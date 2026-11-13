'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');
const settings = require('./settings.service');

/**
 * Academic structure: sessions, classes, sections, subjects and
 * which subjects belong to which class.
 */

const SESSION_SPEC = {
  name: helpers.text({ min: 4, max: 30, required: true }),
  startDate: helpers.date({ required: true }),
  endDate: helpers.date({ required: true }),
};

const CLASS_SPEC = {
  name: helpers.text({ min: 1, max: 60, required: true }),
  code: helpers.text({ max: 20 }),
  levelOrder: helpers.int({ min: 0, max: 200, default: 0 }),
};

const SECTION_SPEC = {
  classId: helpers.int({ min: 1 }),
  name: helpers.text({ min: 1, max: 20, required: true }),
  capacity: helpers.int({ min: 1, max: 200, default: 30 }),
  roomNo: helpers.text({ max: 20 }),
  classTeacherId: helpers.int({ min: 1 }),
};

const SUBJECT_SPEC = {
  name: helpers.text({ min: 1, max: 60, required: true }),
  code: helpers.text({ max: 20 }),
};

const CLASS_SUBJECT_SPEC = {
  classId: helpers.int({ min: 1 }),
  subjectId: helpers.int({ min: 1 }),
  maxMarks: helpers.int({ min: 1, max: 1000, default: 100 }),
  passMarks: helpers.int({ min: 0, max: 1000, default: 40 }),
  weeklyPeriods: helpers.int({ min: 0, max: 40, default: 3 }),
};

const ASSIGNMENT_SPEC = {
  teacherId: helpers.int({ min: 1 }),
  classId: helpers.int({ min: 1 }),
  sectionId: helpers.int({ min: 1 }),
  subjectId: helpers.int({ min: 1 }),
  academicSessionId: helpers.int({ min: 1 }),
};

// ---------------------------------------------------------------------------
// Academic sessions
// ---------------------------------------------------------------------------

function listSessions() {
  return getDb()
    .prepare(`SELECT * FROM academic_sessions ORDER BY start_date DESC`)
    .all();
}

function createSession(payload, session) {
  const clean = validate(payload, SESSION_SPEC);
  if (clean.endDate <= clean.startDate) throw new ValidationError({ endDate: 'invalid' });
  const db = getDb();
  if (db.prepare(`SELECT id FROM academic_sessions WHERE name = ?`).get(clean.name)) {
    throw new ValidationError({ name: 'alreadyExists' });
  }
  const id = db
    .prepare(`INSERT INTO academic_sessions (name, start_date, end_date, is_active) VALUES (?, ?, ?, 0)`)
    .run(clean.name, clean.startDate, clean.endDate).lastInsertRowid;
  audit.log({ action: 'create', entity: 'academic_sessions', entityId: id, details: { name: clean.name }, session });
  return db.prepare(`SELECT * FROM academic_sessions WHERE id = ?`).get(id);
}

function activateSession(id, session) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM academic_sessions WHERE id = ?`).get(id);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  db.transaction(() => {
    db.prepare(`UPDATE academic_sessions SET is_active = 0`).run();
    db.prepare(`UPDATE academic_sessions SET is_active = 1 WHERE id = ?`).run(id);
    db.prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('session', @value, datetime('now'), @by)
       ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = datetime('now'), updated_by = @by`,
    ).run({ value: row.name, by: session ? session.userId : null });
  })();
  audit.log({ action: 'update', entity: 'academic_sessions', entityId: id, details: { activated: row.name }, session });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

