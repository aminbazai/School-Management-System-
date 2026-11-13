import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Award, Bell, CalendarCheck, ClipboardList, Megaphone, Pin, School, Table2, Wallet } from 'lucide-react';
import { useAuth } from '../../store/AuthProvider';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, PanelHeader, StatCard, ProgressBar } from '../../components/ui/Panel';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { TrendChart } from '../../components/charts/Charts';
import { formatCurrency, formatDate, formatRelative } from '../../utils/format';

export function StudentDashboard() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, settings } = useAuth();
  const symbol = settings?.currency_symbol || 'Rs';

  const [data, setData] = useState(null);
  const [notices, setNotices] = useState([]);

  const load = useCallback(async () => {
    try {
      const [dashboard, board] = await Promise.all([api.reports.dashboard(), api.notices.list()]);
      setData(dashboard);
      setNotices(board.rows.slice(0, 4));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const attendance = data?.attendance;
  const fees = data?.fees;
  const latest = data?.latestResult;
  const trend = (data?.attendanceTrend || []).map((row) => ({ ...row, label: row.date.slice(5) }));

  return (
    <>
      <PageHeader
        title={t('dash.welcome', { name: user?.displayName })}
        subtitle={t('dash.subtitle_student')}
        actions={<Badge tone="accent" dot>{t('roles.student')}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('dash.myAttendance')}
          value={attendance ? `${attendance.percentage}%` : <Skeleton />}
          icon={CalendarCheck}
          hint={attendance ? `${attendance.present}/${attendance.total} ${t('time.thisMonth')}` : ''}
        >
          {attendance && <ProgressBar value={attendance.percentage} tone={attendance.percentage >= 75 ? 'ok' : 'warn'} />}
        </StatCard>
        <StatCard
          label={t('dash.myResults')}
          value={latest ? `${latest.percentage}%` : <Skeleton />}
          icon={Table2}
          hint={latest ? `${latest.grade} · ${latest.examName}` : t('common.noData')}
        >
          {latest && <ProgressBar value={latest.percentage} tone={latest.isPass ? 'ok' : 'danger'} />}
        </StatCard>
        <StatCard
          label={t('dash.feesStatus')}
          value={fees ? formatCurrency(fees.balance, symbol) : <Skeleton />}
          icon={Wallet}
          hint={fees ? `${t('dash.paid')}: ${formatCurrency(fees.paid, symbol)}` : ''}
        />
        <StatCard
          label={t('nav.student.class')}
          value={data?.student ? `${data.student.className} ${data.student.sectionName || ''}` : <Skeleton />}
          icon={School}
          hint={data?.student?.admissionNo}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title={t('dash.attendanceTrend')} />
            <TrendChart
              data={trend}
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

          <Panel>
            <PanelHeader
              title={t('nav.student.notices')}
              actions={<Bell size={15} className="text-[var(--color-dim)]" />}
            />
            {notices.length === 0 ? (
              <EmptyState icon={Megaphone} title={t('notices.noNotices')} hint={t('notices.noNoticesHint')} />
            ) : (
              <ul className="flex flex-col gap-2">
                {notices.map((notice) => (
                  <li key={notice.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--glass)] p-3">
                    <div className="flex items-start gap-2">
                      {notice.pinned && <Pin size={12} className="mt-1 shrink-0 text-[var(--accent)]" />}
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-medium text-[var(--color-ink)]">{notice.title}</p>
                        {notice.body && (
                          <p className="line-clamp-2 text-[11.5px] text-[var(--color-muted)]">{notice.body}</p>
                        )}
                        <p className="mt-1 text-[11px] text-[var(--color-dim)]">{formatRelative(notice.createdAt, t)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/student/notices" className="btn btn-sm mt-3 w-full">
              {t('common.viewAll')}
            </Link>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          {data?.upcomingExams?.length > 0 && (
            <Panel>
              <PanelHeader title={t('dash.upcomingExams')} />
              <ul className="flex flex-col gap-2">
                {data.upcomingExams.map((exam) => (
                  <li
                    key={`${exam.id}-${exam.subjectName}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] px-3.5 py-2.5"
                  >
                    <span className="truncate text-[12.5px] text-[var(--color-ink2)]">{exam.subjectName}</span>
                    <span className="no-urdu shrink-0 text-[11.5px] text-[var(--color-dim)]">{formatDate(exam.examDate)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {latest && (
            <Panel>
              <PanelHeader title={t('exams.myResults')} />
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]">
                  <Award size={24} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-[var(--color-ink)]">{latest.examName}</p>
                  <p className="no-urdu text-[12px] text-[var(--color-muted)]">
                    {latest.percentage}% · {latest.grade} · {t('exams.position')} {latest.position}
                  </p>
                </div>
              </div>
              <Link to="/student/results" className="btn btn-sm mt-4 w-full">
                {t('nav.student.results')}
              </Link>
            </Panel>
          )}

          <Panel>
            <PanelHeader title={t('dash.quickAccess')} />
            <div className="flex flex-col gap-3">
              <Link
                to="/student/timetable"
                className="flex items-center justify-between rounded-xl border border-[var(--color-line)] bg-[var(--glass)] px-3.5 py-2.5 text-[12.5px] text-[var(--color-ink2)] transition hover:border-[var(--color-line2)] hover:text-[var(--color-ink)]"
              >
                {t('nav.student.timetable')}
                <ClipboardList size={13} className="text-[var(--color-dim)]" />
              </Link>
              <Link
                to="/student/attendance"
                className="flex items-center justify-between rounded-xl border border-[var(--color-line)] bg-[var(--glass)] px-3.5 py-2.5 text-[12.5px] text-[var(--color-ink2)] transition hover:border-[var(--color-line2)] hover:text-[var(--color-ink)]"
              >
                {t('nav.student.attendance')}
                <CalendarCheck size={13} className="text-[var(--color-dim)]" />
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

export default StudentDashboard;