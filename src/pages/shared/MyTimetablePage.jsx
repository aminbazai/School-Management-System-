import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarRange, Users } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, StatCard } from '../../components/ui/Panel';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { TimetableGrid, TimetableSummary } from '../../components/timetable/TimetableGrid';

/**
 * Read-only timetable shared by the teacher and student workspaces.
 *
 * Neither passes an id: the main process resolves "my" from the session, so
 * there is nothing here that could be pointed at another section or teacher.
 */
export function MyTimetablePage({ role = 'student' }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.timetable.my());
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const isTeacher = role === 'teacher';
  const subjectCount = new Set((data?.slots || []).map((slot) => slot.subjectId).filter(Boolean)).size;

  return (
    <>
      <PageHeader title={t('timetable.myTimetable')} subtitle={t('timetable.myTimetableSubtitle')} />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          label={isTeacher ? t('staff.title') : t('timetable.section')}
          menu={false}
          icon={CalendarRange}
          value={loading ? <Skeleton /> : isTeacher ? data?.staffName || '-' : `${data?.className || '-'} ${data?.sectionName || ''}`}
        />
        <StatCard
          label={t('timetable.lessons', { count: data?.slots?.length || 0 })}
          menu={false}
          icon={Users}
          value={loading ? <Skeleton /> : data?.slots?.length || 0}
          hint={isTeacher ? data?.employeeCode : undefined}
        />
        <StatCard
          label={t('exams.papers')}
          menu={false}
          value={loading ? <Skeleton /> : subjectCount}
          hint={t('exams.subject')}
        />
      </div>

      <Panel padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] p-4">
          <TimetableSummary data={data} />
          {!isTeacher && data?.className && (
            <Badge tone="accent">
              {data.className} · {data.sectionName}
            </Badge>
          )}
        </div>
        <TimetableGrid data={data} loading={loading} mode="view" />
      </Panel>
    </>
  );
}

export default MyTimetablePage;