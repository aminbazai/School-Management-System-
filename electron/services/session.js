'use strict';

const { logger } = require('../logger');

/**
 * In-memory session store (main process is the single source of truth).
 * The renderer never owns its own session - it only asks for one.
 */

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_FAILED = 5;
const LOCK_MINUTES = 5;

let session = null;
let idleTimer = null;
let onExpire = null;

function createSession(user) {
  session = {
    token: `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    userId: user.id,
    username: user.username,
    role: user.role,
    linkedId: user.linked_id ?? null,
    displayName: user.display_name || user.username,
    mustChangePassword: !!user.must_change_password,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  return publicSession();
}

function publicSession() {
  if (!session) return null;
  return {
    token: session.token,
    userId: session.userId,
    username: session.username,
    role: session.role,
    linkedId: session.linkedId,
    displayName: session.displayName,
    mustChangePassword: session.mustChangePassword,
    loginAt: new Date(session.createdAt).toISOString(),
  };
}

function getSession() {
  if (!session) return null;
  if (isIdle()) {
    clearSession();
    return null;
  }
  return session;
}

function isIdle(now = Date.now()) {
  return !!session && now - session.lastActivity > IDLE_TIMEOUT_MS;
}

function touch() {
  if (!session) return;
  session.lastActivity = Date.now();
}

/** Called after a successful password change so the rest of the app unlocks. */
function markPasswordChanged() {
  if (!session) return;
  session.mustChangePassword = false;
}

/** Keeps the session's own identity in step after an admin renames the account. */
function updateUsername(username) {
  if (!session) return;
  const displayWasUsername = session.displayName === session.username;
  session.username = username;
  if (displayWasUsername) session.displayName = username;
}

function clearSession() {
  session = null;
}

/** Watches for inactivity; calls the provided callback when the session expires. */
function startIdleWatch(callback) {
  stopIdleWatch();
  onExpire = callback;
  idleTimer = setInterval(() => {
    if (session && isIdle()) {
      const expired = publicSession();
      clearSession();
      logger.warn('session expired after inactivity', expired && expired.username);
      if (onExpire) onExpire(expired);
    }
  }, 15 * 1000);
  if (idleTimer.unref) idleTimer.unref();
}

function stopIdleWatch() {
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
  onExpire = null;
}

module.exports = {
  IDLE_TIMEOUT_MS,
  MAX_FAILED,
  LOCK_MINUTES,
  createSession,
  publicSession,
  getSession,
  touch,
  markPasswordChanged,
  updateUsername,
  clearSession,
  isIdle,
  startIdleWatch,
  stopIdleWatch,
};