'use strict';

/**
 * Phase 3 functional tests (dev tool): `npm run test:phase3`
 * Staff records, attendance (student + staff) and leave management,
 * with a focus on the teacher scoping rules.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-phase3-test');

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
    console.error(`  FAIL  ${label}${detail !== undefined ? ` -> ${String(JSON.stringify(detail)).slice(0, 200)}` : ''}`);
  }
}

const today = new Date().toISOString().slice(0, 10);
const month = new Date().toISOString().slice(0, 7);

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

  // -------------------------------------------------------------------------
  console.log('\n--- authentication --------------------------------------------------');
  await signIn('admin', 'admin123', 'admin1234');

  console.log('\n--- staff records ---------------------------------------------------');
  let res = await call(`window.school.staff.list({ pageSize: 50 })`);
  check('staff list loads seeded teachers', res.ok && res.data.total >= 4, res.ok ? res.data.total : res);
  check('staff rows expose login state', res.ok && res.data.rows.every((r) => 'hasLogin' in r));

  res = await call(`window.school.staff.create({ name: 'Test Teacher', employeeCode: 'T-900', staffType: 'teacher', designation: 'Lecturer', basicSalary: 55000, joiningDate: '${today}', phone: '03001234567', cnic: '35202-1234567-1', createLogin: true })`);
  const staffId = res.ok ? res.data.id : null;
  check('admin can add a staff member', res.ok && res.data.hasLogin === true, res);

  const staffLogin = getDb().prepare(`SELECT username, must_change_password FROM users WHERE linked_id = ? AND role = 'teacher'`).get(staffId);
  check('staff login uses the employee code', staffLogin && staffLogin.username === 't-900', staffLogin);
  check('staff must change the password at first login', staffLogin && staffLogin.must_change_password === 1);

  res = await call(`window.school.staff.create({ name: 'Dup Code', employeeCode: 'T-900' })`);
  check('duplicate employee code is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.staff.update(${staffId}, { designation: 'Senior Lecturer', status: 'on_leave' })`);
  check('staff record can be edited', res.ok && res.data.designation === 'Senior Lecturer' && res.data.status === 'on_leave', res);

  res = await call(`window.school.staff.remove(${staffId})`);
  check('staff without assignments can be deleted', res.ok === true, res);

  const assigned = getDb().prepare(`SELECT id FROM staff WHERE is_deleted = 0 AND staff_type = 'teacher' LIMIT 1`).get().id;
  res = await call(`window.school.staff.remove(${assigned})`);
  check('teacher with class assignments cannot be deleted', res.ok === false && res.error.code === 'STAFF_HAS_CLASSES', res);

  console.log('\n--- student attendance (admin) ----------------------------------------');
  const klass = getDb().prepare(`SELECT id FROM classes WHERE is_deleted = 0 ORDER BY level_order LIMIT 1`).get().id;
  const section = getDb().prepare(`SELECT id FROM sections WHERE class_id = ? AND is_deleted = 0 LIMIT 1`).get(klass).id;

  res = await call(`window.school.attendance.roster({ classId: ${klass}, sectionId: ${section}, date: '${today}' })`);
  check('roster lists the class students', res.ok && res.data.students.length > 0, res);
  check('roster reports the day summary', res.ok && typeof res.data.summary.present === 'number', res.ok ? res.data.summary : res);
  check('admin may edit any date', res.ok && res.data.editable === true);

  const rosterIds = res.ok ? res.data.students.map((s) => s.id) : [];
  res = await call(`window.school.attendance.markAllPresent({ classId: ${klass}, sectionId: ${section}, date: '${today}' })`);
  check('mark all present fills the register', res.ok && res.data.summary.present === rosterIds.length, res.ok ? res.data.summary : res);

  const entries = JSON.stringify(
    rosterIds.slice(0, 2).map((id, i) => ({ studentId: id, status: i === 0 ? 'absent' : 'late', remarks: 'test' })),
  );
  res = await call(`window.school.attendance.mark({ classId: ${klass}, sectionId: ${section}, date: '${today}', entries: ${entries} })`);
  check('individual statuses can be changed', res.ok && res.data.summary.absent === 1 && res.data.summary.late === 1, res.ok ? res.data.summary : res);

  const stored = getDb()
    .prepare(`SELECT status, remarks, marked_by FROM student_attendance WHERE student_id = ? AND date = ?`)
    .get(rosterIds[0], today);
  check('attendance row keeps status, remark and marker', stored.status === 'absent' && stored.remarks === 'test' && stored.marked_by === 1, stored);

  res = await call(`window.school.attendance.mark({ classId: ${klass}, sectionId: ${section}, date: '${today}', entries: ${JSON.stringify([{ studentId: rosterIds[0], status: 'present' }])} })`);
  check('re-marking the same day updates instead of duplicating', res.ok && res.data.summary.present === rosterIds.length - 1);

  res = await call(`window.school.attendance.register({ classId: ${klass}, sectionId: ${section}, month: '${month}' })`);
  check('register returns per-student percentages', res.ok && res.data.students[0].percentage >= 0, res.ok ? res.data.students[0] : res);
  check('register flags students below 75%', res.ok && typeof res.data.low === 'number', res.ok ? res.data.low : res);

  res = await call(`window.school.attendance.low({ month: '${month}', threshold: 100 })`);
  check('low attendance report lists students', res.ok && Array.isArray(res.data), res);

  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  res = await call(`window.school.attendance.mark({ classId: ${klass}, sectionId: ${section}, date: '${future}', entries: ${JSON.stringify([{ studentId: rosterIds[0], status: 'absent' }])} })`);
  check('future dates are rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  console.log('\n--- teacher scoping ---------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('teacher1', 'teacher123', 'teacher1234');

  res = await call(`window.school.structure.get()`);
  const assignedCount = getDb()
    .prepare(`SELECT COUNT(DISTINCT class_id) AS n FROM teacher_assignments WHERE is_active = 1`)
    .get().n;
  check('teacher structure only contains assigned classes', res.ok && res.data.classes.length === assignedCount, {
    got: res.ok ? res.data.classes.length : res,
    expected: assignedCount,
  });
  const myClass = res.ok ? res.data.classes[0].id : null;
  const mySection = res.ok ? res.data.sections.find((s) => s.class_id === myClass)?.id : null;
  check('teacher structure only contains assigned sections', res.ok && res.data.sections.length > 0);

  res = await call(`window.school.attendance.roster({ classId: ${myClass}, sectionId: ${mySection}, date: '${today}' })`);
  check('teacher can mark an assigned class today', res.ok === true, res);

  const otherClass = getDb().prepare(`SELECT id FROM classes WHERE id <> ? AND is_deleted = 0 LIMIT 1`).get(myClass).id;
  const otherSection = getDb().prepare(`SELECT id FROM sections WHERE class_id = ? LIMIT 1`).get(otherClass)?.id;

  // Seeded teachers cover all classes, so create one with no assignments to
  // prove the scoping rule rather than the seed data.
  res = await call(`window.school.auth.logout()`);
  await signIn('admin', 'admin1234');
  await call(`window.school.staff.create({ name: 'Unassigned Teacher', employeeCode: 'T-901', staffType: 'teacher', createLogin: true })`);
  await call(`window.school.auth.logout()`);
  await signIn('t-901', 't-901', 't901pass');

  res = await call(`window.school.structure.get()`);
  check('teacher with no assignments gets an empty structure', res.ok && res.data.classes.length === 0, res.ok ? res.data.classes.length : res);

  res = await call(`window.school.attendance.roster({ classId: ${otherClass}, sectionId: ${otherSection}, date: '${today}' })`);
  check('teacher is blocked from a class they do not teach', res.ok === false && res.error.code === 'FORBIDDEN', res);

  await call(`window.school.auth.logout()`);
  await signIn('teacher1', 'teacher1234');

  res = await call(`window.school.attendance.mark({ classId: ${myClass}, sectionId: ${mySection}, date: '2025-01-15', entries: ${JSON.stringify([{ studentId: 1, status: 'absent' }])} })`);
  check('teacher cannot edit a past register', res.ok === false && res.error.code === 'EDIT_LOCKED', res);

  res = await call(`window.school.staffAttendance.day({ date: '${today}' })`);
  check('teacher cannot open the staff attendance desk', res.ok === false && res.error.code === 'FORBIDDEN', res);

  const ownStaff = getDb().prepare(`SELECT linked_id FROM users WHERE username = 'teacher1'`).get().linked_id;
  res = await call(`window.school.staffAttendance.month({ staffId: ${ownStaff}, month: '${month}' })`);
  check('teacher can read their own attendance month', res.ok && res.data.staff.id === ownStaff, res);

  res = await call(`window.school.staffAttendance.month({ staffId: ${ownStaff + 1}, month: '${month}' })`);
  check("teacher cannot read another staff member's attendance", res.ok === false && res.error.code === 'FORBIDDEN', res);

  console.log('\n--- leaves ------------------------------------------------------------');
  res = await call(`window.school.leaves.types()`);
  check('leave types are seeded', res.ok && res.data.length >= 3, res);
  const casual = res.ok ? res.data.find((x) => x.name === 'Casual') : null;

  res = await call(`window.school.leaves.apply({ staffId: ${ownStaff}, leaveTypeId: ${casual.id}, fromDate: '${today}', toDate: '${today}', reason: 'Family event' })`);
  const leaveId = res.ok ? res.data.id : null;
  check('teacher can apply for leave', res.ok && res.data.status === 'pending' && res.data.days === 1, res);

  res = await call(`window.school.leaves.apply({ staffId: ${ownStaff + 1}, leaveTypeId: ${casual.id}, fromDate: '${today}', toDate: '${today}' })`);
  check('teacher cannot apply for somebody else', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.leaves.balances({})`);
  check('teacher sees their own leave balance', res.ok && res.data.find((b) => b.name === 'Casual')?.used === 0, res);

  res = await call(`window.school.leaves.decide({ id: ${leaveId}, status: 'approved' })`);
  check('teacher cannot approve their own leave', res.ok === false && res.error.code === 'FORBIDDEN', res);

  console.log('\n--- office / admin approval ------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('office', 'office123', 'office1234');

  res = await call(`window.school.leaves.list({})`);
  check('office sees leave applications', res.ok && res.data.some((l) => l.id === leaveId), res.ok ? res.data.length : res);

  res = await call(`window.school.leaves.decide({ id: ${leaveId}, status: 'approved' })`);
  check('office can approve leave', res.ok && res.data.status === 'approved', res);

  res = await call(`window.school.leaves.balances({ staffId: ${ownStaff}, year: ${new Date().getFullYear()} })`);
  check('approved leave is deducted from the balance', res.ok && res.data.find((b) => b.name === 'Casual')?.used === 1, res);

  res = await call(`window.school.staffAttendance.day({ date: '${today}' })`);
  check('office can open the staff attendance desk', res.ok && Array.isArray(res.data.staff), res);

  const staffEntries = JSON.stringify(
    res.data.staff.slice(0, 3).map((s, i) => ({ staffId: s.id, status: i === 0 ? 'present' : 'absent', checkIn: '08:10', checkOut: '13:00' })),
  );
  res = await call(`window.school.staffAttendance.mark({ date: '${today}', entries: ${staffEntries} })`);
  check('office can mark staff attendance', res.ok && res.data.staff.filter((s) => s.status).length >= 3, res);

  res = await call(`window.school.staffAttendance.summary({ month: '${month}' })`);
  check('staff monthly summary computes percentages', res.ok && res.data.rows.every((r) => r.percentage >= 0), res.ok ? res.data.rows[0] : res);

  console.log('\n--- student self service ---------------------------------------------');
  const adm = `adm-${new Date().getFullYear()}-001`;
  await call(`window.school.auth.logout()`);
  await signIn(adm, `ADM-${new Date().getFullYear()}-001`, 'student1234');

  res = await call(`window.school.attendance.studentHistory({ month: '${month}' })`);
  check('student can read their own attendance without asking for an id', res.ok && res.data.student.name, res);
  check('student history includes daily entries', res.ok && res.data.days.length > 0, res.ok ? res.data.days.length : res);
  check('student history includes a yearly trend', res.ok && Array.isArray(res.data.yearly));

  res = await call(`window.school.attendance.studentHistory({ studentId: 2, month: '${month}' })`);
  check('student cannot read another student record', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.attendance.roster({ classId: ${klass}, sectionId: ${section}, date: '${today}' })`);
  check('student cannot open a class register', res.ok === false && res.error.code === 'FORBIDDEN', res);

  closeDatabase();
  console.log(`\n${failed === 0 ? 'ALL PHASE 3 TESTS PASSED' : `FAILURES: ${failures.length}`} (${passed} passed)`);
  if (failed) console.error(failures.map((f) => `  - ${f}`).join('\n'));
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);