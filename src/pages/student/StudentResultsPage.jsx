import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Award, Download, Printer, Table2, TrendingUp } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, StatCard, ProgressBar } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/States';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { BarsChart } from '../../components/charts/Charts';
import { formatDate } from '../../utils/format';

/**
 * Student workspace for Phase 6.
 *
 * The student never sends an id - the main process resolves who they are from
 * the session, so there is nothing in the renderer that could be pointed at
 * somebody else's record.
 */
export function StudentResultsPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.exams.myResults();
      setRows(result.rows);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const latest = rows[0] || null;
  const best = rows.reduce((acc, row) => (acc === null || row.percentage > acc.percentage ? row : acc), null);
  const average = rows.length
    ? Math.round((rows.reduce((sum, row) => sum + row.percentage, 0) / rows.length) * 100) / 100
    : 0;
  const chartData = [...rows].reverse().map((row) => ({
    exam: row.examName.length > 12 ? `${row.examName.slice(0, 12)}…` : row.examName,
    percentage: row.percentage,
  }));

  return (
    <>
      <PageHeader title={t('exams.myResults')} subtitle={t('exams.myResultsSubtitle')} />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t('exams.grade')}
          menu={false}
          icon={Award}
          value={loading ? <Skeleton /> : latest?.grade || '-'}
          hint={latest ? latest.examName : t('common.noData')}
        />
        <StatCard
          label={t('dash.myResults')}
          menu={false}
          icon={TrendingUp}
          value={loading ? <Skeleton /> : `${latest?.percentage ?? 0}%`}
          hint={latest?.isPass ? t('exams.pass') : t('exams.fail')}
        >
          {latest && <ProgressBar value={latest.percentage} tone={latest.isPass ? 'ok' : 'danger'} />}
        </StatCard>
        <StatCard
          label={t('exams.average')}
          menu={false}
          icon={Table2}
          value={loading ? <Skeleton /> : `${average}%`}
          hint={t('exams.resultsCount', { count: rows.length })}
        />
      </div>

      {rows.length > 1 && (
        <Panel className="mb-4">
          <h3 className="panel-title mb-3">{t('exams.myResults')}</h3>
          <BarsChart
            data={chartData}
            xKey="exam"
            series={[{ key: 'percentage', label: t('exams.percentage'), color: 'var(--accent)' }]}
            height={190}
          />
        </Panel>
      )}

      <Panel padded={false}>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('exams.exam')}</th>
                <th className="text-end">{t('exams.obtained')}</th>
                <th className="text-end">{t('exams.percentage')}</th>
                <th className="text-center">{t('exams.grade')}</th>
                <th className="text-center">{t('exams.position')}</th>
                <th className="text-center">{t('exams.result')}</th>
                <th className="text-end">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-14 text-center">
                    <Skeleton className="mx-auto" width="w-24" height="h-6" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState icon={Award} title={t('exams.noMyResults')} hint={t('exams.noMyResultsHint')} />
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.examId}>
                    <td>
                      <p className="font-medium text-[var(--color-ink)]">{row.examName}</p>
                      <p className="no-urdu text-[11.5px] text-[var(--color-dim)]">{formatDate(row.examDate)}</p>
                    </td>
                    <td className="no-urdu text-end">
                      {row.obtainedMarks} / {row.totalMarks}
                    </td>
                    <td className="no-urdu text-end font-semibold text-[var(--color-ink)]">{row.percentage}%</td>
                    <td className="text-center">
                      <Badge tone="accent">{row.grade || '-'}</Badge>
                    </td>
                    <td className="no-urdu text-center text-[var(--color-muted)]">
                      {row.position}
                      {row.tied && <span className="ms-1 text-[10.5px] text-[var(--color-dim)]">({t('exams.tied')})</span>}
                    </td>
                    <td className="text-center">
                      <Badge tone={row.isPass ? 'ok' : 'danger'} dot>
                        {row.isPass ? t('exams.pass') : t('exams.fail')}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <IconButton icon={Table2} label={t('exams.reportCard')} onClick={() => setDetail(row)} />
                        <IconButton
                          icon={Download}
                          label={t('reports.downloadPdf')}
                          onClick={async () => {
                            try {
                              await api.exams.reportCardPdf({ examId: row.examId });
                            } catch (err) {
                              toast.error(t(errorKey(err)));
                            }
                          }}
                        />
                        <IconButton
                          icon={Printer}
                          label={t('exams.preview')}
                          onClick={async () => {
                            try {
                              await api.exams.reportCardPrint({ examId: row.examId });
                            } catch (err) {
                              toast.error(t(errorKey(err)));
                            }
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {best && !loading && (
        <p className="mt-3 text-[11.5px] text-[var(--color-dim)]">
          {t('dash.myResults')}: {best.examName} - {best.percentage}% ({best.grade})
        </p>
      )}

      <ResultDetailModal examId={detail?.examId} onClose={() => setDetail(null)} />
    </>
  );
}

