/** Dashboard: the one-screen brief on where the business stands. */
(function () {
  'use strict';

  window.Pages = window.Pages || {};

  const {
    api, apiSafe, esc, icon, fmt, card, stat, delta, table, barList, barChart,
    statusBadge, INVOICE_STATUS, bindActions, toast, num
  } = window.UI;

  window.Pages.dashboard = {
    title: 'Dashboard',
    crumb: 'Overview',

    async render(ctx) {
      ctx.actions.innerHTML =
        '<button class="btn secondary" data-action="newExpense">' + icon('expense', 15) + 'Add expense</button>' +
        '<button class="btn secondary" data-action="newIncome">' + icon('income', 15) + 'Add income</button>' +
        '<button class="btn" data-action="newInvoice">' + icon('plus', 15) + 'New invoice</button>';

      bindActions(ctx.actions, {
        newIncome: () => ctx.go('income', { action: 'new' }),
        newExpense: () => ctx.go('expenses', { action: 'new' }),
        newInvoice: () => ctx.go('invoices', { action: 'new' })
      });

      const [data, backup] = await Promise.all([
        api('dashboard:summary', { months: 12 }),
        apiSafe('backup:status')
      ]);
      ctx.el.innerHTML = view(data, backup);
      wire(ctx, data, backup);
    }
  };

  function view(data, backup) {
    const month = data.periods.month;
    const last = data.periods.lastMonth;
    const fy = data.periods.financialYear;
    const receivables = data.receivables || {};
    const projects = data.projectStats || {};

    return banners(data, backup) +

      '<div class="grid c4 mb14">' +
        stat({
          label: 'Income this month',
          value: fmt.moneyShort(month.income),
          sub: delta(month.income, last.income, 'vs ' + fmt.monthLabel(last.from.slice(0, 7))),
          accent: true
        }) +
        stat({
          label: 'Expenses this month',
          value: fmt.moneyShort(month.expense),
          sub: delta(month.expense, last.expense, 'vs last month')
        }) +
        stat({
          label: 'Net this month',
          value: '<span class="' + (month.net >= 0 ? 'pos' : 'neg') + '">' +
            fmt.moneyShort(month.net) + '</span>',
          sub: month.income > 0
            ? '<span class="faint">' +
              fmt.percent((month.net / month.income) * 100, 0) + ' margin</span>'
            : '<span class="faint">no income yet this month</span>'
        }) +
        stat({
          label: 'Money owed to you',
          value: fmt.moneyShort(receivables.outstanding),
          sub: Number(receivables.overdue_count) > 0
            ? '<span class="delta down">' + receivables.overdue_count + ' overdue</span> ' +
              '<span class="faint">· ' + fmt.moneyShort(receivables.overdue) + '</span>'
            : '<span class="faint">' + num(receivables.invoice_count) + ' open invoice' +
              (num(receivables.invoice_count) === 1 ? '' : 's') + '</span>'
        }) +
      '</div>' +

      '<div class="grid sidebar-right mb14">' +
        card({
          title: 'Income vs expenses',
          hint: 'last 12 months',
          body: barChart(data.series, { pixelHeight: 230 })
        }) +
        '<div class="col" style="gap:14px">' +
          card({
            title: 'This financial year',
            hint: data.financialYear,
            body:
              '<dl class="kv">' +
                '<dt>Income</dt><dd>' + fmt.money(fy.income) + '</dd>' +
                '<dt>Expenses</dt><dd>' + fmt.money(fy.expense) + '</dd>' +
                '<dt class="strong">Net</dt><dd class="strong ' +
                  (fy.net >= 0 ? 'pos' : 'neg') + '">' + fmt.money(fy.net) + '</dd>' +
                '<dt>Active clients</dt><dd>' + num(data.clientCount) + '</dd>' +
                '<dt>Open projects</dt><dd>' + num(projects.open_count) + '</dd>' +
                '<dt>Awaiting payment</dt><dd>' + num(projects.awaiting_payment) + '</dd>' +
              '</dl>'
          }) +
          card({
            title: 'Where the money went',
            hint: 'this month',
            body: barList(
              (data.expenseByKind || []).map((row) => ({
                label: fmt.label(row.kind), value: row.total
              })),
              { empty: 'No expenses recorded this month.' }
            )
          }) +
        '</div>' +
      '</div>' +

      '<div class="grid sidebar-right mb14">' +
        card({
          title: 'Invoices awaiting payment',
          actions: '<button class="btn sm secondary" data-action="allInvoices">View all</button>',
          flush: true,
          body: table([
            { label: 'Invoice', render: (row) =>
              '<span class="mono">' + esc(row.invoice_number) + '</span>' +
              '<div class="row-sub">' + esc(row.client_name || '—') + '</div>' },
            { label: 'Due', render: (row) =>
              fmt.dateShort(row.due_date || row.invoice_date) +
              (row.days_overdue > 0
                ? '<div class="row-sub neg">' + row.days_overdue + 'd overdue</div>'
                : '') },
            { label: 'Balance', className: 'num', render: (row) =>
              '<span class="strong">' + fmt.money(row.balance) + '</span>' +
              (num(row.amount_paid) > 0
                ? '<div class="row-sub">of ' + fmt.money(row.total) + '</div>' : '') },
            { label: '', className: 'actions', render: (row) =>
              '<button class="btn sm secondary" data-action="openInvoice" data-id="' + row.id +
              '">Open</button>' }
          ], {
            rows: data.outstandingInvoices,
            empty: {
              icon: 'check', title: 'Nothing outstanding',
              message: 'Every invoice you have sent has been paid in full.'
            }
          })
        }) +
        card({
          title: 'Top clients',
          hint: 'this FY',
          body: barList(
            (data.topClients || []).map((row) => ({
              label: row.company || row.name, value: row.total
            })),
            { empty: 'No client income recorded this financial year.' }
          )
        }) +
      '</div>' +

      '<div class="grid c2 mb14">' +
        card({
          title: 'Completed, waiting to be paid',
          flush: true,
          body: table([
            { label: 'Project', render: (row) =>
              '<div class="row-title">' + esc(row.title) + '</div>' +
              '<div class="row-sub">' + esc(row.client_name || 'No client') +
              (row.completed_on ? ' · done ' + fmt.dateShort(row.completed_on) : '') +
              '</div>' },
            { label: 'Balance', className: 'num', render: (row) =>
              '<span class="strong">' + fmt.money(row.balance) + '</span>' },
            { label: '', className: 'actions', render: (row) =>
              (num(row.invoice_count) === 0
                ? '<button class="btn sm secondary" data-action="billProject" data-id="' +
                  row.id + '">Bill it</button>'
                : '') +
              '<button class="btn sm" data-action="markPaid" data-id="' + row.id +
              '" data-title="' + esc(row.title) + '" data-balance="' + row.balance +
              '">Mark paid</button>' }
          ], {
            rows: data.awaitingPayment,
            empty: {
              icon: 'check', title: 'All settled',
              message: 'No completed project is waiting on payment.'
            }
          })
        }) +
        card({
          title: 'Coming up',
          flush: true,
          body: upcoming(data)
        }) +
      '</div>' +

      '<div class="grid sidebar-left">' +
        card({ title: 'Recent activity', flush: true, body: activityFeed(data.activity) }) +
        '<div class="grid c2" style="gap:14px">' +
          card({
            title: 'Latest income',
            flush: true,
            body: table([
              { label: 'Date', render: (row) => fmt.dateShort(row.received_on) },
              { label: 'From', render: (row) =>
                '<div class="row-title truncate">' +
                esc(row.client_name || row.description || row.category) + '</div>' +
                (row.project_title
                  ? '<div class="row-sub truncate">' + esc(row.project_title) + '</div>' : '') },
              { label: 'Amount', className: 'num strong', render: (row) => fmt.money(row.amount) }
            ], {
              compact: true,
              rows: data.recentIncome,
              empty: { icon: 'income', title: 'No income yet', message: 'Your entries will appear here.' }
            })
          }) +
          card({
            title: 'Latest expenses',
            flush: true,
            body: table([
              { label: 'Date', render: (row) => fmt.dateShort(row.spent_on) },
              { label: 'What', render: (row) =>
                '<div class="row-title truncate">' + esc(row.title) + '</div>' +
                '<div class="row-sub truncate">' + esc(row.category_name || 'Uncategorised') + '</div>' },
              { label: 'Amount', className: 'num strong', render: (row) => fmt.money(row.amount) }
            ], {
              compact: true,
              rows: data.recentExpenses,
              empty: { icon: 'expense', title: 'No expenses yet', message: 'Your entries will appear here.' }
            })
          }) +
        '</div>' +
      '</div>';
  }

  function banners(data, backup) {
    let html = '';

    if (backup && backup.due) {
      html += '<div class="banner warn">' + icon('shield', 17) +
        '<div><strong>A backup is due.</strong> ' +
        (backup.lastBackupAt
          ? 'The last copy was taken ' + esc(fmt.relative(backup.lastBackupAt)) + '.'
          : 'No backup has been taken yet.') +
        ' Your data lives only on this computer, so keep a copy somewhere else too.</div>' +
        '<span class="spacer"></span>' +
        '<button class="btn sm" data-action="backupNow">Back up now</button></div>';
    }

    const overdue = Number((data.receivables || {}).overdue_count || 0);
    if (overdue > 0) {
      html += '<div class="banner bad">' + icon('alert', 17) +
        '<div><strong>' + overdue + ' invoice' + (overdue === 1 ? ' is' : 's are') +
        ' past the due date</strong> — ' +
        fmt.money(data.receivables.overdue) + ' is overdue.</div>' +
        '<span class="spacer"></span>' +
        '<button class="btn sm secondary" data-action="overdueInvoices">Chase them</button></div>';
    }

    // Project deadlines. `dueProjects` only ever holds open work, so anything
    // with a day count at or below zero is genuinely late.
    const projects = data.dueProjects || [];
    const lateProjects = projects.filter((row) => num(row.days_to_due) < 0);
    const soonProjects = projects.filter((row) =>
      num(row.days_to_due) >= 0 && num(row.days_to_due) <= 7);
    if (lateProjects.length || soonProjects.length) {
      const first = (lateProjects.length ? lateProjects : soonProjects)
        .slice(0, 3).map((row) => row.title);
      html += '<div class="banner ' + (lateProjects.length ? 'bad' : 'warn') + '">' +
        icon(lateProjects.length ? 'alert' : 'bell', 17) +
        '<div><strong>' +
        (lateProjects.length
          ? lateProjects.length + ' project' + (lateProjects.length === 1 ? ' is' : 's are') +
            ' past the deadline'
          : soonProjects.length + ' deadline' + (soonProjects.length === 1 ? '' : 's') +
            ' this week') +
        '</strong> — ' + esc(first.join(', ')) +
        (first.length < (lateProjects.length || soonProjects.length) ? ' and more' : '') +
        '.</div><span class="spacer"></span>' +
        '<button class="btn sm secondary" data-action="goDeadlines">See them</button></div>';
    }

    const dueRecurring = (data.dueRecurring || []).filter((row) => num(row.days_to_due) <= 0);
    if (dueRecurring.length) {
      html += '<div class="banner">' + icon('repeat', 17) +
        '<div><strong>' + dueRecurring.length + ' recurring payment' +
        (dueRecurring.length === 1 ? '' : 's') + ' due</strong> — ' +
        esc(dueRecurring.map((row) => row.title).slice(0, 3).join(', ')) +
        (dueRecurring.length > 3 ? ' and more' : '') + '.</div>' +
        '<span class="spacer"></span>' +
        '<button class="btn sm secondary" data-action="goRecurring">Review</button></div>';
    }

    return html;
  }

  function upcoming(data) {
    const rows = [];

    (data.dueRecurring || []).forEach((row) => {
      rows.push({
        kind: 'recurring',
        id: row.id,
        when: row.next_due_date,
        days: num(row.days_to_due),
        title: row.title,
        sub: fmt.label(row.frequency) + ' · ' + (row.category_name || 'Uncategorised'),
        amount: row.amount
      });
    });

    (data.dueProjects || []).forEach((row) => {
      rows.push({
        kind: 'project',
        id: row.id,
        when: row.due_date,
        days: num(row.days_to_due),
        title: row.title,
        sub: 'Deadline · ' + (row.client_name || 'No client'),
        amount: row.amount
      });
    });

    rows.sort((a, b) => String(a.when).localeCompare(String(b.when)));

    if (!rows.length) {
      return window.UI.emptyState({
        icon: 'calendar', title: 'Nothing due',
        message: 'No deadlines or recurring payments in the next few days.'
      });
    }

    return table([
      { label: 'When', render: (row) =>
        fmt.dateShort(row.when) +
        '<div class="row-sub' + (row.days < 0 ? ' neg' : '') + '">' +
        esc(fmt.due(row.days)) + '</div>' },
      { label: 'What', render: (row) =>
        '<div class="row-title truncate">' + esc(row.title) + '</div>' +
        '<div class="row-sub truncate">' + esc(row.sub) + '</div>' },
      { label: 'Amount', className: 'num', render: (row) => fmt.money(row.amount) },
      { label: '', className: 'actions', render: (row) =>
        row.kind === 'recurring'
          ? '<button class="btn sm secondary" data-action="postRecurring" data-id="' + row.id +
            '" data-title="' + esc(row.title) + '" data-amount="' + row.amount + '">Mark paid</button>'
          : '<button class="btn sm secondary" data-action="openProject" data-id="' + row.id +
            '">Open</button>' }
    ], { rows, compact: true });
  }

  function activityFeed(entries) {
    if (!entries || !entries.length) {
      return window.UI.emptyState({
        icon: 'clock', title: 'No activity yet',
        message: 'Everything you record is logged here so you can retrace your steps.'
      });
    }
    const hollow = { deleted: true, payment_removed: true };
    return '<div class="feed">' + entries.map((entry) =>
      '<div class="feed-item">' +
        '<span class="feed-dot' + (hollow[entry.action] ? ' hollow' : '') + '"></span>' +
        '<span class="what">' + esc(entry.summary) + '</span>' +
        '<span class="when">' + esc(fmt.relative(entry.created_at)) + '</span>' +
      '</div>').join('') + '</div>';
  }

  function wire(ctx, data, backup) {
    bindActions(ctx.el, {
      allInvoices: () => ctx.go('invoices'),
      overdueInvoices: () => ctx.go('invoices', { status: 'overdue' }),
      goRecurring: () => ctx.go('expenses', { tab: 'recurring' }),
      goDeadlines: () => ctx.go('projects', { bucket: 'pending' }),
      openInvoice: (ds) => ctx.go('invoices', { action: 'open', id: Number(ds.id) }),
      openProject: (ds) => ctx.go('projects', { action: 'open', id: Number(ds.id) }),
      billProject: (ds) => ctx.go('invoices', { action: 'new', projectId: Number(ds.id) }),

      backupNow: async (ds, button) => {
        await window.UI.busy(button, async () => {
          const result = await apiSafe('backup:run', { reason: 'manual' });
          if (!result) return;
          toast('Backup saved', 'success', fmt.bytes(result.bytes) + ' · ' + result.folder);
          const status = await apiSafe('backup:status');
          if (status) window.App.setBackupStatus(status);
          ctx.refresh();
        });
      },

      markPaid: async (ds) => {
        const ok = await window.UI.confirm({
          title: 'Mark project as paid',
          message: 'Record ' + fmt.money(ds.balance) + ' received for "' + ds.title + '"?',
          detail: 'This adds an income entry dated today and marks the project fully paid.',
          confirmLabel: 'Record payment'
        });
        if (!ok) return;
        const result = await apiSafe('projects:markPaid', { id: Number(ds.id) });
        if (result) {
          toast('Payment recorded', 'success');
          ctx.refresh();
        }
      },

      postRecurring: async (ds) => {
        const ok = await window.UI.confirm({
          title: 'Record this payment',
          message: 'Post ' + fmt.money(ds.amount) + ' for "' + ds.title + '" as an expense?',
          detail: 'The schedule moves on to the next due date.',
          confirmLabel: 'Record it'
        });
        if (!ok) return;
        const result = await apiSafe('expenses:postRecurring', { id: Number(ds.id) });
        if (result) {
          toast('Expense recorded', 'success');
          ctx.refresh();
        }
      }
    });
  }
})();
