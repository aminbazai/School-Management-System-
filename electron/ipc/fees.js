'use strict';

const path = require('node:path');
const { dialog } = require('electron');
const { register } = require('./guard');
const C = require('./channels');
const fees = require('../services/fees.service');
const expenses = require('../services/expenses.service');
const print = require('../services/print.service');
const files = require('../services/files.service');
const settings = require('../services/settings.service');
const { validate, helpers, AppError } = require('../services/validation');

/** Fee collection (admin + office) and read-only fee status for students. */
function registerFeesIpc() {
  // --- fee structures & discounts ------------------------------------------
  register(C.FEE_STRUCTURES, { roles: ['admin', 'office'] }, ({ payload }) =>
    fees.listStructures(payload || {}),
  );
  register(C.FEE_STRUCTURE_SAVE, { roles: ['admin'] }, ({ payload, session }) => fees.saveStructure(payload || {}, session));
  register(C.FEE_STRUCTURE_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    fees.deleteStructure(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session),
  );
  register(C.FEE_DISCOUNTS, { roles: ['admin', 'office'] }, ({ payload }) => fees.listDiscounts(payload || {}));
  register(C.FEE_DISCOUNT_SAVE, { roles: ['admin', 'office'] }, ({ payload, session }) => fees.saveDiscount(payload || {}, session));
  register(C.FEE_DISCOUNT_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    fees.deleteDiscount(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session),
  );

  // --- vouchers -------------------------------------------------------------
  register(C.FEE_VOUCHERS, { roles: ['admin', 'office', 'student'] }, ({ payload, session }) =>
    fees.listVouchers(payload || {}, session),
  );
  register(C.FEE_VOUCHER_DETAIL, { roles: ['admin', 'office', 'student'] }, ({ payload, session }) =>
    fees.voucherDetail(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session),
  );
  register(C.FEE_PREVIEW, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    fees.previewGenerate(payload || {}, session),
  );
  register(C.FEE_GENERATE, { roles: ['admin'] }, ({ payload, session }) => fees.generateVouchers(payload || {}, session));
  register(C.FEE_LATE_FINE, { roles: ['admin'] }, ({ payload, session }) => fees.applyLateFines(payload || {}, session));

  // --- payments -------------------------------------------------------------
  register(C.FEE_PAYMENT, { roles: ['admin', 'office'] }, ({ payload, session }) => fees.recordPayment(payload || {}, session));
  register(C.FEE_PAYMENT_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    fees.deletePayment(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session),
  );

  // --- reports --------------------------------------------------------------
  register(C.FEE_DEFAULTERS, { roles: ['admin', 'office'] }, ({ payload, session }) => fees.defaulters(payload || {}, session));
  register(C.FEE_COLLECTION_REPORT, { roles: ['admin', 'office'] }, ({ payload, session }) => fees.collectionReport(payload || {}, session));
  register(C.FEE_MY, { roles: ['admin', 'office', 'student'] }, ({ payload, session }) =>
    fees.studentFees(payload?.studentId ?? null, session),
  );

  // --- printable documents --------------------------------------------------
  register(C.FEE_RECEIPT_PDF, { roles: ['admin', 'office', 'student'] }, async ({ payload, session }) => {
    const data = fees.receiptData(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session);
    return print.printHtmlToPdf({
      html: receiptHtml(data),
      defaultName: `receipt-${data.payment.receiptNo}`,
      paperSize: 'A4',
      margin: false,
      session,
      entity: 'fee_payments',
      entityId: data.payment.id,
      description: `receipt ${data.payment.receiptNo}`,
    });
  });

  register(C.FEE_RECEIPT_PRINT, { roles: ['admin', 'office', 'student'] }, async ({ payload, session }) => {
    const data = fees.receiptData(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session);
    return print.openPrintPreview({ html: receiptHtml(data), session });
  });

  register(C.FEE_LIST_PDF, { roles: ['admin', 'office'] }, async ({ payload, session }) => {
    const result = fees.listVouchers({ ...(payload || {}), pageSize: 500 }, session);
    const rows = result.rows
      .map(
        (row, index) => `<tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(row.voucherNo)}</td>
          <td>${escapeHtml(row.studentName)}</td>
          <td>${escapeHtml(row.admissionNo)}</td>
          <td>${escapeHtml(row.className || '')}</td>
          <td class="num">${row.totalAmount.toFixed(2)}</td>
          <td class="num">${row.discount.toFixed(2)}</td>
          <td class="num">${row.paidAmount.toFixed(2)}</td>
          <td class="num">${row.balance.toFixed(2)}</td>
          <td>${escapeHtml(row.status)}</td>
        </tr>`,
      )
      .join('');

    const s = settings.getAll();
    const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 24px; }
      header { border-bottom: 2px solid #4c7df0; padding-bottom: 8px; margin-bottom: 14px; }
      h1 { font-size: 18px; margin: 0; }
      .sub { font-size: 12px; color: #475569; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { background: #eef2ff; text-align: left; padding: 6px; border: 1px solid #dbe3f5; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
      td { padding: 5px 6px; border: 1px solid #e2e8f0; }
      td.num { text-align: right; }
      tbody tr:nth-child(even) td { background: #f8fafc; }
      .totals { margin-top: 12px; font-size: 12px; display: flex; gap: 18px; }
    </style></head><body>
      <header>
        <h1>${escapeHtml(s.school_name)}</h1>
        <div class="sub">Fee vouchers &middot; ${escapeHtml(payload?.month || '')}</div>
      </header>
      <table><thead><tr>
        <th>#</th><th>Voucher</th><th>Student</th><th>Admission</th><th>Class</th>
        <th>Total</th><th>Discount</th><th>Paid</th><th>Balance</th><th>Status</th>
      </tr></thead><tbody>${rows || '<tr><td colspan="10">No vouchers</td></tr>'}</tbody></table>
      <div class="totals">
        <span>Total: ${result.summary.total.toFixed(2)}</span>
        <span>Paid: ${result.summary.paid.toFixed(2)}</span>
        <span>Balance: ${result.summary.balance.toFixed(2)}</span>
      </div>
    </body></html>`;

    return print.printHtmlToPdf({
      html,
      defaultName: `fee-vouchers-${Date.now()}`,
      landscape: true,
      session,
      entity: 'fee_vouchers',
      description: 'voucher list',
    });
  });

  register(C.FEE_REMINDERS_PDF, { roles: ['admin', 'office'] }, async ({ payload, session }) => {
    const data = fees.reminderRows(payload || {}, session);
    if (!data.rows.length) throw new AppError('NOTHING_TO_GENERATE', 'NOTHING_TO_GENERATE');
    return print.printHtmlToPdf({
      html: remindersHtml(data, files.logoDataUrl()),
      defaultName: `fee-reminders-${payload?.month || 'all'}-${Date.now()}`,
      paperSize: 'A4',
      session,
      entity: 'fee_vouchers',
      description: `${data.rows.length} fee reminder letters`,
    });
  });

  // --- expenses -------------------------------------------------------------
  register(C.EXPENSE_LIST, { roles: ['admin', 'office'] }, ({ payload, session }) => expenses.list(payload || {}, session));
  register(C.EXPENSE_CREATE, { roles: ['admin', 'office'] }, ({ payload, session }) => expenses.create(payload || {}, session));
  register(C.EXPENSE_UPDATE, { roles: ['admin', 'office'] }, ({ payload, session }) => {
    const { id, ...rest } = payload || {};
    return expenses.update(validate({ id }, { id: helpers.int({ min: 1 }) }).id, rest, session);
  });
  register(C.EXPENSE_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    expenses.softDelete(validate(payload || {}, { id: helpers.int({ min: 1 }) }).id, session),
  );
  register(C.EXPENSE_REPORT, { roles: ['admin', 'office'] }, ({ payload, session }) => expenses.report(payload || {}, session));
  register(C.EXPENSE_CATEGORIES, { roles: ['admin', 'office'] }, () => expenses.CATEGORIES);
}

function receiptHtml(data) {
  const logo = files.logoDataUrl();
  const { payment, voucher, student, school } = data;
  const fmt = (v) => `${school.currency || 'Rs'} ${Number(v).toFixed(2)}`;
  const paid = voucher.totalAmount + voucher.lateFine - voucher.discount;

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; }
  .sheet { padding: 28px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4c7df0; padding-bottom: 10px; }
  .school { font-size: 17px; font-weight: 700; }
  .addr { font-size: 11px; color: #475569; }
  .logo { width: 54px; height: 54px; object-fit: contain; }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0; font-size: 12px; }
  .meta b { color: #64748b; font-weight: 500; display: block; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #eef2ff; text-align: left; padding: 7px 9px; border: 1px solid #dbe3f5; }
  td { padding: 6px 9px; border: 1px solid #e2e8f0; }
  td.num, th.num { text-align: right; }
  .total { display: flex; justify-content: space-between; margin-top: 10px; font-size: 14px; font-weight: 700; }
  .paid { margin-top: 12px; border: 2px solid #4c7df0; border-radius: 8px; padding: 12px 14px; display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; background: #f5f8ff; }
  .foot { margin-top: 22px; display: flex; justify-content: space-between; font-size: 11px; color: #64748b; }
  .sig { margin-top: 46px; display: flex; justify-content: space-between; font-size: 11px; color: #475569; }
</style></head><body><div class="sheet">
  <header>
    <div>
      <div class="school">${escapeHtml(school.name || '')}</div>
      <div class="addr">${escapeHtml(school.address || '')}</div>
      <div class="addr">${escapeHtml(school.phone || '')}${school.email ? ` &middot; ${escapeHtml(school.email)}` : ''}</div>
    </div>
    ${logo ? `<img class="logo" src="${logo}" alt="" />` : '<div></div>'}
  </header>

  <div class="meta">
    <div><b>Receipt No</b>${escapeHtml(payment.receiptNo)}</div>
    <div><b>Date</b>${escapeHtml(payment.paymentDate)}</div>
    <div><b>Voucher</b>${escapeHtml(voucher.voucherNo)}</div>
    <div><b>Month Paid</b>${escapeHtml(monthLabel(voucher.month))}</div>
    <div><b>Method</b>${escapeHtml(payment.method)}</div>
    <div><b>Student</b>${escapeHtml(student.name)}</div>
    <div><b>Father Name</b>${escapeHtml(student.fatherName || '-')}</div>
    <div><b>Roll No</b>${escapeHtml(student.rollNo || '-')}</div>
    <div><b>Admission No</b>${escapeHtml(student.admissionNo)}</div>
    <div><b>Class</b>${escapeHtml(`${student.className || ''} ${student.sectionName || ''}`)}</div>
    <div><b>Father Phone</b>${escapeHtml(student.phone || student.guardianPhone || '-')}</div>
    <div><b>Address</b>${escapeHtml(student.address || '-')}</div>
    <div><b>Guardian Phone</b>${escapeHtml(student.guardianPhone || '-')}</div>
  </div>

  <table>
    <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
    <tbody>
      ${(data.items.length ? data.items : [{ description: 'Tuition fee', amount: voucher.totalAmount }])
        .map((item) => `<tr><td>${escapeHtml(item.description)}</td><td class="num">${item.amount.toFixed(2)}</td></tr>`)
        .join('')}
      ${voucher.discount > 0 ? `<tr><td>Discount / concession</td><td class="num">-${voucher.discount.toFixed(2)}</td></tr>` : ''}
      ${voucher.lateFine > 0 ? `<tr><td>Late fine</td><td class="num">${voucher.lateFine.toFixed(2)}</td></tr>` : ''}
    </tbody>
  </table>

  <div class="total"><span>Total payable</span><span>${fmt(paid)}</span></div>
  <div class="paid"><span>Amount received</span><span>${fmt(payment.amount)}</span></div>
  <div class="total"><span>Balance after this payment</span><span>${fmt(voucher.balance)}</span></div>

  ${school.footer ? `<div class="foot"><span>${escapeHtml(school.footer)}</span></div>` : ''}
  <div class="foot"><span>Printed ${new Date().toLocaleString()}</span><span>${escapeHtml(payment.reference || '')}</span></div>
  <div class="sig"><span>_______________________<br />Cashier</span><span>_______________________<br />Parent / Guardian</span></div>
</div></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function monthLabel(month) {
  if (!month) return 'all unpaid months';
  const [year, index] = String(month).split('-');
  const date = new Date(Number(year), Math.max(0, Number(index) - 1), 1);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/** One polite reminder letter per page, ready to print or save as PDF. */
function remindersHtml(data, logo) {
  const { school, rows } = data;
  const symbol = school.currency || 'Rs';
  const fmt = (value) => `${symbol} ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const letters = rows
    .map((row) => {
      const guardian = row.guardianName || 'Parent / Guardian';
      const className = [row.className, row.sectionName].filter(Boolean).join(' - ');
      return `<article class="letter">
        <header>
          <div>
            <div class="school">${escapeHtml(school.name || '')}</div>
            <div class="addr">${escapeHtml(school.address || '')}</div>
            <div class="addr">${escapeHtml(school.phone || '')}${school.email ? ` &middot; ${escapeHtml(school.email)}` : ''}</div>
          </div>
          ${logo ? `<img class="logo" src="${logo}" alt="" />` : ''}
        </header>

        <div class="title-row">
          <h1>Fee Reminder</h1>
          <div class="date">${escapeHtml(new Date().toLocaleDateString('en-GB'))}</div>
        </div>

        <p>Dear <strong>${escapeHtml(guardian)}</strong>,</p>
        <p>This is a friendly reminder that the fee voucher for <strong>${escapeHtml(row.studentName)}</strong>
          ${className ? `(${escapeHtml(className)})` : ''} for <strong>${escapeHtml(monthLabel(row.month))}</strong>
          is still awaiting payment. Our records show a balance of <strong>${fmt(row.balance)}</strong>.</p>

        <table>
          <tr><th>Voucher No</th><td>${escapeHtml(row.voucherNo)}</td><th>Due Date</th><td>${escapeHtml(row.dueDate || '-')}</td></tr>
          <tr><th>Total fee</th><td>${fmt(row.totalAmount)}</td><th>Discount</th><td>${fmt(row.discount)}</td></tr>
          <tr><th>Late fine</th><td>${fmt(row.lateFine)}</td><th>Already paid</th><td>${fmt(row.paidAmount)}</td></tr>
          <tr class="balance"><th>Balance payable</th><td colspan="3">${fmt(row.balance)}</td></tr>
        </table>

        <p class="ask">Please pay the outstanding amount at the school office at your earliest convenience, or contact us if you have any questions about this voucher.</p>
        <p class="note">If you have already made this payment, kindly ignore this notice and accept our thanks.</p>

        <div class="sign">
          <span>_______________________<br />Accounts Office</span>
          <span>_______________________<br />Parent / Guardian</span>
        </div>
        ${school.footer ? `<div class="foot">${escapeHtml(school.footer)}</div>` : ''}
      </article>`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; }
    .letter { padding: 26px 30px; page-break-after: always; min-height: 250mm; display: flex; flex-direction: column; }
    .letter:last-child { page-break-after: auto; }
    header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4c7df0; padding-bottom: 10px; }
    .school { font-size: 19px; font-weight: 700; }
    .addr { font-size: 11px; color: #475569; margin-top: 2px; }
    .logo { width: 58px; height: 58px; object-fit: contain; }
    .title-row { display: flex; justify-content: space-between; align-items: baseline; margin: 22px 0 14px; }
    h1 { font-size: 20px; margin: 0; letter-spacing: .02em; }
    .date { font-size: 12px; color: #64748b; }
    p { font-size: 13px; line-height: 1.65; margin: 0 0 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 16px 0; }
    th { background: #eef2ff; text-align: left; padding: 7px 9px; border: 1px solid #dbe3f5; font-weight: 600; width: 20%; }
    td { padding: 7px 9px; border: 1px solid #e2e8f0; }
    tr.balance th, tr.balance td { background: #f5f8ff; font-size: 13px; font-weight: 700; color: #1d4ed8; }
    .ask { margin-top: 18px; }
    .note { color: #64748b; font-size: 11.5px; }
    .sign { margin-top: auto; padding-top: 60px; display: flex; justify-content: space-between; font-size: 11px; color: #475569; }
    .foot { margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 10px; color: #94a3b8; }
  </style></head><body>${letters || '<p>No defaulters found</p>'}</body></html>`;
}

module.exports = { registerFeesIpc };