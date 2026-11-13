import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, PanelHeader, ProgressBar, StatCard } from '../../components/ui/Panel';
import { Input } from '../../components/ui/Form';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { dayjs } from '../../utils/format';

const thisMonth = () => new Date().toISOString().slice(0, 7);

const STATUS_STYLE = {
  present: 'bg-[color-mix(in_srgb,var(--color-ok)_22%,transparent)] text-[var(--color-ok)]',
  absent: 'bg-[color-mix(in_srgb,var(--color-danger)_22%,transparent)] text-[var(--color-danger)]',
  leave: 'bg-[color-mix(in_srgb,var(--color-warn)_22%,transparent)] text-[var(--color-warn)]',
  late: 'bg-[color-mix(in_srgb,var(--color-warn)_14%,transparent)] text-[var(--color-warn)]',
  half_day: 'bg-[color-mix(in_srgb,var(--color-info)_18%,transparent)] text-[var(--color-info)]',
};

/**
 * Student > My Attendance: monthly calendar plus percentage.
 * The student id is resolved from the session in the main process.
 */
export function MyAttendancePage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.attendance
      .studentHistory({ month })
      .then((rows) => active && setData(rows))
      .catch((err) => active && toast.error(t(errorKey(err))))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [month, t, toast]);

  const lang = i18n.resolvedLanguage === 'ur' ? 'ur' : 'en-gb';

  const calendar = useMemo(() => {
    if (!data) return [];
    const start = dayjs(`${month}-01`);
    const daysInMonth = start.daysInMonth();
    const statusByDay = Object.fromEntries(data.days.map((d) => [d.date, d.status]));
    const cells = [];
    for (let i = 0; i < start.day(); i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = start.date(day).format('YYYY-MM-DD');
      cells.push({ day, date, status: statusByDay[date] || null });
    }
    return cells;
  }, [data, month]);

  const weekdays = useMemo(() => {
    const start = dayjs(`${month}-01`);
    return Array.from({ length: 7 }, (_, i) => start.add(i, 'day').format('ddd'));
  }, [month]);

  return (
    <>
      <PageHeader
        title={t('attendance.myAttendance')}
        subtitle={data?.student?.name}
        actions={<Badge tone="accent" dot>{t('roles.student')}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('attendance.percentage')} value={loading ? <Skeleton /> : `${data?.percentage ?? 0}%`} icon={TrendingUp} />
        <StatCard label={t('attendance.present')} value={loading ? <Skeleton /> : data?.counts?.present ?? 0} />
        <StatCard label={t('attendance.absent')} value={loading ? <Skeleton /> : data?.counts?.absent ?? 0} />
        <StatCard label={t('attendance.leave')} value={loading ? <Skeleton /> : data?.counts?.leave ?? 0} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel>
          <div className="mb-4 flex items-end gap-3">
            <div className="w-[180px]">
              <Input label={t('settings.session')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {weekdays.map((day) => (
              <div key={day} className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-[var(--color-dim)]">
                {dayjs().locale(lang).day ? day.slice(0, 3) : day}
              </div>
            ))}
            {calendar.map((cell, index) =>
              cell ? (
                <div
                  key={cell.date}
                  title={`${cell.date} · ${cell.status ? t(`attendance.${cell.status}`) : '-'}`}
                  className={clsx(
                    'flex h-11 items-center justify-center rounded-lg border text-[12.5px]',
                    cell.status
                      ? STATUS_STYLE[cell.status]
                      : 'border-[var(--color-line)] bg-[var(--glass)] text-[var(--color-dim)]',
                  )}
                >
                  {cell.day}
                </div>
              ) : (
                <div key={`empty-${index}`} />
              ),
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            {['present', 'absent', 'leave', 'late', 'half_day'].map((status) => (
              <span key={status} className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-muted)]">
                <span className={clsx('h-3 w-3 rounded', STATUS_STYLE[status])} />
                {t(`attendance.${status}`)}
              </span>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={t('attendance.monthlyTrend')} actions={<CalendarDays size={15} className="text-[var(--color-dim)]" />} />
          <div className="flex flex-col gap-3">
            {(data?.yearly || []).map((row) => (
              <div key={row.month}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="no-urdu text-[var(--color-muted)]">{row.month}</span>
                  <span className="no-urdu text-[var(--color-dim)]">{row.percentage}%</span>
                </div>
                <ProgressBar value={row.percentage} tone={row.percentage < 75 ? 'danger' : row.percentage < 85 ? 'warn' : 'ok'} />
              </div>
            ))}
            {loading && <Skeleton height="h-24" width="w-full" />}
          </div>
        </Panel>
      </div>
    </>
  );
}

export default MyAttendancePage;