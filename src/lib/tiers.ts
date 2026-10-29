import type { AppRole, CreatorTier } from '@/lib/auth/auth-context';

/**
 * What we call roles and tiers, in one place.
 *
 * NEUTRAL, like the stage vocabulary next to it. Both sides print these, and
 * two copies of a label is how an admin ends up calling somebody "Pro" on one
 * screen and "pro" on another.
 *
 * Note the collision these two share: a creator on the starting tier is a
 * "Creator" with the tier "Creator". Anywhere both appear, label the tier as a
 * TIER rather than stacking the two words in a column, or it reads as a
 * mistake.
 */

export const ROLE_LABEL: Record<AppRole, string> = {
  applicant: 'Applicant',
  creator: 'Creator',
  creative_strategist: 'Creative strategist',
  ops: 'Ops',
  admin: 'Admin',
  /* Spelled out rather than abbreviated: "ATL" means nothing to somebody
     reading an audit row. The first two are read-only Paid Collabs roles;
     Ads Manager is full staff since 2026-09-15. */
  affiliate_team_lead: 'Affiliate Team Lead',
  operations_lead: 'Operations Lead',
  ads_manager: 'Ads Manager',
};

export const TIER_LABEL: Record<CreatorTier, string> = {
  creator: 'Creator',
  rising: 'Rising',
  pro: 'Pro',
  elite: 'Elite',
};

/**
 * THE GMV EACH TIER STARTS AT. Transcribed, not invented.
 *
 * The source is the migration that created the enum,
 * `20260729145631_auth_profiles_roles_tiers.sql`:
 *
 *   -- Thresholds (first tracked sale, $1K, $10K, $50K GMV) get applied by the
 *   -- tier automation in Phase 2. This enum only names the levels.
 *
 * They live here now because §5.1d of the redesign reaches for "the thresholds
 * in src/lib/tiers.ts" and found only labels. Two things to know before
 * trusting a tier badge:
 *
 * 1. THE AUTOMATION IS STILL NOT BUILT. `profiles.tier` is set by hand, so a
 *    creator can sit below or above the figure her tier implies. The ring on
 *    Home therefore shows progress towards the NEXT tier's threshold; it does
 *    not claim her current tier was earned by crossing one.
 * 2. THEY ARE IN US DOLLARS. Creator money is TikTok's own figure in TikTok's
 *    own currency and is never converted, so for a creator paid in anything
 *    else these numbers are not comparable. `tierTarget` returns null there
 *    rather than comparing two different currencies.
 */
const TIER_GMV_THRESHOLD: Record<CreatorTier, number> = {
  creator: 0,
  rising: 1_000,
  pro: 10_000,
  elite: 50_000,
};

const ORDER: CreatorTier[] = ['creator', 'rising', 'pro', 'elite'];

/** The tier above this one, or null at the top. */
function nextTier(tier: CreatorTier): CreatorTier | null {
  const i = ORDER.indexOf(tier);
  return i >= 0 && i < ORDER.length - 1 ? (ORDER[i + 1] ?? null) : null;
}

/**
 * What she is climbing towards, or null when there is nothing honest to show:
 * at the top tier, or when her money is not in the currency these are set in.
 */
export function tierTarget(
  tier: CreatorTier,
  currency: string | null
): { next: CreatorTier; threshold: number } | null {
  if (currency && currency.toUpperCase() !== 'USD') return null;
  const next = nextTier(tier);
  return next ? { next, threshold: TIER_GMV_THRESHOLD[next] } : null;
}
