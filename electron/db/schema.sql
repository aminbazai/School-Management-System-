-- ============================================================================
--  School Management System - canonical schema (SQLite)
--  Applied automatically on first launch by electron/db/connection.js
--  Later changes go into electron/db/migrations/NNN_*.sql
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Meta / infrastructure
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
  note        TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  INTEGER
);

-- ---------------------------------------------------------------------------
-- Identity, roles and sessions
-- ---------------------------------------------------------------------------
--
-- The permission model lives in the main process, not in the database: every
-- IPC channel declares the roles that may call it (see electron/ipc/*.js) and
-- the guard in electron/ipc/guard.js enforces it. There is deliberately no
-- roles/permissions table here - an empty one would only suggest a feature
-- the application does not have.

CREATE TABLE IF NOT EXISTS users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  username              TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN ('admin','office','teacher','student','parent')),
  linked_id             INTEGER,               -- students.id / staff.id depending on role
  email                 TEXT,
  phone                 TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1,
  must_change_password  INTEGER NOT NULL DEFAULT 1,
  failed_attempts       INTEGER NOT NULL DEFAULT 0,
  locked_until          TEXT,
  last_login            TEXT,
  password_changed_at   TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_role    ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_linked  ON users(linked_id);
CREATE INDEX IF NOT EXISTS idx_users_active  ON users(is_active, is_deleted);

-- ---------------------------------------------------------------------------
-- Academic structure
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS academic_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,          -- e.g. 2025-2026
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,                 -- unique among rows that are not deleted (ux_classes_name)
  code        TEXT,
  level_order INTEGER NOT NULL DEFAULT 0,    -- Play Group .. Inter, for sorting/promotion
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted  INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_classes_name ON classes(name) WHERE is_deleted = 0;

CREATE TABLE IF NOT EXISTS sections (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id          INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  capacity          INTEGER NOT NULL DEFAULT 30,
  class_teacher_id  INTEGER,
  room_no           TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sections_class ON sections(class_id, is_deleted);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sections_class_name ON sections(class_id, name) WHERE is_deleted = 0;

CREATE TABLE IF NOT EXISTS subjects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,                 -- unique among rows that are not deleted (ux_subjects_name)
  code        TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted  INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_subjects_name ON subjects(name) WHERE is_deleted = 0;

CREATE TABLE IF NOT EXISTS class_subjects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id      INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  max_marks       INTEGER NOT NULL DEFAULT 100,
  pass_marks      INTEGER NOT NULL DEFAULT 40,
  weekly_periods  INTEGER NOT NULL DEFAULT 3,
  is_active       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (class_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_class_subjects_class ON class_subjects(class_id);

CREATE TABLE IF NOT EXISTS periods (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  start_time  TEXT NOT NULL,        -- HH:MM
  end_time    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_break    INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- Staff (teachers + office + other staff) and students
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staff (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code  TEXT UNIQUE,
  name           TEXT NOT NULL,
  father_name    TEXT,
  cnic           TEXT,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  qualification  TEXT,
  designation    TEXT,
  staff_type     TEXT NOT NULL DEFAULT 'teacher' CHECK (staff_type IN ('teacher','office','other')),
  joining_date   TEXT,
  photo_path     TEXT,
  basic_salary   REAL NOT NULL DEFAULT 0,
  blood_group    TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave','inactive')),
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_staff_name   ON staff(name);
CREATE INDEX IF NOT EXISTS idx_staff_type   ON staff(staff_type, is_deleted);
CREATE INDEX IF NOT EXISTS idx_staff_cnic   ON staff(cnic);

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id         INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  class_id           INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  section_id         INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id         INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  academic_session_id INTEGER REFERENCES academic_sessions(id),
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (teacher_id, class_id, section_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_ta_teacher ON teacher_assignments(teacher_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ta_class   ON teacher_assignments(class_id, section_id);

CREATE TABLE IF NOT EXISTS students (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  admission_no      TEXT NOT NULL UNIQUE,     -- also the login username
  gr_no             TEXT,
  name              TEXT NOT NULL,
  father_name       TEXT,
  gender            TEXT CHECK (gender IN ('male','female','other')),
  dob               TEXT,
  b_form            TEXT,
  phone             TEXT,
  email             TEXT,
  address           TEXT,
  photo_path        TEXT,
  class_id          INTEGER REFERENCES classes(id),
  section_id        INTEGER REFERENCES sections(id),
  admission_date    TEXT,
  previous_school   TEXT,
  roll_no           TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left','passed_out')),
  created_by        INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_students_name   ON students(name);
CREATE INDEX IF NOT EXISTS idx_students_class  ON students(class_id, section_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_adm    ON students(admission_no);

CREATE TABLE IF NOT EXISTS guardians (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  relation  TEXT CHECK (relation IN ('father','mother','grandfather','grandmother','uncle','aunt','brother','sister','other')),
  cnic      TEXT,
  phone     TEXT,
  email     TEXT,
  address   TEXT,
  occupation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS student_guardians (
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id  INTEGER NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  is_primary   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (student_id, guardian_id)
);

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS student_attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,                  -- YYYY-MM-DD
  status      TEXT NOT NULL CHECK (status IN ('present','absent','leave','late','half_day')),
  remarks     TEXT,
  marked_by   INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sa_date    ON student_attendance(date);
CREATE INDEX IF NOT EXISTS idx_sa_student ON student_attendance(student_id, date);
CREATE INDEX IF NOT EXISTS idx_sa_class   ON student_attendance(date, status);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('present','absent','leave','late','half_day','holiday')),
  check_in    TEXT,
  check_out   TEXT,
  remarks     TEXT,
  marked_by   INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (staff_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sta_date  ON staff_attendance(date);
CREATE INDEX IF NOT EXISTS idx_sta_staff ON staff_attendance(staff_id, date);

CREATE TABLE IF NOT EXISTS leave_types (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  days_per_year REAL NOT NULL DEFAULT 12,
  is_paid       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id      INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year          INTEGER NOT NULL,
  total_days    REAL NOT NULL DEFAULT 0,
  used_days     REAL NOT NULL DEFAULT 0,
  UNIQUE (staff_id, leave_type_id, year)
);

CREATE TABLE IF NOT EXISTS leaves (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id     INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  leave_type_id INTEGER REFERENCES leave_types(id),
  leave_type   TEXT,                          -- free text fallback (e.g. 'casual')
  from_date    TEXT NOT NULL,
  to_date      TEXT NOT NULL,
  days         REAL NOT NULL DEFAULT 1,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  applied_at   TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by   INTEGER,
  decided_at   TEXT,
  remarks      TEXT
);

CREATE INDEX IF NOT EXISTS idx_leaves_staff ON leaves(staff_id, status);

-- ---------------------------------------------------------------------------
-- Salary / payroll
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS salary_structures (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id       INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  basic_salary   REAL NOT NULL DEFAULT 0,
  effective_from TEXT,
  effective_to   TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_sal_staff ON salary_structures(staff_id, is_active);

CREATE TABLE IF NOT EXISTS allowances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('house','medical','transport','fuel','special','custom')),
  amount      REAL NOT NULL DEFAULT 0,
  is_percent  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_allow_staff ON allowances(staff_id, is_active);

CREATE TABLE IF NOT EXISTS deductions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('absent','late','tax','pf','insurance','custom')),
  amount      REAL NOT NULL DEFAULT 0,
  is_percent  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deduct_staff ON deductions(staff_id, is_active);

CREATE TABLE IF NOT EXISTS advances (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id           INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  amount             REAL NOT NULL,
  advance_date       TEXT NOT NULL,
  installments       INTEGER NOT NULL DEFAULT 1,
  installment_amount REAL NOT NULL DEFAULT 0,
  recovered          REAL NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','recovered','cancelled')),
  notes              TEXT,
  created_by         INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_adv_staff ON advances(staff_id, status);

CREATE TABLE IF NOT EXISTS payroll (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id         INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  month            TEXT NOT NULL,             -- YYYY-MM
  basic            REAL NOT NULL DEFAULT 0,
  allowances_total REAL NOT NULL DEFAULT 0,
  gross            REAL NOT NULL DEFAULT 0,
  deductions_total REAL NOT NULL DEFAULT 0,
  advance_recovery REAL NOT NULL DEFAULT 0,
  bonus            REAL NOT NULL DEFAULT 0,
  net              REAL NOT NULL DEFAULT 0,
  working_days     REAL NOT NULL DEFAULT 0,
  present_days     REAL NOT NULL DEFAULT 0,
  absent_days      REAL NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','approved','paid')),
  paid_date        TEXT,
  payment_method   TEXT CHECK (payment_method IN ('cash','bank')),
  payment_reference TEXT,
  notes            TEXT,
  generated_by     INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (staff_id, month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_month ON payroll(month, status);

CREATE TABLE IF NOT EXISTS payroll_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_id  INTEGER NOT NULL REFERENCES payroll(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('earning','deduction')),
  name        TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_payitems_payroll ON payroll_items(payroll_id);

CREATE TABLE IF NOT EXISTS advance_recoveries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  advance_id  INTEGER NOT NULL REFERENCES advances(id) ON DELETE CASCADE,
  payroll_id  INTEGER REFERENCES payroll(id) ON DELETE SET NULL,
  amount      REAL NOT NULL,
  recovery_date TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_advrec_advance ON advance_recoveries(advance_id);

-- ---------------------------------------------------------------------------
-- Fees
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fee_structures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id     INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  fee_type     TEXT NOT NULL DEFAULT 'tuition' CHECK (fee_type IN ('admission','tuition','exam','transport','library','uniform','other')),
  frequency    TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('one_time','monthly','quarterly','yearly')),
  amount       REAL NOT NULL DEFAULT 0,
  session_id   INTEGER REFERENCES academic_sessions(id),
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_feestruct_class ON fee_structures(class_id, is_active);

CREATE TABLE IF NOT EXISTS discounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  percent     REAL NOT NULL DEFAULT 0,
  reason      TEXT,
  session_id  INTEGER REFERENCES academic_sessions(id),
  approved_by INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_disc_student ON discounts(student_id, is_deleted);

CREATE TABLE IF NOT EXISTS fee_vouchers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_no    TEXT NOT NULL UNIQUE,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id      INTEGER REFERENCES classes(id),
  month         TEXT NOT NULL,          -- YYYY
  period        TEXT NOT NULL,          -- 01..12
  due_date      TEXT,
  total_amount  REAL NOT NULL DEFAULT 0,
  discount      REAL NOT NULL DEFAULT 0,
  late_fine     REAL NOT NULL DEFAULT 0,
  paid_amount   REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','cancelled')),
  generated_by  INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (student_id, period, month)
);

CREATE INDEX IF NOT EXISTS idx_voucher_period ON fee_vouchers(month, period, status);
CREATE INDEX IF NOT EXISTS idx_voucher_student ON fee_vouchers(student_id);

CREATE TABLE IF NOT EXISTS voucher_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id       INTEGER NOT NULL REFERENCES fee_vouchers(id) ON DELETE CASCADE,
  fee_structure_id INTEGER REFERENCES fee_structures(id),
  description      TEXT NOT NULL,
  amount           REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_vitems_voucher ON voucher_items(voucher_id);

CREATE TABLE IF NOT EXISTS fee_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id   INTEGER NOT NULL REFERENCES fee_vouchers(id) ON DELETE CASCADE,
  receipt_no   TEXT NOT NULL UNIQUE,
  amount       REAL NOT NULL,
  payment_date TEXT NOT NULL,
  method       TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','bank','online','cheque')),
  reference    TEXT,
  remarks      TEXT,
  collected_by INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pay_voucher ON fee_payments(voucher_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_pay_date    ON fee_payments(payment_date);

-- ---------------------------------------------------------------------------
-- Exams, marks and results
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exam_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS exams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  exam_type_id INTEGER REFERENCES exam_types(id),
  session_id  INTEGER REFERENCES academic_sessions(id),
  class_id    INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  start_date  TEXT,
  end_date    TEXT,
  weightage   REAL NOT NULL DEFAULT 100,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','marks_open','published','locked')),
  is_locked   INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_exams_class ON exams(class_id, status);

CREATE TABLE IF NOT EXISTS exam_subjects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id     INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  total_marks REAL NOT NULL DEFAULT 100,
  pass_marks  REAL NOT NULL DEFAULT 40,
  exam_date   TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (exam_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_exsub_exam ON exam_subjects(exam_id);

CREATE TABLE IF NOT EXISTS marks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id          INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  exam_subject_id  INTEGER NOT NULL REFERENCES exam_subjects(id) ON DELETE CASCADE,
  student_id       INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  marks_obtained   REAL,
  entered_by       INTEGER,
  entered_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (exam_subject_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id);
CREATE INDEX IF NOT EXISTS idx_marks_exam    ON marks(exam_id);

CREATE TABLE IF NOT EXISTS results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  exam_id        INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  total_marks    REAL NOT NULL DEFAULT 0,
  obtained_marks REAL NOT NULL DEFAULT 0,
  percentage     REAL NOT NULL DEFAULT 0,
  grade          TEXT,
  grade_point    REAL,
  position       INTEGER,
  is_pass        INTEGER NOT NULL DEFAULT 0,
  computed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, exam_id)
);

CREATE INDEX IF NOT EXISTS idx_results_exam ON results(exam_id);

CREATE TABLE IF NOT EXISTS grade_scale (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  min_percentage  REAL NOT NULL,
  max_percentage  REAL NOT NULL,
  grade_point     REAL NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (name)
);

-- ---------------------------------------------------------------------------
-- Timetable, notices, expenses, audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS timetable (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  section_id    INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  teacher_id    INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  subject_id    INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  period_id     INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),   -- 0 = Sunday
  session_id    INTEGER REFERENCES academic_sessions(id),
  is_active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (section_id, day_of_week, period_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_tt_teacher ON timetable(teacher_id, day_of_week, period_id);
CREATE INDEX IF NOT EXISTS idx_tt_section ON timetable(section_id, day_of_week);

CREATE TABLE IF NOT EXISTS notices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  body        TEXT,
  audience    TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','teachers','students','office','staff')),
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  is_deleted  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notices_audience ON notices(audience, is_active);

CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_type   TEXT NOT NULL DEFAULT 'expense' CHECK (entry_type IN ('income','expense')),
  category     TEXT NOT NULL,
  description  TEXT,
  amount       REAL NOT NULL DEFAULT 0,
  method       TEXT CHECK (method IN ('cash','bank','cheque','online')),
  reference    TEXT,
  entry_date   TEXT NOT NULL,
  created_by   INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(entry_date, entry_type);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  username    TEXT,
  role        TEXT,
  action      TEXT NOT NULL,        -- login, login_failed, logout, create, update, delete, pay, ...
  entity      TEXT,                 -- students, users, payroll, ...
  entity_id   TEXT,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- Default grade scale (editable from Settings)
INSERT OR IGNORE INTO grade_scale (name, min_percentage, max_percentage, grade_point, is_active) VALUES
  ('A+', 90, 100, 5.0, 1),
  ('A',  80, 89.99, 4.0, 1),
  ('B',  70, 79.99, 3.0, 1),
  ('C',  60, 69.99, 2.0, 1),
  ('D',  50, 59.99, 1.0, 1),
  ('F',  0,  49.99, 0.0, 1);

-- Default exam types
INSERT OR IGNORE INTO exam_types (name, sort_order) VALUES
  ('Monthly Test', 1),
  ('Mid Term', 2),
  ('Final', 3);

-- Default leave types
INSERT OR IGNORE INTO leave_types (name, days_per_year, is_paid) VALUES
  ('Casual', 12, 1),
  ('Sick', 12, 1),
  ('Earned', 10, 1),
  ('Unpaid', 0, 0);