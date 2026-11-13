'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The ONLY bridge between renderer and main.
 *
 * - No Node APIs, no fs, no direct database access.
 * - A fixed, hand-written surface: the renderer cannot call arbitrary channels.
 * - Every call goes through ipcRenderer.invoke and is re-checked (session +
 *   role) inside the main process before anything happens.
 *
 * NOTE: this preload runs in a sandbox, where `require` resolves only `electron`
 * itself - so the channel names are inlined here and must stay identical to the
 * ones in electron/ipc/channels.js.
 */

const C = {
  APP_GET_INFO: 'app:getInfo',

  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_SESSION: 'auth:session',
  AUTH_HEARTBEAT: 'auth:heartbeat',
  AUTH_CHANGE_PASSWORD: 'auth:changePassword',

  SETTINGS_GET: 'settings:get',
  SETTINGS_PUBLIC: 'settings:public',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_UPLOAD_LOGO: 'settings:uploadLogo',
  SETTINGS_CLEAR_LOGO: 'settings:clearLogo',
  GRADE_SCALE_LIST: 'gradeScale:list',
  GRADE_SCALE_SAVE: 'gradeScale:save',
  GRADE_SCALE_DELETE: 'gradeScale:delete',

  USERS_LIST: 'users:list',
  USERS_GET: 'users:get',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_SET_ACTIVE: 'users:setActive',
  USERS_RESET_PASSWORD: 'users:resetPassword',
  USERS_DELETE: 'users:delete',
  AUDIT_LIST: 'audit:list',

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

  FILES_PICK_IMAGE: 'files:pickImage',

  STAFF_LIST: 'staff:list',
  STAFF_GET: 'staff:get',
  STAFF_CREATE: 'staff:create',
  STAFF_UPDATE: 'staff:update',
  STAFF_DELETE: 'staff:delete',
  STAFF_EXPORT_EXCEL: 'staff:exportExcel',
  STAFF_IMPORT_PREVIEW: 'staff:importPreview',
  STAFF_IMPORT_COMMIT: 'staff:importCommit',

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

  MESSAGING_RECIPIENTS: 'messaging:recipients',
  MESSAGING_OPEN_LINK: 'messaging:openLink',
  MESSAGING_EXPORT: 'messaging:export',
  MESSAGING_PDF: 'messaging:pdf',

  EXPENSE_LIST: 'expenses:list',
  EXPENSE_CREATE: 'expenses:create',
  EXPENSE_UPDATE: 'expenses:update',
  EXPENSE_DELETE: 'expenses:delete',
  EXPENSE_REPORT: 'expenses:report',
  EXPENSE_CATEGORIES: 'expenses:categories',

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

  TIMETABLE_PERIODS: 'timetable:periods',
  TIMETABLE_PERIOD_SAVE: 'timetable:savePeriod',
  TIMETABLE_PERIOD_DELETE: 'timetable:deletePeriod',
  TIMETABLE_GET: 'timetable:get',
  TIMETABLE_SAVE: 'timetable:save',
  TIMETABLE_MY: 'timetable:my',
  TIMETABLE_TEACHER: 'timetable:teacher',

  NOTICES_LIST: 'notices:list',
  NOTICES_SAVE: 'notices:save',
  NOTICES_DELETE: 'notices:delete',
  NOTICES_PIN: 'notices:pin',

  REPORTS_DASHBOARD: 'reports:dashboard',
  REPORTS_RUN: 'reports:run',
  REPORTS_PDF: 'reports:pdf',

  BACKUP_LIST: 'backup:list',
  BACKUP_INFO: 'backup:info',
  BACKUP_CREATE: 'backup:create',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_RESTORE_FILE: 'backup:restoreFile',
  BACKUP_DELETE: 'backup:delete',
  BACKUP_OPEN_FOLDER: 'backup:openFolder',

  DATA_STATS: 'data:stats',
  DATA_SCOPE: 'data:scope',
  DATA_CLEAR: 'data:clear',
  DATA_FACTORY_RESET: 'data:factoryReset',
};

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('school', {
  app: {
    getInfo: () => invoke(C.APP_GET_INFO),
  },
  auth: {
    login: (credentials) => invoke(C.AUTH_LOGIN, credentials),
    logout: () => invoke(C.AUTH_LOGOUT),
    session: () => invoke(C.AUTH_SESSION),
    heartbeat: () => invoke(C.AUTH_HEARTBEAT),
    changePassword: (payload) => invoke(C.AUTH_CHANGE_PASSWORD, payload),
    /** Main -> renderer events (session:expired, ...). */
    on: (event, callback) => {
      const allowed = ['session:expired', 'session:changed', 'session:reset', 'app:navigate'];
      if (!allowed.includes(event)) return () => {};
      const listener = (_e, payload) => callback(payload);
      ipcRenderer.on(event, listener);
      return () => ipcRenderer.removeListener(event, listener);
    },
  },
  settings: {
    get: () => invoke(C.SETTINGS_GET),
    public: () => invoke(C.SETTINGS_PUBLIC),
    update: (payload) => invoke(C.SETTINGS_UPDATE, payload),
    uploadLogo: () => invoke(C.SETTINGS_UPLOAD_LOGO),
    clearLogo: () => invoke(C.SETTINGS_CLEAR_LOGO),
  },
  gradeScale: {
    list: () => invoke(C.GRADE_SCALE_LIST),
    save: (payload) => invoke(C.GRADE_SCALE_SAVE, payload),
    remove: (id) => invoke(C.GRADE_SCALE_DELETE, { id }),
  },
  users: {
    list: (params) => invoke(C.USERS_LIST, params),
    get: (id) => invoke(C.USERS_GET, { id }),
    create: (payload) => invoke(C.USERS_CREATE, payload),
    update: (id, payload) => invoke(C.USERS_UPDATE, { id, ...payload }),
    setActive: (id, isActive) => invoke(C.USERS_SET_ACTIVE, { id, isActive }),
    resetPassword: (id, newPassword, options) =>
      invoke(C.USERS_RESET_PASSWORD, {
        id,
        newPassword,
        mustChangePassword: options?.mustChangePassword,
      }),
    remove: (id) => invoke(C.USERS_DELETE, { id }),
  },
  audit: {
    list: (params) => invoke(C.AUDIT_LIST, params),
  },

  structure: {
    get: () => invoke(C.STRUCTURE_GET),
  },
  classes: {
    list: (params) => invoke(C.CLASSES_LIST, params),
    create: (payload) => invoke(C.CLASSES_CREATE, payload),
    update: (id, payload) => invoke(C.CLASSES_UPDATE, { id, ...payload }),
    remove: (id) => invoke(C.CLASSES_DELETE, { id }),
  },
  sections: {
    list: (params) => invoke(C.SECTIONS_LIST, params),
    create: (payload) => invoke(C.SECTIONS_CREATE, payload),
    update: (id, payload) => invoke(C.SECTIONS_UPDATE, { id, ...payload }),
    remove: (id) => invoke(C.SECTIONS_DELETE, { id }),
  },
  subjects: {
    list: (params) => invoke(C.SUBJECTS_LIST, params),
    create: (payload) => invoke(C.SUBJECTS_CREATE, payload),
    update: (id, payload) => invoke(C.SUBJECTS_UPDATE, { id, ...payload }),
    remove: (id) => invoke(C.SUBJECTS_DELETE, { id }),
  },
  classSubjects: {
    list: (params) => invoke(C.CLASS_SUBJECTS_LIST, params),
    save: (payload) => invoke(C.CLASS_SUBJECTS_SAVE, payload),
    remove: (id) => invoke(C.CLASS_SUBJECTS_DELETE, { id }),
  },
  teacherAssignments: {
    list: (params) => invoke(C.TEACHER_ASSIGNMENTS_LIST, params),
    save: (payload) => invoke(C.TEACHER_ASSIGNMENTS_SAVE, payload),
    remove: (id) => invoke(C.TEACHER_ASSIGNMENTS_DELETE, { id }),
  },
  sessions: {
    list: () => invoke(C.SESSIONS_LIST),
    create: (payload) => invoke(C.SESSIONS_CREATE, payload),
    activate: (id) => invoke(C.SESSIONS_ACTIVATE, { id }),
  },

  students: {
    list: (params) => invoke(C.STUDENTS_LIST, params),
    me: () => invoke(C.STUDENTS_ME),
    get: (id) => invoke(C.STUDENTS_GET, { id }),
    create: (payload) => invoke(C.STUDENTS_CREATE, payload),
    update: (id, payload) => invoke(C.STUDENTS_UPDATE, { id, ...payload }),
    remove: (id) => invoke(C.STUDENTS_DELETE, { id }),
    promote: (payload) => invoke(C.STUDENTS_PROMOTE, payload),
    exportExcel: (params) => invoke(C.STUDENTS_EXPORT_EXCEL, params),
    importPreview: () => invoke(C.STUDENTS_IMPORT_PREVIEW),
    importCommit: (payload) => invoke(C.STUDENTS_IMPORT_COMMIT, payload),
    exportPdf: (params) => invoke(C.STUDENTS_EXPORT_PDF, params),
    idCards: (ids) => invoke(C.STUDENTS_ID_CARDS, { ids }),
  },

  files: {
    pickImage: (kind) => invoke(C.FILES_PICK_IMAGE, { kind }),
  },

  staff: {
    list: (params) => invoke(C.STAFF_LIST, params),
    get: (id) => invoke(C.STAFF_GET, { id }),
    create: (payload) => invoke(C.STAFF_CREATE, payload),
    update: (id, payload) => invoke(C.STAFF_UPDATE, { id, ...payload }),
    remove: (id) => invoke(C.STAFF_DELETE, { id }),
    exportExcel: (params) => invoke(C.STAFF_EXPORT_EXCEL, params),
    importPreview: () => invoke(C.STAFF_IMPORT_PREVIEW),
    importCommit: (payload) => invoke(C.STAFF_IMPORT_COMMIT, payload),
  },

  attendance: {
    roster: (params) => invoke(C.ATTENDANCE_ROSTER, params),
    mark: (payload) => invoke(C.ATTENDANCE_MARK, payload),
    markAllPresent: (params) => invoke(C.ATTENDANCE_MARK_ALL_PRESENT, params),
    register: (params) => invoke(C.ATTENDANCE_REGISTER, params),
    monthlyGrid: (params) => invoke(C.ATTENDANCE_MONTHLY_GRID, params),
    monthlyMark: (payload) => invoke(C.ATTENDANCE_MONTHLY_MARK, payload),
    studentHistory: (params) => invoke(C.ATTENDANCE_STUDENT_HISTORY, params),
    low: (params) => invoke(C.ATTENDANCE_LOW, params),
  },

  staffAttendance: {
    day: (params) => invoke(C.STAFF_ATTENDANCE_DAY, params),
    mark: (payload) => invoke(C.STAFF_ATTENDANCE_MARK, payload),
    summary: (params) => invoke(C.STAFF_ATTENDANCE_SUMMARY, params),
    month: (params) => invoke(C.STAFF_ATTENDANCE_MONTH, params),
  },

  leaves: {
    types: () => invoke(C.LEAVE_TYPES),
    list: (params) => invoke(C.LEAVE_LIST, params),
    balances: (params) => invoke(C.LEAVE_BALANCES, params),
    balanceList: (params) => invoke(C.LEAVE_BALANCE_LIST, params),
    setBalance: (payload) => invoke(C.LEAVE_BALANCE_SET, payload),
    apply: (payload) => invoke(C.LEAVE_APPLY, payload),
    decide: (payload) => invoke(C.LEAVE_DECIDE, payload),
  },

  salary: {
    structure: (params) => invoke(C.SALARY_STRUCTURE, params),
    saveBasic: (payload) => invoke(C.SALARY_SAVE_BASIC, payload),
    saveAllowance: (payload) => invoke(C.SALARY_SAVE_ALLOWANCE, payload),
    deleteAllowance: (id) => invoke(C.SALARY_DELETE_ALLOWANCE, { id }),
    saveDeduction: (payload) => invoke(C.SALARY_SAVE_DEDUCTION, payload),
    deleteDeduction: (id) => invoke(C.SALARY_DELETE_DEDUCTION, { id }),
    addAdvance: (payload) => invoke(C.SALARY_ADD_ADVANCE, payload),
    cancelAdvance: (id) => invoke(C.SALARY_CANCEL_ADVANCE, { id }),
    preview: (payload) => invoke(C.SALARY_PREVIEW, payload),
    generate: (payload) => invoke(C.SALARY_GENERATE, payload),
    list: (params) => invoke(C.SALARY_LIST, params),
    detail: (id) => invoke(C.SALARY_DETAIL, { id }),
    markPaid: (payload) => invoke(C.SALARY_MARK_PAID, payload),
    remove: (id) => invoke(C.SALARY_DELETE, { id }),
    mySlips: () => invoke(C.SALARY_MY_SLIPS),
    slipPdf: (id) => invoke(C.SALARY_SLIP_PDF, { id }),
    slipPrint: (id) => invoke(C.SALARY_PAYSLIP_PRINT, { id }),
  },

  fees: {
    structures: (params) => invoke(C.FEE_STRUCTURES, params),
    saveStructure: (payload) => invoke(C.FEE_STRUCTURE_SAVE, payload),
    deleteStructure: (id) => invoke(C.FEE_STRUCTURE_DELETE, { id }),
    discounts: (params) => invoke(C.FEE_DISCOUNTS, params),
    saveDiscount: (payload) => invoke(C.FEE_DISCOUNT_SAVE, payload),
    deleteDiscount: (id) => invoke(C.FEE_DISCOUNT_DELETE, { id }),
    vouchers: (params) => invoke(C.FEE_VOUCHERS, params),
    voucherDetail: (id) => invoke(C.FEE_VOUCHER_DETAIL, { id }),
    preview: (payload) => invoke(C.FEE_PREVIEW, payload),
    generate: (payload) => invoke(C.FEE_GENERATE, payload),
    lateFine: (payload) => invoke(C.FEE_LATE_FINE, payload),
    payment: (payload) => invoke(C.FEE_PAYMENT, payload),
    deletePayment: (id) => invoke(C.FEE_PAYMENT_DELETE, { id }),
    defaulters: (params) => invoke(C.FEE_DEFAULTERS, params),
    collectionReport: (params) => invoke(C.FEE_COLLECTION_REPORT, params),
    my: (params) => invoke(C.FEE_MY, params),
    receiptPdf: (id) => invoke(C.FEE_RECEIPT_PDF, { id }),
    receiptPrint: (id) => invoke(C.FEE_RECEIPT_PRINT, { id }),
    listPdf: (params) => invoke(C.FEE_LIST_PDF, params),
    remindersPdf: (payload) => invoke(C.FEE_REMINDERS_PDF, payload),
  },

  messaging: {
    recipients: (payload) => invoke(C.MESSAGING_RECIPIENTS, payload),
    openLink: (url, channel) => invoke(C.MESSAGING_OPEN_LINK, { url, channel }),
    exportCsv: (payload) => invoke(C.MESSAGING_EXPORT, payload),
    pdf: (payload) => invoke(C.MESSAGING_PDF, payload),
  },

  expenses: {
    list: (params) => invoke(C.EXPENSE_LIST, params),
    create: (payload) => invoke(C.EXPENSE_CREATE, payload),
    update: (id, payload) => invoke(C.EXPENSE_UPDATE, { id, ...payload }),
    remove: (id) => invoke(C.EXPENSE_DELETE, { id }),
    report: (params) => invoke(C.EXPENSE_REPORT, params),
    categories: () => invoke(C.EXPENSE_CATEGORIES),
  },

  exams: {
    types: () => invoke(C.EXAM_TYPES_LIST),
    list: (params) => invoke(C.EXAMS_LIST, params),
    get: (id) => invoke(C.EXAMS_GET, { id }),
    create: (payload) => invoke(C.EXAMS_CREATE, payload),
    update: (id, payload) => invoke(C.EXAMS_UPDATE, { id, ...payload }),
    remove: (id) => invoke(C.EXAMS_DELETE, { id }),
    setStatus: (payload) => invoke(C.EXAMS_SET_STATUS, payload),
    saveSubjects: (payload) => invoke(C.EXAM_SUBJECTS_SAVE, payload),
    markSheet: (params) => invoke(C.EXAM_MARKS_SHEET, params),
    saveMarks: (payload) => invoke(C.EXAM_MARKS_SAVE, payload),
    resultSheet: (params) => invoke(C.EXAM_RESULTS, params),
    computeResults: (payload) => invoke(C.EXAM_RESULTS_COMPUTE, payload),
    stats: (examId) => invoke(C.EXAM_STATS, { examId }),
    myResults: () => invoke(C.EXAM_MY_RESULTS),
    reportCard: (params) => invoke(C.EXAM_REPORT_CARD, params),
    reportCardPdf: (params) => invoke(C.EXAM_REPORT_CARD_PDF, params),
    reportCardPrint: (params) => invoke(C.EXAM_REPORT_CARD_PRINT, params),
    resultSheetPdf: (params) => invoke(C.EXAM_RESULT_SHEET_PDF, params),
  },

  timetable: {
    periods: (params) => invoke(C.TIMETABLE_PERIODS, params),
    savePeriod: (payload) => invoke(C.TIMETABLE_PERIOD_SAVE, payload),
    deletePeriod: (id) => invoke(C.TIMETABLE_PERIOD_DELETE, { id }),
    get: (params) => invoke(C.TIMETABLE_GET, params),
    save: (payload) => invoke(C.TIMETABLE_SAVE, payload),
    my: () => invoke(C.TIMETABLE_MY),
    teacher: (params) => invoke(C.TIMETABLE_TEACHER, params),
  },

  notices: {
    list: (params) => invoke(C.NOTICES_LIST, params),
    save: (payload) => invoke(C.NOTICES_SAVE, payload),
    remove: (id) => invoke(C.NOTICES_DELETE, { id }),
    pin: (id, pinned) => invoke(C.NOTICES_PIN, { id, pinned }),
  },

  reports: {
    dashboard: (params) => invoke(C.REPORTS_DASHBOARD, params),
    run: (payload) => invoke(C.REPORTS_RUN, payload),
    pdf: (payload) => invoke(C.REPORTS_PDF, payload),
  },

  backup: {
    list: () => invoke(C.BACKUP_LIST),
    info: () => invoke(C.BACKUP_INFO),
    create: (payload) => invoke(C.BACKUP_CREATE, payload),
    restore: (name) => invoke(C.BACKUP_RESTORE, { name }),
    restoreFile: () => invoke(C.BACKUP_RESTORE_FILE),
    remove: (name) => invoke(C.BACKUP_DELETE, { name }),
    openFolder: () => invoke(C.BACKUP_OPEN_FOLDER),
  },
  data: {
    stats: () => invoke(C.DATA_STATS),
    scope: () => invoke(C.DATA_SCOPE),
    clear: () => invoke(C.DATA_CLEAR),
    factoryReset: () => invoke(C.DATA_FACTORY_RESET),
  },
});