'use strict';

const { getDb } = require('../db/connection');
const { validate, assertPassword, ValidationError, AppError, helpers } = require('./validation');
const auth = require('./auth.service');
const audit = require('./audit.service');
const sessionStore = require('./session');

const ROLES = ['admin', 'office', 'teacher', 'student'];

function shape(row) {
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
    lockedUntil: row.locked_until,
    failedAttempts: row.failed_attempts,
    createdAt: row.created_at,
  };
}

function list({ search = '', role = null, isActive = null, limit = 100, offset = 0 } = {}) {
  const db = getDb();
  const where = [`u.is_deleted = 0`];
  const params = {};

  if (search) {
    where.push(`(u.username LIKE @search OR IFNULL(s.name,'') LIKE @search OR IFNULL(f.name,'') LIKE @search)`);
    params.search = `%${search}%`;
  }
  if (role) {
    where.push(`u.role = @role`);
    params.role = role;
  }
  if (isActive !== null) {
    where.push(`u.is_active = @isActive`);
    params.isActive = isActive ? 1 : 0;
  }
  const clause = `WHERE ${where.join(' AND ')}`;

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM users u LEFT JOIN students s ON u.role='student' AND s.id=u.linked_id LEFT JOIN staff f ON u.role IN ('teacher','office') AND f.id=u.linked_id ${clause}`)
    .get(params).n;

  const rows = db
    .prepare(
      `SELECT u.*, COALESCE(s.name, f.name, u.username) AS display_name
       FROM users u
       LEFT JOIN students s ON u.role = 'student' AND s.id = u.linked_id
       LEFT JOIN staff   f ON u.role IN ('teacher','office') AND f.id = u.linked_id
       ${clause}
       ORDER BY u.id
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset });

  return { total, rows: rows.map(shape) };
}

function findById(id) {
  return shape(
    getDb()
      .prepare(
        `SELECT u.*, COALESCE(s.name, f.name, u.username) AS display_name
         FROM users u
         LEFT JOIN students s ON u.role = 'student' AND s.id = u.linked_id
         LEFT JOIN staff   f ON u.role IN ('teacher','office') AND f.id = u.linked_id
         WHERE u.id = ? AND u.is_deleted = 0`,
      )
      .get(id),
  );
}

function usernameExists(username, exceptId = null) {
  const row = getDb()
    .prepare(`SELECT id FROM users WHERE username = ? AND is_deleted = 0 AND id IS NOT ?`)
    .get(username, exceptId);
  return !!row;
}

const CREATE_SPEC = {
  username: helpers.text({ min: 3, max: 60, lowercase: true, required: true, pattern: /^[a-z0-9._-]+$/ }),
  password: helpers.text({ min: 6, max: 128, required: true }),
  role: helpers.enum(ROLES),
  linkedId: helpers.int({ min: 1 }),
  email: helpers.text({ max: 120 }),
  phone: helpers.text({ max: 40 }),
  isActive: helpers.bool({ default: true }),
  mustChangePassword: helpers.bool({ default: true }),
};

/**
 * Admin creates an account (used by Settings > Users, and by staff/student creation flows).
 * `options.systemGenerated` allows the auto-created student login to use the
 * admission number as its first password - the "password differs from username"
 * rule applies to human-chosen passwords only.
 */
