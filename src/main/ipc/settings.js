'use strict';

const fs = require('fs');
const path = require('path');
const { dialog, app } = require('electron');

const db = require('../db');
const config = require('../config');
const { readSettings, logActivity } = require('../services/util');
const { parseConnectionString, requiresTls } = require('../services/connectionString');

/**
 * Keys the Settings screen is allowed to write. Anything else the renderer
 * sends is ignored, so a stray field can never create junk rows.
 */
const ALLOWED_KEYS = new Set([
  'app_display_name', 'onboarded',
  'company_name', 'company_tagline', 'company_address_line1', 'company_address_line2',
  'company_city', 'company_state', 'company_pincode', 'company_country',
  'company_phone', 'company_email', 'company_website', 'company_gstin', 'company_pan',
  'company_logo',
  'bank_name', 'bank_account_name', 'bank_account_number', 'bank_ifsc', 'bank_branch',
  'bank_upi',
  'currency_symbol', 'invoice_prefix', 'invoice_number_format', 'invoice_next_seq',
  'invoice_seq_padding', 'invoice_default_gst_mode', 'invoice_default_gst_rate',
  'invoice_default_due_days', 'invoice_default_terms', 'invoice_footer_note',
  'invoice_signature_label', 'invoice_signature_image',
  'invoice_round_off', 'owner_name', 'last_pdf_folder',
  'updates_check_on_start'
]);

const MAX_LOGO_BYTES = 1024 * 1024; // 1 MB, plenty for a print-quality mark
const MAX_SIGNATURE_BYTES = 512 * 1024; // a signature is a small transparent PNG

/**
 * The two pictures stored inside the database as base64 data URLs. They are
 * the only heavy rows in app_settings, and both change about once in the life
 * of an install, so they are left out of an ordinary settings read.
 */
const IMAGE_KEYS = [
  ['company_logo', 'has_logo'],
  ['invoice_signature_image', 'has_signature']
];

module.exports = {
  /**
   * The company profile.
   *
   * `company_logo` holds a base64 data URL of up to a megabyte. Dragging that
   * out of a cloud database every time a page asks for the settings is the
   * single most expensive thing on this screen, and it changes almost never —
   * so it is left out unless the caller says it needs it. The window fetches
   * it once at start-up for the sidebar and keeps it.
   */
  'settings:get': async ({ withLogo } = {}) => {
    const settings = db.isReady() ? await readSettings(db) : {};
    if (!withLogo) {
      IMAGE_KEYS.forEach(([key, flag]) => {
        if (settings[key] === undefined) return;
        settings[flag] = settings[key] ? '1' : '';
        delete settings[key];
      });
    }
    return {
      settings,
      config: config.publicConfig(),
      app: {
        version: app.getVersion(),
        name: app.getName(),
        electron: process.versions.electron,
        node: process.versions.node,
        userData: app.getPath('userData')
      }
    };
  },

  'settings:save': async ({ settings } = {}) => {
    const entries = Object.entries(settings || {})
      .filter(([key]) => ALLOWED_KEYS.has(key))
      .map(([key, value]) => [key, value === null || value === undefined ? '' : String(value)]);

    if (!entries.length) return { saved: 0 };

    await db.raw(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ?
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [entries]
    );
    await logActivity(db, 'settings', null, 'updated',
      `Settings updated (${entries.length} field${entries.length === 1 ? '' : 's'})`);
    return { saved: entries.length };
  },

  /**
   * Finish the first-run wizard: the business name, what to call the software,
   * and anything else the welcome step collected. Marks the install onboarded
   * so the wizard does not come back.
   */
  'settings:completeSetup': async (payload = {}) => {
    const name = String(payload.company_name || '').trim();
    if (!name) throw new Error('Enter your business name.');

    const entries = [
      ['company_name', name.slice(0, 180)],
      ['company_tagline', String(payload.company_tagline || '').trim().slice(0, 180)],
      ['app_display_name',
        String(payload.app_display_name || '').trim().slice(0, 60) || 'DashBill'],
      ['invoice_signature_label', 'For ' + name.slice(0, 160)],
      ['bank_account_name', name.slice(0, 180)],
      ['onboarded', '1']
    ];
    if (payload.invoice_prefix) {
      entries.push(['invoice_prefix',
        String(payload.invoice_prefix).trim().toUpperCase().slice(0, 12)]);
    }

    await db.raw(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ?
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [entries]
    );
    await logActivity(db, 'settings', null, 'setup', `Set up for ${name}`);
    return { ok: true };
  },

  /**
   * Pick a logo and store it inside the database as a data URL.
   * Keeping it in the database (rather than as a file path) means a restored
   * backup always still has the logo, even on a different machine.
   */
  'settings:pickLogo': async () => pickImage({
    key: 'company_logo',
    title: 'Choose your logo',
    limit: MAX_LOGO_BYTES,
    advice: 'a 600 x 600 PNG is more than enough for a printed invoice'
  }),

  'settings:clearLogo': async () => clearImage('company_logo'),

  /**
   * Pick the signature that prints above "Authorised Signatory".
   *
   * A transparent PNG is what this is for: scanned or drawn, background
   * removed, so it sits on the invoice's signature rule rather than in a white
   * box. JPG works but brings its background with it, which is why the
   * Settings screen says so.
   */
  'settings:pickSignature': async () => pickImage({
    key: 'invoice_signature_image',
    title: 'Choose your signature image',
    limit: MAX_SIGNATURE_BYTES,
    advice: 'a transparent PNG about 600 x 200 is ideal'
  }),

  'settings:clearSignature': async () => clearImage('invoice_signature_image'),

  // -- database connection -------------------------------------------------
  'settings:dbStatus': async () => {
    const cfg = config.publicConfig();
    if (!db.isReady()) {
      return { connected: false, error: db.lastError(), config: cfg.db };
    }
    // Three independent lookups; no reason to wait for each in turn.
    const [version, size, counts] = await Promise.all([
      db.scalar('SELECT VERSION()'),
      db.one(`
        SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes,
               COUNT(*) AS tables
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`),
      db.one(`
        SELECT
          (SELECT COUNT(*) FROM clients)  AS clients,
          (SELECT COUNT(*) FROM projects) AS projects,
          (SELECT COUNT(*) FROM incomes)  AS incomes,
          (SELECT COUNT(*) FROM expenses) AS expenses,
          (SELECT COUNT(*) FROM invoices) AS invoices`)
    ]);
    return { connected: true, version, size, counts, config: cfg.db };
  },

  /**
   * Turn a pasted connection string into form fields.
   *
   * TiDB Cloud -> Connect -> "General" gives a string of the form
   *   mysql://<user>:<password>@<host>:4000/<database>
   * which is exactly what this accepts. The password is returned so the form
   * can be filled in; it is not stored until the user presses Save.
   */
  'settings:parseConnectionString': async ({ text } = {}) => {
    const result = parseConnectionString(text);
    if (!result.ok) return { ok: false, error: { code: 'PARSE', message: result.error } };
    const value = result.value;
    return {
      ok: true,
      value: {
        mode: value.mode,
        host: value.host,
        port: value.port,
        user: value.user,
        password: value.password,
        // A connection string often names an existing database such as `test`.
        // Keep the app's own database instead unless one was given.
        database: value.database || config.load().db.database || 'anjoy_billings',
        ssl: value.ssl
      },
      tlsRequired: requiresTls(value.host)
    };
  },

  /**
   * Merge a payload from the form over what is already saved.
   * A blank or masked password field means "keep the saved one".
   */
  'settings:resolveDb': async (payload = {}) => mergeDbConfig(payload),

  /** Try a set of credentials without disturbing the live connection. */
  'settings:testDb': async (payload = {}) => db.test(mergeDbConfig(payload)),

  /** Save credentials and reconnect. */
  'settings:saveDb': async (payload = {}) => {
    const next = mergeDbConfig(payload);
    if (!next.host) {
      return { ok: false, error: { code: 'NO_HOST', message: 'Enter the server host name.' } };
    }
    if (!next.user) {
      return { ok: false, error: { code: 'NO_USER', message: 'Enter the database user name.' } };
    }
    if (!next.database) {
      return { ok: false, error: { code: 'NO_DB', message: 'Enter a database name.' } };
    }

    const probe = await db.test(next);
    if (!probe.ok) return { ok: false, error: probe.error };

    config.save({ db: next, configured: true });
    const opened = await db.init(next);
    if (!opened.ok) return { ok: false, error: opened.error };
    return { ok: true, version: probe.version, config: config.publicConfig().db };
  }
};

