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
  completeWithOrders,
  linkHandle,
  linkVideoId,
  rosterHandle,
  sumCreatives,
  sumOrders,
  fromEuka,
  fromReacher,
  matchBrand,
  monthWindow,
  needsRead,
  rangeWindow,
  recentMonths,
  settledAt,
} from '../../../supabase/functions/_shared/collab-gmv.ts';
import { applyFills, monthKeyOf, videoHandleOf, videoIdOf } from '../../../src/lib/admin/matrix-autofill.ts';
import { cellFor, handleOf, periodText, rowHandles, storedMonthFor, usablePeriod, wholeMonthOf } from '../../../src/lib/admin/creator-month-gmv.ts';

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
  const padded = fromEuka({ affiliates: Array.from({ length: EUKA_CAP }, (_, i) => ({ handle: 'p' + i, totalGmv: i < 3 ? 100 - i : 0 })) });
  ok(padded.truncated === false && padded.floor === null, 'a full list that already ran down to $0 is complete (a small brand), not cut');
  const zeroCut = cellFor({ brand: 'Mineral Ice Extreme', tiktok_account: 'nobody' }, { from: '2026-10-01', to: '2026-10-31' }, { source: 'euka', truncated: true, floorGmv: 0 }, new Map([['someone', 5]]));
  ok(zeroCut.label === '$0', 'and a stored "cut" list whose floor is $0 shows $0, never "< $0"');
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
  const SEP = { from: '2026-09-01', to: '2026-09-30' };
  const row = (extra = {}) => ({ brand: 'Penetrex', tiktok_account: '@ErinRaganCooper', ...extra });
  const euka = { source: 'euka', truncated: true, floorGmv: 53.47 };
  const by = new Map([['erinragancooper', 4005.09], ['simplysarah.daily', 6507.03]]);
  const a = cellFor(row(), SEP, euka, by);
  ok(a.label === '$4,005' && a.gmv === 4005.09, 'a creator the platform lists shows her GMV', JSON.stringify(a));
  ok(/Euka/.test(a.title) && /September 2026/.test(a.title) && /by sales date/.test(a.title), 'and the hover names the source and the dates');
  const u = cellFor(row({ tiktok_account: 'tinycreator' }), SEP, euka, by);
  ok(u.label === '< $53' && u.gmv === null, 'absent from a CUT Euka list: under the smallest figure, not $0', JSON.stringify(u));
  const z = cellFor(row({ tiktok_account: 'tinycreator' }), SEP, { source: 'reacher', truncated: false, floorGmv: null }, by);
  ok(z.label === '$0' && z.gmv === 0, 'absent from a COMPLETE list: $0', JSON.stringify(z));
  const zeroE = cellFor(row({ tiktok_account: 'tinycreator' }), SEP, { source: 'euka', truncated: false, floorGmv: null }, by);
  ok(zeroE.label === '$0', 'absent from an Euka list shorter than 50 is also complete: $0');
  const none = cellFor(row({ brand: 'Bentgo' }), SEP, null, null);
  ok(none.label === null && /Bentgo/.test(none.title), 'a brand on neither platform: a dash that says so');
  const week = cellFor(row(), null, euka, by);
  ok(week.label === null && /start and an end date/.test(week.title), 'no dates picked (All Time): a dash that says why');
  const nohandle = cellFor(row({ tiktok_account: '' }), SEP, euka, by);
  ok(nohandle.label === null && /No TikTok handle/.test(nohandle.title), 'a row with no handle cannot be matched: a dash, never $0');
  const two = cellFor(row({ tiktok_account: 'erinragancooper', tiktok_account_2: 'simplysarah.daily' }), SEP, euka, by);
  ok(Math.round(two.gmv) === 10512, 'a creator with two accounts adds both');
  ok(handleOf('https://www.tiktok.com/@Some.Name/') === 'some.name', 'a profile link is read as the handle');
  ok(handleOf('https://www.tiktok.com/@some.name?lang=en') === 'some.name', 'a query string is dropped');
  ok(rowHandles({ tiktok_account: '@a', tiktok_account_2: 'A' }).length === 1, 'the same handle twice on a row is one');
}

