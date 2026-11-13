'use strict';

const { register } = require('./guard');
const C = require('./channels');
const data = require('../services/data.service');

/**
 * The destructive data operations.
 *
 * Everything here is admin-only and takes effect in the main process - the
 * renderer only ever asks, it never touches the database itself. The session
 * is ended after every one of them, so the person who pressed the button has
 * to sign in again and see the result with their own eyes.
 */
function registerDataIpc() {
  register(C.DATA_STATS, { roles: ['admin'] }, () => data.statistics());
  register(C.DATA_SCOPE, { roles: ['admin'] }, () => data.SCOPE);
  register(C.DATA_CLEAR, { roles: ['admin'] }, ({ session, win }) => {
    const result = data.clearSchoolData(session);
    // The session is gone; the renderer has to know so it can go back to the
    // login screen and show what happened.
    win?.webContents?.send('session:reset', { reason: 'data_cleared' });
    return result;
  });
  register(C.DATA_FACTORY_RESET, { roles: ['admin'] }, async ({ session, win }) => {
    const result = await data.factoryReset(session);
    win?.webContents?.send('session:reset', { reason: 'factory_reset' });
    return result;
  });
}

module.exports = { registerDataIpc };
