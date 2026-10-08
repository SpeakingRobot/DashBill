'use strict';

const { amountInWords, formatIndian, money } = require('./util');
const { normaliseColumns } = require('./invoiceMath');

/** HTML-escape everything that comes out of the database. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape and turn newlines into <br>, for addresses, notes and terms. */
function multiline(value) {
  return esc(value).replace(/\r?\n/g, '<br>');
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return esc(value);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function qty(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
}

/** Join the non-empty parts of an address into lines. */
function addressLines(parts) {
  return parts.filter((p) => p && String(p).trim()).map((p) => String(p).trim());
}

/**
 * Render a complete, self-contained A4 invoice document.
 *
 * The design is deliberately monochrome: hairline rules, generous whitespace,
 * uppercase letterspaced labels and one heavy rule under the grand total. It
 * photocopies and faxes cleanly, and costs nothing in colour ink to print.
 *
 * @param {object}  data.invoice   row from `invoices`
 * @param {Array}   data.items     rows from `invoice_items`
 * @param {Array}   data.payments  rows from `invoice_payments`
 * @param {object}  data.settings  app_settings as a flat object
 * @param {boolean} data.screen    true when shown in the on-screen preview
 */
function renderInvoiceHtml(data) {
  const inv = data.invoice || {};
  const items = data.items || [];
  const payments = data.payments || [];
  const s = data.settings || {};
  const cur = inv.currency_symbol || s.currency_symbol || '₹';

  const amt = (value) => `${esc(cur)}&nbsp;${formatIndian(value)}`;

  const fromAddress = inv.bill_from_address
    ? String(inv.bill_from_address).split(/\r?\n/)
    : addressLines([
      s.company_address_line1, s.company_address_line2,
      addressLines([s.company_city, s.company_state, s.company_pincode]).join(', '),
      s.company_country
    ]);

  const toAddress = inv.bill_to_address ? String(inv.bill_to_address).split(/\r?\n/) : [];

  const contactBits = addressLines([
    s.company_phone ? `Phone ${s.company_phone}` : '',
    s.company_email || '',
    s.company_website || ''
  ]);

  const balance = money(money(inv.total) - money(inv.amount_paid));
  const isPaid = balance <= 0.009 && money(inv.total) > 0;

  const taxRows = [];
  if (money(inv.discount_amount) > 0) {
    const label = inv.discount_type === 'percent'
      ? `Discount (${formatIndian(inv.discount_value, 2).replace(/\.00$/, '')}%)`
      : 'Discount';
    taxRows.push({ label, value: `- ${amt(inv.discount_amount)}` });
    taxRows.push({ label: 'Taxable Value', value: amt(inv.taxable_amount) });
  }
  // A plain combined GST line — the usual case for commercial work.
  if (money(inv.gst_amount) > 0) {
    taxRows.push({
      label: `GST @ ${formatIndian(inv.gst_rate, 2).replace(/\.00$/, '')}%`,
      value: amt(inv.gst_amount)
    });
  }
  if (money(inv.cgst_amount) > 0 || money(inv.sgst_amount) > 0) {
    const half = (Number(inv.gst_rate) || 0) / 2;
    taxRows.push({ label: `CGST @ ${formatIndian(half, 2).replace(/\.00$/, '')}%`, value: amt(inv.cgst_amount) });
    taxRows.push({ label: `SGST @ ${formatIndian(half, 2).replace(/\.00$/, '')}%`, value: amt(inv.sgst_amount) });
  }
  if (money(inv.igst_amount) > 0) {
    taxRows.push({
      label: `IGST @ ${formatIndian(inv.gst_rate, 2).replace(/\.00$/, '')}%`,
      value: amt(inv.igst_amount)
    });
  }
  if (money(inv.shipping_amount) > 0) {
    taxRows.push({ label: 'Delivery / Shipping', value: amt(inv.shipping_amount) });
  }
  if (money(inv.round_off) !== 0) {
    const r = money(inv.round_off);
    taxRows.push({
      label: 'Round Off',
      value: `${r < 0 ? '- ' : '+ '}${esc(cur)}&nbsp;${formatIndian(Math.abs(r))}`
    });
  }

  // Payment details. An invoice may carry its own free-text block, which wins
  // over the company defaults; otherwise the structured fields from Settings
  // are printed as label/value pairs.
  //
  // Kept as pairs on purpose: running them through a line-flattening helper
  // turns each pair into one string and prints a single letter per cell.
  const bankOverride = String(inv.bank_details || '').trim();
  const bankRows = bankOverride ? [] : [
    ['Account Name', s.bank_account_name],
    ['Bank', s.bank_name],
    ['Account No.', s.bank_account_number],
    ['IFSC', s.bank_ifsc],
    ['Branch', s.bank_branch],
    ['UPI', s.bank_upi]
  ].filter((pair) => pair[1] && String(pair[1]).trim())
    .map((pair) => [pair[0], String(pair[1]).trim()]);

  const hasBank = Boolean(bankOverride) || bankRows.length > 0;

  // The stored signature, if the user uploaded one. A data URL, so it needs no
  // network access and survives being e-mailed as a standalone PDF.
  const signatureImage = String(s.invoice_signature_image || '').trim();

  // Which line-item columns this invoice prints.
  const columns = normaliseColumns(inv.column_config);
  const customColumns = columns.custom;
  const columnCount = 4 + customColumns.length +      // #, description, rate, amount
    (columns.hsn ? 1 : 0) + (columns.quantity ? 1 : 0) + (columns.unit ? 1 : 0);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Invoice ${esc(inv.invoice_number)}</title>
<style>
  @page { size: A4; margin: 0; }

  :root {
    --ink: #000;
    --soft: #4a4a4a;
    --faint: #8a8a8a;
    --rule: #000;
    --hair: #c9c9c9;
    --wash: #f3f3f3;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: var(--ink);
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .sheet {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 14mm 14mm 12mm;
    display: flex;
    flex-direction: column;
  }
  ${data.screen ? `
  body { background: #d8d8d8; padding: 18px 0; }
  .sheet { background: #fff; box-shadow: 0 2px 18px rgba(0,0,0,.35); }
  ` : ''}

  .label {
    font-size: 7pt;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--faint);
    font-weight: 600;
  }

  /* ---------- masthead ---------- */
  .masthead { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; }
  .brand { display: flex; gap: 6mm; align-items: flex-start; }
  .logo { width: 24mm; height: 24mm; object-fit: contain; flex: 0 0 auto; }
  .logo-fallback {
    width: 24mm; height: 24mm; flex: 0 0 auto;
    border: 1.5pt solid var(--ink);
    display: flex; align-items: center; justify-content: center;
    font-size: 15pt; font-weight: 700; letter-spacing: .04em;
  }
  .company-name {
    font-size: 19pt; font-weight: 700; line-height: 1.15; letter-spacing: -.01em;
    margin: 0 0 1mm;
  }
  .company-tagline {
    font-size: 8pt; letter-spacing: .1em; text-transform: uppercase;
    color: var(--soft); margin: 0 0 2.5mm;
  }
  .company-meta { font-size: 8.5pt; color: var(--soft); line-height: 1.55; }
  .company-meta strong { color: var(--ink); font-weight: 600; }

  .doc-title {
    text-align: right;
    flex: 0 0 auto;
  }
  .doc-title h1 {
    margin: 0 0 3mm;
    font-size: 26pt;
    letter-spacing: .22em;
    font-weight: 300;
    text-transform: uppercase;
  }
  .doc-meta { font-size: 9pt; }
  .doc-meta table { border-collapse: collapse; margin-left: auto; }
  .doc-meta td { padding: .7mm 0 .7mm 5mm; vertical-align: top; }
  .doc-meta td:first-child {
    padding-left: 0; text-align: right;
    font-size: 7pt; letter-spacing: .12em; text-transform: uppercase;
    color: var(--faint); font-weight: 600;
  }
  .doc-meta td:last-child { text-align: right; font-weight: 600; }

  /* ---------- parties ---------- */
  .parties { display: flex; gap: 8mm; margin-top: 8mm; }
  .party { flex: 1 1 0; }
  .party-name { font-size: 11.5pt; font-weight: 700; margin: 2mm 0 1mm; }
  .party-body { font-size: 9pt; color: var(--soft); line-height: 1.55; }
  .party-body .gst { color: var(--ink); font-weight: 600; margin-top: 1.5mm; display: block; }

  /* ---------- items ---------- */
  table.items { width: 100%; border-collapse: collapse; margin-top: 7mm; }
  table.items thead th {
    font-size: 7pt; letter-spacing: .12em; text-transform: uppercase;
    font-weight: 700; text-align: left;
    padding: 2.5mm 2mm;
    border-top: 1.2pt solid var(--ink);
    border-bottom: 1.2pt solid var(--ink);
    background: var(--wash);
  }
  table.items tbody td {
    padding: 2.6mm 2mm;
    border-bottom: .6pt solid var(--hair);
    vertical-align: top;
    font-size: 9.5pt;
  }
  table.items .c-num   { width: 9mm; text-align: center; color: var(--faint); }
  table.items .c-hsn   { width: 22mm; white-space: nowrap; }
  table.items .c-custom{ width: 24mm; }
  table.items .c-qty   { width: 16mm; text-align: right; white-space: nowrap; }
  table.items .c-unit  { width: 16mm; }
  table.items .c-rate  { width: 26mm; text-align: right; white-space: nowrap; }
  table.items .c-amt   { width: 30mm; text-align: right; white-space: nowrap; font-weight: 600; }
  table.items thead .c-qty, table.items thead .c-rate, table.items thead .c-amt { text-align: right; }
  .item-desc { font-weight: 500; }
  .item-hsn { font-size: 7.5pt; color: var(--faint); letter-spacing: .06em; margin-top: .6mm; }

  /* ---------- totals ---------- */
  .totals-wrap { display: flex; justify-content: space-between; gap: 8mm; margin-top: 6mm; }
  .totals-left { flex: 1 1 0; }
  .totals { flex: 0 0 78mm; }
  .totals table { width: 100%; border-collapse: collapse; }
  .totals td { padding: 1.5mm 0; font-size: 9.5pt; }
  .totals td:last-child { text-align: right; white-space: nowrap; }
  .totals tr.sub td { border-top: .6pt solid var(--hair); }
  .totals tr.grand td {
    border-top: 1.5pt solid var(--ink);
    border-bottom: 1.5pt solid var(--ink);
    padding: 2.6mm 0;
    font-size: 12pt;
    font-weight: 700;
    letter-spacing: .02em;
  }
  .totals tr.paid td { color: var(--soft); }
  .totals tr.due td { font-weight: 700; padding-top: 2mm; }

  .words {
    margin-top: 4mm;
    padding: 3mm 4mm;
    border: .6pt solid var(--hair);
    background: var(--wash);
    font-size: 9pt;
  }
  .words .label { display: block; margin-bottom: 1mm; }
  .words b { font-weight: 700; }

  .stamp {
    display: inline-block;
    margin-top: 5mm;
    border: 1.5pt solid var(--ink);
    padding: 1.6mm 4mm;
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: .18em;
    text-transform: uppercase;
  }

  /* ---------- notes ---------- */
  .note-block {
    margin-top: 7mm;
    padding: 3mm 4mm;
    border-left: 2pt solid var(--ink);
    font-size: 9pt;
    line-height: 1.6;
    color: var(--soft);
  }
  .note-block .label { display: block; margin-bottom: 1.5mm; }

  /* ---------- footer blocks ---------- */
  .blocks { display: flex; gap: 8mm; margin-top: 7mm; }
  .block { flex: 1 1 0; font-size: 8.5pt; color: var(--soft); line-height: 1.6; }
  .block .label { display: block; margin-bottom: 1.8mm; }
  .block ol, .block ul { margin: 0; padding-left: 4.2mm; }
  .bank table { border-collapse: collapse; font-size: 8.5pt; }
  .bank td { padding: .5mm 0; }
  .bank td:first-child { color: var(--faint); padding-right: 4mm; white-space: nowrap; }
  .bank td:last-child { color: var(--ink); font-weight: 600; }

  .payments table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  .payments th {
    text-align: left; font-size: 7pt; letter-spacing: .1em; text-transform: uppercase;
    color: var(--faint); border-bottom: .6pt solid var(--hair); padding: 1mm 2mm 1mm 0;
  }
  .payments td { padding: 1mm 2mm 1mm 0; border-bottom: .6pt solid var(--hair); }
  .payments td:last-child, .payments th:last-child { text-align: right; }

  .sign {
    margin-top: auto;
    padding-top: 10mm;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 10mm;
  }
  .sign-note { font-size: 8pt; color: var(--faint); max-width: 95mm; }
  .sign-box { text-align: center; min-width: 52mm; }
  /*
   * The signature sits ON the rule, the way a pen would. The space is kept
   * at a fixed height whether or not an image is stored, so an invoice signed
   * by hand after printing has exactly as much room as a signed one.
   */
  .sign-space {
    height: 16mm;
    border-bottom: .8pt solid var(--ink);
    margin-bottom: 1.5mm;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    overflow: hidden;
  }
  .sign-img { max-height: 15mm; max-width: 50mm; object-fit: contain; display: block; }
  .sign-for { font-size: 9pt; font-weight: 600; }
  .sign-cap { font-size: 7pt; letter-spacing: .12em; text-transform: uppercase; color: var(--faint); }

  .colophon {
    margin-top: 6mm;
    border-top: .6pt solid var(--hair);
    padding-top: 2.5mm;
    font-size: 7pt;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--faint);
    display: flex;
    justify-content: space-between;
  }

  tr, .block, .words, .sign, .note-block { page-break-inside: avoid; }
  thead { display: table-header-group; }
</style>
</head>
<body>
<div class="sheet">

  <header class="masthead">
    <div class="brand">
      ${s.company_logo
    ? `<img class="logo" src="${esc(s.company_logo)}" alt="">`
    : `<div class="logo-fallback">${esc(initials(inv.bill_from_name || s.company_name || 'AG'))}</div>`}
      <div>
        <p class="company-name">${esc(inv.bill_from_name || s.company_name || 'Your business')}</p>
        ${s.company_tagline ? `<p class="company-tagline">${esc(s.company_tagline)}</p>` : ''}
        <div class="company-meta">
          ${fromAddress.map((line) => esc(line)).join('<br>')}
          ${contactBits.length ? `<br>${contactBits.map((b) => esc(b)).join(' &nbsp;·&nbsp; ')}` : ''}
          ${inv.bill_from_gstin || s.company_gstin
    ? `<br><strong>GSTIN ${esc(inv.bill_from_gstin || s.company_gstin)}</strong>` : ''}
          ${s.company_pan ? `&nbsp; <strong>PAN ${esc(s.company_pan)}</strong>` : ''}
        </div>
      </div>
    </div>

    <div class="doc-title">
      <h1>${inv.status === 'cancelled' ? 'Cancelled' : 'Invoice'}</h1>
      <div class="doc-meta">
        <table>
          <tr><td>Invoice No.</td><td>${esc(inv.invoice_number)}</td></tr>
          <tr><td>Invoice Date</td><td>${formatDate(inv.invoice_date)}</td></tr>
          ${inv.due_date ? `<tr><td>Due Date</td><td>${formatDate(inv.due_date)}</td></tr>` : ''}
          ${inv.place_of_supply ? `<tr><td>Place of Supply</td><td>${esc(inv.place_of_supply)}</td></tr>` : ''}
        </table>
      </div>
    </div>
  </header>

  <section class="parties">
    <div class="party">
      <span class="label">Billed To</span>
      <p class="party-name">${esc(inv.bill_to_name || 'Customer')}</p>
      <div class="party-body">
        ${toAddress.length ? toAddress.map((line) => esc(line)).join('<br>') : '<em>—</em>'}
        ${inv.bill_to_gstin ? `<span class="gst">GSTIN ${esc(inv.bill_to_gstin)}</span>` : ''}
      </div>
    </div>
    ${data.projectTitle ? `
    <div class="party">
      <span class="label">Project / Work Order</span>
      <p class="party-name" style="font-size:10pt">${esc(data.projectTitle)}</p>
    </div>` : '<div class="party"></div>'}
  </section>

  <table class="items">
    <thead>
      <tr>
        <th class="c-num">#</th>
        <th>Item / Service</th>
        ${columns.hsn ? '<th class="c-hsn">HSN/SAC</th>' : ''}
        ${customColumns.map((c) => `<th class="c-custom">${esc(c.label)}</th>`).join('')}
        ${columns.quantity ? '<th class="c-qty">Qty</th>' : ''}
        ${columns.unit ? '<th class="c-unit">Unit</th>' : ''}
        <th class="c-rate">Rate</th>
        <th class="c-amt">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${items.length ? items.map((item, index) => `
      <tr>
        <td class="c-num">${index + 1}</td>
        <td><div class="item-desc">${multiline(item.description)}</div></td>
        ${columns.hsn ? `<td class="c-hsn">${esc(item.hsn_sac || '')}</td>` : ''}
        ${customColumns.map((c) => `<td class="c-custom">${
  esc((item.custom_fields || {})[c.id] || '')}</td>`).join('')}
        ${columns.quantity ? `<td class="c-qty">${qty(item.quantity)}</td>` : ''}
        ${columns.unit ? `<td class="c-unit">${esc(item.unit || '')}</td>` : ''}
        <td class="c-rate">${formatIndian(item.rate)}</td>
        <td class="c-amt">${formatIndian(item.amount)}</td>
      </tr>`).join('') : `
      <tr><td class="c-num"></td><td colspan="${columnCount - 1}"><em>No line items.</em></td></tr>`}
    </tbody>
  </table>

  <section class="totals-wrap">
    <div class="totals-left">
      <div class="words">
        <span class="label">Amount in words</span>
        <b>${esc(amountInWords(inv.total, currencyWord(cur), fractionWord(cur)))}</b>
      </div>
      ${isPaid && inv.status !== 'cancelled' ? '<div class="stamp">Paid in full</div>' : ''}
      ${inv.status === 'cancelled' ? '<div class="stamp">Cancelled</div>' : ''}
    </div>

    <div class="totals">
      <table>
        <tr class="sub"><td>Subtotal</td><td>${amt(inv.subtotal)}</td></tr>
        ${taxRows.map((row) => `<tr><td>${row.label}</td><td>${row.value}</td></tr>`).join('')}
        <tr class="grand"><td>Total</td><td>${amt(inv.total)}</td></tr>
        ${money(inv.amount_paid) > 0
    ? `<tr class="paid"><td>Amount Received</td><td>- ${amt(inv.amount_paid)}</td></tr>
           <tr class="due"><td>Balance Due</td><td>${amt(balance)}</td></tr>` : ''}
      </table>
    </div>
  </section>

  ${inv.notes ? `
  <section class="note-block">
    <span class="label">Notes</span>
    <div>${multiline(inv.notes)}</div>
  </section>` : ''}

  <section class="blocks">
    ${hasBank ? `
    <div class="block bank">
      <span class="label">Payment Details</span>
      ${bankOverride
    ? `<div>${multiline(bankOverride)}</div>`
    : `<table>
        ${bankRows.map((pair) => `<tr><td>${esc(pair[0])}</td><td>${esc(pair[1])}</td></tr>`).join('')}
      </table>`}
    </div>` : ''}

    ${inv.terms ? `
    <div class="block">
      <span class="label">Terms &amp; Conditions</span>
      <div>${multiline(inv.terms)}</div>
    </div>` : ''}

    ${payments.length ? `
    <div class="block payments">
      <span class="label">Payments Received</span>
      <table>
        <thead><tr><th>Date</th><th>Mode</th><th>Amount</th></tr></thead>
        <tbody>
          ${payments.map((p) => `<tr>
            <td>${formatDate(p.paid_on)}</td>
            <td>${esc(methodLabel(p.method))}</td>
            <td>${formatIndian(p.amount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
  </section>

  <section class="sign">
    <div class="sign-note">
      ${s.invoice_footer_note ? multiline(s.invoice_footer_note) : ''}
      ${money(inv.gst_rate) === 0 && inv.gst_mode === 'none'
    ? '<br>This is not a GST invoice. No tax has been charged on this bill.' : ''}
    </div>
    <div class="sign-box">
      <div class="sign-space">${signatureImage
    ? `<img class="sign-img" src="${esc(signatureImage)}" alt="Signature">` : ''}</div>
      <div class="sign-for">${esc(s.invoice_signature_label || `For ${s.company_name || ''}`)}</div>
      <div class="sign-cap">Authorised Signatory</div>
    </div>
  </section>

  <div class="colophon">
    <span>${esc(inv.invoice_number)} &nbsp;·&nbsp; ${formatDate(inv.invoice_date)}</span>
    <span>${esc(s.company_name || '')}</span>
  </div>
</div>
</body>
</html>`;
}

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('') || 'AG';
}

function currencyWord(symbol) {
  if (symbol === '₹' || symbol === 'Rs' || symbol === 'Rs.' || symbol === 'INR') return 'Rupees';
  if (symbol === '$') return 'Dollars';
  if (symbol === '€') return 'Euros';
  if (symbol === '£') return 'Pounds';
  return symbol ? `${symbol}` : '';
}

function fractionWord(symbol) {
  if (symbol === '₹' || symbol === 'Rs' || symbol === 'Rs.' || symbol === 'INR') return 'Paise';
  if (symbol === '£') return 'Pence';
  return 'Cents';
}

function methodLabel(method) {
  const labels = {
    cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank Transfer',
    cheque: 'Cheque', card: 'Card', other: 'Other'
  };
  return labels[method] || method || '';
}

module.exports = { renderInvoiceHtml, esc, formatDate, methodLabel };
