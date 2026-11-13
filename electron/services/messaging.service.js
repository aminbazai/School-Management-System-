'use strict';

const { getDb } = require('../db/connection');
const { validate, helpers, AppError } = require('./validation');
const acl = require('./acl.service');
const settings = require('./settings.service');

/**
 * Free bulk messaging helpers.
 *
 * The app deliberately does not talk to a paid SMS/WhatsApp gateway. It builds
 * recipient lists plus a personalised message for each contact, and the
 * renderer opens the device's own apps through deep links:
 *   - WhatsApp  -> https://wa.me/<number>?text=...
 *   - Email     -> mailto:
 *   - SMS       -> sms:<number>?body=...
 *
 * Everything works offline; the device handles delivery when it has a
 * connection. Printable PDF notices cover parents without a phone/email.
 */

const AUDIENCES = ['fee_defaulters', 'absent_students', 'student_guardians', 'staff', 'custom'];

const SPEC = {
  audience: helpers.enum(AUDIENCES, { default: 'student_guardians' }),
  month: helpers.month(),
  classId: helpers.int({ min: 1 }),
  date: helpers.date(),
  staffType: helpers.enum(['teacher', 'office', 'other']),
  template: helpers.text({ max: 4000, default: '' }),
  contacts: helpers.array({ max: 500 }),
};

