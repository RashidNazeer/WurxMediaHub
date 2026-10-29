#!/usr/bin/env node
/**
 * The brand page's date range, proved without a browser.
 *
 * Two bugs reached Rashid on this feature, and both were the kind a test like
 * this catches in a second:
 *
 *   - the picker was handed `window: undefined`, so `presetToRange` returned
 *     NULL for every preset, the control read "All time" and nothing filtered;
 *   - an identifier was used outside the component that declared it.
 *
 * The second is covered by the scope checker. This covers the first, and the
 * filtering rule itself, because "no data is updating" is a silent failure:
 * the page still renders, still looks right, and simply shows the wrong set.
 *
 * Run: node scripts/verify/collabs/check-collab-period.mjs
 */
import { presetToRange, PRESETS } from '../../../src/lib/creator/date-range.ts';
import { clipCreatorsToRange } from '../../../src/lib/admin/collab-period.ts';

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(want)}`);
};
const ok = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${detail}`}`);
};

/* The window the brand page builds: earliest evidence to today. */
const today = new Date().toISOString().slice(0, 10);
const win = { earliest: '2026-01-01', latest: today, videos: 0 };

console.log('\nTHE PRESETS RESOLVE TO REAL DATES\n');
for (const p of PRESETS) {
  const r = presetToRange(p.key, win);
  /*
   * `prevYear` is EXPECTED to be null against this window, and that is correct
   * rather than a failure: the window starts on 2026-01-01, so the whole of
   * 2025 lies before the brand's first evidence and `clamp` rightly reports
   * that there is nothing there. Asserting it resolved was my mistake, not the
   * code's. Every preset that OVERLAPS the window must resolve.
   */
  const expectNull = p.key === 'prevYear' && win.earliest > `${Number(today.slice(0, 4)) - 1}-12-31`;
  if (expectNull) ok(`${p.label} is empty for a brand with no data that year`, r === null);
  else ok(`${p.label} resolves`, r && r.from && r.to, '-> null, which is what made the control say "All time"');
}

/* And with a window that does reach back, it resolves like the rest. */
const wide = { earliest: '2024-02-01', latest: today, videos: 0 };
const prev = presetToRange('prevYear', wide);
ok('Previous calendar year resolves when the brand has data that far back', prev && prev.from && prev.to);

console.log('\n  and WITHOUT a window they all return null, which is the bug that shipped:');
const nulls = PRESETS.filter((p) => presetToRange(p.key, undefined) === null).length;
ok(`every preset returns null when window is undefined (${nulls}/${PRESETS.length})`, nulls === PRESETS.length);

console.log('\nTHE FILTER KEEPS THE RIGHT VIDEOS\n');
const creators = [
  {
    name: 'A',
    video_codes: [
      { video: 'v1', date: '2026-09-02', revenue: 100, views: 10 },
      { video: 'v2', date: '2026-09-20', revenue: 200, views: 20 },
      { video: 'v3', date: '2026-10-05', revenue: 400, views: 40 },
      { video: 'v4', revenue: 50, views: 5 }, /* undated: a hand-typed row */
    ],
  },
  { name: 'B', video_codes: [] },
];

const inSep = clipCreatorsToRange(creators, { from: '2026-09-01', to: '2026-09-30' });
check(
  'September keeps only September, plus the undated row',
  inSep[0].video_codes.map((v) => v.video),
  ['v1', 'v2', 'v4'],
);
const week = clipCreatorsToRange(creators, { from: '2026-09-15', to: '2026-09-25' });
check('a narrow window keeps only what falls inside it', week[0].video_codes.map((v) => v.video), ['v2', 'v4']);

ok('a null range is a no-op and returns the same array', clipCreatorsToRange(creators, null) === creators);
ok('a creator with no videos is untouched', inSep[1] === creators[1]);

/* The sums the cards show must follow from the filter, not be recomputed. */
const gmv = (list) =>
  list.reduce((t, c) => t + (c.video_codes || []).reduce((s, v) => s + (Number(v.revenue) || 0), 0), 0);
check('September GMV is the sum of September videos (+ the undated row)', gmv(inSep), 350);
check('October-only GMV', gmv(clipCreatorsToRange(creators, { from: '2026-10-01', to: '2026-10-31' })), 450);

console.log(failed ? `\n${failed} CHECK(S) FAILED\n` : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
