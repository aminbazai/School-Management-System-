'use strict';

/**
 * Phase 4 functional tests (dev tool): `npm run test:phase4`
 * Salary structures, payroll computation and generation, advances, slips.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-phase4-test');

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

const month = new Date().toISOString().slice(0, 7);
const lastMonth = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
})();

async function main() {
  const { initDatabase, getDb, closeDatabase } = require('../electron/db/connection');
  const { registerIpc } = require('../electron/ipc');

  initDatabase({ seed: true });
  registerIpc();

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  const call = (expr) =>
    win.webContents.executeJavaScript(`(async () => JSON.stringify(await (${expr})))()`, true).then(JSON.parse);

  const signIn = async (username, password, newPassword) => {
    await call(`window.school.auth.login({ username: ${JSON.stringify(username)}, password: ${JSON.stringify(password)} })`);
    if (newPassword) {
      await call(`window.school.auth.changePassword({ currentPassword: ${JSON.stringify(password)}, newPassword: ${JSON.stringify(newPassword)} })`);
    }
  };

  await signIn('admin', 'admin123', 'admin1234');
  const staff = getDb().prepare(`SELECT id, name FROM staff WHERE staff_type = 'teacher' AND is_deleted = 0 LIMIT 1`).get();
  const staffId = staff.id;

  // -------------------------------------------------------------------------
  console.log('\n--- salary structure ------------------------------------------------');
  let res = await call(`window.school.salary.structure({ staffId: ${staffId} })`);
  check('structure loads with seeded allowances', res.ok && res.data.allowances.length >= 3, res.ok ? res.data.allowances.length : res);
  check('structure exposes basic salary', res.ok && res.data.staff.basicSalary > 0, res.ok ? res.data.staff : res);

  res = await call(`window.school.salary.saveBasic({ staffId: ${staffId}, basicSalary: 60000, effectiveFrom: '${month}-01' })`);
  check('basic salary can be changed', res.ok && res.data.staff.basicSalary === 60000, res);

  res = await call(`window.school.salary.saveAllowance({ staffId: ${staffId}, name: 'Fuel Card', kind: 'fuel', amount: 3000 })`);
  check('allowance can be added', res.ok && res.data.allowances.some((a) => a.name === 'Fuel Card'), res);

  res = await call(`window.school.salary.saveAllowance({ staffId: ${staffId}, name: 'Special', kind: 'special', amount: 10, isPercent: true })`);
  check('percentage allowance can be added', res.ok && res.data.allowances.some((a) => a.is_percent === 1), res);

  res = await call(`window.school.salary.saveAllowance({ name: 'No Staff' })`);
  check('allowance without a staff member is rejected', res.ok === false && res.error.code === 'VALIDATION_FAILED', res);

  const customAllowance = getDb().prepare(`SELECT id FROM allowances WHERE staff_id = ? AND name = 'Fuel Card'`).get(staffId).id;
  res = await call(`window.school.salary.deleteAllowance(${customAllowance})`);
  check('allowance can be removed', res.ok && !res.data.allowances.some((a) => a.name === 'Fuel Card'), res);

  console.log('\n--- payroll computation ----------------------------------------------');
  res = await call(`window.school.salary.preview({ month: '${month}' })`);
  check('preview computes rows without saving', res.ok && res.data.rows.length > 0, res.ok ? res.data.rows.length : res);
  check('preview is marked as not generated', res.ok && res.data.skipped === 0, res.ok ? res.data.skipped : res);

  const mine = res.ok ? res.data.rows.find((r) => r.staff.id === staffId) : null;
  const basic = 60000;
  check('basic salary is carried into the payroll', mine && mine.basic === basic, mine && mine.basic);

  // expected = every allowance row resolved the same way the service does
  const allowanceRows = getDb()
    .prepare(`SELECT name, amount, is_percent FROM allowances WHERE staff_id = ? AND is_active = 1`)
    .all(staffId);
  const expectedAllowances = Math.round(
    allowanceRows.reduce((sum, row) => sum + (row.is_percent ? (basic * row.amount) / 100 : row.amount), 0) * 100,
  ) / 100;
  check('percentage allowance is applied to the basic salary', mine
    && Math.abs(mine.allowancesTotal - expectedAllowances) < 0.01,
    mine && { got: mine.allowancesTotal, expected: expectedAllowances });
  check('gross = basic + allowances', mine && Math.abs(mine.gross - (basic + mine.allowancesTotal)) < 0.01, mine && mine.gross);

  const absent = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM staff_attendance WHERE staff_id = ? AND substr(date,1,7) = ? AND status = 'absent'`)
    .get(staffId, month).n;
  const perDay = getDb().prepare(`SELECT value FROM settings WHERE key = 'absent_deduction_per_day'`).get()?.value;
  check('attendance is read into the payroll', mine && mine.attendance.absent === absent, mine && { absent: mine.attendance.absent, db: absent });

  if (Number(perDay) > 0) {
    check(
      'absent-day deduction is applied',
      mine && mine.deductionItems.some((d) => d.kind === 'absent'),
      mine && mine.deductionItems,
    );
  }

  console.log('\n--- advances --------------------------------------------------------');
  res = await call(`window.school.salary.addAdvance({ staffId: ${staffId}, amount: 12000, advanceDate: '${month}-05', installments: 3, notes: 'Family' })`);
  const advanceId = res.ok ? res.data.id : null;
  check('advance is recorded with installments', res.ok && res.data.installment_amount === 4000, res);

  res = await call(`window.school.salary.preview({ month: '${month}' })`);
  const withAdvance = res.ok ? res.data.rows.find((r) => r.staff.id === staffId) : null;
  check('one installment is deducted from the first month', withAdvance && withAdvance.advanceRecovery === 4000, withAdvance && withAdvance.advanceRecovery);

  console.log('\n--- generation ------------------------------------------------------');
  res = await call(`window.school.salary.generate({ month: '${month}' })`);
  check('payroll is generated for the month', res.ok && res.data.length > 0, res.ok ? res.data.length : res);

  const payrollRow = getDb().prepare(`SELECT * FROM payroll WHERE staff_id = ? AND month = ?`).get(staffId, month);
  check('payroll row stores gross/net', payrollRow && payrollRow.gross > 0 && payrollRow.net > 0, payrollRow);
  check('net = gross - deductions - advance', payrollRow
    && Math.abs(payrollRow.net - (payrollRow.gross - payrollRow.deductions_total - payrollRow.advance_recovery)) < 0.01, payrollRow);

  const items = getDb().prepare(`SELECT * FROM payroll_items WHERE payroll_id = ?`).all(payrollRow.id);
  check('payslip items are stored', items.length >= 3, items.length);
  check('earnings and deductions are itemised', items.some((i) => i.kind === 'earning') && items.some((i) => i.kind === 'deduction'));

  const advanceAfter = getDb().prepare(`SELECT * FROM advances WHERE id = ?`).get(advanceId);
  check('advance recovered amount is tracked', Math.abs(advanceAfter.recovered - 4000) < 0.01, advanceAfter);

  res = await call(`window.school.salary.generate({ month: '${month}' })`);
  check('generating twice does not duplicate', res.ok === false && res.error.code === 'NOTHING_TO_GENERATE', res);

  res = await call(`window.school.salary.preview({ month: '${month}' })`);
  check('preview skips already generated staff', res.ok && res.data.skipped > 0, res.ok ? res.data.skipped : res);

  console.log('\n--- payslips ---------------------------------------------------------');
  res = await call(`window.school.salary.detail(${payrollRow.id})`);
  check('payslip detail returns items', res.ok && res.data.items.length >= 3, res);
  check('payslip carries the attendance summary', res.ok && typeof res.data.presentDays === 'number', res.ok ? res.data.presentDays : res);

  res = await call(`window.school.salary.markPaid({ id: ${payrollRow.id}, paymentMethod: 'bank', reference: 'TRX-99' })`);
  check('payslip can be marked paid', res.ok && res.data.status === 'paid' && res.data.paidDate, res);

  res = await call(`window.school.salary.markPaid({ id: ${payrollRow.id} })`);
  check('a paid payslip cannot be paid again', res.ok === false && res.error.code === 'ALREADY_PAID', res);

  res = await call(`window.school.salary.remove(${payrollRow.id})`);
  check('a paid payslip cannot be deleted', res.ok === false && res.error.code === 'ALREADY_PAID', res);

  console.log('\n--- teacher access ---------------------------------------------------');
  const teacherStaff = getDb().prepare(`SELECT linked_id FROM users WHERE username = 'teacher1'`).get().linked_id;
  await call(`window.school.auth.logout()`);
  await signIn('teacher1', 'teacher123', 'teacher1234');

  res = await call(`window.school.salary.mySlips()`);
  check('teacher sees their own payslips', res.ok && res.data.every((r) => r.staffId === teacherStaff), res.ok ? res.data.length : res);
  check('teacher does not see other payslips', res.ok && !res.data.some((r) => r.staffId !== teacherStaff), res.ok ? res.data.length : res);

  res = await call(`window.school.salary.list({})`);
  check('teacher list is scoped to themselves', res.ok && res.data.every((r) => r.staffId === teacherStaff), res.ok ? res.data.length : res);

  res = await call(`window.school.salary.generate({ month: '${month}' })`);
  check('teacher cannot generate payroll', res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.salary.markPaid({ id: ${payrollRow.id} })`);
  check('teacher cannot mark a payslip paid', res.ok === false && res.error.code === 'FORBIDDEN', res);

  const otherPayrollId = getDb()
    .prepare(`SELECT p.id FROM payroll p WHERE p.staff_id <> ? LIMIT 1`)
    .get(teacherStaff)?.id;
  res = await call(`window.school.salary.detail(${otherPayrollId ?? '0'})`);
  check("teacher cannot open another member's payslip", res.ok === false && res.error.code === 'FORBIDDEN', res);

  res = await call(`window.school.salary.saveBasic({ staffId: ${staffId}, basicSalary: 1 })`);
  check('teacher cannot change a salary structure', res.ok === false && res.error.code === 'FORBIDDEN', res);

  console.log('\n--- office access ----------------------------------------------------');
  await call(`window.school.auth.logout()`);
  await signIn('office', 'office123', 'office1234');

  res = await call(`window.school.salary.list({ month: '${month}' })`);
  check('office can read the payroll', res.ok && Array.isArray(res.data), res);
  res = await call(`window.school.salary.preview({ month: '${lastMonth}' })`);
  check('office can preview a payroll', res.ok === true, res);
  res = await call(`window.school.salary.generate({ month: '${lastMonth}' })`);
  check('office cannot generate payroll (admin only)', res.ok === false && res.error.code === 'FORBIDDEN', res);

  closeDatabase();
  console.log(`\n${failed === 0 ? 'ALL PHASE 4 TESTS PASSED' : `FAILURES: ${failures.length}`} (${passed} passed)`);
  if (failed) console.error(failures.map((f) => `  - ${f}`).join('\n'));
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);