'use strict';

const { register } = require('./guard');
const C = require('./channels');
const notices = require('../services/notices.service');
const { validate, helpers } = require('../services/validation');

const ID = { id: helpers.int({ min: 1, required: true }) };

/**
 * Notice board. Everyone reads the notices addressed to them; only an admin
 * publishes, edits, pins or removes.
 */
function registerNoticesIpc() {
  register(C.NOTICES_LIST, { roles: ['admin', 'office', 'teacher', 'student'] }, ({ payload, session }) =>
    notices.list(payload || {}, session),
  );
  register(C.NOTICES_SAVE, { roles: ['admin'] }, ({ payload, session }) => notices.save(payload || {}, session));
  register(C.NOTICES_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    notices.remove(validate(payload || {}, ID).id, session),
  );
  register(C.NOTICES_PIN, { roles: ['admin'] }, ({ payload, session }) => notices.setPinned(payload || {}, session));
}

module.exports = { registerNoticesIpc };