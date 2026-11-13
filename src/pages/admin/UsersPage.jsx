import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Search, KeyRound, Trash2, Power, Users as UsersIcon, Pencil } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel } from '../../components/ui/Panel';
import { Button, IconButton, Spinner } from '../../components/ui/Button';
import { Input, Select, PasswordInput, FormGrid } from '../../components/ui/Form';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime, initialsOf } from '../../utils/format';
import { ROLES } from '../../lib/constants';

const EMPTY_FORM = { username: '', password: '', role: 'teacher', linkedId: '', email: '', phone: '', isActive: true };

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { user: currentUser } = useAuth();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);

  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const lang = i18n.resolvedLanguage || 'en';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.users.list({ search: debouncedSearch, role: role || undefined, limit: 200 });
      setRows(data.rows);
      setTotal(data.total);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, role, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const roleOptions = useMemo(
    () => ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) })),
    [t],
  );

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setForm({
      username: row.username,
      password: '',
      role: row.role,
      linkedId: row.linkedId ? String(row.linkedId) : '',
      email: row.email || '',
      phone: row.phone || '',
      isActive: row.isActive,
      mustChangePassword: row.mustChangePassword,
    });
    setFormErrors({});
    setEditTarget(row);
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    if (saving || !editTarget) return;
    setSaving(true);
    setFormErrors({});
    try {
      await api.users.update(editTarget.id, {
        role: form.role,
        linkedId: form.linkedId ? Number(form.linkedId) : undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        isActive: form.isActive,
        mustChangePassword: form.mustChangePassword,
      });
      toast.success(t('common.saved'));
      setEditTarget(null);
      load();
    } catch (err) {
      if (err.fields) {
        setFormErrors(
          Object.fromEntries(
            Object.entries(err.fields).map(([key, code]) => [key, t(`validation.${code}`)]),
          ),
        );
      } else {
        toast.error(t(errorKey(err)));
      }
    } finally {
      setSaving(false);
    }
  };

  const submitCreate = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormErrors({});
    try {
      await api.users.create({
        ...form,
        linkedId: form.linkedId ? Number(form.linkedId) : undefined,
      });
      toast.success(t('common.created', { item: t('nav.admin.users') }));
      setModalOpen(false);
      load();
    } catch (err) {
      if (err.fields) {
        setFormErrors(
          Object.fromEntries(
            Object.entries(err.fields).map(([key, code]) => [key, t(`validation.${code}`)]),
          ),
        );
      } else {
        toast.error(t(errorKey(err)));
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row) => {
    try {
      await api.users.setActive(row.id, !row.isActive);
      toast.success(t('common.saved'));
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const submitReset = async (event) => {
    event.preventDefault();
    if (!resetTarget || busy) return;
    setBusy(true);
    try {
      await api.users.resetPassword(resetTarget.id, resetPassword);
      toast.success(t('common.saved'));
      setResetTarget(null);
      setResetPassword('');
      load();
    } catch (err) {
      if (err.fields?.password) toast.warning(t(`validation.${err.fields.password}`));
      else toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      await api.users.remove(deleteTarget.id);
      toast.success(t('common.deleted', { item: t('nav.admin.users') }));
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
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={
          <Button variant="primary" icon={UserPlus} onClick={openCreate}>
            {t('users.addUser')}
          </Button>
        }
      />

      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-line)] p-4">
          <div className="min-w-[240px] flex-1">
            <Input
              icon={Search}
              placeholder={`${t('common.search')}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-[200px]">
            <Select
              value={role}
              placeholder={t('common.filter')}
              options={roleOptions}
              onChange={(e) => setRole(e.target.value)}
            />
          </div>
          <Badge tone="neutral">
            {t('common.total')}: <span className="no-urdu ms-1 text-[var(--color-ink)]">{total}</span>
          </Badge>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size={20} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title={t('common.noData')} hint={t('common.noDataHint')} icon={UsersIcon} />
        ) : (
          <div className="max-h-[62vh] overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('common.username')}</th>
                  <th>{t('common.role')}</th>
                  <th>{t('users.lastLogin')}</th>
                  <th>{t('common.status')}</th>
                  <th className="text-end">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--glass-2)] text-[11px] font-semibold">
                          {initialsOf(row.displayName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[var(--color-ink)]">{row.displayName}</p>
                          {row.mustChangePassword && (
                            <p className="text-[10.5px] text-[var(--color-warn)]">{t('users.mustChange')}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="no-urdu">{row.username}</td>
                    <td>
                      <Badge tone="accent">{t(`roles.${row.role}`)}</Badge>
                    </td>
                    <td className="no-urdu text-[12px]">
                      {row.lastLogin ? formatDateTime(row.lastLogin, lang) : t('users.never')}
                    </td>
                    <td>
                      <StatusBadge status={row.isActive ? 'active' : 'inactive'} />
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <IconButton
                          icon={Pencil}
                          label={t('users.editUser')}
                          onClick={() => openEdit(row)}
                        />
                        <IconButton
                          icon={KeyRound}
                          label={t('users.resetPassword')}
                          onClick={() => {
                            setResetTarget(row);
                            setResetPassword('');
                          }}
                        />
                        {row.id !== currentUser?.id && (
                          <IconButton
                            icon={Power}
                            label={row.isActive ? t('users.deactivate') : t('users.activate')}
                            onClick={() => toggleActive(row)}
                          />
                        )}
                        {row.id !== currentUser?.id && (
                          <IconButton icon={Trash2} label={t('common.delete')} onClick={() => setDeleteTarget(row)} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Create user */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('users.addUser')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={submitCreate}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form onSubmit={submitCreate} className="flex flex-col gap-4">
          <FormGrid>
            <Input
              label={t('common.username')}
              value={form.username}
              error={formErrors.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
            <Select
              label={t('common.role')}
              value={form.role}
              options={roleOptions}
              error={formErrors.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            />
          </FormGrid>
          <PasswordInput
            label={t('common.password')}
            value={form.password}
            error={formErrors.password}
            hint="6 characters minimum - the user must change it after the first login"
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <FormGrid>
            <Input
              label="Email"
              type="email"
              value={form.email}
              error={formErrors.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              label="Phone"
              value={form.phone}
              error={formErrors.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </FormGrid>
          <Input
            label={`${t('users.linkedTo')} (ID)`}
            value={form.linkedId}
            error={formErrors.linkedId}
            hint="Optional: student.id or staff.id this account belongs to"
            onChange={(e) => setForm({ ...form, linkedId: e.target.value })}
          />
        </form>
      </Modal>

      {/* Edit user */}
      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={t('users.editUser')}
        subtitle={editTarget?.username}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={submitEdit}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form onSubmit={submitEdit} className="flex flex-col gap-4">
          <FormGrid>
            <Input label={t('common.username')} value={form.username} disabled readOnly />
            <Select
              label={t('common.role')}
              value={form.role}
              options={roleOptions}
              error={formErrors.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            />
          </FormGrid>
          <FormGrid>
            <Input
              label="Email"
              type="email"
              value={form.email}
              error={formErrors.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              label="Phone"
              value={form.phone}
              error={formErrors.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </FormGrid>
          <Input
            label={`${t('users.linkedTo')} (ID)`}
            value={form.linkedId}
            error={formErrors.linkedId}
            hint="Optional: student.id or staff.id this account belongs to"
            onChange={(e) => setForm({ ...form, linkedId: e.target.value })}
          />
          <FormGrid>
            <label className="field">
              <span className="field-label">{t('common.status')}</span>
              <Select
                value={form.isActive ? 'yes' : 'no'}
                options={[
                  { value: 'yes', label: t('users.active') },
                  { value: 'no', label: t('users.inactive') },
                ]}
                onChange={(e) => setForm({ ...form, isActive: e.target.value === 'yes' })}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('users.passwordPolicy')}</span>
              <Select
                value={form.mustChangePassword ? 'yes' : 'no'}
                options={[
                  { value: 'yes', label: t('users.mustChangeAtNextLogin') },
                  { value: 'no', label: t('users.keepCurrentPassword') },
                ]}
                onChange={(e) => setForm({ ...form, mustChangePassword: e.target.value === 'yes' })}
              />
            </label>
          </FormGrid>
        </form>
      </Modal>

      {/* Reset password */}
      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={t('users.resetPassword')}
        subtitle={resetTarget?.displayName}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={submitReset}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form onSubmit={submitReset}>
          <PasswordInput
            label={t('users.newPassword')}
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            hint={t('users.mustChange')}
            required
          />
        </form>
      </Modal>

      {/* Delete */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={busy}
        title={t('common.deleteConfirmTitle', { item: t('nav.admin.users') })}
        message={t('common.deleteConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

export default UsersPage;