#!/usr/bin/env node
/**
 * Put VIDEOS against the approved jobs on DEV, so every state of the new
 * progress bar has something to render.
 *
 * Why this exists. Dev carried brands, offers and approved jobs, but almost no
 * content, so every bar would have read "0 of 5" and the screen Rashid was
 * asked to approve would have looked broken rather than empty. The seed spreads
 * work across the five states that matter: nothing posted, part filmed, waiting
 * on us, sent back, and fully covered.
 *
 * IT USES THE REAL FUNCTIONS. Submissions are inserted the way `submit_content`
 * writes them, and every approval goes through `review_content`, which is the
 * only thing in the product allowed to carry a job to "content completed". A
 * script that set stages by hand would drift from the rule the moment the rule
 * changed, and would have hidden the two stuck-job bugs this step fixed rather
 * than exercising them.
 *
 * DEV ONLY. Never run this against prod.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/seed/seed-pipeline.mjs
 *   SUPABASE_SERVICE_KEY=... node scripts/seed/seed-pipeline.mjs --clean
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

// Creates and deletes data. Dev only, checked before anything runs.
assertDevProject(env.VITE_SUPABASE_URL, 'seed-pipeline.mjs');

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

// Every ad code this script writes carries the prefix, so --clean removes
// exactly what it made and nothing a real person typed.
const PREFIX = 'DEMO-';
const clean = process.argv.includes('--clean');

/**
 * A plausible looking TikTok post link.
 *
 * Deliberately not a real video. The thumbnail is best effort everywhere in
 * this product and every card is designed to look right without one, so a dead
 * link is honest demo data rather than a broken screen.
 */
const linkFor = (n) => `https://www.tiktok.com/@wurxdemo/video/${7000000000000000000n + BigInt(n)}`;

/**
 * How each job gets filled in, in order. Cycled across whatever approved jobs
 * dev happens to have, so the board shows every state without needing to know
 * what is on the database today.
 *
 * `approve` and `sendBack` are counts taken from `post`, and whatever is left
 * over stays with the team.
 */
const SHAPES = [
  { name: 'nothing posted yet', post: 0, approve: 0, sendBack: 0 },
  { name: 'part filmed, rest to come', post: 2, approve: 2, sendBack: 0 },
  { name: 'one waiting on us', post: 2, approve: 1, sendBack: 0 },
  { name: 'one sent back', post: 3, approve: 1, sendBack: 1 },
  { name: 'fully covered', post: -1, approve: -1, sendBack: 0 },
];

async function main() {
  if (clean) return removeAll();

  // Somebody has to be the reviewer. `review_content` re-reads the actor from
  // profiles and refuses anybody who is not active staff, exactly as it does
  // for a real click.
  const { data: staff, error: staffErr } = await admin
    .from('profiles')
    .select('id, email, role')
    .in('role', ['admin', 'ops'])
    .eq('is_active', true)
    .limit(1);
  if (staffErr) throw staffErr;
  if (!staff?.length) {
    throw new Error('No active admin or ops account on this project. Run create-admin.mjs first.');
  }
  const actor = staff[0];

  const { data: jobs, error: jobsErr } = await admin
    .from('offer_applications')
    .select(
      'id, creator_id, brand_id, offer_id, creator_handle, creator_name, stage, ' +
        'committed_video_count, offer:offers (title), brand:brands (name)'
    )
    .eq('status', 'approved')
    .order('created_at', { ascending: true });
  if (jobsErr) throw jobsErr;

  if (!jobs?.length) {
    console.log('No approved jobs on this project, so there is nothing to film against.');
    console.log('Approve a creator onto an offer first, then run this again.');
    return;
  }

  console.log(`Reviewer: ${actor.email}`);
  console.log(`${jobs.length} approved job(s) found.\n`);

  let n = Date.now() % 100000;
  let made = 0;

  for (const [i, job] of jobs.entries()) {
    const required = job.committed_video_count;
    const shape = SHAPES[i % SHAPES.length];

    // A job with no agreed number can never be short of anything, so the only
    // honest thing to do is post one and leave it. The screens say "1 posted"
    // and draw no bar.
    const post = required === null ? 1 : shape.post === -1 ? required : Math.min(shape.post, required + 1);
    const approve = required === null ? 0 : shape.approve === -1 ? required : shape.approve;

    const label = `${job.brand?.name ?? 'a brand'} / ${job.offer?.title ?? 'an offer'}`;
    if (post === 0) {
      console.log(`  ${label}: ${shape.name}`);
      continue;
    }

    const rows = [];
    for (let v = 0; v < post; v += 1) {
      n += 1;
      rows.push({
        application_id: job.id,
        creator_id: job.creator_id,
        brand_id: job.brand_id,
        offer_id: job.offer_id,
        creator_handle: job.creator_handle,
        creator_name: job.creator_name,
        video_url: linkFor(n),
        ad_code: `${PREFIX}${String(n).slice(-6)}`,
        ad_authorized: v % 3 !== 2,
        status: 'submitted',
      });
    }

    const { data: written, error: writeErr } = await admin
      .from('content_submissions')
      .insert(rows)
      .select('id');
    if (writeErr) throw writeErr;
    made += written.length;

    /*
     * Now decide them the way a person would.
     *
     * The LAST approval of a covered job is the one that carries it to
     * "content completed", inside `review_content`, in the same transaction.
     * Nothing here sets a stage.
     */
    for (let k = 0; k < approve && k < written.length; k += 1) {
      const { error } = await admin.rpc('review_content', {
        p_actor_id: actor.id,
        p_content_id: written[k].id,
        p_status: 'approved',
      });
      if (error) throw error;
    }

    for (let k = approve; k < approve + shape.sendBack && k < written.length; k += 1) {
      const { error } = await admin.rpc('review_content', {
        p_actor_id: actor.id,
        p_content_id: written[k].id,
        p_status: 'needs_another_take',
        p_note: 'The hook is good but the product is out of frame for the first four seconds.',
      });
      if (error) throw error;
    }

    const covered = required !== null && approve >= required;
    console.log(
      `  ${label}: ${shape.name} (${post} posted, ${approve} approved` +
        `${shape.sendBack ? `, ${shape.sendBack} sent back` : ''})` +
        `${covered ? '  -> job finished by the last approval' : ''}`
    );
  }

  console.log(`\n${made} video(s) written. Remove them again with --clean.`);
}

async function removeAll() {
  const { data, error } = await admin
    .from('content_submissions')
    .delete()
    .like('ad_code', `${PREFIX}%`)
    .select('id');
  if (error) throw error;
  console.log(`Removed ${data?.length ?? 0} demo video(s).`);
  console.log(
    'Stages are NOT walked back: a job carried to "content completed" by an approval\n' +
      'stays there, the same as if the videos had been deleted by hand. Move it from the\n' +
      'admin queue if you want it back.'
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
