#!/usr/bin/env node
/**
 * CREATIVE ANGLES MUST BE FINDABLE BY THE WHOLE TEAM.
 *
 *   pnpm build && pnpm preview
 *   COLLAB_STAFF_PASSWORD=... node scripts/verify/angles/check-angles-visible.mjs
 *
 * WHY THIS EXISTS. Masifa set up four creative-angle tests and Asad reported
 * he could not see them. It was read as an access problem and it was not:
 * he is superadmin, and the rows were already in his browser. The tests are
 * scoped to a brand in a MONTH, they were saved against August, and the
 * report opens on the CURRENT month — so he was looking at an empty
 * September whose only message was "start your first angle".
 *
 * A screen scoped to one cycle has to name the cycle. This asserts that an
 * empty month SAYS where the tests are and that one click reaches them,
 * for a superadmin and for the IPC who wrote them.
 */
import { launchBrowser } from '../../lib/browser.mjs';
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const PW = process.env.COLLAB_STAFF_PASSWORD || '1234567890';
const WHO = [
  [process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com', 'Asad'],
  ['masifa@wurxmedia.com', 'Masifa'],
];
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const browser = await launchBrowser();
try {
  for (const [email, label] of WHO) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });

    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
    const hi = page.getByRole('button', { name: /let.s go/i });
    if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

    await page.goto(`${BASE}/admin/collabs/reporting`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(14000);

    const mirror = await page.evaluate(() => {
      try { const m = JSON.parse(localStorage.getItem('wurx_creative_angles_v1') || '{}'); return Object.keys(m).length; }
      catch { return -1; }
    });
    check(mirror >= 6, `${label}: the shared tests reached this browser`, mirror + ' brand-months in the mirror');

    const tab = page.locator('button', { hasText: /creative angle testing/i }).first();
    check(await tab.isVisible().catch(() => false), `${label}: can open the angles tab`);
    await tab.click();
    await page.waitForTimeout(9000);

    /* THE BUG: on the current month this screen was blank and said nothing. */
    const hint = await page.evaluate(() => {
      const el = document.querySelector('.cx-else');
      if (!el) return null;
      return {
        head: (el.querySelector('.cx-else-h') || {}).textContent || '',
        items: [...el.querySelectorAll('.cx-else-item')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
      };
    });
    check(hint && hint.items.length > 0,
      `${label}: an empty month now says where the tests are`,
      hint ? hint.items.length + ' offered: ' + hint.items.slice(0, 3).join(' | ') : 'NOTHING ON SCREEN');

    if (hint && hint.items.length) {
      /* one click must land on real angles */
      const target = hint.items.find((t) => /swisse/i.test(t)) || hint.items[0];
      await page.locator('.cx-else-item', { hasText: target.split(' ')[0] }).first().click();
      await page.waitForTimeout(9000);
      const landed = await page.evaluate(() => {
        const list = document.querySelector('.cx-list');
        return {
          angles: list ? list.children.length : 0,
          chips: [...document.querySelectorAll('.cx-chip')].map((c) => c.textContent.trim()),
        };
      });
      check(landed.angles > 0,
        `${label}: one click renders the actual angles`,
        landed.angles + ' angle cards, chips: ' + landed.chips.join(' / '));
      check(landed.chips.some((c) => /august/i.test(c)),
        `${label}: and the header names the month they were saved in`,
        landed.chips.join(' / '));
    }

    check(errors.length === 0, `${label}: zero console errors`, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally { await browser.close(); }

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
