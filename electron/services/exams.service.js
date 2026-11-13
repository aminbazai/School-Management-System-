'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');
const acl = require('./acl.service');
const settings = require('./settings.service');

/**
 * Exams, marks and results.
 *
 * The lifecycle is explicit so nothing is published by accident:
 *   draft -> marks_open -> published -> locked
 * Only an admin moves an exam forward, and a locked exam refuses marks and
 * recomputation entirely.
 *
 * Marks are keyed by (exam_subject, student). Results are *computed* from those
 * marks - never typed - using the grade scale editable in Settings.
 */

const STATUSES = ['draft', 'marks_open', 'published', 'locked'];
/** Forward-only transitions. Anything not listed is refused. */
const TRANSITIONS = {
  draft: ['draft', 'marks_open'],
  marks_open: ['marks_open', 'draft', 'published'],
  published: ['published', 'locked'],
  locked: ['locked'],
};

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

function assertAdmin(session) {
  if (!session || session.role !== 'admin') throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

const EXAM_SPEC = {
  id: helpers.int({ min: 1 }),
  name: helpers.text({ min: 1, max: 120 }),
  examTypeId: helpers.int({ min: 1 }),
  sessionId: helpers.int({ min: 1 }),
  classId: helpers.int({ min: 1, required: true }),
  startDate: helpers.date(),
  endDate: helpers.date(),
};

// ---------------------------------------------------------------------------
// Exam types
// ---------------------------------------------------------------------------

function listTypes() {
  return getDb()
    .prepare(`SELECT id, name, sort_order AS sortOrder, is_active AS isActive
              FROM exam_types WHERE is_active = 1 ORDER BY sort_order, name`)
    .all();
}

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    examTypeId: row.exam_type_id,
    examTypeName: row.exam_type_name || null,
    sessionId: row.session_id,
    sessionName: row.session_name || null,
    classId: row.class_id,
    className: row.class_name || null,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    isLocked: !!row.is_locked,
    subjectCount: row.subject_count ?? null,
    studentCount: row.student_count ?? null,
    enteredCount: row.entered_count ?? null,
    resultCount: row.result_count ?? null,
    passPercentage: row.result_count ? round2((row.pass_count / row.result_count) * 100) : null,
    averagePercentage: row.avg_percentage === null || row.avg_percentage === undefined ? null : round2(row.avg_percentage),
    createdAt: row.created_at,
  };
}

const EXAM_SELECT = `
  SELECT e.*, c.name AS class_name, s.name AS session_name, t.name AS exam_type_name,
         (SELECT COUNT(*) FROM exam_subjects es WHERE es.exam_id = e.id) AS subject_count,
         (SELECT COUNT(*) FROM students st WHERE st.class_id = e.class_id AND st.is_deleted = 0 AND st.status = 'active') AS student_count,
         (SELECT COUNT(*) FROM marks m WHERE m.exam_id = e.id) AS entered_count,
         (SELECT COUNT(*) FROM results r WHERE r.exam_id = e.id) AS result_count,
         (SELECT COUNT(*) FROM results r WHERE r.exam_id = e.id AND r.is_pass = 1) AS pass_count,
         (SELECT AVG(r.percentage) FROM results r WHERE r.exam_id = e.id) AS avg_percentage
  FROM exams e
  LEFT JOIN classes c ON c.id = e.class_id
  LEFT JOIN academic_sessions s ON s.id = e.session_id
  LEFT JOIN exam_types t ON t.id = e.exam_type_id`;

