'use strict';

const { register } = require('./guard');
const C = require('./channels');
const reports = require('../services/reports.service');
const print = require('../services/print.service');
const settings = require('../services/settings.service');
const { getDb } = require('../db/connection');
const { validate, AppError, helpers } = require('../services/validation');

/**
 * Phase 7: dashboard statistics and the printable report desk.
 *
 * The dashboard is one call per role and is already scoped in the service -
 * a teacher's numbers never include a class they do not teach, and a student
 * only ever sees their own records.
 */

/** The reports an admin or the office may print. Each returns rows + columns. */
const REPORT_KINDS = {
  enrolment: {
    roles: ['admin', 'office'],
    title: 'Enrolment Report',
    build(session, params) {
      const db = reports.schoolCounts(session, null);
      const rows = [
        { metric: 'Students', value: db.students },
        { metric: 'Male students', value: db.male },
        { metric: 'Female students', value: db.female },
        { metric: 'Teachers', value: db.teachers },
        { metric: 'Office staff', value: db.officeStaff },
        { metric: 'Staff on leave', value: db.onLeave },
        { metric: 'Classes', value: db.classes },
        { metric: 'Sections', value: db.sections },
      ];
      return { rows, summary: `Total students: ${db.students}` };
    },
  },

  attendance: {
    roles: ['admin', 'office'],
    title: 'Attendance Report',
    build(session, params) {
      const stats = reports.attendanceStats(session, null, params.month);
      const trend = reports.attendanceTrend(session, null, 30);
      return {
        rows: trend.map((row) => ({
          date: row.date,
          total: row.total,
          present: row.present,
          absent: row.absent,
          late: row.late,
          percentage: row.percentage,
        })),
        summary: `Month average: ${stats.studentPercentage}% over ${stats.markedDays} marked days`,
        footer: [
          { metric: 'Month', value: stats.month },
          { metric: 'Records', value: stats.studentTotal },
          { metric: 'Present', value: stats.studentPresent },
          { metric: 'Absent', value: stats.studentAbsent },
          { metric: 'Attendance %', value: stats.studentPercentage },
        ],
      };
    },
  },

  fees: {
    roles: ['admin', 'office'],
    title: 'Fee Collection Report',
    build(session, params) {
      const stats = reports.feeStats(session, params.month);
      const trend = reports.financeTrend(session, 6);
      return {
        rows: trend.map((row) => ({
          month: row.month,
          collected: row.collected,
          expense: row.expense,
          income: row.income,
          salary: row.salary,
          net: row.net,
        })),
        summary: `Collected this month: ${stats.paid} of ${stats.billed} (${stats.collectionPercentage}%)`,
        footer: [
          { metric: 'Billed (month)', value: stats.billed },
          { metric: 'Collected', value: stats.paid },
          { metric: 'Outstanding', value: stats.outstanding },
          { metric: 'Open vouchers', value: stats.open },
        ],
      };
    },
  },

  salary: {
    roles: ['admin', 'office'],
    title: 'Payroll Report',
    build(session, params) {
      const stats = reports.salaryStats(session, params.month);
      const rows = getDb()
        .prepare(
          `SELECT st.name, st.employee_code, p.month, p.basic, p.allowances_total, p.deductions_total, p.net, p.status
           FROM payroll p JOIN staff st ON st.id = p.staff_id
           WHERE p.month = ? ORDER BY st.name`,
        )
        .all(params.month);
      return {
        rows,
        summary: `Net payroll for ${stats.month}: ${stats.net}`,
        footer: [
          { metric: 'Payslips', value: stats.slips },
          { metric: 'Net payable', value: stats.net },
          { metric: 'Paid', value: stats.paid },
          { metric: 'Pending', value: stats.pending },
        ],
      };
    },
  },

  results: {
    roles: ['admin', 'office'],
    title: 'Results Summary',
    build(session, params) {
      const stats = reports.resultStats(session, null);
      return {
        rows: stats.byClass,
        summary: `Pass rate ${stats.passPercentage}% across ${stats.results} results`,
        footer: [
          { metric: 'Results', value: stats.results },
          { metric: 'Passed', value: stats.passed },
          { metric: 'Pass rate %', value: stats.passPercentage },
          { metric: 'Average %', value: stats.averagePercentage },
        ],
      };
    },
  },
};

