'use strict';

/**
 * DashBill -- Electron main process.
 * Author: Samuel Fernandes
 *
 * Everything runs on this machine: the window, the MySQL connection, the PDF
 * engine and the backup writer. The only thing it talks to over the network is the
 * database the user configured on first run — their own TiDB Cloud cluster, or a
 * MySQL server on this machine.
 */

const path = require('path');
const { app, BrowserWindow, Menu, shell, dialog, nativeTheme } = require('electron');

const db = require('./db');
const config = require('./config');
const ipc = require('./ipc');
const { runBackup, isDue } = require('./services/backupRunner');
const updates = require('./services/updates');

const isDev = process.argv.includes('--dev');

/** Only one copy may run: two instances would fight over the same database. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

let mainWindow = null;
let splashWindow = null;
let backupTimer = null;
let quitting = false;

/**
 * A small branded window shown while the main one loads and the database
 * connection is attempted. It is frameless and borderless, closes itself as
 * soon as the application is ready to be seen, and is never the last window
 * standing, so it cannot hold the app open on its own.
 */
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 268,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true }
  });
  splashWindow.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));
  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });
  splashWindow.on('closed', () => { splashWindow = null; });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
}

function start() {
  // The window itself never needs the network, so the renderer is locked down: no
  // node integration, context isolation on, a strict CSP in index.html, and any
  // attempt to open an external window is handed to the real browser instead. All
  // database traffic happens here in the main process.
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    nativeTheme.themeSource = 'light';
    createSplash();
    createWindow();
    ipc.register({ isDev });
    // Progress and results from the updater are pushed, not polled.
    updates.configure(send);

    // Connect in the background: the window must appear even when MySQL is
    // asleep, so the user can read the setup screen and fix it.
    const result = await db.init();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('db:state', {
        ready: result.ok,
        error: result.ok ? null : result.error
      });
    }

    if (result.ok) scheduleBackupCheck();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', (event) => {
    if (quitting) return;
    const cfg = config.load();
    if (!cfg.backup.backupOnExit || !db.isReady()) return;

    // Take the parting backup before the process actually goes away.
    event.preventDefault();
    quitting = true;
    runBackup({ reason: 'on_exit' })
      .catch((err) => console.error('[backup] exit backup failed:', err.message))
      .finally(async () => {
        await db.close();
        app.quit();
      });
  });
}

function createWindow() {
  const cfg = config.load();

  mainWindow = new BrowserWindow({
    width: cfg.window.width,
    height: cfg.window.height,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#ffffff',
    title: app.getName(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });

  if (cfg.window.maximized) mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Whatever display size was chosen last time, applied before the window is
  // shown so nothing is ever drawn at the wrong size and then jumps.
  mainWindow.webContents.on('did-finish-load', () => {
    const zoom = Number(config.load().ui.zoom) || 1;
    mainWindow.webContents.setZoomFactor(Math.min(1.5, Math.max(1, zoom)));
  });

  mainWindow.once('ready-to-show', () => {
    // Hold the splash a moment so it reads as a start-up screen rather than a
    // flash, then hand over to the real window.
    setTimeout(() => {
      closeSplash();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.show();
      mainWindow.focus();
      if (isDev) mainWindow.webContents.openDevTools({ mode: 'bottom' });
    }, 900);
  });

  mainWindow.on('close', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getNormalBounds();
    config.save({
      window: {
        width: bounds.width,
        height: bounds.height,
        maximized: mainWindow.isMaximized()
      }
    });
  });

  mainWindow.on('closed', () => { mainWindow = null; closeSplash(); });
  mainWindow.webContents.on('did-fail-load', closeSplash);

  // External links open in the user's browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  buildMenu();
}

/**
 * Check for a due backup shortly after launch and then once an hour, so a
 * machine that stays on for weeks still gets its fortnightly copy.
 */
