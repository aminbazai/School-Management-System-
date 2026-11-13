'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, shell } = require('electron');
const { register } = require('./guard');
const C = require('./channels');
const messaging = require('../services/messaging.service');
const print = require('../services/print.service');
const audit = require('../services/audit.service');
const { AppError } = require('../services/validation');
const { logger } = require('../logger');

const ALLOWED_LINK = [
  /^https:\/\/wa\.me\/\d{6,15}(?:[?#].*)?$/i,
  /^https:\/\/api\.whatsapp\.com\/send\/?\?(?:.*)$/i,
  /^https:\/\/web\.whatsapp\.com\/send\/?\?(?:.*)$/i,
  /^mailto:[^\s]+$/i,
  /^sms:[+\d][^\s]*$/i,
];

function assertLink(url) {
  const value = String(url || '').trim();
  if (!value || value.length > 4000 || !ALLOWED_LINK.some((pattern) => pattern.test(value))) {
    throw new AppError('INVALID_LINK', 'INVALID_LINK');
  }
  return value;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function cleanRecipients(list) {
  return (Array.isArray(list) ? list : []).slice(0, 1000).map((row) => ({
    name: String(row?.name || '').slice(0, 160),
    studentName: String(row?.studentName || '').slice(0, 160),
    className: String(row?.className || '').slice(0, 160),
    phone: String(row?.phoneDisplay || row?.phone || '').slice(0, 60),
    email: String(row?.email || '').slice(0, 200),
    detail: String(row?.detail || '').slice(0, 200),
    message: String(row?.message || '').slice(0, 4000),
  }));
}

function registerMessagingIpc() {
  register(C.MESSAGING_RECIPIENTS, { roles: ['admin', 'office'] }, ({ payload, session }) =>
    messaging.buildRecipients(payload || {}, session),
  );

  // Deep links must be opened by MAIN: the renderer cannot call shell.openExternal.
  register(C.MESSAGING_OPEN_LINK, { roles: ['admin', 'office'] }, async ({ payload, session }) => {
    const url = assertLink(payload?.url);
    const channel = String(payload?.channel || '').slice(0, 20);
    await shell.openExternal(url);
    if (['whatsapp', 'sms', 'email'].includes(channel)) {
      audit.log({ action: 'message_open', entity: 'messaging', details: { channel }, session });
    }
    return { opened: true };
  });

  register(C.MESSAGING_EXPORT, { roles: ['admin', 'office'] }, async ({ payload, session }) => {
    const recipients = cleanRecipients(payload?.recipients);
    if (!recipients.length) {
      throw new AppError('NOTHING_TO_GENERATE', 'NOTHING_TO_GENERATE');
    }
    const header = ['Name', 'Student', 'Class', 'Phone', 'Email', 'Detail', 'Message'];
    const lines = recipients.map((row) =>
      [row.name, row.studentName, row.className, row.phone, row.email, row.detail, row.message].map(csvCell).join(','),
    );
    const result = await dialog.showSaveDialog({
      title: 'Export recipients',
      defaultPath: path.join(app.getPath('documents'), `message-recipients-${Date.now()}.csv`),
      filters: [{ name: 'CSV file', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, `\uFEFF${[header.map(csvCell).join(','), ...lines].join('\r\n')}`, 'utf8');
    audit.log({ action: 'export', entity: 'messaging', details: { count: recipients.length }, session });
    return { canceled: false, filePath: result.filePath, count: recipients.length };
  });

  register(C.MESSAGING_PDF, { roles: ['admin', 'office'] }, async ({ payload, session }) => {
    const title = String(payload?.title || 'Notice').slice(0, 160);
    const intro = String(payload?.message || '').slice(0, 4000);
    const recipients = cleanRecipients(payload?.recipients);
    if (!recipients.length) {
      throw new AppError('NOTHING_TO_GENERATE', 'NOTHING_TO_GENERATE');
    }

    const slips = recipients
      .map(
        (row, index) => `<article class="slip">
          <div class="slip-head">
            <span class="school">${escapeHtml(payload?.schoolName || '')}</span>
            <span class="no">#${index + 1}</span>
          </div>
          <div class="who">
            <strong>${escapeHtml(row.name || '-')}</strong>
            ${row.studentName ? `<span>Student: ${escapeHtml(row.studentName)}</span>` : ''}
            ${row.className ? `<span>Class: ${escapeHtml(row.className)}</span>` : ''}
            ${row.detail ? `<span>${escapeHtml(row.detail)}</span>` : ''}
          </div>
          <p class="body">${escapeHtml(row.message || intro).replace(/\n/g, '<br />')}</p>
          <div class="foot"><span>${escapeHtml(new Date().toLocaleDateString('en-GB'))}</span><span>Signature: ____________________</span></div>
        </article>`,
      )
      .join('');

    const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; }
      header { border-bottom: 2px solid #4c7df0; padding: 16px 20px 10px; }
      h1 { font-size: 18px; margin: 0; }
      .sub { font-size: 11.5px; color: #64748b; margin-top: 4px; }
      .grid { padding: 14px 20px 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .slip { border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px 14px; page-break-inside: avoid; min-height: 90mm; display: flex; flex-direction: column; }
      .slip-head { display: flex; justify-content: space-between; font-size: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 8px; }
      .school { font-weight: 700; }
      .no { color: #94a3b8; font-size: 10px; }
      .who { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; color: #475569; margin-bottom: 8px; }
      .who strong { width: 100%; font-size: 13px; color: #0f172a; }
      .body { font-size: 11.5px; line-height: 1.6; white-space: normal; flex: 1; }
      .foot { display: flex; justify-content: space-between; border-top: 1px dashed #cbd5e1; padding-top: 6px; margin-top: 10px; font-size: 9.5px; color: #64748b; }
    </style></head><body>
      <header><h1>${escapeHtml(title)}</h1><div class="sub">${escapeHtml(payload?.schoolName || '')} &middot; ${recipients.length} notices</div></header>
      <div class="grid">${slips}</div>
    </body></html>`;

    try {
      return await print.printHtmlToPdf({
        html,
        defaultName: `notices-${Date.now()}`,
        paperSize: 'A4',
        session,
        entity: 'messaging',
        description: `${recipients.length} printed notices`,
      });
    } catch (err) {
      logger.error('message notice pdf failed', err);
      throw err;
    }
  });
}

module.exports = { registerMessagingIpc };
