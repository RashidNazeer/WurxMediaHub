import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { PrismMark } from '@/components/brand/PrismMark';
import { useTheme } from '@/components/theme/theme-context';
import '@/vendor/wurxbase/paidcollabs.css';
import '@/routes/admin/wurxbase-overrides.css';

/**
 * WHAT A CLIENT SEES, WITH NO ACCOUNT AT ALL.
 *
 * Rashid's boss, 2026-09-17: "we need to show them exact same view as we have
 * they will just not be able to see ad spend and roi at any cost". So this is
 * the Paid Collabs BRANDS view — the same five cards, the same top-videos
 * strip, the same table — wearing the same stylesheet, and nothing else of the
 * product. "No other section no other data please."
 *
 * WHAT IS NOT HERE, and could not be even if this file wanted it: ad spend,
 * ROI, payment details, phone numbers, emails, internal comments. The
 * `collab-share` function builds the payload field by field and those fields
 * are never read into it. This page can only draw what it is given, which is
 * the point — hiding a column in CSS would leave it one "view source" away.
 *
 * ALSO NOT HERE, because a client must not change anything: the status
 * dropdown is a plain pill, and there is no contract download, no row actions,
 * no export. Nothing on this page writes.
 *
 * It holds no Supabase client, no key and no session, and stores nothing in the
 * browser.
 */

type Video = {
  url: string;
  date: string | null;
  views: number;
  gmv: number;
  items: number;
  product: string | null;
  thumb: string | null;
  spark: string | null;
};

type Creator = {
  name: string;
  tiktok: string[];
  hiredBy: string | null;
  tier: string | null;
  l30: number | null;
  onboarded: string | null;
  completedOn: string | null;
  deal: number;
  perVideo: number | null;
  committed: number;
  delivered: number;
  views: number;
  gmv: number;
  items: number;
  videos?: Video[];
};

type BrandBlock = {
  brand: string;
  contentGuide?: string;
  kpis?: {
    budget: number;
    allocated: number;
    paid: number;
    remaining: number;
    creators: number;
    delivered: number;
    committed: number;
    costPerVideo: number;
    views: number;
    gmv: number;
  };
  topVideos?: { url: string; thumb: string | null; gmv: number; views: number; name: string }[];
  creators?: Creator[];
};

type Payload = {
  label: string;
  sections: { kpis: boolean; topVideos: boolean; creators: boolean; videos: boolean };
  months: string[];
  month: string;
  expiresAt: string;
  data: BrandBlock[];
};

/* Their column widths, minus Ad spend, ROI, Contract and Actions. Inline so it
   beats the vendored rule, which counts twelve columns. */
const COLS = '0.36fr 0.74fr 1.7fr .86fr .56fr .6fr .8fr .74fr .56fr';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const monthLabel = (key: string) => {
  if (key === 'all') return 'All time';
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1] ?? '?'} ${y}`;
};
const dayLabel = (iso: string | null) => {
  if (!iso) return '–';
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? '–'
    : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const money = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '–'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: n % 1 === 0 ? 0 : 2,
      }).format(n);
const kNum = (n: number) =>
  n >= 1000
    ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
        n
      )
    : String(n || 0);
const handleOf = (raw: string) => {
  const t = String(raw).trim().replace(/\/$/, '');
  if (t.startsWith('http')) {
    const last = t.split('/').pop() ?? '';
    return last.startsWith('@') ? last : `@${last}`;
  }
  return t.startsWith('@') ? t : `@${t}`;
};
const profileUrl = (raw: string) =>
  String(raw).trim().startsWith('http')
    ? String(raw).trim()
    : `https://www.tiktok.com/${handleOf(raw)}`;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

/* Their hired-by palette, so the tag is the same colour it is on your screen. */
const HIRED_BY: Record<string, { i: string; fg: string; bg: string }> = {
  aris: { i: 'A', fg: '#1259C3', bg: '#E7EFFB' },
  myles: { i: 'M', fg: '#7A3BB5', bg: '#F1E9FB' },
  emily: { i: 'E', fg: '#C2185B', bg: '#FCE7F0' },
  khushi: { i: 'K', fg: '#0E7A3A', bg: '#E4F5EB' },
};

