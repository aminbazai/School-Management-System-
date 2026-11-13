import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Save,
  Upload,
  Trash2,
  Plus,
  Building2,
  GraduationCap,
  Palette,
  ShieldCheck,
  Award,
  Pencil,
  DatabaseBackup,
  TriangleAlert,
  RotateCcw,
  Users,
  KeyRound,
  Search,
} from 'lucide-react';
import clsx from 'clsx';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel, PanelHeader, StatCard } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable } from '../../components/ui/DataTable';
import { Input, Select, Textarea, FormGrid, PasswordInput } from '../../components/ui/Form';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { ROLES } from '../../lib/constants';

const TABS = [
  { key: 'school', labelKey: 'settings.school', icon: Building2 },
  { key: 'academic', labelKey: 'settings.academic', icon: GraduationCap },
  { key: 'appearance', labelKey: 'settings.appearance', icon: Palette },
  { key: 'security', labelKey: 'settings.security', icon: ShieldCheck },
  { key: 'users', labelKey: 'settings.userControl', icon: Users },
  { key: 'grades', labelKey: 'settings.grades', icon: Award },
  { key: 'data', labelKey: 'settings.data', icon: DatabaseBackup },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const { settings, updateSettings, refreshSettings } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState('school');
  const [form, setForm] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [grades, setGrades] = useState([]);
  const [grade, setGrade] = useState({ name: '', minPercentage: '', maxPercentage: '', gradePoint: '' });

  // The data tab
  const [stats, setStats] = useState(null);
  const [scope, setScope] = useState(null);
  const [danger, setDanger] = useState(null); // { kind: 'clear' | 'reset' }
  const [confirmText, setConfirmText] = useState('');
  const [working, setWorking] = useState(false);

  // The user control tab
  const [userRows, setUserRows] = useState([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userLoading, setUserLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userRole, setUserRole] = useState('');
  const [usernameTarget, setUsernameTarget] = useState(null);
  const [usernameValue, setUsernameValue] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [userBusy, setUserBusy] = useState(false);

  useEffect(() => {
    if (settings) setForm({ ...settings });
  }, [settings]);

  const loadGrades = async () => {
    try {
      setGrades(await api.gradeScale.list());
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  useEffect(() => {
    loadGrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setErrors({});
    try {
      const payload = {
        school_name: form.school_name,
        school_address: form.school_address,
        school_phone: form.school_phone,
        school_email: form.school_email,
        session: form.session,
        currency: form.currency,
        currency_symbol: form.currency_symbol,
        attendance_cutoff: form.attendance_cutoff,
        working_days: form.working_days,
        report_footer: form.report_footer,
        auto_print_receipt: form.auto_print_receipt,
        late_fine_amount: Number(form.late_fine_amount) || 0,
        absent_deduction_per_day: Number(form.absent_deduction_per_day) || 0,
      };
      await updateSettings(payload);
      toast.success(t('common.saved'));
    } catch (err) {
      if (err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, t(`validation.${v}`)])));
      else toast.error(t(errorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async () => {
    try {
      const result = await api.settings.uploadLogo();
      if (result.canceled) return;
      await refreshSettings();
      setForm((prev) => ({ ...prev, logo_path: result.settings.logo_path }));
      toast.success(t('settings.logoUpdated'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const clearLogo = async () => {
    try {
      await api.settings.clearLogo();
      await refreshSettings();
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const saveGrade = async () => {
    try {
      const rows = await api.gradeScale.save({
        ...(grade.id ? { id: grade.id } : {}),
        name: grade.name,
        minPercentage: Number(grade.minPercentage),
        maxPercentage: Number(grade.maxPercentage),
        gradePoint: Number(grade.gradePoint) || 0,
      });
      setGrades(rows);
      setGrade({ name: '', minPercentage: '', maxPercentage: '', gradePoint: '' });
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(err.fields?.name ? t(`validation.${err.fields.name}`) : t(errorKey(err)));
    }
  };

  const removeGrade = async (id) => {
    try {
      setGrades(await api.gradeScale.remove(id));
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  const editGrade = (row) =>
    setGrade({
      id: row.id,
      name: row.name,
      minPercentage: row.min_percentage,
      maxPercentage: row.max_percentage,
      gradePoint: row.grade_point,
    });

  // ---------------------------------------------------------------------------
  // The data tab: what is in the database, and the two destructive actions.
  // ---------------------------------------------------------------------------

  const loadData = async () => {
    try {
      const [counts, description] = await Promise.all([api.data.stats(), api.data.scope()]);
      setStats(counts);
      setScope(description);
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
  };

  useEffect(() => {
    if (tab === 'data') loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ---------------------------------------------------------------------------
  // The user control tab: every account, with username and password editing.
  // ---------------------------------------------------------------------------

  const roleOptions = useMemo(() => ROLES.map((role) => ({ value: role, label: t(`roles.${role}`) })), [t]);
  const debouncedUserSearch = useDebouncedValue(userSearch, 250);

  const loadUsers = useCallback(async () => {
    setUserLoading(true);
    try {
      const data = await api.users.list({
        search: debouncedUserSearch,
        role: userRole || undefined,
        limit: 500,
      });
      setUserRows(data.rows);
      setUserTotal(data.total);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setUserLoading(false);
    }
  }, [debouncedUserSearch, userRole, t, toast]);

  useEffect(() => {
    if (tab === 'users') loadUsers();
  }, [tab, loadUsers]);

  const openUsername = (row) => {
    setUsernameTarget(row);
    setUsernameValue(row.username);
    setUsernameError('');
  };

  const closeUsername = () => {
    setUsernameTarget(null);
    setUsernameValue('');
    setUsernameError('');
  };

  const submitUsername = async (event) => {
    event?.preventDefault();
    if (!usernameTarget || userBusy) return;
    const value = usernameValue.trim().toLowerCase();
    if (!value) {
      setUsernameError(t('validation.required'));
      return;
    }
    setUserBusy(true);
    setUsernameError('');
    try {
      await api.users.update(usernameTarget.id, { username: value });
      toast.success(t('settings.usernameUpdated'));
      closeUsername();
      loadUsers();
    } catch (err) {
      if (err.fields?.username) setUsernameError(t(`validation.${err.fields.username}`));
      else toast.error(t(errorKey(err)));
    } finally {
      setUserBusy(false);
    }
  };

  const openPassword = (row) => {
    setPasswordTarget(row);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setConfirmError('');
    setMustChangePassword(true);
  };

  const closePassword = () => {
    setPasswordTarget(null);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setConfirmError('');
  };

  const submitPassword = async (event) => {
    event?.preventDefault();
    if (!passwordTarget || userBusy) return;
    let invalid = false;
    if (!newPassword || newPassword.length < 6) {
      setPasswordError(t('validation.passwordTooShort'));
      invalid = true;
    } else {
      setPasswordError('');
    }
    if (newPassword !== confirmPassword) {
      setConfirmError(t('validation.passwordsDoNotMatch'));
      invalid = true;
    } else {
      setConfirmError('');
    }
    if (invalid) return;

    setUserBusy(true);
    try {
      await api.users.resetPassword(passwordTarget.id, newPassword, { mustChangePassword });
      toast.success(t('settings.passwordUpdated', { name: passwordTarget.displayName }));
      closePassword();
      loadUsers();
    } catch (err) {
      if (err.fields?.password) setPasswordError(t(`validation.${err.fields.password}`));
      else toast.error(t(errorKey(err)));
    } finally {
      setUserBusy(false);
    }
  };

  const openDanger = (kind) => {
    setConfirmText('');
    setDanger({ kind });
  };

  const closeDanger = () => {
    setDanger(null);
    setConfirmText('');
  };

  const CONFIRM_WORDS = { clear: 'DELETE', reset: 'RESET' };
  const confirmWord = danger ? CONFIRM_WORDS[danger.kind] : '';

  const runDanger = async () => {
    if (!danger || working) return;
    if (confirmText.trim().toUpperCase() !== confirmWord) return;
    setWorking(true);
    try {
      if (danger.kind === 'clear') {
        await api.data.clear();
      } else {
        await api.data.factoryReset();
      }
      closeDanger();
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setWorking(false);
    }
  };

  const statCards = stats
    ? [
        ['students', t('settings.statStudents')],
        ['staff', t('settings.statStaff')],
        ['attendance', t('settings.statAttendance')],
        ['exams', t('settings.statExams')],
        ['fees', t('settings.statFees')],
        ['payroll', t('settings.statPayroll')],
        ['leaves', t('settings.statLeaves')],
        ['expenses', t('settings.statExpenses')],
        ['notices', t('settings.statNotices')],
        ['auditLog', t('settings.statAudit')],
      ]
    : [];

  return (
    <>
      <PageHeader
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
        actions={
          <Button variant="primary" icon={Save} loading={saving} onClick={save}>
            {t('common.save')}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={clsx('btn btn-sm', tab === item.key && 'btn-primary')}
          >
            <item.icon size={14} />
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'school' && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Panel>
            <PanelHeader title={t('settings.logo')} />
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[var(--color-line2)] bg-[var(--glass)] text-[var(--color-dim)]">
                {form.logo_path ? (
                  <span className="text-[11px]">{t('settings.logoSet')}</span>
                ) : (
                  <Building2 size={26} />
                )}
              </div>
              <Button icon={Upload} onClick={uploadLogo}>
                {t('settings.uploadLogo')}
              </Button>
              {form.logo_path && (
                <Button variant="ghost" icon={Trash2} onClick={clearLogo}>
                  {t('settings.removeLogo')}
                </Button>
              )}
              <p className="text-center text-[11.5px] text-[var(--color-dim)]">{t('settings.logoHint')}</p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t('settings.schoolDetails')} />
            <div className="flex flex-col gap-4">
              <Input
                label={t('settings.schoolName')}
                value={form.school_name || ''}
                error={errors.school_name}
                onChange={set('school_name')}
              />
              <Textarea label={t('settings.address')} value={form.school_address || ''} onChange={set('school_address')} />
              <FormGrid columns={2}>
                <Input label={t('settings.phone')} value={form.school_phone || ''} onChange={set('school_phone')} />
                <Input label={t('settings.email')} type="email" value={form.school_email || ''} onChange={set('school_email')} />
              </FormGrid>
              <Textarea label={t('settings.reportFooter')} value={form.report_footer || ''} onChange={set('report_footer')} />
               <Select
                 label={t('settings.autoPrintReceipt', 'Auto print fee receipt after payment')}
                 value={form.auto_print_receipt || '1'}
                 options={[
                   { value: '1', label: t('common.yes') },
                   { value: '0', label: t('common.no') },
                 ]}
                 onChange={set('auto_print_receipt')}
               />
            </div>
          </Panel>
        </div>
      )}

      {tab === 'academic' && (
        <Panel>
          <PanelHeader title={t('settings.academicRules')} />
          <div className="flex flex-col gap-4">
            <FormGrid columns={2}>
              <Input label={t('settings.session')} value={form.session || ''} onChange={set('session')} />
              <FormGrid columns={2}>
                <Input label={t('settings.currency')} value={form.currency || ''} onChange={set('currency')} />
                <Input label={t('settings.currencySymbol')} value={form.currency_symbol || ''} onChange={set('currency_symbol')} />
              </FormGrid>
            </FormGrid>
            <FormGrid columns={2}>
              <Input
                label={t('settings.attendanceCutoff')}
                type="time"
                value={form.attendance_cutoff || ''}
                onChange={set('attendance_cutoff')}
              />
              <Input
                label={t('settings.workingDays')}
                value={form.working_days || ''}
                placeholder="Mon,Tue,Wed,Thu,Fri,Sat"
                hint={t('settings.workingDaysHint')}
                onChange={set('working_days')}
              />
            </FormGrid>
            <FormGrid columns={2}>
              <Input
                label={t('settings.lateFine')}
                type="number"
                value={form.late_fine_amount ?? 0}
                onChange={set('late_fine_amount')}
              />
              <Input
                label={t('settings.absentDeduction')}
                type="number"
                value={form.absent_deduction_per_day ?? 0}
                onChange={set('absent_deduction_per_day')}
              />
            </FormGrid>
          </div>
        </Panel>
      )}

      {tab === 'appearance' && (
        <Panel>
          <PanelHeader title={t('settings.appearance')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="field-label">{t('settings.theme')}</p>
              <div className="flex gap-2">
                {['dark', 'light'].map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => updateSettings({ theme })}
                    className={clsx(
                      'flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] transition',
                      form.theme === theme
                        ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--color-ink)]'
                        : 'border-[var(--color-line)] text-[var(--color-muted)]',
                    )}
                  >
                    {t(theme === 'dark' ? 'settings.dark' : 'settings.light')}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="field-label">{t('settings.defaultLanguage')}</p>
              <Select
                value={form.language || 'en'}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ur', label: 'اردو (RTL)' },
                ]}
                onChange={(e) => updateSettings({ language: e.target.value })}
              />
            </div>
          </div>
        </Panel>
      )}

      {tab === 'security' && (
        <Panel>
          <PanelHeader title={t('settings.securityRules')} />
          <div className="flex flex-col gap-3">
            {[
              ['min_password_length', t('settings.minPassword')],
              ['max_failed_attempts', t('settings.maxAttempts')],
              ['lockout_minutes', t('settings.lockoutMinutes')],
              ['session_timeout_minutes', t('settings.sessionTimeout')],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] px-4 py-3">
                <span className="text-[13px] text-[var(--color-ink2)]">{label}</span>
                <Badge tone="accent">{settings?.[key]}</Badge>
              </div>
            ))}
            <p className="text-[11.5px] text-[var(--color-dim)]">{t('settings.securityHint')}</p>
          </div>
        </Panel>
      )}

      {tab === 'users' && (
        <Panel padded={false}>
          <div className="p-5 pb-0">
            <PanelHeader title={t('settings.userControl')} subtitle={t('settings.userControlHint')} />
          </div>
          <DataTable
            rows={userRows}
            loading={userLoading}
            rowKey={(row) => row.id}
            emptyTitle={t('common.noData')}
            emptyHint={t('common.noDataHint')}
            toolbar={
              <>
                <div className="min-w-[220px] flex-1">
                  <Input
                    icon={Search}
                    placeholder={`${t('common.search')}...`}
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                  />
                </div>
                <div className="w-[190px]">
                  <Select
                    value={userRole}
                    placeholder={t('settings.allRoles')}
                    options={roleOptions}
                    onChange={(e) => setUserRole(e.target.value)}
                  />
                </div>
                <Badge tone="neutral">
                  {t('common.total')}: <span className="no-urdu ms-1 text-[var(--color-ink)]">{userTotal}</span>
                </Badge>
              </>
            }
            columns={[
              {
                key: 'displayName',
                header: t('common.name'),
                render: (row) => (
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--color-ink)]">{row.displayName}</p>
                    {row.mustChangePassword && (
                      <p className="text-[10.5px] text-[var(--color-warn)]">{t('users.mustChange')}</p>
                    )}
                  </div>
                ),
              },
              { key: 'username', header: t('common.username'), className: 'no-urdu' },
              {
                key: 'role',
                header: t('common.role'),
                render: (row) => <Badge tone="accent">{t(`roles.${row.role}`)}</Badge>,
              },
              {
                key: 'isActive',
                header: t('common.status'),
                render: (row) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} />,
              },
              {
                key: 'actions',
                header: t('common.actions'),
                align: 'end',
                render: (row) => (
                  <div className="flex justify-end gap-1">
                    <IconButton
                      icon={Pencil}
                      label={t('settings.changeUsername')}
                      onClick={() => openUsername(row)}
                    />
                    <IconButton
                      icon={KeyRound}
                      label={t('settings.changePassword')}
                      onClick={() => openPassword(row)}
                    />
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      )}

      {tab === 'grades' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Panel padded={false}>
            <DataTable
              rows={grades}
              rowKey={(row) => row.id}
              emptyTitle={t('common.noData')}
              columns={[
                { key: 'name', header: t('settings.grade') },
                { key: 'min_percentage', header: t('settings.from'), className: 'no-urdu' },
                { key: 'max_percentage', header: t('settings.to'), className: 'no-urdu' },
                { key: 'grade_point', header: t('settings.points'), className: 'no-urdu' },
                {
                  key: 'actions',
                  header: t('common.actions'),
                  align: 'end',
                  render: (row) => (
                    <div className="flex justify-end gap-1">
                      <IconButton icon={Pencil} label={t('common.edit')} onClick={() => editGrade(row)} />
                      <IconButton icon={Trash2} label={t('common.delete')} onClick={() => removeGrade(row.id)} />
                    </div>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader title={grade.id ? t('common.editItem', { item: t('settings.grade') }) : t('settings.addGrade')} />
            <div className="flex flex-col gap-3">
              <Input
                label={t('settings.grade')}
                value={grade.name}
                onChange={(e) => setGrade({ ...grade, name: e.target.value })}
                required
              />
              <FormGrid columns={2}>
                <Input
                  label={t('settings.from')}
                  type="number"
                  value={grade.minPercentage}
                  onChange={(e) => setGrade({ ...grade, minPercentage: e.target.value })}
                />
                <Input
                  label={t('settings.to')}
                  type="number"
                  value={grade.maxPercentage}
                  onChange={(e) => setGrade({ ...grade, maxPercentage: e.target.value })}
                />
              </FormGrid>
              <Input
                label={t('settings.points')}
                type="number"
                value={grade.gradePoint}
                onChange={(e) => setGrade({ ...grade, gradePoint: e.target.value })}
              />
              <div className="flex gap-2">
                <Button variant="primary" icon={grade.id ? Save : Plus} onClick={saveGrade}>
                  {t('common.save')}
                </Button>
                {grade.id && (
                  <Button variant="ghost" onClick={() => setGrade({ name: '', minPercentage: '', maxPercentage: '', gradePoint: '' })}>
                    {t('common.reset')}
                  </Button>
                )}
              </div>
            </div>
          </Panel>
        </div>
      )}
      {tab === 'data' && (
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title={t('settings.currentRecords')} subtitle={t('settings.currentRecordsHint')} />
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {statCards.map(([key, label]) => (
                <StatCard key={key} label={label} value={stats?.[key] ?? 0} menu={false} />
              ))}
            </div>
          </Panel>

          <Panel className="border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)]">
            <PanelHeader title={t('settings.dangerZone')} subtitle={t('settings.dangerZoneHint')} />

            <div className="flex flex-col gap-3">
              {/* Clear all data */}
              <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] p-4">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-[var(--color-ink)]">{t('settings.clearData')}</p>
                  <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-[var(--color-muted)]">
                    {t('settings.clearDataHint')}
                  </p>
                  {scope?.clearSchoolData && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {scope.clearSchoolData.removes.map((item) => (
                        <Badge key={item} tone="danger">
                          {t(`dataScope.${item}`)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <Button variant="danger" icon={Trash2} onClick={() => openDanger('clear')}>
                  {t('settings.clearData')}
                </Button>
              </div>

              {/* Factory reset */}
              <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] p-4">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-[var(--color-ink)]">{t('settings.factoryReset')}</p>
                  <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-[var(--color-muted)]">
                    {t('settings.factoryResetHint')}
                  </p>
                </div>
                <Button variant="danger" icon={RotateCcw} onClick={() => openDanger('reset')}>
                  {t('settings.factoryReset')}
                </Button>
              </div>

              <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[var(--color-dim)]">
                <TriangleAlert size={14} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
                {t('settings.backupReminder')}
              </p>
            </div>
          </Panel>
        </div>
      )}

      {/* The confirmation dialog: the word has to be typed out */}
      <Modal
        open={!!danger}
        onClose={closeDanger}
        title={danger?.kind === 'reset' ? t('settings.factoryReset') : t('settings.clearData')}
        subtitle={t('settings.typeToConfirm', { word: confirmWord })}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closeDanger}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={working}
              disabled={confirmText.trim().toUpperCase() !== confirmWord}
              onClick={runDanger}
            >
              {danger?.kind === 'reset' ? t('settings.factoryReset') : t('settings.clearData')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] p-3">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[var(--color-danger)]" />
            <p className="text-[12.5px] leading-relaxed text-[var(--color-ink)]">
              {danger?.kind === 'reset' ? t('settings.resetWarning') : t('settings.clearWarning')}
            </p>
          </div>

          {scope && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="field-label">{t('settings.whatRemoves')}</p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {(danger?.kind === 'reset' ? scope.factoryReset.removes : scope.clearSchoolData.removes).map(
                    (item) => (
                      <li key={item} className="text-[12px] text-[var(--color-muted)]">
                        • {t(`dataScope.${item}`)}
                      </li>
                    ),
                  )}
                </ul>
              </div>
              <div>
                <p className="field-label">{t('settings.whatKeeps')}</p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {(danger?.kind === 'reset' ? scope.factoryReset.keeps : scope.clearSchoolData.keeps).map(
                    (item) => (
                      <li key={item} className="text-[12px] text-[var(--color-muted)]">
                        • {t(`dataScope.${item}`)}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </div>
          )}

          <Input
            label={t('settings.typeToConfirm', { word: confirmWord })}
            value={confirmText}
            placeholder={confirmWord}
            onChange={(e) => setConfirmText(e.target.value)}
            autoFocus
          />

          <p className="text-[11.5px] text-[var(--color-dim)]">{t('settings.signOutAgain')}</p>
        </div>
      </Modal>

      {/* Change username */}
      <Modal
        open={!!usernameTarget}
        onClose={closeUsername}
        title={t('settings.changeUsername')}
        subtitle={usernameTarget?.displayName}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closeUsername}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={userBusy}
              disabled={
                !usernameValue.trim() ||
                usernameValue.trim().toLowerCase() === usernameTarget?.username
              }
              onClick={submitUsername}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form onSubmit={submitUsername} className="flex flex-col gap-4">
          <Input
            label={t('common.username')}
            value={usernameValue}
            error={usernameError}
            hint={t('settings.changeUsernameHint')}
            onChange={(e) => {
              setUsernameValue(e.target.value);
              setUsernameError('');
            }}
            autoFocus
            required
            className="no-urdu"
          />
          <p className="text-[11.5px] leading-relaxed text-[var(--color-dim)]">
            {t('settings.changeUsernameWarning')}
          </p>
        </form>
      </Modal>

      {/* Change password */}
      <Modal
        open={!!passwordTarget}
        onClose={closePassword}
        title={t('settings.changePassword')}
        subtitle={passwordTarget?.displayName}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closePassword}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={userBusy} onClick={submitPassword}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form onSubmit={submitPassword} className="flex flex-col gap-4">
          <PasswordInput
            label={t('settings.newPassword')}
            value={newPassword}
            error={passwordError}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setPasswordError('');
            }}
            autoFocus
            required
          />
          <PasswordInput
            label={t('settings.confirmPassword')}
            value={confirmPassword}
            error={confirmError}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setConfirmError('');
            }}
            required
          />
          <Select
            label={t('settings.passwordPolicy')}
            value={mustChangePassword ? 'yes' : 'no'}
            options={[
              { value: 'yes', label: t('settings.requirePasswordChange') },
              { value: 'no', label: t('settings.usePasswordNow') },
            ]}
            hint={t('settings.passwordPolicyHint')}
            onChange={(e) => setMustChangePassword(e.target.value === 'yes')}
          />
        </form>
      </Modal>
    </>
  );
}

export default SettingsPage;