'use strict';

const { register } = require('./guard');
const C = require('./channels');
const backup = require('../services/backup.service');

/**
 * Phase 8: manual and automatic backups, restore and the backup folder.
 * Every channel here is admin-only - a backup contains the entire school.
 */
function registerBackupIpc() {
  register(C.BACKUP_LIST, { roles: ['admin'] }, ({ session }) => backup.list(session));
  register(C.BACKUP_INFO, { roles: ['admin'] }, ({ session }) => backup.info(session));
  register(C.BACKUP_CREATE, { roles: ['admin'] }, ({ payload, session }) => backup.create(payload || {}, session));
  register(C.BACKUP_RESTORE, { roles: ['admin'] }, async ({ payload, session }) =>
    backup.restore(payload || {}, session),
  );
  register(C.BACKUP_RESTORE_FILE, { roles: ['admin'] }, async ({ session }) => backup.importFromFile(session));
  register(C.BACKUP_DELETE, { roles: ['admin'] }, ({ payload, session }) => backup.remove(payload || {}, session));
  register(C.BACKUP_OPEN_FOLDER, { roles: ['admin'] }, ({ session }) => backup.openFolder(session));
}

module.exports = { registerBackupIpc };