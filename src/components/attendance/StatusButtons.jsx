import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

const TONE = {
  present: 'text-[var(--color-ok)] border-[color-mix(in_srgb,var(--color-ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-ok)_14%,transparent)]',
  absent: 'text-[var(--color-danger)] border-[color-mix(in_srgb,var(--color-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)]',
  leave: 'text-[var(--color-warn)] border-[color-mix(in_srgb,var(--color-warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_14%,transparent)]',
  late: 'text-[var(--color-warn)] border-[color-mix(in_srgb,var(--color-warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)]',
  half_day: 'text-[var(--color-info)] border-[color-mix(in_srgb,var(--color-info)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-info)_12%,transparent)]',
};

/** Compact status selector used by the staff attendance grid. */
export function StatusButtons({ value, onChange, statuses = ['present', 'absent', 'leave', 'late', 'half_day'], disabled = false, size = 'md' }) {
  const { t } = useTranslation();

  return (
    <div className={clsx('flex flex-wrap gap-1.5', size === 'sm' && 'gap-1')}>
      {statuses.map((status) => {
        const active = value === status;
        return (
          <button
            key={status}
            type="button"
            disabled={disabled}
            onClick={() => onChange(active ? '' : status)}
            title={t(`attendance.${status}`)}
            className={clsx(
              'flex items-center gap-1 rounded-lg border font-medium transition disabled:cursor-not-allowed',
              size === 'sm' ? 'h-7 px-2 text-[11px]' : 'h-8 px-2.5 text-[12px]',
              active ? TONE[status] : 'border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-line2)]',
            )}
          >
            {active && <Check size={12} />}
            {t(`attendance.${status}`)}
          </button>
        );
      })}
    </div>
  );
}

export default StatusButtons;