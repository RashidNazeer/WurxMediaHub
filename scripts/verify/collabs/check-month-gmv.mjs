#!/usr/bin/env node
/**
 * Is what a creator's videos for a brand have made worked out right?
 *
 * The Brand GMV column of the Creators and Brands tables: pick a month and it is the
 * GMV, up to now, of the videos posted for that brand in that month, across all of her
 * rows, each video once. Live, never locked. Needs nothing but this repository: the
 * calculation (src/lib/admin/month-gmv.ts) is imported as it is.
 *
 * Run: pnpm verify:month-gmv
 */
import { creatorBrandGmv, gmvKey, personKey } from '../../../src/lib/admin/month-gmv.ts';

let failed = 0;
let passed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) {
    passed += 1;
    console.log('  ok   ' + name);
  } else {
    failed += 1;
    console.log('  FAIL ' + name + (extra ? '  -> ' + extra : ''));
  }
};
const section = (s) => console.log('\n' + s);

const vid = (id, who = 'x') => `https://www.tiktok.com/@${who}/video/${id}`;
const v = (id, date, revenue, extra = {}) => ({ video: vid(id), date, ...(revenue === undefined ? {} : { revenue }), ...extra });
const one = (m, brand, name) => m.get(gmvKey(brand, name));
const month = (rows, m) => creatorBrandGmv(rows, { from: `${m}-01`, to: `${m}-31` });

section('1. THE RULES, one at a time');
{
  const rows = [
    { brand: 'Aqua', name: 'Ann Lee', video_codes: [v(1001, '2026-10-03', 100), v(1002, '2026-10-20', 50.5), v(1003, '2026-09-30', 999)] },
    // a September deal that carries an October video: a per-row view would never see it
    { brand: 'Aqua', name: ' ann lee ', video_codes: [v(1004, '2026-10-08', 25)] },
    // the same video sits on two of her rows, with two different synced figures: once, the larger
    { brand: 'Aqua', name: 'ANN LEE', video_codes: [v(1001, '2026-10-03', 140)] },
    // another brand is another total
    { brand: 'Zest', name: 'Ann Lee', video_codes: [v(2001, '2026-10-05', 10)] },
    // sold nothing, never synced, and has no date
    { brand: 'Aqua', name: 'Bo Chan', video_codes: [v(3001, '2026-10-02', 0), v(3002, '2026-10-04'), v(3003, '', 500), v(3004, undefined, 500)] },
    // text revenue is read as the number the app's totals read it as; a negative figure is never GMV
    { brand: 'Aqua', name: 'Cy Dunn', video_codes: [v(4001, '2026-10-09', '12.50'), v(4002, '2026-10-10', -7)] },
    // no /video/ id: the link itself is the key, so the same link twice is one video
    { brand: 'Aqua', name: 'Di Fox', video_codes: [{ video: 'https://vm.tiktok.com/ZSabc/', date: '2026-10-11', revenue: 30 }, { video: 'https://vm.tiktok.com/ZSabc/', date: '2026-10-11', revenue: 30 }] },
  ];
  const m = month(rows, '2026-10');
  const ann = one(m, 'Aqua', 'Ann Lee');
  ok(ann && ann.gmv === 140 + 50.5 + 25, 'October is the October-posted videos only, once each, across all her rows (September\'s 999 is not in it)', JSON.stringify(ann));
  ok(ann && ann.videos === 3, 'the same video on two rows is one video, the larger figure (140, not 100 and not 240)', JSON.stringify(ann));
  ok(one(month(rows, '2026-09'), 'Aqua', 'Ann Lee')?.gmv === 999, 'September shows her September video');
  ok(one(m, 'Zest', 'Ann Lee')?.gmv === 10, 'another brand is its own total');
  ok(personKey(' ANN  lee ') !== personKey('ann lee'), 'only case and the ends of the name are normalised (inner spacing is a different person, as in the app)');
  const bo = one(m, 'Aqua', 'Bo Chan');
  ok(bo && bo.videos === 2 && bo.zero === 1 && bo.unsynced === 1 && bo.withSales === 0 && bo.gmv === 0,
    'zero, unsynced and with-sales are kept apart, and an undated video is left out of the month', JSON.stringify(bo));
  ok(one(m, 'Aqua', 'Cy Dunn')?.gmv === 12.5, 'a numeric string is read as a number, and a negative figure is never GMV');
  ok(one(m, 'Aqua', 'Di Fox')?.videos === 1 && one(m, 'Aqua', 'Di Fox')?.gmv === 30, 'a link with no id is its own key, so a repeat is one video');
  const all = creatorBrandGmv(rows, null);
  ok(one(all, 'Aqua', 'Bo Chan')?.videos === 4, 'with NO range (All Time) every video counts, dated or not');
  ok(one(all, 'Aqua', 'Ann Lee')?.gmv === 140 + 50.5 + 25 + 999, 'All Time is every video she has posted for the brand');
  ok(!creatorBrandGmv([{ brand: 'A', name: 'N', video_codes: [v(9, '2026-08-01', 5)] }], { from: '2026-10-01', to: '2026-10-31' }).size,
    'a creator with nothing posted in the month has no entry at all (the table shows a dash, not $0)');
  ok(!creatorBrandGmv([{ brand: '', name: 'N', video_codes: [v(9, '2026-10-01', 5)] }, { brand: 'A', name: '  ', video_codes: [v(9, '2026-10-01', 5)] }], null).size,
    'a row with no brand or no name belongs to nobody and is skipped');
}

section('2. LIVE: the figure follows the videos');
{
  const rows = [{ brand: 'Aqua', name: 'Ann Lee', video_codes: [v(1, '2026-10-03', 100), v(2, '2026-10-09', 50)] }];
  ok(one(month(rows, '2026-10'), 'Aqua', 'Ann Lee')?.gmv === 150, 'October is 150 today');
  rows[0].video_codes[0].revenue = 5000; // a sync raised one October video
  ok(one(month(rows, '2026-10'), 'Aqua', 'Ann Lee')?.gmv === 5050, 'after a sync raises a video, October is 5050: it is never locked');
  ok(one(month(rows, '2026-10'), 'Aqua', 'Ann Lee')?.videos === 2, 'and still the same two videos');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
