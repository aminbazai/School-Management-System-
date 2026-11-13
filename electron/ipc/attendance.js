'use strict';

const { register } = require('./guard');
const C = require('./channels');
const attendance = require('../services/attendance.service');
const leaves = require('../services/leaves.service');
const { validate, helpers } = require('../services/validation');

const today = () => new Date().toISOString().slice(0, 10);
const ID = { id: helpers.int({ min: 1 }) };

/**
 * Attendance for students and staff plus leave management.
 * Class/section scoping and the same-day rule live in the service layer.
 */
function registerAttendanceIpc() {
  // --- students ------------------------------------------------------------
  register(C.ATTENDANCE_ROSTER, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    attendance.roster(payload || {}, session),
  );
  register(C.ATTENDANCE_MARK, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    attendance.mark(payload || {}, session),
  );
  register(C.ATTENDANCE_MARK_ALL_PRESENT, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    attendance.markAllPresent(payload || {}, session),
  );
  register(C.ATTENDANCE_REGISTER, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    attendance.register({ ...(payload || {}), month: payload?.month || new Date().toISOString().slice(0, 7) }, session),
  );
  register(C.ATTENDANCE_MONTHLY_GRID, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    attendance.monthlyGrid(payload || {}, session),
  );
  register(C.ATTENDANCE_MONTHLY_MARK, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    attendance.markMonthly(payload || {}, session),
  );
  register(C.ATTENDANCE_STUDENT_HISTORY, { roles: ['admin', 'office', 'teacher', 'student'] }, ({ payload, session }) =>
    attendance.studentHistory(payload || {}, session),
  );
  register(C.ATTENDANCE_LOW, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    attendance.lowAttendance(payload || {}, session),
  );

  // --- staff ---------------------------------------------------------------
  register(C.STAFF_ATTENDANCE_DAY, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    attendance.staffDay({ date: payload?.date || today(), staffType: payload?.staffType }, session),
  );
  register(C.STAFF_ATTENDANCE_MARK, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    attendance.markStaffDay(payload || {}, session),
  );
  register(C.STAFF_ATTENDANCE_SUMMARY, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    attendance.staffSummary(payload || {}, session),
  );
  register(C.STAFF_ATTENDANCE_MONTH, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    attendance.staffMonth(payload || {}, session),
  );

  // --- leaves --------------------------------------------------------------
  register(C.LEAVE_TYPES, { roles: ['admin', 'office', 'teacher'] }, () => leaves.listTypes());
  register(C.LEAVE_LIST, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    leaves.list(payload || {}, session),
  );
  register(C.LEAVE_BALANCES, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) => {
    const clean = validate(payload || {}, { staffId: helpers.int({ min: 1 }), year: helpers.int({ min: 2000, max: 2100 }) });
    let staffId = clean.staffId;
    if (session.role === 'teacher') staffId = session.linkedId;
    return leaves.balances(staffId, clean.year || new Date().getFullYear());
  });
  register(C.LEAVE_BALANCE_LIST, { roles: ['admin', 'office'] }, ({ payload }) => {
    const clean = validate(payload || {}, { staffId: helpers.int({ min: 1 }), year: helpers.int({ min: 2000, max: 2100 }) });
    return leaves.listBalances(clean);
  });
  register(C.LEAVE_BALANCE_SET, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    leaves.setBalance(payload || {}, session),
  );
  register(C.LEAVE_APPLY, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    leaves.apply(payload || {}, session),
  );
  // A teacher may only withdraw their own pending application; the service
  // enforces that narrower rule.
  register(C.LEAVE_DECIDE, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    leaves.decide(payload || {}, session),
  );
}

module.exports = { registerAttendanceIpc };