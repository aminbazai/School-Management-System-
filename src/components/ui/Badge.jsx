import clsx from 'clsx';

const TONES = {
  neutral: 'text-[var(--color-muted)]',
  accent: 'text-[var(--accent)]',
  ok: 'text-[var(--color-ok)]',
  warn: 'text-[var(--color-warn)]',
  danger: 'text-[var(--color-danger)]',
  info: 'text-[var(--color-info)]',
};

export function Badge({ tone = 'neutral', dot = false, children, className }) {
  return (
    <span className={clsx('chip', TONES[tone], className)}>
      {dot && <span className="chip-dot" />}
      {children}
    </span>
  );
}

const STATUS_TONE = {
  active: 'ok',
  present: 'ok',
  paid: 'ok',
  published: 'ok',
  approved: 'ok',
  inactive: 'neutral',
  left: 'neutral',
  cancelled: 'neutral',
  draft: 'neutral',
  generated: 'info',
  absent: 'danger',
  unpaid: 'danger',
  locked: 'danger',
  leave: 'warn',
  late: 'warn',
  partial: 'warn',
  pending: 'warn',
  on_leave: 'warn',
  passed_out: 'info',
  half_day: 'info',
  marks_open: 'info',
};

export function StatusBadge({ status, className }) {
  const tone = STATUS_TONE[status] || 'neutral';
  return (
    <Badge tone={tone} dot className={className}>
      <span className="capitalize">{String(status ?? '').replace(/_/g, ' ')}</span>
    </Badge>
  );
}

export default Badge;