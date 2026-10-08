'use strict';

/**
 * A self-contained mysqldump replacement.
 *
 * Writing the dump in JavaScript means a backup never depends on mysqldump.exe
 * being installed or on PATH — which matters, because the whole point of these
 * files is that they still work on a different machine after this one dies.
 *
 * The output is ordinary SQL: you can restore it from this app, from MySQL
 * Workbench, or from `mysql -u root -p dashbill < backup.sql`.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const mysqlRaw = require('mysql2');
const { requiresTls } = require('./connectionString');

/** Quote an identifier: table -> `table`. */
function id(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

/** Escape a value for inclusion in SQL. Falls back if mysql2 ever moves it. */
const escapeValue = typeof mysqlRaw.escape === 'function'
  ? mysqlRaw.escape
  : (value) => {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
    if (value instanceof Date) {
      const pad = (n) => String(n).padStart(2, '0');
      return `'${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
        `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}'`;
    }
    return `'${String(value).replace(/[\0\n\r\b\t\\'"\x1a]/g, (ch) => ({
      '\0': '\\0', '\n': '\\n', '\r': '\\r', '\b': '\\b', '\t': '\\t',
      '\x1a': '\\Z', '\\': '\\\\', "'": "\\'", '"': '\\"'
    }[ch]))}'`;
  };

/**
 * The dump and restore routines open their own connections, so they repeat the
 * TLS decision made in db.js: on by default, and always on for a managed host
 * that refuses plaintext.
 */
function tlsFor(dbConfig) {
  const wanted = dbConfig.ssl === undefined ? true : Boolean(dbConfig.ssl);
  if (!wanted && !requiresTls(dbConfig.host)) return undefined;
  return { minVersion: 'TLSv1.2', rejectUnauthorized: true };
}

const INSERT_BATCH_ROWS = 200;

/**
 * Write a full SQL dump of `dbConfig.database` to `filePath`.
 * Returns { path, bytes, tables, rows }.
 */
async function dumpToFile(dbConfig, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const conn = await mysql.createConnection({
    host: dbConfig.host,
    port: Number(dbConfig.port) || 3306,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    ssl: tlsFor(dbConfig),
    connectTimeout: 30000,
    // Keep DECIMAL/DATE as strings here: a dump must reproduce exactly what is
    // stored, with no float rounding on the way through.
    decimalNumbers: false,
    dateStrings: true,
    multipleStatements: false
  });

  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });

  // One error listener for the whole dump. Adding one per write would pile up
  // hundreds of listeners on a large database and leak them.
  let streamError = null;
  stream.on('error', (err) => { streamError = err; });

  const write = (text) => new Promise((resolve, reject) => {
    if (streamError) { reject(streamError); return; }
    // A false return means the buffer is full; wait for it to drain so memory
    // use stays flat however big the table is.
    if (stream.write(text)) resolve();
    else stream.once('drain', resolve);
  });

  let tableCount = 0;
  let rowCount = 0;

  try {
    const [versionRows] = await conn.query('SELECT VERSION() AS v');
    const stamp = new Date().toISOString();

    await write([
      '-- ===========================================================',
      '--  DashBill -- database backup',
      '--  DashBill, by Samuel Fernandes',
      `--  Database : ${dbConfig.database}`,
      `--  Server   : ${dbConfig.host}:${dbConfig.port || 3306} (MySQL ${versionRows[0].v})`,
      `--  Taken at : ${stamp}`,
      '--',
      '--  To restore from inside the app:  Settings -> Backups -> Restore.',
      '--  To restore by hand:',
      `--    mysql -u root -p ${dbConfig.database} < "${path.basename(filePath)}"`,
      '-- ===========================================================',
      '',
      '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
      '/*!40101 SET NAMES utf8mb4 */;',
      '/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;',
      "/*!40103 SET TIME_ZONE='+00:00' */;",
      'SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS;',
      'SET FOREIGN_KEY_CHECKS=0;',
      'SET @OLD_SQL_MODE=@@SQL_MODE;',
      "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';",
      ''
    ].join('\n'));

    const [tables] = await conn.query(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`, [dbConfig.database]
    );

    for (const table of tables) {
      const name = table.name;
      tableCount += 1;

      const [created] = await conn.query(`SHOW CREATE TABLE ${id(name)}`);
      const createSql = created[0]['Create Table'];

      await write([
        '',
        `-- -----------------------------------------------------------`,
        `-- Table: ${name}`,
        `-- -----------------------------------------------------------`,
        `DROP TABLE IF EXISTS ${id(name)};`,
        `${createSql};`,
        ''
      ].join('\n'));

      const [columns] = await conn.query(
        `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [dbConfig.database, name]
      );
      const columnList = columns.map((c) => id(c.name)).join(', ');

      // Stream the rows so a large table never has to fit in memory at once.
      //
      // Streaming lives on mysql2's core connection, not on the promise wrapper:
      // `promiseConnection.query(...)` resolves to an array and has no .stream().
      // Reaching through to `.connection` is what makes a row-by-row read work.
      const rows = conn.connection
        .query({ sql: `SELECT * FROM ${id(name)}`, rowsAsArray: false })
        .stream();
      let batch = [];
      let wroteAny = false;

      const flush = async () => {
        if (!batch.length) return;
        await write(
          `INSERT INTO ${id(name)} (${columnList}) VALUES\n${batch.join(',\n')};\n`
        );
        batch = [];
      };

      for await (const row of rows) {
        const values = columns.map((c) => escapeValue(row[c.name]));
        batch.push(`  (${values.join(', ')})`);
        rowCount += 1;
        wroteAny = true;
        if (batch.length >= INSERT_BATCH_ROWS) await flush();
      }
      await flush();
      if (!wroteAny) await write(`-- (no rows)\n`);
    }

    await write([
      '',
      'SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;',
      'SET SQL_MODE=@OLD_SQL_MODE;',
      '/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;',
      '/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;',
      '',
      `-- Dump completed: ${tableCount} tables, ${rowCount} rows.`,
      ''
    ].join('\n'));
  } finally {
    await new Promise((resolve) => stream.end(resolve));
    await conn.end();
  }

  // A write error that surfaced late — a full disk, say — must not leave the
  // caller believing a usable backup exists.
  if (streamError) throw streamError;

  const { size } = fs.statSync(filePath);
  return { path: filePath, bytes: size, tables: tableCount, rows: rowCount };
}

/**
 * Restore a dump file. The whole file is handed to MySQL in one go with
 * multipleStatements enabled, so quoting and semicolons inside string literals
 * are MySQL's problem to parse, not ours.
 */
async function restoreFromFile(dbConfig, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  if (!/CREATE TABLE/i.test(sql)) {
    throw new Error('That file does not look like a DashBill backup.');
  }

  const conn = await mysql.createConnection({
    host: dbConfig.host,
    port: Number(dbConfig.port) || 3306,
    user: dbConfig.user,
    password: dbConfig.password,
    ssl: tlsFor(dbConfig),
    connectTimeout: 30000,
    multipleStatements: true
  });

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS ${id(dbConfig.database)}` +
      ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    await conn.changeUser({ database: dbConfig.database });
    await conn.query(sql);
  } finally {
    await conn.end();
  }
  return { path: filePath, bytes: fs.statSync(filePath).size };
}

module.exports = { dumpToFile, restoreFromFile };
