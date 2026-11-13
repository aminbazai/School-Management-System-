'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');
const acl = require('./acl.service');
const settings = require('./settings.service');

/**
 * Salary management: structures, allowances, deductions, advances, monthly
 * payroll generation and the numbers behind the salary slip.
 *
 * Calculation order (also printed on the slip):
 *   gross        = basic + allowances
 *   deductions   = static rows + attendance deductions (absent/late)
 *   net          = gross - deductions - advance recovery + bonus
 */

const ALLOWANCE_KINDS = ['house', 'medical', 'transport', 'fuel', 'special', 'custom'];
const DEDUCTION_KINDS = ['absent', 'late', 'tax', 'pf', 'insurance', 'custom'];

const itemSpec = (kinds) => ({
  staffId: helpers.int({ min: 1, required: true }),
  name: helpers.text({ min: 1, max: 60 }),
  kind: helpers.enum(kinds, { default: 'custom' }),
  amount: helpers.number({ min: 0, max: 10000000 }),
  isPercent: helpers.bool({ default: false }),
});

const ALLOWANCE_SPEC = itemSpec(ALLOWANCE_KINDS);

const DEDUCTION_SPEC = itemSpec(DEDUCTION_KINDS);

const ADVANCE_SPEC = {
  staffId: helpers.int({ min: 1 }),
  amount: helpers.number({ min: 1, max: 10000000 }),
  advanceDate: helpers.date({ required: true }),
  installments: helpers.int({ min: 1, max: 60, default: 1 }),
  notes: helpers.text({ max: 300 }),
};

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const monthOf = (value) => String(value).slice(0, 7);

