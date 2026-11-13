'use strict';

/**
 * Phase 2 functional tests (dev tool): `npm run test:phase2`
 *
 * Exercises the academic structure + student services through the real IPC
 * bridge: CRUD, validation, guards, promotion, import mapping and exports.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-phase2-test');

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
    console.error(`  FAIL  ${label}${detail ? ` -> ${JSON.stringify(detail).slice(0, 220)}` : ''}`);
  }
}

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

  console.log('\n--- academic structure ---------------------------------------------');
  let res = await call(`window.school.structure.get()`);
  check('structure returns classes/sections/subjects/sessions', res.ok && res.data.classes.length > 0 && res.data.sections.length > 0, res);

  res = await call(`window.school.classes.create({ name: 'Class 9', levelOrder: 9 })`);
  const newClassId = res.ok ? res.data.id : null;
  check('admin can create a class', res.ok && res.data.name === 'Class 9', res);

  res = await call(`window.school.classes.create({ name: 'Class 9' })`);
  check('duplicate class name is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.classes.create({ name: '' })`);
  check('empty class name is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.sections.create({ classId: ${newClassId}, name: 'A', capacity: 25, roomNo: 'R-9A' })`);
  const newSectionId = res.ok ? res.data.id : null;
  check('admin can create a section', res.ok && res.data.capacity === 25, res);

  res = await call(`window.school.sections.create({ classId: ${newClassId}, name: 'A' })`);
  check('duplicate section in the same class is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.sections.create({ classId: 99999, name: 'B' })`);
  check('section for a non-existent class is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.subjects.create({ name: 'Computer Science', code: 'CS' })`);
  const newSubjectId = res.ok ? res.data.id : null;
  check('admin can create a subject', res.ok, res);

  res = await call(`window.school.classSubjects.save({ classId: ${newClassId}, subjectId: ${newSubjectId}, maxMarks: 100, passMarks: 45, weeklyPeriods: 4 })`);
  check('subject can be assigned to a class', res.ok && res.data.length === 1, res);

  res = await call(`window.school.classSubjects.save({ classId: ${newClassId}, subjectId: ${newSubjectId}, maxMarks: 100, passMarks: 120 })`);
  check('pass marks above max marks is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.sessions.create({ name: '2030-2031', startDate: '2030-04-01', endDate: '2031-03-31' })`);
  const sessionId = res.ok ? res.data.id : null;
  check('admin can create an academic session', res.ok, res);

  res = await call(`window.school.sessions.create({ name: 'bad', startDate: '2030-04-01', endDate: '2029-01-01' })`);
  check('end date before start date is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.sessions.activate(${sessionId})`);
  check('session can be activated', res.ok === true, res);
  check(
    'activating a session updates the settings',
    getDb().prepare(`SELECT value FROM settings WHERE key = 'session'`).get().value === '2030-2031',
  );
  await call(`window.school.settings.update({ session: '2026-2027' })`);

  console.log('\n--- students --------------------------------------------------------');
  res = await call(`window.school.students.list({ page: 1, pageSize: 5 })`);
  check('students list paginates', res.ok && res.data.rows.length === 5 && res.data.total >= 24, res);
  const firstPageTotal = res.ok ? res.data.total : 0;

  res = await call(`window.school.students.list({ page: 1, pageSize: 5, search: 'Ayesha' })`);
  check('search filters by name', res.ok && res.data.rows.every((r) => /ayesha/i.test(r.name)), res);

  res = await call(`window.school.students.list({ page: 1, pageSize: 5, sortBy: 'admission_no', sortDir: 'desc' })`);
  check('sorting by admission no desc works', res.ok && res.data.rows[0].admissionNo > res.data.rows[1].admissionNo, res);

  res = await call(`window.school.students.list({ page: 1, pageSize: 5, status: 'passed_out' })`);
  check('status filter works', res.ok && res.data.rows.length === 0, res);

  const firstClass = getDb().prepare(`SELECT id FROM classes WHERE is_deleted = 0 ORDER BY level_order LIMIT 1`).get().id;
  const firstSection = getDb().prepare(`SELECT id FROM sections WHERE class_id = ? LIMIT 1`).get(firstClass).id;

  res = await call(`window.school.students.create({ name: 'Test Student', classId: ${firstClass}, sectionId: ${firstSection}, gender: 'male', fatherName: 'Test Father', admissionDate: '2026-01-15', guardianName: 'Test Guardian', guardianPhone: '03001234567', createLogin: true })`);
  const studentId = res.ok ? res.data.id : null;
  check('admin can create a student', res.ok && /^ADM-/.test(res.data.admissionNo), res);

  const loginUser = res.ok
    ? getDb().prepare(`SELECT username FROM users WHERE role='student' AND linked_id = ?`).get(studentId)
    : null;
  check('student login is created with the admission number', !!loginUser, loginUser);

  res = await call(`window.school.students.create({ name: 'No Class Student' })`);
  check('student without a class is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.students.create({ name: 'Bad Section', classId: ${newClassId}, sectionId: ${firstSection} })`);
  check('section from another class is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.students.create({ name: 'Dup Admission', admissionNo: 'ADM-2026-001', classId: ${firstClass} })`);
  check('duplicate admission number is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.students.update(${studentId}, { status: 'left', phone: '03009998888' })`);
  check('admin can edit a student', res.ok && res.data.status === 'left' && res.data.phone === '03009998888', res);

  res = await call(`window.school.students.get(${studentId})`);
  check('student detail includes guardians', res.ok && res.data.guardianName === 'Test Guardian', res);

  console.log('\n--- promotion --------------------------------------------------------');
  res = await call(`window.school.students.promote({ ids: [${studentId}], classId: ${newClassId}, sectionId: ${newSectionId} })`);
  check('student can be promoted to another class', res.ok && res.data.moved === 1, res);
  res = await call(`window.school.students.get(${studentId})`);
  check('promotion updated class and section', res.ok && res.data.classId === newClassId && res.data.sectionId === newSectionId, res);

  res = await call(`window.school.students.promote({ ids: [${studentId}], classId: 99999 })`);
  check('promotion to an unknown class is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.students.promote({ fromClassId: ${newClassId}, classId: ${firstClass} })`);
  check('whole class can be promoted at once', res.ok && res.data.moved >= 1, res);

  console.log('\n--- import / export --------------------------------------------------');
  res = await call(`window.school.students.exportExcel({ classId: ${firstClass} })`);
  check('excel export opens a save dialog (cancel is handled)', res.ok === true, res);

  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Students');
  worksheet.addRow(['Admission No', 'Name', "Father's Name", 'Gender', 'Class', 'Section', 'Phone', 'Status']);
  worksheet.addRow(['', 'Imported One', 'Imported Father', 'Male', 'Class 1', 'A', '03001112222', 'Active']);
  worksheet.addRow(['', 'Imported Two', 'Imported Father', 'F', 'Not A Class', 'A', '', 'Active']);
  const buffer = await workbook.xlsx.writeBuffer();
  const importPath = path.join(TMP, 'students.xlsx');
  fs.writeFileSync(importPath, buffer);

  const { readWorkbook } = require('../electron/services/excel.service');
  const parsed = await readWorkbook(importPath);
  check('import parser recognises the standard headers', parsed.mapped.includes('name') && parsed.mapped.includes('class_name'), parsed.mapped);

  const { importRows } = require('../electron/services/students.service');
  const mapped = parsed.rows.map((cells) => {
    const row = {};
    parsed.mapped.forEach((key, index) => {
      if (key) row[key] = cells[index];
    });
    return row;
  });
  res = importRows({ rows: mapped, updateExisting: true }, { userId: 1, username: 'admin', role: 'admin' });
  check('valid rows are imported', res.imported === 1 && res.failed === 1, res);
  check('invalid rows are reported with a row number', res.errors[0] && res.errors[0].row === 3, res.errors);

  res = await call(`window.school.students.list({ search: 'Imported One', pageSize: 10 })`);
  check('imported student is searchable', res.ok && res.data.rows.length === 1, res);

  console.log('\n--- roles -------------------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('teacher1', 'teacher123', 'teacher1234');
  res = await call(`window.school.students.create({ name: 'Nope', classId: ${firstClass} })`);
  check('teacher cannot create students', res.ok === false && res.error.code === 'FORBIDDEN', res);
  res = await call(`window.school.classes.create({ name: 'Teacher Class' })`);
  check('teacher cannot create classes', res.ok === false && res.error.code === 'FORBIDDEN', res);
  res = await call(`window.school.students.list({ page: 1, pageSize: 5 })`);
  check('teacher can read the student list', res.ok === true, res);
  res = await call(`window.school.students.remove(${studentId})`);
  check('teacher cannot delete students', res.ok === false && res.error.code === 'FORBIDDEN', res);
  await call(`window.school.auth.logout()`);

  await signIn('office', 'office123', 'office1234');
  res = await call(`window.school.students.create({ name: 'Office Student', classId: ${firstClass} })`);
  check('office can admit students', res.ok === true, res);
  res = await call(`window.school.students.remove(${studentId})`);
  check('office cannot delete students', res.ok === false && res.error.code === 'FORBIDDEN', res);
  res = await call(`window.school.settings.update({ school_name: 'Hacked' })`);
  check('office cannot change settings', res.ok === false && res.error.code === 'FORBIDDEN', res);
  await call(`window.school.auth.logout()`);

  console.log('\n--- deletion & integrity ---------------------------------------------');
  await signIn('admin', 'admin1234');
  res = await call(`window.school.students.create({ name: 'Blocks Class Delete', classId: ${newClassId} })`);
  check('a student is placed in the new class', res.ok === true, res);

  res = await call(`window.school.classes.remove(${newClassId})`);
  check('class with students cannot be deleted', res.ok === false && res.error.code === 'CLASS_HAS_STUDENTS', res);

  const totalBeforeDelete = (await call(`window.school.students.list({ page: 1, pageSize: 5 })`)).data.total;
  res = await call(`window.school.students.remove(${studentId})`);
  check('admin can soft delete a student', res.ok === true, res);
  const deleted = getDb().prepare(`SELECT is_deleted FROM students WHERE id = ?`).get(studentId);
  check('soft delete keeps the row', deleted.is_deleted === 1, deleted);
  const linkedLogin = getDb().prepare(`SELECT is_deleted FROM users WHERE role='student' AND linked_id = ?`).get(studentId);
  check('student login is disabled with the student', linkedLogin.is_deleted === 1, linkedLogin);

  res = await call(`window.school.students.list({ page: 1, pageSize: 5 })`);
  check('deleted students disappear from the list', res.ok && res.data.total === totalBeforeDelete - 1, {
    before: totalBeforeDelete,
    after: res.ok ? res.data.total : null,
  });

  console.log('\n--- grade scale -------------------------------------------------------');
  res = await call(`window.school.gradeScale.list()`);
  check('default grade scale is available', res.ok && res.data.length >= 6, res);
  const aPlus = res.ok ? res.data.find((g) => g.name === 'A+') : null;
  res = await call(`window.school.gradeScale.save({ id: ${aPlus.id}, name: 'A+', minPercentage: 90, maxPercentage: 100, gradePoint: 5.5 })`);
  check('admin can edit a grade band', res.ok && res.data.find((g) => g.name === 'A+').grade_point === 5.5, res);
  res = await call(`window.school.gradeScale.save({ name: 'Bad', minPercentage: 10, maxPercentage: 90, gradePoint: 1 })`);
  check('overlapping grade bands are rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  closeDatabase();
  console.log(`\n${failed === 0 ? 'ALL PHASE 2 TESTS PASSED' : `FAILURES: ${failures.length}`} (${passed} passed)`);
  if (failed) console.error(failures.map((f) => `  - ${f}`).join('\n'));
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);
