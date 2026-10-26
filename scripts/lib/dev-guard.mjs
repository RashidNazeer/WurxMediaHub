/**
 * Refuse to run anywhere but DEV.
 *
 * WHY THIS EXISTS. Every suite and every seed in this folder creates accounts,
 * writes rows and deletes them again. They all read the project URL out of
 * `.env.local` and, until 2026-08-18, seventeen of the twenty trusted whatever
 * they found there. Nothing was ever pointed at prod, but "nothing has gone
 * wrong yet" is not a safety mechanism: one edited env file and a routine
 * `pnpm verify:all` would have created throwaway admins in the live database
 * and then deleted rows on the way out.
 *
 * Rashid asked for this directly, and he was right to: "please make sure we
 * don't accidently delete the data this is very crucial".
 *
 * IT IS A POSITIVE CHECK. It must RECOGNISE the dev project, not merely fail to
 * recognise prod. A typo that matches neither would otherwise sail straight
 * through, which is the failure mode a blocklist always has.
 */

/**
 * The dev project. Changing this is a deliberate act, not a convenience.
 *
 * MOVED 2026-10-27: dev is CreatorHub (ap-southeast-1, org Prism) now. The old
 * `wurxmediahub-dev` project (npznoiotslruqovorrec, org WurxMedia) went over its
 * free quota and is retired, only ever paused, never deleted.
 */
export const DEV_REF = 'qinxwfdwvpkzfhcijuqw';

export function assertDevProject(url, what = 'This script') {
  const u = String(url ?? '');
  if (u.includes(DEV_REF)) return u;

  console.error(
    `\nREFUSING TO RUN.\n\n` +
      `${what} creates and deletes data, so it only ever runs against the DEV\n` +
      `project (${DEV_REF}).\n\n` +
      `.env.local points at: ${u || '(nothing)'}\n\n` +
      `If dev has genuinely moved, change DEV_REF in scripts/lib/dev-guard.mjs\n` +
      `deliberately. Never point it at prod.\n`
  );
  process.exit(1);
}
