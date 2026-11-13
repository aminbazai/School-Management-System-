# User Guide

This guide covers what each role can do today. Everything described here is
implemented and tested — there are no placeholder screens.

---

## Signing in

1. Launch **School Management System**.
2. Enter your username and password.
3. On your **first login** you must set a new password (minimum 6 characters). The rest of the
   application stays locked until you do — this rule is enforced in the main process, not just
   hidden in the UI.
4. After 5 wrong passwords the account is locked for 5 minutes. The screen tells you when it
   unlocks; an administrator can also reset it.
5. After 30 minutes without activity you are signed out automatically.

The top bar holds the language switch (**EN / اردو**), the light/dark theme toggle, notifications,
and the account menu (change password / sign out). Switching to Urdu flips the whole interface to
right-to-left with the Nastaliq font.

---

## Principal / Admin — full control

Menu: Dashboard, Students, Teachers & Staff, Classes & Sections, Subjects, Attendance Reports,
Fees, Salary, Exams & Results, Timetable, Users & Roles, Notices, Reports, Settings,
Backup & Restore, Audit Log.

What each screen does:

* **Students** — the full register. Search by name/admission number/phone, filter by class,
  section and status, sort any column, page through results and tick rows to act on them.
  *Add Student* opens a form with academic details (class, section, roll no, admission number —
  left empty it is generated automatically, GR no, admission date), personal details (gender,
  date of birth, B-form, phone, address, previous school) and the guardian. A photo can be
  picked from your computer. Tick **create a student login** and the account is created with the
  admission number as username; the student must set their own password at first login.
* **Excel import** — pick a `.xlsx` file, review the detected columns and the first rows, then
  import. Rows with problems (unknown class, duplicate admission number, missing name) are
  reported with their row number and skipped.
* **Excel / PDF export** — exports whatever the current filters show.
* **ID Cards** — prints a two-column sheet with photo, admission number and class for the
  selected students (or the whole list when nothing is selected).
* **Promotion** — select rows, press *Promote*, choose the new class/section. Use it at the end
  of the school year.
* **Classes & Sections** — six tabs: Classes (name, code, sort order), Sections (capacity, room,
  class teacher), Subjects, Class subjects (max/pass marks, periods per week), **Teacher
  assignments** and academic sessions. Activating a session makes it the current school year
  everywhere.
* **Teacher assignments** — the tab that decides what a teacher can actually reach. Pick a teacher,
  a class, a section and a subject, and press **Add**. From that moment the teacher sees that
  class, can mark its register, can open its timetable and can enter marks for that subject — and
  nothing else. Only subjects the class actually teaches can be assigned, and a teacher that holds
  assignments cannot be deleted until they are removed. This is the tab to use whenever a new
  teacher joins.
* **Subjects** — the tab inside Classes & Sections.
* **Settings** — school profile and logo, academic rules (session, currency, attendance
  cut-off, working days, late fine, absent deduction), theme and default language, the security
  policy in force, the grade scale used for results later, and a **Data** tab with the records the
  database holds and the two destructive actions described below.
* **Attendance** — daily register by class and section. Pick the date, mark each student, add
  remarks, **Mark all present** for the unmarked rows, then **Save register**. Switch to
  **Monthly register** for per-student percentages; anyone under 75% is highlighted.
* **Attendance Reports** — every student below a warning threshold (default 75%, adjustable),
  with the option to filter by class and export the list to CSV.
* **Users & Roles** — create an account (username, role, initial password), **edit** an account
  (role, linked student or staff record, email, phone, active flag and whether the password must be
  changed at the next login), activate/deactivate, reset a password (the user must change it again),
  soft-delete. Search and filter by role. You cannot deactivate or delete your own account, and the
  last active administrator cannot be removed.
* **Dashboard** — greeting, live *Recent Activity* from the audit log, and real numbers with
  charts: students and staff counts, this month's attendance, fee collection, payroll and result
  pass rates, a six-month finance trend and a per-class result breakdown.
* **Fees** and **Expenses** — the same screens the office uses. As an administrator you additionally
  get **Preview month** (calculate a month before issuing it), **Late fine** (add a fine to every
  still-open voucher of a month) and the ability to delete a fee head, a concession, a payment or an
  expense entry. See *Fee Collection* and *Expenses* below — the office and administrator screens are
  the same, with those extra buttons.
