'use strict';

const { register } = require('./guard');
const C = require('./channels');
const files = require('../services/files.service');
const { validate, helpers } = require('../services/validation');

/**
 * File access for the renderer: it can ask main to open a native picker and to
 * copy the chosen image into the app data folder. Nothing else touches disk.
 */
function registerFilesIpc() {
  register(
    C.FILES_PICK_IMAGE,
    { roles: ['admin', 'office'] },
    async ({ payload, session }) => {
      const { kind } = validate(payload || {}, { kind: helpers.enum(['students', 'staff', 'logo']) });
      return files.pickAndStoreImage({ kind, session });
    },
  );
}

module.exports = { registerFilesIpc };