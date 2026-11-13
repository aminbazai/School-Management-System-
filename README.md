# School Management System

Offline-first desktop **School Management System** built with Electron, React, Vite and SQLite.
One app, one login screen, four completely separate workspaces (Admin, Office, Teacher, Student)
with their own sidebar, colour accent and dashboard.

> **Status: all eight phases are complete, and the gaps that were left have been closed.**
> The foundation, academic structure, students, settings, staff records, both attendance systems,
> salary management, fee collection, the expense book, exams and results, timetables, notices, the
> live dashboards, backup/restore and the audit log are all finished and tested.
> Teacher assignments, leave applications, leave balances and account editing were added on top
> (see *What closing the last gaps added*).

---

## 1. Requirements

| Tool | Version |
|------|---------|
| Node.js | 20 or newer (tested on 24) |
| npm | 10+ |
| Windows | 10/11 (x64) |

No database server, no internet connection at runtime — the app is fully offline.

## 2. Install and run

```bash
npm install          # installs deps and rebuilds better-sqlite3 for Electron
npm run dev          # Vite dev server + Electron with hot reload
npm run build        # production renderer build into dist/
npm run start        # run the built app (npm run build first)
npm run dist         # build + package the Windows NSIS installer into release/
```

Extra developer commands:

```bash
npm run smoke            # verifies SQLite + bcrypt load inside Electron, schema + seed
npm run test:security    # 32 security assertions through the real IPC surface
npm run test:phase2      # 50 assertions for classes / sections / subjects / students
npm run test:phase3      # 45 assertions for staff, attendance and leaves
npm run test:phase4      # 38 assertions for salary structures and payroll
npm run test:phase5      # 108 assertions for fees, vouchers, receipts and expenses
npm run test:phase6      # 57 assertions for exams, marks, results and report cards
npm run test:phase7      # 63 assertions for timetable, notices and dashboards
npm run test:phase8      # 43 assertions for backup, restore and the audit log
npm run test:phase9      # 50 assertions for teacher assignments, leave and account editing
npm run test:classes     # 30 assertions for the academic structure edge cases
npm run test:ui          # 75 end-to-end checks that drive the real forms
npm run check:routes     # every sidebar link has a real route
npm run check:i18n       # both languages hold the same keys, and every t() exists
npm run test:all         # runs all of the above in order
npm run shots            # renders every role workspace to ./screenshots
```

## 2b. What Phase 2 adds

* **Students** — full CRUD, automatic admission numbers (`ADM-<year>-###`), photo picker,
  guardian record, status (active / left / passed out), search + class/section/status filters,
  sorting, pagination, row selection, bulk promotion to another class, Excel import (with a
  preview and per-row error report) and export, PDF list export and ID-card printing.
  Creating a student can auto-create their login (username = admission number).
* **Classes, Sections, Subjects** — CRUD with capacity, room, class teacher, subject codes and
  max/pass marks per class, plus academic sessions (activate one to make it the current year).
* **Settings** — school profile and logo, academic rules (session, currency, attendance
  cut-off, working days, fines), theme and default language, security policy readout and the
  editable grade scale used later by results.
* **Office** — the same student module in *Admissions* mode (no delete permission).
* **Student** — *My Profile* and *My Class & Section*, resolved from `users.linked_id` in main.

## 2c. What Phase 3 adds

* **Teachers & Staff** — records for teachers, office staff and other employees (code, CNIC,
  phone, address, qualification, designation, joining date, photo, basic salary, blood group,
  status). Login is created from the employee code; a teacher holding class assignments cannot
  be deleted until they are removed.
* **Student attendance** — daily register by class + section with Present / Absent / Leave / Late /
  Half day buttons, remarks, *Mark all present*, and a monthly register with per-student
  percentages. Teachers may only mark **today** and only for **their own classes** — both rules
  live in the main process.
* **Attendance reports** — students below a configurable threshold (default 75%), sortable, with
  CSV export.