* **Exams & Results** — three tabs on one screen.
  * *Exams* — create an exam for a class, then work through its **lifecycle** with the single
    action button on each row: **Open for marks → Publish → Lock**. The order is enforced; a draft
    exam cannot jump to published, and **Locked is permanent** — it is the point at which the
    results become final.
  * *Papers* (the sheet icon) — tick the subjects this exam covers and set each one's total marks,
    pass marks and exam date. The paper list freezes once any mark is entered.
  * *Marks entry* — pick the exam and the paper, type marks, **Save marks**. A box must be between
    0 and the paper total; an empty box clears the mark. The header shows how many of the class are
    entered.
  * *Results* — **Compute results** turns the marks into totals, percentages, grades and
    positions. Students with a missing paper are not scored; a pass requires *every* paper to be
    above its pass mark. The sheet below shows the whole class and every student has a
    **report card** button (save PDF). The grade donut, class average and top five sit above it.
* **Timetable** — *Edit periods* sets up the school day (name, start, end, order, break). Then pick
  a class and section and click any cell to assign a subject and teacher. Saving replaces that
  section's whole week. If a teacher ends up in two sections at the same time, the clash is listed
  at the top as a **warning** — the save still goes through, because substitution is normal.
  Switch to the **Teacher view** to see one teacher's whole week at a glance, and back to the
  **Class view** to edit the grid.
* **Notices** — post an announcement to everyone, teachers, students, the office or all staff. Tick
  *Pinned* to keep it at the top, set an expiry date if it is temporary, and untick *Published* to
  take a notice down without deleting it. Everyone else sees only the notices addressed to them.
* **Backup & Restore** — the screen shows where the database and the backups live.
  * *Create backup* makes a copy now; give it a label if you want to recognise it later.
  * *Import from file* copies a backup from elsewhere into the backup folder — the file is checked
    before it is accepted.
  * *Restore* puts a backup back. **Everything entered since that backup is lost.** The app copies
    the current database aside first, so a restore can itself be undone from the backup list (look
    for a `-prerestore` file).
  * The app also takes **one automatic backup every day it starts** and keeps the last seven.
    Manual backups are never removed automatically.
* **Audit Log** — every login, lockout, change, payment, print and backup, newest first. Filter by
  action, free text or date range, and export the page to CSV.

Every action is written to the audit log.

### Danger zone (Settings > Data)

The **Data** tab shows how many students, staff, attendance records, exams, fee vouchers, payslips,
leave requests, expenses, notices and audit entries the school is holding, and it carries the two
actions that delete things. Both are for the principal only, and both ask you to type a word
before they do anything.

* **Clear all data** — removes every record of the running school: students, staff, the
  attendance, the exams and marks, the fee heads, vouchers and payments, the salary structures,
  payslips and advances, the leave applications and balances, the timetable, the notices, the
  expenses and the audit log. What stays is the school profile and logo, the settings, your
  administrator account and the academic structure — the classes, sections, subjects and periods.
  The school comes out empty and you can start enrolling again straight away.
* **Factory reset** — throws the whole database away and builds a new one, which brings the
  factory demo state back: the seeded accounts (admin, office, teacher1…, the students) and the
  demo records. Every account is recreated, including yours, so the password goes back to
  `admin123` and you have to change it again. Use this to hand the computer over to someone else
  or to start completely clean.

Two things to know before you press either button:

* A **safety backup is taken first** and stays in the backups folder, so the backup screen can put
  everything back if you change your mind.
* Your **session ends** when the action finishes, so you are taken back to the login screen and
  can see the result with your own eyes.

The audit log is emptied with everything else, but the record of the deletion itself is written
afterwards — it is the only trace left of it.

---

## Office / Accounts

Menu: Dashboard, Teacher & Staff Records, Teacher Attendance, Salary Management, Fee Collection,
Admissions, Expenses, Reports, Timetable, Notices, Student Attendance.

Dashboard, **Admissions** (the student module in admission mode — create students and their logins,
import from Excel, export lists and ID cards), **Teacher & Staff Records**, **Teacher Attendance**,
**Student Attendance**, **Timetable**, **Notices** and change password.
You cannot delete students or change settings. Salary, fees and expenses are all available.

### Reports

The **Reports** screen has one button per report: Enrolment, Attendance, Fee collection, Payroll and
Results. Pick one, choose the month where it matters, and press **Run report**. The figures are built
live from the current records. **Save as PDF** writes the same table (and the same totals) to a
landscape PDF using the school name and the report footer from Settings.

### Timetable

The office can read the timetable but not change it — that is the administrator's job. Pick a class
and a section to see the week, or switch to the **Teacher view** to see one teacher's whole week.
The cells are read-only for you.

### Teacher Attendance

