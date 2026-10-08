/**
 * The in-app tutorial.
 *
 * Two things live here. `TOPICS` is the written material: a plain-English
 * description of each part of the software, the questions people actually ask
 * about it, and a short sequence of steps for a guided run-through. `run()` is
 * the player: it walks those steps, taking the window to the right page and
 * ringing the control being talked about.
 *
 * It is deliberately a tour of the real screens rather than a video or a set of
 * screenshots. Nothing here can go stale against the interface without being
 * noticed, and a person finishes the tour already looking at their own data.
 */
(function () {
  'use strict';

  const { esc, icon } = window.UI;

  // =========================================================================
  // The material
  // =========================================================================

  const TOPICS = [
    {
      id: 'start',
      label: 'Getting started',
      icon: 'dashboard',
      page: 'dashboard',
      blurb: 'What this software is for and how the pieces fit together.',
      steps: [
        { page: 'dashboard', title: 'This is your dashboard',
          text: 'Everything you have earned, spent and are still owed, in one ' +
            'screen. It is built from the entries you make on the other pages — ' +
            'you never type anything in here directly.' },
        { page: 'dashboard', selector: '#nav',
          title: 'The sidebar is the whole app',
          text: 'Money (what came in, what went out), Work (jobs, bills and the ' +
            'people you bill) and Books (reports, settings). The small numbers ' +
            'next to Projects and Invoices are things still open.' },
        { page: 'dashboard', selector: '.sidebar-foot',
          title: 'Your data lives in your own database',
          text: 'The dot shows the connection. Nothing is stored on anybody ' +
            'else’s server — these are your books, in a database only ' +
            'you hold the password to.' },
        { page: 'clients', title: 'The usual order of work',
          text: 'Add the client, add the project you agreed with them, update ' +
            'the project as the work moves, raise the invoice, and record the ' +
            'payment when it arrives. Income and the dashboard look after ' +
            'themselves from there.' },
        { page: 'settings', title: 'And everything is yours to change',
          text: 'Your business name, logo, signature, invoice numbering, tax ' +
            'defaults and the wording on the bill all live under Settings.' }
      ],
      faq: [
        { q: 'Do I have to be online to use it?',
          a: 'If your books are in a cloud database, yes — that is what lets ' +
            'you install this on a second computer and see the same data. If you ' +
            'chose MySQL on this machine during setup, no.' },
        { q: 'Where exactly is my data?',
          a: 'In the database you connected on first run, and nowhere else. ' +
            'Settings → Database shows the server, and Settings → ' +
            'Backups & data shows the folder your backup copies are written to.' },
        { q: 'Can I rename the software?',
          a: 'Yes. Settings → Company profile → Name of this software. ' +
            'It changes the sidebar, the window title and the About box.' }
      ]
    },

    {
      id: 'clients',
      label: 'Clients',
      icon: 'clients',
      page: 'clients',
      blurb: 'Register the people you work for once, and reuse them everywhere.',
      steps: [
        { page: 'clients', title: 'Everyone you bill',
          text: 'A client is registered once. From then on they appear in every ' +
            'dropdown — projects, income, invoices — so their address ' +
            'and GSTIN never have to be typed twice.' },
        { page: 'clients', selector: '#topbar-actions [data-action="new"]',
          title: 'Add a client',
          text: 'Only the name is required. The address and GSTIN are worth ' +
            'filling in because they print on the invoice exactly as entered.' },
        { page: 'clients', selector: '#clients-list',
          title: 'Each row is a running total',
          text: 'How much work you have done for them, how much they have paid ' +
            'and what is still outstanding. Click a row for the full history.' }
      ],
      faq: [
        { q: 'Why does the client’s state matter?',
          a: 'For GST. If you use the split form of tax, a client in your own ' +
            'state gets CGST + SGST and a client in another state gets IGST. ' +
            'The invoice decides that from the two state fields.' },
        { q: 'What happens if I delete a client?',
          a: 'Their projects, invoices and income entries stay exactly as they ' +
            'are and simply lose the link. Your totals never change because a ' +
            'client was removed.' },
        { q: 'Can I hide a client I no longer work with?',
          a: 'Mark them inactive instead of deleting. They drop out of the ' +
            'dropdowns but all their history stays.' }
      ]
    },

    {
      id: 'projects',
      label: 'Projects',
      icon: 'projects',
      page: 'projects',
      blurb: 'Every job you take on, its deadline, its status and what it is worth.',
      steps: [
        { page: 'projects', title: 'One entry per job',
          text: 'A project is a job you have agreed to do, with a price. ' +
            'Everything else on this page follows from keeping its status up to ' +
            'date as the work moves.' },
        { page: 'projects', selector: '.tabs',
          title: 'Three ways to look at the same work',
          text: 'This first tab is where everything is changed — adding a job, ' +
            'moving it along, recording what you were paid. The other two are ' +
            'purely for looking.' },
        { page: 'projects', title: 'The status board',
          text: 'A column for each stage — in progress, submitted, planned, ' +
            'completed — so you can see where every job stands without ' +
            'reading a table. Anything overdue or due within the week is called ' +
            'out at the top. Click any card to open that job.' },
        { page: 'projects', title: 'Payments',
          text: 'Who still owes you, and how much. Work you have finished but not ' +
            'been paid for is listed first, because that is the money worth ' +
            'chasing.' },
        { page: 'projects', selector: 'table.data [data-action="advance"]',
          title: 'Move the work along',
          text: 'Each row offers the one button that makes sense next: Start ' +
            'work, Mark submitted, Mark completed. The status changes ' +
            'immediately.' },
        { page: 'projects', title: 'Completed is not the same as paid',
          text: 'Finishing the work and being paid for it are two separate steps ' +
            'on purpose. Mark it completed when you deliver; mark it paid only ' +
            'when the money actually arrives — and the income entry is ' +
            'written for you.' }
      ],
      faq: [
        { q: 'Why can I not mark a project paid straight away?',
          a: 'Mark it Completed first. The two steps are kept apart so your ' +
            '"done but not paid" list is always honest. For an advance or a part ' +
            'payment use Record payment, which works at any stage.' },
        { q: 'How do I know a deadline is coming up?',
          a: 'The Status board lists anything overdue or due within seven days ' +
            'at the top, the Deadline column counts down in red, and the ' +
            'dashboard repeats it. The welcome screen tells you too.' },
        { q: 'Why can I not change anything on the Status board?',
          a: 'On purpose. Those two tabs are for looking, so there is nothing to ' +
            'press by accident while you are reading. Click any row or card and ' +
            'it opens that job, where every button lives.' },
        { q: 'What does Record payment do that Mark paid does not?',
          a: 'Record payment takes any amount, so it handles advances and part ' +
            'payments. Mark paid settles the whole remaining balance in one go.' },
        { q: 'Can I delete a project?',
          a: 'Only while no income is attached to it. Once money has been ' +
            'recorded against a job, set its status to Cancelled instead — ' +
            'that closes it without rewriting your books.' }
      ]
    },

    {
      id: 'invoices',
      label: 'Invoices',
      icon: 'invoice',
      page: 'invoices',
      blurb: 'Raise a professional GST invoice and send it as a PDF.',
      steps: [
        { page: 'invoices', selector: '.tabs',
          title: 'Two tabs: raising bills, and chasing them',
          text: 'The first is every invoice you have issued, and where you raise, ' +
            'edit and get paid for them. The second is read-only — who owes ' +
            'you, grouped by how long they have kept you waiting.' },
        { page: 'invoices', selector: '#topbar-actions [data-action="new"]',
          title: 'A new invoice',
          text: 'Pick the client and the lines fill in from the project if there ' +
            'is one. The number is generated for you from the format in ' +
            'Settings, and you can always overwrite it.' },
        { page: 'invoices', title: 'Choose your own columns',
          text: 'Item, rate, quantity and amount are always there. Quantity can ' +
            'be switched off for flat-fee work, and you can add your own ' +
            'columns — Size, Finish, whatever your trade needs.' },
        { page: 'invoices', title: 'GST the way you actually bill',
          text: 'One combined GST line is the usual choice. CGST + SGST and IGST ' +
            'are there when you need the split form, and No GST for work that ' +
            'carries none.' },
        { page: 'invoices', title: 'Preview, then PDF',
          text: 'The preview is the real document, not an approximation — ' +
            'the PDF is printed from exactly what you see, logo, signature and ' +
            'all.' }
      ],
      faq: [
        { q: 'How do I put my signature on the invoice?',
          a: 'Settings → Company profile → Signature. Upload a ' +
            'transparent PNG of your signature and it prints on the signature ' +
            'line of every invoice from then on.' },
        { q: 'Can I change the invoice number?',
          a: 'Yes, on the invoice itself. The format and the running counter are ' +
            'under Settings → Invoice defaults, and a number already used is ' +
            'skipped automatically.' },
        { q: 'The payment details at the bottom are wrong for this one bill.',
          a: 'They are editable per invoice. Change them on the invoice and only ' +
            'that invoice carries the change; everything else keeps the bank ' +
            'details from your profile.' },
        { q: 'How do I delete an invoice?',
          a: 'The delete button on its row in the list. You are asked to ' +
            'confirm, and any payments recorded against it go with it.' },
        { q: 'How do I see who still owes me?',
          a: 'Invoices → Money owed. It lists every unpaid bill grouped by how ' +
            'late it is — inside terms, one to thirty days, thirty to sixty, ' +
            'over sixty — with a summary of which client owes the most. ' +
            'Clicking any row opens that bill.' },
        { q: 'Where does the PDF go?',
          a: 'Wherever you choose when you save it — the app remembers the ' +
            'last folder you used. Nothing is uploaded anywhere.' }
      ]
    },

    {
      id: 'income',
      label: 'Income',
      icon: 'income',
      page: 'income',
      blurb: 'Everything that came in, whether or not it came from a project.',
      steps: [
        { page: 'income', title: 'Your receipts ledger',
          text: 'Every rupee that came in, in one list. Most entries arrive here ' +
            'on their own when you mark a project paid or record an invoice ' +
            'payment.' },
        { page: 'income', selector: '#topbar-actions [data-action="new"]',
          title: 'Add something by hand',
          text: 'For money that did not come through a project — a one-off ' +
            'job, a refund, interest. Either pick the client, or say in a word ' +
            'where it came from.' },
        { page: 'income', selector: '#i-range',
          title: 'Filter by period',
          text: 'This month, last month, this financial year, or any two dates ' +
            'you choose. The totals above the table follow the filter.' }
      ],
      faq: [
        { q: 'Why can I not edit some entries?',
          a: 'Entries created by a project payment or an invoice payment belong ' +
            'to that record. Change them where they came from and the ledger ' +
            'follows, so the two can never disagree.' },
        { q: 'Do I need a client on every entry?',
          a: 'No — but if there is no client you are asked for a reason ' +
            'instead, so that no entry in your books is unexplained.' },
        { q: 'Is this the same as my bank balance?',
          a: 'No. This is what you earned. What you have left is income minus ' +
            'expenses, which is the figure the dashboard calls Net.' }
      ]
    },

    {
      id: 'expenses',
      label: 'Expenses',
      icon: 'expense',
      page: 'expenses',
      blurb: 'Materials, bills, reinvestment, loans and personal spending.',
      steps: [
        { page: 'expenses', title: 'Everything that went out',
          text: 'Materials and inks, rent and subscriptions, equipment you ' +
            'bought back into the business, loan repayments, and personal ' +
            'spending kept separate from the business.' },
        { page: 'expenses', selector: '#e-kind',
          title: 'Grouped by kind',
          text: 'Each category belongs to a kind, and the kind is what the ' +
            'reports add up. It is the difference between "I spent a lot" and ' +
            '"I spent a lot on materials".' },
        { page: 'expenses', title: 'Recurring bills',
          text: 'Anything that comes round every month or year is entered once ' +
            'and then reminds you. The dashboard tells you what is due.' },
        { page: 'expenses', title: 'Tag a cost to a job',
          text: 'Put a project on an expense and that job’s page shows what ' +
            'it cost you to deliver — and therefore what you actually made ' +
            'on it.' }
      ],
      faq: [
        { q: 'Should personal spending go in here?',
          a: 'You can, and it is kept under its own kind so it never muddles the ' +
            'business figures. The reports can show it separately or leave it ' +
            'out.' },
        { q: 'What is reinvestment?',
          a: 'Money put back into the business rather than consumed — a new ' +
            'printer, a laptop, a licence. Keeping it apart from running costs ' +
            'stops a good month looking like a bad one.' },
        { q: 'How do recurring expenses work?',
          a: 'You set the amount and how often it falls due. When the date ' +
            'arrives it is flagged on the dashboard, and recording it writes a ' +
            'normal expense and moves the due date on.' }
      ]
    },

    {
      id: 'reports',
      label: 'Reports',
      icon: 'reports',
      page: 'reports',
      blurb: 'What you made over a period, and where it went.',
      steps: [
        { page: 'reports', title: 'The figures, for any period',
          text: 'Income, expenses and what is left, for whatever range you ' +
            'choose — a month, a quarter, the financial year.' },
        { page: 'reports', selector: '#r-preset',
          title: 'Pick the period',
          text: 'The presets cover the usual ones. Or set two dates yourself and ' +
            'press Apply.' },
        { page: 'reports', title: 'Use it at tax time',
          text: 'The financial-year view is the one to take to your accountant: ' +
            'total billed, total received, GST collected and expenses by kind.' }
      ],
      faq: [
        { q: 'Which financial year does it use?',
          a: 'The Indian one — 1 April to 31 March. The year is worked out ' +
            'from the date, so in February you are still looking at the year ' +
            'that began the previous April.' },
        { q: 'Does it count invoices or payments?',
          a: 'Income counts money actually received. Invoices raised but not yet ' +
            'paid show as outstanding, not as income.' }
      ]
    },

    {
      id: 'backups',
      label: 'Backups & safety',
      icon: 'shield',
      page: 'settings',
      blurb: 'Keeping a copy of your books somewhere other than the database.',
      steps: [
        { page: 'settings', title: 'Backups are under Settings',
          text: 'The "Backups & data" tab. A backup is a single file containing ' +
            'every table — clients, projects, income, expenses, invoices, ' +
            'your logo and your settings.' },
        { page: 'settings', title: 'It runs on its own',
          text: 'A copy is taken on the schedule you set, and optionally when ' +
            'you close the app. You choose the folder — put it somewhere ' +
            'that syncs, like OneDrive or Google Drive.' },
        { page: 'settings', title: 'Restoring',
          text: 'Restore replaces what is in the database with what is in the ' +
            'file. It asks twice, because it cannot be undone.' }
      ],
      faq: [
        { q: 'If my laptop dies, do I lose everything?',
          a: 'No, if your books are in a cloud database — install the ' +
            'software on the new machine, enter the same connection details and ' +
            'everything is there. The backup folder is your second line of ' +
            'defence, and it is worth having one.' },
        { q: 'How often should I back up?',
          a: 'The default of a fortnight suits most people. If you bill every ' +
            'day, make it weekly.' },
        { q: 'Can I open a backup file myself?',
          a: 'Yes. It is plain SQL — readable in any text editor and ' +
            'loadable into any MySQL server.' }
      ]
    },

    {
      id: 'settings',
      label: 'Settings & branding',
      icon: 'settings',
      page: 'settings',
      blurb: 'Your name, logo, signature and the wording on every invoice.',
      steps: [
        { page: 'settings', title: 'This is what prints on your bills',
          text: 'Company profile holds your name, address, GSTIN, bank details, ' +
            'logo and signature. Fill it in once and every invoice from then on ' +
            'carries it.' },
        { page: 'settings', title: 'Your signature',
          text: 'Upload a transparent PNG of your signature and it prints on the ' +
            'signature line above "Authorised Signatory" — no more printing ' +
            'a bill just to sign it.' },
        { page: 'settings', title: 'Invoice defaults',
          text: 'Numbering format, the GST treatment new invoices start with, ' +
            'payment terms and the footer note. All of it can still be changed ' +
            'on an individual invoice.' }
      ],
      faq: [
        { q: 'What size should my logo be?',
          a: 'A square mark around 600 × 600 pixels, under 1 MB. It is ' +
            'stored inside your database, so it travels with your backups.' },
        { q: 'How do I make my signature transparent?',
          a: 'Sign a white sheet in black ink, photograph or scan it, and remove ' +
            'the white background in any photo editor or free background ' +
            'remover. Save as PNG. A JPG will work but brings a white box with ' +
            'it.' },
        { q: 'Can two computers use the same books?',
          a: 'Yes — install the software on both and give each the same ' +
            'database connection details. Both then read and write the same ' +
            'books.' }
      ]
    }
  ];

  const byId = {};
  TOPICS.forEach((topic) => { byId[topic.id] = topic; });

  // =========================================================================
  // The player
  // =========================================================================

  let session = null;

  /** Poll for an element, because a page render is asynchronous. */
  function waitForElement(selector, limit) {
    const deadline = Date.now() + (limit || 3500);
    return new Promise((resolve) => {
      const tick = () => {
        const found = document.querySelector(selector);
        if (found) { resolve(found); return; }
        if (Date.now() > deadline) { resolve(null); return; }
        setTimeout(tick, 90);
      };
      tick();
    });
  }

  function host() {
    let el = document.getElementById('tour');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'tour';
    el.innerHTML =
      '<div class="tour-ring" hidden></div>' +
      '<div class="tour-card" role="dialog" aria-label="Tutorial">' +
        '<div class="tour-progress"><i></i></div>' +
        '<div class="tour-head">' +
          '<span class="tour-topic"></span>' +
          '<span class="spacer"></span>' +
          '<span class="tour-count"></span>' +
          '<button class="btn ghost icon tour-x" title="End the tour">' +
            icon('close', 15) + '</button>' +
        '</div>' +
        '<div class="tour-body"><h3></h3><p></p></div>' +
        '<div class="tour-foot">' +
          '<button class="btn ghost sm tour-back">Back</button>' +
          '<span class="spacer"></span>' +
          '<button class="btn sm tour-next">Next</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelector('.tour-x').addEventListener('click', () => stop());
    el.querySelector('.tour-back').addEventListener('click', () => move(-1));
    el.querySelector('.tour-next').addEventListener('click', () => move(1));
    return el;
  }

  /** Draw the ring around the control this step is talking about. */
  function ring(target) {
    const el = document.getElementById('tour');
    if (!el) return;
    const ringEl = el.querySelector('.tour-ring');
    if (!target) { ringEl.hidden = true; return; }
    const box = target.getBoundingClientRect();
    if (!box.width && !box.height) { ringEl.hidden = true; return; }
    const pad = 6;
    ringEl.hidden = false;
    ringEl.style.left = Math.max(2, box.left - pad) + 'px';
    ringEl.style.top = Math.max(2, box.top - pad) + 'px';
    ringEl.style.width = (box.width + pad * 2) + 'px';
    ringEl.style.height = (box.height + pad * 2) + 'px';
  }

  function reposition() {
    if (!session || !session.target) return;
    if (!document.body.contains(session.target)) { ring(null); return; }
    ring(session.target);
  }

  async function show() {
    if (!session) return;
    const step = session.steps[session.index];
    const el = host();
    el.classList.add('open');

    // Take the window to the page this step is about, if it is not there.
    if (step.page && window.App && window.App.current !== step.page) {
      window.UI.closeAllModals();
      await window.App.go(step.page);
      if (!session) return;
    }

    const target = step.selector ? await waitForElement(step.selector) : null;
    if (!session) return;
    session.target = target;
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(reposition, 320);
    }
    ring(target);

    el.querySelector('.tour-topic').textContent = session.label;
    el.querySelector('.tour-count').textContent =
      (session.index + 1) + ' of ' + session.steps.length;
    el.querySelector('.tour-body h3').textContent = step.title;
    el.querySelector('.tour-body p').textContent = step.text;
    el.querySelector('.tour-progress i').style.width =
      Math.round(((session.index + 1) / session.steps.length) * 100) + '%';
    el.querySelector('.tour-back').disabled = session.index === 0;
    el.querySelector('.tour-next').textContent =
      session.index === session.steps.length - 1 ? 'Finish' : 'Next';
  }

  function move(delta) {
    if (!session) return;
    const next = session.index + delta;
    if (next < 0) return;
    if (next >= session.steps.length) { stop(true); return; }
    session.index = next;
    show();
  }

  function stop(finished) {
    const el = document.getElementById('tour');
    if (el) {
      el.classList.remove('open');
      el.querySelector('.tour-ring').hidden = true;
    }
    const was = session;
    session = null;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', reposition);
    if (was && finished) {
      window.UI.toast('Run-through finished', 'success',
        'Settings → Help & tutorial has them all, any time.');
    }
  }

  function onKey(event) {
    if (!session) return;
    if (event.key === 'Escape') { event.stopPropagation(); stop(); }
    else if (event.key === 'ArrowRight') move(1);
    else if (event.key === 'ArrowLeft') move(-1);
  }

  /** Start a run-through. `id` is a topic id, or 'all' for the whole tour. */
  function run(id) {
    const steps = [];
    let label = '';
    if (id === 'all') {
      label = 'Full run-through';
      TOPICS.forEach((topic) => topic.steps.forEach((step) => steps.push(step)));
    } else {
      const topic = byId[id];
      if (!topic) return;
      label = topic.label;
      topic.steps.forEach((step) => steps.push(step));
    }
    if (!steps.length) return;

    window.UI.closeAllModals();
    session = { steps, index: 0, label, target: null };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    const view = document.getElementById('view');
    if (view) view.addEventListener('scroll', reposition, { passive: true });
    show();
  }

  /** The topic whose run-through fits the page currently on screen. */
  function topicForPage(page) {
    const match = TOPICS.filter((topic) => topic.page === page);
    return match.length ? match[0] : byId.start;
  }

  window.Guide = {
    TOPICS,
    topic: (id) => byId[id],
    topicForPage,
    run,
    stop,
    running: () => Boolean(session),
    esc
  };
})();
