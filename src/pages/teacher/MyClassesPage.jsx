import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { School, Layers, Users, BookOpen, UsersRound } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, StatCard } from '../../components/ui/Panel';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { DataTable } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Form';
import { EmptyState } from '../../components/ui/States';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';

/**
 * Teacher > My Classes.
 *
 * Everything on this screen comes from `structure.get`, which the main process
 * already narrows to the teacher's own assignments - so a teacher cannot see a
 * class they do not hold, and the page never has to filter for itself.
 */
export function MyClassesPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [structure, setStructure] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [rosterTarget, setRosterTarget] = useState(null);
  const [roster, setRoster] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setStructure(await api.structure.get());
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  /** The subject a teacher holds for a given class, from their assignments. */
  const subjectsForClass = useCallback(
    (classId) => {
      const names = (structure?.assignments || [])
        .filter((a) => a.classId === Number(classId) && a.subjectName)
        .map((a) => a.subjectName);
      return [...new Set(names)];
    },
    [structure],
  );

  const sections = useMemo(() => {
    const rows = structure?.sections || [];
    if (!search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter(
      (s) =>
        (s.name || '').toLowerCase().includes(needle) ||
        (s.class_name || '').toLowerCase().includes(needle) ||
        subjectsForClass(s.class_id).some((name) => name.toLowerCase().includes(needle)),
    );
  }, [structure, search, subjectsForClass]);

  const totals = useMemo(() => {
    const rows = structure?.sections || [];
    return {
      classes: (structure?.classes || []).length,
      sections: rows.length,
      students: rows.reduce((sum, s) => sum + (s.student_count || 0), 0),
      subjects: new Set((structure?.assignments || []).map((a) => a.subjectId).filter(Boolean)).size,
    };
  }, [structure]);

  /** The roster is loaded per section, and only for sections the teacher holds. */
  const openRoster = async (section) => {
    setRosterTarget(section);
    setRoster(null);
    setRosterLoading(true);
    try {
      const data = await api.students.list({
        classId: section.class_id,
        sectionId: section.id,
        pageSize: 200,
        sortBy: 'roll_no',
        sortDir: 'asc',
      });
      setRoster(data);
    } catch (err) {
      toast.error(t(errorKey(err)));
      setRosterTarget(null);
    } finally {
      setRosterLoading(false);
    }
  };

  const columns = [
    {
      key: 'class_name',
      header: t('students.class'),
      sortable: true,
      render: (r) => (
        <div>
          <div className="font-medium">{r.class_name}</div>
          <div className="no-urdu text-[11.5px] text-[var(--color-dim)]">{r.room_no || t('classes.room')}</div>
        </div>
      ),
    },
    {
      key: 'name',
      header: t('students.section'),
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{r.name}</span>
          {r.class_teacher_name && <Badge>{t('classes.classTeacher')}</Badge>}
        </div>
      ),
    },
    {
      key: 'subjects',
      header: t('myClasses.subjectsTaught'),
      render: (r) => {
        const names = subjectsForClass(r.class_id);
        if (!names.length) return <span className="text-[var(--color-dim)]">-</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {names.map((name) => (
              <Badge key={name} tone="accent">
                {name}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: 'student_count',
      header: t('classes.enrolled'),
      align: 'center',
      render: (r) => `${r.student_count || 0} / ${r.capacity || '-'}`,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      align: 'end',
      render: (r) => (
        <Button size="sm" icon={UsersRound} onClick={() => openRoster(r)}>
          {t('myClasses.viewRoster')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('nav.teacher.classes')}
        subtitle={t('myClasses.subtitle')}
        actions={
          <div className="w-[220px]">
            <Input
              placeholder={t('common.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('students.class')} value={loading ? <Skeleton /> : totals.classes} icon={School} />
        <StatCard label={t('classes.sections')} value={loading ? <Skeleton /> : totals.sections} icon={Layers} />
        <StatCard label={t('classes.enrolled')} value={loading ? <Skeleton /> : totals.students} icon={Users} />
        <StatCard label={t('myClasses.subjectsTaught')} value={loading ? <Skeleton /> : totals.subjects} icon={BookOpen} />
      </div>

      <Panel className="mt-4" padded={false}>
        {loading ? (
          <div className="p-6">
            <Skeleton />
          </div>
        ) : sections.length === 0 ? (
          <EmptyState
            icon={School}
            title={search ? t('common.noData') : t('myClasses.noClasses')}
            hint={search ? t('common.noDataHint') : t('myClasses.noClassesHint')}
          />
        ) : (
          <DataTable
            rows={sections}
            total={sections.length}
            columns={columns}
            rowKey={(row) => row.id}
            emptyTitle={t('common.noData')}
          />
        )}
      </Panel>

      <Modal
        open={Boolean(rosterTarget)}
        onClose={() => setRosterTarget(null)}
        title={
          rosterTarget ? `${rosterTarget.class_name} - ${t('students.section')} ${rosterTarget.name}` : ''
        }
        subtitle={t('myClasses.rosterSubtitle')}
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setRosterTarget(null)}>
            {t('common.close')}
          </Button>
        }
      >
        {rosterLoading ? (
          <div className="p-6">
            <Skeleton />
          </div>
        ) : (roster?.rows || []).length === 0 ? (
          <EmptyState icon={Users} title={t('common.noData')} />
        ) : (
          <DataTable
            rows={roster.rows}
            total={roster.total}
            columns={[
              { key: 'rollNo', header: t('students.rollNo'), className: 'no-urdu' },
              { key: 'name', header: t('common.name'), sortable: true },
              { key: 'admissionNo', header: t('students.admissionNo'), className: 'no-urdu' },
              { key: 'fatherName', header: t('students.fatherName') },
              { key: 'phone', header: t('students.phone'), className: 'no-urdu', render: (r) => r.phone || '-' },
            ]}
            rowKey={(row) => row.id}
            emptyTitle={t('common.noData')}
          />
        )}
      </Modal>
    </>
  );
}

export default MyClassesPage;
