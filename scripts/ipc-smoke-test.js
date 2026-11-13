'use strict';

/**
 * End-to-end IPC smoke test for the new free features.
 * Loads the built renderer, signs in, and calls the preload bridge exactly as
 * the UI does. Run: npx electron scripts/ipc-smoke-test.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(os.tmpdir(), 'sms-ipc-smoke-test');

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
    console.error(`  FAIL  ${label}${detail !== undefined ? ` -> ${String(JSON.stringify(detail)).slice(0, 240)}` : ''}`);
  }
}

async function main() {
  const { initDatabase, closeDatabase } = require('../electron/db/connection');
  const { registerIpc } = require('../electron/ipc');

  initDatabase({ seed: true });
  registerIpc();

  // The PDF handlers ask for a save location. Point them at the temp folder so
  // the test can verify the pipeline without a human clicking a dialog.
  const { dialog } = require('electron');
  let nextSavePath = path.join(TMP, 'document.pdf');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: nextSavePath });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  const call = (expr) =>
    win.webContents.executeJavaScript(`(async () => JSON.stringify(await (${expr})))()`, true).then(JSON.parse);

  const surfaces = await call(`({
    staffImport: typeof window.school.staff.importPreview,
    staffExport: typeof window.school.staff.exportExcel,
    feeReminders: typeof window.school.fees.remindersPdf,
    messagingRecipients: typeof window.school.messaging.recipients,
    messagingOpen: typeof window.school.messaging.openLink,
    messagingExport: typeof window.school.messaging.exportCsv,
    messagingPdf: typeof window.school.messaging.pdf,
  })`);
  check('preload exposes all new APIs', Object.values(surfaces).every((type) => type === 'function'), surfaces);

  let response = await call(`window.school.auth.login({ username: 'admin', password: 'password123' })`);
  check('admin can sign in', response.ok === true, response);

  // --- admin user control: rename an account and set its password ----------
  const ipcUsername = `ipc-user-${Date.now()}`;
  response = await call(
    `window.school.users.create({ username: ${JSON.stringify(ipcUsername)}, password: 'secret123', role: 'office', mustChangePassword: false })`,
  );
  check('admin can create a user over IPC', response.ok === true && response.data.username === ipcUsername, response);
  const ipcUserId = response.ok ? response.data.id : 0;

  const renamedIpcUsername = `${ipcUsername}-x`;
  response = await call(
    `window.school.users.update(${ipcUserId}, { username: ${JSON.stringify(renamedIpcUsername)} })`,
  );
  check(
    'admin can change a username over IPC',
    response.ok === true && response.data.username === renamedIpcUsername,
    response,
  );

  response = await call(
    `window.school.users.resetPassword(${ipcUserId}, 'newpass123', { mustChangePassword: false })`,
  );
  check(
    'admin can set a password over IPC',
    response.ok === true && response.data.mustChangePassword === false,
    response,
  );

  response = await call(
    `window.school.auth.login({ username: ${JSON.stringify(renamedIpcUsername)}, password: 'newpass123' })`,
  );
  check(
    'renamed user signs in with the new credentials',
    response.ok === true &&
      response.data.user.username === renamedIpcUsername &&
      response.data.user.mustChangePassword === false,
    response,
  );

  response = await call(`window.school.auth.login({ username: 'admin', password: 'password123' })`);
  check('admin can sign in again after user control', response.ok === true, response);

  response = await call(`window.school.users.remove(${ipcUserId})`);
  check('controlled user can be removed afterwards', response.ok === true, response);

  response = await call(`window.school.staff.list({ page: 1, pageSize: 5 })`);
  check('staff list IPC works', response.ok === true && response.data.rows.length > 0, response.ok ? response.data.total : response);

  // --- staff Excel round trip through the real IPC + dialogs ---------------
  const excel = require('../electron/services/excel.service');
  const importCode = `IPC-${Date.now()}`;
  const importWorkbook = await excel.writeWorkbook([
    {
      name: 'Staff',
      columns: excel.STAFF_COLUMNS,
      rows: [
        {
          employee_code: importCode,
          name: 'IPC Import Staff',
          father_name: 'IPC Father',
          cnic: '35202-9999999-9',
          phone: '0345-1234567',
          email: 'ipc@example.com',
          address: '1 IPC Road',
          qualification: 'B.Ed',
          designation: 'Coordinator',
          staff_type: 'office',
          joining_date: '2025-09-01',
          basic_salary: 52000,
          blood_group: 'O+',
          status: 'active',
          notes: 'Created by the IPC smoke test',
        },
      ],
    },
  ]);
  const importPath = path.join(TMP, 'staff-ipc-import.xlsx');
  fs.writeFileSync(importPath, importWorkbook);
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [importPath] });

  const preview = await call(`window.school.staff.importPreview()`);
  check('staff import preview IPC works', preview.ok === true && preview.data.total === 1 && preview.data.rows.length === 1, preview);
  const previewRow = preview.ok ? preview.data.rows[0] : {};
  check(
    'staff import preview maps header labels',
    previewRow['employee code'] === importCode && String(previewRow['basic salary']) === '52000',
    previewRow,
  );

  response = await call(
    `window.school.staff.importCommit(${JSON.stringify({ rows: preview.data.rows, updateExisting: false })})`,
  );
  check('staff import commit IPC works', response.ok === true && response.data.imported === 1, response);

  response = await call(`window.school.staff.list({ search: ${JSON.stringify(importCode)} })`);
  const importedStaff = response.ok ? response.data.rows[0] || {} : {};
  check(
    'staff import IPC keeps every column',
    importedStaff.employeeCode === importCode &&
      importedStaff.fatherName === 'IPC Father' &&
      importedStaff.staffType === 'office' &&
      importedStaff.basicSalary === 52000 &&
      importedStaff.joiningDate === '2025-09-01',
    importedStaff,
  );

  nextSavePath = path.join(TMP, 'staff-ipc-export.xlsx');
  response = await call(`window.school.staff.exportExcel({ search: ${JSON.stringify(importCode)} })`);
  const exportFile = fs.existsSync(nextSavePath) ? fs.readFileSync(nextSavePath) : Buffer.alloc(0);
  check('staff export IPC works', response.ok === true && response.data.count === 1, response);
  check('staff export file is written', exportFile.length > 1000, exportFile.length);
  const exportParsed = await excel.readWorkbook(nextSavePath, excel.STAFF_HEADER_ALIASES);
  check(
    'exported file reopens with the staff headers',
    exportParsed.rows.length === 1 && exportParsed.mapped.includes('employee code'),
    exportParsed.headers,
  );
  check('exported file contains the staff code', JSON.stringify(exportParsed.rows[0]).includes(importCode), exportParsed.rows[0]);

  response = await call(
    `window.school.messaging.recipients({ audience: 'fee_defaulters', template: 'Dear {{name}}, {{student}} owes {{amount}}.' })`,
  );
  check('messaging recipients IPC works', response.ok === true && response.data.total > 0, response.ok ? response.data.total : response);
  check(
    'messaging IPC returns personalised messages',
    response.ok && response.data.recipients.every((row) => !row.message.includes('{{')),
    response.ok ? response.data.recipients[0]?.message : response,
  );

  response = await call(`window.school.fees.defaulters({})`);
  check('fee defaulters IPC works', response.ok === true && response.data.length > 0, response.ok ? response.data.length : response);
  check(
    'fee defaulters IPC includes guardian contacts',
    response.ok &&
      response.data.every((row) =>
        ['guardianName', 'guardianPhone', 'guardianEmail'].every((key) =>
          Object.prototype.hasOwnProperty.call(row, key),
        ),
      ),
    response.ok ? Object.keys(response.data[0] || {}) : response,
  );

  response = await call(`window.school.messaging.recipients({ audience: 'custom', contacts: [{ name: 'A', phone: '0300-1234567' }] })`);
  check('custom recipients IPC works', response.ok === true && response.data.total === 1, response.ok ? response.data : response);
  check(
    'custom recipient phone is normalised',
    response.ok && response.data.recipients[0].phone === '923001234567',
    response.ok ? response.data.recipients[0] : response,
  );

  nextSavePath = path.join(TMP, 'fee-reminders.pdf');
  response = await call(`window.school.fees.remindersPdf({})`);
  const reminderPdf = fs.existsSync(nextSavePath) ? fs.readFileSync(nextSavePath) : Buffer.alloc(0);
  check('fee reminder PDF is generated', response.ok === true && reminderPdf.length > 1000, response);
  check('fee reminder file is a PDF', reminderPdf.slice(0, 4).toString() === '%PDF', reminderPdf.slice(0, 4).toString());

  nextSavePath = path.join(TMP, 'notices.pdf');
  response = await call(`window.school.messaging.pdf({
    title: 'Test notice',
    schoolName: 'Test School',
    message: 'Dear parent, this is a test notice.',
    recipients: [{
      name: 'Ali Khan',
      studentName: 'Ahmed Khan',
      className: 'Class 1 - A',
      phoneDisplay: '0300-1234567',
      email: '',
      detail: 'ADM-1',
      message: 'Dear Ali Khan, this is a test notice.',
    }],
  })`);
  const noticePdf = fs.existsSync(nextSavePath) ? fs.readFileSync(nextSavePath) : Buffer.alloc(0);
  check('printed notices PDF is generated', response.ok === true && noticePdf.length > 1000, response);
  check('printed notices file is a PDF', noticePdf.slice(0, 4).toString() === '%PDF', noticePdf.slice(0, 4).toString());

  // The deep-link guard must reject anything that is not WhatsApp/SMS/email
  // BEFORE shell.openExternal runs, so this cannot launch an app.
  response = await call(`window.school.messaging.openLink('https://example.com/phishing', 'whatsapp')`);
  check(
    'deep link guard rejects foreign URLs',
    response.ok === false && response.error?.code === 'INVALID_LINK',
    response,
  );

  // Staff import/export open native dialogs, so only validate refusal for the
  // wrong role: a teacher must not reach either channel.
  response = await call(`window.school.auth.login({ username: 'teacher1', password: 'password123' })`);
  check('teacher can sign in', response.ok === true, response);
  response = await call(`window.school.messaging.recipients({ audience: 'staff' })`);
  check('teacher is refused messaging IPC', response.ok === false && response.error?.code === 'FORBIDDEN', response);
  response = await call(`window.school.staff.importPreview()`);
  check('teacher is refused staff import IPC', response.ok === false && response.error?.code === 'FORBIDDEN', response);

  win.destroy();
  closeDatabase();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('Failures:', failures);
    app.exit(1);
  } else {
    app.exit(0);
  }
}

app.whenReady().then(main).catch((err) => {
  console.error('\nTEST RUN FAILED');
  console.error(err && err.stack ? err.stack : err);
  app.exit(1);
});
