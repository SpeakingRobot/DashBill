'use strict';

const fs = require('fs');
const path = require('path');
const { app, shell, dialog, BrowserWindow } = require('electron');

const db = require('../db');
const config = require('../config');
const { isDue, daysSince } = require('../services/backupRunner');

/** The sizes the Display control offers, smallest first. */
const ZOOM_STEPS = [1, 1.15, 1.3, 1.5];

function clampZoom(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.5, Math.max(1, Math.round(n * 100) / 100));
}

module.exports = {
  /**
   * How large to draw everything.
   *
   * Windows' own display scaling is global; this is per-application, so
   * somebody who only finds this screen hard to read can enlarge it without
   * making everything else on their computer enormous.
   */
  'app:setZoom': async ({ zoom, step } = {}) => {
    const current = clampZoom(config.load().ui.zoom);
    let next;
    if (step) {
      const index = ZOOM_STEPS.findIndex((z) => Math.abs(z - current) < 0.02);
      const at = index < 0 ? 0 : index;
      next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, at + Number(step)))];
    } else {
      next = clampZoom(zoom);
    }
    config.save({ ui: { zoom: next } });
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.setZoomFactor(next);
    });
    return { zoom: next, steps: ZOOM_STEPS };
  },

  'app:getZoom': async () => ({
    zoom: clampZoom(config.load().ui.zoom), steps: ZOOM_STEPS
  }),

  /**
   * Everything the renderer needs to decide what to show first: is the
   * database reachable, has setup been done, is a backup overdue.
   */
  'app:bootstrap': async () => {
    const cfg = config.load();
    return {
      ready: db.isReady(),
      error: db.isReady() ? null : db.lastError(),
      configured: config.isConfigured(),
      app: {
        name: app.getName(),
        version: app.getVersion(),
        author: 'Samuel Fernandes',
        userData: app.getPath('userData')
      },
      database: {
        mode: cfg.db.mode,
        host: cfg.db.host,
        port: cfg.db.port,
        user: cfg.db.user,
        database: cfg.db.database,
        ssl: Boolean(cfg.db.ssl)
      },
      backup: {
        folder: cfg.backup.folder,
        intervalDays: cfg.backup.intervalDays,
        lastBackupAt: cfg.backup.lastBackupAt,
        daysSinceBackup: daysSince(cfg.backup.lastBackupAt),
        due: isDue()
      }
    };
  },

  /** Retry the connection after the user has started MySQL or fixed details. */
  'app:reconnect': async () => {
    const result = await db.init();
    return { ready: result.ok, error: result.ok ? null : result.error };
  },

  /**
   * Open the bundled README. In development it sits in the project root; in an
   * installed build electron-builder copies it beside the app as a resource.
   */
  'app:openReadme': async () => {
    const candidates = [
      path.join(process.resourcesPath || '', 'README.md'),
      path.join(app.getAppPath(), 'README.md'),
      path.join(app.getAppPath(), '..', 'README.md')
    ];
    const found = candidates.find((candidate) => {
      try { return candidate && fs.existsSync(candidate); } catch { return false; }
    });
    if (!found) throw new Error('README.md could not be found next to the application.');
    const error = await shell.openPath(found);
    if (error) throw new Error(error);
    return { opened: true, path: found };
  },

  'app:openExternal': async ({ url }) => {
    // Only ever hand http(s) and mailto links to the OS.
    if (!/^(https?:|mailto:)/i.test(String(url || ''))) {
      throw new Error('That link cannot be opened.');
    }
    await shell.openExternal(url);
    return { opened: true };
  },

  'app:openPath': async ({ path: target }) => {
    const error = await shell.openPath(String(target || ''));
    if (error) throw new Error(error);
    return { opened: true };
  },

  /** Generic yes/no used before deletes. */
  'app:confirm': async ({ title, message, detail, confirmLabel, danger } = {}) => {
    const result = await dialog.showMessageBox({
      type: danger ? 'warning' : 'question',
      buttons: ['Cancel', confirmLabel || 'Continue'],
      defaultId: danger ? 0 : 1,
      cancelId: 0,
      title: title || 'Please confirm',
      message: message || 'Are you sure?',
      detail: detail || undefined
    });
    return { confirmed: result.response === 1 };
  },

  'app:message': async ({ type, title, message, detail } = {}) => {
    await dialog.showMessageBox({
      type: type || 'info',
      buttons: ['OK'],
      title: title || app.getName(),
      message: message || '',
      detail: detail || undefined
    });
    return { ok: true };
  },

  'app:minimize': async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.minimize();
    return { ok: true };
  },

  'app:toggleMaximize': async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { maximized: false };
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { maximized: win.isMaximized() };
  },

  'app:quit': async () => {
    app.quit();
    return { ok: true };
  }
};
