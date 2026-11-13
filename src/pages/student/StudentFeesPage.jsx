import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet, Printer, FileText, AlertTriangle, HandCoins } from 'lucide-react';
import clsx from 'clsx';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, StatCard } from '../../components/ui/Panel';
import { IconButton } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency, formatDate, formatMonth } from '../../utils/format';

const TABS = [
  { key: 'vouchers', labelKey: 'fees.myVouchers', icon: Wallet },
  { key: 'receipts', labelKey: 'fees.myReceipts', icon: HandCoins },
];

/**
 * Student > My Fee Status.
 * The main process resolves the student from the session, so a student can only
 * ever see their own account - there is no id in the renderer to tamper with.
 */
export function StudentFeesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || 'Rs';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('vouchers');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.fees.my());
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const printReceipt = async (id) => {
    try {
      await api.fees.receiptPrint(id);
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const saveReceipt = async (id) => {
    try {
      const result = await api.fees.receiptPdf(id);
      if (result && !result.canceled) toast.success(t('fees.pdfSaved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const totals = data?.totals || {};
  const stats = [
    { label: t('fees.billed'), value: loading ? <Skeleton /> : formatCurrency(totals.billed, symbol), icon: Wallet },
    { label: t('fees.paid'), value: loading ? <Skeleton /> : formatCurrency(totals.paid, symbol), icon: HandCoins },
    { label: t('fees.balance'), value: loading ? <Skeleton /> : formatCurrency(totals.balance, symbol), icon: AlertTriangle },
  ];

  return (
    <>
      <PageHeader
        title={t('fees.myFees')}
        subtitle={t('fees.myFeesSubtitle')}
        actions={data?.student ? <Badge tone="accent">{data.student.admissionNo}</Badge> : null}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} menu={false} />
        ))}
      </div>

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

      {tab === 'vouchers' && (
        <Panel padded={false}>
          <DataTable
            rows={data?.vouchers || []}
            loading={loading}
            total={data?.vouchers?.length || 0}
            emptyIcon={Wallet}
            emptyTitle={t('fees.noFeeRecords')}
            emptyHint={t('fees.noFeeRecordsHint')}
            columns={[
              {
                key: 'month',
                header: t('fees.period'),
                className: 'no-urdu',
                render: (r) => formatMonth(r.month),
              },
              { key: 'voucherNo', header: t('fees.voucherNo'), className: 'no-urdu' },
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
            ]}
          />
        </Panel>
      )}

      {tab === 'receipts' && (
        <Panel padded={false}>
          <DataTable
            rows={data?.payments || []}
            loading={loading}
            total={data?.payments?.length || 0}
            emptyIcon={HandCoins}
            emptyTitle={t('fees.noReceipts')}
            emptyHint={t('fees.noReceiptsHint')}
            columns={[
              { key: 'receiptNo', header: t('fees.receiptNo'), className: 'no-urdu' },
              { key: 'paymentDate', header: t('common.date'), render: (r) => formatDate(r.paymentDate) },
              { key: 'voucherNo', header: t('fees.voucherNo'), className: 'no-urdu' },
              {
                key: 'amount',
                header: t('fees.amount'),
                align: 'end',
                className: 'no-urdu',
                render: (r) => <span className="font-semibold text-[var(--color-ink)]">{formatCurrency(r.amount, symbol)}</span>,
              },
              { key: 'method', header: t('fees.method'), render: (r) => t(`fees.method_${r.method}`) },
              {
                key: 'actions',
                header: t('common.actions'),
                align: 'end',
                render: (row) => (
                  <div className="flex items-center justify-end gap-1">
                    <IconButton icon={Printer} label={t('common.print')} onClick={() => printReceipt(row.id)} />
                    <IconButton icon={FileText} label={t('fees.downloadPdf')} onClick={() => saveReceipt(row.id)} />
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      )}
    </>
  );
}

export default StudentFeesPage;