function assertAdminLike(session) {
  if (!acl.isAdminLike(session)) throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

/** Guardian contact sub-selects, always primary guardian first. */
const GUARDIAN_NAME = `(SELECT g.name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
  WHERE sg.student_id = s.id AND g.is_deleted = 0 ORDER BY sg.is_primary DESC, g.id LIMIT 1)`;
const GUARDIAN_PHONE = `(SELECT g.phone FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
  WHERE sg.student_id = s.id AND g.is_deleted = 0 ORDER BY sg.is_primary DESC, g.id LIMIT 1)`;
const GUARDIAN_EMAIL = `(SELECT g.email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
  WHERE sg.student_id = s.id AND g.is_deleted = 0 ORDER BY sg.is_primary DESC, g.id LIMIT 1)`;

function monthLabel(month) {
  if (!month) return '';
  const [year, index] = String(month).split('-');
  const date = new Date(Number(year), Math.max(0, Number(index) - 1), 1);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/** Strips formatting and adds Pakistan's country code for local 03xx numbers. */
function normalisePhone(raw) {
  let digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `92${digits.slice(1)}`;
  else if (digits.length === 10 && digits.startsWith('3')) digits = `92${digits}`;
  return digits;
}

function contactFields(base) {
  return {
    ...base,
    phone: normalisePhone(base.phone),
    phoneDisplay: String(base.phone || '').trim(),
    email: String(base.email || '').trim(),
  };
}

function feeDefaulters(clean) {
  const db = getDb();
  const where = ["v.is_deleted = 0", "v.status IN ('unpaid','partial')", 's.is_deleted = 0'];
  const params = {};
  if (clean.month) {
    where.push('v.month = @month');
    params.month = clean.month;
  }
  if (clean.classId) {
    where.push('v.class_id = @classId');
    params.classId = clean.classId;
  }

  return db
    .prepare(
      `SELECT v.student_id AS student_id, s.name AS student_name, s.admission_no,
              c.name AS class_name, sec.name AS section_name,
              SUM(v.total_amount + v.late_fine - v.paid_amount - v.discount) AS balance,
              COUNT(*) AS voucher_count, MIN(v.due_date) AS due_date,
              ${GUARDIAN_NAME} AS guardian_name, ${GUARDIAN_PHONE} AS guardian_phone,
              ${GUARDIAN_EMAIL} AS guardian_email, s.phone AS student_phone, s.email AS student_email
       FROM fee_vouchers v
       JOIN students s ON s.id = v.student_id
       LEFT JOIN classes c ON c.id = v.class_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       WHERE ${where.join(' AND ')}
       GROUP BY v.student_id
       ORDER BY balance DESC`,
    )
    .all(params)
    .map((row) =>
      contactFields({
        key: `s-${row.student_id}`,
        studentId: row.student_id,
        name: row.guardian_name || row.student_name,
        studentName: row.student_name,
        className: [row.class_name, row.section_name].filter(Boolean).join(' - '),
        phone: row.guardian_phone || row.student_phone,
        email: row.guardian_email || row.student_email,
        amount: Math.round(Number(row.balance || 0) * 100) / 100,
        month: clean.month || '',
        voucherCount: row.voucher_count,
        dueDate: row.due_date || '',
        detail: `${row.admission_no || ''}${row.voucher_count > 1 ? ` · ${row.voucher_count} vouchers` : ''}`,
      }),
    );
}

function absentStudents(clean) {
  const db = getDb();
  const date = clean.date || new Date().toISOString().slice(0, 10);
  const params = { date };
  let filter = '';
  if (clean.classId) {
    filter = ' AND s.class_id = @classId';
    params.classId = clean.classId;
  }

  return db
    .prepare(
      `SELECT s.id AS student_id, s.name AS student_name, s.admission_no,
              c.name AS class_name, sec.name AS section_name,
              ${GUARDIAN_NAME} AS guardian_name, ${GUARDIAN_PHONE} AS guardian_phone,
              ${GUARDIAN_EMAIL} AS guardian_email, s.phone AS student_phone, s.email AS student_email
       FROM student_attendance a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       WHERE a.date = @date AND a.status = 'absent' AND s.is_deleted = 0${filter}
       ORDER BY c.level_order, s.name`,
    )
    .all(params)
    .map((row) =>
      contactFields({
        key: `s-${row.student_id}`,
        studentId: row.student_id,
        name: row.guardian_name || row.student_name,
        studentName: row.student_name,
        className: [row.class_name, row.section_name].filter(Boolean).join(' - '),
        phone: row.guardian_phone || row.student_phone,
        email: row.guardian_email || row.student_email,
        date,
        detail: row.admission_no || '',
      }),
    );
}

function studentGuardians(clean) {
  const db = getDb();
  const params = {};
  let filter = '';
  if (clean.classId) {
    filter = ' AND s.class_id = @classId';
    params.classId = clean.classId;
  }

  return db
    .prepare(
      `SELECT s.id AS student_id, s.name AS student_name, s.admission_no,
              c.name AS class_name, sec.name AS section_name,
              ${GUARDIAN_NAME} AS guardian_name, ${GUARDIAN_PHONE} AS guardian_phone,
              ${GUARDIAN_EMAIL} AS guardian_email, s.phone AS student_phone, s.email AS student_email
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       WHERE s.is_deleted = 0 AND s.status = 'active'${filter}
       ORDER BY c.level_order, s.name`,
    )
    .all(params)
    .map((row) =>
      contactFields({
        key: `s-${row.student_id}`,
        studentId: row.student_id,
        name: row.guardian_name || row.student_name,
        studentName: row.student_name,
        className: [row.class_name, row.section_name].filter(Boolean).join(' - '),
        phone: row.guardian_phone || row.student_phone,
        email: row.guardian_email || row.student_email,
        detail: row.admission_no || '',
      }),
    );
}

function staffRecipients(clean) {
  const db = getDb();
  const params = {};
  let filter = '';
  if (clean.staffType) {
    filter = ' AND staff_type = @staffType';
    params.staffType = clean.staffType;
  }

  return db
    .prepare(
      `SELECT id, name, employee_code, designation, phone, email
       FROM staff WHERE is_deleted = 0 AND status = 'active'${filter}
       ORDER BY staff_type, name`,
    )
    .all(params)
    .map((row) =>
      contactFields({
        key: `t-${row.id}`,
        staffId: row.id,
        name: row.name,
        studentName: '',
        className: '',
        phone: row.phone,
        email: row.email,
        detail: row.designation || row.employee_code || '',
      }),
    );
}

function customRecipients(payload) {
  return (Array.isArray(payload.contacts) ? payload.contacts : [])
    .slice(0, 500)
    .map((contact, index) => {
      const name = String(contact?.name || '').trim().slice(0, 120);
      const phone = String(contact?.phone || '').trim().slice(0, 40);
      const email = String(contact?.email || '').trim().slice(0, 160);
      return contactFields({
        key: `c-${index}`,
        name: name || phone || email,
        studentName: '',
        className: String(contact?.className || '').trim().slice(0, 120),
        phone,
        email,
        detail: '',
      });
    })
    .filter((contact) => contact.phone || contact.email);
}

function renderMessage(template, recipient, school) {
  const symbol = school.currency || 'Rs';
  const amount =
    recipient.amount === undefined || recipient.amount === null || recipient.amount === ''
      ? ''
      : `${symbol} ${Number(recipient.amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const values = {
    name: recipient.name || '',
    student: recipient.studentName || '',
    class: recipient.className || '',
    amount,
    month: monthLabel(recipient.month),
    voucher: recipient.voucherCount ? `${recipient.voucherCount} voucher(s)` : '',
    due: recipient.dueDate || '',
    date: recipient.dataDate || recipient.date || new Date().toISOString().slice(0, 10),
    school: school.name || '',
    phone: school.phone || '',
    email: school.email || '',
  };
  return String(template || '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}

function buildRecipients(payload, session) {
  assertAdminLike(session);
  const clean = validate(payload || {}, SPEC);
  const all = settings.getAll();
  const school = {
    name: all.school_name,
    phone: all.school_phone,
    email: all.school_email,
    currency: all.currency_symbol || 'Rs',
  };

  let recipients;
  if (clean.audience === 'fee_defaulters') recipients = feeDefaulters(clean);
  else if (clean.audience === 'absent_students') recipients = absentStudents(clean);
  else if (clean.audience === 'staff') recipients = staffRecipients(clean);
  else if (clean.audience === 'custom') recipients = customRecipients(payload || {});
  else recipients = studentGuardians(clean);

  const withMessage = recipients.map((recipient) => ({
    ...recipient,
    message: renderMessage(clean.template, recipient, school),
  }));

  const generic = renderMessage(
    clean.template,
    { name: '', studentName: '', className: '', amount: '', month: clean.month || '' },
    school,
  );

  return {
    audience: clean.audience,
    total: withMessage.length,
    withPhone: withMessage.filter((r) => r.phone).length,
    withEmail: withMessage.filter((r) => r.email).length,
    missingPhone: withMessage.filter((r) => !r.phone).length,
    missingEmail: withMessage.filter((r) => !r.email).length,
    recipients: withMessage,
    genericMessage: generic,
    school,
  };
}

module.exports = {
  AUDIENCES,
  normalisePhone,
  monthLabel,
  renderMessage,
  buildRecipients,
};