function list({ classId, status, search, examTypeId } = {}, session) {
  if (session.role !== 'admin' && session.role !== 'teacher') {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }

  const clean = validate({ classId, status, search, examTypeId }, {
    classId: helpers.int({ min: 1 }),
    status: helpers.enum(STATUSES),
    examTypeId: helpers.int({ min: 1 }),
    search: helpers.text({ max: 100, default: '' }),
  });

  const db = getDb();
  const where = ['e.is_deleted = 0'];
  const params = {};

  // A teacher only ever sees exams of the classes they are assigned to.
  if (session.role === 'teacher') {
    const classIds = acl.teacherClassIds(session);
    if (classIds.length === 0) return { rows: [], statuses: STATUSES, types: listTypes() };
    where.push(`e.class_id IN (${classIds.map((_, i) => `@t${i}`).join(',')})`);
    classIds.forEach((id, i) => {
      params[`t${i}`] = id;
    });
  }

  if (clean.classId) {
    where.push('e.class_id = @classId');
    params.classId = clean.classId;
  }
  if (clean.status) {
    where.push('e.status = @status');
    params.status = clean.status;
  }
  if (clean.examTypeId) {
    where.push('e.exam_type_id = @examTypeId');
    params.examTypeId = clean.examTypeId;
  }
  if (clean.search) {
    where.push('(e.name LIKE @search OR c.name LIKE @search)');
    params.search = `%${clean.search}%`;
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const rows = db
    .prepare(`${EXAM_SELECT} ${clause} ORDER BY COALESCE(e.start_date, e.created_at) DESC, e.id DESC`)
    .all(params);

  return { rows: rows.map(shape), statuses: STATUSES, types: listTypes() };
}

function getExam(id, session) {
  const db = getDb();
  const row = db.prepare(`${EXAM_SELECT} WHERE e.id = ? AND e.is_deleted = 0`).get(id);
  if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  if (session.role === 'teacher') acl.assertClassAccess(session, row.class_id);
  else if (session.role === 'student') throw new AppError('FORBIDDEN', 'FORBIDDEN');

  const exam = shape(row);
  exam.subjects = db
    .prepare(
      `SELECT es.id, es.subject_id AS subjectId, s.name AS subjectName, s.code AS subjectCode,
              es.total_marks AS totalMarks, es.pass_marks AS passMarks, es.exam_date AS examDate,
              es.sort_order AS sortOrder,
              (SELECT COUNT(*) FROM marks m WHERE m.exam_subject_id = es.id AND m.marks_obtained IS NOT NULL) AS enteredCount
       FROM exam_subjects es JOIN subjects s ON s.id = es.subject_id
       WHERE es.exam_id = ? ORDER BY es.sort_order, s.name`,
    )
    .all(id)
    .map((r) => ({ ...r, enteredCount: r.enteredCount ?? 0 }));

  exam.grades = settingsGradeScale();
  return exam;
}

function activeSessionId(db) {
  const row = db.prepare(`SELECT id FROM academic_sessions WHERE is_active = 1 ORDER BY id DESC LIMIT 1`).get();
  return row ? row.id : null;
}

function settingsGradeScale() {
  return getDb()
    .prepare(
      `SELECT name, min_percentage AS minPercentage, max_percentage AS maxPercentage,
              grade_point AS gradePoint
       FROM grade_scale WHERE is_active = 1 ORDER BY max_percentage DESC`,
    )
    .all();
}

function saveExam(payload, session) {
  assertAdmin(session);
  const clean = validate(payload || {}, EXAM_SPEC);
  if (!clean.name) throw new ValidationError({ name: 'required' });
  if (clean.startDate && clean.endDate && clean.endDate < clean.startDate) {
    throw new ValidationError({ endDate: 'invalid' });
  }

  const db = getDb();
  if (!db.prepare(`SELECT id FROM classes WHERE id = ? AND is_deleted = 0`).get(clean.classId)) {
    throw new ValidationError({ classId: 'invalid' });
  }
  if (clean.examTypeId && !db.prepare(`SELECT id FROM exam_types WHERE id = ?`).get(clean.examTypeId)) {
    throw new ValidationError({ examTypeId: 'invalid' });
  }

  const sessionId = clean.sessionId || activeSessionId(db);
  const payloadValues = {
    name: clean.name,
    examTypeId: clean.examTypeId ?? null,
    sessionId,
    classId: clean.classId,
    startDate: clean.startDate ?? null,
    endDate: clean.endDate ?? null,
  };

  if (clean.id) {
    const existing = db.prepare(`SELECT * FROM exams WHERE id = ? AND is_deleted = 0`).get(clean.id);
    if (!existing) throw new AppError('NOT_FOUND', 'NOT_FOUND');
    if (existing.is_locked) throw new AppError('EXAM_LOCKED', 'EXAM_LOCKED');

    db.prepare(
      `UPDATE exams SET name = @name, exam_type_id = @examTypeId, session_id = @sessionId,
              class_id = @classId, start_date = @startDate, end_date = @endDate,
              updated_at = datetime('now')
       WHERE id = @id`,
    ).run({ ...payloadValues, id: clean.id });

    audit.log({ action: 'update', entity: 'exams', entityId: clean.id, details: payloadValues, session });
    return getExam(clean.id, session);
  }

  const id = Number(
    db
      .prepare(
        `INSERT INTO exams (name, exam_type_id, session_id, class_id, start_date, end_date, status, created_by)
         VALUES (@name, @examTypeId, @sessionId, @classId, @startDate, @endDate, 'draft', @by)`,
      )
      .run({ ...payloadValues, by: session.userId }).lastInsertRowid,
  );

  audit.log({ action: 'create', entity: 'exams', entityId: id, details: payloadValues, session });
  return getExam(id, session);
}

function deleteExam(id, session) {
  assertAdmin(session);
  const db = getDb();
  const exam = db.prepare(`SELECT * FROM exams WHERE id = ? AND is_deleted = 0`).get(id);
  if (!exam) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  if (exam.is_locked) throw new AppError('EXAM_LOCKED', 'EXAM_LOCKED');

  const entered = db.prepare(`SELECT COUNT(*) AS n FROM marks WHERE exam_id = ?`).get(id).n;
  if (entered > 0) throw new AppError('EXAM_HAS_MARKS', 'EXAM_HAS_MARKS');

  db.prepare(`UPDATE exams SET is_deleted = 1 WHERE id = ?`).run(id);
  audit.log({ action: 'delete', entity: 'exams', entityId: id, details: { name: exam.name }, session });
  return { ok: true };
}

/**
 * Moves an exam along its lifecycle. Refuses any transition that is not listed
 * in TRANSITIONS, so a published exam can never quietly go back to draft and a
 * locked exam can never reopen.
 */
function setStatus({ id, status }, session) {
  assertAdmin(session);
  const clean = validate({ id, status }, {
    id: helpers.int({ min: 1, required: true }),
    status: helpers.enum(STATUSES, { required: true }),
  });

  const db = getDb();
  const exam = db.prepare(`SELECT * FROM exams WHERE id = ? AND is_deleted = 0`).get(clean.id);
  if (!exam) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const allowed = TRANSITIONS[exam.status] || [];
  if (!allowed.includes(clean.status)) {
    throw new AppError('INVALID_TRANSITION', 'INVALID_TRANSITION');
  }

  if (clean.status === 'marks_open' || clean.status === 'published') {
    const subjects = db.prepare(`SELECT COUNT(*) AS n FROM exam_subjects WHERE exam_id = ?`).get(clean.id).n;
    if (subjects === 0) throw new ValidationError({ subjects: 'required' });
  }

  db.prepare(
    `UPDATE exams SET status = @status, is_locked = @locked, updated_at = datetime('now') WHERE id = @id`,
  ).run({ id: clean.id, status: clean.status, locked: clean.status === 'locked' ? 1 : 0 });

  audit.log({
    action: 'exam.status',
    entity: 'exams',
    entityId: clean.id,
    details: { from: exam.status, to: clean.status },
    session,
  });
  return getExam(clean.id, session);
}

// ---------------------------------------------------------------------------
// Exam subjects (the paper-wise schedule)
// ---------------------------------------------------------------------------

const SUBJECT_SPEC = {
  subjectId: helpers.int({ min: 1, required: true }),
  totalMarks: helpers.number({ min: 1, max: 1000 }),
  passMarks: helpers.number({ min: 0, max: 1000 }),
  examDate: helpers.date(),
};

/**
 * Replaces the whole paper list of an exam in one transaction.
 * Subjects are first validated against the class subject list, so an exam can
 * never carry a subject the class does not teach.
 */
function saveSubjects({ examId, subjects }, session) {
  assertAdmin(session);
  const clean = validate({ examId, subjects }, {
    examId: helpers.int({ min: 1, required: true }),
    subjects: helpers.array({ required: true }),
  });

  const db = getDb();
  const exam = db.prepare(`SELECT * FROM exams WHERE id = ? AND is_deleted = 0`).get(clean.examId);
  if (!exam) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  if (exam.is_locked) throw new AppError('EXAM_LOCKED', 'EXAM_LOCKED');

  const rows = clean.subjects.map((raw, index) => {
    const item = validate(raw, SUBJECT_SPEC);
    const taught = db
      .prepare(`SELECT max_marks, pass_marks FROM class_subjects WHERE class_id = ? AND subject_id = ? AND is_active = 1`)
      .get(exam.class_id, item.subjectId);
    if (!taught) throw new ValidationError({ subjects: 'invalid' });

    const totalMarks = item.totalMarks ?? taught.max_marks;
    const passMarks = item.passMarks ?? taught.pass_marks;
    if (passMarks > totalMarks) throw new ValidationError({ passMarks: 'invalid' });

    return {
      subjectId: item.subjectId,
      totalMarks,
      passMarks,
      examDate: item.examDate ?? null,
      sortOrder: index + 1,
    };
  });

  const run = db.transaction(() => {
    const entered = db.prepare(`SELECT COUNT(*) AS n FROM marks WHERE exam_id = ?`).get(clean.examId).n;
    if (entered > 0) {
      throw new AppError('EXAM_HAS_MARKS', 'EXAM_HAS_MARKS');
    }
    db.prepare(`DELETE FROM exam_subjects WHERE exam_id = ?`).run(clean.examId);
    const insert = db.prepare(
      `INSERT INTO exam_subjects (exam_id, subject_id, total_marks, pass_marks, exam_date, sort_order)
       VALUES (@examId, @subjectId, @totalMarks, @passMarks, @examDate, @sortOrder)`,
    );
    for (const row of rows) insert.run({ ...row, examId: clean.examId });
  });
  run();

  audit.log({ action: 'exam.subjects', entity: 'exam_subjects', entityId: clean.examId, details: { count: rows.length }, session });
  return getExam(clean.examId, session);
}

// ---------------------------------------------------------------------------
// Marks entry
// ---------------------------------------------------------------------------

/** Roster of an exam class with whatever has already been entered. */
function markSheet({ examId: requestedExamId, examSubjectId } = {}, session) {
  const clean = validate({ examId: requestedExamId, examSubjectId }, {
    examId: helpers.int({ min: 1 }),
    examSubjectId: helpers.int({ min: 1 }),
  });
  if (!clean.examId && !clean.examSubjectId) throw new ValidationError({ examId: 'required' });

  const db = getDb();
  const resolved = clean.examSubjectId
    ? db.prepare(`SELECT es.*, e.class_id, e.status, e.is_locked, e.name AS exam_name FROM exam_subjects es
                  JOIN exams e ON e.id = es.exam_id WHERE es.id = ? AND e.is_deleted = 0`).get(clean.examSubjectId)
    : null;
  const examId = clean.examSubjectId ? resolved?.exam_id : clean.examId;

  const exam = db.prepare(`SELECT * FROM exams WHERE id = ? AND is_deleted = 0`).get(examId);
  if (!exam) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  // A teacher may only ever open a paper from a class assigned to them; the
  // per-subject check below narrows that further to the subjects they teach.
  if (session.role === 'teacher') acl.assertClassAccess(session, exam.class_id);
  if (resolved) assertMarkAccess(session, exam.class_id, resolved.subject_id, exam);

  if (exam.is_locked) throw new AppError('EXAM_LOCKED', 'EXAM_LOCKED');

  const examSubject = resolved || db.prepare(`SELECT * FROM exam_subjects WHERE exam_id = ? ORDER BY sort_order LIMIT 1`).get(examId);
  const canEnter = Boolean(examSubject) && canMarkSubject(session, exam.class_id, examSubject.subject_id);

  const roster = db
    .prepare(
      `SELECT st.id, st.name, st.admission_no, st.roll_no, sec.name AS section_name,
              m.id AS mark_id, m.marks_obtained
       FROM students st
       LEFT JOIN sections sec ON sec.id = st.section_id
       LEFT JOIN marks m ON m.exam_subject_id = @examSubjectId AND m.student_id = st.id
       WHERE st.class_id = @classId AND st.is_deleted = 0 AND st.status = 'active'
       ORDER BY sec.name, st.roll_no, st.name`,
    )
    .all({ classId: exam.class_id, examSubjectId: examSubject ? examSubject.id : -1 });

  const subjectRows = db
    .prepare(
      `SELECT es.id, es.subject_id AS subjectId, s.name AS subjectName, es.total_marks AS totalMarks,
              es.pass_marks AS passMarks,
              (SELECT COUNT(*) FROM marks m WHERE m.exam_subject_id = es.id AND m.marks_obtained IS NOT NULL) AS enteredCount,
              (SELECT COUNT(*) FROM students st WHERE st.class_id = @classId AND st.is_deleted = 0 AND st.status = 'active') AS studentCount
       FROM exam_subjects es JOIN subjects s ON s.id = es.subject_id
       WHERE es.exam_id = @examId ORDER BY es.sort_order, s.name`,
    )
    .all({ examId, classId: exam.class_id });

  return {
    exam: {
      id: exam.id,
      name: exam.name,
      classId: exam.class_id,
      status: exam.status,
      startDate: exam.start_date,
      endDate: exam.end_date,
    },
    subject: examSubject
      ? {
          id: examSubject.id,
          subjectId: examSubject.subject_id,
          subjectName: db.prepare(`SELECT name FROM subjects WHERE id = ?`).get(examSubject.subject_id)?.name || '',
          totalMarks: examSubject.total_marks,
          passMarks: examSubject.pass_marks,
          examDate: examSubject.exam_date,
        }
      : null,
    subjects: subjectRows.map((row) => ({
      ...row,
      enteredCount: row.enteredCount ?? 0,
      studentCount: row.studentCount ?? 0,
      canEnter: canMarkSubject(session, exam.class_id, row.subjectId),
    })),
    canEnter,
    rows: roster.map((row) => ({
      studentId: row.id,
      name: row.name,
      admissionNo: row.admission_no,
      rollNo: row.roll_no || '',
      sectionName: row.section_name || '',
      marksObtained: row.marks_obtained === null || row.marks_obtained === undefined ? null : round2(row.marks_obtained),
    })),
  };
}

/** A teacher may enter marks only for a subject they actually teach. */
function canMarkSubject(session, classId, subjectId) {
  if (acl.isAdminLike(session)) return true;
  if (!session || session.role !== 'teacher' || !subjectId) return false;
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM teacher_assignments
       WHERE teacher_id = ? AND class_id = ? AND subject_id = ? AND is_active = 1 LIMIT 1`,
    )
    .get(session.linkedId, classId, subjectId);
  return !!row;
}

function assertMarkAccess(session, classId, subjectId, exam) {
  if (exam && (exam.status !== 'marks_open' && exam.status !== 'published')) {
    throw new AppError('EXAM_NOT_OPEN', 'EXAM_NOT_OPEN');
  }
  if (!canMarkSubject(session, classId, subjectId)) throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

/**
 * Saves one paper for many students at once.
 * - a mark above the paper total or below zero is refused
 * - a student who is not on the exam roster is refused
 * - a blank mark clears the cell rather than storing 0
 */
function saveMarks({ examSubjectId, marks }, session) {
  const clean = validate({ examSubjectId, marks }, {
    examSubjectId: helpers.int({ min: 1, required: true }),
    marks: helpers.array({ required: true }),
  });

  const db = getDb();
  const examSubject = db
    .prepare(
      `SELECT es.*, e.class_id, e.status, e.is_locked FROM exam_subjects es
       JOIN exams e ON e.id = es.exam_id WHERE es.id = ? AND e.is_deleted = 0`,
    )
    .get(clean.examSubjectId);
  if (!examSubject) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  if (examSubject.is_locked) throw new AppError('EXAM_LOCKED', 'EXAM_LOCKED');

  assertMarkAccess(session, examSubject.class_id, examSubject.subject_id, examSubject);

  const roster = new Set(
    db
      .prepare(`SELECT id FROM students WHERE class_id = ? AND is_deleted = 0 AND status = 'active'`)
      .all(examSubject.class_id)
      .map((r) => r.id),
  );

  const prepared = clean.marks.map((raw) => {
    const row = validate(raw, {
      studentId: helpers.int({ min: 1, required: true }),
      marksObtained: helpers.number({ min: 0, max: 100000 }),
    });
    if (!roster.has(row.studentId)) throw new ValidationError({ studentId: 'invalid' });
    if (row.marksObtained !== undefined && row.marksObtained > examSubject.total_marks) {
      throw new ValidationError({ marksObtained: 'max' });
    }
    return { studentId: row.studentId, marksObtained: row.marksObtained ?? null };
  });

  const upsert = db.prepare(
    `INSERT INTO marks (exam_id, exam_subject_id, student_id, marks_obtained, entered_by)
     VALUES (@examId, @examSubjectId, @studentId, @marksObtained, @by)
     ON CONFLICT(exam_subject_id, student_id) DO UPDATE
       SET marks_obtained = excluded.marks_obtained,
           entered_by = excluded.entered_by,
           updated_at = datetime('now')`,
  );

  const run = db.transaction(() => {
    for (const row of prepared) {
      upsert.run({
        examId: examSubject.exam_id,
        examSubjectId: clean.examSubjectId,
        studentId: row.studentId,
        marksObtained: row.marksObtained,
        by: session.userId,
      });
    }
  });
  run();

  audit.log({
    action: 'exam.marks',
    entity: 'marks',
    entityId: clean.examSubjectId,
    details: { count: prepared.length },
    session,
  });
  return markSheet({ examSubjectId: clean.examSubjectId }, session);
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Grade for a percentage, from the editable scale in Settings.
 * Bands are inclusive at both ends; the scale is validated so they never
 * overlap, which is what makes the lookup unambiguous.
 */
function gradeFor(scale, percentage) {
  const match = scale.find((g) => percentage >= g.minPercentage && percentage <= g.maxPercentage);
  return match ? { grade: match.name, gradePoint: match.gradePoint } : { grade: null, gradePoint: 0 };
}

/**
 * Recomputes every result of an exam from the marks on record.
 *
 * A student with no mark for one paper is skipped rather than scored on the
 * papers they sat - the totals always describe what was actually entered.
 * `is_pass` requires *every* paper to be at or above its own pass mark, so a
 * high average cannot carry a failed subject.
 */
function computeResults({ examId } = {}, session) {
  assertAdmin(session);
  const clean = validate({ examId }, { examId: helpers.int({ min: 1, required: true }) });

  const db = getDb();
  const exam = db.prepare(`SELECT * FROM exams WHERE id = ? AND is_deleted = 0`).get(clean.examId);
  if (!exam) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  if (exam.is_locked) throw new AppError('EXAM_LOCKED', 'EXAM_LOCKED');

  const subjects = db.prepare(`SELECT * FROM exam_subjects WHERE exam_id = ?`).all(clean.examId);
  if (subjects.length === 0) throw new ValidationError({ subjects: 'required' });

  const scale = settingsGradeScale();
  const students = db
    .prepare(`SELECT id FROM students WHERE class_id = ? AND is_deleted = 0 AND status = 'active' ORDER BY id`)
    .all(exam.class_id);

  const bySubject = new Map();
  const markStmt = db.prepare(
    `SELECT student_id, marks_obtained FROM marks WHERE exam_subject_id = ? AND marks_obtained IS NOT NULL`,
  );
  for (const subject of subjects) {
    const map = new Map();
    for (const row of markStmt.all(subject.id)) map.set(row.student_id, row.marks_obtained);
    bySubject.set(subject.id, map);
  }

  const computed = [];
  for (const student of students) {
    let total = 0;
    let obtained = 0;
    let satAll = true;
    let passAll = true;

    for (const subject of subjects) {
      total += subject.total_marks;
      const mark = bySubject.get(subject.id).get(student.id);
      if (mark === undefined) {
        satAll = false;
        continue;
      }
      obtained += mark;
      if (mark < subject.pass_marks) passAll = false;
    }

    if (!satAll) continue; // incomplete paper set - not scored

    const percentage = total > 0 ? (obtained / total) * 100 : 0;
    const { grade, gradePoint } = gradeFor(scale, percentage);
    computed.push({
      studentId: student.id,
      totalMarks: round2(total),
      obtainedMarks: round2(obtained),
      percentage: round2(percentage),
      grade,
      gradePoint,
      isPass: passAll ? 1 : 0,
    });
  }

  // Position: 1 = highest percentage. Ties share a position (1,1,3).
  computed.sort((a, b) => b.percentage - a.percentage);
  let lastPct = null;
  let lastPosition = 0;
  computed.forEach((row, index) => {
    if (row.percentage !== lastPct) {
      lastPosition = index + 1;
      lastPct = row.percentage;
    }
    row.position = lastPosition;
  });

  const upsert = db.prepare(
    `INSERT INTO results (student_id, exam_id, total_marks, obtained_marks, percentage, grade, grade_point, position, is_pass, computed_at)
     VALUES (@studentId, @examId, @totalMarks, @obtainedMarks, @percentage, @grade, @gradePoint, @position, @isPass, datetime('now'))
     ON CONFLICT(student_id, exam_id) DO UPDATE SET
       total_marks = excluded.total_marks,
       obtained_marks = excluded.obtained_marks,
       percentage = excluded.percentage,
       grade = excluded.grade,
       grade_point = excluded.grade_point,
       position = excluded.position,
       is_pass = excluded.is_pass,
       computed_at = datetime('now')`,
  );
  const remove = db.prepare(`DELETE FROM results WHERE exam_id = ? AND student_id = ?`);

  const run = db.transaction(() => {
    const keep = new Set(computed.map((r) => r.studentId));
    const stale = db.prepare(`SELECT student_id FROM results WHERE exam_id = ?`).all(clean.examId);
    for (const row of stale) {
      if (!keep.has(row.student_id)) remove.run(clean.examId, row.student_id);
    }
    for (const row of computed) upsert.run({ ...row, examId: clean.examId });
  });
  run();

  audit.log({
    action: 'exam.compute',
    entity: 'results',
    entityId: clean.examId,
    details: { students: computed.length },
    session,
  });

  return { ...stats(clean.examId, session), computed: computed.length };
}

/** Aggregate numbers for one exam - pass rate, average, grade spread, positions. */
function stats(examId, session) {
  const db = getDb();
  const exam = db.prepare(`SELECT id FROM exams WHERE id = ? AND is_deleted = 0`).get(examId);
  if (!exam) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  if (session.role === 'teacher') {
    const row = db.prepare(`SELECT class_id FROM exams WHERE id = ?`).get(examId);
    acl.assertClassAccess(session, row.class_id);
  }

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS results,
              COALESCE(SUM(CASE WHEN is_pass = 1 THEN 1 ELSE 0 END),0) AS passed,
              COALESCE(AVG(percentage),0) AS average,
              COALESCE(MAX(percentage),0) AS highest,
              COALESCE(MIN(percentage),0) AS lowest
       FROM results WHERE exam_id = ?`,
    )
    .get(examId);

  return {
    examId,
    results: totals.results,
    passed: totals.passed,
    failed: totals.results - totals.passed,
    passPercentage: totals.results ? round2((totals.passed / totals.results) * 100) : 0,
    averagePercentage: round2(totals.average),
    highestPercentage: round2(totals.highest),
    lowestPercentage: totals.results ? round2(totals.lowest) : 0,
    gradeDistribution: db
      .prepare(
        `SELECT COALESCE(grade,'-') AS grade, COUNT(*) AS count
         FROM results WHERE exam_id = ? GROUP BY grade ORDER BY MAX(percentage) DESC`,
      )
      .all(examId),
    toppers: db
      .prepare(
        `SELECT r.student_id AS studentId, st.name, st.admission_no, r.percentage, r.grade, r.position
         FROM results r JOIN students st ON st.id = r.student_id
         WHERE r.exam_id = ? ORDER BY r.percentage DESC, st.name LIMIT 5`,
      )
      .all(examId),
  };
}

