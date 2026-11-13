import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, PanelHeader, ProgressBar, StatCard } from '../../components/ui/Panel';
import { Input } from '../../components/ui/Form';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const STATUSES = ['present', 'absent', 'leave', 'late', 'half_day'];

/**
 * Teacher > My Attendance: the staff member's own record, resolved from
 * users.linked_id in the main process.
 */
export function MyStaffAttendancePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.staffAttendance
      .month({ staffId: user?.linkedId, month })
      .then((rows) => active && setData(rows))
      .catch((err) => active && toast.error(t(errorKey(err))))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user?.linkedId, month, t, toast]);

  const daysByStatus = useMemo(() => {
    const map = { present: [], absent: [], leave: [], late: [], half_day: [] };
    (data?.days || []).forEach((d) => map[d.status]?.push(d));
    return map;
  }, [data]);

  return (
    <>
      <PageHeader
        title={t('staffAttendance.myAttendance')}
        subtitle={data?.staff?.name || t('common.loading')}
        actions={<Badge tone="accent" dot>{t('roles.teacher')}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('attendance.percentage')} value={loading ? <Skeleton /> : `${data?.percentage ?? 0}%`} icon={CalendarCheck} />
        <StatCard label={t('attendance.present')} value={loading ? <Skeleton /> : data?.counts?.present ?? 0} />
        <StatCard label={t('attendance.absent')} value={loading ? <Skeleton /> : data?.counts?.absent ?? 0} />
        <StatCard label={t('attendance.leave')} value={loading ? <Skeleton /> : data?.counts?.leave ?? 0} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel padded={false}>
          <div className="flex items-end gap-3 border-b border-[var(--color-line)] p-4">
            <div className="w-[180px]">
              <Input label={t('settings.session')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          </div>
          <div className="max-h-[52vh] overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('attendance.status')}</th>
                  <th>{t('staffAttendance.checkIn')}</th>
                  <th>{t('staffAttendance.checkOut')}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.days || []).map((d) => (
                  <tr key={d.date}>
                    <td className="no-urdu">{d.date}</td>
                    <td>
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="no-urdu">{d.check_in || '-'}</td>
                    <td className="no-urdu">{d.check_out || '-'}</td>
                  </tr>
                ))}
                {!loading && (data?.days || []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-[12px] text-[var(--color-dim)]">
                      {t('common.noData')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={t('attendance.summary')} />
          <div className="flex flex-col gap-3">
            {STATUSES.map((status) => (
              <div key={status}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="text-[var(--color-muted)]">{t(`attendance.${status}`)}</span>
                  <span className="no-urdu text-[var(--color-dim)]">
                    {data?.counts?.[status] ?? 0} · {daysByStatus[status].length}
                  </span>
                </div>
                <ProgressBar
                  value={data?.marked ? ((data?.counts?.[status] ?? 0) / data.marked) * 100 : 0}
                  tone={status === 'present' ? 'ok' : status === 'absent' ? 'danger' : 'warn'}
                />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

export default MyStaffAttendancePage;