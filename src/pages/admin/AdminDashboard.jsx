import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  CalendarCheck,
  Clock,
  GraduationCap,
  Landmark,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../../store/AuthProvider';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, PanelHeader, StatCard, ProgressBar } from '../../components/ui/Panel';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { TrendChart, BarsChart, DonutChart } from '../../components/charts/Charts';
import { formatCurrency, formatRelative, formatMonth, initialsOf, formatNumber } from '../../utils/format';

function ActivityRow({ entry, t }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--glass-2)] text-[11px] font-semibold text-[var(--color-muted)]">
        {initialsOf(entry.username || '?')}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] text-[var(--color-ink2)]">
          <span className="font-medium text-[var(--color-ink)]">{entry.username}</span>
          {' · '}
          {entry.action.replace(/_/g, ' ')}
          {entry.entity ? ` · ${entry.entity}` : ''}
        </p>
        <p className="text-[11px] text-[var(--color-dim)]">{formatRelative(entry.created_at, t)}</p>
      </div>
      <Badge tone={entry.action.includes('fail') ? 'danger' : 'neutral'}>{entry.role || '-'}</Badge>
    </li>
  );
}

/** A quick link card - the dashboard's "where do I go next" row. */
function Shortcut({ to, icon: Icon, title, hint }) {
  return (
    <Link
      to={to}
      className="panel flex items-center gap-3 p-4 transition hover:border-[var(--color-line2)]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]">
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{title}</p>
        {hint && <p className="truncate text-[11.5px] text-[var(--color-dim)]">{hint}</p>}
      </div>
      <ArrowUpRight size={15} className="shrink-0 text-[var(--color-dim)]" />
    </Link>
  );
}

export function AdminDashboard() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, settings } = useAuth();
  const symbol = settings?.currency_symbol || 'Rs';

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

  const counts = data?.counts;
  const attendance = data?.attendance;
  const fees = data?.fees;
  const salary = data?.salary;
  const results = data?.results;

  const attendanceData = (data?.attendanceTrend || []).map((row) => ({
    ...row,
    label: row.date.slice(5),
  }));
  const financeData = (data?.financeTrend || []).map((row) => ({
    ...row,
    label: formatMonth(row.month).slice(0, 3),
  }));

  return (
    <>
      <PageHeader
        title={t('dash.welcome', { name: user?.displayName })}
        subtitle={t('dash.subtitle_admin')}
        actions={<Badge tone="accent" dot>{t('roles.admin')}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('dash.totalStudents')}
          icon={Users}
          value={counts ? formatNumber(counts.students) : <Skeleton />}
          hint={counts ? `${counts.male} M / ${counts.female} F · ${counts.classes} ${t('classes.title')}` : ''}
        />
        <StatCard
          label={t('dash.totalTeachers')}
          icon={UserCheck}
          value={counts ? formatNumber(counts.staff) : <Skeleton />}
          hint={counts ? `${counts.teachers} ${t('nav.admin.staff')} · ${counts.onLeave} ${t('staff.onLeave')}` : ''}
        />
        <StatCard
          label={t('dash.studentAttendance')}
          icon={CalendarCheck}
          value={attendance ? `${attendance.studentPercentage}%` : <Skeleton />}
          hint={attendance ? `${formatMonth(attendance.month)} · ${attendance.markedDays} ${t('attendance.daily')}` : ''}
        >
          {attendance && <ProgressBar value={attendance.studentPercentage} tone="ok" />}
        </StatCard>
        <StatCard
          label={t('dash.feesCollected')}
          icon={Wallet}
          value={fees ? formatCurrency(fees.paid, symbol) : <Skeleton />}
          hint={fees ? `${fees.collectionPercentage}% · ${fees.receiptsToday} ${t('time.today')}` : ''}
        >
          {fees && <ProgressBar value={fees.collectionPercentage} tone="accent" />}
        </StatCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title={t('dash.attendanceTrend')} />
            <TrendChart
              data={attendanceData}
              xKey="label"
              height={200}
              type="area"
              suffix="%"
              series={[
                { key: 'percentage', label: t('attendance.percentage'), color: 'var(--accent)' },
                { key: 'late', label: t('attendance.late'), color: 'var(--color-warn)' },
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader title={t('dash.feeCollection')} />
            <BarsChart
              data={financeData}
              xKey="label"
              height={200}
              series={[
                { key: 'collected', label: t('dash.feesCollected'), color: 'var(--accent)' },
                { key: 'expense', label: t('expenses.expense'), color: 'var(--color-warn)' },
                { key: 'salary', label: t('salary.net'), color: 'var(--color-danger)' },
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader title={t('dash.recentActivity')} actions={<Clock size={15} className="text-[var(--color-dim)]" />} />
            {!data ? (
              <div className="flex flex-col gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-[var(--glass-2)]" />
                ))}
              </div>
            ) : (data.recentAudit || []).length === 0 ? (
              <EmptyState title={t('common.noData')} icon={Activity} />
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {data.recentAudit.map((entry, index) => (
                  <ActivityRow key={`${entry.created_at}-${index}`} entry={entry} t={t} />
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title={t('nav.admin.fees')} />
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                  <span className="text-[var(--color-muted)]">{t('dash.feesCollected')}</span>
                  <span className="no-urdu text-[var(--color-ink)]">{fees ? formatCurrency(fees.paid, symbol) : '—'}</span>
                </div>
                <ProgressBar value={fees?.collectionPercentage || 0} />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                  <span className="text-[var(--color-muted)]">{t('dash.feesPending')}</span>
                  <span className="no-urdu text-[var(--color-ink)]">{fees ? formatCurrency(fees.outstanding, symbol) : '—'}</span>
                </div>
                <ProgressBar value={fees?.open ? 100 : 0} tone="warn" />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-[12px]">
                  <span className="text-[var(--color-muted)]">{t('dash.salaryPending')}</span>
                  <span className="no-urdu text-[var(--color-ink)]">{salary ? formatCurrency(salary.pending, symbol) : '—'}</span>
                </div>
                <ProgressBar value={salary?.net ? (salary.paid / salary.net) * 100 : 0} tone="ok" />
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t('exams.results')} />
            <DonutChart
              data={(results?.byClass || [])
                .filter((row) => row.results > 0)
                .map((row) => ({ name: row.className, value: Math.round(row.average) }))}
              centerLabel={t('exams.average')}
              centerValue={results ? `${results.averagePercentage}%` : '—'}
              emptyMessage={t('common.noData')}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <span className="text-[var(--color-muted)]">{t('exams.passPercentage')}</span>
              <Badge tone={!results ? 'neutral' : results.passPercentage >= 50 ? 'ok' : 'danger'}>
                {results ? `${results.passPercentage}%` : '—'}
              </Badge>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t('dash.quickAccess')} />
            <div className="flex flex-col gap-3">
              <Shortcut to="/admin/exams" icon={GraduationCap} title={t('nav.admin.exams')} hint={t('exams.subtitle')} />
              <Shortcut to="/admin/attendance-reports" icon={CalendarCheck} title={t('nav.admin.attendanceReports')} hint={t('attendance.reportsSubtitle')} />
              <Shortcut to="/admin/backup" icon={Landmark} title={t('nav.admin.backup')} hint={t('backup.subtitle')} />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

export default AdminDashboard;