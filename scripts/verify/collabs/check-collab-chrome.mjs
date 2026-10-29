#!/usr/bin/env node
/**
 * THE PAID COLLABS CHROME: FIELDS THAT ARE NOT HIGHLIGHTS, AND AN UNREAD
 * MARKER SOMEBODY CAN SEE.
 *
 *   pnpm build && pnpm preview
 *   COLLAB_STAFF_PASSWORD=... node scripts/verify/collabs/check-collab-chrome.mjs
 *
 * Both halves of this were reported by Rashid on 2026-09-03, in his words:
 * "it seems like someone has already selected the text, why is there a
 * shadow or background behind the text everywhere it needs input" and "the
 * notifications are still hidden, not seen properly".
 *
 * Neither was a mystery once measured. Every input was painted
 * `--wx-surface-2` — #f0ede8 on a white card, which is what a SELECTION looks
 * like. And the unread dot was painted `--wx-danger-soft`, a 10% wash meant
 * for surfaces, ringed in a hardcoded `#30271C` that is a dark smudge on a
 * light top bar.
 *
 * Half of this is measured in a real browser, in BOTH themes, because a token
 * can be right in the file and wrong on screen. The other half is a source
 * scan, because the offending colours were inline styles and JS hover
 * handlers that no rendered check would catch while the count is zero.
 */
import { readFileSync } from 'node:fs';
import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const EMAIL = process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com';
const PW = process.env.COLLAB_STAFF_PASSWORD || '1234567890';
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

/* ── 1 · the source, for the things a rendered check cannot see ───────── */
const ui = readFileSync('src/vendor/wurxbase/WurxUI.jsx', 'utf8');

/* The header row: bell, logs, settings, approvals. These carried a cream
   literal in their hover handlers and a 10%-opacity fill that made them
   invisible on both grounds. */
const creamHover = (ui.match(/rgba\(245,\s*233,\s*214/g) || []).length;
check(creamHover === 0, 'no hardcoded cream hover left in the header buttons', creamHover + ' found');

const faintFill = (ui.match(/color-mix\(in srgb, var\(--wx-surface-2\) 10%, transparent\)/g) || []).length;
check(faintFill === 0, 'no 10%-opacity button fills left', faintFill + ' found');

/* The unread dot specifically. */
const dotBlock = ui.slice(Math.max(0, ui.indexOf('notificationsCount > 0')), ui.indexOf('notificationsCount > 0') + 700);
check(/background: 'var\(--wx-danger\)'/.test(dotBlock),
  'the unread dot is SOLID danger, not the soft wash', dotBlock.slice(0, 90));
check(!/#[0-9a-fA-F]{6}/.test(dotBlock),
  'the unread dot carries no hardcoded hex', (dotBlock.match(/#[0-9a-fA-F]{6}/g) || []).join(','));

/* The field rule. */
const css = readFileSync('src/routes/admin/wurxbase-overrides.css', 'utf8');
check(/background: var\(--wx-field\) !important;/.test(css),
  'inputs take --wx-field, not a surface fill');
const tokens = readFileSync('src/styles/tokens.css', 'utf8');
check((tokens.match(/--wx-field:/g) || []).length === 2,
  '--wx-field is defined in BOTH themes', (tokens.match(/--wx-field:/g) || []).length + ' definitions');

/* ── 2 · and what the browser actually paints, in both themes ─────────── */
const browser = await launchBrowser();
try {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, colorScheme: theme });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PW);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
    const hi = page.getByRole('button', { name: /let.s go/i });
    if (await hi.first().isVisible().catch(() => false)) await hi.first().click();
    await page.goto(`${BASE}/admin/collabs/creators`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(14000);

    const seen = await page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const fields = [...document.querySelectorAll('.wurxbase-root input:not([type=checkbox]):not([type=radio])')]
        .filter(vis).filter((i) => !i.classList.contains('pc-mx-input'));
      const wanted = getComputedStyle(document.documentElement).getPropertyValue('--wx-field').trim();
      return {
        count: fields.length,
        backgrounds: [...new Set(fields.map((f) => getComputedStyle(f).backgroundColor))],
        borders: [...new Set(fields.map((f) => getComputedStyle(f).borderTopWidth + ' ' + getComputedStyle(f).borderTopColor))],
        edgeless: fields.filter((f) => getComputedStyle(f).borderTopWidth === '0px')
          .map((f) => (f.classList.contains('pc-chrome-input') || f.closest('[class*="monthpicker"]')
            ? 'chrome' : (f.className || f.type || 'input'))),
        fieldToken: wanted,
      };
    });
    check(seen.count > 0, `${theme}: there are fields on screen to check`, seen.count + ' fields');
    /* The old bug was surface-2: #f0ede8 light / #221e1a dark. Dark's field IS
       #221e1a on purpose, so only light can be asserted by exclusion. */
    if (theme === 'light') {
      check(!seen.backgrounds.includes('rgb(240, 237, 232)'),
        'light: no field is painted the old grey band', seen.backgrounds.join(' | '));
      check(seen.backgrounds.every((b) => b === 'rgb(255, 255, 255)' || b === 'rgba(0, 0, 0, 0)'),
        'light: fields are white, defined by their edge', seen.backgrounds.join(' | '));
    } else {
      check(seen.backgrounds.includes('rgb(34, 30, 26)'),
        'dark: fields are still a readable well', seen.backgrounds.join(' | '));
    }
    /* NOT "every field has a border". The month picker is a borderless input
       inside a pill, and giving it one rebuilds the box-inside-a-box Rashid
       has objected to twice. The question is whether a field is DISTINGUISH-
       ABLE, so: it has an edge, or it is deliberate chrome. */
    check(seen.edgeless.every((c) => c === 'chrome'),
      `${theme}: every field is either edged or deliberate chrome`, seen.edgeless.join(' | '));

    /* the panel itself must open, on screen, in this theme's colours */
    const bell = page.locator('.pc-head-bell').first();
    if (await bell.isVisible().catch(() => false)) {
      await bell.click();
      await page.waitForTimeout(1600);
      const p = await page.evaluate(() => {
        const el = document.querySelector('.notif-panel');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const onTop = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + 40));
        return {
          onScreen: r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.left >= 0,
          covered: !el.contains(onTop),
          bg: getComputedStyle(el).backgroundColor,
        };
      });
      check(p && p.onScreen, `${theme}: the notifications panel opens on screen`, JSON.stringify(p));
      check(p && !p.covered, `${theme}: and nothing is painted over it`, JSON.stringify(p));
    } else {
      check(false, `${theme}: the notifications bell is there to click`);
    }
    await ctx.close();
  }
} finally { await browser.close(); }

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
