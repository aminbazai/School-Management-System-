import clsx from 'clsx';
import { Inbox } from 'lucide-react';
import { Spinner } from './Button';

export function Loading({ label, className }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-3 py-16 text-[var(--color-muted)]', className)}>
      <Spinner size={22} />
      {label && <p className="text-[13px]">{label}</p>}
    </div>
  );
}

export function EmptyState({ title, hint, icon: Icon = Inbox, action, className }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--color-line)] bg-[var(--glass-2)] text-[var(--color-dim)]">
        <Icon size={20} />
      </div>
      <div>
        <p className="text-[14px] font-medium text-[var(--color-ink2)]">{title}</p>
        {hint && <p className="mt-1 text-[12.5px] text-[var(--color-dim)]">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export default EmptyState;