function assertEditableMonth(month) {
  const current = new Date().toISOString().slice(0, 7);
  if (month > current) throw new ValidationError({ month: 'invalid' });
  return month;
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

function structureFor(staffId) {
  const db = getDb();
  const staff = db
    .prepare(`SELECT id, name, employee_code, designation, basic_salary, joining_date FROM staff WHERE id = ? AND is_deleted = 0`)
    .get(staffId);
  if (!staff) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const salary = db
    .prepare(`SELECT * FROM salary_structures WHERE staff_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1`)
    .get(staffId);

  return {
    staff: {
      id: staff.id,
      name: staff.name,
      employeeCode: staff.employee_code,
      designation: staff.designation,
      basicSalary: salary ? salary.basic_salary : staff.basic_salary,
      joiningDate: staff.joining_date,
    },
    effectiveFrom: salary ? salary.effective_from : null,
    allowances: db
      .prepare(`SELECT * FROM allowances WHERE staff_id = ? AND is_active = 1 ORDER BY id`)
      .all(staffId),
    deductions: db
      .prepare(`SELECT * FROM deductions WHERE staff_id = ? AND is_active = 1 ORDER BY id`)
      .all(staffId),
    advances: db
      .prepare(`SELECT * FROM advances WHERE staff_id = ? AND is_deleted = 0 ORDER BY advance_date DESC`)
      .all(staffId),
  };
}

function saveBasic(staffId, payload, session) {
  const clean = validate({ staffId, ...payload }, {
    staffId: helpers.int({ min: 1 }),
    basicSalary: helpers.number({ min: 0, max: 10000000, required: true }),
    effectiveFrom: helpers.date({}),
  });
  const db = getDb();
  const staff = db.prepare(`SELECT * FROM staff WHERE id = ? AND is_deleted = 0`).get(staffId);
  if (!staff) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const existing = db
    .prepare(`SELECT id FROM salary_structures WHERE staff_id = ? AND is_active = 1`)
    .get(staffId);

  if (existing) {
    db.prepare(
      `UPDATE salary_structures SET basic_salary = ?, effective_from = COALESCE(?, effective_from) WHERE id = ?`,
    ).run(clean.basicSalary, clean.effectiveFrom ?? null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO salary_structures (staff_id, basic_salary, effective_from) VALUES (?, ?, ?)`,
    ).run(staffId, clean.basicSalary, clean.effectiveFrom ?? null);
  }
  db.prepare(`UPDATE staff SET basic_salary = ?, updated_at = datetime('now') WHERE id = ?`).run(clean.basicSalary, staffId);

  audit.log({ action: 'salary_structure', entity: 'staff', entityId: staffId, details: { basicSalary: clean.basicSalary }, session });
  return structureFor(staffId);
}

function saveAllowance(payload, session) {
  const clean = validate(payload, ALLOWANCE_SPEC);
  const db = getDb();
  const id = db
    .prepare(
      `INSERT INTO allowances (staff_id, name, kind, amount, is_percent) VALUES (@staffId, @name, @kind, @amount, @isPercent)`,
    )
    .run({
      staffId: clean.staffId,
      name: clean.name,
      kind: clean.kind,
      amount: clean.amount,
      isPercent: clean.isPercent ? 1 : 0,
    }).lastInsertRowid;
  audit.log({ action: 'create', entity: 'allowances', entityId: id, details: clean, session });
  return structureFor(clean.staffId);
}

function deleteAllowance(id, session) {
  const row = getDb().prepare(`SELECT * FROM allowances WHERE id = ?`).get(id);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  getDb().prepare(`UPDATE allowances SET is_active = 0 WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'allowances', entityId: id, details: { name: row.name }, session });
  return structureFor(row.staff_id);
}

function saveDeduction(payload, session) {
  const clean = validate(payload, DEDUCTION_SPEC);
  const db = getDb();
  const id = db
    .prepare(
      `INSERT INTO deductions (staff_id, name, kind, amount, is_percent) VALUES (@staffId, @name, @kind, @amount, @isPercent)`,
    )
    .run({
      staffId: clean.staffId,
      name: clean.name,
      kind: clean.kind,
      amount: clean.amount,
      isPercent: clean.isPercent ? 1 : 0,
    }).lastInsertRowid;
  audit.log({ action: 'create', entity: 'deductions', entityId: id, details: clean, session });
  return structureFor(clean.staffId);
}

function deleteDeduction(id, session) {
  const row = getDb().prepare(`SELECT * FROM deductions WHERE id = ?`).get(id);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  getDb().prepare(`UPDATE deductions SET is_active = 0 WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'deductions', entityId: id, details: { name: row.name }, session });
  return structureFor(row.staff_id);
}

// ---------------------------------------------------------------------------
// Advances / loans
// ---------------------------------------------------------------------------

function addAdvance(payload, session) {
  const clean = validate(payload, ADVANCE_SPEC);
  const db = getDb();
  const staff = db.prepare(`SELECT id FROM staff WHERE id = ? AND is_deleted = 0`).get(clean.staffId);
  if (!staff) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const installment = money(clean.amount / clean.installments);
  const id = db
    .prepare(
      `INSERT INTO advances (staff_id, amount, advance_date, installments, installment_amount, recovered, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, 0, 'active', ?, ?)`,
    )
    .run(clean.staffId, clean.amount, clean.advanceDate, clean.installments, installment, clean.notes ?? null, session ? session.userId : null)
    .lastInsertRowid;

  audit.log({ action: 'advance_create', entity: 'advances', entityId: id, details: clean, session });
  return db.prepare(`SELECT * FROM advances WHERE id = ?`).get(id);
}

function cancelAdvance(id, session) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM advances WHERE id = ? AND is_deleted = 0`).get(id);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  db.prepare(`UPDATE advances SET status = 'cancelled', is_deleted = 1 WHERE id = ?`).run(id);
  audit.log({ action: 'advance_cancel', entity: 'advances', entityId: id, details: { amount: row.amount }, session });
  return structureFor(row.staff_id);
}

function advancesFor(staffId) {
  return getDb()
    .prepare(`SELECT * FROM advances WHERE staff_id = ? AND is_deleted = 0 ORDER BY advance_date DESC`)
    .all(staffId);
}

// ---------------------------------------------------------------------------
// Payroll computation
// ---------------------------------------------------------------------------

function attendanceSummary(staffId, month) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS marked,
              SUM(CASE WHEN status = 'present'  THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status = 'absent'   THEN 1 ELSE 0 END) AS absent,
              SUM(CASE WHEN status = 'leave'    THEN 1 ELSE 0 END) AS leave_days,
              SUM(CASE WHEN status = 'late'     THEN 1 ELSE 0 END) AS late,
              SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) AS half_day
       FROM staff_attendance WHERE staff_id = ? AND substr(date, 1, 7) = ?`,
    )
    .get(staffId, month);

  return {
    present: row.present || 0,
    absent: row.absent || 0,
    leave: row.leave_days || 0,
    late: row.late || 0,
    halfDay: row.half_day || 0,
    marked: row.marked || 0,
  };
}

/** Installments still to recover on a given payroll. */
function advanceRecovery(staffId, alreadyRecovered) {
  const rows = advancesFor(staffId).filter((a) => a.status === 'active');
  let total = 0;
  const detail = [];
  rows.forEach((advance) => {
    const remaining = money(advance.amount - (alreadyRecovered[advance.id] || 0) - advance.recovered);
    const installment = Math.min(advance.installment_amount || advance.amount, remaining);
    if (installment > 0) {
      total = money(total + installment);
      detail.push({ advanceId: advance.id, amount: installment });
    }
  });
  return { total, detail };
}

function recoveriesFor(staffId, month) {
  const rows = getDb()
    .prepare(
      `SELECT ar.advance_id, COALESCE(SUM(ar.amount), 0) AS amount
       FROM advance_recoveries ar
       JOIN payroll p ON p.id = ar.payroll_id
       WHERE ar.advance_id IN (SELECT id FROM advances WHERE staff_id = ?) AND p.month = ?
       GROUP BY ar.advance_id`,
    )
    .all(staffId, month);
  return Object.fromEntries(rows.map((r) => [r.advance_id, r.amount]));
}

/**
 * Computes one staff member's salary for a month.
 * @param {{ staffId: number, month: string, bonus?: number }} options
 */
function compute({ staffId, month }, session, options = {}) {
  const structure = structureFor(staffId);
  const basic = Number(structure.staff.basicSalary) || 0;
  const attendance = attendanceSummary(staffId, month);

  const allowanceItems = structure.allowances.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    isPercent: !!row.is_percent,
    amount: row.is_percent ? money((basic * row.amount) / 100) : money(row.amount),
  }));
  const allowancesTotal = money(allowanceItems.reduce((sum, item) => sum + item.amount, 0));
  const gross = money(basic + allowancesTotal);

  const perDayAbsent = Number(settings.get('absent_deduction_per_day')) || 0;
  const lateRow = structure.deductions.find((d) => d.kind === 'late');
  const lateRate = lateRow ? (lateRow.is_percent ? money((basic * lateRow.amount) / 100) : money(lateRow.amount)) : 0;

  const deductionItems = structure.deductions
    .filter((row) => row.kind !== 'absent' && row.kind !== 'late')
    .map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      isPercent: !!row.is_percent,
      amount: row.is_percent ? money((basic * row.amount) / 100) : money(row.amount),
    }));

  if (perDayAbsent > 0 && attendance.absent > 0) {
    deductionItems.push({
      id: null,
      name: `Absence (${attendance.absent} day${attendance.absent > 1 ? 's' : ''})`,
      kind: 'absent',
      isPercent: false,
      amount: money(perDayAbsent * attendance.absent),
    });
  }
  if (lateRate > 0 && attendance.late > 0) {
    deductionItems.push({
      id: null,
      name: `Late (${attendance.late} day${attendance.late > 1 ? 's' : ''})`,
      kind: 'late',
      isPercent: false,
      amount: money(lateRate * attendance.late),
    });
  }

  const deductionsTotal = money(deductionItems.reduce((sum, item) => sum + item.amount, 0));
  const recovery = advanceRecovery(staffId, recoveriesFor(staffId, month));
  const bonus = money(options.bonus || 0);
  const net = money(gross - deductionsTotal - recovery.total + bonus);

  return {
    staff: structure.staff,
    month,
    basic: money(basic),
    allowanceItems,
    allowancesTotal,
    gross,
    deductionItems,
    deductionsTotal,
    attendance,
    advanceRecovery: recovery.total,
    advanceDetail: recovery.detail,
    bonus,
    net,
  };
}

/** Payroll preview for a month: computed numbers without writing anything. */
function preview({ month, staffIds = null, bonuses = {} }, session) {
  assertEditableMonth(month);
  const db = getDb();
  const ids = Array.isArray(staffIds) && staffIds.length
    ? staffIds.map(Number)
    : db
        .prepare(`SELECT id FROM staff WHERE is_deleted = 0 AND status != 'inactive' AND staff_type IN ('teacher','office')`)
        .all()
        .map((r) => r.id);

  const existing = db.prepare(`SELECT staff_id FROM payroll WHERE month = ?`).all(month).map((r) => r.staff_id);
  const rows = ids
    .filter((id) => !existing.includes(id))
    .map((id) => compute({ staffId: id, month }, session, { bonus: Number(bonuses[id]) || 0 }));

  return {
    month,
    generated: existing.length,
    skipped: existing.length,
    rows,
    totals: rows.reduce(
      (acc, row) => ({
        gross: money(acc.gross + row.gross),
        deductions: money(acc.deductions + row.deductionsTotal),
        net: money(acc.net + row.net),
        advance: money(acc.advance + row.advanceRecovery),
      }),
      { gross: 0, deductions: 0, net: 0, advance: 0 },
    ),
  };
}

/** Writes the payroll rows for a month in one transaction. */
function generate({ month, bonuses = {} }, session) {
  assertEditableMonth(month);
  const db = getDb();
  const calculated = preview({ month, bonuses }, session);
  if (!calculated.rows.length) {
    throw new AppError('NOTHING_TO_GENERATE', 'NOTHING_TO_GENERATE');
  }

  const insertPayroll = db.prepare(
    `INSERT INTO payroll (staff_id, month, basic, allowances_total, gross, deductions_total, advance_recovery,
       bonus, net, working_days, present_days, absent_days, status, generated_by)
     VALUES (@staffId, @month, @basic, @allowancesTotal, @gross, @deductionsTotal, @advanceRecovery,
       @bonus, @net, @workingDays, @presentDays, @absentDays, 'generated', @generatedBy)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO payroll_items (payroll_id, kind, name, amount, sort_order) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertRecovery = db.prepare(
    `INSERT INTO advance_recoveries (advance_id, payroll_id, amount, recovery_date) VALUES (?, ?, ?, date('now'))`,
  );

  const run = db.transaction(() => {
    calculated.rows.forEach((row) => {
      const payrollId = insertPayroll.run({
        staffId: row.staff.id,
        month,
        basic: row.basic,
        allowancesTotal: row.allowancesTotal,
        gross: row.gross,
        deductionsTotal: row.deductionsTotal,
        advanceRecovery: row.advanceRecovery,
        bonus: row.bonus,
        net: row.net,
        workingDays: row.attendance.marked,
        presentDays: row.attendance.present,
        absentDays: row.attendance.absent,
        generatedBy: session ? session.userId : null,
      }).lastInsertRowid;

      insertItem.run(payrollId, 'earning', 'Basic salary', row.basic, 0);
      row.allowanceItems.forEach((item, index) => {
        insertItem.run(payrollId, 'earning', item.name, item.amount, index + 1);
      });
      row.deductionItems.forEach((item, index) => {
        insertItem.run(payrollId, 'deduction', item.name, item.amount, index + 1);
      });
      if (row.advanceRecovery > 0) {
        insertItem.run(payrollId, 'deduction', 'Advance recovery', row.advanceRecovery, 90);
        row.advanceDetail.forEach((detail) => {
          insertRecovery.run(detail.advanceId, payrollId, detail.amount);
          const advance = db.prepare(`SELECT amount, recovered FROM advances WHERE id = ?`).get(detail.advanceId);
          const recovered = money(advance.recovered + detail.amount);
          db.prepare(`UPDATE advances SET recovered = ?, status = ? WHERE id = ?`).run(
            recovered,
            recovered >= advance.amount - 0.01 ? 'recovered' : 'active',
            detail.advanceId,
          );
        });
      }
    });
  });
  run();

  audit.log({ action: 'payroll_generate', entity: 'payroll', details: { month, staff: calculated.rows.length }, session });
  return list({ month }, session);
}

