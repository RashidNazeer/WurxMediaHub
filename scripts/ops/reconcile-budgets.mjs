#!/usr/bin/env node
/**
 * Put every brand's committed budget back in step with its approved requests.
 *
 * `brand_commercials.budget_used` is a running total, kept by
 * `review_offer_application` in the same transaction as the approval. That is
 * the only thing in the product that moves it, and nothing a browser can reach
 * goes near it, so in normal use it cannot drift.
 *
 * It CAN drift if somebody deletes approved requests straight out of the table
 * with the service key, which is exactly what a clumsy cleanup script did on
 * 2026-08-01 and left three brands claiming money they had not promised. This
 * script is the answer to that, so the fix is one command rather than a
 * hand-written query at the wrong moment.
 *
 * Read-only unless something is actually wrong. Run it any time; it prints what
 * it would change and only writes the rows that disagree.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/reconcile-budgets.mjs [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const dryRun = process.argv.includes('--dry-run');
// Rewrites every brand's committed figure. Dev only, checked before the
// client exists: this is a writer, and a writer pointed at prod would
// silently restate live budgets.
assertDevProject(env.VITE_SUPABASE_URL, 'reconcile-budgets.mjs');

const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

console.log(`\nReconciling budgets on ${env.VITE_SUPABASE_URL}`);
console.log(dryRun ? 'Dry run: nothing will be written.\n' : '');

const { data: brands, error } = await admin.from('brands').select('id, name').order('name');
if (error) throw new Error(`could not read brands: ${error.message}`);

let drifted = 0;

for (const brand of brands ?? []) {
  const { data: approved, error: reqErr } = await admin
    .from('offer_applications')
    .select('committed_amount')
    .eq('brand_id', brand.id)
    .eq('status', 'approved');
  if (reqErr) throw new Error(`could not read requests: ${reqErr.message}`);

  // Rounded to pennies. Adding numerics in JavaScript is fine at these sizes,
  // but the column is numeric(14,2) and a floating point tail would be written
  // straight back as drift of its own.
  const truth =
    Math.round(
      (approved ?? []).reduce((total, r) => total + Number(r.committed_amount ?? 0), 0) * 100
    ) / 100;

  const { data: commercial, error: cErr } = await admin
    .from('brand_commercials')
    .select('budget_used')
    .eq('brand_id', brand.id)
    .maybeSingle();
  if (cErr) throw new Error(`could not read the budget: ${cErr.message}`);
  if (!commercial) continue;

  const stored = Number(commercial.budget_used ?? 0);
  if (stored === truth) continue;

  drifted += 1;
  console.log(`  ${brand.name.padEnd(24)} ${stored}  ->  ${truth}`);

  if (!dryRun) {
    const { error: upErr } = await admin
      .from('brand_commercials')
      .update({ budget_used: truth })
      .eq('brand_id', brand.id);
    if (upErr) throw new Error(`could not correct ${brand.name}: ${upErr.message}`);
  }
}

if (drifted === 0) {
  console.log('  Every brand already matches its approved requests.\n');
} else {
  console.log(`\n  ${drifted} brand(s) ${dryRun ? 'would be' : 'were'} corrected.\n`);
}
