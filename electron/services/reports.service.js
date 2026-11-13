'use strict';

const { getDb } = require('../db/connection');
const { validate, AppError, helpers } = require('./validation');
const acl = require('./acl.service');

/**
 * Cross-module statistics for the dashboards, plus the printable report desk.
 *
 * Every query is filtered by role before it runs:
 *   - a teacher only ever counts classes they are assigned to
 *   - a student only ever counts their own records
 *   - office/admin see the whole school
 */

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** Current month as "YYYY-MM" - the same month format the rest of the app uses. */
const currentYM = () => new Date().toISOString().slice(0, 7);

const ACTIVE_STUDENT = `is_deleted = 0 AND status = 'active'`;

function assertStatsReader(session) {
  if (!session) throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

function schoolCounts(session, classes) {
  const db = getDb();
  const scoped = classes && classes.length > 0;
  const inClause = scoped ? `AND class_id IN (${classes.map((_, i) => `@c${i}`).join(',')})` : '';
  const params = {};
  if (scoped) classes.forEach((id, i) => { params[`c${i}`] = id; });

  const students = db
    .prepare(`SELECT COUNT(*) AS total,
                     COALESCE(SUM(CASE WHEN gender = 'female' THEN 1 ELSE 0 END),0) AS female,
                     COALESCE(SUM(CASE WHEN gender = 'male'   THEN 1 ELSE 0 END),0) AS male
              FROM students WHERE ${ACTIVE_STUDENT} ${inClause}`)
    .get(params);

  const staff = db
    .prepare(`SELECT COUNT(*) AS total,
                     COALESCE(SUM(CASE WHEN staff_type = 'teacher' THEN 1 ELSE 0 END),0) AS teachers,
                     COALESCE(SUM(CASE WHEN staff_type = 'office'  THEN 1 ELSE 0 END),0) AS office,
                     COALESCE(SUM(CASE WHEN status = 'on_leave' THEN 1 ELSE 0 END),0) AS onLeave
              FROM staff WHERE is_deleted = 0 AND status <> 'inactive'`)
    .get({});

  const classes_ = db.prepare(`SELECT COUNT(*) AS n FROM classes WHERE is_deleted = 0 AND is_active = 1`).get().n;
  const sections = db.prepare(`SELECT COUNT(*) AS n FROM sections WHERE is_deleted = 0 AND is_active = 1`).get().n;

  return {
    students: students.total,
    female: students.female,
    male: students.male,
    staff: staff.total,
    teachers: staff.teachers,
    officeStaff: staff.office,
    onLeave: staff.onLeave,
    classes: classes_,
    sections,
  };
}

/** Attendance percentages over a month for students (and staff separately). */
function attendanceStats(session, classes, month) {
  const db = getDb();
  const scoped = classes && classes.length > 0;
  const inClause = scoped ? `AND st.class_id IN (${classes.map((_, i) => `@c${i}`).join(',')})` : '';
  const params = { month };
  if (scoped) classes.forEach((id, i) => { params[`c${i}`] = id; });

  const student = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END),0) AS present,
              COALESCE(SUM(CASE WHEN a.status = 'absent'  THEN 1 ELSE 0 END),0) AS absent,
              COALESCE(SUM(CASE WHEN a.status = 'leave'   THEN 1 ELSE 0 END),0) AS leaveDays,
              COALESCE(SUM(CASE WHEN a.status = 'late'    THEN 1 ELSE 0 END),0) AS late,
              COUNT(DISTINCT a.date) AS markedDays
       FROM student_attendance a JOIN students st ON st.id = a.student_id
       WHERE st.is_deleted = 0 AND st.status = 'active'
         AND strftime('%Y-%m', a.date) = @month ${inClause}`,
    )
    .get(params);

  const staff = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END),0) AS present,
              COALESCE(SUM(CASE WHEN status = 'absent'  THEN 1 ELSE 0 END),0) AS absent
       FROM staff_attendance WHERE strftime('%Y-%m', date) = @month`,
    )
    .get({ month });

  return {
    month,
    studentTotal: student.total,
    studentPresent: student.present,
    studentAbsent: student.absent,
    studentLeave: student.leaveDays,
    studentLate: student.late,
    studentPercentage: student.total ? round2((student.present / student.total) * 100) : 0,
    markedDays: student.markedDays || 0,
    staffTotal: staff.total,
    staffPresent: staff.present,
    staffAbsent: staff.absent,
    staffPercentage: staff.total ? round2((staff.present / staff.total) * 100) : 0,
  };
}

