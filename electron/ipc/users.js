'use strict';

const { register } = require('./guard');
const C = require('./channels');
const users = require('../services/users.service');
const audit = require('../services/audit.service');
const { validate, helpers } = require('../services/validation');

const LIST_SPEC = {
  search: helpers.text({ max: 100, default: '' }),
  role: helpers.text({ max: 20 }),
  isActive: helpers.bool(),
  limit: helpers.int({ min: 1, max: 500, default: 50 }),
  offset: helpers.int({ min: 0, default: 0 }),
};

const AUDIT_SPEC = {
  action: helpers.text({ max: 40 }),
  userId: helpers.int({ min: 1 }),
  search: helpers.text({ max: 100 }),
  from: helpers.date({}),
  to: helpers.date({}),
  page: helpers.int({ min: 1, default: 1 }),
  pageSize: helpers.int({ min: 5, max: 500, default: 50 }),
};

function registerUsersIpc() {
  register(C.USERS_LIST, { roles: ['admin'] }, ({ payload }) => users.list(validate(payload || {}, LIST_SPEC)));
  register(C.USERS_GET, { roles: ['admin'] }, ({ payload }) => {
    const id = validate(payload || {}, { id: helpers.int({ min: 1 }) }).id;
    return users.findById(id);
  });
  register(C.USERS_CREATE, { roles: ['admin'] }, ({ payload, session }) => users.create(payload || {}, session));
  register(C.USERS_UPDATE, { roles: ['admin'] }, ({ payload, session }) => {
    const { id, ...rest } = payload || {};
    return users.update(validate({ id }, { id: helpers.int({ min: 1 }) }).id, rest, session);
  });
  register(C.USERS_SET_ACTIVE, { roles: ['admin'] }, ({ payload, session }) => {
    const clean = validate(payload || {}, { id: helpers.int({ min: 1 }), isActive: helpers.bool() });
    return users.setActive(clean.id, clean.isActive, session);
  });
  register(C.USERS_RESET_PASSWORD, { roles: ['admin'] }, ({ payload, session }) => {
    const clean = validate(payload || {}, {
      id: helpers.int({ min: 1 }),
      newPassword: helpers.text({ min: 6, max: 128 }),
      mustChangePassword: helpers.bool(),
    });
    return users.resetPassword(clean.id, clean.newPassword, session, {
      mustChangePassword: clean.mustChangePassword,
    });
  });
  register(C.USERS_DELETE, { roles: ['admin'] }, ({ payload, session }) => {
    const clean = validate(payload || {}, { id: helpers.int({ min: 1 }) });
    return users.softDelete(clean.id, session);
  });

  register(C.AUDIT_LIST, { roles: ['admin'] }, ({ payload }) => {
    const clean = validate(payload || {}, AUDIT_SPEC);
    // The renderer asks for pages; the service works in limit/offset.
    const { page, pageSize, ...filters } = clean;
    return audit.list({ ...filters, limit: pageSize, offset: (page - 1) * pageSize });
  });
}

module.exports = { registerUsersIpc };