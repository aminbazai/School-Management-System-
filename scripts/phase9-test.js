'use strict';

/**
 * Phase 9 functional tests (dev tool): `npm run test:phase9`
 *
 * The features that closed the last gaps:
 *  - teacher assignments (who teaches what, and what that unlocks),
 *  - the leave desk (apply, withdraw, approve, balances, quotas),
 *  - editing a user account.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-phase9-test');

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

const today = new Date().toISOString().slice(0, 10);
const year = new Date().getFullYear();

async function main() {
  const { initDatabase, getDb, closeDatabase } = require('../electron/db/connection');
  const { registerIpc } = require('../electron/ipc');

  initDatabase({ seed: true });
  registerIpc();

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  const call = (expr) =>
    win.webContents.executeJavaScript(`(async () => JSON.stringify(await (${expr})))()`, true).then(JSON.parse);

  const signIn = async (username, password, newPassword) => {
    await call(`window.school.auth.login({ username: ${JSON.stringify(username)}, password: ${JSON.stringify(password)} })`);
    if (newPassword) {
      await call(`window.school.auth.changePassword({ currentPassword: ${JSON.stringify(password)}, newPassword: ${JSON.stringify(newPassword)} })`);
    }
  };

  const db = getDb();

  // A class, a section and a subject that class actually teaches.
  const klass = db.prepare(`SELECT id FROM classes WHERE is_deleted = 0 ORDER BY level_order LIMIT 1`).get().id;
  const section = db.prepare(`SELECT id FROM sections WHERE class_id = ? AND is_deleted = 0 LIMIT 1`).get(klass).id;
  const classSubject = db.prepare(`SELECT subject_id FROM class_subjects WHERE class_id = ? AND is_active = 1 LIMIT 1`).get(klass);
  const subjectId = classSubject.subject_id;
  const otherSubject = db
    .prepare(`SELECT id FROM subjects WHERE id <> ? AND is_deleted = 0 LIMIT 1`)
    .get(subjectId).id;

  // -------------------------------------------------------------------------
  console.log('\n--- teacher assignments (admin) ---------------------------------------');
  await signIn('admin', 'admin123', 'admin1234');

  let res = await call(`window.school.teacherAssignments.list({})`);
  check('the assignment list loads', res.ok && Array.isArray(res.data) && res.data.length > 0, res);
  check('an assignment carries the names it is shown with', res.ok && !!res.data[0].teacher_name && !!res.data[0].subject_name, res.ok ? res.data[0] : res);

  res = await call(`window.school.staff.create({ name: 'Phase Nine Teacher', employeeCode: 'T-910', staffType: 'teacher', createLogin: true })`);
  const newTeacherId = res.ok ? res.data.id : null;
  check('a teacher without any assignment can be created', res.ok && !!newTeacherId, res);

  res = await call(`window.school.teacherAssignments.save({ teacherId: ${newTeacherId}, classId: ${klass}, sectionId: ${section}, subjectId: ${subjectId} })`);
  check('admin can assign a teacher to a class, section and subject', res.ok === true, res);

  const stored = db
    .prepare(`SELECT * FROM teacher_assignments WHERE teacher_id = ? AND class_id = ? AND section_id = ? AND subject_id = ? AND is_active = 1`)
    .get(newTeacherId, klass, section, subjectId);
  check('the assignment is written to the database', !!stored, stored);

  res = await call(`window.school.teacherAssignments.save({ teacherId: ${newTeacherId}, classId: ${klass}, sectionId: ${section}, subjectId: ${subjectId} })`);
  const rows = db
    .prepare(`SELECT COUNT(*) AS n FROM teacher_assignments WHERE teacher_id = ? AND class_id = ? AND section_id = ? AND subject_id = ?`)
    .get(newTeacherId, klass, section, subjectId).n;
  check('saving the same assignment again does not duplicate it', res.ok && rows === 1, { rows, res });

  res = await call(`window.school.teacherAssignments.save({ teacherId: ${newTeacherId}, classId: ${klass}, sectionId: ${section}, subjectId: ${otherSubject} })`);
  check('a subject the class does not teach is refused', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  const otherSection = db
    .prepare(`SELECT id FROM sections WHERE class_id <> ? AND is_deleted = 0 LIMIT 1`)
    .get(klass).id;
  res = await call(`window.school.teacherAssignments.save({ teacherId: ${newTeacherId}, classId: ${klass}, sectionId: ${otherSection}, subjectId: ${subjectId} })`);
  check('a section of another class is refused', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  // -------------------------------------------------------------------------
  console.log('\n--- what an assignment unlocks ----------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('t-910', 't-910', 't910pass');

  res = await call(`window.school.structure.get()`);
  check('the assigned class shows up in the teacher structure', res.ok && res.data.classes.some((c) => c.id === klass), res.ok ? res.data.classes.map((c) => c.id) : res);
  check('the assigned section shows up in the teacher structure', res.ok && res.data.sections.some((s) => s.id === section), res.ok ? res.data.sections.map((s) => s.id) : res);
  check('the teacher sees the assignment that was made for them', res.ok && (res.data.assignments || []).length === 1, res.ok ? res.data.assignments : res);

  res = await call(`window.school.attendance.roster({ classId: ${klass}, sectionId: ${section}, date: '${today}' })`);
  check('the teacher can open the register of the assigned class', res.ok === true, res);

  res = await call(`window.school.timetable.get({ classId: ${klass}, sectionId: ${section} })`);
  check('the teacher can open the timetable of the assigned class', res.ok === true, res);

  res = await call(`window.school.teacherAssignments.list({})`);
  check('a teacher only sees their own assignments', res.ok && res.data.length === 1 && res.data[0].teacher_id === newTeacherId, res);

  res = await call(`window.school.teacherAssignments.save({ teacherId: ${newTeacherId}, classId: ${klass}, sectionId: ${section}, subjectId: ${subjectId} })`);
  check('a teacher cannot create an assignment', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.teacherAssignments.remove(${stored.id})`);
  check('a teacher cannot remove an assignment', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- removing an assignment -------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('admin', 'admin1234');

  res = await call(`window.school.teacherAssignments.remove(${stored.id})`);
  check('admin can remove an assignment', res.ok === true, res);

  const after = db.prepare(`SELECT is_active FROM teacher_assignments WHERE id = ?`).get(stored.id);
  check('the removed assignment is deactivated, not lost', after && after.is_active === 0, after);

  await call(`window.school.auth.logout()`);
  await signIn('t-910', 't910pass');

  res = await call(`window.school.attendance.roster({ classId: ${klass}, sectionId: ${section}, date: '${today}' })`);
  check('without the assignment the class is closed to the teacher again', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- leave applications ------------------------------------------------');
  const ownStaff = db.prepare(`SELECT linked_id FROM users WHERE username = 't-910'`).get().linked_id;

  res = await call(`window.school.leaves.types()`);
  const casual = res.ok ? res.data.find((x) => x.name === 'Casual') : null;
  check('leave types are available to the teacher', res.ok && !!casual, res);

  res = await call(`window.school.leaves.balances({ year: ${year} })`);
  check('the teacher sees their own leave balance', res.ok && res.data.some((b) => b.name === 'Casual'), res);

  res = await call(`window.school.leaves.apply({ staffId: ${ownStaff}, leaveTypeId: ${casual.id}, fromDate: '${today}', toDate: '${today}', reason: 'Fever' })`);
  const leaveId = res.ok ? res.data.id : null;
  check('the teacher can apply for leave', res.ok && res.data.status === 'pending' && res.data.days === 1, res);

  res = await call(`window.school.leaves.list({})`);
  check('the teacher sees their own application', res.ok && res.data.length === 1 && res.data[0].id === leaveId, res.ok ? res.data.length : res);

  res = await call(`window.school.leaves.apply({ staffId: ${ownStaff + 999}, leaveTypeId: ${casual.id}, fromDate: '${today}', toDate: '${today}' })`);
  check('the teacher cannot apply for somebody else', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.leaves.decide({ id: ${leaveId}, status: 'approved' })`);
  check('the teacher cannot approve their own leave', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.leaves.decide({ id: ${leaveId}, status: 'cancelled' })`);
  check('the teacher can withdraw their own pending application', res.ok && res.data.status === 'cancelled', res);

  res = await call(`window.school.leaves.decide({ id: ${leaveId}, status: 'cancelled' })`);
  check('a withdrawn application cannot be withdrawn again', res.ok === false, res);

  // A second application, this time for the office to approve.
  res = await call(`window.school.leaves.apply({ staffId: ${ownStaff}, leaveTypeId: ${casual.id}, fromDate: '${today}', toDate: '${today}', reason: 'Fever again' })`);
  const leaveId2 = res.ok ? res.data.id : null;
  check('the teacher can apply again after withdrawing', res.ok && res.data.status === 'pending', res);

  // -------------------------------------------------------------------------
  console.log('\n--- leave desk (office) ------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('office', 'office123', 'office1234');

  res = await call(`window.school.leaves.list({})`);
  check('the office sees the pending application', res.ok && res.data.some((l) => l.id === leaveId2), res);

  res = await call(`window.school.leaves.decide({ id: ${leaveId2}, status: 'approved' })`);
  check('the office can approve a leave', res.ok && res.data.status === 'approved', res);

  res = await call(`window.school.leaves.balances({ staffId: ${ownStaff}, year: ${year} })`);
  const casualBalance = res.ok ? res.data.find((b) => b.name === 'Casual') : null;
  check('the approved leave is deducted from the balance', casualBalance && casualBalance.used === 1, casualBalance);

  const balanceRow = db
    .prepare(`SELECT * FROM leave_balances WHERE staff_id = ? AND leave_type_id = ? AND year = ?`)
    .get(ownStaff, casual.id, year);
  check('the balance is stored in leave_balances', !!balanceRow && balanceRow.used_days === 1, balanceRow);

  res = await call(`window.school.leaves.balanceList({ year: ${year} })`);
  check('the office can read the balance of every staff member', res.ok && res.data.length > 0, res);
  check('a balance row carries the person and every leave type', res.ok && !!res.data[0].staffName && res.data[0].balances.length > 0, res.ok ? res.data[0] : res);

  res = await call(`window.school.leaves.setBalance({ staffId: ${ownStaff}, leaveTypeId: ${casual.id}, year: ${year}, totalDays: 20 })`);
  check('the office can change the yearly quota of a person', res.ok && res.data.find((b) => b.name === 'Casual')?.total === 20, res);

  res = await call(`window.school.leaves.balances({ staffId: ${ownStaff}, year: ${year} })`);
  const afterQuota = res.ok ? res.data.find((b) => b.name === 'Casual') : null;
  check('the new quota is the one that is used', afterQuota && afterQuota.total === 20 && afterQuota.remaining === 19, afterQuota);

  // The approved leave is also on the staff register, so the payroll does not
  // treat it as an absence.
  const onRegister = db
    .prepare(`SELECT status, remarks FROM staff_attendance WHERE staff_id = ? AND date = ?`)
    .get(ownStaff, today);
  check('the approved leave is marked on the staff register', onRegister && onRegister.status === 'leave', onRegister);

  res = await call(`window.school.leaves.balanceList({ year: ${year} })`);
  await call(`window.school.auth.logout()`);
  await signIn('t-910', 't910pass');
  res = await call(`window.school.leaves.balanceList({ year: ${year} })`);
  check('a teacher cannot read the balance list of everybody', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- editing a user ----------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('admin', 'admin1234');

  res = await call(`window.school.users.list({ limit: 50 })`);
  const officeUser = res.ok ? res.data.rows.find((u) => u.username === 'office') : null;
  check('the office account can be found', !!officeUser, res);

  res = await call(`window.school.users.update(${officeUser.id}, { phone: '0300-1234567' })`);
  check('admin can edit a user', res.ok && res.data.id === officeUser.id, res);

  const phone = db.prepare(`SELECT phone FROM users WHERE id = ?`).get(officeUser.id).phone;
  check('the new phone is stored', phone === '0300-1234567', phone);

  res = await call(`window.school.users.update(${officeUser.id}, { role: 'teacher' })`);
  check('admin can change the role of a user', res.ok && res.data.role === 'teacher', res);

  res = await call(`window.school.users.update(${officeUser.id}, { role: 'office' })`);
  check('the role can be changed back', res.ok && res.data.role === 'office', res);

  const adminUser = db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get();
  res = await call(`window.school.users.update(${adminUser.id}, { isActive: false })`);
  check('an admin cannot deactivate themselves', res.ok === false, res);

  // Deactivate the second administrator: that is allowed while two are active.
  const otherAdmin = db.prepare(`SELECT id FROM users WHERE username = 'principal'`).get();
  res = await call(`window.school.users.update(${otherAdmin.id}, { isActive: false })`);
  check('the second administrator can be deactivated', res.ok && res.data.isActive === false, res);

  // Now only one active administrator is left - the school must never reach zero.
  res = await call(`window.school.users.update(${otherAdmin.id}, { isActive: false })`);
  check('the last active admin cannot be deactivated', res.ok === false && res.error.code === 'LAST_ADMIN', res);

  await call(`window.school.auth.logout()`);
  await signIn('t-910', 't910pass');
  res = await call(`window.school.users.update(${officeUser.id}, { phone: '0300-0000000' })`);
  check('a teacher cannot edit a user', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- the data tab (danger zone) ----------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('admin', 'admin1234');

  res = await call(`window.school.data.stats()`);
  check('the admin can read what the database holds', res.ok && res.data.students > 0, res);
  check('the statistics cover every kind of record', res.ok && typeof res.data.auditLog === 'number' && typeof res.data.fees === 'number', res.ok ? res.data : res);

  res = await call(`window.school.data.scope()`);
  check('the scope of both operations is described', res.ok && res.data.clearSchoolData && res.data.factoryReset, res);

  await call(`window.school.auth.logout()`);
  await signIn('t-910', 't910pass');
  res = await call(`window.school.data.stats()`);
  check('a teacher cannot read the data statistics', res.ok === false && res.error.code === 'FORBIDDEN', res);
  res = await call(`window.school.data.clear()`);
  check('a teacher cannot clear the data', res.ok === false && res.error.code === 'FORBIDDEN', res);
  res = await call(`window.school.data.factoryReset()`);
  check('a teacher cannot reset the database', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- clearing all the data --------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('admin', 'admin1234');

  const settingsBefore = getDb().prepare(`SELECT value FROM settings WHERE key = 'school_name'`).get();
  const classCountBefore = getDb().prepare(`SELECT COUNT(*) AS n FROM classes WHERE is_deleted = 0`).get().n;
  const subjectCountBefore = getDb().prepare(`SELECT COUNT(*) AS n FROM subjects WHERE is_deleted = 0`).get().n;

  // A named school, so the settings can be checked afterwards.
  await call(`window.school.settings.update({ school_name: 'Phase Nine School' })`);

  res = await call(`window.school.data.clear()`);
  check('the admin can clear the school data', res.ok === true, res);
  check('the result says what was removed', res.ok && res.data.removed.students > 0, res.ok ? res.data.removed : res);

  const emptiedCounts = {
    students: getDb().prepare(`SELECT COUNT(*) AS n FROM students`).get().n,
    staff: getDb().prepare(`SELECT COUNT(*) AS n FROM staff`).get().n,
    attendance: getDb().prepare(`SELECT COUNT(*) AS n FROM student_attendance`).get().n,
    exams: getDb().prepare(`SELECT COUNT(*) AS n FROM exams`).get().n,
    fees: getDb().prepare(`SELECT COUNT(*) AS n FROM fee_vouchers`).get().n,
    payroll: getDb().prepare(`SELECT COUNT(*) AS n FROM payroll`).get().n,
    leaves: getDb().prepare(`SELECT COUNT(*) AS n FROM leaves`).get().n,
    expenses: getDb().prepare(`SELECT COUNT(*) AS n FROM expenses`).get().n,
    notices: getDb().prepare(`SELECT COUNT(*) AS n FROM notices`).get().n,
  };
  const emptied = Object.entries(emptiedCounts).filter(([, n]) => n !== 0);
  check('every record of the school is gone', emptied.length === 0, emptiedCounts);

  const kept = {
    admins: getDb().prepare(`SELECT COUNT(*) AS n FROM users WHERE role='admin'`).get().n,
    classes: getDb().prepare(`SELECT COUNT(*) AS n FROM classes WHERE is_deleted = 0`).get().n,
    subjects: getDb().prepare(`SELECT COUNT(*) AS n FROM subjects WHERE is_deleted = 0`).get().n,
    sessions: getDb().prepare(`SELECT COUNT(*) AS n FROM academic_sessions`).get().n,
    schoolName: getDb().prepare(`SELECT value FROM settings WHERE key = 'school_name'`).get()?.value,
  };
  check('the administrator accounts are kept', kept.admins >= 1, kept);
  check('the academic structure is kept', kept.classes === classCountBefore && kept.subjects === subjectCountBefore, kept);
  check('the academic sessions are kept', kept.sessions >= 1, kept);
  check('the school settings are kept', kept.schoolName === 'Phase Nine School', kept);

  const logged = getDb().prepare(`SELECT action FROM audit_log ORDER BY id DESC LIMIT 1`).get();
  check('the clearing itself is written to the audit log', logged && logged.action === 'data.clear', logged);
  check('the audit log holds nothing but the clearing itself', getDb().prepare(`SELECT COUNT(*) AS n FROM audit_log`).get().n === 1);

  // The session ends with the data, so the admin has to sign in again.
  res = await call(`window.school.auth.session()`);
  check('the session ends with the data', res.ok && res.data.user === null, res);

  res = await call(`window.school.auth.login({ username: 'admin', password: 'admin1234' })`);
  check('the administrator can sign in again on the cleared database', res.ok === true, res);

  // -------------------------------------------------------------------------
  console.log('\n--- factory reset ------------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('admin', 'admin1234');

  res = await call(`window.school.data.factoryReset()`);
  check('the admin can reset the database to the factory state', res.ok === true, res);
  check('a safety backup is taken first', res.ok && typeof res.data.safetyBackup === 'string' && res.data.safetyBackup.length > 0, res);

  const backupPath = path.join(TMP, 'backups', res.ok ? res.data.safetyBackup : '');
  check('the safety backup is really on disk', fs.existsSync(backupPath), backupPath);

  const restored = {
    students: getDb().prepare(`SELECT COUNT(*) AS n FROM students`).get().n,
    staff: getDb().prepare(`SELECT COUNT(*) AS n FROM staff`).get().n,
    classes: getDb().prepare(`SELECT COUNT(*) AS n FROM classes`).get().n,
    users: getDb().prepare(`SELECT COUNT(*) AS n FROM users`).get().n,
  };
  check('the demo data is back', restored.students > 0 && restored.staff > 0 && restored.classes > 0, restored);
  check('the accounts are back', restored.users > 0, restored);

  res = await call(`window.school.auth.session()`);
  check('the session ends with the reset', res.ok && res.data.user === null, res);

  // The seeded administrator is back with the factory password.
  res = await call(`window.school.auth.login({ username: 'admin', password: 'admin123' })`);
  check('the factory account works again', res.ok === true, res);

  // -------------------------------------------------------------------------
  console.log('\n--- the new screens are wired ----------------------------------------');
  const appSource = fs.readFileSync(path.join(ROOT, 'src', 'App.jsx'), 'utf8');
  check('the teacher leave screen has a route', appSource.includes('my-leave'), 'src/App.jsx');
  const menuSource = fs.readFileSync(path.join(ROOT, 'src', 'config', 'menu.js'), 'utf8');
  check('the teacher leave screen is in the sidebar', menuSource.includes('/teacher/my-leave'), 'src/config/menu.js');
  const classSource = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'admin', 'ClassesPage.jsx'), 'utf8');
  check('the teacher assignment tab is on the academic structure screen', classSource.includes('assignments'), 'src/pages/admin/ClassesPage.jsx');

  closeDatabase();
  console.log(`\n${failed === 0 ? 'ALL PHASE 9 TESTS PASSED' : `FAILURES: ${failures.length}`} (${passed} passed)`);
  if (failed) console.error(failures.map((f) => `  - ${f}`).join('\n'));
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);
