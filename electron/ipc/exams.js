'use strict';

const { register } = require('./guard');
const C = require('./channels');
const exams = require('../services/exams.service');
const print = require('../services/print.service');
const files = require('../services/files.service');
const { validate, helpers } = require('../services/validation');

const ID = { id: helpers.int({ min: 1, required: true }) };

/**
 * Phase 6: exams, schedules, marks entry, results and report cards.
 *
 * Write access is admin-only. A teacher may enter marks for the subjects they
 * actually teach and read results for their own classes; a student may only
 * read their own published results.
 */
function registerExamsIpc() {
  register(C.EXAM_TYPES_LIST, { roles: ['admin', 'office', 'teacher'] }, () => exams.listTypes());

  // --- exam setup ------------------------------------------------------------
  register(C.EXAMS_LIST, { roles: ['admin', 'teacher'] }, ({ payload, session }) => exams.list(payload || {}, session));
  register(C.EXAMS_GET, { roles: ['admin', 'teacher'] }, ({ payload, session }) =>
    exams.getExam(validate(payload || {}, ID).id, session),
  );
  register(C.EXAMS_CREATE, { roles: ['admin'] }, ({ payload, session }) => exams.saveExam(payload || {}, session));
  register(C.EXAMS_UPDATE, { roles: ['admin'] }, ({ payload, session }) => exams.saveExam(payload || {}, session));
  register(C.EXAMS_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    exams.deleteExam(validate(payload || {}, ID).id, session),
  );
  register(C.EXAMS_SET_STATUS, { roles: ['admin'] }, ({ payload, session }) => exams.setStatus(payload || {}, session));
  register(C.EXAM_SUBJECTS_SAVE, { roles: ['admin'] }, ({ payload, session }) => exams.saveSubjects(payload || {}, session));

  // --- marks -----------------------------------------------------------------
  register(C.EXAM_MARKS_SHEET, { roles: ['admin', 'teacher'] }, ({ payload, session }) =>
    exams.markSheet(payload || {}, session),
  );
  register(C.EXAM_MARKS_SAVE, { roles: ['admin', 'teacher'] }, ({ payload, session }) =>
    exams.saveMarks(payload || {}, session),
  );

  // --- results ---------------------------------------------------------------
  register(C.EXAM_RESULTS, { roles: ['admin', 'teacher'] }, ({ payload, session }) =>
    exams.resultSheet(payload || {}, session),
  );
  register(C.EXAM_RESULTS_COMPUTE, { roles: ['admin'] }, ({ payload, session }) => exams.computeResults(payload || {}, session));
  register(C.EXAM_STATS, { roles: ['admin', 'teacher'] }, ({ payload, session }) =>
    exams.stats(validate(payload || {}, { examId: helpers.int({ min: 1, required: true }) }).examId, session),
  );
  register(C.EXAM_MY_RESULTS, { roles: ['student'] }, ({ payload, session }) => exams.myResults(payload || {}, session));

  // --- printable documents ---------------------------------------------------
  register(C.EXAM_REPORT_CARD, { roles: ['admin', 'teacher', 'student'] }, ({ payload, session }) =>
    exams.reportCard(payload || {}, session),
  );

  register(C.EXAM_REPORT_CARD_PDF, { roles: ['admin', 'teacher', 'student'] }, async ({ payload, session }) => {
    const card = exams.reportCard(payload || {}, session);
    return print.printHtmlToPdf({
      html: reportCardHtml(card),
      defaultName: `report-card-${card.student.admissionNo}-${card.exam.id}`,
      paperSize: 'A4',
      margin: false,
      session,
      entity: 'results',
      entityId: card.student.id,
      description: `report card ${card.student.admissionNo}`,
    });
  });

  register(C.EXAM_REPORT_CARD_PRINT, { roles: ['admin', 'teacher', 'student'] }, async ({ payload, session }) =>
    print.openPrintPreview({ html: reportCardHtml(exams.reportCard(payload || {}, session)), session }),
  );

  register(C.EXAM_RESULT_SHEET_PDF, { roles: ['admin', 'teacher'] }, async ({ payload, session }) => {
    const sheet = exams.resultSheet(payload || {}, session);
    const subjectColumns = sheet.subjects;

    const head = [
      '#',
      'Student',
      'Admission',
      'Roll',
      'Section',
      ...subjectColumns.map((s) => `${s.name} (${s.totalMarks})`),
      'Total',
      '%',
      'Grade',
      'Position',
      'Result',
    ].map((h) => `<th>${escapeHtml(h)}</th>`).join('');

    const body = sheet.rows
      .map((row, index) => {
        const cells = subjectColumns.map((s) => `<td class="num">${row.marks[s.id] === null ? '-' : row.marks[s.id]}</td>`).join('');
        return `<tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.admissionNo)}</td>
          <td>${escapeHtml(row.rollNo)}</td>
          <td>${escapeHtml(row.sectionName)}</td>
          ${cells}
          <td class="num">${row.obtainedMarks === null ? '-' : `${row.obtainedMarks} / ${row.totalMarks}`}</td>
          <td class="num">${row.percentage === null ? '-' : row.percentage}</td>
          <td>${escapeHtml(row.grade || '-')}</td>
          <td class="num">${row.position ?? '-'}</td>
          <td>${row.isPass === null ? 'Not computed' : row.isPass ? 'Pass' : 'Fail'}</td>
        </tr>`;
      })
      .join('');

    const stats = sheet.stats;
    const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 24px; }
      header { border-bottom: 2px solid #4c7df0; padding-bottom: 8px; margin-bottom: 14px; }
      h1 { font-size: 18px; margin: 0; }
      .sub { font-size: 12px; color: #475569; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      th { background: #eef2ff; padding: 5px; border: 1px solid #dbe3f5; text-transform: uppercase; font-size: 9px; }
      td { padding: 4px 5px; border: 1px solid #e2e8f0; }
      td.num, th.num { text-align: right; }
      tbody tr:nth-child(even) td { background: #f8fafc; }
      .totals { margin-top: 12px; font-size: 12px; display: flex; gap: 18px; }
    </style></head><body>
      <header>
        <h1>${escapeHtml(sheet.exam.name)}</h1>
        <div class="sub">${escapeHtml(sheet.exam.className)} &middot; Result sheet</div>
      </header>
      <table><thead><tr>${head}</tr></thead>
      <tbody>${body || `<tr><td colspan="${head ? head.split('</th>').length : 1}">No students</td></tr>`}</tbody></table>
      <div class="totals">
        <span>Students: ${stats.results}</span>
        <span>Passed: ${stats.passed} (${stats.passPercentage}%)</span>
        <span>Average: ${stats.averagePercentage}%</span>
        <span>Highest: ${stats.highestPercentage}%</span>
      </div>
    </body></html>`;

    return print.printHtmlToPdf({
      html,
      defaultName: `result-sheet-${sheet.exam.id}`,
      landscape: true,
      session,
      entity: 'results',
      entityId: sheet.exam.id,
      description: 'result sheet',
    });
  });
}

/** The printable report card: marks, totals, grade, position and attendance. */
function reportCardHtml(card) {
  const logo = files.logoDataUrl();
  const { school, exam, student, result } = card;

  const rows = card.items
    .map(
      (item, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(item.subjectName)}</td>
        <td class="num">${item.obtainedMarks === null ? '-' : item.obtainedMarks}</td>
        <td class="num">${item.totalMarks}</td>
        <td class="num">${item.passMarks}</td>
        <td class="num">${item.percentage === null ? '-' : `${item.percentage}%`}</td>
        <td>${item.isPass === null ? '-' : item.isPass ? 'P' : 'F'}</td>
      </tr>`,
    )
    .join('');

  const attendance = card.attendance;
  const attendanceRow =
    attendance.total > 0
      ? `<div class="stats">
           <div><b>Attendance</b>${attendance.percentage}% (${attendance.present}/${attendance.total})</div>
           <div><b>Absent days</b>${attendance.absent}</div>
           <div><b>Leave days</b>${attendance.leave}</div>
         </div>`
      : '';

  const position = result ? (result.tied ? `Position ${result.position} (tied)` : `Position ${result.position}`) : '-';

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; }
  .sheet { padding: 26px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4c7df0; padding-bottom: 10px; }
  .school { font-size: 17px; font-weight: 700; }
  .addr { font-size: 11px; color: #475569; }
  .logo { width: 54px; height: 54px; object-fit: contain; }
  .title { text-align: center; margin: 16px 0 10px; }
  .title h2 { font-size: 15px; margin: 0; letter-spacing: .12em; text-transform: uppercase; }
  .title .sub { font-size: 11px; color: #475569; margin-top: 4px; }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; font-size: 12px; }
  .meta b { color: #64748b; font-weight: 500; display: block; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #eef2ff; text-align: left; padding: 7px 9px; border: 1px solid #dbe3f5; }
  td { padding: 6px 9px; border: 1px solid #e2e8f0; }
  td.num, th.num { text-align: right; }
  .summary { margin-top: 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .box { border: 1px solid #dbe3f5; border-radius: 8px; padding: 10px 12px; background: #f8faff; }
  .box .label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; }
  .box .value { font-size: 18px; font-weight: 700; margin-top: 3px; }
  .box.ok { background: #f0fdf4; border-color: #bbf7d0; }
  .box.ok .value { color: #15803d; }
  .box.bad { background: #fef2f2; border-color: #fecaca; }
  .box.bad .value { color: #b91c1c; }
  .stats { display: flex; gap: 24px; margin-top: 12px; font-size: 11px; color: #475569; }
  .stats b { color: #64748b; font-weight: 500; display: block; }
  .foot { margin-top: 18px; font-size: 11px; color: #64748b; }
  .sig { margin-top: 44px; display: flex; justify-content: space-between; font-size: 11px; color: #475569; }
</style></head><body><div class="sheet">
  <header>
    <div>
      <div class="school">${escapeHtml(school.name || '')}</div>
      <div class="addr">${escapeHtml(school.address || '')}</div>
      <div class="addr">${escapeHtml(school.phone || '')}${school.email ? ` &middot; ${escapeHtml(school.email)}` : ''}</div>
    </div>
    ${logo ? `<img class="logo" src="${logo}" alt="" />` : '<div></div>'}
  </header>

  <div class="title">
    <h2>Report Card</h2>
    <div class="sub">${escapeHtml(exam.name)} &middot; ${escapeHtml(exam.sessionName || school.session || '')}</div>
  </div>

  <div class="meta">
    <div><b>Student</b>${escapeHtml(student.name)}</div>
    <div><b>Admission No</b>${escapeHtml(student.admissionNo)}</div>
    <div><b>Father's name</b>${escapeHtml(student.fatherName || '-')}</div>
    <div><b>Roll No</b>${escapeHtml(student.rollNo || '-')}</div>
    <div><b>Class</b>${escapeHtml(student.className)}</div>
    <div><b>Section</b>${escapeHtml(student.sectionName)}</div>
    <div><b>Exam dates</b>${escapeHtml(exam.startDate || '-')} to ${escapeHtml(exam.endDate || '-')}</div>
    <div><b>Position</b>${escapeHtml(position)}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="num">#</th><th>Subject</th>
        <th class="num">Obtained</th><th class="num">Total</th><th class="num">Pass</th>
        <th class="num">%</th><th>Result</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="7">No marks recorded</td></tr>'}</tbody>
  </table>

  ${
    result
      ? `<div class="summary">
           <div class="box"><div class="label">Total</div><div class="value">${result.obtainedMarks} / ${result.totalMarks}</div></div>
           <div class="box"><div class="label">Percentage</div><div class="value">${result.percentage}%</div></div>
           <div class="box"><div class="label">Grade</div><div class="value">${escapeHtml(result.grade || '-')}</div></div>
           <div class="box ${result.isPass ? 'ok' : 'bad'}"><div class="label">Result</div><div class="value">${result.isPass ? 'PASS' : 'FAIL'}</div></div>
         </div>`
      : ''
  }
  ${attendanceRow}

  ${school.footer ? `<div class="foot">${escapeHtml(school.footer)}</div>` : ''}
  <div class="foot">Printed ${new Date().toLocaleString()}</div>
  <div class="sig"><span>_______________________<br />Class Teacher</span><span>_______________________<br />Principal</span><span>_______________________<br />Parent / Guardian</span></div>
</div></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { registerExamsIpc };