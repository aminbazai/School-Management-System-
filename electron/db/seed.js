'use strict';

const { hashPassword } = require('../services/auth.service');
const { logger } = require('../logger');

/**
 * Demo / test data. Runs only when the users table is empty.
 * Deterministic (seeded PRNG) so screenshots and manual testing are reproducible.
 */

const FIRST_NAMES = ['Ayesha', 'Bilal', 'Hina', 'Usman', 'Zainab', 'Hamza', 'Maryam', 'Ali', 'Fatima', 'Omar',
  'Sana', 'Yusuf', 'Amna', 'Tariq', 'Hafsa', 'Nabeel', 'Iqra', 'Salman', 'Mahnoor', 'Danish'];
const FATHER_NAMES = ['Muhammad Khan', 'Ali Raza', 'Usman Ghani', 'Tariq Mehmood', 'Nadeem Ahmed',
  'Shahid Iqbal', 'Javed Aslam', 'Imran Haider', 'Kashif Raza', 'Sajid Iqbal',
  'Waqar Ahmed', 'Adnan Sheikh', 'Faisal Iqbal', 'Haris Khan', 'Zeeshan Ali'];
const TEACHERS = [
  { code: 'T-001', name: 'Ahmed Khan', subject: 'Science', salary: 45000, designation: 'Senior Teacher' },
  { code: 'T-002', name: 'Sara Ali', subject: 'English', salary: 42000, designation: 'Teacher' },
  { code: 'T-003', name: 'Bilal Ahmed', subject: 'Mathematics', salary: 40000, designation: 'Teacher' },
];
const OFFICE_STAFF = { code: 'O-001', name: 'Fatima Noor', designation: 'Accountant', salary: 38000 };

function mulberry32(a) {
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const dayOffset = (base, offset) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);

