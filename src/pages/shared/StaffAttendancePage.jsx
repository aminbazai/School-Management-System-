import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, Save, CalendarRange, Umbrella, Plus } from 'lucide-react';
import clsx from 'clsx';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, PanelHeader, ProgressBar } from '../../components/ui/Panel';
import { Button } from '../../components/ui/Button';
import { Input, Select, FormGrid } from '../../components/ui/Form';
import { Modal } from '../../components/ui/Modal';
import { DataTable } from '../../components/ui/DataTable';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { StatusButtons } from '../../components/attendance/StatusButtons';
import { useToast } from '../../components/ui/Toast';

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

const TABS = [
  { key: 'daily', labelKey: 'staffAttendance.daily', icon: CalendarCheck },
  { key: 'monthly', labelKey: 'staffAttendance.monthly', icon: CalendarRange },
  { key: 'leaves', labelKey: 'staffAttendance.leaves', icon: Umbrella },
];

/** Staff (teacher) attendance: daily marking, monthly summary and leave desk. */
export function StaffAttendancePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [tab, setTab] = useState('daily');
  const [date, setDate] = useState(today());
  const [month, setMonth] = useState(thisMonth());

  return (
    <>
      <PageHeader title={t('staffAttendance.title')} subtitle={t('staffAttendance.subtitle')} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button key={item.key} type="button" onClick={() => setTab(item.key)} className={clsx('btn btn-sm', tab === item.key && 'btn-primary')}>
            <item.icon size={14} />
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'daily' && <DailyTab date={date} setDate={setDate} />}
      {tab === 'monthly' && <MonthlyTab month={month} setMonth={setMonth} />}
      {tab === 'leaves' && <LeavesTab toast={toast} />}
    </>
  );
}

