import { useMemo } from 'react';
import clsx from 'clsx';
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Spinner } from './Button';
import { EmptyState } from './States';
import { Input } from './Form';

/**
 * Reusable data table with search, sorting, selection, pagination and
 * an action slot for export/print buttons.
 *
 * The table is presentational: it never talks to the API. Pages pass the rows,
 * the sort state and the callbacks they already own.
 */
export function DataTable({
  columns,
  rows,
  loading = false,
  emptyTitle,
  emptyHint,
  emptyIcon,
  sortBy,
  sortDir = 'asc',
  onSort,
  rowKey = (row) => row.id,
  selectable = false,
  selected = [],
  onSelect,
  onSelectAll,
  page = 1,
  pageSize = 25,
  total = 0,
  onPageChange,
  onPageSizeChange,
  toolbar,
  actions,
  rowClassName,
  className,
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((row) => selected.includes(rowKey(row))),
    [rows, selected, rowKey],
  );

  const toggleAll = () => {
    if (!onSelectAll) return;
    const ids = rows.map(rowKey);
    onSelectAll(allSelected ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  };

  const toggleRow = (id) => {
    if (!onSelect) return;
    onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div className={clsx('overflow-hidden', className)}>
      {(toolbar || actions) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-line)] p-4">
          {toolbar}
          {actions && <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}

      <div className="max-h-[62vh] overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 42 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={clsx(col.align === 'end' && 'text-end', col.align === 'center' && 'text-center')}
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.sortKey || col.key)}
                      className="inline-flex items-center gap-1 transition hover:text-[var(--color-ink)]"
                    >
                      {col.header}
                      {sortBy === (col.sortKey || col.key) &&
                        (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="py-14 text-center">
                  <Spinner size={20} className="mx-auto text-[var(--color-muted)]" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)}>
                  <EmptyState title={emptyTitle} hint={emptyHint} icon={emptyIcon} />
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const id = rowKey(row);
                return (
                  <tr key={id} className={clsx(rowClassName?.(row), selected.includes(id) && 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]')}>
                    {selectable && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(id)}
                          onChange={() => toggleRow(id)}
                          aria-label="Select row"
                          className="h-3.5 w-3.5 accent-[var(--accent)]"
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className={clsx(col.align === 'end' && 'text-end', col.align === 'center' && 'text-center', col.className)}>
                        {col.render ? col.render(row) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] px-4 py-3 text-[12px] text-[var(--color-muted)]">
          <span className="no-urdu">
            {from}-{to} / {total}
          </span>
          <div className="flex items-center gap-2">
            {onPageSizeChange && (
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="h-8 rounded-lg border border-[var(--color-line)] bg-[var(--glass)] px-2 text-[12px]"
                aria-label="Rows per page"
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn btn-sm"
              disabled={page <= 1}
              onClick={() => onPageChange?.(page - 1)}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="no-urdu px-1">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={page >= pageCount}
              onClick={() => onPageChange?.(page + 1)}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small helper so pages can build filter toolbars consistently. */
export function TableSearch({ value, onChange, placeholder }) {
  return (
    <div className="min-w-[220px] flex-1">
      <Input icon={Search} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export default DataTable;