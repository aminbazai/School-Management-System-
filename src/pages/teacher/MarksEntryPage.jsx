import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Info, Pencil, Users } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, StatCard } from '../../components/ui/Panel';
import { Select } from '../../components/ui/Form';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/States';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { MarksGrid, PaperTabs } from '../../components/exams/MarksGrid';
import { formatDate } from '../../utils/format';

/**
 * Teacher workspace for Phase 6: enter marks for the subjects they teach.
 *
 * The exam list is deliberately narrow - only exams of the classes they are
 * assigned to, and only ones open for marks. The main process enforces the
 * same rule; this list is convenience, not security.
 */
export function MarksEntryPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sheetLoading, setSheetLoading] = useState(false);

  useEffect(() => {
    api.exams
      .list()
      .then((data) => {
        // The main process already scopes the list to this teacher's classes;
        // we only drop the exams that are not accepting marks.
        const open = data.rows.filter((exam) => exam.status === 'marks_open' || exam.status === 'published');
        setExams(open);
        setExamId((prev) => prev ?? open[0]?.id ?? null);
      })
      .catch((err) => toast.error(t(errorKey(err))))
      .finally(() => setLoading(false));
  }, [t, toast]);

  const loadSheet = useCallback(
    async (id) => {
      if (!id) {
        setSheet(null);
        setSubjects([]);
        return;
      }
      setSheetLoading(true);
      try {
        const data = await api.exams.markSheet({ examId: id });
        setSheet(data);
        setSubjects(data.subjects);
        setSubjectId((prev) => (data.subjects.some((s) => s.id === prev) ? prev : data.subjects[0]?.id ?? null));
      } catch (err) {
        toast.error(t(errorKey(err)));
      } finally {
        setSheetLoading(false);
      }
    },
    [t, toast],
  );

  useEffect(() => {
    loadSheet(examId);
  }, [examId, loadSheet]);

  const mine = subjects.filter((subject) => subject.canEnter);

  if (!loading && exams.length === 0) {
    return (
      <>
        <PageHeader title={t('exams.marks')} subtitle={t('exams.subtitle')} />
        <EmptyState icon={Pencil} title={t('exams.noMarksExams')} hint={t('exams.noMarksExamsHint')} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('exams.marks')} subtitle={t('exams.subtitle')} />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t('exams.exam')}
          menu={false}
          value={loading ? <Skeleton /> : exams.length}
          icon={Pencil}
        />
        <StatCard
          label={t('exams.papers')}
          menu={false}
          value={sheetLoading ? <Skeleton /> : mine.length}
          hint={t('exams.studentCount', { count: sheet?.rows?.length || 0 })}
          icon={CalendarDays}
        />
        <StatCard
          label={t('students.title')}
          menu={false}
          value={sheetLoading ? <Skeleton /> : sheet?.rows?.length || 0}
          icon={Users}
        />
      </div>

      <Panel>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-[300px]">
            <Select
              label={t('exams.exam')}
              value={examId || ''}
              placeholder={t('exams.exam')}
              options={exams.map((exam) => ({ value: exam.id, label: `${exam.name} · ${exam.className}` }))}
              onChange={(e) => setExamId(Number(e.target.value))}
            />
          </div>
          {sheet?.exam && (
            <div className="flex items-center gap-2 pb-1 text-[12.5px] text-[var(--color-muted)]">
              <Badge tone="info">{t(`exams.${sheet.exam.status === 'marks_open' ? 'openForMarks' : 'publish'}`)}</Badge>
              <span className="no-urdu">{formatDate(sheet.exam.startDate)} → {formatDate(sheet.exam.endDate)}</span>
            </div>
          )}
        </div>

        {subjects.length === 0 ? (
          <EmptyState icon={Pencil} title={t('exams.noPapers')} hint={t('exams.noPapersHint')} className="py-10" />
        ) : (
          <>
            <PaperTabs subjects={subjects} activeId={subjectId} onSelect={setSubjectId} />
            {mine.length === 0 && (
              <p className="mt-3 flex items-center gap-2 text-[12.5px] text-[var(--color-warn)]">
                <Info size={14} />
                {t('exams.readOnly')}
              </p>
            )}
            <div className="mt-4">
              <MarksGrid examSubjectId={subjectId} canEdit={!!subjects.find((s) => s.id === subjectId)?.canEnter} />
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

export default MarksEntryPage;