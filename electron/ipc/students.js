'use strict';

const path = require('node:path');
const { dialog, app } = require('electron');
const { register } = require('./guard');
const C = require('./channels');
const students = require('../services/students.service');
const excel = require('../services/excel.service');
const print = require('../services/print.service');
const { validate, helpers } = require('../services/validation');
const { logger } = require('../logger');

const ID = { id: helpers.int({ min: 1 }) };

function registerStudentsIpc() {
  register(C.STUDENTS_LIST, { roles: ['admin', 'office', 'teacher'] }, ({ payload }) =>
    students.list(payload || {}),
  );
  register(C.STUDENTS_ME, { roles: ['student'] }, ({ session }) => students.meForUser(session));
  register(C.STUDENTS_GET, { roles: ['admin', 'office', 'teacher'] }, ({ payload }) =>
    students.get(validate(payload || {}, ID).id),
  );
  register(C.STUDENTS_CREATE, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    students.create(payload || {}, session),
  );
  register(C.STUDENTS_UPDATE, { roles: ['admin', 'office'] }, ({ payload, session }) => {
    const { id, ...rest } = payload || {};
    return students.update(validate({ id }, ID).id, rest, session);
  });
  register(C.STUDENTS_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    students.softDelete(validate(payload || {}, ID).id, session),
  );
  register(C.STUDENTS_PROMOTE, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    students.promote(payload || {}, session),
  );

  // --- Excel export --------------------------------------------------------
  register(C.STUDENTS_EXPORT_EXCEL, { roles: ['admin', 'office'] }, async ({ payload, session }) => {
    const data = students.exportRows(payload || {});
    const buffer = await excel.writeWorkbook([
      {
        name: 'Students',
        title: `${data.meta.school} - Students (${data.meta.session})`,
        columns: excel.STUDENT_COLUMNS,
        rows: data.rows,
      },
    ]);
    const result = await dialog.showSaveDialog({
      title: 'Export students',
      defaultPath: path.join(app.getPath('documents'), `students-${Date.now()}.xlsx`),
      filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    require('node:fs').writeFileSync(result.filePath, buffer);
    return { canceled: false, filePath: result.filePath, count: data.rows.length };
  });

  // --- Excel import --------------------------------------------------------
  register(C.STUDENTS_IMPORT_PREVIEW, { roles: ['admin', 'office'] }, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import students from Excel',
      properties: ['openFile'],
      filters: [{ name: 'Excel workbook', extensions: ['xlsx', 'xlsm'] }],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };

    try {
      const parsed = await excel.readWorkbook(result.filePaths[0]);
      // header order -> canonical keys, unknown columns become undefined
      const rows = parsed.rows.map((cells) => {
        const row = {};
        parsed.mapped.forEach((key, index) => {
          if (key) row[key] = cells[index];
        });
        return row;
      });
      return { canceled: false, headers: parsed.headers, rows: rows.slice(0, 200), total: rows.length };
    } catch (err) {
      logger.error('import preview failed', err);
      throw Object.assign(new Error('INVALID_FILE'), { code: 'INVALID_FILE' });
    }
  });

  register(C.STUDENTS_IMPORT_COMMIT, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    students.importRows(payload || {}, session),
  );

  // --- printable documents -------------------------------------------------
  register(C.STUDENTS_EXPORT_PDF, { roles: ['admin', 'office'] }, async ({ payload, session }) => {
    const data = students.exportRows(payload || {});
    const rowsHtml = data.rows
      .map(
        (row, index) => `<tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(row.admission_no)}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.father_name)}</td>
          <td>${escapeHtml(row.class_name)}${row.section_name ? ` - ${escapeHtml(row.section_name)}` : ''}</td>
          <td>${escapeHtml(row.roll_no)}</td>
          <td>${escapeHtml(row.phone)}</td>
        </tr>`,
      )
      .join('');
    const html = documentTemplate({
      title: 'Student List',
      subtitle: `Session ${data.meta.session}`,
      body: `<table><thead><tr>
          <th>#</th><th>Admission No</th><th>Name</th><th>Father</th><th>Class</th><th>Roll</th><th>Phone</th>
        </tr></thead><tbody>${rowsHtml}</tbody></table>`,
      count: data.rows.length,
    });
    return print.printHtmlToPdf({
      html,
      defaultName: `students-${Date.now()}`,
      landscape: true,
      session,
      entity: 'students',
      description: `list of ${data.rows.length} students`,
    });
  });

  register(C.STUDENTS_ID_CARDS, { roles: ['admin', 'office'] }, async ({ payload, session }) => {
    const settings = require('../services/settings.service');
    const s = settings.getAll();
    const schoolName = s.school_name;
    const schoolAddress = s.school_address;
    const schoolPhone = s.school_phone;
    const sessionName = s.session;
    const cards = students.idCardRows(payload?.ids);
    const cardsHtml = cards
      .map(
        (card) => `<div class="card front">
        <div class="card-top">
          <div class="school-block">
            <div class="school">${escapeHtml(schoolName || '')}</div>
            <div class="tag">Student Identity Card</div>
          </div>
          ${card.photoDataUrl ? `<img src="${card.photoDataUrl}" alt="" />` : '<div class="photo empty"></div>'}
        </div>
        <div class="card-body">
          <table>
            <tr><th>Name</th><td>${escapeHtml(card.name)}</td></tr>
            <tr><th>Admission No</th><td class="no">${escapeHtml(card.admissionNo)}</td></tr>
            <tr><th>Class</th><td>${escapeHtml(card.className || '-')} ${escapeHtml(card.sectionName || '')}</td></tr>
            <tr><th>Father</th><td>${escapeHtml(card.fatherName || '-')}</td></tr>
            <tr><th>Phone</th><td class="no">${escapeHtml(card.phone || '-')}</td></tr>
          </table>
        </div>
        <div class="card-foot">If found, please return to the school office.</div>
      </div>
      <div class="card back">
        <div class="card-top">
          <div class="school-block">
            <div class="school">${escapeHtml(schoolName || '')}</div>
            <div class="tag">Student Identity Card</div>
          </div>
        </div>
        <div class="card-body">
          <table>
            <tr><th>Student</th><td>${escapeHtml(card.name)}</td></tr>
            <tr><th>Admission No</th><td class="no">${escapeHtml(card.admissionNo)}</td></tr>
            <tr><th>Parent Phone</th><td class="no">${escapeHtml(card.phone || '-')}</td></tr>
            <tr><th>Address</th><td>${escapeHtml(card.address || '-')}</td></tr>
            <tr><th>Validity</th><td>Academic Session ${escapeHtml(sessionName || '')}</td></tr>
          </table>
          <p class="note">This card is the property of the school and must be carried at all times. Please contact the school office if found.</p>
        </div>
        <div class="sig">Principal Signature: ____________________</div>
      </div>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
      body { font-family: 'Segoe UI', Arial, sans-serif; margin: 12px; background: #f1f5f9; }
      .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
      .card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 0; page-break-inside: avoid; min-height: 230px; background: #fff; overflow: hidden; box-shadow: 0 4px 12px rgba(15,23,42,.08); }
      .card-top { background: linear-gradient(135deg, #1d4ed8, #4c7df0); color: #fff; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; }
      .card-top .school { font-weight: 700; font-size: 14px; }
      .card-top .tag { font-size: 9px; text-transform: uppercase; letter-spacing: .1em; opacity: .9; }
      .card-top img, .card-top .photo { width: 58px; height: 72px; object-fit: cover; border-radius: 6px; border: 2px solid rgba(255,255,255,.6); background: #e2e8f0; }
      .card-body { padding: 10px 12px; }
      table { width: 100%; font-size: 11.5px; border-collapse: collapse; }
      th { text-align: left; color: #64748b; font-weight: 500; width: 34%; padding: 2px 0; }
      td { padding: 2px 0; font-weight: 600; color: #0f172a; }
      .no { font-family: Consolas, monospace; }
      .card-foot { padding: 8px 12px; font-size: 9.5px; color: #64748b; border-top: 1px dashed #e2e8f0; background: #f8fafc; }
      .back .card-body table { font-size: 11px; }
      .note { color: #64748b; font-size: 10px; margin-top: 8px; line-height: 1.4; }
      .sig { margin-top: 14px; font-size: 10.5px; color: #475569; }
    </style></head><body><div class="grid">${cardsHtml || '<p>No students selected</p>'}</div></body></html>`;

    return print.printHtmlToPdf({
      html,
      defaultName: `id-cards-${Date.now()}`,
      paperSize: 'A4',
      session,
      entity: 'students',
      description: `${cards.length} id cards`,
    });
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Shared printable document frame (header, meta line, footer). */
function documentTemplate({ title, subtitle, body, count }) {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; }
    header { border-bottom: 2px solid #4c7df0; padding-bottom: 8px; margin-bottom: 14px; }
    h1 { font-size: 18px; margin: 0; }
    .sub { font-size: 12px; color: #475569; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    th { background: #eef2ff; text-align: left; padding: 7px 8px; border: 1px solid #dbe3f5; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    td { padding: 6px 8px; border: 1px solid #e2e8f0; }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    footer { margin-top: 12px; font-size: 10.5px; color: #64748b; display: flex; justify-content: space-between; }
  </style></head><body>
    <header><h1>${escapeHtml(title)}</h1><div class="sub">${escapeHtml(subtitle || '')}</div></header>
    ${body}
    <footer><span>Total: ${count ?? ''}</span><span>Printed: ${new Date().toLocaleString()}</span></footer>
  </body></html>`;
}

module.exports = { registerStudentsIpc };