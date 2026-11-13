import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Banknote, CalendarCheck, Receipt, TrendingDown, TrendingUp } from 'lucide-react';
import { useAuth } from '../../store/AuthProvider';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, PanelHeader, StatCard, ProgressBar } from '../../components/ui/Panel';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { TrendChart, BarsChart } from '../../components/charts/Charts';
import { formatCurrency, formatMonth, formatNumber } from '../../utils/format';

export function OfficeDashboard() {
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

  const fees = data?.fees;
  const salary = data?.salary;
  const attendance = data?.attendance;

  const collections = (data?.collections || []).map((row) => ({ ...row, label: row.paymentDate.slice(5) }));
  const financeData = (data?.financeTrend || []).map((row) => ({
    ...row,
    label: formatMonth(row.month).slice(0, 3),
  }));

  return (
    <>
      <PageHeader
        title={t('dash.welcome', { name: user?.displayName })}
        subtitle={t('dash.subtitle_office')}
        actions={<Badge tone="accent" dot>{t('roles.office')}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('dash.feesCollected')}
          value={fees ? formatCurrency(fees.paid, symbol) : <Skeleton />}
          icon={Receipt}
          hint={fees ? `${fees.collectionPercentage}% · ${formatMonth(fees.month)}` : ''}
        >
          {fees && <ProgressBar value={fees.collectionPercentage} tone="ok" />}
        </StatCard>
        <StatCard
          label={t('dash.feesPending')}
          value={fees ? formatCurrency(fees.outstanding, symbol) : <Skeleton />}
          icon={TrendingDown}
          hint={fees ? `${fees.open} ${t('fees.openVouchers')}` : ''}
        >
          {fees && <ProgressBar value={fees.open ? 100 : 0} tone="warn" />}
        </StatCard>
        <StatCard
          label={t('dash.salaryPaid')}
          value={salary ? formatCurrency(salary.paid, symbol) : <Skeleton />}
          icon={Banknote}
          hint={salary ? `${salary.slips} ${t('salary.payrolls')} · ${formatCurrency(salary.pending, symbol)} ${t('dash.salaryPending')}` : ''}
        />
        <StatCard
          label={t('dash.teacherAttendance')}
          value={attendance ? `${attendance.staffPercentage}%` : <Skeleton />}
          icon={CalendarCheck}
          hint={attendance ? `${formatNumber(attendance.staffPresent)}/${formatNumber(attendance.staffTotal)}` : ''}
        >
          {attendance && <ProgressBar value={attendance.staffPercentage} tone="accent" />}
        </StatCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title={t('dash.feeCollection')} subtitle={t('time.daysAgo', { count: 14 })} />
            <TrendChart
              data={collections}
              xKey="label"
              height={200}
              type="area"
              series={[{ key: 'amount', label: t('dash.feesCollected'), color: 'var(--accent)' }]}
            />
          </Panel>

          <Panel>
            <PanelHeader title={t('expenses.report')} />
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
        </div>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title={t('fees.defaulters')} />
            <div className="flex items-baseline gap-2">
              <span className="no-urdu text-[28px] font-semibold leading-none text-[var(--color-ink)]">
                {data ? formatNumber(data.defaulters.count) : <Skeleton width="w-14" height="h-7" />}
              </span>
              <span className="text-[12px] text-[var(--color-muted)]">{t('students.title')}</span>
            </div>
            <p className="no-urdu mt-3 text-[13px] text-[var(--color-ink2)]">
              {t('dash.feesPending')}:{' '}
              {data ? formatCurrency(data.defaulters.balance, symbol) : '—'}
            </p>
            <Link to="/office/fees" className="btn btn-sm mt-4 w-full">
              {t('nav.office.fees')}
              <ArrowUpRight size={14} />
            </Link>
          </Panel>

          <Panel>
            <PanelHeader title={t('reports.title')} />
            <div className="flex flex-col gap-3">
              {['enrolment', 'attendance', 'fees', 'salary', 'results'].map((kind) => (
                <Link
                  key={kind}
                  to="/office/reports"
                  className="flex items-center justify-between rounded-xl border border-[var(--color-line)] bg-[var(--glass)] px-3.5 py-2.5 text-[12.5px] text-[var(--color-ink2)] transition hover:border-[var(--color-line2)] hover:text-[var(--color-ink)]"
                >
                  {t(`reports.${kind}`)}
                  <TrendingUp size={13} className="text-[var(--color-dim)]" />
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

export default OfficeDashboard;