function scheduleBackupCheck() {
  const check = async () => {
    if (!db.isReady() || !isDue()) return;
    try {
      const result = await runBackup({ reason: 'scheduled' });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backup:done', result);
      }
    } catch (err) {
      console.error('[backup] scheduled backup failed:', err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backup:failed', { message: err.message });
      }
    }
  };

  setTimeout(check, 45 * 1000);
  backupTimer = setInterval(check, 60 * 60 * 1000);
  app.on('will-quit', () => clearInterval(backupTimer));
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload || {});
  }
}

function buildMenu() {
  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'New Invoice', accelerator: 'CmdOrCtrl+N', click: () => send('menu:navigate', { page: 'invoices', action: 'new' }) },
        { label: 'New Income Entry', accelerator: 'CmdOrCtrl+I', click: () => send('menu:navigate', { page: 'income', action: 'new' }) },
        { label: 'New Expense', accelerator: 'CmdOrCtrl+E', click: () => send('menu:navigate', { page: 'expenses', action: 'new' }) },
        { label: 'New Project', accelerator: 'CmdOrCtrl+P', click: () => send('menu:navigate', { page: 'projects', action: 'new' }) },
        { label: 'New Client', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('menu:navigate', { page: 'clients', action: 'new' }) },
        { type: 'separator' },
        { label: 'Back Up Now', accelerator: 'CmdOrCtrl+B', click: () => send('menu:action', { action: 'backup' }) },
        { label: 'Open Backup Folder', click: () => send('menu:action', { action: 'openBackups' }) },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => send('menu:navigate', { page: 'settings' }) },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: '&Go',
      submenu: [
        { label: 'Dashboard', accelerator: 'Alt+1', click: () => send('menu:navigate', { page: 'dashboard' }) },
        { label: 'Income', accelerator: 'Alt+2', click: () => send('menu:navigate', { page: 'income' }) },
        { label: 'Expenses', accelerator: 'Alt+3', click: () => send('menu:navigate', { page: 'expenses' }) },
        { label: 'Projects', accelerator: 'Alt+4', click: () => send('menu:navigate', { page: 'projects' }) },
        { label: 'Invoices', accelerator: 'Alt+5', click: () => send('menu:navigate', { page: 'invoices' }) },
        { label: 'Clients', accelerator: 'Alt+6', click: () => send('menu:navigate', { page: 'clients' }) },
        { label: 'Reports', accelerator: 'Alt+7', click: () => send('menu:navigate', { page: 'reports' }) }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '&View',
      submenu: [
        { label: 'Refresh', accelerator: 'F5', click: () => send('menu:action', { action: 'refresh' }) },
        { type: 'separator' },
        { label: 'Bigger Text', accelerator: 'CmdOrCtrl+=',
          click: () => send('menu:action', { action: 'zoomIn' }) },
        { label: 'Smaller Text', accelerator: 'CmdOrCtrl+-',
          click: () => send('menu:action', { action: 'zoomOut' }) },
        { label: 'Normal Text Size', accelerator: 'CmdOrCtrl+0',
          click: () => send('menu:action', { action: 'zoomReset' }) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : [])
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Where is my data?', click: () => send('menu:navigate', { page: 'settings', action: 'paths' }) },
        { label: 'Run through this page', accelerator: 'F1', click: () => send('menu:action', { action: 'tour' }) },
        { label: 'Check for Updates', click: () => send('menu:navigate', { page: 'settings', action: 'updates' }) },
        { label: "What's New", click: () => send('menu:navigate', { page: 'settings', action: 'updates' }) },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: `About ${app.getName()}`,
              message: `${app.getName()} ${app.getVersion()}`,
              detail:
                'Budget, project and GST invoicing software.\n\n' +
                'Built by Samuel Fernandes.\n\n' +
                `Your data lives in: ${config.load().db.database} on ` +
                `${config.load().db.host || '(not configured yet)'}\n` +
                `${config.load().db.mode === 'mysql'
                  ? 'A MySQL server on this computer.'
                  : 'Your own cloud database, over an encrypted connection.'}\n\n` +
                `Electron ${process.versions.electron} · Node ${process.versions.node}`,
              buttons: ['Close']
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
