import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getSupabase } from '@/lib/supabase';

/**
 * THE APC'S HOME: totals for the brands assigned to them, and nothing else.
 *
 * Built ONLY from `wurxbase.apc_creators` and `wurxbase.apc_brand_monthly_budgets`,
 * the brand-scoped views (migration 20261105090100). The staff dashboard reads
 * application inboxes, creator payouts and the audit log for every brand, so
 * none of it is reused here.
 *
 * NUMBERS ARE WHAT IS RECORDED. A figure nobody entered is a dash, never $0:
 * `total_gmv` and `ad_spent` are typed or synced per creator row, and a blank
 * means "not reported", not "none".
 */

type Row = {
  brand: string | null;
  name: string | null;
  tiktok_account: string | null;
  hiring_date: string | null;
  total_gmv: number | string | null;
  ad_spent: number | string | null;
};
type Budget = { brand: string | null; month: string | null; budget: number | string | null };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const usd = (n: number | null) =>
  n === null ? '–' : `$${Math.round(n).toLocaleString('en-US')}`;
/** Sum that stays null when nothing was reported. */
const total = (xs: Array<number | null>) => {
  const have = xs.filter((x): x is number => x !== null);
  return have.length ? have.reduce((a, b) => a + b, 0) : null;
};

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthsBack = (n: number) => {
  const d = new Date();
  d.setDate(1);
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1);
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
  });
};
const monthLabel = (k: string) =>
  new Date(`${k}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

async function loadAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await getSupabase()
      .schema('wurxbase')
      .from(table)
      .select(cols)
      .order(table === 'apc_creators' || table === 'apc_brand_monthly_budgets' ? 'id' : 'brand')
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function ApcDashboard() {
  const creators = useQuery({
    queryKey: ['apc', 'creators'],
    queryFn: () =>
      loadAll<Row>('apc_creators', 'id,brand,name,tiktok_account,hiring_date,total_gmv,ad_spent'),
    staleTime: 60_000,
  });
  const budgets = useQuery({
    queryKey: ['apc', 'budgets'],
    queryFn: () => loadAll<Budget>('apc_brand_monthly_budgets', 'id,brand,month,budget'),
    staleTime: 60_000,
  });

  const view = useMemo(() => {
    const rows = creators.data ?? [];
    const now = thisMonth();
    const brandNames = [...new Set(rows.map((r) => r.brand ?? '').filter(Boolean))].sort();
    const monthBudget = (brand: string) =>
      total(
        (budgets.data ?? [])
          .filter((b) => b.brand === brand && String(b.month ?? '').slice(0, 7) === now)
          .map((b) => num(b.budget))
      );
    const perBrand = brandNames.map((brand) => {
      const mine = rows.filter((r) => r.brand === brand);
      return {
        brand,
        deals: mine.length,
        gmv: total(mine.map((r) => num(r.total_gmv))),
        ad: total(mine.map((r) => num(r.ad_spent))),
        budget: monthBudget(brand),
      };
    });
    const trend = monthsBack(6).map((m) => {
      const mine = rows.filter((r) => String(r.hiring_date ?? '').slice(0, 7) === m);
      return { m, deals: mine.length, gmv: total(mine.map((r) => num(r.total_gmv))) };
    });
    const top = [...rows]
      .filter((r) => num(r.total_gmv) !== null)
      .sort((a, b) => (num(b.total_gmv) ?? 0) - (num(a.total_gmv) ?? 0))
      .slice(0, 5);
    return {
      brands: brandNames.length,
      deals: rows.length,
      gmv: total(rows.map((r) => num(r.total_gmv))),
      ad: total(rows.map((r) => num(r.ad_spent))),
      budget: total(perBrand.map((b) => b.budget)),
      perBrand,
      trend,
      top,
    };
  }, [creators.data, budgets.data]);

  if (creators.isPending) return <p className="text-muted">Loading…</p>;
  if (creators.isError) {
    return (
      <p role="alert" className="text-danger">
        Could not load your brands.
      </p>
    );
  }
  if (view.deals === 0) {
    return (
      <div className="wx-neo-raised rounded-xl px-6 py-14 text-center">
        <p className="font-bold">No brands to show yet</p>
        <p className="text-muted mt-1 text-[0.875rem]">
          Nothing is assigned to your account, or your brands have no creators yet.
        </p>
      </div>
    );
  }

  const cards: Array<[string, string]> = [
    ['Brands', String(view.brands)],
    ['Creator deals', String(view.deals)],
    ['Total GMV', usd(view.gmv)],
    ['Ad spend', usd(view.ad)],
    [`Budget, ${monthLabel(thisMonth())}`, usd(view.budget)],
  ];

  return (
    <div className="grid gap-4">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map(([label, value]) => (
          <li key={label} className="wx-neo-raised rounded-xl p-4">
            <p className="text-muted font-mono text-[0.6875rem] tracking-[0.14em] uppercase">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
          </li>
        ))}
      </ul>

      <section className="wx-neo-raised overflow-x-auto rounded-xl p-5">
        <h2 className="font-bold">Your brands</h2>
        <table className="mt-3 w-full text-left text-[0.875rem]">
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-4 font-medium">Brand</th>
              <th className="py-1 pr-4 font-medium">Deals</th>
              <th className="py-1 pr-4 font-medium">GMV</th>
              <th className="py-1 pr-4 font-medium">Ad spend</th>
              <th className="py-1 font-medium">Budget this month</th>
            </tr>
          </thead>
          <tbody>
            {view.perBrand.map((b) => (
              <tr key={b.brand} className="border-t border-black/5">
                <td className="py-2 pr-4 font-semibold">
                  <Link to="/admin/collabs/brands" className="hover:underline">
                    {b.brand}
                  </Link>
                </td>
                <td className="py-2 pr-4">{b.deals}</td>
                <td className="py-2 pr-4">{usd(b.gmv)}</td>
                <td className="py-2 pr-4">{usd(b.ad)}</td>
                <td className="py-2">{usd(b.budget)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="wx-neo-raised rounded-xl p-5">
          <h2 className="font-bold">Hired, last six months</h2>
          <table className="mt-3 w-full text-left text-[0.875rem]">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-medium">Month</th>
                <th className="py-1 font-medium">Deals</th>
                <th className="py-1 font-medium">GMV</th>
              </tr>
            </thead>
            <tbody>
              {view.trend.map((t) => (
                <tr key={t.m} className="border-t border-black/5">
                  <td className="py-2">{monthLabel(t.m)}</td>
                  <td className="py-2">{t.deals}</td>
                  <td className="py-2">{usd(t.gmv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="wx-neo-raised rounded-xl p-5">
          <h2 className="font-bold">Top creators by GMV</h2>
          {view.top.length === 0 ? (
            <p className="text-muted mt-3 text-[0.875rem]">No GMV has been reported yet.</p>
          ) : (
            <ol className="mt-3 grid gap-2 text-[0.875rem]">
              {view.top.map((r, i) => (
                <li key={`${r.name}-${i}`} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <b>{r.name}</b>{' '}
                    <span className="text-muted">
                      {r.tiktok_account ? `@${String(r.tiktok_account).replace(/^@/, '')}` : ''} · {r.brand}
                    </span>
                  </span>
                  <span className="font-semibold">{usd(num(r.total_gmv))}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
