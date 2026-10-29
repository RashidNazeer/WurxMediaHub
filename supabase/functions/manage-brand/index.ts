/**
 * manage-brand
 * ---------------------------------------------------------------------------
 * Create and edit brands, their story, their products, and the offers inside
 * their Brand Hub.
 *
 * CLAUDE.md names brand edits as a privileged action, so this follows the same
 * shape as `review-application`:
 *
 *   1. Verify the access token with the auth server. Not decode it.
 *   2. Read the caller's role FROM THE PROFILES TABLE. A JWT claim can be an
 *      hour stale, so someone demoted five minutes ago is still carrying an
 *      admin claim right now. The table is the truth.
 *   3. Validate with Zod, again, even though the browser already did.
 *   4. Hand the work to one security definer function, so the row and its
 *      audit entry commit together or not at all.
 *
 * There are no insert, update or delete policies on `brands`, `offers`,
 * `brand_products` or `brand_commercials`, and the database functions are
 * granted to `service_role` alone. This function is the only door.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';

const money = z
  .number()
  .finite()
  .nonnegative()
  .max(99_999_999)
  // Money is stored as numeric(x,2). Round here rather than letting Postgres
  // silently truncate a third decimal place somebody pasted in.
  .transform((n) => Math.round(n * 100) / 100);

const currency = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Za-z]{3}$/, 'Currency must be a three letter code')
  .transform((c) => c.toUpperCase());

const BrandBody = z.object({
  action: z.literal('brand.save'),
  brandId: z.uuid().nullish(),
  name: z.string().trim().min(1, 'A brand needs a name').max(120),
  storeId: z.string().trim().min(1, 'A brand needs a store id').max(64),
  clientName: z.string().trim().max(120).nullish(),
  budget: money.nullish(),
  currency: currency.default('USD'),
  isActive: z.boolean().default(true),
});

const OfferBody = z.object({
  action: z.literal('offer.save'),
  offerId: z.uuid().nullish(),
  brandId: z.uuid('An offer must belong to a brand'),
  badgeTitle: z.string().trim().max(32).nullish(),
  title: z.string().trim().min(1, 'An offer needs a title').max(120),
  description: z.string().trim().max(2000).nullish(),
  // Both nullable: an offer can have no fixed deliverable and no fixed fee, for
  // example a boosted commission rate. Which offers MUST carry terms is decided
  // just below, because it depends on needsApplication.
  videoCount: z.number().int().min(1, 'At least one video').max(1000).nullish(),
  rewardAmount: money.nullish(),
  currency: currency.default('USD'),
  status: z.enum(['active', 'inactive']).default('active'),
  needsApplication: z.boolean().default(true),

  /*
   * WHO IS THIS OFFER FOR, added 2026-08-21.
   *
   *   retainer         named creators only. The list is an ALLOW list and it
   *                    is required before the offer can go live.
   *   volume           everyone, minus anyone named. The list EXCLUDES.
   *   high_commission  never needs an application; the list optionally narrows
   *                    it, and an empty one means everyone.
   *
   * The audience arrives as the raw text an admin pasted — handles, emails, or
   * a mixture — and is resolved to creator ids below. It is NOT accepted as
   * ids from the browser: a client that can name arbitrary uuids can put a
   * person on a private deal, and this is the money-sensitive half of the
   * feature.
   */
  kind: z.enum(['retainer', 'volume', 'high_commission']).default('volume'),

  /*
   * ONE STRING, NOT AN ARRAY, because that is what an admin pastes: a block of
   * handles and emails separated by newlines, commas or semicolons, however
   * they happened to come out of a spreadsheet. Splitting it is this function's
   * job, next to the resolving — the browser sending a tidy array would only
   * mean the browser deciding what counts as a separator.
   *
   * Capped, because an unbounded list is a write amplifier pointed straight at
   * a SECURITY DEFINER function.
   */
  audience: z.string().max(20000).default(''),
});

/** Handles and emails out of whatever an admin pasted. */
function splitAudience(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ].slice(0, 500);
}

const DeleteOfferBody = z.object({
  action: z.literal('offer.delete'),
  offerId: z.uuid(),
});

/**
 * The brand's own story: logo, tagline, description.
 *
 * A separate action rather than three more fields on `brand.save`, so the
 * About form cannot touch the name, the store id or the budget even by
 * sending a stale copy of them back with its own edit.
 */
/** A colour an admin picked. Lower cased so a row has exactly one spelling. */
const themeStop = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'A colour must look like #173d36')
  .transform((v) => v.toLowerCase());

const themeArea = (max: number, allow: { tone?: boolean; angle?: boolean } = {}) =>
  z
    .object({
      stops: z.array(themeStop).min(1).max(max),
      ...(allow.angle ? { angle: z.number().int().min(0).max(360).optional() } : {}),
      ...(allow.tone ? { tone: z.enum(['auto', 'light']).optional() } : {}),
    })
    .strict();

