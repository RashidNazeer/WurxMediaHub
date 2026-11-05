/**
 * manage-apc
 * ---------------------------------------------------------------------------
 * Create and manage APC viewer accounts: a brand's account manager who signs
 * in with credentials Rashid shares and can READ the brands assigned to them,
 * and nothing else.
 *
 * Same shape as `manage-brand`:
 *   1. Verify the access token with the auth server.
 *   2. Read the caller's role FROM THE PROFILES TABLE, not the JWT.
 *   3. Validate with Zod.
 *   4. Act with the service role.
 *
 * ADMIN AND OPS ONLY. Not `STAFF_ROLES`: Ads Manager is staff, but handing out
 * logins to a brand's numbers is an owner's decision (same call as client
 * links). The role is re-checked here, so widening a UI list changes nothing.
 *
 * THE PASSWORD IS GENERATED HERE and returned exactly once, in the response to
 * `create` or `reset_password`. It is never stored anywhere we can read it
 * back; Supabase keeps only the hash. Lose it, reset it.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';

const Brands = z.array(z.string().trim().min(1).max(200)).min(1, 'Assign at least one brand').max(100);

/** Platform brands (public.brands) whose contests the APC may read. Optional. */
const PlatformIds = z.array(z.uuid()).max(100).default([]);

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('brands') }),
  z.object({
    action: z.literal('create'),
    email: z.string().trim().toLowerCase().email().max(254),
    displayName: z.string().trim().min(1, 'A name is needed').max(120),
    brands: Brands,
    platformBrandIds: PlatformIds,
  }),
  z.object({
    action: z.literal('set_brands'),
    userId: z.uuid(),
    brands: Brands,
    platformBrandIds: PlatformIds,
  }),
  z.object({ action: z.literal('reset_password'), userId: z.uuid() }),
  z.object({ action: z.literal('set_active'), userId: z.uuid(), active: z.boolean() }),
]);

