import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Plus, Save, Trash2, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { useStructure } from '../../hooks/useStructure';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { Input, Select, FormGrid } from '../../components/ui/Form';
import { Badge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { DataTable } from '../../components/ui/DataTable';
import { useToast } from '../../components/ui/Toast';
import { TimetableGrid, TimetableSummary } from '../../components/timetable/TimetableGrid';

/**
 * Phase 7 admin workspace: build the weekly grid.
 *
 * Every cell is edited through one small modal. Saving replaces the whole
 * section grid in a single transaction, so a half-built timetable is never
 * left behind - and teacher clashes come back with the response as warnings.
 */
export function TimetablePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { structure } = useStructure();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [view, setView] = useState('class');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cell, setCell] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [periodsOpen, setPeriodsOpen] = useState(false);

  const sections = (structure?.sections || []).filter((section) => !classId || section.class_id === Number(classId));

  const load = useCallback(async () => {
    if (view === 'teacher') {
      if (!teacherId) {
        setData(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        setData(await api.timetable.teacher({ staffId: Number(teacherId) }));
      } catch (err) {
        toast.error(t(errorKey(err)));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!classId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await api.timetable.get({ classId: Number(classId), sectionId: sectionId || undefined });
      setData(result);
      setSectionId(String(result.sectionId));
      setConflicts(result.conflicts || []);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [view, classId, sectionId, teacherId, t, toast]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, classId, sectionId, teacherId]);

  useEffect(() => {
    if (!classId && structure?.classes?.length) setClassId(String(structure.classes[0].id));
    if (!teacherId && structure?.teachers?.length) setTeacherId(String(structure.teachers[0].id));
  }, [structure, classId, teacherId]);

  const saveGrid = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const entries = data.slots.map((slot) => ({
        dayOfWeek: slot.dayOfWeek,
        periodId: slot.periodId,
        subjectId: slot.subjectId || undefined,
        teacherId: slot.teacherId || undefined,
      }));
      const result = await api.timetable.save({
        classId: Number(data.classId),
        sectionId: Number(data.sectionId),
        entries,
      });
      setData(result);
      setConflicts(result.conflicts || []);
      toast.success(t('timetable.saved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const isClassView = view === 'class';
  // Only an admin may change the grid; office and teacher read it.
  const canEdit = isAdmin;

  return (
    <>
      <PageHeader
        title={t('timetable.title')}
        subtitle={t('timetable.subtitle')}
        actions={
          <>
            {canEdit && (
              <Button icon={Clock} onClick={() => setPeriodsOpen(true)}>
                {t('timetable.editPeriods')}
              </Button>
            )}
            {canEdit && isClassView && (
              <Button icon={Save} variant="primary" loading={busy} disabled={!data} onClick={saveGrid}>
                {t('common.save')}
              </Button>
            )}
          </>
        }
      />

      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1.5 pb-1">
            <button
              type="button"
              onClick={() => setView('class')}
              className={clsx('btn btn-sm', isClassView && 'btn-primary')}
            >
              {t('timetable.classView')}
            </button>
            <button
              type="button"
              onClick={() => setView('teacher')}
              className={clsx('btn btn-sm', !isClassView && 'btn-primary')}
            >
              {t('timetable.teacherView')}
            </button>
          </div>

          {isClassView ? (
            <>
              <div className="w-[190px]">
                <Select
                  label={t('exams.class')}
                  value={classId}
                  placeholder={t('exams.class')}
                  options={(structure?.classes || []).map((c) => ({ value: c.id, label: c.name }))}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setSectionId('');
                  }}
                />
              </div>
              <div className="w-[190px]">
                <Select
                  label={t('timetable.section')}
                  value={sectionId}
                  placeholder={t('timetable.section')}
                  options={sections.map((s) => ({ value: s.id, label: s.name }))}
                  onChange={(e) => setSectionId(e.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="w-[240px]">
              <Select
                label={t('timetable.teacher')}
                value={teacherId}
                placeholder={t('classes.selectTeacher')}
                options={(structure?.teachers || []).map((f) => ({ value: f.id, label: f.name }))}
                onChange={(e) => setTeacherId(e.target.value)}
              />
            </div>
          )}

          <div className="ms-auto pb-1">
            <TimetableSummary data={data} />
          </div>
        </div>
      </Panel>

      {canEdit && isClassView && conflicts.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--color-warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)] p-4">
          <TriangleAlert size={17} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-[var(--color-ink)]">{t('timetable.clashTitle')}</p>
            <p className="mt-1 text-[12px] text-[var(--color-muted)]">{t('timetable.clashBody')}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {conflicts.map((row, index) => (
                <li key={`${row.dayOfWeek}-${row.periodId}-${row.teacherId}-${index}`}>
                  <Badge tone="warn" className="no-urdu">
                    {row.teacherName} · {row.sectionNames}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-[var(--color-dim)]">{t('timetable.clashHint')}</p>
          </div>
        </div>
      )}

      <Panel padded={false}>
        <TimetableGrid
          data={data}
          loading={loading}
          mode={canEdit && isClassView ? 'edit' : 'view'}
          onCellClick={
            canEdit && isClassView
              ? (dayOfWeek, periodId, slot) =>
                  setCell({
                    dayOfWeek,
                    periodId,
                    sectionId: data?.sectionId,
                    subjectId: slot?.subjectId || '',
                    teacherId: slot?.teacherId || '',
                  })
              : undefined
          }
        />
      </Panel>

      {canEdit && isClassView && (
        <CellModal
          cell={cell}
          data={data}
          subjects={data?.subjects || []}
          teachers={data?.teachers || []}
          onClose={() => setCell(null)}
          onSaved={() => {
            setCell(null);
            load();
          }}
        />
      )}

      {canEdit && <PeriodsModal open={periodsOpen} onClose={() => setPeriodsOpen(false)} onSaved={load} />}
    </>
  );
}

/* --------------------------------------------------------------- cell editor */

/**
 * Editing one cell.
 *
 * The save replaces the whole section grid, so the current slot is merged back
 * in here - the cell modal never silently wipes the rest of the week.
 */
function CellModal({ cell, data, subjects, teachers, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [draft, setDraft] = useState({ subjectId: '', teacherId: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cell) return;
    setDraft({ subjectId: cell.subjectId || '', teacherId: cell.teacherId || '' });
  }, [cell]);

  /**
   * `override` lets "clear this slot" save an empty cell. The button cannot
   * just clear the form state and re-save, because `save` would still close
   * over the previous draft and write the lesson straight back.
   */
  const save = async (override) => {
    if (!cell || !data) return;
    const next = override || draft;
    setBusy(true);
    try {
      const others = data.slots.filter(
        (slot) => !(slot.dayOfWeek === cell.dayOfWeek && slot.periodId === cell.periodId),
      );
      const entries = [
        ...others.map((slot) => ({
          dayOfWeek: slot.dayOfWeek,
          periodId: slot.periodId,
          subjectId: slot.subjectId || undefined,
          teacherId: slot.teacherId || undefined,
        })),
        {
          dayOfWeek: cell.dayOfWeek,
          periodId: cell.periodId,
          subjectId: next.subjectId ? Number(next.subjectId) : undefined,
          teacherId: next.teacherId ? Number(next.teacherId) : undefined,
        },
      ];
      await api.timetable.save({ classId: Number(data.classId), sectionId: Number(data.sectionId), entries });
      toast.success(t('timetable.saved'));
      onSaved();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!cell}
      onClose={onClose}
      title={t('timetable.notAssigned')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {cell && (
        <FormGrid columns={1}>
          <Select
            label={t('exams.subject')}
            value={draft.subjectId}
            placeholder={t('timetable.notAssigned')}
            options={subjects.map((subject) => ({ value: subject.id, label: subject.name }))}
            onChange={(e) => setDraft({ ...draft, subjectId: e.target.value })}
          />
          <Select
            label={t('timetable.teacher')}
            value={draft.teacherId}
            placeholder={t('timetable.notAssigned')}
            options={teachers.map((teacher) => ({
              value: teacher.id,
              label: teacher.employee_code ? `${teacher.name} (${teacher.employee_code})` : teacher.name,
            }))}
            onChange={(e) => setDraft({ ...draft, teacherId: e.target.value })}
          />
          {cell.subjectId && (
            <Button
              variant="danger"
              icon={Trash2}
              loading={busy}
              onClick={() => save({ subjectId: '', teacherId: '' })}
            >
              {t('timetable.clearSlot')}
            </Button>
          )}
        </FormGrid>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------ periods manager */

function PeriodsModal({ open, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.timetable.periods({ includeInactive: true }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  }, [t, toast]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const payload = {
        id: form.id,
        name: form.name,
        startTime: form.startTime,
        endTime: form.endTime,
        sortOrder: Number(form.sortOrder) || 99,
        isBreak: !!form.isBreak,
      };
      setRows(await api.timetable.savePeriod(payload));
      toast.success(t('timetable.periodsSaved'));
      setForm(null);
      onSaved();
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
      setRows(await api.timetable.deletePeriod(deleteTarget.id));
      toast.success(t('common.deleted', { item: t('timetable.period') }));
      setDeleteTarget(null);
      onSaved();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('timetable.periods')}
        subtitle={t('timetable.noPeriodsHint')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button
              icon={Plus}
              variant="primary"
              onClick={() => setForm({ name: '', startTime: '', endTime: '', sortOrder: rows.length + 1, isBreak: false })}
            >
              {t('timetable.addPeriod')}
            </Button>
          </>
        }
      >
        <DataTable
          rows={rows}
          total={rows.length}
          emptyIcon={Clock}
          emptyTitle={t('timetable.noPeriods')}
          emptyHint={t('timetable.noPeriodsHint')}
          columns={[
            { key: 'sortOrder', header: t('timetable.order'), width: 70, className: 'no-urdu' },
            { key: 'name', header: t('common.name') },
            {
              key: 'time',
              header: t('timetable.startTime'),
              className: 'no-urdu',
              render: (row) => `${row.startTime} – ${row.endTime}`,
            },
            {
              key: 'isBreak',
              header: t('timetable.isBreak'),
              align: 'center',
              render: (row) => (row.isBreak ? <Badge tone="warn">{t('timetable.lunch')}</Badge> : ''),
            },
            {
              key: 'actions',
              header: t('common.actions'),
              align: 'end',
              render: (row) => (
                <div className="flex items-center justify-end gap-1">
                  <IconButton
                    icon={Clock}
                    label={t('common.edit')}
                    onClick={() => setForm({ ...row, isBreak: row.isBreak })}
                  />
                  <IconButton icon={Trash2} label={t('common.delete')} onClick={() => setDeleteTarget(row)} />
                </div>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? t('timetable.editPeriod') : t('timetable.addPeriod')}
        size="sm"
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
            <Input label={t('common.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <FormGrid columns={2}>
              <Input
                label={t('timetable.startTime')}
                type="time"
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                required
              />
              <Input
                label={t('timetable.endTime')}
                type="time"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                required
              />
            </FormGrid>
            <Input
              label={t('timetable.order')}
              type="number"
              min={1}
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            />
            <label className="flex items-center gap-2.5 text-[13px] text-[var(--color-ink2)]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--accent)]"
                checked={!!form.isBreak}
                onChange={(e) => setForm({ ...form, isBreak: e.target.checked })}
              />
              {t('timetable.isBreak')}
            </label>
          </FormGrid>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={busy}
        title={t('common.deleteConfirmTitle', { item: t('timetable.period') })}
        message={t('timetable.periodInUse')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

export default TimetablePage;