/**
 * Euka's dashboard endpoints name their date range { startDate, endDate }.
 * Sending { start, end } is a 400 — which is what made onboarding say
 * "EUKA will not return a catalogue for <brand> (error 400)" for every brand.
 *
 * Checks, with no key needed:
 *   1. the LIVE public spec still says startDate/endDate for the two endpoints
 *      we call, so a change on their side is caught here and not by an admin;
 *   2. our two functions send exactly those keys.
 *
 *   node scripts/verify/euka/check-euka-date-keys.mjs
 */
import { readFileSync } from 'node:fs';

let failed = 0;
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
  if (!c) failed++;
};

const spec = await (await fetch('https://api.euka.ai/openapi.json')).json();
const body = (p) => spec.paths[p]?.post?.requestBody?.content?.['application/json']?.schema;

const products = body('/dashboard/products-performance')?.properties?.postedDateRange;
ok(
  JSON.stringify(products?.required) === '["startDate","endDate"]',
  'spec: products-performance wants postedDateRange.{startDate,endDate}'
);
const videos = body('/dashboard/top-videos-by-revenue')?.properties?.filter?.properties?.postedDateRange;
ok(
  JSON.stringify(videos?.required) === '["startDate","endDate"]',
  'spec: top-videos-by-revenue wants filter.postedDateRange.{startDate,endDate}'
);

const read = (f) => readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8');
const cp = read('supabase/functions/collab-products/index.ts');
const eu = read('supabase/functions/euka/index.ts');

ok(
  /postedDateRange:\s*\{\s*startDate:\s*iso\(from\),\s*endDate:\s*iso\(to\)\s*\}/.test(cp),
  'collab-products sends startDate/endDate'
);
ok(
  /postedDateRange:\s*\{\s*startDate:\s*start,\s*endDate:\s*end\s*\}/.test(eu),
  'euka (top videos) sends startDate/endDate'
);
for (const [name, src] of [['collab-products', cp], ['euka', eu]]) {
  ok(
    !/postedDateRange:\s*\{\s*start\s*[:,}]/.test(src),
    `${name} no longer sends the old { start, end }`
  );
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
