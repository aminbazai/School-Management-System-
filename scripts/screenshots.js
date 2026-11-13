'use strict';

/**
 * Visual / end-to-end check (dev tool).
 *
 * Boots the real main-process modules (database + IPC + preload) against the
 * production renderer build, signs in through the real IPC channel, and writes
 * PNG screenshots of each role workspace to ./screenshots.
 *
 * Usage:
 *   npm run build
 *   npm run shots
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'sms-shots');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', TMP);
app.disableHardwareAcceleration();

const problems = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  // Wait for two animation frames so the compositor has a fully painted surface.
  await js(win, `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 300))))`);
  win.webContents.invalidate();
  await wait(400);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  console.log(`  captured ${name}.png`);
}

/** Navigates through the hash router and waits until the new page is rendered. */
/**
 * Navigates to a hash route and waits for the page to render.
 * `options.second` reads the page heading instead of the top-bar heading.
 */
async function goto(win, hash, expectHeading, options = {}) {
  await js(win, `location.hash = ${JSON.stringify(hash)}; true`);
  // A hidden window only produces a fresh frame after a full load, so reload.
  await js(win, `location.reload(); true`);

  const readHeading = () =>
    js(
      win,
      `(() => {
         const list = [...document.querySelectorAll('h1')].map((el) => el.textContent || '');
         return ${options.second ? 'list[list.length - 1]' : 'list[0]'} || '';
       })()`,
    ).catch(() => '');

  for (let i = 0; i < 30; i += 1) {
    await wait(200);
    const heading = await readHeading();
    if (!expectHeading || String(heading).includes(expectHeading)) {
      await wait(500);
      return heading;
    }
  }

  const heading = await readHeading();
  problems.push(`navigation to ${hash} did not render (heading: ${heading})`);
  return heading;
}