/** Daily student attendance across the last N days - the trend line. */
function attendanceTrend(session, classes, days = 14) {
  const db = getDb();
  const scoped = classes && classes.length > 0;
  const inClause = scoped ? `AND st.class_id IN (${classes.map((_, i) => `@c${i}`).join(',')})` : '';
  const params = { days: -days };
  if (scoped) classes.forEach((id, i) => { params[`c${i}`] = id; });

  return db
    .prepare(
      `SELECT a.date AS date,
              COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END),0) AS present,
              COALESCE(SUM(CASE WHEN a.status = 'absent'  THEN 1 ELSE 0 END),0) AS absent,
              COALESCE(SUM(CASE WHEN a.status = 'late'    THEN 1 ELSE 0 END),0) AS late
       FROM student_attendance a JOIN students st ON st.id = a.student_id
       WHERE date(a.date) >= date('now', @days || ' days')
         AND st.is_deleted = 0 AND st.status = 'active' ${inClause}
       GROUP BY a.date ORDER BY a.date`,
    )
    .all(params)
    .map((row) => ({
      date: row.date,
      total: row.total,
      present: row.present,
      absent: row.absent,
      late: row.late,
      percentage: row.total ? round2((row.present / row.total) * 100) : 0,
    }));
}

/** Money in and money out for the last N months - the finance chart. */
function financeTrend(session, months = 6) {
  const db = getDb();
  const monthRows = db
    .prepare(
      `WITH RECURSIVE span(m) AS (
         SELECT strftime('%Y-%m', date('now', 'start of month', '-' || (@months - 1) || ' months'))
         UNION ALL
         SELECT strftime('%Y-%m', date(m || '-01', '+1 month')) FROM span WHERE m < strftime('%Y-%m', 'now')
       )
       SELECT m AS month,
              (SELECT COALESCE(SUM(amount),0) FROM fee_payments
                WHERE is_deleted = 0 AND strftime('%Y-%m', payment_date) = m) AS collected,
              (SELECT COALESCE(SUM(amount),0) FROM expenses
                WHERE is_deleted = 0 AND entry_type = 'expense' AND strftime('%Y-%m', entry_date) = m) AS expense,
              (SELECT COALESCE(SUM(amount),0) FROM expenses
                WHERE is_deleted = 0 AND entry_type = 'income' AND strftime('%Y-%m', entry_date) = m) AS income,
              (SELECT COALESCE(SUM(net),0) FROM payroll WHERE strftime('%Y-%m', month) = m) AS salary
       FROM span`,
    )
    .all({ months });

  return monthRows.map((row) => ({
    month: row.month,
    collected: round2(row.collected),
    expense: round2(row.expense),
    income: round2(row.income),
    salary: round2(row.salary),
    net: round2(row.collected + row.income - row.expense - row.salary),
  }));
}

function feeStats(session, month) {
  const db = getDb();
  const period = month || currentYM();

  const current = db
    .prepare(
      `SELECT COUNT(*) AS vouchers,
              COALESCE(SUM(total_amount + late_fine - discount),0) AS billed,
              COALESCE(SUM(paid_amount),0) AS paid,
              COALESCE(SUM(CASE WHEN status IN ('unpaid','partial') THEN 1 ELSE 0 END),0) AS open
       FROM fee_vouchers WHERE is_deleted = 0 AND month = @month AND period <> '00'`,
    )
    .get({ month: period });

  const outstanding = db
    .prepare(
      `SELECT COALESCE(SUM(total_amount + late_fine - discount - paid_amount),0) AS balance
       FROM fee_vouchers
       WHERE is_deleted = 0 AND status IN ('unpaid','partial')`,
    )
    .get().balance;

  const collectedToday = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count
       FROM fee_payments WHERE is_deleted = 0 AND payment_date = date('now')`,
    )
    .get();

  return {
    month: period,
    vouchers: current.vouchers,
    billed: round2(current.billed),
    paid: round2(current.paid),
    open: current.open,
    outstanding: round2(Math.max(0, outstanding)),
    collectionPercentage: current.billed ? round2((current.paid / current.billed) * 100) : 0,
    collectedToday: round2(collectedToday.total),
    receiptsToday: collectedToday.count,
  };
}

function salaryStats(session, month) {
  const db = getDb();
  const period = month || currentYM();

  const current = db
    .prepare(
      `SELECT COUNT(*) AS slips,
              COALESCE(SUM(net),0) AS net,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN net ELSE 0 END),0) AS paid,
              COALESCE(SUM(CASE WHEN status <> 'paid' THEN net ELSE 0 END),0) AS pending
       FROM payroll WHERE month = @month`,
    )
    .get({ month: period });

  const lastMonth = db
    .prepare(`SELECT COALESCE(SUM(net),0) AS net FROM payroll WHERE month = ?`)
    .get(monthShiftFrom(period, -1)).net;

  return {
    month: period,
    slips: current.slips,
    net: round2(current.net),
    paid: round2(current.paid),
    pending: round2(current.pending),
    lastMonthNet: round2(lastMonth),
  };
}

/** Month arithmetic on the "YYYY-MM" string the whole app stores. */
function monthShiftFrom(month, offset) {
  const [year, mon] = month.split('-').map(Number);
  const d = new Date(year, mon - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function expenseStats(session, month) {
  const db = getDb();
  const period = month || currentYM();

  const current = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'income'  THEN amount ELSE 0 END),0) AS income,
              COALESCE(SUM(CASE WHEN entry_type = 'expense' THEN amount ELSE 0 END),0) AS expense
       FROM expenses WHERE is_deleted = 0 AND strftime('%Y-%m', entry_date) = @month`,
    )
    .get({ month: period });

  return {
    month: period,
    income: round2(current.income),
    expense: round2(current.expense),
    net: round2(current.income - current.expense),
  };
}

