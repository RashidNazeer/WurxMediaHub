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
import { useEffect, useMemo, useState } from 'react';
import { eukaJson } from '@/vendor/wurxbase/supabaseClient';

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
 * THE LAST THREE MONTHS, ONE PLACE PER CREATOR.
 *
 * Rashid, 2026-11-05: "the repeated creators of September that worked in October
 * will be displayed in October only, and the creators of September who are no
 * longer with us will also be shown."
 *
 * So a creator is listed ONCE, in the newest of the three months they were hired
 * in. Someone hired in Aug, Sep and Oct sits under Oct, with a trail showing the
 * two months before. Someone hired in Aug and Sep but not Oct sits under Sep, as
 * having left after Sep. Someone hired only in Aug sits under Aug. Reading the
 * columns left to right is reading who stayed and who dropped off, month by month.
 */
export function compareMonths(rows, month, budgets, brand, helpers, live) {
  const m1 = prevMonthKey(month);
  const m2 = prevMonthKey(m1);
  const months = [m2, m1, month];
  const inMonth = (mk) => rows.filter((c) => String(c.hiring_date || '').slice(0, 7) === mk);
  const monthRows = months.map(inMonth);

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
  const idx = monthRows.map(index);

  const matchIn = (ix, p) => {
    for (const row of p.rows)
      for (const i of identitiesOf(row)) {
        const hit = ix.byId.get(i);
        if (hit) return hit;
      }
    return null;
  };
  const figures = (p) => {
    const s = summarise(p.rows, helpers);
    return { videos: s.videos, delivered: s.delivered, gmv: s.gmv };
  };

  /* WHAT EACH PERSON HAS MADE THIS MONTH, WHENEVER THEY WERE HIRED.
     Rashid, 2026-11-25: a creator hired in October and dropped from the roster
     can still be one of the brand's top sellers in November, because her
     October videos keep selling and she posts more. So this reads every row the
     brand holds for her, not only the rows hired in the column's month, and
     keeps the videos POSTED in the current month. As everywhere on this page, a
     video's GMV is its running total to date (see lib/admin/collab-period.ts).
     A video with no usable date cannot be placed in a month, so it is left out. */
  const postedMonth = (r) => {
    const raw = String((r && r.date) || '').trim();
    if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
    const d = raw ? new Date(raw) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 7) : '';
  };
  const everyone = index(rows);
  const thisMonthFor = (p) => {
    const seen = new Set();
    const mine = [];
    p.rows.forEach((row) =>
      identitiesOf(row).forEach((i) => {
        const hit = everyone.byId.get(i);
        if (hit && !seen.has(hit)) {
          seen.add(hit);
          mine.push(...hit.rows);
        }
      })
    );
    const clipped = [...new Set(mine)].map((c) => ({
      ...c,
      video_codes: (Array.isArray(c.video_codes) ? c.video_codes : []).filter((r) => postedMonth(r) === month),
    }));
    const t = helpers.wxVideoTotals(clipped);
    let gmv = t.gmv;
    let videos = t.all.length;
    /* THE LIVE FIGURE, WHEN WE HAVE ONE. Our own rows only keep a video posted
       inside the month that creator was hired for, so a creator hired in October
       who keeps posting in November has her November videos in Euka but not
       here. Euka's month, summed by handle, is the whole of it. The larger of
       the two is shown, because both only ever grow. */
    if (live && live.byHandle) {
      const handles = new Set();
      mine.forEach((c) => [c.tiktok_account, c.tiktok_account_2].map(handleKey).filter(Boolean).forEach((h) => handles.add(h)));
      let lg = 0;
      let lv = 0;
      handles.forEach((h) => {
        const e = live.byHandle.get(h);
        if (e) {
          lg += e.gmv;
          lv += e.videos;
        }
      });
      if (lg > gmv) {
        gmv = lg;
        videos = Math.max(videos, lv);
      }
    }
    return { gmv, videos };
  };

  /* Totally new: no hire in any earlier month at all (not only the two shown),
     so someone back after a long gap is not "new". */
  const before = index(
    rows.filter((c) => {
      const mk = String(c.hiring_date || '').slice(0, 7);
      return mk && mk < month;
    })
  );

  /* Walk from the newest month back; a person already placed later is skipped. */
  const columns = months.map((mk, i) => ({ month: mk, i, people: [], count: idx[i].people.length }));
  for (let i = 2; i >= 0; i--) {
    idx[i].people.forEach((p) => {
      const trail = idx.map((ix, j) => (j === i ? true : !!matchIn(ix, p)));
      if (trail.slice(i + 1).some(Boolean)) return;
      columns[i].people.push({
        name: p.name,
        handle: p.handle,
        trail,
        returning: trail.slice(0, i).some(Boolean),
        fresh: i === 2 && !matchIn(before, p),
        fig: figures(p),
        now: thisMonthFor(p),
        /* What they did in each of the three months, or null where not hired. */
        figs: idx.map((ix, j) => (trail[j] ? figures(j === i ? p : matchIn(ix, p)) : null)),
      });
    });
    columns[i].people.sort((x, y) => y.fig.gmv - x.fig.gmv);
  }

  /* Totally new: this month's creators with no hire in any earlier month at all
     (not only the two shown), so someone back after a long gap is not "new". */
  const fresh = columns[2].people.filter((p) => p.fresh);
  columns[2].people = columns[2].people.filter((p) => !p.fresh);
  columns[3] = { month, i: 3, count: fresh.length, people: fresh };

  /* Of the people hired in one month, how many were hired again the next. */
  const flow = (a, b) => {
    const total = idx[a].people.length;
    const stayed = idx[a].people.filter((p) => matchIn(idx[b], p)).length;
    return { from: months[a], to: months[b], total, stayed, pct: total > 0 ? (stayed / total) * 100 : null };
  };

  return { month, months, columns, flows: [flow(0, 1), flow(1, 2)] };
}

