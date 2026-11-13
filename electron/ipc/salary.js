'use strict';

const path = require('node:path');
const { dialog } = require('electron');
const { register } = require('./guard');
const C = require('./channels');
const salary = require('../services/salary.service');
const print = require('../services/print.service');
const settings = require('../services/settings.service');
const files = require('../services/files.service');
const { validate, helpers, AppError } = require('../services/validation');
const { money } = salary;

/** Salary management. Teachers may only read their own slips. */
function registerSalaryIpc() {
  // --- structure ----------------------------------------------------------
  register(C.SALARY_STRUCTURE, { roles: ['admin', 'office'] }, ({ payload }) =>
    salary.structureFor(validate(payload || {}, { staffId: helpers.int({ min: 1 }) }).staffId),
  );
  register(C.SALARY_SAVE_BASIC, { roles: ['admin'] }, ({ payload, session }) => {
    const { staffId, ...rest } = payload || {};
    return salary.saveBasic(validate({ staffId }, { staffId: helpers.int({ min: 1 }) }).staffId, rest, session);
  });
  register(C.SALARY_SAVE_ALLOWANCE, { roles: ['admin'] }, ({ payload, session }) => salary.saveAllowance(payload || {}, session));
  register(C.SALARY_DELETE_ALLOWANCE, { roles: ['admin'] }, ({ payload, session }) =>
    salary.deleteAllowance(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session),
  );
  register(C.SALARY_SAVE_DEDUCTION, { roles: ['admin'] }, ({ payload, session }) => salary.saveDeduction(payload || {}, session));
  register(C.SALARY_DELETE_DEDUCTION, { roles: ['admin'] }, ({ payload, session }) =>
    salary.deleteDeduction(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session),
  );

  // --- advances -----------------------------------------------------------
  register(C.SALARY_ADD_ADVANCE, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    salary.addAdvance(payload || {}, session),
  );
  register(C.SALARY_CANCEL_ADVANCE, { roles: ['admin'] }, ({ payload, session }) =>
    salary.cancelAdvance(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session),
  );

  // --- payroll ------------------------------------------------------------
  register(C.SALARY_PREVIEW, { roles: ['admin', 'office'] }, ({ payload, session }) => salary.preview(payload || {}, session));
  register(C.SALARY_GENERATE, { roles: ['admin'] }, ({ payload, session }) => salary.generate(payload || {}, session));
  register(C.SALARY_LIST, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) => salary.list(payload || {}, session));
  register(C.SALARY_DETAIL, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) =>
    ownSlip(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session),
  );
  register(C.SALARY_MARK_PAID, { roles: ['admin'] }, ({ payload, session }) => salary.markPaid(payload || {}, session));
  register(C.SALARY_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    salary.remove(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session),
  );
  register(C.SALARY_MY_SLIPS, { roles: ['admin', 'office', 'teacher'] }, ({ session }) => salary.mySlips(session));

  // --- salary slip PDF ----------------------------------------------------
  register(C.SALARY_SLIP_PDF, { roles: ['admin', 'office', 'teacher'] }, async ({ payload, session }) => {
    const slip = ownSlip(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session);
    return print.printHtmlToPdf({
      html: slipHtml(slip),
      defaultName: `salary-slip-${slip.staffName.replace(/\s+/g, '-')}-${slip.month}`,
      session,
      entity: 'payroll',
      entityId: slip.id,
      description: `salary slip ${slip.month}`,
    });
  });

  register(C.SALARY_PAYSLIP_PRINT, { roles: ['admin', 'office', 'teacher'] }, async ({ payload, session }) => {
    const slip = ownSlip(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session);
    return print.openPrintPreview({ html: slipHtml(slip), session });
  });
}

/**
 * Loads a payslip and enforces that a teacher only ever sees their own.
 * @param {number} id
 * @param {{ role: string, linkedId?: number }} session
 */
function ownSlip(id, session) {
  const detail = salary.detail(id);
  if (session.role === 'teacher' && detail.staffId !== session.linkedId) {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }
  return detail;
}