function DailyTab({ date, setDate }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [marks, setMarks] = useState({});
  const [staffType, setStaffType] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.staffAttendance.day({ date, staffType: staffType || undefined });
      setData(result);
      const next = {};
      result.staff.forEach((s) => {
        next[s.id] = { status: s.status || '', checkIn: s.check_in || '08:00', checkOut: s.check_out || '13:00' };
      });
      setMarks(next);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [date, staffType, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const entries = Object.entries(marks)
        .filter(([, value]) => value.status)
        .map(([staffId, value]) => ({ staffId: Number(staffId), ...value }));
      const result = await api.staffAttendance.mark({ date, entries });
      setData(result);
      toast.success(t('attendance.saved'));
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel padded={false}>
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-line)] p-4">
        <div className="w-[180px]">
          <Input label={t('common.date')} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="w-[180px]">
          <Select
            label={t('staff.type')}
            value={staffType}
            placeholder={t('staff.allTypes')}
            options={[
              { value: 'teacher', label: t('roles.teacher') },
              { value: 'office', label: t('roles.office') },
              { value: 'other', label: t('staff.other') },
            ]}
            onChange={(e) => setStaffType(e.target.value)}
          />
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Badge tone="neutral">{t('staffAttendance.members', { count: data?.staff?.length || 0 })}</Badge>
          <Button variant="primary" icon={Save} loading={saving} disabled={!data?.editable} onClick={save}>
            {t('common.save')}
          </Button>
        </div>
      </div>

      <div className="max-h-[60vh] overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>#</th>
              <th>{t('staff.name')}</th>
              <th>{t('staff.designation')}</th>
              <th style={{ width: 330 }}>{t('attendance.status')}</th>
              <th style={{ width: 110 }}>{t('staffAttendance.checkIn')}</th>
              <th style={{ width: 110 }}>{t('staffAttendance.checkOut')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-[12px] text-[var(--color-dim)]">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!loading && (data?.staff || []).length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-[12px] text-[var(--color-dim)]">
                  {t('common.noData')}
                </td>
              </tr>
            )}
            {!loading &&
              (data?.staff || []).map((member, index) => (
                <tr key={member.id}>
                  <td className="no-urdu text-[var(--color-dim)]">{index + 1}</td>
                  <td>
                    <p className="font-medium text-[var(--color-ink)]">{member.name}</p>
                    <p className="no-urdu text-[11px] text-[var(--color-dim)]">{member.employee_code || '-'}</p>
                  </td>
                  <td>{member.designation || t(`roles.${member.staff_type === 'teacher' ? 'teacher' : 'office'}`)}</td>
                  <td>
                    <StatusButtons
                      value={marks[member.id]?.status || ''}
                      disabled={!data?.editable}
                      onChange={(status) => setMarks((prev) => ({ ...prev, [member.id]: { ...prev[member.id], status } }))}
                      statuses={['present', 'absent', 'leave', 'late', 'half_day']}
                    />
                  </td>
                  <td>
                    <Input
                      type="time"
                      value={marks[member.id]?.checkIn || ''}
                      disabled={!data?.editable}
                      onChange={(e) => setMarks((prev) => ({ ...prev, [member.id]: { ...prev[member.id], checkIn: e.target.value } }))}
                    />
                  </td>
                  <td>
                    <Input
                      type="time"
                      value={marks[member.id]?.checkOut || ''}
                      disabled={!data?.editable}
                      onChange={(e) => setMarks((prev) => ({ ...prev, [member.id]: { ...prev[member.id], checkOut: e.target.value } }))}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function MonthlyTab({ month, setMonth }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.staffAttendance
      .summary({ month })
      .then((rows) => active && setData(rows))
      .catch(() => active && setData(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [month]);

  return (
    <Panel padded={false}>
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-line)] p-4">
        <div className="w-[180px]">
          <Input label={t('settings.session')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </div>
      <DataTable
        rows={data?.rows || []}
        loading={loading}
        total={data?.rows?.length || 0}
        rowKey={(row) => row.id}
        emptyTitle={t('common.noData')}
        columns={[
          { key: 'name', header: t('staff.name') },
          { key: 'designation', header: t('staff.designation') },
          { key: 'present', header: t('attendance.present'), align: 'center', className: 'no-urdu' },
          { key: 'absent', header: t('attendance.absent'), align: 'center', className: 'no-urdu' },
          { key: 'late', header: t('attendance.late'), align: 'center', className: 'no-urdu' },
          { key: 'leave', header: t('attendance.leave'), align: 'center', className: 'no-urdu' },
          { key: 'half_day', header: t('attendance.half_day'), align: 'center', className: 'no-urdu' },
          {
            key: 'percentage',
            header: t('attendance.percentage'),
            render: (row) => (
              <div className="flex items-center gap-2">
                <ProgressBar value={row.percentage} className="w-20" tone={row.percentage < 80 ? 'warn' : 'ok'} />
                <span className="no-urdu w-12 text-[12px]">{row.percentage}%</span>
              </div>
            ),
          },
        ]}
      />
    </Panel>
  );
}

function LeavesTab({ toast }) {
  const { t } = useTranslation();
  const [view, setView] = useState('requests');
  const [rows, setRows] = useState([]);
  const [types, setTypes] = useState([]);
  const [staff, setStaff] = useState([]);
  const [balances, setBalances] = useState([]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({ staffId: '', leaveTypeId: '', fromDate: '', toDate: '', reason: '' });
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [leaves, leaveTypes, people, balanceRows] = await Promise.all([
        api.leaves.list({}),
        api.leaves.types(),
        api.staff.list({ pageSize: 200 }),
        api.leaves.balanceList({ year: Number(year) }),
      ]);
      setRows(leaves);
      setTypes(leaveTypes);
      setStaff(people?.rows || []);
      setBalances(balanceRows || []);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [year, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (row, status) => {
    setBusy(true);
    try {
      await api.leaves.decide({ id: row.id, status });
      toast.success(t('staffAttendance.leaveUpdated'));
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setFormErrors({});
    try {
      await api.leaves.apply({
        staffId: Number(form.staffId),
        leaveTypeId: Number(form.leaveTypeId),
        fromDate: form.fromDate,
        toDate: form.toDate,
        reason: form.reason || undefined,
      });
      toast.success(t('leave.applied'));
      setApplyOpen(false);
      load();
    } catch (err) {
      if (err.fields) {
        setFormErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, t(`validation.${v}`)])));
      } else {
        toast.error(t(errorKey(err)));
      }
    } finally {
      setSaving(false);
    }
  };

  const setQuota = async (person, balance, totalDays) => {
    setBusy(true);
    try {
      await api.leaves.setBalance({
        staffId: person.staffId,
        leaveTypeId: balance.leaveTypeId,
        year: Number(year),
        totalDays: Number(totalDays),
      });
      toast.success(t('common.saved'));
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const staffOptions = staff.map((s) => ({ value: String(s.id), label: s.name }));
  const typeOptions = types.map((type) => ({ value: String(type.id), label: type.name }));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setView('requests')}
          className={clsx('btn btn-sm', view === 'requests' && 'btn-primary')}
        >
          {t('staffAttendance.leaveDesk')}
        </button>
        <button
          type="button"
          onClick={() => setView('balances')}
          className={clsx('btn btn-sm', view === 'balances' && 'btn-primary')}
        >
          {t('leave.balance')}
        </button>
        <Button size="sm" variant="primary" icon={Plus} onClick={() => setApplyOpen(true)}>
          {t('leave.apply')}
        </Button>
      </div>

      {view === 'requests' && (
        <Panel padded={false}>
          <PanelHeader
            title={t('staffAttendance.leaveDesk')}
            subtitle={t('staffAttendance.leaveHint')}
            className="px-4 pt-4"
          />
          <DataTable
            rows={rows}
            loading={loading}
            total={rows.length}
            rowKey={(row) => row.id}
            emptyTitle={t('common.noData')}
            columns={[
              { key: 'staff_name', header: t('staff.name') },
              { key: 'type_name', header: t('staffAttendance.leaveType'), render: (r) => r.type_name || r.leave_type || '-' },
              { key: 'from_date', header: t('classes.startDate'), className: 'no-urdu' },
              { key: 'to_date', header: t('classes.endDate'), className: 'no-urdu' },
              { key: 'days', header: t('staffAttendance.days'), align: 'center', className: 'no-urdu' },
              { key: 'reason', header: t('staffAttendance.reason'), render: (r) => r.reason || '-' },
              { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
              {
                key: 'actions',
                header: t('common.actions'),
                align: 'end',
                render: (row) =>
                  row.status === 'pending' ? (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => decide(row, 'approved')}>
                        {t('common.confirm')}
                      </Button>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => decide(row, 'rejected')}>
                        {t('common.delete')}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[11.5px] text-[var(--color-dim)]">{row.decided_at?.slice(0, 10) || ''}</span>
                  ),
              },
            ]}
          />
        </Panel>
      )}

      {view === 'balances' && (
        <Panel padded={false}>
          <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-line)] p-4">
            <div className="w-[160px]">
              <Input label={t('leave.year')} type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
            <Badge tone="neutral">{t('leave.balanceHint')}</Badge>
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('staff.name')}</th>
                  {types.map((type) => (
                    <th key={type.id} className="text-center">
                      {type.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={types.length + 1} className="py-12 text-center text-[12px] text-[var(--color-dim)]">
                      {t('common.loading')}
                    </td>
                  </tr>
                )}
                {!loading &&
                  balances.map((person) => (
                    <tr key={person.staffId}>
                      <td className="font-medium text-[var(--color-ink)]">{person.staffName}</td>
                      {types.map((type) => {
                        const balance = person.balances.find((b) => b.leaveTypeId === type.id);
                        return (
                          <td key={type.id} className="text-center">
                            {balance ? (
                              <div className="flex items-center justify-center gap-2">
                                <span className="no-urdu text-[12px] text-[var(--color-dim)]">
                                  {balance.used}/{balance.total}
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  className="input w-20 text-center"
                                  defaultValue={balance.total}
                                  disabled={busy}
                                  onBlur={(e) => {
                                    const next = Number(e.target.value);
                                    if (Number.isFinite(next) && next !== balance.total) {
                                      setQuota(person, balance, next);
                                    }
                                  }}
                                />
                              </div>
                            ) : (
                              <span className="text-[12px] text-[var(--color-dim)]">-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                {!loading && balances.length === 0 && (
                  <tr>
                    <td colSpan={types.length + 1} className="py-12 text-center text-[12px] text-[var(--color-dim)]">
                      {t('common.noData')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Modal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        title={t('leave.apply')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setApplyOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={submit}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <FormGrid columns={1}>
          <Select
            label={t('staff.name')}
            value={form.staffId}
            options={staffOptions}
            placeholder={t('leave.selectStaff')}
            error={formErrors.staffId}
            onChange={(e) => setForm({ ...form, staffId: e.target.value })}
            required
          />
          <Select
            label={t('staffAttendance.leaveType')}
            value={form.leaveTypeId}
            options={typeOptions}
            placeholder={t('leave.selectType')}
            error={formErrors.leaveTypeId}
            onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
            required
          />
          <FormGrid columns={2}>
            <Input
              label={t('common.from')}
              type="date"
              value={form.fromDate}
              error={formErrors.fromDate}
              onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
              required
            />
            <Input
              label={t('common.to')}
              type="date"
              value={form.toDate}
              min={form.fromDate}
              error={formErrors.toDate}
              onChange={(e) => setForm({ ...form, toDate: e.target.value })}
              required
            />
          </FormGrid>
          <Input
            label={t('staffAttendance.reason')}
            value={form.reason}
            error={formErrors.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </FormGrid>
      </Modal>
    </>
  );
}

export default StaffAttendancePage;