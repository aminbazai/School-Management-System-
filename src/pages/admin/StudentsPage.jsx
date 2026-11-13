import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  UserPlus,
  Upload,
  FileSpreadsheet,
  FileText,
  IdCard,
  ArrowUpCircle,
  Pencil,
  Trash2,
  Users as UsersIcon,
  Image as ImageIcon,
  Eye,
  History,
} from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { useStructure } from '../../hooks/useStructure';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel } from '../../components/ui/Panel';
import { Button, IconButton, Spinner } from '../../components/ui/Button';
import { DataTable, TableSearch } from '../../components/ui/DataTable';
import { StatusBadge, Badge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Input, Select, Textarea, FormGrid } from '../../components/ui/Form';
import { useToast } from '../../components/ui/Toast';
import { formatDate } from '../../utils/format';

const EMPTY = {
  name: '',
  fatherName: '',
  gender: '',
  dob: '',
  bForm: '',
  phone: '',
  email: '',
  address: '',
  classId: '',
  sectionId: '',
  admissionNo: '',
  grNo: '',
  rollNo: '',
  admissionDate: new Date().toISOString().slice(0, 10),
  previousSchool: '',
  status: 'active',
  photoPath: '',
  photoPreview: null,
  guardianName: '',
  guardianRelation: 'father',
  guardianPhone: '',
  guardianCnic: '',
  createLogin: true,
};

function DetailItem({ label, value }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wide text-[var(--color-dim)]">{label}</p>
      <p className="mt-0.5 text-[12.5px] text-[var(--color-ink2)]">{value || '-'}</p>
    </div>
  );
}

