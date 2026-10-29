/**
 * Browser environment contract.
 *
 * ONLY public values belong here. Anything in this file ships inside the
 * JavaScript bundle that every visitor downloads, so a service-role key or any
 * other secret must never appear. Those live in Edge Function secrets.
 *
 * Validation is lazy on purpose: the public shell renders fine without Supabase
 * configured, but the moment anything touches the database we want a loud,
 * readable error instead of a mystery `undefined` in a network call.
 *
 * NO ZOD IN HERE, AND THAT IS A LOAD-TIME DECISION RATHER THAN A STYLE ONE.
 *
 * `lib/supabase.ts` imports this file, so whatever this file imports is pulled
 * in the moment anything touches the database — which, through `AuthProvider`,
 * is every page including the public landing page. Validating two strings with
 * Zod cost 17.8 KB gzipped on that path (the shared `schemas` chunk), measured
 * 2026-10-16, to check one URL and one minimum length. Both checks are four
 * lines of JavaScript, so they are four lines of JavaScript.
 *
 * Zod is still the right tool for the FORM schemas in `lib/schemas/*`: those
 * are large, they report per-field errors into the UI, and they are reached
 * from route chunks that are already lazy. This file is not that.
 *
 * The error text and the lazy, cached behaviour are unchanged from the Zod
 * version on purpose — anything already relying on how this fails still sees
 * the same failure.
 */

interface Env {
  VITE_SUPABASE_URL: string;
  /**
   * The `sb_publishable_...` key, not the legacy `eyJ...` anon JWT. Both work
   * today, but Supabase is phasing the legacy keys out and this project is
   * meant to run for years. Safe to ship publicly: it grants nothing on its
   * own, because every table is behind Row Level Security.
   */
  VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

/**
 * A full, absolute URL — the same thing `z.string().url()` accepted.
 *
 * `new URL()` is the browser's own parser, so this cannot drift from what the
 * Supabase client will actually do with the value. It is wrapped because the
 * constructor THROWS on a bad input rather than returning a result, and a
 * throw here would escape as a `TypeError` instead of the readable error
 * below.
 */
function isUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  /* Collected rather than thrown one at a time, so a developer with both
     variables missing is told about both. This is what Zod's `safeParse` +
     `error.issues` was doing. */
  const details: string[] = [];
  if (!isUrl(url)) {
    details.push('  - VITE_SUPABASE_URL: VITE_SUPABASE_URL must be a full https:// URL');
  }
  if (typeof key !== 'string' || key.length < 20) {
    details.push(
      '  - VITE_SUPABASE_PUBLISHABLE_KEY: VITE_SUPABASE_PUBLISHABLE_KEY looks empty or truncated'
    );
  }

  if (details.length > 0) {
    throw new Error(
      `Missing or invalid environment variables.\n${details.join('\n')}\n\n` +
        `Locally: copy .env.example to .env.local and fill it in.\n` +
        `On Vercel: set them in Project Settings -> Environment Variables, then redeploy.`
    );
  }

  cached = {
    VITE_SUPABASE_URL: url as string,
    VITE_SUPABASE_PUBLISHABLE_KEY: key as string,
  };
  return cached;
}
