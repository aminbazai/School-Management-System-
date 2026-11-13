import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Umbrella, Plus } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, PanelHeader, ProgressBar, StatCard } from '../../components/ui/Panel';
import { Button } from '../../components/ui/Button';
import { Input, Select, FormGrid } from '../../components/ui/Form';
import { StatusBadge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Teacher > My Leave: the staff member's own leave desk.
 *
 * The main process resolves the person from users.linked_id, so there is no id
 * in the renderer that could be tampered with. A teacher may apply for leave,
 * see the balance of every leave type and withdraw a pending application.
 */
export function MyLeavePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [balances, setBalances] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applyOpen, setApplyOpen] = useState(false);
  const [form, setForm] = useState({ leaveTypeId: '', fromDate: '', toDate: '', reason: '' });
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [leaves, balanceRows, leaveTypes] = await Promise.all([
        api.leaves.list({}),
        api.leaves.balances({ year: new Date().getFullYear() }),
        api.leaves.types(),
      ]);
      setRows(leaves || []);
      setBalances(balanceRows || []);
      setTypes(leaveTypes || []);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const used = balances.reduce((sum, b) => sum + (b.used || 0), 0);
    const total = balances.reduce((sum, b) => sum + (b.total || 0), 0);
    const pending = rows.filter((r) => r.status === 'pending').length;
    return { used, total, pending, remaining: Math.max(0, total - used) };
  }, [balances, rows]);

  const typeOptions = useMemo(
    () => types.map((type) => ({ value: String(type.id), label: type.name })),
    [types],
  );

  const openApply = () => {
    setForm({ leaveTypeId: '', fromDate: '', toDate: '', reason: '' });
    setFormErrors({});
    setApplyOpen(true);
  };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setFormErrors({});
    try {
      await api.leaves.apply({
        staffId: user?.linkedId,
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

  const withdraw = async (row) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.leaves.decide({ id: row.id, status: 'cancelled' });
      toast.success(t('leave.cancelled'));
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('leave.title')}
        subtitle={t('leave.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} onClick={openApply}>
            {t('leave.apply')}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('leave.total')}
          value={loading ? <Skeleton /> : totals.total}
          icon={Umbrella}
          hint={t('leave.totalHint')}
        />
        <StatCard label={t('leave.used')} value={loading ? <Skeleton /> : totals.used} />
        <StatCard label={t('leave.remaining')} value={loading ? <Skeleton /> : totals.remaining} />
        <StatCard label={t('leave.pending')} value={loading ? <Skeleton /> : totals.pending} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel padded={false}>
          <PanelHeader
            title={t('leave.myApplications')}
            subtitle={t('leave.myApplicationsHint')}
            className="px-4 pt-4"
          />
          <div className="max-h-[52vh] overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('staffAttendance.leaveType')}</th>
                  <th>{t('common.from')}</th>
                  <th>{t('common.to')}</th>
                  <th>{t('staffAttendance.days')}</th>
                  <th>{t('staffAttendance.reason')}</th>
                  <th>{t('common.status')}</th>
                  <th className="text-end">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-[12px] text-[var(--color-dim)]">
                      {t('common.loading')}
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.type_name || row.leave_type || '-'}</td>
                      <td className="no-urdu">{row.from_date}</td>
                      <td className="no-urdu">{row.to_date}</td>
                      <td className="no-urdu text-center">{row.days}</td>
                      <td className="truncate">{row.reason || '-'}</td>
                      <td>
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="text-end">
                        {row.status === 'pending' ? (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => withdraw(row)}>
                            {t('leave.withdraw')}
                          </Button>
                        ) : (
                          <span className="text-[11.5px] text-[var(--color-dim)]">
                            {row.decided_at?.slice(0, 10) || ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-[12px] text-[var(--color-dim)]">
                      {t('leave.noApplications')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={t('leave.balance')} subtitle={t('leave.balanceHint')} />
          <div className="flex flex-col gap-4">
            {balances.map((balance) => {
              const pct = balance.total > 0 ? (balance.used / balance.total) * 100 : 0;
              return (
                <div key={balance.leaveTypeId}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="text-[var(--color-muted)]">{balance.name}</span>
                    <span className="no-urdu text-[var(--color-dim)]">
                      {balance.used} / {balance.total}
                    </span>
                  </div>
                  <ProgressBar value={pct} tone={pct >= 100 ? 'danger' : pct >= 75 ? 'warn' : 'ok'} />
                  <p className="mt-1 text-[11px] text-[var(--color-dim)]">
                    {t('leave.remaining')}: <span className="no-urdu">{balance.remaining}</span>
                  </p>
                </div>
              );
            })}
            {!loading && balances.length === 0 && (
              <p className="text-[12px] text-[var(--color-dim)]">{t('leave.noBalance')}</p>
            )}
          </div>
        </Panel>
      </div>

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
              min={today()}
              error={formErrors.fromDate}
              onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
              required
            />
            <Input
              label={t('common.to')}
              type="date"
              value={form.toDate}
              min={form.fromDate || today()}
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

export default MyLeavePage;
