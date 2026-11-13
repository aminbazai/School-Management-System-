'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');
const acl = require('./acl.service');

/**
 * Weekly timetable.
 *
 * A slot is unique per (section, day, period, session) - the database enforces
 * it, so a section can never end up with two subjects in the same period.
 * Teacher clashes are *reported*, not silently blocked: a clash is legitimate
 * during substitution, so the editor shows the warning and lets the admin save.
 */

/** 0 = Sunday, matching JS `Date#getDay` and the CHECK constraint. */
const DAYS = [
  { value: 0, key: 'sunday' },
  { value: 1, key: 'monday' },
  { value: 2, key: 'tuesday' },
  { value: 3, key: 'wednesday' },
  { value: 4, key: 'thursday' },
  { value: 5, key: 'friday' },
  { value: 6, key: 'saturday' },
];

const PERIOD_SPEC = {
  id: helpers.int({ min: 1 }),
  name: helpers.text({ min: 1, max: 60 }),
  startTime: helpers.text({ required: true, min: 4, max: 5 }),
  endTime: helpers.text({ required: true, min: 4, max: 5 }),
  sortOrder: helpers.int({ min: 1, max: 99 }),
  isBreak: helpers.bool({ default: false }),
};

function assertAdmin(session) {
  if (!session || session.role !== 'admin') throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function activeSessionId(db) {
  const row = db.prepare(`SELECT id FROM academic_sessions WHERE is_active = 1 ORDER BY id DESC LIMIT 1`).get();
  return row ? row.id : null;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

function listPeriods({ includeInactive = false } = {}) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM periods ${includeInactive ? '' : 'WHERE is_active = 1'}
       ORDER BY sort_order, start_time`,
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      startTime: row.start_time,
      endTime: row.end_time,
      sortOrder: row.sort_order,
      isBreak: !!row.is_break,
      isActive: !!row.is_active,
    }));
}

function savePeriod(payload, session) {
  assertAdmin(session);
  const clean = validate(payload || {}, PERIOD_SPEC);
  if (!clean.name) throw new ValidationError({ name: 'required' });
  if (!TIME_RE.test(clean.startTime) || !TIME_RE.test(clean.endTime)) {
    throw new ValidationError({ startTime: 'invalid' });
  }
  if (clean.endTime <= clean.startTime) throw new ValidationError({ endTime: 'invalid' });

  const db = getDb();

  if (clean.id) {
    db.prepare(
      `UPDATE periods SET name = @name, start_time = @startTime, end_time = @endTime,
              sort_order = @sortOrder, is_break = @isBreak, is_active = 1 WHERE id = @id`,
    ).run({
      name: clean.name,
      startTime: clean.startTime,
      endTime: clean.endTime,
      sortOrder: clean.sortOrder ?? 99,
      isBreak: clean.isBreak ? 1 : 0,
      id: clean.id,
    });
    audit.log({ action: 'update', entity: 'periods', entityId: clean.id, details: clean, session });
    return listPeriods({ includeInactive: true });
  }

  const id = db
    .prepare(
      `INSERT INTO periods (name, start_time, end_time, sort_order, is_break)
       VALUES (@name, @startTime, @endTime, @sortOrder, @isBreak)`,
    )
    .run({
      name: clean.name,
      startTime: clean.startTime,
      endTime: clean.endTime,
      sortOrder: clean.sortOrder ?? 99,
      isBreak: clean.isBreak ? 1 : 0,
    }).lastInsertRowid;

  audit.log({ action: 'create', entity: 'periods', entityId: id, details: clean, session });
  return listPeriods({ includeInactive: true });
}

function deletePeriod(id, session) {
  assertAdmin(session);
  const db = getDb();
  const used = db.prepare(`SELECT COUNT(*) AS n FROM timetable WHERE period_id = ?`).get(id).n;
  if (used > 0) throw new AppError('PERIOD_IN_USE', 'PERIOD_IN_USE');

  db.prepare(`UPDATE periods SET is_active = 0 WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'periods', entityId: id, session });
  return listPeriods({ includeInactive: true });
}

// ---------------------------------------------------------------------------
// Reading the grid
// ---------------------------------------------------------------------------

function shapeSlot(row) {
  return {
    id: row.id,
    sectionId: row.section_id,
    classId: row.class_id,
    className: row.class_name || '',
    sectionName: row.section_name || '',
    dayOfWeek: row.day_of_week,
    periodId: row.period_id,
    subjectId: row.subject_id,
    subjectName: row.subject_name || '',
    teacherId: row.teacher_id,
    teacherName: row.teacher_name || '',
    roomNo: row.room_no || '',
  };
}

const SLOT_SELECT = `
  SELECT t.*, c.name AS class_name, sec.name AS section_name, sub.name AS subject_name,
         st.name AS teacher_name, sec.room_no
  FROM timetable t
  LEFT JOIN classes c ON c.id = t.class_id
  LEFT JOIN sections sec ON sec.id = t.section_id
  LEFT JOIN subjects sub ON sub.id = t.subject_id
  LEFT JOIN staff st ON st.id = t.teacher_id`;

