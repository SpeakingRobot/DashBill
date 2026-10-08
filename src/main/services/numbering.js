'use strict';

const { financialYear, today } = require('./util');

/**
 * Build the next invoice number from the format stored in Settings.
 *
 * Placeholders in `invoice_number_format`:
 *   {prefix}  -> invoice_prefix, e.g. AG
 *   {fy}      -> Indian financial year of the invoice date, e.g. 2026-27
 *   {yyyy}    -> calendar year, e.g. 2026
 *   {yy}      -> two-digit year, e.g. 26
 *   {mm}      -> two-digit month
 *   {seq}     -> running counter, zero padded to invoice_seq_padding
 *
 * Default format: {prefix}/{fy}/{seq}  ->  AG/2026-27/001
 */
function render(format, { prefix, dateStr, seq, padding }) {
  const d = new Date(`${dateStr}T00:00:00`);
  return String(format || '{prefix}/{fy}/{seq}')
    .replace(/\{prefix\}/g, prefix || '')
    .replace(/\{fy\}/g, financialYear(dateStr))
    .replace(/\{yyyy\}/g, String(d.getFullYear()))
    .replace(/\{yy\}/g, String(d.getFullYear()).slice(-2))
    .replace(/\{mm\}/g, String(d.getMonth() + 1).padStart(2, '0'))
    .replace(/\{seq\}/g, String(seq).padStart(Math.max(1, padding), '0'))
    .trim();
}

/**
 * Peek at the next number without consuming it (used to prefill the form).
 * `conn` is the db module or a transaction helper.
 */
async function peekNextNumber(conn, dateStr) {
  const rows = await conn.query(
    `SELECT setting_key, setting_value FROM app_settings
     WHERE setting_key IN ('invoice_prefix','invoice_number_format','invoice_next_seq','invoice_seq_padding')`
  );
  const s = {};
  for (const row of rows) s[row.setting_key] = row.setting_value;

  const date = dateStr || today();
  let seq = Math.max(1, parseInt(s.invoice_next_seq, 10) || 1);
  const padding = Math.max(1, parseInt(s.invoice_seq_padding, 10) || 3);
  const prefix = s.invoice_prefix || 'AG';
  const format = s.invoice_number_format || '{prefix}/{fy}/{seq}';

  // Skip over any number already taken (numbers can also be typed by hand).
  let candidate = render(format, { prefix, dateStr: date, seq, padding });
  for (let guard = 0; guard < 10000; guard += 1) {
    const taken = await conn.scalar(
      'SELECT COUNT(*) FROM invoices WHERE invoice_number = ?', [candidate]
    );
    if (!Number(taken)) break;
    seq += 1;
    candidate = render(format, { prefix, dateStr: date, seq, padding });
  }
  return { number: candidate, seq };
}

/** Take the next number and move the counter on. Call inside a transaction. */
async function consumeNextNumber(conn, dateStr) {
  const { number, seq } = await peekNextNumber(conn, dateStr);
  await conn.query(
    'UPDATE app_settings SET setting_value = ? WHERE setting_key = ?',
    [String(seq + 1), 'invoice_next_seq']
  );
  return number;
}

module.exports = { peekNextNumber, consumeNextNumber, render };
