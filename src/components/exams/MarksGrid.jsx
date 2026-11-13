import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Lock, Save, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import api, { errorKey } from '../../lib/api';
import { Button, Spinner } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/States';
import { useToast } from '../ui/Toast';
import { ProgressBar } from '../ui/Panel';

/**
 * Paper-wise marks entry.
 *
 * The grid is intentionally plain - one row per student, one box per subject
 * column. Progress and the out-of-total hint sit above it so a teacher can see
 * at a glance how far the paper is from complete before saving.
 *
 * `canEdit` is false when the exam is not open or when the signed-in teacher
 * does not teach this subject; the boxes become read-only rather than hidden,
 * so the sheet still shows what has been entered.
 */
export function MarksGrid({ examSubjectId, canEdit, onSaved }) {
  const { t } = useTranslation();
  const toast = useToast();

  const [sheet, setSheet] = useState(null);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!examSubjectId) {
      setSheet(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    api.exams
      .markSheet({ examSubjectId })
      .then((data) => {
        if (cancelled) return;
        setSheet(data);
        const next = {};
        for (const row of data.rows) next[row.studentId] = row.marksObtained ?? '';
        setDraft(next);
      })
      .catch((err) => {
        if (!cancelled) toast.error(t(errorKey(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [examSubjectId, t, toast]);

  const entered = useMemo(() => {
    if (!sheet) return 0;
    return Object.values(draft).filter((value) => value !== '' && value !== null && value !== undefined).length;
  }, [draft, sheet]);

  const changed = useMemo(() => {
    if (!sheet) return false;
    return sheet.rows.some((row) => {
      const before = row.marksObtained ?? '';
      return String(draft[row.studentId] ?? '') !== String(before);
    });
  }, [draft, sheet]);

  const outOfRange = useMemo(() => {
    if (!sheet?.subject) return [];
    const max = Number(sheet.subject.totalMarks) || 0;
    return sheet.rows.filter((row) => {
      const value = draft[row.studentId];
      if (value === '' || value === null || value === undefined) return false;
      const n = Number(value);
      return Number.isNaN(n) || n < 0 || n > max;
    });
  }, [draft, sheet]);

  const save = async () => {
    if (!sheet || !canEdit) return;
    if (outOfRange.length > 0) {
      toast.error(t('exams.markOutOfRange', { total: sheet.subject.totalMarks }));
      return;
    }
    setBusy(true);
    try {
      const marks = sheet.rows.map((row) => ({
        studentId: row.studentId,
        marksObtained: draft[row.studentId] === '' ? null : Number(draft[row.studentId]),
      }));
      const data = await api.exams.saveMarks({ examSubjectId, marks });
      setSheet(data);
      const next = {};
      for (const row of data.rows) next[row.studentId] = row.marksObtained ?? '';
      setDraft(next);
      toast.success(t('exams.marksSaved'));
      onSaved?.();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size={22} className="text-[var(--color-muted)]" />
      </div>
    );
  }

  if (!sheet?.subject) {
    return (
      <EmptyState
        icon={Lock}
        title={t('exams.noPapers')}
        hint={t('exams.noPapersHint')}
        className="py-10"
      />
    );
  }

  const total = sheet.rows.length;
  const percent = total ? Math.round((entered / total) * 100) : 0;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[180px] flex-1">
          <p className="eyebrow">{t('exams.subject')}</p>
          <p className="text-[15px] font-semibold text-[var(--color-ink)]">{sheet.subject.subjectName}</p>
        </div>
        <div className="min-w-[180px] flex-1">
          <p className="eyebrow">{t('exams.entered')}</p>
          <div className="mt-2 flex items-center gap-3">
            <ProgressBar value={percent} tone={percent === 100 ? 'ok' : 'accent'} className="flex-1" />
            <span className="no-urdu text-[12.5px] text-[var(--color-muted)]">
              {entered}/{total}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit ? (
            <>
              <Button icon={Save} variant="primary" loading={busy} disabled={!changed} onClick={save}>
                {t('exams.saveMarks')}
              </Button>
            </>
          ) : (
            <Badge tone="neutral">{t('exams.readOnly')}</Badge>
          )}
        </div>
      </div>

      {outOfRange.length > 0 && (
        <p className="mb-3 flex items-center gap-2 text-[12.5px] text-[var(--color-danger)]">
          <TriangleAlert size={14} />
          {t('exams.outOf', { total: sheet.subject.totalMarks })}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>{t('students.rollNo')}</th>
              <th>{t('common.name')}</th>
              <th>{t('students.admissionNo')}</th>
              <th>{t('timetable.section')}</th>
              <th className="text-end" style={{ width: 140 }}>
                {sheet.subject.subjectName}
                <span className="block text-[10.5px] font-normal text-[var(--color-dim)]">
                  {t('exams.outOf', { total: sheet.subject.totalMarks })}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row) => {
              const value = draft[row.studentId] ?? '';
              const invalid =
                value !== '' && (Number(value) < 0 || Number(value) > Number(sheet.subject.totalMarks));
              return (
                <tr key={row.studentId}>
                  <td className="no-urdu text-[var(--color-muted)]">{row.rollNo || '-'}</td>
                  <td className="font-medium text-[var(--color-ink)]">{row.name}</td>
                  <td className="no-urdu text-[var(--color-muted)]">{row.admissionNo}</td>
                  <td className="text-[var(--color-muted)]">{row.sectionName || '-'}</td>
                  <td>
                    <input
                      type="number"
                      className={clsx('input h-9 text-end', invalid && 'input-error')}
                      value={value}
                      min={0}
                      max={sheet.subject.totalMarks}
                      step="0.5"
                      disabled={!canEdit}
                      aria-label={`${sheet.subject.subjectName} - ${row.name}`}
                      onChange={(e) => setDraft({ ...draft, [row.studentId]: e.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-[var(--color-dim)]">
        <Check size={13} />
        {t('exams.markHint')}
      </p>
    </div>
  );
}

/** Horizontal list of the exam's papers, each showing how complete it is. */
export function PaperTabs({ subjects = [], activeId, onSelect, canEnterFor }) {
  const { t } = useTranslation();

  if (subjects.length === 0) {
    return <p className="py-3 text-[12.5px] text-[var(--color-dim)]">{t('exams.noPapers')}</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {subjects.map((subject) => {
        const done = subject.studentCount > 0 && subject.enteredCount >= subject.studentCount;
        const allowed = canEnterFor ? canEnterFor(subject) : subject.canEnter;
        const active = subject.id === activeId;

        return (
          <button
            key={subject.id}
            type="button"
            onClick={() => onSelect(subject.id)}
            className={clsx('btn btn-sm', active && 'btn-primary')}
            title={allowed ? undefined : t('exams.readOnly')}
          >
            {subject.subjectName}
            <span className={clsx('no-urdu text-[10.5px]', done ? 'text-[var(--color-ok)]' : 'opacity-70')}>
              {subject.enteredCount}/{subject.studentCount}
            </span>
            {allowed && <span className="text-[10px] opacity-60">{t('exams.enterMarks')}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default MarksGrid;