function registerReportsIpc() {
  register(C.REPORTS_DASHBOARD, { roles: ['admin', 'office', 'teacher', 'student'] }, ({ payload, session }) =>
    reports.dashboard(payload || {}, session),
  );

  register(C.REPORTS_RUN, { roles: ['admin', 'office'] }, ({ payload, session }) => {
    const clean = validate(payload || {}, {
      kind: helpers.enum(Object.keys(REPORT_KINDS), { required: true }),
      month: helpers.month(),
    });
    const report = REPORT_KINDS[clean.kind];
    if (!report.roles.includes(session.role)) throw new AppError('FORBIDDEN', 'FORBIDDEN');

    const month = clean.month || new Date().toISOString().slice(0, 7);
    const built = report.build(session, { month });
    return { kind: clean.kind, title: report.title, month, ...built };
  });

  register(C.REPORTS_PDF, { roles: ['admin', 'office'] }, async ({ payload, session }) => {
    const clean = validate(payload || {}, {
      kind: helpers.enum(Object.keys(REPORT_KINDS), { required: true }),
      month: helpers.month(),
    });
    const report = REPORT_KINDS[clean.kind];
    if (!report.roles.includes(session.role)) throw new AppError('FORBIDDEN', 'FORBIDDEN');

    const month = clean.month || new Date().toISOString().slice(0, 7);
    const built = report.build(session, { month });
    const s = settings.getAll();

    const columns = built.rows.length ? Object.keys(built.rows[0]) : [];
    const head = columns.map((c) => `<th>${escapeHtml(titleCase(c))}</th>`).join('');
    const body = built.rows
      .map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(row[c])}</td>`).join('')}</tr>`)
      .join('');
    const footer = built.footer
      ? `<div class="totals">${built.footer
          .map((f) => `<span>${escapeHtml(f.metric)}: ${escapeHtml(f.value)}</span>`)
          .join('')}</div>`
      : '';

    const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 24px; }
      header { border-bottom: 2px solid #4c7df0; padding-bottom: 8px; margin-bottom: 14px; }
      h1 { font-size: 18px; margin: 0; }
      .sub { font-size: 12px; color: #475569; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px; }
      th { background: #eef2ff; text-align: left; padding: 6px; border: 1px solid #dbe3f5; text-transform: uppercase; font-size: 10px; }
      td { padding: 5px 6px; border: 1px solid #e2e8f0; }
      tbody tr:nth-child(even) td { background: #f8fafc; }
      .totals { margin-top: 12px; font-size: 12px; display: flex; gap: 18px; flex-wrap: wrap; }
      .foot { margin-top: 20px; font-size: 10px; color: #64748b; }
    </style></head><body>
      <header>
        <h1>${escapeHtml(s.school_name)}</h1>
        <div class="sub">${escapeHtml(report.title)} &middot; ${escapeHtml(month)}</div>
      </header>
      <p class="sub">${escapeHtml(built.summary || '')}</p>
      <table><thead><tr>${head}</tr></thead>
      <tbody>${body || `<tr><td colspan="${columns.length || 1}">No data</td></tr>`}</tbody></table>
      ${footer}
      <div class="foot">${s.report_footer ? escapeHtml(s.report_footer) : ''} &middot; Printed ${new Date().toLocaleString()}</div>
    </body></html>`;

    return print.printHtmlToPdf({
      html,
      defaultName: `${clean.kind}-${month}`,
      landscape: true,
      session,
      entity: 'reports',
      entityId: clean.kind,
      description: report.title,
    });
  });
}

function titleCase(value) {
  return String(value)
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { registerReportsIpc, REPORT_KINDS };