function listClasses({ includeInactive = false } = {}) {
  const db = getDb();
  const where = includeInactive ? '' : 'WHERE c.is_deleted = 0';
  return db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM sections s WHERE s.class_id = c.id AND s.is_deleted = 0) AS section_count,
              (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.is_deleted = 0 AND st.status = 'active') AS student_count
       FROM classes c
       ${where}
       ORDER BY c.level_order, c.name`,
    )
    .all();
}

function createClass(payload, session) {
  const clean = validate(payload, CLASS_SPEC);
  const db = getDb();
  if (db.prepare(`SELECT id FROM classes WHERE name = ? AND is_deleted = 0`).get(clean.name)) {
    throw new ValidationError({ name: 'alreadyExists' });
  }
  const id = db
    .prepare(`INSERT INTO classes (name, code, level_order) VALUES (@name, @code, @levelOrder)`)
    .run({ name: clean.name, code: clean.code ?? null, levelOrder: clean.levelOrder }).lastInsertRowid;
  audit.log({ action: 'create', entity: 'classes', entityId: id, details: { name: clean.name }, session });
  return db.prepare(`SELECT * FROM classes WHERE id = ?`).get(id);
}

function updateClass(id, payload, session) {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM classes WHERE id = ? AND is_deleted = 0`).get(id);
  if (!existing) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  const clean = validate(payload, {
    name: helpers.text({ min: 1, max: 60 }),
    code: helpers.text({ max: 20 }),
    levelOrder: helpers.int({ min: 0, max: 200 }),
    isActive: helpers.bool(),
  });

  const duplicate = db
    .prepare(`SELECT id FROM classes WHERE name = ? AND id <> ? AND is_deleted = 0`)
    .get(clean.name ?? existing.name, id);
  if (duplicate) throw new ValidationError({ name: 'alreadyExists' });

  db.prepare(
    `UPDATE classes SET name = COALESCE(@name, name), code = COALESCE(@code, code),
       level_order = COALESCE(@levelOrder, level_order), is_active = COALESCE(@isActive, is_active),
       updated_at = datetime('now')
     WHERE id = @id`,
  ).run({
    id,
    name: clean.name ?? null,
    code: clean.code ?? null,
    levelOrder: clean.levelOrder ?? null,
    isActive: clean.isActive === undefined ? null : clean.isActive ? 1 : 0,
  });

  audit.log({ action: 'update', entity: 'classes', entityId: id, details: clean, session });
  return db.prepare(`SELECT * FROM classes WHERE id = ?`).get(id);
}

function deleteClass(id, session) {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM classes WHERE id = ? AND is_deleted = 0`).get(id);
  if (!existing) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const students = db
    .prepare(`SELECT COUNT(*) AS n FROM students WHERE class_id = ? AND is_deleted = 0`)
    .get(id).n;
  if (students > 0) {
    throw new AppError('CLASS_HAS_STUDENTS', 'CLASS_HAS_STUDENTS', { count: students });
  }

  db.prepare(`UPDATE classes SET is_deleted = 1, is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
  db.prepare(`UPDATE sections SET is_deleted = 1, is_active = 0 WHERE class_id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'classes', entityId: id, details: { name: existing.name }, session });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function listSections({ classId = null } = {}) {
  const db = getDb();
  const params = {};
  let where = `WHERE s.is_deleted = 0`;
  if (classId) {
    where += ` AND s.class_id = @classId`;
    params.classId = classId;
  }
  return db
    .prepare(
      `SELECT s.*, c.name AS class_name,
              (SELECT COUNT(*) FROM students st WHERE st.section_id = s.id AND st.is_deleted = 0 AND st.status = 'active') AS student_count,
              (SELECT f.name FROM staff f WHERE f.id = s.class_teacher_id) AS class_teacher_name
       FROM sections s
       JOIN classes c ON c.id = s.class_id
       ${where}
       ORDER BY c.level_order, c.name, s.name`,
    )
    .all(params);
}

function createSection(payload, session) {
  const clean = validate(payload, SECTION_SPEC);
  const db = getDb();
  if (!db.prepare(`SELECT id FROM classes WHERE id = ? AND is_deleted = 0`).get(clean.classId)) {
    throw new ValidationError({ classId: 'invalid' });
  }
  if (db.prepare(`SELECT id FROM sections WHERE class_id = ? AND name = ? AND is_deleted = 0`).get(clean.classId, clean.name)) {
    throw new ValidationError({ name: 'alreadyExists' });
  }
  const id = db
    .prepare(
      `INSERT INTO sections (class_id, name, capacity, room_no, class_teacher_id)
       VALUES (@classId, @name, @capacity, @roomNo, @classTeacherId)`,
    )
    .run({
      classId: clean.classId,
      name: clean.name,
      capacity: clean.capacity,
      roomNo: clean.roomNo ?? null,
      classTeacherId: clean.classTeacherId ?? null,
    }).lastInsertRowid;
  audit.log({ action: 'create', entity: 'sections', entityId: id, details: { classId: clean.classId, name: clean.name }, session });
  return db.prepare(`SELECT * FROM sections WHERE id = ?`).get(id);
}

function updateSection(id, payload, session) {
  const db = getDb();
  if (!db.prepare(`SELECT id FROM sections WHERE id = ? AND is_deleted = 0`).get(id)) {
    throw new AppError('NOT_FOUND', 'NOT_FOUND');
  }
  const clean = validate(payload, {
    classId: helpers.int({ min: 1 }),
    name: helpers.text({ min: 1, max: 20 }),
    capacity: helpers.int({ min: 1, max: 200 }),
    roomNo: helpers.text({ max: 20 }),
    classTeacherId: helpers.int({ min: 1 }),
    isActive: helpers.bool(),
  });
  db.prepare(
    `UPDATE sections SET class_id = COALESCE(@classId, class_id), name = COALESCE(@name, name),
       capacity = COALESCE(@capacity, capacity), room_no = COALESCE(@roomNo, room_no),
       class_teacher_id = COALESCE(@classTeacherId, class_teacher_id),
       is_active = COALESCE(@isActive, is_active), updated_at = datetime('now')
     WHERE id = @id`,
  ).run({
    id,
    classId: clean.classId ?? null,
    name: clean.name ?? null,
    capacity: clean.capacity ?? null,
    roomNo: clean.roomNo ?? null,
    classTeacherId: clean.classTeacherId ?? null,
    isActive: clean.isActive === undefined ? null : clean.isActive ? 1 : 0,
  });
  audit.log({ action: 'update', entity: 'sections', entityId: id, details: clean, session });
  return db.prepare(`SELECT * FROM sections WHERE id = ?`).get(id);
}

function deleteSection(id, session) {
  const db = getDb();
  const students = db
    .prepare(`SELECT COUNT(*) AS n FROM students WHERE section_id = ? AND is_deleted = 0`)
    .get(id).n;
  if (students > 0) throw new AppError('SECTION_HAS_STUDENTS', 'SECTION_HAS_STUDENTS', { count: students });
  db.prepare(`UPDATE sections SET is_deleted = 1, is_active = 0 WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'sections', entityId: id, session });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

