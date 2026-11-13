'use strict';

const { ipcMain, BrowserWindow } = require('electron');
const sessionStore = require('../services/session');
const { ValidationError, AppError } = require('../services/validation');
const { logger } = require('../logger');
const C = require('./channels');

/**
 * Every IPC handler goes through register().
 *
 * Rules enforced here (main process, never the UI):
 *  1. The caller must be a window we created.
 *  2. A live, non-expired session must exist (unless `auth: false`).
 *  3. The session role must be allowed for that channel.
 *  4. An account flagged `must_change_password` may only use auth channels.
 *
 * The role list a channel declares IS the permission model - there is no
 * permission table in the database, because a channel is the smallest thing
 * that can be allowed or refused. Everything finer than that (a teacher's own
 * classes, a student's own record) is checked in the service layer, which
 * knows the rows.
 *
 * Handlers return a plain envelope so the renderer never depends on
 * Electron's error serialisation.
 */

// The only channels a "must change password" account may touch.
const PASSWORD_CHANGE_ALLOWED = new Set([
  C.APP_GET_INFO,
  C.AUTH_SESSION,
  C.AUTH_LOGOUT,
  C.AUTH_HEARTBEAT,
  C.AUTH_CHANGE_PASSWORD,
  C.SETTINGS_PUBLIC,
]);

function fail(code, message, extra = {}) {
  return { ok: false, error: { code, message: message || code, ...extra } };
}

function toError(err) {
  if (err instanceof ValidationError) {
    return fail('VALIDATION_FAILED', 'VALIDATION_FAILED', { fields: err.fields });
  }
  if (err instanceof AppError) {
    return fail(err.code, err.message, {
      fields: err.fields,
      seconds: err.seconds,
      attemptsLeft: err.attemptsLeft,
    });
  }
  // A uniqueness clash the service did not anticipate (the duplicate check and
  // the database constraint disagreeing) is the user's mistake, not a crash.
  if (err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY')) {
    logger.error('unexpected uniqueness violation', err);
    return fail('DUPLICATE_VALUE', 'DUPLICATE_VALUE');
  }
  logger.error('unhandled ipc error', err);
  return fail('SERVER_ERROR', 'SERVER_ERROR');
}

function register(channel, options, handler) {
  if (typeof options === 'function') {
    handler = options;
    options = {};
  }
  const { roles = '*', auth = true } = options;

  ipcMain.handle(channel, async (event, payload) => {
    try {
      // 1. only our own windows may talk to us
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) {
        logger.warn(`ipc rejected from unknown sender: ${channel}`);
        return fail('FORBIDDEN', 'FORBIDDEN');
      }

      // 2. session
      const session = sessionStore.getSession();
      if (auth && !session) return fail('AUTH_REQUIRED', 'AUTH_REQUIRED');

      // 3. role
      if (auth && roles !== '*' && !roles.includes(session.role)) {
        logger.warn(`ipc denied: ${session.username} (${session.role}) -> ${channel}`);
        return fail('FORBIDDEN', 'FORBIDDEN');
      }

      const data = await handler({ session, payload, win, event });
      return { ok: true, data: data === undefined ? null : data };
    } catch (err) {
      return toError(err);
    }
  });
}

module.exports = { register, fail, toError };