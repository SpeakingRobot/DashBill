'use strict';

/**
 * MySQL connection pool + schema bootstrap.
 *
 * Nothing in this file talks to the UI. Everything the renderer needs goes
 * through the IPC handlers in ./ipc, which call `query` / `tx` from here.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');
const { requiresTls } = require('./services/connectionString');

let pool = null;
let connectionError = null;

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

/**
 * TLS settings for a connection.
 *
 * Managed clusters such as TiDB Cloud refuse plaintext outright
 * ("Connections using insecure transport are prohibited"), so TLS is forced on
 * for those hosts no matter what the saved config says. Certificates are
 * verified against Node's built-in CA bundle; no certificate file to install.
 */
function tlsOptions(dbConfig) {
  const wanted = dbConfig.ssl === undefined ? true : Boolean(dbConfig.ssl);
  if (!wanted && !requiresTls(dbConfig.host)) return undefined;
  return { minVersion: 'TLSv1.2', rejectUnauthorized: true };
}

function baseOptions(dbConfig) {
  return {
    host: dbConfig.host,
    port: Number(dbConfig.port) || 3306,
    user: dbConfig.user,
    password: dbConfig.password,
    ssl: tlsOptions(dbConfig),
    // A cloud cluster on the other side of the world needs longer than the
    // 10 s default, and a serverless cluster may be waking from idle.
    connectTimeout: 30000
  };
}

function poolOptions(dbConfig) {
  return {
    ...baseOptions(dbConfig),
    database: dbConfig.database,
    waitForConnections: true,
    // The dashboard and the reports fire a dozen independent queries at once.
    // A small pool would make them queue in twos and threes and undo the
    // benefit, so there is room for a whole screen's worth in flight.
    connectionLimit: 16,
    queueLimit: 0,
    // A cloud cluster drops idle connections; letting the pool retire them
    // itself avoids a stall on the first query after a quiet spell.
    idleTimeout: 60000,
    maxIdle: 6,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    // DECIMAL columns come back as JS numbers rather than strings, so money
    // arithmetic in the UI does not need parsing at every call site.
    decimalNumbers: true,
    dateStrings: ['DATE'],
    charset: 'utf8mb4_unicode_ci',
    timezone: 'local',
    multipleStatements: false
  };
}

/** Create the database if it does not exist yet, then return a pool for it. */
async function connect(dbConfig) {
  const cfg = dbConfig || config.load().db;

  // Connect without a database first so a brand-new machine can be set up.
  const bootstrap = await mysql.createConnection({
    ...baseOptions(cfg),
    multipleStatements: false
  });
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${cfg.database.replace(/`/g, '')}\`` +
      ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
  } finally {
    await bootstrap.end();
  }

  const created = mysql.createPool(poolOptions(cfg));
  await created.query('SELECT 1');
  return created;
}

/**
 * Columns added after the first release.
 *
 * `CREATE TABLE IF NOT EXISTS` in schema.sql covers a fresh install but does
 * nothing to a database that already has the table, so anything added later
 * has to be applied here as well. MySQL 8 has no `ADD COLUMN IF NOT EXISTS`,
 * so each one is checked against information_schema first.
 */
const COLUMN_ADDITIONS = [
  { table: 'invoices', column: 'gst_amount',
    definition: 'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER gst_rate' },
  { table: 'invoices', column: 'bank_details', definition: 'TEXT NULL' },
  { table: 'invoices', column: 'column_config', definition: 'TEXT NULL' },
  { table: 'invoice_items', column: 'custom_fields', definition: 'TEXT NULL' }
];

/**
 * Columns whose definition widened — currently just the gst_mode enum.
 *
 * The new member is appended, never inserted. An ENUM is stored as the index
 * of its member, so adding one in the middle renumbers everything after it and
 * would turn existing CGST+SGST invoices into something else; TiDB refuses the
 * change outright for the same reason.
 */
const COLUMN_CHANGES = [
  {
    table: 'invoices',
    column: 'gst_mode',
    definition: "ENUM('none','cgst_sgst','igst','gst') NOT NULL DEFAULT 'none'",
    // Matches 'gst' only as a whole member, not inside 'cgst_sgst'.
    stale: (columnType) => !/(^|[(,])'gst'([,)]|$)/.test(String(columnType))
  }
];

async function applyColumnMigrations(target) {
  const [rows] = await target.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS ty
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`
  );
  const existing = new Map();
  for (const row of rows) existing.set(`${row.t}.${row.c}`, row.ty);

  for (const add of COLUMN_ADDITIONS) {
    if (existing.has(`${add.table}.${add.column}`)) continue;
    await target.query(
      `ALTER TABLE \`${add.table}\` ADD COLUMN \`${add.column}\` ${add.definition}`
    );
  }

  for (const change of COLUMN_CHANGES) {
    const type = existing.get(`${change.table}.${change.column}`);
    if (type === undefined || !change.stale(type)) continue;
    await target.query(
      `ALTER TABLE \`${change.table}\` MODIFY COLUMN \`${change.column}\` ${change.definition}`
    );
  }
}