section('7. ONLY WHAT THE USER SETS IS ASKED LIVE');
{
  const now = at('2026-11-06T09:00:00Z');
  ok(storedMonthFor({ from: '2026-11-01', to: '2026-11-06' }, now) === '2026-11', 'opening the page (This month, 1st to today) is answered from what is stored: no request');
  ok(storedMonthFor({ from: '2026-10-01', to: '2026-10-31' }, now) === '2026-10', 'a whole past month is answered from what is stored');
  ok(storedMonthFor({ from: '2026-11-01', to: '2026-11-05' }, now) === null, '1 to 5 November on the 6th is NOT the month so far: it is asked live, because the user set it');
  ok(storedMonthFor({ from: '2026-11-02', to: '2026-11-06' }, now) === null, 'a range that starts mid-month is asked live');
  ok(storedMonthFor({ from: '2026-10-15', to: '2026-11-06' }, now) === null, 'a range across months is asked live');
  ok(storedMonthFor(null, now) === null, 'no dates: nothing');
  ok(storedMonthFor({ from: '2026-10-01', to: '2026-10-30' }, at('2026-10-30T09:00:00Z')) === '2026-10', 'the month so far on the 30th is that month');
  ok(storedMonthFor({ from: '2026-10-01', to: '2026-10-29' }, at('2026-10-30T09:00:00Z')) === null, 'but not through the 29th');
}

section('8. THE PERFORMANCE SHEET FILLS ITSELF, AND NEVER OVER THE TEAM');
{
  const fill = (m, e) => applyFills(m, e);
  const a = fill({}, [{ key: '2026-10', gmv: 4005.09, adSpent: 2245.41 }]);
  ok(a && a['2026-10'].gmv === 4005.09 && a['2026-10'].adSpent === 2245.41 && a['2026-10'].auto.length === 2, 'an empty month fills GMV and Ad, and records that the sheet filled them');
  ok(applyFills(a, [{ key: '2026-10', gmv: 4005.09, adSpent: 2245.41 }]) === null, 'filling the same figures again changes nothing (so opening the sheet twice writes nothing)');
  const up = fill(a, [{ key: '2026-10', gmv: 4100.5, adSpent: 2245.41 }]);
  ok(up && up['2026-10'].gmv === 4100.5 && up['2026-10'].adSpent === 2245.41, 'a figure the sheet filled is refreshed when it moves (late sales settle)');
  const typed = { '2026-09': { gmv: 100, adSpent: 50 } };
  ok(applyFills(typed, [{ key: '2026-09', gmv: 4005.09, adSpent: 2245.41 }]) === null, 'a cell the team TYPED is never touched');
  const mixed = fill({ '2026-09': { gmv: 100 } }, [{ key: '2026-09', gmv: 999, adSpent: 70 }]);
  ok(mixed && mixed['2026-09'].gmv === 100 && mixed['2026-09'].adSpent === 70 && mixed['2026-09'].auto.length === 1 && mixed['2026-09'].auto[0] === 'adSpent', 'a typed GMV stays while the empty Ad beside it is filled');
  ok(applyFills(a, [{ key: '2026-10' }]) === null, 'no figure for a field leaves it alone: unknown is not zero');
  ok(applyFills(a, [{ key: '2026-10', gmv: 0, adSpent: 0 }]) === null, 'and a zero never removes what was filled');
  const second = fill({}, [{ key: '2026-10@other.account', gmv: 12 }]);
  ok(second && second['2026-10@other.account'].gmv === 12 && !second['2026-10'], 'a second account fills its own key');
  const other = fill({ l30: 5, perf: { hidden: false } }, [{ key: '2026-10', gmv: 3 }]);
  ok(other && other.l30 === 5 && other.perf && other['2026-10'].gmv === 3, 'the rest of the monthly record is carried across untouched');
  ok(videoIdOf('https://www.tiktok.com/@erin/video/7641255386334383390?x=1') === '7641255386334383390', 'a video id is read from the link');
  ok(videoHandleOf('https://www.tiktok.com/@ErinRaganCooper/video/764') === 'erinragancooper', 'a video link names the handle');
  ok(videoHandleOf('https://vm.tiktok.com/ZSabc/') === '', 'a short link names nobody (the handle on the row is used)');
  ok(monthKeyOf('2026-10-01') === '2026-10', 'an ad month is a sheet month');
}