function listSubjects({ includeInactive = false } = {}) {
  const db = getDb();
  const where = includeInactive ? '' : 'WHERE is_deleted = 0';
  return db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM class_subjects cs WHERE cs.subject_id = s.id AND cs.is_active = 1) AS class_count
       FROM subjects s ${where}
       ORDER BY s.name`,
    )
    .all();
}

function createSubject(payload, session) {
  const clean = validate(payload, SUBJECT_SPEC);
  const db = getDb();
  if (db.prepare(`SELECT id FROM subjects WHERE name = ? AND is_deleted = 0`).get(clean.name)) {
    throw new ValidationError({ name: 'alreadyExists' });
  }
  const id = db
    .prepare(`INSERT INTO subjects (name, code) VALUES (@name, @code)`)
    .run({ name: clean.name, code: clean.code ?? null }).lastInsertRowid;
  audit.log({ action: 'create', entity: 'subjects', entityId: id, details: { name: clean.name }, session });
  return db.prepare(`SELECT * FROM subjects WHERE id = ?`).get(id);
}

function updateSubject(id, payload, session) {
  const db = getDb();
  if (!db.prepare(`SELECT id FROM subjects WHERE id = ? AND is_deleted = 0`).get(id)) {
    throw new AppError('NOT_FOUND', 'NOT_FOUND');
  }
  const clean = validate(payload, {
    name: helpers.text({ min: 1, max: 60 }),
    code: helpers.text({ max: 20 }),
    isActive: helpers.bool(),
  });
  db.prepare(
    `UPDATE subjects SET name = COALESCE(@name, name), code = COALESCE(@code, code),
       is_active = COALESCE(@isActive, is_active) WHERE id = @id`,
  ).run({
    id,
    name: clean.name ?? null,
    code: clean.code ?? null,
    isActive: clean.isActive === undefined ? null : clean.isActive ? 1 : 0,
  });
  audit.log({ action: 'update', entity: 'subjects', entityId: id, details: clean, session });
  return db.prepare(`SELECT * FROM subjects WHERE id = ?`).get(id);
}

function deleteSubject(id, session) {
  const db = getDb();
  const used = db.prepare(`SELECT COUNT(*) AS n FROM class_subjects WHERE subject_id = ? AND is_active = 1`).get(id).n;
  if (used > 0) throw new AppError('SUBJECT_IN_USE', 'SUBJECT_IN_USE', { count: used });
  db.prepare(`UPDATE subjects SET is_deleted = 1, is_active = 0 WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'subjects', entityId: id, session });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Class -> subject mapping