/**
 * The class result sheet: every student with their per-subject marks, total,
 * grade and position. Teachers only ever get classes they are assigned to.
 */
function resultSheet({ examId, sectionId, search } = {}, session) {
  const clean = validate({ examId, sectionId, search }, {
    examId: helpers.int({ min: 1, required: true }),
    sectionId: helpers.int({ min: 1 }),
    search: helpers.text({ max: 100, default: '' }),
  });

  const db = getDb();
  const exam = db.prepare(`SELECT * FROM exams WHERE id = ? AND is_deleted = 0`).get(clean.examId);
  if (!exam) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  if (session.role === 'teacher') acl.assertClassAccess(session, exam.class_id);
  else assertAdmin(session);

  const subjects = db
    .prepare(
      `SELECT es.id, es.subject_id AS subjectId, s.name AS subjectName, es.total_marks AS totalMarks
       FROM exam_subjects es JOIN subjects s ON s.id = es.subject_id
       WHERE es.exam_id = ? ORDER BY es.sort_order, s.name`,
    )
    .all(clean.examId);

  const where = ['st.class_id = @classId', 'st.is_deleted = 0'];
  const params = { classId: exam.class_id };
  if (clean.sectionId) {
    where.push('st.section_id = @sectionId');
    params.sectionId = clean.sectionId;
  }
  if (clean.search) {
    where.push('(st.name LIKE @search OR st.admission_no LIKE @search OR st.roll_no LIKE @search)');
    params.search = `%${clean.search}%`;
  }

  const rows = db
    .prepare(
      `SELECT st.id AS studentId, st.name, st.admission_no AS admissionNo, st.roll_no AS rollNo,
              sec.name AS sectionName, r.total_marks AS totalMarks, r.obtained_marks AS obtainedMarks,
              r.percentage, r.grade, r.grade_point AS gradePoint, r.position, r.is_pass AS isPass
       FROM students st
       LEFT JOIN sections sec ON sec.id = st.section_id
       LEFT JOIN results r ON r.student_id = st.id AND r.exam_id = @examId
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(r.position, 9999), sec.name, st.roll_no, st.name`,
    )
    .all({ ...params, examId: clean.examId });

  const markStmt = db.prepare(`SELECT marks_obtained FROM marks WHERE exam_subject_id = ? AND student_id = ?`);
  const subjectIds = subjects.map((s) => s.id);

  return {
    exam: {
      id: exam.id,
      name: exam.name,
      classId: exam.class_id,
      className: db.prepare(`SELECT name FROM classes WHERE id = ?`).get(exam.class_id)?.name || '',
      status: exam.status,
      startDate: exam.start_date,
      endDate: exam.end_date,
    },
    subjects: subjects.map((s) => ({ id: s.subjectId, name: s.subjectName, totalMarks: s.totalMarks })),
    rows: rows.map((row) => ({
      studentId: row.studentId,
      name: row.name,
      admissionNo: row.admissionNo,
      rollNo: row.rollNo || '',
      sectionName: row.sectionName || '',
      totalMarks: row.totalMarks ?? null,
      obtainedMarks: row.obtainedMarks ?? null,
      percentage: row.percentage ?? null,
      grade: row.grade || null,
      gradePoint: row.gradePoint ?? null,
      position: row.position ?? null,
      isPass: row.isPass === null ? null : !!row.isPass,
      marks: Object.fromEntries(
        subjects.map((s, index) => {
          const value = subjectIds.length ? markStmt.get(subjectIds[index], row.studentId) : null;
          return [s.subjectId, value ? round2(value.marks_obtained) : null];
        }),
      ),
    })),
    stats: stats(clean.examId, session),
  };
}

