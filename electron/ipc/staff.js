'use strict';

const path = require('node:path');
const { dialog, app } = require('electron');
const { register } = require('./guard');
const C = require('./channels');
const staff = require('../services/staff.service');
const excel = require('../services/excel.service');
const { validate, helpers } = require('../services/validation');
const { logger } = require('../logger');

const ID = { id: helpers.int({ min: 1 }) };

/** Teachers & staff records: admin and office. */
function registerStaffIpc() {
  register(C.STAFF_LIST, { roles: ['admin', 'office'] }, ({ payload }) => staff.list(payload || {}));
  register(C.STAFF_GET, { roles: ['admin', 'office'] }, ({ payload }) =>
    staff.get(validate(payload || {}, ID).id),
  );
  register(C.STAFF_CREATE, { roles: ['admin', 'office'] }, ({ payload, session }) => staff.create(payload || {}, session));
  register(C.STAFF_UPDATE, { roles: ['admin', 'office'] }, ({ payload, session }) => {
    const { id, ...rest } = payload || {};
    return staff.update(validate({ id }, ID).id, rest, session);
  });
  register(C.STAFF_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    staff.softDelete(validate(payload || {}, ID).id, session),
  );

  // --- Excel export --------------------------------------------------------
  register(C.STAFF_EXPORT_EXCEL, { roles: ['admin', 'office'] }, async ({ payload }) => {
    const data = staff.exportRows(payload || {});
    const buffer = await excel.writeWorkbook([
      {
        name: 'Staff',
        title: `${data.meta.school} - Teachers & Staff (${data.meta.session})`,
        columns: excel.STAFF_COLUMNS,
        rows: data.rows,
      },
    ]);
    const result = await dialog.showSaveDialog({
      title: 'Export staff',
      defaultPath: path.join(app.getPath('documents'), `staff-${Date.now()}.xlsx`),
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    require('node:fs').writeFileSync(result.filePath, buffer);
    return { canceled: false, filePath: result.filePath, count: data.rows.length };
  });

  // --- Excel import --------------------------------------------------------
  register(C.STAFF_IMPORT_PREVIEW, { roles: ['admin', 'office'] }, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import staff from Excel',
      properties: ['openFile'],
      filters: [{ name: 'Excel workbook', extensions: ['xlsx', 'xlsm'] }],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };

    try {
      const parsed = await excel.readWorkbook(result.filePaths[0], excel.STAFF_HEADER_ALIASES);
      const rows = parsed.rows.map((cells) => {
        const row = {};
        parsed.mapped.forEach((key, index) => {
          if (key) row[key] = cells[index];
        });
        return row;
      });
      return { canceled: false, headers: parsed.headers, rows: rows.slice(0, 200), total: rows.length };
    } catch (err) {
      logger.error('staff import preview failed', err);
      throw Object.assign(new Error('INVALID_FILE'), { code: 'INVALID_FILE' });
    }
  });

  register(C.STAFF_IMPORT_COMMIT, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    staff.importRows(payload || {}, session),
  );
}

module.exports = { registerStaffIpc };
