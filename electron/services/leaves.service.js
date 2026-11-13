'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');
const acl = require('./acl.service');

/**
 * Leave types, applications and balances.
 * Staff apply for their own leave; admins and office approve or reject.
 */

function listTypes() {
  return getDb().prepare(`SELECT * FROM leave_types WHERE is_active = 1 ORDER BY name`).all();
}

function daysBetween(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days = Math.round((end - start) / 86400000) + 1;
  return days > 0 ? days : 1;
}

/** Balance for one staff member and year (falls back to the type's yearly quota). */
function balances(staffId, year) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM leave_types WHERE is_active = 1 ORDER BY name`)
    .all()
    .map((type) => {
      const row = db
        .prepare(`SELECT * FROM leave_balances WHERE staff_id = ? AND leave_type_id = ? AND year = ?`)
        .get(staffId, type.id, year);
      const used =
        row?.used_days ??
        db
          .prepare(
            `SELECT COALESCE(SUM(days), 0) AS used FROM leaves
             WHERE staff_id = ? AND status = 'approved' AND leave_type_id = ?
               AND strftime('%Y', from_date) = ?`,
          )
          .get(staffId, type.id, String(year)).used;

      const total = row ? row.total_days : type.days_per_year;
      return {
        leaveTypeId: type.id,
        name: type.name,
        isPaid: !!type.is_paid,
        total,
        used,
        remaining: Math.max(0, Math.round((total - used) * 100) / 100),
      };
    });
}

/**
 * Balances for every staff member, for the leave desk.
 * The yearly quota may be overridden per person; the used days are always
 * derived from the approved applications.
 */
function listBalances({ staffId = null, year = null } = {}) {
  const db = getDb();
  const targetYear = year || new Date().getFullYear();
  const params = { year: String(targetYear) };
  let where = `f.is_deleted = 0 AND f.status = 'active'`;
  if (staffId) {
    where += ` AND f.id = @staffId`;
    params.staffId = staffId;
  }

  const staff = db
    .prepare(`SELECT id, name, employee_code, staff_type FROM staff f WHERE ${where} ORDER BY f.name`)
    .all(params);

  return staff.map((person) => ({
    staffId: person.id,
    staffName: person.name,
    employeeCode: person.employee_code,
    staffType: person.staff_type,
    year: targetYear,
    balances: balances(person.id, targetYear),
  }));
}

/**
 * Recomputes the used days of one balance row from the approved applications.
 * The row is created on first use, which is what makes the table a real
 * record instead of a decoration - the quota can then be overridden per person.
 */
function recalcBalance(staffId, leaveTypeId, year) {
  if (!leaveTypeId) return;
  const db = getDb();
  const type = db.prepare(`SELECT * FROM leave_types WHERE id = ?`).get(leaveTypeId);
  if (!type) return;

  const used = db
    .prepare(
      `SELECT COALESCE(SUM(days), 0) AS used FROM leaves
       WHERE staff_id = ? AND status = 'approved' AND leave_type_id = ?
         AND strftime('%Y', from_date) = ?`,
    )
    .get(staffId, leaveTypeId, String(year)).used;

  const row = db
    .prepare(`SELECT id FROM leave_balances WHERE staff_id = ? AND leave_type_id = ? AND year = ?`)
    .get(staffId, leaveTypeId, year);

  if (row) {
    db.prepare(`UPDATE leave_balances SET used_days = ? WHERE id = ?`).run(used, row.id);
  } else {
    db.prepare(
      `INSERT INTO leave_balances (staff_id, leave_type_id, year, total_days, used_days)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(staffId, leaveTypeId, year, type.days_per_year, used);
  }
}

