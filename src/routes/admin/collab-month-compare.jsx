/**
 * THIS MONTH AGAINST LAST, FOR ONE BRAND.
 *
 * Rashid, 2026-11-04: "a data comparison between selected month and
 * selected-1 month ... also tell which creators we worked with last month are
 * also working with us the current month".
 *
 * OURS, NOT THE VENDORED COPY'S. The brand drilldown in `WurxUI.jsx` is a
 * verbatim copy of WurxBase, so this lives here and is mounted from there on one
 * fenced line. The helpers it needs (deal parsing, delivered-video counting, the
 * once-per-video totals) are handed in rather than imported, because importing
 * them back from `WurxUI` would be a circular import.
 *
 * WHAT A "MONTH" IS HERE. The contract cycle: a creator row belongs to the month
 * of its `hiring_date`, exactly as the budget, allocated and paid cards on the
 * same screen do. Views and GMV are the totals of that month's creators' videos,
 * not of the videos posted in that calendar month, so this compares like with
 * like with the cards above it.
 *
 * WHO COUNTS AS THE SAME CREATOR. The TikTok handle, lower-cased, with the @ and
 * any profile URL stripped, and either of a creator's two accounts matching
 * either of the other's. A name is only used when a row has no handle at all,
 * because two people can share a first name and one person can be typed three
 * ways.
 *
 * NOTHING IS INVENTED. A month with no creators shows dashes, not zeros, and a
 * change against a month of nothing is "new", not "+∞%".
 */
import { useMemo, useState } from 'react';

export const prevMonthKey = (month) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return '';
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo < 1) {
    mo = 12;
    y -= 1;
  }
  return `${y}-${String(mo).padStart(2, '0')}`;
};

export const handleKey = (raw) => {
  if (!raw) return '';
  let t = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (t.includes('/')) t = t.split('/').pop() || '';
  return t.replace(/^@+/, '');
};