/** The grid shape the renderer draws: periods down the side, days across. */
function buildGrid(periods, days, slots) {
  return periods.map((period) => ({
    period,
    days: days.map((day) => ({
      day,
      slot: slots.find((s) => s.dayOfWeek === day.value && s.periodId === period.id) || null,
    })),
  }));
}

/** Section timetable - admin/office editor. */
function get({ classId, sectionId } = {}, session) {
  const clean = validate({ classId, sectionId }, {
    classId: helpers.int({ min: 1, required: true }),
    sectionId: helpers.int({ min: 1 }),
  });

  const db = getDb();
  if (session.role === 'teacher') acl.assertClassAccess(session, clean.classId, clean.sectionId);
  else if (session.role === 'student') throw new AppError('FORBIDDEN', 'FORBIDDEN');
  else if (!acl.isAdminLike(session)) throw new AppError('FORBIDDEN', 'FORBIDDEN');

  const sessionId = activeSessionId(db);
  const sections = db
    .prepare(`SELECT id, name FROM sections WHERE class_id = ? AND is_deleted = 0 AND is_active = 1 ORDER BY name`)
    .all(clean.classId);

  const targetSection = clean.sectionId || sections[0]?.id;
  if (!targetSection) throw new ValidationError({ sectionId: 'invalid' });

  const slots = db
    .prepare(`${SLOT_SELECT} WHERE t.section_id = ? AND t.session_id IS ? AND t.is_active = 1`)
    .all(targetSection, sessionId)
    .map(shapeSlot);

  const periods = listPeriods();

  return {
    classId: clean.classId,
    className: db.prepare(`SELECT name FROM classes WHERE id = ?`).get(clean.classId)?.name || '',
    sectionId: targetSection,
    sectionName: db.prepare(`SELECT name FROM sections WHERE id = ?`).get(targetSection)?.name || '',
    sessionId,
    days: DAYS,
    periods,
    grid: buildGrid(periods, DAYS, slots),
    slots,
    sections,
    teachers: db
      .prepare(`SELECT id, name, employee_code FROM staff WHERE staff_type = 'teacher' AND is_deleted = 0 ORDER BY name`)
      .all(),
    subjects: db
      .prepare(
        `SELECT s.id, s.name FROM subjects s
         JOIN class_subjects cs ON cs.subject_id = s.id AND cs.class_id = @classId
         WHERE s.is_deleted = 0 AND cs.is_active = 1 ORDER BY s.name`,
      )
      .all({ classId: clean.classId }),
  };
}

/** A teacher's own week (teacher role, or an admin looking at a staff member). */
function forTeacher({ staffId } = {}, session) {
  let teacherId = null;
  if (session.role === 'teacher') {
    teacherId = acl.ownStaffId(session);
  } else if (acl.isAdminLike(session)) {
    const clean = validate({ staffId }, { staffId: helpers.int({ min: 1, required: true }) });
    teacherId = clean.staffId;
  } else {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }

  const db = getDb();
  const teacher = db.prepare(`SELECT id, name, employee_code FROM staff WHERE id = ? AND is_deleted = 0`).get(teacherId);
  if (!teacher) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const sessionId = activeSessionId(db);
  const slots = db
    .prepare(`${SLOT_SELECT} WHERE t.teacher_id = ? AND t.session_id IS ? AND t.is_active = 1`)
    .all(teacherId, sessionId)
    .map(shapeSlot);

  const periods = listPeriods();

  return {
    staffId: teacher.id,
    staffName: teacher.name,
    employeeCode: teacher.employee_code || '',
    sessionId,
    days: DAYS,
    periods,
    grid: buildGrid(periods, DAYS, slots),
    slots,
    lessons: slots.length,
  };
}

/** Whatever "my timetable" means for the signed-in role. */
function my(session) {
  if (session.role === 'teacher') return forTeacher({}, session);
  if (session.role !== 'student') throw new AppError('FORBIDDEN', 'FORBIDDEN');

  const db = getDb();
  const student = db
    .prepare(`SELECT st.class_id, st.section_id, c.name AS class_name, sec.name AS section_name
              FROM students st
              LEFT JOIN classes c ON c.id = st.class_id
              LEFT JOIN sections sec ON sec.id = st.section_id
              WHERE st.id = (SELECT linked_id FROM users WHERE id = ? AND is_deleted = 0)`)
    .get(session.userId);

  if (!student || !student.section_id) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const sessionId = activeSessionId(db);
  const slots = db
    .prepare(`${SLOT_SELECT} WHERE t.section_id = ? AND t.session_id IS ? AND t.is_active = 1`)
    .all(student.section_id, sessionId)
    .map(shapeSlot);

  const periods = listPeriods();

  return {
    classId: student.class_id,
    className: student.class_name || '',
    sectionId: student.section_id,
    sectionName: student.section_name || '',
    sessionId,
    days: DAYS,
    periods,
    grid: buildGrid(periods, DAYS, slots),
    slots,
    lessons: slots.length,
  };
}

