'use strict';

/**
 * Updates and news.
 *
 * Two separate things share this file because they come from the same place.
 *
 *   Updates   A new version is published as a GitHub Release. The app asks
 *             GitHub whether there is a newer one, downloads the installer and
 *             runs it. The installer replaces the program files and nothing
 *             else: the database is somewhere else entirely, and the
 *             connection details live in the user's own profile folder, so an
 *             update never touches anybody's books or credentials.
 *
 *             A packaged application cannot rebuild itself from source — that
 *             would need Node, npm and the build toolchain on every user's
 *             machine — so "pull the update from GitHub" means fetching the
 *             installer that was built from that source, with its checksum
 *             verified before anything is run.
 *
 *   News      Release notes come from the releases themselves. Short notices
 *             between releases come from `notices.json` in the same public
 *             repository, which the admin tool writes.
 *
 * Everything fetched here is DATA. Notice and release text is shown to the
 * reader as plain text and is never executed, never used to build a URL and
 * never allowed to decide what this program does.
 */

const https = require('https');
const { app } = require('electron');

/** The one repository this app will talk to. Not configurable at runtime. */
const OWNER = 'SpeakingRobot';
const REPO = 'DashBill';

const RELEASES_URL =
  `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=12`;
const NOTICES_URL =
  `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/notices.json`;
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases`;

/** Generous ceilings. A feed bigger than this is a mistake, not a feature. */
const MAX_BYTES = 512 * 1024;
const MAX_NOTICES = 40;
const MAX_RELEASES = 12;
const REQUEST_TIMEOUT = 12000;
const NEWS_CACHE_MS = 30 * 60 * 1000;

let autoUpdater = null;
let send = () => {};
let newsCache = null;
let newsCachedAt = 0;

const state = {
  // idle | checking | available | downloading | downloaded | current | error
  status: 'idle',
  version: null,        // the version on offer, when there is one
  notes: '',
  percent: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0,
  error: null,
  checkedAt: null,
  canSelfUpdate: false
};

function snapshot() {
  return Object.assign({ current: app.getVersion(), releasesPage: RELEASES_PAGE }, state);
}

function set(patch) {
  Object.assign(state, patch);
  send('updates:state', snapshot());
}

// ---------------------------------------------------------------------------
// Plain HTTPS fetch
// ---------------------------------------------------------------------------

/**
 * GET a JSON document over HTTPS.
 *
 * Only ever called with the two constant URLs above. Redirects are followed
 * only within github.com, so a redirect cannot walk this off to somewhere
 * else, and the body is capped so a huge or endless response cannot sit in
 * memory.
 */
function getJson(url, depth) {
  return new Promise((resolve, reject) => {
    if ((depth || 0) > 3) { reject(new Error('Too many redirects.')); return; }
    let parsed;
    try { parsed = new URL(url); } catch { reject(new Error('Bad URL.')); return; }
    if (parsed.protocol !== 'https:' ||
        !/(^|\.)github\.com$|(^|\.)githubusercontent\.com$/.test(parsed.hostname)) {
      reject(new Error('Refusing to fetch from ' + parsed.hostname));
      return;
    }

    const request = https.get(url, {
      headers: {
        'User-Agent': `DashBill/${app.getVersion()}`,
        Accept: 'application/json'
      },
      timeout: REQUEST_TIMEOUT
    }, (response) => {
      const code = response.statusCode || 0;
      if (code >= 300 && code < 400 && response.headers.location) {
        response.resume();
        resolve(getJson(new URL(response.headers.location, url).toString(), (depth || 0) + 1));
        return;
      }
      if (code === 404) { response.resume(); resolve(null); return; }
      if (code !== 200) {
        response.resume();
        reject(new Error(`GitHub replied ${code}.`));
        return;
      }

      let size = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          request.destroy();
          reject(new Error('That feed is unexpectedly large; ignoring it.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('That feed is not readable JSON.')); }
      });
    });

    request.on('timeout', () => {
      request.destroy();
      reject(new Error('GitHub did not answer in time.'));
    });
    request.on('error', (err) => reject(new Error(err.message)));
  });
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/** Compare two dotted versions. Returns 1, 0 or -1. Pre-release tags ignored. */
function compareVersions(a, b) {
  const parts = (value) => String(value || '0').replace(/^v/i, '').split('-')[0]
    .split('.').map((n) => parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// News: release notes and admin notices
// ---------------------------------------------------------------------------

function text(value, limit) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\u0000/g, '')
    .slice(0, limit || 4000);
}

/** Keep only the fields we display, at sane lengths. */
function cleanRelease(row) {
  if (!row || typeof row !== 'object') return null;
  const version = text(row.tag_name || row.name, 40).replace(/^v/i, '');
  if (!version) return null;
  return {
    version,
    title: text(row.name || ('Version ' + version), 160),
    notes: text(row.body, 8000),
    publishedAt: text(row.published_at || row.created_at, 40),
    prerelease: Boolean(row.prerelease),
    url: /^https:\/\/github\.com\//.test(String(row.html_url || ''))
      ? String(row.html_url)
      : RELEASES_PAGE
  };
}

const NOTICE_KINDS = ['info', 'update', 'warning'];

function cleanNotice(row) {
  if (!row || typeof row !== 'object') return null;
  const title = text(row.title, 160).trim();
  if (!title) return null;
  return {
    id: text(row.id, 64) || title.slice(0, 40),
    title,
    body: text(row.body, 4000),
    kind: NOTICE_KINDS.includes(row.kind) ? row.kind : 'info',
    postedAt: text(row.postedAt || row.posted_at, 40),
    pinned: Boolean(row.pinned),
    // A notice may say it is about one version; it can never say anything else.
    version: text(row.version, 40).replace(/^v/i, '')
  };
}

/**
 * Fetch release notes and notices together. Either half may fail on its own —
 * no network is a normal state for this app, not an error worth shouting
 * about — so each is reported separately and whatever arrived is returned.
 */
async function news({ force } = {}) {
  if (!force && newsCache && Date.now() - newsCachedAt < NEWS_CACHE_MS) {
    return newsCache;
  }

  const [releasesResult, noticesResult] = await Promise.allSettled([
    getJson(RELEASES_URL),
    getJson(NOTICES_URL)
  ]);

  const releases = releasesResult.status === 'fulfilled' && Array.isArray(releasesResult.value)
    ? releasesResult.value.slice(0, MAX_RELEASES).map(cleanRelease).filter(Boolean)
    : [];

  const raw = noticesResult.status === 'fulfilled' ? noticesResult.value : null;
  const list = raw && Array.isArray(raw.notices) ? raw.notices
    : (Array.isArray(raw) ? raw : []);
  const notices = list.slice(0, MAX_NOTICES).map(cleanNotice).filter(Boolean);

  const result = {
    releases,
    notices,
    current: app.getVersion(),
    releasesPage: RELEASES_PAGE,
    fetchedAt: new Date().toISOString(),
    errors: {
      releases: releasesResult.status === 'rejected' ? releasesResult.reason.message : null,
      notices: noticesResult.status === 'rejected' ? noticesResult.reason.message : null
    }
  };
  newsCache = result;
  newsCachedAt = Date.now();
  return result;
}

// ---------------------------------------------------------------------------
// The updater itself
// ---------------------------------------------------------------------------

/**
 * electron-updater only works in a packaged application: it needs the
 * installer metadata that `npm run dist` writes beside the .exe. Running from
 * source, the version check still happens — it is only the download that is
 * unavailable, and the window says so rather than failing silently.
 */
function packaged() {
  return app.isPackaged;
}

function updater() {
  if (autoUpdater) return autoUpdater;
  // Required lazily so that merely loading this file costs nothing.
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO });
  autoUpdater.logger = {
    info: (m) => console.log('[update]', m),
    warn: (m) => console.warn('[update]', m),
    error: (m) => console.error('[update]', m),
    debug: () => {}
  };

  autoUpdater.on('update-available', (info) => set({
    status: 'available', version: info.version, notes: '', error: null
  }));
  autoUpdater.on('update-not-available', () => set({
    status: 'current', version: null, error: null
  }));
  autoUpdater.on('download-progress', (p) => set({
    status: 'downloading',
    percent: Math.round(p.percent || 0),
    bytesPerSecond: Math.round(p.bytesPerSecond || 0),
    transferred: p.transferred || 0,
    total: p.total || 0
  }));
  autoUpdater.on('update-downloaded', (info) => set({
    status: 'downloaded', version: info.version, percent: 100, error: null
  }));
  autoUpdater.on('error', (err) => set({
    status: 'error',
    error: friendlyUpdateError(err && err.message ? err.message : String(err))
  }));

  return autoUpdater;
}

/** Turn the updater's internal wording into something actionable. */
function friendlyUpdateError(message) {
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|network/i.test(message)) {
    return 'Could not reach GitHub. Check your internet connection and try again.';
  }
  if (/latest\.yml|Cannot find channel|404/i.test(message)) {
    return 'That release has no update metadata attached, so it cannot be installed ' +
      'automatically. Download the installer from the releases page instead.';
  }
  if (/sha512|checksum|integrity/i.test(message)) {
    return 'The downloaded file did not match its checksum and was discarded. ' +
      'Nothing was installed. Try again, or download it from the releases page.';
  }
  return message;
}

/**
 * Ask whether there is a newer version.
 *
 * The GitHub Releases API is the source of truth for "is there one and what
 * changed"; the updater is what actually installs it. Asking the API as well
 * means the window can show release notes, and can still tell the user about
 * a new version when running from source or when the metadata is missing.
 */
async function check({ force } = {}) {
  set({ status: 'checking', error: null });
  let latest = null;
  try {
    const feed = await news({ force: true });
    const stable = feed.releases.filter((release) => !release.prerelease);
    latest = stable.length ? stable[0] : null;
  } catch (err) {
    set({ status: 'error', error: err.message, checkedAt: new Date().toISOString() });
    return snapshot();
  }

  const newer = latest && compareVersions(latest.version, app.getVersion()) > 0;
  set({
    checkedAt: new Date().toISOString(),
    canSelfUpdate: packaged(),
    version: newer ? latest.version : null,
    notes: newer ? latest.notes : '',
    status: newer ? 'available' : 'current'
  });

  // In a packaged build let the updater confirm it can see the same release,
  // so a missing latest.yml is reported now rather than on pressing Install.
  if (newer && packaged()) {
    try { await updater().checkForUpdates(); }
    catch (err) {
      set({ status: 'available', error: friendlyUpdateError(err.message) });
    }
  }
  void force;
  return snapshot();
}

async function download() {
  if (!packaged()) {
    throw new Error(
      'Automatic installation only works in an installed copy. This one is running ' +
      'from source, so update it with git and npm run dist instead.'
    );
  }
  if (state.status !== 'available' && state.status !== 'error') {
    throw new Error('Check for updates first.');
  }
  set({ status: 'downloading', percent: 0, error: null });
  await updater().downloadUpdate();
  return snapshot();
}

/**
 * Quit and run the installer.
 *
 * The installer upgrades the program files in place. `config.json` lives in
 * the per-user application data folder and is not touched, so the database
 * connection, the window size and the backup schedule all survive — and the
 * books themselves were never on this machine in the first place.
 */
function install() {
  if (state.status !== 'downloaded') {
    throw new Error('Download the update first.');
  }
  setImmediate(() => updater().quitAndInstall(false, true));
  return { installing: true };
}

function configure(pusher) {
  send = typeof pusher === 'function' ? pusher : () => {};
  state.canSelfUpdate = packaged();
}

module.exports = {
  configure, check, download, install, news, snapshot,
  compareVersions, cleanNotice, cleanRelease,
  RELEASES_PAGE, NOTICES_URL, OWNER, REPO
};
