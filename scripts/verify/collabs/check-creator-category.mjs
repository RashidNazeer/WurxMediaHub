#!/usr/bin/env node
/**
 * Does a creator's Category fill from Euka, and only where nobody typed one?
 *
 * Pure parts of `supabase/functions/_shared/creator-category.ts`, imported as they are.
 * Run: pnpm verify:creator-category
 */
import { categoriesFromRank, dueHandles, labelFrom, mayFill, planWrites } from '../../../supabase/functions/_shared/creator-category.ts';

let failed = 0;
let passed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { passed += 1; console.log('  ok   ' + name); }
  else { failed += 1; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
};
const section = (s) => console.log('\n' + s);
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-06T12:00:00Z');

section('1. THE LABEL');
ok(labelFrom(['Beauty & Personal Care', 'Health', 'Pet Supplies']) === 'Beauty & Personal Care / Health', 'the first two of Euka\'s three');
ok(labelFrom(['Health']) === 'Health', 'one is one');
ok(labelFrom(['Health', 'health', ' Health ']) === 'Health', 'repeats collapse');
ok(labelFrom([]) === '' && labelFrom(null) === '' && labelFrom(['', null]) === '', 'nothing is an empty cell, never "undefined"');

section('2. THE ANSWER IS HER, OR NOTHING');
const rank = { data: [
  { creator_handle: 'maddie', category_list: ['Home Supplies'] },
  { creator_handle: '@Maddie.Restucci', category_list: ['Beauty & Personal Care', 'Health', 'Food & Beverages', 'Pets'] },
  { creator_handle: 'nocats' },
] };
ok(JSON.stringify(categoriesFromRank(rank, 'maddie.restucci')) === '["Beauty & Personal Care","Health","Food & Beverages"]', 'an exact handle (case and @ aside) gives her top three');
ok(categoriesFromRank(rank, 'maddie.r') === null, 'a near miss is a miss');
ok(JSON.stringify(categoriesFromRank(rank, 'nocats')) === '[]', 'her, with no category listed, is empty and not a miss');
ok(categoriesFromRank({ data: [] }, 'x') === null && categoriesFromRank(null, 'x') === null && categoriesFromRank(rank, '') === null, 'no rows, no payload, no handle: a miss');
ok(JSON.stringify(categoriesFromRank([{ creator_handle: 'a', category_list: ['X'] }], 'a')) === '["X"]', 'a bare array answer is read as well');

section('3. WHAT MAY BE WRITTEN');
const row = (id, category, a, b = null) => ({ id, category, tiktok_account: a, tiktok_account_2: b });
const stored = (label, written = null, found = true, checkedAt = NOW) => ({ label, written, found, checkedAt });
ok(mayFill(row(1, null, 'a'), null) && mayFill(row(1, '  ', 'a'), null), 'an empty Category may be filled');
ok(!mayFill(row(1, 'health/beauty', 'a'), null), 'one a person typed may not');
ok(mayFill(row(1, 'Health', 'a'), 'Health') && !mayFill(row(1, 'Health', 'a'), 'Beauty'), 'the sync\'s own text may be refreshed; text typed over it may not');
{
  const roster = [row(1, '', '@Ann'), row(2, 'health/beauty', 'ann'), row(3, null, 'https://www.tiktok.com/@ann'), row(4, null, 'bob'), row(5, null, '', ''), row(6, null, 'cy', 'ann')];
  const plan = planWrites(roster, new Map([['ann', stored('Health / Pets')]]));
  ok(JSON.stringify(plan.map((p) => p.id)) === '[1,3,6]', 'every blank row with her handle is filled (any spelling, either account), the typed one is left', JSON.stringify(plan));
  ok(plan.every((p) => p.category === 'Health / Pets'), 'with her label');
  ok(planWrites(roster, new Map([['ann', stored('Health / Pets', null, false)]])).length === 0, 'a miss writes nothing');
  ok(planWrites(roster, new Map([['ann', stored('')]])).length === 0, 'an empty label writes nothing');
  const again = planWrites([row(1, 'Health / Pets', 'ann')], new Map([['ann', stored('Health / Pets', 'Health / Pets')]]));
  ok(again.length === 0, 'a row already holding it is not rewritten');
  const refresh = planWrites([row(1, 'Health / Pets', 'ann'), row(2, 'mine', 'ann')], new Map([['ann', stored('Beauty', 'Health / Pets')]]));
  ok(JSON.stringify(refresh.map((p) => p.id)) === '[1]', 'a refreshed label updates the sync\'s own text and never a typed one');
}

section('4. WHO IS ASKED ABOUT NEXT');
{
  const roster = [row(1, null, 'new1'), row(2, 'typed', 'typed1'), row(3, null, 'old1'), row(4, null, 'fresh1'), row(5, null, 'err1')];
  const known = new Map([
    ['old1', stored('X', null, true, NOW - 40 * DAY)],
    ['fresh1', stored('Y', null, true, NOW - 2 * DAY)],
    ['err1', stored('', null, false, NOW - 29 * DAY)],
  ]);
  const due = dueHandles(roster, known, NOW, 10);
  ok(due.includes('new1') && due.includes('old1'), 'never asked, and asked over a month ago, are due', JSON.stringify(due));
  ok(!due.includes('typed1'), 'a creator with a typed category is never looked up');
  ok(!due.includes('fresh1'), 'a recent answer is not asked again');
  ok(dueHandles(roster, known, NOW, 1)[0] === 'new1', 'a handle never asked about is first in line (new creators are filled first)');
  ok(dueHandles(roster, known, NOW, 1).length === 1, 'and the batch is respected');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
