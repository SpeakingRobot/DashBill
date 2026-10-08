/**
 * Application shell: navigation, routing, the first-run setup screen and the
 * small amount of global state the pages share.
 */
(function () {
  'use strict';

  const { api, apiSafe, esc, icon, toast, fmt } = window.UI;

  const NAV = [
    { group: 'Overview', items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' }
    ] },
    { group: 'Money', items: [
      { id: 'income', label: 'Income', icon: 'income' },
      { id: 'expenses', label: 'Expenses', icon: 'expense' }
    ] },
    { group: 'Work', items: [
      { id: 'projects', label: 'Projects', icon: 'projects', count: 'openProjects' },
      { id: 'invoices', label: 'Invoices', icon: 'invoice', count: 'outstandingInvoices' },
      { id: 'clients', label: 'Clients', icon: 'clients' }
    ] },
    { group: 'Books', items: [
      { id: 'reports', label: 'Reports', icon: 'reports' },
      { id: 'settings', label: 'Settings', icon: 'settings' }
    ] }
  ];

  const App = {
    current: null,
    params: {},
    ready: false,
    settings: {},
    counts: {},
    bootstrap: null
  };
  window.App = App;

  const viewEl = () => document.getElementById('view');
  const actionsEl = () => document.getElementById('topbar-actions');
  const gateEl = (id) => document.getElementById(id);

  // =========================================================================
  // Navigation
  // =========================================================================

  function renderNav() {
    const nav = document.getElementById('nav');
    let html = '';
    NAV.forEach((group) => {
      html += '<div class="nav-group-label">' + esc(group.group) + '</div>';
      group.items.forEach((item) => {
        html += '<button class="nav-item" data-page="' + item.id + '">' +
          '<span class="ico">' + icon(item.icon, 16) + '</span>' +
          '<span>' + esc(item.label) + '</span>' +
          (item.count ? '<span class="count" data-count="' + item.count + '" hidden></span>' : '') +
          '</button>';
      });
    });
    nav.innerHTML = html;
    nav.querySelectorAll('[data-page]').forEach((button) => {
      button.addEventListener('click', () => go(button.getAttribute('data-page')));
    });
  }

  function markActive(page) {
    document.querySelectorAll('#nav .nav-item').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-page') === page);
    });
  }

  /**
   * Navigate. `params` is handed to the page and also drives deep actions,
   * e.g. go('invoices', { action: 'new', projectId: 4 }).
   *
   * Only one navigation runs at a time. A page render is asynchronous, so two
   * overlapping ones both write to the same `#view` and the slower one lands
   * last — leaving the title from one page above the contents of another.
   * Over a cloud database that is easy to trigger just by clicking through the
   * sidebar quickly. A request that arrives mid-render is therefore held, and
   * only the most recent one runs afterwards, so you always end up on the page
   * you asked for last.
   */
  let navInFlight = false;
  let pendingNav = null;

  async function go(page, params) {
    const definition = window.Pages[page];
    if (!definition) {
      toast('Unknown page: ' + page, 'error');
      return;
    }
    if (navInFlight) {
      pendingNav = [page, params];
      return;
    }
    navInFlight = true;
    try {
      await navigate(definition, page, params);
    } finally {
      navInFlight = false;
      const next = pendingNav;
      pendingNav = null;
      if (next) await go(next[0], next[1]);
    }
  }
  App.go = go;

  async function navigate(definition, page, params) {
    App.current = page;
    App.params = params || {};

    // A dialog belongs to the page that opened it; leaving the page closes it.
    window.UI.closeAllModals();

    markActive(page);
    document.getElementById('page-title').textContent = definition.title;
    document.getElementById('crumb').textContent = definition.crumb || '';
    actionsEl().innerHTML = '';
    const view = viewEl();
    view.classList.toggle('flush', Boolean(definition.flush));
    view.innerHTML = window.UI.loading(7);
    view.scrollTop = 0;

    try {
      await definition.render({
        el: view,
        actions: actionsEl(),
        params: App.params,
        go,
        refresh: () => go(page, App.params)
      });
    } catch (err) {
      view.innerHTML = '<div class="banner bad">' + icon('alert', 17) +
        '<div><strong>This page could not load.</strong><br>' + esc(err.message) + '</div></div>';
      console.error(err);
    }
    refreshCounts();
  }

  async function refreshCounts() {
    const counts = await apiSafe('dashboard:counts');
    if (!counts) return;
    App.counts = counts;
    document.querySelectorAll('#nav [data-count]').forEach((span) => {
      const value = Number(counts[span.getAttribute('data-count')] || 0);
      span.hidden = value <= 0;
      span.textContent = String(value);
    });
  }
  App.refreshCounts = refreshCounts;

  // =========================================================================
  // First-run setup
  // =========================================================================

  /** Which kind of database the user picked on the first screen. */
  let gateMode = 'tidb';

  function showGate(error) {
    gateEl('gate').classList.add('open');
    const box = gateEl('gate-error');
    if (error) {
      box.classList.remove('hidden');
      box.innerHTML = '<strong>Could not connect.</strong>' +
        esc(error.hint || '') +
        '<br><code>' + esc(error.code || '') + ': ' +
        esc(String(error.message || '').slice(0, 300)) + '</code>';
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      box.classList.add('hidden');
    }
  }

  function hideGate() { gateEl('gate').classList.remove('open'); }

  const TIDB_HELP = [
    'Create a free account at <strong>tidbcloud.com</strong> and add a ' +
      '<strong>Serverless</strong> cluster. Pick the region nearest to you.',
    'Open the cluster and press <strong>Connect</strong>. Choose ' +
      '<strong>General</strong> under &ldquo;Connect With&rdquo;, then generate a ' +
      'password if you have not already. Keep that password somewhere safe &mdash; ' +
      'it is shown only once.',
    'Copy the connection string, paste it in the box above, and press ' +
      '<strong>Fill in the form from this</strong>.',
    'Press <strong>Connect and set up</strong>. The database and all its tables are ' +
      'created for you, and you land on the dashboard.'
  ];

  const MYSQL_HELP = [
    'Install <strong>MySQL Community Server 8</strong> from dev.mysql.com. During ' +
      'setup tick <em>Configure MySQL Server as a Windows Service</em> and ' +
      '<em>Start the service at System Startup</em>, and set a root password you ' +
      'will remember.',
    'Check the service is running: press <code>Win+R</code>, type ' +
      '<code>services.msc</code>, find <code>MySQL80</code> and start it if it is ' +
      'stopped.',
    'Leave the host as <code>127.0.0.1</code> and the port as <code>3306</code>, ' +
      'enter <code>root</code> with your root password, then press ' +
      '<strong>Connect and set up</strong>.'
  ];

  /** Switch the setup screen between the two kinds of database. */
  function selectGateMode(mode) {
    gateMode = mode;
    const isCloud = mode === 'tidb';

    gateEl('gate-choice').classList.add('hidden');
    gateEl('gate-form').classList.remove('hidden');
    gateEl('gate-paste').classList.toggle('hidden', !isCloud);
    gateEl('gate-form-title').textContent = isCloud
      ? 'TiDB Cloud connection details'
      : 'Local MySQL connection details';

    const saved = (App.bootstrap && App.bootstrap.database) || {};
    const sameKind = saved.mode === mode;

    gateEl('gate-host').value = sameKind && saved.host ? saved.host : (isCloud ? '' : '127.0.0.1');
    gateEl('gate-port').value = sameKind && saved.port ? saved.port : (isCloud ? 4000 : 3306);
    gateEl('gate-user').value = sameKind && saved.user ? saved.user : (isCloud ? '' : 'root');
    gateEl('gate-database').value = saved.database || 'anjoy_billings';
    gateEl('gate-ssl').checked = isCloud;
    gateEl('gate-ssl-note').textContent = isCloud
      ? 'Required by TiDB Cloud and every other hosted database. Leave this on.'
      : 'A MySQL server on this computer does not normally use TLS. Leave this off ' +
        'unless you have set up certificates yourself.';

    gateEl('gate-help').innerHTML = (isCloud ? TIDB_HELP : MYSQL_HELP)
      .map((step) => '<li>' + step + '</li>').join('');

    showGate(null);
    gateEl('gate-status').textContent = '';
    const focusTarget = isCloud ? gateEl('gate-conn') : gateEl('gate-password');
    setTimeout(() => focusTarget.focus(), 60);
  }

  function gateValues() {
    return {
      mode: gateMode,
      host: gateEl('gate-host').value.trim(),
      port: Number(gateEl('gate-port').value) || (gateMode === 'tidb' ? 4000 : 3306),
      user: gateEl('gate-user').value.trim(),
      password: gateEl('gate-password').value,
      database: gateEl('gate-database').value.trim(),
      ssl: gateEl('gate-ssl').checked ? 1 : 0
    };
  }

  function wireGate() {
    gateEl('choice-ico-cloud').innerHTML = icon('database', 18);
    gateEl('choice-ico-local').innerHTML = icon('shield', 18);

    document.querySelectorAll('#gate-choice .choice').forEach((button) => {
      button.addEventListener('click', () => selectGateMode(button.getAttribute('data-mode')));
    });

    gateEl('gate-back').addEventListener('click', () => {
      gateEl('gate-form').classList.add('hidden');
      gateEl('gate-choice').classList.remove('hidden');
      showGate(null);
    });

    // Paste a connection string, get every field filled in.
    gateEl('gate-fill').addEventListener('click', async () => {
      const result = await apiSafe('settings:parseConnectionString',
        { text: gateEl('gate-conn').value });
      if (!result) return;
      if (!result.ok) {
        showGate({ code: 'Could not read it', message: result.error.message, hint: '' });
        return;
      }
      const v = result.value;
      gateEl('gate-host').value = v.host;
      gateEl('gate-port').value = v.port;
      gateEl('gate-user').value = v.user;
      gateEl('gate-password').value = v.password;
      gateEl('gate-database').value = v.database;
      gateEl('gate-ssl').checked = Boolean(v.ssl);
      showGate(null);
      gateEl('gate-status').textContent = 'Filled in — now press Connect.';
      toast('Connection details filled in', 'success');
    });

    const status = gateEl('gate-status');

    gateEl('gate-test').addEventListener('click', async (event) => {
      status.textContent = 'Testing…';
      await window.UI.busy(event.currentTarget, async () => {
        const result = await apiSafe('settings:testDb', gateValues());
        if (!result) { status.textContent = ''; return; }
        if (result.ok) {
          status.textContent = 'Reached the server — ' + result.version;
          showGate(null);
        } else {
          status.textContent = '';
          showGate(result.error);
        }
      });
    });

    gateEl('gate-connect').addEventListener('click', async (event) => {
      status.textContent = 'Connecting and preparing the database…';
      await window.UI.busy(event.currentTarget, async () => {
        const result = await apiSafe('settings:saveDb', gateValues());
        if (!result) { status.textContent = ''; return; }
        if (!result.ok) {
          status.textContent = '';
          showGate(result.error);
          return;
        }
        status.textContent = '';

        // A brand-new database still needs a business name and logo on it.
        const loaded = await apiSafe('settings:get');
        const onboarded = loaded && loaded.settings &&
          String(loaded.settings.onboarded || '0') === '1';
        if (onboarded) {
          hideGate();
          await afterConnect();
          toast('Connected', 'success', 'Your database is ready to use.');
        } else {
          showBrandStep();
        }
      });
    });

    // Enter submits from any field on the form.
    ['gate-password', 'gate-host', 'gate-user', 'gate-database'].forEach((id) => {
      gateEl(id).addEventListener('keydown', (event) => {
        if (event.key === 'Enter') gateEl('gate-connect').click();
      });
    });

    wireBrandStep();
  }

  /** Step three of the wizard: whose business this copy belongs to. */
  function showBrandStep() {
    gateEl('gate-choice').classList.add('hidden');
    gateEl('gate-form').classList.add('hidden');
    gateEl('gate-brand').classList.remove('hidden');
    gateEl('gate-brand-tick').innerHTML = icon('check', 17);
    showGate(null);
    setTimeout(() => gateEl('brand-name').focus(), 80);
  }

  function wireBrandStep() {
    const nameEl = gateEl('brand-name');
    const prefixEl = gateEl('brand-prefix');
    const previewEl = gateEl('brand-number-preview');
    const status = gateEl('brand-status');

    /** Suggest an invoice prefix from the initials of the business name. */
    const suggestPrefix = () => {
      if (prefixEl.dataset.touched === '1') return;
      const initials = nameEl.value.trim().split(/\s+/).filter(Boolean)
        .slice(0, 3).map((word) => word[0]).join('').toUpperCase();
      prefixEl.value = initials || 'INV';
      refreshNumber();
    };
    const refreshNumber = () => {
      const year = new Date().getFullYear();
      const fy = new Date().getMonth() + 1 >= 4 ? year : year - 1;
      previewEl.textContent = (prefixEl.value || 'INV') + '/' + fy + '-' +
        String((fy + 1) % 100).padStart(2, '0') + '/001';
    };

    nameEl.addEventListener('input', suggestPrefix);
    prefixEl.addEventListener('input', () => {
      prefixEl.dataset.touched = '1';
      refreshNumber();
    });
    refreshNumber();

    gateEl('brand-logo-pick').addEventListener('click', async (event) => {
      await window.UI.busy(event.currentTarget, async () => {
        const result = await apiSafe('settings:pickLogo');
        if (!result || result.canceled) return;
        setBrandLogo(result.logo);
        status.textContent = 'Logo added';
      });
    });

    gateEl('brand-logo-clear').addEventListener('click', async () => {
      await apiSafe('settings:clearLogo');
      setBrandLogo('');
      status.textContent = '';
    });

    gateEl('brand-finish').addEventListener('click', async (event) => {
      if (!nameEl.value.trim()) {
        showGate({ code: 'Business name', message: 'Enter your business name.', hint: '' });
        nameEl.focus();
        return;
      }
      await window.UI.busy(event.currentTarget, finishSetup);
    });

    gateEl('brand-skip').addEventListener('click', async () => {
      // Skipping still marks the install set up; everything is editable later.
      await apiSafe('settings:save', { settings: { onboarded: '1' } });
      hideGate();
      await afterConnect();
      toast('You can add your business details any time', 'info',
        'Settings → Company profile');
    });

    nameEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') gateEl('brand-finish').click();
    });
  }

  function setBrandLogo(dataUrl) {
    const box = gateEl('brand-logo-preview');
    const clear = gateEl('brand-logo-clear');
    if (dataUrl) {
      box.innerHTML = '<img src="' + esc(dataUrl) + '" alt="Your logo">';
      clear.classList.remove('hidden');
      gateEl('brand-logo-pick').textContent = 'Choose a different logo';
    } else {
      box.innerHTML = '<span class="logo-empty">No logo yet</span>';
      clear.classList.add('hidden');
      gateEl('brand-logo-pick').textContent = 'Choose a logo';
    }
  }

  async function finishSetup() {
    const result = await apiSafe('settings:completeSetup', {
      company_name: gateEl('brand-name').value,
      company_tagline: gateEl('brand-tagline').value,
      invoice_prefix: gateEl('brand-prefix').value,
      app_display_name: gateEl('brand-appname').value
    });
    if (!result) return;
    hideGate();
    await afterConnect();
    toast('All set up', 'success', 'Your business details are on every invoice now.');
  }

  // =========================================================================
  // Status strip in the sidebar
  // =========================================================================

  function setDbStatus(ready, label) {
    document.getElementById('db-dot').classList.toggle('off', !ready);
    document.getElementById('db-label').innerHTML = label;
  }

  function setBackupStatus(backup) {
    const el = document.getElementById('backup-label');
    if (!backup) { el.innerHTML = ''; return; }
    if (!backup.lastBackupAt) {
      el.innerHTML = '<strong>Backup:</strong> never taken';
      return;
    }
    const days = backup.daysSinceBackup;
    const when = days === 0 ? 'today' : (days === 1 ? 'yesterday' : days + ' days ago');
    el.innerHTML = '<strong>Backup:</strong> ' + esc(when) +
      (backup.due ? ' <span style="color:#e0a030">(due)</span>' : '');
  }
  App.setBackupStatus = setBackupStatus;

  // =========================================================================
  // Boot
  // =========================================================================

  async function loadSettings() {
    // Once per session, with the logo; later reads leave it out and reuse this.
    const result = await apiSafe('settings:get', { withLogo: 1 });
    if (result && result.settings) {
      App.settings = result.settings;
      window.UI.setCurrency(result.settings.currency_symbol);
      applyBranding(result.settings);
    }
  }

  /**
   * Put the business on the sidebar and in the window title: their logo (or
   * their initials), their name, and whatever this copy of the software is
   * called underneath. Called again whenever Settings are saved.
   */
  function applyBranding(settings) {
    const product = String(settings.app_display_name || 'DashBill').trim() || 'DashBill';
    const business = String(settings.company_name || '').trim();
    const logo = String(settings.company_logo || '').trim();

    const initials = business
      ? business.split(/\s+/).filter(Boolean).slice(0, 2)
        .map((word) => word[0].toUpperCase()).join('')
      : '';

    const badge = document.getElementById('brand-badge');
    badge.innerHTML = logo
      ? '<img src="' + esc(logo) + '" alt="">'
      : esc(initials || product.slice(0, 2).toUpperCase());

    document.getElementById('brand-title').textContent = business || product;
    document.getElementById('brand-subtitle').textContent = business
      ? product
      : 'Budget · Invoicing';
    document.title = business ? business + ' — ' + product : product;
  }
  App.applyBranding = applyBranding;

  async function afterConnect() {
    App.ready = true;
    const boot = await apiSafe('app:bootstrap');
    App.bootstrap = boot;
    if (boot) {
      const where = boot.database.mode === 'tidb' ? 'TiDB Cloud' : boot.database.host;
      setDbStatus(true,
        '<strong>' + esc(boot.database.database) + '</strong> on ' + esc(where));
      setBackupStatus(boot.backup);
    }
    await loadSettings();
    renderNav();
    await go('dashboard');
  }

  let booted = false;
  async function boot() {
    if (booted) return;
    booted = true;

    wireGate();
    renderNav();

    const info = await apiSafe('app:bootstrap');
    App.bootstrap = info;

    if (info && info.ready) {
      hideGate();
      await afterConnect();
      return;
    }

    setDbStatus(false, 'Not connected');

    // A machine that has been set up before goes straight to the form it used,
    // with the error that stopped it. A fresh install starts at the choice.
    if (info && info.configured && info.database && info.database.host) {
      showGate(info.error);
      selectGateMode(info.database.mode === 'mysql' ? 'mysql' : 'tidb');
      showGate(info.error);
    } else {
      showGate(null);
    }
  }

  // Pushed messages from the main process ----------------------------------
  window.api.on('db:state', async (state) => {
    if (state.ready) {
      hideGate();
      if (!App.ready) await afterConnect();
    } else {
      App.ready = false;
      setDbStatus(false, 'Not connected');
      const info = App.bootstrap;
      if (info && info.configured && info.database && info.database.host) {
        showGate(state.error);
        selectGateMode(info.database.mode === 'mysql' ? 'mysql' : 'tidb');
        showGate(state.error);
      } else {
        showGate(state.error);
      }
    }
  });

  window.api.on('backup:done', (result) => {
    toast('Backup saved', 'success',
      result.path ? result.path.split(/[\\/]/).pop() : '');
    apiSafe('backup:status').then((status) => { if (status) setBackupStatus(status); });
  });

  window.api.on('backup:failed', (payload) => {
    toast('Automatic backup failed', 'error', payload.message);
  });

  window.api.on('menu:navigate', (payload) => {
    if (!App.ready) return;
    go(payload.page, payload.action ? { action: payload.action } : {});
  });

  window.api.on('menu:action', async (payload) => {
    if (payload.action === 'refresh') {
      if (App.ready) go(App.current || 'dashboard', App.params);
    } else if (payload.action === 'backup') {
      if (!App.ready) return;
      toast('Taking a backup…');
      const result = await apiSafe('backup:run', { reason: 'manual' });
      if (result) {
        toast('Backup saved', 'success', fmt.bytes(result.bytes) + ' · ' + result.folder);
        const status = await apiSafe('backup:status');
        if (status) setBackupStatus(status);
      }
    } else if (payload.action === 'openBackups') {
      apiSafe('backup:openFolder');
    }
  });

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
