'use strict';

const { money, num, pick } = require('./util');

const GST_MODES = ['none', 'gst', 'cgst_sgst', 'igst'];
const DISCOUNT_TYPES = ['none', 'percent', 'amount'];

/** Built-in optional columns on the line-item table. */
const OPTIONAL_COLUMNS = ['quantity', 'hsn', 'unit'];

/** What an invoice shows in its line-item table when nothing is configured. */
const DEFAULT_COLUMNS = { quantity: true, hsn: false, unit: false, custom: [] };

/**
 * Normalise a column configuration coming from the form or the database.
 *
 * Only description, rate and amount are fixed. Quantity is on by default but
 * can be switched off for a flat-price bill, and HSN/SAC and Unit are off
 * unless asked for, so an invoice never prints an empty column. Anything else
 * the job needs is added as a named custom column.
 */
function normaliseColumns(input) {
  let raw = input;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (!raw || typeof raw !== 'object') raw = {};

  const customSource = Array.isArray(raw.custom) ? raw.custom : [];
  const custom = [];
  customSource.forEach((entry, index) => {
    const label = String((entry && entry.label) || '').trim().slice(0, 40);
    if (!label) return;
    const id = String((entry && entry.id) || `c${index + 1}`)
      .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || `c${index + 1}`;
    if (custom.some((c) => c.id === id)) return;
    custom.push({ id, label });
  });

  return {
    quantity: raw.quantity === undefined ? true : Boolean(raw.quantity),
    hsn: Boolean(raw.hsn),
    unit: Boolean(raw.unit),
    custom: custom.slice(0, 4)
  };
}

/** Keep only the custom values that belong to a configured column. */
function pickCustomFields(value, columns) {
  let raw = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const column of columns.custom) {
    const text = raw[column.id];
    if (text === undefined || text === null) continue;
    const trimmed = String(text).trim();
    if (trimmed) out[column.id] = trimmed.slice(0, 200);
  }
  return out;
}

/**
 * Work out every money figure on an invoice from its line items and tax
 * settings. The renderer runs the same arithmetic live while you type, and this
 * copy in the main process is what actually gets stored — the UI is never
 * trusted for totals.
 *
 * Order of operations (standard Indian GST invoice):
 *   subtotal  = SUM(qty x rate)        -- qty is 1 when the column is off
 *   discount  = percent of subtotal, or a flat amount
 *   taxable   = subtotal - discount
 *   GST       = taxable x rate, as one combined line, or split 50/50 into
 *               CGST+SGST for an in-state sale, or charged whole as IGST
 *   total     = taxable + GST + shipping, optionally rounded
 */
function computeInvoice(input) {
  const columns = normaliseColumns(input.columns);

  const items = (input.items || [])
    .map((item, index) => {
      // With the quantity column switched off every line is a single unit.
      const quantity = columns.quantity ? num(item.quantity, 0) : 1;
      const rate = money(item.rate);
      return {
        position: index + 1,
        description: String(item.description || '').trim().slice(0, 500),
        hsn_sac: columns.hsn && item.hsn_sac
          ? String(item.hsn_sac).trim().slice(0, 20) : null,
        quantity: Math.round(quantity * 1000) / 1000,
        unit: columns.unit && item.unit ? String(item.unit).trim().slice(0, 30) : null,
        rate,
        amount: money(quantity * rate),
        custom_fields: pickCustomFields(item.custom_fields, columns)
      };
    })
    .filter((item) => item.description.length > 0);

  const subtotal = money(items.reduce((sum, item) => sum + item.amount, 0));

  const discountType = pick(input.discount_type, DISCOUNT_TYPES, 'none');
  const discountValue = money(input.discount_value);
  let discountAmount = 0;
  if (discountType === 'percent') discountAmount = money(subtotal * (discountValue / 100));
  else if (discountType === 'amount') discountAmount = money(discountValue);
  if (discountAmount > subtotal) discountAmount = subtotal;
  if (discountAmount < 0) discountAmount = 0;

  const taxableAmount = money(subtotal - discountAmount);

  const gstMode = pick(input.gst_mode, GST_MODES, 'none');
  const gstRate = gstMode === 'none' ? 0 : Math.max(0, num(input.gst_rate, 0));

  let gst = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (gstMode === 'gst') {
    gst = money((taxableAmount * gstRate) / 100);
  } else if (gstMode === 'cgst_sgst') {
    const half = money((taxableAmount * gstRate) / 200);
    cgst = half;
    sgst = half;
  } else if (gstMode === 'igst') {
    igst = money((taxableAmount * gstRate) / 100);
  }

  const shipping = money(input.shipping_amount);
  const beforeRounding = money(taxableAmount + gst + cgst + sgst + igst + shipping);

  const wantRounding = input.round_off_enabled === undefined
    ? true
    : Boolean(input.round_off_enabled);
  const rounded = wantRounding ? Math.round(beforeRounding) : beforeRounding;
  const roundOff = money(rounded - beforeRounding);
  const total = money(rounded);

  return {
    items,
    columns,
    subtotal,
    discount_type: discountType,
    discount_value: discountValue,
    discount_amount: discountAmount,
    taxable_amount: taxableAmount,
    gst_mode: gstMode,
    gst_rate: gstRate,
    gst_amount: gst,
    cgst_amount: cgst,
    sgst_amount: sgst,
    igst_amount: igst,
    shipping_amount: shipping,
    round_off: roundOff,
    total
  };
}

/** Payment state derived from what has actually been received. */
function paymentStatus(total, amountPaid, currentStatus) {
  if (currentStatus === 'cancelled') return 'cancelled';
  const paid = money(amountPaid);
  const due = money(total);
  if (paid <= 0) return currentStatus === 'draft' ? 'draft' : 'sent';
  if (paid + 0.009 >= due) return 'paid';
  return 'partially_paid';
}

module.exports = {
  computeInvoice, paymentStatus, normaliseColumns, pickCustomFields,
  GST_MODES, DISCOUNT_TYPES, OPTIONAL_COLUMNS, DEFAULT_COLUMNS
};