/** Overrides the yearly quota of one person and leave type. */
function setBalance(payload, session) {
  const clean = validate(payload, {
    staffId: helpers.int({ min: 1 }),
    leaveTypeId: helpers.int({ min: 1 }),
    year: helpers.int({ min: 2000, max: 2100 }),
    totalDays: helpers.number({ min: 0, max: 365 }),
  });
  if (!acl.isAdminLike(session)) throw new AppError('FORBIDDEN', 'FORBIDDEN');

  const db = getDb();
  const type = db.prepare(`SELECT * FROM leave_types WHERE id = ?`).get(clean.leaveTypeId);
  if (!type) throw new ValidationError({ leaveTypeId: 'invalid' });
  const person = db.prepare(`SELECT id FROM staff WHERE id = ? AND is_deleted = 0`).get(clean.staffId);
  if (!person) throw new ValidationError({ staffId: 'invalid' });

  const existing = db
    .prepare(`SELECT id FROM leave_balances WHERE staff_id = ? AND leave_type_id = ? AND year = ?`)
    .get(clean.staffId, clean.leaveTypeId, clean.year);

  if (existing) {
    db.prepare(`UPDATE leave_balances SET total_days = ? WHERE id = ?`).run(clean.totalDays, existing.id);
  } else {
    db.prepare(
      `INSERT INTO leave_balances (staff_id, leave_type_id, year, total_days, used_days)
       VALUES (?, ?, ?, ?, 0)`,
    ).run(clean.staffId, clean.leaveTypeId, clean.year, clean.totalDays);
  }
  recalcBalance(clean.staffId, clean.leaveTypeId, clean.year);

  audit.log({
    action: 'update',
    entity: 'leave_balances',
    entityId: clean.staffId,
    details: { leaveTypeId: clean.leaveTypeId, year: clean.year, totalDays: clean.totalDays },
    session,
  });
  return balances(clean.staffId, clean.year);
}