* **Teacher attendance** — office marks the whole staff day with check-in/check-out times, sees a
  monthly summary for everyone, and handles leave requests (approve/reject) with per-type balances.
  A teacher applies for their own leave and can withdraw a pending application; the office can also
  record one on behalf of any staff member. Approving a leave deducts it from the balance and marks
  those days as *leave* on the register, so the payroll does not treat them as an absence. The
  yearly quota of every person can be overridden from the leave desk.
* **Teacher > My Attendance** and **Student > My Attendance** — personal record with a monthly
  summary; the student also gets a colour-coded calendar and a 12-month trend.
* **Access control** (`services/acl.service.js`) — class/section scoping for teachers, "own record
  only" for students, enforced on every call.

## 2d. What Phase 4 adds

* **Salary structures** — per staff member: basic salary (kept in sync with the staff record) plus
  allowances (house, medical, transport, fuel, special, custom) and deductions (tax, provident
  fund, insurance, custom). Any row can be a fixed amount **or** a percentage of the basic salary.
* **Attendance-driven pay** — the monthly payroll reads the staff attendance that was marked in
  Phase 3. Absent days are deducted at the rate from Settings, and a `late` deduction row is applied
  per late day. Nothing is guessed: the slip shows present / absent next to the figures.
* **Advances / loans** — amount, date and number of installments; one installment is recovered from
  each payroll until the advance is fully recovered. Deleting an unpaid payslip returns the
  recovered amount to the advance.
* **Payroll run** — *Preview payroll* calculates the month for every active staff member and shows
  the totals **without saving**; *Generate payroll* commits it. Generating twice is refused, and staff
  who already have a payslip are skipped.
* **Payslips** — itemised earnings and deductions, mark as paid (cash/bank + reference), print
  preview and save as PDF using the school logo and report footer from Settings.
* **Teacher > My Salary Slips** — own payslips only, with latest net pay and year-to-date totals.
  The main process resolves the staff member from `users.linked_id`, so a teacher can never request
  another person's slip.

## 2e. What Phase 5 adds

* **Fee heads** — per class (or one row applied to every class): name, fee type (admission, tuition,
  exam, transport, library, uniform, other), frequency (one-time, monthly, quarterly, yearly) and
  amount. A monthly head is what a voucher is built from.
* **Concessions** — a fixed amount, a percentage, or both, per student, with a reason (sibling
  concession, merit, staff child). A concession is applied to every voucher generated for that
  student and can never exceed the fee itself.
* **Monthly vouchers** — *Preview month* calculates what would be created **without saving**;
  *Generate vouchers* commits it in one transaction. Students who already have a voucher for that
  month are skipped, and generating twice is refused. Each voucher keeps its fee items.
* **Collection** — full or part payments against a voucher (overpayment is refused), cash / bank /
  cheque / online with a reference, and the voucher status is derived from the amounts rather than
  typed in. A payment can be reversed by an admin, which restores the balance and the status.
* **Receipts** — every payment gets a sequential receipt number and a printable receipt with the
  school logo, the fee items, the total payable and the remaining balance, plus cashier and guardian
  signature lines. Print or save as PDF. The voucher list can also be exported as a landscape PDF.
* **Late fines** — an admin can add a flat fine to every still-open voucher of a month. Vouchers
  that already carry a fine, and vouchers that are fully paid, are never fined twice.
* **Defaulter list** — every unpaid/part-paid voucher, largest balance first, with the siblings of
  the student (derived from the shared guardian) so the family can be settled in one visit. CSV export.
* **Collection report** — money collected per day over a date range, split by cash versus
  bank/online, with per-method totals.
* **Expenses & other income** — a day book with fixed categories for expenses (utilities, maintenance,
  stationery, transport, salaries, events, repairs, other) and for income (admission, donation, event,
  other income). Monthly totals, a per-category breakdown and a month-by-month income/expense/net view.
  Only an admin can delete an entry.