/* ─── the screen ───────────────────────────────────────────────────────── */

const FIRST = 8;

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

/** The real current month, `YYYY-MM`. The comparison always ends here. */
const thisMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** One column: a title, a count, and the creators placed under that month. */
function Column({ title, sub, tone, people, Face, gmvMonth, nowMonth }) {
  const [all, setAll] = useState(false);
  const shown = all ? people : people.slice(0, FIRST);
  return (
    <section className={`wx-cmp-col ${tone}`}>
      <header>
        <span className="wx-cmp-dot" aria-hidden />
        <h4>{title}</h4>
        <span className="wx-cmp-count">{people.length}</span>
      </header>
      <p className="wx-cmp-hint">{sub}</p>
      {people.length === 0 ? (
        <p className="wx-cmp-none">Nobody.</p>
      ) : (
        <ul>
          {shown.map((p, i) => (
            <li key={`${p.handle || p.name}-${i}`} className="wx-cmp-row">
              {Face ? (
                <Face handle={p.handle} name={p.name} size={36} />
              ) : (
                <span className="wx-cmp-initial">{(p.name || '?')[0].toUpperCase()}</span>
              )}
              <span className="wx-cmp-who">
                <b>{p.name}</b>
                {p.handle && <em>@{p.handle}</em>}
              </span>
              <span
                className="wx-cmp-fig"
                title={`${gmvMonth} contract with this brand: ${p.fig.delivered} of ${p.fig.videos} videos delivered, ${
                  p.fig.gmv > 0 ? `${usd(p.fig.gmv)} GMV` : 'no GMV reported'
                }. Videos posted so far in ${nowMonth}: ${p.now.gmv > 0 ? `${usd(p.now.gmv)} GMV from ${p.now.videos}` : 'none with GMV'}.`}
              >
                <b>{p.fig.videos > 0 ? `${p.fig.delivered}/${p.fig.videos}` : '–'}</b>
                {/* GMV made so far for this brand in the month they are listed under,
                    so the team can see what a creator earned us before re-onboarding
                    them. No GMV reported is a dash, never $0. */}
                <em>{p.fig.gmv > 0 ? `${usd(p.fig.gmv)} GMV` : 'no GMV'}</em>
                {/* What she has made for this brand from videos posted so far THIS
                    month, whichever month she was hired in. */}
                <strong className={p.now.gmv > 0 ? 'wx-cmp-now' : 'wx-cmp-now none'}>
                  {nowMonth} {p.now.gmv > 0 ? usd(p.now.gmv) : '–'}
                </strong>
              </span>
            </li>
          ))}
        </ul>
      )}
      {people.length > FIRST && (
        <button type="button" className="wx-cmp-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${people.length}`}
        </button>
      )}
    </section>
  );
}

/**
 * The month the comparison ends on, taken from what the calendar shows. A range
 * that crosses months (Last 30 days, Last 6 months) has no single month for the
 * contract, but it does have an END, and that is the month the reader is looking
 * at: Oct 6 - Nov 4 ends in November. All Time has no calendar, so it is today.
 */
const MONTH_KEY = /^\d{4}-\d{2}$/;
const anchorMonth = ({ month, allTime, periodRange }) => {
  if (allTime) return thisMonthKey();
  const end = String((periodRange && periodRange.to) || '').slice(0, 7);
  if (MONTH_KEY.test(end)) return end;
  return MONTH_KEY.test(String(month || '')) ? month : thisMonthKey();
};

