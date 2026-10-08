'use strict';

/** Small shared helpers used by the IPC handlers and the PDF template. */

/** Round to 2 decimals without the usual floating-point surprises. */
function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** `YYYY-MM-DD` for today in local time. */
function today() {
  const d = new Date();
  return toDateString(d);
}

function toDateString(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Normalise whatever the UI sent into `YYYY-MM-DD`, or null. */
function dateOrNull(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return toDateString(value);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return toDateString(d);
}

/** Advance a date by a recurring-expense frequency. */
function advance(dateStr, frequency) {
  const d = new Date(`${dateStr}T00:00:00`);
  switch (frequency) {
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'half_yearly': d.setMonth(d.getMonth() + 6); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
    case 'monthly':
    default: d.setMonth(d.getMonth() + 1); break;
  }
  return toDateString(d);
}

/** Indian financial year label for a date: 2026-04-02 -> "2026-27". */
function financialYear(dateStr) {
  const d = new Date(`${(dateStr || today())}T00:00:00`);
  const year = d.getFullYear();
  const startYear = d.getMonth() + 1 >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** First and last day of the month containing `dateStr`. */
function monthRange(dateStr) {
  const d = new Date(`${(dateStr || today())}T00:00:00`);
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: toDateString(from), to: toDateString(to) };
}

/** Indian-system amount in words, for the invoice PDF. */
function amountInWords(amount, currencyWord = 'Rupees', fractionWord = 'Paise') {
  const value = money(Math.abs(num(amount)));
  const whole = Math.floor(value);
  const fraction = Math.round((value - whole) * 100);

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
    'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy',
    'Eighty', 'Ninety'];

  const twoDigits = (n) => {
    if (n < 20) return ones[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return tens[t] + (o ? ` ${ones[o]}` : '');
  };

  const indian = (n) => {
    if (n === 0) return 'Zero';
    const parts = [];
    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const hundred = Math.floor((n % 1000) / 100);
    const rest = n % 100;
    if (crore) parts.push(`${indian(crore)} Crore`);
    if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
    if (hundred) parts.push(`${ones[hundred]} Hundred`);
    if (rest) parts.push(`${parts.length ? 'and ' : ''}${twoDigits(rest)}`);
    return parts.join(' ');
  };

  let words = `${currencyWord} ${indian(whole)}`;
  if (fraction > 0) words += ` and ${twoDigits(fraction)} ${fractionWord}`;
  return `${words} Only`;
}

/** Group digits Indian style: 1234567.5 -> "12,34,567.50". */
function formatIndian(amount, decimals = 2) {
  const n = num(amount);
  const negative = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [whole, frac] = fixed.split('.');
  let out;
  if (whole.length <= 3) {
    out = whole;
  } else {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3);
    out = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
  }
  return `${negative ? '-' : ''}${out}${frac ? `.${frac}` : ''}`;
}

/** Write a line to the activity feed. Failures here never break the caller. */
async function logActivity(db, entity, entityId, action, summary) {
  try {
    await db.query(
      'INSERT INTO activity_log (entity, entity_id, action, summary) VALUES (?, ?, ?, ?)',
      [entity, entityId || null, action, String(summary).slice(0, 400)]
    );
  } catch {
    /* the log is a convenience, never a blocker */
  }
}

/** All rows of app_settings as a plain object. */
async function readSettings(db) {
  const rows = await db.query('SELECT setting_key, setting_value FROM app_settings');
  const out = {};
  for (const row of rows) out[row.setting_key] = row.setting_value;
  return out;
}

/** Trim a string, returning null for blanks so MySQL stores NULL not ''. */
function str(value, maxLength) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLength ? s.slice(0, maxLength) : s;
}

/** Guard an enum value coming from the renderer. */
function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

module.exports = {
  money, num, today, toDateString, dateOrNull, addDays, advance,
  financialYear, monthRange, amountInWords, formatIndian,
  logActivity, readSettings, str, pick
};