const MIME_BY_EXTENSION = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp'
};

/**
 * Ask for an image file and store it in app_settings as a data URL.
 * Shared by the logo and the signature, which differ only in size limit and
 * wording.
 */
async function pickImage({ key, title, limit, advice }) {
  const picked = await dialog.showOpenDialog({
    title,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }],
    properties: ['openFile']
  });
  if (picked.canceled || !picked.filePaths.length) return { canceled: true };

  const filePath = picked.filePaths[0];
  const { size } = fs.statSync(filePath);
  if (size > limit) {
    throw new Error(
      `That image is ${(size / 1024 / 1024).toFixed(1)} MB. Please use one under ` +
      `${Math.round(limit / 1024)} KB — ${advice}.`
    );
  }

  const mime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()];
  if (!mime) throw new Error('Use a PNG, JPG, SVG or WebP image.');

  const dataUrl = `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  await db.query(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, dataUrl]
  );
  return {
    canceled: false,
    image: dataUrl,
    logo: dataUrl,          // the name the logo caller has always used
    transparent: mime === 'image/png' || mime === 'image/svg+xml' || mime === 'image/webp',
    bytes: size,
    name: path.basename(filePath)
  };
}

async function clearImage(key) {
  await db.query(
    "UPDATE app_settings SET setting_value = '' WHERE setting_key = ?", [key]
  );
  return { cleared: true };
}

/** Build a complete db config from a partial form payload plus what is saved. */
function mergeDbConfig(payload) {
  const current = config.load().db;
  const host = payload.host === undefined ? current.host : String(payload.host).trim();
  const port = Number(payload.port) || current.port || (requiresTls(host) ? 4000 : 3306);

  return {
    mode: payload.mode === 'mysql' || payload.mode === 'tidb' ? payload.mode : current.mode,
    host,
    port,
    user: payload.user === undefined ? current.user : String(payload.user).trim(),
    password: payload.password === undefined || payload.password === '' ||
      payload.password === '********'
      ? current.password
      : String(payload.password),
    database: payload.database === undefined
      ? current.database
      : String(payload.database).trim(),
    // TLS is forced on for hosts that refuse plaintext, whatever the form says.
    ssl: requiresTls(host)
      ? true
      : (payload.ssl === undefined ? current.ssl : Boolean(Number(payload.ssl) || payload.ssl === true))
  };
}
