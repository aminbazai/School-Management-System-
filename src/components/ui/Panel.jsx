import clsx from 'clsx';
import { MoreVertical } from 'lucide-react';

export function Panel({ className, children, padded = true, ...rest }) {
  return (
    <section className={clsx('panel', padded && 'p-5', className)} {...rest}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, subtitle, actions, className }) {
  return (
    <header className={clsx('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h3 className="panel-title truncate">{title}</h3>
        {subtitle && <p className="mt-1 text-[12.5px] text-[var(--color-muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Stat card in the style of the reference design: eyebrow label, large value,
 * optional trend chip and a slot for a sparkline / ring chart.
 */
export function StatCard({ label, value, hint, trend, icon: Icon, children, className, menu = true }) {
  return (
    <section className={clsx('panel animate-in p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow truncate">{label}</p>
        <div className="flex items-center gap-1.5">
          {Icon && <Icon size={14} className="text-[var(--color-dim)]" />}
          {menu && (
            <button type="button" className="text-[var(--color-dim)] transition hover:text-[var(--color-ink)]">
              <MoreVertical size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[26px] font-semibold leading-none tracking-tight text-[var(--color-ink)]">
            {value}
          </div>
          {hint && <p className="mt-2 truncate text-[11.5px] text-[var(--color-dim)]">{hint}</p>}
        </div>
        {trend && (
          <span
            className={clsx(
              'chip no-urdu',
              trend.direction === 'up' && 'text-[var(--color-ok)]',
              trend.direction === 'down' && 'text-[var(--color-danger)]',
              trend.direction === 'flat' && 'text-[var(--color-muted)]',
            )}
          >
            {trend.value}
          </span>
        )}
      </div>

      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

export function ProgressBar({ value = 0, tone = 'accent', className }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const color =
    tone === 'ok' ? 'var(--color-ok)' : tone === 'warn' ? 'var(--color-warn)' : tone === 'danger' ? 'var(--color-danger)' : 'var(--accent)';
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-line)]', className)}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default Panel;