function list({ month, status = null, staffId = null, search = '' }, session) {
  const db = getDb();
  const where = [];
  const params = {};

  if (month) {
    where.push('p.month = @month');
    params.month = month;
  }
  if (status) {
    where.push('p.status = @status');
    params.status = status;
  }
  if (staffId) {
    where.push('p.staff_id = @staffId');
    params.staffId = Number(staffId);
  }
  if (search) {
    where.push(`(f.name LIKE @search OR f.employee_code LIKE @search)`);
    params.search = `%${search}%`;
  }

  // teachers only ever see their own payroll
  if (session.role === 'teacher') {
    where.push('p.staff_id = @ownStaff');
    params.ownStaff = acl.ownStaffId(session);
  } else if (!acl.isAdminLike(session)) {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT p.*, f.name AS staff_name, f.employee_code, f.designation
       FROM payroll p JOIN staff f ON f.id = p.staff_id
       ${clause}
       ORDER BY p.month DESC, f.name
       LIMIT 500`,
    )
    .all(params);

  return rows.map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    employeeCode: row.employee_code,
    designation: row.designation,
    month: row.month,
    basic: row.basic,
    allowancesTotal: row.allowances_total,
    gross: row.gross,
    deductionsTotal: row.deductions_total,
    advanceRecovery: row.advance_recovery,
    bonus: row.bonus,
    net: row.net,
    presentDays: row.present_days,
    absentDays: row.absent_days,
    workingDays: row.working_days,
    status: row.status,
    paidDate: row.paid_date,
    paymentMethod: row.payment_method,
  }));
}

function detail(payrollId) {
  const db = getDb();
  const row = db
    .prepare(`SELECT p.*, f.name AS staff_name, f.employee_code, f.designation, f.cnic, f.phone
              FROM payroll p JOIN staff f ON f.id = p.staff_id WHERE p.id = ?`)
    .get(payrollId);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  return {
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    employeeCode: row.employee_code,
    designation: row.designation,
    month: row.month,
    basic: row.basic,
    allowancesTotal: row.allowances_total,
    gross: row.gross,
    deductionsTotal: row.deductions_total,
    advanceRecovery: row.advance_recovery,
    bonus: row.bonus,
    net: row.net,
    presentDays: row.present_days,
    absentDays: row.absent_days,
    workingDays: row.working_days,
    status: row.status,
    paidDate: row.paid_date,
    paymentMethod: row.payment_method,
    items: db.prepare(`SELECT kind, name, amount, sort_order FROM payroll_items WHERE payroll_id = ? ORDER BY sort_order`).all(payrollId),
  };
}

function markPaid({ id, paymentMethod, reference, paidDate }, session) {
  if (!acl.isAdminLike(session)) throw new AppError('FORBIDDEN', 'FORBIDDEN');
  const clean = validate({ id, paymentMethod, reference, paidDate }, {
    id: helpers.int({ min: 1 }),
    paymentMethod: helpers.enum(['cash', 'bank']),
    reference: helpers.text({ max: 60 }),
    paidDate: helpers.date({}),
  });

  const db = getDb();
  const row = db.prepare(`SELECT * FROM payroll WHERE id = ?`).get(clean.id);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  if (row.status === 'paid') throw new AppError('ALREADY_PAID', 'ALREADY_PAID');

  db.prepare(
    `UPDATE payroll SET status = 'paid', paid_date = COALESCE(?, date('now')),
       payment_method = ?, payment_reference = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(clean.paidDate ?? null, clean.paymentMethod ?? null, clean.reference ?? null, clean.id);

  audit.log({ action: 'payroll_paid', entity: 'payroll', entityId: clean.id, details: { net: row.net, method: clean.paymentMethod }, session });
  return detail(clean.id);
}

function remove(payrollId, session) {
  if (!acl.isAdminLike(session)) throw new AppError('FORBIDDEN', 'FORBIDDEN');
  const db = getDb();
  const row = db.prepare(`SELECT * FROM payroll WHERE id = ?`).get(payrollId);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  if (row.status === 'paid') throw new AppError('ALREADY_PAID', 'ALREADY_PAID');

  // give the recovered amount back to the advances before deleting
  db.prepare(
    `SELECT advance_id, amount FROM advance_recoveries WHERE payroll_id = ?`,
  ).all(payrollId).forEach((recovery) => {
    const advance = db.prepare(`SELECT amount, recovered FROM advances WHERE id = ?`).get(recovery.advance_id);
    if (advance) {
      const recovered = Math.max(0, Math.round((advance.recovered - recovery.amount) * 100) / 100);
      db.prepare(`UPDATE advances SET recovered = ?, status = 'active' WHERE id = ?`).run(recovered, recovery.advance_id);
    }
  });

  db.prepare(`DELETE FROM payroll WHERE id = ?`).run(payrollId);
  audit.log({ action: 'payroll_delete', entity: 'payroll', entityId: payrollId, details: { month: row.month, staff: row.staff_id }, session });
  return { ok: true };
}

/** Every slip a staff member can download (teacher sees only their own). */
function mySlips(session) {
  if (!session) throw new AppError('FORBIDDEN', 'FORBIDDEN');
  const staffId = session.role === 'teacher' ? acl.ownStaffId(session) : null;
  return list(staffId ? { staffId } : {}, session);
}

module.exports = {
  ALLOWANCE_KINDS,
  DEDUCTION_KINDS,
  structureFor,
  saveBasic,
  saveAllowance,
  deleteAllowance,
  saveDeduction,
  deleteDeduction,
  addAdvance,
  cancelAdvance,
  advancesFor,
  attendanceSummary,
  compute,
  preview,
  generate,
  list,
  detail,
  markPaid,
  remove,
  mySlips,
  money,
};