1. Open **Teacher Attendance** and pick the date.
2. Filter by *All types*, *Teacher*, *Office* or *Other*.
3. Click a status for each person and set the check-in / check-out times.
4. **Save**. Yesterday and earlier days are read-only for the attendance desk too — corrections go
   through an administrator.

The **Monthly summary** tab shows present / absent / leave / late / half day plus a percentage for
every staff member.

The **Leaves** tab is the leave desk. It has two views:

* **Requests** — every application, with a *Apply for leave* button that records a leave on behalf
  of a staff member (type, dates and reason). Approve or reject a pending application with one
  click. An approved leave is immediately deducted from that person's balance and is marked as
  *leave* on the staff register, so the payroll does not treat those days as an absence. Withdrawing
  an approval takes the days back off the register.
* **Balances** — one row per staff member and one column per leave type, showing *used / total*.
  Change the yearly quota for a person by typing a new number in the box and clicking away. The
  used days are always derived from the approved applications; only the quota is yours to set.

### Salary Management

The screen has three tabs: **Payroll**, **Salary structures** and **Advances & loans**.

**Payroll** — choose the month and press **Preview payroll**. Every active staff member is
calculated (nothing is saved yet) and the totals appear at the top. If the figures are right, press
**Generate payroll**. Staff who already have a payslip for that month are skipped, and generating
the same month twice is refused.

For each payslip you can open the slip, print it, or mark it **paid** with a payment method and
reference. A paid payslip can no longer be edited or deleted.

**Salary structures** — pick a staff member, set the basic salary (it also updates their staff
record), and add allowances (house rent, medical, transport, fuel, special, custom) and deductions
(tax, provident fund, insurance, custom). Tick *percentage of basic salary* for a row that should
scale with the salary instead of being a fixed amount.

Two kinds of deduction are automatic and driven by attendance:

* **Absent day** — the per-day amount from Settings → Academic is multiplied by the absent days.
* **Late day** — if a deduction row of type *late* exists, its amount is applied per late day.

**Advances & loans** — record an amount and the number of installments. One installment is recovered
from each payroll until it is fully recovered; the remaining amount is shown in the list.

### Fee Collection

Five tabs: **Collection**, **Fee heads**, **Concessions**, **Defaulter list** and
**Collection report**. An administrator also has the *Preview month*, *Late fine* and *Save PDF*
buttons here.

**Collection** — this is the cashier's screen.

1. Pick the month (or *All months*), optionally a class and a status, and search by student name,
   admission number or voucher number.
2. The four figures at the top are for the current filter: billed, paid, balance and how many
   vouchers are still open.
3. Press the **Collect fee** button (the hand with a coin) on a row to open the payment dialog. The
   outstanding amount is filled in for you; change it to take a part payment, or leave it to settle
   the voucher in full. Enter the date, the mode (cash / bank transfer / cheque / online) and a
   reference such as the cheque or transaction number.
4. **Save payment**. The status becomes *Part paid* or *Paid* automatically — nothing is typed in by
   hand. A dialog then offers to **print** the receipt or **save it as PDF**.

Press the page icon on a row to open the voucher: its fee items, the concession that was applied,
the payments received so far (each one printable), and the remaining balance. An administrator can
delete a payment with the bin icon, which puts the balance back.

**Fee heads** (administrator) — the parts that make up a monthly fee. Pick a class (or leave *All
classes* to apply the row everywhere), then **Add fee head**: name, type, frequency and amount. Only
*monthly* heads are pulled into a voucher; one-time and yearly heads are kept on the record for
reference. Edit or delete a head with the pencil and bin icons — deleting only hides it from future
vouchers, it never touches vouchers already issued.

**Concessions** — a sibling concession, a merit award or a staff-child reduction. Pick the student,
name the concession, and give either a fixed amount, a percentage, or both, plus a reason. The
concession is subtracted from every voucher generated for that student from then on, and can never
push the fee below zero.

**Defaulter list** — every voucher that is unpaid or part paid, largest balance first. Filter by
month or class, search by name/admission number/voucher, and **CSV** the list to follow up. The
*Siblings* column shows the other children of the same guardian — the whole family can be settled in
one visit, and a concession covering them is usually worth setting first.

**Collection report** — choose a date range (and optionally a class) to see the money collected each
day, split into cash and bank/online, with per-mode totals across the period. This is the figure to
compare against the cash in the drawer at the end of the day.

### Expenses

Two tabs: **Entries** and **Report**.

