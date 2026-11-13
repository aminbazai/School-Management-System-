'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, dialog, shell, session: electronSession } = require('electron');

const { logger } = require('./logger');
const { initDatabase, closeDatabase } = require('./db/connection');
const { registerIpc } = require('./ipc');
const sessionStore = require('./services/session');

const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

/** @type {BrowserWindow|null} */
let mainWindow = null;

// ---------------------------------------------------------------------------
// Single instance
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: '#05070c',
    title: 'School Management System',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // External links open in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block navigation away from the app (phishing / hijack protection).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!allowed) {
      logger.warn(`blocked navigation to ${url}`);
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// ---------------------------------------------------------------------------
// Security hardening (production only)
// ---------------------------------------------------------------------------
function hardenSession() {
  if (isDev) return;

  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; font-src 'self' data:; " +
            "connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'",
        ],
      },
    });
  });

  electronSession.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

// ---------------------------------------------------------------------------
// Idle session watchdog - the session dies in MAIN, not in the UI
// ---------------------------------------------------------------------------
function startSessionWatchdog(getWindow) {
  sessionStore.startIdleWatch(() => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('session:expired');
  });
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
function showFatalError(title, message) {
  logger.error(`${title}: ${message}`);
  if (!app.isReady()) {
    dialog.showErrorBox('School Management System', `${title}\n\n${message}`);
    app.exit(1);
    return;
  }
  dialog.showErrorBox('School Management System', `${title}\n\n${message}\n\nDetails were written to:\n${logger.filePath()}`);
}

process.on('uncaughtException', (err) => {
  showFatalError('Unexpected error', err.message);
});
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', reason);
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  try {
    initDatabase({ seed: true });
  } catch (err) {
    showFatalError(
      'Database error',
      `The school database could not be opened.\n${err.message}`,
    );
    return;
  }

  registerIpc();
  Menu.setApplicationMenu(null);
  hardenSession();
  createWindow();
  startSessionWatchdog(() => mainWindow);

  // One automatic backup per day, keeping the last seven. Never awaited on the
  // startup path - a slow disk must not delay the window appearing.
  require('./services/backup.service')
    .runAutomaticBackup()
    .catch((err) => logger.error('startup backup failed', err));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  sessionStore.stopIdleWatch();
  closeDatabase();
});

// Keep the crash reporter quiet in dev; real details go to the log file.
app.on('render-process-gone', (_event, _wc, details) => {
  logger.error('render process gone', details);
});

// Make sure the data folder exists before the renderer ever asks for it.
app.on('ready', () => {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
  } catch (err) {
    logger.error('could not create userData folder', err);
  }
});