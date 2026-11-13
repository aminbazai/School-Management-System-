'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');
const users = require('./users.service');
const files = require('./files.service');
const settings = require('./settings.service');
const { logger } = require('../logger');

/**
 * Students: CRUD, search/filter/pagination, bulk promotion, Excel import,
 * login creation and the data used for printable lists and ID cards.
 */

const SORTABLE = {
  name: 'st.name',
  admission_no: 'st.admission_no',
  class_name: 'c.level_order',
  roll_no: 'st.roll_no',
  admission_date: 'st.admission_date',
  created_at: 'st.created_at',
};

const SPEC = {
  admissionNo: helpers.text({ max: 30 }),
  grNo: helpers.text({ max: 30 }),
  name: helpers.text({ min: 2, max: 80 }),
  fatherName: helpers.text({ max: 80 }),
  gender: helpers.enum(['male', 'female', 'other']),
  dob: helpers.date({}),
  bForm: helpers.text({ max: 20 }),
  phone: helpers.text({ max: 20 }),
  email: helpers.text({ max: 120 }),
  address: helpers.text({ max: 300 }),
  classId: helpers.int({ min: 1 }),
  sectionId: helpers.int({ min: 1 }),
  admissionDate: helpers.date({}),
  previousSchool: helpers.text({ max: 120 }),
  rollNo: helpers.text({ max: 20 }),
  status: helpers.enum(['active', 'left', 'passed_out'], { default: 'active' }),
  photoPath: helpers.text({ max: 200 }),
  guardianName: helpers.text({ max: 80 }),
  guardianRelation: helpers.enum(['father', 'mother', 'grandfather', 'grandmother', 'uncle', 'aunt', 'brother', 'sister', 'other']),
  guardianPhone: helpers.text({ max: 20 }),
  guardianCnic: helpers.text({ max: 20 }),
  createLogin: helpers.bool(),
};

const LIST_SPEC = {
  search: helpers.text({ max: 100, default: '' }),
  classId: helpers.int({ min: 1 }),
  sectionId: helpers.int({ min: 1 }),
  status: helpers.enum(['active', 'left', 'passed_out']),
  page: helpers.int({ min: 1, default: 1 }),
  pageSize: helpers.int({ min: 5, max: 2000, default: 25 }),
  sortBy: helpers.enum(Object.keys(SORTABLE)),
  sortDir: helpers.enum(['asc', 'desc'], { default: 'asc' }),
  includeDeleted: helpers.bool(),
};

const BASE_SELECT = `
  SELECT st.*, c.name AS class_name, sec.name AS section_name,
         g.name AS guardian_name, g.phone AS guardian_phone,
         (SELECT COUNT(*) FROM students s2 WHERE s2.is_deleted = 0 AND s2.status = 'active') AS school_total
  FROM students st
  LEFT JOIN classes c ON c.id = st.class_id
  LEFT JOIN sections sec ON sec.id = st.section_id
  LEFT JOIN student_guardians sg ON sg.student_id = st.id AND sg.is_primary = 1
  LEFT JOIN guardians g ON g.id = sg.guardian_id`;

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    admissionNo: row.admission_no,
    grNo: row.gr_no,
    name: row.name,
    fatherName: row.father_name,
    gender: row.gender,
    dob: row.dob,
    bForm: row.b_form,
    phone: row.phone,
    email: row.email,
    address: row.address,
    classId: row.class_id,
    className: row.class_name,
    sectionId: row.section_id,
    sectionName: row.section_name,
    admissionDate: row.admission_date,
    previousSchool: row.previous_school,
    rollNo: row.roll_no,
    status: row.status,
    photoPath: row.photo_path,
    guardianName: row.guardian_name,
    guardianPhone: row.guardian_phone,
    isDeleted: !!row.is_deleted,
    createdAt: row.created_at,
  };
}