// ---------------------------------------------------------------------------

function listClassSubjects({ classId = null } = {}) {
  const db = getDb();
  const params = {};
  let where = `WHERE cs.is_active = 1`;
  if (classId) {
    where += ` AND cs.class_id = @classId`;
    params.classId = classId;
  }
  return db
    .prepare(
      `SELECT cs.*, s.name AS subject_name, s.code AS subject_code, c.name AS class_name
       FROM class_subjects cs
       JOIN subjects s ON s.id = cs.subject_id
       JOIN classes c ON c.id = cs.class_id
       ${where}
       ORDER BY c.level_order, c.name, s.name`,
    )
    .all(params);
}

function saveClassSubject(payload, session) {
  const clean = validate(payload, CLASS_SUBJECT_SPEC);
  if (clean.passMarks > clean.maxMarks) throw new ValidationError({ passMarks: 'invalid' });
  const db = getDb();

  const existing = db
    .prepare(`SELECT * FROM class_subjects WHERE class_id = ? AND subject_id = ?`)
    .get(clean.classId, clean.subjectId);

  let id;
  if (existing) {
    db.prepare(
      `UPDATE class_subjects SET max_marks = @maxMarks, pass_marks = @passMarks,
         weekly_periods = @weeklyPeriods, is_active = 1 WHERE id = @id`,
    ).run({ ...clean, id: existing.id });
    id = existing.id;
  } else {
    id = db
      .prepare(
        `INSERT INTO class_subjects (class_id, subject_id, max_marks, pass_marks, weekly_periods)
         VALUES (@classId, @subjectId, @maxMarks, @passMarks, @weeklyPeriods)`,
      )
      .run(clean).lastInsertRowid;
  }

  audit.log({ action: 'save', entity: 'class_subjects', entityId: id, details: clean, session });
  return listClassSubjects({ classId: clean.classId });
}

