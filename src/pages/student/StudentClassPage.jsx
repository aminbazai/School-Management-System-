import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, BookOpen, UserCheck, IdCard, Phone, CalendarDays, History } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, PanelHeader } from '../../components/ui/Panel';
import { Badge } from '../../components/ui/Badge';
import { Loading, EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { formatDate } from '../../utils/format';

/**
 * Read-only student pages. The record is resolved in the main process from
 * users.linked_id - the renderer cannot ask for anybody else's data.
 */
export function StudentClassPage({ mode = 'class' }) {
  const { t, i18n } = useTranslation();
  const { settings } = useAuth();
  const toast = useToast();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.students
      .me()
      .then((data) => active && setMe(data))
      .catch((err) => {
        if (active) {
          toast.error(t(errorKey(err)));
          setMe({ empty: true });
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Loading label={t('common.loading')} />;
  if (!me || me.empty) return <EmptyState title={t('common.noData')} />;

  const lang = i18n.resolvedLanguage || 'en';

  const details = [
    { label: t('students.admissionNo'), value: me.admissionNo, mono: true },
    { label: t('students.grNo'), value: me.grNo || '-', mono: true },
    { label: t('students.fatherName'), value: me.fatherName || '-' },
    { label: t('students.gender'), value: me.gender ? t(`students.${me.gender}`) : '-' },
    { label: t('students.dob'), value: me.dob ? formatDate(me.dob, lang) : '-', mono: true },
    { label: t('students.bForm'), value: me.bForm || '-', mono: true },
    { label: t('students.phone'), value: me.phone || '-', mono: true },
    { label: t('students.admissionDate'), value: me.admissionDate ? formatDate(me.admissionDate, lang) : '-' },
    { label: t('students.previousSchool'), value: me.previousSchool || '-' },
    { label: t('students.address'), value: me.address || '-', span: true },
  ];

  return (
    <>
      <PageHeader
        title={mode === 'profile' ? t('nav.student.profile') : t('nav.student.class')}
        subtitle={mode === 'profile' ? t('student.profileSubtitle') : t('student.classSubtitle')}
        actions={<Badge tone="accent" dot>{t('roles.student')}</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-[var(--accent-2)] to-[var(--accent)] text-[20px] font-semibold text-white">
                {me.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-[18px] font-semibold tracking-tight">{me.name}</h2>
                <p className="no-urdu text-[12.5px] text-[var(--color-muted)]">{me.admissionNo}</p>
              </div>
              <div className="ms-auto flex flex-col items-end gap-1.5">
                <Badge tone="accent">
                  {me.className || '-'} {me.sectionName || ''}
                </Badge>
                <Badge tone={me.status === 'active' ? 'ok' : 'neutral'}>{t(`common.${me.status}`)}</Badge>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t('students.sectionPersonal')} />
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {details.map((item) => (
                <div key={item.label} className={item.span ? 'sm:col-span-2' : ''}>
                  <p className="text-[11.5px] text-[var(--color-dim)]">{item.label}</p>
                  <p className={`mt-0.5 text-[13px] text-[var(--color-ink2)] ${item.mono ? 'no-urdu' : ''}`}>{item.value}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title={t('classes.subjects')} actions={<BookOpen size={15} className="text-[var(--color-dim)]" />} />
            {me.subjects?.length ? (
              <ul className="divide-y divide-[var(--color-line)]">
                {me.subjects.map((subject) => (
                  <li key={subject.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-[13px] text-[var(--color-ink2)]">{subject.name}</span>
                    <span className="no-urdu text-[11.5px] text-[var(--color-dim)]">
                      {subject.max_marks} / {subject.pass_marks}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={t('common.noData')} />
            )}
          </Panel>

          <Panel>
            <PanelHeader title={t('student.teachers')} actions={<UserCheck size={15} className="text-[var(--color-dim)]" />} />
            {me.teachers?.length ? (
              <ul className="divide-y divide-[var(--color-line)]">
                {me.teachers.map((teacher) => (
                  <li key={`${teacher.id}-${teacher.subject_name}`} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--glass-2)] text-[11px] font-semibold text-[var(--color-muted)]">
                      {teacher.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-[var(--color-ink2)]">{teacher.name}</p>
                      <p className="truncate text-[11px] text-[var(--color-dim)]">{teacher.subject_name || '-'}</p>
                    </div>
                    {teacher.phone && (
                      <span className="no-urdu flex items-center gap-1 text-[11px] text-[var(--color-dim)]">
                        <Phone size={11} />
                        {teacher.phone}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={t('common.noData')} />
            )}
          </Panel>

          {me.siblings?.length > 0 && (
            <Panel>
              <PanelHeader title={t('student.siblings')} actions={<Users size={15} className="text-[var(--color-dim)]" />} />
              <ul className="divide-y divide-[var(--color-line)]">
                {me.siblings.map((sibling) => (
                  <li key={sibling.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-[13px] text-[var(--color-ink2)]">{sibling.name}</span>
                    <span className="no-urdu text-[11.5px] text-[var(--color-dim)]">{sibling.admission_no}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel>
            <PanelHeader title={t('students.classHistory')} actions={<History size={15} className="text-[var(--color-dim)]" />} />
            {me.classHistory?.length ? (
              <ul className="divide-y divide-[var(--color-line)]">
                {me.classHistory.map((h, index) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-[var(--color-ink2)]">
                        {h.className || '-'}
                        {h.sectionName ? ` - ${h.sectionName}` : ''}
                      </p>
                      <p className="text-[11px] text-[var(--color-dim)]">
                        {h.changedAt ? formatDate(h.changedAt, lang) : '-'}
                        {' · '}
                        {h.note === 'Admission'
                          ? t('students.noteAdmission')
                          : h.note === 'Promoted'
                            ? t('students.notePromoted')
                            : h.note === 'Class updated'
                              ? t('students.noteClassUpdated')
                              : h.note || '-'}
                      </p>
                    </div>
                    {index === 0 && <Badge tone="accent">{t('students.currentClass')}</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={t('students.noHistory')} />
            )}
          </Panel>

          <Panel className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)]">
              <CalendarDays size={17} />
            </div>
            <div>
              <p className="text-[12.5px] text-[var(--color-ink2)]">{t('student.session')}</p>
              <p className="text-[11.5px] text-[var(--color-dim)]">{settings?.session}</p>
            </div>
            <IdCard size={15} className="ms-auto text-[var(--color-dim)]" />
          </Panel>
        </div>
      </div>
    </>
  );
}

export default StudentClassPage;