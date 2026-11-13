'use strict';

/**
 * Security regression tests (dev tool): `npm run test:security`
 *
 * Everything is exercised through the real preload bridge against the real
 * IPC handlers - i.e. exactly what the renderer can do, and nothing more.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-security-test');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
app.setPath('userData', TMP);
app.disableHardwareAcceleration();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
    console.error(`  FAIL  ${label}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`);
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

  // Calls the bridge from inside the renderer and returns the raw envelope.
  const call = (expression) =>
    win.webContents.executeJavaScript(`(async () => JSON.stringify(await (${expression})))()`, true).then(JSON.parse);

  const login = (username, password) => call(`window.school.auth.login({ username: ${JSON.stringify(username)}, password: ${JSON.stringify(password)} })`);
  const logout = () => call(`window.school.auth.logout()`);

  console.log('\n--- authentication -------------------------------------------------');

  let res = await call(`window.school.auth.login({ username: 'admin', password: 'wrong' })`);
  check('wrong password is rejected', res.ok === false && res.error.code === 'INVALID_CREDENTIALS', res);

  res = await call(`window.school.auth.login({ username: 'ghost', password: 'whatever' })`);
  check('unknown user is rejected', res.ok === false && res.error.code === 'INVALID_CREDENTIALS', res);

  res = await call(`window.school.auth.login({ username: 'ad', password: 'short' })`);
  check('input is validated in main (VALIDATION_FAILED)', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  // 5 failed attempts -> lock for 5 minutes
  for (let i = 0; i < 5; i += 1) await call(`window.school.auth.login({ username: 'teacher2', password: 'wrong' })`);
  res = await call(`window.school.auth.login({ username: 'teacher2', password: 'teacher123' })`);
  check('account locks after 5 failed attempts', res.ok === false && res.error.code === 'ACCOUNT_LOCKED', res);

  const lockRow = getDb().prepare(`SELECT locked_until FROM users WHERE username = 'teacher2'`).get();
  check('lockout timestamp is written', !!lockRow.locked_until, lockRow);

  getDb().prepare(`UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE username = 'teacher2'`).run();
  res = await login('teacher2', 'teacher123');
  check('account works again once the lock expires', res.ok === true, res);

  console.log('\n--- forced password change -----------------------------------------');
  res = await call(`window.school.users.list({ limit: 5 })`);
  check('teacher cannot list users (role guard)', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.settings.update({ theme: 'light' })`);
  check('teacher cannot change settings (role guard)', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.audit.list({ limit: 5 })`);
  check('teacher cannot read the audit log (role guard)', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.users.create({ username: 'x', password: '123456', role: 'admin' })`);
  check('teacher cannot create users (role guard)', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.auth.changePassword({ currentPassword: 'teacher123', newPassword: 'nope' })`);
  check('password shorter than 6 is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.auth.changePassword({ currentPassword: 'teacher123', newPassword: 'teacher123' })`);
  check('new password must differ from the old one', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  console.log('\n--- admin access ----------------------------------------------------');
  await logout();
  res = await login('admin', 'admin123');
  check('admin signs in', res.ok === true, res);

  res = await call(`window.school.users.list({ limit: 5 })`);
  check('first login blocks the app until the password is changed', res.ok === false && res.error.code === 'PASSWORD_CHANGE_REQUIRED', res);

  res = await call(`window.school.auth.changePassword({ currentPassword: 'admin123', newPassword: 'admin1234' })`);
  check('admin completes the forced password change', res.ok === true, res);

  res = await call(`window.school.users.list({ limit: 5 })`);
  check('admin can list users', res.ok === true && res.data.rows.length === 5, res);

  res = await call(`window.school.audit.list({ limit: 5 })`);
  check('admin can read the audit log', res.ok === true && res.data.total > 0, res);

  res = await call(`window.school.settings.update({ theme: 'light' })`);
  check('admin can update settings', res.ok === true && res.data.theme === 'light', res);
  await call(`window.school.settings.update({ theme: 'dark' })`);

  res = await call(`window.school.users.create({ username: 'temp-teacher', password: '123', role: 'teacher' })`);
  check('weak password on create is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.users.create({ username: 'admin', password: 'secret123', role: 'teacher' })`);
  check('duplicate username is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.users.create({ username: 'temp-teacher', password: 'secret123', role: 'teacher' })`);
  check('admin can create a user', res.ok === true, res);
  const createdId = res.ok ? res.data.id : null;

  res = await call(`window.school.users.setActive(${createdId}, false)`);
  check('admin can deactivate a user', res.ok === true && res.data.isActive === false, res);

  await logout();
  res = await login('temp-teacher', 'secret123');
  check('deactivated account cannot sign in', res.ok === false && res.error.code === 'ACCOUNT_DISABLED', res);

  console.log('\n--- session handling ------------------------------------------------');
  res = await call(`window.school.users.list({ limit: 1 })`);
  check('no session -> AUTH_REQUIRED', res.ok === false && res.error.code === 'AUTH_REQUIRED', res);

  res = await login('admin', 'admin1234');
  check('admin signs in again', res.ok === true, res);
  res = await call(`window.school.auth.session()`);
  check('session reports the signed in user', res.ok === true && res.data.user.username === 'admin', res);

  console.log('\n--- student scope ---------------------------------------------------');
  await logout();
  const adm = `adm-${new Date().getFullYear()}-001`;
  res = await login(adm, `ADM-${new Date().getFullYear()}-001`);
  check('student signs in with admission number', res.ok === true, res);
  res = await call(`window.school.users.list({ limit: 1 })`);
  check('student cannot list users', res.ok === false && res.error.code === 'FORBIDDEN', res);

  const year = new Date().getFullYear();
  res = await call(`window.school.auth.changePassword({ currentPassword: 'ADM-${year}-001', newPassword: 'student1234' })`);
  check('student completes the forced password change', res.ok === true, res);
  res = await call(`window.school.settings.get()`);
  check('student can read settings (branding/theme)', res.ok === true, res);
  res = await call(`window.school.settings.update({ theme: 'light' })`);
  check('student cannot change settings', res.ok === false && res.error.code === 'FORBIDDEN', res);

  console.log('\n--- audit trail ----------------------------------------------------');
  const adminActions = getDb()
    .prepare(`SELECT DISTINCT action FROM audit_log ORDER BY action`)
    .all()
    .map((r) => r.action);
  check(
    'login / failure / password events are audited',
    ['login', 'login_failed', 'password_change', 'logout', 'create'].every((a) => adminActions.includes(a)),
    adminActions,
  );

  closeDatabase();
  console.log(`\n${failed === 0 ? 'ALL SECURITY TESTS PASSED' : `FAILURES: ${failures.length}`} (${passed} passed)`);
  if (failed) console.error(failures.map((f) => `  - ${f}`).join('\n'));
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);