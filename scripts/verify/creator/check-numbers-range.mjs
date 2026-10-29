/* The new date-range calendar and brand dropdown on /app/numbers.
   Signs in as the demo creator, opens the picker, picks a preset, drags out a
   custom range, and checks the figures actually change and nothing spills. */
const { launchBrowser } = await import('../../lib/browser.mjs');
const BASE = process.env.BASE_URL || 'http://localhost:4179';
const EMAIL = process.env.CREATOR_EMAIL ?? 'skinbyamara@wurxmediahub.demo';
const PASSWORD = process.env.CREATOR_PASSWORD ?? 'demo-password-for-dev-only-1';

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 160)));

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForURL((u) => !/\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
const hi = page.getByRole('button', { name: /let.s go/i });
if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

await page.goto(`${BASE}/app/numbers`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const trigger = page.getByRole('button', { name: /choose a date range|all time|last /i }).first();
const triggerVisible = await trigger.isVisible().catch(() => false);
check(triggerVisible, 'the date-range button is on the screen');

/* The old fixed tabs must be gone. */
const oldTabs = await page.getByRole('tab', { name: /^(7 days|30 days|By month)$/ }).count();
check(oldTabs === 0, 'the old fixed range tabs are gone', `${oldTabs} left`);

if (triggerVisible) {
  const before = (await page.locator('main').innerText()).slice(0, 2000);

  await trigger.click();
  const panel = page.getByRole('dialog', { name: /choose a date range/i });
  check(await panel.isVisible().catch(() => false), 'the calendar opens');

  const presetCount = await panel.getByRole('button', { name: /last 7 days|last 30 days|last 90 days|last 6 months|last 12 months|previous calendar year|this month|last month|all time/i }).count();
  check(presetCount >= 9, 'all nine shortcuts are offered', `${presetCount} found`);

  const dayCount = await panel.locator('button[aria-label]').count();
  check(dayCount > 30, 'the calendar draws days', `${dayCount} day buttons`);

  /* Escape closes and focus returns. */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(!(await panel.isVisible().catch(() => false)), 'Escape closes the calendar');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup'));
  check(focused === 'dialog', 'focus returns to the trigger after Escape', String(focused));

  /* Pick a preset and prove the screen reacts. */
  await trigger.click();
  await panel.getByRole('button', { name: /^last 30 days$/i }).click();
  await page.waitForTimeout(2500);
  const label = (await trigger.innerText()).trim();
  check(/last 30 days/i.test(label), 'the button shows the chosen range', label);
  const after = (await page.locator('main').innerText()).slice(0, 2000);
  check(after !== before, 'the figures changed when the range changed');

  /* A custom range: two clicks on day cells. */
  await trigger.click();
  const days = panel.locator('button[aria-label]:not([disabled])');
  const n = await days.count();
  if (n >= 2) {
    await days.nth(Math.max(0, n - 8)).click();
    await days.nth(n - 1).click();
    await page.waitForTimeout(2500);
    const custom = (await trigger.innerText()).trim();
    check(/\d/.test(custom) && !/last 30 days/i.test(custom), 'a custom range is applied and labelled', custom);
  } else {
    check(false, 'enough selectable days to make a custom range', `${n}`);
  }
}

/* The brand dropdown. */
const brandSel = page.getByLabel('Which brand');
const hasBrand = await brandSel.isVisible().catch(() => false);
const opts = hasBrand ? await brandSel.locator('option').count() : 0;
console.log(`  brand dropdown present: ${hasBrand}${hasBrand ? ` with ${opts} options` : ' (creator has <2 brands, so it is deliberately hidden)'}`);
if (hasBrand && opts > 1) {
  const before = (await page.locator('main').innerText()).slice(0, 1200);
  await brandSel.selectOption({ index: 1 });
  await page.waitForTimeout(2500);
  const after = (await page.locator('main').innerText()).slice(0, 1200);
  check(after !== before, 'choosing a brand changes the figures');
  check((await brandSel.locator('option').count()) === opts, 'the brand list does not shrink after choosing one', `${await brandSel.locator('option').count()} vs ${opts}`);
}

/* Widths: the popover is the thing most likely to push the page sideways. */
for (const w of [1440, 1024, 768, 375]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(600);
  const t2 = page.getByRole('button', { name: /all time|last |\d{4}/i }).first();
  if (await t2.isVisible().catch(() => false)) {
    await t2.click();
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"][aria-label="Choose a date range"]');
      const r = el?.getBoundingClientRect();
      return {
        open: !!el,
        offRight: r ? Math.round(r.right - window.innerWidth) : 0,
        offLeft: r ? Math.round(r.left) : 0,
        pageScroll: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    check(m.open, `${w}px: the calendar opens`);
    check(m.offRight <= 1 && m.offLeft >= -1, `${w}px: the calendar stays inside the viewport`, `left ${m.offLeft}, overflow right ${m.offRight}`);
    check(m.pageScroll <= 1, `${w}px: no horizontal page scroll with it open`, `${m.pageScroll}px`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  } else {
    check(false, `${w}px: the date-range button is reachable`);
  }
}

check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
await browser.close();

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
