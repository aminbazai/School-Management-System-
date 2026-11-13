import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wallet,
  Plus,
  Trash2,
  Calculator,
  CheckCircle2,
  Printer,
  FileText,
  HandCoins,
} from 'lucide-react';
import clsx from 'clsx';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, PanelHeader } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { Input, Select, FormGrid } from '../../components/ui/Form';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils/format';

const currentMonth = () => new Date().toISOString().slice(0, 7);

const TABS = [
  { key: 'payroll', labelKey: 'salary.payroll', icon: Wallet },
  { key: 'structure', labelKey: 'salary.structures', icon: Calculator },
  { key: 'advances', labelKey: 'salary.advances', icon: HandCoins },
];

const ALLOWANCE_KINDS = ['house', 'medical', 'transport', 'fuel', 'special', 'custom'];
const DEDUCTION_KINDS = ['absent', 'late', 'tax', 'pf', 'insurance', 'custom'];

/** Salary management: payroll run, per-staff structures and advances. */
export function SalaryPage({ role = 'admin' }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings } = useAuth();
  const isAdmin = role === 'admin';

  const [tab, setTab] = useState('payroll');
  const [month, setMonth] = useState(currentMonth());
  const [staff, setStaff] = useState([]);

  useEffect(() => {
    api.staff
      .list({ pageSize: 500, status: 'active' })
      .then((data) => setStaff(data.rows))
      .catch(() => setStaff([]));
  }, []);

  const symbol = settings?.currency_symbol || 'Rs';

  return (
    <>
      <PageHeader
        title={t('salary.title')}
        subtitle={t('salary.subtitle')}
        actions={<Badge tone="accent">{month}</Badge>}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={clsx('btn btn-sm', tab === item.key && 'btn-primary')}
          >
            <item.icon size={14} />
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'payroll' && <PayrollTab month={month} setMonth={setMonth} staff={staff} isAdmin={isAdmin} symbol={symbol} />}
      {tab === 'structure' && <StructureTab staff={staff} isAdmin={isAdmin} symbol={symbol} />}
      {tab === 'advances' && <AdvancesTab staff={staff} isAdmin={isAdmin} symbol={symbol} />}
    </>
  );
}

/* ------------------------------------------------------------------ payroll */

