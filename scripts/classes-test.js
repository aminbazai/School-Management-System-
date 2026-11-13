'use strict';

/**
 * Academic structure regression tests (dev tool): `npm run test:classes`
 *
 * The Classes page could not add a class whose name had been deleted before:
 * the duplicate check ignores soft-deleted rows, but the database still held a
 * table level UNIQUE constraint, so the insert died with "UNIQUE constraint
 * failed: classes.name" and the user saw a generic "something went wrong".
 *
 * These tests pin that down: uniqueness must mean "unique among rows that are
 * not deleted" for classes, sections and subjects, on a fresh database as well
 * as on one migrated from the old schema.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-classes-test');

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
    console.error(`  FAIL  ${label}${detail ? ` -> ${String(JSON.stringify(detail)).slice(0, 220)}` : ''}`);
  }
}

async function main() {
  const { initDatabase, getDb, closeDatabase } = require('../electron/db/connection');
  const { registerIpc } = require('../electron/ipc');
  const { toError } = require('../electron/ipc/guard');

  const db = initDatabase({ seed: true });
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
  console.log('\n--- schema ----------------------------------------------------------');
  const schemaVersion = db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get().v;
  check('the soft-delete unique migration is recorded', schemaVersion >= 2, { schemaVersion });

  const indexes = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'ux_%'`)
    .all()
    .map((r) => r.name)
    .sort();
  check(
    'classes, sections and subjects use partial unique indexes',
    ['ux_classes_name', 'ux_sections_class_name', 'ux_subjects_name'].every((n) => indexes.includes(n)),
    indexes,
  );

  const partial = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'ux_classes_name'`)
    .get();
  check('the class unique index only covers rows that are not deleted', /WHERE is_deleted = 0/.test(partial.sql), partial);

  const leftovers = db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE '%\_v2' ESCAPE '\\'`).all();
  check('the rebuild left no temporary tables behind', leftovers.length === 0, leftovers);

  const brokenFks = db.pragma('foreign_key_check');
  check('foreign keys are intact after the rebuild', brokenFks.length === 0, brokenFks);

  const sequences = db.prepare(`SELECT name, seq FROM sqlite_sequence WHERE name IN ('classes','sections','subjects')`).all();
  check(
    'every rebuilt table kept exactly one autoincrement watermark',
    sequences.length === 3,
    sequences,
  );

  // -------------------------------------------------------------------------
  console.log('\n--- classes ---------------------------------------------------------');
  await signIn('admin', 'admin123', 'admin1234');

  let res = await call(`window.school.classes.create({ name: 'Reuse Test Class', code: 'RTC', levelOrder: 42 })`);
  const classId = res.ok ? res.data.id : null;
  check('admin can create a class', res.ok && res.data.name === 'Reuse Test Class', res);

  res = await call(`window.school.classes.create({ name: 'Reuse Test Class' })`);
  check('the same name is refused while the class exists', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.classes.remove(${classId})`);
  check('admin can delete a class', res.ok === true, res);

  res = await call(`window.school.classes.create({ name: 'Reuse Test Class' })`);
  const secondClassId = res.ok ? res.data.id : null;
  check('the name can be used again after the class was deleted', res.ok === true, res);
  check('the re-created class is a new row', secondClassId !== classId, { classId, secondClassId });

  const live = db
    .prepare(`SELECT COUNT(*) AS n FROM classes WHERE name = 'Reuse Test Class' AND is_deleted = 0`)
    .get().n;
  const archived = db.prepare(`SELECT COUNT(*) AS n FROM classes WHERE name = 'Reuse Test Class' AND is_deleted = 1`).get().n;
  check('exactly one live class and one archived one share the name', live === 1 && archived === 1, { live, archived });

  res = await call(`window.school.classes.list({})`);
  check('the archived class stays out of the list', res.ok && res.data.filter((c) => c.name === 'Reuse Test Class').length === 1, res);

  res = await call(`window.school.classes.update(${secondClassId}, { name: 'Reuse Test Class' })`);
  check('renaming a class to its own name is allowed', res.ok === true, res);

  // -------------------------------------------------------------------------
  console.log('\n--- sections --------------------------------------------------------');
  res = await call(`window.school.sections.create({ classId: ${secondClassId}, name: 'Reuse-A', capacity: 40, roomNo: 'R-1' })`);
  const sectionId = res.ok ? res.data.id : null;
  check('admin can create a section', res.ok && res.data.capacity === 40, res);

  res = await call(`window.school.sections.create({ classId: ${secondClassId}, name: 'Reuse-A' })`);
  check('the same section name is refused while the section exists', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.sections.remove(${sectionId})`);
  check('admin can delete a section', res.ok === true, res);

  res = await call(`window.school.sections.create({ classId: ${secondClassId}, name: 'Reuse-A' })`);
  check('the section name can be used again after deletion', res.ok === true, res);

  // -------------------------------------------------------------------------
  console.log('\n--- subjects --------------------------------------------------------');
  res = await call(`window.school.subjects.create({ name: 'Reuse Subject', code: 'RS' })`);
  const subjectId = res.ok ? res.data.id : null;
  check('admin can create a subject', res.ok === true, res);

  res = await call(`window.school.subjects.create({ name: 'Reuse Subject' })`);
  check('the same subject name is refused while the subject exists', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  const subjectInUse = await call(`window.school.classSubjects.save({ classId: ${secondClassId}, subjectId: ${subjectId} })`);
  check('the subject can be attached to a class', subjectInUse.ok === true, subjectInUse);

  res = await call(`window.school.subjects.remove(${subjectId})`);
  check('a subject in use cannot be deleted', res.ok === false && res.error.code === 'SUBJECT_IN_USE', res);

  await call(`window.school.classSubjects.remove(${(subjectInUse.data || [])[0].id})`);
  res = await call(`window.school.subjects.remove(${subjectId})`);
  check('admin can delete the subject once it is free', res.ok === true, res);

  res = await call(`window.school.subjects.create({ name: 'Reuse Subject' })`);
  check('the subject name can be used again after deletion', res.ok === true, res);

  // -------------------------------------------------------------------------
  console.log('\n--- error reporting -------------------------------------------------');
  check(
    'an unexpected uniqueness clash reads as a duplicate, not a server error',
    toError({ code: 'SQLITE_CONSTRAINT_UNIQUE', message: 'UNIQUE constraint failed: classes.name' }).error.code ===
      'DUPLICATE_VALUE',
  );
  check(
    'any other database error still reads as a server error',
    toError(new Error('disk is on fire')).error.code === 'SERVER_ERROR',
  );

  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'en.json'), 'utf8'));
  const ur = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'ur.json'), 'utf8'));
  check('the duplicate message is translated in English', !!en.errors.DUPLICATE_VALUE);
  check('the duplicate message is translated in Urdu', !!ur.errors.DUPLICATE_VALUE);

  // -------------------------------------------------------------------------
  console.log('\n--- structure -------------------------------------------------------');
  res = await call(`window.school.structure.get()`);
  check('the dropdown payload still carries every tab', res.ok && ['classes', 'sections', 'subjects', 'classSubjects', 'sessions'].every((k) => k in res.data), Object.keys(res.data || {}));
  check(
    'deleted classes do not leak into the dropdown',
    res.ok && res.data.classes.every((c) => c.name !== 'Reuse Test Class' || c.id === secondClassId),
    res.data.classes,
  );

  closeDatabase();
  console.log(`\n${failed === 0 ? 'ALL CLASS TESTS PASSED' : `FAILURES: ${failures.length}`} (${passed} passed)`);
  if (failed) console.error(failures.map((f) => `  - ${f}`).join('\n'));
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);