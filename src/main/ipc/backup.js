'use strict';

const fs = require('fs');
const path = require('path');
const { dialog, shell, app } = require('electron');

const db = require('../db');
const config = require('../config');
const { dumpToFile, restoreFromFile } = require('../services/dump');
const { readSettings, logActivity, today } = require('../services/util');
const {
  stampFileName, listFiles, daysSince, runBackup
} = require('../services/backupRunner');

module.exports = {
  'backup:status': async () => {
    const cfg = config.load();
    const files = listFiles(cfg.backup.folder);
    const since = daysSince(cfg.backup.lastBackupAt);
    const interval = Number(cfg.backup.intervalDays) || 15;
    return {
      folder: cfg.backup.folder,
      intervalDays: interval,
      keepCopies: cfg.backup.keepCopies,
      backupOnExit: cfg.backup.backupOnExit,
      lastBackupAt: cfg.backup.lastBackupAt,
      daysSinceBackup: since,
      due: since === null ? true : since >= interval,
      files,
      totalBytes: files.reduce((sum, f) => sum + f.bytes, 0)
    };
  },

  'backup:run': async ({ reason } = {}) => runBackup({ reason: reason || 'manual' }),

  /** Write a copy somewhere the user picks, without touching the schedule. */
  'backup:saveAs': async () => {
    const cfg = config.load();
    const result = await dialog.showSaveDialog({
      title: 'Save a copy of the database',
      defaultPath: path.join(app.getPath('documents'), stampFileName()),
      filters: [{ name: 'SQL backup', extensions: ['sql'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const dump = await dumpToFile(cfg.db, result.filePath);
    return { canceled: false, ...dump };
  },

  'backup:settings': async (payload) => {
    const patch = {};
    if (payload.folder) patch.folder = String(payload.folder);
    if (payload.intervalDays !== undefined) {
      patch.intervalDays = Math.min(Math.max(Number(payload.intervalDays) || 15, 1), 365);
    }
    if (payload.keepCopies !== undefined) {
      patch.keepCopies = Math.min(Math.max(Number(payload.keepCopies) || 24, 1), 500);
    }
    if (payload.backupOnExit !== undefined) {
      patch.backupOnExit = Boolean(payload.backupOnExit);
    }
    const cfg = config.save({ backup: patch });
    if (patch.folder) fs.mkdirSync(cfg.backup.folder, { recursive: true });
    return cfg.backup;
  },

  'backup:pickFolder': async () => {
    const cfg = config.load();
    const result = await dialog.showOpenDialog({
      title: 'Choose the backup folder',
      defaultPath: fs.existsSync(cfg.backup.folder)
        ? cfg.backup.folder : app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const folder = result.filePaths[0];
    config.save({ backup: { folder } });
    fs.mkdirSync(folder, { recursive: true });
    return { canceled: false, folder };
  },

  'backup:openFolder': async () => {
    const cfg = config.load();
    fs.mkdirSync(cfg.backup.folder, { recursive: true });
    await shell.openPath(cfg.backup.folder);
    return { folder: cfg.backup.folder };
  },

  'backup:revealFile': async ({ path: filePath }) => {
    shell.showItemInFolder(filePath);
    return { ok: true };
  },

  'backup:deleteFile': async ({ path: filePath }) => {
    const cfg = config.load();
    // Only ever delete inside the configured backup folder.
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(cfg.backup.folder))) {
      throw new Error('That file is outside the backup folder.');
    }
    await shell.trashItem(resolved);
    return { path: resolved };
  },

  /**
   * Replace the current database with the contents of a backup file.
   * Guarded by a modal confirmation, and a safety copy is taken first.
   */
  'backup:restore': async ({ path: filePath } = {}) => {
    const cfg = config.load();

    let target = filePath;
    if (!target) {
      const picked = await dialog.showOpenDialog({
        title: 'Choose a backup file to restore',
        defaultPath: cfg.backup.folder,
        filters: [{ name: 'SQL backup', extensions: ['sql'] }],
        properties: ['openFile']
      });
      if (picked.canceled || !picked.filePaths.length) return { canceled: true };
      target = picked.filePaths[0];
    }

    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Replace my data'],
      defaultId: 0,
      cancelId: 0,
      title: 'Restore from backup',
      message: 'This replaces everything currently in the database.',
      detail:
        `Every client, project, income entry, expense and invoice will be ` +
        `replaced with the contents of:\n\n${path.basename(target)}\n\n` +
        `A safety copy of your current data is saved first, so this can be undone.`
    });
    if (confirmation.response !== 1) return { canceled: true };

    // Safety copy before overwriting anything.
    const safetyFolder = path.join(cfg.backup.folder, 'before-restore');
    fs.mkdirSync(safetyFolder, { recursive: true });
    const safetyPath = path.join(safetyFolder, stampFileName());
    let safety = null;
    try {
      safety = await dumpToFile(cfg.db, safetyPath);
    } catch {
      // An empty or broken database cannot be dumped; restoring is still fine.
    }

    await db.close();
    await restoreFromFile(cfg.db, target);
    const reopened = await db.init(cfg.db);
    if (!reopened.ok) throw new Error(reopened.error.message);

    await logActivity(db, 'backup', null, 'restored',
      `Database restored from ${path.basename(target)}`);
    return {
      canceled: false,
      restored: path.basename(target),
      safetyCopy: safety ? safety.path : null
    };
  },

  /**
   * CSV exports for the accountant: income, expenses, invoices and the GST
   * summary, written as plain comma-separated files.
   */
  'backup:exportCsv': async ({ from, to } = {}) => {
    const start = from || `${new Date().getFullYear()}-01-01`;
    const end = to || today();

    const picked = await dialog.showOpenDialog({
      title: 'Choose a folder for the CSV exports',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true };
    const folder = picked.filePaths[0];

    const csv = (rows) => {
      if (!rows.length) return '';
      const headers = Object.keys(rows[0]);
      const cell = (value) => {
        if (value === null || value === undefined) return '';
        const text = String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      return [headers.join(','), ...rows.map((row) => headers.map((h) => cell(row[h])).join(','))]
        .join('\r\n');
    };

    const income = await db.query(`
      SELECT i.received_on AS date, i.amount, i.category, i.description,
             i.method, i.reference, i.source,
             c.name AS client, p.title AS project, inv.invoice_number AS invoice
      FROM incomes i
      LEFT JOIN clients c ON c.id = i.client_id
      LEFT JOIN projects p ON p.id = i.project_id
      LEFT JOIN invoices inv ON inv.id = i.invoice_id
      WHERE i.received_on BETWEEN ? AND ?
      ORDER BY i.received_on ASC`, [start, end]);

    const expenses = await db.query(`
      SELECT e.spent_on AS date, e.amount, e.title, e.payee, e.method, e.reference,
             ec.name AS category, ec.kind, p.title AS project, e.notes
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
      LEFT JOIN projects p ON p.id = e.project_id
      WHERE e.spent_on BETWEEN ? AND ?
      ORDER BY e.spent_on ASC`, [start, end]);

    const invoices = await db.query(`
      SELECT i.invoice_number, i.invoice_date, i.due_date, i.status,
             COALESCE(c.name, i.bill_to_name) AS client, i.bill_to_gstin AS client_gstin,
             i.place_of_supply, i.subtotal, i.discount_amount, i.taxable_amount,
             i.gst_rate, i.cgst_amount, i.sgst_amount, i.igst_amount,
             i.round_off, i.total, i.amount_paid, (i.total - i.amount_paid) AS balance
      FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
      WHERE i.invoice_date BETWEEN ? AND ?
      ORDER BY i.invoice_date ASC`, [start, end]);

    const projects = await db.query(`
      SELECT p.title, c.name AS client, p.amount, p.amount_paid,
             (p.amount - p.amount_paid) AS balance, p.status, p.payment_status,
             p.start_date, p.due_date, p.completed_on, p.paid_on
      FROM projects p LEFT JOIN clients c ON c.id = p.client_id
      ORDER BY p.id ASC`);

    const written = [];
    const files = [
      [`income_${start}_to_${end}.csv`, csv(income)],
      [`expenses_${start}_to_${end}.csv`, csv(expenses)],
      [`invoices_${start}_to_${end}.csv`, csv(invoices)],
      ['projects.csv', csv(projects)]
    ];
    for (const [name, content] of files) {
      if (!content) continue;
      const full = path.join(folder, name);
      // A BOM keeps Excel happy with the rupee sign and other UTF-8 characters.
      fs.writeFileSync(full, `﻿${content}`, 'utf8');
      written.push(name);
    }

    shell.openPath(folder);
    return { canceled: false, folder, files: written, from: start, to: end };
  },

  /** Where everything lives on disk — shown in Settings for peace of mind. */
  'backup:paths': async () => {
    const cfg = config.load();
    const settings = db.isReady() ? await readSettings(db) : {};
    return {
      configFile: config.configPath(),
      backupFolder: cfg.backup.folder,
      userData: app.getPath('userData'),
      database: `${cfg.db.host}:${cfg.db.port}/${cfg.db.database}`,
      lastPdfFolder: settings.last_pdf_folder || null
    };
  }
};
