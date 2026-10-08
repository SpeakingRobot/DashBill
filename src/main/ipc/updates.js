'use strict';

const { shell } = require('electron');

const db = require('../db');
const updates = require('../services/updates');
const { readSettings } = require('../services/util');

/**
 * What the window has already been shown.
 *
 * Kept in app_settings rather than on this machine so that somebody running
 * the software on their shop computer and their laptop is not told the same
 * news twice. Two keys only: the newest release they have seen, and the ids
 * of the notices they have read.
 */
const SEEN_VERSION = 'updates_seen_version';
const SEEN_NOTICES = 'updates_seen_notices';
const MAX_REMEMBERED = 60;

async function readSeen() {
  if (!db.isReady()) return { version: '', notices: [] };
  const settings = await readSettings(db);
  const raw = String(settings[SEEN_NOTICES] || '');
  return {
    version: String(settings[SEEN_VERSION] || ''),
    notices: raw ? raw.split(',').filter(Boolean) : []
  };
}

async function writeSeen({ version, notices }) {
  if (!db.isReady()) return;
  const entries = [];
  if (version !== undefined) entries.push([SEEN_VERSION, String(version).slice(0, 40)]);
  if (notices !== undefined) {
    entries.push([SEEN_NOTICES, notices.slice(0, MAX_REMEMBERED).join(',').slice(0, 4000)]);
  }
  if (!entries.length) return;
  await db.raw(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES ?
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [entries]
  );
}

module.exports = {
  /** Where the updater currently stands, without touching the network. */
  'updates:state': async () => updates.snapshot(),

  /**
   * Release notes, notices, and how many of each are new to this reader.
   *
   * `quiet` is what the window calls on start-up: it uses the half-hour cache
   * and never shows an error, because having no internet is an ordinary state
   * for this program, not a fault.
   */
  'updates:news': async ({ force, quiet } = {}) => {
    let feed;
    try {
      feed = await updates.news({ force: Boolean(force) });
    } catch (err) {
      if (quiet) {
        return { releases: [], notices: [], unread: 0, offline: true,
          current: updates.snapshot().current, errors: { releases: err.message } };
      }
      throw err;
    }

    const seen = await readSeen();
    const seenNotices = new Set(seen.notices);

    const newer = feed.releases.filter((release) =>
      !release.prerelease &&
      updates.compareVersions(release.version, feed.current) > 0 &&
      (!seen.version || updates.compareVersions(release.version, seen.version) > 0));
    const unreadNotices = feed.notices.filter((notice) => !seenNotices.has(notice.id));

    return Object.assign({}, feed, {
      newReleases: newer.map((release) => release.version),
      unreadNoticeIds: unreadNotices.map((notice) => notice.id),
      unread: newer.length + unreadNotices.length,
      offline: Boolean(feed.errors.releases && feed.errors.notices)
    });
  },

  /** Mark everything currently on offer as read. */
  'updates:markSeen': async ({ version, noticeIds } = {}) => {
    const seen = await readSeen();
    const merged = Array.from(new Set(seen.notices.concat(
      Array.isArray(noticeIds) ? noticeIds.map((id) => String(id).slice(0, 64)) : []
    )));
    const nextVersion = version &&
      updates.compareVersions(version, seen.version || '0') > 0
      ? version
      : seen.version;
    await writeSeen({ version: nextVersion, notices: merged });
    return { ok: true };
  },

  'updates:check': async ({ force } = {}) => updates.check({ force }),

  'updates:download': async () => updates.download(),

  'updates:install': async () => updates.install(),

  /** Open the releases page in the real browser, never inside the app. */
  'updates:openReleases': async () => {
    await shell.openExternal(updates.RELEASES_PAGE);
    return { opened: true };
  }
};