/*
 * WHICH SUPABASE REGION THE FUNCTION RUNS IN. By default the platform starts a
 * function in the region nearest the VISITOR, and every database call it then
 * makes travels back to the database. For a client opening this link from the US
 * or Europe that is a trip across an ocean for each call. Pinning it next to the
 * database makes the visitor pay for one trip. Set VITE_SHARE_REGION to the
 * project's own region (Singapore today), or to an empty string to switch it off.
 */
const SHARE_REGION =
  (import.meta.env.VITE_SHARE_REGION as string | undefined) ?? 'ap-southeast-1';

/** A failed request, with whether the link itself is the problem. */
class ShareFail extends Error {
  gone: boolean;
  constructor(message: string, gone: boolean) {
    super(message);
    this.gone = gone;
  }
}

async function fetchMonth(token: string, askedMonth: string | null): Promise<Payload> {
  let res: Response;
  try {
    res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/collab-share`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SHARE_REGION ? { 'x-region': SHARE_REGION } : {}),
      },
      body: JSON.stringify(askedMonth ? { token, month: askedMonth } : { token }),
    });
  } catch {
    throw new ShareFail(
      'We could not reach the server. Check your connection and try again.',
      false
    );
  }
  const body = await res.json().catch(() => null);
  if (res.status === 404) {
    throw new ShareFail(body?.error ?? 'This link is not active any more.', true);
  }
  if (!res.ok || !body?.data) {
    throw new ShareFail(body?.error ?? 'Something went wrong loading this page.', false);
  }
  return body as Payload;
}

export function ShareCollab() {
  const { token = '' } = useParams();
  const { resolved: theme } = useTheme();
  const [brandIdx, setBrandIdx] = useState(0);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /* The month the visitor has just clicked, while its answer is on the way. The
     button lights up at once; the table stays as it was until the answer lands. */
  const [pending, setPending] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState('');

  /*
   * EVERY MONTH, KEPT. The first answer lists the months this link may show, and
   * the page then fetches the rest quietly, one at a time, so by the time anybody
   * clicks one it is already here and the switch costs nothing. A month that is
   * still on its way is awaited rather than asked for twice, and only the latest
   * click is allowed to change the screen (a slow answer for an earlier click
   * must not land on top of a later one).
   */
  const cache = useRef(new Map<string, Payload>());
  const inflight = useRef(new Map<string, Promise<Payload>>());
  const latestClick = useRef(0);

  const getMonth = useCallback(
    (askedMonth: string | null): Promise<Payload> => {
      const key = askedMonth ?? '';
      const have = cache.current.get(key);
      if (have) return Promise.resolve(have);
      const running = inflight.current.get(key);
      if (running) return running;
      const p = fetchMonth(token, askedMonth)
        .then((answer) => {
          cache.current.set(key, answer);
          /* The function may answer a different month than was asked (one outside
             the link's list is replaced by one inside it), so file it under both. */
          cache.current.set(answer.month, answer);
          return answer;
        })
        .finally(() => inflight.current.delete(key));
      inflight.current.set(key, p);
      return p;
    },
    [token]
  );

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const loadFirst = useCallback(() => {
    let cancelled = false;
    setState('loading');
    getMonth(null)
      .then(async (first) => {
        if (cancelled) return;
        setPayload(first);
        setState('ready');
        /* The other months, in the background, one at a time. Failures are
           ignored here: a month that did not arrive is simply asked for again
           when somebody clicks it. */
        const rest = [
          ...first.months.slice(0, 12),
          ...(first.months.length > 1 ? ['all'] : []),
        ].filter((m) => !cache.current.has(m));
        for (const m of rest) {
          if (cancelled) return;
          await getMonth(m).catch(() => undefined);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const fail =
          e instanceof ShareFail
            ? e
            : new ShareFail('Something went wrong loading this page.', false);
        setMessage(fail.message);
        setState(fail.gone ? 'gone' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [getMonth]);

  useEffect(() => loadFirst(), [loadFirst]);

  const pickMonth = useCallback(
    (m: string) => {
      setSwitchError('');
      const click = ++latestClick.current;
      const have = cache.current.get(m);
      if (have) {
        setPayload(have);
        setPending(null);
        return;
      }
      setPending(m);
      getMonth(m)
        .then((answer) => {
          if (click !== latestClick.current) return;
          setPayload(answer);
          setPending(null);
        })
        .catch((e: unknown) => {
          if (click !== latestClick.current) return;
          setPending(null);
          setSwitchError(
            e instanceof ShareFail && !e.gone
              ? e.message
              : 'That month did not load. Try it again.'
          );
        });
    },
    [getMonth]
  );

  useEffect(() => {
    document.title = payload
      ? `${payload.data.map((b) => b.brand).join(', ')} · Wurx Media`
      : 'Wurx Media';
  }, [payload]);

  const brand = payload?.data[brandIdx] ?? payload?.data[0];
  const expires = useMemo(
    () =>
      payload
        ? new Date(payload.expiresAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : '',
    [payload]
  );

  if (state === 'loading' && !payload) {
    return (
      <Shell>
        <div className="space-y-4" aria-busy="true" aria-live="polite">
          <div className="bg-surface-2 h-8 w-56 animate-pulse rounded-md" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-surface-2 h-24 animate-pulse rounded-xl" />
            ))}
          </div>
          <div className="bg-surface-2 h-64 animate-pulse rounded-xl" />
          <span className="sr-only">Loading this report</span>
        </div>
      </Shell>
    );
  }

  if (state === 'gone' || state === 'error') {
    return (
      <Shell>
        <div className="wx-neo-raised mx-auto max-w-md rounded-xl p-8 text-center">
          <h1 className="text-xl font-extrabold">
            {state === 'gone' ? 'This link has ended' : 'Something went wrong'}
          </h1>
          <p className="text-muted mt-3 leading-relaxed">{message}</p>
          {state === 'error' && (
            <button
              type="button"
              onClick={() => loadFirst()}
              className="wx-neo-raised-sm wx-neo-press mt-6 rounded-md px-4 py-2 text-sm font-semibold"
            >
              Try again
            </button>
          )}
        </div>
      </Shell>
    );
  }

  if (!payload || !brand) return null;
  const k = brand.kpis;
  /* The button lit is the month just clicked, not the one still on screen. */
  const shownMonth = pending ?? payload.month;

  return (
    <Shell>
      <header
        className="flex flex-wrap items-center justify-between gap-4"
        data-month={payload.month}
      >
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight">{brand.brand}</h1>
          <p className="text-muted mt-1 text-sm">
            Creator campaign report · {monthLabel(payload.month)}
          </p>
        </div>
        <span className="wx-neo-raised-sm text-muted rounded-full px-3 py-1 text-xs font-bold tracking-wider uppercase">
          Read only
        </span>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {payload.data.length > 1 &&
          payload.data.map((b, i) => (
            <button
              key={b.brand}
              type="button"
              onClick={() => setBrandIdx(i)}
              aria-pressed={i === brandIdx}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                i === brandIdx
                  ? '[background-color:var(--wx-accent-fill)] [color:var(--wx-on-accent-fill)]'
                  : 'wx-neo-raised-sm wx-neo-press'
              }`}
            >
              {b.brand}
            </button>
          ))}
        {payload.data.length > 1 && <span className="bg-line mx-1 h-5 w-px" aria-hidden />}
        {[...payload.months.slice(0, 12), ...(payload.months.length > 1 ? ['all'] : [])].map(
          (m) => (
            <button
              key={m}
              type="button"
              onClick={() => pickMonth(m)}
              aria-pressed={m === shownMonth}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                m === shownMonth
                  ? '[background-color:var(--wx-accent-fill)] [color:var(--wx-on-accent-fill)]'
                  : 'wx-neo-raised-sm wx-neo-press'
              }`}
            >
              {monthLabel(m)}
            </button>
          )
        )}
      </div>

      <p className="text-muted mt-3 min-h-5 text-sm" role="status" aria-live="polite">
        {pending ? `Loading ${monthLabel(pending)}…` : switchError}
      </p>

      {/* Everything below wears Paid Collabs' own stylesheet, which switches on
          data-theme: without it the cards and table stayed dark on a light page. */}
      <div
        className="wurxbase-root mt-2 transition-opacity"
        data-theme={theme}
        aria-busy={pending !== null}
        style={pending ? { opacity: 0.55 } : undefined}
      >
        {k && (
          <div
            className="pc-kpis pc-kpis-5"
            style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
          >
            <Kpi
              label="Budget"
              color="#1259C3"
              value={money(k.budget)}
              sub={
                k.budget > 0
                  ? `${Math.round((k.allocated / k.budget) * 100)}% used`
                  : 'no budget set'
              }
            />
            <Kpi
              label="Allocated"
              color="#7A3BB5"
              value={money(k.allocated)}
              sub={`${k.creators} creator${k.creators === 1 ? '' : 's'}`}
            />
            <Kpi
              label="Paid"
              color="#0E7A3A"
              value={money(k.paid)}
              sub={
                k.allocated > 0 ? `${Math.round((k.paid / k.allocated) * 100)}% paid out` : '—'
              }
            />
            <Kpi
              label="Videos"
              color="#0EA5E9"
              value={`${k.delivered}/${k.committed}`}
              sub={
                k.committed > 0
                  ? `${Math.round((k.delivered / k.committed) * 100)}% completed`
                  : '—'
              }
            />
            <Kpi
              label="Cost / Video"
              color="#E65100"
              value={k.costPerVideo > 0 ? money(Math.round(k.costPerVideo)) : '-'}
              sub="per delivered video"
            />
          </div>
        )}

        {brand.topVideos && brand.topVideos.length > 0 && (
          <div className="pc-topvids">
            <div className="pc-topvids-head">
              Top videos by GMV · {monthLabel(payload.month)}
              <span className="pc-topvids-sub">live from EUKA</span>
            </div>
            <div className="pc-topvids-body">
              <div className="pc-topvids-row">
                {brand.topVideos.map((v, i) => (
                  <a
                    key={v.url + i}
                    className="pc-topvid"
                    href={v.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={`${v.name} · ${money(v.gmv)} GMV · open on TikTok`}
                  >
                    <span className="pc-topvid-frame">
                      {v.thumb ? (
                        <img className="pc-topvid-thumb" src={v.thumb} alt="" loading="lazy" />
                      ) : (
                        <span className="pc-topvid-thumb pc-topvid-ph" aria-hidden>
                          ▶
                        </span>
                      )}
                      <span className="pc-topvid-rank">#{i + 1}</span>
                      <span className="pc-topvid-gmv">{money(v.gmv)}</span>
                    </span>
                    <span className="pc-topvid-name">{v.name}</span>
                    <span className="pc-topvid-views">
                      {v.views > 0 ? `${kNum(v.views)} views` : ' '}
                    </span>
                  </a>
                ))}
              </div>
              {k && (
                <div className="pc-topvids-totalwrap">
                  <div
                    className="pc-topvids-stats"
                    aria-label={`Totals for ${monthLabel(payload.month)}`}
                  >
                    <div
                      className="pc-topvids-stat views"
                      data-value={k.views}
                      title={`${k.views.toLocaleString()} views`}
                    >
                      <span className="pc-topvids-stat-ico" aria-hidden>
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </span>
                      <span className="pc-topvids-stat-lbl">Views</span>
                      <span className="pc-topvids-stat-val">{kNum(k.views)}</span>
                    </div>
                    <div
                      className="pc-topvids-stat gmv"
                      data-value={k.gmv}
                      title={`${money(k.gmv)} new video GMV`}
                    >
                      <span className="pc-topvids-stat-ico" aria-hidden>
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                          <polyline points="17 6 23 6 23 12" />
                        </svg>
                      </span>
                      <span className="pc-topvids-stat-lbl">GMV</span>
                      <span className="pc-topvids-stat-val">{money(k.gmv)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {brand.creators && (
          <div className="pc-card mt-4">
            <div className="pc-ct-head" style={{ gridTemplateColumns: COLS }}>
              <div className="pc-num">#</div>
              <div>Completed on</div>
              <div>Creator</div>
              <div className="pc-num">Deal</div>
              <div className="pc-num">Videos</div>
              <div className="pc-num">Total views</div>
              <div className="pc-num">New video GMV</div>
              <div className="pc-num">L30 GMV</div>
              <div className="pc-num">Items sold</div>
            </div>

            {brand.creators.length === 0 ? (
              <div className="pc-empty">
                <h3>No creators in {monthLabel(payload.month)}</h3>
                <p>Nothing was posted for {brand.brand} in this month.</p>
              </div>
            ) : (
              brand.creators.map((c, i) => {
                const id = `${c.name}-${i}`;
                const isOpen = open === id;
                const tag = c.hiredBy ? HIRED_BY[c.hiredBy.trim().toLowerCase()] : null;
                return (
                  <div key={id}>
                    <div
                      className={`pc-ct-row ${isOpen ? 'open' : ''}`}
                      style={{
                        gridTemplateColumns: COLS,
                        cursor: c.videos?.length ? 'pointer' : 'default',
                      }}
                      onClick={() => c.videos?.length && setOpen(isOpen ? null : id)}
                      data-creator={c.name}
                      data-deal={c.deal}
                      data-delivered={c.delivered}
                      data-views={c.views}
                      data-gmv={c.gmv}
                    >
                      <div className="pc-cell pc-num" data-label="#">
                        <span className="pc-idx">#{i + 1}</span>
                      </div>
                      <div className="pc-cell" data-label="Completed on">
                        {c.completedOn ? (
                          dayLabel(c.completedOn)
                        ) : (
                          <span className="pc-handle">-</span>
                        )}
                      </div>
                      <div className="pc-cell" data-label="Creator">
                        <span className="pc-creatorcell">
                          {/* No deals circle: how many campaigns this person
                              runs with our other clients is ours, not theirs. */}
                          <Face name={c.name} handle={c.tiktok[0]} />
                          <span className="pc-creatorcell-txt">
                            <span className="pc-cname">{c.name || '-'}</span>
                            {c.tiktok[0] ? (
                              <a
                                className="pc-handle pc-handle-sub"
                                href={profileUrl(c.tiktok[0])}
                                target="_blank"
                                rel="noreferrer noopener"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {handleOf(c.tiktok[0])}
                              </a>
                            ) : (
                              <span className="pc-handle pc-handle-sub">-</span>
                            )}
                          </span>
                          {c.tier && (
                            <span
                              className={`pc-tierbadge ${c.tier.toLowerCase()}`}
                              title={`EUKA creator tier ${c.tier}`}
                            >
                              {c.tier}
                            </span>
                          )}
                          {tag && (
                            <span
                              className="pc-hbtag"
                              style={{ color: tag.fg, background: tag.bg }}
                              title={c.hiredBy ?? ''}
                            >
                              {tag.i}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="pc-cell pc-num" data-label="Deal">
                        {c.deal > 0 ? (
                          <span className="pc-money">
                            {money(c.deal)}
                            {c.perVideo ? (
                              <span className="pc-deal-per"> · {money(c.perVideo)}/vid</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="pc-handle">-</span>
                        )}
                      </div>
                      <div className="pc-cell pc-num" data-label="Videos">
                        <span className="pc-metric">
                          {c.delivered}
                          {c.committed ? (
                            <span style={{ opacity: 0.6 }}>/{c.committed}</span>
                          ) : null}
                        </span>
                      </div>
                      <div className="pc-cell pc-num" data-label="Total views">
                        {c.views > 0 ? (
                          <span className="pc-metric">{kNum(c.views)}</span>
                        ) : (
                          <span className="pc-handle">-</span>
                        )}
                      </div>
                      <div className="pc-cell pc-num" data-label="New video GMV">
                        {c.gmv > 0 ? (
                          <span className="pc-metric pc-metric-gmv">
                            {money(Math.round(c.gmv))}
                          </span>
                        ) : (
                          <span className="pc-handle">-</span>
                        )}
                      </div>
                      <div className="pc-cell pc-num" data-label="L30 GMV">
                        {c.l30 ? (
                          <span className="pc-l30-cell">{money(Math.round(c.l30))}</span>
                        ) : (
                          <span className="pc-l30-cell muted">–</span>
                        )}
                      </div>
                      <div className="pc-cell pc-num" data-label="Items sold">
                        {c.items > 0 ? (
                          <span className="pc-metric">{c.items}</span>
                        ) : (
                          <span className="pc-handle">-</span>
                        )}
                      </div>
                    </div>

                    {isOpen && c.videos && (
                      <div className="wx-share-videos">
                        {c.videos.map((v, vi) => (
                          <div key={v.url + vi} className="wx-share-video">
                            <a href={v.url} target="_blank" rel="noreferrer noopener">
                              Video {vi + 1}
                            </a>
                            <span>{v.date ? dayLabel(v.date) : '–'}</span>
                            <span>{kNum(v.views)} views</span>
                            <span className="wx-share-gmv">{money(v.gmv)}</span>
                            {v.items > 0 && <span>{v.items} sold</span>}
                            {v.product && (
                              <span className="wx-share-product" title={v.product}>
                                {v.product}
                              </span>
                            )}
                            {v.spark && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void navigator.clipboard?.writeText(v.spark ?? '');
                                  setCopied(v.url + vi);
                                  window.setTimeout(() => setCopied(null), 1600);
                                }}
                              >
                                {copied === v.url + vi ? 'Copied' : 'Copy spark code'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <footer className="border-line text-muted mt-10 border-t pt-6 text-xs">
        <p>Shared with you by Wurx Media. This page is read only and works until {expires}.</p>
        <p className="mt-1">Figures come from TikTok Shop and update through the day.</p>
      </footer>
    </Shell>
  );
}

/**
 * The creator's picture, by the same chain the staff row uses (`CreatorFace`):
 * their TikTok photo, and an initial when there is none. Rashid: "I told you to
 * keep the ui same why can't see avatarts".
 *
 * The picture comes from unavatar.io by handle, which is where the staff screen
 * gets it too, so the two screens show the same face. Nothing but the public
 * handle is sent, and a failure falls back to the initial rather than a gap.
 */
function Face({ name, handle }: { name: string; handle?: string }) {
  const [failed, setFailed] = useState(false);
  const h = handle ? handleOf(handle).replace(/^@/, '') : '';
  if (!h || failed) {
    return (
      <span className="pc-face" style={{ width: 30, height: 30, fontSize: 12 }}>
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      className="pc-face"
      src={`https://unavatar.io/tiktok/${encodeURIComponent(h)}?fallback=false`}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      style={{ width: 30, height: 30 }}
      onError={() => setFailed(true)}
    />
  );
}

function Kpi({
  label,
  color,
  value,
  sub,
}: {
  label: string;
  color: string;
  value: string;
  sub?: string;
}) {
  const pct = sub ? Number(sub.match(/(\d+(?:\.\d+)?)\s*%/)?.[1] ?? NaN) : NaN;
  return (
    <div className="pc-kpi" style={{ '--kpi-color': color } as React.CSSProperties}>
      <div className="pc-kpi-row">
        <span className="pc-kpi-badge" aria-hidden />
        <div className="pc-kpi-label">{label}</div>
      </div>
      <div>
        <div className="pc-kpi-value">{value}</div>
        {Number.isFinite(pct) && (
          <div className="pc-kpi-track" aria-hidden>
            <div
              className="pc-kpi-fill"
              style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
          </div>
        )}
        {sub && <div className="pc-kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-bg min-h-dvh px-4 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-[1600px]">
        <div className="mb-8 flex items-center justify-between">
          <PrismMark />
        </div>
        {children}
      </div>
    </div>
  );
}