function list({ staffId, status, year }, session) {
  const clean = validate({ staffId, status, year }, {
    staffId: helpers.int({ min: 1 }),
    status: helpers.enum(['pending', 'approved', 'rejected', 'cancelled']),
    year: helpers.int({ min: 2000, max: 2100 }),
  });

  const db = getDb();
  const where = [];
  const params = {};

  // teachers see only their own applications; office/admin see everything
  if (session.role === 'teacher') {
    where.push('l.staff_id = @staffId');
    params.staffId = acl.ownStaffId(session);
  } else if (session.role === 'student') {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  } else if (clean.staffId) {
    where.push('l.staff_id = @staffId');
    params.staffId = clean.staffId;
  }

  if (clean.status) {
    where.push('l.status = @status');
    params.status = clean.status;
  }
  if (clean.year) {
    where.push(`strftime('%Y', l.from_date) = @year`);
    params.year = String(clean.year);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT l.*, f.name AS staff_name, f.employee_code, t.name AS type_name
       FROM leaves l
       JOIN staff f ON f.id = l.staff_id
       LEFT JOIN leave_types t ON t.id = l.leave_type_id
       ${clause}
       ORDER BY l.from_date DESC, l.id DESC
       LIMIT 500`,
    )
    .all(params);
}

function apply(payload, session) {
  const clean = validate(payload, {
    staffId: helpers.int({ min: 1 }),
    leaveTypeId: helpers.int({ min: 1 }),
    fromDate: helpers.date({ required: true }),
    toDate: helpers.date({ required: true }),
    reason: helpers.text({ max: 300 }),
  });

  // a teacher can only apply for themselves
  if (session.role === 'teacher') {
    const own = acl.ownStaffId(session);
    if (clean.staffId !== own) throw new AppError('FORBIDDEN', 'FORBIDDEN');
  } else if (!acl.isAdminLike(session)) {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }

  if (clean.toDate < clean.fromDate) throw new ValidationError({ toDate: 'invalid' });

  const db = getDb();
  const type = db.prepare(`SELECT * FROM leave_types WHERE id = ? AND is_active = 1`).get(clean.leaveTypeId);
  if (!type) throw new ValidationError({ leaveTypeId: 'invalid' });

  const days = daysBetween(clean.fromDate, clean.toDate);

  // Not more than what is left of a paid leave type.
  const year = Number(clean.fromDate.slice(0, 4));
  const balance = balances(clean.staffId, year).find((b) => b.leaveTypeId === clean.leaveTypeId);
  if (balance && balance.isPaid && balance.total > 0 && days > balance.remaining) {
    throw new ValidationError({ days: 'exceedsBalance' });
  }

  const id = db
    .prepare(
      `INSERT INTO leaves (staff_id, leave_type_id, from_date, to_date, days, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    )
    .run(clean.staffId, clean.leaveTypeId, clean.fromDate, clean.toDate, days, clean.reason ?? null).lastInsertRowid;

  audit.log({ action: 'leave_apply', entity: 'leaves', entityId: id, details: { days, type: type.name }, session });
  return db.prepare(`SELECT * FROM leaves WHERE id = ?`).get(id);
}

function decide({ id, status, remarks }, session) {
  const clean = validate({ id, status, remarks }, {
    id: helpers.int({ min: 1 }),
    status: helpers.enum(['approved', 'rejected', 'cancelled']),
    remarks: helpers.text({ max: 300 }),
  });

  const db = getDb();
  const leave = db.prepare(`SELECT * FROM leaves WHERE id = ?`).get(clean.id);
  if (!leave) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  // A teacher may withdraw their own pending application; everything else is
  // an office decision.
  const ownPendingCancellation =
    session.role === 'teacher' &&
    clean.status === 'cancelled' &&
    leave.status === 'pending' &&
    leave.staff_id === acl.ownStaffId(session);

  if (!ownPendingCancellation && !acl.isAdminLike(session)) {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }
  if (ownPendingCancellation && leave.status !== 'pending') {
    throw new AppError('INVALID_TRANSITION', 'INVALID_TRANSITION');
  }

  db.prepare(
    `UPDATE leaves SET status = ?, decided_by = ?, decided_at = datetime('now'), remarks = COALESCE(?, remarks)
     WHERE id = ?`,
  ).run(clean.status, session.userId, clean.remarks ?? null, clean.id);

  // The used days always follow the approved applications.
  const year = String(leave.from_date).slice(0, 4);
  recalcBalance(leave.staff_id, leave.leave_type_id, Number(year));

  // An approved leave is also marked on the staff register, so the payroll
  // does not treat those days as an absence.
  if (clean.status === 'approved') markLeaveOnRegister(leave);
  else unmarkLeaveOnRegister(leave);

  audit.log({ action: `leave_${clean.status}`, entity: 'leaves', entityId: clean.id, details: { days: leave.days }, session });
  return db.prepare(`SELECT * FROM leaves WHERE id = ?`).get(clean.id);
}

/**
 * Marks the working days of an approved leave as "leave" on the register, so
 * the payroll does not treat them as an absence. A day that was already
 * marked "present" by somebody else is left alone - the office knows more
 * about that day than the leave form does.
 */
function markLeaveOnRegister(leave) {
  const db = getDb();
  const days = Math.max(1, Math.round(leave.days));
  const start = new Date(`${leave.from_date}T00:00:00Z`);
  const stmt = db.prepare(
    `INSERT INTO staff_attendance (staff_id, date, status, remarks)
     VALUES (?, ?, 'leave', 'Approved leave')
     ON CONFLICT(staff_id, date) DO UPDATE
       SET status = 'leave', remarks = 'Approved leave', updated_at = datetime('now')
     WHERE staff_attendance.status <> 'present'`,
  );
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start.getTime() + i * 86400000);
    stmt.run(leave.staff_id, d.toISOString().slice(0, 10));
  }
}

/** Removes the automatic "leave" marks again when an approval is taken back. */
function unmarkLeaveOnRegister(leave) {
  const db = getDb();
  const days = Math.max(1, Math.round(leave.days));
  const start = new Date(`${leave.from_date}T00:00:00Z`);
  const stmt = db.prepare(
    `DELETE FROM staff_attendance
     WHERE staff_id = ? AND date = ? AND status = 'leave' AND remarks = 'Approved leave'`,
  );
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start.getTime() + i * 86400000);
    stmt.run(leave.staff_id, d.toISOString().slice(0, 10));
  }
}

module.exports = {
  listTypes,
  balances,
  listBalances,
  setBalance,
  list,
  apply,
  decide,
  daysBetween,
};