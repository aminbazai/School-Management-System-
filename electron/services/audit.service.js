'use strict';

const { getDb } = require('../db/connection');
const { logger } = require('../logger');
const sessionStore = require('./session');

/**
 * Every meaningful action is written here: logins, CRUD, payments, salary changes.
 * Logging failures never break the operation that triggered them.
 */

function log({ action, entity = null, entityId = null, details = null, session = null }) {
  try {
    const s = session || sessionStore.getSession();
    getDb()
      .prepare(
        `INSERT INTO audit_log (user_id, username, role, action, entity, entity_id, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s ? s.userId : null,
        s ? s.username : null,
        s ? s.role : null,
        action,
        entity,
        entityId === null || entityId === undefined ? null : String(entityId),
        details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
      );
  } catch (err) {
    logger.error('audit log failed', action, err);
  }
}

/**
 * Paged, filtered read of the log for the audit screen.
 * `action` is a prefix match, so "pay" also shows "payment" style entries.
 */
function list({ limit = 100, offset = 0, action = null, userId = null, from = null, to = null, search = null } = {}) {
  const db = getDb();
  const where = [];
  const params = {};

  if (action) {
    where.push('action LIKE @action');
    params.action = `${action}%`;
  }
  if (userId) {
    where.push('user_id = @userId');
    params.userId = userId;
  }
  if (from) {
    where.push('date(created_at) >= date(@from)');
    params.from = from;
  }
  if (to) {
    where.push('date(created_at) <= date(@to)');
    params.to = to;
  }
  if (search) {
    where.push('(username LIKE @search OR details LIKE @search OR entity LIKE @search OR action LIKE @search)');
    params.search = `%${search}%`;
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${clause}`).get(params).n;
  const rows = db
    .prepare(
      `SELECT id, user_id, username, role, action, entity, entity_id, details, created_at
       FROM audit_log ${clause}
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset });

  return { total, rows };
}

module.exports = { log, list };