function nextAdmissionNo(db) {
  const year = new Date().getFullYear();
  const prefix = `ADM-${year}-`;
  const last = db
    .prepare(`SELECT admission_no FROM students WHERE admission_no LIKE ? ORDER BY admission_no DESC LIMIT 1`)
    .get(`${prefix}%`);
  const seq = last ? Number.parseInt(String(last.admission_no).slice(prefix.length), 10) + 1 : 1;
  let candidate = `${prefix}${String(seq).padStart(3, '0')}`;
  let guard = 0;
  while (db.prepare(`SELECT id FROM students WHERE admission_no = ?`).get(candidate) && guard < 1000) {
    guard += 1;
    candidate = `${prefix}${String(seq + guard).padStart(3, '0')}`;
  }
  return candidate;
}

function assertSectionBelongsToClass(db, classId, sectionId) {
  if (!sectionId) return;
  const section = db.prepare(`SELECT class_id FROM sections WHERE id = ? AND is_deleted = 0`).get(sectionId);
  if (!section) throw new ValidationError({ sectionId: 'invalid' });
  if (classId && section.class_id !== classId) throw new ValidationError({ sectionId: 'invalid' });
}

function syncGuardian(db, studentId, clean) {
  const hasGuardian = clean.guardianName || clean.guardianPhone || clean.guardianCnic;
  const existing = db
    .prepare(
      `SELECT sg.guardian_id FROM student_guardians sg WHERE sg.student_id = ? AND sg.is_primary = 1`,
    )
    .get(studentId);

  if (!hasGuardian) {
    if (existing) {
      db.prepare(`UPDATE guardians SET is_deleted = 1 WHERE id = ?`).run(existing.guardian_id);
      db.prepare(`DELETE FROM student_guardians WHERE student_id = ?`).run(studentId);
    }
    return;
  }

  if (existing) {
    db.prepare(
      `UPDATE guardians SET name = COALESCE(@name, name), phone = COALESCE(@phone, phone),
         cnic = COALESCE(@cnic, cnic), relation = COALESCE(@relation, relation), is_deleted = 0
       WHERE id = @id`,
    ).run({
      id: existing.guardian_id,
      name: clean.guardianName ?? null,
      phone: clean.guardianPhone ?? null,
      cnic: clean.guardianCnic ?? null,
      relation: clean.guardianRelation ?? null,
    });
    return;
  }

  const guardianId = db
    .prepare(
      `INSERT INTO guardians (name, relation, phone, cnic) VALUES (?, ?, ?, ?)`,
    )
    .run(
      clean.guardianName || clean.fatherName || 'Guardian',
      clean.guardianRelation || 'father',
      clean.guardianPhone ?? null,
      clean.guardianCnic ?? null,
    ).lastInsertRowid;

  db.prepare(
    `INSERT INTO student_guardians (student_id, guardian_id, is_primary) VALUES (?, ?, 1)`,
  ).run(studentId, guardianId);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function list(payload = {}) {
  const clean = validate(payload, LIST_SPEC);
  const db = getDb();
  const where = [clean.includeDeleted ? '1 = 1' : 'st.is_deleted = 0'];
  const params = {};

  if (clean.search) {
    where.push(`(st.name LIKE @search OR st.admission_no LIKE @search OR st.father_name LIKE @search OR st.phone LIKE @search OR st.gr_no LIKE @search)`);
    params.search = `%${clean.search}%`;
  }
  if (clean.classId) {
    where.push('st.class_id = @classId');
    params.classId = clean.classId;
  }
  if (clean.sectionId) {
    where.push('st.section_id = @sectionId');
    params.sectionId = clean.sectionId;
  }
  if (clean.status) {
    where.push('st.status = @status');
    params.status = clean.status;
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const orderBy = `${SORTABLE[clean.sortBy || 'name']} ${String(clean.sortDir || 'asc').toUpperCase()}, st.id`;

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM students st
       LEFT JOIN classes c ON c.id = st.class_id ${clause}`,
    )
    .get(params).n;

  const rows = db
    .prepare(`${BASE_SELECT} ${clause} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`)
    .all({
      ...params,
      limit: clean.pageSize,
      offset: (clean.page - 1) * clean.pageSize,
    });

  return { total, page: clean.page, pageSize: clean.pageSize, rows: rows.map(shape) };
}

/** Flat list used by exports / printing (no pagination). */
function listAll(payload = {}) {
  return list({ ...payload, page: 1, pageSize: 2000 }).rows;
}

function get(id) {
  const db = getDb();
  const row = db.prepare(`${BASE_SELECT} WHERE st.id = ?`).get(id);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  const result = shape(row);
  result.guardians = db
    .prepare(
      `SELECT g.* FROM guardians g JOIN student_guardians sg ON sg.guardian_id = g.id
       WHERE sg.student_id = ? ORDER BY sg.is_primary DESC`,
    )
    .all(id);
  result.hasLogin = !!db
    .prepare(`SELECT id FROM users WHERE role = 'student' AND linked_id = ? AND is_deleted = 0`)
    .get(id);
  result.classHistory = db
    .prepare(
      `SELECT h.id, h.class_id AS classId, c.name AS className, h.section_id AS sectionId,
              sec.name AS sectionName, h.changed_at AS changedAt, h.note
       FROM student_class_history h
       LEFT JOIN classes c ON c.id = h.class_id
       LEFT JOIN sections sec ON sec.id = h.section_id
       WHERE h.student_id = ?
       ORDER BY h.changed_at DESC, h.id DESC`,
    )
    .all(id);
  return result;
}

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

function create(payload, session) {
  const clean = validate(payload, SPEC);
  if (!clean.name) throw new ValidationError({ name: 'required' });
  const db = getDb();
  if (!clean.classId) throw new ValidationError({ classId: 'required' });
  if (!db.prepare(`SELECT id FROM classes WHERE id = ? AND is_deleted = 0`).get(clean.classId)) {
    throw new ValidationError({ classId: 'invalid' });
  }
  assertSectionBelongsToClass(db, clean.classId, clean.sectionId);

  const admissionNo = clean.admissionNo || nextAdmissionNo(db);
  if (db.prepare(`SELECT id FROM students WHERE admission_no = ?`).get(admissionNo)) {
    throw new ValidationError({ admissionNo: 'alreadyExists' });
  }

  const info = db
    .prepare(
      `INSERT INTO students (admission_no, gr_no, name, father_name, gender, dob, b_form, phone, email,
        address, class_id, section_id, admission_date, previous_school, roll_no, status, photo_path, created_by)
       VALUES (@admissionNo, @grNo, @name, @fatherName, @gender, @dob, @bForm, @phone, @email,
        @address, @classId, @sectionId, @admissionDate, @previousSchool, @rollNo, @status, @photoPath, @createdBy)`,
    )
    .run({
      admissionNo,
      grNo: clean.grNo ?? null,
      name: clean.name,
      fatherName: clean.fatherName ?? null,
      gender: clean.gender ?? null,
      dob: clean.dob ?? null,
      bForm: clean.bForm ?? null,
      phone: clean.phone ?? null,
      email: clean.email ?? null,
      address: clean.address ?? null,
      classId: clean.classId,
      sectionId: clean.sectionId ?? null,
      admissionDate: clean.admissionDate ?? new Date().toISOString().slice(0, 10),
      previousSchool: clean.previousSchool ?? null,
      rollNo: clean.rollNo ?? null,
      status: clean.status,
      photoPath: clean.photoPath ?? null,
      createdBy: session ? session.userId : null,
    });

  const studentId = Number(info.lastInsertRowid);
  syncGuardian(db, studentId, clean);

  db.prepare(
    `INSERT INTO student_class_history (student_id, class_id, section_id, changed_at, note)
     VALUES (?, ?, ?, ?, 'Admission')`,
  ).run(studentId, clean.classId, clean.sectionId ?? null, clean.admissionDate ?? new Date().toISOString().slice(0, 10));

  if (clean.createLogin) {
    try {
      users.createStudentLogin(studentId, session);
    } catch (err) {
      logger.warn('student login not created', err.message);
    }
  }

  audit.log({ action: 'create', entity: 'students', entityId: studentId, details: { name: clean.name, admissionNo }, session });
  return get(studentId);
}

function update(id, payload, session) {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM students WHERE id = ? AND is_deleted = 0`).get(id);
  if (!existing) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const clean = validate(payload, SPEC);
  const classId = clean.classId ?? existing.class_id;
  if (!classId) throw new ValidationError({ classId: 'required' });
  assertSectionBelongsToClass(db, classId, clean.sectionId);

  if (clean.admissionNo && clean.admissionNo !== existing.admission_no) {
    if (db.prepare(`SELECT id FROM students WHERE admission_no = ? AND id <> ?`).get(clean.admissionNo, id)) {
      throw new ValidationError({ admissionNo: 'alreadyExists' });
    }
  }

  db.prepare(
    `UPDATE students SET
       admission_no = COALESCE(@admissionNo, admission_no),
       gr_no = COALESCE(@grNo, gr_no),
       name = COALESCE(@name, name),
       father_name = COALESCE(@fatherName, father_name),
       gender = COALESCE(@gender, gender),
       dob = COALESCE(@dob, dob),
       b_form = COALESCE(@bForm, b_form),
       phone = COALESCE(@phone, phone),
       email = COALESCE(@email, email),
       address = COALESCE(@address, address),
       class_id = COALESCE(@classId, class_id),
       section_id = COALESCE(@sectionId, section_id),
       admission_date = COALESCE(@admissionDate, admission_date),
       previous_school = COALESCE(@previousSchool, previous_school),
       roll_no = COALESCE(@rollNo, roll_no),
       status = COALESCE(@status, status),
       photo_path = COALESCE(@photoPath, photo_path),
       updated_at = datetime('now')
     WHERE id = @id`,
  ).run({
    id,
    admissionNo: clean.admissionNo ?? null,
    grNo: clean.grNo ?? null,
    name: clean.name ?? null,
    fatherName: clean.fatherName ?? null,
    gender: clean.gender ?? null,
    dob: clean.dob ?? null,
    bForm: clean.bForm ?? null,
    phone: clean.phone ?? null,
    email: clean.email ?? null,
    address: clean.address ?? null,
    classId: clean.classId ?? null,
    sectionId: clean.sectionId ?? null,
    admissionDate: clean.admissionDate ?? null,
    previousSchool: clean.previousSchool ?? null,
    rollNo: clean.rollNo ?? null,
    status: clean.status ?? null,
    photoPath: clean.photoPath ?? null,
  });

  // Guardian details are only touched when the caller actually sends them,
  // so a partial update (e.g. status only) never wipes the guardian.
  const guardianKeys = ['guardianName', 'guardianPhone', 'guardianCnic', 'guardianRelation'];
  if (guardianKeys.some((key) => payload[key] !== undefined && payload[key] !== null)) {
    syncGuardian(db, id, clean);
  }

  const newClassId = clean.classId ?? existing.class_id;
  const newSectionId = clean.sectionId === undefined ? existing.section_id : (clean.sectionId ?? null);
  if (newClassId !== existing.class_id || newSectionId !== existing.section_id) {
    db.prepare(
      `INSERT INTO student_class_history (student_id, class_id, section_id, changed_at, note)
       VALUES (?, ?, ?, datetime('now'), 'Class updated')`,
    ).run(id, newClassId, newSectionId);
  }

  if (clean.createLogin) {
    try {
      users.createStudentLogin(id, session);
    } catch (err) {
      logger.warn('student login not created', err.message);
    }
  }

  audit.log({ action: 'update', entity: 'students', entityId: id, details: { name: clean.name }, session });
  return get(id);
}

function softDelete(id, session) {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM students WHERE id = ? AND is_deleted = 0`).get(id);
  if (!existing) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  db.prepare(`UPDATE students SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  // the login must not survive the student record
  db.prepare(`UPDATE users SET is_active = 0, is_deleted = 1 WHERE role = 'student' AND linked_id = ?`).run(id);
  if (existing.photo_path) files.removeImage(existing.photo_path, 'students');

  audit.log({ action: 'delete', entity: 'students', entityId: id, details: { name: existing.name }, session });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bulk promotion
// ---------------------------------------------------------------------------

/**
 * Moves students to another class/section (e.g. end of year promotion).
 * @param {{ ids?: number[], classId?: number, sectionId?: number,
 *           fromClassId?: number, fromSectionId?: number, session: object }} payload
 */
function promote(payload, session) {
  const db = getDb();
  const ids = Array.isArray(payload.ids) ? payload.ids.map(Number).filter(Boolean) : [];

  if (!ids.length && !payload.fromClassId) {
    throw new ValidationError({ ids: 'required' });
  }

  const targetClassId = Number(payload.classId);
  if (!targetClassId) throw new ValidationError({ classId: 'required' });
  if (!db.prepare(`SELECT id FROM classes WHERE id = ? AND is_deleted = 0`).get(targetClassId)) {
    throw new ValidationError({ classId: 'invalid' });
  }
  const targetSectionId = payload.sectionId ? Number(payload.sectionId) : null;
  assertSectionBelongsToClass(db, targetClassId, targetSectionId);

  // Collect affected students BEFORE the change so we can record their history.
  let affected;
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    affected = db
      .prepare(`SELECT id, class_id, section_id FROM students WHERE is_deleted = 0 AND id IN (${placeholders})`)
      .all(...ids);
  } else {
    const where = ['is_deleted = 0', 'class_id = ?'];
    const params = [Number(payload.fromClassId)];
    if (payload.fromSectionId) {
      where.push('section_id = ?');
      params.push(Number(payload.fromSectionId));
    }
    affected = db
      .prepare(`SELECT id, class_id, section_id FROM students WHERE ${where.join(' AND ')}`)
      .all(...params);
  }

  const run = db.transaction(() => {
    let info;
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      info = db
        .prepare(
          `UPDATE students SET class_id = ?, section_id = ?, updated_at = datetime('now')
           WHERE is_deleted = 0 AND id IN (${placeholders})`,
        )
        .run(targetClassId, targetSectionId, ...ids);
    } else {
      const where = ['is_deleted = 0', 'class_id = @fromClassId'];
      const params = { fromClassId: Number(payload.fromClassId) };
      if (payload.fromSectionId) {
        where.push('section_id = @fromSectionId');
        params.fromSectionId = Number(payload.fromSectionId);
      }
      params.classId = targetClassId;
      params.sectionId = targetSectionId;
      info = db
        .prepare(
          `UPDATE students SET class_id = @classId, section_id = @sectionId, updated_at = datetime('now')
           WHERE ${where.join(' AND ')}`,
        )
        .run(params);
    }

    // Record history for each promoted student (only if class actually changed).
    const insertHist = db.prepare(
      `INSERT INTO student_class_history (student_id, class_id, section_id, changed_at, note)
       VALUES (?, ?, ?, datetime('now'), 'Promoted')`,
    );
    affected.forEach((s) => {
      if (s.class_id !== targetClassId || s.section_id !== targetSectionId) {
        insertHist.run(s.id, targetClassId, targetSectionId);
      }
    });

    return info;
  });

  const info = run();

  audit.log({
    action: 'promote',
    entity: 'students',
    details: { moved: info.changes, toClassId: targetClassId, toSectionId: targetSectionId },
    session,
  });
  return { moved: info.changes };
}

