/**
 * Expenses: one-off spends, plus the recurring side — rent, EMIs, subscriptions,
 * reinvestment into the business and personal expenditure.
 */
(function () {
  'use strict';

  window.Pages = window.Pages || {};

  const {
    api, apiSafe, esc, icon, fmt, card, stat, table, modal, toast, readForm,
    bindActions, bindRows, debounce, confirm, options, enumOptions, barList,
    PAYMENT_METHODS, methodLabel, num, today, monthStart, monthEnd, fyStart, badge
  } = window.UI;

  const RANGES = [
    ['month', 'This month'],
    ['last', 'Last month'],
    ['fy', 'This FY'],
    ['all', 'All time'],
    ['custom', 'Custom']
  ];

  const KINDS = [
    ['business', 'Business running cost'],
    ['materials', 'Materials & stock'],
    ['reinvestment', 'Reinvestment in the business'],
    ['loan', 'Loan / EMI'],
    ['subscription', 'Subscription'],
    ['personal', 'Personal'],
    ['tax', 'Tax'],
    ['other', 'Other']
  ];

  const FREQUENCIES = [
    ['weekly', 'Every week'],
    ['monthly', 'Every month'],
    ['quarterly', 'Every 3 months'],
    ['half_yearly', 'Every 6 months'],
    ['yearly', 'Every year']
  ];

  const state = {
    tab: 'entries',
    range: 'month',
    from: monthStart(0),
    to: monthEnd(0),
    search: '',
    categoryId: '',
    kind: ''
  };

  let categories = [];
  let projects = [];

  window.Pages.expenses = {
    title: 'Expenses',
    crumb: 'Money',

    async render(ctx) {
      if (ctx.params.tab) state.tab = ctx.params.tab;

      /*
       * The dropdown data and the tab's own contents are independent, so they
       * are asked for together. Only the entries tab is prefetched here: the
       * other two are cheap and are loaded by loadTab below.
       */
      const [categoryList, projectList, entries] = await Promise.all([
        api('expenses:categories'),
        api('projects:options'),
        state.tab === 'entries' ? fetchEntries() : Promise.resolve(null)
      ]);
      categories = categoryList;
      projects = projectList;

      ctx.el.innerHTML =
        '<div class="tabs">' +
          tab('entries', 'Expense entries') +
          tab('recurring', 'Recurring & loans') +
          tab('categories', 'Categories') +
        '</div><div id="exp-body">' + window.UI.loading(6) + '</div>';

      ctx.el.querySelectorAll('[data-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          state.tab = button.getAttribute('data-tab');
          ctx.refresh();
        });
      });

      setActions(ctx);
      if (entries) {
        const host = document.getElementById('exp-body');
        host.innerHTML = filters() + window.UI.loading(6);
        wireFilters(ctx);
        renderEntries(ctx, entries[0], entries[1], entries[2]);
      } else {
        await loadTab(ctx);
      }

      if (ctx.params.action === 'new') entryEditor(ctx, null);
    }
  };

  function tab(id, label) {
    return '<button data-tab="' + id + '"' + (state.tab === id ? ' class="active"' : '') + '>' +
      esc(label) + '</button>';
  }

  function setActions(ctx) {
    if (state.tab === 'recurring') {
      ctx.actions.innerHTML =
        '<button class="btn" data-action="newRecurring">' + icon('repeat', 15) +
        'Add recurring payment</button>';
      bindActions(ctx.actions, { newRecurring: () => recurringEditor(ctx, null) });
    } else if (state.tab === 'categories') {
      ctx.actions.innerHTML =
        '<button class="btn" data-action="newCategory">' + icon('plus', 15) + 'Add category</button>';
      bindActions(ctx.actions, { newCategory: () => categoryEditor(ctx, null) });
    } else {
      ctx.actions.innerHTML =
        '<button class="btn secondary" data-action="export">' + icon('download', 15) + 'Export CSV</button>' +
        '<button class="btn" data-action="new">' + icon('plus', 15) + 'Add expense</button>';
      bindActions(ctx.actions, {
        new: () => entryEditor(ctx, null),
        export: () => apiSafe('backup:exportCsv', {
          from: state.range === 'all' ? undefined : state.from,
          to: state.range === 'all' ? undefined : state.to
        })
      });
    }
  }

  async function loadTab(ctx) {
    if (state.tab === 'recurring') return loadRecurring(ctx);
    if (state.tab === 'categories') return loadCategories(ctx);
    return loadEntries(ctx);
  }

  // =========================================================================
  // Tab 1: expense entries
  // =========================================================================

  /** Just the data, so the caller can fetch it alongside anything else. */
  function fetchEntries() {
    const filter = {
      from: state.range === 'all' ? undefined : state.from,
      to: state.range === 'all' ? undefined : state.to,
      search: state.search || undefined,
      categoryId: state.categoryId || undefined,
      kind: state.kind || undefined
    };
    return Promise.all([
      api('expenses:list', filter),
      api('expenses:monthly', { months: 12 }),
      api('income:monthly', { months: 12 })
    ]);
  }

  async function loadEntries(ctx) {
    const host = document.getElementById('exp-body');
    host.innerHTML = filters() + window.UI.loading(6);
    wireFilters(ctx);
    const [data, monthly, income] = await fetchEntries();
    renderEntries(ctx, data, monthly, income);
  }

  function renderEntries(ctx, data, monthly, income) {
    const host = document.getElementById('exp-body');

    const total = num(data.totals.total);
    const count = num(data.totals.entries);
    const incomeMap = {};
    income.forEach((row) => { incomeMap[row.month] = num(row.total); });
    const series = monthly.map((row) => ({
      month: row.month, expense: num(row.total), income: incomeMap[row.month] || 0
    }));

    const personal = (data.byKind || [])
      .filter((row) => row.kind === 'personal')
      .reduce((sum, row) => sum + num(row.total), 0);
    const business = total - personal;

    host.innerHTML = filters() +
      '<div class="grid c4 mb14">' +
        stat({ label: 'Spent in period', value: fmt.moneyShort(total), accent: true,
          sub: '<span class="faint">' + periodLabel() + '</span>' }) +
        stat({ label: 'Business', value: fmt.moneyShort(business), small: true,
          sub: '<span class="faint">' +
            (total ? fmt.percent((business / total) * 100, 0) + ' of spending' : '—') +
            '</span>' }) +
        stat({ label: 'Personal', value: fmt.moneyShort(personal), small: true,
          sub: '<span class="faint">' +
            (total ? fmt.percent((personal / total) * 100, 0) + ' of spending' : '—') +
            '</span>' }) +
        stat({ label: 'Entries', value: fmt.number(count), small: true,
          sub: '<span class="faint">average ' +
            fmt.money(count ? total / count : 0) + '</span>' }) +
      '</div>' +

      '<div class="grid sidebar-right mb14">' +
        card({ title: 'Income vs expenses', hint: 'last 12 months',
          body: window.UI.barChart(series, { pixelHeight: 190 }) }) +
        card({ title: 'By category', hint: 'this period',
          body: barList((data.byCategory || []).map((row) => ({
            label: row.category_name, value: row.total
          })), { empty: 'Nothing spent in this period.', limit: 9 }) }) +
      '</div>' +

      card({
        title: 'Expense entries',
        hint: count + ' entr' + (count === 1 ? 'y' : 'ies') + ' · ' + fmt.money(total),
        flush: true,
        body: table([
          { label: 'Date', className: 'shrink', render: (row) => fmt.date(row.spent_on) },
          { label: 'What', render: (row) =>
            '<div class="row-title">' + esc(row.title) + '</div>' +
            (row.payee ? '<div class="row-sub">' + esc(row.payee) + '</div>' : '') },
          { label: 'Category', render: (row) =>
            (row.category_name
              ? '<span class="small">' + esc(row.category_name) + '</span>' +
                '<div class="row-sub">' + esc(fmt.label(row.category_kind)) + '</div>'
              : '<span class="faint">Uncategorised</span>') },
          { label: 'Project', render: (row) =>
            row.project_title
              ? '<span class="badge quiet">' + esc(shorten(row.project_title, 22)) + '</span>'
              : '<span class="faint">—</span>' },
          { label: 'Mode', render: (row) =>
            '<span class="small faint">' + esc(methodLabel(row.method)) + '</span>' +
            (row.recurring_title
              ? '<div class="row-sub">' + icon('repeat', 10) + ' recurring</div>' : '') },
          { label: 'Amount', className: 'num', render: (row) =>
            '<span class="strong">' + fmt.money(row.amount) + '</span>' },
          { label: '', className: 'actions', render: (row) =>
            '<button class="btn sm ghost" data-action="edit" data-id="' + row.id +
            '" title="Edit">' + icon('edit', 13) + '</button>' +
            '<button class="btn sm ghost" data-action="remove" data-id="' + row.id +
            '" data-title="' + esc(row.title) + '" title="Delete">' + icon('trash', 13) + '</button>' }
        ], {
          rows: data.rows,
          footer: data.rows.length
            ? '<tr><td colspan="5">Total for this period</td><td class="num">' +
              fmt.money(total) + '</td><td></td></tr>'
            : '',
          empty: {
            icon: 'expense',
            title: hasFilters() ? 'No expense matches these filters' : 'No expenses recorded yet',
            message: hasFilters()
              ? 'Widen the period or clear a filter to see more.'
              : 'Record what you spend — paper and ink, outsourced printing, rent, ' +
                'salaries, software, EMIs, even personal expenditure. Each entry gets ' +
                'a category so the monthly picture makes sense at a glance.',
            action: hasFilters() ? '' : 'new',
            actionLabel: 'Add your first expense'
          }
        })
      });

    wireFilters(ctx);
    bindRows(host, data.rows, (row) => entryEditor(ctx, row.id));
    bindActions(host, {
      new: () => entryEditor(ctx, null),
      edit: (ds) => entryEditor(ctx, Number(ds.id)),
      remove: async (ds) => {
        const ok = await confirm({
          title: 'Delete expense',
          message: 'Delete "' + ds.title + '"?',
          confirmLabel: 'Delete',
          danger: true
        });
        if (!ok) return;
        const result = await apiSafe('expenses:delete', { id: Number(ds.id) });
        if (result) { toast('Expense deleted', 'success'); loadEntries(ctx); }
      }
    });
  }

  function filters() {
    return '<div class="filters">' +
      '<div class="field"><label>Period</label><select id="e-range">' +
        enumOptions(RANGES, state.range) + '</select></div>' +
      '<div class="field"><label>From</label><input type="date" id="e-from" value="' +
        esc(state.from) + '"' + (state.range === 'all' ? ' disabled' : '') + '></div>' +
      '<div class="field"><label>To</label><input type="date" id="e-to" value="' +
        esc(state.to) + '"' + (state.range === 'all' ? ' disabled' : '') + '></div>' +
      '<div class="field"><label>Category</label><select id="e-category">' +
        options(categories, { selected: state.categoryId, blank: 'All categories' }) +
        '</select></div>' +
      '<div class="field"><label>Type</label><select id="e-kind">' +
        enumOptions(KINDS, state.kind, 'All types') + '</select></div>' +
      '<div class="field grow"><label>Search</label><div class="search-box">' +
        icon('search', 14) + '<input type="text" id="e-search" placeholder="Title, payee or note" ' +
        'value="' + esc(state.search) + '" spellcheck="false"></div></div>' +
      '</div>';
  }

  function wireFilters(ctx) {
    const rangeEl = document.getElementById('e-range');
    if (!rangeEl) return;

    rangeEl.addEventListener('change', (event) => {
      state.range = event.target.value;
      if (state.range === 'month') { state.from = monthStart(0); state.to = monthEnd(0); }
      else if (state.range === 'last') { state.from = monthStart(-1); state.to = monthEnd(-1); }
      else if (state.range === 'fy') { state.from = fyStart(); state.to = today(); }
      else if (state.range === 'all') { state.from = ''; state.to = ''; }
      loadEntries(ctx);
    });

    ['from', 'to'].forEach((key) => {
      document.getElementById('e-' + key).addEventListener('change', (event) => {
        state[key] = event.target.value;
        state.range = 'custom';
        loadEntries(ctx);
      });
    });

    document.getElementById('e-category').addEventListener('change', (event) => {
      state.categoryId = event.target.value;
      loadEntries(ctx);
    });
    document.getElementById('e-kind').addEventListener('change', (event) => {
      state.kind = event.target.value;
      loadEntries(ctx);
    });

    const search = document.getElementById('e-search');
    search.addEventListener('input', debounce(() => {
      state.search = search.value.trim();
      loadEntries(ctx);
    }, 240));
  }

  function hasFilters() {
    return Boolean(state.search || state.categoryId || state.kind) || state.range !== 'all';
  }

  function periodLabel() {
    if (state.range === 'all') return 'all time';
    return fmt.date(state.from) + ' – ' + fmt.date(state.to);
  }

  function shorten(text, length) {
    const value = String(text || '');
    return value.length > length ? value.slice(0, length - 1) + '…' : value;
  }

  async function entryEditor(ctx, id) {
    let entry = {
      category_id: '', project_id: '', title: '', payee: '', amount: '',
      spent_on: today(), method: 'upi', reference: '', notes: ''
    };
    if (id) {
      const loaded = await apiSafe('expenses:get', { id });
      if (!loaded) return;
      entry = loaded;
    }

    const handle = modal({
      title: id ? 'Edit expense' : 'Add expense',
      sub: id ? entry.title : 'Anything that went out',
      body:
        '<div class="field"><label>What was it for? <span class="req">*</span></label>' +
          '<input type="text" data-field="title" value="' + esc(entry.title) + '" ' +
          'placeholder="e.g. 500 sheets 300gsm art card"></div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Amount <span class="req">*</span></label>' +
            '<div class="input-prefix"><span>' +
            esc(window.App.settings.currency_symbol || '₹') + '</span>' +
            '<input type="number" step="0.01" min="0" class="num" data-field="amount" ' +
            'value="' + esc(entry.amount) + '" placeholder="0.00"></div></div>' +
          '<div class="field"><label>Date <span class="req">*</span></label>' +
            '<input type="date" data-field="spent_on" value="' + esc(entry.spent_on) + '"></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Category</label><select data-field="category_id">' +
            options(categories, { selected: entry.category_id, blank: '— uncategorised —' }) +
            '</select></div>' +
          '<div class="field"><label>Paid to</label>' +
            '<input type="text" data-field="payee" value="' + esc(entry.payee) + '" ' +
            'placeholder="Vendor or person"></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Payment mode</label><select data-field="method">' +
            enumOptions(PAYMENT_METHODS, entry.method) + '</select></div>' +
          '<div class="field"><label>Reference</label>' +
            '<input type="text" data-field="reference" value="' + esc(entry.reference) + '" ' +
            'placeholder="Bill no., UTR"></div>' +
        '</div>' +
        '<div class="field"><label>Against a project</label>' +
          '<select data-field="project_id">' +
          options(projects, {
            selected: entry.project_id,
            blank: '— general expense —',
            label: (p) => p.title + (p.client_name ? ' — ' + p.client_name : '')
          }) + '</select>' +
          '<div class="help">Tag job costs to a project and you can see what that job ' +
          'really earned, and pull the cost onto its invoice.</div></div>' +
        '<div class="field"><label>Notes</label>' +
          '<textarea data-field="notes">' + esc(entry.notes) + '</textarea></div>',
      footer:
        '<button class="btn secondary" data-close>Cancel</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn" data-save>' + icon('check', 15) +
        (id ? 'Save changes' : 'Add expense') + '</button>'
    });

    handle.el.querySelector('[data-save]').addEventListener('click', async (event) => {
      const payload = readForm(handle.body);
      if (!String(payload.title || '').trim()) { handle.error('Give the expense a title.'); return; }
      if (!num(payload.amount)) { handle.error('Enter an amount greater than zero.'); return; }
      await window.UI.busy(event.currentTarget, async () => {
        try {
          await api('expenses:save', Object.assign({ id }, payload));
          handle.close();
          toast(id ? 'Expense updated' : 'Expense added', 'success');
          loadEntries(ctx);
        } catch (err) {
          handle.error(err.message);
        }
      });
    });
  }

  // =========================================================================
  // Tab 2: recurring payments, loans and EMIs
  // =========================================================================

  async function loadRecurring(ctx) {
    const host = document.getElementById('exp-body');
    host.innerHTML = window.UI.loading(5);

    const rows = await api('expenses:recurringList', { includeInactive: 1 });
    const active = rows.filter((row) => row.is_active);
    const monthlyCommitment = active.reduce((sum, row) => {
      const perMonth = {
        weekly: num(row.amount) * 4.33, monthly: num(row.amount),
        quarterly: num(row.amount) / 3, half_yearly: num(row.amount) / 6,
        yearly: num(row.amount) / 12
      }[row.frequency] || num(row.amount);
      return sum + perMonth;
    }, 0);
    const loans = active.filter((row) => row.outstanding !== null);
    const loanOutstanding = loans.reduce((sum, row) => sum + num(row.outstanding), 0);
    const dueNow = active.filter((row) => num(row.days_to_due) <= 0);

    host.innerHTML =
      '<div class="banner">' + icon('info', 17) +
      '<div>Set up anything that goes out again and again — shop rent, salaries, ' +
      'internet, software, an equipment EMI, a bank loan, or money you put back into ' +
      'the business every month. When one falls due, record it in a click and it ' +
      'becomes a normal expense entry, with the schedule rolling forward by itself.</div></div>' +

      '<div class="grid c4 mb14">' +
        stat({ label: 'Monthly commitment', value: fmt.moneyShort(monthlyCommitment),
          accent: true, sub: '<span class="faint">' + active.length +
          ' active schedule' + (active.length === 1 ? '' : 's') + '</span>' }) +
        stat({ label: 'Due now', value: fmt.number(dueNow.length), small: true,
          sub: dueNow.length
            ? '<span class="delta down">' +
              fmt.money(dueNow.reduce((s, r) => s + num(r.amount), 0)) + ' waiting</span>'
            : '<span class="faint">nothing pending</span>' }) +
        stat({ label: 'Loan balance', value: fmt.moneyShort(loanOutstanding), small: true,
          sub: '<span class="faint">' + loans.length + ' loan' +
            (loans.length === 1 ? '' : 's') + ' tracked</span>' }) +
        stat({ label: 'Posted so far', value:
          fmt.moneyShort(rows.reduce((sum, row) => sum + num(row.posted_total), 0)),
          small: true, sub: '<span class="faint">' +
            rows.reduce((sum, row) => sum + num(row.posted_count), 0) +
            ' instalments recorded</span>' }) +
      '</div>' +

      card({
        title: 'Recurring payments & loans',
        flush: true,
        body: table([
          { label: 'Payment', render: (row) =>
            '<div class="row-title">' + esc(row.title) +
            (row.is_active ? '' : ' ' + badge('Stopped', 'quiet')) + '</div>' +
            '<div class="row-sub">' + esc(row.category_name || 'Uncategorised') +
            (row.payee ? ' · ' + esc(row.payee) : '') + '</div>' },
          { label: 'Every', render: (row) =>
            '<span class="small">' + esc(frequencyLabel(row.frequency)) + '</span>' },
          { label: 'Amount', className: 'num', render: (row) =>
            '<span class="strong">' + fmt.money(row.amount) + '</span>' },
          { label: 'Next due', render: (row) => {
            if (!row.is_active) return '<span class="faint">—</span>';
            const days = num(row.days_to_due);
            return fmt.date(row.next_due_date) +
              '<div class="row-sub' + (days <= 0 ? ' neg' : '') + '">' +
              esc(fmt.due(days)) + '</div>';
          } },
          { label: 'Loan balance', className: 'num', render: (row) =>
            row.outstanding === null
              ? '<span class="faint">—</span>'
              : fmt.money(row.outstanding) +
                (row.installments_left !== null
                  ? '<div class="row-sub">' + row.installments_left + ' left</div>' : '') },
          { label: 'Paid so far', className: 'num', render: (row) =>
            num(row.posted_count)
              ? fmt.money(row.posted_total) +
                '<div class="row-sub">' + row.posted_count + ' times</div>'
              : '<span class="faint">—</span>' },
          { label: '', className: 'actions', render: (row) =>
            (row.is_active
              ? '<button class="btn sm" data-action="post" data-id="' + row.id +
                '" data-title="' + esc(row.title) + '" data-amount="' + row.amount +
                '">Record payment</button>'
              : '') +
            '<button class="btn sm ghost" data-action="edit" data-id="' + row.id +
            '" title="Edit">' + icon('edit', 13) + '</button>' +
            '<button class="btn sm ghost" data-action="remove" data-id="' + row.id +
            '" data-title="' + esc(row.title) + '" title="Delete">' + icon('trash', 13) + '</button>' }
        ], {
          rows,
          empty: {
            icon: 'repeat',
            title: 'No recurring payments set up',
            message: 'Add rent, salaries, subscriptions, an EMI or a monthly ' +
              'reinvestment, and the app will remind you when each one falls due.',
            action: 'newRecurring',
            actionLabel: 'Add a recurring payment'
          }
        })
      });

    bindRows(host, rows, (row) => recurringEditor(ctx, row.id));
    bindActions(host, {
      newRecurring: () => recurringEditor(ctx, null),
      edit: (ds) => recurringEditor(ctx, Number(ds.id)),
      post: (ds) => postRecurring(ctx, ds),
      remove: async (ds) => {
        const ok = await confirm({
          title: 'Delete recurring payment',
          message: 'Delete the schedule for "' + ds.title + '"?',
          detail: 'Expenses already recorded from it are kept. If you only want it to ' +
            'stop, edit it and untick Active instead.',
          confirmLabel: 'Delete schedule',
          danger: true
        });
        if (!ok) return;
        const result = await apiSafe('expenses:deleteRecurring', { id: Number(ds.id) });
        if (result) { toast('Schedule deleted', 'success'); loadRecurring(ctx); }
      }
    });
  }

  function frequencyLabel(value) {
    const found = FREQUENCIES.find((entry) => entry[0] === value);
    return found ? found[1] : fmt.label(value);
  }

  async function recurringEditor(ctx, id) {
    let item = {
      category_id: '', title: '', payee: '', amount: '', frequency: 'monthly',
      start_date: today(), next_due_date: today(), end_date: '', outstanding: '',
      installments_left: '', notes: '', is_active: 1
    };
    if (id) {
      const rows = await apiSafe('expenses:recurringList', { includeInactive: 1 });
      if (!rows) return;
      const found = rows.find((row) => Number(row.id) === Number(id));
      if (!found) { toast('That schedule no longer exists.', 'error'); return; }
      item = found;
    }

    const handle = modal({
      title: id ? 'Edit recurring payment' : 'New recurring payment',
      sub: id ? item.title : 'Rent, salary, EMI, subscription, reinvestment…',
      body:
        '<div class="field"><label>Name <span class="req">*</span></label>' +
          '<input type="text" data-field="title" value="' + esc(item.title) + '" ' +
          'placeholder="e.g. Shop rent, Printer EMI, Adobe subscription"></div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Amount <span class="req">*</span></label>' +
            '<div class="input-prefix"><span>' +
            esc(window.App.settings.currency_symbol || '₹') + '</span>' +
            '<input type="number" step="0.01" min="0" class="num" data-field="amount" ' +
            'value="' + esc(item.amount) + '"></div></div>' +
          '<div class="field"><label>How often</label><select data-field="frequency">' +
            enumOptions(FREQUENCIES, item.frequency) + '</select></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Category</label><select data-field="category_id">' +
            options(categories, { selected: item.category_id, blank: '— uncategorised —' }) +
            '</select></div>' +
          '<div class="field"><label>Paid to</label>' +
            '<input type="text" data-field="payee" value="' + esc(item.payee) + '"></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Started on</label>' +
            '<input type="date" data-field="start_date" value="' + esc(item.start_date) + '"></div>' +
          '<div class="field"><label>Next due <span class="req">*</span></label>' +
            '<input type="date" data-field="next_due_date" value="' +
            esc(item.next_due_date) + '"></div>' +
          '<div class="field"><label>Ends on</label>' +
            '<input type="date" data-field="end_date" value="' + esc(item.end_date || '') + '">' +
            '<div class="help">Optional</div></div>' +
        '</div>' +
        '<hr class="divider">' +
        '<div class="section-title">If this is a loan or EMI</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Amount still owed</label>' +
            '<div class="input-prefix"><span>' +
            esc(window.App.settings.currency_symbol || '₹') + '</span>' +
            '<input type="number" step="0.01" min="0" class="num" data-field="outstanding" ' +
            'value="' + esc(item.outstanding === null ? '' : item.outstanding) + '" ' +
            'placeholder="Leave blank if not a loan"></div>' +
            '<div class="help">Comes down automatically each time you record an instalment.</div></div>' +
          '<div class="field"><label>Instalments remaining</label>' +
            '<input type="number" min="0" step="1" class="num" data-field="installments_left" ' +
            'value="' + esc(item.installments_left === null ? '' : item.installments_left) + '">' +
            '<div class="help">The schedule stops itself at zero.</div></div>' +
        '</div>' +
        '<div class="field"><label>Notes</label>' +
          '<textarea data-field="notes">' + esc(item.notes || '') + '</textarea></div>' +
        '<label class="check"><input type="checkbox" data-field="is_active"' +
        (item.is_active ? ' checked' : '') +
        '><span>Active<small>Untick to stop the reminders without losing the history.</small>' +
        '</span></label>',
      footer:
        '<button class="btn secondary" data-close>Cancel</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn" data-save>' + icon('check', 15) +
        (id ? 'Save changes' : 'Add schedule') + '</button>'
    });

    handle.el.querySelector('[data-save]').addEventListener('click', async (event) => {
      const payload = readForm(handle.body);
      if (!String(payload.title || '').trim()) { handle.error('Give this payment a name.'); return; }
      if (!num(payload.amount)) { handle.error('Enter an amount greater than zero.'); return; }
      await window.UI.busy(event.currentTarget, async () => {
        try {
          await api('expenses:saveRecurring', Object.assign({ id }, payload));
          handle.close();
          toast(id ? 'Schedule updated' : 'Schedule added', 'success');
          loadRecurring(ctx);
        } catch (err) {
          handle.error(err.message);
        }
      });
    });
  }

  function postRecurring(ctx, ds) {
    const handle = modal({
      title: 'Record this payment',
      sub: ds.title,
      size: 'narrow',
      body:
        '<div class="field"><label>Amount paid</label>' +
          '<div class="input-prefix"><span>' +
          esc(window.App.settings.currency_symbol || '₹') + '</span>' +
          '<input type="number" step="0.01" min="0" class="num" data-field="amount" ' +
          'value="' + esc(ds.amount) + '"></div>' +
          '<div class="help">Change it if this instalment differed.</div></div>' +
        '<div class="field"><label>Paid on</label>' +
          '<input type="date" data-field="spent_on" value="' + today() + '"></div>' +
        '<div class="field"><label>Payment mode</label><select data-field="method">' +
          enumOptions(PAYMENT_METHODS, 'bank_transfer') + '</select></div>' +
        '<div class="field"><label>Reference</label>' +
          '<input type="text" data-field="reference" placeholder="UTR, cheque no."></div>',
      footer:
        '<button class="btn secondary" data-close>Cancel</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn" data-save>' + icon('check', 15) + 'Record as expense</button>'
    });

    handle.el.querySelector('[data-save]').addEventListener('click', async (event) => {
      const payload = readForm(handle.body);
      await window.UI.busy(event.currentTarget, async () => {
        try {
          const result = await api('expenses:postRecurring',
            Object.assign({ id: Number(ds.id) }, payload));
          handle.close();
          toast('Recorded as an expense', 'success',
            'Next due ' + fmt.date(result.next_due_date));
          loadRecurring(ctx);
        } catch (err) {
          handle.error(err.message);
        }
      });
    });
  }

  // =========================================================================
  // Tab 3: categories
  // =========================================================================

  async function loadCategories(ctx) {
    const host = document.getElementById('exp-body');
    host.innerHTML = window.UI.loading(5);
    const rows = await api('expenses:categories', { includeInactive: 1 });

    const grouped = {};
    rows.forEach((row) => {
      grouped[row.kind] = grouped[row.kind] || [];
      grouped[row.kind].push(row);
    });

    host.innerHTML =
      '<div class="banner">' + icon('info', 17) +
      '<div>Categories are how the reports add up. Each one has a <strong>type</strong> ' +
      'so the dashboard can separate business running costs from materials, ' +
      'reinvestment, loan repayments and your own personal spending.</div></div>' +
      '<div class="grid c2">' +
      KINDS.map((entry) => {
        const list = grouped[entry[0]] || [];
        return card({
          title: entry[1],
          hint: list.length + ' categor' + (list.length === 1 ? 'y' : 'ies'),
          flush: true,
          body: list.length
            ? table([
              { label: 'Name', render: (row) =>
                esc(row.name) + (row.is_active ? '' : ' ' + badge('Hidden', 'quiet')) },
              { label: 'Used', className: 'num', render: (row) =>
                num(row.used) || '<span class="faint">—</span>' },
              { label: '', className: 'actions', render: (row) =>
                '<button class="btn sm ghost" data-action="edit" data-id="' + row.id +
                '" title="Edit">' + icon('edit', 13) + '</button>' +
                '<button class="btn sm ghost" data-action="remove" data-id="' + row.id +
                '" data-name="' + esc(row.name) + '" title="Remove">' +
                icon('trash', 13) + '</button>' }
            ], { rows: list, compact: true })
            : '<p class="small faint center" style="padding:16px 0">None yet.</p>'
        });
      }).join('') +
      '</div>';

    bindActions(host, {
      edit: (ds) => categoryEditor(ctx, Number(ds.id), rows),
      remove: async (ds) => {
        const ok = await confirm({
          title: 'Remove category',
          message: 'Remove "' + ds.name + '"?',
          detail: 'If any expense already uses it, the category is hidden rather than ' +
            'deleted, so your old entries keep their label.',
          confirmLabel: 'Remove',
          danger: true
        });
        if (!ok) return;
        const result = await apiSafe('expenses:deleteCategory', { id: Number(ds.id) });
        if (result) {
          toast(result.deactivated ? 'Category hidden (it is still in use)' : 'Category removed',
            'success');
          categories = await api('expenses:categories');
          loadCategories(ctx);
        }
      }
    });
  }

  function categoryEditor(ctx, id, rows) {
    const existing = id && rows ? rows.find((row) => Number(row.id) === Number(id)) : null;
    const handle = modal({
      title: id ? 'Edit category' : 'New expense category',
      size: 'narrow',
      body:
        '<div class="field"><label>Name <span class="req">*</span></label>' +
          '<input type="text" data-field="name" value="' +
          esc(existing ? existing.name : '') + '" placeholder="e.g. Courier charges"></div>' +
        '<div class="field"><label>Type</label><select data-field="kind">' +
          enumOptions(KINDS, existing ? existing.kind : 'business') + '</select>' +
          '<div class="help">Decides which bucket it falls into on the dashboard and ' +
          'in the reports.</div></div>' +
        (id
          ? '<label class="check"><input type="checkbox" data-field="is_active"' +
            (existing && existing.is_active ? ' checked' : '') +
            '><span>Show in the dropdowns</span></label>'
          : ''),
      footer:
        '<button class="btn secondary" data-close>Cancel</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn" data-save>' + icon('check', 15) + (id ? 'Save' : 'Add category') +
        '</button>'
    });

    handle.el.querySelector('[data-save]').addEventListener('click', async (event) => {
      const payload = readForm(handle.body);
      if (!String(payload.name || '').trim()) { handle.error('A name is required.'); return; }
      await window.UI.busy(event.currentTarget, async () => {
        try {
          await api('expenses:saveCategory', Object.assign({ id }, payload));
          handle.close();
          toast(id ? 'Category updated' : 'Category added', 'success');
          categories = await api('expenses:categories');
          loadCategories(ctx);
        } catch (err) {
          handle.error(err.message);
        }
      });
    });
  }
})();
