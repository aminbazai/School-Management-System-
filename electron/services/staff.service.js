'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');
const users = require('./users.service');
const auth = require('./auth.service');
const files = require('./files.service');
const settings = require('./settings.service');

/**
 * Staff records: teachers, office staff and other employees.
 * One table (staff.staff_type) so payroll and attendance reference a single
 * entity - see README assumptions.
 */

const SPEC = {
  employeeCode: helpers.text({ max: 20 }),
  name: helpers.text({ min: 2, max: 80 }),
  fatherName: helpers.text({ max: 80 }),
  cnic: helpers.text({ max: 20 }),
  phone: helpers.text({ max: 20 }),
  email: helpers.text({ max: 120 }),
  address: helpers.text({ max: 300 }),
  qualification: helpers.text({ max: 80 }),
  designation: helpers.text({ max: 60 }),
  staffType: helpers.enum(['teacher', 'office', 'other'], { default: 'teacher' }),
  joiningDate: helpers.date({}),
  photoPath: helpers.text({ max: 200 }),
  basicSalary: helpers.number({ min: 0, max: 10000000, default: 0 }),
  bloodGroup: helpers.text({ max: 10 }),
  status: helpers.enum(['active', 'on_leave', 'inactive'], { default: 'active' }),
  notes: helpers.text({ max: 500 }),
  createLogin: helpers.bool(),
};

const LIST_SPEC = {
  search: helpers.text({ max: 100, default: '' }),
  staffType: helpers.enum(['teacher', 'office', 'other']),
  status: helpers.enum(['active', 'on_leave', 'inactive']),
  page: helpers.int({ min: 1, default: 1 }),
  pageSize: helpers.int({ min: 5, max: 500, default: 25 }),
};

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    employeeCode: row.employee_code,
    name: row.name,
    fatherName: row.father_name,
    cnic: row.cnic,
    phone: row.phone,
    email: row.email,
    address: row.address,
    qualification: row.qualification,
    designation: row.designation,
    staffType: row.staff_type,
    joiningDate: row.joining_date,
    photoPath: row.photo_path,
    basicSalary: row.basic_salary,
    bloodGroup: row.blood_group,
    status: row.status,
    notes: row.notes,
    hasLogin: !!row.user_id,
    username: row.username,
    classCount: row.class_count ?? 0,
    createdAt: row.created_at,
  };
}

const BASE_SELECT = `
  SELECT f.*, u.id AS user_id, u.username,
         (SELECT COUNT(DISTINCT class_id) FROM teacher_assignments ta
          WHERE ta.teacher_id = f.id AND ta.is_active = 1) AS class_count
  FROM staff f
  LEFT JOIN users u ON u.linked_id = f.id AND u.is_deleted = 0
      AND ((u.role = 'teacher' AND f.staff_type = 'teacher') OR (u.role = 'office' AND f.staff_type = 'office'))`;

function list(payload = {}) {
  const clean = validate(payload, LIST_SPEC);
  const db = getDb();
  const where = ['f.is_deleted = 0'];
  const params = {};

  if (clean.search) {
    where.push(`(f.name LIKE @search OR f.employee_code LIKE @search OR f.phone LIKE @search OR f.cnic LIKE @search OR f.designation LIKE @search)`);
    params.search = `%${clean.search}%`;
  }
  if (clean.staffType) {
    where.push('f.staff_type = @staffType');
    params.staffType = clean.staffType;
  }
  if (clean.status) {
    where.push('f.status = @status');
    params.status = clean.status;
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM staff f ${clause}`).get(params).n;
  const rows = db
    .prepare(`${BASE_SELECT} ${clause} ORDER BY f.staff_type, f.name LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: clean.pageSize, offset: (clean.page - 1) * clean.pageSize });

  return { total, page: clean.page, pageSize: clean.pageSize, rows: rows.map(shape) };
}

function get(id) {
  const row = getDb().prepare(`${BASE_SELECT} WHERE f.id = ? AND f.is_deleted = 0`).get(id);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  return shape(row);
}

