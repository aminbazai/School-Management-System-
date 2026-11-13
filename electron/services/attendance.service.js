'use strict';

const { getDb } = require('../db/connection');
const { validate, ValidationError, AppError, helpers } = require('./validation');
const audit = require('./audit.service');
const acl = require('./acl.service');
const settings = require('./settings.service');

/**
 * Attendance for students and staff, monthly registers, reports and leaves.
 *
 * Role rules (enforced here, not in the UI):
 *  - teachers only reach classes/sections assigned to them, and only for today,
 *  - students only ever read their own record,
 *  - admins and office can mark anything and edit history.
 */

const STATUSES = ['present', 'absent', 'leave', 'late', 'half_day'];
const STAFF_STATUSES = [...STATUSES, 'holiday'];

const today = () => new Date().toISOString().slice(0, 10);

function monthOf(date) {
  return String(date).slice(0, 7);
}

function assertMarkableDate(date, session) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    throw new ValidationError({ date: 'invalid' });
  }
  // Teachers may only touch today; office/admin may correct history.
  if (session.role === 'teacher' && date !== today()) {
    throw new AppError('EDIT_LOCKED', 'EDIT_LOCKED');
  }
  if (date > today()) throw new ValidationError({ date: 'invalid' });
}

// ---------------------------------------------------------------------------
// Student attendance - marking
// ---------------------------------------------------------------------------

/** Class roster with today's (or a given day's) marks, ready for the grid. */
function roster({ classId, sectionId, date }, session) {
  const clean = validate({ classId, sectionId, date: date || today() }, {
    classId: helpers.int({ min: 1 }),
    sectionId: helpers.int({ min: 1 }),
    date: helpers.date({ required: true }),
  });
  acl.assertClassAccess(session, clean.classId, clean.sectionId);

  const db = getDb();
  const students = db
    .prepare(
      `SELECT st.id, st.name, st.admission_no, st.roll_no,
              sa.status, sa.remarks, sa.marked_by
       FROM students st
       LEFT JOIN student_attendance sa ON sa.student_id = st.id AND sa.date = @date
       WHERE st.class_id = @classId AND st.section_id = @sectionId
         AND st.is_deleted = 0 AND st.status = 'active'
       ORDER BY COALESCE(NULLIF(st.roll_no, ''), st.name)`,
    )
    .all({ classId: clean.classId, sectionId: clean.sectionId, date: clean.date });

  const summary = students.reduce(
    (acc, s) => {
      if (s.status) acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    },
    { present: 0, absent: 0, leave: 0, late: 0, half_day: 0, unmarked: 0 },
  );
  summary.unmarked = students.filter((s) => !s.status).length;

  return { date: clean.date, students, summary, editable: canEdit(session, clean.date) };
}

function canEdit(session, date) {
  if (session.role === 'admin' || session.role === 'office') return true;
  return date === today();
}

/** Saves a whole class register for one day in a single transaction. */
function mark({ classId, sectionId, date, entries }, session) {
  const clean = validate({ classId, sectionId, date, entries }, {
    classId: helpers.int({ min: 1 }),
    sectionId: helpers.int({ min: 1 }),
    date: helpers.date({ required: true }),
    entries: helpers.array({ required: true, min: 1 }),
  });
  acl.assertClassAccess(session, clean.classId, clean.sectionId);
  assertMarkableDate(clean.date, session);

  const db = getDb();
  const rosterRows = db
    .prepare(`SELECT id FROM students WHERE class_id = ? AND section_id = ? AND is_deleted = 0 AND status = 'active'`)
    .all(clean.classId, clean.sectionId);
  const allowed = new Set(rosterRows.map((r) => r.id));

  const stmt = db.prepare(
    `INSERT INTO student_attendance (student_id, date, status, remarks, marked_by, updated_at)
     VALUES (@studentId, @date, @status, @remarks, @markedBy, datetime('now'))
     ON CONFLICT(student_id, date) DO UPDATE SET
       status = excluded.status, remarks = excluded.remarks,
       marked_by = excluded.marked_by, updated_at = datetime('now')`,
  );

  let saved = 0;
  const run = db.transaction(() => {
    for (const entry of clean.entries) {
      const studentId = Number(entry.studentId);
      if (!allowed.has(studentId)) continue;
      if (!STATUSES.includes(entry.status)) continue;
      stmt.run({
        studentId,
        date: clean.date,
        status: entry.status,
        remarks: entry.remarks ?? null,
        markedBy: session.userId,
      });
      saved += 1;
    }
  });
  run();

  audit.log({ action: 'attendance_mark', entity: 'student_attendance', details: { classId: clean.classId, sectionId: clean.sectionId, date: clean.date, saved }, session });
  return roster({ classId: clean.classId, sectionId: clean.sectionId, date: clean.date }, session);
}

