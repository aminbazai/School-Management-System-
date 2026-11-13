import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DatabaseBackup, FolderOpen, HardDrive, Plus, RotateCcw, Trash2 } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, StatCard } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Form';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime } from '../../utils/format';

/**
 * Phase 8 backup desk.
 *
 * Restoring replaces the whole database, so it is behind a confirm dialog that
 * says plainly what is lost. The main process keeps a safety copy of the live
 * database before it swaps anything in, which is what makes this reversible.
 */
export function BackupPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [info, setInfo] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meta, list] = await Promise.all([api.backup.info(), api.backup.list()]);
      setInfo(meta);
      setRows(list.rows);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const result = await api.backup.create({ note });
      toast.success(t('backup.backupCreated'));
      setNote('');
      setNoteOpen(false);
      load();
      return result;
    } catch (err) {
      toast.error(t(errorKey(err)));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!restoreTarget) return;
    setBusy(true);
    try {
      const result = await api.backup.restore(restoreTarget.name);
      toast.success(t('backup.restored', { name: result.restored }));
      setRestoreTarget(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.backup.remove(deleteTarget.name);
      toast.success(t('common.deleted', { item: t('backup.file') }));
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('backup.title')}
        subtitle={t('backup.subtitle')}
        actions={
          <>
            <Button
              icon={FolderOpen}
              onClick={async () => {
                try {
                  await api.backup.openFolder();
                } catch (err) {
                  toast.error(t(errorKey(err)));
                }
              }}
            >
              {t('backup.openFolder')}
            </Button>
            <Button
              icon={HardDrive}
              onClick={async () => {
                try {
                  const result = await api.backup.restoreFile();
                  if (!result.canceled) {
                    toast.success(t('backup.imported', { name: result.name }));
                    load();
                  }
                } catch (err) {
                  toast.error(t(errorKey(err)));
                }
              }}
            >
              {t('backup.restoreFile')}
            </Button>
            <Button icon={Plus} variant="primary" onClick={() => setNoteOpen(true)}>
              {t('backup.createBackup')}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('backup.database')}
          menu={false}
          icon={HardDrive}
          value={loading ? <Skeleton /> : info?.databaseSizeLabel || '-'}
          hint={info?.databaseFile}
        />
        <StatCard
          label={t('backup.backups')}
          menu={false}
          icon={DatabaseBackup}
          value={loading ? <Skeleton /> : rows.length}
          hint={info?.backupFolder}
        />
        <StatCard
          label={t('backup.lastBackup')}
          menu={false}
          value={loading ? <Skeleton /> : info?.lastBackup ? formatDateTime(info.lastBackup) : t('backup.never')}
        />
        <StatCard label={t('backup.appVersion')} menu={false} value={loading ? <Skeleton /> : info?.version || '-'} />
      </div>

      <Panel className="mb-4">
        <p className="text-[12.5px] leading-relaxed text-[var(--color-muted)]">
          {t('backup.autoNote')} {t('backup.keepLast')}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-[11.5px]">
          <Badge tone="neutral">{t('backup.dataFolder')}: {info?.dataFolder}</Badge>
          <Badge tone="neutral">{t('backup.backupFolder')}: {info?.backupFolder}</Badge>
        </div>
      </Panel>

      <Panel padded={false}>
        <DataTable
          rows={rows}
          loading={loading}
          total={rows.length}
          emptyIcon={DatabaseBackup}
          emptyTitle={t('backup.noBackups')}
          emptyHint={t('backup.noBackupsHint')}
          columns={[
            {
              key: 'name',
              header: t('backup.file'),
              render: (row) => <span className="no-urdu text-[12px]">{row.name}</span>,
            },
            {
              key: 'kind',
              header: t('backup.kind'),
              render: (row) => (
                <Badge tone={row.kind === 'automatic' ? 'info' : 'accent'}>
                  {row.kind === 'automatic' ? t('backup.automatic') : t('backup.manual')}
                </Badge>
              ),
            },
            { key: 'sizeLabel', header: t('backup.size'), align: 'end', className: 'no-urdu' },
            {
              key: 'createdAt',
              header: t('backup.taken'),
              render: (row) => formatDateTime(row.createdAt),
            },
            {
              key: 'actions',
              header: t('common.actions'),
              align: 'end',
              render: (row) => (
                <div className="flex items-center justify-end gap-1">
                  <IconButton icon={RotateCcw} label={t('backup.restore')} onClick={() => setRestoreTarget(row)} />
                  <IconButton
                    icon={FolderOpen}
                    label={t('backup.openFolder')}
                    onClick={async () => {
                      try {
                        await api.backup.openFolder();
                      } catch (err) {
                        toast.error(t(errorKey(err)));
                      }
                    }}
                  />
                  <IconButton icon={Trash2} label={t('common.delete')} onClick={() => setDeleteTarget(row)} />
                </div>
              ),
            },
          ]}
        />
      </Panel>

      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title={t('backup.createBackup')}
        subtitle={t('backup.noBackupsHint')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNoteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={create}>
              {t('backup.createBackup')}
            </Button>
          </>
        }
      >
        <Input
          label={t('backup.file')}
          value={note}
          maxLength={32}
          placeholder="before-exams"
          hint={t('common.optional')}
          onChange={(e) => setNote(e.target.value)}
        />
      </Modal>

      <ConfirmDialog
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={restore}
        loading={busy}
        title={t('backup.restoreConfirm')}
        message={t('backup.restoreConfirmBody')}
        confirmLabel={t('backup.restore')}
        cancelLabel={t('common.cancel')}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={busy}
        title={t('common.deleteConfirmTitle', { item: t('backup.file') })}
        message={t('common.deleteConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

export default BackupPage;