import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, UserCheck } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useStructure } from '../../hooks/useStructure';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, ProgressBar } from '../../components/ui/Panel';
import { Button } from '../../components/ui/Button';
import { Select, Input } from '../../components/ui/Form';
import { DataTable } from '../../components/ui/DataTable';
import { MarkingGrid } from '../../components/attendance/MarkingGrid';
import { useToast } from '../../components/ui/Toast';

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Student attendance - daily marking and the monthly register.
 * Teachers see only the classes assigned to them (enforced in main).
 */
export function StudentAttendancePage({ role = 'admin' }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { structure, loading: structureLoading } = useStructure();
  const isTeacher = role === 'teacher';

  const [date, setDate] = useState(today());
  const [month, setMonth] = useState(thisMonth());
  const [tab, setTab] = useState('mark');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [roster, setRoster] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [register, setRegister] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const [monthlyEdits, setMonthlyEdits] = useState({});
  const [monthlySaving, setMonthlySaving] = useState(false);

  // teachers only get the classes/sections assigned to them (scoped in main)
  const availableClasses = structure?.classes || [];

  const sections = useMemo(
    () => (structure?.sections || []).filter((s) => String(s.class_id) === String(classId)),
    [structure, classId],
  );

  const loadRoster = useCallback(async () => {
    if (!classId || !sectionId) return;
    setLoading(true);
    try {
      setRoster(await api.attendance.roster({ classId: Number(classId), sectionId: Number(sectionId), date }));
    } catch (err) {
      toast.error(t(errorKey(err)));
      setRoster(null);
    } finally {
      setLoading(false);
    }
  }, [classId, sectionId, date, t, toast]);

  const loadRegister = useCallback(async () => {
    if (!classId || !sectionId) return;
    setLoading(true);
    try {
      setRegister(await api.attendance.register({ classId: Number(classId), sectionId: Number(sectionId), month }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [classId, sectionId, month, t, toast]);

  const loadMonthly = useCallback(async () => {
    if (!classId || !sectionId) return;
    setLoading(true);
    try {
      const data = await api.attendance.monthlyGrid({ classId: Number(classId), sectionId: Number(sectionId), month });
      setMonthly(data);
      setMonthlyEdits({});
    } catch (err) {
      toast.error(t(errorKey(err)));
      setMonthly(null);
    } finally {
      setLoading(false);
    }
  }, [classId, sectionId, month, t, toast]);

  useEffect(() => {
    if (availableClasses.length && !classId) setClassId(String(availableClasses[0].id));
  }, [availableClasses, classId]);

  useEffect(() => {
    const first = sections[0];
    setSectionId(first ? String(first.id) : '');
  }, [classId, sections]);

  useEffect(() => {
    if (tab === 'mark') loadRoster();
    else if (tab === 'register') loadRegister();
    else if (tab === 'monthly') loadMonthly();
  }, [tab, loadRoster, loadRegister, loadMonthly]);

  // entries come from the grid's current state, not the last server response
  const save = async (entries) => {
    if (!roster) return;
    setSaving(true);
    try {
      const payload = entries.filter((entry) => entry.status);
      const result = await api.attendance.mark({
        classId: Number(classId),
        sectionId: Number(sectionId),
        date,
        entries: payload,
      });
      setRoster(result);
      toast.success(t('attendance.saved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  // "Mark all present" is a server action, so ask main to do it in one transaction
  const markAll = async () => {
    try {
      const result = await api.attendance.markAllPresent({
        classId: Number(classId),
        sectionId: Number(sectionId),
        date,
      });
      setRoster(result);
      toast.success(t('attendance.allPresent'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const saveMonthly = async () => {
    if (!monthly) return;
    const entries = Object.entries(monthlyEdits).map(([key, status]) => {
      const [sid, date] = key.split('|');
      return { studentId: Number(sid), date, status };
    });
    if (!entries.length) {
      toast.success(t('attendance.saved'));
      return;
    }
    setMonthlySaving(true);
    try {
      const result = await api.attendance.monthlyMark({
        classId: Number(classId),
        sectionId: Number(sectionId),
        month,
        entries,
      });
      setMonthly(result);
      setMonthlyEdits({});
      toast.success(t('attendance.saved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setMonthlySaving(false);
    }
  };

  const classOptions = availableClasses.map((c) => ({ value: String(c.id), label: c.name }));
  const sectionOptions = sections.map((s) => ({ value: String(s.id), label: `${s.name} (${s.student_count})` }));

  return (
    <>
      <PageHeader
        title={t('attendance.title')}
        subtitle={t('attendance.subtitle')}
        actions={
          <div className="flex gap-2">
            <Button
              variant={tab === 'mark' ? 'primary' : 'ghost'}
              onClick={() => setTab('mark')}
            >
              {t('attendance.daily')}
            </Button>
            <Button
              variant={tab === 'register' ? 'primary' : 'ghost'}
              onClick={() => setTab('register')}
            >
              {t('attendance.register')}
            </Button>
            <Button
              variant={tab === 'monthly' ? 'primary' : 'ghost'}
              onClick={() => setTab('monthly')}
            >
              {t('attendance.monthlyGrid', 'Monthly grid')}
            </Button>
          </div>
        }
      />

      <Panel className="mb-4" padded={false}>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="w-[190px]">
            <Select label={t('students.class')} value={classId} options={classOptions} onChange={(e) => setClassId(e.target.value)} />
          </div>
          <div className="w-[190px]">
            <Select label={t('students.section')} value={sectionId} options={sectionOptions} onChange={(e) => setSectionId(e.target.value)} />
          </div>
          {tab === 'mark' ? (
            <div className="w-[180px]">
              <Input label={t('common.date')} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
            </div>
          ) : (
            <div className="w-[180px]">
              <Input label={t('settings.session')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          )}
          </div>
      </Panel>

      {tab === 'mark' ? (
        <Panel padded={false}>
          <MarkingGrid
            students={roster?.students || []}
            summary={roster?.summary}
            disabled={!roster?.editable || loading}
            saving={saving}
            onSave={save}
            onMarkAll={markAll}
          />
          {!roster?.editable && (
            <p className="border-t border-[var(--color-line)] px-4 py-2 text-[11.5px] text-[var(--color-warn)]">
              {t('attendance.readOnly')}
            </p>
          )}
        </Panel>
      ) : tab === 'register' ? (
        <div className="grid gap-4">
          {register && register.low > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--color-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)] px-4 py-3">
              <UserCheck size={16} className="text-[var(--color-warn)]" />
              <span className="text-[12.5px] text-[var(--color-ink2)]">
                {t('attendance.belowThreshold', { count: register.low, threshold: register.threshold })}
              </span>
            </div>
          )}

          <Panel padded={false}>
            <DataTable
              rows={register?.students || []}
              loading={loading}
              total={register?.students?.length || 0}
              rowKey={(row) => row.id}
              emptyTitle={t('common.noData')}
              columns={[
                { key: 'name', header: t('common.name'), sortable: true },
                { key: 'admissionNo', header: t('students.admissionNo'), className: 'no-urdu' },
                { key: 'rollNo', header: t('students.rollNo'), align: 'center', className: 'no-urdu' },
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
                      <ProgressBar
                        value={row.percentage}
                        className="w-20"
                        tone={row.percentage < 75 ? 'danger' : row.percentage < 85 ? 'warn' : 'ok'}
                      />
                      <span className="no-urdu w-12 text-[12px]">{row.percentage}%</span>
                    </div>
                  ),
                },
              ]}
              rowClassName={(row) => (row.percentage < 75 ? 'bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]' : '')}
            />
          </Panel>
        </div>
      ) : (
        <div className="grid gap-4">
          <Panel padded={false}>
            <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
              <div className="text-[13px] font-semibold">{t('attendance.monthlyGrid', 'Monthly grid')}</div>
              <Button onClick={saveMonthly} disabled={monthlySaving || loading || !monthly}>
                {monthlySaving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
            <div className="overflow-auto">
              <table className="min-w-full text-[12px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-[var(--color-surface)] px-3 py-2 text-left">{t('common.name')}</th>
                    {(monthly?.dates || []).map((d) => (
                      <th key={d} className="px-1 py-2 text-center no-urdu">{Number(d.slice(-2))}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(monthly?.students || []).map((st) => (
                    <tr key={st.id} className="border-t border-[var(--color-line)]">
                      <td className="sticky left-0 z-10 bg-[var(--color-surface)] px-3 py-2 font-medium">{st.name}</td>
                      {(monthly?.dates || []).map((d) => {
                        const key = `${st.id}|${d}`;
                        const val = monthlyEdits[key] !== undefined ? monthlyEdits[key] : (st.days?.[d] || '');
                        return (
                          <td key={d} className="px-1 py-1 text-center">
                            <select
                              className="w-9 rounded border border-[var(--color-line)] bg-transparent px-1 py-0.5 text-[11px]"
                              value={val || ''}
                              disabled={loading}
                              onChange={(e) => setMonthlyEdits((prev) => ({ ...prev, [key]: e.target.value || null }))}
                            >
                              <option value=""></option>
                              <option value="present">P</option>
                              <option value="absent">A</option>
                              <option value="leave">L</option>
                              <option value="late">T</option>
                              <option value="half_day">H</option>
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!monthly?.students?.length && !loading && (
              <p className="px-4 py-6 text-center text-[12px] text-[var(--color-muted)]">{t('common.noData')}</p>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}

export default StudentAttendancePage;