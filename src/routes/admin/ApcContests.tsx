import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

/**
 * CONTESTS FOR THE BRANDS ASSIGNED TO THIS APC, read only.
 *
 * Reads `public.apc_contests` (migration 20261106090000): one row per contest
 * for the platform brands an admin ticked for this person. It carries counts and
 * money totals only. No creator names, handles or emails and no internal notes
 * are in that view, so none can appear here.
 */

type Contest = {
  id: string;
  brand_name: string;
  name: string;
  description: string | null;
  status: string;
  opens_at: string;
  expires_at: string;
  currency: string;
  total_budget: number | string | null;
  entries: number;
  entries_approved: number;
  submissions: number;
  awarded: number | string;
  paid: number | string;
  owed: number | string;
};

const money = (v: number | string | null, currency: string) => {
  if (v === null || v === undefined || v === '') return '–';
  const n = Number(v);
  if (!Number.isFinite(n)) return '–';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${Math.round(n).toLocaleString('en-US')}`;
  }
};
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

export function ApcContests() {
  const q = useQuery({
    queryKey: ['apc', 'contests'],
    queryFn: async (): Promise<Contest[]> => {
      const { data, error } = await getSupabase()
        .from('apc_contests')
        .select('*')
        .order('expires_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Contest[];
    },
    staleTime: 60_000,
  });

  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) {
    return (
      <p role="alert" className="text-danger">
        Could not load contests.
      </p>
    );
  }
  if (q.data.length === 0) {
    return (
      <div className="wx-neo-raised rounded-xl px-6 py-14 text-center">
        <p className="font-bold">No contests to show</p>
        <p className="text-muted mt-1 text-[0.875rem]">
          Either no contest brands are assigned to your account, or they have no contests.
        </p>
      </div>
    );
  }

  const now = Date.now();
  return (
    <ul className="grid gap-3">
      {q.data.map((c) => {
        const live = c.status === 'active' && new Date(c.expires_at).getTime() > now;
        return (
          <li key={c.id} className="wx-neo-raised rounded-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 font-bold">
                {c.name} <span className="text-muted font-normal">· {c.brand_name}</span>
              </p>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[0.6875rem] font-extrabold tracking-wider uppercase',
                  live ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted'
                )}
              >
                {live ? 'Live' : 'Closed'}
              </span>
            </div>
            <p className="text-muted mt-1 text-[0.8125rem]">
              {day(c.opens_at)} to {day(c.expires_at)}
            </p>
            {c.description && <p className="mt-2 text-[0.875rem]">{c.description}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-3 text-[0.875rem] md:grid-cols-6">
              {[
                ['Entries', String(c.entries)],
                ['Approved', String(c.entries_approved)],
                ['Videos', String(c.submissions)],
                ['Budget', money(c.total_budget, c.currency)],
                ['Awarded', money(c.awarded, c.currency)],
                ['Still owed', money(c.owed, c.currency)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted text-[0.6875rem] tracking-[0.14em] uppercase">{k}</dt>
                  <dd className="font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