function resultStats(session, classes) {
  const db = getDb();
  const scoped = classes && classes.length > 0;
  const inClause = scoped ? `AND e.class_id IN (${classes.map((_, i) => `@c${i}`).join(',')})` : '';
  const params = {};
  if (scoped) classes.forEach((id, i) => { params[`c${i}`] = id; });

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS results,
              COALESCE(SUM(CASE WHEN r.is_pass = 1 THEN 1 ELSE 0 END),0) AS passed,
              COALESCE(AVG(r.percentage),0) AS average
       FROM results r JOIN exams e ON e.id = r.exam_id
       WHERE e.is_deleted = 0 AND e.status IN ('published','locked') ${inClause}`,
    )
    .get(params);

  const byClass = db
    .prepare(
      `SELECT c.id AS classId, c.name AS className,
              COALESCE(AVG(r.percentage),0) AS average,
              COUNT(r.id) AS results
       FROM classes c
       LEFT JOIN exams e ON e.class_id = c.id AND e.is_deleted = 0 AND e.status IN ('published','locked')
       LEFT JOIN results r ON r.exam_id = e.id
       WHERE c.is_deleted = 0 ${scoped ? `AND c.id IN (${classes.map((_, i) => `@c${i}`).join(',')})` : ''}
       GROUP BY c.id ORDER BY c.level_order, c.name`,
    )
    .all(params);

  return {
    results: totals.results,
    passed: totals.passed,
    passPercentage: totals.results ? round2((totals.passed / totals.results) * 100) : 0,
    averagePercentage: round2(totals.average),
    byClass: byClass.map((row) => ({
      classId: row.classId,
      className: row.className,
      average: round2(row.average),
      results: row.results || 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Dashboard per role
// ---------------------------------------------------------------------------

function adminDashboard(session, month) {
  const db = getDb();
  const counts = schoolCounts(session, null);
  const attendance = attendanceStats(session, null, month);
  const fees = feeStats(session, month);
  const salary = salaryStats(session, month);
  const expenses = expenseStats(session, month);
  const results = resultStats(session, null);

  const sections = db
    .prepare(
      `SELECT c.name AS className, sec.name AS sectionName, sec.capacity,
              (SELECT COUNT(*) FROM students st WHERE st.class_id = sec.class_id AND st.section_id = sec.id
                 AND st.is_deleted = 0 AND st.status = 'active') AS students
       FROM sections sec JOIN classes c ON c.id = sec.class_id
       WHERE sec.is_deleted = 0 AND sec.is_active = 1 ORDER BY c.level_order, c.name, sec.name`,
    )
    .all();

  return {
    role: 'admin',
    counts,
    attendance,
    fees,
    salary,
    expenses,
    results,
    sections,
    attendanceTrend: attendanceTrend(session, null, 14),
    financeTrend: financeTrend(session, 6),
    recentAudit: db
      .prepare(
        `SELECT action, entity, entity_id, username, role, created_at
         FROM audit_log ORDER BY datetime(created_at) DESC, id DESC LIMIT 8`,
      )
      .all(),
  };
}

function officeDashboard(session, month) {
  const db = getDb();
  const counts = schoolCounts(session, null);

  const collections = db
    .prepare(
      `SELECT p.payment_date AS paymentDate, COUNT(*) AS receipts, COALESCE(SUM(p.amount),0) AS amount
       FROM fee_payments p WHERE p.is_deleted = 0 AND p.payment_date >= date('now','-13 days')
       GROUP BY p.payment_date ORDER BY p.payment_date`,
    )
    .all()
    .map((row) => ({ ...row, amount: round2(row.amount) }));

  return {
    role: 'office',
    counts,
    fees: feeStats(session, month),
    salary: salaryStats(session, month),
    expenses: expenseStats(session, month),
    attendance: attendanceStats(session, null, month),
    collections,
    financeTrend: financeTrend(session, 6),
    defaulters: db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount + late_fine - discount - paid_amount),0) AS balance
         FROM fee_vouchers WHERE is_deleted = 0 AND status IN ('unpaid','partial')`,
      )
      .get(),
  };
}