/** Every identity a creator row answers to: its handles, else its name. */
export const identitiesOf = (c) => {
  const ids = [c && c.tiktok_account, c && c.tiktok_account_2].map(handleKey).filter(Boolean);
  if (ids.length) return ids.map((h) => `h:${h}`);
  const n = String((c && c.name) || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return n ? [`n:${n}`] : [];
};

/** Everything about one month's creators that the comparison shows. */
export function summarise(rows, helpers) {
  const { parseDealAmount, parseDealVideos, deliveredVideoCount, wxVideoTotals } = helpers;
  let allocated = 0,
    paid = 0,
    videos = 0,
    delivered = 0;
  rows.forEach((c) => {
    const amt = parseDealAmount(c.deal);
    allocated += amt;
    if (c.payment_status === 'Paid') paid += amt;
    videos += parseDealVideos(c.deal);
    delivered += deliveredVideoCount(c);
  });
  const t = wxVideoTotals(rows);
  return {
    creators: rows.length,
    allocated,
    paid,
    videos,
    delivered,
    views: t.views,
    gmv: t.gmv,
    costPerVideo: videos > 0 ? allocated / videos : 0,
    completion: videos > 0 ? (delivered / videos) * 100 : 0,
  };
}

/**
 * The comparison itself. `rows` is every creator row the brand has, in any
 * month; `month` is the one on screen.
 */
export function compareMonths(rows, month, budgets, brand, helpers) {
  const prev = prevMonthKey(month);
  const inMonth = (mk) => rows.filter((c) => String(c.hiring_date || '').slice(0, 7) === mk);
  const curRows = inMonth(month);
  const prevRows = inMonth(prev);

  const budgetOf = (mk) => {
    const b = (budgets || []).find((x) => x.brand === brand && x.month === mk);
    return b ? Number(b.budget) || 0 : 0;
  };

  const cur = { ...summarise(curRows, helpers), budget: budgetOf(month) };
  const old = { ...summarise(prevRows, helpers), budget: budgetOf(prev) };

  /* Who is in which month. A creator hired twice in one month is one person. */
  const index = (list) => {
    const byId = new Map();
    const people = [];
    list.forEach((c) => {
      const ids = identitiesOf(c);
      let p = ids.map((i) => byId.get(i)).find(Boolean);
      if (!p) {
        p = { name: c.name || ids[0] || 'Unnamed', handle: '', rows: [] };
        people.push(p);
      }
      p.rows.push(c);
      if (!p.handle) p.handle = handleKey(c.tiktok_account) || handleKey(c.tiktok_account_2);
      ids.forEach((i) => byId.set(i, p));
    });
    return { byId, people };
  };
  const a = index(prevRows);
  const b = index(curRows);

  const figures = (p) => {
    const s = summarise(p.rows, helpers);
    return { allocated: s.allocated, videos: s.videos, delivered: s.delivered, gmv: s.gmv };
  };
  const matchIn = (idx, p) => {
    for (const row of p.rows)
      for (const i of identitiesOf(row)) {
        const hit = idx.byId.get(i);
        if (hit) return hit;
      }
    return null;
  };

  const stayed = [],
    dropped = [],
    joined = [];
  a.people.forEach((p) => {
    const now = matchIn(b, p);
    if (now)
      stayed.push({
        name: now.name,
        handle: now.handle || p.handle,
        before: figures(p),
        now: figures(now),
      });
    else dropped.push({ name: p.name, handle: p.handle, before: figures(p) });
  });
  b.people.forEach((p) => {
    if (!matchIn(a, p)) joined.push({ name: p.name, handle: p.handle, now: figures(p) });
  });

  const byGmv = (x, y) => (y.now || y.before).gmv - (x.now || x.before).gmv;
  stayed.sort(byGmv);
  dropped.sort(byGmv);
  joined.sort(byGmv);

  return {
    month,
    prev,
    cur,
    old,
    people: { before: a.people.length, now: b.people.length },
    stayed,
    dropped,
    joined,
    retention: a.people.length > 0 ? (stayed.length / a.people.length) * 100 : null,
  };
}

/* ─── the screen ───────────────────────────────────────────────────────── */

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const num = (n) => Math.round(n).toLocaleString('en-US');
const pct = (n) => `${Math.round(n)}%`;

/** "up 12%", "new", or a dash. `good` says which direction is the happy one. */
function Delta({ now, before, good = 'up', fmt = (n) => num(n), noPct = false }) {
  if (before == null || now == null) return <span className="wx-cmp-d none">–</span>;
  const diff = now - before;
  if (diff === 0) return <span className="wx-cmp-d flat">no change</span>;
  const up = diff > 0;
  const tone = good === 'neutral' ? 'flat' : up === (good === 'up') ? 'good' : 'bad';
  const rel =
    before > 0 && !noPct
      ? ` · ${up ? '+' : '−'}${Math.round(Math.abs(diff / before) * 100)}%`
      : '';
  return (
    <span className={`wx-cmp-d ${tone}`}>
      {up ? '▲' : '▼'} {up ? '+' : '−'}
      {fmt(Math.abs(diff))}
      {rel}
    </span>
  );
}

function Metric({ label, now, before, fmt, good, empty, noPct }) {
  return (
    <div className="wx-cmp-metric">
      <span className="wx-cmp-lbl">{label}</span>
      <span className="wx-cmp-now">{empty ? '–' : fmt(now)}</span>
      <span className="wx-cmp-was">{empty ? 'no data' : `was ${fmt(before)}`}</span>
      {!empty && <Delta now={now} before={before} fmt={fmt} good={good} noPct={noPct} />}
    </div>
  );
}

function PeopleList({ title, tone, hint, items, show }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 8);
  return (
    <section className={`wx-cmp-people ${tone}`}>
      <header>
        <h4>{title}</h4>
        <span className="wx-cmp-count">{items.length}</span>
      </header>
      <p className="wx-cmp-hint">{hint}</p>
      {items.length === 0 ? (
        <p className="wx-cmp-none">Nobody.</p>
      ) : (
        <ul>
          {shown.map((p, i) => (
            <li key={`${p.handle || p.name}-${i}`}>
              <span className="wx-cmp-who">
                <b>{p.name}</b>
                {p.handle && <em>@{p.handle}</em>}
              </span>
              <span className="wx-cmp-fig">{show(p)}</span>
            </li>
          ))}
        </ul>
      )}
      {items.length > 8 && (
        <button type="button" className="wx-cmp-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}

export function BrandMonthCompare({
  brand,
  month,
  allTime,
  rows,
  budgets,
  helpers,
  monthLabel,
}) {
  const [open, setOpen] = useState(true);
  const cmp = useMemo(
    () =>
      allTime || !month ? null : compareMonths(rows || [], month, budgets, brand, helpers),
    [rows, month, allTime, budgets, brand, helpers]
  );
  /* All Time has no "last month", so there is nothing honest to compare. */
  if (!cmp) return null;

  const { cur, old } = cmp;
  const noPrev = old.creators === 0;
  const lbl = (k) => (monthLabel ? monthLabel(k) : k);

  return (
    <div className="wx-cmp" data-wx="month-compare">
      <button
        type="button"
        className="wx-cmp-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="wx-cmp-title">
          {lbl(cmp.month)} vs {lbl(cmp.prev)}
          {cmp.month === new Date().toISOString().slice(0, 7) ? ' · month in progress' : ''}
        </span>
        <span className="wx-cmp-sub">
          {noPrev
            ? `No creators were hired in ${lbl(cmp.prev)}`
            : `${cmp.stayed.length} of ${cmp.people.before} creators from ${lbl(cmp.prev)} are back${cmp.retention != null ? ` · ${pct(cmp.retention)} retained` : ''}`}
        </span>
        <span className="wx-cmp-chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <>
          <div className="wx-cmp-grid">
            <Metric
              label="Budget"
              now={cur.budget}
              before={old.budget}
              fmt={usd}
              empty={cur.budget === 0 && old.budget === 0}
            />
            <Metric
              label="Allocated"
              now={cur.allocated}
              before={old.allocated}
              fmt={usd}
              empty={cur.creators === 0 && noPrev}
            />
            <Metric
              label="Paid"
              now={cur.paid}
              before={old.paid}
              fmt={usd}
              empty={cur.creators === 0 && noPrev}
            />
            <Metric
              label="Creators"
              now={cur.creators}
              before={old.creators}
              fmt={num}
              empty={cur.creators === 0 && noPrev}
            />
            <Metric
              label="Videos committed"
              now={cur.videos}
              before={old.videos}
              fmt={num}
              empty={cur.creators === 0 && noPrev}
            />
            <Metric
              label="Videos delivered"
              now={cur.delivered}
              before={old.delivered}
              fmt={num}
              empty={cur.creators === 0 && noPrev}
            />
            <Metric
              label="Completion"
              now={cur.completion}
              before={old.completion}
              fmt={pct}
              noPct
              empty={cur.videos === 0 && old.videos === 0}
            />
            <Metric
              label="Cost / video"
              now={cur.costPerVideo}
              before={old.costPerVideo}
              fmt={usd}
              good="down"
              empty={cur.videos === 0 || old.videos === 0}
            />
            <Metric
              label="Views"
              now={cur.views}
              before={old.views}
              fmt={num}
              empty={cur.views === 0 && old.views === 0}
            />
            <Metric
              label="GMV"
              now={cur.gmv}
              before={old.gmv}
              fmt={usd}
              empty={cur.gmv === 0 && old.gmv === 0}
            />
          </div>

          <div className="wx-cmp-cols">
            <PeopleList
              title={`Working with us again`}
              tone="stayed"
              hint={`Hired in ${lbl(cmp.prev)} and in ${lbl(cmp.month)}`}
              items={cmp.stayed}
              show={(p) =>
                `${usd(p.before.allocated)} → ${usd(p.now.allocated)} · ${p.now.delivered}/${p.now.videos} videos`
              }
            />
            <PeopleList
              title="Not back this month"
              tone="dropped"
              hint={`Hired in ${lbl(cmp.prev)}, not in ${lbl(cmp.month)}`}
              items={cmp.dropped}
              show={(p) =>
                `${usd(p.before.allocated)} · ${p.before.delivered}/${p.before.videos} videos · ${usd(p.before.gmv)} GMV`
              }
            />
            <PeopleList
              title="New this month"
              tone="joined"
              hint={`Hired in ${lbl(cmp.month)}, not in ${lbl(cmp.prev)}`}
              items={cmp.joined}
              show={(p) =>
                `${usd(p.now.allocated)} · ${p.now.delivered}/${p.now.videos} videos`
              }
            />
          </div>
          <p className="wx-cmp-foot">
            Months are contract cycles (the month a creator was hired). Views and GMV are the
            videos of that month's creators. "Back" means the same TikTok handle.
          </p>
        </>
      )}
    </div>
  );
}
