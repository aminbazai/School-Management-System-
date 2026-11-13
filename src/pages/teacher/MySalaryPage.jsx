import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer, FileText, Wallet } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, StatCard } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { FormGrid } from '../../components/ui/Form';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency, formatMonth } from '../../utils/format';

/**
 * Teacher > My Salary Slips.
 * The main process resolves which staff member this is from users.linked_id,
 * so a teacher can never request another person's payslip.
 */
export function MySalaryPage() {
  const { t } = useTranslation();
  const { settings } = useAuth();
  const toast = useToast();
  const symbol = settings?.currency_symbol || 'Rs';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [slip, setSlip] = useState(null);

  useEffect(() => {
    let active = true;
    api.salary
      .mySlips()
      .then((data) => active && setRows(data))
      .catch((err) => active && toast.error(t(errorKey(err))))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [t, toast]);

  const latest = rows[0];
  const yearTotal = rows
    .filter((r) => r.month.startsWith(String(new Date().getFullYear())))
    .reduce((sum, r) => sum + r.net, 0);

  const print = async (row) => {
    try {
      await api.salary.slipPrint(row.id);
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const download = async (row) => {
    try {
      const result = await api.salary.slipPdf(row.id);
      if (result && !result.canceled) toast.success(t('salary.pdfSaved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  return (
    <>
      <PageHeader
        title={t('salary.mySlips')}
        subtitle={t('salary.mySlipsSubtitle')}
        actions={<Badge tone="accent" dot>{t('roles.teacher')}</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t('salary.latestNet')}
          icon={Wallet}
          value={loading ? <Skeleton /> : latest ? formatCurrency(latest.net, symbol) : '—'}
          hint={latest ? formatMonth(latest.month) : undefined}
        />
        <StatCard
          label={t('salary.yearTotal')}
          value={loading ? <Skeleton /> : formatCurrency(yearTotal, symbol)}
          hint={String(new Date().getFullYear())}
        />
        <StatCard label={t('salary.slipsCount')} value={loading ? <Skeleton /> : rows.length} />
      </div>

      <div className="mt-4 grid gap-4">
        <Panel padded={false}>
          <DataTable
            rows={rows}
            loading={loading}
            total={rows.length}
            emptyIcon={Wallet}
            emptyTitle={t('salary.noPayroll')}
            emptyHint={t('salary.noPayrollHint')}
            columns={[
              { key: 'month', header: t('salary.month'), render: (r) => formatMonth(r.month) },
              {
                key: 'basic',
                header: t('salary.basic'),
                align: 'end',
                className: 'no-urdu',
                render: (r) => formatCurrency(r.basic, symbol),
              },
              {
                key: 'allowancesTotal',
                header: t('salary.allowances'),
                align: 'end',
                className: 'no-urdu',
                render: (r) => formatCurrency(r.allowancesTotal, symbol),
              },
              {
                key: 'deductions',
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
                    <IconButton
                      icon={FileText}
                      label={t('salary.viewSlip')}
                      onClick={async () => {
                        try {
                          setSlip(await api.salary.detail(row.id));
                        } catch (err) {
                          toast.error(t(errorKey(err)));
                        }
                      }}
                    />
                    <IconButton icon={Printer} label={t('common.print')} onClick={() => print(row)} />
                    <IconButton icon={FileText} label={t('salary.downloadPdf')} onClick={() => download(row)} />
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      </div>

      <Modal
        open={!!slip}
        onClose={() => setSlip(null)}
        title={t('salary.slip')}
        subtitle={slip ? `${slip.month}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSlip(null)}>
              {t('common.close')}
            </Button>
            <Button variant="primary" icon={Printer} onClick={() => print(slip)}>
              {t('common.print')}
            </Button>
          </>
        }
      >
        {slip && (
          <div className="flex flex-col gap-4">
            <FormGrid columns={3}>
              <div>
                <p className="text-[11.5px] text-[var(--color-dim)]">{t('staff.name')}</p>
                <p className="text-[13px] text-[var(--color-ink2)]">{slip.staffName}</p>
              </div>
              <div>
                <p className="text-[11.5px] text-[var(--color-dim)]">{t('staff.designation')}</p>
                <p className="text-[13px] text-[var(--color-ink2)]">{slip.designation || '-'}</p>
              </div>
              <div>
                <p className="text-[11.5px] text-[var(--color-dim)]">{t('salary.attendanceDays')}</p>
                <p className="no-urdu text-[13px] text-[var(--color-ink2)]">
                  {slip.presentDays} / {slip.absentDays}
                </p>
              </div>
            </FormGrid>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="eyebrow mb-2">{t('salary.earnings')}</p>
                <ul className="flex flex-col gap-1.5">
                  {slip.items
                    .filter((i) => i.kind === 'earning')
                    .map((item, index) => (
                      <li key={index} className="flex items-center justify-between border-b border-dashed border-[var(--color-line)] pb-1.5 text-[12.5px]">
                        <span className="text-[var(--color-muted)]">{item.name}</span>
                        <span className="no-urdu text-[var(--color-ink2)]">{formatCurrency(item.amount, symbol)}</span>
                      </li>
                    ))}
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
                      <li key={index} className="flex items-center justify-between border-b border-dashed border-[var(--color-line)] pb-1.5 text-[12.5px]">
                        <span className="text-[var(--color-muted)]">{item.name}</span>
                        <span className="no-urdu text-[var(--color-ink2)]">{formatCurrency(item.amount, symbol)}</span>
                      </li>
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
    </>
  );
}

export default MySalaryPage;