const BrandTheme = z
  .object({
    v: z.literal(1),
    hero: themeArea(4, { tone: true, angle: true }).optional(),
    rail: themeArea(3, { tone: true }).optional(),
    page: themeArea(3).optional(),
    accent: themeArea(3).optional(),
  })
  .strict();

const BrandAboutBody = z.object({
  action: z.literal('brand.about'),
  brandId: z.uuid(),
  logoUrl: z.url('That logo address is not a URL').max(500).nullish(),
  tagline: z.string().trim().max(160).nullish(),
  description: z.string().trim().max(4000).nullish(),
  /*
   * THE ONE COLOUR A BRAND'S WORLD IS BUILT FROM.
   *
   * Checked here as well as in the column and in the browser, because this is
   * the layer that can say something useful. The column constraint would come
   * back as a raw Postgres constraint violation, which reaches an admin as a
   * wall of text about a check named after a table.
   *
   * There is no contrast check in this function ON PURPOSE. Readability is not
   * a property of the hex, it is a property of the palette derived from it, and
   * `src/lib/brand-theme.ts` guarantees that for EVERY six digit colour: the
   * text is chosen by measurement, so there is no such thing as an unreadable
   * input to reject. `scripts/build/check-brand-theme.mjs` proves it over a hue
   * circle plus white, black and the primaries, inside `pnpm build`.
   */
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'A brand colour must look like #173d36')
    .nullish(),
  heroUrl: z.url('That hero image address is not a URL').max(2048).nullish(),
  /*
   * THE AREAS AN ADMIN COLOURED BY HAND.
   *
   * `.strict()` on every level, and that is the security-relevant line rather
   * than a tidiness one. The safety of this whole feature rests on no TEXT
   * colour ever being stored: fills are held inside a lightness band and every
   * ink is computed by measuring contrast against them. An extra key sailing
   * through a permissive object is exactly how a `text` would arrive, so an
   * unknown key is refused here, refused by `brand_theme_ok` in the database,
   * and dropped again by `readBrandThemeConfig` on the way back out.
   *
   * No contrast check here, ON PURPOSE, for the same reason as `brandColor`
   * above: readability is not a property of the values, it is a property of the
   * palette derived from them, and there is no such thing as an unreadable
   * input to reject.
   */
  theme: BrandTheme.nullish(),
  // The founder, shown in the hub introduction. All optional.
  founderName: z.string().trim().max(120).nullish(),
  founderRole: z.string().trim().max(120).nullish(),
  founderNote: z.string().trim().max(1000).nullish(),
});
const percent = z
  .number()
  .finite()
  .min(0)
  .max(100, 'A commission cannot be more than 100%')
  // numeric(5,2). Round rather than letting Postgres truncate a third decimal.
  .transform((n) => Math.round(n * 100) / 100);

const ProductBody = z.object({
  action: z.literal('product.save'),
  productId: z.uuid().nullish(),
  brandId: z.uuid('A product must belong to a brand'),
  name: z.string().trim().min(1, 'A product needs a name').max(160),
  externalProductId: z
    .string()
    .trim()
    .min(1, 'A product needs its TikTok Shop product id')
    .max(64),
  imageUrl: z.url('That image address is not a URL').max(500).nullish(),
  // Price and commission are both optional: a product can be listed before its
  // numbers are confirmed, and an empty field is honest where a made up one is
  // not. The cards handle the gap.
  price: money.nullish(),
  currency: currency.default('USD'),
  commissionRate: percent.nullish(),
  badgeTitle: z.string().trim().max(32).nullish(),
  isActive: z.boolean().default(true),
});

const DeleteProductBody = z.object({
  action: z.literal('product.delete'),
  productId: z.uuid(),
});

/** One line of a brief's hooks, do's or don'ts. */
const briefLines = z.array(z.string().trim().max(280, 'Keep each line under 280 characters')).max(10, 'Ten lines at most');

const BriefBody = z.object({
  action: z.literal('brief.save'),
  briefId: z.uuid().nullish(),
  brandId: z.uuid('A brief must belong to a brand'),
  title: z.string().trim().min(1, 'A brief needs a title').max(120),
  whatToMake: z.string().trim().max(2000).nullish(),
  hooks: briefLines.default([]),
  dos: briefLines.default([]),
  donts: briefLines.default([]),
  isActive: z.boolean().default(true),
});

const DeleteBriefBody = z.object({
  action: z.literal('brief.delete'),
  briefId: z.uuid(),
});

const Body = z.discriminatedUnion('action', [
  BrandBody,
  BrandAboutBody,
  OfferBody,
  DeleteOfferBody,
  ProductBody,
  DeleteProductBody,
  BriefBody,
  DeleteBriefBody,
]);

