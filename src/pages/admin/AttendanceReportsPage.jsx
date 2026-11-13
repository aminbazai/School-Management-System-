import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserX, Download, TrendingDown } from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useStructure } from '../../hooks/useStructure';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, ProgressBar } from '../../components/ui/Panel';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Form';
import { DataTable, TableSearch } from '../../components/ui/DataTable';
import { useToast } from '../../components/ui/Toast';

const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Attendance reports: students below the threshold and a printable list.
 * Teachers see only their own classes (the service enforces it).
 */
export function AttendanceReportsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { structure } = useStructure();
  const [month, setMonth] = useState(thisMonth());
  const [classId, setClassId] = useState('');
  const [threshold, setThreshold] = useState(75);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.attendance
      .low({ month, classId: classId || undefined, threshold })
      .then((data) => active && setRows(data))
      .catch((err) => {
        if (active) {
          toast.error(t(errorKey(err)));
          setRows([]);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [month, classId, threshold, t, toast]);

  const filtered = useMemo(
    () => (search ? rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase())) : rows),
    [rows, search],
  );

  const exportCsv = () => {
    const header = ['Name', 'Admission No', 'Class', 'Section', 'Present', 'Absent', 'Late', 'Percentage'];
    const lines = filtered.map((r) =>
      [r.name, r.admissionNo, r.className, r.sectionName, r.present, r.absent, r.late, `${r.percentage}%`].join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-low-${month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t('attendance.exported'));
  };

  return (
    <>
      <PageHeader
        title={t('attendance.reportsTitle')}
        subtitle={t('attendance.reportsSubtitle')}
        actions={
          <Button icon={Download} onClick={exportCsv} disabled={filtered.length === 0}>
            CSV
          </Button>
        }
      />

      <Panel className="mb-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Input label={t('settings.session')} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <Select
            label={t('students.class')}
            value={classId}
            placeholder={t('students.allClasses')}
            options={(structure?.classes || []).map((c) => ({ value: String(c.id), label: c.name }))}
            onChange={(e) => setClassId(e.target.value)}
          />
          <Input
            label={t('attendance.threshold')}
            type="number"
            value={threshold}
            min={1}
            max={100}
            onChange={(e) => setThreshold(Number(e.target.value) || 75)}
          />
          <div className="flex items-end">
            <div className="flex w-full items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--color-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)] px-3.5 py-3">
              <TrendingDown size={16} className="text-[var(--color-warn)]" />
              <span className="text-[12.5px] text-[var(--color-ink2)]">
                {t('attendance.belowThreshold', { count: rows.length, threshold })}
              </span>
            </div>
          </div>
        </div>
      </Panel>

      <Panel padded={false}>
        <DataTable
          rows={filtered}
          loading={loading}
          total={filtered.length}
          emptyIcon={UserX}
          emptyTitle={t('attendance.noLowAttendance')}
          emptyHint={t('attendance.noLowAttendanceHint')}
          toolbar={<TableSearch value={search} onChange={setSearch} placeholder={t('common.search')} />}
          columns={[
            { key: 'name', header: t('common.name') },
            { key: 'admissionNo', header: t('students.admissionNo'), className: 'no-urdu' },
            {
              key: 'className',
              header: t('students.class'),
              render: (row) => `${row.className || '-'} ${row.sectionName || ''}`,
            },
            { key: 'present', header: t('attendance.present'), align: 'center', className: 'no-urdu' },
            { key: 'absent', header: t('attendance.absent'), align: 'center', className: 'no-urdu' },
            { key: 'late', header: t('attendance.late'), align: 'center', className: 'no-urdu' },
            {
              key: 'percentage',
              header: t('attendance.percentage'),
              render: (row) => (
                <div className="flex items-center gap-2">
                  <ProgressBar
                    value={row.percentage}
                    className="w-24"
                    tone={row.percentage < 60 ? 'danger' : 'warn'}
                  />
                  <span className="no-urdu w-12 text-[12px]">{row.percentage}%</span>
                </div>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}

export default AttendanceReportsPage;