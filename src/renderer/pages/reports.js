/**
 * Reports: the figures you hand to the accountant — profit and loss for any
 * period, GST charged, income by client, spending by category.
 */
(function () {
  'use strict';

  window.Pages = window.Pages || {};

  const {
    api, apiSafe, esc, icon, fmt, card, stat, table, toast, bindActions,
    enumOptions, barList, num, today, monthStart, monthEnd, fyStart
  } = window.UI;

  const PRESETS = [
    ['fy', 'This financial year'],
    ['lastFy', 'Last financial year'],
    ['month', 'This month'],
    ['lastMonth', 'Last month'],
    ['quarter', 'Last 3 months'],
    ['year', 'This calendar year'],
    ['custom', 'Custom dates']
  ];

  const state = { preset: 'fy', from: fyStart(), to: today() };

  window.Pages.reports = {
    title: 'Reports',
    crumb: 'Books',

    async render(ctx) {
      ctx.actions.innerHTML =
        '<button class="btn secondary" data-action="csv">' + icon('download', 15) +
        'Export CSV for accountant</button>' +
        '<button class="btn secondary" data-action="print">' + icon('print', 15) + 'Print</button>';
      bindActions(ctx.actions, {
        csv: async () => {
          const result = await apiSafe('backup:exportCsv', { from: state.from, to: state.to });
          if (result && !result.canceled) {
            toast('CSV files written', 'success', result.files.join(', '));
          }
        },
        print: () => window.print()
      });

      ctx.el.innerHTML = filters() + '<div id="rep-body">' + window.UI.loading(7) + '</div>';
      wireFilters(ctx);
      await load(ctx);
    }
  };

  function filters() {
    return '<div class="filters">' +
      '<div class="field"><label>Period</label><select id="r-preset">' +
        enumOptions(PRESETS, state.preset) + '</select></div>' +
      '<div class="field"><label>From</label>' +
        '<input type="date" id="r-from" value="' + esc(state.from) + '"></div>' +
      '<div class="field"><label>To</label>' +
        '<input type="date" id="r-to" value="' + esc(state.to) + '"></div>' +
      '<span class="spacer"></span>' +
      '<div class="field"><label>&nbsp;</label>' +
        '<button class="btn secondary" id="r-apply">' + icon('refresh', 14) + 'Refresh</button></div>' +
      '</div>';
  }

  function applyPreset(preset) {
    const now = new Date();
    const year = now.getFullYear();
    const fyYear = now.getMonth() + 1 >= 4 ? year : year - 1;

    if (preset === 'fy') { state.from = fyYear + '-04-01'; state.to = today(); }
    else if (preset === 'lastFy') {
      state.from = (fyYear - 1) + '-04-01';
      state.to = fyYear + '-03-31';
    } else if (preset === 'month') { state.from = monthStart(0); state.to = monthEnd(0); }
    else if (preset === 'lastMonth') { state.from = monthStart(-1); state.to = monthEnd(-1); }
    else if (preset === 'quarter') { state.from = monthStart(-2); state.to = monthEnd(0); }
    else if (preset === 'year') { state.from = year + '-01-01'; state.to = today(); }
  }

  function wireFilters(ctx) {
    document.getElementById('r-preset').addEventListener('change', (event) => {
      state.preset = event.target.value;
      if (state.preset !== 'custom') {
        applyPreset(state.preset);
        document.getElementById('r-from').value = state.from;
        document.getElementById('r-to').value = state.to;
      }
      load(ctx);
    });
    ['from', 'to'].forEach((key) => {
      document.getElementById('r-' + key).addEventListener('change', (event) => {
        state[key] = event.target.value;
        state.preset = 'custom';
        document.getElementById('r-preset').value = 'custom';
        load(ctx);
      });
    });
    document.getElementById('r-apply').addEventListener('click', () => load(ctx));
  }

  async function load(ctx) {
    const host = document.getElementById('rep-body');
    host.innerHTML = window.UI.loading(7);

    const data = await api('dashboard:report', { from: state.from, to: state.to });
    const gst = data.gst || {};
    const margin = data.income ? (data.net / data.income) * 100 : 0;

    host.innerHTML =
      '<div class="banner">' + icon('info', 17) +
      '<div><strong>' + esc(fmt.date(data.from)) + ' to ' + esc(fmt.date(data.to)) +
      '.</strong> Income and expenses are counted on the date the money actually moved. ' +
      'GST below is what you charged on invoices dated in this period.</div></div>' +

      '<div class="grid c4 mb14">' +
        stat({ label: 'Income', value: fmt.moneyShort(data.income), accent: true,
          sub: '<span class="faint">money received</span>' }) +
        stat({ label: 'Expenses', value: fmt.moneyShort(data.expense),
          sub: '<span class="faint">money spent</span>' }) +
        stat({ label: 'Net', value: '<span class="' + (data.net >= 0 ? 'pos' : 'neg') + '">' +
          fmt.moneyShort(data.net) + '</span>',
          sub: '<span class="faint">' + fmt.percent(margin, 1) + ' of income</span>' }) +
        stat({ label: 'GST charged', value: fmt.moneyShort(
          num(gst.gst) + num(gst.cgst) + num(gst.sgst) + num(gst.igst)), small: true,
          sub: '<span class="faint">on ' + num(gst.invoice_count) + ' invoice' +
            (num(gst.invoice_count) === 1 ? '' : 's') + '</span>' }) +
      '</div>' +

      card({
        title: 'Month by month',
        className: 'mb14',
        body: window.UI.barChart(data.monthly, { pixelHeight: 230, limit: 36 }) +
          (data.monthly.length
            ? table([
              { label: 'Month', render: (row) => fmt.monthLong(row.month) },
              { label: 'Income', className: 'num', render: (row) => fmt.money(row.income) },
              { label: 'Expenses', className: 'num', render: (row) => fmt.money(row.expense) },
              { label: 'Net', className: 'num', render: (row) =>
                '<span class="' + (num(row.income) - num(row.expense) >= 0 ? 'pos' : 'neg') +
                ' strong">' + fmt.money(num(row.income) - num(row.expense)) + '</span>' }
            ], {
              rows: data.monthly,
              compact: true,
              footer: '<tr><td>Total</td><td class="num">' + fmt.money(data.income) +
                '</td><td class="num">' + fmt.money(data.expense) +
                '</td><td class="num">' + fmt.money(data.net) + '</td></tr>'
            })
            : '')
      }) +

      '<div class="grid c2 mb14">' +
        card({ title: 'Income by client', flush: true, body: table([
          { label: 'Client', key: 'client_name' },
          { label: 'Entries', className: 'num', key: 'entries' },
          { label: 'Received', className: 'num', render: (row) =>
            '<span class="strong">' + fmt.money(row.total) + '</span>' },
          { label: 'Share', className: 'num', render: (row) =>
            data.income ? fmt.percent((num(row.total) / data.income) * 100, 1) : '—' }
        ], {
          rows: data.incomeByClient, compact: true,
          empty: { icon: 'clients', title: 'No income in this period', message: '' }
        }) }) +
        card({ title: 'Income by category', body:
          barList((data.incomeByCategory || []).map((row) => ({
            label: row.category, value: row.total
          })), { empty: 'No income in this period.', limit: 12 }) }) +
      '</div>' +

      '<div class="grid c2 mb14">' +
        card({ title: 'Expenses by category', flush: true, body: table([
          { label: 'Category', render: (row) =>
            esc(row.category_name) +
            '<div class="row-sub">' + esc(fmt.label(row.kind)) + '</div>' },
          { label: 'Entries', className: 'num', key: 'entries' },
          { label: 'Spent', className: 'num', render: (row) =>
            '<span class="strong">' + fmt.money(row.total) + '</span>' },
          { label: 'Share', className: 'num', render: (row) =>
            data.expense ? fmt.percent((num(row.total) / data.expense) * 100, 1) : '—' }
        ], {
          rows: data.expenseByCategory, compact: true,
          empty: { icon: 'expense', title: 'No expenses in this period', message: '' }
        }) }) +
        card({ title: 'Spending by type', body:
          barList((data.expenseByKind || []).map((row) => ({
            label: fmt.label(row.kind), value: row.total
          })), { empty: 'No expenses in this period.' }) +
          '<hr class="divider">' +
          '<p class="tiny faint" style="margin:0;line-height:1.6">Types come from each ' +
          'category’s setting under Expenses &rarr; Categories. Keeping personal ' +
          'spending in its own type is what lets you read the business figures cleanly.</p>' }) +
      '</div>' +

      card({
        title: 'GST summary',
        hint: 'invoices dated in this period, cancelled ones excluded',
        body:
          '<div class="grid c2" style="gap:18px">' +
            '<dl class="kv">' +
              '<dt>Invoices raised</dt><dd>' + num(gst.invoice_count) + '</dd>' +
              '<dt>Taxable value</dt><dd>' + fmt.money(gst.taxable) + '</dd>' +
              '<dt>GST</dt><dd>' + fmt.money(gst.gst) + '</dd>' +
              '<dt>CGST</dt><dd>' + fmt.money(gst.cgst) + '</dd>' +
              '<dt>SGST</dt><dd>' + fmt.money(gst.sgst) + '</dd>' +
              '<dt>IGST</dt><dd>' + fmt.money(gst.igst) + '</dd>' +
              '<dt class="strong">Total GST</dt><dd class="strong">' +
                fmt.money(num(gst.gst) + num(gst.cgst) + num(gst.sgst) + num(gst.igst)) +
                '</dd>' +
              '<dt class="strong">Total billed</dt><dd class="strong">' +
                fmt.money(gst.billed) + '</dd>' +
            '</dl>' +
            '<p class="small faint" style="margin:0;line-height:1.7">' +
            'These are the figures your accountant needs at filing time. Use ' +
            '<strong>Export CSV</strong> above to hand over the full invoice list, the ' +
            'income ledger and the expense ledger for the same period as spreadsheet ' +
            'files. The software keeps the record; it does not file anything for you.</p>' +
          '</div>'
      });
  }
})();