/** SQLSTATE from the database functions to something HTTP shaped. */
const STATUS_FOR_PG: Record<string, number> = {
  '42501': 403, // insufficient privilege
  P0002: 404, // no data found
  '23505': 409, // unique violation, a duplicate store id or slug
  '22023': 400, // invalid parameter value
  '23514': 400, // check constraint violation
};

/** Turn a raw Postgres complaint into something a human can act on. */
function humanise(message: string, code: string | undefined): string {
  if (code === '23505') {
    if (message.includes('external_product_id')) {
      return 'This brand already has a product with that product id';
    }
    if (message.includes('store_id')) return 'Another brand already uses that store id';
    if (message.includes('slug')) return 'A brand with a very similar name already exists';
    return 'That already exists';
  }
  if (code === '23514') return 'One of those values is outside what we allow';
  return message;
}

Deno.serve(async (req) => {
  const reply = (body: unknown, status = 200) => json(body, status, req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Not signed in' }, 401);

  // ---------------------------------------------------------- who is this --
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) return reply({ error: 'Not signed in' }, 401);

  // Service role from here on. Nothing above this line was trusted.
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: actor, error: actorErr } = await admin
    .from('profiles')
    .select('id, email, role, is_active')
    .eq('id', userData.user.id)
    .single();

  if (actorErr || !actor) return reply({ error: 'Not allowed' }, 403);

  // Ads Manager is staff since 2026-09-15, the same as ops. Mirrors is_staff().
  const isStaff = actor.role === 'admin' || actor.role === 'ops' || actor.role === 'ads_manager';
  if (!isStaff || !actor.is_active) {
    // A real account reaching for something it is not entitled to. Kept.
    await admin.from('audit_log').insert({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'brand.write_denied',
      subject_type: 'brand',
      detail: { reason: actor.is_active ? 'not staff' : 'account inactive' },
    });
    return reply({ error: 'Not allowed' }, 403);
  }

  // ------------------------------------------------------------ the input --
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reply({ error: 'Expected a JSON body' }, 400);
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return reply(
      { error: parsed.error.issues[0]?.message ?? 'That request was not valid' },
      400
    );
  }
  const input = parsed.data;

  // Checked after the union rather than inside it: a `.refine()` on a member
  // stops it being a plain object, and `discriminatedUnion` needs plain
  // objects.
  //
  // The terms are required only when the creator has to apply. Not every offer
  // is "N videos for $X": a boosted commission rate has no fixed deliverable
  // and no fixed fee, and demanding one only gets a made up number. But an
  // offer somebody applies FOR has to say what they are applying for.
  /*
   * HIGH COMMISSION NEVER NEEDS AN APPLICATION, so the terms it must carry are
   * decided against the EFFECTIVE value rather than whatever the form sent.
   * `save_offer` forces the column the same way; this only decides which
   * fields are demanded on the way in.
   */
  const needsApplication =
    input.action === 'offer.save' && input.kind !== 'high_commission'
      ? input.needsApplication
      : false;

  if (input.action === 'offer.save' && needsApplication) {
    if (!input.description?.trim()) {
      return reply(
        { error: 'An offer creators apply for needs a description of what to deliver' },
        400
      );
    }
    if (input.videoCount === null || input.videoCount === undefined) {
      return reply({ error: 'How many videos would they deliver?' }, 400);
    }
    if (input.rewardAmount === null || input.rewardAmount === undefined) {
      return reply({ error: 'What does this offer pay?' }, 400);
    }
  }

  // ------------------------------------------------------------- do it ----
  let rpc: { data: unknown; error: { message?: string; code?: string } | null };

  if (input.action === 'brand.save') {
    rpc = await admin.rpc('save_brand', {
      p_actor_id: actor.id,
      p_name: input.name,
      p_store_id: input.storeId,
      p_brand_id: input.brandId ?? null,
      p_client_name: input.clientName ?? null,
      p_budget: input.budget ?? null,
      p_currency: input.currency,
      p_is_active: input.isActive,
    });
  } else if (input.action === 'brand.about') {
    rpc = await admin.rpc('save_brand_about', {
      p_actor_id: actor.id,
      p_brand_id: input.brandId,
      p_logo_url: input.logoUrl ?? null,
      p_tagline: input.tagline ?? null,
      p_description: input.description ?? null,
      p_brand_color: input.brandColor ?? null,
      p_hero_url: input.heroUrl ?? null,
      p_theme: input.theme ?? null,
      p_founder_name: input.founderName ?? null,
      p_founder_role: input.founderRole ?? null,
      p_founder_note: input.founderNote ?? null,
    });
  } else if (input.action === 'brief.save') {
    rpc = await admin.rpc('save_brand_brief', {
      p_actor_id: actor.id,
      p_brand_id: input.brandId,
      p_title: input.title,
      p_what_to_make: input.whatToMake ?? null,
      p_hooks: input.hooks,
      p_dos: input.dos,
      p_donts: input.donts,
      p_is_active: input.isActive,
      p_brief_id: input.briefId ?? null,
    });
  } else if (input.action === 'brief.delete') {
    rpc = await admin.rpc('delete_brand_brief', {
      p_actor_id: actor.id,
      p_brief_id: input.briefId,
    });
  } else if (input.action === 'product.save') {
    rpc = await admin.rpc('save_product', {
      p_actor_id: actor.id,
      p_brand_id: input.brandId,
      p_name: input.name,
      p_external_product_id: input.externalProductId,
      p_product_id: input.productId ?? null,
      p_image_url: input.imageUrl ?? null,
      p_price: input.price ?? null,
      p_currency: input.currency,
      p_commission_rate: input.commissionRate ?? null,
      p_badge_title: input.badgeTitle ?? null,
      p_is_active: input.isActive,
    });
  } else if (input.action === 'product.delete') {
    rpc = await admin.rpc('delete_product', {
      p_actor_id: actor.id,
      p_product_id: input.productId,
    });
  } else if (input.action === 'offer.save') {
    /*
     * RESOLVE THE PASTED TEXT TO REAL CREATORS, SERVER SIDE.
     *
     * Rashid asked for handles or emails, and for the misses to be named
     * rather than silently dropped: *"Save the ones that matched, list the
     * ones that did not"*. A typo that quietly means "one fewer creator sees
     * this" is the failure mode worth engineering against, so nothing is
     * dropped without being reported back.
     *
     * `creator_directory` is the only place the two identifiers sit together:
     * the email is on `profiles`, the TikTok handle is on `applications`. It
     * is a staff-only view and this runs with the service key, which is
     * exactly why the browser never gets to send ids.
     */
    const wanted = splitAudience(input.audience);
    const matched = new Map<string, string>(); // input token -> creator id
    const unmatched: string[] = [];

    if (wanted.length > 0) {
      const { data: people, error: lookupError } = await admin
        .from('creator_directory')
        .select('id, email, tiktok_handle')
        .eq('is_active', true);

      if (lookupError) {
        console.error('manage-brand audience lookup failed', lookupError);
        return reply({ error: 'Could not check who those creators are' }, 500);
      }

      // Both sides lowercased, and a leading @ is stripped from the pasted
      // side only: an admin copying from TikTok gets "@name", and the stored
      // handle has no @.
      const byHandle = new Map<string, string>();
      const byEmail = new Map<string, string>();
      for (const p of people ?? []) {
        if (p.tiktok_handle) byHandle.set(String(p.tiktok_handle).toLowerCase(), p.id);
        if (p.email) byEmail.set(String(p.email).toLowerCase(), p.id);
      }

      for (const token of wanted) {
        const key = token.toLowerCase().replace(/^@+/, '');
        const id = byHandle.get(key) ?? byEmail.get(token.toLowerCase());
        if (id) matched.set(token, id);
        else unmatched.push(token);
      }
    }

    rpc = await admin.rpc('save_offer', {
      p_actor_id: actor.id,
      p_brand_id: input.brandId,
      p_title: input.title,
      p_video_count: input.videoCount ?? null,
      p_reward_amount: input.rewardAmount ?? null,
      p_offer_id: input.offerId ?? null,
      p_badge_title: input.badgeTitle ?? null,
      p_description: input.description ?? null,
      p_currency: input.currency,
      p_status: input.status,
      p_needs_application: needsApplication,
      p_kind: input.kind,
      p_audience: [...new Set(matched.values())],
    });

    /*
     * The unmatched list rides back on a SUCCESSFUL save, because that is what
     * "save the ones that matched and tell me about the rest" means. On a
     * failure the error wins and this is not sent: there is nothing saved for
     * it to be a footnote to.
     */
    if (!rpc.error && unmatched.length > 0) {
      // The same shape as the success reply at the bottom, plus the footnote.
      // One shape means the client has one thing to read.
      return reply({ ok: true, result: rpc.data, unmatched }, 200);
    }
  } else {
    rpc = await admin.rpc('delete_offer', {
      p_actor_id: actor.id,
      p_offer_id: input.offerId,
    });
  }

  if (rpc.error) {
    const status = STATUS_FOR_PG[rpc.error.code ?? ''] ?? 500;
    if (status === 500) console.error('manage-brand failed', input.action, rpc.error);
    return reply(
      { error: humanise(rpc.error.message ?? 'Something went wrong', rpc.error.code) },
      status
    );
  }

  return reply({ ok: true, result: rpc.data }, 200);
});
