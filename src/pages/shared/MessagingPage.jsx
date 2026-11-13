import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  Megaphone,
  Wallet,
  UserX,
  Users,
  IdCard,
  Contact,
  Download,
  Printer,
  MessageCircle,
  Mail,
  Smartphone,
  Send,
} from 'lucide-react';
import api, { errorKey } from '../../lib/api';
import { useAuth } from '../../store/AuthProvider';
import { useStructure } from '../../hooks/useStructure';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel } from '../../components/ui/Panel';
import { Button, IconButton } from '../../components/ui/Button';
import { DataTable, TableSearch } from '../../components/ui/DataTable';
import { Badge } from '../../components/ui/Badge';
import { Input, Select, Textarea } from '../../components/ui/Form';
import { ConfirmDialog } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { formatMonth } from '../../utils/format';
import { cleanTemplate, mailtoUrl, smsUrl, whatsappUrl } from '../../lib/messaging';

const today = () => new Date().toISOString().slice(0, 10);

const AUDIENCES = [
  { key: 'fee_defaulters', icon: Wallet },
  { key: 'absent_students', icon: UserX },
  { key: 'student_guardians', icon: Users },
  { key: 'staff', icon: IdCard },
  { key: 'custom', icon: Contact },
];

const PLACEHOLDERS = ['name', 'student', 'class', 'amount', 'month', 'voucher', 'due', 'date', 'school'];

/** Last 12 months plus "all months" for the defaulters filter. */
function useMonthOptions() {
  const { t } = useTranslation();
  return useMemo(() => {
    const now = new Date();
    const list = [];
    for (let i = 0; i < 12; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      list.push({ value, label: formatMonth(value) });
    }
    return [{ value: '', label: t('fees.allMonths') }, ...list];
  }, [t]);
}

/** Accepts "Name, phone, email" / "phone" lines for the custom audience. */
function parseContacts(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,;\t]/).map((part) => part.trim()).filter(Boolean);
      if (parts.length === 1) {
        const value = parts[0];
        return value.includes('@') ? { email: value } : { phone: value };
      }
      const [name, second, third] = parts;
      const secondIsEmail = second?.includes('@');
      return {
        name,
        phone: secondIsEmail ? undefined : second,
        email: third || (secondIsEmail ? second : undefined),
      };
    });
}

/**
 * Free Messaging Centre: builds recipient lists and opens the device's own
 * WhatsApp / SMS / email apps. No paid gateway subscription is required.
 */
