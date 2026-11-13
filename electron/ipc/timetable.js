'use strict';

const { register } = require('./guard');
const C = require('./channels');
const timetable = require('../services/timetable.service');
const { validate, helpers } = require('../services/validation');

const ID = { id: helpers.int({ min: 1, required: true }) };

/**
 * Period definitions and the weekly grid.
 * A student reads their own section's grid, a teacher reads their own week -
 * neither ever passes an id the main process has not resolved itself.
 */
function registerTimetableIpc() {
  register(C.TIMETABLE_PERIODS, { roles: ['admin', 'office', 'teacher', 'student'] }, ({ payload }) =>
    timetable.listPeriods({ includeInactive: !!payload?.includeInactive }),
  );
  register(C.TIMETABLE_PERIOD_SAVE, { roles: ['admin'] }, ({ payload, session }) =>
    timetable.savePeriod(payload || {}, session),
  );
  register(C.TIMETABLE_PERIOD_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    timetable.deletePeriod(validate(payload || {}, ID).id, session),
  );

  register(C.TIMETABLE_GET, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    timetable.get(payload || {}, session),
  );
  register(C.TIMETABLE_SAVE, { roles: ['admin'] }, ({ payload, session }) => timetable.save(payload || {}, session));

  register(C.TIMETABLE_TEACHER, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    timetable.forTeacher(payload || {}, session),
  );
  register(C.TIMETABLE_MY, { roles: ['teacher', 'student'] }, ({ payload, session }) => timetable.my(session));
}

module.exports = { registerTimetableIpc };