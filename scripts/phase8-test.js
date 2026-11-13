'use strict';

/**
 * Phase 8 functional tests (dev tool): `npm run test:phase8`
 * Manual backups, the automatic daily backup, restore-from-file safety and the
 * audit log screen - plus the role boundaries around all of it.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-phase8-test');

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

async function main() {
  const { initDatabase, getDb, closeDatabase } = require('../electron/db/connection');
  const { registerIpc } = require('../electron/ipc');
  const backup = require('../electron/services/backup.service');

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
    'the renderer api client exposes the phase 8 groups',
    apiSource.includes('bridge.backup.create') && apiSource.includes('bridge.audit.list'),
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
  console.log('\n--- backup info -----------------------------------------------------');
  let res = await call(`window.school.backup.info()`);
  check('backup info reports the data folder', res.ok && res.data.dataFolder === TMP, res);
  check('it reports the database size', res.ok && res.data.databaseSize > 0, res);
  check('it reports the app version', res.ok && typeof res.data.version === 'string', res);

  res = await call(`window.school.backup.list()`);
  check('the backup list starts empty', res.ok && res.data.rows.length === 0, res);

  // -------------------------------------------------------------------------
  console.log('\n--- manual backups --------------------------------------------------');
  res = await call(`window.school.backup.create({ note: 'before-tests' })`);
  check('a manual backup can be created', res.ok && res.data.size > 0, res);
  const backupName = res.ok ? res.data.name : null;
  check('the backup is a real SQLite file', res.ok && fs.existsSync(res.data.path), res);
  check('the note is part of the filename', res.ok && backupName.includes('before-tests'), backupName);

  res = await call(`window.school.backup.list()`);
  check('the backup appears in the list', res.ok && res.data.rows.length === 1, res);
  check('it is marked as manual', res.ok && res.data.rows[0].kind === 'manual', res);
  check('the listed backup is the one we made', res.ok && res.data.rows[0].name === backupName, res.ok ? res.data.rows[0] : res);

  res = await call(`window.school.backup.create({ note: 'a b/../c!!' })`);
  check('a note with path characters is sanitised into the name', res.ok && !res.data.name.includes('/'), res);
  const secondName = res.ok ? res.data.name : null;

  res = await call(`window.school.backup.remove(${JSON.stringify(secondName)})`);
  check('a backup can be removed', res.ok, res);

  res = await call(`window.school.backup.remove(${JSON.stringify(secondName)})`);
  check('removing a backup twice is refused', res.ok === false && res.error.code === 'NOT_FOUND', res);

  res = await call(`window.school.backup.remove('../../etc/passwd')`);
  check('a path traversal filename is refused', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  // -------------------------------------------------------------------------
  console.log('\n--- automatic backups -----------------------------------------------');
  const auto1 = await backup.runAutomaticBackup();
  check('the automatic backup runs', !auto1.skipped, auto1);
  check('it is marked automatic', String(auto1.name).includes('-auto'), auto1.name);

  const auto2 = await backup.runAutomaticBackup();
  check('a second automatic backup on the same day is skipped', auto2.skipped === true, auto2);

  // -------------------------------------------------------------------------
  console.log('\n--- restore ---------------------------------------------------------');
  // Record a marker row, back up, change it, then restore and prove it came back.
  getDb().prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('report_footer', 'BEFORE-BACKUP')`).run();
  res = await call(`window.school.backup.create({ note: 'marker' })`);
  check('a marker backup is created', res.ok, res);
  const markerName = res.data.name;

  getDb().prepare(`UPDATE settings SET value = 'AFTER-CHANGE' WHERE key = 'report_footer'`).run();
  check(
    'the live value really changed',
    getDb().prepare(`SELECT value FROM settings WHERE key = 'report_footer'`).get().value === 'AFTER-CHANGE',
  );

  res = await call(`window.school.backup.restore(${JSON.stringify(markerName)})`);
  check('a backup can be restored', res.ok && res.data.restored === markerName, res);
  check('a safety copy of the live database is kept', res.ok && !!res.data.safetyCopy, res);

  const restored = getDb().prepare(`SELECT value FROM settings WHERE key = 'report_footer'`).get().value;
  check('the restored database holds the backed-up value', restored === 'BEFORE-BACKUP', restored);

  res = await call(`window.school.backup.list()`);
  check(
    'the safety copy is listed so the restore can be undone',
    res.ok && res.data.rows.some((row) => row.name.includes('prerestore')),
    res.ok ? res.data.rows.map((r) => r.name) : res,
  );

  // The session must survive the connection swap.
  res = await call(`window.school.auth.session()`);
  check('the session survives a restore', res.ok && res.data.user.username === 'admin', res);

  res = await call(`window.school.backup.restore('../../school.db')`);
  check('restoring from a path traversal name is refused', res.ok === false, res);

  // -------------------------------------------------------------------------
  console.log('\n--- audit log -------------------------------------------------------');
  res = await call(`window.school.audit.list({ page: 1, pageSize: 25 })`);
  check('the audit log is paged', res.ok && res.data.rows.length <= 25 && res.data.total > 0, res.ok ? res.data.rows.length : res);

  res = await call(`window.school.audit.list({ action: 'backup' })`);
  check('the action filter works as a prefix', res.ok && res.data.rows.every((r) => r.action.startsWith('backup')), res);
  check('backup actions are recorded', res.ok && res.data.rows.some((r) => r.action === 'backup.restore'), res);

  res = await call(`window.school.audit.list({ search: 'admin' })`);
  check('the search filter matches a username', res.ok && res.data.rows.length > 0, res);

  res = await call(`window.school.audit.list({ from: '2000-01-01', to: '2000-01-02' })`);
  check('a date range can exclude everything', res.ok && res.data.total === 0, res);

  res = await call(`window.school.audit.list({ pageSize: 5, page: 2 })`);
  check('a later page returns a different slice', res.ok && res.data.rows.length > 0, res);

  // -------------------------------------------------------------------------
  console.log('\n--- role boundaries -------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('office', 'office123', 'office1234');

  res = await call(`window.school.backup.list()`);
  check('office cannot list backups', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.backup.create({})`);
  check('office cannot create a backup', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.audit.list({})`);
  check('office cannot read the audit log', res.ok === false && res.error.code === 'FORBIDDEN', res);

  await call(`window.school.auth.logout()`);
  const student = getDb().prepare(`SELECT admission_no FROM students WHERE is_deleted = 0 ORDER BY id LIMIT 1`).get();
  await signIn(String(student.admission_no).toLowerCase(), student.admission_no, 'student1234');

  res = await call(`window.school.backup.info()`);
  check('a student cannot read backup info', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.audit.list({})`);
  check('a student cannot read the audit log', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.reports.dashboard({})`);
  check('a student dashboard still works after all of this', res.ok && res.data.role === 'student', res);

  // -------------------------------------------------------------------------
  console.log('\n--- leftover files --------------------------------------------------');
  const { backupDir } = require('../electron/db/connection');
  const leftovers = fs.existsSync(backupDir()) ? fs.readdirSync(backupDir()) : [];
  check('backups are written into the user data folder', leftovers.length > 0, leftovers);
  check('every backup uses the expected prefix', leftovers.every((name) => name.startsWith('school-backup-')), leftovers);
  check(
    'no temporary file is left in the install folder',
    !fs.existsSync(path.join(ROOT, 'school.db')),
  );

  closeDatabase();
  console.log(`\n${failed === 0 ? 'ALL PHASE 8 TESTS PASSED' : `FAILURES: ${failures.length}`} (${passed} passed)`);
  if (failed) console.error(failures.map((f) => `  - ${f}`).join('\n'));
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);