// ---------------------------------------------------------------------------
// Import / export / print helpers
// ---------------------------------------------------------------------------

/** Maps one Excel row object (already header-mapped) into a student payload. */
function rowToStudent(row, index, classLookup, sectionLookup) {
  // Import previews use the header labels ("father's name", "roll no") while
  // API payloads use camelCase; accept both spellings.
  const value = (...keys) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
    }
    return undefined;
  };

  const problems = [];
  const name = String(value('name') || '').trim();
  if (!name) problems.push({ row: index, field: 'name', message: 'Name is required' });

  const className = String(value('class_name', 'class') || '').trim();
  const classId = classLookup.get(className.toLowerCase());
  if (className && !classId) {
    problems.push({ row: index, field: 'class', message: `Unknown class "${className}"` });
  }

  const sectionName = String(value('section_name', 'section') || '').trim();
  const sectionKey = `${className.toLowerCase()}|${sectionName.toLowerCase()}`;
  const sectionId = sectionLookup.get(sectionKey);

  const normalise = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return undefined;
    const lower = text.toLowerCase();
    if (lower === 'male' || lower === 'm') return 'male';
    if (lower === 'female' || lower === 'f') return 'female';
    if (lower === 'other') return 'other';
    if (lower === 'active' || lower === 'left' || lower === 'passed_out') return lower;
    return undefined;
  };

  const dateValue = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return undefined;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed.toISOString().slice(0, 10);
  };

  return {
    problems,
    payload: {
      admissionNo: String(value('admission_no', 'admission no') || '').trim() || undefined,
      grNo: String(value('gr_no', 'gr no') || '').trim() || undefined,
      name,
      fatherName: String(value('father_name', "father's name") || '').trim() || undefined,
      gender: normalise(value('gender')),
      dob: dateValue(value('dob', 'date of birth')),
      bForm: String(value('b_form', 'b-form') || '').trim() || undefined,
      phone: String(value('phone', 'contact', 'mobile') || '').trim() || undefined,
      address: String(value('address') || '').trim() || undefined,
      classId,
      sectionId,
      admissionDate: dateValue(value('admission_date', 'admission date')),
      previousSchool: String(value('previous_school', 'previous school') || '').trim() || undefined,
      rollNo: String(value('roll_no', 'roll no') || '').trim() || undefined,
      status: normalise(value('status')) || 'active',
      guardianName: String(value('guardian_name', 'guardian name') || '').trim() || undefined,
      guardianPhone: String(value('guardian_phone', 'guardian phone') || '').trim() || undefined,
    },
  };
}

