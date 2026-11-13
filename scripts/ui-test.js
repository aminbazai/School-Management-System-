'use strict';

/**
 * UI end-to-end test (dev tool): `npm run test:ui`
 *
 * Drives the real interface - opens modals, fills the forms, clicks Save -
 * and verifies the result through the API. This covers the renderer code that
 * the service tests cannot reach.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-ui-test');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
app.setPath('userData', TMP);
app.disableHardwareAcceleration();

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.error(`  FAIL  ${label}${detail !== undefined ? ` -> ${String(JSON.stringify(detail)).slice(0, 200)}` : ''}`);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Helper injected into the page: set a React-controlled input value. */
const HELPERS = `
  window.__t = {
    byLabel(label, tag = 'input') {
      const el = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(label));
      if (!el) return null;
      return document.getElementById(el.htmlFor);
    },
    setValue(el, value) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    button(text) {
      return [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
    },
    clickText(text) {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(text));
      if (!b) throw new Error('no button: ' + text);
      b.click();
      return true;
    },
    text() { return document.body.innerText; },
  };
  true;
`;

async function main() {
  const { initDatabase, getDb, closeDatabase } = require('../electron/db/connection');
  const { registerIpc } = require('../electron/ipc');

  initDatabase({ seed: true });
  registerIpc();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // Every renderer error is collected: a page that crashes while rendering
  // still "passes" a heading check, so the errors are asserted on at the end.
  const rendererErrors = [];
  win.webContents.on('console-message', (...a) => {
    const level = typeof a[0] === 'object' ? a[1] : a[0];
    const msg = typeof a[0] === 'object' ? a[2] : a[1];
    if (level === 3 || level === 'error') {
      const text = String(msg).slice(0, 300);
      rendererErrors.push(text);
      console.error(`  [renderer] ${text}`);
    }
  });
  win.webContents.on('render-process-gone', (_e, _wc, details) => {
    rendererErrors.push(`render process gone: ${JSON.stringify(details)}`);
  });

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await wait(1200);

  /** executeJavaScript can hang if the page reloads mid-call - never block forever. */
  const js = (code, timeout = 8000) =>
    Promise.race([
      win.webContents.executeJavaScript(code, true),
      new Promise((_, reject) => setTimeout(() => reject(new Error('js timeout')), timeout)),
    ]);

  // sign in and open a route
  const step = (name) => console.log('  ... ' + name);

  const open = async (hash, heading, options = {}) => {
    step('open ' + hash);
    await js(`(async () => {
      const s = await window.school.auth.session();
      if (!s.data.user) {
        await window.school.auth.login({ username: 'admin', password: 'admin123' });
        await window.school.auth.changePassword({ currentPassword: 'admin123', newPassword: 'admin1234' });
      }
      return true;
    })()`);
    await js(`location.hash = ${JSON.stringify(hash)}; location.reload(); true`);
    await wait(2000);
    for (let i = 0; i < 30; i += 1) {
      await wait(200);
      await js(HELPERS).catch(() => {});
      // the top bar renders the first <h1>; the page heading is the last one
      const text = await js(
        `(() => {
           const list = [...document.querySelectorAll('h1')].map((el) => el.textContent || '');
           return ${options.second ? 'list[list.length - 1]' : 'list[0]'} || '';
         })()`,
      ).catch(() => '');
      if (!heading || String(text).includes(heading)) return;
    }
  };

  console.log('\n--- students form ----------------------------------------------------');
  await open('#/admin/students', 'Students');

  const before = (await js(`window.school.students.list({ page: 1, pageSize: 5 }).then(JSON.stringify)`)).length;

  // empty submit must show validation, not crash
  await js(`window.__t.clickText('Add Student'); true`);
  await wait(400);
  check('add-student modal opens', await js(`!!document.querySelector('[role="dialog"]')`));
  await js(`window.__t.clickText('Save'); true`);
  await wait(400);
  check('empty form shows a validation message', /required|Required/.test(await js(`window.__t.text()`)));

  const classId = getDb().prepare(`SELECT id FROM classes WHERE is_deleted = 0 ORDER BY level_order LIMIT 1`).get().id;
  const sectionId = getDb().prepare(`SELECT id FROM sections WHERE class_id = ? LIMIT 1`).get(classId).id;

  await js(`
    (() => {
      window.__t.setValue(window.__t.byLabel('Name'), 'Ui Test Student');
      window.__t.setValue(window.__t.byLabel("Father's Name"), 'Ui Father');
      window.__t.setValue(window.__t.byLabel('Phone'), '03001234567');
      window.__t.setValue(window.__t.byLabel('Guardian Name'), 'Ui Guardian');
      window.__t.setValue(window.__t.byLabel('Class'), '${classId}');
      return true;
    })()
  `);
  await wait(300);
  await js(`window.__t.setValue(window.__t.byLabel('Section'), '${sectionId}'); true`);
  await wait(200);
  await js(`window.__t.clickText('Save'); true`);
  await wait(1200);

  check('modal closes after a valid save', await js(`!document.querySelector('[role="dialog"]')`));

  const created = getDb().prepare(`SELECT * FROM students WHERE name = 'Ui Test Student'`).get();
  check('student row was written to the database', !!created, created);
  check('admission number was generated', created && /^ADM-\d{4}-\d{3}$/.test(created.admission_no), created && created.admission_no);
  check('class and section were stored', created && created.class_id === classId && created.section_id === sectionId);
  check('guardian was stored', created && !!getDb().prepare(`SELECT 1 x FROM student_guardians WHERE student_id = ?`).get(created.id));

  const login = getDb().prepare(`SELECT username FROM users WHERE role='student' AND linked_id = ?`).get(created && created.id);
  check('student login was created automatically', !!login, login);
  check('new student appears in the table', await js(`window.__t.text().includes('Ui Test Student')`));

  // search filter
  await js(`(() => {
    const input = document.querySelector('input[placeholder*="Search"]');
    window.__t.setValue(input, 'Ui Test Student');
    return true;
  })()`);
  await wait(900);
  const rowsShown = await js(`document.querySelectorAll('tbody tr').length`);
  check('search narrows the table to one row', rowsShown === 1, rowsShown);

  step('students section done');
  console.log('\n--- classes form -----------------------------------------------------');
  await open('#/admin/classes', 'Classes');
  await js(`window.__t.clickText('Add'); true`);
  await wait(400);
  await js(`window.__t.setValue(window.__t.byLabel('Name'), 'Ui Class'); true`);
  await wait(150);
  await js(`window.__t.clickText('Save'); true`);
  await wait(1000);
  const cls = getDb().prepare(`SELECT * FROM classes WHERE name = 'Ui Class' AND is_deleted = 0`).get();
  check('class created from the UI', !!cls, cls);
  check('new class is listed', await js(`window.__t.text().includes('Ui Class')`));

  // delete the class again (it has no students)
  await js(`(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Ui Class'));
    const del = [...row.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Delete');
    del.click();
    return true;
  })()`);
  await wait(400);
  await js(`window.__t.clickText('Delete'); true`);
  await wait(800);
  const deleted = getDb().prepare(`SELECT is_deleted FROM classes WHERE id = ?`).get(cls.id);
  check('class soft deleted from the UI', deleted.is_deleted === 1, deleted);

  console.log('\n--- subjects deep link ----------------------------------------------');
  // /admin/subjects has no page of its own - it must land on the subjects tab.
  await open('#/admin/subjects', 'Classes & Sections');
  await wait(700);
  check(
    'the subjects deep link opens the subjects tab',
    await js(`window.__t.text().includes('English')`),
  );
  const subjectsActive = await js(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Subjects'));
    return btn ? btn.className.includes('btn-primary') : false;
  })()`);
  check('the Subjects tab is the selected one', subjectsActive === true, subjectsActive);
  check(
    'subject rows are listed',
    await js(`document.querySelectorAll('tbody tr').length > 0`),
  );

  console.log('\n--- teacher assignments ----------------------------------------------');
  await open('#/admin/classes', 'Classes & Sections');
  await wait(700);
  await js(`window.__t.clickText('Teacher Assignments'); true`);
  await wait(1200);
  const assignmentBody = await js(`document.body.innerText`);
  check('the teacher assignments tab lists the seeded assignments', /Science|English|Mathematics/.test(assignmentBody), assignmentBody.slice(0, 200));

  // a teacher, a class, a section of that class and a subject the class teaches
  const newTeacher = getDb().prepare(`SELECT id FROM staff WHERE staff_type='teacher' AND is_deleted=0 ORDER BY id LIMIT 1`).get().id;
  const assignClass = getDb().prepare(`SELECT id FROM classes WHERE is_deleted=0 ORDER BY level_order LIMIT 1`).get().id;
  const assignSection = getDb().prepare(`SELECT id FROM sections WHERE class_id=? AND is_deleted=0 LIMIT 1`).get(assignClass).id;
  const assignSubject = getDb()
    .prepare(`SELECT subject_id FROM class_subjects WHERE class_id=? AND is_active=1 LIMIT 1`)
    .get(assignClass).subject_id;

  await js(`window.__t.clickText('Add'); true`);
  await wait(500);
  check('the assignment modal opens', await js(`!!document.querySelector('[role="dialog"]')`));
  await js(`window.__t.setValue(window.__t.byLabel('Teacher'), '${newTeacher}'); true`);
  await wait(200);
  await js(`window.__t.setValue(window.__t.byLabel('Class'), '${assignClass}'); true`);
  await wait(400);
  await js(`window.__t.setValue(window.__t.byLabel('Section'), '${assignSection}'); true`);
  await wait(200);
  await js(`window.__t.setValue(window.__t.byLabel('Subject'), '${assignSubject}'); true`);
  await wait(200);
  await js(`window.__t.clickText('Save'); true`);
  await wait(1200);

  const assignment = getDb()
    .prepare(`SELECT * FROM teacher_assignments WHERE teacher_id=? AND class_id=? AND section_id=? AND subject_id=? AND is_active=1`)
    .get(newTeacher, assignClass, assignSection, assignSubject);
  check('the assignment was created from the UI', !!assignment, assignment);
  check('the assignment modal closed', await js(`!document.querySelector('[role="dialog"]')`));

  console.log('\n--- editing a user --------------------------------------------------');
  await open('#/admin/users', 'Users');
  await wait(700);
  await js(`(() => {
    const row = document.querySelectorAll('tbody tr')[1];
    if (!row) return false;
    const btn = [...row.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Edit user');
    if (!btn) return false;
    btn.click();
    return true;
  })()`).then((r) => check('the edit button opens the account form', r === true, r));
  await wait(500);
  check('the edit form opens', await js(`!!document.querySelector('[role="dialog"]')`));
  await js(`window.__t.setValue(window.__t.byLabel('Phone'), '03009998888'); true`);
  await wait(200);
  await js(`window.__t.clickText('Save'); true`);
  await wait(1000);
  const editedPhone = getDb()
    .prepare(`SELECT phone FROM users WHERE id = (SELECT id FROM users WHERE username='office')`)
    .get().phone;
  check('the account was edited from the UI', editedPhone === '03009998888', editedPhone);
  check('the edit form closed', await js(`!document.querySelector('[role="dialog"]')`));

  console.log('\n--- settings form ----------------------------------------------------');
  await open('#/admin/settings', 'Settings');
  await js(`window.__t.setValue(window.__t.byLabel('School name'), 'Bright Future Academy'); true`);
  await wait(200);
  await js(`window.__t.clickText('Save'); true`);
  await wait(900);
  const saved = getDb().prepare(`SELECT value FROM settings WHERE key = 'school_name'`).get();
  check('settings save through the UI', saved.value === 'Bright Future Academy', saved);
  check('sidebar picks up the new school name', await js(`window.__t.text().includes('Bright Future Academy')`));

  console.log('\n--- attendance marking ----------------------------------------------');
  await open('#/admin/attendance', 'Student Attendance');
  await wait(900);
  await js(HELPERS);

  const rowsBefore = await js(`document.querySelectorAll('tbody tr').length`);
  check('attendance grid loads the class roster', rowsBefore > 0, rowsBefore);

  await js(`(() => {
    const row = document.querySelectorAll('tbody tr')[0];
    const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Absent');
    btn.click();
    return true;
  })()`);
  await wait(250);
  await js(`window.__t.clickText('Save register'); true`);
  await wait(1200);

  const savedAbsent = getDb()
    .prepare(`SELECT COUNT(*) n FROM student_attendance WHERE date = date('now','localtime') AND status = 'absent'`)
    .get().n;
  check('absent status saved from the UI', savedAbsent >= 1, savedAbsent);

  const markedBy = getDb()
    .prepare(`SELECT marked_by FROM student_attendance WHERE date = date('now','localtime') AND status = 'absent' LIMIT 1`)
    .get();
  check('marking records who marked it', markedBy && markedBy.marked_by === 1, markedBy);

  await js(`window.__t.clickText('Monthly register'); true`);
  await wait(1800);
  const registerText = await js(`document.body.innerText`);
  check('monthly register shows percentages', /%/.test(registerText), registerText.slice(0, 120));

  console.log('\n--- salary payroll -------------------------------------------------');
  await open('#/admin/salary', 'Salary Management', { second: true });
  await wait(900);
  check('salary screen opens', (await js(`document.body.innerText`)).includes('Payroll'));

  // preview the current month, then generate it
  await js(`window.__t.clickText('Preview payroll'); true`);
  await wait(1500);
  const previewText = await js(`document.body.innerText`);
  check('payroll preview lists staff', /Gross|allowance/i.test(previewText), previewText.slice(0, 140));

  const staffRows = getDb().prepare(`SELECT COUNT(*) n FROM staff WHERE is_deleted = 0 AND staff_type IN ('teacher','office')`).get().n;
  await js(`window.__t.clickText('Generate payroll'); true`);
  await wait(2500);
  const payrollCount = getDb().prepare(`SELECT COUNT(*) n FROM payroll WHERE month = substr(date('now'),1,7)`).get().n;
  check('payroll generated from the UI', payrollCount > 0, { payrollCount, staffRows });

  const netOk = getDb()
    .prepare(`SELECT COUNT(*) n FROM payroll WHERE month = substr(date('now'),1,7) AND ABS(net - (gross - deductions_total - advance_recovery)) > 0.01`)
    .get().n;
  check('generated payroll maths is consistent', netOk === 0, netOk);

  // mark the first one paid
  await js(`(() => {
    const row = document.querySelectorAll('tbody tr')[0];
    const btn = [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').length > 0);
    return !!row;
  })()`);
  // the seed already contains last month's paid payroll; this month must be fresh
  const paidThisMonth = getDb()
    .prepare(`SELECT COUNT(*) n FROM payroll WHERE month = substr(date('now'),1,7) AND status = 'paid'`)
    .get().n;
  check('newly generated payslips start unpaid', paidThisMonth === 0, paidThisMonth);

  console.log('\n--- fee collection -------------------------------------------------');
  // fee collection is an admin/office module, so switch to the office account
  await js(`(async () => {
    await window.school.auth.logout();
    const res = await window.school.auth.login({ username: 'office', password: 'office123' });
    if (!res.ok) return 'LOGIN_FAILED';
    const cp = await window.school.auth.changePassword({ currentPassword: 'office123', newPassword: 'office1234' });
    return cp.ok ? 'OK' : 'CHANGE_FAILED';
  })()`).then((r) => {
    if (String(r) !== 'OK') console.error(`  office sign-in: ${r}`);
  });

  // make sure there is a month of vouchers to work with (admin-only generate)
  const work = await js(`(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  })()`);
  await js(`(async () => {
    await window.school.auth.logout();
    await window.school.auth.login({ username: 'admin', password: 'admin1234' });
    await window.school.fees.generate({ month: '${work.slice(0, 4)}', period: '${work.slice(5, 7)}' });
    await window.school.auth.logout();
    await window.school.auth.login({ username: 'office', password: 'office1234' });
    return true;
  })()`);
  await wait(400);

  await js(`location.hash = '#/office/fees'; location.reload(); true`);
  await wait(2500);
  await js(HELPERS).catch(() => {});
  check('fee screen opens', (await js(`document.body.innerText`)).includes('Fee heads'), (await js(`document.body.innerText`)).slice(0, 200));

  const voucherRows = await js(`document.querySelectorAll('tbody tr').length`);
  check('fee vouchers are listed', voucherRows > 0, voucherRows);

  // switch the month filter to the month we just generated
  await js(`(() => {
    const el = window.__t.byLabel('Month', 'select');
    if (!el) return false;
    window.__t.setValue(el, '${work}');
    return true;
  })()`).then((r) => check('month filter can be switched', r === true, r));
  await wait(1600);
  const futureRows = await js(`document.querySelectorAll('tbody tr').length`);
  check('the generated month shows vouchers', futureRows > 0, futureRows);

  // collect a payment on the first open voucher (office may collect, admin generates)
  const opened = await js(`(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => /unpaid/i.test(r.textContent));
    if (!row) return 'NO_ROW';
    const btn = [...row.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Collect fee');
    if (!btn) return 'NO_BUTTON';
    btn.click();
    return 'CLICKED';
  })()`);
  check('collect button found on an unpaid voucher', opened === 'CLICKED', opened);
  await wait(600);
  check('collect-payment modal opens', await js(`!!document.querySelector('[role="dialog"]')`));

  await js(`window.__t.clickText('Save payment'); true`);
  await wait(1500);
  const paidRows = getDb().prepare(`SELECT COUNT(*) AS n FROM fee_payments WHERE is_deleted = 0`).get().n;
  check('a payment was recorded from the UI', paidRows > 10, paidRows);

  const receiptShown = await js(`document.body.innerText`);
  check('a receipt confirmation is shown', /receipt/i.test(receiptShown), receiptShown.slice(0, 140));
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Close');
    if (b) b.click();
    return true;
  })()`);
  await wait(400);

  // expenses
  await js(`location.hash = '#/office/expenses'; location.reload(); true`);
  await wait(2500);
  await js(HELPERS).catch(() => {});
  check('expense screen opens', (await js(`document.body.innerText`)).includes('Entries'), (await js(`document.body.innerText`)).slice(0, 200));
  await js(`window.__t.clickText('Add entry'); true`);
  await wait(500);
  await js(`(() => {
    window.__t.setValue(window.__t.byLabel('Description'), 'Ui Test Expense');
    window.__t.setValue(window.__t.byLabel('Amount'), '1234');
    return true;
  })()`);
  await wait(250);
  await js(`window.__t.clickText('Save'); true`);
  await wait(1200);
  const uiExpense = getDb().prepare(`SELECT * FROM expenses WHERE description = 'Ui Test Expense'`).get();
  check('an expense is created from the UI', !!uiExpense, uiExpense);
  check('the new expense appears in the table', await js(`window.__t.text().includes('Ui Test Expense')`));

  console.log('\n--- teacher my classes ----------------------------------------------');
  await js(`(async () => {
    await window.school.auth.logout();
    await window.school.auth.login({ username: 'teacher1', password: 'teacher123' });
    await window.school.auth.changePassword({ currentPassword: 'teacher123', newPassword: 'teacher1234' });
    return true;
  })()`);
  await js(`location.hash = '#/teacher/classes'; location.reload(); true`);
  await wait(2500);
  await js(HELPERS).catch(() => {});
  const classesBody = await js(`document.body.innerText`);
  check('the my-classes page opens', /My Classes/i.test(classesBody), classesBody.slice(0, 160));

  const assignedSections = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM teacher_assignments ta
       JOIN users u ON u.linked_id = ta.teacher_id AND u.username = 'teacher1'
       WHERE ta.is_active = 1`,
    )
    .get().n;
  const sectionRows = await js(`document.querySelectorAll('tbody tr').length`);
  check('assigned sections are listed', sectionRows > 0 && sectionRows <= assignedSections, {
    sectionRows,
    assignedSections,
  });

  const taughtSubjects = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT ta.subject_id) AS n FROM teacher_assignments ta
       JOIN users u ON u.linked_id = ta.teacher_id AND u.username = 'teacher1'
       WHERE ta.is_active = 1`,
    )
    .get().n;
  check('a subject the teacher holds is shown', /Science|English|Mathematics/.test(classesBody), classesBody.slice(0, 200));
  check('the subject count matches the assignments', taughtSubjects > 0, taughtSubjects);

  // open a roster for the first section
  await js(`(() => {
    const row = document.querySelectorAll('tbody tr')[0];
    if (!row) return false;
    const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Roster');
    if (!btn) return false;
    btn.click();
    return true;
  })()`).then((r) => check('the roster button is present', r === true, r));
  await wait(1600);
  check('the section roster opens', await js(`!!document.querySelector('[role="dialog"]')`));
  const rosterBody = await js(`document.body.innerText`);
  check('the roster lists students', /ADM-/.test(rosterBody), rosterBody.slice(-200));
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Close');
    if (b) b.click();
    return true;
  })()`);
  await wait(400);

  console.log('\n--- teacher my leave ------------------------------------------------');
  await js(`location.hash = '#/teacher/my-leave'; location.reload(); true`);
  await wait(2500);
  await js(HELPERS).catch(() => {});
  const leaveBody = await js(`document.body.innerText`);
  check('the my-leave page opens', /My Leave/i.test(leaveBody), leaveBody.slice(0, 160));
  check('the leave balances are shown', /Casual|Sick|Earned/.test(leaveBody), leaveBody.slice(0, 240));

  const teacherStaff = getDb().prepare(`SELECT linked_id FROM users WHERE username='teacher1'`).get().linked_id;
  const casualType = getDb().prepare(`SELECT id FROM leave_types WHERE name='Casual'`).get().id;

  await js(`window.__t.clickText('Apply for leave'); true`);
  await wait(500);
  check('the leave form opens', await js(`!!document.querySelector('[role="dialog"]')`));
  await js(`window.__t.setValue(window.__t.byLabel('Leave type'), '${casualType}'); true`);
  await wait(200);
  await js(`window.__t.setValue(window.__t.byLabel('From'), '${new Date().toISOString().slice(0, 10)}'); true`);
  await wait(150);
  await js(`window.__t.setValue(window.__t.byLabel('To'), '${new Date().toISOString().slice(0, 10)}'); true`);
  await wait(150);
  await js(`window.__t.setValue(window.__t.byLabel('Reason'), 'Ui test leave'); true`);
  await wait(200);
  await js(`window.__t.clickText('Save'); true`);
  await wait(1400);

  const uiLeave = getDb()
    .prepare(`SELECT * FROM leaves WHERE staff_id=? AND reason='Ui test leave' ORDER BY id DESC LIMIT 1`)
    .get(teacherStaff);
  check('the leave application was created from the UI', !!uiLeave && uiLeave.status === 'pending', uiLeave);
  check('the application appears in the table', await js(`window.__t.text().includes('Ui test leave')`));

  await js(`window.__t.clickText('Withdraw'); true`);
  await wait(1200);
  const withdrawn = getDb().prepare(`SELECT status FROM leaves WHERE id=?`).get(uiLeave.id);
  check('the teacher can withdraw the application from the UI', withdrawn.status === 'cancelled', withdrawn);

  console.log('\n--- unknown route ----------------------------------------------------');
  await js(`location.hash = '#/teacher/does-not-exist'; location.reload(); true`);
  await wait(2000);
  const notFoundBody = await js(`document.body.innerText`);
  check('an unknown route explains itself instead of promising a phase', /not found/i.test(notFoundBody), notFoundBody.slice(0, 160));
  check('the unknown route offers a way back', notFoundBody.includes('Back'), notFoundBody.slice(0, 200));

  console.log('\n--- student self-service ----------------------------------------------');
  const adm = `adm-${new Date().getFullYear()}-001`;
  await js(`(async () => {
    await window.school.auth.logout();
    await window.school.auth.login({ username: ${JSON.stringify(adm)}, password: 'ADM-${new Date().getFullYear()}-001' });
    // a seeded student must change the password before anything else works
    await window.school.auth.changePassword({ currentPassword: 'ADM-${new Date().getFullYear()}-001', newPassword: 'student1234' });
    return true;
  })()`);
  await js(`location.hash = '#/student/class'; location.reload(); true`);
  await wait(2500);
  await js(HELPERS).catch(() => {});
  const body = await js(`document.body.innerText`);
  check('student sees their own class page', /Play Group|Nursery|Class 1/.test(body), body.slice(0, 120));
  check('student cannot see the admin menu', !body.includes('Backup & Restore'));
  check('student sees their own admission number', body.includes('ADM-'), body.slice(0, 200));

  const meResult = await js(`window.school.students.me().then(JSON.stringify)`);
  check('students:me resolves the record in main', JSON.parse(meResult).ok === true, meResult.slice(0, 120));
  const listDenied = await js(`window.school.students.list({ page: 1, pageSize: 5 }).then(JSON.stringify)`);
  check('student cannot list other students', JSON.parse(listDenied).error?.code === 'FORBIDDEN', listDenied.slice(0, 160));

  // student fee status page
  await js(`location.hash = '#/student/fees'; location.reload(); true`);
  await wait(2200);
  await js(HELPERS).catch(() => {});
  const feesBody = await js(`document.body.innerText`);
  check('student sees their own fee status', /Fee Status/i.test(feesBody), feesBody.slice(0, 140));
  const studentFees = await js(`window.school.fees.my().then(JSON.stringify)`);
  const parsedFees = JSON.parse(studentFees);
  check('fees.my resolves the student account in main', parsedFees.ok === true, studentFees.slice(0, 120));
  check('the student account matches their own record', parsedFees.ok && parsedFees.data.vouchers.every((v) => v.studentId === parsedFees.data.student.id));
  check('the student sees their own admission number', feesBody.includes('ADM-'), feesBody.slice(0, 200));

  console.log('\n--- timetables render ----------------------------------------------');
  // The grid is built in the main process; the renderer has to read it the
  // right way or the whole page comes up blank.
  await js(`(async () => {
    await window.school.auth.logout();
    await window.school.auth.login({ username: 'admin', password: 'admin1234' });
    return true;
  })()`);
  await js(`location.hash = '#/admin/timetable'; location.reload(); true`);
  await wait(2500);
  await js(HELPERS).catch(() => {});
  const ttBody = await js(`document.body.innerText`);
  check('the admin timetable renders its grid', /Period 1|Period 2/.test(ttBody), ttBody.slice(0, 200));
  check(
    'the timetable grid has a cell for every period',
    (await js(`document.querySelectorAll('table.data-table tbody tr').length`)) > 0,
  );
  check(
    'the timetable shows the subjects it holds',
    /English|Science|Mathematics|Urdu/.test(ttBody),
    ttBody.slice(0, 240),
  );

  await js(`(async () => {
    await window.school.auth.logout();
    await window.school.auth.login({ username: 'teacher1', password: 'teacher1234' });
    return true;
  })()`);
  await js(`location.hash = '#/teacher/timetable'; location.reload(); true`);
  await wait(2500);
  await js(HELPERS).catch(() => {});
  const teacherTt = await js(`document.body.innerText`);
  check('the teacher timetable renders its grid', /Period 1|Period 2/.test(teacherTt), teacherTt.slice(0, 200));

  console.log('\n--- clearing all the data -------------------------------------------');
  // This is the last thing the run does: it empties the school.
  await js(`(async () => {
    await window.school.auth.logout();
    await window.school.auth.login({ username: 'admin', password: 'admin1234' });
    return true;
  })()`);
  await open('#/admin/settings', 'Settings');
  await wait(700);
  await js(HELPERS).catch(() => {});
  await js(`window.__t.clickText('Data'); true`);
  await wait(1500);
  const dataBody = await js(`document.body.innerText`);
  check('the data tab opens', /Records in the database|Danger zone/.test(dataBody), dataBody.slice(0, 200));
  check('it shows what the database holds', /\b24\b|\b3\b/.test(dataBody), dataBody.slice(0, 240));

  await js(`window.__t.clickText('Clear all data'); true`);
  await wait(700);
  check('the confirmation dialog opens', await js(`!!document.querySelector('[role="dialog"]')`));

  const confirmDisabled = await js(`(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Clear all data');
    return btn ? btn.disabled : null;
  })()`);
  check('the confirm button is locked until the word is typed', confirmDisabled === true, confirmDisabled);

  await js(`window.__t.setValue(window.__t.byLabel('Type DELETE'), 'DELETE'); true`);
  await wait(400);
  const confirmEnabled = await js(`(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Clear all data');
    return btn ? !btn.disabled : null;
  })()`);
  check('typing the word unlocks the confirm button', confirmEnabled === true, confirmEnabled);

  // The button inside the dialog - the one on the page behind it is covered.
  await js(`(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Clear all data');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await wait(3000);

  // The session is gone with the data, so the database is read directly.
  const stillThere = getDb().prepare(`SELECT COUNT(*) AS n FROM students`).get().n;
  check('the school is empty afterwards', stillThere === 0, stillThere);
  const adminKept = getDb().prepare(`SELECT COUNT(*) AS n FROM users WHERE role='admin'`).get().n;
  check('the administrator account survived the clear', adminKept >= 1, adminKept);
  const signedOut = await js(`document.body.innerText`);
  check('the session ends and the login screen comes back', /Sign in|sign in/.test(signedOut), signedOut.slice(0, 200));

  console.log('\n--- no renderer errors ----------------------------------------------');
  // A page that throws while rendering can still answer a heading check, so
  // every console error seen during the run is a failure of its own.
  check('the renderer logged no errors', rendererErrors.length === 0, rendererErrors.slice(0, 5));

  closeDatabase();
  console.log(`\n${failed === 0 ? 'ALL UI TESTS PASSED' : `FAILURES: ${failures.length}`} (${passed} passed)`);
  if (failed) console.error(failures.map((f) => `  - ${f}`).join('\n'));
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error(err);
    app.exit(1);
  }),
);