// ---------------------------------------------------------------------------
// Writing the grid
// ---------------------------------------------------------------------------

/**
 * Replaces every slot of one section.
 * Entries with a blank subject are simply omitted, which clears the slot.
 * Returns the clash list so the UI can warn without blocking the save.
 */
function save({ classId, sectionId, entries } = {}, session) {
  assertAdmin(session);
  const clean = validate({ classId, sectionId, entries }, {
    classId: helpers.int({ min: 1, required: true }),
    sectionId: helpers.int({ min: 1, required: true }),
    entries: helpers.array({ required: true }),
  });

  const db = getDb();
  const section = db
    .prepare(`SELECT id FROM sections WHERE id = ? AND class_id = ? AND is_deleted = 0`)
    .get(clean.sectionId, clean.classId);
  if (!section) throw new ValidationError({ sectionId: 'invalid' });

  const sessionId = activeSessionId(db);
  const validSubjects = new Set(
    db
      .prepare(`SELECT subject_id FROM class_subjects WHERE class_id = ? AND is_active = 1`)
      .all(clean.classId)
      .map((r) => r.subject_id),
  );

  const prepared = clean.entries.map((raw) => {
    const entry = validate(raw, {
      dayOfWeek: helpers.int({ min: 0, max: 6, required: true }),
      periodId: helpers.int({ min: 1, required: true }),
      subjectId: helpers.int({ min: 1 }),
      teacherId: helpers.int({ min: 1 }),
    });
    if (!entry.subjectId) return null; // empty slot - cleared
    if (!validSubjects.has(entry.subjectId)) throw new ValidationError({ subjectId: 'invalid' });
    if (entry.teacherId && !db.prepare(`SELECT id FROM staff WHERE id = ? AND is_deleted = 0`).get(entry.teacherId)) {
      throw new ValidationError({ teacherId: 'invalid' });
    }
    return entry;
  }).filter(Boolean);

  // The database enforces one slot per (day, period), but a duplicate here
  // would surface as an opaque SQLITE_CONSTRAINT - reject it as a normal
  // validation error instead.
  const seen = new Set();
  for (const entry of prepared) {
    const key = `${entry.dayOfWeek}:${entry.periodId}`;
    if (seen.has(key)) throw new ValidationError({ periodId: 'alreadyExists' });
    seen.add(key);
  }

  const run = db.transaction(() => {
    db.prepare(`DELETE FROM timetable WHERE section_id = ? AND session_id IS ?`).run(clean.sectionId, sessionId);
    const insert = db.prepare(
      `INSERT INTO timetable (class_id, section_id, teacher_id, subject_id, period_id, day_of_week, session_id)
       VALUES (@classId, @sectionId, @teacherId, @subjectId, @periodId, @dayOfWeek, @sessionId)`,
    );
    for (const entry of prepared) {
      insert.run({
        classId: clean.classId,
        sectionId: clean.sectionId,
        teacherId: entry.teacherId ?? null,
        subjectId: entry.subjectId,
        periodId: entry.periodId,
        dayOfWeek: entry.dayOfWeek,
        sessionId,
      });
    }
  });
  run();

  audit.log({
    action: 'update',
    entity: 'timetable',
    entityId: clean.sectionId,
    details: { classId: clean.classId, slots: prepared.length },
    session,
  });

  return { ...get({ classId: clean.classId, sectionId: clean.sectionId }, session), conflicts: detectConflicts(clean.sectionId, sessionId) };
}

/**
 * Teacher double-bookings against the section being edited.
 *
 * The outer query is "other sections' slots"; the EXISTS clause narrows it to
 * the teacher *and* the exact day/period the edited section has booked them in,
 * so the result is a list of real clashes rather than the whole school week.
 * A clash is a warning, not an error - substitution makes them legitimate.
 */
function detectConflicts(sectionId, sessionId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.day_of_week, t.period_id, t.teacher_id, st.name AS teacher_name,
              GROUP_CONCAT(DISTINCT sec.name) AS section_names
       FROM timetable t
       LEFT JOIN staff st ON st.id = t.teacher_id
       JOIN sections sec ON sec.id = t.section_id
       WHERE t.section_id <> @sectionId AND t.session_id IS @sessionId AND t.is_active = 1
         AND t.teacher_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM timetable mine
           WHERE mine.section_id = @sectionId AND mine.session_id IS @sessionId AND mine.is_active = 1
             AND mine.teacher_id = t.teacher_id
             AND mine.day_of_week = t.day_of_week AND mine.period_id = t.period_id
         )
       GROUP BY t.day_of_week, t.period_id, t.teacher_id
       ORDER BY t.day_of_week, t.period_id`,
    )
    .all({ sectionId, sessionId });

  return rows.map((row) => ({
    dayOfWeek: row.day_of_week,
    periodId: row.period_id,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name || '',
    sectionNames: row.section_names || '',
  }));
}

module.exports = {
  DAYS,
  listPeriods,
  savePeriod,
  deletePeriod,
  get,
  forTeacher,
  my,
  save,
  detectConflicts,
};