export function StudentsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const { structure, sectionsOf } = useStructure();
  const canDelete = user?.role === 'admin';

  const [query, setQuery] = useState({ page: 1, pageSize: 25, sortBy: 'name', sortDir: 'asc' });
  const [filters, setFilters] = useState({ search: '', classId: '', sectionId: '', status: '' });
  const debouncedSearch = useDebouncedValue(filters.search, 300);

  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);

  const [form, setForm] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const [importData, setImportData] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteTo, setPromoteTo] = useState({ classId: '', sectionId: '' });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.students.list({
        page: query.page,
        pageSize: query.pageSize,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        search: debouncedSearch || undefined,
        classId: filters.classId || undefined,
        sectionId: filters.sectionId || undefined,
        status: filters.status || undefined,
      });
      setData(result);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [query, debouncedSearch, filters, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const lang = i18n.resolvedLanguage || 'en';

  const openCreate = () => {
    setForm({ ...EMPTY, classId: filters.classId || '', sectionId: filters.sectionId || '' });
    setFormErrors({});
  };

  const openEdit = async (row) => {
    try {
      const full = await api.students.get(row.id);
      setForm({
        ...EMPTY,
        ...full,
        gender: full.gender || '',
        classId: full.classId || '',
        sectionId: full.sectionId || '',
        guardianName: full.guardianName || '',
        guardianPhone: full.guardianPhone || '',
        photoPreview: null,
        createLogin: false,
      });
      setFormErrors({});
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const openDetail = async (row) => {
    setDetailLoading(true);
    setDetailTarget(null);
    try {
      const full = await api.students.get(row.id);
      setDetailTarget(full);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setDetailLoading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (saving || !form) return;
    setSaving(true);
    setFormErrors({});

    const payload = {
      name: form.name,
      fatherName: form.fatherName || undefined,
      gender: form.gender || undefined,
      dob: form.dob || undefined,
      bForm: form.bForm || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      address: form.address || undefined,
      classId: form.classId ? Number(form.classId) : undefined,
      sectionId: form.sectionId ? Number(form.sectionId) : undefined,
      admissionNo: form.admissionNo || undefined,
      grNo: form.grNo || undefined,
      rollNo: form.rollNo || undefined,
      admissionDate: form.admissionDate || undefined,
      previousSchool: form.previousSchool || undefined,
      status: form.status,
      photoPath: form.photoPath || undefined,
      guardianName: form.guardianName || undefined,
      guardianRelation: form.guardianRelation || undefined,
      guardianPhone: form.guardianPhone || undefined,
      guardianCnic: form.guardianCnic || undefined,
      createLogin: form.createLogin || undefined,
    };

    try {
      if (form.id) {
        await api.students.update(form.id, payload);
        toast.success(t('common.saved'));
      } else {
        await api.students.create(payload);
        toast.success(t('common.created', { item: t('nav.admin.students') }));
      }
      setForm(null);
      load();
    } catch (err) {
      if (err.fields) {
        setFormErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, t(`validation.${v}`)])));
      } else {
        toast.error(t(errorKey(err)));
      }
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async () => {
    try {
      const result = await api.files.pickImage('students');
      if (result.canceled) return;
      setForm((prev) => ({ ...prev, photoPath: result.storedName, photoPreview: result.dataUrl }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const runImportPreview = async () => {
    setImportBusy(true);
    try {
      const result = await api.students.importPreview();
      if (result.canceled) return;
      setImportData({ ...result, errors: [], committed: false });
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setImportBusy(false);
    }
  };

  const commitImport = async () => {
    setImportBusy(true);
    try {
      const result = await api.students.importCommit({ rows: importData.rows, updateExisting: false });
      setImportData((prev) => ({ ...prev, committed: true, result }));
      toast.success(t('students.importDone', { imported: result.imported, failed: result.failed }));
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setImportBusy(false);
    }
  };

  const exportExcel = async () => {
    try {
      const result = await api.students.exportExcel({
        classId: filters.classId || undefined,
        sectionId: filters.sectionId || undefined,
        status: filters.status || undefined,
      });
      if (!result.canceled) toast.success(t('students.exported', { count: result.count }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const exportPdf = async () => {
    try {
      const result = await api.students.exportPdf({
        classId: filters.classId || undefined,
        sectionId: filters.sectionId || undefined,
        status: filters.status || undefined,
      });
      if (!result.canceled) toast.success(t('students.pdfSaved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const printIdCards = async () => {
    try {
      const result = await api.students.idCards(selected.length ? selected : null);
      if (!result.canceled) toast.success(t('students.cardsSaved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const printOneIdCard = async (id) => {
    try {
      const result = await api.students.idCards([id]);
      if (!result.canceled) toast.success(t('students.cardsSaved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const runPromote = async () => {
    setBusy(true);
    try {
      const result = await api.students.promote({
        ids: selected,
        classId: Number(promoteTo.classId),
        sectionId: promoteTo.sectionId ? Number(promoteTo.sectionId) : undefined,
      });
      toast.success(t('students.promoted', { count: result.moved }));
      setPromoteOpen(false);
      setSelected([]);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.students.remove(deleteTarget.id);
      toast.success(t('common.deleted', { item: t('nav.admin.students') }));
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
          <button
            type="button"
            onClick={() => openDetail(row)}
            className="flex items-center gap-2.5 text-start"
            title={t('students.viewDetails')}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--glass-2)] text-[10.5px] font-semibold text-[var(--color-muted)]">
              {row.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-[var(--color-ink)] hover:text-[var(--accent)]">{row.name}</p>
              <p className="no-urdu truncate text-[11px] text-[var(--color-dim)]">{row.admissionNo}</p>
            </div>
          </button>
        ),
      },
      { key: 'fatherName', header: t('students.fatherName'), render: (row) => row.fatherName || '-' },
      {
        key: 'class_name',
        header: t('students.class'),
        sortable: true,
        render: (row) => (
          <span>
            {row.className || '-'}
            {row.sectionName ? <span className="text-[var(--color-dim)]"> - {row.sectionName}</span> : null}
          </span>
        ),
      },
      { key: 'roll_no', header: t('students.rollNo'), render: (row) => row.rollNo || '-' },
      { key: 'phone', header: t('students.phone'), render: (row) => row.phone || '-' },
      {
        key: 'admission_date',
        header: t('students.admissionDate'),
        sortable: true,
        render: (row) => <span className="no-urdu">{row.admissionDate ? formatDate(row.admissionDate, lang) : '-'}</span>,
      },
      { key: 'status', header: t('common.status'), render: (row) => <StatusBadge status={row.status} /> },
      {
        key: 'actions',
        header: t('common.actions'),
        align: 'end',
        render: (row) => (
          <div className="flex items-center justify-end gap-1">
            <IconButton icon={Eye} label={t('common.view')} onClick={() => openDetail(row)} />
            <IconButton icon={IdCard} label={t('students.idCards')} onClick={() => printOneIdCard(row.id)} />
            <IconButton icon={Pencil} label={t('common.edit')} onClick={() => openEdit(row)} />
            {canDelete && (
              <IconButton icon={Trash2} label={t('common.delete')} onClick={() => setDeleteTarget(row)} />
            )}
          </div>
        ),
      },
    ],
    [t, lang, canDelete],
  );

  const classOptions = (structure?.classes || []).map((c) => ({ value: String(c.id), label: c.name }));
  const sectionOptions = sectionsOf(form?.classId || filters.classId).map((s) => ({
    value: String(s.id),
    label: `${s.name} (${s.student_count}/${s.capacity})`,
  }));

  return (
    <>
      <PageHeader
        title={t('students.title')}
        subtitle={t('students.subtitle')}
        actions={
          <>
            <Button icon={UserPlus} variant="primary" onClick={openCreate}>
              {t('students.addStudent')}
            </Button>
            <Button icon={Upload} onClick={runImportPreview} loading={importBusy}>
              {t('common.import')}
            </Button>
            <Button icon={FileSpreadsheet} onClick={exportExcel}>
              Excel
            </Button>
            <Button icon={FileText} onClick={exportPdf}>
              PDF
            </Button>
            <Button icon={IdCard} onClick={printIdCards}>
              {t('students.idCards')}
            </Button>
          </>
        }
      />

      {selected.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-4 py-3">
          <Badge tone="accent">{t('students.selected', { count: selected.length })}</Badge>
          <Button
            size="sm"
            icon={ArrowUpCircle}
            onClick={() => {
              setPromoteTo({ classId: '', sectionId: '' });
              setPromoteOpen(true);
            }}
          >
            {t('students.promote')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            {t('common.reset')}
          </Button>
        </div>
      )}

      <Panel padded={false}>
        <DataTable
          columns={columns}
          rows={data.rows}
          loading={loading}
          total={data.total}
          page={query.page}
          pageSize={query.pageSize}
          selected={selected}
          selectable
          onSelect={setSelected}
          emptyIcon={UsersIcon}
          emptyTitle={t('common.noData')}
          emptyHint={t('common.noDataHint')}
          onPageChange={(page) => setQuery((q) => ({ ...q, page }))}
          onPageSizeChange={(pageSize) => setQuery((q) => ({ ...q, pageSize, page: 1 }))}
          onSort={(sortBy) =>
            setQuery((q) => ({
              ...q,
              page: 1,
              sortBy,
              sortDir: q.sortBy === sortBy && q.sortDir === 'asc' ? 'desc' : 'asc',
            }))
          }
          sortBy={query.sortBy}
          sortDir={query.sortDir}
          toolbar={
            <>
              <TableSearch value={filters.search} onChange={(v) => setFilters((f) => ({ ...f, search: v }))} placeholder={t('students.searchPlaceholder')} />
              <div className="w-[170px]">
                <Select
                  value={filters.classId}
                  placeholder={t('students.allClasses')}
                  options={classOptions}
                  onChange={(e) => setFilters((f) => ({ ...f, classId: e.target.value, sectionId: '' }))}
                />
              </div>
              <div className="w-[170px]">
                <Select
                  value={filters.sectionId}
                  placeholder={t('students.allSections')}
                  options={sectionsOf(filters.classId).map((s) => ({ value: String(s.id), label: s.name }))}
                  onChange={(e) => setFilters((f) => ({ ...f, sectionId: e.target.value }))}
                />
              </div>
              <div className="w-[160px]">
                <Select
                  value={filters.status}
                  placeholder={t('students.allStatuses')}
                  options={[
                    { value: 'active', label: t('common.active') },
                    { value: 'left', label: t('students.statusLeft') },
                    { value: 'passed_out', label: t('students.statusPassedOut') },
                  ]}
                  onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                />
              </div>
            </>
          }
        />
      </Panel>

      {/* Read-only student details */}
      <Modal
        open={detailLoading || !!detailTarget}
        onClose={() => setDetailTarget(null)}
        title={detailTarget ? detailTarget.name : t('students.viewDetails')}
        subtitle={
          detailTarget
            ? `${detailTarget.admissionNo || ''}${detailTarget.className ? ` · ${detailTarget.className}${detailTarget.sectionName ? ` - ${detailTarget.sectionName}` : ''}` : ''}`
            : undefined
        }
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setDetailTarget(null)}>
            {t('common.close')}
          </Button>
        }
      >
        {detailLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner size={24} className="text-[var(--color-muted)]" />
          </div>
        )}
        {detailTarget && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_9%,transparent)] p-3.5">
              <div>
                <p className="eyebrow">{t('students.currentClass')}</p>
                <p className="mt-0.5 text-[15px] font-semibold text-[var(--color-ink)]">
                  {detailTarget.className || '-'}
                  {detailTarget.sectionName ? ` - ${detailTarget.sectionName}` : ''}
                </p>
              </div>
              <StatusBadge status={detailTarget.status} />
            </div>

            <div>
              <p className="eyebrow mb-3">{t('students.sectionPersonal')}</p>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <DetailItem label={t('common.name')} value={detailTarget.name} />
                <DetailItem label={t('students.fatherName')} value={detailTarget.fatherName} />
                <DetailItem label={t('students.gender')} value={detailTarget.gender ? t(`students.${detailTarget.gender}`) : null} />
                <DetailItem label={t('students.dob')} value={detailTarget.dob ? formatDate(detailTarget.dob, lang) : null} />
                <DetailItem label={t('students.bForm')} value={detailTarget.bForm} />
                <DetailItem label={t('students.phone')} value={<span className="no-urdu">{detailTarget.phone}</span>} />
                <DetailItem label={t('students.email')} value={<span className="no-urdu">{detailTarget.email}</span>} />
                <DetailItem label={t('students.address')} value={detailTarget.address} />
              </div>
            </div>

            <div>
              <p className="eyebrow mb-3">{t('students.sectionAcademic')}</p>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <DetailItem label={t('students.admissionNo')} value={<span className="no-urdu">{detailTarget.admissionNo}</span>} />
                <DetailItem label={t('students.grNo')} value={<span className="no-urdu">{detailTarget.grNo}</span>} />
                <DetailItem label={t('students.rollNo')} value={<span className="no-urdu">{detailTarget.rollNo}</span>} />
                <DetailItem
                  label={t('students.admissionDate')}
                  value={detailTarget.admissionDate ? <span className="no-urdu">{formatDate(detailTarget.admissionDate, lang)}</span> : null}
                />
                <DetailItem label={t('students.previousSchool')} value={detailTarget.previousSchool} />
              </div>
            </div>

            <div>
              <p className="eyebrow mb-3">{t('students.sectionGuardian')}</p>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <DetailItem label={t('students.guardianName')} value={detailTarget.guardianName} />
                <DetailItem label={t('students.guardianPhone')} value={<span className="no-urdu">{detailTarget.guardianPhone}</span>} />
                {detailTarget.guardians?.[0]?.cnic && <DetailItem label="CNIC" value={<span className="no-urdu">{detailTarget.guardians[0].cnic}</span>} />}
              </div>
            </div>

            <div>
              <p className="eyebrow mb-3 flex items-center gap-1.5">
                <History size={13} /> {t('students.classHistory')}
              </p>
              {detailTarget.classHistory?.length ? (
                <ol className="flex flex-col gap-2">
                  {detailTarget.classHistory.map((h, index) => (
                    <li
                      key={h.id}
                      className="flex items-start gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] p-3"
                    >
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]">
                        <History size={12} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-[var(--color-ink)]">
                          {h.className || '-'}
                          {h.sectionName ? ` - ${h.sectionName}` : ''}
                        </p>
                        <p className="text-[11px] text-[var(--color-dim)]">
                          {h.changedAt ? formatDate(h.changedAt, lang) : '-'}
                          {' · '}
                          {h.note === 'Admission'
                            ? t('students.noteAdmission')
                            : h.note === 'Promoted'
                              ? t('students.notePromoted')
                              : h.note === 'Class updated'
                                ? t('students.noteClassUpdated')
                                : h.note || '-'}
                        </p>
                      </div>
                      {index === 0 && (
                        <span className="chip ms-auto shrink-0">{t('students.currentClass')}</span>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[12px] text-[var(--color-dim)]">{t('students.noHistory')}</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Add / edit */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? t('common.editItem', { item: t('nav.admin.students') }) : t('common.newItem', { item: t('nav.admin.students') })}
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
            {/* photo + basics */}
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
                  label={t('students.fatherName')}
                  value={form.fatherName}
                  error={formErrors.fatherName}
                  onChange={(e) => setForm({ ...form, fatherName: e.target.value })}
                />
              </div>
            </div>

            <div>
              <p className="eyebrow mb-3">{t('students.sectionAcademic')}</p>
              <FormGrid columns={3}>
                <Select
                  label={t('students.class')}
                  value={form.classId}
                  options={classOptions}
                  error={formErrors.classId}
                  onChange={(e) => setForm({ ...form, classId: e.target.value, sectionId: '' })}
                  required
                />
                <Select
                  label={t('students.section')}
                  value={form.sectionId}
                  options={sectionOptions}
                  error={formErrors.sectionId}
                  onChange={(e) => setForm({ ...form, sectionId: e.target.value })}
                />
                <Input
                  label={t('students.rollNo')}
                  value={form.rollNo}
                  error={formErrors.rollNo}
                  onChange={(e) => setForm({ ...form, rollNo: e.target.value })}
                />
                <Input
                  label={t('students.admissionNo')}
                  value={form.admissionNo}
                  error={formErrors.admissionNo}
                  hint={t('students.admissionNoHint')}
                  onChange={(e) => setForm({ ...form, admissionNo: e.target.value })}
                />
                <Input
                  label={t('students.grNo')}
                  value={form.grNo}
                  onChange={(e) => setForm({ ...form, grNo: e.target.value })}
                />
                <Input
                  label={t('students.admissionDate')}
                  type="date"
                  value={form.admissionDate}
                  onChange={(e) => setForm({ ...form, admissionDate: e.target.value })}
                />
              </FormGrid>
            </div>

            <div>
              <p className="eyebrow mb-3">{t('students.sectionPersonal')}</p>
              <FormGrid columns={3}>
                <Select
                  label={t('students.gender')}
                  value={form.gender}
                  placeholder={t('common.optional')}
                  options={[
                    { value: 'male', label: t('students.male') },
                    { value: 'female', label: t('students.female') },
                    { value: 'other', label: t('students.other') },
                  ]}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                />
                <Input
                  label={t('students.dob')}
                  type="date"
                  value={form.dob}
                  error={formErrors.dob}
                  onChange={(e) => setForm({ ...form, dob: e.target.value })}
                />
                <Input
                  label={t('students.bForm')}
                  value={form.bForm}
                  onChange={(e) => setForm({ ...form, bForm: e.target.value })}
                />
                <Input
                  label={t('students.phone')}
                  value={form.phone}
                  error={formErrors.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
                <Input
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                <Select
                  label={t('common.status')}
                  value={form.status}
                  options={[
                    { value: 'active', label: t('common.active') },
                    { value: 'left', label: t('students.statusLeft') },
                    { value: 'passed_out', label: t('students.statusPassedOut') },
                  ]}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                />
              </FormGrid>
              <div className="mt-4 grid gap-4">
                <Input
                  label={t('students.previousSchool')}
                  value={form.previousSchool}
                  onChange={(e) => setForm({ ...form, previousSchool: e.target.value })}
                />
                <Textarea
                  label={t('students.address')}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
            </div>

            <div>
              <p className="eyebrow mb-3">{t('students.sectionGuardian')}</p>
              <FormGrid columns={2}>
                <Input
                  label={t('students.guardianName')}
                  value={form.guardianName}
                  onChange={(e) => setForm({ ...form, guardianName: e.target.value })}
                />
                <Select
                  label={t('students.guardianRelation')}
                  value={form.guardianRelation}
                  options={['father', 'mother', 'grandfather', 'grandmother', 'uncle', 'aunt', 'brother', 'sister', 'other'].map(
                    (value) => ({ value, label: t(`relation.${value}`) }),
                  )}
                  onChange={(e) => setForm({ ...form, guardianRelation: e.target.value })}
                />
                <Input
                  label={t('students.guardianPhone')}
                  value={form.guardianPhone}
                  onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })}
                />
                <Input
                  label="CNIC"
                  value={form.guardianCnic}
                  onChange={(e) => setForm({ ...form, guardianCnic: e.target.value })}
                />
              </FormGrid>
            </div>

            {!form.id && (
              <label className="flex items-center gap-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] px-3.5 py-3">
                <input
                  type="checkbox"
                  checked={form.createLogin}
                  onChange={(e) => setForm({ ...form, createLogin: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span className="text-[12.5px] text-[var(--color-ink2)]">{t('students.createLoginHint')}</span>
              </label>
            )}
          </form>
        )}
      </Modal>

      {/* Import */}
      <Modal
        open={!!importData}
        onClose={() => setImportData(null)}
        title={t('students.importTitle')}
        subtitle={importData ? t('students.importSubtitle', { count: importData.total }) : ''}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportData(null)}>
              {t('common.close')}
            </Button>
            {!importData?.committed && (
              <Button variant="primary" loading={importBusy} onClick={commitImport}>
                {t('students.importNow')}
              </Button>
            )}
          </>
        }
      >
        {importData && (
          <div className="flex flex-col gap-4">
            {importData.result && (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-ok)_10%,transparent)] p-3 text-[12.5px]">
                {t('students.importResult', { imported: importData.result.imported, failed: importData.result.failed })}
              </div>
            )}
            {importData.errors?.length > 0 && (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] p-3">
                <p className="mb-1.5 text-[12.5px] font-medium text-[var(--color-ink)]">{t('students.importErrors')}</p>
                <ul className="flex flex-col gap-1 text-[11.5px] text-[var(--color-muted)]">
                  {importData.errors.slice(0, 8).map((e, i) => (
                    <li key={i}>
                      {t('students.row')} {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="max-h-[320px] overflow-auto rounded-xl border border-[var(--color-line)]">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('common.name')}</th>
                    <th>{t('students.fatherName')}</th>
                    <th>{t('students.class')}</th>
                    <th>{t('students.section')}</th>
                    <th>{t('students.phone')}</th>
                  </tr>
                </thead>
                <tbody>
                  {importData.rows.slice(0, 100).map((row, index) => (
                    <tr key={index}>
                      <td className="no-urdu text-[var(--color-dim)]">{index + 2}</td>
                      <td>{row.name || '-'}</td>
                      <td>{row.father_name || '-'}</td>
                      <td>{row.class_name || '-'}</td>
                      <td>{row.section_name || '-'}</td>
                      <td className="no-urdu">{row.phone || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* Promote */}
      <Modal
        open={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        title={t('students.promote')}
        subtitle={t('students.promoteHint', { count: selected.length })}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPromoteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} disabled={!promoteTo.classId} onClick={runPromote}>
              {t('students.promote')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            label={t('students.moveToClass')}
            value={promoteTo.classId}
            placeholder={t('students.selectClass')}
            options={classOptions}
            onChange={(e) => setPromoteTo((p) => ({ ...p, classId: e.target.value, sectionId: '' }))}
          />
          <Select
            label={t('students.moveToSection')}
            value={promoteTo.sectionId}
            placeholder={t('students.selectSection')}
            options={sectionsOf(promoteTo.classId).map((s) => ({ value: String(s.id), label: s.name }))}
            onChange={(e) => setPromoteTo((p) => ({ ...p, sectionId: e.target.value }))}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={busy}
        title={t('common.deleteConfirmTitle', { item: t('nav.admin.students') })}
        message={t('students.deleteWarning')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

export default StudentsPage;