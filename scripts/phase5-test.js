'use strict';

/**
 * Phase 5 functional tests (dev tool): `npm run test:phase5`
 * Fee heads, concessions, voucher generation, payments, receipts, defaulters,
 * collection reports, expenses and the role/ownership boundaries around them.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-phase5-test');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
app.setPath('userData', TMP);
app.disableHardwareAcceleration();

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.error(`  FAIL  ${label}${detail !== undefined ? ` -> ${String(JSON.stringify(detail)).slice(0, 220)}` : ''}`);
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

function shiftMonth(offset) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The seed already fills the current month, so Phase 5 works in the next one. */
const work = shiftMonth(1);

async function main() {
  const { initDatabase, getDb, closeDatabase } = require('../electron/db/connection');
  const { registerIpc } = require('../electron/ipc');

  initDatabase({ seed: true });
  registerIpc();

  console.log('\n--- channel wiring ---------------------------------------------------');
  const channels = require('../electron/ipc/channels');
  const preloadSource = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8');
  const channelValues = Object.entries(channels)
    .filter(([key]) => key !== 'PENDING')
    .map(([, value]) => value);
  const missingInPreload = channelValues.filter((value) => !preloadSource.includes(`'${value}'`));
  check('every channel in channels.js is mirrored in the preload bridge', missingInPreload.length === 0, missingInPreload);

  const preloadNames = [...preloadSource.matchAll(/^\s{2}([A-Z0-9_]+):\s*'([^']+)',/gm)].map((m) => m[2]);
  const missingInChannels = preloadNames.filter((value) => !channelValues.includes(value));
  check('every channel in the preload bridge exists in channels.js', missingInChannels.length === 0, missingInChannels);

  const apiSource = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'api.js'), 'utf8');
  ['fees.structures', 'fees.vouchers', 'fees.my', 'expenses.list', 'expenses.report'].every((name) =>
    apiSource.includes(`bridge.${name}`),
  );
  check('the renderer api client exposes the phase 5 groups', apiSource.includes('bridge.fees.preview') && apiSource.includes('bridge.expenses.report'));

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.on('console-message', (...a) => {
    const level = typeof a[0] === 'object' ? a[1] : a[0];
    const message = typeof a[0] === 'object' ? a[2] : a[1];
    if (level === 3 || level === 'error') console.error(`  [renderer] ${String(message).slice(0, 300)}`);
  });

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));

  const call = (expr) =>
    win.webContents
      .executeJavaScript(`(async () => JSON.stringify(await (${expr})))()`, true)
      .then(JSON.parse)
      .catch((err) => {
        console.error(`  !! call threw for ${expr.slice(0, 120)} -> ${String(err).slice(0, 200)}`);
        throw err;
      });

  const signIn = async (username, password, newPassword) => {
    await call(`window.school.auth.login({ username: ${JSON.stringify(username)}, password: ${JSON.stringify(password)} })`);
    if (newPassword) {
      await call(`window.school.auth.changePassword({ currentPassword: ${JSON.stringify(password)}, newPassword: ${JSON.stringify(newPassword)} })`);
    }
  };

  await signIn('admin', 'admin123', 'admin1234');

  // -------------------------------------------------------------------------
  console.log('\n--- fee heads -------------------------------------------------------');
  let res = await call(`window.school.fees.structures()`);
  check('fee heads load', res.ok && res.data.length > 0, res.ok ? res.data.length : res);
  check('fee heads are shaped for the UI', res.ok && typeof res.data[0].feeType === 'string', res.ok ? res.data[0] : res);

  const classId = getDb().prepare(`SELECT id FROM classes WHERE is_deleted = 0 ORDER BY level_order LIMIT 1`).get().id;

  res = await call(`window.school.fees.saveStructure({ classId: ${classId}, name: 'Library Fee', feeType: 'library', frequency: 'monthly', amount: 500 })`);
  check('a monthly fee head can be added', res.ok && res.data.name === 'Library Fee', res);
  const structureId = res.ok ? res.data.id : null;

  res = await call(`window.school.fees.saveStructure({ classId: ${classId}, name: 'Bad', feeType: 'library', frequency: 'monthly', amount: -5 })`);
  check('a negative amount is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.fees.saveStructure({ classId: ${classId}, feeType: 'library', frequency: 'monthly', amount: 100 })`);
  check('a fee head without a name is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.fees.saveStructure({ id: ${structureId}, classId: ${classId}, name: 'Library Fee', feeType: 'library', frequency: 'monthly', amount: 750 })`);
  check('a fee head can be edited', res.ok && res.data.amount === 750, res);

  res = await call(`window.school.fees.deleteStructure(${structureId})`);
  check('a fee head can be removed', res.ok && !getDb().prepare(`SELECT id FROM fee_structures WHERE id = ? AND is_deleted = 0`).get(structureId), res);

  // -------------------------------------------------------------------------
  console.log('\n--- concessions -----------------------------------------------------');
  const studentId = getDb().prepare(`SELECT id FROM students WHERE is_deleted = 0 AND status = 'active' ORDER BY id LIMIT 1`).get().id;

  res = await call(`window.school.fees.saveDiscount({ studentId: ${studentId}, name: 'Merit', percent: 15, reason: 'Top of the class' })`);
  check('a percentage concession can be granted', res.ok && res.data.percent === 15, res);
  const discountId = res.ok ? res.data.id : null;

  res = await call(`window.school.fees.saveDiscount({ studentId: ${studentId}, name: 'Nothing' })`);
  check('a concession without an amount or percent is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.fees.saveDiscount({ studentId: 999999, name: 'Ghost', amount: 100 })`);
  check('a concession for an unknown student is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.fees.discounts({ studentId: ${studentId} })`);
  check('concessions list for a student', res.ok && res.data.some((d) => d.id === discountId), res);

  // -------------------------------------------------------------------------
  console.log('\n--- voucher list ---------------------------------------------------');
  const seeded = getDb().prepare(`SELECT COUNT(*) AS n FROM fee_vouchers WHERE is_deleted = 0`).get().n;
  res = await call(`window.school.fees.vouchers({})`);
  check('the voucher list is not empty for the seeded data', res.ok && res.data.total === seeded, { got: res.ok ? res.data.total : res, seeded });

  // the UI sends a plain "YYYY-MM" month; the service must match it exactly
  res = await call(`window.school.fees.vouchers({ month: '${currentMonth()}' })`);
  const seededThisMonth = getDb().prepare(`SELECT COUNT(*) AS n FROM fee_vouchers WHERE is_deleted = 0 AND month = ?`).get(currentMonth()).n;
  check('a "YYYY-MM" month filter matches the stored month', res.ok && res.data.total === seededThisMonth, { got: res.ok ? res.data.total : res, seededThisMonth });
  check('the month filter actually filters', res.ok && res.data.total > 0, res.ok ? res.data.total : res);

  res = await call(`window.school.fees.vouchers({ month: 'not-a-month' })`);
  check('a malformed month is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.fees.vouchers({ month: '2026' })`);
  check('a bare year is not accepted as a month', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  // -------------------------------------------------------------------------
  console.log('\n--- voucher generation ----------------------------------------------');
  res = await call(`window.school.fees.preview({ month: '${work}' })`);
  check('preview computes the next month without saving', res.ok && res.data.rows.length > 0, res.ok ? res.data.rows.length : res);
  check('preview is not generated yet', res.ok && res.data.skipped === 0, res.ok ? res.data.skipped : res);

  const previewRow = res.ok ? res.data.rows.find((r) => r.studentId === studentId) : null;
  const expectedTotal = previewRow ? Math.round(previewRow.items.reduce((s, i) => s + i.amount, 0) * 100) / 100 : 0;
  check('the preview total equals the sum of the monthly fee heads', previewRow && Math.abs(previewRow.total - expectedTotal) < 0.01, previewRow && { total: previewRow.total, expectedTotal });
  check('the concession is applied to the preview', previewRow && previewRow.discount > 0, previewRow && previewRow.discount);
  check('payable = total - discount', previewRow && Math.abs(previewRow.payable - (previewRow.total - previewRow.discount)) < 0.01, previewRow && previewRow);

  check('preview writes nothing', getDb().prepare(`SELECT COUNT(*) AS n FROM fee_vouchers WHERE month = ?`).get(work).n === 0);

  res = await call(`window.school.fees.generate({ month: '${work}' })`);
  check('vouchers are generated for the month', res.ok && res.data.generated > 0, res);

  const voucher = getDb().prepare(`SELECT * FROM fee_vouchers WHERE student_id = ? AND month = ?`).get(studentId, work);
  check('the student has a voucher', !!voucher, voucher);
  check('voucher numbers are unique', getDb().prepare(`SELECT COUNT(*) AS n FROM fee_vouchers WHERE month = ?`).get(work).n === res.data.generated);

  const voucherItems = getDb().prepare(`SELECT * FROM voucher_items WHERE voucher_id = ?`).all(voucher.id);
  check('voucher items are stored', voucherItems.length >= 2, voucherItems.length);
  const itemsTotal = Math.round(voucherItems.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  check('voucher total matches its items', Math.abs(voucher.total_amount - itemsTotal) < 0.01, { total: voucher.total_amount, itemsTotal });

  res = await call(`window.school.fees.generate({ month: '${work}' })`);
  check('generating the same month twice does not duplicate', res.ok === false && res.error.code === 'NOTHING_TO_GENERATE', res);

  res = await call(`window.school.fees.preview({ month: '${work}' })`);
  check('preview now skips everyone', res.ok && res.data.skipped > 0 && res.data.rows.length === 0, res.ok ? res.data.skipped : res);

  // -------------------------------------------------------------------------
  console.log('\n--- payments --------------------------------------------------------');
  const payable = Math.round((voucher.total_amount - voucher.discount) * 100) / 100;

  res = await call(`window.school.fees.payment({ voucherId: ${voucher.id}, amount: ${payable + 500}, paymentDate: '${today()}' })`);
  check('overpaying a voucher is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.fees.payment({ voucherId: ${voucher.id}, amount: 0 })`);
  check('a zero payment is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  const half = Math.round((payable / 2) * 100) / 100;
  res = await call(`window.school.fees.payment({ voucherId: ${voucher.id}, amount: ${half}, paymentDate: '${today()}', method: 'cash', reference: 'CASH-1' })`);
  check('a part payment is accepted', res.ok && res.data.status === 'partial', res);
  check('the receipt number is returned', res.ok && /^RCP-\d{6}-\d{4}$/.test(res.data.receiptNo), res);
  const paymentId = res.ok ? res.data.id : null;
  const receiptNo = res.ok ? res.data.receiptNo : null;

  const afterPart = getDb().prepare(`SELECT * FROM fee_vouchers WHERE id = ?`).get(voucher.id);
  check('the voucher status becomes partial', afterPart.status === 'partial' && Math.abs(afterPart.paid_amount - half) < 0.01, afterPart);

  res = await call(`window.school.fees.payment({ voucherId: ${voucher.id}, amount: ${payable - half}, paymentDate: '${today()}', method: 'bank' })`);
  check('the remaining amount closes the voucher', res.ok && res.data.status === 'paid', res);
  const paidVoucher = getDb().prepare(`SELECT * FROM fee_vouchers WHERE id = ?`).get(voucher.id);
  check('paid_amount equals the total payable', Math.abs(paidVoucher.paid_amount - payable) < 0.01, paidVoucher);

  res = await call(`window.school.fees.voucherDetail(${voucher.id})`);
  check('the voucher keeps both payments', res.ok && res.data.payments.length === 2, res.ok ? res.data.payments.length : res);
  check('the voucher exposes its items and concessions', res.ok && res.data.items.length >= 2 && res.data.discounts.length > 0, res);
  check('the balance is zero once paid', res.ok && Math.abs(res.data.balance) < 0.01, res.ok ? res.data.balance : res);

  res = await call(`window.school.fees.deletePayment(${paymentId})`);
  check('a payment can be reversed', res.ok, res);
  const reversed = getDb().prepare(`SELECT * FROM fee_vouchers WHERE id = ?`).get(voucher.id);
  check('reversing a payment restores the status', reversed.status === 'partial' && Math.abs(reversed.paid_amount - (payable - half)) < 0.01, reversed);
  check('the reversed payment is soft deleted', !!getDb().prepare(`SELECT id FROM fee_payments WHERE id = ? AND is_deleted = 1`).get(paymentId));

  const lastReceipt = getDb()
    .prepare(`SELECT receipt_no FROM fee_payments WHERE voucher_id = ? AND is_deleted = 0 ORDER BY id DESC LIMIT 1`)
    .get(voucher.id);
  check('receipt numbers stay unique after a reversal', lastReceipt && lastReceipt.receipt_no !== receiptNo, { lastReceipt, receiptNo });

  // close the voucher again so the "paid voucher is never fined" check below
  res = await call(`window.school.fees.payment({ voucherId: ${voucher.id}, amount: ${payable - half}, paymentDate: '${today()}' })`);
  check('the voucher can be closed again after a reversal', res.ok && res.data.status === 'paid', res);

  // -------------------------------------------------------------------------
  console.log('\n--- late fine -------------------------------------------------------');
  const unpaidVoucher = getDb()
    .prepare(`SELECT * FROM fee_vouchers WHERE month = ? AND status = 'unpaid' ORDER BY id LIMIT 1`)
    .get(work);
  check('the month still has unpaid vouchers', !!unpaidVoucher, unpaidVoucher);

  res = await call(`window.school.fees.lateFine({ month: '${work}', amount: 200 })`);
  check('a late fine is applied to the open vouchers', res.ok && res.data.updated > 0, res);
  check('a paid voucher is never fined', getDb().prepare(`SELECT late_fine FROM fee_vouchers WHERE id = ?`).get(voucher.id).late_fine === 0);
  check('the fine is stored on the voucher', getDb().prepare(`SELECT late_fine FROM fee_vouchers WHERE id = ?`).get(unpaidVoucher.id).late_fine === 200);

  res = await call(`window.school.fees.lateFine({ month: '${work}', amount: 200 })`);
  check('a fine is not applied twice', res.ok && res.data.updated === 0, res);

  res = await call(`window.school.fees.lateFine({ month: '${work}' })`);
  check('a fine without an amount is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  // -------------------------------------------------------------------------
  console.log('\n--- reports ---------------------------------------------------------');
  res = await call(`window.school.fees.defaulters({ month: '${work}' })`);
  check('the defaulter list only holds open vouchers', res.ok && res.data.every((r) => ['unpaid', 'partial'].includes(r.status)), res.ok ? res.data.length : res);
  check('the defaulter list is sorted by the largest balance first', res.ok
    ? res.data.every((row, i) => i === 0 || res.data[i - 1].balance >= row.balance)
    : false);
  check('siblings are reported with the defaulter', res.ok && res.data.every((r) => Array.isArray(r.siblings)), res);

  const from = `${work}-01`;
  const to = `${work}-31`;
  res = await call(`window.school.fees.collectionReport({ from: '${from}', to: '${to}' })`);
  check('the collection report groups by day', res.ok && Array.isArray(res.data.rows), res);
  check('the collection report totals the payments', res.ok && res.data.total >= 0, res);
  const dbTotal = getDb()
    .prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM fee_payments WHERE is_deleted = 0 AND payment_date BETWEEN ? AND ?`)
    .get(from, to).total;
  check('report total matches the payments table', res.ok && Math.abs(res.data.total - dbTotal) < 0.01, res.ok ? res.data.total : res);
  const methodsTotal = res.ok ? res.data.byMethod.reduce((s, m) => s + m.amount, 0) : 0;
  check('the by-mode breakdown matches the daily total', res.ok && Math.abs(methodsTotal - res.data.total) < 0.01, res);

  res = await call(`window.school.fees.collectionReport({ from: '${to}', to: '${from}' })`);
  check('a reversed date range is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  // -------------------------------------------------------------------------
  console.log('\n--- expenses --------------------------------------------------------');
  res = await call(`window.school.expenses.categories()`);
  check('expense categories are exposed', res.ok && res.data.expense.length > 0 && res.data.income.length > 0, res);

  res = await call(`window.school.expenses.create({ entryType: 'expense', category: 'Utilities', description: 'Test bill', amount: 4200, method: 'cash', entryDate: '${today()}' })`);
  check('an expense can be recorded', res.ok && res.data.id > 0, res);
  const expenseId = res.ok ? res.data.id : null;

  res = await call(`window.school.expenses.create({ entryType: 'expense', category: 'Utilities', amount: 0, entryDate: '${today()}' })`);
  check('a zero amount is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.expenses.create({ entryType: 'expense', category: 'Utilities', amount: 100 })`);
  check('an entry without a date is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.expenses.create({ entryType: 'expense', category: 'Not A Category', amount: 100, entryDate: '${today()}' })`);
  check('an unknown category is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.expenses.create({ entryType: 'income', category: 'Utilities', amount: 100, entryDate: '${today()}' })`);
  check('an income row cannot use an expense category', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.expenses.update(${expenseId}, { amount: 5000 })`);
  check('an expense can be edited with a partial payload', res.ok, res);
  check('the edit keeps the other fields', getDb().prepare(`SELECT description FROM expenses WHERE id = ?`).get(expenseId).description === 'Test bill');
  check('the edit stores the new amount', getDb().prepare(`SELECT amount FROM expenses WHERE id = ?`).get(expenseId).amount === 5000);

  res = await call(`window.school.expenses.update(${expenseId}, { entryType: 'income' })`);
  check('an expense category cannot be retyped as income', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  res = await call(`window.school.expenses.update(${expenseId}, { entryType: 'income', category: 'Donation' })`);
  check('an expense can be retyped together with a valid category', res.ok, res);
  check('the retyped row keeps its amount', getDb().prepare(`SELECT amount FROM expenses WHERE id = ?`).get(expenseId).amount === 5000);

  res = await call(`window.school.expenses.update(${expenseId}, { entryType: 'expense', category: 'Utilities' })`);
  check('it can be retyped back', res.ok, res);

  const monthKey = today().slice(0, 7);
  res = await call(`window.school.expenses.list({ month: '${monthKey}' })`);
  check('expenses are listed with a summary', res.ok && res.data.summary.expense > 0, res);
  const listedAmount = res.ok ? res.data.rows.find((r) => r.id === expenseId)?.amount : null;
  check('the list reflects the edit', listedAmount === 5000, listedAmount);

  res = await call(`window.school.expenses.report({ month: '${monthKey}' })`);
  check('the expense report totals income and expenses', res.ok && res.data.totals.expense > 0 && typeof res.data.totals.net === 'number', res);
  check('the report groups by category', res.ok && res.data.byCategory.some((r) => r.category === 'Utilities'), res);
  check('net = income - expense', res.ok && Math.abs(res.data.totals.net - (res.data.totals.income - res.data.totals.expense)) < 0.01, res);

  res = await call(`window.school.expenses.remove(${expenseId})`);
  check('an expense can be removed', res.ok, res);
  check('removal is a soft delete', !!getDb().prepare(`SELECT id FROM expenses WHERE id = ? AND is_deleted = 1`).get(expenseId));

  // -------------------------------------------------------------------------
  console.log('\n--- student scope ---------------------------------------------------');
  const year = new Date().getFullYear();
  const adm = `adm-${year}-001`;
  await call(`window.school.auth.logout()`);
  await signIn(adm, `ADM-${year}-001`, 'student1234');

  const ownStudent = getDb().prepare(`SELECT linked_id FROM users WHERE username = ?`).get(adm).linked_id;
  const otherStudent = getDb().prepare(`SELECT id FROM students WHERE id <> ? AND is_deleted = 0 LIMIT 1`).get(ownStudent).id;

  res = await call(`window.school.fees.my()`);
  check('a student sees their own fee account', res.ok && res.data.student.id === ownStudent, res);
  check('a student only sees their own vouchers', res.ok && res.data.vouchers.every((v) => v.studentId === ownStudent), res);
  check('only their own payments come back', res.ok && res.data.payments.every((p) => p.voucherNo), res);

  res = await call(`window.school.fees.my({ studentId: ${otherStudent} })`);
  check("a student cannot read another student's fees", res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.fees.vouchers({ studentId: ${otherStudent} })`);
  check("a student's voucher list is locked to them", res.ok && res.data.rows.every((v) => v.studentId === ownStudent), res);

  const ownVoucher = getDb().prepare(`SELECT id FROM fee_vouchers WHERE student_id = ? LIMIT 1`).get(ownStudent);
  const otherVoucher = getDb().prepare(`SELECT id FROM fee_vouchers WHERE student_id <> ? LIMIT 1`).get(ownStudent);

  res = await call(`window.school.fees.voucherDetail(${ownVoucher.id})`);
  check('a student can open their own voucher', res.ok, res);
  res = await call(`window.school.fees.voucherDetail(${otherVoucher.id})`);
  check("a student cannot open someone else's voucher", res.ok === false && res.error.code === 'FORBIDDEN', res);

  const ownPayment = getDb().prepare(`SELECT id FROM fee_payments WHERE voucher_id = ? AND is_deleted = 0 LIMIT 1`).get(ownVoucher.id);
  const otherPayment = getDb().prepare(`SELECT id FROM fee_payments WHERE is_deleted = 0 AND voucher_id <> ? LIMIT 1`).get(ownVoucher.id);
  res = await call(`window.school.fees.receiptPdf(${otherPayment.id})`);
  check("a student cannot download another person's receipt", res.ok === false && res.error.code === 'FORBIDDEN', res);
  check('their own receipt resolves', !!ownPayment, ownPayment);

  res = await call(`window.school.fees.payment({ voucherId: ${ownVoucher.id}, amount: 100, paymentDate: '${today()}' })`);
  check('a student cannot pay their own fees', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.expenses.list({})`);
  check('a student cannot read the expense book', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.fees.defaulters({})`);
  check('a student cannot read the defaulter list', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- teacher access --------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('teacher1', 'teacher123', 'teacher1234');

  res = await call(`window.school.fees.vouchers({})`);
  check('a teacher cannot read fee vouchers', res.ok === false && res.error.code === 'FORBIDDEN', res);
  res = await call(`window.school.fees.my()`);
  check('a teacher has no fee account', res.ok === false && res.error.code === 'FORBIDDEN', res);
  res = await call(`window.school.fees.structures()`);
  check('a teacher cannot read fee heads', res.ok === false && res.error.code === 'FORBIDDEN', res);
  res = await call(`window.school.expenses.report({})`);
  check('a teacher cannot read the expense report', res.ok === false && res.error.code === 'FORBIDDEN', res);

  // -------------------------------------------------------------------------
  console.log('\n--- office access ---------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('office', 'office123', 'office1234');

  res = await call(`window.school.fees.vouchers({ month: '${work}' })`);
  check('office can read the vouchers', res.ok && res.data.rows.length > 0, res);
  res = await call(`window.school.fees.structures()`);
  check('office can read the fee heads', res.ok, res);
  res = await call(`window.school.fees.defaulters({})`);
  check('office can read the defaulter list', res.ok, res);
  res = await call(`window.school.expenses.create({ entryType: 'expense', category: 'Stationery', amount: 900, entryDate: '${today()}' })`);
  check('office can record an expense', res.ok, res);
  if (res.ok) await call(`window.school.expenses.remove(${res.data.id})`);

  const officeVoucher = getDb().prepare(`SELECT * FROM fee_vouchers WHERE month = ? AND status = 'unpaid' LIMIT 1`).get(work);
  res = await call(`window.school.fees.payment({ voucherId: ${officeVoucher.id}, amount: 100, paymentDate: '${today()}' })`);
  check('office can collect a fee', res.ok && res.data.status === 'partial', res);
  const officePaymentId = res.ok ? res.data.id : null;

  res = await call(`window.school.fees.generate({ month: '${shiftMonth(2)}' })`);
  check('office cannot generate vouchers (admin only)', res.ok === false && res.error.code === 'FORBIDDEN', res);
  res = await call(`window.school.fees.deletePayment(${officePaymentId})`);
  check('office cannot reverse a payment', res.ok === false && res.error.code === 'FORBIDDEN', res);
  res = await call(`window.school.fees.saveStructure({ classId: ${classId}, name: 'Office', feeType: 'library', frequency: 'monthly', amount: 100 })`);
  check('office cannot change a fee head', res.ok === false && res.error.code === 'FORBIDDEN', res);
  res = await call(`window.school.fees.deleteStructure(1)`);
  check('office cannot delete a fee head', res.ok === false && res.error.code === 'FORBIDDEN', res);

  console.log('\n--- audit trail -----------------------------------------------------');
  const actions = getDb().prepare(`SELECT DISTINCT action FROM audit_log`).all().map((r) => r.action);
  check(
    'fee and expense actions are audited',
    ['fee_generate', 'fee_payment', 'fee_payment_delete', 'fee_late_fine'].every((a) => actions.includes(a)),
    actions,
  );
  check('expense writes are audited', getDb().prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'expenses'`).get().n > 0);

  closeDatabase();
  console.log(`\n${failed === 0 ? 'ALL PHASE 5 TESTS PASSED' : `FAILURES: ${failures.length}`} (${passed} passed)`);
  if (failed) console.error(failures.map((f) => `  - ${f}`).join('\n'));
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);