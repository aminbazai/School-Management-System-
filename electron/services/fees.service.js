'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');
const acl = require('./acl.service');
const settings = require('./settings.service');

/**
 * Fee management: structures per class, monthly vouchers, payments (full or
 * partial), concessions, receipts and the defaulter list.
 *
 * A voucher is generated from the active fee structures for the student's class
 * plus any concession; payments are recorded against it and the status is
 * derived from the amounts rather than typed in.
 */

const FEE_TYPES = ['admission', 'tuition', 'exam', 'transport', 'library', 'uniform', 'other'];
const FREQUENCIES = ['one_time', 'monthly', 'quarterly', 'yearly'];
const METHODS = ['cash', 'bank', 'online', 'cheque'];

const STRUCTURE_SPEC = {
  classId: helpers.int({ min: 1 }),
  name: helpers.text({ max: 80 }),
  feeType: helpers.enum(FEE_TYPES, { default: 'tuition' }),
  frequency: helpers.enum(FREQUENCIES, { default: 'monthly' }),
  amount: helpers.number({ min: 0, max: 1000000, required: true }),
};

const DISCOUNT_SPEC = {
  studentId: helpers.int({ min: 1 }),
  name: helpers.text({ max: 80 }),
  amount: helpers.number({ min: 0, max: 1000000 }),
  percent: helpers.number({ min: 0, max: 100 }),
  reason: helpers.text({ max: 200 }),
};

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
/** Current month as "YYYY-MM" - the single month format used everywhere. */
const currentYM = () => new Date().toISOString().slice(0, 7);

