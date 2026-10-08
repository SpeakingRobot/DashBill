'use strict';

/**
 * The only bridge between the window and Node.
 *
 * The renderer gets one function, `api.call(channel, payload)`, plus a small
 * event subscription helper. It never sees `require`, the filesystem or the
 * database driver — a renderer bug cannot touch the disk.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Channels the main process is allowed to push to the window. */
const PUSH_CHANNELS = [
  'db:state', 'backup:done', 'backup:failed', 'menu:navigate', 'menu:action'
];

/** Channel prefixes the renderer may invoke. */
const ALLOWED_PREFIXES = [
  'app:', 'settings:', 'clients:', 'projects:', 'income:', 'expenses:',
  'invoices:', 'dashboard:', 'backup:'
];

contextBridge.exposeInMainWorld('api', {
  /**
   * Invoke a handler in the main process.
   * Always resolves to `{ ok, data }` or `{ ok: false, error }`.
   */
  call: async (channel, payload) => {
    if (typeof channel !== 'string' ||
        !ALLOWED_PREFIXES.some((prefix) => channel.startsWith(prefix))) {
      return { ok: false, error: { code: 'BAD_CHANNEL', message: `Unknown action: ${channel}` } };
    }
    try {
      return await ipcRenderer.invoke(channel, payload || {});
    } catch (err) {
      return {
        ok: false,
        error: { code: 'IPC_FAILED', message: err && err.message ? err.message : String(err) }
      };
    }
  },

  /** Subscribe to a push channel. Returns an unsubscribe function. */
  on: (channel, listener) => {
    if (!PUSH_CHANNELS.includes(channel) || typeof listener !== 'function') return () => {};
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  }
});