/** Every row matching the list filters, without pagination (used by Excel export). */
function listAll(payload = {}) {
  const clean = validate(payload, LIST_SPEC);
  const db = getDb();
  const where = ['f.is_deleted = 0'];
  const params = {};

  if (clean.search) {
    where.push(`(f.name LIKE @search OR f.employee_code LIKE @search OR f.phone LIKE @search OR f.cnic LIKE @search OR f.designation LIKE @search)`);
    params.search = `%${clean.search}%`;
  }
  if (clean.staffType) {
    where.push('f.staff_type = @staffType');
    params.staffType = clean.staffType;
  }
  if (clean.status) {
    where.push('f.status = @status');
    params.status = clean.status;
  }

  return db
    .prepare(`${BASE_SELECT} WHERE ${where.join(' AND ')} ORDER BY f.staff_type, f.name`)
    .all(params)
    .map(shape);
}

/** Row data for the reusable Excel export table. */
function exportRows(payload = {}) {
  const rows = listAll(payload);
  return {
    meta: {
      session: settings.get('session'),
      school: settings.get('school_name'),
      generatedAt: new Date().toISOString(),
      count: rows.length,
    },
    rows: rows.map((s) => ({
      employee_code: s.employeeCode,
      name: s.name,
      father_name: s.fatherName,
      cnic: s.cnic,
      phone: s.phone,
      email: s.email,
      address: s.address,
      qualification: s.qualification,
      designation: s.designation,
      staff_type: s.staffType,
      joining_date: s.joiningDate,
      basic_salary: s.basicSalary,
      blood_group: s.bloodGroup,
      status: s.status,
      notes: s.notes,
    })),
  };
}

function normaliseStaffType(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!text) return undefined;
  if (['teacher', 'teaching', 'faculty'].includes(text)) return 'teacher';
  if (['office', 'admin', 'administrative', 'accounts', 'clerk', 'management'].includes(text)) return 'office';
  if (['other', 'support', 'nonteaching', 'staff'].includes(text)) return 'other';
  return undefined;
}

function normaliseStaffStatus(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!text) return undefined;
  if (['active', 'present', 'working'].includes(text)) return 'active';
  if (['onleave', 'leave', 'absent'].includes(text)) return 'on_leave';
  if (['inactive', 'left', 'resigned', 'disabled'].includes(text)) return 'inactive';
  return undefined;
}

/** Maps one Excel row object (already header-mapped) into a staff payload. */
function rowToStaff(row, index) {
  // Import previews use the header labels ("employee code", "joining date")
  // while API payloads use camelCase; accept both spellings.
  const value = (...keys) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
    }
    return undefined;
  };

  const problems = [];
  const name = String(value('name') || '').trim();
  if (!name) problems.push({ row: index, field: 'name', message: 'Name is required' });

  const dateValue = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return undefined;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed.toISOString().slice(0, 10);
  };

  const salaryText = String(value('basic_salary', 'basic salary') ?? '').replace(/[^0-9.-]/g, '');
  const salary = salaryText === '' ? undefined : Number(salaryText);
  if (salaryText !== '' && !Number.isFinite(salary)) {
    problems.push({ row: index, field: 'basicSalary', message: 'Basic salary must be a number' });
  }

  return {
    problems,
    payload: {
      employeeCode: String(value('employee_code', 'employee code') || '').trim() || undefined,
      name,
      fatherName: String(value('father_name', "father's name") || '').trim() || undefined,
      cnic: String(value('cnic', 'cnic no', 'cnic number') || '').trim() || undefined,
      phone: String(value('phone', 'contact', 'mobile') || '').trim() || undefined,
      email: String(value('email', 'email address') || '').trim() || undefined,
      address: String(value('address') || '').trim() || undefined,
      qualification: String(value('qualification') || '').trim() || undefined,
      designation: String(value('designation') || '').trim() || undefined,
      staffType: normaliseStaffType(value('staff_type', 'staff type')),
      joiningDate: dateValue(value('joining_date', 'joining date')),
      basicSalary: salary,
      bloodGroup: String(value('blood_group', 'blood group') || '').trim() || undefined,
      status: normaliseStaffStatus(value('status')),
      notes: String(value('notes', 'remarks') || '').trim() || undefined,
      createLogin: false,
    },
  };
}

