import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { CalendarDays, Coffee, Pencil } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/States';
import { Skeleton } from '../ui/Skeleton';

/**
 * The weekly grid, periods down the side and days across.
 *
 * `mode="edit"` renders a subject/teacher picker in every cell (admin only);
 * `mode="view"` renders the lesson. Both share the same markup so what an
 * admin edits is exactly what everyone else reads.
 *
 * The shape comes from the main process: `data.grid` is one entry per period,
 * each holding the period itself and the day cells for that period
 * (`{ period, days: [{ day, slot }] }`).
 */
export function TimetableGrid({ data, loading, mode = 'view', onCellClick }) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} width="w-full" height="h-14" />
        ))}
      </div>
    );
  }

  if (!data?.periods?.length) {
    return <EmptyState icon={CalendarDays} title={t('timetable.noPeriods')} hint={t('timetable.noPeriodsHint')} />;
  }

  if (!data.slots?.length) {
    return <EmptyState icon={CalendarDays} title={t('timetable.emptyGrid')} hint={t('timetable.emptyGridHint')} />;
  }

  // Sunday is the school's holiday in the seed data, so it is left out of the
  // working week unless a lesson actually sits there.
  const days = data.days.filter((day) => day.value !== 0 || data.slots.some((slot) => slot.dayOfWeek === day.value));

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 150 }}>{t('timetable.period')}</th>
            {days.map((day) => (
              <th key={day.value} className="text-center">
                {t(`weekday.${day.key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data.grid || []).map((row) => {
            const period = row.period;
            return (
              <tr key={period.id}>
                <td>
                  <p className="text-[12.5px] font-medium text-[var(--color-ink)]">{period.name}</p>
                  <p className="no-urdu text-[11px] text-[var(--color-dim)]">
                    {period.startTime} – {period.endTime}
                  </p>
                </td>

                {days.map((day) => {
                  const cell = row.days.find((d) => d.day.value === day.value);
                  const slot = cell?.slot;

                  if (period.isBreak) {
                    return (
                      <td key={day.value} className="bg-[var(--glass)] text-center">
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--color-dim)]">
                          <Coffee size={12} />
                          {t('timetable.lunch')}
                        </span>
                      </td>
                    );
                  }

                  if (!slot) {
                    return (
                      <td key={day.value} className="text-center">
                        {mode === 'edit' ? (
                          <button
                            type="button"
                            onClick={() => onCellClick?.(day.value, period.id, null)}
                            className="w-full rounded-lg border border-dashed border-[var(--color-line)] px-2 py-2 text-[11.5px] text-[var(--color-dim)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          >
                            {t('timetable.notAssigned')}
                          </button>
                        ) : (
                          <span className="text-[11.5px] text-[var(--color-dim)]">—</span>
                        )}
                      </td>
                    );
                  }

                  return (
                    <td key={day.value}>
                      {mode === 'edit' ? (
                        <button
                          type="button"
                          onClick={() => onCellClick?.(day.value, period.id, slot)}
                          className="group flex w-full flex-col items-start gap-0.5 rounded-lg border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-2 py-1.5 text-start transition hover:border-[var(--accent)]"
                        >
                          <span className="flex w-full items-center gap-1 text-[12.5px] font-medium text-[var(--color-ink)]">
                            <span className="truncate">{slot.subjectName || t('timetable.notAssigned')}</span>
                            <Pencil
                              size={11}
                              className="ms-auto shrink-0 opacity-0 transition group-hover:opacity-60"
                            />
                          </span>
                          {slot.teacherName && (
                            <span className="truncate text-[11px] text-[var(--color-muted)]">{slot.teacherName}</span>
                          )}
                        </button>
                      ) : (
                        <div
                          className={clsx(
                            'rounded-lg px-2 py-1.5',
                            slot.subjectId
                              ? 'border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]'
                              : '',
                          )}
                        >
                          <p className="truncate text-[12.5px] font-medium text-[var(--color-ink)]">
                            {slot.subjectName || t('timetable.free')}
                          </p>
                          {slot.teacherName && (
                            <p className="truncate text-[11px] text-[var(--color-muted)]">{slot.teacherName}</p>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Week-at-a-glance summary shown above every timetable. */
export function TimetableSummary({ data }) {
  const { t } = useTranslation();
  if (!data) return null;

  const perDay = data.days.map((day) => ({
    ...day,
    count: data.slots.filter((slot) => slot.dayOfWeek === day.value).length,
  }));
  const busiest = perDay.reduce((best, day) => (day.count > (best?.count ?? -1) ? day : best), null);
  const subjects = new Set(data.slots.map((slot) => slot.subjectId).filter(Boolean));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="accent">{t('timetable.lessons', { count: data.slots.length })}</Badge>
      <Badge tone="neutral">
        {t('exams.subject')}: {subjects.size}
      </Badge>
      {busiest?.count > 0 && (
        <Badge tone="info">
          {t(`weekday.${busiest.key}`)}: {busiest.count}
        </Badge>
      )}
    </div>
  );
}

export default TimetableGrid;