/** Run schema.sql statement by statement. Safe to call on every start-up. */
async function migrate(target) {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const statements = sql
    .split(/^\s*;;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await target.query(statement);
  }
  await applyColumnMigrations(target);
  await seedSettings(target);
}

/** Insert the default company profile / invoice settings on first run only. */
async function seedSettings(target) {
  const defaults = {
    // How this copy of DashBill is branded. Nothing here names a particular
    // business: the first-run wizard fills it in, so the same installer can be
    // handed to anyone and becomes theirs.
    app_display_name: 'DashBill',
    onboarded: '0',
    company_name: '',
    company_tagline: '',
    company_address_line1: '',
    company_address_line2: '',
    company_city: '',
    company_state: '',
    company_pincode: '',
    company_country: 'India',
    company_phone: '',
    company_email: '',
    company_website: '',
    company_gstin: '',
    company_pan: '',
    company_logo: '',
    bank_name: '',
    bank_account_name: '',
    bank_account_number: '',
    bank_ifsc: '',
    bank_branch: '',
    bank_upi: '',
    currency_symbol: '₹',
    invoice_prefix: 'INV',
    invoice_number_format: '{prefix}/{fy}/{seq}',
    invoice_next_seq: '1',
    invoice_seq_padding: '3',
    invoice_default_gst_mode: 'gst',
    invoice_default_gst_rate: '18',
    invoice_default_due_days: '15',
    invoice_default_terms:
      '1. Payment due within 15 days of invoice date.\n' +
      '2. Files are released after full payment is received.\n' +
      '3. Please quote the invoice number with every payment.',
    invoice_footer_note: 'Thank you for your business.',
    invoice_signature_label: '',
    invoice_signature_image: '',
    updates_seen_version: '',
    updates_seen_notices: '',
    updates_check_on_start: '1',
    invoice_round_off: '1',
    owner_name: ''
  };

  const rows = Object.entries(defaults).map(([k, v]) => [k, v]);
  await target.query(
    'INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES ?',
    [rows]
  );
}

/**
 * Open (or re-open) the pool. Returns { ok, error }. Never throws, so the main
 * process can always show the UI and let the user fix their credentials.
 */
async function init(dbConfig) {
  if (pool) {
    try { await pool.end(); } catch { /* already gone */ }
    pool = null;
  }
  try {
    const created = await connect(dbConfig);
    await migrate(created);
    pool = created;
    connectionError = null;
    return { ok: true };
  } catch (err) {
    connectionError = describe(err);
    return { ok: false, error: connectionError };
  }
}

