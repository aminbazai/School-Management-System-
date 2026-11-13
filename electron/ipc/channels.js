'use strict';

/**
 * Single source of truth for IPC channel names.
 * Required by the main process; mirrored inside electron/preload.js because a
 * sandboxed preload can only require `electron` itself.
 */

module.exports = {
  APP_GET_INFO: 'app:getInfo',

  // auth
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_SESSION: 'auth:session',
  AUTH_HEARTBEAT: 'auth:heartbeat',
  AUTH_CHANGE_PASSWORD: 'auth:changePassword',

  // settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_PUBLIC: 'settings:public',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_UPLOAD_LOGO: 'settings:uploadLogo',
  SETTINGS_CLEAR_LOGO: 'settings:clearLogo',
  GRADE_SCALE_LIST: 'gradeScale:list',
  GRADE_SCALE_SAVE: 'gradeScale:save',
  GRADE_SCALE_DELETE: 'gradeScale:delete',

  // users
  USERS_LIST: 'users:list',
  USERS_GET: 'users:get',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_SET_ACTIVE: 'users:setActive',
  USERS_RESET_PASSWORD: 'users:resetPassword',
  USERS_DELETE: 'users:delete',
  AUDIT_LIST: 'audit:list',

  // academic structure
  STRUCTURE_GET: 'structure:get',
  CLASSES_LIST: 'classes:list',
  CLASSES_CREATE: 'classes:create',
  CLASSES_UPDATE: 'classes:update',
  CLASSES_DELETE: 'classes:delete',
  SECTIONS_LIST: 'sections:list',
  SECTIONS_CREATE: 'sections:create',
  SECTIONS_UPDATE: 'sections:update',
  SECTIONS_DELETE: 'sections:delete',
  SUBJECTS_LIST: 'subjects:list',
  SUBJECTS_CREATE: 'subjects:create',
  SUBJECTS_UPDATE: 'subjects:update',
  SUBJECTS_DELETE: 'subjects:delete',
  CLASS_SUBJECTS_LIST: 'classSubjects:list',
  CLASS_SUBJECTS_SAVE: 'classSubjects:save',
  CLASS_SUBJECTS_DELETE: 'classSubjects:delete',
  TEACHER_ASSIGNMENTS_LIST: 'teacherAssignments:list',
  TEACHER_ASSIGNMENTS_SAVE: 'teacherAssignments:save',
  TEACHER_ASSIGNMENTS_DELETE: 'teacherAssignments:delete',
  SESSIONS_LIST: 'sessions:list',
  SESSIONS_CREATE: 'sessions:create',
  SESSIONS_ACTIVATE: 'sessions:activate',

  // students
  STUDENTS_LIST: 'students:list',
  STUDENTS_ME: 'students:me',
  STUDENTS_GET: 'students:get',
  STUDENTS_CREATE: 'students:create',
  STUDENTS_UPDATE: 'students:update',
  STUDENTS_DELETE: 'students:delete',
  STUDENTS_PROMOTE: 'students:promote',
  STUDENTS_EXPORT_EXCEL: 'students:exportExcel',
  STUDENTS_IMPORT_PREVIEW: 'students:importPreview',
  STUDENTS_IMPORT_COMMIT: 'students:importCommit',
  STUDENTS_EXPORT_PDF: 'students:exportPdf',
  STUDENTS_ID_CARDS: 'students:idCards',

  // files
  FILES_PICK_IMAGE: 'files:pickImage',


  // staff
  STAFF_LIST: 'staff:list',
  STAFF_GET: 'staff:get',
  STAFF_CREATE: 'staff:create',
  STAFF_UPDATE: 'staff:update',
  STAFF_DELETE: 'staff:delete',
  STAFF_EXPORT_EXCEL: 'staff:exportExcel',
  STAFF_IMPORT_PREVIEW: 'staff:importPreview',
  STAFF_IMPORT_COMMIT: 'staff:importCommit',

  // attendance
  ATTENDANCE_ROSTER: 'attendance:roster',
  ATTENDANCE_MARK: 'attendance:mark',
  ATTENDANCE_MARK_ALL_PRESENT: 'attendance:markAllPresent',
  ATTENDANCE_REGISTER: 'attendance:register',
  ATTENDANCE_MONTHLY_GRID: 'attendance:monthlyGrid',
  ATTENDANCE_MONTHLY_MARK: 'attendance:monthlyMark',
  ATTENDANCE_STUDENT_HISTORY: 'attendance:studentHistory',
  ATTENDANCE_LOW: 'attendance:low',
  STAFF_ATTENDANCE_DAY: 'staffAttendance:day',
  STAFF_ATTENDANCE_MARK: 'staffAttendance:mark',
  STAFF_ATTENDANCE_SUMMARY: 'staffAttendance:summary',
  STAFF_ATTENDANCE_MONTH: 'staffAttendance:month',
  LEAVE_TYPES: 'leave:types',
  LEAVE_LIST: 'leave:list',
  LEAVE_BALANCES: 'leave:balances',
  LEAVE_BALANCE_LIST: 'leave:balanceList',
  LEAVE_BALANCE_SET: 'leave:setBalance',
  LEAVE_APPLY: 'leave:apply',
  LEAVE_DECIDE: 'leave:decide',
  // salary
  SALARY_STRUCTURE: 'salary:structure',
  SALARY_SAVE_BASIC: 'salary:saveBasic',
  SALARY_SAVE_ALLOWANCE: 'salary:saveAllowance',
  SALARY_DELETE_ALLOWANCE: 'salary:deleteAllowance',
  SALARY_SAVE_DEDUCTION: 'salary:saveDeduction',
  SALARY_DELETE_DEDUCTION: 'salary:deleteDeduction',
  SALARY_ADD_ADVANCE: 'salary:addAdvance',
  SALARY_CANCEL_ADVANCE: 'salary:cancelAdvance',
  SALARY_PREVIEW: 'salary:preview',
  SALARY_GENERATE: 'salary:generate',
  SALARY_LIST: 'salary:list',
  SALARY_DETAIL: 'salary:detail',
  SALARY_MARK_PAID: 'salary:markPaid',
  SALARY_DELETE: 'salary:delete',
  SALARY_MY_SLIPS: 'salary:mySlips',
  SALARY_SLIP_PDF: 'salary:slipPdf',
  SALARY_PAYSLIP_PRINT: 'salary:slipPrint',

  // fees
  FEE_STRUCTURES: 'fees:structures',
  FEE_STRUCTURE_SAVE: 'fees:saveStructure',
  FEE_STRUCTURE_DELETE: 'fees:deleteStructure',
  FEE_DISCOUNTS: 'fees:discounts',
  FEE_DISCOUNT_SAVE: 'fees:saveDiscount',
  FEE_DISCOUNT_DELETE: 'fees:deleteDiscount',
  FEE_VOUCHERS: 'fees:vouchers',
  FEE_VOUCHER_DETAIL: 'fees:voucherDetail',
  FEE_PREVIEW: 'fees:preview',
  FEE_GENERATE: 'fees:generate',
  FEE_LATE_FINE: 'fees:lateFine',
  FEE_PAYMENT: 'fees:payment',
  FEE_PAYMENT_DELETE: 'fees:deletePayment',
  FEE_DEFAULTERS: 'fees:defaulters',
  FEE_COLLECTION_REPORT: 'fees:collectionReport',
  FEE_MY: 'fees:my',
  FEE_RECEIPT_PDF: 'fees:receiptPdf',
  FEE_RECEIPT_PRINT: 'fees:receiptPrint',
  FEE_LIST_PDF: 'fees:listPdf',
  FEE_REMINDERS_PDF: 'fees:remindersPdf',

  // free messaging helpers (WhatsApp / SMS / email links)
  MESSAGING_RECIPIENTS: 'messaging:recipients',
  MESSAGING_OPEN_LINK: 'messaging:openLink',
  MESSAGING_EXPORT: 'messaging:export',
  MESSAGING_PDF: 'messaging:pdf',

  // expenses / other income
  EXPENSE_LIST: 'expenses:list',
  EXPENSE_CREATE: 'expenses:create',
  EXPENSE_UPDATE: 'expenses:update',
  EXPENSE_DELETE: 'expenses:delete',
  EXPENSE_REPORT: 'expenses:report',
  EXPENSE_CATEGORIES: 'expenses:categories',

  // exams, marks and results
  EXAM_TYPES_LIST: 'examTypes:list',
  EXAMS_LIST: 'exams:list',
  EXAMS_GET: 'exams:get',
  EXAMS_CREATE: 'exams:create',
  EXAMS_UPDATE: 'exams:update',
  EXAMS_DELETE: 'exams:delete',
  EXAMS_SET_STATUS: 'exams:setStatus',
  EXAM_SUBJECTS_SAVE: 'examSubjects:save',
  EXAM_MARKS_SHEET: 'exams:markSheet',
  EXAM_MARKS_SAVE: 'exams:saveMarks',
  EXAM_RESULTS: 'exams:resultSheet',
  EXAM_RESULTS_COMPUTE: 'exams:computeResults',
  EXAM_STATS: 'exams:stats',
  EXAM_MY_RESULTS: 'exams:myResults',
  EXAM_REPORT_CARD: 'exams:reportCard',
  EXAM_REPORT_CARD_PDF: 'exams:reportCardPdf',
  EXAM_REPORT_CARD_PRINT: 'exams:reportCardPrint',
  EXAM_RESULT_SHEET_PDF: 'exams:resultSheetPdf',

  // timetable
  TIMETABLE_PERIODS: 'timetable:periods',
  TIMETABLE_PERIOD_SAVE: 'timetable:savePeriod',
  TIMETABLE_PERIOD_DELETE: 'timetable:deletePeriod',
  TIMETABLE_GET: 'timetable:get',
  TIMETABLE_SAVE: 'timetable:save',
  TIMETABLE_MY: 'timetable:my',
  TIMETABLE_TEACHER: 'timetable:teacher',

  // notices
  NOTICES_LIST: 'notices:list',
  NOTICES_SAVE: 'notices:save',
  NOTICES_DELETE: 'notices:delete',
  NOTICES_PIN: 'notices:pin',

  // dashboard / printable reports
  REPORTS_DASHBOARD: 'reports:dashboard',
  REPORTS_RUN: 'reports:run',
  REPORTS_PDF: 'reports:pdf',

  // backup & restore
  BACKUP_LIST: 'backup:list',
  BACKUP_CREATE: 'backup:create',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_RESTORE_FILE: 'backup:restoreFile',
  BACKUP_DELETE: 'backup:delete',
  BACKUP_OPEN_FOLDER: 'backup:openFolder',
  BACKUP_INFO: 'backup:info',

  // destructive data operations (admin only)
  DATA_STATS: 'data:stats',
  DATA_SCOPE: 'data:scope',
  DATA_CLEAR: 'data:clear',
  DATA_FACTORY_RESET: 'data:factoryReset',
};

/**
 * Channel names reserved for the phases that have not landed yet.
 * They are deliberately kept out of the registry above so that the
 * channels <-> preload parity check stays meaningful.
 */
module.exports.PENDING = {};