#!/usr/bin/env node
/**
 * Is what a creator made for a brand in a month read and shown right?
 *
 * The Brand GMV column: pick a whole calendar month and it is the GMV the creator made
 * from the 1st to the last day, by SALES date, from any of her videos, as Euka or
 * Reacher report it. `collab-gmv-sync` copies their answer; the screen shows it.
 * Needs nothing but this repository: the pure parts of the sync
 * (supabase/functions/_shared/collab-gmv.ts) and of the screen
 * (src/lib/admin/creator-month-gmv.ts) are imported as they are.
 *
 * Run: pnpm verify:month-gmv
 */
import {
  EUKA_CAP,
  cleanHandle,
  fromEuka,
  fromReacher,
  matchBrand,
  monthWindow,
  needsRead,
  recentMonths,
  settledAt,
} from '../../../supabase/functions/_shared/collab-gmv.ts';
import { cellFor, handleOf, rowHandles, wholeMonthOf } from '../../../src/lib/admin/creator-month-gmv.ts';

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
const at = (iso) => new Date(iso);

section('1. MONTHS');
{
  ok(JSON.stringify(recentMonths(at('2026-11-06T10:00:00Z'), 3)) === '["2026-11","2026-10","2026-09"]', 'the last three months, newest first');
  ok(JSON.stringify(recentMonths(at('2027-01-15T00:00:00Z'), 3)) === '["2027-01","2026-12","2026-11"]', 'and across a year end');
  const sep = monthWindow('2026-09', at('2026-11-06T00:00:00Z'));
  ok(sep.start === '2026-09-01' && sep.end === '2026-09-30', 'September is 1 to 30 September');
  ok(monthWindow('2028-02', at('2028-06-01T00:00:00Z')).end === '2028-02-29', 'a leap February has 29 days');
  const cur = monthWindow('2026-11', at('2026-11-06T23:59:00Z'));
  ok(cur.end === '2026-11-06', 'the running month ends today (nothing has happened later)');
  ok(wholeMonthOf({ from: '2026-09-01', to: '2026-09-30' }) === '2026-09', 'a whole month is recognised');
  ok(wholeMonthOf({ from: '2026-09-01', to: '2026-09-29' }) === null, 'a week short of a month is not');
  ok(wholeMonthOf({ from: '2026-09-02', to: '2026-09-30' }) === null, 'nor is a month starting on the 2nd');
  ok(wholeMonthOf(null) === null, 'All Time is not a month');
  ok(wholeMonthOf({ from: '2028-02-01', to: '2028-02-29' }) === '2028-02', 'a leap February is a whole month');
}

section('2. WHEN A MONTH IS READ AGAIN');
{
  const now = at('2026-11-06T12:00:00Z');
  ok(needsRead('2026-09', null, now), 'a month never read is due');
  ok(needsRead('2026-11', at('2026-11-06T05:00:00Z'), now) === true, 'this month, read 7 hours ago, is due');
  ok(needsRead('2026-11', at('2026-11-06T08:00:00Z'), now) === false, 'this month, read 4 hours ago, is not');
  ok(needsRead('2026-10', at('2026-11-05T23:00:00Z'), now) === true, 'last month, read before it settled and 13 hours ago, is due');
  ok(needsRead('2026-10', at('2026-11-06T06:00:00Z'), now) === false, 'last month, read 6 hours ago, is not');
  ok(settledAt('2026-10').toISOString().slice(0, 10) === '2026-11-09', 'October settles a week into November');
  ok(needsRead('2026-10', at('2026-11-10T00:00:00Z'), at('2026-12-20T00:00:00Z')) === false, 'a month read after it settled is never read again');
  ok(needsRead('2026-09', at('2026-10-02T00:00:00Z'), at('2026-11-06T12:00:00Z')) === true, 'September read on 2 October (before it settled) is read once more');
}

section('3. WHICH PLATFORM OWNS A BRAND');
{
  const euka = [{ name: 'Penetrex' }, { name: 'Swisse Wellness' }, { name: 'Apothecary Brands' }, { name: "Dr. Harvey's" }, { name: 'Dr Tobias' }];
  ok(matchBrand('Penetrex', euka)?.name === 'Penetrex', 'the same name');
  ok(matchBrand('Swisse', euka)?.name === 'Swisse Wellness', 'Swisse is Swisse Wellness');
  ok(matchBrand('Apothecary', euka)?.name === 'Apothecary Brands', 'Apothecary is Apothecary Brands');
  ok(matchBrand("Dr Harvey's", euka)?.name === "Dr. Harvey's", 'punctuation and case do not matter');
  ok(matchBrand('Bentgo', euka) === null, 'a brand on neither platform matches nothing');
  ok(matchBrand('Dr', [{ name: 'Dr Tobias' }, { name: "Dr. Harvey's" }]) === null, 'a prefix that two brands share is not guessed');
  ok(matchBrand('', euka) === null, 'an empty name matches nothing');
  ok(matchBrand('Irwin Naturals', [{ name: 'Biostime' }, { name: 'Irwin Naturals' }])?.name === 'Irwin Naturals', 'Irwin Naturals is a Reacher shop');
}

