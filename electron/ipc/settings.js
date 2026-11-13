'use strict';

const { register } = require('./guard');
const C = require('./channels');
const settings = require('../services/settings.service');
const files = require('../services/files.service');
const { validate, helpers } = require('../services/validation');

const GRADE_SPEC = {
  id: helpers.int({ min: 1 }),
  name: helpers.text({ min: 1, max: 10 }),
  minPercentage: helpers.number({ min: 0, max: 100 }),
  maxPercentage: helpers.number({ min: 0, max: 100 }),
  gradePoint: helpers.number({ min: 0, max: 10, default: 0 }),
};

/**
 * Application settings. Reads are open to every signed-in role (branding,
 * language, theme); everything else is admin-only.
 */
function registerSettingsIpc() {
  register(C.SETTINGS_GET, { roles: '*' }, () => settings.getAll());
  register(C.SETTINGS_PUBLIC, { auth: false }, () => settings.getPublic());
  register(C.SETTINGS_UPDATE, { roles: ['admin'] }, ({ payload, session }) =>
    settings.update(payload || {}, session),
  );

  // school logo
  register(C.SETTINGS_UPLOAD_LOGO, { roles: ['admin'] }, async ({ session }) => {
    const picked = await files.pickAndStoreImage({ kind: 'logo', session });
    if (picked.canceled) return { canceled: true };
    settings.update({ logo_path: picked.storedName }, session);
    return { canceled: false, settings: settings.getAll(), dataUrl: picked.dataUrl };
  });

  register(C.SETTINGS_CLEAR_LOGO, { roles: ['admin'] }, ({ session }) => files.clearLogo(session));

  // grade scale (used by results and report cards)
  register(C.GRADE_SCALE_LIST, { roles: '*' }, () => settings.listGradeScale());
  register(C.GRADE_SCALE_SAVE, { roles: ['admin'] }, ({ payload, session }) =>
    settings.saveGradeScale(payload || {}, session),
  );
  register(C.GRADE_SCALE_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    settings.deleteGradeScale(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session),
  );
}

/** Shared with users.js so the grade-scale helpers stay in the service layer. */
module.exports = { registerSettingsIpc, GRADE_SPEC };