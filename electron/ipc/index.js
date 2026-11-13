'use strict';

const { registerAuthIpc } = require('./auth');
const { registerSettingsIpc } = require('./settings');
const { registerUsersIpc } = require('./users');
const { registerStudentsIpc } = require('./students');
const { registerStaffIpc } = require('./staff');
const { registerClassesIpc } = require('./classes');
const { registerFilesIpc } = require('./files');
const { registerAttendanceIpc } = require('./attendance');
const { registerSalaryIpc } = require('./salary');
const { registerFeesIpc } = require('./fees');
const { registerExamsIpc } = require('./exams');
const { registerTimetableIpc } = require('./timetable');
const { registerNoticesIpc } = require('./notices');
const { registerReportsIpc } = require('./reports');
const { registerBackupIpc } = require('./backup');
const { registerDataIpc } = require('./data');
const { registerMessagingIpc } = require('./messaging');

/**
 * Registers every IPC channel exactly once.
 * Module layout stays flat (one file per domain) so later phases can add
 * channels without touching security plumbing.
 */
function registerIpc() {
  registerAuthIpc();
  registerSettingsIpc();
  registerUsersIpc();
  registerStudentsIpc();
  registerStaffIpc();
  registerClassesIpc();
  registerFilesIpc();
  registerAttendanceIpc();
  registerSalaryIpc();
  registerFeesIpc();
  registerExamsIpc();
  registerTimetableIpc();
  registerNoticesIpc();
  registerReportsIpc();
  registerBackupIpc();
  registerDataIpc();
  registerMessagingIpc();
}

module.exports = { registerIpc };