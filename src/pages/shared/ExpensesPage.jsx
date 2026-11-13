import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingDown, TrendingUp, Plus, Trash2, Pencil, FileText } from 'lucide-react';
import clsx from 'clsx';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, StatCard } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable, TableSearch } from '../../components/ui/DataTable';
import { Input, Select, FormGrid } from '../../components/ui/Form';
import { Badge } from '../../components/ui/Badge';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { formatCurrency, formatDate } from '../../utils/format';

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

const TABS = [
  { key: 'entries', labelKey: 'expenses.entries', icon: FileText },
  { key: 'report', labelKey: 'expenses.report', icon: TrendingDown },
];

/** Expense / other-income bookkeeping with a category and monthly report. */
export function ExpensesPage({ role = 'office' }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('entries');
  const isAdmin = role === 'admin';

  return (
    <>
      <PageHeader title={t('expenses.title')} subtitle={t('expenses.subtitle')} />

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

      {tab === 'entries' && <EntriesTab isAdmin={isAdmin} />}
      {tab === 'report' && <ReportTab />}
    </>
  );
}

/* ------------------------------------------------------------------ entries */

function EntriesTab({ isAdmin }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || 'Rs';

  const [month, setMonth] = useState(currentMonth());
  const [entryType, setEntryType] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], summary: null, total: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState({ expense: [], income: [] });

  const [item, setItem] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    api.expenses
      .categories()
      .then(setCategories)
      .catch(() => setCategories({ expense: [], income: [] }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.expenses.list({
        month: month || undefined,
        entryType: entryType || undefined,
        category: category || undefined,
        search: search || undefined,
        page,
        pageSize: 50,
      });
      setData(result);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [month, entryType, category, search, page, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [month, entryType, category, search]);

  const blank = () => ({
    entryType: 'expense',
    category: categories.expense[0] || '',
    description: '',
    amount: '',
    method: 'cash',
    reference: '',
    entryDate: today(),
  });

  const save = async () => {
    if (!item) return;
    setBusy(true);
    try {
      const payload = {
        entryType: item.entryType,
        category: item.category,
        description: item.description || undefined,
        amount: Number(item.amount) || 0,
        method: item.method || undefined,
        reference: item.reference || undefined,
        entryDate: item.entryDate,
      };
      if (item.id) await api.expenses.update(item.id, payload);
      else await api.expenses.create(payload);
      toast.success(t('common.saved'));
      setItem(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.expenses.remove(deleteTarget.id);
      toast.success(t('common.deleted', { item: t('expenses.entry') }));
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const header = [t('common.date'), t('expenses.type'), t('expenses.category'), t('expenses.description'), t('expenses.amount'), t('expenses.method'), t('expenses.reference')];
    const lines = data.rows.map((r) =>
      [r.entryDate, r.entryType, r.category, r.description || '', r.amount, r.method || '', r.reference || '']
        .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `expenses-${month || 'all'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t('expenses.exported'));
  };

  const summary = data.summary || {};
  const options = entryType ? categories[entryType] : [];

  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t('expenses.totalIncome')}
          icon={TrendingUp}
          menu={false}
          value={loading ? <Skeleton /> : formatCurrency(summary.income, symbol)}
        />
        <StatCard
          label={t('expenses.totalExpense')}
          icon={TrendingDown}
          menu={false}
          value={loading ? <Skeleton /> : formatCurrency(summary.expense, symbol)}
        />
        <StatCard
          label={t('expenses.net')}
          menu={false}
          value={loading ? <Skeleton /> : formatCurrency((summary.income || 0) - (summary.expense || 0), symbol)}
        />
      </div>

      <Panel padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-line)] p-4">
          <div className="w-[170px]">
            <Input label={t('fees.month')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="w-[160px]">
            <Select
              label={t('expenses.type')}
              value={entryType}
              placeholder={t('expenses.allTypes')}
              options={[
                { value: 'expense', label: t('expenses.expense') },
                { value: 'income', label: t('expenses.income') },
              ]}
              onChange={(e) => {
                setEntryType(e.target.value);
                setCategory('');
              }}
            />
          </div>
          <div className="w-[180px]">
            <Select
              label={t('expenses.category')}
              value={category}
              placeholder={t('expenses.allCategories')}
              options={options.map((c) => ({ value: c, label: c }))}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <TableSearch value={search} onChange={setSearch} placeholder={t('common.search')} />
          </div>
          <div className="flex items-center gap-2">
            <Button icon={FileText} onClick={exportCsv} disabled={data.rows.length === 0}>
              CSV
            </Button>
            <Button icon={Plus} onClick={() => setItem(blank())}>
              {t('expenses.addEntry')}
            </Button>
          </div>
        </div>

        <DataTable
          rows={data.rows}
          loading={loading}
          total={data.total}
          page={page}
          pageSize={50}
          onPageChange={setPage}
          emptyIcon={TrendingDown}
          emptyTitle={t('expenses.noEntries')}
          emptyHint={t('expenses.noEntriesHint')}
          columns={[
            { key: 'entryDate', header: t('common.date'), render: (r) => formatDate(r.entryDate) },
            {
              key: 'entryType',
              header: t('expenses.type'),
              render: (r) => (
                <Badge tone={r.entryType === 'income' ? 'ok' : 'warn'}>
                  {r.entryType === 'income' ? t('expenses.income') : t('expenses.expense')}
                </Badge>
              ),
            },
            { key: 'category', header: t('expenses.category') },
            { key: 'description', header: t('expenses.description') },
            {
              key: 'amount',
              header: t('expenses.amount'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => (
                <span className={r.entryType === 'income' ? 'font-semibold text-[var(--color-ok)]' : 'font-semibold text-[var(--color-ink)]'}>
                  {formatCurrency(r.amount, symbol)}
                </span>
              ),
            },
            {
              key: 'method',
              header: t('expenses.method'),
              render: (r) => (r.method ? t(`fees.method_${r.method}`) : '-'),
            },
            { key: 'username', header: t('common.username') },
            {
              key: 'actions',
              header: t('common.actions'),
              align: 'end',
              render: (row) => (
                <div className="flex items-center justify-end gap-1">
                  <IconButton
                    icon={Pencil}
                    label={t('common.edit')}
                    onClick={() =>
                      setItem({
                        id: row.id,
                        entryType: row.entryType,
                        category: row.category,
                        description: row.description || '',
                        amount: row.amount,
                        method: row.method || '',
                        reference: row.reference || '',
                        entryDate: row.entryDate,
                      })
                    }
                  />
                  {isAdmin && <IconButton icon={Trash2} label={t('common.delete')} onClick={() => setDeleteTarget(row)} />}
                </div>
              ),
            },
          ]}
        />
      </Panel>

      <Modal
        open={!!item}
        onClose={() => setItem(null)}
        title={item?.id ? t('expenses.editEntry') : t('expenses.addEntry')}
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
              label={t('expenses.type')}
              value={item.entryType}
              options={[
                { value: 'expense', label: t('expenses.expense') },
                { value: 'income', label: t('expenses.income') },
              ]}
              onChange={(e) => setItem({ ...item, entryType: e.target.value, category: '' })}
            />
            <Select
              label={t('expenses.category')}
              value={item.category}
              options={(categories[item.entryType] || []).map((c) => ({ value: c, label: c }))}
              onChange={(e) => setItem({ ...item, category: e.target.value })}
            />
            <Input
              label={t('expenses.description')}
              value={item.description}
              onChange={(e) => setItem({ ...item, description: e.target.value })}
            />
            <Input
              label={t('expenses.amount')}
              type="number"
              min={1}
              step="0.01"
              value={item.amount}
              onChange={(e) => setItem({ ...item, amount: e.target.value })}
              required
            />
            <Input
              label={t('common.date')}
              type="date"
              value={item.entryDate}
              onChange={(e) => setItem({ ...item, entryDate: e.target.value })}
            />
            <Select
              label={t('expenses.method')}
              value={item.method}
              placeholder={t('common.optional')}
              options={['cash', 'bank', 'cheque', 'online'].map((m) => ({ value: m, label: t(`fees.method_${m}`) }))}
              onChange={(e) => setItem({ ...item, method: e.target.value })}
            />
            <Input
              label={t('expenses.reference')}
              value={item.reference}
              onChange={(e) => setItem({ ...item, reference: e.target.value })}
            />
          </FormGrid>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={busy}
        title={t('common.deleteConfirmTitle', { item: t('expenses.entry') })}
        message={t('common.deleteConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
      />
    </>
  );
}

/* ------------------------------------------------------------------- report */

function ReportTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings } = useAuth();
  const symbol = settings?.currency_symbol || 'Rs';

  const [month, setMonth] = useState(currentMonth());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.expenses.report({ month: month || undefined }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [month, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const income = useMemo(() => (report?.byCategory || []).filter((r) => r.entry_type === 'income'), [report]);
  const expense = useMemo(() => (report?.byCategory || []).filter((r) => r.entry_type === 'expense'), [report]);
  const max = useMemo(
    () => Math.max(1, ...(report?.byCategory || []).map((r) => r.amount)),
    [report],
  );

  return (
    <>
      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[180px]">
            <Input label={t('fees.month')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="ms-auto flex items-center gap-3 text-[12.5px]">
            <Badge tone="ok">{t('expenses.income')}: {formatCurrency(report?.totals?.income || 0, symbol)}</Badge>
            <Badge tone="warn">{t('expenses.expense')}: {formatCurrency(report?.totals?.expense || 0, symbol)}</Badge>
            <Badge tone="accent">
              {t('expenses.net')}: {formatCurrency(report?.totals?.net || 0, symbol)}
            </Badge>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { title: t('expenses.expense'), rows: expense, tone: 'warn' },
          { title: t('expenses.income'), rows: income, tone: 'ok' },
        ].map((group) => (
          <Panel key={group.title}>
            <h3 className="panel-title mb-3">{group.title}</h3>
            {group.rows.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-[var(--color-dim)]">{t('common.noData')}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {group.rows.map((row) => (
                  <li key={`${row.entry_type}-${row.category}`}>
                    <div className="flex items-center justify-between text-[12.5px]">
                      <span className="text-[var(--color-ink2)]">{row.category}</span>
                      <span className="no-urdu text-[var(--color-ink)]">
                        {formatCurrency(row.amount, symbol)}
                        <span className="ms-2 text-[11px] text-[var(--color-dim)]">
                          ({t('expenses.entriesCount', { count: row.entries })})
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-line)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round((row.amount / max) * 100)}%`,
                          background: group.tone === 'ok' ? 'var(--color-ok)' : 'var(--color-warn)',
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>

      <Panel padded={false} className="mt-4">
        <DataTable
          rows={report?.monthly || []}
          loading={loading}
          total={report?.monthly?.length || 0}
          rowKey={(row) => row.month}
          emptyIcon={TrendingDown}
          emptyTitle={t('expenses.noEntries')}
          columns={[
            { key: 'month', header: t('fees.month'), render: (r) => formatDate(`${r.month}-01`).slice(0, 7) },
            {
              key: 'income',
              header: t('expenses.income'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.income, symbol),
            },
            {
              key: 'expense',
              header: t('expenses.expense'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => formatCurrency(r.expense, symbol),
            },
            {
              key: 'net',
              header: t('expenses.net'),
              align: 'end',
              className: 'no-urdu',
              render: (r) => (
                <span className="font-semibold text-[var(--color-ink)]">
                  {formatCurrency(r.income - r.expense, symbol)}
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}

export default ExpensesPage;