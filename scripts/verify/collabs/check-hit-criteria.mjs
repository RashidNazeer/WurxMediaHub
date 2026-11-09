#!/usr/bin/env node
/**
 * The hit-criteria settings, proved without a browser or a database.
 *
 * What is tested here is everything that happens BEFORE the database is asked: what a user may
 * type, what is refused, what "Reset" means, what is remembered, and that two different choices
 * can never share a cache key (which is what keeps an old result from showing under a new
 * definition). The classification and every count are SQL, and are proved by
 * `pnpm verify:hit-rate` (scripts/verify/creator-hit-rate.sql).
 *
 * Run: pnpm verify:hit-criteria
 */
import {
  KEYS, parseAmount, validateDraft, wouldLeaveNone, draftFrom, sameCriteria, asCriteria,
  describe, chip, compact, applyDraft, setApplied, getApplied, subscribe, keyOf, payloadOf, _resetForTests,
} from '../../../src/lib/admin/hit-criteria.ts';

let failed = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${detail}`}`);
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

/* the server's factory settings, as collab_hit_defaults() returns them */
const DEFAULTS = { gmv30: { on: true, min: 1000 }, gmv90: { on: true, min: 1000 }, views: { on: true, min: 250000 } };

/* a browser's storage, so persistence can be proved in Node */
const makeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};
const fresh = (storage) => {
  globalThis.window = { localStorage: storage };
  _resetForTests();
};

console.log('\nTHE THRESHOLD A PERSON TYPES\n');
eq('plain number', parseAmount('2000'), 2000);
eq('thousands comma', parseAmount('2,000'), 2000);
eq('dollar sign', parseAmount('$2,000'), 2000);
eq('500k is 500,000', parseAmount('500k'), 500000);
eq('1.5m is 1,500,000', parseAmount('1.5m'), 1500000);
eq('zero is allowed', parseAmount('0'), 0);
eq('decimals', parseAmount('99.5'), 99.5);
eq('negative is refused', parseAmount('-5'), null);
eq('text is refused', parseAmount('lots'), null);
eq('empty is refused', parseAmount(''), null);
eq('two numbers are refused', parseAmount('1 000 x'), null);
eq('scientific notation is refused', parseAmount('1e6'), null);

console.log('\nVALIDATION\n');
const base = draftFrom(DEFAULTS);
ok('the defaults validate', validateDraft(base).ok === true);
eq('the defaults round-trip through the form unchanged', validateDraft(base).criteria, DEFAULTS);
const custom = { gmv30: { on: true, min: '2000' }, gmv90: { on: true, min: '3,000' }, views: { on: true, min: '500k' } };
eq('the spec example ($2,000 / $3,000 / 500,000) is accepted as typed',
  validateDraft(custom).criteria, { gmv30: { on: true, min: 2000 }, gmv90: { on: true, min: 3000 }, views: { on: true, min: 500000 } });
const bad = validateDraft({ ...base, gmv30: { on: true, min: '-1' } });
ok('a negative threshold is refused with a message on that row', !bad.ok && /number/i.test(bad.errors.gmv30 || ''));
ok('a text threshold is refused', !validateDraft({ ...base, views: { on: true, min: 'many' } }).ok);
const none = validateDraft({ gmv30: { on: false, min: '1000' }, gmv90: { on: false, min: '1000' }, views: { on: false, min: '250000' } });
ok('every condition off is refused', !none.ok && /at least one/i.test(none.errors.form || ''));
eq('GMV off, views on: valid, views is the only condition',
  KEYS.filter((k) => validateDraft({ ...base, gmv30: { ...base.gmv30, on: false }, gmv90: { ...base.gmv90, on: false } }).criteria[k].on), ['views']);
eq('views off, GMV on: valid, GMV is the only condition',
  KEYS.filter((k) => validateDraft({ ...base, views: { ...base.views, on: false } }).criteria[k].on), ['gmv30', 'gmv90']);
ok('a disabled row still has to hold a valid number (what is saved is always well formed)',
  !validateDraft({ ...base, views: { on: false, min: 'x' } }).ok);

console.log('\nTHE LAST CONDITION CANNOT BE SWITCHED OFF\n');
ok('with all three on, any can be switched off', KEYS.every((k) => !wouldLeaveNone(base, k)));
const onlyViews = { ...base, gmv30: { ...base.gmv30, on: false }, gmv90: { ...base.gmv90, on: false } };
ok('with only views on, views cannot be switched off', wouldLeaveNone(onlyViews, 'views') === true);
ok('...while a disabled one can still be switched back on', wouldLeaveNone(onlyViews, 'gmv30') === false);

