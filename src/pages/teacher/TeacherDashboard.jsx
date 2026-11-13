import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Banknote,
  CalendarCheck,
  ClipboardList,
  PencilRuler,
  School,
  Users,
} from 'lucide-react';
import { useAuth } from '../../store/AuthProvider';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, PanelHeader, StatCard, ProgressBar } from '../../components/ui/Panel';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { TrendChart, DonutChart } from '../../components/charts/Charts';
import { formatDate, formatNumber } from '../../utils/format';

export function TeacherDashboard() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();

  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.reports.dashboard());
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const own = data?.ownAttendance;
  const marked = data?.attendanceMarkedToday || 0;
  const total = data?.attendanceTotalToday || 0;
  const results = data?.results;

  const attendanceData = (data?.attendanceTrend || []).map((row) => ({ ...row, label: row.date.slice(5) }));

  return (
    <>
      <PageHeader
        title={t('dash.welcome', { name: user?.displayName })}
        subtitle={t('dash.subtitle_teacher')}
        actions={<Badge tone="accent" dot>{t('roles.teacher')}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('dash.myClassesToday')}
          value={data ? formatNumber(data.classCount) : <Skeleton />}
          icon={School}
          hint={data ? `${formatNumber(data.studentCount)} ${t('students.title')}` : ''}
        />
        <StatCard
          label={t('dash.pendingAttendance')}
          value={data ? `${marked}/${total}` : <Skeleton />}
          icon={CalendarCheck}
          hint={t('attendance.daily')}
        >
          {data && <ProgressBar value={total ? (marked / total) * 100 : 0} tone={marked >= total ? 'ok' : 'warn'} />}
        </StatCard>
        <StatCard
          label={t('dash.upcomingExams')}
          value={data ? data.openExams.length : <Skeleton />}
          icon={ClipboardList}
          hint={t('exams.marks')}
        />
        <StatCard
          label={t('dash.myAttendance')}
          value={own ? `${own.percentage}%` : <Skeleton />}
          icon={CalendarCheck}
          hint={own ? `${own.present}/${own.total} ${t('time.thisMonth')}` : ''}
        >
          {own && <ProgressBar value={own.percentage} tone="ok" />}
        </StatCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title={t('nav.teacher.classes')} />
            {!data ? (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] p-3">
                    <Skeleton height="h-8" width="w-8" className="rounded-lg" />
                    <div className="flex-1">
                      <Skeleton height="h-3" width="w-32" />
                      <Skeleton height="h-2.5" width="w-20" className="mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : data.assignments.length === 0 ? (
              <EmptyState title={t('common.noData')} hint={t('common.noDataHint')} icon={School} />
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {data.assignments.slice(0, 8).map((row, index) => (
                  <li key={`${row.className}-${row.sectionName}-${row.subjectName}-${index}`} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]">
                      <Users size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-[var(--color-ink)]">
                        {row.className} · {row.sectionName}
                      </p>
                      <p className="truncate text-[11.5px] text-[var(--color-dim)]">{row.subjectName || '-'}</p>
                    </div>
                    <Badge tone="neutral">{row.students}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title={t('dash.attendanceTrend')} />
            <TrendChart
              data={attendanceData}
              xKey="label"
              height={190}
              type="area"
              suffix="%"
              series={[
                { key: 'percentage', label: t('attendance.percentage'), color: 'var(--accent)' },
                { key: 'absent', label: t('attendance.absent'), color: 'var(--color-danger)' },
              ]}
            />
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title={t('dash.upcomingExams')} />
            {!data ? (
              <Skeleton width="w-full" height="h-24" />
            ) : data.openExams.length === 0 ? (
              <EmptyState title={t('common.noData')} hint={t('common.noDataHint')} icon={ClipboardList} />
            ) : (
              <ul className="flex flex-col gap-2">
                {data.openExams.map((exam) => (
                  <li key={exam.id}>
                    <Link
                      to="/teacher/marks"
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] p-3 transition hover:border-[var(--accent)]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-medium text-[var(--color-ink)]">{exam.name}</p>
                        <p className="no-urdu truncate text-[11.5px] text-[var(--color-dim)]">
                          {exam.className} · {formatDate(exam.endDate)} · {exam.subjects} {t('exams.papers')}
                        </p>
                      </div>
                      <ArrowUpRight size={14} className="shrink-0 text-[var(--color-dim)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title={t('exams.results')} />
            <DonutChart
              data={(results?.byClass || []).filter((row) => row.results > 0).map((row) => ({ name: row.className, value: Math.round(row.average) }))}
              centerLabel={t('exams.average')}
              centerValue={results ? `${results.averagePercentage}%` : '—'}
              height={180}
              emptyMessage={t('common.noData')}
            />
          </Panel>

          <Panel className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]">
                <PencilRuler size={18} />
              </div>
              <div>
                <p className="text-[13px] font-medium">{t('nav.teacher.marks')}</p>
                <p className="text-[11.5px] text-[var(--color-dim)]">{t('exams.subtitle')}</p>
              </div>
            </div>
            <Link to="/teacher/marks" className="btn btn-sm">
              {t('nav.teacher.marks')}
            </Link>
          </Panel>

          <Panel className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]">
                <Banknote size={18} />
              </div>
              <div>
                <p className="text-[13px] font-medium">{t('nav.teacher.salary')}</p>
                <p className="text-[11.5px] text-[var(--color-dim)]">{t('salary.mySlipsSubtitle')}</p>
              </div>
            </div>
            <Link to="/teacher/salary" className="btn btn-sm">
              {t('common.viewAll')}
            </Link>
          </Panel>
        </div>
      </div>
    </>
  );
}

export default TeacherDashboard;