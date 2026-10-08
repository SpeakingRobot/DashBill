'use strict';

/**
 * The backup schedule itself, kept separate from the IPC layer so that the
 * main process can also take a backup on a timer and on exit without going
 * through the renderer.
 */

const fs = require('fs');
const path = require('path');

const db = require('../db');
const config = require('../config');
const { dumpToFile } = require('./dump');
const { logActivity } = require('./util');

const FILE_PREFIX = 'anjoy-billings-';

function stampFileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${FILE_PREFIX}${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.sql`;
}

/** Backup files present in a folder, newest first. */
function listFiles(folder) {
  try {
    return fs.readdirSync(folder)
      .filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith('.sql'))
      .map((name) => {
        const full = path.join(folder, name);
        const stat = fs.statSync(full);
        return { name, path: full, bytes: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  } catch {
    return [];
  }
}

/** Delete the oldest files beyond `keepCopies`. Returns the names removed. */
function prune(folder, keepCopies) {
  const keep = Math.max(1, Number(keepCopies) || 24);
  const removed = [];
  for (const file of listFiles(folder).slice(keep)) {
    try {
      fs.unlinkSync(file.path);
      removed.push(file.name);
    } catch {
      /* a locked file is not worth failing the backup over */
    }
  }
  return removed;
}

function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

/** True when the configured interval has elapsed (or nothing was ever saved). */
function isDue() {
  const cfg = config.load();
  const since = daysSince(cfg.backup.lastBackupAt);
  const interval = Number(cfg.backup.intervalDays) || 15;
  return since === null ? true : since >= interval;
}

/**
 * Take a backup now. Shared by the manual button, the periodic check and app
 * exit. Returns { path, bytes, tables, rows, folder, pruned, reason }.
 */
async function runBackup({ reason = 'manual', folder } = {}) {
  const cfg = config.load();
  const targetFolder = folder || cfg.backup.folder;
  fs.mkdirSync(targetFolder, { recursive: true });

  const filePath = path.join(targetFolder, stampFileName());
  const result = await dumpToFile(cfg.db, filePath);
  const pruned = prune(targetFolder, cfg.backup.keepCopies);

  config.save({ backup: { lastBackupAt: new Date().toISOString() } });
  if (db.isReady()) {
    await logActivity(db, 'backup', null, reason,
      `Backup saved: ${path.basename(filePath)} (${(result.bytes / 1024).toFixed(0)} KB)`);
  }
  return { ...result, folder: targetFolder, pruned, reason };
}

module.exports = {
  FILE_PREFIX, stampFileName, listFiles, prune, daysSince, isDue, runBackup
};
