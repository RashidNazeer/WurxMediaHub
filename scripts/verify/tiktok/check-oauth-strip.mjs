#!/usr/bin/env node
/**
 * TIKTOK'S RETURN PARAMETERS MUST NEVER REACH THE SUPABASE CLIENT.
 *
 *   pnpm build && pnpm preview
 *   node scripts/verify/tiktok/check-oauth-strip.mjs
 *
 * `src/lib/supabase.ts` is built with `detectSessionInUrl: true` and PKCE, so
 * the moment that module loads it looks for a `?code=` in the address and tries
 * to exchange it for a session. TikTok sends creators back to
 * /oauth/tiktok-creator/callback with exactly that shape. If the client gets
 * there first it spends a code that was never its own — and with a stale PKCE
 * verifier in storage it can take the session down with it.
 *
 * The strip therefore has to happen BEFORE the module graph loads, which is why
 * it lives in index.html. This check is the only thing that can prove it did:
 * it watches the network for a call to the auth token endpoint, which is what
 * the failure actually looks like from outside.
 */
import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const browser = await launchBrowser();
try {
  for (const path of ['/oauth/tiktok-creator/callback', '/oauth/tiktok/callback']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const authCalls = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/\/auth\/v1\/(token|verify|callback)/.test(u)) authCalls.push(`${r.method()} ${u.slice(0, 110)}`);
    });

    const code = 'zzfake-tiktok-code-do-not-spend';
    const state = 'zzfake-state';
    await page.goto(`${BASE}${path}?code=${code}&auth_code=${code}&state=${state}`,
      { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const seen = await page.evaluate(() => ({
      search: window.location.search,
      stash: (window).__wxOAuthReturn || null,
    }));

    /* THE GUARD: if the page never received the parameters at all, "no auth
       call" would be true for the wrong reason. Prove they arrived first. */
    check(!!seen.stash && seen.stash.code === code,
      `${path}: the page still RECEIVES the code (so the rest means something)`,
      JSON.stringify(seen.stash));
    check(seen.stash?.state === state, `${path}: and the state`);
    check(seen.search === '', `${path}: the address bar is clean before anything can read it`,
      `search="${seen.search}"`);
    check(authCalls.length === 0,
      `${path}: the Supabase client made NO attempt to spend TikTok's code`,
      authCalls.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
