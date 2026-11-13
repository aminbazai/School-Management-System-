import clsx from 'clsx';

/** Pulsing placeholder used while real numbers arrive with the reports module. */
export function Skeleton({ className, width = 'w-16', height = 'h-7' }) {
  return (
    <span
      className={clsx('inline-block animate-pulse rounded-lg bg-[var(--glass-2)]', width, height, className)}
      aria-hidden="true"
    />
  );
}

export default Skeleton;