section('9. EXACT FIGURES BELOW EUKA\'S TOP 50, FROM THE ORDERS');
{
  /* the 16 affiliate orders Euka returned for Dr Tobias on 15 Oct 2026, and the figures its own
     top-creators report gave for the same day: the orders must add up to the same cents */
  const KELLY = '7638828876864671006';
  const lines = [
    ['444adan', 16.19], ['cakes.by.cynthia', 17.99], ['selfless.entrepreneur', 17.09], ['', 14.39, KELLY],
    ['filmsandfitness', 17.99], ['holistic.rx', 17.99], ['auntietheinfluencer', 11.51], ['philsmypharmacist', 22.49],
    ['selfless.entrepreneur', 16.19], ['donniesdealss', 9.78], ['donniesdealss', 17.01], ['nayesilva.1', 11.18],
    ['', 14.39, KELLY], ['donniesdealss', 14.39], ['judithrtiktokshop', 9.49], ['philsmypharmacist', 22.49],
  ];
  const page = { orders: lines.map(([u, price, content], i) => ({ orderId: String(i), skus: [{ creatorUsername: u, contentId: content ?? 'x' + i, price, quantity: 1 }] })), nextPageToken: null };
  const roster = {
    handles: new Set(['philsmypharmacist', 'donniesdealss', 'selfless.entrepreneur', 'kelly.rebelwhitecoat', '444adan', 'nayesilva.1', 'quietcreator']),
    owner: new Map([[KELLY, 'kelly.rebelwhitecoat']]),
  };
  const sums = sumOrders([page], roster);
  const r2 = (h) => Math.round((sums.get(h) ?? 0) * 100) / 100;
  ok(r2('philsmypharmacist') === 44.98 && r2('donniesdealss') === 41.18 && r2('selfless.entrepreneur') === 33.28, 'orders add up to the same cents as Euka\'s report (44.98, 41.18, 33.28)');
  ok(r2('kelly.rebelwhitecoat') === 28.78, 'orders that name no creator belong to whoever posted the video (28.78, as in Euka\'s report)');
  ok(!sums.has(''), 'an order that cannot be placed is left out, as in Euka\'s list');
  const top = { rows: [{ handle: 'philsmypharmacist', gmv: 44.98 }], truncated: true, floor: 44.98 };
  const done = completeWithOrders(top, sums, roster, true);
  const got = new Map(done.rows.map((r) => [r.handle, r.gmv]));
  ok(done.truncated === false && done.floor === null, 'a cut list completed from every order page is no longer cut');
  ok(got.get('donniesdealss') === 41.18 && got.get('444adan') === 16.19 && got.get('nayesilva.1') === 11.18 && got.get('kelly.rebelwhitecoat') === 28.78, 'creators on the roster below the list get their exact figures');
  ok(!got.has('quietcreator') && done.rows.length === 6, 'a roster creator with no orders is simply absent (the screen reads that as $0)');
  ok(got.get('philsmypharmacist') === 44.98, 'a creator Euka listed keeps Euka\'s own figure');
  ok(completeWithOrders(top, sums, roster, false) === top, 'with a page missing, nothing is added: a partial sum is a lower bound, not a figure');
  const whole = { rows: [{ handle: 'a', gmv: 5 }], truncated: false, floor: null };
  ok(completeWithOrders(whole, sums, roster, true) === whole, 'a list that was never cut is left alone');
  let threw = false;
  try { sumOrders([{ nope: 1 }], roster); } catch { threw = true; }
  ok(threw, 'an orders page with no orders is an error, never "nobody sold"');
  ok(sumOrders([{ orders: [{ skus: [{ creatorUsername: 'A', price: 10, quantity: 3 }, { creatorUsername: 'a', price: -5, quantity: 1 }] }] }], roster).get('a') === 30, 'quantity multiplies the price, and a negative line is never GMV');
  ok(rosterHandle('https://www.tiktok.com/@Some.Name/') === 'some.name' && rosterHandle(' @X ') === 'x', 'roster handles are cleaned like the screen\'s');
  ok(linkHandle('https://www.tiktok.com/@Erin/video/123') === 'erin' && linkVideoId('https://www.tiktok.com/@e/video/123?x=1') === '123', 'a video link gives its handle and id');
}