/** Turn a mysql2 error into something a non-technical user can act on. */
function describe(err) {
  const code = err && err.code ? err.code : '';
  const message = err && err.message ? err.message : String(err);

  // Some conditions only show up in the message text, not the code.
  if (/insecure transport/i.test(message)) {
    return {
      code: code || 'TLS_REQUIRED',
      message,
      hint: 'This server only accepts encrypted connections. Switch "Use a secure ' +
        'connection (TLS)" on and try again.'
    };
  }
  if (/certificate|self.signed|CERT_/i.test(message)) {
    return {
      code: code || 'TLS_FAILED',
      message,
      hint: 'The TLS certificate presented by the server could not be verified. Check ' +
        'that the host name is exactly the one your provider gave you.'
    };
  }

  const hints = {
    ECONNREFUSED:
      'Nothing is listening on that host and port. For a local MySQL server, start ' +
      'the service (Win+R -> services.msc -> MySQL80 -> Start). For a cloud cluster, ' +
      'check the host and port shown in the Connect dialog of your provider.',
    ER_ACCESS_DENIED_ERROR:
      'The user name or password was rejected. On TiDB Cloud the user name includes ' +
      'the cluster prefix, like 1a2b3c4d5e.root — copy it exactly from the Connect ' +
      'dialog, and use the password you generated there.',
    ER_DBACCESS_DENIED_ERROR:
      'This user is not allowed to use that database. If you entered sys, mysql, ' +
      'information_schema or performance_schema, those belong to the server itself ' +
      'and nobody may store data in them — put a name of your own, such as ' +
      'dashbill, and it will be created for you.',
    ER_BAD_DB_ERROR:
      'That database does not exist and this user cannot create it. Enter the name of ' +
      'a database that already exists.',
    ETIMEDOUT:
      'The server did not answer in time. Check your internet connection, and that ' +
      'your cloud provider allows connections from your current network.',
    ENOTFOUND:
      'That host name could not be found. Check it for typos — it should look like ' +
      'gateway01.<region>.prod.aws.tidbcloud.com for TiDB Cloud.',
    EAI_AGAIN:
      'The host name could not be looked up. This usually means no internet connection.',
    ECONNRESET:
      'The connection was dropped by the server. Try again; a serverless cluster may ' +
      'have been waking up.',
    PROTOCOL_CONNECTION_LOST:
      'The connection was lost. Press Retry to reconnect.'
  };

  return {
    code: code || 'UNKNOWN',
    message,
    hint: hints[code] || 'Open Settings -> Database and check the connection details.'
  };
}

function isReady() { return Boolean(pool); }
function lastError() { return connectionError; }

function requirePool() {
  if (!pool) {
    const err = new Error('No database connection. Open Settings -> Database.');
    err.code = 'NO_DB';
    throw err;
  }
  return pool;
}

/** Run a query. Returns rows for SELECT, the result header otherwise. */
async function query(sql, params) {
  const [result] = await requirePool().execute(sql, params === undefined ? [] : params);
  return result;
}

/** Same as `query` but for statements mysql2 cannot prepare (DDL, SHOW, ...). */
async function raw(sql, params) {
  const [result] = await requirePool().query(sql, params === undefined ? [] : params);
  return result;
}

/** First row of a SELECT, or null. */
async function one(sql, params) {
  const rows = await query(sql, params);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Single scalar value of a SELECT, or null. */
async function scalar(sql, params) {
  const row = await one(sql, params);
  if (!row) return null;
  const keys = Object.keys(row);
  return keys.length ? row[keys[0]] : null;
}

/**
 * Run `fn` inside a transaction. `fn` receives a helper with the same shape as
 * this module (query/one/scalar) bound to the transaction's connection.
 */
async function tx(fn) {
  const conn = await requirePool().getConnection();
  const helper = {
    query: async (sql, params) => {
      const [r] = await conn.execute(sql, params === undefined ? [] : params);
      return r;
    },
    raw: async (sql, params) => {
      const [r] = await conn.query(sql, params === undefined ? [] : params);
      return r;
    }
  };
  helper.one = async (sql, params) => {
    const rows = await helper.query(sql, params);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  };
  helper.scalar = async (sql, params) => {
    const row = await helper.one(sql, params);
    if (!row) return null;
    const keys = Object.keys(row);
    return keys.length ? row[keys[0]] : null;
  };

  try {
    await conn.beginTransaction();
    const result = await fn(helper);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* connection may be dead */ }
    throw err;
  } finally {
    conn.release();
  }
}

/** Probe a set of credentials without disturbing the live pool. */
async function test(dbConfig) {
  try {
    const probe = await connect(dbConfig);
    const version = await (async () => {
      const [rows] = await probe.query('SELECT VERSION() AS v');
      return rows[0].v;
    })();
    await probe.end();
    return { ok: true, version };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

async function close() {
  if (pool) {
    try { await pool.end(); } catch { /* ignore */ }
    pool = null;
  }
}

module.exports = {
  init, test, close, migrate,
  query, raw, one, scalar, tx,
  isReady, lastError, describe,
  get pool() { return pool; }
};