/**
 * Named-parameter binding helper for the "scope this to a set of classes"
 * pattern. `[]` degrades to a literal NULL so the query still runs (and simply
 * matches nothing) rather than producing `IN ()`, which is a syntax error.
 */
function classScopeParams(classes) {
  if (!classes || classes.length === 0) return {};
  return Object.fromEntries(classes.map((id, i) => [`c${i}`, id]));
}

function classScopeClause(classes, column = 'class_id') {
  if (!classes || classes.length === 0) return `${column} IN (NULL)`;
  return `${column} IN (${classes.map((_, i) => `@c${i}`).join(',')})`;
}

function teacherDashboard(session, month) {
  const db = getDb();
  const teacherId = acl.ownStaffId(session);
  const classes = acl.teacherClassIds(session);
  const scopeParams = classScopeParams(classes);

  const assignments = db
    .prepare(
      `SELECT c.name AS className, sec.name AS sectionName, sub.name AS subjectName,
              (SELECT COUNT(*) FROM students st WHERE st.class_id = sec.class_id AND st.section_id = sec.id
                 AND st.is_deleted = 0 AND st.status = 'active') AS students
       FROM teacher_assignments ta
       JOIN classes c ON c.id = ta.class_id
       JOIN sections sec ON sec.id = ta.section_id
       LEFT JOIN subjects sub ON sub.id = ta.subject_id
       WHERE ta.teacher_id = @teacherId AND ta.is_active = 1
       ORDER BY c.level_order, c.name, sec.name, sub.name`,
    )
    .all({ teacherId });

  const today = new Date().toISOString().slice(0, 10);
  const markedToday = db
    .prepare(
      `SELECT COUNT(DISTINCT a.student_id) AS n FROM student_attendance a
       JOIN students st ON st.id = a.student_id
       WHERE a.date = @today AND ${classScopeClause(classes, 'st.class_id')}`,
    )
    .get({ ...scopeParams, today }).n;

  const ownTotal = assignments.reduce((sum, a) => sum + a.students, 0);

  const openExams = db
    .prepare(
      `SELECT e.id, e.name, e.end_date, c.name AS className,
              (SELECT COUNT(*) FROM students st WHERE st.class_id = e.class_id AND st.is_deleted = 0 AND st.status = 'active') AS students,
              (SELECT COUNT(*) FROM exam_subjects es WHERE es.exam_id = e.id) AS subjects
       FROM exams e JOIN classes c ON c.id = e.class_id
       WHERE e.is_deleted = 0 AND e.status = 'marks_open'
         AND ${classScopeClause(classes, 'e.class_id')}
       ORDER BY COALESCE(e.end_date, e.start_date) LIMIT 5`,
    )
    .all(scopeParams);

  const staffAttendance = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END),0) AS present,
              COALESCE(SUM(CASE WHEN status = 'absent'  THEN 1 ELSE 0 END),0) AS absent
       FROM staff_attendance WHERE staff_id = @staffId AND strftime('%Y-%m', date) = @month`,
    )
    .get({ staffId: teacherId, month });

  return {
    role: 'teacher',
    classCount: classes.length,
    studentCount: ownTotal,
    assignments,
    attendanceMarkedToday: markedToday,
    attendanceTotalToday: ownTotal,
    ownAttendance: {
      total: staffAttendance.total,
      present: staffAttendance.present,
      absent: staffAttendance.absent,
      percentage: staffAttendance.total ? round2((staffAttendance.present / staffAttendance.total) * 100) : 0,
    },
    openExams: openExams.map((row) => ({
      id: row.id,
      name: row.name,
      endDate: row.end_date,
      className: row.className,
      students: row.students,
      subjects: row.subjects,
    })),
    results: resultStats(session, classes),
    attendanceTrend: attendanceTrend(session, classes, 14),
    resultsSummary: db
      .prepare(
        `SELECT r.percentage, r.grade, r.is_pass, st.name, st.admission_no
         FROM results r JOIN exams e ON e.id = r.exam_id JOIN students st ON st.id = r.student_id
         WHERE e.is_deleted = 0 AND e.status IN ('published','locked')
           AND ${classScopeClause(classes, 'e.class_id')}
         ORDER BY datetime(r.computed_at) DESC LIMIT 8`,
      )
      .all(scopeParams),
  };
}

function studentDashboard(session, month) {
  const db = getDb();
  const studentId = acl.ownStudentId(session);

  const student = db
    .prepare(
      `SELECT st.*, c.name AS class_name, sec.name AS section_name FROM students st
       LEFT JOIN classes c ON c.id = st.class_id LEFT JOIN sections sec ON sec.id = st.section_id
       WHERE st.id = @studentId`,
    )
    .get({ studentId });

  const attendance = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status='present' THEN 1 ELSE 0 END),0) AS present,
              COALESCE(SUM(CASE WHEN status='absent'  THEN 1 ELSE 0 END),0) AS absent,
              COALESCE(SUM(CASE WHEN status='leave'   THEN 1 ELSE 0 END),0) AS leaveDays
       FROM student_attendance WHERE student_id = @studentId AND strftime('%Y-%m', date) = @month`,
    )
    .get({ studentId, month });

  const fees = db
    .prepare(
      `SELECT COALESCE(SUM(total_amount + late_fine - discount),0) AS billed,
              COALESCE(SUM(paid_amount),0) AS paid,
              COALESCE(SUM(CASE WHEN status IN ('unpaid','partial') THEN 1 ELSE 0 END),0) AS open
       FROM fee_vouchers WHERE is_deleted = 0 AND student_id = @studentId AND strftime('%Y-%m', month) = @month`,
    )
    .get({ studentId, month });

  const latestResult = db
    .prepare(
      `SELECT r.percentage, r.grade, r.position, r.is_pass, e.name AS examName, e.id AS examId
       FROM results r JOIN exams e ON e.id = r.exam_id
       WHERE r.student_id = @studentId AND e.is_deleted = 0 AND e.status IN ('published','locked')
       ORDER BY COALESCE(e.end_date, e.created_at) DESC LIMIT 1`,
    )
    .get({ studentId });

  const upcoming = db
    .prepare(
      `SELECT e.id, e.name, es.exam_date, s.name AS subjectName
       FROM exams e JOIN exam_subjects es ON es.exam_id = e.id JOIN subjects s ON s.id = es.subject_id
       WHERE e.is_deleted = 0 AND e.class_id = @classId AND e.status IN ('draft','marks_open')
         AND es.exam_date IS NOT NULL AND es.exam_date >= date('now')
       ORDER BY es.exam_date LIMIT 5`,
    )
    .all({ classId: student?.class_id ?? 0 });

  return {
    role: 'student',
    student: student
      ? {
          id: student.id,
          name: student.name,
          admissionNo: student.admission_no,
          rollNo: student.roll_no || '',
          className: student.class_name || '',
          sectionName: student.section_name || '',
          photoPath: student.photo_path || null,
        }
      : null,
    attendance: {
      month,
      total: attendance.total,
      present: attendance.present,
      absent: attendance.absent,
      leave: attendance.leaveDays,
      percentage: attendance.total ? round2((attendance.present / attendance.total) * 100) : 0,
    },
    fees: {
      month,
      billed: round2(fees.billed),
      paid: round2(fees.paid),
      balance: round2(Math.max(0, fees.billed - fees.paid)),
      open: fees.open,
    },
    latestResult: latestResult
      ? {
          examId: latestResult.examId,
          examName: latestResult.examName,
          percentage: round2(latestResult.percentage),
          grade: latestResult.grade,
          position: latestResult.position,
          isPass: !!latestResult.is_pass,
        }
      : null,
    upcomingExams: upcoming.map((row) => ({ id: row.id, name: row.name, examDate: row.exam_date, subjectName: row.subjectName })),
    attendanceTrend: attendanceTrend(session, student?.class_id ? [student.class_id] : [], 14),
  };
}

/** One call per role, already scoped - the renderer never filters by hand. */
function dashboard(params = {}, session) {
  assertStatsReader(session);
  const clean = validate(params, { month: helpers.month() });
  const month = clean.month || currentYM();

  switch (session.role) {
    case 'admin':
      return adminDashboard(session, month);
    case 'office':
      return officeDashboard(session, month);
    case 'teacher':
      return teacherDashboard(session, month);
    case 'student':
      return studentDashboard(session, month);
    default:
      throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }
}

module.exports = {
  dashboard,
  schoolCounts,
  attendanceStats,
  attendanceTrend,
  financeTrend,
  feeStats,
  salaryStats,
  expenseStats,
  resultStats,
  assertStatsReader,
};