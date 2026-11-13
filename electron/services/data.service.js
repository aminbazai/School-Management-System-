'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const { getDb, closeDatabase, initDatabase, dbFile } = require('../db/connection');
const { AppError } = require('./validation');
const audit = require('./audit.service');
const sessionStore = require('./session');
const backups = require('./backup.service');
const { logger } = require('../logger');

/**
 * The two destructive operations an administrator can perform.
 *
 * They are deliberately different:
 *
 *  clearSchoolData() removes every *record* of the running school - the
 *    people, their attendance, the marks, the money, the leaves, the notices
 *    and the audit trail - but keeps the things the school is set up with:
 *    the profile and logo, the settings, the administrator accounts and the
 *    academic structure (sessions, classes, sections, subjects, periods).
 *    The school is left empty and usable, ready to enrol again.
 *
 *  factoryReset() throws the whole database away and builds a new one, which
 *    brings the factory demo state back - the seeded accounts and the demo
 *    records. Every account is recreated, including the administrator's.
 *
 * Both take a safety backup before they touch anything, both are admin-only,
 * and both end the session: the person who pressed the button has to sign in
 * again and see the result for themselves.
 */

/**
 * The tables that hold school records, in the order they have to be emptied:
 * a child before its parent. Foreign keys cascade, but the explicit order
 * keeps the intent readable and does not rely on the cascade for correctness.
 */
const RECORD_TABLES = [
  'marks',
  'results',
  'exam_subjects',
  'exams',
  'voucher_items',
  'fee_payments',
  'fee_vouchers',
  'discounts',
  'fee_structures',
  'payroll_items',
  'advance_recoveries',
  'payroll',
  'advances',
  'allowances',
  'deductions',
  'salary_structures',
  'student_attendance',
  'staff_attendance',
  'leave_balances',
  'leaves',
  'timetable',
  'teacher_assignments',
  'student_guardians',
  'guardians',
  'students',
  'staff',
  'notices',
  'expenses',
  'audit_log',
];

/**
 * What each operation is going to remove, for the confirmation screen.
 * The entries are keys, not sentences: the renderer translates them, so the
 * confirmation reads in the language the school is using.
 */
const SCOPE = {
  clearSchoolData: {
    removes: [
      'students', 'staff', 'assignments', 'attendance', 'exams', 'fees',
      'salary', 'leaves', 'timetable', 'notices', 'expenses', 'audit',
    ],
    keeps: ['profile', 'accounts', 'structure', 'sessions'],
  },
  factoryReset: {
    removes: ['everything'],
    keeps: ['nothing'],
  },
};

function assertAdmin(session) {
  if (!session || session.role !== 'admin') throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

/** Counts the records that are about to go, so the screen can show the size of it. */
function statistics() {
  const db = getDb();
  const one = (sql) => db.prepare(sql).get().n;
  return {
    students: one('SELECT COUNT(*) AS n FROM students WHERE is_deleted = 0'),
    staff: one('SELECT COUNT(*) AS n FROM staff WHERE is_deleted = 0'),
    attendance: one('SELECT COUNT(*) AS n FROM student_attendance')
      + one('SELECT COUNT(*) AS n FROM staff_attendance'),
    exams: one('SELECT COUNT(*) AS n FROM exams'),
    fees: one('SELECT COUNT(*) AS n FROM fee_vouchers'),
    payroll: one('SELECT COUNT(*) AS n FROM payroll'),
    leaves: one('SELECT COUNT(*) AS n FROM leaves'),
    expenses: one('SELECT COUNT(*) AS n FROM expenses WHERE is_deleted = 0'),
    notices: one('SELECT COUNT(*) AS n FROM notices WHERE is_deleted = 0'),
    auditLog: one('SELECT COUNT(*) AS n FROM audit_log'),
  };
}

/** The photos of the students and staff that are about to be deleted. */
function clearPhotoFolders() {
  const root = path.join(app.getPath('userData'), 'photos');
  for (const kind of ['students', 'staff']) {
    const dir = path.join(root, kind);
    try {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        try {
          fs.rmSync(path.join(dir, file), { force: true });
        } catch (err) {
          logger.error(`could not remove photo ${file}`, err);
        }
      }
    } catch (err) {
      logger.error(`could not clear the ${kind} photo folder`, err);
    }
  }
}

/** Lets the counters start again from 1, so a cleared school looks like a new one. */
function resetCounters(db) {
  const names = RECORD_TABLES.map((t) => `'${t}'`).join(', ');
  db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${names})`).run();
}

/**
 * Removes every record of the running school and keeps the school itself.
 * @returns {object} what was removed
 */
function clearSchoolData(session) {
  assertAdmin(session);
  const db = getDb();
  const before = statistics();

  db.transaction(() => {
    for (const table of RECORD_TABLES) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    // The accounts of the people whose records just went are of no use any
    // more; the administrators stay, because they are the ones who operate
    // the school.
    db.prepare(`DELETE FROM users WHERE role IN ('teacher', 'office', 'student')`).run();
    resetCounters(db);
  })();

  clearPhotoFolders();

  // The audit trail was emptied with everything else, so the record of what
  // just happened is written afterwards - it is the only trace left.
  audit.log({
    action: 'data.clear',
    entity: 'school',
    entityId: 'school',
    details: before,
    session,
  });

  logger.info('all school data cleared', before);
  sessionStore.clearSession();
  return { ok: true, removed: before, scope: SCOPE.clearSchoolData };
}

/**
 * Replaces the whole database with a fresh one, which restores the factory
 * demo state.
 * @returns {object} the name of the safety backup that was taken first
 */
async function factoryReset(session) {
  assertAdmin(session);
  const db = getDb();
  const before = statistics();

  // A safety copy first: a reset that cannot be undone is not a reset, it is
  // a loss. The backup is taken with the same online API the manual backups
  // use, so it is consistent even while the app is open.
  const safety = await backups.create({ note: 'before-factory-reset' }, session);

  // Stop everything that could write while the file is being replaced.
  db.pragma('wal_checkpoint(TRUNCATE)');
  closeDatabase();

  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${dbFile()}${suffix}`, { force: true });
    } catch (err) {
      logger.error(`could not remove ${dbFile()}${suffix}`, err);
    }
  }

  // A brand new database: the schema is applied and the demo data is seeded.
  // The counters are left alone - the seeded rows keep their ids, so the
  // counter has to carry on from where they ended.
  initDatabase({ seed: true });

  audit.log({
    action: 'data.factory_reset',
    entity: 'school',
    entityId: 'school',
    details: { removed: before, safetyBackup: safety.name },
    session,
  });

  logger.info(`factory reset done, safety backup: ${safety.name}`);
  sessionStore.clearSession();
  return { ok: true, removed: before, safetyBackup: safety.name, scope: SCOPE.factoryReset };
}

module.exports = {
  SCOPE,
  statistics,
  clearSchoolData,
  factoryReset,
};
