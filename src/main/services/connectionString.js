'use strict';

/**
 * Parse a database connection string into the fields the setup form uses.
 *
 * Accepts the shapes people actually paste:
 *   mysql://user:pass@host:4000/dbname
 *   mysql://user:pass@host:4000/dbname?ssl-mode=VERIFY_IDENTITY
 *   user:pass@host:4000/dbname
 *   host:4000
 *
 * TiDB Cloud hands you the first form from "Connect" -> "General". The user
 * part of a TiDB Serverless cluster looks like `1a2b3c4d5e.root`, and the
 * password may contain characters that need percent-encoding, so both are
 * decoded here.
 */

/** Hosts that always require TLS, whatever the string says. */
const TLS_ONLY_HOSTS = [/\.tidbcloud\.com$/i, /\.aivencloud\.com$/i, /\.planetscale\./i];

function decode(value) {
  if (value === undefined || value === null) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * @param {string} text
 * @returns {{ok:boolean, error?:string, value?:object}}
 */
function parseConnectionString(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'Paste a connection string first.' };

  // Strip a leading `mysql -u ... -p...` style command if that is what was copied.
  if (/^mysql\s+-/i.test(raw)) return parseCliForm(raw);

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `mysql://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return {
      ok: false,
      error: 'That does not look like a connection string. Expected something like ' +
        'mysql://user:password@host:4000/database'
    };
  }

  if (!url.hostname) return { ok: false, error: 'No host found in that connection string.' };

  const database = decode(url.pathname.replace(/^\//, '')) || '';
  const port = url.port ? Number(url.port) : 4000;

  // ssl-mode / sslmode / ssl query parameters, plus hosts that mandate TLS.
  const sslMode = (url.searchParams.get('ssl-mode') || url.searchParams.get('sslmode') ||
    url.searchParams.get('ssl') || '').toUpperCase();
  let ssl = true;
  if (['DISABLED', 'FALSE', '0', 'OFF'].includes(sslMode)) ssl = false;
  if (TLS_ONLY_HOSTS.some((pattern) => pattern.test(url.hostname))) ssl = true;

  return {
    ok: true,
    value: {
      host: url.hostname,
      port: Number.isFinite(port) && port > 0 ? port : 4000,
      user: decode(url.username),
      password: decode(url.password),
      database,
      ssl,
      mode: TLS_ONLY_HOSTS.some((pattern) => pattern.test(url.hostname)) ? 'tidb' : 'mysql'
    }
  };
}

/** `mysql -u x -h y -P 4000 -p<pass> dbname` */
function parseCliForm(raw) {
  const value = { host: '', port: 4000, user: '', password: '', database: '', ssl: true, mode: 'tidb' };

  const host = raw.match(/(?:-h|--host[= ])\s*([^\s]+)/i);
  const port = raw.match(/(?:-P|--port[= ])\s*(\d+)/);
  const user = raw.match(/(?:-u|--user[= ])\s*([^\s]+)/i);
  const pass = raw.match(/(?:-p|--password=)\s*([^\s]+)/);
  const db = raw.match(/(?:-D|--database[= ])\s*([^\s]+)/i);

  if (host) value.host = host[1];
  if (port) value.port = Number(port[1]);
  if (user) value.user = user[1];
  if (pass) value.password = pass[1];
  if (db) value.database = db[1];

  if (!value.host) return { ok: false, error: 'No -h host found in that command.' };
  if (!TLS_ONLY_HOSTS.some((pattern) => pattern.test(value.host))) value.mode = 'mysql';
  return { ok: true, value };
}

/** True when this host will refuse an unencrypted connection. */
function requiresTls(host) {
  return TLS_ONLY_HOSTS.some((pattern) => pattern.test(String(host || '')));
}

module.exports = { parseConnectionString, requiresTls };
