import clsx from 'clsx';

export function PageHeader({ title, subtitle, actions, className, children }) {
  return (
    <div className={clsx('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-[var(--color-ink)]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children}
    </div>
  );
}

export default PageHeader;