import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Megaphone, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { Input, Select, Textarea, FormGrid } from '../../components/ui/Form';
import { Badge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime } from '../../utils/format';

/**
 * Notice board.
 *
 * Everyone reads the notices addressed to them; the main process applies the
 * role-to-audience mapping, so the filter here is a convenience rather than a
 * control. Only an admin sees the write actions.
 */
export function NoticesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
  const canManage = user?.role === 'admin';

  const [rows, setRows] = useState([]);
  const [audiences, setAudiences] = useState([]);
  const [filters, setFilters] = useState({ audience: '', search: '', includeExpired: false, includeInactive: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.notices.list({
        audience: filters.audience || undefined,
        search: filters.search || undefined,
        includeExpired: filters.includeExpired || undefined,
        includeInactive: filters.includeInactive || undefined,
      });
      setRows(result.rows);
      setAudiences(result.audiences);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [filters.audience, filters.search, filters.includeExpired, filters.includeInactive, t, toast]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.audience, filters.includeExpired, filters.includeInactive]);

  // The search box is debounced; the first render is skipped so opening the
  // page does not fire two identical requests.
  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) {
      firstSearch.current = false;
      return undefined;
    }
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  const blank = () => ({ title: '', body: '', audience: 'all', pinned: false, expiresAt: '', isActive: true });

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const payload = {
        id: form.id,
        title: form.title,
        body: form.body || undefined,
        audience: form.audience,
        pinned: !!form.pinned,
        expiresAt: form.expiresAt || undefined,
        isActive: form.isActive !== false,
      };
      await api.notices.save(payload);
      toast.success(t('notices.saved'));
      setForm(null);
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
      await api.notices.remove(deleteTarget.id);
      toast.success(t('common.deleted', { item: t('notices.notice') }));
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (row) => {
    try {
      await api.notices.pin(row.id, !row.pinned);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  return (
    <>
      <PageHeader
        title={t('notices.title')}
        subtitle={t('notices.subtitle')}
        actions={
          canManage ? (
            <Button icon={Plus} variant="primary" onClick={() => setForm(blank())}>
              {t('notices.addNotice')}
            </Button>
          ) : null
        }
      />

      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[180px]">
            <Select
              label={t('notices.audience')}
              value={filters.audience}
              placeholder={t('notices.allAudiences')}
              options={audiences.map((value) => ({ value, label: t(`notices.audience_${value}`) }))}
              onChange={(e) => setFilters({ ...filters, audience: e.target.value })}
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <Input
              label={t('common.search')}
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-5 pb-2">
              <label className="flex items-center gap-2.5 text-[12.5px] text-[var(--color-ink2)]">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                  checked={filters.includeExpired}
                  onChange={(e) => setFilters({ ...filters, includeExpired: e.target.checked })}
                />
                {t('notices.showExpired')}
              </label>
              <label className="flex items-center gap-2.5 text-[12.5px] text-[var(--color-ink2)]">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                  checked={filters.includeInactive}
                  onChange={(e) => setFilters({ ...filters, includeInactive: e.target.checked })}
                />
                {t('notices.showUnpublished')}
              </label>
            </div>
          )}
        </div>
      </Panel>

      {rows.length === 0 && !loading ? (
        <Panel>
          <EmptyState icon={Megaphone} title={t('notices.noNotices')} hint={t('notices.noNoticesHint')} />
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <article
              key={row.id}
              className={clsx(
                'panel flex flex-col gap-3 p-5',
                row.pinned && 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)]',
                row.isExpired && 'opacity-60',
              )}
            >
              <header className="flex items-start justify-between gap-2">
                <h3 className="text-[14.5px] font-semibold leading-snug text-[var(--color-ink)]">{row.title}</h3>
                <div className="flex shrink-0 items-center gap-1">
                  {row.pinned && <Pin size={14} className="text-[var(--accent)]" />}
                  {canManage && (
                    <>
                      <IconButton
                        icon={row.pinned ? PinOff : Pin}
                        label={row.pinned ? t('notices.unpin') : t('notices.pin')}
                        onClick={() => togglePin(row)}
                      />
                      <IconButton
                        icon={Pencil}
                        label={t('common.edit')}
                        onClick={() =>
                          setForm({
                            id: row.id,
                            title: row.title,
                            body: row.body,
                            audience: row.audience,
                            pinned: row.pinned,
                            expiresAt: row.expiresAt || '',
                            isActive: row.isActive,
                          })
                        }
                      />
                      <IconButton icon={Trash2} label={t('common.delete')} onClick={() => setDeleteTarget(row)} />
                    </>
                  )}
                </div>
              </header>

              {row.body && (
                <p className="whitespace-pre-line text-[13px] leading-relaxed text-[var(--color-ink2)]">{row.body}</p>
              )}

              <footer className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <Badge tone="info">{t(`notices.audience_${row.audience}`)}</Badge>
                {row.pinned && <Badge tone="accent">{t('notices.pinned')}</Badge>}
                {row.isExpired ? (
                  <Badge tone="danger">{t('notices.expired')}</Badge>
                ) : (
                  !row.isActive && <Badge tone="neutral">{t('common.inactive')}</Badge>
                )}
                <span className="ms-auto text-[11px] text-[var(--color-dim)]">
                  {row.authorName ? `${row.authorName} · ` : ''}
                  {formatDateTime(row.createdAt)}
                </span>
              </footer>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? t('notices.editNotice') : t('notices.addNotice')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {form && (
          <FormGrid columns={1}>
            <Input
              label={t('common.name')}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
            <Textarea
              label={t('notices.body')}
              rows={5}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
            <FormGrid columns={2}>
              <Select
                label={t('notices.audience')}
                value={form.audience}
                options={audiences.map((value) => ({ value, label: t(`notices.audience_${value}`) }))}
                onChange={(e) => setForm({ ...form, audience: e.target.value })}
              />
              <Input
                label={t('notices.expiresAt')}
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </FormGrid>
            <label className="flex items-center gap-2.5 text-[13px] text-[var(--color-ink2)]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--accent)]"
                checked={!!form.pinned}
                onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
              />
              {t('notices.pinned')}
            </label>
            <label className="flex items-center gap-2.5 text-[13px] text-[var(--color-ink2)]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--accent)]"
                checked={form.isActive !== false}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              {t('notices.active')}
            </label>
          </FormGrid>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={busy}
        title={t('common.deleteConfirmTitle', { item: t('notices.notice') })}
        message={t('common.deleteConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

export default NoticesPage;