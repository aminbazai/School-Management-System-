'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');

/**
 * Notice board.
 *
 * A notice has one audience. Every role is mapped to the audiences it may
 * read, and that mapping is applied in SQL - the renderer never gets to ask
 * for an audience it has no business seeing.
 */

const AUDIENCES = ['all', 'teachers', 'students', 'office', 'staff'];

/** Audiences a role is allowed to read. */
const AUDIENCE_BY_ROLE = {
  admin: ['all', 'teachers', 'students', 'office', 'staff'],
  office: ['all', 'office', 'staff'],
  teacher: ['all', 'teachers', 'staff'],
  student: ['all', 'students'],
};

function readableAudiences(session) {
  return AUDIENCE_BY_ROLE[session?.role] || [];
}

const SPEC = {
  id: helpers.int({ min: 1 }),
  title: helpers.text({ min: 1, max: 160 }),
  body: helpers.text({ max: 4000 }),
  audience: helpers.enum(AUDIENCES),
  pinned: helpers.bool({ default: false }),
  expiresAt: helpers.date(),
  isActive: helpers.bool({ default: true }),
};

/** Only an admin may publish, edit or remove a notice. */
function assertAdmin(session) {
  if (!session || session.role !== 'admin') throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

function shape(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body || '',
    audience: row.audience,
    pinned: !!row.pinned,
    expiresAt: row.expires_at || null,
    isExpired: row.expires_at ? row.expires_at < new Date().toISOString().slice(0, 10) : false,
    isActive: !!row.is_active,
    createdBy: row.created_by,
    authorName: row.author_name || null,
    createdAt: row.created_at,
  };
}

const NOTICE_SELECT = `
  SELECT n.*, u.username AS author_name
  FROM notices n LEFT JOIN users u ON u.id = n.created_by`;

/**
 * Notices for the caller's role.
 * Expired notices are only visible to an admin, who is the one who has to
 * renew or remove them.
 */
function list({ audience, search, includeExpired = false, includeInactive = false } = {}, session) {
  const allowed = readableAudiences(session);
  const clean = validate({ audience, search, includeExpired, includeInactive }, {
    audience: helpers.enum(AUDIENCES),
    search: helpers.text({ max: 100, default: '' }),
    includeExpired: helpers.bool({ default: false }),
    includeInactive: helpers.bool({ default: false }),
  });

  const db = getDb();
  // `is_deleted` is the soft delete, `is_active` is the admin's publish switch -
  // a notice the admin took down must not stay on everyone's board.
  const where = ['n.is_deleted = 0'];
  const params = {};

  // Only an admin may look at unpublished notices - they are the one who
  // published them and the only one who can bring them back.
  if (!(session.role === 'admin' && clean.includeInactive)) where.push('n.is_active = 1');

  if (!allowed.length) return { rows: [], audiences: AUDIENCES, canManage: session?.role === 'admin' };

  where.push(`n.audience IN (${allowed.map((_, i) => `@aud${i}`).join(', ')})`);
  allowed.forEach((value, i) => {
    params[`aud${i}`] = value;
  });

  if (clean.audience) {
    if (!allowed.includes(clean.audience)) throw new AppError('FORBIDDEN', 'FORBIDDEN');
    where.push('n.audience = @audience');
    params.audience = clean.audience;
  }

  const today = new Date().toISOString().slice(0, 10);
  // Only an admin can look at expired notices - they are the one who cleans them up.
  if (!(session.role === 'admin' && clean.includeExpired)) {
    where.push('(n.expires_at IS NULL OR n.expires_at >= @today)');
    params.today = today;
  }

  if (clean.search) {
    where.push('(n.title LIKE @search OR n.body LIKE @search)');
    params.search = `%${clean.search}%`;
  }

  const rows = db
    .prepare(`${NOTICE_SELECT} WHERE ${where.join(' AND ')}
              ORDER BY n.pinned DESC, datetime(n.created_at) DESC, n.id DESC`)
    .all(params);

  return {
    rows: rows.map(shape),
    audiences: AUDIENCES,
    canManage: session.role === 'admin',
  };
}

/** One notice by id, regardless of whether it is currently published. */
function readOne(id) {
  const row = getDb().prepare(`${NOTICE_SELECT} WHERE n.id = ? AND n.is_deleted = 0`).get(id);
  return row ? shape(row) : null;
}

function save(payload, session) {
  assertAdmin(session);
  const clean = validate(payload || {}, SPEC);
  if (!clean.title) throw new ValidationError({ title: 'required' });

  const db = getDb();

  if (clean.id) {
    const existing = db.prepare(`SELECT id FROM notices WHERE id = ? AND is_deleted = 0`).get(clean.id);
    if (!existing) throw new AppError('NOT_FOUND', 'NOT_FOUND');

    db.prepare(
      `UPDATE notices SET title = @title, body = @body, audience = @audience,
              pinned = @pinned, expires_at = @expiresAt, is_active = @isActive
       WHERE id = @id`,
    ).run({
      title: clean.title,
      body: clean.body ?? null,
      audience: clean.audience ?? 'all',
      pinned: clean.pinned ? 1 : 0,
      expiresAt: clean.expiresAt ?? null,
      isActive: clean.isActive === false ? 0 : 1,
      id: clean.id,
    });

    audit.log({ action: 'update', entity: 'notices', entityId: clean.id, details: clean, session });
    return readOne(clean.id);
  }

  const id = db
    .prepare(
      `INSERT INTO notices (title, body, audience, pinned, expires_at, is_active, created_by)
       VALUES (@title, @body, @audience, @pinned, @expiresAt, @isActive, @by)`,
    )
    .run({
      title: clean.title,
      body: clean.body ?? null,
      audience: clean.audience ?? 'all',
      pinned: clean.pinned ? 1 : 0,
      expiresAt: clean.expiresAt ?? null,
      isActive: clean.isActive === false ? 0 : 1,
      by: session.userId,
    }).lastInsertRowid;

  audit.log({ action: 'create', entity: 'notices', entityId: id, details: clean, session });
  return readOne(id);
}

function remove(id, session) {
  assertAdmin(session);
  const db = getDb();
  const row = db.prepare(`SELECT * FROM notices WHERE id = ? AND is_deleted = 0`).get(id);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  db.prepare(`UPDATE notices SET is_deleted = 1, is_active = 0 WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'notices', entityId: id, details: { title: row.title }, session });
  return { ok: true };
}

function setPinned({ id, pinned }, session) {
  assertAdmin(session);
  const clean = validate({ id, pinned }, {
    id: helpers.int({ min: 1, required: true }),
    pinned: helpers.bool({ required: true }),
  });

  const db = getDb();
  if (!db.prepare(`SELECT id FROM notices WHERE id = ? AND is_deleted = 0`).get(clean.id)) {
    throw new AppError('NOT_FOUND', 'NOT_FOUND');
  }
  db.prepare(`UPDATE notices SET pinned = ? WHERE id = ?`).run(clean.pinned ? 1 : 0, clean.id);
  audit.log({ action: 'update', entity: 'notices', entityId: clean.id, details: { pinned: clean.pinned }, session });
  return list({}, session);
}

module.exports = { AUDIENCES, AUDIENCE_BY_ROLE, readableAudiences, list, save, remove, setPinned };