* **Student > My Fee Status** — own vouchers and own receipts, with billed / paid / balance totals.
  The main process resolves the student from `users.linked_id`, so there is no id in the renderer
  to tamper with; asking for another student's account returns `FORBIDDEN`.

## 2g. What Phase 6 adds

* **Exams** — per class, with a type, a date range and an explicit lifecycle:
  `draft → marks_open → published → locked`. Only an admin moves an exam forward and only along the
  allowed edges; a locked exam refuses marks, recomputation and every edit, permanently.
* **Paper list** — the subjects one exam covers, each with its own total marks, pass marks and exam
  date. A subject the class does not teach is refused, so a paper can never contain a subject the
  students never had. The list is replaced in one transaction and is frozen once marks exist.
* **Marks entry** — paper-wise grid: one row per student, one box per paper. A mark above the paper
  total, below zero, or for a student who is not on the roster is refused; a blank box clears the
  mark rather than storing a zero. Teachers only ever get boxes for **their own subjects** in
  **their own classes** — the rule lives in `exams.service.js`, not in the UI.
* **Results** — *computed*, never typed: totals, percentage, grade and grade point from the editable
  scale in Settings, plus position (ties share a position: 1, 1, 3). `is_pass` requires **every**
  paper to reach its own pass mark, so a high average cannot carry a failed subject. A student with
  a missing paper is left unscored rather than scored on what they sat. Recomputing is idempotent and
  removes results for students who no longer qualify.
* **Result sheet & statistics** — the whole class with per-subject marks, pass rate, class average,
  highest, lowest, a grade spread and the top five; printable as a landscape PDF.
* **Report cards** — one student, one exam: paper list with pass marks, totals, grade, position and
  the attendance record for the exam window. Save as PDF or print. A student may only read a result
  that has actually been published, and only their own.
* **Teacher > Marks Entry** — the open exams of the teacher's classes, paper tabs with a completion
  count, and read-only boxes for any subject they do not teach.
* **Student > My Results** — every published result with grade, position and a report card
  preview, download and print.

## 2h. What Phase 7 adds