/** Marks every unmarked student present in one call ("mark all present"). */
function markAllPresent({ classId, sectionId, date }, session) {
  const clean = validate({ classId, sectionId, date: date || today() }, {
    classId: helpers.int({ min: 1 }),
    sectionId: helpers.int({ min: 1 }),
    date: helpers.date({ required: true }),
  });
  acl.assertClassAccess(session, clean.classId, clean.sectionId);
  assertMarkableDate(clean.date, session);

  const current = roster(clean, session);
  const entries = current.students
    .filter((s) => !s.status)
    .map((s) => ({ studentId: s.id, status: 'present' }));

  if (!entries.length) return current;
  return mark({ ...clean, entries }, session);
}

// ---------------------------------------------------------------------------
// Student attendance - registers and reports
// ---------------------------------------------------------------------------

function summarise(counts) {
  const total = counts.present + counts.absent + counts.leave + counts.late + counts.half_day;
  const percentage = total === 0 ? 0 : Math.round(((counts.present + counts.late + counts.half_day * 0.5) / total) * 1000) / 10;
  return { total, percentage };
}

function emptyCounts() {
  return { present: 0, absent: 0, leave: 0, late: 0, half_day: 0 };
}

/** Class/section register for a month: one row per student. */
function register({ classId, sectionId, month }, session) {
  const clean = validate({ classId, sectionId, month: month || monthOf(today()) }, {
    classId: helpers.int({ min: 1 }),
    sectionId: helpers.int({ min: 1 }),
    month: helpers.month({ required: true }),
  });
  acl.assertClassAccess(session, clean.classId, clean.sectionId);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT st.id, st.name, st.admission_no, st.roll_no,
              SUM(CASE WHEN sa.status = 'present'  THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN sa.status = 'absent'   THEN 1 ELSE 0 END) AS absent,
              SUM(CASE WHEN sa.status = 'leave'    THEN 1 ELSE 0 END) AS leave_days,
              SUM(CASE WHEN sa.status = 'late'     THEN 1 ELSE 0 END) AS late,
              SUM(CASE WHEN sa.status = 'half_day' THEN 1 ELSE 0 END) AS half_day,
              COUNT(sa.id) AS marked
       FROM students st
       LEFT JOIN student_attendance sa
              ON sa.student_id = st.id AND substr(sa.date, 1, 7) = @month
       WHERE st.class_id = @classId AND st.section_id = @sectionId
         AND st.is_deleted = 0 AND st.status = 'active'
       GROUP BY st.id
       ORDER BY COALESCE(NULLIF(st.roll_no, ''), st.name)`,
    )
    .all({ classId: clean.classId, sectionId: clean.sectionId, month: clean.month });

  const students = rows.map((row) => {
    const counts = {
      present: row.present || 0,
      absent: row.absent || 0,
      leave: row.leave_days || 0,
      late: row.late || 0,
      half_day: row.half_day || 0,
    };
    const { total, percentage } = summarise(counts);
    return {
      id: row.id,
      name: row.name,
      admissionNo: row.admission_no,
      rollNo: row.roll_no,
      ...counts,
      marked: row.marked || 0,
      percentage,
    };
  });

  return {
    month: clean.month,
    classId: clean.classId,
    sectionId: clean.sectionId,
    students,
    threshold: LOW_THRESHOLD,
    low: students.filter((s) => s.percentage < LOW_THRESHOLD).length,
  };
}

const LOW_THRESHOLD = 75;

/** Students below the attendance threshold for a month (optionally one class). */
function lowAttendance({ month, classId = null, threshold = LOW_THRESHOLD }, session) {
  const clean = validate({ month: month || monthOf(today()), classId, threshold }, {
    month: helpers.month({ required: true }),
    classId: helpers.int({ min: 1 }),
    threshold: helpers.int({ min: 1, max: 100, default: LOW_THRESHOLD }),
  });
  const db = getDb();
  const params = { month: clean.month };
  let filter = '';

  if (clean.classId) {
    acl.assertClassAccess(session, clean.classId);
    filter = ' AND st.class_id = @classId';
    params.classId = clean.classId;
  } else if (!acl.isAdminLike(session)) {
    // a teacher only ever sees the classes assigned to them
    const ids = acl.teacherClassIds(session);
    if (!ids.length) return [];
    ids.forEach((id, index) => {
      params[`cls${index}`] = id;
    });
    filter = ` AND st.class_id IN (${ids.map((_, index) => `@cls${index}`).join(', ')})`;
  }

  const rows = db
    .prepare(
      `SELECT st.id, st.name, st.admission_no, st.class_id, st.section_id, c.name AS class_name, sec.name AS section_name,
              COUNT(sa.id) AS marked,
              SUM(CASE WHEN sa.status = 'present'  THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN sa.status = 'absent'   THEN 1 ELSE 0 END) AS absent,
              SUM(CASE WHEN sa.status = 'late'     THEN 1 ELSE 0 END) AS late,
              SUM(CASE WHEN sa.status = 'half_day' THEN 1 ELSE 0 END) AS half_day
       FROM students st
       LEFT JOIN student_attendance sa ON sa.student_id = st.id AND substr(sa.date, 1, 7) = @month
       JOIN classes c ON c.id = st.class_id
       LEFT JOIN sections sec ON sec.id = st.section_id
       WHERE st.is_deleted = 0 AND st.status = 'active'${filter}
       GROUP BY st.id
       HAVING marked > 0`,
    )
    .all(params);

  return rows
    .map((row) => {
      const counts = {
        present: row.present || 0,
        absent: row.absent || 0,
        leave: 0,
        late: row.late || 0,
        half_day: row.half_day || 0,
      };
      const { total, percentage } = summarise(counts);
      return {
        id: row.id,
        name: row.name,
        admissionNo: row.admission_no,
        className: row.class_name,
        sectionName: row.section_name,
        percentage,
        ...counts,
        total,
      };
    })
    .filter((r) => r.percentage < clean.threshold)
    .sort((a, b) => a.percentage - b.percentage);
}

/** One student's daily history (calendar view) plus the month summary. */
function studentHistory({ studentId, month }, session) {
  // A student never chooses whose data they read: it is resolved from the
  // session in the main process, and asking for anyone else is a hard denial.
  let targetId = studentId ? Number(studentId) : null;
  if (session.role === 'student') {
    const own = acl.ownStudentId(session);
    if (targetId && targetId !== own) throw new AppError('FORBIDDEN', 'FORBIDDEN');
    targetId = own;
  }
  if (!targetId) throw new ValidationError({ studentId: 'required' });

  const clean = validate({ studentId: targetId, month: month || monthOf(today()) }, {
    studentId: helpers.int({ min: 1 }),
    month: helpers.month({}),
  });
  acl.assertStudentAccess(session, clean.studentId);

  const db = getDb();
  const student = db
    .prepare(`SELECT id, name, admission_no, class_id, section_id FROM students WHERE id = ? AND is_deleted = 0`)
    .get(clean.studentId);
  if (!student) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const days = db
    .prepare(
      `SELECT date, status, remarks FROM student_attendance
       WHERE student_id = ? AND substr(date, 1, 7) = ? ORDER BY date`,
    )
    .all(clean.studentId, clean.month);

  const counts = emptyCounts();
  days.forEach((d) => {
    if (counts[d.status] !== undefined) counts[d.status] += 1;
  });
  const { total, percentage } = summarise(counts);

  // yearly totals for the sparkline-style summary
  const yearly = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month,
              SUM(CASE WHEN status = 'present'  THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status = 'absent'   THEN 1 ELSE 0 END) AS absent,
              SUM(CASE WHEN status = 'late'     THEN 1 ELSE 0 END) AS late,
              SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) AS half_day,
              SUM(CASE WHEN status = 'leave'    THEN 1 ELSE 0 END) AS leave_days
       FROM student_attendance WHERE student_id = ? GROUP BY month ORDER BY month DESC LIMIT 12`,
    )
    .all(clean.studentId)
    .reverse()
    .map((row) => {
      const c = {
        present: row.present || 0,
        absent: row.absent || 0,
        leave: row.leave_days || 0,
        late: row.late || 0,
        half_day: row.half_day || 0,
      };
      const s = summarise(c);
      return { month: row.month, percentage: s.percentage, ...c };
    });

  return {
    student: {
      id: student.id,
      name: student.name,
      admissionNo: student.admission_no,
      classId: student.class_id,
      sectionId: student.section_id,
    },
    month: clean.month,
    days,
    counts,
    total,
    percentage,
    yearly,
  };
}

