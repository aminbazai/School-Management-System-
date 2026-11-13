'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, dialog } = require('electron');
const { getDb } = require('../db/connection');
const { AppError } = require('./validation');
const audit = require('./audit.service');
const settings = require('./settings.service');

/**
 * File helpers owned by the main process: image picking, copying into the app's
 * own data folder and safe reading back. The renderer never touches disk.
 */

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

function photoDir(kind = 'students') {
  const dir = path.join(app.getPath('userData'), 'photos', kind);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '');
}

function isImage(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

function readDataUrl(filePath) {
  try {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const buffer = fs.readFileSync(filePath);
    return `data:image/${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Opens a file picker and copies the chosen image into the app data folder.
 * @param {{ kind?: string, session: object, label?: string }} options
 */
async function pickAndStoreImage({ kind = 'students', session = null } = {}) {
  const result = await dialog.showOpenDialog({
    title: 'Select image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const source = result.filePaths[0];
  if (!isImage(source)) throw new AppError('INVALID_FILE_TYPE', 'INVALID_FILE_TYPE');

  const ext = path.extname(source).slice(1).toLowerCase();
  const storedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const target = path.join(photoDir(kind), storedName);
  fs.copyFileSync(source, target);

  audit.log({ action: 'upload', entity: kind, details: { storedName }, session });
  return { canceled: false, storedName, dataUrl: readDataUrl(target), path: target };
}

/** Absolute path for a stored photo (used by PDF/print rendering). */
function resolveImage(storedName, kind = 'students') {
  if (!storedName) return null;
  const name = path.basename(safeName(storedName));
  if (!name) return null;
  const target = path.join(photoDir(kind), name);
  return fs.existsSync(target) ? target : null;
}

function removeImage(storedName, kind = 'students') {
  if (!storedName) return;
  const target = resolveImage(storedName, kind);
  if (target) {
    try {
      fs.rmSync(target);
    } catch {
      /* ignore */
    }
  }
}

/** School logo used by printable documents. */
function logoDataUrl() {
  const stored = settings.get('logo_path');
  const target = resolveImage(stored, 'logo');
  return target ? readDataUrl(target) : null;
}

function clearLogo(session) {
  removeImage(settings.get('logo_path'), 'logo');
  getDb()
    .prepare(
      `UPDATE settings SET value = '', updated_at = datetime('now'), updated_by = ? WHERE key = 'logo_path'`,
    )
    .run(session ? session.userId : null);
  audit.log({ action: 'update', entity: 'settings', details: { logo_path: '' }, session });
  return settings.getAll();
}

module.exports = {
  pickAndStoreImage,
  resolveImage,
  readDataUrl,
  removeImage,
  logoDataUrl,
  clearLogo,
  photoDir,
};