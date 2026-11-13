'use strict';

/**
 * Phase 6 functional tests (dev tool): `npm run test:phase6`
 * Exam setup, papers, the lifecycle, marks entry, result computation,
 * report cards and the role boundaries around all of it.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-phase6-test');

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

/**
 * A check that could not be made because the data needed for it does not
 * exist. It is reported, but it never counts as a pass either.
 */
function skip(label, reason) {
  console.log(`  skip  ${label} (${reason})`);
}

const today = () => new Date().toISOString().slice(0, 10);

async function main() {
  const { initDatabase, getDb, closeDatabase } = require('../electron/db/connection');
  const { registerIpc } = require('../electron/ipc');

  initDatabase({ seed: true });
  registerIpc();

  console.log('\n--- channel wiring ---------------------------------------------------');
  const channels = require('../electron/ipc/channels');
  const preloadSource = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8');
  const channelValues = Object.entries(channels)
    .filter(([key]) => key !== 'PENDING')
    .map(([, value]) => value);
  const missingInPreload = channelValues.filter((value) => !preloadSource.includes(`'${value}'`));
  check('every channel in channels.js is mirrored in the preload bridge', missingInPreload.length === 0, missingInPreload);

  const preloadNames = [...preloadSource.matchAll(/^\s{2}([A-Z0-9_]+):\s*'([^']+)',/gm)].map((m) => m[2]);
  const missingInChannels = preloadNames.filter((value) => !channelValues.includes(value));
  check('every channel in the preload bridge exists in channels.js', missingInChannels.length === 0, missingInChannels);

  const apiSource = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'api.js'), 'utf8');
  check(
    'the renderer api client exposes the phase 6 groups',
    apiSource.includes('bridge.exams.saveMarks') && apiSource.includes('bridge.exams.myResults'),
  );

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.on('console-message', (...a) => {
    const level = typeof a[0] === 'object' ? a[1] : a[0];
    const message = typeof a[0] === 'object' ? a[2] : a[1];
    if (level === 3 || level === 'error') console.error(`  [renderer] ${String(message).slice(0, 300)}`);
  });

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));

  const call = (expr) =>
    win.webContents
      .executeJavaScript(`(async () => JSON.stringify(await (${expr})))()`, true)
      .then(JSON.parse)
      .catch((err) => {
        console.error(`  !! call threw for ${expr.slice(0, 120)} -> ${String(err).slice(0, 200)}`);
        throw err;
      });

  const signIn = async (username, password, newPassword) => {
    await call(`window.school.auth.login({ username: ${JSON.stringify(username)}, password: ${JSON.stringify(password)} })`);
    if (newPassword) {
      await call(`window.school.auth.changePassword({ currentPassword: ${JSON.stringify(password)}, newPassword: ${JSON.stringify(newPassword)} })`);
    }
  };

  await signIn('admin', 'admin123', 'admin1234');

  // -------------------------------------------------------------------------
  console.log('\n--- exam setup ------------------------------------------------------');
  let res = await call(`window.school.exams.types()`);
  check('exam types load', res.ok && res.data.length > 0, res.ok ? res.data.length : res);

  res = await call(`window.school.exams.list()`);
  check('the seeded exams are listed', res.ok && res.data.rows.length > 0, res.ok ? res.data.rows.length : res);

  const classId = getDb().prepare(`SELECT id FROM classes WHERE is_deleted = 0 ORDER BY level_order DESC LIMIT 1`).get().id;

  res = await call(`window.school.exams.create({ name: 'Unit Test', classId: ${classId}, startDate: '${today()}' })`);
  check('an exam can be created in draft', res.ok && res.data.status === 'draft', res);
  const examId = res.ok ? res.data.id : null;

  // A second exam is kept in draft throughout - it is what proves an
  // unpublished result cannot be read by a student.
  res = await call(`window.school.exams.create({ name: 'Still In Draft', classId: ${classId} })`);
  check('a second draft exam is created', res.ok, res);
  const draftExamId = res.ok ? res.data.id : null;

  res = await call(`window.school.exams.create({ classId: ${classId} })`);
  check('an exam without a name is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.exams.create({ name: 'X', classId: 999999 })`);
  check('an exam for an unknown class is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.exams.create({ name: 'X', classId: ${classId}, startDate: '${today()}', endDate: '2000-01-01' })`);
  check('an end date before the start date is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.exams.update(${examId}, { name: 'Unit Test 2', classId: ${classId} })`);
  check('an exam can be renamed', res.ok && res.data.name === 'Unit Test 2', res);

  // -------------------------------------------------------------------------
  console.log('\n--- papers ----------------------------------------------------------');
  const classSubjects = getDb()
    .prepare(`SELECT subject_id, max_marks, pass_marks FROM class_subjects WHERE class_id = ? AND is_active = 1 ORDER BY id`)
    .all(classId);

  res = await call(
    `window.school.exams.saveSubjects({ examId: ${examId}, subjects: ${JSON.stringify(
      classSubjects.map((cs, i) => ({
        subjectId: cs.subject_id,
        totalMarks: cs.max_marks,
        passMarks: cs.pass_marks,
        examDate: today(),
        sortOrder: i + 1,
      })),
    )} })`,
  );
  check('the paper list is saved', res.ok && res.data.subjects.length === classSubjects.length, res);
  const examSubjectIds = res.ok ? res.data.subjects.map((s) => s.id) : [];

  res = await call(
    `window.school.exams.saveSubjects({ examId: ${examId}, subjects: [{ subjectId: 999999, totalMarks: 50 }] })`,
  );
  check('a subject the class does not teach is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(
    `window.school.exams.saveSubjects({ examId: ${examId}, subjects: [{ subjectId: ${classSubjects[0].subject_id}, totalMarks: 10, passMarks: 50 }] })`,
  );
  check('pass marks above the total are rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  // Give the second exam its own paper list and open it for marks, so the
  // teacher-scope checks later run against an exam that is not locked.
  res = await call(
    `window.school.exams.saveSubjects({ examId: ${draftExamId}, subjects: ${JSON.stringify(
      classSubjects.map((cs, i) => ({
        subjectId: cs.subject_id,
        totalMarks: cs.max_marks,
        passMarks: cs.pass_marks,
        examDate: today(),
        sortOrder: i + 1,
      })),
    )} })`,
  );
  check('a second exam gets its own paper list', res.ok && res.data.subjects.length === classSubjects.length, res);

  res = await call(`window.school.exams.setStatus({ id: ${draftExamId}, status: 'marks_open' })`);
  check('the second exam can be opened for marks', res.ok && res.data.status === 'marks_open', res);

  // -------------------------------------------------------------------------
  console.log('\n--- lifecycle -------------------------------------------------------');
  res = await call(`window.school.exams.setStatus({ id: ${examId}, status: 'published' })`);
  check('a draft exam cannot jump straight to published', res.ok === false && res.error.code === 'INVALID_TRANSITION', res);

  res = await call(`window.school.exams.setStatus({ id: ${examId}, status: 'marks_open' })`);
  check('a draft exam can be opened for marks', res.ok && res.data.status === 'marks_open', res);

  res = await call(`window.school.exams.saveMarks({ examSubjectId: ${examSubjectIds[0]}, marks: [{ studentId: 1, marksObtained: 50 }] })`);
  check('a student who is not on the roster is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  // -------------------------------------------------------------------------
  console.log('\n--- marks -----------------------------------------------------------');
  const roster = getDb()
    .prepare(`SELECT id FROM students WHERE class_id = ? AND is_deleted = 0 AND status = 'active' ORDER BY id`)
    .all(classId)
    .map((r) => r.id);

  res = await call(`window.school.exams.markSheet({ examSubjectId: ${examSubjectIds[0]} })`);
  check('the marks sheet loads the class roster', res.ok && res.data.rows.length === roster.length, res.ok ? res.data.rows.length : res);
  check('an admin may enter marks for any paper', res.ok && res.data.canEnter === true, res);

  res = await call(`window.school.exams.markSheet({ examId: ${examId} })`);
  check('a paper sheet can also be opened by exam id', res.ok && res.data.subjects.length === classSubjects.length, res);

  // Every paper needs marks, otherwise computeResults correctly skips the student.
  const paperTotals = res.ok ? res.data.subjects.map((s) => s.totalMarks) : [];
  for (let p = 0; p < examSubjectIds.length; p += 1) {
    const paperTotal = paperTotals[p];
    res = await call(
      `window.school.exams.saveMarks({ examSubjectId: ${examSubjectIds[p]}, marks: ${JSON.stringify(
        roster.map((id, i) => ({ studentId: id, marksObtained: Math.max(0, paperTotal - i) })),
      )} })`,
    );
  }
  check('a full sheet of marks saves', res.ok && res.data.rows.every((r) => r.marksObtained !== null), res);

  const total = paperTotals[0];
  res = await call(
    `window.school.exams.saveMarks({ examSubjectId: ${examSubjectIds[0]}, marks: [{ studentId: ${roster[0]}, marksObtained: ${total + 5} }] })`,
  );
  check('a mark above the paper total is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(
    `window.school.exams.saveMarks({ examSubjectId: ${examSubjectIds[0]}, marks: [{ studentId: ${roster[0]}, marksObtained: -1 }] })`,
  );
  check('a negative mark is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  // -------------------------------------------------------------------------
  console.log('\n--- results ---------------------------------------------------------');
  res = await call(`window.school.exams.computeResults({ examId: ${examId} })`);
  check('results are computed from the marks', res.ok && res.data.computed === roster.length, res);
  check('the pass rate is reported', res.ok && typeof res.data.passPercentage === 'number', res);

  res = await call(`window.school.exams.resultSheet({ examId: ${examId} })`);
  check('the result sheet lists every student', res.ok && res.data.rows.length === roster.length, res);
  check('positions are assigned', res.ok && res.data.rows.some((r) => r.position === 1), res);
  check(
    'a grade from the editable scale is applied',
    res.ok && res.data.rows.every((r) => typeof r.grade === 'string' && r.grade.length > 0),
    res.ok ? res.data.rows[0] : res,
  );

  res = await call(`window.school.exams.stats(${examId})`);
  check('exam statistics load', res.ok && res.data.gradeDistribution.length > 0, res);

  res = await call(`window.school.exams.resultSheet({ examId: ${examId} })`);
  const bottom = res.ok && res.data.rows.find((r) => r.studentId === roster[roster.length - 1]);
  check('the weakest student is not ranked first', bottom && bottom.position > 1, bottom);

  // -------------------------------------------------------------------------
  console.log('\n--- report cards ----------------------------------------------------');
  res = await call(`window.school.exams.reportCard({ studentId: ${roster[0]}, examId: ${examId} })`);
  check('a report card resolves', res.ok && res.data.student.id === roster[0], res);
  check('the card carries the paper list', res.ok && res.data.items.length === classSubjects.length, res);
  check('the card carries a total', res.ok && res.data.result && res.data.result.totalMarks > 0, res);

  // -------------------------------------------------------------------------
  console.log('\n--- lifecycle end ---------------------------------------------------');
  res = await call(`window.school.exams.setStatus({ id: ${examId}, status: 'published' })`);
  check('an open exam can be published', res.ok && res.data.status === 'published', res);

  res = await call(`window.school.exams.setStatus({ id: ${examId}, status: 'draft' })`);
  check('a published exam cannot go back to draft', res.ok === false && res.error.code === 'INVALID_TRANSITION', res);

  res = await call(`window.school.exams.setStatus({ id: ${examId}, status: 'locked' })`);
  check('a published exam can be locked', res.ok && res.data.isLocked === true, res);

  res = await call(`window.school.exams.saveMarks({ examSubjectId: ${examSubjectIds[0]}, marks: [{ studentId: ${roster[0]}, marksObtained: 10 }] })`);
  check('a locked exam refuses marks', res.ok === false && res.error.code === 'EXAM_LOCKED', res);

  res = await call(`window.school.exams.computeResults({ examId: ${examId} })`);
  check('a locked exam refuses recomputation', res.ok === false && res.error.code === 'EXAM_LOCKED', res);

  res = await call(`window.school.exams.remove(${examId})`);
  check('a locked exam cannot be deleted', res.ok === false && res.error.code === 'EXAM_LOCKED', res);

  // -------------------------------------------------------------------------
  console.log('\n--- student access --------------------------------------------------');
  await call(`window.school.auth.logout()`);
  const ownStudent = getDb().prepare(`SELECT id, admission_no FROM students WHERE is_deleted = 0 ORDER BY id LIMIT 1`).get();
  const otherStudent = getDb().prepare(`SELECT id FROM students WHERE is_deleted = 0 AND id <> ? ORDER BY id LIMIT 1`).get(ownStudent.id);

  // A student on the seeded published exam class - the seed publishes one exam per class.
  const publishedForStudent = getDb()
    .prepare(
      `SELECT e.id FROM exams e JOIN students st ON st.class_id = e.class_id
       WHERE st.id = ? AND e.status = 'published' LIMIT 1`,
    )
    .get(ownStudent.id);
  const publishedExamId = publishedForStudent ? publishedForStudent.id : null;

  await signIn(String(ownStudent.admission_no).toLowerCase(), ownStudent.admission_no, 'student1234');

  res = await call(`window.school.exams.myResults()`);
  check('a student sees their own results', res.ok && res.data.rows.length > 0, res);
  check(
    'only published results are shown',
    res.ok && res.data.rows.every((row) => row.examId !== examId),
    res.ok ? res.data.rows.map((r) => r.examId) : res,
  );

  res = await call(`window.school.exams.reportCard({ examId: ${publishedExamId} })`);
  check('a student can open their own report card', res.ok, res);

  res = await call(`window.school.exams.reportCard({ studentId: ${otherStudent.id}, examId: ${publishedExamId} })`);
  check("a student cannot open someone else's report card", res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.exams.reportCard({ studentId: ${ownStudent.id}, examId: ${draftExamId} })`);
  check('a student cannot read an unpublished exam', res.ok === false && res.error.code === 'RESULT_NOT_PUBLISHED', res);

  res = await call(`window.school.exams.list()`);
  check('a student cannot list exams', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.exams.saveMarks({ examSubjectId: ${examSubjectIds[0]}, marks: [] })`);
  check('a student cannot enter marks', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.exams.computeResults({ examId: ${examId} })`);
  check('a student cannot compute results', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- teacher access --------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('teacher1', 'teacher123', 'teacher1234');

  res = await call(`window.school.exams.list()`);
  check('a teacher sees exams, scoped to their classes', res.ok && res.data.rows.length > 0, res);
  const teacherId = getDb().prepare(`SELECT linked_id FROM users WHERE username = 'teacher1'`).get().linked_id;
  const teacherClassIds = getDb()
    .prepare(`SELECT DISTINCT class_id AS id FROM teacher_assignments WHERE teacher_id = ? AND is_active = 1`)
    .all(teacherId)
    .map((r) => r.id);
  check(
    'a teacher never sees an exam outside their classes',
    res.ok && res.data.rows.every((row) => teacherClassIds.includes(row.classId)),
    res.ok ? res.data.rows.map((r) => r.classId) : res,
  );

  res = await call(`window.school.exams.create({ name: 'Nope', classId: ${classId} })`);
  check('a teacher cannot create an exam', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.exams.setStatus({ id: ${examId}, status: 'draft' })`);
  check('a teacher cannot change the exam lifecycle', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // The paper list for the draft exam was saved as admin in the setup section.

  const openSubject = getDb()
    .prepare(
      `SELECT es.id, es.subject_id FROM exam_subjects es
       JOIN subjects s ON s.id = es.subject_id
       WHERE es.exam_id = ? AND s.id NOT IN (
         SELECT subject_id FROM teacher_assignments WHERE teacher_id = ? AND class_id = ? AND is_active = 1
       ) LIMIT 1`,
    )
    .get(draftExamId, teacherId, classId);

  if (openSubject && teacherClassIds.includes(classId)) {
    res = await call(`window.school.exams.saveMarks({ examSubjectId: ${openSubject.id}, marks: [{ studentId: ${roster[0]}, marksObtained: 5 }] })`);
    check('a teacher cannot enter marks for a subject they do not teach', res.ok === false && res.error.code === 'FORBIDDEN', res);
  } else {
    // The seed gives every teacher every class, so there may be no paper they
    // do not teach. That is reported as a skip - never as a pass.
    skip('a teacher cannot enter marks for a subject they do not teach', 'no paper outside the teacher assignments exists');
  }

  res = await call(`window.school.exams.resultSheet({ examId: ${examId} })`);
  check(
    'a teacher assigned to the class can read the result sheet',
    res.ok === true,
    res,
  );

  // Seeded teachers cover every class, so prove the boundary with one who has none.
  await call(`window.school.auth.logout()`);
  await signIn('admin', 'admin1234');
  await call(`window.school.staff.create({ name: 'Unassigned Teacher', employeeCode: 'T-906', staffType: 'teacher', createLogin: true })`);
  await call(`window.school.auth.logout()`);
  await signIn('t-906', 't-906', 't906pass');

  res = await call(`window.school.exams.resultSheet({ examId: ${examId} })`);
  check('a teacher cannot read results for a class they do not teach', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- audit trail -----------------------------------------------------');
  const actions = getDb().prepare(`SELECT DISTINCT action FROM audit_log`).all().map((r) => r.action);
  check(
    'exam actions are audited',
    ['exam.status', 'exam.marks', 'exam.compute', 'exam.subjects'].every((a) => actions.includes(a)),
    actions,
  );

  closeDatabase();
  console.log(`\n${failed === 0 ? 'ALL PHASE 6 TESTS PASSED' : `FAILURES: ${failures.length}`} (${passed} passed)`);
  if (failed) console.error(failures.map((f) => `  - ${f}`).join('\n'));
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);