// ---------------------------------------------------------------------------
// Staff attendance
// ---------------------------------------------------------------------------

/** Staff list with their mark for a given day (office/admin screens). */
function staffDay({ date, staffType = null }, session) {
  const clean = validate({ date: date || today(), staffType }, {
    date: helpers.date({ required: true }),
    staffType: helpers.enum(['teacher', 'office', 'other']),
  });
  if (!acl.isAdminLike(session)) throw new AppError('FORBIDDEN', 'FORBIDDEN');

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT f.id, f.name, f.employee_code, f.designation, f.staff_type,
              sa.status, sa.check_in, sa.check_out, sa.remarks
       FROM staff f
       LEFT JOIN staff_attendance sa ON sa.staff_id = f.id AND sa.date = @date
       WHERE f.is_deleted = 0 AND f.status != 'inactive'
         AND (@staffType IS NULL OR f.staff_type = @staffType)
       ORDER BY f.staff_type, f.name`,
    )
    .all({ date: clean.date, staffType: clean.staffType ?? null });

  return { date: clean.date, editable: clean.date <= today(), staff: rows };
}

/** Saves staff attendance for a day. */
function markStaffDay({ date, entries }, session) {
  const clean = validate({ date, entries }, {
    date: helpers.date({ required: true }),
    entries: helpers.array({ required: true, min: 1 }),
  });
  if (!acl.isAdminLike(session)) throw new AppError('FORBIDDEN', 'FORBIDDEN');
  if (clean.date > today()) throw new ValidationError({ date: 'invalid' });

  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO staff_attendance (staff_id, date, status, check_in, check_out, remarks, marked_by, updated_at)
     VALUES (@staffId, @date, @status, @checkIn, @checkOut, @remarks, @markedBy, datetime('now'))
     ON CONFLICT(staff_id, date) DO UPDATE SET
       status = excluded.status, check_in = excluded.check_in, check_out = excluded.check_out,
       remarks = excluded.remarks, marked_by = excluded.marked_by, updated_at = datetime('now')`,
  );

  let saved = 0;
  const run = db.transaction(() => {
    for (const entry of clean.entries) {
      const status = entry.status;
      if (!STAFF_STATUSES.includes(status)) continue;
      const staff = db
        .prepare(`SELECT id FROM staff WHERE id = ? AND is_deleted = 0`)
        .get(Number(entry.staffId));
      if (!staff) continue;
      stmt.run({
        staffId: Number(entry.staffId),
        date: clean.date,
        status,
        checkIn: status === 'present' || status === 'late' ? entry.checkIn ?? '08:00' : null,
        checkOut: status === 'present' || status === 'late' ? entry.checkOut ?? '13:00' : null,
        remarks: entry.remarks ?? null,
        markedBy: session.userId,
      });
      saved += 1;
    }
  });
  run();

  audit.log({ action: 'staff_attendance_mark', entity: 'staff_attendance', details: { date: clean.date, saved }, session });
  return staffDay({ date: clean.date }, session);
}