function PayrollTab({ month, setMonth, staff, isAdmin, symbol }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [slip, setSlip] = useState(null);
  const [payTarget, setPayTarget] = useState(null);
  const [payForm, setPayForm] = useState({ paymentMethod: 'cash', reference: '' });
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.salary.list({ month }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [month, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const runPreview = async () => {
    setBusy(true);
    try {
      setPreview(await api.salary.preview({ month }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    try {
      const result = await api.salary.generate({ month });
      toast.success(t('salary.generated', { count: result.length }));
      setPreview(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async () => {
    if (!payTarget) return;
    setBusy(true);
    try {
      await api.salary.markPaid({ id: payTarget.id, ...payForm });
      toast.success(t('salary.markedPaid'));
      setPayTarget(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const openSlip = async (row) => {
    try {
      setSlip(await api.salary.detail(row.id));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const printSlip = async (row) => {
    try {
      const result = await api.salary.slipPrint(row.id);
      if (result && result.opened) toast.info(t('salary.printOpened'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          gross: acc.gross + row.gross,
          deductions: acc.deductions + row.deductionsTotal,
          net: acc.net + row.net,
        }),
        { gross: 0, deductions: 0, net: 0 },
      ),
    [rows],
  );

  return (
    <>
      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[180px]">
            <Input label={t('salary.month')} type="month" value={month} max={currentMonth()} onChange={(e) => setMonth(e.target.value)} />
          </div>
          {isAdmin && (
            <Button icon={Calculator} onClick={runPreview} loading={busy}>
              {t('salary.preview')}
            </Button>
          )}
          <div className="ms-auto flex flex-wrap gap-4 text-[12px]">
            <span className="text-[var(--color-muted)]">
              {t('salary.gross')}: <b className="no-urdu text-[var(--color-ink)]">{formatCurrency(totals.gross, symbol)}</b>
            </span>
            <span className="text-[var(--color-muted)]">
              {t('salary.deductions')}: <b className="no-urdu text-[var(--color-ink)]">{formatCurrency(totals.deductions, symbol)}</b>
            </span>
            <span className="text-[var(--color-muted)]">
              {t('salary.net')}: <b className="no-urdu text-[var(--accent)]">{formatCurrency(totals.net, symbol)}</b>
            </span>
          </div>
        </div>
      </Panel>

      <Panel padded={false}>
        <DataTable
          rows={rows}
          loading={loading}
          total={rows.length}
          emptyIcon={Wallet}
          emptyTitle={t('salary.noPayroll')}
          emptyHint={t('salary.noPayrollHint')}
          columns={[
            { key: 'staffName', header: t('staff.name') },
            { key: 'designation', header: t('staff.designation') },
            { key: 'basic', header: t('salary.basic'), align: 'end', className: 'no-urdu', render: (r) => formatCurrency(r.basic, symbol) },
            {
              key: 'allowancesTotal',
              header: t('salary.allowances'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.allowancesTotal, symbol),
            },
            {
              key: 'deductionsTotal',
              header: t('salary.deductions'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.deductionsTotal + r.advanceRecovery, symbol),
            },
            {
              key: 'net',
              header: t('salary.net'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => <span className="font-semibold text-[var(--color-ink)]">{formatCurrency(r.net, symbol)}</span>,
            },
            {
              key: 'attendance',
              header: t('salary.attendanceDays'),
              align: 'center',
              className: 'no-urdu',
              render: (r) => `${r.presentDays}P / ${r.absentDays}A`,
            },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions',
              header: t('common.actions'),
              align: 'end',
              render: (row) => (
                <div className="flex items-center justify-end gap-1">
                  <IconButton icon={FileText} label={t('salary.viewSlip')} onClick={() => openSlip(row)} />
                  <IconButton icon={Printer} label={t('common.print')} onClick={() => printSlip(row)} />
                  {isAdmin && row.status !== 'paid' && (
                    <>
                      <IconButton
                        icon={CheckCircle2}
                        label={t('salary.markPaid')}
                        onClick={() => {
                          setPayTarget(row);
                          setPayForm({ paymentMethod: 'cash', reference: '' });
                        }}
                      />
                      <IconButton icon={Trash2} label={t('common.delete')} onClick={() => setDeleteTarget(row)} />
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Panel>

      {/* preview */}
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={t('salary.previewTitle')}
        subtitle={preview ? t('salary.previewSubtitle', { month }) : ''}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" icon={CheckCircle2} loading={busy} onClick={generate}>
              {t('salary.generate')}
            </Button>
          </>
        }
      >
        {preview && (
          <div className="flex flex-col gap-4">
            {preview.skipped > 0 && (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)] p-3 text-[12.5px]">
                {t('salary.alreadyGenerated', { count: preview.skipped })}
              </div>
            )}
            <DataTable
              rows={preview.rows}
              total={preview.rows.length}
              columns={[
                { key: 'staff.name', header: t('staff.name'), render: (r) => r.staff.name },
                { key: 'basic', header: t('salary.basic'), align: 'end', className: 'no-urdu', render: (r) => formatCurrency(r.basic, symbol) },
                { key: 'a', header: t('salary.allowances'), align: 'end', className: 'no-urdu', render: (r) => formatCurrency(r.allowancesTotal, symbol) },
                { key: 'd', header: t('salary.deductions'), align: 'end', className: 'no-urdu', render: (r) => formatCurrency(r.deductionsTotal, symbol) },
                { key: 'r', header: t('salary.advance'), align: 'end', className: 'no-urdu', render: (r) => formatCurrency(r.advanceRecovery, symbol) },
                {
                  key: 'n',
                  header: t('salary.net'),
                  align: 'end',
                  className: 'no-urdu',
                  render: (r) => <span className="font-semibold text-[var(--color-ink)]">{formatCurrency(r.net, symbol)}</span>,
                },
              ]}
            />
            <div className="flex justify-end gap-4 text-[12.5px]">
              <span className="text-[var(--color-muted)]">
                {t('common.total')} {t('salary.net')}:{' '}
                <b className="no-urdu text-[var(--accent)]">{formatCurrency(preview.totals.net, symbol)}</b>
              </span>
            </div>
          </div>
        )}
      </Modal>

      {/* slip */}
      <Modal
        open={!!slip}
        onClose={() => setSlip(null)}
        title={t('salary.slip')}
        subtitle={slip ? `${slip.staffName} - ${slip.month}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSlip(null)}>
              {t('common.close')}
            </Button>
            <Button
              variant="primary"
              icon={Printer}
              onClick={async () => {
                try {
                  await api.salary.slipPrint(slip.id);
                } catch (err) {
                  toast.error(t(errorKey(err)));
                }
              }}
            >
              {t('common.print')}
            </Button>
          </>
        }
      >
        {slip && (
          <div className="flex flex-col gap-4">
            <FormGrid columns={3}>
              <Info label={t('staff.name')} value={slip.staffName} />
              <Info label={t('staff.designation')} value={slip.designation || '-'} />
              <Info label={t('salary.attendanceDays')} value={`${slip.presentDays} / ${slip.absentDays}`} mono />
            </FormGrid>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="eyebrow mb-2">{t('salary.earnings')}</p>
                <ul className="flex flex-col gap-1.5">
                  {slip.items
                    .filter((i) => i.kind === 'earning')
                    .map((item, index) => (
                      <SlipRow key={index} label={item.name} value={formatCurrency(item.amount, symbol)} />
                    ))}
                  <SlipRow label={t('salary.gross')} value={formatCurrency(slip.gross, symbol)} strong />
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-2">{t('salary.deductions')}</p>
                <ul className="flex flex-col gap-1.5">
                  {slip.items.filter((i) => i.kind === 'deduction').length === 0 && (
                    <li className="text-[12.5px] text-[var(--color-dim)]">{t('common.noData')}</li>
                  )}
                  {slip.items
                    .filter((i) => i.kind === 'deduction')
                    .map((item, index) => (
                      <SlipRow key={index} label={item.name} value={formatCurrency(item.amount, symbol)} />
                    ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-4 py-3">
              <span className="text-[13px] font-medium">{t('salary.netPayable')}</span>
              <span className="no-urdu text-[17px] font-semibold text-[var(--color-accent)]">
                {formatCurrency(slip.net, symbol)}
              </span>
            </div>
          </div>
        )}
      </Modal>

      {/* mark paid */}
      <Modal
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title={t('salary.markPaid')}
        subtitle={payTarget ? `${payTarget.staffName} · ${formatCurrency(payTarget.net, symbol)}` : ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={markPaid}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <FormGrid columns={1}>
          <Select
            label={t('salary.paymentMethod')}
            value={payForm.paymentMethod}
            options={[
              { value: 'cash', label: t('salary.cash') },
              { value: 'bank', label: t('salary.bank') },
            ]}
            onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })}
          />
          <Input
            label={t('salary.reference')}
            value={payForm.reference}
            onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
          />
        </FormGrid>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.salary.remove(deleteTarget.id);
            toast.success(t('common.deleted', { item: t('nav.admin.salary') }));
            setDeleteTarget(null);
            load();
          } catch (err) {
            toast.error(t(errorKey(err)));
          } finally {
            setBusy(false);
          }
        }}
        loading={busy}
        title={t('common.deleteConfirmTitle', { item: t('nav.admin.salary') })}
        message={t('salary.deleteWarning')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

function Info({ label, value, mono }) {
  return (
    <div>
      <p className="text-[11.5px] text-[var(--color-dim)]">{label}</p>
      <p className={`mt-0.5 text-[13px] text-[var(--color-ink2)] ${mono ? 'no-urdu' : ''}`}>{value}</p>
    </div>
  );
}

function SlipRow({ label, value, strong }) {
  return (
    <li className="flex items-center justify-between border-b border-dashed border-[var(--color-line)] pb-1.5 text-[12.5px]">
      <span className={strong ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-muted)]'}>{label}</span>
      <span className={`no-urdu ${strong ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-ink2)]'}`}>{value}</span>
    </li>
  );
}

/* --------------------------------------------------------------- structure */

function StructureTab({ staff, isAdmin, symbol }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [staffId, setStaffId] = useState('');
  const [structure, setStructure] = useState(null);
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!staffId && staff.length) setStaffId(String(staff[0].id));
  }, [staff, staffId]);

  const load = useCallback(async () => {
    if (!staffId) return;
    setLoading(true);
    try {
      setStructure(await api.salary.structure({ staffId: Number(staffId) }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [staffId, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const saveItem = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const payload = {
        staffId: Number(staffId),
        name: item.name,
        kind: item.kind,
        amount: Number(item.amount) || 0,
        isPercent: item.isPercent,
      };
      const next = item.type === 'allowance'
        ? await api.salary.saveAllowance(payload)
        : await api.salary.saveDeduction(payload);
      setStructure(next);
      setItem(null);
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (type, id) => {
    try {
      const next = type === 'allowance'
        ? await api.salary.deleteAllowance(id)
        : await api.salary.deleteDeduction(id);
      setStructure(next);
      toast.success(t('common.deleted', { item: t(type === 'allowance' ? 'salary.allowance' : 'salary.deduction') }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const saveBasic = async (value) => {
    setBusy(true);
    try {
      setStructure(await api.salary.saveBasic({ staffId: Number(staffId), basicSalary: Number(value) || 0 }));
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <Panel>
        <PanelHeader title={t('staff.name')} />
        <Select
          value={staffId}
          options={staff.map((s) => ({ value: String(s.id), label: s.name }))}
          onChange={(e) => setStaffId(e.target.value)}
        />
        {structure && (
          <div className="mt-4 flex flex-col gap-3">
            <Input
              label={t('salary.basic')}
              type="number"
              defaultValue={structure.staff.basicSalary}
              onBlur={(e) => {
                if (Number(e.target.value) !== Number(structure.staff.basicSalary) && isAdmin) saveBasic(e.target.value);
              }}
            />
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--glass)] p-3 text-[12px]">
              <p className="text-[var(--color-dim)]">{t('salary.designation')}</p>
              <p className="text-[var(--color-ink2)]">{structure.staff.designation || '-'}</p>
              <p className="mt-2 text-[var(--color-dim)]">{t('staff.joiningDate')}</p>
              <p className="no-urdu text-[var(--color-ink2)]">{structure.staff.joiningDate || '-'}</p>
            </div>
          </div>
        )}
      </Panel>

      <div className="grid gap-4">
        {[
          { type: 'allowance', title: t('salary.allowances'), kinds: ALLOWANCE_KINDS, rows: structure?.allowances || [], isPercentOf: t('salary.percentOfBasic') },
          { type: 'deduction', title: t('salary.deductions'), kinds: DEDUCTION_KINDS, rows: structure?.deductions || [], isPercentOf: t('salary.percentOfBasic') },
        ].map((group) => (
          <Panel key={group.type} padded={false}>
            <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] p-4">
              <div>
                <h3 className="panel-title">{group.title}</h3>
                <p className="mt-0.5 text-[11.5px] text-[var(--color-dim)]">
                  {group.type === 'allowance' ? t('salary.allowanceHint') : t('salary.deductionHint')}
                </p>
              </div>
              {isAdmin && (
                <Button
                  size="sm"
                  icon={Plus}
                  onClick={() => setItem({ type: group.type, name: '', kind: group.kinds[0], amount: 0, isPercent: false })}
                >
                  {t('common.add')}
                </Button>
              )}
            </div>
            <ul className="divide-y divide-[var(--color-line)]">
              {group.rows.length === 0 && (
                <li className="px-4 py-8 text-center text-[12.5px] text-[var(--color-dim)]">{t('common.noData')}</li>
              )}
              {group.rows.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-[var(--color-ink)]">{row.name}</p>
                    <p className="text-[11px] capitalize text-[var(--color-dim)]">{row.kind}</p>
                  </div>
                  <span className="no-urdu text-[13px] text-[var(--color-ink2)]">
                    {row.is_percent ? `${row.amount}%` : formatCurrency(row.amount, symbol)}
                  </span>
                  {isAdmin && <IconButton icon={Trash2} label={t('common.delete')} onClick={() => removeItem(group.type, row.id)} />}
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      <Modal
        open={!!item}
        onClose={() => setItem(null)}
        title={item ? t(item.type === 'allowance' ? 'salary.addAllowance' : 'salary.addDeduction') : ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setItem(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={saveItem}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {item && (
          <FormGrid columns={1}>
            <Input
              label={t('common.name')}
              value={item.name}
              onChange={(e) => setItem({ ...item, name: e.target.value })}
              required
            />
            <Select
              label={t('salary.kind')}
              value={item.kind}
              options={item.type === 'allowance'
                ? ALLOWANCE_KINDS.map((k) => ({ value: k, label: t(`allowance.${k}`) }))
                : DEDUCTION_KINDS.map((k) => ({ value: k, label: t(`deduction.${k}`) }))}
              onChange={(e) => setItem({ ...item, kind: e.target.value })}
            />
            <Input
              label={item.isPercent ? t('salary.percent') : t('salary.amount')}
              type="number"
              value={item.amount}
              onChange={(e) => setItem({ ...item, amount: e.target.value })}
            />
            <label className="flex items-center gap-2.5 text-[12.5px] text-[var(--color-ink2)]">
              <input
                type="checkbox"
                checked={item.isPercent}
                onChange={(e) => setItem({ ...item, isPercent: e.target.checked })}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              {t('salary.isPercent')}
            </label>
          </FormGrid>
        )}
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------- advances */

function AdvancesTab({ staff, isAdmin, symbol }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [staffId, setStaffId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: '', advanceDate: new Date().toISOString().slice(0, 10), installments: 1, notes: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!staffId && staff.length) setStaffId(String(staff[0].id));
  }, [staff, staffId]);

  const load = useCallback(async () => {
    if (!staffId) return;
    setLoading(true);
    try {
      const data = await api.salary.structure({ staffId: Number(staffId) });
      setRows(data.advances);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [staffId, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    try {
      await api.salary.addAdvance({ staffId: Number(staffId), ...form, amount: Number(form.amount) || 0, installments: Number(form.installments) || 1 });
      toast.success(t('salary.advanceAdded'));
      setOpen(false);
      setForm({ amount: '', advanceDate: new Date().toISOString().slice(0, 10), installments: 1, notes: '' });
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id) => {
    try {
      await api.salary.cancelAdvance(id);
      toast.success(t('common.saved'));
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  return (
    <>
      <Panel padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-line)] p-4">
          <div className="w-[240px]">
            <Select
              label={t('staff.name')}
              value={staffId}
              options={staff.map((s) => ({ value: String(s.id), label: s.name }))}
              onChange={(e) => setStaffId(e.target.value)}
            />
          </div>
          <Button icon={Plus} onClick={() => setOpen(true)}>
            {t('salary.addAdvance')}
          </Button>
        </div>
        <DataTable
          rows={rows}
          loading={loading}
          total={rows.length}
          emptyIcon={HandCoins}
          emptyTitle={t('salary.noAdvances')}
          columns={[
            { key: 'amount', header: t('salary.amount'), align: 'end', className: 'no-urdu', render: (r) => formatCurrency(r.amount, symbol) },
            { key: 'installments', header: t('salary.installments'), align: 'center', className: 'no-urdu' },
            {
              key: 'installment_amount',
              header: t('salary.perInstallment'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.installment_amount, symbol),
            },
            {
              key: 'recovered',
              header: t('salary.recovered'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.recovered, symbol),
            },
            { key: 'advance_date', header: t('common.date'), className: 'no-urdu' },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions',
              header: t('common.actions'),
              align: 'end',
              render: (row) =>
                isAdmin && row.status === 'active' ? (
                  <IconButton icon={Trash2} label={t('salary.cancelAdvance')} onClick={() => cancel(row.id)} />
                ) : null,
            },
          ]}
        />
      </Panel>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('salary.addAdvance')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={add}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <FormGrid columns={1}>
          <Input
            label={t('salary.amount')}
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
          <Input
            label={t('common.date')}
            type="date"
            value={form.advanceDate}
            onChange={(e) => setForm({ ...form, advanceDate: e.target.value })}
          />
          <Input
            label={t('salary.installments')}
            type="number"
            min={1}
            value={form.installments}
            onChange={(e) => setForm({ ...form, installments: e.target.value })}
            hint={Number(form.installments) > 0 && Number(form.amount) > 0
              ? t('salary.installmentHint', { amount: formatCurrency(Number(form.amount) / Number(form.installments), symbol) })
              : undefined}
          />
          <Input label={t('common.name')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormGrid>
      </Modal>
    </>
  );
}

export default SalaryPage;