/**
 * Imports parsed Excel rows.
 * @param {{ rows: object[], updateExisting?: boolean, createLogin?: boolean }} payload
 */
function importRows(payload, session) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) throw new ValidationError({ rows: 'required' });

  const db = getDb();
  let imported = 0;
  let updated = 0;
  const errors = [];

  const run = db.transaction(() => {
    rows.forEach((row, index) => {
      const { problems, payload: member } = rowToStaff(row, index + 2);
      if (problems.length) {
        errors.push(...problems);
        return;
      }
      try {
        let existing = null;
        if (member.employeeCode) {
          existing = db
            .prepare(`SELECT id FROM staff WHERE employee_code = ? AND is_deleted = 0`)
            .get(member.employeeCode);
        }
        if (!existing && member.cnic) {
          existing = db
            .prepare(`SELECT id FROM staff WHERE cnic = ? AND is_deleted = 0`)
            .get(member.cnic);
        }
        if (existing) {
          if (payload.updateExisting) {
            const current = db.prepare(`SELECT * FROM staff WHERE id = ?`).get(existing.id);
            update(
              existing.id,
              {
                ...member,
                staffType: member.staffType ?? current.staff_type,
                status: member.status ?? current.status,
                basicSalary: member.basicSalary ?? current.basic_salary,
                createLogin: payload.createLogin === true,
              },
              session,
            );
            updated += 1;
          } else {
            errors.push({ row: index + 2, field: 'employeeCode', message: 'Employee code or CNIC already exists' });
          }
          return;
        }
        create({ ...member, createLogin: payload.createLogin === true }, session);
        imported += 1;
      } catch (err) {
        errors.push({
          row: index + 2,
          field: 'name',
          message: err.fields ? Object.values(err.fields)[0] : err.message,
        });
      }
    });
  });

  run();
  audit.log({ action: 'import', entity: 'staff', details: { imported, updated, failed: errors.length }, session });
  return { imported, updated, failed: errors.length, errors: errors.slice(0, 50) };
}

function create(payload, session) {
  const clean = validate(payload, SPEC);
  if (!clean.name) throw new ValidationError({ name: 'required' });
  const db = getDb();

  if (clean.employeeCode && db.prepare(`SELECT id FROM staff WHERE employee_code = ? AND is_deleted = 0`).get(clean.employeeCode)) {
    throw new ValidationError({ employeeCode: 'alreadyExists' });
  }

  const id = db
    .prepare(
      `INSERT INTO staff (employee_code, name, father_name, cnic, phone, email, address, qualification,
        designation, staff_type, joining_date, photo_path, basic_salary, blood_group, status, notes)
       VALUES (@employeeCode, @name, @fatherName, @cnic, @phone, @email, @address, @qualification,
        @designation, @staffType, @joiningDate, @photoPath, @basicSalary, @bloodGroup, @status, @notes)`,
    )
    .run({
      employeeCode: clean.employeeCode ?? null,
      name: clean.name,
      fatherName: clean.fatherName ?? null,
      cnic: clean.cnic ?? null,
      phone: clean.phone ?? null,
      email: clean.email ?? null,
      address: clean.address ?? null,
      qualification: clean.qualification ?? null,
      designation: clean.designation ?? null,
      staffType: clean.staffType,
      joiningDate: clean.joiningDate ?? null,
      photoPath: clean.photoPath ?? null,
      basicSalary: clean.basicSalary,
      bloodGroup: clean.bloodGroup ?? null,
      status: clean.status,
      notes: clean.notes ?? null,
    }).lastInsertRowid;

  audit.log({ action: 'create', entity: 'staff', entityId: id, details: { name: clean.name, type: clean.staffType }, session });
  if (clean.createLogin) createLogin(id, clean.staffType, session);
  return get(id);
}

