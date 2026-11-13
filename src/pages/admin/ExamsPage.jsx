import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileSpreadsheet,
  Layers,
  Lock,
  Pencil,
  PlayCircle,
  Plus,
  Printer,
  Send,
  Trash2,
} from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useStructure } from '../../hooks/useStructure';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, StatCard } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable, TableSearch } from '../../components/ui/DataTable';
import { Input, Select, FormGrid } from '../../components/ui/Form';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { MarksGrid, PaperTabs } from '../../components/exams/MarksGrid';
import { DonutChart } from '../../components/charts/Charts';
import { formatDate, formatNumber } from '../../utils/format';

const TABS = [
  { key: 'exams', labelKey: 'exams.exams', icon: ClipboardList },
  { key: 'marks', labelKey: 'exams.marks', icon: Pencil },
  { key: 'results', labelKey: 'exams.results', icon: BarChart3 },
];

/** The exam lifecycle, in the order an admin moves through it. */
const EXAM_STATUS_OPTIONS = [
  { value: 'draft', labelKey: 'exams.draft' },
  { value: 'marks_open', labelKey: 'exams.openForMarks' },
  { value: 'published', labelKey: 'exams.publish' },
  { value: 'locked', labelKey: 'exams.lock' },
];

/**
 * Phase 6 admin workspace: exam setup, papers, marks entry and results.
 *
 * The three tabs share the same exam list, so moving between "set the paper"
 * and "read the result" never loses the selection.
 */
export function ExamsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('exams');
  const [selectedExamId, setSelectedExamId] = useState(null);

  return (
    <>
      <PageHeader title={t('exams.title')} subtitle={t('exams.subtitle')} />

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
          </button>
        ))}
      </div>

      {tab === 'exams' && <ExamsTab selectedExamId={selectedExamId} onSelect={setSelectedExamId} />}
      {tab === 'marks' && <MarksTab examId={selectedExamId} onSelect={setSelectedExamId} />}
      {tab === 'results' && <ResultsTab examId={selectedExamId} onSelect={setSelectedExamId} />}
    </>
  );
}

/* ------------------------------------------------------------------- exams */

