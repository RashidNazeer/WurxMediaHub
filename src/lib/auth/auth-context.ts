import { createContext, useContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';

export const ROLES = [
  'applicant',
  'creator',
  'creative_strategist',
  'ops',
  'admin',
  /*
   * The READ-ONLY Paid Collabs roles, added 2026-09-02.
   *
   * Affiliate Team Lead and Operations Lead see Paid Collabs and nothing
   * else, and cannot change anything inside it. They are deliberately NOT
   * staff: `is_staff()` guards seventy policies across creators, offers,
   * contests, brands and money, and widening it to "let them see the collabs
   * screen" would hand them the entire product.
   *
   * What they can reach is one predicate wide: `public.is_collabs_viewer()`,
   * used only by the SELECT policies on the wurxbase schema. Writes there
   * still answer to `is_staff()`.
   */
  'affiliate_team_lead',
  'operations_lead',
  /* Ads Manager was the third read-only role until 2026-09-15, when Rashid
     made it full staff. See STAFF_ROLES. */
  'ads_manager',
] as const;
export type AppRole = (typeof ROLES)[number];

/**
 * The roles that ARE staff: the whole admin app, and every write `is_staff()`
 * allows.
 *
 * Ads Manager joined Ops and Admin on 2026-09-15. Rashid: *"ads manager will
 * have the same edit access as asad and rashid has which means they can edit
 * anything"* — and asked whether that meant one person or the role, the role.
 *
 * This list MIRRORS `public.is_staff()` in the database and the staff checks
 * in the Edge Functions. It decides which screens render; the database decides
 * what is allowed. If the two ever disagree somebody gets a screen whose every
 * query comes back empty, or a button that answers "Not allowed".
 */
export const STAFF_ROLES = ['ops', 'admin', 'ads_manager'] as const satisfies readonly AppRole[];

export const isStaffRole = (r: AppRole | null | undefined): boolean =>
  Boolean(r) && (STAFF_ROLES as readonly string[]).includes(r as string);

/**
 * The roles whose whole world is Paid Collabs, read only.
 *
 * One list, imported by the router, the sidebar and the Paid Collabs identity
 * hook, so another role of this kind is added in exactly one place. Three
 * copies of this array is how one of them ends up out of step and somebody
 * either loses access or gains it.
 */
export const COLLABS_ONLY_ROLES = [
  'affiliate_team_lead',
  'operations_lead',
] as const satisfies readonly AppRole[];

export const isCollabsOnlyRole = (r: AppRole | null | undefined): boolean =>
  Boolean(r) && (COLLABS_ONLY_ROLES as readonly string[]).includes(r as string);

/* What each is CALLED on screen lives in `src/lib/tiers.ts` with every other
   role label, not here. One list. */

export const TIERS = ['creator', 'rising', 'pro', 'elite'] as const;
export type CreatorTier = (typeof TIERS)[number];

/**
 * Claims we put into the access token via the Postgres hook
 * (`custom_access_token_hook`). Reading them avoids a database round trip on
 * every screen just to find out who someone is.
 *
 * These are for DECIDING WHAT TO SHOW, never for deciding what is allowed.
 * A token is signed but it is still client-side data, and it can be up to an
 * hour stale. Permission is enforced by row level security in the database.
 */
interface AuthClaims {
  role: AppRole;
  tier: CreatorTier | null;
  active: boolean;
}

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/**
 * SOMEBODY ELSE SIGNED IN, IN ANOTHER TAB, AND THIS TAB IS NOW THEM.
 *
 * Supabase stores the session in localStorage, which belongs to the ORIGIN, not
 * to the tab. So signing in as a creator in one tab replaces the admin session
 * in every other tab of the same browser, silently. That is not a bug in
 * Supabase and it is not something the app can prevent: there is one session
 * per origin and there always will be.
 *
 * What WAS a bug is that nothing said so. The admin screen carried on rendering
 * because it had already loaded, the next thing the admin clicked went to an
 * Edge Function with somebody else's token, and it came back "Not signed in" on
 * a screen that plainly showed them signed in. Rashid hit this repeatedly, and
 * the first time he raised it I called it "not a code bug" and moved on, which
 * was wrong: the swap is unavoidable, being ambushed by it is not.
 *
 * `null` until it happens. Set only when a REAL person was replaced by a
 * different person or by nobody, never on the first sign-in of a fresh tab and
 * never on a token refresh, which produces a new token for the same user id.
 */
export interface IdentitySwap {
  /** The user id that was signed in here before. Never null: no swap without one. */
  from: string;
  /** Who is signed in now. Null means the other tab signed out. */
  to: string | null;
  /** Their email, when it is known, so the banner can name them. */
  toEmail: string | null;
}

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  claims: AuthClaims | null;
  /** See IdentitySwap. Null in the ordinary case, which is almost always. */
  identitySwap: IdentitySwap | null;
  /** Dismiss the banner. The swap itself cannot be undone from here. */
  acknowledgeSwap: () => void;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where each role belongs after signing in. */
export const HOME_FOR_ROLE: Record<AppRole, string> = {
  applicant: '/app',
  creator: '/app',
  creative_strategist: '/studio',
  ops: '/admin',
  admin: '/admin',
  /* Staff since 2026-09-15, so home is the dashboard like Ops. */
  ads_manager: '/admin',
  /* Straight into Paid Collabs. `/admin` would bounce them: it is the
     dashboard, and they cannot read anything it is made of. */
  affiliate_team_lead: '/admin/collabs/brands',
  operations_lead: '/admin/collabs/brands',
};

const isRole = (v: unknown): v is AppRole =>
  typeof v === 'string' && (ROLES as readonly string[]).includes(v);

const isTier = (v: unknown): v is CreatorTier =>
  typeof v === 'string' && (TIERS as readonly string[]).includes(v);

/**
 * Pull our custom claims out of the access token.
 *
 * Deliberately hand-rolled rather than pulling in a JWT library: we are only
 * reading a base64 payload we already trust the server to have signed, and we
 * never verify it here because verification is the database's job.
 */
export function readClaims(accessToken: string | undefined): AuthClaims | null {
  if (!accessToken) return null;
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return {
      role: isRole(parsed.user_role) ? parsed.user_role : 'applicant',
      tier: isTier(parsed.user_tier) ? parsed.user_tier : null,
      active: parsed.user_active !== false,
    };
  } catch {
    // A malformed token means we know nothing. Treat it as the least
    // privileged case rather than guessing.
    return null;
  }
}