* **Timetable** — school-day periods (name, start, end, order, break flag) and a weekly grid of
  periods down the side and days across. A slot is unique per section / day / period / session, so
  two subjects can never land in the same period. Saving replaces a whole section grid in one
  transaction. The screen has a **class view** (the grid you edit) and a **teacher view** (one
  teacher's whole week). Teacher double-bookings are **reported as warnings, not blocked** — a
  clash is legitimate during substitution.
* **Notices** — title, message, audience (`all`, teachers, students, office, staff), an optional
  expiry and a pin. The role-to-audience mapping is applied in SQL, so a renderer cannot request an
  audience it has no business seeing. Expired notices are only visible to an admin, who is the one
  who has to clean them up.
* **Live dashboards** — one scoped call per role (`reports.dashboard`), already filtered in the main
  process: an admin sees the whole school, a teacher only their assigned classes, a student only
  their own records. Each role gets its own stat cards and charts (attendance trend, finance
  columns, grade donut, result list, upcoming exams, collection history).
* **Office > Reports** — enrolment, attendance, fee collection, payroll and results, each built live
  from current records and saved as a landscape PDF. What is on screen is exactly what the PDF
  contains — there is no second, prettier rendering that could disagree.

## 2i. What Phase 8 adds

* **Backup & restore** — a manual backup with an optional label, plus one automatic backup every day
  the app starts (the last seven are kept; manual backups are never pruned). Backups are made with
  SQLite's own online backup API, so they are consistent even while the app is being used.
* **Restore is reversible** — the live database is copied aside before anything is swapped in, so a
  restore can itself be undone. WAL side files belonging to the replaced database are removed first,
  otherwise SQLite would replay stale pages on top of the restored file. After the swap the
  connection reopens and migrations re-run, which is what makes an *older* backup safe to restore.
* **Audit log screen** — every login, lockout, create, update, delete, payment, print and backup,
  filterable by action prefix, free text and date range, paged and exportable to CSV. The log is
  append-only; the screen only reads it.
* **Tests and installer** — `test:phase6`, `test:phase7` and `test:phase8` drive the real IPC surface
  the same way the earlier suites do, and `npm run dist` produces the NSIS installer.

## 2f. Where the data lives

A month is always one value: `YYYY-MM` (`fee_vouchers.month`). The stored `period` (`01`–`12`) is
derived from it, so the seed, the UI and the reports can never disagree about which month a voucher
belongs to. Admission-fee vouchers use period `00` to stay clear of the monthly voucher's
`UNIQUE(student_id, period, month)`.

## 3. Demo accounts (seeded)

| Role | Username | Password | Notes |
|------|----------|----------|-------|
| Principal / Admin | `admin` | `admin123` | password change required at first login |
| Principal / Admin | `principal` | `principal123` | second administrator |
| Office / Accounts | `office` | `office123` | |
| Teacher | `teacher1` · `teacher2` · `teacher3` | `teacher123` | |
| Student | `adm-<year>-001` … `adm-<year>-024` | same as username | username = admission number |

New accounts must change their password at first login (enforced in the main process).

## 4. Project structure

```
electron/                  MAIN PROCESS - owns the database and all business logic
  main.js                  window, security hardening, idle watchdog, error dialogs
  preload.js               the only renderer <-> main bridge (contextBridge)
  logger.js                rotating file logger
  db/
    connection.js          single SQLite connection + migration runner
    schema.sql             canonical schema (all phases)
    migrations/            numbered NNN_*.sql applied on top of schema.sql
    seed.js                deterministic demo data
  services/                business logic + validation + audit
    auth.service.js  users.service.js  settings.service.js  audit.service.js
    session.js       validation.js     classes.service.js    students.service.js
    attendance.service.js  salary.service.js  fees.service.js  expenses.service.js
    exams.service.js  timetable.service.js  notices.service.js  reports.service.js
    backup.service.js  acl.service.js   (class/section and "own record only" rules)
    excel.service.js (import/export)  files.service.js (images) print.service.js (PDF)
  ipc/                     one file per domain, every channel wrapped by guard.js
    channels.js            single source of truth for channel names (mirrored in preload.js)
    guard.js               session + role + forced-password enforcement

src/                       RENDERER - React + Vite, no Node access at all
  layouts/                 AdminLayout, OfficeLayout, TeacherLayout, StudentLayout
  pages/                   pages per role/module
  components/ui            Button, Form, Panel, Badge, Modal, Toast, Table pieces
  components/charts        themed Recharts wrappers (trend, bars, ranked, donut, sparkline)
  components/exams         marks entry grid and paper tabs, shared by admin and teacher
  components/timetable     the weekly grid, in edit and view modes
  components/layout        AppShell, Sidebar, TopBar
  store/AuthProvider.jsx   mirrors the main-process session in React
  i18n/                    en.json, ur.json (Urdu = RTL + Noto Nastaliq)
  config/menu.js           role menus and the phase each module shipped in

scripts/                   dev tools (smoke test, per-phase tests, UI test, screenshots, icon)
```

## 5. Architecture and security

* **Main process owns everything**: SQLite, validation, permissions, audit log.
* **Renderer is untrusted**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  no `require`, no `fs`, no database handle. It can only call the fixed API exposed by `preload.js`.
* **Every IPC call is re-checked in main** (`electron/ipc/guard.js`):
  1. the sender must be one of our windows,
  2. a live session must exist (auto-expires after 30 minutes of inactivity),
  3. the session role must be allowed for that channel,
  4. an account flagged `must_change_password` may only call auth channels.
* **Passwords**: bcrypt (10 rounds), minimum 6 characters, never equal to the username,
  never equal to the previous one. Five failed attempts lock the account for 5 minutes.
* **Input validation happens in main** (`services/validation.js`), parameterised SQL only.
* **Audit log** records login, login failure, lockout, logout, password changes and every
  create/update/delete with user, role and timestamp.
* **Soft deletes** (`is_deleted`) for students, staff and financial records.
* Production builds add a strict CSP, deny `window.open`, block navigation away from the app,
  and deny all permission requests.

The UI never decides permissions — hiding a button is cosmetic, the guard in main is what counts.

## 6. Data

* File: `%APPDATA%/School Management System/school.db` (never inside the install folder).
* WAL mode, foreign keys on, indexes on searched columns.
* Migrations: `schema_version` table; add future changes as
  `electron/db/migrations/00N_description.sql` and they are applied automatically.
* Backups folder already created at `%APPDATA%/School Management System/backups` (used in Phase 8).
* Logs at `%APPDATA%/School Management System/logs/app-YYYY-MM-DD.log`.

To start over: quit the app, delete `school.db*` in that folder, relaunch (it re-seeds).
Deleting the database does **not** delete the backups, which is the point of keeping them.

## 7. Interface

Dark glass workspace modelled on the supplied `ui-design.jpg`: 264 px sidebar, pill language
switch, stat cards with sparkline slots, floating panels, soft blue glow.
Each role has its own accent colour — Admin blue, Office emerald, Teacher violet, Student amber.
Light theme is available from the top bar toggle.

English and Urdu are complete for the Phase 1 interface. Urdu switches the whole layout to
**RTL** with the bundled **Noto Nastaliq Urdu** font (works offline).

## 8. Roadmap

| Phase | Content | State |
|-------|---------|-------|
| 1 | Project setup, schema, auth, role routing, 4 layouts, preload API, security, i18n | **done** |
| 2 | Settings, classes, sections, subjects, students (CRUD, import/export, promotion, ID cards) | **done** |
| 3 | Teachers/staff, staff attendance, student attendance + reports | **done** |
| 4 | Salary management + salary slips | **done** |
| 5 | Fee management + receipts + defaulters | **done** |
| 6 | Exams, marks, results, report cards | **done** |
| 7 | Timetable, notices, dashboards with charts for all roles | **done** |
| 8 | Backup/restore, audit log screen, polish, tests, installer | **done** |
| 9 | Teacher assignments, leave applications and balances, account editing, gap closing | **done** |

Every module in the sidebar is live and every sidebar link has a real route
(`npm run check:routes` enforces this). The `P2`–`P8` badge no longer appears on anything.

## 8b. What closing the last gaps added

* **Teacher assignments** — the table that decides what a teacher can reach had no writer, so a
  teacher created through the app had no classes at all and could not even be deleted. The
  *Teacher Assignments* tab of the academic structure screen now assigns a teacher to a class, a
  section and a subject; only subjects the class actually teaches can be assigned, and removing an
  assignment closes the class to that teacher again. The rules live in `classes.service.js` and
  `acl.service.js`, not in the UI.
* **Leave applications** — `leave:apply` had a service but no screen. A teacher now has a *My Leave*
  desk: apply, see the balance of every leave type, watch the decision and withdraw a pending
  application. The office can record a leave on behalf of any staff member.
* **Leave balances** — `leave_balances` was never written. The used days are now derived from the
  approved applications and stored, the yearly quota can be overridden per person from the leave
  desk, and an approved leave is marked on the staff register so the payroll does not treat it as
  an absence.
* **Editing an account** — `users:update` had a service but no screen. An administrator can now
  change the role, the linked student or staff record, the email, the phone, the active flag and
  the forced-password-change flag of an account.
* **Clear all data** — a *Danger zone* on the Settings screen with two destructive actions, both
  admin-only and both taken with a safety backup first:
  * *Clear all data* removes every record of the running school (students, staff, attendance,
    marks, fees, salary, leaves, timetable, notices, expenses and the audit log) and keeps the
    school profile, the settings, the administrator accounts and the academic structure — the
    school comes out empty and ready to enrol again.
  * *Factory reset* replaces the whole database with a fresh one, which brings the factory demo
    state back. Every account, including the administrator's, is recreated.

  Both ask for the word to be typed out, both end the session (so the person has to sign in again
  and see the result), and both leave the safety backup in the backups folder.
* **Admin > Subjects** — the sidebar entry now resolves. It opens the academic
  structure screen on the *Subjects* tab (`ClassesPage` takes an `initialTab`),
  so subjects and the per-class subject list are managed in one place instead of
  two near-identical screens.
* **Teacher > My Classes** — the assigned classes and sections with the subjects
  the teacher actually holds, enrolment against capacity, and a per-section
  roster. The scoping is not done in the renderer: `structure.get` returns only
  the signed-in teacher's assignments (now including the subject names), so a
  teacher cannot see a class they do not hold even by calling the API directly.
* **Teacher week in the timetable** — the timetable screen can now show one teacher's whole week
  next to the class grid, and the office can read the timetable it has a menu entry for.
* **The timetable grid renders again** — the renderer read the plain period list where the built
  grid belongs, so the whole page came up blank for every role. The grid is now drawn from
  `data.grid`, and the UI test fails on any renderer error, so a page that crashes cannot pass
  a heading check any more.
* **Honest 404** — the catch-all inside a workspace no longer claims a module is
  "coming in phase N"; it says the page does not exist and offers a way back.
* **Dead code removed** — `PhaseNotice`, `PhasePill` and the stale
  *"Live statistics arrive in Phase 7"* copy are gone, together with the unused
  imports, exports and constants that the audit found.

## 9. Packaging

`electron-builder.yml` builds an NSIS installer (x64):

```bash
npm run dist        # -> release/School Management System-Setup-1.0.0.exe
```

* The app icon is generated by `scripts/make-icon.ps1` (`build/icon.png` + `build/icon.ico`).
* `better-sqlite3` is unpacked from the asar archive automatically.
* Uninstall keeps your data (`deleteAppDataOnUninstall: false`).

## 10. Assumptions

1. **Electron 38 is pinned on purpose.** It matches the newest `better-sqlite3` prebuilt binary
   (ABI 139), so no Visual Studio build tools are needed on the build machine.
2. **Staff live in one `staff` table** with a `staff_type` column (teacher / office / other)
   instead of a separate teachers table — payroll and attendance then reference one entity.
3. **Student logins use the admission number** as username, with the same value as the initial
   password; the forced password change clears it immediately.
4. **Family/sibling grouping** is derived from a shared guardian (`student_guardians`), not a
   separate sibling table.
5. **Sessions live in main-process memory only.** Closing the app signs everyone out — appropriate
   for a single-machine desktop app.
6. **The sidebar marks future phases** rather than hiding them, so you can review the full
   information architecture before each phase is implemented.
7. **Files are owned by the main process.** Excel import/export, PDF generation and image
   picking all happen in main (with native dialogs); the renderer only sends and receives data.
8. **Print/PDF uses Electron's `printToPDF`** on a hidden window, so print CSS and the bundled
   Urdu font render exactly as they appear on screen.
9. **Teachers can only mark today's register.** Admin and office can correct history — this
   matches the specification and is enforced in `attendance.service.js`.
10. **Payroll is calculated, never typed.** Wages are derived from the salary structure plus the
   attendance that was actually marked; a payslip stores the resulting numbers and the itemised
   lines so historical payslips stay correct even if the structure changes later.
11. **Percentage rows are percentages of the basic salary**, not of the gross. Gross can change with
   allowances, which would make a "5% tax" line move unexpectedly.
12. **Results are computed, never typed** — exactly like payroll. A result is derived from the marks
    that were actually entered and stores the numbers it derived, so a later change to the grade
    scale cannot silently rewrite a published report card.
13. **A locked exam is permanent.** There is no unlock, on purpose: a published report card that
    could be edited after being handed to a parent is worse than an admin who has to create a
    re-exam.
14. **Timetable clashes warn instead of blocking.** Blocking them would make substitution impossible;
    the editor lists every clash and lets the admin decide.
15. **Restoring keeps a safety copy.** The live database is copied aside before the swap, so a
    restore is itself undoable.