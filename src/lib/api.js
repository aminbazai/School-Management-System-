/**
 * Renderer-side API client.
 *
 * Every call goes through the preload bridge (window.school) - the renderer
 * has no Node access and no direct database handle. Errors arrive as a single
 * ApiError shape so pages can map codes onto i18n messages.
 */

export class ApiError extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN';
    this.fields = extra.fields || null;
    this.seconds = extra.seconds;
    this.attemptsLeft = extra.attemptsLeft;
  }
}

const bridge = globalThis.window?.school;

function assertBridge() {
  if (!bridge) {
    throw new ApiError('BRIDGE_UNAVAILABLE');
  }
}

async function call(fn, ...args) {
  assertBridge();
  const response = await fn(...args);
  if (response && response.ok) return response.data;
  const error = response?.error || { code: 'SERVER_ERROR' };
  throw new ApiError(error.code, error);
}

export const api = {
  app: {
    getInfo: () => call(bridge.app.getInfo),
  },
  auth: {
    login: (username, password) => call(bridge.auth.login, { username, password }),
    logout: () => call(bridge.auth.logout),
    session: () => call(bridge.auth.session),
    heartbeat: () => call(bridge.auth.heartbeat),
    changePassword: (payload) => call(bridge.auth.changePassword, payload),
    /** Main -> renderer events (session:expired, ...). */
    on: (event, callback) => bridge.auth.on(event, callback),
  },
  settings: {
    get: () => call(bridge.settings.get),
    update: (payload) => call(bridge.settings.update, payload),
    uploadLogo: () => call(bridge.settings.uploadLogo),
    clearLogo: () => call(bridge.settings.clearLogo),
  },
  gradeScale: {
    list: () => call(bridge.gradeScale.list),
    save: (payload) => call(bridge.gradeScale.save, payload),
    remove: (id) => call(bridge.gradeScale.remove, id),
  },
  users: {
    list: (params) => call(bridge.users.list, params),
    create: (payload) => call(bridge.users.create, payload),
    update: (id, payload) => call(bridge.users.update, id, payload),
    setActive: (id, isActive) => call(bridge.users.setActive, id, isActive),
    resetPassword: (id, newPassword, options) => call(bridge.users.resetPassword, id, newPassword, options),
    remove: (id) => call(bridge.users.remove, id),
  },
  audit: {
    list: (params) => call(bridge.audit.list, params),
  },

  structure: {
    get: () => call(bridge.structure.get),
  },
  classes: {
    create: (payload) => call(bridge.classes.create, payload),
    update: (id, payload) => call(bridge.classes.update, id, payload),
    remove: (id) => call(bridge.classes.remove, id),
  },
  sections: {
    create: (payload) => call(bridge.sections.create, payload),
    update: (id, payload) => call(bridge.sections.update, id, payload),
    remove: (id) => call(bridge.sections.remove, id),
  },
  subjects: {
    create: (payload) => call(bridge.subjects.create, payload),
    update: (id, payload) => call(bridge.subjects.update, id, payload),
    remove: (id) => call(bridge.subjects.remove, id),
  },
  classSubjects: {
    save: (payload) => call(bridge.classSubjects.save, payload),
    remove: (id) => call(bridge.classSubjects.remove, id),
  },
  sessions: {
    create: (payload) => call(bridge.sessions.create, payload),
    activate: (id) => call(bridge.sessions.activate, id),
  },
  teacherAssignments: {
    list: (params) => call(bridge.teacherAssignments.list, params),
    save: (payload) => call(bridge.teacherAssignments.save, payload),
    remove: (id) => call(bridge.teacherAssignments.remove, id),
  },

  students: {
    list: (params) => call(bridge.students.list, params),
    me: () => call(bridge.students.me),
    get: (id) => call(bridge.students.get, id),
    create: (payload) => call(bridge.students.create, payload),
    update: (id, payload) => call(bridge.students.update, id, payload),
    remove: (id) => call(bridge.students.remove, id),
    promote: (payload) => call(bridge.students.promote, payload),
    exportExcel: (params) => call(bridge.students.exportExcel, params),
    importPreview: () => call(bridge.students.importPreview),
    importCommit: (payload) => call(bridge.students.importCommit, payload),
    exportPdf: (params) => call(bridge.students.exportPdf, params),
    idCards: (ids) => call(bridge.students.idCards, ids),
  },

  files: {
    pickImage: (kind) => call(bridge.files.pickImage, kind),
  },

  staff: {
    list: (params) => call(bridge.staff.list, params),
    create: (payload) => call(bridge.staff.create, payload),
    update: (id, payload) => call(bridge.staff.update, id, payload),
    remove: (id) => call(bridge.staff.remove, id),
    exportExcel: (params) => call(bridge.staff.exportExcel, params),
    importPreview: () => call(bridge.staff.importPreview),
    importCommit: (payload) => call(bridge.staff.importCommit, payload),
  },

  attendance: {
    roster: (params) => call(bridge.attendance.roster, params),
    mark: (payload) => call(bridge.attendance.mark, payload),
    markAllPresent: (params) => call(bridge.attendance.markAllPresent, params),
    register: (params) => call(bridge.attendance.register, params),
    monthlyGrid: (params) => call(bridge.attendance.monthlyGrid, params),
    monthlyMark: (payload) => call(bridge.attendance.monthlyMark, payload),
    studentHistory: (params) => call(bridge.attendance.studentHistory, params),
    low: (params) => call(bridge.attendance.low, params),
  },

  staffAttendance: {
    day: (params) => call(bridge.staffAttendance.day, params),
    mark: (payload) => call(bridge.staffAttendance.mark, payload),
    summary: (params) => call(bridge.staffAttendance.summary, params),
    month: (params) => call(bridge.staffAttendance.month, params),
  },

  leaves: {
    types: () => call(bridge.leaves.types),
    list: (params) => call(bridge.leaves.list, params),
    balances: (params) => call(bridge.leaves.balances, params),
    balanceList: (params) => call(bridge.leaves.balanceList, params),
    setBalance: (payload) => call(bridge.leaves.setBalance, payload),
    apply: (payload) => call(bridge.leaves.apply, payload),
    decide: (payload) => call(bridge.leaves.decide, payload),
  },

  salary: {
    structure: (params) => call(bridge.salary.structure, params),
    saveBasic: (payload) => call(bridge.salary.saveBasic, payload),
    saveAllowance: (payload) => call(bridge.salary.saveAllowance, payload),
    deleteAllowance: (id) => call(bridge.salary.deleteAllowance, id),
    saveDeduction: (payload) => call(bridge.salary.saveDeduction, payload),
    deleteDeduction: (id) => call(bridge.salary.deleteDeduction, id),
    addAdvance: (payload) => call(bridge.salary.addAdvance, payload),
    cancelAdvance: (id) => call(bridge.salary.cancelAdvance, id),
    preview: (payload) => call(bridge.salary.preview, payload),
    generate: (payload) => call(bridge.salary.generate, payload),
    list: (params) => call(bridge.salary.list, params),
    detail: (id) => call(bridge.salary.detail, id),
    markPaid: (payload) => call(bridge.salary.markPaid, payload),
    remove: (id) => call(bridge.salary.remove, id),
    mySlips: () => call(bridge.salary.mySlips),
    slipPdf: (id) => call(bridge.salary.slipPdf, id),
    slipPrint: (id) => call(bridge.salary.slipPrint, id),
  },

  fees: {
    structures: (params) => call(bridge.fees.structures, params),
    saveStructure: (payload) => call(bridge.fees.saveStructure, payload),
    deleteStructure: (id) => call(bridge.fees.deleteStructure, id),
    discounts: (params) => call(bridge.fees.discounts, params),
    saveDiscount: (payload) => call(bridge.fees.saveDiscount, payload),
    deleteDiscount: (id) => call(bridge.fees.deleteDiscount, id),
    vouchers: (params) => call(bridge.fees.vouchers, params),
    voucherDetail: (id) => call(bridge.fees.voucherDetail, id),
    preview: (payload) => call(bridge.fees.preview, payload),
    generate: (payload) => call(bridge.fees.generate, payload),
    lateFine: (payload) => call(bridge.fees.lateFine, payload),
    payment: (payload) => call(bridge.fees.payment, payload),
    deletePayment: (id) => call(bridge.fees.deletePayment, id),
    defaulters: (params) => call(bridge.fees.defaulters, params),
    collectionReport: (params) => call(bridge.fees.collectionReport, params),
    my: (params) => call(bridge.fees.my, params),
    receiptPdf: (id) => call(bridge.fees.receiptPdf, id),
    receiptPrint: (id) => call(bridge.fees.receiptPrint, id),
    listPdf: (params) => call(bridge.fees.listPdf, params),
    remindersPdf: (payload) => call(bridge.fees.remindersPdf, payload),
  },

  messaging: {
    recipients: (payload) => call(bridge.messaging.recipients, payload),
    openLink: (url, channel) => call(bridge.messaging.openLink, url, channel),
    exportCsv: (payload) => call(bridge.messaging.exportCsv, payload),
    pdf: (payload) => call(bridge.messaging.pdf, payload),
  },

  expenses: {
    list: (params) => call(bridge.expenses.list, params),
    create: (payload) => call(bridge.expenses.create, payload),
    update: (id, payload) => call(bridge.expenses.update, id, payload),
    remove: (id) => call(bridge.expenses.remove, id),
    report: (params) => call(bridge.expenses.report, params),
    categories: () => call(bridge.expenses.categories),
  },

  exams: {
    list: (params) => call(bridge.exams.list, params),
    get: (id) => call(bridge.exams.get, id),
    create: (payload) => call(bridge.exams.create, payload),
    update: (id, payload) => call(bridge.exams.update, id, payload),
    remove: (id) => call(bridge.exams.remove, id),
    setStatus: (payload) => call(bridge.exams.setStatus, payload),
    saveSubjects: (payload) => call(bridge.exams.saveSubjects, payload),
    markSheet: (params) => call(bridge.exams.markSheet, params),
    saveMarks: (payload) => call(bridge.exams.saveMarks, payload),
    resultSheet: (params) => call(bridge.exams.resultSheet, params),
    computeResults: (payload) => call(bridge.exams.computeResults, payload),
    myResults: () => call(bridge.exams.myResults),
    reportCard: (params) => call(bridge.exams.reportCard, params),
    reportCardPdf: (params) => call(bridge.exams.reportCardPdf, params),
    reportCardPrint: (params) => call(bridge.exams.reportCardPrint, params),
    resultSheetPdf: (params) => call(bridge.exams.resultSheetPdf, params),
  },

  timetable: {
    periods: (params) => call(bridge.timetable.periods, params),
    savePeriod: (payload) => call(bridge.timetable.savePeriod, payload),
    deletePeriod: (id) => call(bridge.timetable.deletePeriod, id),
    get: (params) => call(bridge.timetable.get, params),
    save: (payload) => call(bridge.timetable.save, payload),
    my: () => call(bridge.timetable.my),
    teacher: (params) => call(bridge.timetable.teacher, params),
  },

  notices: {
    list: (params) => call(bridge.notices.list, params),
    save: (payload) => call(bridge.notices.save, payload),
    remove: (id) => call(bridge.notices.remove, id),
    pin: (id, pinned) => call(bridge.notices.pin, id, pinned),
  },

  reports: {
    dashboard: (params) => call(bridge.reports.dashboard, params),
    run: (payload) => call(bridge.reports.run, payload),
    pdf: (payload) => call(bridge.reports.pdf, payload),
  },

  backup: {
    list: () => call(bridge.backup.list),
    info: () => call(bridge.backup.info),
    create: (payload) => call(bridge.backup.create, payload),
    restore: (name) => call(bridge.backup.restore, name),
    restoreFile: () => call(bridge.backup.restoreFile),
    remove: (name) => call(bridge.backup.remove, name),
    openFolder: () => call(bridge.backup.openFolder),
  },
  data: {
    stats: () => call(bridge.data.stats),
    scope: () => call(bridge.data.scope),
    clear: () => call(bridge.data.clear),
    factoryReset: () => call(bridge.data.factoryReset),
  },
};

/** i18n key for an ApiError, e.g. errors.INVALID_CREDENTIALS */
export function errorKey(err) {
  return `errors.${err?.code || 'SERVER_ERROR'}`;
}

export default api;