function update(id, payload, session) {
  const existing = getDb().prepare(`SELECT * FROM staff WHERE id = ? AND is_deleted = 0`).get(id);
  if (!existing) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  const clean = validate(payload, SPEC);

  getDb()
    .prepare(
      `UPDATE staff SET employee_code = COALESCE(@employeeCode, employee_code), name = COALESCE(@name, name),
        father_name = COALESCE(@fatherName, father_name), cnic = COALESCE(@cnic, cnic),
        phone = COALESCE(@phone, phone), email = COALESCE(@email, email), address = COALESCE(@address, address),
        qualification = COALESCE(@qualification, qualification), designation = COALESCE(@designation, designation),
        staff_type = COALESCE(@staffType, staff_type), joining_date = COALESCE(@joiningDate, joining_date),
        photo_path = COALESCE(@photoPath, photo_path), basic_salary = COALESCE(@basicSalary, basic_salary),
        blood_group = COALESCE(@bloodGroup, blood_group), status = COALESCE(@status, status),
        notes = COALESCE(@notes, notes), updated_at = datetime('now')
       WHERE id = @id`,
    )
    .run({
      id,
      employeeCode: clean.employeeCode ?? null,
      name: clean.name ?? null,
      fatherName: clean.fatherName ?? null,
      cnic: clean.cnic ?? null,
      phone: clean.phone ?? null,
      email: clean.email ?? null,
      address: clean.address ?? null,
      qualification: clean.qualification ?? null,
      designation: clean.designation ?? null,
      staffType: clean.staffType ?? null,
      joiningDate: clean.joiningDate ?? null,
      photoPath: clean.photoPath ?? null,
      basicSalary: clean.basicSalary ?? null,
      bloodGroup: clean.bloodGroup ?? null,
      status: clean.status ?? null,
      notes: clean.notes ?? null,
    });

  audit.log({ action: 'update', entity: 'staff', entityId: id, details: clean, session });
  if (clean.createLogin) createLogin(id, existing.staff_type, session);
  return get(id);
}

function softDelete(id, session) {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM staff WHERE id = ? AND is_deleted = 0`).get(id);
  if (!existing) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const classes = db
    .prepare(`SELECT COUNT(DISTINCT class_id) AS n FROM teacher_assignments WHERE teacher_id = ? AND is_active = 1`)
    .get(id).n;
  if (classes > 0) throw new AppError('STAFF_HAS_CLASSES', 'STAFF_HAS_CLASSES', { count: classes });

  db.prepare(`UPDATE staff SET is_deleted = 1, status = 'inactive', updated_at = datetime('now') WHERE id = ?`).run(id);
  db.prepare(`UPDATE users SET is_deleted = 1, is_active = 0 WHERE linked_id = ?`).run(id);
  if (existing.photo_path) files.removeImage(existing.photo_path, 'staff');

  audit.log({ action: 'delete', entity: 'staff', entityId: id, details: { name: existing.name }, session });
  return { ok: true };
}

/** Staff login: username = employee code, otherwise a generated one. */
function createLogin(staffId, staffType, session) {
  const db = getDb();
  const staff = db.prepare(`SELECT * FROM staff WHERE id = ?`).get(staffId);
  if (!staff) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const existing = db
    .prepare(`SELECT id, username FROM users WHERE linked_id = ? AND is_deleted = 0 AND role IN ('teacher','office')`)
    .get(staffId);
  if (existing) return existing;

  const base =
    (staff.employee_code || `${staff.staff_type}${staff.id}`).toLowerCase().replace(/[^a-z0-9._-]/g, '') || `staff${staffId}`;
  let username = base;
  let n = 1;
  while (db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)) {
    n += 1;
    username = `${base}${n}`;
  }

  const role = staff.staff_type === 'teacher' ? 'teacher' : 'office';
  const id = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, linked_id, email, phone, is_active, must_change_password, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, datetime('now'))`,
    )
    .run(username, auth.hashPassword(username), role, staffId, staff.email, staff.phone);

  audit.log({ action: 'create', entity: 'users', entityId: id.lastInsertRowid, details: { username, role, staffId }, session });
  return { id: id.lastInsertRowid, username };
}

module.exports = { SPEC, LIST_SPEC, list, listAll, get, create, update, softDelete, createLogin, exportRows, importRows };