**Entries** is a day book. **Add entry**, then choose *Expense* or *Income*, a category, an optional
description, the amount, the date and the mode. Categories for expenses are Utilities, Maintenance,
Stationery, Transport, Salaries, Events, Repairs and Other; for income they are Admission, Donation,
Event and Other Income. The three figures at the top are the income, the expenses and the net for the
selected month. Filter by month, type and category, search the text, and **CSV** the result.

Only an administrator can delete an entry, and deleting hides it from the totals rather than erasing
it. Editing an entry only changes the fields you actually fill in.

**Report** shows the same month broken down per category (expense on one side, income on the other)
and a month-by-month table of income, expenses and net — the quick answer to "did we break even?".

---

## Teacher

Menu: Dashboard, My Classes, Student Attendance, Marks Entry, My Timetable, My Attendance,
My Leave, My Salary Slips, Notices, Change Password.

Dashboard, **Student Attendance**, **My Attendance**, **My Leave** and change password.

*Student Attendance* is your marking screen. Pick a class and section — you only ever see the
sections you are assigned to — then mark each student Present, Absent, Leave, Late or Half day,
add a remark where it matters, and press **Save register**. **Mark all present** fills the
unmarked rows in one step.

Two rules are enforced by the application itself, not just hidden from you:

* you can only mark **today's** register — earlier days are read-only and an administrator must
  correct them;
* you can only mark **your own classes**.

*My Attendance* shows your own monthly record with percentages and a summary.

*My Leave* is your own leave desk. The four figures at the top are the leave you have been given
this year, the days you have used, what is left and how many applications are still waiting. The
panel on the right shows the balance of every leave type; the table lists your applications with
their decision.

* **Apply for leave** — pick the type, the first and the last day and a reason, then press
  **Save**. The application is *pending* until the office decides. You cannot ask for more days
  than the balance of a paid leave type allows.
* **Withdraw** — a pending application can be taken back while it is still waiting. Once it has
  been approved or rejected it can no longer be withdrawn.

You only ever see your own leave — the application resolves which staff member you are from your
account, not from anything the screen asks for.

*My Salary Slips* lists your payslips with basic, allowances, deductions, net pay and your
attendance for that month. Open a slip to see the itemised earnings and deductions, print it, or
save it as a PDF. You only ever see your own payslips — the application resolves which staff member
you are from your account, not from anything the screen asks for.

**Marks Entry** — open it from the sidebar. The page lists the exams that are open for marks for the
classes you teach. Pick one, then pick a paper from the row of tabs (each shows how many of the class
are done). Type the marks and press **Save marks**. Two rules are enforced by the application, not just
hidden from you:

* you can only enter marks for **the subjects you actually teach** — every other paper is read-only,
  so you can still see what has been entered;
* an exam that is not open (or that has been locked) refuses marks.

**My Timetable** shows your week: every period with the subject, the room and who teaches it.

**Notices** shows the announcements addressed to you, pinned ones first.

Teachers have no access to fees or expenses at all.

---

## Student (read-only)

Menu: Dashboard, My Profile, My Class & Section, My Attendance, My Results, My Fee Status,
Timetable, Notices, Change Password.

Everything is read-only — the only thing you can change is your password.

*My Attendance* shows your percentage for the month, the counts for each status, a colour-coded
calendar (green present, red absent, amber leave/late, blue half day) and a 12-month trend so you
can see where you stand before the term ends.

*My Results* lists every result the school has published, newest first, with the percentage, grade
and position (a tie is shown as *tied*). Press the report-card icon to see the full breakdown —
every subject with its marks, pass mark and result — then **Save as PDF** to keep a copy or
**Preview** to print. Results appear here only once the school publishes them; the school decides
that, not you.

*My Fee Status* has three figures at the top — **Billed**, **Paid** and **Balance** — and two tabs.

* **Vouchers** — every fee voucher issued to you: the month, the voucher number, the total, the
  discount applied, what has been paid, what is still due, the due date and the status
  (*Unpaid*, *Part paid*, *Paid*).
* **Receipts** — every payment received, with its receipt number, date, voucher and amount. Use the
  printer icon to print a receipt or the page icon to save it as a PDF and keep it.

You only ever see your own account — the school resolves which student you are from your login, not
from anything the screen asks for. If an amount is outstanding, the receipt shows what is still
left so you can settle it at the fee counter.

**Timetable** shows your section's week: every period with the subject, the teacher and the room.

**Notices** shows the announcements addressed to students, pinned ones first.

---

## Keyboard and windows

* Minimum window size 1280×720; the layout adapts to wider screens.
* `Esc` closes a dialog, `Tab` moves through form fields, labels are keyboard reachable.
* The application is single-instance: opening it again focuses the running window.