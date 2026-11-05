import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

/**
 * APC viewer accounts, for the screen that manages them.
 *
 * Every call goes through the `manage-apc` Edge Function, which re-checks that
 * the caller is admin or ops from the profiles table. There is no table read
 * from the browser: `wurxbase.apc_brand_access` is staff-only and the profiles
 * of other people are not ours to list from here.
 *
 * A password comes back ONCE, in the response to `create` or `reset`. Nothing
 * here stores it; the screen shows it and it is gone on the next render.
 */

export type ApcAccount = {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  brands: string[];
};

type Credentials = { userId: string; email: string; password: string };

async function messageFrom(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      // Not JSON: fall through.
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'That did not go through. Try again.';
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke('manage-apc', { body });
  if (error) throw new Error(await messageFrom(error));
  return data as T;
}

const KEY = ['admin', 'apc-accounts'];

export function useApcAccounts() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await call<{ apcs: ApcAccount[] }>({ action: 'list' })).apcs,
    staleTime: 15_000,
  });
}

export function useApcBrandChoices() {
  return useQuery({
    queryKey: [...KEY, 'brands'],
    queryFn: async () => (await call<{ brands: string[] }>({ action: 'brands' })).brands,
    staleTime: 5 * 60_000,
  });
}

export function useApcActions() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: KEY });
  return {
    create: useMutation({
      mutationFn: (v: { email: string; displayName: string; brands: string[] }) =>
        call<Credentials>({ action: 'create', ...v }),
      onSuccess: done,
    }),
    setBrands: useMutation({
      mutationFn: (v: { userId: string; brands: string[] }) =>
        call<{ ok: true }>({ action: 'set_brands', ...v }),
      onSuccess: done,
    }),
    resetPassword: useMutation({
      mutationFn: (v: { userId: string }) => call<Credentials>({ action: 'reset_password', ...v }),
      onSuccess: done,
    }),
    setActive: useMutation({
      mutationFn: (v: { userId: string; active: boolean }) =>
        call<{ ok: true }>({ action: 'set_active', ...v }),
      onSuccess: done,
    }),
  };
}
