/*
 * The service worker. It exists so the app can be INSTALLED, and it is
 * deliberately almost inert beyond that.
 *
 * WHAT IT DOES NOT DO, and why that is the design rather than a gap:
 *
 * It does not precache the application bundle. `App-*.js` is over a megabyte,
 * nearly all of it the vendored Paid Collabs admin code, and a creator can
 * never open that screen. Precaching would make every creator download an
 * admin tool over mobile data to install an app. The hashed assets are already
 * served `immutable` for a year by the host, so the browser's own HTTP cache
 * is doing this job correctly and a second copy in here would only add a way
 * for it to go stale.
 *
 * It never touches anything cross-origin, which is what keeps it away from
 * Supabase. Auth tokens, sessions and every figure a creator reads come from
 * another origin, and a service worker that cached a signed-in response would
 * be a way to serve one person's numbers to the next. The origin check is the
 * guard; there is no allow-list to get wrong.
 *
 * It never caches a navigation. A page is always fetched fresh, so a deploy is
 * live the moment it lands. The cached copy is only ever the offline page, and
 * only when the network has actually failed. We have already been bitten once
 * by a cached icon surviving a deploy; the same mistake with index.html would
 * pin creators to an old build with no way to say so.
 *
 * So: fonts and icons are cached because they are stable, large-ish and fetched
 * on every cold start. Everything else goes to the network, and the only thing
 * that happens when the network is gone is a designed page instead of the
 * browser's dinosaur.
 */

const VERSION = 'prism-v1';
const SHELL = `${VERSION}-shell`;
const OFFLINE_URL = '/offline.html';

/* Stable paths only. Nothing hashed goes in here, by design. */
const PRECACHE = [
  OFFLINE_URL,
  '/icons/icon-192.png',
  '/fonts/figtree-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      /* Added one at a time: `addAll` rejects the whole install if a single
         file 404s, and an install that fails leaves the app uninstallable for
         a reason nobody would think to look for. */
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/** Stable, cacheable assets. Everything else is left to the network. */
const CACHEABLE = /^\/(fonts|icons|brand)\/|^\/(favicon|apple-touch-icon)/;

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  /* The one rule that keeps Supabase, and therefore every session and every
     figure, entirely out of this worker. */
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cached = await caches.match(OFFLINE_URL);
          return (
            cached ??
            new Response('You are offline.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        }
      })()
    );
    return;
  }

  if (!CACHEABLE.test(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      /* Only a real, complete, same-origin answer is worth keeping. */
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(SHELL);
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