section('10. AD SPEND PER CREATOR FOR A MONTH, FROM EUKA CREATIVES');
{
  /* erinragancooper at Penetrex, October 2026, as Euka listed it on 6 Nov: 19 creatives that spent
     (some of them the same video in a second campaign) and a few that spent nothing */
  const costs = [1404.7, 232.57, 151.22, 131.78, 36.37, 25.16, 18.01, 11.4, 9.4, 8.24, 8.09, 3.12, 0.99, 0.71, 0.55, 0.2, 0.17, 0.09, 0.03, 0, 0, 0];
  const page = { rows: costs.map((c, i) => ({ itemId: String(i), creatorHandle: 'erinragancooper', metrics: { cost: c } })), hasMore: false };
  const rows = sumCreatives([page, { rows: [{ creatorHandle: '@MamaAub2', metrics: { cost: 12.5 } }, { creatorHandle: 'mamaaub2', metrics: { cost: 7.25 } }, { creatorHandle: '', metrics: { cost: 99 } }, { creatorHandle: 'nobody', metrics: { cost: 0 } }, { creatorHandle: 'bad', metrics: { cost: 'x' } }] }]);
  const by = new Map(rows.map((r) => [r.handle, r.gmv]));
  ok(by.get('erinragancooper') === 2042.8, 'October ad spend is the sum of the cost of her creatives: $2,042.80 (our stale copy said $1,930.30)', String(by.get('erinragancooper')));
  ok(by.get('mamaaub2') === 19.75, 'a handle listed twice, in two spellings, is added up');
  ok(rows.length === 2, 'a row with no handle, no cost or a bad cost is left out');
  let threw = false;
  try { sumCreatives([{ nope: 1 }]); } catch { threw = true; }
  ok(threw, 'a page with no rows is an error, never "nothing was spent"');
}

section('6. ANY RANGE OF DAYS');
{
  const today = at('2026-11-06T12:00:00Z');
  const w = rangeWindow('2026-11-01', '2026-11-05', today);
  ok(w && w.start === '2026-11-01' && w.end === '2026-11-05', '1 to 5 November is asked as it is');
  ok(rangeWindow('2026-11-01', '2026-11-30', today)?.end === '2026-11-06', 'an end in the future is cut to today');
  ok(rangeWindow('2026-11-10', '2026-11-12', today) === null, 'a range entirely in the future cannot be asked');
  ok(rangeWindow('2026-11-05', '2026-11-01', today) === null, 'a start after the end is refused');
  ok(rangeWindow('2026-02-30', '2026-03-05', today) === null, 'a day that does not exist is refused');
  ok(rangeWindow('nope', '2026-03-05', today) === null, 'junk is refused');
  ok(rangeWindow('2025-01-01', '2026-11-06', today) === null, 'more than a year is refused');
  ok(rangeWindow('2025-11-07', '2026-11-06', today) !== null, 'exactly a year is allowed');
  ok(JSON.stringify(usablePeriod({ from: '2026-11-01', to: '2026-11-05' })) === '{"from":"2026-11-01","to":"2026-11-05"}', 'the screen accepts two real days');
  ok(usablePeriod({ from: '2026-11-05', to: '2026-11-01' }) === null && usablePeriod(null) === null && usablePeriod({ from: '2026-11-01' }) === null, 'and nothing else');
  ok(periodText({ from: '2026-09-01', to: '2026-09-30' }) === 'September 2026', 'a whole month reads as the month');
  ok(periodText({ from: '2026-11-01', to: '2026-11-05' }) === '1 Nov 2026 to 5 Nov 2026', 'a range reads as its two days');
  ok(periodText({ from: '2026-11-03', to: '2026-11-03' }) === '3 Nov 2026', 'one day reads as that day');
  const rng = { from: '2026-11-01', to: '2026-11-05' };
  const c = cellFor({ brand: 'Irwin Naturals', tiktok_account: 'clarkepayne3.0' }, rng, { source: 'reacher', truncated: false, floorGmv: null }, new Map([['clarkepayne3.0', 812.4]]));
  ok(c.label === '$812' && /1 Nov 2026 to 5 Nov 2026/.test(c.title) && /Reacher/.test(c.title), 'a custom range shows her GMV for those days, and the hover says so', JSON.stringify(c));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
