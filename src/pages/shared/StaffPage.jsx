import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Pencil, Trash2, Users as UsersIcon, Image as ImageIcon, Upload, FileSpreadsheet } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable, TableSearch } from '../../components/ui/DataTable';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Input, Select, Textarea, FormGrid } from '../../components/ui/Form';
import { useToast } from '../../components/ui/Toast';
import { formatDate } from '../../utils/format';

const EMPTY = {
  employeeCode: '',
  name: '',
  fatherName: '',
  cnic: '',
  phone: '',
  email: '',
  address: '',
  qualification: '',
  designation: '',
  staffType: 'teacher',
  joiningDate: new Date().toISOString().slice(0, 10),
  basicSalary: 0,
  bloodGroup: '',
  status: 'active',
  notes: '',
  photoPath: '',
  photoPreview: null,
  createLogin: true,
};

export function StaffPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const canDelete = user?.role === 'admin';

  const [query, setQuery] = useState({ page: 1, pageSize: 25 });
  const [filters, setFilters] = useState({ search: '', staffType: '', status: '' });
  const search = useDebouncedValue(filters.search, 300);
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const [importData, setImportData] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importUpdate, setImportUpdate] = useState(false);
  const [importCreateLogin, setImportCreateLogin] = useState(false);

  const lang = i18n.resolvedLanguage || 'en';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await api.staff.list({
          page: query.page,
          pageSize: query.pageSize,
          search: search || undefined,
          staffType: filters.staffType || undefined,
          status: filters.status || undefined,
        }),
      );
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [query, search, filters, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (event) => {
    event?.preventDefault();
    if (saving || !form) return;
    setSaving(true);
    setFormErrors({});
    try {
      const payload = {
        employeeCode: form.employeeCode || undefined,
        name: form.name,
        fatherName: form.fatherName || undefined,
        cnic: form.cnic || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        address: form.address || undefined,
        qualification: form.qualification || undefined,
        designation: form.designation || undefined,
        staffType: form.staffType,
        joiningDate: form.joiningDate || undefined,
        photoPath: form.photoPath || undefined,
        basicSalary: Number(form.basicSalary) || 0,
        bloodGroup: form.bloodGroup || undefined,
        status: form.status,
        notes: form.notes || undefined,
        createLogin: form.createLogin || undefined,
      };
      if (form.id) {
        await api.staff.update(form.id, payload);
        toast.success(t('common.saved'));
      } else {
        await api.staff.create(payload);
        toast.success(t('common.created', { item: t('staff.title') }));
      }
      setForm(null);
      load();
    } catch (err) {
      if (err.fields) setFormErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, t(`validation.${v}`)])));
      else toast.error(t(errorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async () => {
    try {
      const result = await api.files.pickImage('staff');
      if (result.canceled) return;
      setForm((prev) => ({ ...prev, photoPath: result.storedName, photoPreview: result.dataUrl }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const runImportPreview = async () => {
    setImportBusy(true);
    try {
      const result = await api.staff.importPreview();
      if (result.canceled) return;
      setImportUpdate(false);
      setImportCreateLogin(false);
      setImportData({ ...result, committed: false });
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setImportBusy(false);
    }
  };

  const commitImport = async () => {
    setImportBusy(true);
    try {
      const result = await api.staff.importCommit({
        rows: importData.rows,
        updateExisting: importUpdate,
        createLogin: importCreateLogin,
      });
      setImportData((prev) => ({ ...prev, committed: true, result }));
      toast.success(t('staff.importDone', { imported: result.imported, updated: result.updated, failed: result.failed }));
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setImportBusy(false);
    }
  };

  const exportExcel = async () => {
    try {
      const result = await api.staff.exportExcel({
        search: search || undefined,
        staffType: filters.staffType || undefined,
        status: filters.status || undefined,
      });
      if (!result.canceled) toast.success(t('staff.exported', { count: result.count }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.staff.remove(deleteTarget.id);
      toast.success(t('common.deleted', { item: t('staff.title') }));
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: t('common.name'),
        sortable: true,
        render: (row) => (
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--glass-2)] text-[10.5px] font-semibold text-[var(--color-muted)]">
              {row.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-[var(--color-ink)]">{row.name}</p>
              <p className="no-urdu truncate text-[11px] text-[var(--color-dim)]">
                {row.employeeCode || row.username || '-'}
              </p>
            </div>
          </div>
        ),
      },
      { key: 'designation', header: t('staff.designation'), render: (row) => row.designation || '-' },
      { key: 'qualification', header: t('staff.qualification'), render: (row) => row.qualification || '-' },
      { key: 'phone', header: t('students.phone'), className: 'no-urdu', render: (row) => row.phone || '-' },
      { key: 'basicSalary', header: t('staff.basicSalary'), align: 'end', className: 'no-urdu', render: (row) => row.basicSalary },
      {
        key: 'joiningDate',
        header: t('staff.joiningDate'),
        className: 'no-urdu',
        render: (row) => (row.joiningDate ? formatDate(row.joiningDate, lang) : '-'),
      },
      {
        key: 'status',
        header: t('common.status'),
        render: (row) => (
          <div className="flex items-center gap-1.5">
            <StatusBadge status={row.status === 'active' ? 'active' : row.status === 'inactive' ? 'inactive' : 'on_leave'} />
            {row.hasLogin && <Badge tone="neutral">@{row.username}</Badge>}
          </div>
        ),
      },
      {
        key: 'actions',
        header: t('common.actions'),
        align: 'end',
        render: (row) => (
          <div className="flex items-center justify-end gap-1">
            <IconButton
              icon={Pencil}
              label={t('common.edit')}
              onClick={() => {
                setFormErrors({});
                setForm({ ...EMPTY, ...row, photoPreview: null, createLogin: false });
              }}
            />
            {canDelete && (
              <IconButton icon={Trash2} label={t('common.delete')} onClick={() => setDeleteTarget(row)} />
            )}
          </div>
        ),
      },
    ],
    [t, lang, canDelete],
  );

  return (
    <>
      <PageHeader
        title={t('staff.title')}
        subtitle={t('staff.subtitle')}
        actions={
          <>
            <Button
              variant="primary"
              icon={UserPlus}
              onClick={() => {
                setFormErrors({});
                setForm({ ...EMPTY });
              }}
            >
              {t('staff.addMember')}
            </Button>
            <Button icon={Upload} onClick={runImportPreview} loading={importBusy}>
              {t('common.import')}
            </Button>
            <Button icon={FileSpreadsheet} onClick={exportExcel}>
              Excel
            </Button>
          </>
        }
      />

      <Panel padded={false}>
        <DataTable
          columns={columns}
          rows={data.rows}
          loading={loading}
          total={data.total}
          page={query.page}
          pageSize={query.pageSize}
          emptyIcon={UsersIcon}
          emptyTitle={t('common.noData')}
          emptyHint={t('common.noDataHint')}
          onPageChange={(page) => setQuery((q) => ({ ...q, page }))}
          onPageSizeChange={(pageSize) => setQuery((q) => ({ ...q, pageSize, page: 1 }))}
          toolbar={
            <>
              <TableSearch
                value={filters.search}
                onChange={(v) => setFilters((f) => ({ ...f, search: v }))}
                placeholder={t('staff.searchPlaceholder')}
              />
              <div className="w-[180px]">
                <Select
                  value={filters.staffType}
                  placeholder={t('staff.allTypes')}
                  options={[
                    { value: 'teacher', label: t('roles.teacher') },
                    { value: 'office', label: t('roles.office') },
                    { value: 'other', label: t('staff.other') },
                  ]}
                  onChange={(e) => setFilters((f) => ({ ...f, staffType: e.target.value }))}
                />
              </div>
              <div className="w-[170px]">
                <Select
                  value={filters.status}
                  placeholder={t('common.status')}
                  options={[
                    { value: 'active', label: t('common.active') },
                    { value: 'on_leave', label: t('staff.onLeave') },
                    { value: 'inactive', label: t('common.inactive') },
                  ]}
                  onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                />
              </div>
            </>
          }
        />
      </Panel>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? t('common.editItem', { item: t('staff.title') }) : t('common.newItem', { item: t('staff.title') })}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={submit}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {form && (
          <form onSubmit={submit} className="flex flex-col gap-5">
            <div className="flex items-start gap-4">
              <div className="flex h-24 w-20 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--color-line2)] bg-[var(--glass)] text-[var(--color-dim)]">
                {form.photoPreview ? (
                  <img src={form.photoPreview} alt="" className="h-16 w-14 rounded-lg object-cover" />
                ) : (
                  <ImageIcon size={20} />
                )}
                <Button size="sm" variant="ghost" onClick={pickPhoto}>
                  {t('common.edit')}
                </Button>
              </div>
              <div className="grid flex-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('common.name')}
                  value={form.name}
                  error={formErrors.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
                <Input
                  label={t('staff.employeeCode')}
                  value={form.employeeCode}
                  error={formErrors.employeeCode}
                  onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
                />
                <Select
                  label={t('staff.type')}
                  value={form.staffType}
                  options={[
                    { value: 'teacher', label: t('roles.teacher') },
                    { value: 'office', label: t('roles.office') },
                    { value: 'other', label: t('staff.other') },
                  ]}
                  onChange={(e) => setForm({ ...form, staffType: e.target.value })}
                />
                <Select
                  label={t('common.status')}
                  value={form.status}
                  options={[
                    { value: 'active', label: t('common.active') },
                    { value: 'on_leave', label: t('staff.onLeave') },
                    { value: 'inactive', label: t('common.inactive') },
                  ]}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                />
              </div>
            </div>

            <div>
              <p className="eyebrow mb-3">{t('staff.sectionContact')}</p>
              <FormGrid columns={3}>
                <Input label="CNIC" value={form.cnic} error={formErrors.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} />
                <Input label={t('students.phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                <Input label={t('staff.fatherName')} value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} />
                <Select
                  label={t('staff.bloodGroup')}
                  value={form.bloodGroup}
                  placeholder={t('common.optional')}
                  options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((v) => ({ value: v, label: v }))}
                  onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}
                />
                <Input label={t('staff.joiningDate')} type="date" value={form.joiningDate} onChange={(e) => setForm({ ...form, joiningDate: e.target.value })} />
              </FormGrid>
              <div className="mt-4 grid gap-4">
                <Textarea label={t('settings.address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
            </div>

            <div>
              <p className="eyebrow mb-3">{t('staff.sectionEmployment')}</p>
              <FormGrid columns={2}>
                <Input label={t('staff.designation')} value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
                <Input label={t('staff.qualification')} value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} />
                <Input
                  label={t('staff.basicSalary')}
                  type="number"
                  value={form.basicSalary}
                  error={formErrors.basicSalary}
                  onChange={(e) => setForm({ ...form, basicSalary: e.target.value })}
                />
              </FormGrid>
              <div className="mt-4 grid gap-4">
                <Textarea label={t('staff.notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>

            {!form.hasLogin && (
              <label className="flex items-center gap-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] px-3.5 py-3">
                <input
                  type="checkbox"
                  checked={form.createLogin}
                  onChange={(e) => setForm({ ...form, createLogin: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span className="text-[12.5px] text-[var(--color-ink2)]">{t('staff.createLoginHint')}</span>
              </label>
            )}
          </form>
        )}
      </Modal>

      {/* Excel import */}
      <Modal
        open={!!importData}
        onClose={() => setImportData(null)}
        title={t('staff.importTitle')}
        subtitle={importData ? t('staff.importSubtitle', { count: importData.total }) : ''}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportData(null)}>
              {t('common.close')}
            </Button>
            {!importData?.committed && (
              <Button variant="primary" loading={importBusy} onClick={commitImport}>
                {t('staff.importNow')}
              </Button>
            )}
          </>
        }
      >
        {importData && (
          <div className="flex flex-col gap-4">
            {importData.result && (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-ok)_10%,transparent)] p-3 text-[12.5px]">
                {t('staff.importResult', {
                  imported: importData.result.imported,
                  updated: importData.result.updated,
                  failed: importData.result.failed,
                })}
              </div>
            )}
            {importData.result?.errors?.length > 0 && (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] p-3">
                <p className="mb-1.5 text-[12.5px] font-medium text-[var(--color-ink)]">{t('staff.importErrors')}</p>
                <ul className="flex flex-col gap-1 text-[11.5px] text-[var(--color-muted)]">
                  {importData.result.errors.slice(0, 8).map((e, i) => (
                    <li key={i}>
                      {t('staff.row')} {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!importData.committed && (
              <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] p-3.5">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={importUpdate}
                    onChange={(e) => setImportUpdate(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span className="text-[12px] text-[var(--color-ink2)]">{t('staff.importUpdate')}</span>
                </label>
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={importCreateLogin}
                    onChange={(e) => setImportCreateLogin(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span className="text-[12px] text-[var(--color-ink2)]">{t('staff.importCreateLogin')}</span>
                </label>
              </div>
            )}
            <div className="max-h-[320px] overflow-auto rounded-xl border border-[var(--color-line)]">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('common.name')}</th>
                    <th>{t('staff.employeeCode')}</th>
                    <th>{t('staff.designation')}</th>
                    <th>{t('staff.type')}</th>
                    <th>{t('students.phone')}</th>
                  </tr>
                </thead>
                <tbody>
                  {importData.rows.slice(0, 100).map((row, index) => (
                    <tr key={index}>
                      <td className="no-urdu text-[var(--color-dim)]">{index + 2}</td>
                      <td>{row.name || '-'}</td>
                      <td className="no-urdu">{row.employee_code || '-'}</td>
                      <td>{row.designation || '-'}</td>
                      <td>{row.staff_type || '-'}</td>
                      <td className="no-urdu">{row.phone || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={busy}
        title={t('common.deleteConfirmTitle', { item: t('staff.title') })}
        message={t('staff.deleteWarning')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

export default StaffPage;