/**
 * Imports parsed Excel rows.
 * @param {{ rows: object[], skipInvalid?: boolean, updateExisting?: boolean }} payload
 */
function importRows(payload, session) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) throw new ValidationError({ rows: 'required' });

  const db = getDb();
  const classRows = db.prepare(`SELECT id, name FROM classes WHERE is_deleted = 0`).all();
  const classLookup = new Map(classRows.map((c) => [c.name.toLowerCase(), c.id]));
  const classNameById = new Map(classRows.map((c) => [c.id, c.name]));
  const sectionLookup = new Map(
    db
      .prepare(`SELECT id, name, class_id FROM sections WHERE is_deleted = 0`)
      .all()
      .map((s) => [`${(classNameById.get(s.class_id) || '').toLowerCase()}|${s.name.toLowerCase()}`, s.id]),
  );

  let imported = 0;
  let updated = 0;
  const errors = [];

  const run = db.transaction(() => {
    rows.forEach((row, index) => {
      const { problems, payload: student } = rowToStudent(row, index + 2, classLookup, sectionLookup);
      if (problems.length) {
        errors.push(...problems);
        return;
      }
      if (!student.classId) {
        errors.push({ row: index + 2, field: 'class', message: 'Class is required' });
        return;
      }
      try {
        if (student.admissionNo) {
          const existing = db
            .prepare(`SELECT id FROM students WHERE admission_no = ? AND is_deleted = 0`)
            .get(student.admissionNo);
          if (existing) {
            if (payload.updateExisting) {
              update(existing.id, student, session);
              updated += 1;
            } else {
              errors.push({ row: index + 2, field: 'admissionNo', message: 'Admission number already exists' });
            }
            return;
          }
        }
        create(student, session);
        imported += 1;
      } catch (err) {
        errors.push({ row: index + 2, field: 'name', message: err.fields ? Object.values(err.fields)[0] : err.message });
      }
    });
  });

  run();
  audit.log({ action: 'import', entity: 'students', details: { imported, updated, failed: errors.length }, session });
  return { imported, updated, failed: errors.length, errors: errors.slice(0, 50) };
}