/** Monthly summary for one staff member (own record for teachers). */
function staffMonth({ staffId, month }, session) {
  const clean = validate({ staffId, month: month || monthOf(today()) }, {
    staffId: helpers.int({ min: 1 }),
    month: helpers.month({ required: true }),
  });
  if (session.role === 'teacher' && Number(session.linkedId) !== clean.staffId) {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }
  if (!['teacher', 'admin', 'office'].includes(session.role)) throw new AppError('FORBIDDEN', 'FORBIDDEN');

  const db = getDb();
  const staff = db.prepare(`SELECT id, name, employee_code, designation, photo_path FROM staff WHERE id = ?`).get(clean.staffId);
  if (!staff) throw new AppError('NOT_FOUND', 'NOT_FOUND');

  const days = db
    .prepare(`SELECT date, status, check_in, check_out FROM staff_attendance WHERE staff_id = ? AND substr(date, 1, 7) = ? ORDER BY date`)
    .all(clean.staffId, clean.month);

  const counts = emptyCounts();
  days.forEach((d) => {
    if (counts[d.status] !== undefined) counts[d.status] += 1;
  });
  const workingDays = settings.get('working_days') || '';
  const { percentage } = summarise(counts);

  return {
    staff: {
      id: staff.id,
      name: staff.name,
      employeeCode: staff.employee_code,
      designation: staff.designation,
    },
    month: clean.month,
    days,
    counts,
    marked: days.length,
    percentage,
    workingDays: workingDays.split(',').filter(Boolean),
  };
}

