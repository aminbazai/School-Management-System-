import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Check, CheckCheck, Save, RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Input } from '../ui/Form';

const STATUSES = ['present', 'absent', 'leave', 'late', 'half_day'];

const TONE = {
  present: 'text-[var(--color-ok)] border-[color-mix(in_srgb,var(--color-ok)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-ok)_14%,transparent)]',
  absent: 'text-[var(--color-danger)] border-[color-mix(in_srgb,var(--color-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)]',
  leave: 'text-[var(--color-warn)] border-[color-mix(in_srgb,var(--color-warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_14%,transparent)]',
  late: 'text-[var(--color-warn)] border-[color-mix(in_srgb,var(--color-warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)]',
  half_day: 'text-[var(--color-info)] border-[color-mix(in_srgb,var(--color-info)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-info)_12%,transparent)]',
};

/**
 * Shared attendance grid used by admin, office and teacher screens.
 * Status buttons (not selects) keep marking fast on a touch/click basis.
 */
export function MarkingGrid({
  students = [],
  marks,
  onChange,
  disabled = false,
  showRemarks = true,
  bulkPresent = true,
  onMarkAll,
  onSave,
  saving = false,
  summary,
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState({});

  // reset local state whenever the roster changes
  useEffect(() => {
    const next = {};
    students.forEach((s) => {
      next[s.id] = { status: s.status || '', remarks: s.remarks || '' };
    });
    setRows(next);
  }, [students]);

  const entries = useMemo(
    () => students.map((s) => ({ studentId: s.id, status: rows[s.id]?.status || '', remarks: rows[s.id]?.remarks || '' })),
    [students, rows],
  );

  const dirty = useMemo(
    () =>
      students.some((s) => (rows[s.id]?.status || '') !== (s.status || '') || (rows[s.id]?.remarks || '') !== (s.remarks || '')),
    [students, rows],
  );

  const setStatus = (id, status) => setRows((prev) => ({ ...prev, [id]: { ...prev[id], status } }));

  const setRemark = (id, remarks) => setRows((prev) => ({ ...prev, [id]: { ...prev[id], remarks } }));

  const counts = useMemo(() => {
    const acc = { present: 0, absent: 0, leave: 0, late: 0, half_day: 0, unmarked: 0 };
    students.forEach((s) => {
      const status = rows[s.id]?.status;
      if (status && acc[status] !== undefined) acc[status] += 1;
      else acc.unmarked += 1;
    });
    return acc;
  }, [students, rows]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
        {STATUSES.map((status) => (
          <Badge key={status} tone={status === 'present' ? 'ok' : status === 'absent' ? 'danger' : 'warn'} className="capitalize">
            {t(`attendance.${status}`)}: <span className="no-urdu ms-1">{counts[status]}</span>
          </Badge>
        ))}
        <Badge tone={counts.unmarked ? 'danger' : 'ok'}>
          {t('attendance.unmarked')}: <span className="no-urdu ms-1">{counts.unmarked}</span>
        </Badge>

        <div className="ms-auto flex items-center gap-2">
          {bulkPresent && onMarkAll && (
            <Button size="sm" icon={CheckCheck} onClick={onMarkAll} disabled={disabled}>
              {t('attendance.markAllPresent')}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setRows({})} disabled={disabled}>
            {t('common.reset')}
          </Button>
          {onSave && (
            <Button
              size="sm"
              variant="primary"
              icon={Save}
              disabled={disabled || !dirty}
              loading={saving}
              onClick={() => onSave(entries)}
            >
              {t('attendance.save')}
            </Button>
          )}
        </div>
      </div>

      <div className="max-h-[58vh] overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 46 }}>#</th>
              <th>{t('common.name')}</th>
              <th>{t('students.admissionNo')}</th>
              <th style={{ width: 380 }}>{t('attendance.status')}</th>
              {showRemarks && <th style={{ width: 220 }}>{t('attendance.remarks')}</th>}
            </tr>
          </thead>
          <tbody>
            {students.length === 0 ? (
              <tr>
                <td colSpan={showRemarks ? 5 : 4} className="py-10 text-center text-[13px] text-[var(--color-dim)]">
                  {t('common.noData')}
                </td>
              </tr>
            ) : (
              students.map((student, index) => {
                const current = rows[student.id]?.status || '';
                return (
                  <tr key={student.id}>
                    <td className="no-urdu text-[var(--color-dim)]">{index + 1}</td>
                    <td>
                      <span className="font-medium text-[var(--color-ink)]">{student.name}</span>
                      {student.roll_no && (
                        <span className="no-urdu ms-2 text-[11px] text-[var(--color-dim)]">#{student.roll_no}</span>
                      )}
                    </td>
                    <td className="no-urdu text-[12px]">{student.admission_no}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {STATUSES.map((status) => (
                          <button
                            key={status}
                            type="button"
                            disabled={disabled}
                            onClick={() => setStatus(student.id, current === status ? '' : status)}
                            title={t(`attendance.${status}`)}
                            className={clsx(
                              'flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[12px] font-medium transition disabled:cursor-not-allowed',
                              current === status ? TONE[status] : 'border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-line2)]',
                            )}
                          >
                            {current === status && <Check size={12} />}
                            {t(`attendance.${status}`)}
                          </button>
                        ))}
                      </div>
                    </td>
                    {showRemarks && (
                      <td>
                        <Input
                          value={rows[student.id]?.remarks || ''}
                          disabled={disabled}
                          onChange={(e) => setRemark(student.id, e.target.value)}
                          placeholder="-"
                        />
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {summary && (
        <div className="border-t border-[var(--color-line)] px-4 py-2 text-[11.5px] text-[var(--color-dim)]">
          {t('attendance.alreadyMarked', { count: students.filter((s) => s.status).length, total: students.length })}
        </div>
      )}
    </div>
  );
}

export { STATUSES };
export default MarkingGrid;