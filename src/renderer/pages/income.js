/** Income: every rupee that came in, however it came in. */
(function () {
  'use strict';

  window.Pages = window.Pages || {};

  const {
    api, apiSafe, esc, icon, fmt, card, stat, table, modal, toast, readForm,
    bindActions, bindRows, debounce, confirm, options, enumOptions, barList,
    PAYMENT_METHODS, methodLabel, num, today, monthStart, monthEnd, fyStart
  } = window.UI;

  const RANGES = [
    ['month', 'This month'],
    ['last', 'Last month'],
    ['fy', 'This FY'],
    ['all', 'All time'],
    ['custom', 'Custom']
  ];

  const state = {
    range: 'month',
    from: monthStart(0),
    to: monthEnd(0),
    search: '',
    clientId: '',
    category: '',
    source: '',
    method: ''
  };

  let clients = [];
  let categories = [];

  window.Pages.income = {
    title: 'Income',
    crumb: 'Money',

    async render(ctx) {
      ctx.actions.innerHTML =
        '<button class="btn secondary" data-action="export">' + icon('download', 15) + 'Export CSV</button>' +
        '<button class="btn" data-action="new">' + icon('plus', 15) + 'Add income</button>';
      bindActions(ctx.actions, {
        new: () => editor(ctx, null),
        export: () => apiSafe('backup:exportCsv', { from: rangeFrom(), to: rangeTo() })
      });

      if (ctx.params.clientId) state.clientId = String(ctx.params.clientId);

      // The dropdown data and the ledger itself are independent, so the whole
      // page costs one round trip rather than two in sequence.
      const [clientList, categoryList, [data, monthly]] = await Promise.all([
        api('clients:options'),
        api('income:categories'),
        fetchIncome()
      ]);
      clients = clientList;
      categories = categoryList;

      ctx.el.innerHTML = filters() + '<div id="income-body">' + window.UI.loading(7) + '</div>';
      wireFilters(ctx);
      renderIncome(ctx, data, monthly);

      if (ctx.params.action === 'new') {
        editor(ctx, null, {
          client_id: ctx.params.clientId || '',
          project_id: ctx.params.projectId || ''
        });
      }
    }
  };

  function rangeFrom() { return state.range === 'all' ? '' : state.from; }
  function rangeTo() { return state.range === 'all' ? '' : state.to; }

  function filters() {
    return '<div class="filters">' +
      '<div class="field"><label>Period</label><select id="i-range">' +
        enumOptions(RANGES, state.range) + '</select></div>' +
      // The two date boxes only mean anything once you have asked for dates of
      // your own; until then they just repeat the period you already picked.
      '<div class="dates" id="i-dates"' +
        (state.range === 'custom' ? '' : ' hidden') + '>' +
        '<div class="field"><label>From</label>' +
          '<input type="date" id="i-from" value="' + esc(state.from) + '"></div>' +
        '<div class="field"><label>To</label>' +
          '<input type="date" id="i-to" value="' + esc(state.to) + '"></div>' +
      '</div>' +
      '<div class="field"><label>Client</label><select id="i-client">' +
        options(clients, {
          selected: state.clientId,
          blank: 'All clients',
          label: (c) => c.company || c.name
        }) + '</select></div>' +
      '<div class="field"><label>Category</label><select id="i-category">' +
        enumOptions(categories, state.category, 'All categories') + '</select></div>' +
      '<div class="field"><label>Source</label><select id="i-source">' +
        enumOptions([['manual', 'Typed in'], ['project', 'From a project'],
          ['invoice', 'From an invoice']], state.source, 'Any source') + '</select></div>' +
      '<div class="field grow"><label>Search</label>' +
        '<div class="search-box">' + icon('search', 14) +
        '<input type="text" id="i-search" placeholder="Description or reference" ' +
        'value="' + esc(state.search) + '" spellcheck="false"></div></div>' +
      '</div>';
  }

  function wireFilters(ctx) {
    const reload = () => load(ctx);

    document.getElementById('i-range').addEventListener('change', (event) => {
      state.range = event.target.value;
      if (state.range === 'month') { state.from = monthStart(0); state.to = monthEnd(0); }
      else if (state.range === 'last') { state.from = monthStart(-1); state.to = monthEnd(-1); }
      else if (state.range === 'fy') { state.from = fyStart(); state.to = today(); }
      else if (state.range === 'all') { state.from = ''; state.to = ''; }
      const fromEl = document.getElementById('i-from');
      const toEl = document.getElementById('i-to');
      fromEl.value = state.from;
      toEl.value = state.to;
      document.getElementById('i-dates').hidden = state.range !== 'custom';
      toEl.disabled = state.range === 'all';
      reload();
    });

    ['from', 'to'].forEach((key) => {
      document.getElementById('i-' + key).addEventListener('change', (event) => {
        state[key] = event.target.value;
        state.range = 'custom';
        document.getElementById('i-range').value = 'custom';
        state.range = 'custom';
        reload();
      });
    });

    ['client', 'category', 'source'].forEach((key) => {
      document.getElementById('i-' + key).addEventListener('change', (event) => {
        state[key === 'client' ? 'clientId' : key] = event.target.value;
        reload();
      });
    });

    const search = document.getElementById('i-search');
    search.addEventListener('input', debounce(() => {
      state.search = search.value.trim();
      reload();
    }, 240));
  }

  /** The current filter, as the list and chart queries want it. */
  function currentFilter() {
    return {
      from: rangeFrom() || undefined,
      to: rangeTo() || undefined,
      search: state.search || undefined,
      clientId: state.clientId || undefined,
      category: state.category || undefined,
      source: state.source || undefined
    };
  }

  /** Just the data, so the caller can fetch it alongside anything else. */
  function fetchIncome() {
    return Promise.all([
      api('income:list', currentFilter()),
      api('income:monthly', { months: 12 })
    ]);
  }

  async function load(ctx) {
    const host = document.getElementById('income-body');
    host.innerHTML = window.UI.loading(7);
    const [data, monthly] = await fetchIncome();
    renderIncome(ctx, data, monthly);
  }

  function renderIncome(ctx, data, monthly) {
    const host = document.getElementById('income-body');

    const total = num(data.totals.total);
    const count = num(data.totals.entries);
    const average = count ? total / count : 0;
    const biggest = data.rows.reduce((max, row) => Math.max(max, num(row.amount)), 0);

    host.innerHTML =
      '<div class="grid c4 mb14">' +
        stat({ label: 'Received in period', value: fmt.moneyShort(total), accent: true,
          sub: '<span class="faint">' + periodLabel() + '</span>' }) +
        stat({ label: 'Entries', value: fmt.number(count),
          sub: '<span class="faint">average ' + fmt.money(average) + '</span>' }) +
        stat({ label: 'Largest single entry', value: fmt.moneyShort(biggest), small: true,
          sub: '<span class="faint">in this period</span>' }) +
        stat({ label: 'Clients involved', value: fmt.number((data.byClient || []).length),
          small: true,
          sub: '<span class="faint">' +
            ((data.byClient || [])[0] ? 'top: ' + esc((data.byClient[0].client_name || '')) : '—') +
            '</span>' }) +
      '</div>' +

      '<div class="grid sidebar-right mb14">' +
        card({ title: 'Monthly income', hint: 'last 12 months',
          body: window.UI.barChart(
            monthly.map((row) => ({ month: row.month, income: row.total, expense: 0 })),
            { pixelHeight: 190 }
          ) }) +
        card({ title: 'By client', hint: 'this period',
          body: barList((data.byClient || []).map((row) => ({
            label: row.client_name, value: row.total
          })), { empty: 'No income in this period.', limit: 8 }) }) +
      '</div>' +

      card({
        title: 'Income entries',
        hint: count + ' entr' + (count === 1 ? 'y' : 'ies') + ' · ' + fmt.money(total),
        flush: true,
        body: table([
          { label: 'Date', className: 'shrink', render: (row) => fmt.date(row.received_on) },
          { label: 'From', render: (row) =>
            '<div class="row-title">' +
            (row.client_name
              ? esc(row.client_company || row.client_name)
              : '<span class="faint">No client</span>') + '</div>' +
            (row.description
              ? '<div class="row-sub truncate" title="' + esc(row.description) + '">' +
                esc(row.description) + '</div>'
              : '') },
          { label: 'Linked to', render: (row) =>
            row.project_title
              ? '<span class="badge quiet">' + icon('projects', 11) + ' ' +
                esc(trim(row.project_title, 26)) + '</span>'
              : (row.invoice_number
                ? '<span class="badge quiet">' + icon('invoice', 11) + ' ' +
                  esc(row.invoice_number) + '</span>'
                : '<span class="faint">—</span>') },
          { label: 'Category', render: (row) => '<span class="small">' + esc(row.category) + '</span>' },
          { label: 'Mode', render: (row) =>
            '<span class="small faint">' + esc(methodLabel(row.method)) +
            (row.reference ? '<br>' + esc(trim(row.reference, 18)) : '') + '</span>' },
          { label: 'Amount', className: 'num', render: (row) =>
            '<span class="strong">' + fmt.money(row.amount) + '</span>' },
          { label: '', className: 'actions', render: (row) =>
            row.source === 'invoice'
              ? '<span class="badge quiet" title="Created by an invoice payment">auto</span>'
              : '<button class="btn sm ghost" data-action="edit" data-id="' + row.id +
                '" title="Edit">' + icon('edit', 13) + '</button>' +
                '<button class="btn sm ghost" data-action="remove" data-id="' + row.id +
                '" data-amount="' + row.amount + '" title="Delete">' + icon('trash', 13) + '</button>' }
        ], {
          rows: data.rows,
          footer: data.rows.length
            ? '<tr><td colspan="5">Total for this period</td>' +
              '<td class="num">' + fmt.money(total) + '</td><td></td></tr>'
            : '',
          empty: {
            icon: 'income',
            title: hasFilters() ? 'No income matches these filters' : 'No income recorded yet',
            message: hasFilters()
              ? 'Widen the period or clear a filter to see more.'
              : 'Record every payment you receive here. Money from a project you mark ' +
                'as paid, or from an invoice payment, lands here automatically — ' +
                'and you can always type in a one-off amount yourself.',
            action: hasFilters() ? '' : 'new',
            actionLabel: 'Add your first entry'
          }
        })
      });

    bindRows(host, data.rows, (row) => {
      if (row.source === 'invoice') {
        toast('This entry belongs to invoice ' + row.invoice_number,
          'info', 'Edit it from the Invoices tab.');
        return;
      }
      editor(ctx, row.id);
    });

    bindActions(host, {
      new: () => editor(ctx, null),
      edit: (ds) => editor(ctx, Number(ds.id)),
      remove: async (ds) => {
        const ok = await confirm({
          title: 'Delete income entry',
          message: 'Delete this entry of ' + fmt.money(ds.amount) + '?',
          detail: 'If it was tied to a project, that project\'s payment status is ' +
            'recalculated straight away.',
          confirmLabel: 'Delete entry',
          danger: true
        });
        if (!ok) return;
        const result = await apiSafe('income:delete', { id: Number(ds.id) });
        if (result) { toast('Entry deleted', 'success'); load(ctx); }
      }
    });
  }

  function hasFilters() {
    return Boolean(state.search || state.clientId || state.category || state.source) ||
      state.range !== 'all';
  }

  function periodLabel() {
    if (state.range === 'all') return 'all time';
    return fmt.date(state.from) + ' – ' + fmt.date(state.to);
  }

  function trim(text, length) {
    const value = String(text || '');
    return value.length > length ? value.slice(0, length - 1) + '…' : value;
  }

  // =========================================================================
  // Add / edit entry
  // =========================================================================

  async function editor(ctx, id, prefill) {
    let entry = {
      client_id: '', project_id: '', amount: '', received_on: today(),
      category: 'Project work', description: '', method: 'upi', reference: ''
    };
    if (id) {
      const loaded = await apiSafe('income:get', { id });
      if (!loaded) return;
      entry = loaded;
    } else if (prefill) {
      entry = Object.assign(entry, prefill);
    }

    const projects = await api('projects:options',
      entry.client_id ? { clientId: entry.client_id } : {});

    const handle = modal({
      title: id ? 'Edit income entry' : 'Record income',
      enterSaves: true,
      sub: id ? 'Entry #' + id : 'Money received — from a client, or from anything else',
      body:
        '<div class="field-row">' +
          '<div class="field"><label>Amount <span class="req">*</span></label>' +
            '<div class="input-prefix"><span>' +
            esc(window.App.settings.currency_symbol || '₹') + '</span>' +
            '<input type="number" step="0.01" min="0" class="num" data-field="amount" ' +
            'value="' + esc(entry.amount) + '" placeholder="0.00"></div></div>' +
          '<div class="field"><label>Received on <span class="req">*</span></label>' +
            '<input type="date" data-field="received_on" value="' +
            esc(entry.received_on) + '"></div>' +
        '</div>' +

        '<div class="field"><label>Client</label>' +
          '<select data-field="client_id" id="ie-client">' +
          options(clients, {
            selected: entry.client_id,
            blank: '— no client (one-off money) —',
            label: (c) => c.company || c.name
          }) + '</select>' +
          '<div class="help">Not on the list? ' +
          '<a href="#" data-add-client>Add a client</a> and they will appear here ' +
          'and in every other dropdown.</div></div>' +

        '<div class="field"><label>Against a project</label>' +
          '<select data-field="project_id" id="ie-project">' +
          projectOptions(projects, entry.project_id) + '</select>' +
          '<div class="help">Linking it updates that project\'s paid/unpaid status ' +
          'automatically.</div></div>' +

        '<div class="field-row">' +
          '<div class="field"><label>Category</label>' +
            '<select data-field="category">' +
            enumOptions(categories, entry.category) + '</select></div>' +
          '<div class="field"><label>Payment mode</label>' +
            '<select data-field="method">' +
            enumOptions(PAYMENT_METHODS, entry.method) + '</select></div>' +
          '<div class="field"><label>Reference</label>' +
            '<input type="text" data-field="reference" value="' + esc(entry.reference) + '" ' +
            'placeholder="UTR, cheque no."></div>' +
        '</div>' +

        '<div class="field"><label>Description <span id="ie-req" class="req hidden">*</span></label>' +
          '<textarea data-field="description" placeholder="What was this money for?">' +
          esc(entry.description) + '</textarea>' +
          '<div class="help" id="ie-help">With no client selected this is required, so no ' +
          'entry is ever left unexplained.</div></div>',
      footer:
        '<button class="btn secondary" data-close>Cancel</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn" data-save>' + icon('check', 15) +
        (id ? 'Save changes' : 'Record income') + '</button>'
    });

    const clientSelect = handle.body.querySelector('#ie-client');
    const projectSelect = handle.body.querySelector('#ie-project');
    const required = handle.body.querySelector('#ie-req');

    const syncRequired = () => {
      required.classList.toggle('hidden', Boolean(clientSelect.value));
    };
    syncRequired();

    // Narrow the project list to the chosen client, so you cannot tag money to
    // someone else's job by accident.
    clientSelect.addEventListener('change', async () => {
      syncRequired();
      const list = await api('projects:options',
        clientSelect.value ? { clientId: clientSelect.value } : {});
      projectSelect.innerHTML = projectOptions(list, '');
    });

    // Picking a project fills in the client and suggests the outstanding amount.
    projectSelect.addEventListener('change', () => {
      const option = projectSelect.selectedOptions[0];
      if (!option || !option.value) return;
      if (option.dataset.client && !clientSelect.value) {
        clientSelect.value = option.dataset.client;
        syncRequired();
      }
      const amountInput = handle.body.querySelector('[data-field="amount"]');
      if (!amountInput.value && option.dataset.balance) {
        amountInput.value = option.dataset.balance;
      }
    });

    handle.body.querySelector('[data-add-client]').addEventListener('click', (event) => {
      event.preventDefault();
      handle.close();
      ctx.go('clients', { action: 'new' });
    });

    handle.el.querySelector('[data-save]').addEventListener('click', async (event) => {
      const payload = readForm(handle.body);
      if (!num(payload.amount)) { handle.error('Enter an amount greater than zero.'); return; }
      if (!payload.client_id && !String(payload.description || '').trim()) {
        handle.error('With no client selected, describe how this money came in.');
        return;
      }
      await window.UI.busy(event.currentTarget, async () => {
        try {
          await api('income:save', Object.assign({ id }, payload));
          handle.close();
          toast(id ? 'Entry updated' : 'Income recorded', 'success');
          load(ctx);
        } catch (err) {
          handle.error(err.message);
        }
      });
    });
  }

  function projectOptions(projects, selected) {
    let html = '<option value="">— not tied to a project —</option>';
    (projects || []).forEach((project) => {
      const balance = Math.max(0, num(project.amount) - num(project.amount_paid));
      html += '<option value="' + project.id + '"' +
        (String(project.id) === String(selected || '') ? ' selected' : '') +
        ' data-client="' + (project.client_id || '') + '"' +
        ' data-balance="' + balance.toFixed(2) + '">' +
        esc(project.title) +
        (project.client_name ? ' — ' + esc(project.client_name) : '') +
        ' (' + fmt.money(project.amount) +
        (balance > 0 && balance < num(project.amount)
          ? ', ' + fmt.money(balance) + ' due' : '') + ')' +
        '</option>';
    });
    return html;
  }
})();
