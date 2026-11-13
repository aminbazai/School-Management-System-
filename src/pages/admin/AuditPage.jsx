import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ScrollText } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel } from '../../components/ui/Panel';
import { Button } from '../../components/ui/Button';
import { DataTable, TableSearch } from '../../components/ui/DataTable';
import { Input, Select } from '../../components/ui/Form';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime } from '../../utils/format';

const ACTIONS = [
  { value: 'login', labelKey: 'audit.login' },
  { value: 'create', labelKey: 'common.add' },
  { value: 'update', labelKey: 'common.edit' },
  { value: 'delete', labelKey: 'common.delete' },
  { value: 'pay', labelKey: 'audit.pay' },
  { value: 'print', labelKey: 'common.print' },
  { value: 'backup', labelKey: 'backup.title' },
  { value: 'exam', labelKey: 'exams.title' },
];

const ACTION_TONES = {
  login: 'ok',
  login_failed: 'danger',
  logout: 'neutral',
  create: 'accent',
  update: 'info',
  delete: 'danger',
  pay: 'ok',
  print: 'neutral',
  backup: 'accent',
};

/**
 * Phase 8 audit screen.
 *
 * The log is append-only in the main process; this page only reads it. Export
 * is done in the renderer from the rows already fetched - the log itself is
 * never written to from here.
 */
export function AuditPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [filters, setFilters] = useState({ action: '', search: '', from: '', to: '' });
  const [data, setData] = useState({ total: 0, rows: [] });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await api.audit.list({
          action: filters.action || undefined,
          search: filters.search || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          page,
          pageSize,
        }),
      );
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [filters.action, filters.from, filters.to, filters.search, page, pageSize, t, toast]);

  // Changing a filter always goes back to page 1, and the loader reads `page`
  // from the same render, so the reset has to happen in the handlers rather
  // than in a separate effect (which would fire a second, stale load first).
  const setFilter = (patch) => {
    setPage(1);
    setFilters({ ...filters, ...patch });
  };

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = () => {
    const header = [t('audit.when'), t('audit.user'), t('common.role'), t('audit.action'), t('audit.entity'), t('audit.details')];
    const lines = data.rows.map((row) =>
      [row.created_at, row.username, row.role, row.action, row.entity || '', row.details || '']
        .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t('attendance.exported'));
  };

  return (
    <>
      <PageHeader
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        actions={
          <Button icon={Download} onClick={exportCsv} disabled={data.rows.length === 0}>
            CSV
          </Button>
        }
      />

      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[170px]">
            <Select
              label={t('audit.action')}
              value={filters.action}
              placeholder={t('common.filter')}
              options={ACTIONS.map((action) => ({ value: action.value, label: t(action.labelKey) }))}
              onChange={(e) => setFilter({ action: e.target.value })}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <TableSearch
              value={filters.search}
              onChange={(search) => setFilter({ search })}
              placeholder={t('common.search')}
            />
          </div>
          <div className="w-[160px]">
            <Input
              label={t('common.from')}
              type="date"
              value={filters.from}
              onChange={(e) => setFilter({ from: e.target.value })}
            />
          </div>
          <div className="w-[160px]">
            <Input
              label={t('common.to')}
              type="date"
              value={filters.to}
              onChange={(e) => setFilter({ to: e.target.value })}
            />
          </div>
        </div>
      </Panel>

      <Panel padded={false}>
        <DataTable
          rows={data.rows}
          loading={loading}
          total={data.total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          emptyIcon={ScrollText}
          emptyTitle={t('common.noData')}
          emptyHint={t('common.noDataHint')}
          columns={[
            {
              key: 'created_at',
              header: t('audit.when'),
              render: (row) => formatDateTime(row.created_at),
              width: 180,
            },
            {
              key: 'username',
              header: t('audit.user'),
              render: (row) => (
                <div>
                  <p className="font-medium text-[var(--color-ink)]">{row.username || '-'}</p>
                  {row.role && (
                    <p className="text-[11px] text-[var(--color-dim)]">{t(`roles.${row.role}`)}</p>
                  )}
                </div>
              ),
            },
            {
              key: 'action',
              header: t('audit.action'),
              render: (row) => (
                <Badge tone={ACTION_TONES[row.action] || 'neutral'}>
                  {String(row.action || '').replace(/_/g, ' ')}
                </Badge>
              ),
            },
            { key: 'entity', header: t('audit.entity'), render: (row) => row.entity || '-' },
            {
              key: 'details',
              header: t('audit.details'),
              render: (row) => (
                <span className="no-urdu line-clamp-2 text-[11.5px] text-[var(--color-muted)]">{row.details || '-'}</span>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}

export default AuditPage;