console.log('\nWHAT IS APPLIED, AND RESET\n');
const storage = makeStorage();
fresh(storage);
eq('nothing chosen = null = the server\'s defaults', getApplied(), null);
eq('null is what goes to the database for "defaults"', payloadOf(getApplied()), null);
let notified = 0;
const off = subscribe(() => notified++);
applyDraft(validateDraft(custom).criteria, DEFAULTS);
eq('applying the spec example stores it', getApplied(), validateDraft(custom).criteria);
ok('and everything subscribed is told (so every list re-asks the database)', notified === 1);
ok('the choice is remembered in the browser', storage.getItem('wx-hit-criteria:v1') !== null);
fresh(storage);
eq('after a "reload" the same choice comes back', getApplied(), validateDraft(custom).criteria);
setApplied(null);
eq('Reset to Default clears it back to null', getApplied(), null);
ok('...and forgets it in storage', storage.getItem('wx-hit-criteria:v1') === null);
eq('...and the form shows the ORIGINAL thresholds again', draftFrom(DEFAULTS), base);
applyDraft(validateDraft(base).criteria, DEFAULTS);
eq('applying criteria equal to the defaults is stored as "default" (null), not as a custom copy', getApplied(), null);
off();

console.log('\nJUNK IN STORAGE NEVER BREAKS THE SCREEN\n');
for (const [label, raw] of [
  ['unparseable text', '{not json'],
  ['all conditions off', JSON.stringify({ gmv30: { on: false, min: 1 }, gmv90: { on: false, min: 1 }, views: { on: false, min: 1 } })],
  ['a negative threshold', JSON.stringify({ ...DEFAULTS, views: { on: true, min: -3 } })],
  ['a missing condition', JSON.stringify({ gmv30: { on: true, min: 1 } })],
  ['a string threshold', JSON.stringify({ ...DEFAULTS, gmv30: { on: true, min: '1000' } })],
]) {
  const s = makeStorage();
  s.setItem('wx-hit-criteria:v1', raw);
  fresh(s);
  eq(`${label} -> the defaults`, getApplied(), null);
}
globalThis.window = { get localStorage() { throw new Error('blocked'); } };
_resetForTests();
eq('storage that throws -> the defaults', getApplied(), null);
setApplied(validateDraft(custom).criteria);
eq('...and a choice still works for the session', getApplied(), validateDraft(custom).criteria);

console.log('\nNO STALE ANSWERS: A DIFFERENT CHOICE IS A DIFFERENT CACHE KEY\n');
const k0 = keyOf(null);
const variants = [
  DEFAULTS,
  { ...DEFAULTS, gmv30: { on: true, min: 2000 } },
  { ...DEFAULTS, gmv90: { on: true, min: 2000 } },
  { ...DEFAULTS, views: { on: true, min: 500000 } },
  { ...DEFAULTS, gmv30: { on: false, min: 1000 } },
  { ...DEFAULTS, views: { on: false, min: 250000 } },
];
const keys = [k0, ...variants.map(keyOf)];
ok('every distinct criteria set has its own key', new Set(keys).size === keys.length, keys.join(' | '));
ok('the same criteria always give the same key', keyOf(variants[1]) === keyOf({ ...variants[1] }));
ok('switching a condition off changes the key even when its threshold is unchanged', keyOf(variants[4]) !== keyOf(DEFAULTS));
ok('"default" (null) and an explicit copy of the defaults are told apart in the key', keyOf(null) !== keyOf(DEFAULTS));
ok('sameCriteria sees threshold and switch changes', !sameCriteria(DEFAULTS, variants[1]) && !sameCriteria(DEFAULTS, variants[4]) && sameCriteria(DEFAULTS, { ...DEFAULTS }));

console.log('\nTHE ACTIVE CRITERIA IS SPELLED OUT\n');
eq('defaults', describe(DEFAULTS), 'GMV 30d ≥ $1K or GMV 90d ≥ $1K or Views ≥ 250K');
eq('the spec example', describe(validateDraft(custom).criteria), 'GMV 30d ≥ $2K or GMV 90d ≥ $3K or Views ≥ 500K');
eq('a disabled condition is left out', describe({ ...DEFAULTS, gmv30: { on: false, min: 1000 }, gmv90: { on: false, min: 1000 } }), 'Views ≥ 250K');
eq('a chip', chip('gmv30', { on: true, min: 1500 }), 'GMV 30d ≥ $1.5K');
eq('compact: exact below a thousand', compact(750), '750');
eq('compact: millions', compact(2000000), '2M');
ok('asCriteria accepts a well-formed value and rejects junk', asCriteria(DEFAULTS) !== null && asCriteria(null) === null && asCriteria({}) === null);

console.log(failed ? `\n${failed} FAILED\n` : '\nAll passed.\n');
process.exit(failed ? 1 : 0);
