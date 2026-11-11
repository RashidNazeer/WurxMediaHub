#!/usr/bin/env node
/**
 * Which brands the Reacher sync reads, and how, proved without a network or a database.
 *
 * Until 2026-11-11 the sync was Irwin Naturals only, so Biostime (a Reacher shop that Euka does not
 * hold) had no video filed after 29 October. The rule now: every Paid Collabs brand Reacher holds and
 * Euka does NOT, with Euka winning a brand both hold; Irwin read as a whole shop exactly as before;
 * every other brand one creator at a time, a rotating batch per run.
 *
 * Run: pnpm verify:reacher-targets
 */
import { pickTargets, rotate } from '../../../supabase/functions/reacher-sync/targets.ts';

let failed = 0;
const ok = (name, cond, detail = '') => { if (!cond) failed++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + detail}`); };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

/* the real picture on 2026-11-11 */
const OURS = ['Penetrex', 'Swisse', 'Dr Tobias', 'Biostime', 'Irwin Naturals', 'Plant People', 'Bentgo', 'Aqua Sonic', 'Mineral Ice Extreme', 'Aurelia', ' Biostime '];
const EUKA = ['Apothecary Brands', 'Aurelia', 'Cutler Nutrition', 'Dangle-it', 'Dr Tobias', "Dr. Harvey's", 'HoneySticks', 'Longevity Box', 'Mineral Ice Extreme', 'Penetrex', 'Swisse Wellness'].map((name) => ({ name }));
const REACHER = [{ name: 'Biostime', id: 1 }, { name: 'Irwin Naturals', id: 2 }, { name: 'Cutler Nutrition', id: 3 }, { name: 'Longevity', id: 4 }];

console.log('\nWHICH BRANDS');
const r = pickTargets(OURS, EUKA, REACHER, null);
eq('Biostime and Irwin are the Reacher brands', r.targets.map((t) => t.brand), ['Biostime', 'Irwin Naturals']);
eq('Irwin keeps the whole-shop read, exactly as before', r.targets.find((t) => t.brand === 'Irwin Naturals').mode, 'shop');
eq('Biostime is read creator by creator', r.targets.find((t) => t.brand === 'Biostime').mode, 'handles');
eq('each is matched to its own shop', r.targets.map((t) => t.shop.id), [1, 2]);
ok('a brand Euka holds is left to Euka (never read from Reacher too)', ['Penetrex', 'Swisse', 'Dr Tobias', 'Aurelia', 'Mineral Ice Extreme'].every((b) => r.euka.includes(b) && !r.targets.some((t) => t.brand === b)), JSON.stringify(r));
eq('"Swisse" finds Euka\'s "Swisse Wellness", so it is not Reacher\'s', r.euka.includes('Swisse'), true);
eq('brands on neither platform are named, not guessed', r.neither.sort(), ['Aqua Sonic', 'Bentgo', 'Plant People']);
eq('a brand spelled with stray spaces is one brand, not two', r.targets.filter((t) => t.brand === 'Biostime').length, 1);
ok('Cutler Nutrition is a Reacher shop but not one of our brands: it is never read', !r.targets.some((t) => /cutler/i.test(t.brand)));
ok('"Longevity" (a Reacher shop) is not our brand, and a brand merely starting with its name would be ambiguous, never a guess', !r.targets.some((t) => /longevity/i.test(t.brand)));

console.log('\nASKING FOR ONE BRAND');
eq('only Biostime when only Biostime is asked for', pickTargets(OURS, EUKA, REACHER, new Set(['Biostime'])).targets.map((t) => t.brand), ['Biostime']);
eq('asking for an Euka brand reads nothing from Reacher', pickTargets(OURS, EUKA, REACHER, new Set(['Penetrex'])).targets, []);
eq('asking for a brand nobody has reads nothing', pickTargets(OURS, EUKA, REACHER, new Set(['Nope'])).targets, []);
eq('when Euka is not configured, nothing is taken from Reacher\'s side by mistake (Euka list empty -> Reacher-held brands only)',
  pickTargets(OURS, [], REACHER, null).targets.map((t) => t.brand), ['Biostime', 'Irwin Naturals']);

console.log('\nROTATING THROUGH A BRAND\'S CREATORS');
const hs = Array.from({ length: 40 }, (_, i) => 'h' + String(i).padStart(2, '0'));
eq('a batch of 15 is 15 creators', rotate(hs, 15, 0).length, 15);
eq('everybody fits in one run: all of them, once', rotate(hs.slice(0, 10), 15, 7).length, 10);
const seen = new Set();
for (let c = 0; c < 3; c++) rotate(hs, 15, c).forEach((h) => seen.add(h));
eq('three consecutive cycles cover all 40 creators', seen.size, 40);
eq('the window wraps around the end of the list', rotate(hs, 15, 2).includes('h00') && rotate(hs, 15, 2).includes('h39'), true);
eq('a creator is never read twice in one run', new Set(rotate(hs, 15, 5)).size, 15);
eq('duplicates and blanks in the handle list are ignored', rotate(['b', 'a', 'a', '', 'b'], 10, 0), ['a', 'b']);
eq('the same cycle always gives the same slice', rotate(hs, 15, 9), rotate(hs, 15, 9));
eq('an empty roster is an empty batch', rotate([], 15, 3), []);

console.log(failed ? `\n${failed} FAILED\n` : '\nAll passed.\n');
process.exit(failed ? 1 : 0);
