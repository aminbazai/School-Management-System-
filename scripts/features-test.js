'use strict';

/**
 * Functional tests for the three free features:
 *   - staff Excel export / import
 *   - fee reminder rows and guardian contacts
 *   - free messaging recipient builders (WhatsApp / SMS / email deep links)
 *
 * Run inside Electron because better-sqlite3 is built for Electron's ABI:
 *   npx electron scripts/features-test.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-features-test');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
app.setPath('userData', TMP);
app.disableHardwareAcceleration();

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.error(`  FAIL  ${label}${detail !== undefined ? ` -> ${String(JSON.stringify(detail)).slice(0, 220)}` : ''}`);
  }
}

function section(title) {
  console.log(`\n--- ${title} ${'-'.repeat(Math.max(4, 68 - title.length))}`);
}

async function main() {
  const { initDatabase, getDb, closeDatabase } = require('../electron/db/connection');
  const staff = require('../electron/services/staff.service');
  const fees = require('../electron/services/fees.service');
  const messaging = require('../electron/services/messaging.service');
  const excel = require('../electron/services/excel.service');
  const users = require('../electron/services/users.service');
  const auth = require('../electron/services/auth.service');

  initDatabase({ seed: true });
  const db = getDb();
  const session = { userId: 1, username: 'admin', role: 'admin', linkedId: null };

  // =========================================================================
  section('staff excel export');
  const exported = staff.exportRows({});
  check('export returns rows', exported.rows.length > 0, exported.rows.length);
  check('export meta has school and session', !!exported.meta.school && !!exported.meta.session, exported.meta);
  check('export meta count matches rows', exported.meta.count === exported.rows.length, exported.meta);

  const firstRow = exported.rows[0] || {};
  check(
    'export rows have camelCase keys for every column',
    ['employee_code', 'name', 'staff_type', 'basic_salary', 'joining_date', 'status'].every((key) =>
      Object.prototype.hasOwnProperty.call(firstRow, key),
    ),
    Object.keys(firstRow),
  );

  const teacherOnly = staff.exportRows({ staffType: 'teacher' });
  check(
    'staff type filter applies to export',
    teacherOnly.rows.length > 0 && teacherOnly.rows.every((row) => row.staff_type === 'teacher'),
    teacherOnly.rows.length,
  );

  const searched = staff.exportRows({ search: firstRow.name });
  check(
    'search filter applies to export',
    searched.rows.length > 0 && searched.rows.every((row) => String(row.name).toLowerCase().includes(String(firstRow.name).toLowerCase())),
    searched.rows.length,
  );

  const workbook = await excel.writeWorkbook([
    { name: 'Staff', title: 'Test School - Teachers & Staff', columns: excel.STAFF_COLUMNS, rows: exported.rows.slice(0, 3) },
  ]);
  check('staff workbook is written', Buffer.isBuffer(workbook) && workbook.length > 1000, workbook.length);

  const workbookPath = path.join(TMP, 'staff-roundtrip.xlsx');
  fs.writeFileSync(workbookPath, workbook);
  const parsed = await excel.readWorkbook(workbookPath, excel.STAFF_HEADER_ALIASES);
  check('exported workbook can be read back', parsed.rows.length === 3, parsed.rows.length);
  check(
    'title row is skipped when finding headers',
    parsed.headers[0] === 'Employee Code' && parsed.mapped.includes('employee code'),
    parsed.headers,
  );
  check(
    'aliases map every staff column',
    ['employee code', 'name', 'cnic', 'basic salary', 'status'].every((header) =>
      parsed.mapped.includes(header),
    ),
    parsed.mapped,
  );

  // =========================================================================
  section('staff excel import');
  const code = `IMP-${Date.now()}`;
  const beforeCount = staff.listAll({}).length;

  let result = staff.importRows(
    {
      rows: [
        {
          employee_code: code,
          name: 'Import Test Teacher',
          father_name: 'Test Father',
          cnic: '35202-1234567-1',
          phone: '0300-1234567',
          email: 'import.teacher@example.com',
          designation: 'Junior Teacher',
          staff_type: 'Teaching',
          joining_date: '2026-01-15',
          basic_salary: '45,000',
          status: 'Working',
        },
      ],
    },
    session,
  );
  check('new staff row imports', result.imported === 1 && result.failed === 0, result);

  const created = staff.listAll({ search: code });
  check('imported row is stored once', created.length === 1, created.length);
  const member = created[0] || {};
  check('imported fields are normalised', member.name === 'Import Test Teacher' && member.staffType === 'teacher', member);
  check('imported salary is numeric', member.basicSalary === 45000, member.basicSalary);
  check('imported date is ISO', member.joiningDate === '2026-01-15', member.joiningDate);
  check('imported status is normalised', member.status === 'active', member.status);
  check('staff total grew by one', staff.listAll({}).length === beforeCount + 1, staff.listAll({}).length);

  result = staff.importRows({ rows: [{ employee_code: code, name: 'Duplicate' }] }, session);
  check('duplicate row is rejected without update flag', result.imported === 0 && result.failed === 1, result);
  check('rejection names the matching field', result.errors[0]?.field === 'employeeCode', result.errors);

  result = staff.importRows(
    {
      rows: [{ employee_code: code, name: 'Import Test Teacher Renamed', designation: 'Senior Teacher' }],
      updateExisting: true,
    },
    session,
  );
  check('duplicate row updates with update flag', result.updated === 1 && result.failed === 0, result);

  const updated = staff.listAll({ search: code })[0] || {};
  check('update changed the supplied fields', updated.name === 'Import Test Teacher Renamed' && updated.designation === 'Senior Teacher', updated);
  check('update kept untouched fields', updated.basicSalary === 45000 && updated.staffType === 'teacher', updated);
  check('update did not create another row', staff.listAll({ search: code }).length === 1, staff.listAll({ search: code }).length);
  check('update did not create a login', updated.hasLogin === false, updated.hasLogin);

  result = staff.importRows({ rows: [{ employee_code: `${code}-X`, name: '' }] }, session);
  check('row without a name is rejected', result.failed === 1 && result.errors[0]?.field === 'name', result);

  let emptyRejected = false;
  try {
    staff.importRows({ rows: [] }, session);
  } catch (err) {
    emptyRejected = err.code === 'VALIDATION_FAILED';
  }
  check('empty import is rejected', emptyRejected);

  // CNIC-only matching should also update an existing row.
  result = staff.importRows(
    {
      rows: [{ name: 'CNIC Match Rename', cnic: '35202-1234567-1', phone: '0300-7654321' }],
      updateExisting: true,
    },
    session,
  );
  check('CNIC match updates the existing row', result.updated === 1 && result.failed === 0, result);
  const byCnic = staff.listAll({ search: code })[0] || {};
  check('CNIC update changed the name', byCnic.name === 'CNIC Match Rename' && byCnic.phone === '0300-7654321', byCnic);

  // =========================================================================
  section('staff excel import (via preview pipeline)');
  const code2 = `IMP2-${Date.now()}`;
  const roundtripWorkbook = await excel.writeWorkbook([
    {
      name: 'Staff',
      columns: excel.STAFF_COLUMNS,
      rows: [
        {
          employee_code: code2,
          name: 'Pipeline Test Staff',
          father_name: 'Pipeline Father',
          cnic: '35202-7654321-9',
          phone: '0321-7654321',
          email: 'pipeline@example.com',
          address: '12 Test Street',
          qualification: 'M.Ed',
          designation: 'Office Assistant',
          staff_type: 'office',
          joining_date: '2025-08-01',
          basic_salary: 38000,
          blood_group: 'B+',
          status: 'active',
          notes: 'Imported through the UI pipeline',
        },
      ],
    },
  ]);
  const roundtripPath = path.join(TMP, 'staff-import.xlsx');
  fs.writeFileSync(roundtripPath, roundtripWorkbook);
  const roundtripParsed = await excel.readWorkbook(roundtripPath, excel.STAFF_HEADER_ALIASES);
  const previewRows = roundtripParsed.rows.map((cells) => {
    const row = {};
    roundtripParsed.mapped.forEach((key, index) => {
      if (key) row[key] = cells[index];
    });
    return row;
  });
  result = staff.importRows({ rows: previewRows }, session);
  check('preview-shaped rows import', result.imported === 1 && result.failed === 0, result);
  const pipelineStaff = staff.listAll({ search: code2 })[0] || {};
  check('preview import keeps employee code', pipelineStaff.employeeCode === code2, pipelineStaff.employeeCode);
  check('preview import keeps father name', pipelineStaff.fatherName === 'Pipeline Father', pipelineStaff.fatherName);
  check('preview import keeps staff type', pipelineStaff.staffType === 'office', pipelineStaff.staffType);
  check('preview import keeps joining date', pipelineStaff.joiningDate === '2025-08-01', pipelineStaff.joiningDate);
  check('preview import keeps salary', pipelineStaff.basicSalary === 38000, pipelineStaff.basicSalary);
  check('preview import keeps blood group', pipelineStaff.bloodGroup === 'B+', pipelineStaff.bloodGroup);
  check('preview import keeps notes', pipelineStaff.notes === 'Imported through the UI pipeline', pipelineStaff.notes);

  // Student import already shipped; the same preview labels must keep working.
  const studentsService = require('../electron/services/students.service');
  const classInfo = db
    .prepare(
      `SELECT c.name AS class_name, sec.name AS section_name
       FROM sections sec JOIN classes c ON c.id = sec.class_id
       WHERE sec.is_deleted = 0 AND c.is_deleted = 0 LIMIT 1`,
    )
    .get();
  const admissionNo = `RT-${Date.now()}`;
  result = studentsService.importRows(
    {
      rows: [
        {
          'admission no': admissionNo,
          name: 'Pipeline Test Student',
          "father's name": 'Student Father',
          gender: 'Male',
          'date of birth': '2014-04-12',
          'b-form': '35202-1111111-2',
          phone: '0333-1234567',
          address: '9 School Lane',
          class_name: classInfo.class_name,
          section_name: classInfo.section_name,
          'roll no': '17',
          'admission date': '2024-04-01',
          'previous school': 'City School',
          'guardian name': 'Student Father',
          'guardian phone': '0333-7654321',
          status: 'active',
        },
      ],
    },
    session,
  );
  check('student import still accepts preview labels', result.imported === 1 && result.failed === 0, result);
  const importedStudent = db.prepare(`SELECT * FROM students WHERE admission_no = ?`).get(admissionNo) || {};
  check('student import kept father name', importedStudent.father_name === 'Student Father', importedStudent.father_name);
  check('student import kept date of birth', importedStudent.dob === '2014-04-12', importedStudent.dob);
  check('student import kept B-form', importedStudent.b_form === '35202-1111111-2', importedStudent.b_form);
  check('student import kept roll number', importedStudent.roll_no === '17', importedStudent.roll_no);
  check('student import kept admission date', importedStudent.admission_date === '2024-04-01', importedStudent.admission_date);
  check('student import kept previous school', importedStudent.previous_school === 'City School', importedStudent.previous_school);

  // =========================================================================
  section('fee reminders');
  const defaulters = fees.defaulters({ limit: 500 }, session);
  check('defaulters are returned from seeded data', defaulters.length > 0, defaulters.length);
  check(
    'defaulter rows include guardian contacts',
    defaulters.every((row) =>
      ['guardianName', 'guardianPhone', 'guardianEmail'].every((key) => Object.prototype.hasOwnProperty.call(row, key)),
    ),
    Object.keys(defaulters[0] || {}),
  );
  check('at least one guardian has a phone', defaulters.some((row) => !!row.guardianPhone), defaulters.slice(0, 3));

  const month = defaulters[0].month;
  const reminderData = fees.reminderRows({ month }, session);
  check('reminder rows load for a month', reminderData.rows.length > 0, reminderData.rows.length);
  check('reminder data carries the school profile', !!reminderData.school?.name, reminderData.school);
  check(
    'reminder rows are limited to the month',
    reminderData.rows.every((row) => row.month === month),
    reminderData.rows.map((row) => row.month),
  );
  check('reminder rows include the balance', reminderData.rows.every((row) => typeof row.balance === 'number'), reminderData.rows[0]?.balance);

  const selectedIds = defaulters.slice(0, 2).map((row) => row.id);
  const selectedReminders = fees.reminderRows({ voucherIds: selectedIds }, session);
  check(
    'voucher id filter selects only the chosen reminders',
    selectedReminders.rows.length > 0 && selectedReminders.rows.every((row) => selectedIds.includes(row.id)),
    selectedReminders.rows.map((row) => row.id),
  );
  check(
    'reminder voucher numbers are present',
    selectedReminders.rows.every((row) => !!row.voucherNo && !!row.studentName),
    selectedReminders.rows[0],
  );

  // =========================================================================
  section('messaging: phone normalisation');
  check('local 03xx becomes 923xx', messaging.normalisePhone('0300-1234567') === '923001234567', messaging.normalisePhone('0300-1234567'));
  check('spaces and plus are stripped', messaging.normalisePhone('+92 300 1234567') === '923001234567', messaging.normalisePhone('+92 300 1234567'));
  check('international 00 prefix is dropped', messaging.normalisePhone('00923001234567') === '923001234567', messaging.normalisePhone('00923001234567'));
  check('10 digit mobile gets country code', messaging.normalisePhone('3001234567') === '923001234567', messaging.normalisePhone('3001234567'));
  check('empty input returns empty', messaging.normalisePhone('') === '', messaging.normalisePhone(''));
  check('landline keeps its digits', messaging.normalisePhone('042-35761234') === '924235761234', messaging.normalisePhone('042-35761234'));

  // =========================================================================
  section('messaging: recipient builders');
  let recipients = messaging.buildRecipients(
    { audience: 'fee_defaulters', template: 'Dear {{name}}, {{student}} ({{class}}) owes {{amount}} for {{month}}. {{school}}' },
    session,
  );
  check('fee defaulter recipients are built', recipients.total > 0, recipients.total);
  check('recipient counts are consistent', recipients.withPhone + recipients.missingPhone === recipients.total, recipients);
  const paid = recipients.recipients.find((row) => row.phone) || {};
  check('recipient phone is digits only', /^\d+$/.test(String(paid.phone || '')), paid.phone);
  check('recipient keeps a display phone', !!paid.phoneDisplay, paid.phoneDisplay);
  check(
    'messages are personalised',
    recipients.recipients.every((row) => !row.message.includes('{{name}}') && !row.message.includes('{{student}}')),
    recipients.recipients[0]?.message,
  );
  check(
    'fee amount is formatted with the currency symbol',
    recipients.recipients.some((row) => /Rs\s?[\d,]+/.test(row.message)),
    recipients.recipients[0]?.message,
  );
  check('generic preview message is returned', !!recipients.genericMessage && !recipients.genericMessage.includes('{{'), recipients.genericMessage);
  check('audience is echoed back', recipients.audience === 'fee_defaulters', recipients.audience);

  recipients = messaging.buildRecipients({ audience: 'fee_defaulters', month, template: 'Fee due {{amount}}' }, session);
  check(
    'month filter limits defaulter recipients',
    recipients.recipients.every((row) => row.month === month),
    recipients.recipients.map((row) => row.month).slice(0, 3),
  );

  recipients = messaging.buildRecipients({ audience: 'student_guardians', template: 'Dear {{name}}, message about {{student}}' }, session);
  check('student guardian recipients are built', recipients.total > 0, recipients.total);
  check(
    'guardian recipients fall back to the student name',
    recipients.recipients.every((row) => !!row.name),
    recipients.recipients.slice(0, 3),
  );

  const klass = db.prepare(`SELECT class_id FROM students WHERE is_deleted = 0 LIMIT 1`).get();
  recipients = messaging.buildRecipients(
    { audience: 'student_guardians', classId: klass.class_id, template: 'Hello {{name}}' },
    session,
  );
  check('class filter applies to guardian recipients', recipients.total > 0, recipients.total);

  recipients = messaging.buildRecipients({ audience: 'staff', template: 'Dear {{name}}, {{school}}' }, session);
  check('staff recipients are built', recipients.total > 0, recipients.total);
  const staffRow = recipients.recipients[0] || {};
  check('staff recipients expose name and detail', !!staffRow.name && !!staffRow.detail, staffRow);

  recipients = messaging.buildRecipients(
    {
      audience: 'custom',
      template: 'Hello {{name}} from {{school}}',
      contacts: [
        { name: 'Ali Khan', phone: '0300-1112233' },
        { name: 'No Contact' },
        { email: 'parent@example.com' },
        { name: 'Ayesha', email: 'ayesha@example.com', phone: '0321 1234567' },
      ],
    },
    session,
  );
  check('custom recipients drop contacts without phone or email', recipients.total === 3, recipients.total);
  check(
    'custom recipients are personalised by name',
    recipients.recipients.find((row) => row.phone === '923001112233')?.message ===
      `Hello Ali Khan from ${recipients.school.name}`,
    recipients.recipients.map((row) => row.message),
  );
  check(
    'email-only custom contact falls back to the email as name',
    recipients.recipients.some((row) => row.name === 'parent@example.com' && row.email === 'parent@example.com'),
    recipients.recipients,
  );

  const absent = db.prepare(`SELECT date FROM student_attendance WHERE status = 'absent' ORDER BY date DESC LIMIT 1`).get();
  if (absent) {
    recipients = messaging.buildRecipients(
      { audience: 'absent_students', date: absent.date, template: '{{student}} was absent on {{date}}' },
      session,
    );
    check('absent student recipients are built', recipients.total > 0, recipients.total);
    check(
      'absent messages contain the attendance date',
      recipients.recipients.every((row) => row.message.includes(absent.date)),
      recipients.recipients[0]?.message,
    );
  } else {
    check('absent student recipients are built', false, 'seed has no absent records');
  }

  // Unknown placeholders are kept so a typo is visible instead of silently blank.
  recipients = messaging.buildRecipients({ audience: 'staff', template: 'Hi {{name}}, {{unknown}}' }, session);
  check(
    'unknown placeholders are preserved',
    recipients.recipients.every((row) => row.message.includes('{{unknown}}')),
    recipients.recipients[0]?.message,
  );

  // Role guard: teachers may not build bulk recipient lists.
  let blocked = false;
  try {
    messaging.buildRecipients({ audience: 'staff' }, { role: 'teacher' });
  } catch (err) {
    blocked = err.code === 'FORBIDDEN';
  }
  check('teachers are refused messaging recipients', blocked);

  // =========================================================================
  section('user control (username + password)');
  const controlUsername = `control-${Date.now()}`;
  const controlled = users.create(
    { username: controlUsername, password: 'secret123', role: 'teacher', mustChangePassword: false },
    session,
  );
  check('admin can create a controlled account', controlled?.username === controlUsername, controlled);

  const renamed = `${controlUsername}-x`;
  const renamedUser = users.update(controlled.id, { username: renamed }, session);
  check('admin can change any username', renamedUser.username === renamed, renamedUser);
  check(
    'renamed account is found by the new username',
    users.findByUsername(renamed)?.id === controlled.id,
    users.findByUsername(renamed),
  );

  let duplicateBlocked = false;
  try {
    users.update(controlled.id, { username: 'admin' }, session);
  } catch (err) {
    duplicateBlocked = err.code === 'VALIDATION_FAILED' && err.fields?.username === 'usernameTaken';
  }
  check('duplicate usernames are rejected on update', duplicateBlocked);

  let invalidBlocked = false;
  try {
    users.update(controlled.id, { username: 'bad name' }, session);
  } catch (err) {
    invalidBlocked = err.code === 'VALIDATION_FAILED' && !!err.fields?.username;
  }
  check('invalid usernames are rejected on update', invalidBlocked);

  users.resetPassword(controlled.id, 'newpass123', session, { mustChangePassword: false });
  let controlledLogin = auth.login(renamed, 'newpass123');
  check(
    'admin-set password works immediately when requested',
    controlledLogin.user.id === controlled.id && controlledLogin.user.mustChangePassword === false,
    controlledLogin.user,
  );
  check(
    'must-change flag is cleared for an immediate password',
    db.prepare(`SELECT must_change_password FROM users WHERE id = ?`).get(controlled.id).must_change_password === 0,
  );

  users.resetPassword(controlled.id, 'tempass123', session);
  controlledLogin = auth.login(renamed, 'tempass123');
  check(
    'a normal reset still asks for a new password',
    controlledLogin.user.mustChangePassword === true,
    controlledLogin.user,
  );

  users.softDelete(controlled.id, session);

  // =========================================================================
  section('audit trail');
  const auditRows = db
    .prepare(`SELECT action, entity, COUNT(*) AS n FROM audit_log WHERE entity IN ('staff','messaging') GROUP BY action, entity`)
    .all();
  check('staff import was audited', auditRows.some((row) => row.action === 'import' && row.entity === 'staff'), auditRows);
  check('staff create/update were audited', auditRows.some((row) => row.action === 'update' && row.entity === 'staff'), auditRows);

  const userAudit = db
    .prepare(`SELECT action, COUNT(*) AS n FROM audit_log WHERE entity = 'users' GROUP BY action`)
    .all();
  check('username changes are audited', userAudit.some((row) => row.action === 'update'), userAudit);
  check('password resets are audited', userAudit.some((row) => row.action === 'password_reset'), userAudit);

  closeDatabase();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('Failures:', failures);
    app.exit(1);
  } else {
    app.exit(0);
  }
}

main().catch((err) => {
  console.error('\nTEST RUN FAILED');
  console.error(err && err.stack ? err.stack : err);
  app.exit(1);
});