function ExamsTab({ selectedExamId, onSelect }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { structure } = useStructure();

  const [rows, setRows] = useState([]);
  const [types, setTypes] = useState([]);
  const [filters, setFilters] = useState({ classId: '', status: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [papersFor, setPapersFor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.exams.list({
        classId: filters.classId || undefined,
        status: filters.status || undefined,
        search: filters.search || undefined,
      });
      setRows(result.rows);
      setTypes(result.types);
      if (selectedExamId && !result.rows.some((row) => row.id === selectedExamId)) onSelect(null);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [filters.classId, filters.status, filters.search, selectedExamId, onSelect, t, toast]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.classId, filters.status]);

  // The search box is debounced; the first render is skipped so opening the
  // tab does not fire two identical requests.
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

  const blank = () => ({
    name: '',
    examTypeId: types[0]?.id || '',
    classId: filters.classId || structure?.classes?.[0]?.id || '',
    startDate: '',
    endDate: '',
  });

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        examTypeId: form.examTypeId || undefined,
        classId: Number(form.classId),
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      };
      const saved = form.id ? await api.exams.update(form.id, payload) : await api.exams.create(payload);
      toast.success(t('common.saved'));
      setForm(null);
      onSelect(saved.id);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (exam, status) => {
    setBusy(true);
    try {
      const saved = await api.exams.setStatus({ id: exam.id, status });
      toast.success(t('common.saved'));
      onSelect(saved.id);
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
      await api.exams.remove(deleteTarget.id);
      toast.success(t('common.deleted', { item: t('exams.exam') }));
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  /** The next action an exam can take, as a single primary button. */
  const nextAction = (exam) => {
    if (exam.status === 'draft') return { status: 'marks_open', icon: PlayCircle, key: 'exams.openForMarks' };
    if (exam.status === 'marks_open') return { status: 'published', icon: Send, key: 'exams.publish' };
    if (exam.status === 'published') return { status: 'locked', icon: Lock, key: 'exams.lock' };
    return null;
  };

  return (
    <>
      <Panel padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-line)] p-4">
          <div className="w-[170px]">
            <Select
              label={t('exams.class')}
              value={filters.classId}
              placeholder={t('common.filter')}
              options={(structure?.classes || []).map((c) => ({ value: c.id, label: c.name }))}
              onChange={(e) => setFilters({ ...filters, classId: e.target.value })}
            />
          </div>
          <div className="w-[160px]">
            <Select
              label={t('common.status')}
              value={filters.status}
              placeholder={t('common.filter')}
              options={EXAM_STATUS_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <TableSearch value={filters.search} onChange={(search) => setFilters({ ...filters, search })} placeholder={t('common.search')} />
          </div>
          <div className="flex items-center gap-2">
            <Button icon={Plus} variant="primary" onClick={() => setForm(blank())}>
              {t('exams.addExam')}
            </Button>
          </div>
        </div>

        <DataTable
          rows={rows}
          loading={loading}
          total={rows.length}
          rowClassName={(row) => (row.id === selectedExamId ? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]' : undefined)}
          emptyIcon={ClipboardList}
          emptyTitle={t('exams.noExams')}
          emptyHint={t('exams.noExamsHint')}
          columns={[
            { key: 'name', header: t('exams.exam'), sortable: false },
            { key: 'className', header: t('exams.class') },
            {
              key: 'startDate',
              header: t('exams.startDate'),
              render: (r) => (
                <span className="no-urdu">
                  {r.startDate ? formatDate(r.startDate) : '-'}
                  {r.endDate ? ` → ${formatDate(r.endDate)}` : ''}
                </span>
              ),
            },
            {
              key: 'subjectCount',
              header: t('exams.papers'),
              align: 'center',
              render: (r) => (
                <Badge tone={r.subjectCount ? 'accent' : 'warn'}>{r.subjectCount || 0}</Badge>
              ),
            },
            {
              key: 'enteredCount',
              header: t('exams.entered'),
              align: 'center',
              className: 'no-urdu',
              render: (r) => `${r.enteredCount || 0} / ${r.studentCount || 0}`,
            },
            {
              key: 'resultCount',
              header: t('exams.results'),
              align: 'center',
              className: 'no-urdu',
              render: (r) =>
                r.resultCount ? (
                  <span>
                    {r.resultCount} <span className="text-[11px] text-[var(--color-dim)]">({r.passPercentage}%)</span>
                  </span>
                ) : (
                  '-'
                ),
            },
            {
              key: 'status',
              header: t('common.status'),
              render: (r) => <StatusBadge status={r.status} />,
            },
            {
              key: 'actions',
              header: t('common.actions'),
              align: 'end',
              render: (row) => {
                const action = nextAction(row);
                return (
                  <div className="flex items-center justify-end gap-1">
                    <IconButton
                      icon={FileSpreadsheet}
                      label={t('exams.editPapers')}
                      onClick={() => setPapersFor(row)}
                      disabled={row.status === 'locked'}
                    />
                    {action && (
                      <IconButton
                        icon={action.icon}
                        label={t(action.key)}
                        onClick={() => changeStatus(row, action.status)}
                        disabled={busy}
                      />
                    )}
                    <IconButton
                      icon={Pencil}
                      label={t('common.edit')}
                      onClick={() =>
                        setForm({
                          id: row.id,
                          name: row.name,
                          examTypeId: row.examTypeId || '',
                          classId: row.classId,
                          startDate: row.startDate || '',
                          endDate: row.endDate || '',
                        })
                      }
                      disabled={row.status === 'locked'}
                    />
                    <IconButton
                      icon={Trash2}
                      label={t('common.delete')}
                      onClick={() => setDeleteTarget(row)}
                      disabled={row.status === 'locked'}
                    />
                  </div>
                );
              },
            },
          ]}
        />
      </Panel>

      <p className="mt-2 text-[11.5px] text-[var(--color-dim)]">{t('exams.statusHint')}</p>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? t('exams.editExam') : t('exams.addExam')}
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
            <Input
              label={t('exams.exam')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Select
              label={t('exams.examType')}
              value={form.examTypeId}
              options={types.map((type) => ({ value: type.id, label: type.name }))}
              onChange={(e) => setForm({ ...form, examTypeId: e.target.value })}
            />
            <Select
              label={t('exams.class')}
              value={form.classId}
              options={(structure?.classes || []).map((c) => ({ value: c.id, label: c.name }))}
              onChange={(e) => setForm({ ...form, classId: e.target.value })}
              required
            />
            <FormGrid columns={2}>
              <Input
                label={t('exams.startDate')}
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
              <Input
                label={t('exams.endDate')}
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </FormGrid>
          </FormGrid>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={busy}
        title={t('common.deleteConfirmTitle', { item: t('exams.exam') })}
        message={t('common.deleteConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />

      <PapersModal exam={papersFor} onClose={() => setPapersFor(null)} onSaved={() => { setPapersFor(null); load(); }} />
    </>
  );
}

/* ------------------------------------------------------------------ papers */

/** Chooses which class subjects the exam covers and sets each paper's marks. */
function PapersModal({ exam, onClose, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { structure } = useStructure();

  const [rows, setRows] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!exam) {
      setRows({});
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api.exams
      .get(exam.id)
      .then((data) => {
        if (cancelled) return;
        const next = {};
        for (const subject of data.subjects) {
          next[subject.subjectId] = {
            totalMarks: subject.totalMarks,
            passMarks: subject.passMarks,
            examDate: subject.examDate || '',
          };
        }
        setRows(next);
      })
      .catch((err) => toast.error(t(errorKey(err))))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exam, t, toast]);

  // Only subjects this class actually teaches may appear on the paper.
  const classSubjects = useMemo(() => {
    if (!structure?.classSubjects || !exam?.classId) return [];
    return structure.classSubjects
      .filter((cs) => cs.class_id === Number(exam.classId))
      .map((cs) => ({
        id: cs.subject_id,
        name: cs.subject_name,
        maxMarks: cs.max_marks,
        passMarks: cs.pass_marks,
      }));
  }, [structure, exam]);

  const toggle = (subjectId) => {
    setRows((prev) => {
      if (prev[subjectId]) {
        const { [subjectId]: _removed, ...rest } = prev;
        return rest;
      }
      const taught = classSubjects.find((cs) => cs.id === subjectId);
      return {
        ...prev,
        [subjectId]: {
          totalMarks: taught?.maxMarks ?? 100,
          passMarks: taught?.passMarks ?? 40,
          examDate: '',
        },
      };
    });
  };

  const save = async () => {
    if (!exam) return;
    setBusy(true);
    try {
      const subjects = Object.entries(rows).map(([subjectId, value], index) => ({
        subjectId: Number(subjectId),
        totalMarks: Number(value.totalMarks) || 100,
        passMarks: Number(value.passMarks) || 40,
        examDate: value.examDate || undefined,
        sortOrder: index + 1,
      }));
      await api.exams.saveSubjects({ examId: exam.id, subjects });
      toast.success(t('exams.papersSaved'));
      onSaved();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!exam}
      onClose={onClose}
      title={exam ? `${t('exams.papers')} · ${exam.name}` : ''}
      subtitle={t('exams.reportCardHint')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={loading}>
            {t('exams.savePapers')}
          </Button>
        </>
      }
    >
      {loading ? (
        <Skeleton width="w-full" height="h-40" />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-[var(--color-muted)]">{t('exams.noPapersHint')}</p>
          {classSubjects.map((subject) => {
            const value = rows[subject.id];
            return (
              <div
                key={subject.id}
                className={clsx(
                  'flex flex-wrap items-center gap-3 rounded-xl border p-3 transition',
                  value ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_7%,transparent)]' : 'border-[var(--color-line)]',
                )}
              >
                <label className="flex min-w-[180px] flex-1 cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                    checked={!!value}
                    onChange={() => toggle(subject.id)}
                  />
                  <span className="text-[13px] font-medium text-[var(--color-ink)]">{subject.name}</span>
                </label>
                {value && (
                  <>
                    <div className="w-[104px]">
                      <Input
                        label={t('exams.totalMarks')}
                        type="number"
                        min={1}
                        value={value.totalMarks}
                        onChange={(e) => setRows({ ...rows, [subject.id]: { ...value, totalMarks: e.target.value } })}
                      />
                    </div>
                    <div className="w-[104px]">
                      <Input
                        label={t('exams.passMarks')}
                        type="number"
                        min={0}
                        value={value.passMarks}
                        onChange={(e) => setRows({ ...rows, [subject.id]: { ...value, passMarks: e.target.value } })}
                      />
                    </div>
                    <div className="w-[148px]">
                      <Input
                        label={t('exams.examDate')}
                        type="date"
                        value={value.examDate}
                        onChange={(e) => setRows({ ...rows, [subject.id]: { ...value, examDate: e.target.value } })}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------- marks */

function MarksTab({ examId, onSelect }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [exams, setExams] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState(null);

  useEffect(() => {
    api.exams
      .list()
      .then((data) => setExams(data.rows))
      .catch((err) => toast.error(t(errorKey(err))));
  }, [t, toast]);

  const loadSubjects = useCallback(
    async (id) => {
      if (!id) {
        setSubjects([]);
        return;
      }
      try {
        const sheet = await api.exams.markSheet({ examId: id });
        setSubjects(sheet.subjects);
        setSubjectId((prev) => (sheet.subjects.some((s) => s.id === prev) ? prev : sheet.subjects[0]?.id ?? null));
      } catch (err) {
        toast.error(t(errorKey(err)));
      }
    },
    [t, toast],
  );

  useEffect(() => {
    loadSubjects(examId);
  }, [examId, loadSubjects]);

  const editable = exams.filter((exam) => exam.status === 'marks_open' || exam.status === 'published');

  if (!exams.length) {
    return <EmptyState icon={Pencil} title={t('exams.noExams')} hint={t('exams.noExamsHint')} />;
  }

  if (!editable.length) {
    return <EmptyState icon={Lock} title={t('exams.noMarksExams')} hint={t('exams.noMarksExamsHint')} />;
  }

  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-[260px]">
          <Select
            label={t('exams.exam')}
            value={examId || ''}
            placeholder={t('exams.exam')}
            options={editable.map((exam) => ({ value: exam.id, label: `${exam.name} - ${exam.className}` }))}
            onChange={(e) => onSelect(Number(e.target.value))}
          />
        </div>
      </div>

      {examId ? (
        <>
          <PaperTabs subjects={subjects} activeId={subjectId} onSelect={setSubjectId} />
          <div className="mt-4">
            <MarksGrid examSubjectId={subjectId} canEdit={subjects.find((s) => s.id === subjectId)?.canEnter} />
          </div>
        </>
      ) : (
        <EmptyState icon={Pencil} title={t('exams.noMarksExams')} hint={t('exams.noMarksExamsHint')} className="py-10" />
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- results */

function ResultsTab({ examId, onSelect }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [exams, setExams] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cardTarget, setCardTarget] = useState(null);

  useEffect(() => {
    api.exams
      .list()
      .then((data) => setExams(data.rows))
      .catch((err) => toast.error(t(errorKey(err))));
  }, [t, toast]);

  const load = useCallback(async () => {
    if (!examId) {
      setSheet(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSheet(await api.exams.resultSheet({ examId }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [examId, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const compute = async () => {
    if (!examId) return;
    setBusy(true);
    try {
      const result = await api.exams.computeResults({ examId });
      toast.success(t('exams.computed', { count: result.computed }));
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const stats = sheet?.stats;

  return (
    <>
      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[260px]">
            <Select
              label={t('exams.exam')}
              value={examId || ''}
              placeholder={t('exams.exam')}
              options={exams.map((exam) => ({ value: exam.id, label: `${exam.name} - ${exam.className}` }))}
              onChange={(e) => onSelect(Number(e.target.value))}
            />
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button icon={BarChart3} disabled={!examId || loading} loading={busy} onClick={compute}>
              {t('exams.computeResults')}
            </Button>
            <Button
              icon={Printer}
              disabled={!examId || !sheet?.rows?.length}
              onClick={async () => {
                try {
                  await api.exams.resultSheetPdf({ examId });
                } catch (err) {
                  toast.error(t(errorKey(err)));
                }
              }}
            >
              {t('reports.downloadPdf')}
            </Button>
          </div>
        </div>
      </Panel>

      {!examId ? (
        <EmptyState icon={BarChart3} title={t('exams.noResults')} hint={t('exams.noResultsHint')} />
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t('exams.passPercentage')}
              menu={false}
              value={loading ? <Skeleton /> : `${stats?.passPercentage ?? 0}%`}
              hint={stats ? t('exams.studentCount', { count: stats.results }) : ''}
            />
            <StatCard label={t('exams.average')} menu={false} value={loading ? <Skeleton /> : `${stats?.averagePercentage ?? 0}%`} />
            <StatCard label={t('exams.highest')} menu={false} value={loading ? <Skeleton /> : `${stats?.highestPercentage ?? 0}%`} />
            <StatCard label={t('exams.lowest')} menu={false} value={loading ? <Skeleton /> : `${stats?.lowestPercentage ?? 0}%`} />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Panel>
              <h3 className="panel-title mb-3">{t('exams.gradeSpread')}</h3>
              <DonutChart
                data={(stats?.gradeDistribution || []).map((row) => ({ name: row.grade, value: row.count }))}
                centerLabel={t('exams.results')}
                centerValue={formatNumber(stats?.results || 0)}
                emptyMessage={t('exams.noResults')}
              />
            </Panel>
            <Panel>
              <h3 className="panel-title mb-3">{t('exams.toppers')}</h3>
              {stats?.toppers?.length ? (
                <ul className="flex flex-col gap-2">
                  {stats.toppers.map((row, index) => (
                    <li key={row.studentId} className="flex items-center justify-between text-[12.5px]">
                      <span className="truncate text-[var(--color-ink2)]">
                        <span className="me-2 text-[var(--color-dim)] no-urdu">#{index + 1}</span>
                        {row.name}
                      </span>
                      <span className="no-urdu flex items-center gap-2">
                        <Badge tone="accent">{row.grade || '-'}</Badge>
                        <span className="text-[var(--color-ink)]">{row.percentage}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-8 text-center text-[12.5px] text-[var(--color-dim)]">{t('exams.noResults')}</p>
              )}
            </Panel>
          </div>

          <Panel padded={false}>
            <DataTable
              rows={sheet?.rows || []}
              loading={loading}
              total={sheet?.rows?.length || 0}
              emptyIcon={BarChart3}
              emptyTitle={t('exams.noResults')}
              emptyHint={t('exams.noResultsHint')}
              columns={[
                { key: 'position', header: t('exams.position'), align: 'center', className: 'no-urdu', width: 70 },
                { key: 'name', header: t('common.name') },
                { key: 'admissionNo', header: t('students.admissionNo'), className: 'no-urdu' },
                { key: 'rollNo', header: t('students.rollNo'), className: 'no-urdu' },
                { key: 'sectionName', header: t('timetable.section') },
                ...(sheet?.subjects || []).map((subject) => ({
                  key: `s${subject.id}`,
                  header: subject.name,
                  align: 'center',
                  className: 'no-urdu',
                  render: (row) => row.marks[subject.id] ?? '-',
                })),
                {
                  key: 'obtainedMarks',
                  header: t('exams.obtained'),
                  align: 'end',
                  className: 'no-urdu',
                  render: (row) =>
                    row.obtainedMarks === null ? '-' : `${row.obtainedMarks} / ${row.totalMarks}`,
                },
                {
                  key: 'percentage',
                  header: t('exams.percentage'),
                  align: 'end',
                  className: 'no-urdu',
                  render: (row) => (row.percentage === null ? '-' : `${row.percentage}%`),
                },
                { key: 'grade', header: t('exams.grade'), align: 'center', render: (row) => (row.grade ? <Badge tone="accent">{row.grade}</Badge> : '-') },
                {
                  key: 'isPass',
                  header: t('exams.result'),
                  align: 'center',
                  render: (row) =>
                    row.isPass === null ? (
                      <span className="text-[12px] text-[var(--color-dim)]">{t('exams.notComputed')}</span>
                    ) : (
                      <Badge tone={row.isPass ? 'ok' : 'danger'} dot>
                        {row.isPass ? t('exams.pass') : t('exams.fail')}
                      </Badge>
                    ),
                },
                {
                  key: 'actions',
                  header: t('common.actions'),
                  align: 'end',
                  render: (row) => (
                    <IconButton
                      icon={Layers}
                      label={t('exams.reportCard')}
                      onClick={() => setCardTarget(row)}
                      disabled={row.obtainedMarks === null}
                    />
                  ),
                },
              ]}
            />
          </Panel>
        </>
      )}

      <ReportCardModal student={cardTarget} examId={examId} onClose={() => setCardTarget(null)} />
    </>
  );
}

/* -------------------------------------------------------------- report card */

function ReportCardModal({ student, examId, onClose }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!student) {
      setCard(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api.exams
      .reportCard({ studentId: student.studentId, examId })
      .then((data) => {
        if (!cancelled) setCard(data);
      })
      .catch((err) => toast.error(t(errorKey(err))))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [student, examId, t, toast]);

  const download = async () => {
    try {
      await api.exams.reportCardPdf({ studentId: student.studentId, examId });
      toast.success(t('exams.saved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  return (
    <Modal
      open={!!student}
      onClose={onClose}
      title={t('exams.reportCard')}
      subtitle={student ? `${student.name} · ${card?.exam?.name || ''}` : ''}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button icon={Printer} onClick={download} disabled={loading}>
            {t('reports.downloadPdf')}
          </Button>
        </>
      }
    >
      {loading || !card ? (
        <Skeleton width="w-full" height="h-56" />
      ) : (
        <div>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--color-line)] p-3">
              <p className="eyebrow">{t('exams.obtained')}</p>
              <p className="no-urdu text-[20px] font-semibold text-[var(--color-ink)]">
                {card.result?.obtainedMarks ?? '-'} / {card.result?.totalMarks ?? '-'}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-line)] p-3">
              <p className="eyebrow">{t('exams.grade')}</p>
              <p className="text-[20px] font-semibold text-[var(--accent)]">{card.result?.grade || '-'}</p>
            </div>
            <div className="rounded-xl border border-[var(--color-line)] p-3">
              <p className="eyebrow">{t('exams.result')}</p>
              {card.result == null ? (
                <p className="text-[15px] font-semibold text-[var(--color-dim)]">{t('exams.notComputed')}</p>
              ) : (
                <p className={`text-[20px] font-semibold ${card.result.isPass ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger)]'}`}>
                  {card.result.isPass ? t('exams.pass') : t('exams.fail')}
                </p>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--color-line)]">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('exams.subject')}</th>
                  <th className="text-end">{t('exams.obtained')}</th>
                  <th className="text-end">{t('exams.total')}</th>
                  <th className="text-end">%</th>
                  <th className="text-center">{t('exams.result')}</th>
                </tr>
              </thead>
              <tbody>
                {card.items.map((item) => (
                  <tr key={item.subjectId}>
                    <td>{item.subjectName}</td>
                    <td className="no-urdu text-end">{item.obtainedMarks ?? '-'}</td>
                    <td className="no-urdu text-end">{item.totalMarks}</td>
                    <td className="no-urdu text-end">{item.percentage === null ? '-' : `${item.percentage}%`}</td>
                    <td className="text-center">
                      {item.isPass === null ? '-' : (
                        <Badge tone={item.isPass ? 'ok' : 'danger'}>{item.isPass ? t('exams.pass') : t('exams.fail')}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {card.attendance.total > 0 && (
            <p className="mt-3 flex items-center gap-2 text-[12.5px] text-[var(--color-muted)]">
              <CalendarDays size={14} />
              {t('dash.studentAttendance')}: {card.attendance.percentage}% ({card.attendance.present}/{card.attendance.total})
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

export default ExamsPage;