function deleteClassSubject(id, session) {
  getDb().prepare(`UPDATE class_subjects SET is_active = 0 WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'class_subjects', entityId: id, session });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Teacher assignments - who teaches which subject in which section
//
// This table is the backbone of teacher scoping: attendance, timetables,
// marks entry and the teacher dashboard all read it. Without a writer a
// teacher created in the app would have no classes at all.
// ---------------------------------------------------------------------------

function listAssignments({ classId = null, sectionId = null, teacherId = null, subjectId = null } = {}) {
  const db = getDb();
  const where = ['ta.is_active = 1'];
  const params = {};

  if (classId) {
    where.push('ta.class_id = @classId');
    params.classId = classId;
  }
  if (sectionId) {
    where.push('ta.section_id = @sectionId');
    params.sectionId = sectionId;
  }
  if (teacherId) {
    where.push('ta.teacher_id = @teacherId');
    params.teacherId = teacherId;
  }
  if (subjectId) {
    where.push('ta.subject_id = @subjectId');
    params.subjectId = subjectId;
  }

  return db
    .prepare(
      `SELECT ta.*, c.name AS class_name, s.name AS section_name,
              sub.name AS subject_name, f.name AS teacher_name, f.employee_code
       FROM teacher_assignments ta
       JOIN classes c ON c.id = ta.class_id
       JOIN sections s ON s.id = ta.section_id
       LEFT JOIN subjects sub ON sub.id = ta.subject_id
       JOIN staff f ON f.id = ta.teacher_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.level_order, c.name, s.name, sub.name, f.name`,
    )
    .all(params);
}

function saveAssignment(payload, session) {
  const clean = validate(payload, ASSIGNMENT_SPEC);
  const db = getDb();

  const teacher = db
    .prepare(`SELECT id, name FROM staff WHERE id = ? AND is_deleted = 0 AND staff_type = 'teacher'`)
    .get(clean.teacherId);
  if (!teacher) throw new ValidationError({ teacherId: 'invalid' });

  const section = db
    .prepare(`SELECT id, class_id, name FROM sections WHERE id = ? AND is_deleted = 0`)
    .get(clean.sectionId);
  if (!section) throw new ValidationError({ sectionId: 'invalid' });
  if (section.class_id !== clean.classId) throw new ValidationError({ classId: 'invalid' });

  const classRow = db.prepare(`SELECT id FROM classes WHERE id = ? AND is_deleted = 0`).get(clean.classId);
  if (!classRow) throw new ValidationError({ classId: 'invalid' });

  // A teacher may only be given a subject the class actually teaches.
  const teaches = db
    .prepare(`SELECT id FROM class_subjects WHERE class_id = ? AND subject_id = ? AND is_active = 1`)
    .get(clean.classId, clean.subjectId);
  if (!teaches) throw new ValidationError({ subjectId: 'invalid' });

  // The academic session is optional; an active one is used when nothing is given.
  let sessionId = clean.academicSessionId ?? null;
  if (sessionId) {
    const row = db.prepare(`SELECT id FROM academic_sessions WHERE id = ?`).get(sessionId);
    if (!row) throw new ValidationError({ academicSessionId: 'invalid' });
  } else {
    const active = db.prepare(`SELECT id FROM academic_sessions WHERE is_active = 1 LIMIT 1`).get();
    sessionId = active ? active.id : null;
  }

  // The unique index covers teacher + class + section + subject, so an
  // assignment that was removed earlier is re-activated rather than duplicated.
  const existing = db
    .prepare(
      `SELECT id FROM teacher_assignments
       WHERE teacher_id = ? AND class_id = ? AND section_id = ? AND subject_id = ?`,
    )
    .get(clean.teacherId, clean.classId, clean.sectionId, clean.subjectId);

  let id;
  if (existing) {
    db.prepare(
      `UPDATE teacher_assignments
       SET academic_session_id = ?, is_active = 1
       WHERE id = ?`,
    ).run(sessionId, existing.id);
    id = existing.id;
  } else {
    id = db
      .prepare(
        `INSERT INTO teacher_assignments (teacher_id, class_id, section_id, subject_id, academic_session_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(clean.teacherId, clean.classId, clean.sectionId, clean.subjectId, sessionId).lastInsertRowid;
  }

  audit.log({ action: 'save', entity: 'teacher_assignments', entityId: id, details: clean, session });
  return listAssignments({}).find((row) => row.id === id) || { id };
}

function deleteAssignment(id, session) {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM teacher_assignments WHERE id = ?`).get(id);
  if (!existing) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  db.prepare(`UPDATE teacher_assignments SET is_active = 0 WHERE id = ?`).run(id);
  audit.log({
    action: 'delete',
    entity: 'teacher_assignments',
    entityId: id,
    details: { teacherId: existing.teacher_id, classId: existing.class_id, sectionId: existing.section_id },
    session,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// One call that fills every dropdown in the UI
// ---------------------------------------------------------------------------

function structure(session = null) {
  const db = getDb();
  const data = {
    classes: listClasses(),
    sections: listSections(),
    subjects: listSubjects(),
    classSubjects: listClassSubjects(),
    sessions: listSessions(),
    teachers: db
      .prepare(
        `SELECT id, name, employee_code FROM staff
         WHERE staff_type = 'teacher' AND is_deleted = 0 AND status = 'active' ORDER BY name`,
      )
      .all(),
    currentSession: settings.get('session'),
  };

  // A teacher only receives the classes/sections assigned to them.
  if (session && session.role === 'teacher' && session.linkedId) {
    const assignments = db
      .prepare(
        `SELECT ta.class_id AS classId, ta.section_id AS sectionId, ta.subject_id AS subjectId,
                s.name AS subjectName
         FROM teacher_assignments ta
         LEFT JOIN subjects s ON s.id = ta.subject_id
         WHERE ta.teacher_id = ? AND ta.is_active = 1`,
      )
      .all(session.linkedId);
    const classIds = [...new Set(assignments.map((a) => a.classId))];
    const sectionIds = [...new Set(assignments.map((a) => a.sectionId))];
    data.assignments = assignments;
    data.assignedClassIds = classIds;
    data.assignedSectionIds = sectionIds;
    data.classes = data.classes.filter((c) => classIds.includes(c.id));
    data.sections = data.sections.filter((s) => sectionIds.includes(s.id));
  } else if (session && (session.role === 'admin' || session.role === 'office')) {
    // Admin and office need the full list to manage assignments.
    data.assignments = listAssignments();
  }

  return data;
}

module.exports = {
  listSessions,
  createSession,
  activateSession,
  listClasses,
  createClass,
  updateClass,
  deleteClass,
  listSections,
  createSection,
  updateSection,
  deleteSection,
  listSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  listClassSubjects,
  saveClassSubject,
  deleteClassSubject,
  listAssignments,
  saveAssignment,
  deleteAssignment,
  structure,
};