// ---------------------------------------------------------------------------
// Report cards
// ---------------------------------------------------------------------------

/** One student's full result for one exam - everything the printed card needs. */
function reportCard({ studentId, examId } = {}, session) {
  const clean = validate({ studentId, examId }, {
    studentId: helpers.int({ min: 1 }),
    examId: helpers.int({ min: 1 }),
  });

  const db = getDb();

  let targetStudent = clean.studentId ?? null;
  let targetExam = clean.examId ?? null;

  // A student has no id in the renderer - it is resolved here, always.
  if (session.role === 'student') {
    const own = acl.ownStudentId(session);
    if (targetStudent && targetStudent !== own) throw new AppError('FORBIDDEN', 'FORBIDDEN');
    targetStudent = own;
    targetExam = targetExam ?? latestPublishedExam(db, own);
  }

  if (!targetStudent) throw new ValidationError({ studentId: 'required' });
  acl.assertStudentAccess(session, targetStudent);

  const exam = db
    .prepare(`SELECT e.*, c.name AS class_name FROM exams e LEFT JOIN classes c ON c.id = e.class_id
              WHERE e.id = ? AND e.is_deleted = 0`)
    .get(targetExam);
  if (!exam) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  // A student may only read a result that has actually been published.
  if (session.role === 'student' && exam.status !== 'published' && exam.status !== 'locked') {
    throw new AppError('RESULT_NOT_PUBLISHED', 'RESULT_NOT_PUBLISHED');
  }
  if (session.role === 'teacher') acl.assertClassAccess(session, exam.class_id);

  const student = db
    .prepare(
      `SELECT st.*, c.name AS class_name, sec.name AS section_name FROM students st
       LEFT JOIN classes c ON c.id = st.class_id LEFT JOIN sections sec ON sec.id = st.section_id
       WHERE st.id = ? AND st.is_deleted = 0`,
    )
    .get(targetStudent);
  if (!student) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const subjects = db
    .prepare(
      `SELECT es.id, es.subject_id AS subjectId, s.name AS subjectName, es.total_marks AS totalMarks,
              es.pass_marks AS passMarks, es.sort_order AS sortOrder
       FROM exam_subjects es JOIN subjects s ON s.id = es.subject_id
       WHERE es.exam_id = ? ORDER BY es.sort_order, s.name`,
    )
    .all(exam.id);

  const markStmt = db.prepare(
    `SELECT marks_obtained FROM marks WHERE exam_subject_id = ? AND student_id = ? AND marks_obtained IS NOT NULL`,
  );

  const items = subjects.map((subject) => {
    const row = markStmt.get(subject.id, targetStudent);
    const obtained = row ? round2(row.marks_obtained) : null;
    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      totalMarks: subject.totalMarks,
      passMarks: subject.passMarks,
      obtainedMarks: obtained,
      percentage: obtained === null ? null : round2((obtained / subject.totalMarks) * 100),
      isPass: obtained === null ? null : obtained >= subject.passMarks,
    };
  });

  const result = db.prepare(`SELECT * FROM results WHERE student_id = ? AND exam_id = ?`).get(targetStudent, exam.id);

  const attendance = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END),0) AS present,
              COALESCE(SUM(CASE WHEN status = 'absent'  THEN 1 ELSE 0 END),0) AS absent,
              COALESCE(SUM(CASE WHEN status = 'leave'   THEN 1 ELSE 0 END),0) AS leaveDays
       FROM student_attendance
       WHERE student_id = ? AND date BETWEEN COALESCE((SELECT start_date FROM exams WHERE id = ?), '0000-01-01')
                                      AND COALESCE((SELECT end_date FROM exams WHERE id = ?), '9999-12-31')`,
    )
    .get(targetStudent, exam.id, exam.id);

  const positionTied = db
    .prepare(`SELECT COUNT(*) AS n FROM results WHERE exam_id = ? AND position = ?`)
    .get(exam.id, result?.position ?? 0).n;

  return {
    school: schoolProfile(),
    exam: {
      id: exam.id,
      name: exam.name,
      startDate: exam.start_date,
      endDate: exam.end_date,
      sessionName: db.prepare(`SELECT name FROM academic_sessions WHERE id = ?`).get(exam.session_id)?.name || null,
    },
    student: {
      id: student.id,
      name: student.name,
      admissionNo: student.admission_no,
      rollNo: student.roll_no || '',
      className: student.class_name || '',
      sectionName: student.section_name || '',
      fatherName: student.father_name || '',
      photoPath: student.photo_path || null,
    },
    items,
    result: result
      ? {
          totalMarks: round2(result.total_marks),
          obtainedMarks: round2(result.obtained_marks),
          percentage: round2(result.percentage),
          grade: result.grade,
          gradePoint: result.grade_point,
          position: result.position,
          isPass: !!result.is_pass,
          tied: positionTied > 1,
        }
      : null,
    attendance: {
      total: attendance.total,
      present: attendance.present,
      absent: attendance.absent,
      leave: attendance.leaveDays,
      percentage: attendance.total ? round2((attendance.present / attendance.total) * 100) : null,
    },
  };
}

function latestPublishedExam(db, studentId) {
  const row = db
    .prepare(
      `SELECT e.id FROM exams e
       JOIN students st ON st.class_id = e.class_id
       WHERE st.id = ? AND e.is_deleted = 0 AND e.status IN ('published','locked')
       ORDER BY COALESCE(e.end_date, e.created_at) DESC, e.id DESC LIMIT 1`,
    )
    .get(studentId);
  return row ? row.id : null;
}

/** School identity for the printed report card header. */
function schoolProfile() {
  const all = settings.getAll();
  return {
    name: all.school_name,
    address: all.school_address,
    phone: all.school_phone,
    email: all.school_email,
    footer: all.report_footer,
    session: all.session,
  };
}

/** Every exam a student has a published result for, newest first. */
function myResults(params = {}, session) {
  if (!session || session.role !== 'student') throw new AppError('FORBIDDEN', 'FORBIDDEN');
  const studentId = acl.ownStudentId(session);
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT e.id AS examId, e.name AS examName, e.end_date AS examDate,
              c.name AS className, sec.name AS sectionName,
              r.total_marks AS totalMarks, r.obtained_marks AS obtainedMarks,
              r.percentage, r.grade, r.grade_point AS gradePoint, r.position, r.is_pass AS isPass,
              (SELECT COUNT(*) FROM results r2 WHERE r2.exam_id = e.id AND r2.position = r.position) AS tied
       FROM results r
       JOIN exams e ON e.id = r.exam_id
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN sections sec ON sec.id = (SELECT section_id FROM students WHERE id = @studentId)
       WHERE r.student_id = @studentId AND e.is_deleted = 0 AND e.status IN ('published','locked')
       ORDER BY COALESCE(e.end_date, e.created_at) DESC, e.id DESC`,
    )
    .all({ studentId });

  return {
    rows: rows.map((row) => ({
      examId: row.examId,
      examName: row.examName,
      examDate: row.examDate,
      className: row.className || '',
      sectionName: row.sectionName || '',
      totalMarks: round2(row.totalMarks),
      obtainedMarks: round2(row.obtainedMarks),
      percentage: round2(row.percentage),
      grade: row.grade,
      gradePoint: row.gradePoint,
      position: row.position,
      isPass: !!row.isPass,
      tied: row.tied > 1,
    })),
  };
}

module.exports = {
  STATUSES,
  TRANSITIONS,
  listTypes,
  list,
  getExam,
  saveExam,
  deleteExam,
  setStatus,
  saveSubjects,
  markSheet,
  saveMarks,
  computeResults,
  stats,
  resultSheet,
  reportCard,
  myResults,
  canMarkSubject,
};