import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, School, Layers, BookOpen, CalendarRange, Check, UserCheck } from 'lucide-react';
import clsx from 'clsx';
import api, { errorKey } from '../../lib/api';
import { useStructure } from '../../hooks/useStructure';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Input, Select, FormGrid } from '../../components/ui/Form';
import { useToast } from '../../components/ui/Toast';

const TABS = [
  { key: 'classes', labelKey: 'classes.classes', icon: School },
  { key: 'sections', labelKey: 'classes.sections', icon: Layers },
  { key: 'subjects', labelKey: 'classes.subjects', icon: BookOpen },
  { key: 'classSubjects', labelKey: 'classes.classSubjects', icon: Layers },
  { key: 'assignments', labelKey: 'classes.assignments', icon: UserCheck },
  { key: 'sessions', labelKey: 'classes.sessions', icon: CalendarRange },
];

export function ClassesPage({ initialTab = 'classes' }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { structure, loading, reload } = useStructure();

  const [tab, setTab] = useState(
    TABS.some((item) => item.key === initialTab) ? initialTab : 'classes',
  );
  const [modal, setModal] = useState(null); // { type, row }
  const [form, setForm] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [assignments, setAssignments] = useState([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);

  useEffect(() => {
    if (structure) setForm({});
  }, [structure]);

  // Teacher assignments live in their own table, so they are fetched on demand.
  const loadAssignments = useCallback(async () => {
    setAssignmentsLoading(true);
    try {
      const rows = await api.teacherAssignments.list({});
      setAssignments(rows || []);
    } catch {
      setAssignments([]);
    } finally {
      setAssignmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'assignments') return undefined;
    loadAssignments();
  }, [tab, loadAssignments]);

  const closeModal = () => {
    setModal(null);
    setForm({});
    setFormErrors({});
  };

  const openCreate = (type) => {
    setFormErrors({});
    if (type === 'sessions') setForm({ name: '', startDate: '', endDate: '' });
    else if (type === 'classSubjects') setForm({ classId: '', subjectId: '', maxMarks: 100, passMarks: 40, weeklyPeriods: 3 });
    else if (type === 'sections') setForm({ classId: '', name: '', capacity: 30, roomNo: '', classTeacherId: '' });
    else if (type === 'assignments') setForm({ teacherId: '', classId: '', sectionId: '', subjectId: '' });
    else setForm({ name: '', code: '', levelOrder: 0 });
    setModal({ type, row: null });
  };

  const openEdit = (type, row) => {
    setFormErrors({});
    setForm({ ...row });
    setModal({ type, row });
  };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setFormErrors({});
    try {
      const type = modal.type;
      if (type === 'classes') {
        if (modal.row) await api.classes.update(modal.row.id, form);
        else await api.classes.create(form);
      } else if (type === 'sections') {
        const payload = { ...form, classId: Number(form.classId), capacity: Number(form.capacity) || 30 };
        if (form.classTeacherId) payload.classTeacherId = Number(form.classTeacherId);
        else delete payload.classTeacherId;
        if (modal.row) await api.sections.update(modal.row.id, payload);
        else await api.sections.create(payload);
      } else if (type === 'subjects') {
        if (modal.row) await api.subjects.update(modal.row.id, form);
        else await api.subjects.create(form);
      } else if (type === 'classSubjects') {
        await api.classSubjects.save({
          classId: Number(form.classId),
          subjectId: Number(form.subjectId),
          maxMarks: Number(form.maxMarks) || 100,
          passMarks: Number(form.passMarks) || 0,
          weeklyPeriods: Number(form.weeklyPeriods) || 0,
        });
      } else if (type === 'assignments') {
        await api.teacherAssignments.save({
          teacherId: Number(form.teacherId),
          classId: Number(form.classId),
          sectionId: Number(form.sectionId),
          subjectId: Number(form.subjectId),
        });
      } else if (type === 'sessions') {
        await api.sessions.create(form);
      }
      toast.success(t('common.saved'));
      closeModal();
      if (modal.type === 'assignments') loadAssignments();
      reload();
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

  const confirmDelete = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      const { type, row } = deleteTarget;
      if (type === 'classes') await api.classes.remove(row.id);
      if (type === 'sections') await api.sections.remove(row.id);
      if (type === 'subjects') await api.subjects.remove(row.id);
      if (type === 'classSubjects') await api.classSubjects.remove(row.id);
      if (type === 'assignments') await api.teacherAssignments.remove(row.id);
      toast.success(t('common.deleted', { item: t(`classes.${type}`) }));
      setDeleteTarget(null);
      if (type === 'assignments') loadAssignments();
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const activateSession = async (row) => {
    try {
      await api.sessions.activate(row.id);
      toast.success(t('classes.sessionActivated'));
      reload();
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const classOptions = useMemo(
    () => (structure?.classes || []).map((c) => ({ value: String(c.id), label: c.name })),
    [structure],
  );
  const teacherOptions = useMemo(
    () => (structure?.teachers || []).map((f) => ({ value: String(f.id), label: f.name })),
    [structure],
  );

  // The section list follows the class picked in the assignment form.
  const sectionOptions = useMemo(() => {
    const classId = Number(form.classId);
    return (structure?.sections || [])
      .filter((s) => !classId || s.class_id === classId)
      .map((s) => ({ value: String(s.id), label: s.name }));
  }, [structure, form.classId]);

  // Only subjects the class actually teaches can be assigned to a teacher.
  const assignableSubjectOptions = useMemo(() => {
    const classId = Number(form.classId);
    const names = new Map((structure?.subjects || []).map((s) => [s.id, s.name]));
    return (structure?.classSubjects || [])
      .filter((cs) => classId && cs.class_id === classId)
      .map((cs) => ({ value: String(cs.subject_id), label: names.get(cs.subject_id) || cs.subject_name }));
  }, [structure, form.classId]);

  const columnsByTab = {
    classes: [
      { key: 'name', header: t('common.name'), sortable: true },
      { key: 'code', header: t('classes.code'), render: (r) => r.code || '-' },
      { key: 'section_count', header: t('classes.sections'), align: 'center' },
      { key: 'student_count', header: t('students.title'), align: 'center' },
      { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.is_active ? 'active' : 'inactive'} /> },
    ],
    sections: [
      { key: 'class_name', header: t('students.class'), sortable: true },
      { key: 'name', header: t('students.section') },
      { key: 'capacity', header: t('classes.capacity'), align: 'center' },
      { key: 'student_count', header: t('classes.enrolled'), align: 'center' },
      { key: 'room_no', header: t('classes.room'), render: (r) => r.room_no || '-' },
      { key: 'class_teacher_name', header: t('classes.classTeacher'), render: (r) => r.class_teacher_name || '-' },
    ],
    subjects: [
      { key: 'name', header: t('common.name'), sortable: true },
      { key: 'code', header: t('classes.code'), render: (r) => r.code || '-' },
      { key: 'class_count', header: t('classes.usedInClasses'), align: 'center' },
    ],
    classSubjects: [
      { key: 'class_name', header: t('students.class'), sortable: true },
      { key: 'subject_name', header: t('classes.subjects') },
      { key: 'max_marks', header: t('classes.maxMarks'), align: 'center' },
      { key: 'pass_marks', header: t('classes.passMarks'), align: 'center' },
      { key: 'weekly_periods', header: t('classes.weeklyPeriods'), align: 'center' },
    ],
    assignments: [
      { key: 'teacher_name', header: t('classes.teacher'), sortable: true },
      { key: 'class_name', header: t('students.class'), sortable: true },
      { key: 'section_name', header: t('students.section') },
      { key: 'subject_name', header: t('classes.subject') },
    ],
    sessions: [
      { key: 'name', header: t('classes.session'), sortable: true },
      { key: 'start_date', header: t('classes.startDate'), className: 'no-urdu' },
      { key: 'end_date', header: t('classes.endDate'), className: 'no-urdu' },
      {
        key: 'is_active',
        header: t('common.status'),
        render: (r) =>
          r.is_active ? <Badge tone="ok" dot>{t('classes.active')}</Badge> : <Badge>{t('classes.inactive')}</Badge>,
      },
    ],
  };

  const rowsByTab = {
    classes: structure?.classes || [],
    sections: structure?.sections || [],
    subjects: structure?.subjects || [],
    classSubjects: structure?.classSubjects || [],
    assignments,
    sessions: structure?.sessions || [],
  };

  const actions = (row) => {
    if (tab === 'sessions') {
      return (
        <div className="flex justify-end">
          {!row.is_active && (
            <Button size="sm" icon={Check} onClick={() => activateSession(row)}>
              {t('classes.makeActive')}
            </Button>
          )}
        </div>
      );
    }
    return (
      <div className="flex items-center justify-end gap-1">
        {tab !== 'assignments' && (
          <IconButton icon={Pencil} label={t('common.edit')} onClick={() => openEdit(tab, row)} />
        )}
        <IconButton icon={Trash2} label={t('common.delete')} onClick={() => setDeleteTarget({ type: tab, row })} />
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title={t('classes.title')}
        subtitle={t('classes.subtitle')}
        actions={
          <Button icon={Plus} variant="primary" onClick={() => openCreate(tab)}>
            {t('classes.add', { item: t(`classes.${tab}`) })}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={clsx('btn btn-sm', tab === item.key && 'btn-primary')}
          >
            <item.icon size={14} />
            {t(item.labelKey)}
            <span className="no-urdu ms-1 opacity-70">{rowsByTab[item.key].length}</span>
          </button>
        ))}
      </div>

      <Panel padded={false}>
        <DataTable
          columns={[
            ...columnsByTab[tab],
            { key: 'actions', header: t('common.actions'), align: 'end', render: actions },
          ]}
          rows={rowsByTab[tab]}
          loading={tab === 'assignments' ? assignmentsLoading : loading}
          emptyTitle={t('common.noData')}
          emptyHint={t('common.noDataHint')}
        />
      </Panel>

      <Modal
        open={!!modal}
        onClose={closeModal}
        title={
          modal?.row
            ? t('common.editItem', { item: t(`classes.${modal.type}`) })
            : t('classes.add', { item: t(`classes.${modal?.type || ''}`) })
        }
        size={modal?.type === 'classSubjects' || modal?.type === 'assignments' ? 'md' : 'sm'}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={submit}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {modal?.type === 'classes' && (
          <FormGrid columns={1}>
            <Input
              label={t('common.name')}
              value={form.name || ''}
              error={formErrors.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <FormGrid columns={2}>
              <Input
                label={t('classes.code')}
                value={form.code || ''}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
              <Input
                label={t('classes.levelOrder')}
                type="number"
                value={form.levelOrder ?? 0}
                hint={t('classes.levelOrderHint')}
                onChange={(e) => setForm({ ...form, levelOrder: e.target.value })}
              />
            </FormGrid>
          </FormGrid>
        )}

        {modal?.type === 'sections' && (
          <FormGrid columns={1}>
            <Select
              label={t('students.class')}
              value={form.classId || ''}
              options={classOptions}
              placeholder={t('students.selectClass')}
              error={formErrors.classId}
              onChange={(e) => setForm({ ...form, classId: e.target.value })}
              required
            />
            <FormGrid columns={2}>
              <Input
                label={t('students.section')}
                value={form.name || ''}
                error={formErrors.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <Input
                label={t('classes.capacity')}
                type="number"
                value={form.capacity ?? 30}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <Input
                label={t('classes.room')}
                value={form.room_no || form.roomNo || ''}
                onChange={(e) => setForm({ ...form, room_no: e.target.value })}
              />
              <Select
                label={t('classes.classTeacher')}
                value={form.class_teacher_id || form.classTeacherId || ''}
                options={teacherOptions}
                placeholder={t('common.optional')}
                onChange={(e) => setForm({ ...form, class_teacher_id: e.target.value })}
              />
            </FormGrid>
          </FormGrid>
        )}

        {modal?.type === 'subjects' && (
          <FormGrid columns={2}>
            <Input
              label={t('common.name')}
              value={form.name || ''}
              error={formErrors.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Input
              label={t('classes.code')}
              value={form.code || ''}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </FormGrid>
        )}

        {modal?.type === 'classSubjects' && (
          <FormGrid columns={2}>
            <Select
              label={t('students.class')}
              value={form.classId || ''}
              options={classOptions}
              placeholder={t('students.selectClass')}
              onChange={(e) => setForm({ ...form, classId: e.target.value })}
            />
            <Select
              label={t('classes.subjects')}
              value={form.subjectId || ''}
              options={(structure?.subjects || []).map((s) => ({ value: String(s.id), label: s.name }))}
              placeholder={t('classes.selectSubject')}
              onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
            />
            <Input
              label={t('classes.maxMarks')}
              type="number"
              value={form.maxMarks ?? 100}
              onChange={(e) => setForm({ ...form, maxMarks: e.target.value })}
            />
            <Input
              label={t('classes.passMarks')}
              type="number"
              value={form.passMarks ?? 40}
              onChange={(e) => setForm({ ...form, passMarks: e.target.value })}
            />
            <Input
              label={t('classes.weeklyPeriods')}
              type="number"
              value={form.weeklyPeriods ?? 3}
              onChange={(e) => setForm({ ...form, weeklyPeriods: e.target.value })}
            />
          </FormGrid>
        )}

        {modal?.type === 'assignments' && (
          <FormGrid columns={2}>
            <Select
              label={t('classes.teacher')}
              value={form.teacherId || ''}
              options={teacherOptions}
              placeholder={t('classes.selectTeacher')}
              error={formErrors.teacherId}
              onChange={(e) => setForm({ ...form, teacherId: e.target.value })}
              required
            />
            <Select
              label={t('students.class')}
              value={form.classId || ''}
              options={classOptions}
              placeholder={t('students.selectClass')}
              error={formErrors.classId}
              onChange={(e) => setForm({ ...form, classId: e.target.value, sectionId: '', subjectId: '' })}
              required
            />
            <Select
              label={t('students.section')}
              value={form.sectionId || ''}
              options={sectionOptions}
              placeholder={t('students.selectSection')}
              error={formErrors.sectionId}
              onChange={(e) => setForm({ ...form, sectionId: e.target.value })}
              required
            />
            <Select
              label={t('classes.subject')}
              value={form.subjectId || ''}
              options={assignableSubjectOptions}
              placeholder={t('classes.selectSubject')}
              error={formErrors.subjectId}
              onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
              required
            />
          </FormGrid>
        )}

        {modal?.type === 'sessions' && (
          <FormGrid columns={1}>
            <Input
              label={t('classes.session')}
              value={form.name || ''}
              placeholder="2026-2027"
              error={formErrors.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <FormGrid columns={2}>
              <Input
                label={t('classes.startDate')}
                type="date"
                value={form.startDate || ''}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
              <Input
                label={t('classes.endDate')}
                type="date"
                value={form.endDate || ''}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </FormGrid>
          </FormGrid>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={busy}
        title={t('common.deleteConfirmTitle', { item: t(`classes.${deleteTarget?.type || ''}`) })}
        message={t('common.deleteConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

export default ClassesPage;