'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

/**
 * Tiny append-only file logger with daily rotation and a size cap.
 * Never throws - logging must never break the app.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB per log file

function logDir() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return process.cwd();
  }
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function rotateIfNeeded(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }
  } catch {
    /* file does not exist yet */
  }
}

function write(level, args) {
  const ts = new Date().toISOString();
  const message = args
    .map((a) => {
      if (a instanceof Error) return `${a.stack || a.message}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
  const line = `[${ts}] [${level}] ${message}\n`;
  const file = path.join(logDir(), `app-${today()}.log`);
  try {
    rotateIfNeeded(file);
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    /* ignore */
  }
  if (level === 'ERROR' || level === 'WARN') console[level.toLowerCase()](line.trimEnd());
  else console.log(line.trimEnd());
}

const logger = {
  info: (...args) => write('INFO', args),
  warn: (...args) => write('WARN', args),
  error: (...args) => write('ERROR', args),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') write('DEBUG', args);
  },
  filePath: () => path.join(logDir(), `app-${today()}.log`),
};

module.exports = { logger };