/** 16 characters from an unambiguous alphabet (no 0/O, 1/l/I), crypto random. */
function makePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // 256 % 56 != 0, so reject the biased tail rather than use modulo directly.
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  for (const b of bytes) if (b < limit) out += alphabet[b % alphabet.length];
  return out.length >= 16 ? out.slice(0, 16) : makePassword();
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

  const { data: actor } = await admin
    .from('profiles')
    .select('id, email, role, is_active')
    .eq('id', userData.user.id)
    .single();

  if (!actor || !actor.is_active || (actor.role !== 'admin' && actor.role !== 'ops')) {
    if (actor) {
      await admin.from('audit_log').insert({
        actor_id: actor.id,
        actor_email: actor.email,
        actor_role: actor.role,
        action: 'apc.write_denied',
        subject_type: 'profile',
        detail: { reason: actor.is_active ? 'not admin or ops' : 'account inactive' },
      });
    }
    return reply({ error: 'Not allowed' }, 403);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reply({ error: 'Expected a JSON body' }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return reply({ error: parsed.error.issues[0]?.message ?? 'That request was not valid' }, 400);
  }
  const input = parsed.data;

  const wb = () => admin.schema('wurxbase');
  const audit = (action: string, subject: string, detail: Record<string, unknown>) =>
    admin.from('audit_log').insert({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      action,
      subject_type: 'profile',
      subject_id: subject,
      detail,
    });

  /** Every brand that exists, so assignments are picked, never typed. */
  const knownBrands = async (): Promise<string[]> => {
    const seen = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await wb()
        .from('creators')
        .select('brand')
        .order('id')
        .range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? []) if (r.brand && String(r.brand).trim()) seen.add(String(r.brand));
      if (!data || data.length < 1000) break;
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  };

  /** The target must be an APC viewer. This function never touches anyone else. */
  const loadApc = async (userId: string) => {
    const { data } = await admin
      .from('profiles')
      .select('id, email, display_name, role, is_active')
      .eq('id', userId)
      .single();
    return data && data.role === 'apc_viewer' ? data : null;
  };

  /** Every platform brand, so contest access is picked by id, never typed. */
  const platformBrands = async (): Promise<{ id: string; name: string }[]> => {
    const { data, error } = await admin.from('brands').select('id, name').order('name');
    if (error) throw error;
    return data ?? [];
  };

  const setPlatformBrands = async (userId: string, ids: string[]) => {
    const { error: delErr } = await admin.from('apc_platform_brand_access').delete().eq('user_id', userId);
    if (delErr) throw delErr;
    if (!ids.length) return;
    const { error: insErr } = await admin
      .from('apc_platform_brand_access')
      .insert(ids.map((brand_id) => ({ user_id: userId, brand_id, assigned_by: actor.id })));
    if (insErr) throw insErr;
  };

  /** Rejects any id that is not a real platform brand. */
  const unknownPlatform = async (ids: string[]) => {
    if (!ids.length) return null;
    const known = new Set((await platformBrands()).map((b) => b.id));
    return ids.find((i) => !known.has(i)) ?? null;
  };

  const setBrands = async (userId: string, brands: string[]) => {
    const { error: delErr } = await wb().from('apc_brand_access').delete().eq('user_id', userId);
    if (delErr) throw delErr;
    const { error: insErr } = await wb()
      .from('apc_brand_access')
      .insert(brands.map((brand) => ({ user_id: userId, brand, assigned_by: actor.id })));
    if (insErr) throw insErr;
  };

  try {
    if (input.action === 'brands') {
      return reply({ brands: await knownBrands(), platformBrands: await platformBrands() });
    }

    if (input.action === 'list') {
      const { data: people, error } = await admin
        .from('profiles')
        .select('id, email, display_name, is_active, created_at')
        .eq('role', 'apc_viewer')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const { data: links, error: linkErr } = await wb().from('apc_brand_access').select('user_id, brand');
      if (linkErr) throw linkErr;
      const by = new Map<string, string[]>();
      for (const l of links ?? []) by.set(l.user_id, [...(by.get(l.user_id) ?? []), l.brand]);
      const { data: pLinks, error: pErr } = await admin
        .from('apc_platform_brand_access')
        .select('user_id, brand_id');
      if (pErr) throw pErr;
      const pBy = new Map<string, string[]>();
      for (const l of pLinks ?? []) pBy.set(l.user_id, [...(pBy.get(l.user_id) ?? []), l.brand_id]);
      return reply({
        apcs: (people ?? []).map((p) => ({
          ...p,
          brands: (by.get(p.id) ?? []).sort(),
          platformBrandIds: pBy.get(p.id) ?? [],
        })),
      });
    }

    if (input.action === 'create') {
      const known = new Set(await knownBrands());
      const unknown = input.brands.filter((b) => !known.has(b));
      if (unknown.length) return reply({ error: `Unknown brand: ${unknown[0]}` }, 400);
      if (await unknownPlatform(input.platformBrandIds)) {
        return reply({ error: 'Unknown platform brand' }, 400);
      }

      const password = makePassword();
      const { data: made, error: mkErr } = await admin.auth.admin.createUser({
        email: input.email,
        password,
        email_confirm: true,
        user_metadata: { display_name: input.displayName, must_change_password: true },
      });
      if (mkErr || !made?.user) {
        const taken = /already|registered|exists/i.test(mkErr?.message ?? '');
        return reply({ error: taken ? 'That email already has an account' : 'Could not create the account' }, taken ? 409 : 500);
      }
      const uid = made.user.id;

      // The sign-up trigger made a default (applicant) profile. Make it an APC
      // viewer. If anything below fails, remove the account: a half-made APC
      // with the wrong role is worse than none.
      const { error: roleErr } = await admin
        .from('profiles')
        .update({ role: 'apc_viewer', display_name: input.displayName })
        .eq('id', uid);
      try {
        if (roleErr) throw roleErr;
        await setBrands(uid, input.brands);
        await setPlatformBrands(uid, input.platformBrandIds);
      } catch (e) {
        await admin.auth.admin.deleteUser(uid);
        throw e;
      }
      await audit('apc.create', uid, {
        email: input.email,
        brands: input.brands,
        platformBrandIds: input.platformBrandIds,
      });
      return reply({ userId: uid, email: input.email, password });
    }

    // Everything below acts on an existing APC viewer, and only on one.
    const target = await loadApc(input.userId);
    if (!target) return reply({ error: 'That is not an APC account' }, 404);

    if (input.action === 'set_brands') {
      const known = new Set(await knownBrands());
      const unknown = input.brands.filter((b) => !known.has(b));
      if (unknown.length) return reply({ error: `Unknown brand: ${unknown[0]}` }, 400);
      if (await unknownPlatform(input.platformBrandIds)) {
        return reply({ error: 'Unknown platform brand' }, 400);
      }
      await setBrands(target.id, input.brands);
      await setPlatformBrands(target.id, input.platformBrandIds);
      await audit('apc.set_brands', target.id, {
        brands: input.brands,
        platformBrandIds: input.platformBrandIds,
      });
      return reply({ ok: true });
    }

    if (input.action === 'reset_password') {
      const password = makePassword();
      const { error } = await admin.auth.admin.updateUserById(target.id, {
        password,
        user_metadata: { must_change_password: true },
      });
      if (error) throw error;
      await admin.auth.admin.signOut(target.id, 'global').catch(() => undefined);
      await audit('apc.reset_password', target.id, {});
      return reply({ userId: target.id, email: target.email, password });
    }

    // set_active
    const { error } = await admin.from('profiles').update({ is_active: input.active }).eq('id', target.id);
    if (error) throw error;
    if (!input.active) await admin.auth.admin.signOut(target.id, 'global').catch(() => undefined);
    await audit(input.active ? 'apc.enable' : 'apc.disable', target.id, {});
    return reply({ ok: true });
  } catch (e) {
    console.error('manage-apc failed', e);
    return reply({ error: 'Something went wrong' }, 500);
  }
});
