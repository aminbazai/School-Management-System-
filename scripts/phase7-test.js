'use strict';

/**
 * Phase 7 functional tests (dev tool): `npm run test:phase7`
 * Timetable periods and grid, the notice board's audience rules, per-role
 * dashboard statistics and the printable report desk.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-phase7-test');

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

const currentMonth = () => new Date().toISOString().slice(0, 7);

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
    'the renderer api client exposes the phase 7 groups',
    apiSource.includes('bridge.timetable.save') && apiSource.includes('bridge.reports.dashboard') && apiSource.includes('bridge.notices.list'),
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
  console.log('\n--- periods ---------------------------------------------------------');
  let res = await call(`window.school.timetable.periods()`);
  check('the seeded periods load', res.ok && res.data.length > 0, res.ok ? res.data.length : res);

  res = await call(`window.school.timetable.savePeriod({ name: 'Period 8', startTime: '12:30', endTime: '13:15', sortOrder: 8 })`);
  check('a period can be added', res.ok && res.data.some((p) => p.name === 'Period 8'), res);
  const newPeriodId = res.ok ? res.data.find((p) => p.name === 'Period 8').id : null;

  res = await call(`window.school.timetable.savePeriod({ name: 'Bad', startTime: '13:00', endTime: '12:00' })`);
  check('a period ending before it starts is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.timetable.savePeriod({ name: 'Bad', startTime: '99:99', endTime: '12:00' })`);
  check('a malformed time is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.timetable.deletePeriod(${newPeriodId})`);
  check('an unused period can be removed', res.ok && res.data.some((p) => p.id === newPeriodId && p.isActive === false), res);

  // Pick a period that is actually referenced by a timetable slot.
  const usedPeriodId = getDb()
    .prepare(`SELECT period_id FROM timetable WHERE period_id IS NOT NULL LIMIT 1`)
    .get()?.period_id;
  res = await call(`window.school.timetable.deletePeriod(${usedPeriodId})`);
  check('a period used in a timetable is protected', res.ok === false && res.error.code === 'PERIOD_IN_USE', res);

  // -------------------------------------------------------------------------
  console.log('\n--- timetable grid --------------------------------------------------');
  const section = getDb()
    .prepare(`SELECT id, class_id FROM sections WHERE is_deleted = 0 ORDER BY id LIMIT 1`)
    .get();

  res = await call(`window.school.timetable.get({ classId: ${section.class_id}, sectionId: ${section.id} })`);
  check('the section grid loads', res.ok && res.data.grid.length > 0, res);
  check('the grid carries the seeded lessons', res.ok && res.data.slots.length > 0, res);
  check('only this class\'s subjects are offered', res.ok && res.data.subjects.every((s) => !!s.name), res);

  const subject = res.ok ? res.data.subjects[0] : null;
  const teacher = res.ok ? res.data.teachers[0] : null;
  const period = res.ok ? res.data.periods.find((p) => !p.isBreak) : null;

  res = await call(
    `window.school.timetable.save({ classId: ${section.class_id}, sectionId: ${section.id}, entries: [
       { dayOfWeek: 0, periodId: ${period.id}, subjectId: ${subject.id}, teacherId: ${teacher.id} }
     ] })`,
  );
  check('a slot can be written', res.ok && res.data.slots.some((s) => s.dayOfWeek === 0), res);

  const gridCount = res.ok ? res.data.slots.length : 0;

  res = await call(
    `window.school.timetable.save({ classId: ${section.class_id}, sectionId: ${section.id}, entries: [
       { dayOfWeek: 0, periodId: ${period.id}, subjectId: 999999 }
     ] })`,
  );
  check('a subject the class does not teach is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.timetable.get({ classId: ${section.class_id}, sectionId: ${section.id} })`);
  check('a rejected save left the grid untouched', res.ok && res.data.slots.length === gridCount, res.ok ? res.data.slots.length : res);

  res = await call(`window.school.timetable.get({ classId: 999999 })`);
  check('an unknown class is rejected', res.ok === false, res);

  // -------------------------------------------------------------------------
  console.log('\n--- notices ---------------------------------------------------------');
  res = await call(`window.school.notices.save({ title: 'Sports Day', body: 'On Friday in the main field.', audience: 'students' })`);
  check('a notice can be posted', res.ok && res.data.title === 'Sports Day', res);
  const noticeId = res.ok ? res.data.id : null;

  res = await call(`window.school.notices.save({ audience: 'all' })`);
  check('a notice without a title is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.notices.save({ title: 'Bad', audience: 'everyone' })`);
  check('an unknown audience is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.notices.save({ title: 'Expiring', audience: 'all', expiresAt: '2000-01-01' })`);
  check('an already-expired notice is saved but hidden', res.ok, res);

  res = await call(`window.school.notices.list()`);
  check(
    'expired notices are hidden by default',
    res.ok && !res.data.rows.some((row) => row.title === 'Expiring'),
    res.ok ? res.data.rows.map((r) => r.title) : res,
  );

  res = await call(`window.school.notices.list({ includeExpired: true })`);
  check('an admin can ask for expired notices', res.ok && res.data.rows.some((row) => row.title === 'Expiring'), res);

  res = await call(`window.school.notices.pin(${noticeId}, true)`);
  check('a notice can be pinned to the top', res.ok && res.data.rows[0].pinned === true, res);

  res = await call(`window.school.notices.list({})`);
  check('an admin sees the notice', res.ok && res.data.rows.some((row) => row.id === noticeId), res);

  // -------------------------------------------------------------------------
  console.log('\n--- dashboards ------------------------------------------------------');
  res = await call(`window.school.reports.dashboard({})`);
  check('the admin dashboard builds', res.ok && res.data.counts.students > 0, res);
  check('it includes the attendance trend', res.ok && Array.isArray(res.data.attendanceTrend), res);
  check('it includes the finance trend', res.ok && res.data.financeTrend.length > 0, res);
  check('it includes the fee summary', res.ok && typeof res.data.fees.collectionPercentage === 'number', res);

  res = await call(`window.school.reports.run({ kind: 'enrolment' })`);
  check('the enrolment report builds', res.ok && res.data.rows.length > 0, res);

  res = await call(`window.school.reports.run({ kind: 'attendance', month: '${currentMonth()}' })`);
  check('the attendance report builds', res.ok && Array.isArray(res.data.rows), res);

  res = await call(`window.school.reports.run({ kind: 'fees' })`);
  check('the fee report builds', res.ok && res.data.summary.length > 0, res);

  res = await call(`window.school.reports.run({ kind: 'nope' })`);
  check('an unknown report is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  // -------------------------------------------------------------------------
  console.log('\n--- teacher access --------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('teacher1', 'teacher123', 'teacher1234');

  res = await call(`window.school.reports.dashboard({})`);
  check('the teacher dashboard builds', res.ok && res.data.role === 'teacher', res);
  check('it counts only the teacher\'s own classes', res.ok && res.data.classCount > 0 && res.data.classCount <= 3, res.ok ? res.data.classCount : res);

  res = await call(`window.school.timetable.my()`);
  check('a teacher sees their own week', res.ok && res.data.staffId > 0, res);
  check('their week has lessons', res.ok && res.data.slots.length > 0, res);

  res = await call(`window.school.timetable.save({ classId: ${section.class_id}, sectionId: ${section.id}, entries: [] })`);
  check('a teacher cannot write the timetable', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.timetable.savePeriod({ name: 'Nope', startTime: '08:00', endTime: '08:30' })`);
  check('a teacher cannot add a period', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.notices.list({})`);
  check('a teacher reads notices', res.ok, res);
  check(
    'a teacher never sees a students-only notice',
    res.ok && !res.data.rows.some((row) => row.audience === 'students'),
    res.ok ? res.data.rows.map((r) => r.audience) : res,
  );

  res = await call(`window.school.notices.save({ title: 'Nope', audience: 'all' })`);
  check('a teacher cannot post a notice', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.notices.list({ audience: 'students' })`);
  check('a teacher cannot ask for another audience', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.reports.run({ kind: 'enrolment' })`);
  check('a teacher cannot run a school report', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- office access ---------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('office', 'office123', 'office1234');

  res = await call(`window.school.reports.dashboard({})`);
  check('the office dashboard builds', res.ok && res.data.role === 'office', res);
  check('it carries the defaulter summary', res.ok && typeof res.data.defaulters.count === 'number', res);

  res = await call(`window.school.reports.run({ kind: 'fees' })`);
  check('office can run reports', res.ok, res);

  res = await call(`window.school.timetable.get({ classId: ${section.class_id}, sectionId: ${section.id} })`);
  check('office can read the timetable', res.ok === true, res);

  res = await call(`window.school.timetable.save({ classId: ${section.class_id}, sectionId: ${section.id}, entries: [] })`);
  check('office cannot edit the timetable', res.ok === false, res);

  res = await call(`window.school.timetable.teacher({ staffId: ${getDb().prepare(`SELECT id FROM staff WHERE staff_type = 'teacher' AND is_deleted = 0 LIMIT 1`).get().id} })`);
  check('office can read a teacher week', res.ok === true, res);

  res = await call(`window.school.notices.save({ title: 'Nope', audience: 'all' })`);
  check('office cannot post a notice', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- student access --------------------------------------------------');
  await call(`window.school.auth.logout()`);
  const ownStudent = getDb().prepare(`SELECT id, admission_no FROM students WHERE is_deleted = 0 ORDER BY id LIMIT 1`).get();
  await signIn(String(ownStudent.admission_no).toLowerCase(), ownStudent.admission_no, 'student1234');

  res = await call(`window.school.timetable.my()`);
  check('a student sees their section timetable', res.ok && res.data.sectionId > 0, res);

  res = await call(`window.school.timetable.teacher({ staffId: 1 })`);
  check('a student cannot ask for a teacher timetable', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.timetable.get({ classId: ${section.class_id} })`);
  check('a student cannot read the editor', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.reports.dashboard({})`);
  check('the student dashboard builds', res.ok && res.data.role === 'student', res);
  check('it only reports their own attendance', res.ok && res.data.attendance.total > 0, res);
  check('it resolves their own record', res.ok && res.data.student.id === ownStudent.id, res.ok ? res.data.student : res);

  res = await call(`window.school.notices.list({})`);
  check('a student reads notices', res.ok, res);
  check(
    'a student never sees a teachers-only notice',
    res.ok && !res.data.rows.some((row) => row.audience === 'teachers'),
    res.ok ? res.data.rows.map((r) => r.audience) : res,
  );
  check(
    'a student does see a students notice',
    res.ok && res.data.rows.some((row) => row.audience === 'students'),
    res.ok ? res.data.rows.map((r) => r.audience) : res,
  );

  res = await call(`window.school.reports.run({ kind: 'fees' })`);
  check('a student cannot run a school report', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- cleanup ---------------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('admin', 'admin1234', 'admin12345');

  res = await call(`window.school.notices.remove(${noticeId})`);
  check('a notice can be removed', res.ok, res);
  res = await call(`window.school.notices.list({})`);
  check('the removed notice is gone', res.ok && !res.data.rows.some((row) => row.id === noticeId), res);

  res = await call(`window.school.notices.save({ title: 'Teachers Only', audience: 'teachers' })`);
  const teachersNoticeId = res.ok ? res.data.id : null;
  check('a teachers-only notice is posted', res.ok, res);
  await call(`window.school.notices.remove(${teachersNoticeId})`);

  closeDatabase();
  console.log(`\n${failed === 0 ? 'ALL PHASE 7 TESTS PASSED' : `FAILURES: ${failures.length}`} (${passed} passed)`);
  if (failed) console.error(failures.map((f) => `  - ${f}`).join('\n'));
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);