export function MessagingPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings } = useAuth();
  const { structure } = useStructure();
  const monthOptions = useMonthOptions();

  const [audience, setAudience] = useState('fee_defaulters');
  const [month, setMonth] = useState('');
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(today());
  const [staffType, setStaffType] = useState('');
  const [contactsText, setContactsText] = useState('');
  const [template, setTemplate] = useState('');
  const [subject, setSubject] = useState('');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  const schoolName = settings?.school_name || '';
  const debouncedTemplate = useDebouncedValue(template, 400);
  const debouncedContacts = useDebouncedValue(contactsText, 400);

  const audienceLabel = (key) => t(`messaging.audiences.${key}`);
  const channelLabel = (key) => t(`messaging.${key}`);

  // Pick a sensible default template whenever the audience or language changes.
  useEffect(() => {
    setTemplate(t(`messaging.templates.${audience}`));
    setSubject(t('messaging.defaultSubject', { school: schoolName }));
  }, [audience, t, schoolName]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const customContacts = audience === 'custom' ? parseContacts(debouncedContacts) : undefined;
      const data = await api.messaging.recipients({
        audience,
        month: audience === 'fee_defaulters' && month ? month : undefined,
        classId: ['fee_defaulters', 'absent_students', 'student_guardians'].includes(audience) && classId ? classId : undefined,
        date: audience === 'absent_students' ? date : undefined,
        staffType: audience === 'staff' && staffType ? staffType : undefined,
        template: debouncedTemplate,
        contacts: customContacts,
      });
      setResult(data);
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setLoading(false);
    }
  }, [audience, month, classId, date, staffType, debouncedTemplate, debouncedContacts, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      search
        ? (result?.recipients || []).filter((row) =>
            [row.name, row.studentName, row.className, row.phoneDisplay, row.email, row.detail].some((field) =>
              String(field || '').toLowerCase().includes(search.toLowerCase()),
            ),
          )
        : result?.recipients || [],
    [result, search],
  );

  const openWhatsApp = async (row) => {
    const url = whatsappUrl(row.phone, row.message);
    if (!url) return toast.error(t('messaging.noPhone'));
    try {
      await api.messaging.openLink(url, 'whatsapp');
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
    return undefined;
  };

  const openSms = async (row) => {
    const url = smsUrl(row.phone, row.message);
    if (!url) return toast.error(t('messaging.noPhone'));
    try {
      await api.messaging.openLink(url, 'sms');
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
    return undefined;
  };

  const openEmail = async (row) => {
    if (!row.email) return toast.error(t('messaging.noEmail'));
    try {
      await api.messaging.openLink(mailtoUrl({ to: row.email, subject, body: row.message }), 'email');
    } catch (err) {
      toast.error(t(errorKey(err)));
    }
    return undefined;
  };

  const exportCsv = async () => {
    setBusy(true);
    try {
      const response = await api.messaging.exportCsv({ recipients: filtered });
      if (!response.canceled) toast.success(t('messaging.exported', { count: response.count }));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const printNotices = async () => {
    setBusy(true);
    try {
      const response = await api.messaging.pdf({
        title: subject || audienceLabel(audience),
        schoolName,
        message: result?.genericMessage || template,
        recipients: filtered,
      });
      if (!response.canceled) toast.success(t('messaging.pdfSaved'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const runBulk = async () => {
    setBusy(true);
    try {
      if (confirmAction === 'email') {
        const emails = filtered.map((row) => row.email).filter(Boolean);
        if (!emails.length) {
          toast.error(t('messaging.noEmail'));
        } else {
          const body = cleanTemplate(template, {
            name: t('messaging.parentGuardian'),
            school: schoolName,
            date: today(),
          });
          for (let index = 0; index < emails.length; index += 30) {
            const chunk = emails.slice(index, index + 30).join(',');
            // eslint-disable-next-line no-await-in-loop
            await api.messaging.openLink(mailtoUrl({ bcc: chunk, subject, body }), 'email');
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
          toast.success(t('messaging.openedCount', { count: emails.length }));
        }
      } else {
        const links = filtered
          .map((row) =>
            confirmAction === 'sms' ? smsUrl(row.phone, row.message) : whatsappUrl(row.phone, row.message),
          )
          .filter(Boolean);
        if (!links.length) {
          toast.error(t('messaging.noPhone'));
        } else {
          for (const url of links) {
            // eslint-disable-next-line no-await-in-loop
            await api.messaging.openLink(url, confirmAction);
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 700));
          }
          toast.success(t('messaging.openedCount', { count: links.length }));
        }
      }
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  };

  const addPlaceholder = (key) => {
    setTemplate((previous) => `${previous}${previous && !previous.endsWith(' ') ? ' ' : ''}{{${key}}}`);
  };

  const classOptions = (structure?.classes || []).map((c) => ({ value: String(c.id), label: c.name }));

  return (
    <>
      <PageHeader
        title={t('messaging.title')}
        subtitle={t('messaging.subtitle')}
        actions={<Badge tone="ok" dot>{t('messaging.freeBadge')}</Badge>}
      />

      <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--color-ok)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-ok)_8%,transparent)] px-4 py-3 text-[12px] leading-relaxed text-[var(--color-ink2)]">
        {t('messaging.freeHint')}
      </div>

      <Panel className="mb-4">
        <div className="grid gap-5 xl:grid-cols-[260px_1fr]">
          <div>
            <p className="eyebrow mb-2.5">{t('messaging.audience')}</p>
            <div className="flex flex-col gap-1.5">
              {AUDIENCES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setAudience(item.key);
                    setSearch('');
                  }}
                  className={clsx('btn justify-start', audience === item.key && 'btn-primary')}
                >
                  <item.icon size={15} />
                  <span className="truncate">{audienceLabel(item.key)}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-dim)]">
              {t(`messaging.audienceHints.${audience}`)}
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {audience === 'fee_defaulters' && (
                <Select label={t('fees.month')} value={month} options={monthOptions} onChange={(e) => setMonth(e.target.value)} />
              )}
              {audience === 'absent_students' && (
                <Input label={t('messaging.attendanceDate')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              )}
              {['fee_defaulters', 'absent_students', 'student_guardians'].includes(audience) && (
                <Select
                  label={t('students.class')}
                  value={classId}
                  placeholder={t('students.allClasses')}
                  options={classOptions}
                  onChange={(e) => setClassId(e.target.value)}
                />
              )}
              {audience === 'staff' && (
                <Select
                  label={t('staff.type')}
                  value={staffType}
                  placeholder={t('staff.allTypes')}
                  options={[
                    { value: 'teacher', label: t('roles.teacher') },
                    { value: 'office', label: t('roles.office') },
                    { value: 'other', label: t('staff.other') },
                  ]}
                  onChange={(e) => setStaffType(e.target.value)}
                />
              )}
              {audience === 'custom' && (
                <Textarea
                  label={t('messaging.customContacts')}
                  rows={6}
                  value={contactsText}
                  onChange={(e) => setContactsText(e.target.value)}
                  hint={t('messaging.customContactsHint')}
                  placeholder={'Ayesha Khan, 03001234567, ayesha@example.com\n03009876543'}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Input label={t('messaging.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} />
              <div className="flex items-end">
                <Badge tone="accent">{t('messaging.recipientCount', { count: result?.total ?? 0 })}</Badge>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-dim)]">
                  {t('messaging.placeholdersLabel')}
                </span>
                {PLACEHOLDERS.map((key) => (
                  <button key={key} type="button" className="chip" onClick={() => addPlaceholder(key)}>
                    {`{{${key}}}`}
                  </button>
                ))}
              </div>
              <Textarea
                label={t('messaging.message')}
                rows={7}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                hint={t('messaging.templateHint')}
              />
            </div>

            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--glass)] p-3.5">
              <p className="eyebrow mb-1.5">{t('messaging.preview')}</p>
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--color-ink2)]">
                {result?.genericMessage || t('messaging.noPreview')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="ok">{t('messaging.withPhone', { count: result?.withPhone ?? 0 })}</Badge>
              <Badge tone="info">{t('messaging.withEmail', { count: result?.withEmail ?? 0 })}</Badge>
              {(result?.missingPhone ?? 0) > 0 && (
                <Badge tone="warn">{t('messaging.missingPhone', { count: result.missingPhone })}</Badge>
              )}
              <div className="ms-auto flex flex-wrap gap-2">
                <Button size="sm" icon={Download} onClick={exportCsv} disabled={!filtered.length} loading={busy && !confirmAction}>
                  {t('common.export')}
                </Button>
                <Button size="sm" icon={Printer} onClick={printNotices} disabled={!filtered.length} loading={busy && !confirmAction}>
                  {t('messaging.printNotices')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel padded={false}>
        <DataTable
          rows={filtered}
          loading={loading}
          total={filtered.length}
          rowKey={(row) => row.key}
          emptyIcon={Megaphone}
          emptyTitle={t('messaging.noRecipients')}
          emptyHint={t('messaging.noRecipientsHint')}
          toolbar={
            <>
              <TableSearch value={search} onChange={setSearch} placeholder={t('messaging.searchRecipients')} />
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <Button size="sm" icon={MessageCircle} onClick={() => setConfirmAction('whatsapp')} disabled={!filtered.length}>
                  {t('messaging.whatsappAll')}
                </Button>
                <Button size="sm" icon={Mail} onClick={() => setConfirmAction('email')} disabled={!filtered.length}>
                  {t('messaging.emailAll')}
                </Button>
                <Button size="sm" icon={Smartphone} onClick={() => setConfirmAction('sms')} disabled={!filtered.length}>
                  {t('messaging.smsAll')}
                </Button>
              </div>
            </>
          }
          columns={[
            {
              key: 'name',
              header: t('common.name'),
              render: (row) => (
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--color-ink)]">{row.name || '-'}</p>
                  {row.detail && <p className="truncate text-[11px] text-[var(--color-dim)]">{row.detail}</p>}
                </div>
              ),
            },
            {
              key: 'studentName',
              header: t('messaging.student'),
              render: (row) => row.studentName || '-',
            },
            {
              key: 'className',
              header: t('students.class'),
              render: (row) => row.className || '-',
            },
            {
              key: 'phone',
              header: t('students.phone'),
              className: 'no-urdu',
              render: (row) =>
                row.phone ? (
                  row.phoneDisplay || `+${row.phone}`
                ) : (
                  <span className="text-[var(--color-danger)]">{t('messaging.missing')}</span>
                ),
            },
            {
              key: 'email',
              header: t('students.email'),
              className: 'no-urdu',
              render: (row) =>
                row.email || <span className="text-[var(--color-danger)]">{t('messaging.missing')}</span>,
            },
            {
              key: 'actions',
              header: t('common.actions'),
              align: 'end',
              render: (row) => (
                <div className="flex items-center justify-end gap-1">
                  <IconButton
                    icon={MessageCircle}
                    label={t('messaging.whatsapp')}
                    disabled={!row.phone}
                    onClick={() => openWhatsApp(row)}
                  />
                  <IconButton icon={Smartphone} label={t('messaging.sms')} disabled={!row.phone} onClick={() => openSms(row)} />
                  <IconButton icon={Mail} label={t('messaging.email')} disabled={!row.email} onClick={() => openEmail(row)} />
                </div>
              ),
            },
          ]}
        />
      </Panel>

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={runBulk}
        loading={busy}
        title={t('messaging.bulkTitle', { channel: confirmAction ? channelLabel(confirmAction) : '' })}
        message={t('messaging.bulkHint', { count: filtered.length })}
        confirmLabel={t('messaging.openAll')}
        cancelLabel={t('common.cancel')}
      />

      <div className="mt-4 flex items-center gap-2 text-[11px] text-[var(--color-dim)]">
        <Send size={13} />
        {t('messaging.offlineHint')}
      </div>
    </>
  );
}

export default MessagingPage;
