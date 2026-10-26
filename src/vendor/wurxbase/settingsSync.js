/**
 * THE SHARED SETTINGS ROW, WITHOUT THE ECHO.
 *
 * `wurxbase.app_settings` is ONE row for the whole team (brand order, hidden brands, custom brands, the hired-by team), and every
 * open session subscribes to it. The loop this file ends, found 2026-10-27 in the usage numbers (6.5 million reads and 2.7 million
 * writes of that one row, 26 writes a second at the time, and Realtime, egress and log quotas all several times over):
 *
 *   a fetch puts the row's values into React state as NEW arrays
 *   -> the "persist" effect for that state sees a change and upserts the same values
 *   -> the update is broadcast to every session
 *   -> every session fetches, sets new arrays, upserts the same values ... for ever.
 *
 * The fix is one rule: never write back what the server already holds. This remembers, per key, the JSON of the last value the server
 * told us about (a fetch) or accepted from us (a save), and answers whether a value would change anything. A genuine edit still
 * differs, so it still saves exactly once; what a fetch just loaded never does.
 *
 * Plain functions with no React in them, so scripts/verify-settings-sync.mjs can prove the loop is gone without a browser (a browser
 * robot must never be pointed at this app: it writes to the real database).
 */

/** JSON with the keys of every object in sorted order, so the same data compares equal whichever order the database hands its keys back in. */
function json(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(json).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + json(v[k])).join(',') + '}';
}

export function createSettingsMirror() {
  const server = new Map();
  return {
    /** The server holds this value for the key (a fetch brought it, or it accepted our save of it). */
    seen(key, value) {
      server.set(key, json(value));
    },
    /** True when saving `value` would change something. A key the server was never asked about always differs. */
    differs(key, value) {
      return !server.has(key) || server.get(key) !== json(value);
    },
    /** The keys of a patch whose values really differ from what the server holds. */
    changed(patch) {
      return Object.keys(patch).filter((k) => this.differs(k, patch[k]));
    },
  };
}

/**
 * Runs `run` at most once at a time. Calls that arrive while it is running collapse into ONE more run afterwards, so a burst of
 * "settings changed" events (or a poll landing on top of one) is a single fetch, never a pile of them.
 */
export function createFetchGate(run) {
  let busy = false;
  let again = false;
  async function go() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      await run();
    } finally {
      busy = false;
      if (again) {
        again = false;
        void go();
      }
    }
  }
  return go;
}