function runSeedIfEmpty(db) {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_deleted = 0`).get().n;
  if (count > 0) {
    logger.info('seed skipped - database already has users');
    return false;
  }

  logger.info('seeding demo data ...');
  const seed = db.transaction(() => seedAll(db));
  seed();
  logger.info('seed complete');
  return true;
}

function seedAll(db) {
  const rand = mulberry32(20260101);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const today = new Date();
  const sessionYear = `${today.getFullYear()}-${today.getFullYear() + 1}`;

  // --- academic session -----------------------------------------------------
  const sessionId = db
    .prepare(`INSERT INTO academic_sessions (name, start_date, end_date, is_active) VALUES (?, ?, ?, 1)`)
    .run(sessionYear, `${today.getFullYear()}-04-01`, `${today.getFullYear() + 1}-03-31`).lastInsertRowid;

  // --- classes / sections ---------------------------------------------------
  const classRows = [
    { name: 'Play Group', order: 1 },
    { name: 'Nursery', order: 2 },
    { name: 'KG', order: 3 },
    { name: 'Class 1', order: 4 },
    { name: 'Class 2', order: 5 },
    { name: 'Class 3', order: 6 },
    { name: 'Class 4', order: 7 },
    { name: 'Class 5', order: 8 },
    { name: 'Class 6', order: 9 },
    { name: 'Class 7', order: 10 },
    { name: 'Class 8', order: 11 },
    { name: 'Class 9', order: 12 },
    { name: 'Class 10', order: 13 },
  ];
  // Migration 005 may have created the standard classes already; reuse them.
  const classes = classRows.map((c) => {
    const existing = db.prepare(`SELECT id FROM classes WHERE name = ? AND is_deleted = 0`).get(c.name);
    if (existing) return existing.id;
    return Number(db
      .prepare(`INSERT INTO classes (name, code, level_order) VALUES (?, ?, ?)`)
      .run(c.name, c.name.replace(/\s+/g, '').toUpperCase(), c.order).lastInsertRowid);
  });

  const sections = [];
  classes.forEach((classId, ci) => {
    ['A', 'B'].forEach((letter) => {
      const existing = db
        .prepare(`SELECT id FROM sections WHERE class_id = ? AND name = ? AND is_deleted = 0`)
        .get(classId, letter);
      const id = existing
        ? existing.id
        : Number(
            db
              .prepare(`INSERT INTO sections (class_id, name, capacity, room_no) VALUES (?, ?, 30, ?)`)
              .run(classId, letter, `R-${ci + 1}${letter}`).lastInsertRowid,
          );
      sections.push({ id, classId, name: letter });
    });
  });

  // --- subjects -------------------------------------------------------------
  const subjectNames = ['English', 'Urdu', 'Mathematics', 'Science', 'Social Studies', 'Islamiyat', 'Computer'];
  const subjects = subjectNames.map((name) =>
    Number(db.prepare(`INSERT INTO subjects (name, code) VALUES (?, ?)`).run(name, name.slice(0, 3).toUpperCase()).lastInsertRowid),
  );
  const subjectId = Object.fromEntries(subjectNames.map((n, i) => [n, subjects[i]]));

  classes.forEach((classId, ci) => {
    const list = ci === 0 ? ['English', 'Urdu', 'Islamiyat'] : subjectNames;
    list.forEach((name, idx) => {
      db.prepare(
        `INSERT INTO class_subjects (class_id, subject_id, max_marks, pass_marks, weekly_periods)
         VALUES (?, ?, 100, 40, ?)`,
      ).run(classId, subjectId[name], 3 + (idx % 3));
    });
  });

  // --- staff ---------------------------------------------------------------
  const staffIds = [];
  TEACHERS.forEach((t) => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO staff (employee_code, name, father_name, cnic, phone, qualification, designation, staff_type, joining_date, basic_salary, blood_group)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'teacher', ?, ?, ?)`,
        )
        .run(t.code, t.name, 'Muhammad ' + t.name.split(' ')[0], `3520${Math.floor(rand() * 899999) + 100000}-${Math.floor(rand() * 8999999) + 1000000}`,
          `030${Math.floor(rand() * 9)}-${Math.floor(rand() * 8999999) + 1000000}`,
          pick(['M.Sc', 'B.A', 'M.A', 'B.S.Ed']), t.designation,
          ymd(dayOffset(today, -400 - Math.floor(rand() * 400))), t.salary, pick(['A+', 'B+', 'O+', 'AB+'])).lastInsertRowid,
    );
    staffIds.push({ id, ...t });
  });

  const officeId = Number(
    db
      .prepare(
        `INSERT INTO staff (employee_code, name, cnic, phone, qualification, designation, staff_type, joining_date, basic_salary)
         VALUES (?, ?, ?, ?, ?, ?, 'office', ?, ?)`,
      )
      .run(OFFICE_STAFF.code, OFFICE_STAFF.name, `35202${Math.floor(rand() * 8999999) + 1000000}-${Math.floor(rand() * 8999999) + 1000000}`,
        `031${Math.floor(rand() * 9)}-${Math.floor(rand() * 8999999) + 1000000}`, 'M.Com', OFFICE_STAFF.designation,
        ymd(dayOffset(today, -600)), OFFICE_STAFF.salary).lastInsertRowid,
  );

  // --- users ---------------------------------------------------------------
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, role, linked_id, is_active, must_change_password, password_changed_at)
     VALUES (?, ?, ?, ?, 1, ?, datetime('now'))`,
  );
  const DEFAULT_PASSWORD = 'password123';
  insertUser.run('admin', hashPassword(DEFAULT_PASSWORD), 'admin', null, 0);
  insertUser.run('office', hashPassword(DEFAULT_PASSWORD), 'office', officeId, 0);
  staffIds.forEach((t, i) => insertUser.run(`teacher${i + 1}`, hashPassword(DEFAULT_PASSWORD), 'teacher', t.id, 0));
  insertUser.run('principal', hashPassword(DEFAULT_PASSWORD), 'admin', null, 0);

  // --- salary structures / allowances --------------------------------------
  [...staffIds, { id: officeId, salary: OFFICE_STAFF.salary }].forEach((s) => {
    db.prepare(`INSERT INTO salary_structures (staff_id, basic_salary, effective_from) VALUES (?, ?, ?)`)
      .run(s.id, s.salary, `${today.getFullYear()}-04-01`);
    db.prepare(`INSERT INTO allowances (staff_id, name, kind, amount) VALUES (?, 'House Rent', 'house', ?)`)
      .run(s.id, Math.round(s.salary * 0.4));
    db.prepare(`INSERT INTO allowances (staff_id, name, kind, amount) VALUES (?, 'Medical', 'medical', ?)`)
      .run(s.id, 5000);
    db.prepare(`INSERT INTO allowances (staff_id, name, kind, amount) VALUES (?, 'Transport', 'transport', ?)`)
      .run(s.id, 3000);
    db.prepare(`INSERT INTO deductions (staff_id, name, kind, is_percent, amount) VALUES (?, 'Income Tax', 'tax', 1, 5)`)
      .run(s.id);
  });

  // --- teacher assignments ---------------------------------------------------
  const assignmentPlan = [
    { teacher: 0, classIdx: 0, subject: 'English' },
    { teacher: 0, classIdx: 1, subject: 'Science' },
    { teacher: 0, classIdx: 2, subject: 'Science' },
    { teacher: 1, classIdx: 0, subject: 'Urdu' },
    { teacher: 1, classIdx: 1, subject: 'English' },
    { teacher: 1, classIdx: 2, subject: 'English' },
    { teacher: 2, classIdx: 0, subject: 'Mathematics' },
    { teacher: 2, classIdx: 1, subject: 'Mathematics' },
    { teacher: 2, classIdx: 2, subject: 'Mathematics' },
  ];
  assignmentPlan.forEach((plan) => {
    sections.filter((s) => s.classId === classes[plan.classIdx]).forEach((sec) => {
      db.prepare(
        `INSERT OR IGNORE INTO teacher_assignments (teacher_id, class_id, section_id, subject_id, academic_session_id)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(staffIds[plan.teacher].id, classes[plan.classIdx], sec.id, subjectId[plan.subject], sessionId);
    });
  });
  db.prepare(`UPDATE sections SET class_teacher_id = ? WHERE id = ?`).run(staffIds[0].id, sections[0].id);

  // --- students --------------------------------------------------------------
  const guardianCache = new Map();
  const studentIds = [];
  const perSection = 4;
  let counter = 0;
  for (const sec of sections) {
    for (let i = 0; i < perSection; i += 1) {
      counter += 1;
      const first = FIRST_NAMES[(counter - 1) % FIRST_NAMES.length];
      const last = 'Khan';
      const name = `${first} ${last}`;
      const admissionNo = `ADM-${today.getFullYear()}-${String(counter).padStart(3, '0')}`;
      const father = FATHER_NAMES[(counter - 1) % FATHER_NAMES.length];

      const studentId = Number(
        db
          .prepare(
            `INSERT INTO students (admission_no, gr_no, name, father_name, gender, dob, b_form, phone, address, class_id, section_id, admission_date, previous_school, roll_no, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
          )
          .run(
            admissionNo,
            `GR-${String(counter).padStart(3, '0')}`,
            name,
            father,
            counter % 2 === 0 ? 'female' : 'male',
            ymd(dayOffset(today, -1400 - Math.floor(rand() * 1500))),
            `37103${Math.floor(rand() * 8999999) + 1000000}`,
            `03${Math.floor(rand() * 9)}${Math.floor(rand() * 8999999) + 1000000}`,
            `${Math.floor(rand() * 90) + 1}, Block ${Math.floor(rand() * 20) + 1}, Lahore`,
            sec.classId,
            sec.id,
            ymd(dayOffset(today, -300 - Math.floor(rand() * 200))),
            'Previous School',
            String(i + 1),
          ).lastInsertRowid,
      );
      studentIds.push({ id: studentId, classId: sec.classId, sectionId: sec.id, admissionNo, name });
      const admissionDate = db.prepare(`SELECT admission_date FROM students WHERE id = ?`).get(studentId).admission_date;
      db.prepare(
        `INSERT INTO student_class_history (student_id, class_id, section_id, changed_at, note)
         VALUES (?, ?, ?, ?, 'Admission')`,
      ).run(studentId, sec.classId, sec.id, admissionDate);

      // Siblings: every 3rd student shares a guardian with the previous one (family grouping)
      let guardianId;
      if (counter % 3 === 0 && guardianCache.size > 0) {
        guardianId = [...guardianCache.values()][guardianCache.size - 1];
      } else {
        guardianId = Number(
          db
            .prepare(`INSERT INTO guardians (name, relation, cnic, phone, address) VALUES (?, 'father', ?, ?, ?)`)
            .run(father, `3520${Math.floor(rand() * 899999) + 100000}-${Math.floor(rand() * 8999999) + 1000000}`,
              `030${Math.floor(rand() * 9)}-${Math.floor(rand() * 8999999) + 1000000}`,
              `${Math.floor(rand() * 90) + 1}, Lahore`).lastInsertRowid,
        );
        guardianCache.set(father, guardianId);
      }
      db.prepare(`INSERT OR IGNORE INTO student_guardians (student_id, guardian_id, is_primary) VALUES (?, ?, 1)`).run(studentId, guardianId);
      db.prepare(
        `INSERT INTO users (username, password_hash, role, linked_id, is_active, must_change_password, password_changed_at)
         VALUES (?, ?, 'student', ?, 1, 0, datetime('now'))`,
      ).run(admissionNo.toLowerCase(), hashPassword('password123'), studentId);
    }
  }

  // --- student attendance (last 30 school days) --------------------------------
  const attendanceStatuses = ['present', 'present', 'present', 'present', 'present', 'present', 'late', 'absent', 'leave', 'half_day'];
  const insertAtt = db.prepare(
    `INSERT OR IGNORE INTO student_attendance (student_id, date, status, marked_by) VALUES (?, ?, ?, 1)`,
  );
  for (let back = 29; back >= 0; back -= 1) {
    const d = dayOffset(today, -back);
    if (d.getDay() === 0) continue; // Sunday holiday
    studentIds.forEach((s) => {
      const status = back === 0 ? 'present' : pick(attendanceStatuses);
      insertAtt.run(s.id, ymd(d), status);
    });
  }

  // --- staff attendance (current month) -----------------------------------------
  const insertStaffAtt = db.prepare(
    `INSERT OR IGNORE INTO staff_attendance (staff_id, date, status, check_in, check_out) VALUES (?, ?, ?, ?, ?)`,
  );
  [...staffIds, { id: officeId }].forEach((s) => {
    for (let back = 20; back >= 0; back -= 1) {
      const d = dayOffset(today, -back);
      if (d.getDay() === 0) continue;
      const status = pick(['present', 'present', 'present', 'late', 'present', 'absent']);
      insertStaffAtt.run(s.id, ymd(d), status, status === 'absent' ? null : '08:0' + Math.floor(rand() * 9), status === 'absent' ? null : '13:00');
    }
  });

  db.prepare(
    `INSERT INTO leaves (staff_id, leave_type, from_date, to_date, days, reason, status, decided_by, decided_at)
     VALUES (?, 'Sick', ?, ?, 2, 'Fever', 'approved', 1, datetime('now'))`,
  ).run(staffIds[1].id, ymd(dayOffset(today, -12)), ymd(dayOffset(today, -11)));

  // --- periods & timetable ------------------------------------------------------
  const periodDefs = [
    ['Assembly', '08:00', '08:30'],
    ['Period 1', '08:30', '09:15'],
    ['Period 2', '09:15', '10:00'],
    ['Period 3', '10:00', '10:45'],
    ['Break', '10:45', '11:00'],
    ['Period 4', '11:00', '11:45'],
    ['Period 5', '11:45', '12:30'],
  ];
  const periodIds = periodDefs.map(([name, start, end], i) =>
    Number(
      db
        .prepare(`INSERT INTO periods (name, start_time, end_time, sort_order, is_break) VALUES (?, ?, ?, ?, ?)`)
        .run(name, start, end, i + 1, name === 'Break' ? 1 : 0).lastInsertRowid,
    ),
  );

  const assignments = db
    .prepare(`SELECT * FROM teacher_assignments WHERE academic_session_id = ?`)
    .all(sessionId);

  sections.forEach((sec) => {
    const teaching = periodIds.filter((_, i) => i !== 0);
    for (let day = 1; day <= 5; day += 1) {
      teaching.forEach((periodId, slot) => {
        const match = assignments.filter((a) => a.section_id === sec.id);
        const a = match.length ? match[slot % match.length] : null;
        db.prepare(
          `INSERT OR IGNORE INTO timetable (class_id, section_id, teacher_id, subject_id, period_id, day_of_week, session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(sec.classId, sec.id, a ? a.teacher_id : null, a ? a.subject_id : null, periodId, day, sessionId);
      });
    }
  });

  // --- fees -----------------------------------------------------------------------
  const feeDefs = [
    { name: 'Admission Fee', fee_type: 'admission', frequency: 'one_time', amount: 5000 },
    { name: 'Monthly Tuition Fee', fee_type: 'tuition', frequency: 'monthly', amount: 3500 },
    { name: 'Exam Fee', fee_type: 'exam', frequency: 'yearly', amount: 2000 },
    { name: 'Transport Fee', fee_type: 'transport', frequency: 'monthly', amount: 2500 },
  ];
  // feeIds[classIndex][index] = { id, name, amount }
  const feeIds = classes.map((classId) =>
    feeDefs.map((f) => {
      const amount = f.amount + Math.floor(rand() * 5) * 250;
      const id = Number(
        db
          .prepare(`INSERT INTO fee_structures (class_id, name, fee_type, frequency, amount, session_id) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(classId, f.name, f.fee_type, f.frequency, amount, sessionId).lastInsertRowid,
      );
      return { id, name: f.name, amount };
    }),
  );

  const thisMonth = ym(today);
  const period = pad(today.getMonth() + 1);
  let receiptCounter = 1;
  studentIds.forEach((s, idx) => {
    const [admissionFee, tuitionFee, examFee, transportFee] = feeIds[classes.indexOf(s.classId)];
    const total = tuitionFee.amount + transportFee.amount;
    const voucherId = Number(
      db
        .prepare(
          `INSERT INTO fee_vouchers (voucher_no, student_id, class_id, month, period, due_date, total_amount, discount, late_fine, paid_amount, status, generated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'unpaid', 1)`,
        )
        .run(`VCH-${period}-${String(idx + 1).padStart(4, '0')}`, s.id, s.classId, thisMonth, period,
          ymd(new Date(today.getFullYear(), today.getMonth(), 10)), total).lastInsertRowid,
    );
    db.prepare(`INSERT INTO voucher_items (voucher_id, fee_structure_id, description, amount) VALUES (?, ?, ?, ?)`)
      .run(voucherId, tuitionFee.id, tuitionFee.name, tuitionFee.amount);
    db.prepare(`INSERT INTO voucher_items (voucher_id, fee_structure_id, description, amount) VALUES (?, ?, ?, ?)`)
      .run(voucherId, transportFee.id, transportFee.name, transportFee.amount);

    const roll = idx % 5;
    if (roll === 0) {
      const receiptNo = `RCP-${thisMonth.replace('-', '')}-${String(receiptCounter).padStart(4, '0')}`;
      receiptCounter += 1;
      db.prepare(
        `INSERT INTO fee_payments (voucher_id, receipt_no, amount, payment_date, method, collected_by)
         VALUES (?, ?, ?, ?, ?, 1)`,
      ).run(voucherId, receiptNo, total, ymd(dayOffset(today, -Math.floor(rand() * 20))), pick(['cash', 'bank']));
      db.prepare(`UPDATE fee_vouchers SET paid_amount = ?, status = 'paid' WHERE id = ?`).run(total, voucherId);
    } else if (roll === 1) {
      const partial = Math.round(total / 2);
      const receiptNo = `RCP-${thisMonth.replace('-', '')}-${String(receiptCounter).padStart(4, '0')}`;
      receiptCounter += 1;
      db.prepare(
        `INSERT INTO fee_payments (voucher_id, receipt_no, amount, payment_date, method, collected_by)
         VALUES (?, ?, ?, ?, ?, 1)`,
      ).run(voucherId, receiptNo, partial, ymd(dayOffset(today, -Math.floor(rand() * 15))), 'cash');
      db.prepare(`UPDATE fee_vouchers SET paid_amount = ?, status = 'partial' WHERE id = ?`).run(partial, voucherId);
    }

    // one-time admission fee voucher for the first 10 students
    // (period '00' keeps it clear of the monthly voucher's UNIQUE(student_id, period, month))
    if (idx < 10) {
      const info = db
        .prepare(
          `INSERT OR IGNORE INTO fee_vouchers (voucher_no, student_id, class_id, month, period, due_date, total_amount, discount, late_fine, paid_amount, status, generated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'paid', 1)`,
        )
        .run(
          `ADM-${s.admissionNo}`,
          s.id,
          s.classId,
          thisMonth,
          '00',
          ymd(today),
          admissionFee.amount,
          admissionFee.amount,
        );
      if (info.changes > 0) {
        db.prepare(`INSERT INTO voucher_items (voucher_id, fee_structure_id, description, amount) VALUES (?, ?, ?, ?)`)
          .run(info.lastInsertRowid, admissionFee.id, admissionFee.name, admissionFee.amount);
      }
    }

    if (idx % 7 === 0) {
      db.prepare(`INSERT INTO discounts (student_id, name, amount, percent, reason, session_id, approved_by) VALUES (?, 'Sibling concession', ?, 10, 'Two siblings enrolled', ?, 1)`)
        .run(s.id, 500, sessionId);
    }
  });

  // --- exams & marks ---------------------------------------------------------------
  const examTypeId = Number(db.prepare(`SELECT id FROM exam_types WHERE name = 'Mid Term'`).get()?.id);
  classes.forEach((classId) => {
    const examId = Number(
      db
        .prepare(
          `INSERT INTO exams (name, exam_type_id, session_id, class_id, start_date, end_date, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'published', 1)`,
        )
        .run(`Mid Term ${sessionYear}`, examTypeId, sessionId, classId,
          ymd(dayOffset(today, -20)), ymd(dayOffset(today, -18))).lastInsertRowid,
    );

    const classSubjects = db
      .prepare(`SELECT subject_id FROM class_subjects WHERE class_id = ? AND is_active = 1 ORDER BY id`)
      .all(classId);

    classSubjects.forEach((cs, idx) => {
      db.prepare(`INSERT INTO exam_subjects (exam_id, subject_id, total_marks, pass_marks, exam_date, sort_order) VALUES (?, ?, 100, 40, ?, ?)`)
        .run(examId, cs.subject_id, ymd(dayOffset(today, -20 + (idx % 3))), idx + 1);
    });

    const roster = studentIds.filter((s) => s.classId === classId);
    const insertedSubjects = db.prepare(`SELECT * FROM exam_subjects WHERE exam_id = ?`).all(examId);
    const insertMark = db.prepare(
      `INSERT OR IGNORE INTO marks (exam_id, exam_subject_id, student_id, marks_obtained, entered_by) VALUES (?, ?, ?, ?, 1)`,
    );
    roster.forEach((s) => {
      let obtained = 0;
      let total = 0;
      insertedSubjects.forEach((es) => {
        const mark = Math.round(45 + rand() * 55);
        insertMark.run(examId, es.id, s.id, mark);
        obtained += mark;
        total += es.total_marks;
      });
      const pct = (obtained / total) * 100;
      db.prepare(
        `INSERT OR REPLACE INTO results (student_id, exam_id, total_marks, obtained_marks, percentage, grade, grade_point, is_pass)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(s.id, examId, total, obtained, Math.round(pct * 100) / 100,
        pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F',
        pct >= 90 ? 5 : pct >= 80 ? 4 : pct >= 70 ? 3 : pct >= 60 ? 2 : pct >= 50 ? 1 : 0,
        pct >= 50 ? 1 : 0);
    });
  });

  // --- notices, expenses ---------------------------------------------------------
  const notices = [
    ['Staff Meeting', 'Monthly staff meeting on Saturday at 10:00 in the staff room.', 'all'],
    ['Parent Teacher Meeting', 'PTM for Class 1 parents scheduled for next week.', 'students'],
    ['Library Week', 'Library week starts Monday - borrow books from the school library.', 'all'],
  ];
  notices.forEach(([title, body, audience]) => {
    db.prepare(`INSERT INTO notices (title, body, audience, created_by, pinned) VALUES (?, ?, ?, 1, ?)`)
      .run(title, body, audience, title === 'Staff Meeting' ? 1 : 0);
  });

  const expenseRows = [
    ['expense', 'Utilities', 'Electricity bill', 18000],
    ['expense', 'Maintenance', 'Classroom repairs', 9500],
    ['expense', 'Stationery', 'Chalk, registers, printing', 4200],
    ['expense', 'Transport', 'Bus fuel', 22000],
    ['income', 'Other Income', 'School festival sponsorship', 15000],
  ];
  expenseRows.forEach(([type, category, description, amount], i) => {
    db.prepare(
      `INSERT INTO expenses (entry_type, category, description, amount, method, entry_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run(type, category, description, amount, pick(['cash', 'bank']), ymd(dayOffset(today, -i * 3 - 1)));
  });

  // --- payroll for last month --------------------------------------------------------
  const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonth = ym(lastMonthDate);
  [...staffIds, { id: officeId, salary: OFFICE_STAFF.salary }].forEach((s) => {
    const basic = s.salary;
    const allowances = Math.round(basic * 0.4) + 5000 + 3000;
    const gross = basic + allowances;
    const tax = Math.round((gross * 5) / 100);
    db.prepare(
      `INSERT INTO payroll (staff_id, month, basic, allowances_total, gross, deductions_total, net, working_days, present_days, absent_days, status, paid_date, payment_method, generated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 22, 20, 2, 'paid', ?, 'bank', 1)`,
    ).run(s.id, lastMonth, basic, allowances, gross, tax, gross - tax, ymd(lastMonthDate));
  });
}

module.exports = { runSeedIfEmpty };