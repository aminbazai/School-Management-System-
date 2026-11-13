import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { BarChart3, Download, PlayCircle } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel } from '../../components/ui/Panel';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Form';
import { Badge } from '../../components/ui/Badge';
import { DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { formatNumber } from '../../utils/format';

const KINDS = ['enrolment', 'attendance', 'fees', 'salary', 'results'];

/**
 * Report rows are built in main and carry whatever columns their query needs,
 * so there is no stable `id`. Fall back through the columns that are unique
 * within a report; otherwise React would see duplicate keys on every render.
 */
function reportRowKey(row) {
  return (
    row.id ??
    row.metric ??
    [row.month, row.date, row.name, row.className, row.employee_code, row.examId].filter(Boolean).join('|')
  );
}

/**
 * The office report desk.
 *
 * Each report is built live in the main process from current records and
 * rendered as a plain table, so what is on screen is exactly what the PDF
 * contains - there is no second, prettier rendering that could disagree.
 */
export function ReportsPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [kind, setKind] = useState('enrolment');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.reports.run({ kind, month }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [kind, month, t, toast]);

  useEffect(() => {
    run();
  }, [run]);

  const download = async () => {
    setBusy(true);
    try {
      await api.reports.pdf({ kind, month });
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const columns = report?.rows?.length ? Object.keys(report.rows[0]) : [];
  const numeric = (value) => (typeof value === 'number' ? formatNumber(value) : String(value ?? ''));

  return (
    <>
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        actions={
          <>
            <Button icon={PlayCircle} loading={loading} onClick={run}>
              {t('reports.runReport')}
            </Button>
            <Button icon={Download} variant="primary" loading={busy} disabled={!report?.rows?.length} onClick={download}>
              {t('reports.downloadPdf')}
            </Button>
          </>
        }
      />

      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[220px]">
            <Select
              label={t('reports.title')}
              value={kind}
              options={KINDS.map((value) => ({ value, label: t(`reports.${value}`) }))}
              onChange={(e) => setKind(e.target.value)}
            />
          </div>
          <div className="w-[170px]">
            <Input label={t('fees.month')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          {report && (
            <div className="ms-auto pb-1">
              <Badge tone="accent">
                {report.title} · {report.month}
              </Badge>
            </div>
          )}
        </div>
      </Panel>

      {report && (
        <>
          {report.summary && (
            <p className="mb-3 text-[13px] text-[var(--color-muted)]">{report.summary}</p>
          )}

          {report.footer?.length > 0 && (
            <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {report.footer.map((item) => (
                <Panel key={item.metric} className="p-4">
                  <p className="eyebrow">{item.metric}</p>
                  <p className="no-urdu mt-2 text-[20px] font-semibold text-[var(--color-ink)]">{numeric(item.value)}</p>
                </Panel>
              ))}
            </div>
          )}

          <Panel padded={false}>
            {report.rows.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title={t('reports.pickReport')}
                hint={t('reports.pickReportHint')}
                className="py-10"
              />
            ) : (
              <DataTable
                rows={report.rows}
                total={report.rows.length}
                rowKey={reportRowKey}
                columns={columns.map((key) => ({
                  key,
                  header: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
                  align: typeof report.rows[0][key] === 'number' ? 'end' : undefined,
                  className: typeof report.rows[0][key] === 'number' ? 'no-urdu' : undefined,
                  render: (row) => (
                    <span className={clsx(typeof row[key] === 'number' && 'text-[var(--color-ink)]')}>
                      {numeric(row[key])}
                    </span>
                  ),
                }))}
              />
            )}
          </Panel>
        </>
      )}
    </>
  );
}

export default ReportsPage;