function assertAdminLike(session) {
  if (!acl.isAdminLike(session)) throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

// ---------------------------------------------------------------------------
// Fee structures
// ---------------------------------------------------------------------------

function listStructures({ classId = null, includeInactive = false } = {}) {
  const db = getDb();
  const params = {};
  let where = includeInactive ? '' : 'WHERE f.is_deleted = 0 AND f.is_active = 1';
  if (classId) {
    where += where ? ' AND f.class_id = @classId' : 'WHERE f.class_id = @classId';
    params.classId = Number(classId);
  }
  return db
    .prepare(
      `SELECT f.*, c.name AS class_name FROM fee_structures f
       LEFT JOIN classes c ON c.id = f.class_id
       ${where}
       ORDER BY c.level_order, c.name, f.fee_type`,
    )
    .all(params)
    .map(shapeStructure);
}

/** A row with no class applies to every class (a global fee head). */
function shapeStructure(row) {
  return {
    id: row.id,
    classId: row.class_id,
    className: row.class_name,
    name: row.name,
    feeType: row.fee_type,
    frequency: row.frequency,
    amount: money(row.amount),
    isActive: !!row.is_active,
  };
}

function saveStructure(payload, session) {
  assertAdminLike(session);
  const clean = validate(payload, STRUCTURE_SPEC);
  if (!clean.name) throw new ValidationError({ name: 'required' });

  const db = getDb();
  if (clean.classId && !db.prepare(`SELECT id FROM classes WHERE id = ? AND is_deleted = 0`).get(clean.classId)) {
    throw new ValidationError({ classId: 'invalid' });
  }

  if (clean.id) {
    const id = Number(clean.id);
    if (!db.prepare(`SELECT id FROM fee_structures WHERE id = ?`).get(id)) throw new AppError('NOT_FOUND', 'NOT_FOUND');
    db.prepare(
      `UPDATE fee_structures SET class_id = COALESCE(@classId, class_id), name = @name, fee_type = @feeType,
         frequency = @frequency, amount = @amount, updated_at = datetime('now') WHERE id = @id`,
    ).run({ ...clean, classId: clean.classId ?? null, id });
    audit.log({ action: 'update', entity: 'fee_structures', entityId: id, details: clean, session });
    return shapeStructure(db.prepare(`SELECT f.*, c.name AS class_name FROM fee_structures f
                                      LEFT JOIN classes c ON c.id = f.class_id WHERE f.id = ?`).get(id));
  }

  const id = db
    .prepare(
      `INSERT INTO fee_structures (class_id, name, fee_type, frequency, amount)
       VALUES (@classId, @name, @feeType, @frequency, @amount)`,
    )
    .run({ ...clean, classId: clean.classId ?? null }).lastInsertRowid;
  audit.log({ action: 'create', entity: 'fee_structures', entityId: id, details: clean, session });
  return shapeStructure(db.prepare(`SELECT f.*, c.name AS class_name FROM fee_structures f
                                    LEFT JOIN classes c ON c.id = f.class_id WHERE f.id = ?`).get(id));
}

function deleteStructure(id, session) {
  assertAdminLike(session);
  getDb().prepare(`UPDATE fee_structures SET is_deleted = 1, is_active = 0 WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'fee_structures', entityId: id, session });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Concessions / discounts
// ---------------------------------------------------------------------------

function listDiscounts({ studentId = null } = {}) {
  const db = getDb();
  const params = {};
  let where = 'WHERE d.is_deleted = 0';
  if (studentId) {
    where += ' AND d.student_id = @studentId';
    params.studentId = Number(studentId);
  }
  return db
    .prepare(
      `SELECT d.*, s.name AS student_name, s.admission_no
       FROM discounts d JOIN students s ON s.id = d.student_id
       ${where} ORDER BY d.id DESC`,
    )
    .all(params)
    .map(shapeDiscount);
}

function shapeDiscount(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    admissionNo: row.admission_no,
    name: row.name,
    amount: money(row.amount),
    percent: money(row.percent),
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function saveDiscount(payload, session) {
  assertAdminLike(session);
  const clean = validate(payload, DISCOUNT_SPEC);
  if (!clean.name) throw new ValidationError({ name: 'required' });
  if (!clean.amount && !clean.percent) throw new ValidationError({ amount: 'required' });

  const db = getDb();
  if (!db.prepare(`SELECT id FROM students WHERE id = ? AND is_deleted = 0`).get(clean.studentId)) {
    throw new ValidationError({ studentId: 'invalid' });
  }

  const id = db
    .prepare(
      `INSERT INTO discounts (student_id, name, amount, percent, reason, session_id, approved_by)
       VALUES (@studentId, @name, @amount, @percent, @reason, @sessionId, @approvedBy)`,
    )
    .run({
      studentId: clean.studentId,
      name: clean.name,
      amount: money(clean.amount),
      percent: money(clean.percent),
      reason: clean.reason ?? null,
      sessionId: null,
      approvedBy: session ? session.userId : null,
    }).lastInsertRowid;

  audit.log({ action: 'create', entity: 'discounts', entityId: id, details: clean, session });
  return shapeDiscount(
    db
      .prepare(`SELECT d.*, s.name AS student_name, s.admission_no FROM discounts d
                JOIN students s ON s.id = d.student_id WHERE d.id = ?`)
      .get(id),
  );
}

function deleteDiscount(id, session) {
  assertAdminLike(session);
  getDb().prepare(`UPDATE discounts SET is_deleted = 1 WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'discounts', entityId: id, session });
  return { ok: true };
}

/** Total concession for a student: fixed amounts plus percentages of the fee. */
function discountFor(db, studentId, feeTotal) {
  const rows = db
    .prepare(`SELECT * FROM discounts WHERE student_id = ? AND is_deleted = 0`)
    .all(studentId);
  return rows.reduce(
    (total, row) => total + money((row.amount || 0) + (feeTotal * (row.percent || 0)) / 100),
    0,
  );
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

function voucherShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    voucherNo: row.voucher_no,
    studentId: row.student_id,
    studentName: row.student_name,
    admissionNo: row.admission_no,
    className: row.class_name,
    sectionName: row.section_name,
    month: row.month,
    period: row.period,
    dueDate: row.due_date,
    totalAmount: row.total_amount,
    discount: row.discount,
    lateFine: row.late_fine,
    paidAmount: row.paid_amount,
    balance: money(row.total_amount + row.late_fine - row.paid_amount - row.discount),
    status: row.status,
    createdAt: row.created_at,
  };
}