/**
 * The picked month and the two before it (Oct picked: Aug, Sep, Oct), as
 * Rashid asked on 2026-11-05. With All Time picked there is no month to follow,
 * so it falls back to the real current month.
 * Laid out side by side, oldest to newest, so the page reads left to right.
 */
export function BrandMonthCompare({ brand, month, allTime, periodRange, rows, budgets, helpers, monthLabel, liveSource }) {
  const [open, setOpen] = useState(true);
  const anchor = anchorMonth({ month, allTime, periodRange });

  /* Euka's videos for the whole month, by handle. Only for brands whose videos
     come from Euka (Reacher brands keep what the sync files). If it cannot be
     had, the card falls back to what our own rows hold. */
  const [live, setLive] = useState(null);
  useEffect(() => {
    setLive(null);
    if (liveSource !== 'euka' || !MONTH_KEY.test(anchor)) return undefined;
    let alive = true;
    (async () => {
      try {
        const meta = await eukaJson();
        const store = meta && helpers && helpers.eukaStoreForBrand ? helpers.eukaStoreForBrand(meta.stores, brand) : null;
        if (!store) return;
        const [y, m] = anchor.split('-').map(Number);
        const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        const d = await eukaJson({ store: store.id, type: 'videos', from: `${anchor}-01`, to: last < today ? last : today });
        if (!alive || !d || !d.videos) return;
        const byHandle = new Map();
        Object.entries(d.videos).forEach(([h, vids]) => {
          let gmv = 0;
          let n = 0;
          (vids || []).forEach((v) => {
            if (String(v.date || '').slice(0, 7) !== anchor) return;
            gmv += Number(v.revenue) || 0;
            n += 1;
          });
          if (n) byHandle.set(handleKey(h), { gmv, videos: n });
        });
        setLive({ byHandle });
      } catch {
        /* the card keeps the stored figure */
      }
    })();
    return () => {
      alive = false;
    };
  }, [liveSource, anchor, brand, helpers]);

  const cmp = useMemo(
    () => compareMonths(rows || [], anchor, budgets, brand, helpers, live),
    [rows, anchor, budgets, brand, helpers, live]
  );

  const lbl = (k) => (monthLabel ? monthLabel(k) : k);
  const short = (k) => lbl(k).split(' ')[0];
  const Face = helpers && helpers.CreatorFace;
  const { columns, flows } = cmp;
  const [c0, c1, c2, c3] = columns;
  const empty = columns.every((c) => c.count === 0) && c2.people.length === 0;

  const notes = flows
    .filter((f) => f.total > 0)
    .map((f) => `${f.stayed} of ${short(f.from)}'s ${f.total} were hired again in ${short(f.to)}`);

  return (
    <div className="wx-cmp" data-wx="month-compare">
      <button
        type="button"
        className="wx-cmp-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="wx-cmp-title">Creators, last three months</span>
        <span className="wx-cmp-chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open &&
        (empty ? (
          <p className="wx-cmp-none pad">No creators were hired in the last three months.</p>
        ) : (
          <>
            {notes.length > 0 && <p className="wx-cmp-notes">{notes.join(' · ')}</p>}
            <div className="wx-cmp-cols">
              <Column
                title={`Left after ${short(c0.month)}`}
                sub={`Hired in ${lbl(c0.month)}, not since`}
                tone="dropped"
                people={c0.people}
                Face={Face}
                gmvMonth={short(c0.month)}
                nowMonth={short(c2.month)}
              />
              <Column
                title={`Left after ${short(c1.month)}`}
                sub={`Hired in ${lbl(c1.month)}, not in ${lbl(c2.month)}`}
                tone="dropped"
                people={c1.people}
                Face={Face}
                gmvMonth={short(c1.month)}
                nowMonth={short(c2.month)}
              />
              <Column
                title={`Back in ${short(c2.month)}`}
                sub={`Hired in ${lbl(c2.month)}, and before`}
                tone="stayed"
                people={c2.people}
                Face={Face}
                gmvMonth={short(c2.month)}
                nowMonth={short(c2.month)}
              />
              <Column
                title={`New in ${short(c2.month)}`}
                sub={`First time hired, ${lbl(c2.month)}`}
                tone="fresh"
                people={c3.people}
                Face={Face}
                gmvMonth={short(c2.month)}
                nowMonth={short(c2.month)}
              />
            </div>
            <p className="wx-cmp-foot">
              Each creator is listed once, under the latest month they were hired. On the right:
              videos delivered out of committed, then the GMV they made for this brand so far in
              the month they are listed under. The last line is what they have made for this brand
              from videos posted so far in {short(c2.month)}, whenever they were hired. "No GMV" means none reported. Same TikTok handle means same creator.
            </p>
          </>
        ))}
    </div>
  );
}
