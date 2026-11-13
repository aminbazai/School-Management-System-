'use strict';

const { register } = require('./guard');
const C = require('./channels');
const auth = require('../services/auth.service');
const sessionStore = require('../services/session');
const settings = require('../services/settings.service');

function registerAuthIpc() {
  register(C.APP_GET_INFO, { auth: false }, () => ({
    name: 'School Management System',
    version: require('../../package.json').version,
    settings: settings.getPublic(),
  }));

  register(C.AUTH_LOGIN, { auth: false }, ({ payload }) => {
    const result = auth.login(payload?.username, payload?.password);
    return { user: result.user, session: result.session, settings: settings.getPublic() };
  });

  register(C.AUTH_LOGOUT, { roles: '*' }, ({ session }) => auth.logout(session));

  register(C.AUTH_SESSION, { auth: false }, () => ({
    user: auth.currentUser(),
    session: sessionStore.publicSession(),
    settings: settings.getPublic(),
  }));

  // Keeps the main-process idle timer alive while the user is active.
  register(C.AUTH_HEARTBEAT, { roles: '*' }, () => {
    sessionStore.touch();
    return { ok: true, expiresInMs: sessionStore.IDLE_TIMEOUT_MS };
  });

  register(C.AUTH_CHANGE_PASSWORD, { roles: '*' }, ({ payload, session }) =>
    auth.changePassword(payload || {}, session),
  );
}

module.exports = { registerAuthIpc };