function create(payload, session, options = {}) {
  const clean = validate(payload, CREATE_SPEC);
  assertPassword(clean.password, { username: options.systemGenerated ? null : clean.username });
  if (usernameExists(clean.username)) {
    throw new ValidationError({ username: 'usernameTaken' });
  }

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, linked_id, email, phone, is_active, must_change_password, password_changed_at)
       VALUES (@username, @hash, @role, @linkedId, @email, @phone, @isActive, @mustChange, datetime('now'))`,
    )
    .run({
      username: clean.username,
      hash: auth.hashPassword(clean.password),
      role: clean.role,
      linkedId: clean.linkedId ?? null,
      email: clean.email ?? null,
      phone: clean.phone ?? null,
      isActive: clean.isActive ? 1 : 0,
      mustChange: clean.mustChangePassword ? 1 : 0,
    });

  audit.log({ action: 'create', entity: 'users', entityId: info.lastInsertRowid, details: { username: clean.username, role: clean.role }, session });
  return findById(info.lastInsertRowid);
}

const UPDATE_SPEC = {
  username: helpers.text({ min: 3, max: 60, lowercase: true, pattern: /^[a-z0-9._-]+$/ }),
  role: helpers.enum(ROLES),
  linkedId: helpers.int({ min: 1 }),
  email: helpers.text({ max: 120 }),
  phone: helpers.text({ max: 40 }),
  isActive: helpers.bool(),
  mustChangePassword: helpers.bool(),
};

function update(id, payload, session) {
  const target = findById(id);
  if (!target) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  const clean = validate(payload, UPDATE_SPEC);
  const usernameChanged = clean.username !== undefined && clean.username !== target.username;

  if (usernameChanged && usernameExists(clean.username, id)) {
    throw new ValidationError({ username: 'usernameTaken' });
  }
  if (clean.isActive === false && session && session.userId === id) {
    throw new ValidationError({ isActive: 'cannotDeactivateSelf' });
  }
  if (clean.role && target.role === 'admin' && session && session.userId === id) {
    throw new ValidationError({ role: 'cannotChangeOwnRole' });
  }
  if (target.role === 'admin' && clean.isActive === false) {
    const admins = getDb().prepare(`SELECT COUNT(*) AS n FROM users WHERE role='admin' AND is_active=1 AND is_deleted=0`).get().n;
    if (admins <= 1) throw new AppError('LAST_ADMIN', 'LAST_ADMIN');
  }

  const sets = [];
  const params = { id };
  const map = { username: 'username', role: 'role', linkedId: 'linked_id', email: 'email', phone: 'phone' };
  for (const [key, column] of Object.entries(map)) {
    if (clean[key] !== undefined) {
      sets.push(`${column} = @${key}`);
      params[key] = clean[key];
    }
  }
  if (clean.isActive !== undefined) {
    sets.push('is_active = @isActive');
    params.isActive = clean.isActive ? 1 : 0;
  }
  if (clean.mustChangePassword !== undefined) {
    sets.push('must_change_password = @mustChange');
    params.mustChange = clean.mustChangePassword ? 1 : 0;
  }
  if (!sets.length) return target;

  getDb()
    .prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`)
    .run(params);

  // Keep the signed-in session in step when an administrator renames their
  // own account, so password checks and the top bar do not use the old name.
  if (usernameChanged && session && session.userId === id) {
    sessionStore.updateUsername(clean.username);
  }

  audit.log({ action: 'update', entity: 'users', entityId: id, details: { changes: Object.keys(clean) }, session });
  return findById(id);
}

function setActive(id, isActive, session) {
  return update(id, { isActive }, session);
}

/**
 * Admin resets a password. By default the user has to choose a new one at the
 * next login; `options.mustChangePassword = false` sets a password that can be
 * used straight away (useful when the administrator is handing over a working
 * account).
 */
function resetPassword(id, newPassword, session, options = {}) {
  const target = findById(id);
  if (!target) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  assertPassword(newPassword, { username: target.username });
  const mustChange = options.mustChangePassword !== false;

  getDb()
    .prepare(
      `UPDATE users
       SET password_hash = @hash,
           must_change_password = @mustChange,
           failed_attempts = 0,
           locked_until = NULL,
           password_changed_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = @id`,
    )
    .run({ hash: auth.hashPassword(newPassword), id, mustChange: mustChange ? 1 : 0 });

  audit.log({
    action: 'password_reset',
    entity: 'users',
    entityId: id,
    details: { username: target.username, mustChange },
    session,
  });
  return { ok: true, mustChangePassword: mustChange };
}

function softDelete(id, session) {
  const target = findById(id);
  if (!target) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  if (session && session.userId === id) throw new AppError('CANNOT_DELETE_SELF', 'CANNOT_DELETE_SELF');
  if (target.role === 'admin') {
    const admins = getDb().prepare(`SELECT COUNT(*) AS n FROM users WHERE role='admin' AND is_active=1 AND is_deleted=0`).get().n;
    if (admins <= 1) throw new AppError('LAST_ADMIN', 'LAST_ADMIN');
  }

  getDb().prepare(`UPDATE users SET is_deleted = 1, is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'users', entityId: id, details: { username: target.username }, session });
  return { ok: true };
}

/** Creates the login that belongs to a student row (username = admission number). */
function createStudentLogin(studentId, session) {
  const student = getDb().prepare(`SELECT * FROM students WHERE id = ?`).get(studentId);
  if (!student) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  const username = String(student.admission_no).toLowerCase();
  if (usernameExists(username)) return findByUsername(username);

  return create(
    { username, password: student.admission_no, role: 'student', linkedId: studentId, mustChangePassword: true },
    session,
    { systemGenerated: true },
  );
}

function findByUsername(username) {
  return shape(getDb().prepare(`SELECT * FROM users WHERE username = ? AND is_deleted = 0`).get(username));
}

module.exports = {
  ROLES,
  list,
  findById,
  findByUsername,
  create,
  update,
  setActive,
  resetPassword,
  softDelete,
  createStudentLogin,
  usernameExists,
};