/** Row data for the reusable export table. */
function exportRows(payload) {
  const students = listAll(payload);
  const currentSession = settings.get('session');
  return {
    meta: {
      session: currentSession,
      school: settings.get('school_name'),
      generatedAt: new Date().toISOString(),
      count: students.length,
    },
    rows: students.map((s) => ({
      admission_no: s.admissionNo,
      gr_no: s.grNo,
      name: s.name,
      father_name: s.fatherName,
      gender: s.gender,
      dob: s.dob,
      b_form: s.bForm,
      phone: s.phone,
      address: s.address,
      class_name: s.className,
      section_name: s.sectionName,
      roll_no: s.rollNo,
      admission_date: s.admissionDate,
      previous_school: s.previousSchool,
      guardian_name: s.guardianName,
      guardian_phone: s.guardianPhone,
      status: s.status,
    })),
  };
}

function idCardRows(ids) {
  const db = getDb();
  const list = Array.isArray(ids) && ids.length ? ids.map(Number) : null;
  const students = list
    ? list.map((id) => db.prepare(`${BASE_SELECT} WHERE st.id = ?`).get(id)).filter(Boolean)
    : db.prepare(`${BASE_SELECT} WHERE st.is_deleted = 0 ORDER BY st.name`).all();

  return students.map((row) => ({
    ...shape(row),
    photoDataUrl: row.photo_path ? files.readDataUrl(files.resolveImage(row.photo_path, 'students')) : null,
  }));
}