const VOUCHER_BASE = `
  SELECT v.*, s.name AS student_name, s.admission_no, c.name AS class_name, sec.name AS section_name
  FROM fee_vouchers v
  JOIN students s ON s.id = v.student_id
  LEFT JOIN classes c ON c.id = v.class_id
  LEFT JOIN sections sec ON sec.id = s.section_id`;

/**
 * `month` is always a full "YYYY-MM" value - the stored period is derived from
 * it. Keeping one format means the seed, the UI and the reports all agree.
 */
function yearPeriod(month) {
  return { year: month.slice(0, 4), period: month.slice(5, 7) };
}

function listVouchers({ month, classId, status, search, page = 1, pageSize = 25, studentId } = {}, session) {
  const clean = validate({ month, classId, status, search, page, pageSize, studentId }, {
    month: helpers.month(),
    classId: helpers.int({ min: 1 }),
    status: helpers.enum(['unpaid', 'partial', 'paid', 'cancelled']),
    search: helpers.text({ max: 100, default: '' }),
    page: helpers.int({ min: 1, default: 1 }),
    pageSize: helpers.int({ min: 5, max: 500, default: 25 }),
    studentId: helpers.int({ min: 1 }),
  });

  const db = getDb();
  const where = ['v.is_deleted = 0'];
  const params = {};

  // a student only ever sees their own vouchers
  if (session.role === 'student') {
    where.push('v.student_id = @own');
    params.own = acl.ownStudentId(session);
  } else if (!acl.isAdminLike(session)) {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  } else if (clean.studentId) {
    where.push('v.student_id = @studentId');
    params.studentId = clean.studentId;
  }

  if (clean.month) {
    where.push('v.month = @month');
    params.month = clean.month;
  }
  if (clean.classId) {
    where.push('v.class_id = @classId');
    params.classId = clean.classId;
  }
  if (clean.status) {
    where.push('v.status = @status');
    params.status = clean.status;
  }
  if (clean.search) {
    where.push(`(s.name LIKE @search OR s.admission_no LIKE @search OR v.voucher_no LIKE @search)`);
    params.search = `%${clean.search}%`;
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM fee_vouchers v JOIN students s ON s.id = v.student_id ${clause}`,
    )
    .get(params).n;

  const rows = db
    .prepare(`${VOUCHER_BASE} ${clause} ORDER BY v.due_date, s.name LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: clean.pageSize, offset: (clean.page - 1) * clean.pageSize });

  return {
    total,
    page: clean.page,
    pageSize: clean.pageSize,
    rows: rows.map(voucherShape),
    summary: db
      .prepare(
        `SELECT COALESCE(SUM(v.total_amount),0) AS total,
                COALESCE(SUM(v.paid_amount),0) AS paid,
                COALESCE(SUM(v.total_amount + v.late_fine - v.paid_amount - v.discount),0) AS balance,
                COALESCE(SUM(CASE WHEN v.status = 'unpaid' THEN 1 ELSE 0 END),0) AS unpaid,
                COALESCE(SUM(CASE WHEN v.status = 'partial' THEN 1 ELSE 0 END),0) AS partial
         FROM fee_vouchers v JOIN students s ON s.id = v.student_id ${clause}`,
      )
      .get(params),
  };
}

