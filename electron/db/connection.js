'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const Database = require('better-sqlite3');
const { logger } = require('../logger');

/**
 * Single SQLite connection owned by the MAIN process.
 * The database file lives in app.getPath('userData') - never in the install folder.
 *
 * Every service goes through getDb(); nothing else may open the file.
 * This indirection is what allows swapping SQLite for a LAN server later.
 */

let db = null;

function dbFile() {
  return path.join(app.getPath('userData'), 'school.db');
}

function backupDir() {
  return path.join(app.getPath('userData'), 'backups');
}

function ensureFolders() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.mkdirSync(backupDir(), { recursive: true });
}

function currentVersion(conn) {
  const row = conn
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`)
    .get();
  if (!row) return 0;
  const v = conn.prepare(`SELECT MAX(version) AS v FROM schema_version`).get();
  return (v && v.v) || 0;
}

function applySchema(conn) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  conn.exec(sql);
  logger.info('schema.sql applied');
}

function applyMigrations(conn, fromVersion) {
  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return;

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  for (const file of files) {
    const version = Number.parseInt(file.split('_')[0], 10);
    if (!Number.isFinite(version) || version <= fromVersion) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // Migrations that rebuild a table (see https://sqlite.org/lang_altertable.html)
    // need foreign keys off for the duration, because SQLite runs an implicit
    // DELETE FROM when a table is dropped. `PRAGMA foreign_keys` is a no-op
    // inside a transaction, so such a migration opts in with a
    // `-- @no-foreign-keys` marker and the pragma is toggled around it.
    const needsForeignKeysOff = /^\s*--\s*@no-foreign-keys\s*$/m.test(sql);

    const run = () => {
      conn.exec(sql);
      conn.prepare(`INSERT INTO schema_version (version, note) VALUES (?, ?)`).run(version, file);
    };

    if (needsForeignKeysOff) {
      conn.pragma('foreign_keys = OFF');
      try {
        conn.transaction(run)();
        // A rebuild that broke a foreign key would otherwise stay silent until
        // a later query trips over it.
        const broken = conn.pragma('foreign_key_check');
        if (broken.length > 0) throw new Error(`migration ${file} left foreign keys broken: ${JSON.stringify(broken)}`);
      } finally {
        conn.pragma('foreign_keys = ON');
      }
    } else {
      conn.transaction(run)();
    }
    logger.info(`migration applied: ${file} (v${version})`);
  }
}

/**
 * Opens (or returns) the database and guarantees the schema is up to date.
 * @param {{seed?: boolean}} options
 */
function initDatabase(options = {}) {
  const { seed = true } = options;

  if (db) return db;

  ensureFolders();
  const file = dbFile();
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const version = currentVersion(db);
  if (version === 0) {
    db.exec('BEGIN');
    try {
      applySchema(db);
      db.prepare(`INSERT INTO schema_version (version, note) VALUES (?, ?)`).run(1, 'initial schema');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  applyMigrations(db, version);

  if (seed) {
    const { runSeedIfEmpty } = require('./seed');
    runSeedIfEmpty(db);
  }

  logger.info(`database ready at ${file} (schema v${currentVersion(db)})`);
  return db;
}

function getDb() {
  if (!db) initDatabase();
  return db;
}

function closeDatabase() {
  if (!db) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch (err) {
    logger.error('failed to close database', err);
  } finally {
    db = null;
  }
}

module.exports = { initDatabase, getDb, closeDatabase, dbFile, backupDir };