/**
 * The signed-in student's own record.
 * The student id comes from users.linked_id in the MAIN process - the renderer
 * never gets to choose whose data it wants.
 */
function meForUser(session) {
  if (!session || session.role !== 'student') throw new AppError('FORBIDDEN', 'FORBIDDEN');
  const db = getDb();
  const link = db
    .prepare(`SELECT linked_id FROM users WHERE id = ? AND is_deleted = 0`)
    .get(session.userId);
  if (!link || !link.linked_id) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const student = get(link.linked_id);
  const classId = student.classId;

  student.subjects = classId
    ? db
        .prepare(
          `SELECT s.id, s.name, s.code, cs.max_marks, cs.pass_marks, cs.weekly_periods
           FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
           WHERE cs.class_id = ? AND cs.is_active = 1 ORDER BY s.name`,
        )
        .all(classId)
    : [];

  student.teachers = classId
    ? db
        .prepare(
          `SELECT DISTINCT f.id, f.name, f.phone, s.name AS subject_name
           FROM teacher_assignments ta
           JOIN staff f ON f.id = ta.teacher_id
           LEFT JOIN subjects s ON s.id = ta.subject_id
           WHERE ta.class_id = @classId AND ta.is_active = 1 AND f.is_deleted = 0`,
        )
        .all({ classId })
    : [];

  student.siblings = db
    .prepare(
      `SELECT st.id, st.name, st.admission_no FROM students st
       JOIN student_guardians sg2 ON sg2.student_id = st.id
       JOIN student_guardians sg ON sg.guardian_id = sg2.guardian_id
       WHERE sg.student_id = @id AND st.id <> @id AND st.is_deleted = 0`,
    )
    .all({ id: student.id });

  return student;
}

module.exports = {
  SPEC,
  LIST_SPEC,
  list,
  listAll,
  get,
  meForUser,
  create,
  update,
  softDelete,
  promote,
  importRows,
  exportRows,
  idCardRows,
  nextAdmissionNo,
};