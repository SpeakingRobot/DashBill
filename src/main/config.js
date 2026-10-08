'use strict';

/**
 * Local application configuration.
 *
 * This is the one piece of state that cannot live in the database, because we
 * need it *before* a connection exists. It is a small JSON file in Electron's
 * userData folder, per Windows user:
 *   C:\Users\<you>\AppData\Roaming\DashBill\config.json
 *
 * The installer ships no credentials. Every copy of the application asks for
 * its own database details on first run, so anyone can point their install at
 * their own TiDB Cloud cluster (or at a local MySQL server).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const DEFAULTS = {
  db: {
    // 'tidb'  -> TiDB Cloud or any MySQL-compatible server reached over TLS
    // 'mysql' -> a MySQL/MariaDB server on this machine or local network
    mode: 'tidb',
    host: '',
    port: 4000,
    user: '',
    password: '',
    database: 'dashbill',
    ssl: true
  },
  backup: {
    folder: path.join(os.homedir(), 'Documents', 'DashBill Backups'),
    intervalDays: 15,
    keepCopies: 24,
    lastBackupAt: null,
    backupOnExit: true
  },
  window: { width: 1360, height: 880, maximized: true },
  /*
   * How large everything is drawn. This belongs to the screen in front of the
   * person, not to their books, so it stays on this machine rather than in the
   * database -- the same user on a laptop and on a shop counter display wants
   * two different answers.
   */
  ui: { zoom: 1 },
  configured: false
};

let cachePath = null;
let cache = null;

function configPath() {
  if (!cachePath) cachePath = path.join(app.getPath('userData'), 'config.json');
  return cachePath;
}

/** Deep-merge plain objects, with `patch` winning. */
function merge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = merge(out[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    cache = merge(DEFAULTS, JSON.parse(raw));
  } catch {
    cache = merge(DEFAULTS, {});
  }
  return cache;
}

function save(patch) {
  cache = merge(load(), patch);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cache, null, 2), 'utf8');
  return cache;
}

/**
 * Configuration with the password masked — safe to hand to the window.
 * The real password never leaves the main process.
 */
function publicConfig() {
  const cfg = load();
  return merge(cfg, { db: { password: cfg.db.password ? '********' : '' } });
}

/** Has the user completed the first-run connection form? */
function isConfigured() {
  const cfg = load();
  return Boolean(cfg.configured && cfg.db.host && cfg.db.user);
}

module.exports = { load, save, publicConfig, isConfigured, configPath, DEFAULTS };
