import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wallet,
  Plus,
  Trash2,
  Calculator,
  Printer,
  FileText,
  Receipt,
  UserX,
  HandCoins,
  AlertTriangle,
  Pencil,
  Mail,
  MessageCircle,
  Smartphone,
} from 'lucide-react';
import clsx from 'clsx';
import api, { errorKey } from '../../lib/api';
import { FEE_TYPES } from '../../lib/constants';
import { useAuth } from '../../store/AuthProvider';
import { useStructure } from '../../hooks/useStructure';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, StatCard } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable, TableSearch } from '../../components/ui/DataTable';
import { Input, Select, FormGrid } from '../../components/ui/Form';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency, formatDate, formatMonth } from '../../utils/format';
import { cleanTemplate, mailtoUrl, monthLabel, renderTemplate, smsUrl, whatsappUrl } from '../../lib/messaging';
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

const FREQUENCIES = ['one_time', 'monthly', 'quarterly', 'yearly'];
const METHODS = ['cash', 'bank', 'online', 'cheque'];

const TABS = [
  { key: 'collection', labelKey: 'fees.collection', icon: Wallet },
  { key: 'structures', labelKey: 'fees.structures', icon: Calculator },
  { key: 'concessions', labelKey: 'fees.concessions', icon: HandCoins },
  { key: 'defaulters', labelKey: 'fees.defaulters', icon: UserX },
  { key: 'report', labelKey: 'fees.report', icon: Receipt },
];

/** Fee management: vouchers and collection, fee heads, concessions and reports. */
export function FeePage({ role = 'office' }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings } = useAuth();
  const [tab, setTab] = useState('collection');

  const isAdmin = role === 'admin';
  const symbol = settings?.currency_symbol || 'Rs';

  return (
    <>
      <PageHeader title={t('fees.title')} subtitle={t('fees.subtitle')} />

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

      {tab === 'collection' && <CollectionTab isAdmin={isAdmin} symbol={symbol} />}
      {tab === 'structures' && <StructuresTab isAdmin={isAdmin} symbol={symbol} />}
      {tab === 'concessions' && <ConcessionsTab isAdmin={isAdmin} symbol={symbol} />}
      {tab === 'defaulters' && <DefaultersTab symbol={symbol} />}
      {tab === 'report' && <ReportTab symbol={symbol} />}
    </>
  );
}

/** Month dropdown: the last 12 months plus "all months". */
function useMonthOptions() {
  const { t } = useTranslation();
  return useMemo(() => {
    const now = new Date();
    const list = [];
    for (let i = 0; i < 12; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      list.push({ value, label: formatMonth(value) });
    }
    return [{ value: '', label: t('fees.allMonths') }, ...list];
  }, [t]);
}

/* --------------------------------------------------------------- collection */