/** Print-friendly salary slip. */
function slipHtml(slip) {
  const s = settings.getAll();
  const logo = files.logoDataUrl();
  const fmt = (v) => `${s.currency_symbol} ${Number(v).toFixed(2)}`;
  const monthName = new Date(`${slip.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const earnings = slip.items.filter((i) => i.kind === 'earning');
  const deductions = slip.items.filter((i) => i.kind === 'deduction');

  const row = (label, value) => `<tr><td>${label}</td><td class="num">${fmt(value)}</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 28px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4c7df0; padding-bottom: 10px; margin-bottom: 18px; }
  .school { font-size: 18px; font-weight: 700; }
  .addr { font-size: 11px; color: #475569; }
  .logo { width: 58px; height: 58px; object-fit: contain; }
  h1 { font-size: 14px; letter-spacing: .08em; text-transform: uppercase; text-align: center; margin: 14px 0; color: #334155; }
  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 16px; font-size: 12px; margin-bottom: 16px; }
  .meta b { color: #64748b; font-weight: 500; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #eef2ff; text-align: left; padding: 7px 9px; border: 1px solid #dbe3f5; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  td { padding: 6px 9px; border: 1px solid #e2e8f0; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; background: #f8fafc; }
  .net { margin-top: 14px; border: 1px solid #4c7df0; border-radius: 8px; padding: 12px 14px; display: flex; justify-content: space-between; font-size: 15px; font-weight: 700; background: #f5f8ff; }
  .foot { margin-top: 18px; display: flex; justify-content: space-between; font-size: 11px; color: #64748b; }
  .sig { margin-top: 40px; display: flex; justify-content: space-between; font-size: 11px; color: #475569; }
</style></head><body>
  <header>
    <div>
      <div class="school">${escapeHtml(s.school_name)}</div>
      <div class="addr">${escapeHtml(s.school_address || '')}</div>
      <div class="addr">${escapeHtml(s.school_phone || '')}</div>
    </div>
    ${logo ? `<img class="logo" src="${logo}" alt="" />` : '<div></div>'}
  </header>

  <h1>Salary Slip &middot; ${escapeHtml(monthName)}</h1>

  <div class="meta">
    <div><b>Name</b><br />${escapeHtml(slip.staffName)}</div>
    <div><b>Employee code</b><br />${escapeHtml(slip.employeeCode || '-')}</div>
    <div><b>Designation</b><br />${escapeHtml(slip.designation || '-')}</div>
    <div><b>Attendance</b><br />${slip.presentDays} present / ${slip.absentDays} absent</div>
    <div><b>Status</b><br />${escapeHtml(slip.status)}${slip.paidDate ? ` (${slip.paidDate})` : ''}</div>
    <div><b>Session</b><br />${escapeHtml(s.session)}</div>
  </div>

  <div class="cols">
    <table>
      <thead><tr><th>Earnings</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${earnings.map((i) => row(escapeHtml(i.name), i.amount)).join('')}</tbody>
      <tfoot><tr><td>Gross</td><td class="num">${fmt(slip.gross)}</td></tr></tfoot>
    </table>
    <table>
      <thead><tr><th>Deductions</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${(deductions.length ? deductions : [{ name: 'None', amount: 0 }]).map((i) => row(escapeHtml(i.name), i.amount)).join('')}</tbody>
      <tfoot><tr><td>Total deductions</td><td class="num">${fmt(slip.deductionsTotal)}</td></tr></tfoot>
    </table>
  </div>

  <div class="net"><span>Net Payable</span><span>${fmt(slip.net)}</span></div>

  ${s.report_footer ? `<div class="foot"><span>${escapeHtml(s.report_footer)}</span></div>` : ''}
  <div class="foot"><span>Generated by ${escapeHtml(s.school_name)}</span><span>${new Date().toLocaleString()}</span></div>
  <div class="sig"><span>_______________________<br />Employee signature</span><span>_______________________<br />Authorised signature</span></div>
</body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { registerSalaryIpc };