/** Preview of what generating a month would produce, without writing. */
function previewGenerate({ month, classId } = {}, session) {
  assertAdminLike(session);
  const clean = validate({ month: month || currentYM(), classId }, {
    month: helpers.month({ required: true }),
    classId: helpers.int({ min: 1 }),
  });
  const { year, period } = yearPeriod(clean.month);

  const db = getDb();
  const rows = studentsFor(db, clean.classId);
  const structures = db
    .prepare(`SELECT * FROM fee_structures WHERE is_deleted = 0 AND is_active = 1 AND frequency = 'monthly'`)
    .all();

  const existing = new Set(
    db
      .prepare(`SELECT student_id FROM fee_vouchers WHERE month = ? AND period = ? AND is_deleted = 0`)
      .all(clean.month, period)
      .map((r) => r.student_id),
  );

  const preview = rows
    .filter((student) => !existing.has(student.id))
    .map((student) => {
      const items = applicableStructures(structures, student.class_id);
      const total = money(items.reduce((sum, item) => sum + item.amount, 0));
      const discount = money(Math.min(discountFor(db, student.id, total), total));
      return {
        studentId: student.id,
        studentName: student.name,
        admissionNo: student.admission_no,
        className: student.class_name,
        items,
        total,
        discount,
        payable: money(total - discount),
      };
    });

  return {
    month: clean.month,
    period,
    year,
    skipped: existing.size,
    rows: preview,
    total: money(preview.reduce((sum, r) => sum + r.payable, 0)),
  };
}

function studentsFor(db, classId) {
  const params = {};
  let filter = '';
  if (classId) {
    filter = ' AND st.class_id = @classId';
    params.classId = Number(classId);
  }
  return db
    .prepare(
      `SELECT st.id, st.name, st.admission_no, st.class_id, c.name AS class_name
       FROM students st LEFT JOIN classes c ON c.id = st.class_id
       WHERE st.is_deleted = 0 AND st.status = 'active'${filter}
       ORDER BY c.level_order, st.name`,
    )
    .all(params);
}

/** Structures that apply to a class: its own rows plus the global ones. */
function applicableStructures(structures, classId) {
  return structures
    .filter((row) => row.class_id === null || row.class_id === classId)
    .map((row) => ({ id: row.id, name: row.name, feeType: row.fee_type, amount: money(row.amount) }));
}

/** Creates the month's vouchers. Returns how many were written. */
function generateVouchers({ month, classId, dueDate } = {}, session) {
  assertAdminLike(session);
  const preview = previewGenerate({ month, classId }, session);
  if (!preview.rows.length) throw new AppError('NOTHING_TO_GENERATE', 'NOTHING_TO_GENERATE');

  const db = getDb();
  const due = dueDate || `${preview.year}-${preview.period}-10`;
  const prefix = `VCH-${preview.month.replace('-', '')}`;
  const classes = db.prepare(`SELECT class_id FROM students WHERE id = ?`);

  const insertVoucher = db.prepare(
    `INSERT INTO fee_vouchers (voucher_no, student_id, class_id, month, period, due_date, total_amount, discount, late_fine, paid_amount, status, generated_by)
     VALUES (@voucherNo, @studentId, @classId, @month, @period, @dueDate, @total, @discount, 0, 0, @status, @generatedBy)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO voucher_items (voucher_id, fee_structure_id, description, amount) VALUES (?, ?, ?, ?)`,
  );

  let counter = 0;
  const run = db.transaction(() => {
    preview.rows.forEach((row) => {
      const info = insertVoucher.run({
        voucherNo: nextNumber(db, 'fee_vouchers', 'voucher_no', prefix),
        studentId: row.studentId,
        classId: classes.get(row.studentId)?.class_id ?? null,
        month: preview.month,
        period: preview.period,
        dueDate: due,
        total: row.total,
        discount: row.discount,
        status: row.payable <= 0 ? 'paid' : 'unpaid',
        generatedBy: session ? session.userId : null,
      });
      row.items.forEach((item) => insertItem.run(info.lastInsertRowid, item.id, item.name, item.amount));
      counter += 1;
    });
  });
  run();

  audit.log({ action: 'fee_generate', entity: 'fee_vouchers', details: { month: preview.month, period: preview.period, count: counter }, session });
  return { generated: counter, skipped: preview.skipped };
}