function CollectionTab({ isAdmin, symbol }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { structure } = useStructure();
  const monthOptions = useMonthOptions();

  const [month, setMonth] = useState(currentMonth());
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], summary: null, total: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [detail, setDetail] = useState(null);
  const [payTarget, setPayTarget] = useState(null);
  const [payForm, setPayForm] = useState({ amount: '', paymentDate: today(), method: 'cash', reference: '', remarks: '' });
  const [preview, setPreview] = useState(null);
  const [fineOpen, setFineOpen] = useState(false);
  const [fineForm, setFineForm] = useState({ month: currentMonth(), amount: '' });
  const [deletePayment, setDeletePayment] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.fees.vouchers({
        month: month || undefined,
        classId: classId || undefined,
        status: status || undefined,
        search: search || undefined,
        page,
        pageSize: 25,
      });
      setData(result);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [month, classId, status, search, page, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [month, classId, status, search]);

  const openPay = (row) => {
    setPayTarget(row);
    setPayForm({ amount: String(row.balance), paymentDate: today(), method: 'cash', reference: '', remarks: '' });
  };

  const collect = async () => {
    if (!payTarget) return;
    setBusy(true);
    try {
      const result = await api.fees.payment({
        voucherId: payTarget.id,
        amount: Number(payForm.amount),
        paymentDate: payForm.paymentDate,
        method: payForm.method,
        reference: payForm.reference || undefined,
        remarks: payForm.remarks || undefined,
      });
      toast.success(t('fees.paymentSaved', { receipt: result.receiptNo }));
      setPayTarget(null);
      await load();
      if (detail && detail.id === payTarget.id) {
        setDetail(await api.fees.voucherDetail(payTarget.id));
      }
      setReceipt({ id: result.id, receiptNo: result.receiptNo });
      if (settings?.auto_print_receipt !== '0') {
        printReceipt(result.id);
      }
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    setBusy(true);
    try {
      setPreview(await api.fees.preview({ month }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    try {
      const result = await api.fees.generate({ month });
      toast.success(t('fees.generated', { count: result.generated }));
      setPreview(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const applyFine = async () => {
    setBusy(true);
    try {
      const result = await api.fees.lateFine({ month: fineForm.month, amount: Number(fineForm.amount) });
      toast.success(t('fees.lateFineApplied', { count: result.updated }));
      setFineOpen(false);
      setFineForm({ month: currentMonth(), amount: '' });
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const exportPdf = async () => {
    setBusy(true);
    try {
      const result = await api.fees.listPdf({ month: month || undefined });
      if (result && !result.canceled) toast.success(t('fees.pdfSaved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const printReceipt = async (id) => {
    if (!id) return;
    try {
      await api.fees.receiptPrint(id);
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const saveReceipt = async (id) => {
    if (!id) return;
    try {
      const result = await api.fees.receiptPdf(id);
      if (result && !result.canceled) toast.success(t('fees.pdfSaved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const summary = data.summary || {};
  const stats = [
    { label: t('fees.billed'), value: loading ? <Skeleton /> : formatCurrency(summary.total, symbol), icon: Receipt },
    { label: t('fees.paid'), value: loading ? <Skeleton /> : formatCurrency(summary.paid, symbol), icon: Wallet },
    { label: t('fees.balance'), value: loading ? <Skeleton /> : formatCurrency(summary.balance, symbol), icon: AlertTriangle },
    { label: t('fees.openVouchers'), value: loading ? <Skeleton /> : (summary.unpaid || 0) + (summary.partial || 0) },
  ];

  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} menu={false} />
        ))}
      </div>

      <Panel padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-line)] p-4">
          <div className="w-[170px]">
            <Select
              label={t('fees.month')}
              value={month}
              options={monthOptions}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div className="w-[170px]">
            <Select
              label={t('students.class')}
              value={classId}
              placeholder={t('students.allClasses')}
              options={(structure?.classes || []).map((c) => ({ value: String(c.id), label: c.name }))}
              onChange={(e) => setClassId(e.target.value)}
            />
          </div>
          <div className="w-[160px]">
            <Select
              label={t('common.status')}
              value={status}
              placeholder={t('fees.allStatuses')}
              options={[
                { value: 'unpaid', label: t('fees.statusUnpaid') },
                { value: 'partial', label: t('fees.statusPartial') },
                { value: 'paid', label: t('fees.statusPaid') },
              ]}
              onChange={(e) => setStatus(e.target.value)}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <TableSearch value={search} onChange={setSearch} placeholder={t('fees.searchPlaceholder')} />
          </div>
          <div className="flex items-center gap-2">
            <Button icon={FileText} onClick={exportPdf} loading={busy}>
              {t('fees.exportPdf')}
            </Button>
            {isAdmin && (
              <>
                <Button icon={Calculator} onClick={runPreview} loading={busy} disabled={!month}>
                  {t('fees.preview')}
                </Button>
                <Button icon={AlertTriangle} onClick={() => setFineOpen(true)} disabled={!month}>
                  {t('fees.lateFine')}
                </Button>
              </>
            )}
          </div>
        </div>

        <DataTable
          rows={data.rows}
          loading={loading}
          total={data.total}
          page={page}
          pageSize={25}
          onPageChange={setPage}
          emptyIcon={Wallet}
          emptyTitle={t('fees.noVouchers')}
          emptyHint={t('fees.noVouchersHint')}
          columns={[
            { key: 'voucherNo', header: t('fees.voucherNo'), className: 'no-urdu' },
            { key: 'studentName', header: t('common.name') },
            { key: 'admissionNo', header: t('students.admissionNo'), className: 'no-urdu' },
            {
              key: 'className',
              header: t('students.class'),
              render: (r) => `${r.className || '-'} ${r.sectionName || ''}`,
            },
            {
              key: 'totalAmount',
              header: t('fees.total'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.totalAmount, symbol),
            },
            {
              key: 'discount',
              header: t('fees.discount'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => (r.discount > 0 ? `-${formatCurrency(r.discount, symbol)}` : '-'),
            },
            {
              key: 'paidAmount',
              header: t('fees.paid'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.paidAmount, symbol),
            },
            {
              key: 'balance',
              header: t('fees.balance'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => (
                <span className={r.balance > 0 ? 'font-semibold text-[var(--color-warn)]' : 'text-[var(--color-ok)]'}>
                  {formatCurrency(r.balance, symbol)}
                </span>
              ),
            },
            { key: 'dueDate', header: t('fees.dueDate'), className: 'no-urdu' },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions',
              header: t('common.actions'),
              align: 'end',
              render: (row) => (
                <div className="flex items-center justify-end gap-1">
                  <IconButton
                    icon={FileText}
                    label={t('fees.viewVoucher')}
                    onClick={async () => {
                      try {
                        setDetail(await api.fees.voucherDetail(row.id));
                      } catch (err) {
                        toast.error(t(errorKey(err)));
                      }
                    }}
                  />
                  {row.balance > 0 && (
                    <IconButton icon={HandCoins} label={t('fees.collect')} onClick={() => openPay(row)} />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Panel>

      {/* voucher detail */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={t('fees.voucher')}
        subtitle={detail ? `${detail.voucherNo} · ${detail.studentName}` : ''}
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            {t('common.close')}
          </Button>
        }
      >
        {detail && (
          <div className="flex flex-col gap-4">
            <FormGrid columns={4}>
              <Info label={t('students.admissionNo')} value={detail.admissionNo} />
              <Info label={t('students.class')} value={`${detail.className || '-'} ${detail.sectionName || ''}`} />
              <Info label={t('fees.dueDate')} value={detail.dueDate || '-'} mono />
              <Info label={t('common.status')} value={<StatusBadge status={detail.status} />} />
            </FormGrid>

            <div>
              <p className="eyebrow mb-2">{t('fees.items')}</p>
              <ul className="flex flex-col gap-1.5">
                {detail.items.length === 0 && <li className="text-[12.5px] text-[var(--color-dim)]">{t('common.noData')}</li>}
                {detail.items.map((item) => (
                  <Line key={item.id} label={item.description} value={formatCurrency(item.amount, symbol)} />
                ))}
                {detail.discount > 0 && <Line label={t('fees.discount')} value={`-${formatCurrency(detail.discount, symbol)}`} />}
                {detail.lateFine > 0 && <Line label={t('fees.lateFine')} value={formatCurrency(detail.lateFine, symbol)} />}
                <Line label={t('fees.totalPayable')} value={formatCurrency(detail.totalAmount + detail.lateFine - detail.discount, symbol)} strong />
              </ul>
            </div>

            <div>
              <p className="eyebrow mb-2">{t('fees.payments')}</p>
              <ul className="flex flex-col gap-1.5">
                {detail.payments.length === 0 && <li className="text-[12.5px] text-[var(--color-dim)]">{t('fees.noPayments')}</li>}
                {detail.payments.map((payment) => (
                  <li key={payment.id} className="flex items-center gap-2 border-b border-dashed border-[var(--color-line)] pb-1.5 text-[12.5px]">
                    <div className="min-w-0 flex-1">
                      <p className="no-urdu text-[var(--color-ink2)]">{payment.receiptNo}</p>
                      <p className="text-[11px] text-[var(--color-dim)]">
                        {formatDate(payment.paymentDate)} · {payment.method}
                      </p>
                    </div>
                    <span className="no-urdu text-[var(--color-ink2)]">{formatCurrency(payment.amount, symbol)}</span>
                    <IconButton icon={Printer} label={t('common.print')} onClick={() => printReceipt(payment.id)} />
                    <IconButton icon={FileText} label={t('fees.downloadPdf')} onClick={() => saveReceipt(payment.id)} />
                    {isAdmin && <IconButton icon={Trash2} label={t('common.delete')} onClick={() => setDeletePayment(payment)} />}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-4 py-3">
              <span className="text-[13px] font-medium">{t('fees.balanceDue')}</span>
              <span className="no-urdu text-[17px] font-semibold text-[var(--color-accent)]">
                {formatCurrency(detail.balance, symbol)}
              </span>
            </div>
          </div>
        )}
      </Modal>

      {/* collect payment */}
      <Modal
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title={t('fees.collect')}
        subtitle={payTarget ? `${payTarget.studentName} · ${payTarget.voucherNo}` : ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={collect}>
              {t('fees.savePayment')}
            </Button>
          </>
        }
      >
        {payTarget && (
          <FormGrid columns={1}>
            <Info label={t('fees.balanceDue')} value={formatCurrency(payTarget.balance, symbol)} mono />
            <Input
              label={t('fees.amount')}
              type="number"
              min={1}
              step="0.01"
              value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
              required
              hint={t('fees.amountHint', { amount: formatCurrency(payTarget.balance, symbol) })}
            />
            <Input
              label={t('common.date')}
              type="date"
              value={payForm.paymentDate}
              onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
            />
            <Select
              label={t('fees.method')}
              value={payForm.method}
              options={METHODS.map((m) => ({ value: m, label: t(`fees.method_${m}`) }))}
              onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}
            />
            <Input
              label={t('fees.reference')}
              value={payForm.reference}
              onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
            />
            <Input
              label={t('fees.remarks')}
              value={payForm.remarks}
              onChange={(e) => setPayForm({ ...payForm, remarks: e.target.value })}
            />
          </FormGrid>
        )}
      </Modal>

      {/* preview */}
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={t('fees.previewTitle')}
        subtitle={preview ? t('fees.previewSubtitle', { month: formatMonth(preview.month) }) : ''}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={generate}>
              {t('fees.generate')}
            </Button>
          </>
        }
      >
        {preview && (
          <div className="flex flex-col gap-4">
            {preview.skipped > 0 && (
              <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)] p-3 text-[12.5px]">
                {t('fees.alreadyGenerated', { count: preview.skipped })}
              </div>
            )}
            <DataTable
              rows={preview.rows}
              total={preview.rows.length}
              emptyIcon={Wallet}
              emptyTitle={t('fees.nothingToGenerate')}
              columns={[
                { key: 'studentName', header: t('common.name') },
                { key: 'className', header: t('students.class') },
                {
                  key: 'total',
                  header: t('fees.total'),
                  align: 'end',
                  className: 'no-urdu',
                  render: (r) => formatCurrency(r.total, symbol),
                },
                {
                  key: 'discount',
                  header: t('fees.discount'),
                  align: 'end',
                  className: 'no-urdu',
                  render: (r) => formatCurrency(r.discount, symbol),
                },
                {
                  key: 'payable',
                  header: t('fees.payable'),
                  align: 'end',
                  className: 'no-urdu',
                  render: (r) => <span className="font-semibold text-[var(--color-ink)]">{formatCurrency(r.payable, symbol)}</span>,
                },
              ]}
            />
            <div className="flex justify-end text-[12.5px] text-[var(--color-muted)]">
              {t('fees.payable')}:{' '}
              <b className="no-urdu ms-2 text-[var(--accent)]">{formatCurrency(preview.total, symbol)}</b>
            </div>
          </div>
        )}
      </Modal>

      {/* late fine */}
      <Modal
        open={fineOpen}
        onClose={() => setFineOpen(false)}
        title={t('fees.lateFine')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFineOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={applyFine}>
              {t('fees.applyFine')}
            </Button>
          </>
        }
      >
        <FormGrid columns={1}>
          <Select
            label={t('fees.month')}
            value={fineForm.month}
            options={monthOptions.filter((m) => m.value)}
            onChange={(e) => setFineForm({ ...fineForm, month: e.target.value })}
          />
          <Input
            label={t('fees.lateFineAmount')}
            type="number"
            min={0}
            step="0.01"
            value={fineForm.amount}
            onChange={(e) => setFineForm({ ...fineForm, amount: e.target.value })}
            hint={t('fees.lateFineHint')}
            required
          />
        </FormGrid>
      </Modal>

      {/* receipt */}
      <Modal
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title={t('fees.receipt')}
        subtitle={receipt ? receipt.receiptNo : ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReceipt(null)}>
              {t('common.close')}
            </Button>
            <Button variant="ghost" icon={Printer} onClick={() => printReceipt(receipt?.id)}>
              {t('common.print')}
            </Button>
            <Button variant="primary" icon={FileText} onClick={() => saveReceipt(receipt?.id)}>
              {t('fees.downloadPdf')}
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-[var(--color-ink2)]">{t('fees.receiptSaved')}</p>
      </Modal>

      <ConfirmDialog
        open={!!deletePayment}
        onClose={() => setDeletePayment(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.fees.deletePayment(deletePayment.id);
            toast.success(t('common.deleted', { item: t('fees.payment') }));
            setDeletePayment(null);
            if (detail) setDetail(await api.fees.voucherDetail(detail.id));
            load();
          } catch (err) {
            toast.error(t(errorKey(err)));
          } finally {
            setBusy(false);
          }
        }}
        loading={busy}
        title={t('common.deleteConfirmTitle', { item: t('fees.payment') })}
        message={t('fees.deletePaymentWarning')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

/* ---------------------------------------------------------------- structures */

function StructuresTab({ isAdmin, symbol }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { structure } = useStructure();

  const [rows, setRows] = useState([]);
  const [classId, setClassId] = useState('');
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.fees.structures({ classId: classId || undefined }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [classId, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await api.fees.saveStructure({
        id: item.id,
        classId: item.classId ? Number(item.classId) : undefined,
        name: item.name,
        feeType: item.feeType,
        frequency: item.frequency,
        amount: Number(item.amount) || 0,
      });
      toast.success(t('common.saved'));
      setItem(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    try {
      await api.fees.deleteStructure(row.id);
      toast.success(t('common.deleted', { item: t('fees.structure') }));
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  return (
    <>
      <Panel padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-line)] p-4">
          <div className="w-[200px]">
            <Select
              label={t('students.class')}
              value={classId}
              placeholder={t('fees.allClasses')}
              options={(structure?.classes || []).map((c) => ({ value: String(c.id), label: c.name }))}
              onChange={(e) => setClassId(e.target.value)}
            />
          </div>
          {isAdmin && (
            <Button
              icon={Plus}
              onClick={() => setItem({ classId: classId || '', name: '', feeType: 'tuition', frequency: 'monthly', amount: '' })}
            >
              {t('fees.addStructure')}
            </Button>
          )}
        </div>

        <DataTable
          rows={rows}
          loading={loading}
          total={rows.length}
          emptyIcon={Calculator}
          emptyTitle={t('fees.noStructures')}
          emptyHint={t('fees.noStructuresHint')}
          columns={[
            { key: 'name', header: t('common.name') },
            {
              key: 'className',
              header: t('students.class'),
              render: (r) => (r.className ? r.className : <Badge tone="info">{t('fees.allClasses')}</Badge>),
            },
            { key: 'feeType', header: t('fees.feeType'), render: (r) => t(`feeType.${r.feeType}`) },
            { key: 'frequency', header: t('fees.frequency'), render: (r) => t(`frequency.${r.frequency}`) },
            {
              key: 'amount',
              header: t('fees.amount'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.amount, symbol),
            },
            {
              key: 'actions',
              header: t('common.actions'),
              align: 'end',
              render: (row) =>
                isAdmin ? (
                  <div className="flex items-center justify-end gap-1">
                    <IconButton
                      icon={Pencil}
                      label={t('common.edit')}
                      onClick={() =>
                        setItem({
                          id: row.id,
                          classId: row.classId ? String(row.classId) : '',
                          name: row.name,
                          feeType: row.feeType,
                          frequency: row.frequency,
                          amount: row.amount,
                        })
                      }
                    />
                    <IconButton icon={Trash2} label={t('common.delete')} onClick={() => remove(row)} />
                  </div>
                ) : null,
            },
          ]}
        />
      </Panel>

      <Modal
        open={!!item}
        onClose={() => setItem(null)}
        title={item?.id ? t('fees.editStructure') : t('fees.addStructure')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setItem(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {item && (
          <FormGrid columns={1}>
            <Input label={t('common.name')} value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} required />
            <Select
              label={t('students.class')}
              value={item.classId}
              placeholder={t('fees.allClasses')}
              options={(structure?.classes || []).map((c) => ({ value: String(c.id), label: c.name }))}
              onChange={(e) => setItem({ ...item, classId: e.target.value })}
              hint={t('fees.classHint')}
            />
            <Select
              label={t('fees.feeType')}
              value={item.feeType}
              options={FEE_TYPES.map((f) => ({ value: f, label: t(`feeType.${f}`) }))}
              onChange={(e) => setItem({ ...item, feeType: e.target.value })}
            />
            <Select
              label={t('fees.frequency')}
              value={item.frequency}
              options={FREQUENCIES.map((f) => ({ value: f, label: t(`frequency.${f}`) }))}
              onChange={(e) => setItem({ ...item, frequency: e.target.value })}
            />
            <Input
              label={t('fees.amount')}
              type="number"
              min={0}
              step="0.01"
              value={item.amount}
              onChange={(e) => setItem({ ...item, amount: e.target.value })}
              required
            />
          </FormGrid>
        )}
      </Modal>
    </>
  );
}

/* --------------------------------------------------------------- concessions */

function ConcessionsTab({ isAdmin, symbol }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState(null);
  const [students, setStudents] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.fees.discounts());
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!item) return;
    api.students
      .list({ pageSize: 200, status: 'active' })
      .then((data) => setStudents(data.rows))
      .catch(() => setStudents([]));
  }, [item]);

  const save = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await api.fees.saveDiscount({
        studentId: Number(item.studentId),
        name: item.name,
        amount: Number(item.amount) || 0,
        percent: Number(item.percent) || 0,
        reason: item.reason || undefined,
      });
      toast.success(t('common.saved'));
      setItem(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    try {
      await api.fees.deleteDiscount(row.id);
      toast.success(t('common.deleted', { item: t('fees.concession') }));
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  return (
    <>
      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-line)] p-4">
          <p className="text-[12.5px] text-[var(--color-muted)]">{t('fees.concessionsHint')}</p>
          <Button
            className="ms-auto"
            icon={Plus}
            onClick={() => setItem({ studentId: '', name: '', amount: '', percent: '', reason: '' })}
          >
            {t('fees.addConcession')}
          </Button>
        </div>

        <DataTable
          rows={rows}
          loading={loading}
          total={rows.length}
          emptyIcon={HandCoins}
          emptyTitle={t('fees.noConcessions')}
          emptyHint={t('fees.noConcessionsHint')}
          columns={[
            { key: 'studentName', header: t('common.name') },
            { key: 'admissionNo', header: t('students.admissionNo'), className: 'no-urdu' },
            { key: 'name', header: t('fees.concession') },
            {
              key: 'amount',
              header: t('fees.discount'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.amount, symbol),
            },
            {
              key: 'percent',
              header: t('fees.percent'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => (r.percent ? `${r.percent}%` : '-'),
            },
            { key: 'reason', header: t('fees.reason') },
            {
              key: 'actions',
              header: t('common.actions'),
              align: 'end',
              render: (row) =>
                isAdmin ? <IconButton icon={Trash2} label={t('common.delete')} onClick={() => remove(row)} /> : null,
            },
          ]}
        />
      </Panel>

      <Modal
        open={!!item}
        onClose={() => setItem(null)}
        title={t('fees.addConcession')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setItem(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {item && (
          <FormGrid columns={1}>
            <Select
              label={t('fees.student')}
              value={item.studentId}
              placeholder={t('fees.selectStudent')}
              options={students.map((s) => ({ value: String(s.id), label: `${s.name} (${s.admissionNo})` }))}
              onChange={(e) => setItem({ ...item, studentId: e.target.value })}
            />
            <Input label={t('fees.concession')} value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} required />
            <FormGrid columns={2}>
              <Input
                label={t('fees.fixedAmount')}
                type="number"
                min={0}
                step="0.01"
                value={item.amount}
                onChange={(e) => setItem({ ...item, amount: e.target.value })}
              />
              <Input
                label={t('fees.percent')}
                type="number"
                min={0}
                max={100}
                value={item.percent}
                onChange={(e) => setItem({ ...item, percent: e.target.value })}
                hint={t('fees.discountHint')}
              />
            </FormGrid>
            <Input label={t('fees.reason')} value={item.reason} onChange={(e) => setItem({ ...item, reason: e.target.value })} />
          </FormGrid>
        )}
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- defaulters */

function DefaultersTab({ symbol }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings } = useAuth();
  const { structure } = useStructure();
  const monthOptions = useMonthOptions();

  const [month, setMonth] = useState('');
  const [classId, setClassId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.fees.defaulters({ month: month || undefined, classId: classId || undefined }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [month, classId, t, toast]);

  useEffect(() => {
    setSelected([]);
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      search
        ? rows.filter((r) =>
            [r.studentName, r.admissionNo, r.voucherNo, r.guardianName, r.guardianPhone].some((f) =>
              String(f || '').toLowerCase().includes(search.toLowerCase()),
            ),
          )
        : rows,
    [rows, search],
  );

  const targets = selected.length ? filtered.filter((row) => selected.includes(row.id)) : filtered;
  const totalDue = filtered.reduce((sum, r) => sum + r.balance, 0);
  const schoolName = settings?.school_name || '';

  const varsFor = (row) => ({
    name: row.guardianName || t('messaging.parentGuardian'),
    student: row.studentName,
    class: [row.className, row.sectionName].filter(Boolean).join(' - '),
    amount: formatCurrency(row.balance, symbol),
    month: monthLabel(row.month),
    voucher: row.voucherNo,
    due: row.dueDate || '',
    date: today(),
    school: schoolName,
  });

  const messageFor = (row) => renderTemplate(t('messaging.feeTemplate'), varsFor(row));
  const subjectFor = () => t('messaging.feeSubject', { school: schoolName });

  const openWhatsApp = async (row) => {
    const url = whatsappUrl(row.guardianPhone, messageFor(row));
    if (!url) return toast.error(t('messaging.noPhone'));
    try {
      await api.messaging.openLink(url, 'whatsapp');
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
    return undefined;
  };

  const openSms = async (row) => {
    const url = smsUrl(row.guardianPhone, messageFor(row));
    if (!url) return toast.error(t('messaging.noPhone'));
    try {
      await api.messaging.openLink(url, 'sms');
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
    return undefined;
  };

  const openEmail = async (row) => {
    if (!row.guardianEmail) return toast.error(t('messaging.noEmail'));
    try {
      await api.messaging.openLink(
        mailtoUrl({ to: row.guardianEmail, subject: subjectFor(), body: messageFor(row) }),
        'email',
      );
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
    return undefined;
  };

  const printReminders = async () => {
    setBusy(true);
    try {
      const result = await api.fees.remindersPdf({
        month: month || undefined,
        classId: classId || undefined,
        voucherIds: selected.length ? selected : undefined,
      });
      if (!result.canceled) toast.success(t('messaging.remindersSaved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const runBulk = async () => {
    setBusy(true);
    try {
      if (confirmAction === 'email') {
        const emails = targets.map((row) => row.guardianEmail).filter(Boolean);
        if (!emails.length) {
          toast.error(t('messaging.noEmail'));
        } else {
          const body = cleanTemplate(t('messaging.feeTemplate'), {
            name: t('messaging.parentGuardian'),
            month: monthLabel(month || targets[0]?.month),
            date: today(),
            school: schoolName,
          });
          for (let index = 0; index < emails.length; index += 30) {
            const chunk = emails.slice(index, index + 30).join(',');
            // eslint-disable-next-line no-await-in-loop
            await api.messaging.openLink(mailtoUrl({ bcc: chunk, subject: subjectFor(), body }), 'email');
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
          toast.success(t('messaging.openedCount', { count: emails.length }));
        }
      } else {
        const links = targets
          .map((row) =>
            confirmAction === 'sms'
              ? smsUrl(row.guardianPhone, messageFor(row))
              : whatsappUrl(row.guardianPhone, messageFor(row)),
          )
          .filter(Boolean);
        if (!links.length) {
          toast.error(t('messaging.noPhone'));
        } else {
          for (const url of links) {
            // eslint-disable-next-line no-await-in-loop
            await api.messaging.openLink(url, confirmAction);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
          toast.success(t('messaging.openedCount', { count: links.length }));
        }
      }
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  };

  const exportCsv = () => {
    const header = ['Voucher', 'Student', 'Admission No', 'Class', 'Guardian', 'Phone', 'Email', 'Total', 'Paid', 'Balance', 'Due date', 'Siblings'];
    const lines = filtered.map((r) =>
      [
        r.voucherNo,
        r.studentName,
        r.admissionNo,
        `${r.className || ''} ${r.sectionName || ''}`,
        r.guardianName || '',
        r.guardianPhone || '',
        r.guardianEmail || '',
        r.totalAmount,
        r.paidAmount,
        r.balance,
        r.dueDate,
        (r.siblings || []).join(' / '),
      ]
        .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fee-defaulters-${month || 'all'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t('fees.exported'));
  };

  return (
    <>
      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[170px]">
            <Select label={t('fees.month')} value={month} options={monthOptions} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="w-[190px]">
            <Select
              label={t('students.class')}
              value={classId}
              placeholder={t('students.allClasses')}
              options={(structure?.classes || []).map((c) => ({ value: String(c.id), label: c.name }))}
              onChange={(e) => setClassId(e.target.value)}
            />
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {selected.length > 0 && <Badge tone="accent">{t('students.selected', { count: selected.length })}</Badge>}
            <Badge tone="warn" dot>
              {t('fees.dueTotal', { amount: formatCurrency(totalDue, symbol) })}
            </Badge>
            <Button size="sm" icon={FileText} onClick={exportCsv} disabled={filtered.length === 0}>
              CSV
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
          <span className="text-[11.5px] text-[var(--color-dim)]">{t('messaging.feeRemindersHint')}</span>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Printer} onClick={printReminders} disabled={filtered.length === 0} loading={busy && !confirmAction}>
              {t('messaging.printReminders')}
            </Button>
            <Button
              size="sm"
              icon={MessageCircle}
              onClick={() => setConfirmAction('whatsapp')}
              disabled={targets.length === 0}
            >
              {t('messaging.whatsapp')}
            </Button>
            <Button size="sm" icon={Mail} onClick={() => setConfirmAction('email')} disabled={targets.length === 0}>
              {t('messaging.email')}
            </Button>
            <Button size="sm" icon={Smartphone} onClick={() => setConfirmAction('sms')} disabled={targets.length === 0}>
              {t('messaging.sms')}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel padded={false}>
        <DataTable
          rows={filtered}
          loading={loading}
          total={filtered.length}
          selectable
          selected={selected}
          onSelect={setSelected}
          emptyIcon={UserX}
          emptyTitle={t('fees.noDefaulters')}
          emptyHint={t('fees.noDefaultersHint')}
          toolbar={<TableSearch value={search} onChange={setSearch} placeholder={t('common.search')} />}
          columns={[
            { key: 'studentName', header: t('common.name') },
            { key: 'admissionNo', header: t('students.admissionNo'), className: 'no-urdu' },
            {
              key: 'className',
              header: t('students.class'),
              render: (r) => `${r.className || '-'} ${r.sectionName || ''}`,
            },
            {
              key: 'siblings',
              header: t('fees.siblings'),
              render: (r) => (r.siblings && r.siblings.length ? r.siblings.join(', ') : '-'),
            },
            {
              key: 'totalAmount',
              header: t('fees.total'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.totalAmount, symbol),
            },
            {
              key: 'paidAmount',
              header: t('fees.paid'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.paidAmount, symbol),
            },
            {
              key: 'balance',
              header: t('fees.balance'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => <span className="font-semibold text-[var(--color-warn)]">{formatCurrency(r.balance, symbol)}</span>,
            },
            { key: 'dueDate', header: t('fees.dueDate'), className: 'no-urdu' },
            {
              key: 'contact',
              header: t('students.guardianPhone'),
              className: 'no-urdu',
              render: (r) => r.guardianPhone || '-',
            },
            {
              key: 'actions',
              header: t('common.actions'),
              align: 'end',
              render: (r) => (
                <div className="flex items-center justify-end gap-1">
                  <IconButton
                    icon={MessageCircle}
                    label={t('messaging.whatsapp')}
                    disabled={!r.guardianPhone}
                    onClick={() => openWhatsApp(r)}
                  />
                  <IconButton icon={Smartphone} label={t('messaging.sms')} disabled={!r.guardianPhone} onClick={() => openSms(r)} />
                  <IconButton icon={Mail} label={t('messaging.email')} disabled={!r.guardianEmail} onClick={() => openEmail(r)} />
                </div>
              ),
            },
          ]}
        />
      </Panel>

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={runBulk}
        loading={busy}
        title={t('messaging.bulkTitle', {
          channel:
            confirmAction === 'email'
              ? t('messaging.email')
              : confirmAction === 'sms'
                ? t('messaging.sms')
                : t('messaging.whatsapp'),
        })}
        message={t('messaging.bulkHint', { count: targets.length })}
        confirmLabel={t('messaging.openAll')}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

/* -------------------------------------------------------------------- report */

function ReportTab({ symbol }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { structure } = useStructure();

  const firstOfMonth = () => `${currentMonth()}-01`;
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [classId, setClassId] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.fees.collectionReport({ from, to, classId: classId || undefined }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [from, to, classId, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <Panel className="mb-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Input label={t('fees.from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label={t('fees.to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select
            label={t('students.class')}
            value={classId}
            placeholder={t('students.allClasses')}
            options={(structure?.classes || []).map((c) => ({ value: String(c.id), label: c.name }))}
            onChange={(e) => setClassId(e.target.value)}
          />
          <div className="flex items-end">
            <div className="flex w-full items-center justify-between rounded-xl border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-4 py-3">
              <span className="text-[12.5px] text-[var(--color-muted)]">{t('fees.collected')}</span>
              <span className="no-urdu text-[15px] font-semibold text-[var(--color-accent)]">
                {formatCurrency(report?.total || 0, symbol)}
              </span>
            </div>
          </div>
        </div>
      </Panel>

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(report?.byMethod || []).map((row) => (
          <StatCard
            key={row.method}
            label={t(`fees.method_${row.method}`)}
            value={formatCurrency(row.amount, symbol)}
            hint={t('fees.receiptsCount', { count: row.receipts })}
            menu={false}
          />
        ))}
      </div>

      <Panel padded={false}>
        <DataTable
          rows={report?.rows || []}
          loading={loading}
          total={report?.rows?.length || 0}
          emptyIcon={Receipt}
          emptyTitle={t('fees.noCollection')}
          emptyHint={t('fees.noCollectionHint')}
          rowKey={(row) => row.date}
          columns={[
            { key: 'date', header: t('common.date'), render: (r) => formatDate(r.date) },
            { key: 'receipts', header: t('fees.receipts'), align: 'center', className: 'no-urdu' },
            {
              key: 'amount',
              header: t('fees.collected'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => <span className="font-semibold text-[var(--color-ink)]">{formatCurrency(r.amount, symbol)}</span>,
            },
            {
              key: 'cash',
              header: t('fees.method_cash'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.cash, symbol),
            },
            {
              key: 'other',
              header: t('fees.byOtherModes'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.other, symbol),
            },
          ]}
        />
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------- helpers */

function Info({ label, value, mono }) {
  return (
    <div>
      <p className="text-[11.5px] text-[var(--color-dim)]">{label}</p>
      <p className={`mt-0.5 text-[13px] text-[var(--color-ink2)] ${mono ? 'no-urdu' : ''}`}>{value}</p>
    </div>
  );
}

function Line({ label, value, strong }) {
  return (
    <li className="flex items-center justify-between border-b border-dashed border-[var(--color-line)] pb-1.5 text-[12.5px]">
      <span className={strong ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-muted)]'}>{label}</span>
      <span className={`no-urdu ${strong ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-ink2)]'}`}>{value}</span>
    </li>
  );
}

export default FeePage;