async function js(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

/** Signs in through the real IPC channel and waits for the renderer to pick it up. */
async function signIn(win, username, password, newPassword, hash) {
  const result = await js(
    win,
    `(async () => {
      const res = await window.school.auth.login({ username: ${JSON.stringify(username)}, password: ${JSON.stringify(password)} });
      if (!res.ok) return 'LOGIN_FAILED:' + JSON.stringify(res.error);
      ${
        newPassword
          ? `const cp = await window.school.auth.changePassword({currentPassword:${JSON.stringify(password)}, newPassword:${JSON.stringify(newPassword)}});
             if (!cp.ok) return 'CHANGE_FAILED:' + JSON.stringify(cp.error);`
          : ''
      }
      return 'OK';
    })()`,
  );
  if (String(result).startsWith('LOGIN_FAILED')) problems.push(`login ${username}: ${result}`);
  if (String(result).startsWith('CHANGE_FAILED')) problems.push(`change password ${username}: ${result}`);
  await js(win, `location.hash = ${JSON.stringify(hash)}; true`);
  await js(win, `location.reload(); true`);
  await wait(2200);

  const state = await js(
    win,
    `JSON.stringify({
       hash: location.hash,
       hasSidebar: !!document.querySelector('aside'),
       heading: document.querySelector('h1')?.textContent || null,
       body: document.body.innerText.slice(0, 120),
     })`,
  );
  const parsed = JSON.parse(state);
  if (!parsed.hasSidebar) problems.push(`no workspace rendered for ${hash}: ${parsed.body}`);
  return parsed;
}

async function main() {
  const { initDatabase, closeDatabase } = require('../electron/db/connection');
  const { registerIpc } = require('../electron/ipc');

  initDatabase({ seed: true });
  registerIpc();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false, // headless machines have no display surface to capture
    backgroundColor: '#05070c',
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.webContents.on('console-message', (...args) => {
    // Electron >=37 passes (event, level, message, line, sourceId)
    const message = typeof args[0] === 'object' ? args[2] : args[1];
    const level = typeof args[0] === 'object' ? args[1] : args[0];
    if (level === 'error' || level === 3) {
      problems.push(message);
      console.error(`  [renderer error] ${message}`);
    }
  });

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await wait(1200);

  console.log('\n1. login screen');
  await shot(win, '01-login');

  console.log('\n2. admin workspace (forced password change first)');
  await js(
    win,
    `(async () => {
      const res = await window.school.auth.login({ username: 'admin', password: 'admin123' });
      return res.ok ? 'OK' : 'FAIL';
    })()`,
  );
  await js(win, `location.hash = '#/admin/dashboard'; location.reload(); true`);
  await wait(2000);
  await shot(win, '02-admin-first-login-change-password');

  const changeResult = await js(
    win,
    `window.school.auth.changePassword({currentPassword:'admin123', newPassword:'admin1234'})`,
  );
  console.log(`  changePassword -> ${JSON.stringify(changeResult)}`);
  if (!changeResult || !changeResult.ok) problems.push(`admin changePassword: ${JSON.stringify(changeResult)}`);
  await js(win, `location.hash = '#/admin/dashboard'; true`);
  await js(win, `location.reload(); true`);
  await wait(2000);
  await shot(win, '03-admin-dashboard');

  await goto(win, '#/admin/users', 'Users');
  await shot(win, '04-admin-users');

  console.log('\n2b. phase 2 modules');
  await goto(win, '#/admin/students', 'Students');
  await wait(600);
  await shot(win, '05-admin-students');

  await goto(win, '#/admin/classes', 'Classes');
  await wait(600);
  await shot(win, '06-admin-classes');

  // the teacher assignments tab decides what a teacher can reach
  await js(
    win,
    `(async () => {
       const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith('Teacher Assignments'));
       if (btn) btn.click();
       return 'OK';
     })()`,
  );
  await wait(1200);
  await shot(win, '06b-admin-teacher-assignments');

  await goto(win, '#/admin/settings', 'Settings');
  await wait(600);
  await shot(win, '07-admin-settings');

  // the danger zone
  await js(
    win,
    `(async () => {
       const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Data');
       if (btn) btn.click();
       return 'OK';
     })()`,
  );
  await wait(1400);
  await shot(win, '07a-admin-data');

  console.log('\n2c. phase 3 modules');
  await goto(win, '#/admin/staff', 'Teachers');
  await wait(700);
  await shot(win, '07b-admin-staff');

  await goto(win, '#/admin/attendance', 'Attendance');
  await wait(900);
  await shot(win, '07c-admin-attendance');

  await goto(win, '#/admin/attendance-reports', 'Attendance Reports');
  await wait(900);
  await shot(win, '07d-admin-attendance-reports');

  console.log('\n2d. phase 4 modules');
  await goto(win, '#/admin/salary', 'Salary Management', { second: true });
  await wait(1200);
  await shot(win, '07e-admin-salary');

  console.log('\n2e. phase 5 modules');
  // a month of vouchers to look at (generate is admin-only)
  await js(
    win,
    `(async () => {
       const d = new Date(); d.setMonth(d.getMonth() + 1);
       const month = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
       const res = await window.school.fees.generate({ month: month.slice(0, 4), period: month.slice(5, 7) });
       return res.ok ? 'OK' : 'SKIP';
     })()`,
  ).then((r) => {
    if (r !== 'OK') console.log(`  fee generate -> ${r}`);
  });

  await goto(win, '#/admin/fees', 'Fee Management', { second: true });
  await wait(1400);
  await shot(win, '07f-admin-fees');

  await goto(win, '#/admin/expenses', 'Expenses', { second: true });
  await wait(1000);
  await shot(win, '07g-admin-expenses');

  console.log('\n2f. phase 6 modules');
  await goto(win, '#/admin/exams', 'Exams', { second: true });
  await wait(1200);
  await shot(win, '07h-admin-exams');

  await goto(win, '#/admin/exams', 'Exams', { second: true });
  await js(
    win,
    `(async () => {
       // The results tab needs an exam that has results; the seed publishes one
       // per class, so switch the tab by clicking its button.
       const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Results');
       if (btn) btn.click();
       return 'OK';
     })()`,
  );
  await wait(1600);
  await shot(win, '07i-admin-results');

  console.log('\n2g. phase 7 modules');
  await goto(win, '#/admin/timetable', 'Timetable');
  await wait(1200);
  await shot(win, '07j-admin-timetable');

  await goto(win, '#/admin/notices', 'Notices');
  await wait(900);
  await shot(win, '07k-admin-notices');

  console.log('\n2h. phase 8 modules');
  await goto(win, '#/admin/backup', 'Backup');
  await wait(900);
  await shot(win, '07l-admin-backup');

  await goto(win, '#/admin/audit', 'Audit Log');
  await wait(900);
  await shot(win, '07m-admin-audit');

  console.log('\n3. office workspace');
  await js(win, `window.school.auth.logout(); true`);
  await signIn(win, 'office', 'office123', 'office1234', '#/office/dashboard');
  await shot(win, '08-office-dashboard');

  await goto(win, '#/office/admissions', 'Admissions');
  await shot(win, '08b-office-admissions');

  await goto(win, '#/office/staff-attendance', 'Teacher Attendance');
  await wait(900);
  await shot(win, '08c-office-staff-attendance');

  // the leave desk, on the balances view
  await js(
    win,
    `(async () => {
       const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Leave balances');
       if (btn) btn.click();
       return 'OK';
     })()`,
  );
  await wait(1400);
  await shot(win, '08c2-office-leave-balances');

  await goto(win, '#/office/fees', 'Fee Management', { second: true });
  await wait(1400);
  await shot(win, '08d-office-fees');

  await goto(win, '#/office/expenses', 'Expenses', { second: true });
  await wait(1000);
  await shot(win, '08e-office-expenses');

  await goto(win, '#/office/reports', 'Reports');
  await wait(1200);
  await shot(win, '08f-office-reports');

  console.log('\n4. teacher workspace');
  await js(win, `window.school.auth.logout(); true`);
  await signIn(win, 'teacher1', 'teacher123', 'teacher1234', '#/teacher/dashboard');
  await shot(win, '09-teacher-dashboard');

  await goto(win, '#/teacher/attendance', 'Attendance');
  await wait(900);
  await shot(win, '09b-teacher-attendance');

  await goto(win, '#/teacher/my-attendance', 'My Attendance');
  await wait(900);
  await shot(win, '09c-teacher-my-attendance');

  await goto(win, '#/teacher/my-leave', 'My Leave');
  await wait(1200);
  await shot(win, '09c2-teacher-my-leave');

  await goto(win, '#/teacher/salary', 'My Salary Slips');
  await wait(1200);
  await shot(win, '09d-teacher-salary');

  await goto(win, '#/teacher/marks', 'Marks');
  await wait(1200);
  await shot(win, '09e-teacher-marks');

  await goto(win, '#/teacher/timetable', 'Timetable');
  await wait(900);
  await shot(win, '09f-teacher-timetable');

  console.log('\n5. student workspace');
  const adm = `ADM-${new Date().getFullYear()}-001`;
  await js(win, `window.school.auth.logout(); true`);
  await signIn(win, adm.toLowerCase(), adm, 'student1234', '#/student/dashboard');
  await shot(win, '10-student-dashboard');

  await goto(win, '#/student/class', 'Class');
  await shot(win, '10b-student-class');

  await goto(win, '#/student/attendance', 'My Attendance');
  await wait(900);
  await shot(win, '10c-student-attendance');

  await goto(win, '#/student/fees', 'Fee Status', { second: true });
  await wait(1200);
  await shot(win, '10d-student-fees');

  await goto(win, '#/student/results', 'Results', { second: true });
  await wait(1200);
  await shot(win, '10e-student-results');

  await goto(win, '#/student/timetable', 'Timetable');
  await wait(900);
  await shot(win, '10f-student-timetable');

  console.log('\n6. urdu / RTL');
  await js(win, `localStorage.setItem('sms.language','ur'); location.reload(); true`);
  await wait(2200);
  await shot(win, '11-student-dashboard-ur');

  await js(win, `window.school.auth.logout(); true`);
  await signIn(win, 'admin', 'admin1234', null, '#/admin/dashboard');
  await shot(win, '12-admin-dashboard-ur');

  closeDatabase();
  console.log(problems.length ? `\nRENDERER PROBLEMS:\n${problems.join('\n')}` : '\nNo renderer errors.');
  app.exit(0);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);