/** Whole-school staff summary for the month (office/admin). */
function staffSummary({ month }, session) {
  const clean = validate({ month: month || monthOf(today()) }, { month: helpers.month({ required: true }) });
  if (!acl.isAdminLike(session)) throw new AppError('FORBIDDEN', 'FORBIDDEN');

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT f.id, f.name, f.employee_code, f.designation, f.staff_type,
              SUM(CASE WHEN sa.status = 'present'  THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN sa.status = 'absent'   THEN 1 ELSE 0 END) AS absent,
              SUM(CASE WHEN sa.status = 'leave'    THEN 1 ELSE 0 END) AS leave_days,
              SUM(CASE WHEN sa.status = 'late'     THEN 1 ELSE 0 END) AS late,
              SUM(CASE WHEN sa.status = 'half_day' THEN 1 ELSE 0 END) AS half_day,
              COUNT(sa.id) AS marked
       FROM staff f
       LEFT JOIN staff_attendance sa ON sa.staff_id = f.id AND substr(sa.date, 1, 7) = @month
       WHERE f.is_deleted = 0
       GROUP BY f.id
       ORDER BY f.staff_type, f.name`,
    )
    .all({ month: clean.month });

  return {
    month: clean.month,
    rows: rows.map((row) => {
      const counts = {
        present: row.present || 0,
        absent: row.absent || 0,
        leave: row.leave_days || 0,
        late: row.late || 0,
        half_day: row.half_day || 0,
      };
      const s = summarise(counts);
      return {
        id: row.id,
        name: row.name,
        employeeCode: row.employee_code,
        designation: row.designation,
        staffType: row.staff_type,
        marked: row.marked || 0,
        percentage: s.percentage,
        ...counts,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Student attendance - monthly grid (mark a whole month at once)
// ---------------------------------------------------------------------------
function daysInMonth(month) {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) return 0;
  return new Date(y, m, 0).getDate();
}

function monthDates(month) {
  const n = daysInMonth(month);
  const out = [];
  for (let d = 1; d <= n; d += 1) {
    out.push(`${month}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

function monthlyGrid({ classId, sectionId, month }, session) {
  const clean = validate({ classId, sectionId, month: month || monthOf(today()) }, {
    classId: helpers.int({ min: 1 }),
    sectionId: helpers.int({ min: 1 }),
    month: helpers.month({ required: true }),
  });
  acl.assertClassAccess(session, clean.classId, clean.sectionId);

  const db = getDb();
  const students = db
    .prepare(
      `SELECT st.id, st.name, st.admission_no, st.roll_no
       FROM students st
       WHERE st.class_id = @classId AND st.section_id = @sectionId
         AND st.is_deleted = 0 AND st.status = 'active'
       ORDER BY COALESCE(NULLIF(st.roll_no, ''), st.name)`,
    )
    .all({ classId: clean.classId, sectionId: clean.sectionId });

  const dates = monthDates(clean.month);
  const marks = db
    .prepare(
      `SELECT student_id, date, status FROM student_attendance
       WHERE substr(date, 1, 7) = @month
         AND student_id IN (SELECT id FROM students WHERE class_id = @classId AND section_id = @sectionId AND is_deleted = 0 AND status = 'active')`,
    )
    .all({ month: clean.month, classId: clean.classId, sectionId: clean.sectionId });

  const byStudent = new Map();
  for (const row of marks) {
    if (!byStudent.has(row.student_id)) byStudent.set(row.student_id, {});
    byStudent.get(row.student_id)[row.date] = row.status;
  }

  const rows = students.map((st) => {
    const dayMap = byStudent.get(st.id) || {};
    const days = {};
    for (const date of dates) days[date] = dayMap[date] || null;
    return {
      id: st.id,
      name: st.name,
      admissionNo: st.admission_no,
      rollNo: st.roll_no,
      days,
    };
  });

  return {
    month: clean.month,
    classId: clean.classId,
    sectionId: clean.sectionId,
    dates,
    dayNumbers: dates.map((d) => Number(d.slice(-2))),
    students: rows,
    editable: acl.isAdminLike(session) || session.role === 'office' || session.role === 'teacher',
  };
}

function markMonthly({ classId, sectionId, month, entries }, session) {
  const clean = validate({ classId, sectionId, month: month || monthOf(today()), entries }, {
    classId: helpers.int({ min: 1 }),
    sectionId: helpers.int({ min: 1 }),
    month: helpers.month({ required: true }),
    entries: helpers.array({ required: true, min: 1 }),
  });
  acl.assertClassAccess(session, clean.classId, clean.sectionId);

  const db = getDb();
  const rosterRows = db
    .prepare(`SELECT id FROM students WHERE class_id = ? AND section_id = ? AND is_deleted = 0 AND status = 'active'`)
    .all(clean.classId, clean.sectionId);
  const allowed = new Set(rosterRows.map((r) => r.id));
  const dates = new Set(monthDates(clean.month));

  const stmt = db.prepare(
    `INSERT INTO student_attendance (student_id, date, status, remarks, marked_by, updated_at)
     VALUES (@studentId, @date, @status, @remarks, @markedBy, datetime('now'))
     ON CONFLICT(student_id, date) DO UPDATE SET
       status = excluded.status, remarks = excluded.remarks,
       marked_by = excluded.marked_by, updated_at = datetime('now')`,
  );
  const del = db.prepare(`DELETE FROM student_attendance WHERE student_id = ? AND date = ?`);

  let saved = 0;
  const run = db.transaction(() => {
    for (const entry of clean.entries) {
      const studentId = Number(entry.studentId);
      if (!allowed.has(studentId)) continue;
      let date = entry.date;
      if (!date && entry.day != null) date = `${clean.month}-${String(entry.day).padStart(2, '0')}`;
      if (!dates.has(date)) continue;
      if (session.role === 'teacher' && date !== today()) continue;
      if (date > today()) continue;

      const status = entry.status;
      if (!status || status === '' || status === null) {
        del.run(studentId, date);
        saved += 1;
        continue;
      }
      if (!STATUSES.includes(status)) continue;
      stmt.run({
        studentId,
        date,
        status,
        remarks: entry.remarks ?? null,
        markedBy: session.userId,
      });
      saved += 1;
    }
  });
  run();

  audit.log({ action: 'attendance_mark', entity: 'student_attendance', details: { classId: clean.classId, sectionId: clean.sectionId, month: clean.month, saved }, session });
  return monthlyGrid({ classId: clean.classId, sectionId: clean.sectionId, month: clean.month }, session);
}

const monthGrid = monthlyGrid;
const monthlySheet = monthlyGrid;
const monthlyRegisterGrid = monthlyGrid;
const markMonth = markMonthly;
const saveMonthlyAttendance = markMonthly;
const monthlyMark = markMonthly;

module.exports = {
  STATUSES,
  STAFF_STATUSES,
  LOW_THRESHOLD,
  roster,
  mark,
  markAllPresent,
  register,
  lowAttendance,
  studentHistory,
  staffDay,
  markStaffDay,
  staffMonth,
  staffSummary,
  monthlyGrid,
  monthGrid,
  monthlySheet,
  monthlyRegisterGrid,
  markMonthly,
  markMonth,
  saveMonthlyAttendance,
  monthlyMark,
  summarise,
};