section('4. WHAT EUKA AND REACHER SAY BECOME ROWS');
{
  const e = fromEuka({ affiliates: [{ handle: 'ErinRaganCooper', totalGmv: 4005.09 }, { handle: '@mamaaub2', totalGmv: 3552.7 }] });
  ok(e.rows.length === 2 && e.rows[0].handle === 'erinragancooper' && e.rows[0].gmv === 4005.09, 'Euka handles are lower-cased, GMV kept to the cent');
  ok(e.rows[1].handle === 'mamaaub2', 'a leading @ is dropped');
  ok(e.truncated === false && e.floor === null, 'a list shorter than 50 is complete');
  const full = fromEuka({ affiliates: Array.from({ length: EUKA_CAP }, (_, i) => ({ handle: 'c' + i, totalGmv: 1000 - i })) });
  ok(full.truncated === true && full.floor === 951, 'a list of exactly 50 is cut, and the floor is the smallest figure (951)');
  let threw = false;
  try { fromEuka({ nope: 1 }); } catch { threw = true; }
  ok(threw, 'an answer with no list is an error, never "nobody sold"');
  const dup = fromEuka({ affiliates: [{ handle: 'a', totalGmv: 10 }, { handle: 'A', totalGmv: 5.5 }, { handle: '', totalGmv: 99 }] });
  ok(dup.rows.length === 1 && dup.rows[0].gmv === 15.5, 'one handle listed twice is added up, and a blank handle is dropped');
  ok(fromEuka({ affiliates: [{ handle: 'neg', totalGmv: -4 }] }).rows[0].gmv === 0, 'a negative figure is never GMV');
  const r = fromReacher([{ data: [{ creator_handle: 'clarkepayne3.0', gmv: 2216.05 }] }, { data: [{ creator_handle: 'Esthelaolivia', gmv: 192.97 }] }]);
  ok(r.rows.length === 2 && r.rows[1].handle === 'esthelaolivia' && r.truncated === false, 'Reacher pages are joined and the list is complete');
  threw = false;
  try { fromReacher([{ nope: 1 }]); } catch { threw = true; }
  ok(threw, 'a Reacher page with no data is an error');
  ok(cleanHandle(' @Some.Name ') === 'some.name', 'handles are cleaned the same way on both sides');
}

section('5. WHAT ONE ROW SHOWS');
{
  const row = (extra = {}) => ({ brand: 'Penetrex', tiktok_account: '@ErinRaganCooper', ...extra });
  const euka = { source: 'euka', truncated: true, floorGmv: 53.47 };
  const by = new Map([['erinragancooper', 4005.09], ['simplysarah.daily', 6507.03]]);
  const a = cellFor(row(), '2026-09', euka, by);
  ok(a.label === '$4,005' && a.gmv === 4005.09, 'a creator the platform lists shows her GMV', JSON.stringify(a));
  ok(/Euka/.test(a.title) && /September 2026/.test(a.title) && /1 to 30 September/.test(a.title), 'and the hover names the source and the dates');
  const u = cellFor(row({ tiktok_account: 'tinycreator' }), '2026-09', euka, by);
  ok(u.label === '< $53' && u.gmv === null, 'absent from a CUT Euka list: under the smallest figure, not $0', JSON.stringify(u));
  const z = cellFor(row({ tiktok_account: 'tinycreator' }), '2026-09', { source: 'reacher', truncated: false, floorGmv: null }, by);
  ok(z.label === '$0' && z.gmv === 0, 'absent from a COMPLETE list: $0', JSON.stringify(z));
  const zeroE = cellFor(row({ tiktok_account: 'tinycreator' }), '2026-09', { source: 'euka', truncated: false, floorGmv: null }, by);
  ok(zeroE.label === '$0', 'absent from an Euka list shorter than 50 is also complete: $0');
  const none = cellFor(row({ brand: 'Bentgo' }), '2026-09', null, null);
  ok(none.label === null && /Bentgo/.test(none.title), 'a brand on neither platform: a dash that says so');
  const week = cellFor(row(), null, euka, by);
  ok(week.label === null && /whole calendar month/.test(week.title), 'not a whole month: a dash that says why');
  const nohandle = cellFor(row({ tiktok_account: '' }), '2026-09', euka, by);
  ok(nohandle.label === null && /No TikTok handle/.test(nohandle.title), 'a row with no handle cannot be matched: a dash, never $0');
  const two = cellFor(row({ tiktok_account: 'erinragancooper', tiktok_account_2: 'simplysarah.daily' }), '2026-09', euka, by);
  ok(Math.round(two.gmv) === 10512, 'a creator with two accounts adds both');
  ok(handleOf('https://www.tiktok.com/@Some.Name/') === 'some.name', 'a profile link is read as the handle');
  ok(handleOf('https://www.tiktok.com/@some.name?lang=en') === 'some.name', 'a query string is dropped');
  ok(rowHandles({ tiktok_account: '@a', tiktok_account_2: 'A' }).length === 1, 'the same handle twice on a row is one');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