/** The full paper breakdown for one result, loaded on demand. */
function ResultDetailModal({ examId, onClose }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!examId) {
      setCard(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    api.exams
      .reportCard({ examId })
      .then((data) => {
        if (!cancelled) setCard(data);
      })
      .catch((err) => toast.error(t(errorKey(err))))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [examId, t, toast]);

  return (
    <Modal
      open={!!examId}
      onClose={onClose}
      title={t('exams.reportCard')}
      subtitle={card ? `${card.exam.name} · ${card.student.name}` : ''}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            icon={Download}
            onClick={async () => {
              try {
                await api.exams.reportCardPdf({ examId });
              } catch (err) {
                toast.error(t(errorKey(err)));
              }
            }}
            disabled={loading}
          >
            {t('reports.downloadPdf')}
          </Button>
        </>
      }
    >
      {loading || !card ? (
        <Skeleton width="w-full" height="h-56" />
      ) : (
        <div>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[var(--color-line)] p-3">
              <p className="eyebrow">{t('exams.obtained')}</p>
              <p className="no-urdu text-[18px] font-semibold">
                {card.result?.obtainedMarks ?? '-'} / {card.result?.totalMarks ?? '-'}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-line)] p-3">
              <p className="eyebrow">{t('exams.percentage')}</p>
              <p className="no-urdu text-[18px] font-semibold">{card.result?.percentage ?? '-'}%</p>
            </div>
            <div className="rounded-xl border border-[var(--color-line)] p-3">
              <p className="eyebrow">{t('exams.grade')}</p>
              <p className="text-[18px] font-semibold text-[var(--accent)]">{card.result?.grade || '-'}</p>
            </div>
            <div className="rounded-xl border border-[var(--color-line)] p-3">
              <p className="eyebrow">{t('exams.position')}</p>
              <p className="no-urdu text-[18px] font-semibold">{card.result?.position ?? '-'}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--color-line)]">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('exams.subject')}</th>
                  <th className="text-end">{t('exams.obtained')}</th>
                  <th className="text-end">{t('exams.total')}</th>
                  <th className="text-end">{t('exams.passMarks')}</th>
                  <th className="text-center">{t('exams.result')}</th>
                </tr>
              </thead>
              <tbody>
                {card.items.map((item) => (
                  <tr key={item.subjectId}>
                    <td>{item.subjectName}</td>
                    <td className="no-urdu text-end">{item.obtainedMarks ?? '-'}</td>
                    <td className="no-urdu text-end">{item.totalMarks}</td>
                    <td className="no-urdu text-end">{item.passMarks}</td>
                    <td className="text-center">
                      {item.isPass === null ? (
                        '-'
                      ) : (
                        <Badge tone={item.isPass ? 'ok' : 'danger'}>{item.isPass ? t('exams.pass') : t('exams.fail')}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {card.attendance.total > 0 && (
            <p className="mt-3 text-[12.5px] text-[var(--color-muted)]">
              {t('dash.studentAttendance')}: {card.attendance.percentage}% ({card.attendance.present}/{card.attendance.total})
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

export default StudentResultsPage;