'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection');
const { validate, assertPassword, assertPasswordInput, ValidationError, AppError, helpers } = require('./validation');
const sessionStore = require('./session');
const audit = require('./audit.service');
const { logger } = require('../logger');
const settings = require('./settings.service');

// bcryptjs 3.x ships ESM-first; normalise the shape for the main process.
const hash = (...args) =>
  typeof bcrypt.hashSync === 'function' ? bcrypt.hashSync(...args) : bcrypt.default.hashSync(...args);
const compare = (a, b) =>
  typeof bcrypt.compareSync === 'function' ? bcrypt.compareSync(a, b) : bcrypt.default.compareSync(a, b);

const BCRYPT_ROUNDS = 10;

function hashPassword(plain) {
  return hash(plain, BCRYPT_ROUNDS);
}

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    linkedId: row.linked_id,
    displayName: row.display_name || row.username,
    isActive: !!row.is_active,
    mustChangePassword: !!row.must_change_password,
    lastLogin: row.last_login,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
  };
}

/** Resolves the human readable name behind a user (student name, staff name or username). */
function displayNameFor(row) {
  if (!row || !row.linked_id) return row ? row.username : null;
  if (row.role === 'student') {
    const s = getDb().prepare(`SELECT name FROM students WHERE id = ?`).get(row.linked_id);
    return s ? s.name : row.username;
  }
  if (row.role === 'teacher' || row.role === 'office' || row.role === 'parent') {
    const f = getDb().prepare(`SELECT name FROM staff WHERE id = ?`).get(row.linked_id);
    return f ? f.name : row.username;
  }
  return row.username;
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {{user: object, session: object}}
 */
function login(username, password) {
  const { username: uname } = validate({ username }, { username: helpers.text({ min: 3, max: 60, lowercase: true }) });
  const plain = assertPasswordInput(password);

  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM users WHERE username = ? AND is_deleted = 0`)
    .get(uname);

  if (row) row.display_name = displayNameFor(row);

  const maxFailed = settings.get('max_failed_attempts');
  const lockMinutes = settings.get('lockout_minutes');

  if (!row) {
    audit.log({ action: 'login_failed', entity: 'users', details: { username: uname, reason: 'not_found' }, session: { userId: null, username: uname, role: null } });
    throw new AppError('INVALID_CREDENTIALS', 'INVALID_CREDENTIALS');
  }

  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    const seconds = Math.ceil((new Date(row.locked_until) - new Date()) / 1000);
    audit.log({ action: 'login_blocked', entity: 'users', entityId: row.id, details: { username: uname, locked_until: row.locked_until }, session: { userId: row.id, username: uname, role: row.role } });
    throw new AppError('ACCOUNT_LOCKED', 'ACCOUNT_LOCKED', { seconds });
  }

  if (!row.is_active) {
    audit.log({ action: 'login_failed', entity: 'users', entityId: row.id, details: { username: uname, reason: 'inactive' }, session: { userId: row.id, username: uname, role: row.role } });
    throw new AppError('ACCOUNT_DISABLED', 'ACCOUNT_DISABLED');
  }

  if (!compare(plain, row.password_hash)) {
    const failed = row.failed_attempts + 1;
    const lock = failed >= maxFailed;
    const lockedUntil = lock
      ? new Date(Date.now() + lockMinutes * 60 * 1000).toISOString()
      : null;

    db.prepare(
      `UPDATE users
       SET failed_attempts = @failed,
           locked_until = @lockedUntil,
           updated_at = datetime('now')
       WHERE id = @id`,
    ).run({ failed: lock ? 0 : failed, lockedUntil, id: row.id });

    audit.log({
      action: 'login_failed',
      entity: 'users',
      entityId: row.id,
      details: { username: uname, attempts: failed, locked: lock },
      session: { userId: row.id, username: uname, role: row.role },
    });

    if (lock) throw new AppError('ACCOUNT_LOCKED', 'ACCOUNT_LOCKED', { seconds: lockMinutes * 60 });
    throw new AppError('INVALID_CREDENTIALS', 'INVALID_CREDENTIALS', { attemptsLeft: maxFailed - failed });
  }

  db.prepare(
    `UPDATE users
     SET failed_attempts = 0,
         locked_until = NULL,
         last_login = datetime('now'),
         must_change_password = @mustChange,
         updated_at = datetime('now')
     WHERE id = @id`,
  ).run({ mustChange: row.must_change_password ? 1 : 0, id: row.id });

  const session = sessionStore.createSession(row);
  audit.log({ action: 'login', entity: 'users', entityId: row.id, details: { role: row.role }, session });
  logger.info(`login: ${row.username} (${row.role})`);

  return { user: toPublicUser({ ...row, must_change_password: row.must_change_password }), session };
}

function logout(session) {
  if (!session) return { ok: true };
  audit.log({ action: 'logout', entity: 'users', entityId: session.userId, session });
  logger.info(`logout: ${session.username}`);
  sessionStore.clearSession();
  return { ok: true };
}

/** Current user, refreshed from the database (so deactivation takes effect at once). */
function currentUser() {
  const s = sessionStore.getSession();
  if (!s) return null;
  const row = getDb()
    .prepare(`SELECT * FROM users WHERE id = ? AND is_deleted = 0`)
    .get(s.userId);

  if (!row || !row.is_active) {
    sessionStore.clearSession();
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    linkedId: row.linked_id,
    displayName: displayNameFor(row),
    isActive: !!row.is_active,
    mustChangePassword: !!row.must_change_password,
    lastLogin: row.last_login,
    email: row.email,
    phone: row.phone,
  };
}

function changePassword({ currentPassword, newPassword }, session) {
  if (!session) throw new AppError('AUTH_REQUIRED', 'AUTH_REQUIRED');

  const fields = {};
  if (!currentPassword) fields.currentPassword = 'required';
  try {
    assertPassword(newPassword, { username: session.username });
  } catch (err) {
    if (err instanceof ValidationError) fields.newPassword = err.fields.password;
    else throw err;
  }
  if (Object.keys(fields).length) throw new ValidationError(fields);

  const row = getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(session.userId);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  if (!compare(String(currentPassword), row.password_hash)) {
    audit.log({ action: 'password_change_failed', entity: 'users', entityId: row.id, session });
    throw new AppError('WRONG_PASSWORD', 'WRONG_PASSWORD');
  }
  if (compare(String(newPassword), row.password_hash)) {
    throw new ValidationError({ newPassword: 'passwordSameAsOld' });
  }

  getDb()
    .prepare(
      `UPDATE users
       SET password_hash = @hash,
           must_change_password = 0,
           password_changed_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = @id`,
    )
    .run({ hash: hashPassword(String(newPassword)), id: row.id });

  audit.log({ action: 'password_change', entity: 'users', entityId: row.id, session });
  sessionStore.markPasswordChanged();
  return { ok: true };
}

module.exports = {
  login,
  logout,
  currentUser,
  changePassword,
  hashPassword,
  toPublicUser,
};