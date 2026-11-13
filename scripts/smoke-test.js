'use strict';

/**
 * Runtime smoke test (run with: npm run smoke)
 * Verifies the native SQLite addon and bcrypt load inside the Electron runtime
 * - this is the step that catches "NODE_MODULE_VERSION mismatch" early.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app } = require('electron');

const failures = [];
const ok = (label, extra = '') => console.log(`  ok   ${label}${extra ? ` (${extra})` : ''}`);
const fail = (label, err) => {
  failures.push(label);
  console.error(`  FAIL ${label}: ${err && err.message ? err.message : err}`);
  if (err && err.stack) console.error(String(err.stack).split('\n').slice(0, 8).join('\n'));
};

app.disableHardwareAcceleration();

// Never touch the real database from a smoke test.
const SMOKE_DIR = path.join(os.tmpdir(), 'sms-smoke');
fs.rmSync(SMOKE_DIR, { recursive: true, force: true });
app.setPath('userData', SMOKE_DIR);

app.whenReady().then(() => {
  console.log(`electron ${process.versions.electron} | node ${process.versions.node} | abi ${process.versions.modules}`);

  // --- better-sqlite3 -------------------------------------------------------
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO t (name) VALUES (?)').run('school');
    const row = db.prepare('SELECT COUNT(*) AS n FROM t').get();
    db.close();
    ok('better-sqlite3', `${row.n} row`);
  } catch (err) {
    fail('better-sqlite3', err);
  }

  // --- bcryptjs -------------------------------------------------------------
  try {
    const bcrypt = require('bcryptjs');
    const hashFn = bcrypt.hashSync || (bcrypt.default && bcrypt.default.hashSync);
    const compareFn = bcrypt.compareSync || (bcrypt.default && bcrypt.default.compareSync);
    const hash = hashFn('admin123', 10);
    ok('bcryptjs', compareFn('admin123', hash) ? 'hash/verify ok' : 'verify failed');
  } catch (err) {
    fail('bcryptjs', err);
  }

  // --- schema + seed --------------------------------------------------------
  try {
    const { initDatabase, closeDatabase } = require('../electron/db/connection');
    const db = initDatabase({ seed: true });
    const counts = {
      users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
      students: db.prepare('SELECT COUNT(*) n FROM students').get().n,
      classes: db.prepare('SELECT COUNT(*) n FROM classes').get().n,
      sections: db.prepare('SELECT COUNT(*) n FROM sections').get().n,
      attendance: db.prepare('SELECT COUNT(*) n FROM student_attendance').get().n,
      vouchers: db.prepare('SELECT COUNT(*) n FROM fee_vouchers').get().n,
      marks: db.prepare('SELECT COUNT(*) n FROM marks').get().n,
    };
    ok('schema + seed', JSON.stringify(counts));
    closeDatabase();
  } catch (err) {
    fail('schema + seed', err);
  }

  console.log(failures.length === 0 ? '\nSMOKE TEST PASSED' : `\nSMOKE TEST FAILED: ${failures.join(', ')}`);
  app.exit(failures.length === 0 ? 0 : 1);
});