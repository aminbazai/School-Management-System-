'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, BrowserWindow } = require('electron');
const audit = require('./audit.service');
const { logger } = require('../logger');

/**
 * Print / PDF rendering in the main process.
 *
 * Electron's own printToPDF is used instead of a renderer-side PDF library so
 * that the exact print CSS is honoured and fonts/Urdu text render natively.
 */

/**
 * @param {{ html: string, defaultName: string, landscape?: boolean,
 *           paperSize?: string, margin?: boolean, session?: object,
 *           entity?: string, entityId?: any, description?: string }} options
 */
async function printHtmlToPdf({
  html,
  defaultName = 'document',
  landscape = false,
  paperSize = 'A4',
  margin = true,
  session = null,
  entity = null,
  entityId = null,
  description = null,
}) {
  const save = await dialog.showSaveDialog({
    title: 'Save PDF',
    defaultPath: path.join(app.getPath('documents'), `${defaultName}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (save.canceled || !save.filePath) return { canceled: true };

  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false },
  });

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // give web fonts / images a moment
    await new Promise((r) => setTimeout(r, 350));

    const data = await win.webContents.printToPDF({
      landscape,
      printBackground: true,
      pageSize: paperSize,
      margins: margin
        ? { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
        : { marginType: 'none' },
    });

    fs.writeFileSync(save.filePath, data);
    audit.log({ action: 'print', entity, entityId, details: { ...(description ? { description } : {}), file: path.basename(save.filePath) }, session });
    return { canceled: false, filePath: save.filePath };
  } catch (err) {
    logger.error('print failed', err);
    throw err;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Shows the HTML in a real window with a print dialog (Ctrl+P / Save as PDF). */
async function openPrintPreview({ html, session = null }) {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Print preview',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.webContents.once('did-finish-load', () => win.webContents.print({ silent: false, printBackground: true }));
  audit.log({ action: 'print_preview', entity: 'document', session });
  return { opened: true };
}

module.exports = { printHtmlToPdf, openPrintPreview };