function voucherDetail(id, session) {
  const db = getDb();
  const row = db.prepare(`${VOUCHER_BASE} WHERE v.id = ?`).get(id);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  if (session.role === 'student') {
    const own = acl.ownStudentId(session);
    if (row.student_id !== own) throw new AppError('FORBIDDEN', 'FORBIDDEN');
  } else if (!acl.isAdminLike(session)) {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }

  const voucher = voucherShape(row);
  voucher.items = db
    .prepare(`SELECT id, fee_structure_id, description, amount FROM voucher_items WHERE voucher_id = ?`)
    .all(id)
    .map((item) => ({ id: item.id, feeStructureId: item.fee_structure_id, description: item.description, amount: money(item.amount) }));
  voucher.payments = db
    .prepare(
      `SELECT id, receipt_no, amount, payment_date, method, reference, remarks
       FROM fee_payments WHERE voucher_id = ? AND is_deleted = 0 ORDER BY payment_date, id`,
    )
    .all(id)
    .map((p) => ({
      id: p.id,
      receiptNo: p.receipt_no,
      amount: money(p.amount),
      paymentDate: p.payment_date,
      method: p.method,
      reference: p.reference,
      remarks: p.remarks,
    }));
  voucher.discounts = db
    .prepare(`SELECT name, amount, percent, reason FROM discounts WHERE student_id = ? AND is_deleted = 0`)
    .all(row.student_id)
    .map((d) => ({ name: d.name, amount: money(d.amount), percent: money(d.percent), reason: d.reason }));
  return voucher;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Next free document number for a prefix, zero padded to four digits.
 * Reads the highest existing number for the prefix and walks forward until it
 * finds one that is free. `table`/`column` are hard-coded literals at the call
 * sites, never renderer input.
 */
function nextNumber(db, table, column, prefix) {
  const last = db
    .prepare(`SELECT ${column} AS value FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`)
    .get(`${prefix}%`);
  const digits = last ? String(last.value).match(/(\d+)\s*$/) : null;
  let seq = digits ? Number.parseInt(digits[1], 10) + 1 : 1;

  const exists = db.prepare(`SELECT 1 AS taken FROM ${table} WHERE ${column} = ?`);
  let candidate = `${prefix}-${String(seq).padStart(4, '0')}`;
  let guard = 0;
  while (exists.get(candidate) && guard < 1000) {
    guard += 1;
    seq += 1;
    candidate = `${prefix}-${String(seq).padStart(4, '0')}`;
  }
  return candidate;
}

function nextReceiptNo(db) {
  const prefix = `RCP-${new Date().toISOString().slice(0, 7).replace('-', '')}`;
  return nextNumber(db, 'fee_payments', 'receipt_no', prefix);
}

/**
 * Records a payment against a voucher. Partial payments are supported;
 * the voucher status is derived from the amounts.
 */
function recordPayment(payload, session) {
  assertAdminLike(session);
  const clean = validate(payload, {
    voucherId: helpers.int({ min: 1 }),
    amount: helpers.number({ min: 1, max: 10000000, required: true }),
    paymentDate: helpers.date({ required: true }),
    method: helpers.enum(METHODS, { default: 'cash' }),
    reference: helpers.text({ max: 60 }),
    remarks: helpers.text({ max: 200 }),
  });

  const db = getDb();
  const voucher = db.prepare(`SELECT * FROM fee_vouchers WHERE id = ? AND is_deleted = 0`).get(clean.voucherId);
  if (!voucher) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const payable = money(voucher.total_amount + voucher.late_fine - voucher.discount);
  const balance = money(payable - voucher.paid_amount);
  if (clean.amount > balance + 0.01) {
    throw new ValidationError({ amount: 'exceedsBalance' });
  }

  const receiptNo = nextReceiptNo(db);
  const info = db
    .prepare(
      `INSERT INTO fee_payments (voucher_id, receipt_no, amount, payment_date, method, reference, remarks, collected_by)
       VALUES (@voucherId, @receiptNo, @amount, @paymentDate, @method, @reference, @remarks, @collectedBy)`,
    )
    .run({
      voucherId: clean.voucherId,
      receiptNo,
      amount: money(clean.amount),
      paymentDate: clean.paymentDate,
      method: clean.method,
      reference: clean.reference ?? null,
      remarks: clean.remarks ?? null,
      collectedBy: session ? session.userId : null,
    });

  const paid = money(voucher.paid_amount + clean.amount);
  const remaining = money(payable - paid);
  const status = remaining <= 0.01 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

  db.prepare(
    `UPDATE fee_vouchers SET paid_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(paid, status, clean.voucherId);

  audit.log({
    action: 'fee_payment',
    entity: 'fee_vouchers',
    entityId: clean.voucherId,
    details: { receiptNo, amount: clean.amount, status },
    session,
  });

  return { receiptNo: receiptNo, id: info.lastInsertRowid, paid, balance: remaining, status };
}

function deletePayment(id, session) {
  assertAdminLike(session);
  const db = getDb();
  const payment = db.prepare(`SELECT * FROM fee_payments WHERE id = ? AND is_deleted = 0`).get(id);
  if (!payment) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const voucher = db.prepare(`SELECT * FROM fee_vouchers WHERE id = ?`).get(payment.voucher_id);
  db.prepare(`UPDATE fee_payments SET is_deleted = 1 WHERE id = ?`).run(id);

  const paid = money(voucher.paid_amount - payment.amount);
  const payable = money(voucher.total_amount + voucher.late_fine - voucher.discount);
  const remaining = money(payable - paid);
  db.prepare(`UPDATE fee_vouchers SET paid_amount = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    paid,
    remaining <= 0.01 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
    voucher.id,
  );

  audit.log({ action: 'fee_payment_delete', entity: 'fee_payments', entityId: id, details: { voucherId: voucher.id, amount: payment.amount }, session });
  return { ok: true };
}

/** Applies a late fine to overdue vouchers of a month. */
function applyLateFines({ month, amount } = {}, session) {
  assertAdminLike(session);
  const clean = validate({ month: month || currentYM(), amount }, {
    month: helpers.month({ required: true }),
    amount: helpers.number({ min: 0, max: 100000, required: true }),
  });
  const { period } = yearPeriod(clean.month);

  const db = getDb();
  const info = db
    .prepare(
      `UPDATE fee_vouchers SET late_fine = ?, updated_at = datetime('now')
       WHERE month = ? AND period = ? AND is_deleted = 0 AND status != 'paid' AND late_fine = 0`,
    )
    .run(money(clean.amount), clean.month, period);
  audit.log({ action: 'fee_late_fine', entity: 'fee_vouchers', details: { ...clean, rows: info.changes }, session });
  return { updated: info.changes };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Students with an unpaid balance, worst first. */
function defaulters({ month, classId, limit = 200 } = {}, session) {
  assertAdminLike(session);
  const clean = validate({ month, classId, limit }, {
    month: helpers.month(),
    classId: helpers.int({ min: 1 }),
    limit: helpers.int({ min: 1, max: 1000, default: 200 }),
  });

  const db = getDb();
  const where = ["v.is_deleted = 0", "v.status IN ('unpaid','partial')"];
  const params = {};

  if (clean.month) {
    where.push('v.month = @month');
    params.month = clean.month;
  }
  if (clean.classId) {
    where.push('v.class_id = @classId');
    params.classId = clean.classId;
  }

  const rows = db
    .prepare(
      `SELECT v.*, s.name AS student_name, s.admission_no, c.name AS class_name, sec.name AS section_name,
              s.phone AS student_phone, s.email AS student_email,
              (SELECT g.name FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = v.student_id AND g.is_deleted = 0
                ORDER BY sg.is_primary DESC, g.id LIMIT 1) AS guardian_name,
              (SELECT g.phone FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = v.student_id AND g.is_deleted = 0
                ORDER BY sg.is_primary DESC, g.id LIMIT 1) AS guardian_phone,
              (SELECT g.email FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = v.student_id AND g.is_deleted = 0
                ORDER BY sg.is_primary DESC, g.id LIMIT 1) AS guardian_email
       FROM fee_vouchers v
       JOIN students s ON s.id = v.student_id
       LEFT JOIN classes c ON c.id = v.class_id
       LEFT JOIN sections sec ON sec.id = s.section_id
       WHERE ${where.join(' AND ')}
       ORDER BY (v.total_amount + v.late_fine - v.paid_amount - v.discount) DESC
       LIMIT @limit`,
    )
    .all({ ...params, limit: clean.limit });

  return rows.map((row) => ({
    ...voucherShape(row),
    studentId: row.student_id,
    guardianName: row.guardian_name || null,
    guardianPhone: row.guardian_phone || row.student_phone || null,
    guardianEmail: row.guardian_email || row.student_email || null,
    siblings: db
      .prepare(
        `SELECT st.name FROM students st
         JOIN student_guardians a ON a.student_id = st.id
         JOIN student_guardians b ON b.guardian_id = a.guardian_id AND b.student_id = @id
         WHERE st.id <> @id AND st.is_deleted = 0`,
      )
      .all({ id: row.student_id })
      .map((r) => r.name),
  }));
}

/**
 * Rows for printable fee reminder letters. Accepts an optional list of voucher
 * ids so the UI can print only the selected defaulters.
 */
function reminderRows({ month, classId, voucherIds } = {}, session) {
  assertAdminLike(session);
  const rows = defaulters({ month, classId, limit: 1000 }, session);
  const ids = Array.isArray(voucherIds) ? voucherIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
  const filtered = ids.length ? rows.filter((row) => ids.includes(row.id)) : rows;
  return {
    generatedAt: new Date().toISOString(),
    school: {
      name: settings.get('school_name'),
      address: settings.get('school_address'),
      phone: settings.get('school_phone'),
      email: settings.get('school_email'),
      currency: settings.get('currency_symbol'),
      footer: settings.get('report_footer'),
    },
    rows: filtered,
  };
}

/** Money collected per day over a period. */
function collectionReport({ from, to, classId } = {}, session) {
  assertAdminLike(session);
  const clean = validate({ from, to, classId }, {
    from: helpers.date({ required: true }),
    to: helpers.date({ required: true }),
    classId: helpers.int({ min: 1 }),
  });
  if (clean.to < clean.from) throw new ValidationError({ to: 'invalid' });

  const db = getDb();
  const params = { from: clean.from, to: clean.to };
  let filter = '';
  if (clean.classId) {
    filter = ' AND v.class_id = @classId';
    params.classId = clean.classId;
  }

  const rows = db
    .prepare(
      `SELECT p.payment_date AS date,
              COUNT(*) AS receipts,
              COALESCE(SUM(p.amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount ELSE 0 END), 0) AS cash,
              COALESCE(SUM(CASE WHEN p.method != 'cash' THEN p.amount ELSE 0 END), 0) AS other
       FROM fee_payments p
       JOIN fee_vouchers v ON v.id = p.voucher_id
       WHERE p.is_deleted = 0 AND p.payment_date BETWEEN @from AND @to${filter}
       GROUP BY p.payment_date ORDER BY p.payment_date`,
    )
    .all(params);

  const byMethod = db
    .prepare(
      `SELECT p.method, COALESCE(SUM(p.amount),0) AS amount, COUNT(*) AS receipts
       FROM fee_payments p JOIN fee_vouchers v ON v.id = p.voucher_id
       WHERE p.is_deleted = 0 AND p.payment_date BETWEEN @from AND @to${filter}
       GROUP BY p.method`,
    )
    .all(params);

  return {
    from: clean.from,
    to: clean.to,
    rows,
    byMethod,
    total: money(rows.reduce((sum, r) => sum + r.amount, 0)),
  };
}

/** A student's full fee history (own account for a student). */
function studentFees(studentId, session) {
  const db = getDb();
  let target = studentId ? Number(studentId) : null;

  if (session.role === 'student') {
    const own = acl.ownStudentId(session);
    if (target && target !== own) throw new AppError('FORBIDDEN', 'FORBIDDEN');
    target = own;
  } else if (!acl.isAdminLike(session)) {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }
  if (!target) throw new ValidationError({ studentId: 'required' });

  const student = db
    .prepare(`SELECT id, name, admission_no, class_id, section_id FROM students WHERE id = ? AND is_deleted = 0`)
    .get(target);
  if (!student) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const vouchers = db.prepare(`${VOUCHER_BASE} WHERE v.student_id = ? AND v.is_deleted = 0 ORDER BY v.month DESC, v.period DESC`).all(target);

  const payments = db
    .prepare(
      `SELECT p.id, p.receipt_no, p.amount, p.payment_date, p.method, p.voucher_id,
              v.voucher_no, v.month, v.period
       FROM fee_payments p JOIN fee_vouchers v ON v.id = p.voucher_id
       WHERE v.student_id = ? AND p.is_deleted = 0
       ORDER BY p.payment_date DESC, p.id DESC`,
    )
    .all(target)
    .map((p) => ({
      id: p.id,
      receiptNo: p.receipt_no,
      amount: money(p.amount),
      paymentDate: p.payment_date,
      method: p.method,
      voucherId: p.voucher_id,
      voucherNo: p.voucher_no,
      month: p.month,
      period: p.period,
    }));

  return {
    student: {
      id: student.id,
      name: student.name,
      admissionNo: student.admission_no,
    },
    vouchers: vouchers.map(voucherShape),
    payments,
    totals: {
      billed: money(vouchers.reduce((s, v) => s + v.total_amount, 0)),
      discount: money(vouchers.reduce((s, v) => s + v.discount, 0)),
      fine: money(vouchers.reduce((s, v) => s + v.late_fine, 0)),
      paid: money(vouchers.reduce((s, v) => s + v.paid_amount, 0)),
      balance: money(vouchers.reduce((s, v) => s + v.total_amount + v.late_fine - v.discount - v.paid_amount, 0)),
    },
  };
}

/** Data for the printable receipt of a payment. */
function receiptData(paymentId, session) {
  const db = getDb();
  const payment = db.prepare(`SELECT * FROM fee_payments WHERE id = ? AND is_deleted = 0`).get(paymentId);
  if (!payment) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const voucher = db.prepare(`${VOUCHER_BASE} WHERE v.id = ?`).get(payment.voucher_id);
  if (!voucher) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  if (session.role === 'student') {
    if (voucher.student_id !== acl.ownStudentId(session)) throw new AppError('FORBIDDEN', 'FORBIDDEN');
  } else if (!acl.isAdminLike(session)) {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }

  const student = db
    .prepare(
      `SELECT s.*, g.phone AS guardian_phone FROM students s
       LEFT JOIN student_guardians sg ON sg.student_id = s.id AND sg.is_primary = 1
       LEFT JOIN guardians g ON g.id = sg.guardian_id WHERE s.id = ?`,
    )
    .get(voucher.student_id);

  return {
    payment: {
      id: payment.id,
      receiptNo: payment.receipt_no,
      amount: payment.amount,
      paymentDate: payment.payment_date,
      method: payment.method,
      reference: payment.reference,
      remarks: payment.remarks,
    },
    voucher: voucherShape(voucher),
    student: {
      name: student.name,
      fatherName: student.father_name,
      admissionNo: student.admission_no,
      rollNo: student.roll_no,
      className: voucher.class_name,
      sectionName: voucher.section_name,
      phone: student.phone,
      address: student.address,
      guardianPhone: student.guardian_phone,
    },
    items: db.prepare(`SELECT description, amount FROM voucher_items WHERE voucher_id = ?`).all(voucher.id),
    school: {
      name: settings.get('school_name'),
      address: settings.get('school_address'),
      phone: settings.get('school_phone'),
      email: settings.get('school_email'),
      currency: settings.get('currency_symbol'),
      footer: settings.get('report_footer'),
    },
  };
}

module.exports = {
  FEE_TYPES,
  FREQUENCIES,
  METHODS,
  listStructures,
  saveStructure,
  deleteStructure,
  listDiscounts,
  saveDiscount,
  deleteDiscount,
  listVouchers,
  previewGenerate,
  generateVouchers,
  voucherDetail,
  recordPayment,
  deletePayment,
  applyLateFines,
  defaulters,
  reminderRows,
  collectionReport,
  studentFees,
  receiptData,
};