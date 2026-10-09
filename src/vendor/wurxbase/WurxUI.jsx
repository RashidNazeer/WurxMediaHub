/* WURX-ADDED · Ad Spend and ROI ─────────────────────────────────────────────
   This file is otherwise a VERBATIM copy of the WurxBase app. Every change of
   ours sits inside a WURX-ADDED ... WURX-END block, so pulling a newer version
   from upstream is a find-and-reapply job rather than diff archaeology. Nothing
   of theirs is edited or removed; these blocks only add.

   The import reads OUR ad figures out of a React context that our own route
   provides. It is NOT our Supabase client and names no project of ours, so this
   file still cannot reach our database — which is what pnpm verify:isolation
   asserts on every build. See src/routes/admin/collab-ad-figures.tsx.

   The join needs no brand matching: their video links carry TikTok's numeric
   video id, and that is the same id our ad figures are keyed on. */
import {
  useCollabAdFigures as wxAdsHook,
  videoIdsOf as wxVideoIds,
  totalsOf as wxTotals,
  tiktokVideoId as wxVideoId,
  money as wxMoney,
  roiText as wxRoi,
} from '@/routes/admin/collab-ad-figures';
/* WURX-END */
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { can } from './access';
import { createPortal } from 'react-dom';
import { supabase, selectAll, eukaJson, lastEukaFailure, collabProducts, brandSource, runReacherSync } from './supabaseClient';
import { godGet, godMoney, godDateParts, colTemplate, colStyle,
  visibleCols } from './godSettings';
import { generateContractPdf, defaultContractFields, CONTRACT_SECTIONS, renderContractPdf } from './contractPdf';
import { mergeContract, getBrandContract, saveBrandContract,
  fetchBrandContracts } from './brandContract';
import './paidcollabs.css';

/* WURX-ADDED · where their overlays go.

   Every `createPortal` in this app targeted `document.body`, which is OUTSIDE
   `.wurxbase-root` — so every rule in their own stylesheet, all of which the
   vendoring fenced under that class, missed. Ten overlays rendered with no
   styling whatsoever: the status dropdown came out as a bare full-width block
   at the bottom of the document, which is why clicking "Payment Pending" and
   the eye icon appeared to do nothing at all.

   The host is a div our route renders INSIDE `.wurxbase-root` and OUTSIDE
   `.wurxbase-fence`. Inside the root so their CSS matches; outside the fence
   because the fence is transformed and contained, which would make every
   `position: fixed` overlay measure itself against a scrolled box instead of
   the screen.

   Falls back to `document.body` so their app still renders standalone. */
function wxPortalHost() {
  return (typeof document !== 'undefined' && document.getElementById('wurxbase-portal-host')) || document.body;
}


/* ════════════════════════════════════════════════════════════════
   WURX MEDIA · 4-tab month-centric dashboard
   Tabs: Brands · Creators · Performance · Reporting
   Reuses the Afflix design tokens (.pc-* classes) for visual cohesion.
════════════════════════════════════════════════════════════════ */

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const HIRED_BY_OPTIONS = ['Aris', 'Emily', 'Myles', 'Khushi'];

/* ── EUKA L30 GMV · lookup helpers ─────────────────────────────────
   Data shape from the `euka` Edge Function (see supabaseClient.js):
     { handles: { "<handle>": overallL30Gmv } }
   `last_30d_gmv` from EUKA's creator_level export is the creator's
   OVERALL last-30-days GMV across TikTok Shop — store-independent, so
   lookup is purely by handle (no brand matching). Our DB stores handles
   in many forms (@handle, bare, full tiktok.com URL) — normalize all. */
const _normEukaHandle = (raw) => {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  const at = s.lastIndexOf('@');
  if (at >= 0) s = s.slice(at + 1);          // "@h" or "…tiktok.com/@h" → "h…"
  s = s.split(/[/?#]/)[0].trim();            // drop trailing /video/…, ?query
  return s;
};
function eukaL30For(euka, handles) {
  if (!euka) return null;
  let sum = 0, found = false;
  const vidMap = getVidProfileMap();
  (handles || []).forEach(h => {
    const key = _normEukaHandle(h);
    if (!key) return;
    if (euka.handles && euka.handles[key] != null) { sum += Number(euka.handles[key]) || 0; found = true; }
    else if (vidMap[key]?.gmv > 0) { sum += vidMap[key].gmv; found = true; }
  });
  return found ? sum : null;
}
/* ── Creator-editor autocomplete · ranked matching + highlight ──
   Rank: handle-prefix (0.5) beats name-prefix (0) ties via min() ·
   word-prefix (1) · name-substring (2) · handle-substring (2.5).
   Exact matches stay in the list (old code hid them — typing the full
   name made the autofill suggestion vanish right when you needed it). */
function _sugRank(d, q) {
  const name = (d.name || '').toLowerCase();
  let s = Infinity;
  if (name.startsWith(q)) s = 0;
  else if (name.split(/\s+/).some(w => w.startsWith(q))) s = 1;
  else if (name.includes(q)) s = 2;
  [d.tiktok_account, d.tiktok_account_2].forEach(h => {
    const hh = _normEukaHandle(h);
    if (!hh) return;
    if (hh.startsWith(q)) s = Math.min(s, 0.5);
    else if (hh.includes(q)) s = Math.min(s, 2.5);
  });
  return s;
}
function rankDirectory(directory, rawQ, limit = 7) {
  const q = String(rawQ || '').trim().toLowerCase();
  if (q.length < 2) return [];
  return directory
    .map(d => [d, _sugRank(d, q)])
    .filter(([, s]) => s !== Infinity)
    .sort((a, b) => a[1] - b[1] || (a[0].name || '').localeCompare(b[0].name || ''))
    .slice(0, limit)
    .map(([d]) => d);
}
/* Bold the matched substring inside a suggestion row */
function SugHighlight({ text, q }) {
  const t = String(text || '');
  const i = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{t}</>;
  return <>{t.slice(0, i)}<b style={{ color: 'var(--pc-accent)' }}>{t.slice(i, i + q.length)}</b>{t.slice(i + q.length)}</>;
}

/* Merged EUKA profile across a creator's handles (followers, tier, …) */
function eukaProfileFor(euka, handles) {
  if (!euka) return null;
  const vidMap = getVidProfileMap();
  let out = null;
  (handles || []).forEach(h => {
    const key = _normEukaHandle(h);
    if (!key) return;
    const p = euka.profiles && euka.profiles[key];
    if (p) out = { ...p, ...(out || {}) };
    // creator_level (30-day window) missed this creator — fall back to the
    // tier/GMV harvested from their video-export rows (wider history)
    if ((!out || !out.tier) && vidMap[key]?.tier) out = { ...(out || {}), tier: vidMap[key].tier };
  });
  return out;
}

/* Compact metric number · 843 / 12.4K / 1.2M */
function kNum(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(v));
}

/* Per-store "Total GMV" (last 30d generated FOR THIS BRAND's shop) ·
   resolves the EUKA store by brand name, then sums the creator's handles */
function eukaShopGmvFor(euka, brandName, handles) {
  if (!euka || !euka.shopByStore) return null;
  const store = eukaStoreForBrand(euka.stores, brandName);
  const map = store ? euka.shopByStore[_normEukaBrand(store.name)] : null;
  if (!map) return null;
  let sum = 0, found = false;
  (handles || []).forEach(h => {
    const k = _normEukaHandle(h);
    if (k && map[k] != null) { sum += Number(map[k]) || 0; found = true; }
  });
  return found ? sum : null;
}

/* ── DB-persisted EUKA stats · creators.monthly.euka ──
   Written nightly (and on demand) by the euka-checkin background function,
   which sweeps all 9 stores across creator_level + collab invites + full
   video history. Because it lives on the row, every device has it the
   instant creators load — no client-side sweep, no localStorage warm-up.
   `monthly` is the Performance-matrix JSONB; its readers only ever sum
   `.gmv` / `.adSpent` per key, so an `euka` key is inert to them. */
function dbEuka(c) {
  const v = c && c.monthly && c.monthly.euka;
  return v && (v.tier || Number(v.l30) > 0) ? v : null;
}
/* WURX-ADDED · LIVE FIRST, STORED AS THE FALLBACK. This was the other way
   round, and that is a second reason our figures differed from theirs.

   `monthly.euka` is a CACHE, refreshed nightly by a scheduled Netlify function
   (`euka-checkin-background`) that was never vendored in — it lives outside
   their `src/`, and it writes to the Supabase project that was retired on
   2026-08-28. So on their deployment the cache is a day old and the DB-first
   rule is harmless; on ours it is frozen at whatever it held on migration day
   and drifts further every morning. 800 of 1000 creators carry a stored L30
   stamped between 29 July and 28 August, and every one of them was being shown
   in preference to today's number.

   Reading live first fixes it without needing that job: a figure fetched
   minutes ago beats one cached weeks ago. The cache still earns its place as
   the fallback, because `creator_level` only covers the last thirty days from
   today, so a creator who has not posted recently drops out of the live sweep
   entirely — and their last known figure is much better than a dash. It also
   covers the seconds before the sweep returns. */
function creatorTier(c, euka) {
  const p = eukaProfileFor(euka, [c?.tiktok_account, c?.tiktok_account_2]);
  if (p && p.tier) return p.tier;
  const db = dbEuka(c);
  return (db && db.tier) || '';
}
function creatorL30(c, euka) {
  const live = eukaL30For(euka, [c?.tiktok_account, c?.tiktok_account_2]);
  if (live != null) return live;
  const db = dbEuka(c);
  return db && Number(db.l30) > 0 ? Number(db.l30) : null;
}

/* Shared cell renderer · '–' when EUKA has no record of this creator */
function EukaL30Cell({ euka, handles, c }) {
  const v = c ? creatorL30(c, euka) : eukaL30For(euka, handles);
  if (v == null) return euka ? <span className="pc-l30-cell muted">–</span> : <span className="pc-l30-cell loading">…</span>;
  return <span className="pc-l30-cell">{fmt$Exact(Math.round(v))}</span>;
}

/* ── Persisted UI state · restore last view + filters + drill-down on refresh ── */
const UI_STATE_KEY = 'wurx_ui_state_v1';
function loadUIState() {
  try { return JSON.parse(localStorage.getItem(UI_STATE_KEY) || '{}') || {}; }
  catch { return {}; }
}
function patchUIState(patch) {
  try {
    const cur = loadUIState();
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {}
}

/* WURX-ADDED · THE REMEMBERED MONTH EXPIRES AT THE END OF THE DAY.
   Rashid, 2026-10-09: Asad added HoneySticks and nobody else could see it —
   "asad is able to see the brand on his laptop but even he can't see on my
   laptop with his own account".

   THE MONTH IS REMEMBERED PER BROWSER, AND IT WAS REMEMBERED FOR EVER. The
   Brands screen lists the brands with a creator or a budget IN THE SELECTED
   MONTH, so a brand added for October is invisible to a browser still parked
   on September. Proved by experiment: one account, one machine, one build,
   only the saved month different — September hides HoneySticks, October shows
   it. Nothing to do with permissions, which is why signing in as the person
   who could see it changed nothing: the month came from the LAPTOP, not the
   login.

   Remembering it within a working day is the convenience it was added for.
   Remembering it across weeks is how a browser ends up showing September in
   November and quietly disagreeing with everybody else's. So it is stamped,
   and a stamp from another day is ignored. Anyone deliberately working in a
   past month still gets it back on every reload that day. */
function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function rememberedMonth(state) {
  if (!state || !state.month) return null;
  return state.monthSavedOn === todayStamp() ? state.month : null;
}
/* WURX-END */
function hiredByPalette(name) {
  switch ((name || '').trim()) {
    case 'Aris':   return { fg: '#171717', bg: '#F4F4F5', border: 'var(--wx-border-strong)' };  // soft black on warm gray
    case 'Emily':  return { fg: '#C2185B', bg: '#FCE4EC', border: 'var(--wx-border-strong)' };  // pink (unchanged)
    case 'Myles':  return { fg: '#6D28D9', bg: '#EDE9FE', border: 'var(--wx-border-interactive)' };  // rich violet / purple
    /* WURX-ADDED · rosewood darkened from #9C5C5C, which measured 4.27:1 on its
       own chip at 11px, under the 4.5 AA asks. Same hue, same chip, readable.
       The other four here already pass; only this one did not. */
    case 'Khushi': return { fg: '#8F5050', bg: '#F8E7E1', border: 'var(--wx-border-strong)' };  // pinkish-brown (rosewood)
    default:       return { fg: '#5C5C5E', bg: '#F5F5F7', border: 'var(--wx-border)' };  // neutral gray
  }
}
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#6366F1,#8B5CF6)',
  'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#14B8A6,#06B6D4)',
  'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)',
  'linear-gradient(135deg,#3B82F6,#2563EB)',
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
];

// Full money format · always 2 decimals + thousands separators · "3,159.67"
/* All three money formatters now go through God Mode, so the currency
   symbol, compact notation and cents settings reach every screen from one
   place instead of being decided at each call site. */
function fmt$(n) { return godMoney(n); }
/* Brands-section formatter · drops trailing .00 when amount is a whole
   number, keeps real cents otherwise. $1234.00 → "$1,234"  ·  $1234.56 → "$1,234.56" */
function fmt$Exact(n) { return godMoney(n); }
/* Deal sizes and per-video rates are always whole dollars in practice ·
   printing "$40.00" down a column is just noise. */
function fmt$Round(n) { return godMoney(n); }
/* Contact numbers get typed every which way — 3105608722, 310-560-8722,
   +13105608722, (310)5608722 — and the column reads like noise. Strip to
   digits and re-print US numbers in one shape.

   Anything that is NOT a 10-digit US number (or 11 digits starting with 1)
   is returned EXACTLY as it was entered. Guessing a US shape for an
   international number would silently corrupt a real phone number, which
   is far worse than an untidy column. */
function fmtPhone(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return s;
}
function initial(s) { return ((s || '').trim()[0] || '?').toUpperCase(); }
function gradFor(name) {
  if (!name) return AVATAR_GRADIENTS[0];
  return AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length];
}
function monthKey(dateStr) { return dateStr ? String(dateStr).slice(0, 7) : ''; }
function monthLabel(key) {
  if (!key) return 'All time';
  const [y, m] = key.split('-');
  return `${MONTHS[parseInt(m, 10) - 1] || '?'} ${y}`;
}
function monthShort(key) {
  if (!key) return 'All';
  const [y, m] = key.split('-');
  return `${MONTHS[parseInt(m, 10) - 1] || '?'} '${String(y).slice(2)}`;
}
/* ── Shop time ────────────────────────────────────────────────────────
   Every collab deadline, month boundary and "window closed" check is a
   TikTok Shop US fact, but the app runs from Pakistan (UTC+5) — about
   12 hours ahead of Pacific. Left on browser-local time the app rolls
   into a new month (and marks collabs late/over) roughly half a day
   before the shop actually does.

   shopNow() returns the current instant re-expressed in America/
   Los_Angeles, so date-only comparisons line up with EUKA's numbers. */
const SHOP_TZ = 'America/Los_Angeles';
function shopNow() {
  const now = new Date();
  try {
    // en-CA formats as YYYY-MM-DD, so this parses back cleanly
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: SHOP_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(now).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
    const hour = p.hour === '24' ? '00' : p.hour;
    const d = new Date(`${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}`);
    return isNaN(d) ? now : d;
  } catch { return now; }   // ancient browser → fall back to local
}
/* Shop-local calendar date as YYYY-MM-DD */
function shopToday() {
  const d = shopNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function currentMonthKey() {
  const d = shopNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function addMonth(key, delta) {
  let [y, m] = key.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
function parseDealAmount(deal) {
  if (!deal) return 0;
  const m = String(deal).match(/\$?(\d[\d,]*\.?\d*)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) || 0 : 0;
}
// Count actually-delivered videos (video_codes rows with a non-empty URL).
// Single source of truth · matches the popup's "filled count" UI so brand cards
// and the per-creator progress ring agree.
/* Who signed this creator · one initial, one colour, so a brand table can be
   scanned for ownership without opening a row. Names come from the hired_by
   column, which is free text — anyone not on the known list still gets a chip
   from their own initial rather than being dropped. */
const HIRED_BY_TAGS = {
  aris:   { i: 'A', fg: '#1259C3', bg: '#E7EFFB' },
  myles:  { i: 'M', fg: '#7A3BB5', bg: '#F1E9FB' },
  emily:  { i: 'E', fg: '#C2185B', bg: '#FCE7F0' },
  khushi: { i: 'K', fg: '#0E7A3A', bg: '#E4F5EB' },
};
/* WURX-ADDED · HOW MANY DEALS WE HAVE HAD WITH A PERSON, EVER.
   Rashid, 2026-09-16: "a small circular avatar showing no of deals with that
   creator". It sits on the corner of the creator's face (.pc-facewrap), not
   beside the tier tag: there it took 31px from every name, and at 1600px the
   brand page's names fell to one letter.

   IT FOLLOWS THE MONTH PICKER. Rashid, 2026-09-16: "month wise ... not overal".
   A month counts that month's deals across EVERY brand, so a person shows the
   same number on the brand page and the Creators tab; '' (All Time) counts
   their whole history. Keyed on the
   trimmed, lower-cased name, the same key the Creators tab's deals filter and
   tier count already use, so the three can never disagree about who is one
   person. */
function wxDealsByPerson(rows, month) {
  const m = new Map();
  (rows || []).forEach((c) => {
    if (month && monthKey(c && c.hiring_date) !== month) return;
    const k = String((c && c.name) || '').trim().toLowerCase();
    if (k) m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
}
const wxPersonKey = (c) => String((c && c.name) || '').trim().toLowerCase();
/* WURX-ADDED · which followers bucket somebody is in, for the Creators filter.
   `none` is a real answer, not an empty one: EUKA only reports a creator while
   they have been active in one of our shops lately, so 380 of 464 people on dev
   have no profile at all — a fact worth being able to filter FOR. */
/* WURX-ADDED · a handle as the follower store keys it: lower case, no @, no
   URL. Must match normHandle in supabase/functions/_shared/euka-followers.ts. */
function wxHandleKey(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return '';
  const last = t.startsWith('http') ? (t.replace(/\/+$/, '').split('/').pop() || '') : t;
  return last.replace(/^@+/, '').split(/[?#]/)[0].trim();
}
/* WURX-ADDED · a creator's followers: EUKA's live shop data first, then the
   count looked up by handle in its market intelligence, which reaches the
   creators the shop data does not (380 of 464 on dev had none). `source` is
   for the hover text, so a number never hides where it came from. */
function wxFollowersOf(euka, stored, handles) {
  const live = Number(eukaProfileFor(euka, handles)?.followers) || 0;
  if (live > 0) return { n: live, source: 'shop' };
  for (const h of handles || []) {
    const n = stored && stored.get ? stored.get(wxHandleKey(h)) : 0;
    if (n > 0) return { n, source: 'lookup' };
  }
  return { n: 0, source: null };
}
function wxFollowerBucket(n) {
  const v = Number(n) || 0;
  if (!v) return 'none';
  if (v >= 1e6) return '1m';
  if (v >= 1e5) return '100k';
  if (v >= 1e4) return '10k';
  return 'under10k';
}
const WX_FOLLOWER_BUCKETS = [
  { key: '1m',       label: '1M+' },
  { key: '100k',     label: '100K – 1M' },
  { key: '10k',      label: '10K – 100K' },
  { key: 'under10k', label: 'Under 10K' },
  { key: 'none',     label: 'No count yet' },
];
/* WURX-ADDED · ONE BRAND'S VIDEOS, EACH COUNTED ONCE.
   The brand page's Views and GMV cards and the Brands screen's New Video GMV
   card both read this, so the screen-wide total is by construction the brand
   cards added up. Rashid, 2026-09-21: "sum the new video gmv of all the brands
   ... be careful on calculations".

   The same TikTok video can sit under two deals of one creator (84 times in
   Penetrex's history), so it is keyed on TikTok's video id, or the link when
   there is no id, and kept once. Where two rows carry different synced figures
   for it, the larger wins: views and GMV only grow, so the larger is the newer
   sync. `gmv` is NOT rounded here; round once, where it is shown. */
function wxVideoTotals(list) {
  const vids = new Map();
  let dupes = 0;
  (list || []).forEach((c) => {
    const seen = new Set();
    (Array.isArray(c && c.video_codes) ? c.video_codes : []).forEach((r) => {
      const url = r && String(r.video || '').trim();
      if (!url) return;
      const id = wxVideoId(url);
      const k = id || url;
      if (seen.has(k)) return;
      seen.add(k);
      const cur = vids.get(k);
      if (cur) dupes++;
      vids.set(k, {
        id,
        views: Math.max(cur ? cur.views : 0, Number(r.views) || 0),
        gmv: Math.max(cur ? cur.gmv : 0, Number(r.revenue) || 0),
      });
    });
  });
  const all = [...vids.values()];
  return {
    all,
    dupes,
    views: all.reduce((t, v) => t + v.views, 0),
    gmv: all.reduce((t, v) => t + v.gmv, 0),
  };
}
/* WURX-ADDED · THE SAME VIDEOS, BROKEN DOWN BY PRODUCT.
   Rashid, 2026-09-24: "is it possible to get the product wise gmv, product wise
   creators and product wise videos ... it should show us product wise
   everything for the current month that user selected".

   It is, and from data we already hold: 1,042 of the 1,049 videos posted in
   September carry the product they sold, written by the same EUKA and Reacher
   syncs that fill the table. Nothing new is fetched to build this.

   IT DEDUPES EXACTLY AS `wxVideoTotals` DOES, and that is the whole point of
   writing it here beside it rather than inline in the screen. The same TikTok
   video sits under two deals of one creator 32 times in a single brand-month on
   dev; counting it twice here would make the products add up to more than the
   GMV card directly above them, and a breakdown that does not reconcile with
   the total it sits under is worse than no breakdown. Same key (the TikTok
   video id), same rule for disagreeing rows (keep the larger figure, since
   views and GMV only ever grow, so the larger is the newer sync).

   A VIDEO WITH NO PRODUCT IS SHOWN, NOT DROPPED. Seven of those 1,049 have
   none, and silently discarding them is how a breakdown quietly stops summing
   to its own total. They gather under one honest label instead. */
function wxProductTotals(list) {
  const vids = new Map();
  /* WHAT EACH CREATOR ROW PROMISED, read in the same pass.
     Rashid, 2026-10-07: "the videos part must also show the number of expected
     videos like shown product wise 5/10".

     THE COMMITMENT IS ON THE DEAL, NOT ON THE PRODUCT. A creator is hired for
     "10 videos at $40", and nothing in that sentence names a product — so there
     is no such thing as "expected videos for Product 02" in the data, only a
     rule for attributing a creator's promise to the products they posted for.

     THE RULE IS THE BAND'S OWN SCOPE, asked and settled on 2026-10-07: every
     creator who posted at least one video for a product carries their WHOLE
     commitment under it. That is the same scope as the `creators` figure beside
     it, which already counts a person under each product they touched — so the
     two agree, and a card can never show videos against a blank commitment.

     IT OVERLAPS, DELIBERATELY, exactly as the creator count does: a creator who
     posted for two products is counted under both, so these do NOT add up to
     the brand's own "N / M videos" KPI. The alternative — attributing a
     creator's promise only to their main product — makes the cards sum to that
     KPI and in exchange prints "12 / 0" on every side product, which is a
     worse lie than an overlap the figure beside it already has.

     KEYED ON THE ROW, NOT THE PERSON, which is how `brandRows` counts the same
     promise: one row of `creators` is one deal, so a creator hired twice has
     two commitments and both are real. `first wins` guards the one case where
     a row has no id and two deals collapse onto a name — the same collapsing
     the creator count below already does, rather than a second opinion. */
  const committed = new Map();
  (list || []).forEach((c) => {
    const who = (c && (c.id ?? c.name)) ?? '';
    if (who !== '' && !committed.has(who)) committed.set(who, parseDealVideos(c.deal) || 0);
    const seen = new Set();
    (Array.isArray(c && c.video_codes) ? c.video_codes : []).forEach((r) => {
      const url = r && String(r.video || '').trim();
      if (!url) return;
      const id = wxVideoId(url);
      const k = id || url;
      if (seen.has(k)) return;
      seen.add(k);
      const gmv = Number(r.revenue) || 0;
      const cur = vids.get(k);
      /* One video, one product. Where two rows disagree the richer row wins,
         which is the same "the larger is the newer sync" rule used above. */
      if (!cur || gmv > cur.gmv) {
        vids.set(k, {
          /* TikTok's own id, kept so the band can price these videos. A row
             without one is still counted as a video — it just cannot carry ad
             spend, because ad spend is only ever keyed on a real video id. */
          id: cur ? cur.id : id,
          gmv: Math.max(cur ? cur.gmv : 0, gmv),
          views: Math.max(cur ? cur.views : 0, Number(r.views) || 0),
          product: String(r.product || '').trim() || (cur ? cur.product : ''),
          who: cur ? cur.who : who,
        });
      } else if (cur && !cur.product && String(r.product || '').trim()) {
        cur.product = String(r.product || '').trim();
      }
    });
  });
  const byProduct = new Map();
  for (const v of vids.values()) {
    const name = v.product || '';
    const key = name.toLowerCase();
    let row = byProduct.get(key);
    if (!row) {
      row = { name, videos: 0, gmv: 0, views: 0, creators: new Set(), ids: [] };
      byProduct.set(key, row);
    }
    row.videos++;
    row.gmv += v.gmv;
    row.views += v.views;
    /* Already deduped: `vids` is keyed on this id, so one video is one entry. */
    if (v.id) row.ids.push(v.id);
    if (v.who !== '') row.creators.add(v.who);
  }
  return [...byProduct.values()]
    .map((r) => ({
      ...r,
      expected: [...r.creators].reduce((t, w) => t + (committed.get(w) || 0), 0),
      creators: r.creators.size,
    }))
    /* Biggest earner first; a product with no GMV yet still appears, ordered by
       how much work went into it. */
    .sort((a, b) => b.gmv - a.gmv || b.videos - a.videos);
}

/* WURX-ADDED · A VIDEO'S PICTURE, OR THE PLACEHOLDER — NEVER A BROKEN ICON.
   The strip used to render `<img src={v.thumb}>` the moment a thumbnail was
   stored, with no fallback, so a URL that stops answering shows the browser's
   torn-page glyph in the middle of the brand page. That mattered little while
   every thumbnail came from one store that has served them since 2025; it
   matters now that Irwin's are resolved per video and a picture can exist one
   week and not the next. The play symbol already means "no picture here", so a
   failed load says the same thing rather than something alarming. */
function WxVideoThumb({ src, className, phClassName }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  if (!src || broken) return <span className={phClassName} aria-hidden>▶</span>;
  return (
    <img className={className} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
  );
}
/* WURX-END */

/* WURX-ADDED · WHAT A PRODUCT LABEL ACTUALLY SAYS — and why it is not just CSS.
   Clipping these titles from the right produced four Penetrex pills all reading
   "Penetrex Daily Joint & Muscle Car…" beside four different GMV figures: a list
   of identical labels, which is worse than no label. On NUTRAHARMONY it is five
   bands all reading "NUTRA HARMONY Hydrating…".

   The distinguishing words can be at either end — Penetrex's differ at the tail
   (", 3 Oz. Gel", "Lotion, 8 oz Pump") while Irwin's differ at the head — so the
   label keeps BOTH ends and loses the middle. A first attempt trimmed the prefix
   every product shares, which looked neater and then did nothing at all, because
   one product is called "NEW! Penetrex…" and that makes the shared prefix empty.
   Middle truncation has no such dependency on the naming happening to be tidy.
   The full title is always in the tooltip.

   It lives out here because the band's cards and the table's group headers must
   shorten the same name the same way; two copies drifting apart would have one
   half of the screen calling a product something the other half does not. */
function wxShortProduct(name, max = 44) {
  const s = String(name || '');
  if (s.length <= max) return s;
  const head = s.slice(0, Math.ceil(max * 0.55)).trimEnd();
  const tail = s.slice(-Math.floor(max * 0.35)).trimStart();
  return `${head}…${tail}`;
}
/* WURX-END */

/* WURX-ADDED · WHICH PRODUCT A CREATOR SITS UNDER, AND WHY ONLY ONE.
   Rashid, 2026-09-29, with a mockup: "we are showing creators of the brand when
   we open a particular brand ... we also have products and we can see. Now what
   i want is to organize and show product wise creators".

   ONE CREATOR, ONE ROW. A creator's row carries PER-CREATOR money — the deal,
   total views, new-video GMV, L30 GMV, ad spend, ROI — so listing the same
   person again under a second product would show the same money twice on one
   screen. That is not hypothetical: on dev, 10 of Penetrex's 34 September
   creators posted for more than one product, and a row-per-product table comes
   to 53 rows for 34 people, with every figure of those ten counted twice. So a
   creator is placed under the product MOST of their videos are for, and the
   header says how many of its creators also posted elsewhere rather than
   quietly hiding it.

   THE BAND ABOVE ANSWERS A DIFFERENT QUESTION, and its counts will differ on
   purpose. It counts every creator who touched a product, so its figures
   overlap and add up to MORE than the brand has creators (NUTRAHARMONY: 19 + 18
   + 1 + 1 = 39 for 38 people). These groups PARTITION the same people, so they
   add up to exactly the "N creators" pill they sit under. Two scopes, each
   reconciling with the total next to it, which is the only way two breakdowns
   of one list can both be true.

   A CREATOR WITH NO VIDEOS YET STILL BELONGS SOMEWHERE. Ten of Irwin Naturals'
   27 September creators have none. Those fall back to the product they were
   onboarded with — which is exactly what that field being compulsory from
   October is for. The legacy free-text `product` column is used only when it
   matches a product this brand actually sells: it holds an email address on at
   least one live row, and a group header is no place to discover that. */
function wxCreatorProduct(c, known) {
  const tally = new Map();
  const seen = new Set();
  (Array.isArray(c && c.video_codes) ? c.video_codes : []).forEach((r) => {
    const url = r && String(r.video || '').trim();
    if (!url) return;
    /* Deduped on TikTok's video id, the same key `wxVideoTotals` and
       `wxProductTotals` use. One video filed under two deals of one creator is
       a single video here too, or "most" would be decided by how many times a
       row happens to have been duplicated. */
    const k = wxVideoId(url) || url;
    if (seen.has(k)) return;
    seen.add(k);
    const name = String(r.product || '').trim();
    if (!name) return;
    const lk = name.toLowerCase();
    const cur = tally.get(lk) || { name, videos: 0, gmv: 0 };
    cur.videos += 1;
    cur.gmv += Number(r.revenue) || 0;
    tally.set(lk, cur);
  });
  if (tally.size) {
    const best = [...tally.values()].sort((a, b) =>
      b.videos - a.videos || b.gmv - a.gmv || a.name.localeCompare(b.name))[0];
    return { key: best.name.toLowerCase(), name: best.name, alsoOn: tally.size - 1 };
  }
  const assigned = (Array.isArray(c && c.products) ? c.products : [])
    .map((x) => String((x && x.name) || '').trim()).filter(Boolean);
  if (assigned.length) return { key: assigned[0].toLowerCase(), name: assigned[0], alsoOn: 0 };
  const legacy = String((c && c.product) || '').trim();
  const hit = legacy && known ? known.get(legacy.toLowerCase()) : '';
  if (hit) return { key: legacy.toLowerCase(), name: hit, alsoOn: 0 };
  return { key: '', name: '', alsoOn: 0 };
}

/* Every product name this brand is actually known to use, lowercased -> as
   written. Built from the videos AND from what creators were onboarded with, so
   a brand whose sync has not run yet is not treated as having no catalogue. */
function wxKnownProducts(list) {
  const known = new Map();
  const add = (n) => {
    const t = String(n || '').trim();
    if (t && !known.has(t.toLowerCase())) known.set(t.toLowerCase(), t);
  };
  (list || []).forEach((c) => {
    (Array.isArray(c && c.video_codes) ? c.video_codes : []).forEach((r) => add(r && r.product));
    (Array.isArray(c && c.products) ? c.products : []).forEach((x) => add(x && x.name));
  });
  return known;
}

/* THE ORDER THE GROUPS APPEAR IN IS THE BAND'S ORDER, not a second opinion.
   `wxProductTotals` already ranks by GMV then videos and the strip above the
   table draws itself from it; ranking these independently would leave the two
   halves of one screen disagreeing about which product is doing best. A product
   that exists only as an onboarding choice has no GMV to rank by and follows,
   alphabetically; "no product" is always last. */
function wxProductOrder(list) {
  const rank = new Map();
  wxProductTotals(list).forEach((r, i) => {
    const k = String(r.name || '').trim().toLowerCase();
    if (k) rank.set(k, i);
  });
  return rank;
}

function wxSplitByProduct(rows, placed, rank) {
  const bands = new Map();
  (rows || []).forEach((c) => {
    const pl = placed.get(c.id) || { key: '', name: '' };
    let b = bands.get(pl.key);
    if (!b) { b = { key: pl.key, name: pl.name, items: [] }; bands.set(pl.key, b); }
    b.items.push(c);
  });
  const LAST = Number.MAX_SAFE_INTEGER;
  return [...bands.values()].sort((a, b) => {
    if (!a.key !== !b.key) return a.key ? -1 : 1;
    const ra = rank.has(a.key) ? rank.get(a.key) : LAST;
    const rb = rank.has(b.key) ? rank.get(b.key) : LAST;
    return ra - rb || a.name.localeCompare(b.name);
  });
}

/* ONE CATALOGUE FETCH PER BRAND, SHARED. The band and the table groups want the
   same pictures and `collabProducts` is an Edge Function round trip; asking
   twice on every brand open would double that for nothing. A FAILURE IS NOT
   CACHED — it is dropped from the map so the next mount asks again, because "we
   could not reach the catalogue once" must never harden into "this brand has no
   pictures" for the rest of the session. */
const WX_PRODUCT_PICS = new Map();
function wxProductPics(brand) {
  const key = String(brand || '').trim();
  if (!key) return Promise.resolve(new Map());
  if (!WX_PRODUCT_PICS.has(key)) {
    const job = (async () => {
      const res = await collabProducts(key);
      if (!res) throw new Error('catalogue unavailable');
      const map = new Map();
      for (const pr of res.products || []) {
        const k = String((pr && pr.name) || '').trim().toLowerCase();
        if (k && pr.image) map.set(k, pr.image);
      }
      return map;
    })();
    job.catch(() => WX_PRODUCT_PICS.delete(key));
    WX_PRODUCT_PICS.set(key, job);
  }
  return WX_PRODUCT_PICS.get(key).catch(() => new Map());
}
function wxUseProductPics(brand) {
  const [pics, setPics] = useState(null);
  useEffect(() => {
    let alive = true;
    setPics(null);
    if (!brand) return undefined;
    wxProductPics(brand).then((m) => { if (alive) setPics(m); });
    return () => { alive = false; };
  }, [brand]);
  return pics;
}

/* The group header's own menu. Two actions, both real: a brand with seven
   products makes a long page, and collapsing the lot is the only way to see its
   shape. A plain absolutely-positioned panel rather than a portal — a portal is
   how other menus on this screen have twice ended up rendering off-screen. */
function WxGroupMenu({ onExpandAll, onCollapseAll }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <span className="wx-pgroup-menu" ref={wrap}>
      <button type="button" className="wx-pgroup-kebab" aria-label="Product group options"
        aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>
      {open && (
        <span className="wx-pgroup-pop" role="menu">
          <button type="button" role="menuitem" onClick={() => { onExpandAll(); setOpen(false); }}>Expand all products</button>
          <button type="button" role="menuitem" onClick={() => { onCollapseAll(); setOpen(false); }}>Collapse all products</button>
        </span>
      )}
    </span>
  );
}
/* WURX-END */

/* WURX-ADDED · THE BY-PRODUCT BAND on a brand's page.

   One pill per product: its picture, its name, and the three figures Rashid
   asked for — GMV, creators, videos — for whatever month is on screen.

   THE PICTURES ARRIVE LATE AND THAT IS DELIBERATE. The videos carry a product
   NAME and no product id, so the only way to a photograph is to match that name
   against the brand's own catalogue, which is a round trip. The band renders
   immediately with letter tiles and upgrades in place when the catalogue lands;
   making the figures wait on a picture would be the wrong way round.

   THE MATCH IS EXACT AND WITHIN ONE BRAND. Same shop, same platform, same
   string — anything looser would put one product's photograph on another's
   numbers, and a wrong picture beside a real GMV figure is worse than no
   picture at all.

   The pill sits on `--pc-card`, which is `--wx-surface-1`: the surface
   check:contrast section 5 already proves the green GMV ink against. Putting it
   on the tinted `--pc-card-2` would have been a new, unproven ground for an ink
   calibrated elsewhere, which is a bug this project has shipped before. */
function ProductBand({ creators, brand, period }) {
  const rows = useMemo(() => wxProductTotals(creators), [creators]);
  /* The pictures come from the shared per-brand cache, because the groups in
     the table below want exactly the same map and this used to be a second
     Edge Function round trip for it. */
  const pics = wxUseProductPics(brand);

  /* AD SPEND PER PRODUCT, from the figures the rest of this screen already
     reads. Rashid, 2026-10-07: "i want the cards to show the summed up ad spend
     as well in each card".

     NOTHING NEW IS FETCHED. The creator rows below ask for exactly these video
     ids, and the provider caches by "month|id" — so asking here costs one
     shared request rather than a second pass over the same videos.

     IT OBEYS THE MONTH SELECTOR like every other figure on the card, because
     `BrandDrilldown` tells the provider which month is on screen. A lifetime ad
     spend sitting beside a September GMV would be two periods in one card.

     SUMMED OVER THE PRODUCT'S OWN VIDEOS, which is the same scope as the GMV
     and views above it — so a card's ad spend, GMV and views all describe the
     same set of videos, and the cards add up to the brand's ad spend the way
     their GMV adds up to the GMV card. */
  const wxAds = wxAdsHook();
  const adIds = useMemo(() => rows.flatMap((r) => r.ids), [rows]);
  wxAds.ensure(adIds);

  if (!rows.length) return null;
  const total = rows.reduce((t, r) => t + r.gmv, 0);

  const shortLabel = wxShortProduct;

  /* ONE FIGURE IN THE STRIP: what it is above, the number below.
     Rashid, 2026-09-24, with a second mockup: "the current card is taking too
     much space ... it can't take too much space but still show counts
     properly". The tall card stacked its four figures vertically, which made
     every card about 300px high; laid across the bottom of a wide card they
     take about half that, and the row still scrolls so the band stays ONE row
     however many products a brand has. */
  const Cell = ({ icon, label, value, ink }) => (
    <div className="wx-prodcard-cell">
      <span className="wx-prodcard-cell-top">
        <span className="wx-prodcard-ico" aria-hidden="true">{icon}</span>
        <span className="wx-prodcard-lbl">{label}</span>
      </span>
      <span className="wx-prodcard-val" style={ink ? { color: ink } : undefined}>{value}</span>
    </div>
  );

  return (
    <div className="wx-prodband" data-wx="product-band" style={{ marginTop: 14 }}>
      <div className="wx-prodband-head">
        <h3 className="wx-prodband-title">Product performance</h3>
        <span className="wx-prodband-chip">{rows.length} product{rows.length === 1 ? '' : 's'}</span>
        {/* THE PERIOD, NOT A SECOND MONTH PICKER. Rashid's mockup drew a month
            dropdown here, and the screen already has one in its top bar that
            every other figure on the page obeys. A second control would be a
            second source of truth for the same question, and the day the two
            disagree the band and the KPI cards above it would be describing
            different months while looking equally authoritative. */}
        <span className="wx-prodband-period">{period}</span>
      </div>
      {/* The row scrolls inside itself. A long catalogue must never make the
          page scroll sideways — that rule is in CLAUDE.md and it is the thing
          that makes this safe to add to a screen that is already full. */}
      <div className="wx-prodband-row" data-wx="product-band-row">
        {rows.map((r, i) => {
          const has = !!r.name;
          const label = has ? r.name : 'No product recorded';
          const short = has ? shortLabel(r.name) : label;
          const img = has && pics ? (pics.get(r.name.toLowerCase()) || '') : '';
          const share = total > 0 ? Math.round((r.gmv / total) * 100) : 0;
          const ads = wxTotals(wxAds.get, r.ids);
          /* A DASH IS NOT A ZERO, the same rule the creator rows state: no ad
             data means we cannot answer, which is a different claim from
             "nothing was spent" — and a wrong zero about money gets acted on. */
          const adText = ads.withData && !ads.mixedCurrency
            ? wxMoney(ads.cost, ads.currency)
            : '–';
          return (
            <article key={(r.name || 'none') + i} className="wx-prodcard" data-wx="product-pill"
              /* Machine-readable, so the guard compares NUMBERS with the card
                 above rather than parsing "$1,234" back out of the text. */
              data-gmv={Math.round(r.gmv)} data-creators={r.creators} data-videos={r.videos}
              data-expected={r.expected} data-adspend={ads.withData ? Math.round(ads.cost) : ''}
              title={`${label} · ${fmt$Exact(Math.round(r.gmv))} GMV · ${Number(r.views) > 0 ? `${kNum(r.views)} views · ` : ''}${r.creators} creator${r.creators === 1 ? '' : 's'} · ${r.videos}${r.expected > 0 ? ` of ${r.expected}` : ''} video${r.videos === 1 ? '' : 's'} delivered${ads.withData ? ` · ${adText} ad spend across ${ads.withData} of ${ads.asked} video${ads.asked === 1 ? '' : 's'}` : ''}${total > 0 ? ` · ${share}% of this month's GMV` : ''}`}>
              <div className="wx-prodcard-head">
                <span className="wx-prodcard-shot">
                  <ProductTile product={{ name: label, image: img }} size={52} />
                </span>
                <span className="wx-prodcard-id">
                  <span className="wx-prodcard-name" style={!has ? { color: 'var(--pc-text-3)', fontStyle: 'italic' } : undefined}>{short}</span>
                  {/* The rank, said quietly. It was a 2.5rem ghost numeral and
                      that was a lot of height for a fact worth one line. */}
                  <span className="wx-prodcard-rank">Product {String(i + 1).padStart(2, '0')}</span>
                </span>
              </div>
              <div className="wx-prodcard-rows">
                <Cell label="GMV" ink="var(--wx-success)" value={fmt$Exact(Math.round(r.gmv))}
                  icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="20" x2="6" y2="13" /><line x1="12" y1="20" x2="12" y2="8" /><line x1="18" y1="20" x2="18" y2="4" /></svg>} />
                <Cell label="Views" value={Number(r.views) > 0 ? kNum(r.views) : '–'}
                  icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>} />
                <Cell label="Creators" value={r.creators}
                  icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>} />
                {/* DELIVERED OVER PROMISED, drawn the way the creator rows draw
                    it: the count full size, the commitment quieter behind a
                    slash. The commitment is dropped rather than printed as
                    "/0" when this product's creators have no video deal at
                    all — a denominator of nothing is not a target. */}
                <Cell label="Videos"
                  value={r.expected > 0
                    ? <>{r.videos}<span className="wx-prodcard-of">/{r.expected}</span></>
                    : r.videos}
                  icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>} />
                <Cell label="Ad spend" ink={ads.withData ? 'var(--wx-danger)' : undefined} value={adText}
                  icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-8-8 18-2-7-8-3z" /></svg>} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* WURX-ADDED · A PRODUCT'S PICTURE, or an honest stand-in for it.
   Rashid, 2026-09-23: "also use product images as well and show selected images
   properly".

   NOT EVERY PRODUCT HAS ONE, and that is the APIs rather than us: Euka's
   product list carries titles and figures and no image at all (its one endpoint
   with `imageUrl` indexes TikTok at large, and answered our own brand id with
   another company's products), and Reacher carries `primary_image_url` only
   where that shop's catalogue is populated — Irwin's is not. So a product
   without a picture gets a letter on a tinted tile, which reads as "no picture"
   rather than as the wrong product. A broken URL falls back to the same tile. */
function ProductTile({ product, size = 32, bare = false }) {
  const [broken, setBroken] = useState(false);
  const src = !broken ? (product?.image || '') : '';
  const label = String(product?.name || product?.url || '?').trim();
  const initial = (label.match(/[a-z0-9]/i) || ['?'])[0].toUpperCase();
  const box = {
    width: size, height: size, flexShrink: 0, borderRadius: bare ? 10 : 8,
    /* `bare` is for the product cards, where the photograph is the hero and a
       frame around it reads as chrome. The letter stand-in keeps its tile in
       both modes, because a bare letter floating on the card would look like a
       mistake rather than a deliberate "no picture". */
    border: bare ? 0 : '1px solid var(--pc-divider)',
    background: bare ? 'transparent' : 'var(--pc-card-2)',
    display: 'grid', placeItems: 'center', overflow: 'hidden',
  };
  if (src) {
    return (
      <span style={box}>
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: bare ? 'contain' : 'cover', display: 'block' }} />
      </span>
    );
  }
  return (
    <span style={{ ...box, background: 'var(--pc-warn-bg)', color: 'var(--pc-warn-fg)', fontSize: size * 0.4, fontWeight: 800 }}
      title="No picture for this product">
      {initial}
    </span>
  );
}

function DealsBadge({ n, month }) {
  if (!n) return null;
  const deals = `${n} deal${n === 1 ? '' : 's'} with this creator`;
  return (
    <span className="pc-dealsbadge" title={month ? `${deals} in ${monthLabel(month)}, across every brand` : `${deals}, all time`}>
      {n}
    </span>
  );
}
/* WURX-END */

function HiredByTag({ who }) {
  const name = String(who || '').trim();
  if (!name) return null;
  const t = HIRED_BY_TAGS[name.toLowerCase()]
    || { i: name[0].toUpperCase(), fg: '#6B5B45', bg: '#F0EBE1' };
  return (
    <span
      className="pc-hbtag"
      title={`Hired by ${name}`}
      style={{ color: t.fg, background: t.bg }}
    >{t.i}</span>
  );
}

function deliveredVideoCount(c) {
  if (!Array.isArray(c?.video_codes)) return 0;
  /* DISTINCT videos. The same link can end up stored twice (a bulk paste
     that overlaps an existing row — the editor flags it in red but still
     keeps what was typed), and counting it twice would credit delivery
     that never happened, flip the collab to Done early, and inflate the
     leaderboard. Match on the numeric TikTok id when there is one. */
  const seen = new Set();
  c.video_codes.forEach(v => {
    const u = String(v?.video || '').trim();
    if (!u) return;
    const m = u.match(/video\/(\d+)/);
    seen.add(m ? m[1] : u.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, ''));
  });
  return seen.size;
}

// Dedup key for a creator · collapses the many ways one person can appear
// twice in the DB: casing, leading/trailing/internal whitespace, non-breaking
// spaces, accent marks, full-width chars, @ prefix on a handle. Used by
// PerformanceTab (brand creator count) and BrandMatrix (matrix rows) so the
// "uniqueness" rule is identical everywhere.
function _normCreatorString(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')     // strip combining accents
    .replace(/[   ]/g, ' ') // nbsp variants -> space
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')                   // strip leading @
    .replace(/\s+/g, ' ');                // collapse internal whitespace
}
function _extractTikTokHandle(raw) {
  // Pull the bare lowercase username out of any tiktok_account format users
  // paste in · @handle, handle, tiktok.com/@handle, https URL, trailing slash.
  let t = String(raw || '').trim().replace(/\/+$/, '');
  if (!t) return '';
  if (/^https?:\/\//i.test(t) || /tiktok\.com/i.test(t)) {
    t = t.split('/').filter(Boolean).pop() || '';
  }
  return _normCreatorString(t);
}
function creatorDedupKey(c) {
  // TikTok handle first · it's the most reliable identifier (the user enters
  // it as a unique link). Two records with the same handle but slightly
  // different display names (typo, extra word, URL vs @handle form) still
  // merge into one row. Name + id are fallbacks for handle-less rows.
  return _extractTikTokHandle(c?.tiktok_account)
      || _normCreatorString(c?.name)
      || _normCreatorString(c?.id);
}

// 3-state status used by Brands drilldown + Creators tab grouping. Mirrors the
// derivation inside WurxStatusDropdown so dropdown colors and section pills agree.
const STATUS_ORDER = [
  { key: 'pending',  label: 'Payment Pending'    },
  { key: 'progress', label: 'Videos in Progress' },
  { key: 'sent',     label: 'Payment Sent'       },
];
function statusOf(c) {
  if (c?.payment_status === 'Paid') return 'sent';
  if (c?.videos === 'Done')         return 'pending';
  return 'progress';
}
function groupByStatus(rows) {
  const buckets = { pending: [], progress: [], sent: [] };
  rows.forEach(c => { buckets[statusOf(c)].push(c); });
  return STATUS_ORDER
    .map(s => ({ ...s, items: buckets[s.key] }))
    .filter(g => g.items.length > 0);
}

// ── Audit log helper ──────────────────────────────────────────
// Fire-and-forget insert into public.audit_logs. Silently swallows errors
// (audit table optional · don't break the user's primary action).
let _auditActor = { actor: '', actor_id: '' };
/* WURX-ADDED · the whole person, not just their name, so capability questions
   can be asked as well as identity ones. */
let _actorUser = null;
export function setAuditActor(user) {
  _actorUser = user || null;
  _auditActor = {
    actor:    user?.display  || user?.username || '',
    actor_id: user?.username || user?.id       || '',
  };
}
/* Deleting a creator is still Asad-only · UI components consult this */
export function isAsadActor() {
  const a = String(_auditActor.actor_id || _auditActor.actor || '').trim().toLowerCase();
  return a === 'asad';
}

/* WURX-ADDED · WHO MAY MARK A CREATOR PAID.
 *
 * This was `isAsadActor()`: a string comparison against the literal username
 * "asad". Their comment called it a hard rule with no exceptions, and it did
 * work — but it is tied to one person's account name, so the day he is away or
 * changes account nobody can mark anything paid and there is no setting to fix
 * it, only a code change. Rashid, asked directly on 2026-08-31, chose to open
 * it to anyone with edit rights.
 *
 * `canEditPay` is their OWN capability for exactly this — "Change payment
 * status · Mark a creator paid or unpaid" — already granted to superadmin, ipc
 * and admin, and withheld from apc and viewer. So this is not a new rule
 * invented here; it is the rule their access model already described, finally
 * being the one that is enforced. It also means Asad can keep tuning it per
 * person from Access Control, which the hardcoded name never allowed.
 *
 * Still a UI gate, not a boundary: it decides what is offered, and the database
 * is what actually protects the column. */
export function canMarkPaid() {
  return can(_actorUser, 'canEditPay');
}

/* Whether the actor may move a creator between the three status states at all.
 * Their own capability for it is `canEdit` — "Edit creators" — held by
 * superadmin, ipc and admin, and withheld from apc, viewer and client.
 *
 * Rashid asked on 2026-09-02 whether the three read-only roles could change a
 * status, having sensibly refused to click it on live rows to find out. They
 * could not: the App-level handler refuses `viewer` outright and the database
 * refuses the write regardless. But the menu still OPENED for them, which on a
 * money screen reads as permission the moment before it reads as a scolding
 * toast. A viewer now gets the same pill with no caret and nothing to press. */
export function canEditStatus() {
  return can(_actorUser, 'canEdit');
}

/* Whether the actor may take Paid Collabs data OUT — CSV download or the
 * clipboard. Their own capability is `canExportCsv`.
 *
 * THE FLOOR EXISTED AND THIS SCREEN NEVER ASKED. `forcedPermsFor()` withholds
 * canExportCsv from the three read-only roles, and App.jsx honours it — but
 * App.jsx is the old screen. WurxUI is the one people actually see, and every
 * export path in it was ungated: brand budgets, the full deal table, the
 * outreach list with emails, discovery, the leaderboard, and two clipboard
 * copies. A viewer could have taken all of it.
 *
 * Unlike a status change, an export is NOT caught by the database. The rows
 * are already legitimately on their screen; the download happens entirely in
 * the browser. For exports the UI gate is the only gate there is, which is
 * exactly why it has to be right. */
export function canExport() {
  return can(_actorUser, 'canExportCsv');
}

/* Row selection exists only to feed the bulk bar — bulk edits or an export.
 * An actor who can do neither gets no checkboxes rather than a selection that
 * leads nowhere. */
export function canSelectRows() {
  return canEditStatus() || canExport();
}
export async function logAudit({ action, target_type, target_id, target_label, changes }) {
  try {
    await supabase.from('audit_logs').insert([{
      ...(_auditActor),
      action,
      target_type: target_type || null,
      target_id:   target_id   ? String(target_id) : null,
      target_label: target_label || null,
      changes:     changes || {},
    }]);
  } catch (e) { /* never block UI */ }
}

function parseDealVideos(deal) {
  if (!deal) return 0;
  const s = String(deal);
  // 1) "5 videos" / "5 vid" / "5 clips" / "5 posts"
  const m1 = s.match(/(\d+)\s*(?:videos?|vids?|clips?|posts?)\b/i);
  if (m1) return parseInt(m1[1], 10);
  // 2) "$200 / 5" or "$200 - 5" or "$200 x 5" or "$200 for 5"
  const m2 = s.match(/\$\s*\d[\d,]*(?:\.\d+)?\s*(?:[/\-x×*]|for)\s*(\d+)\b/i);
  if (m2) return parseInt(m2[1], 10);
  // 3) bare "5v" / "5V"
  const m3 = s.match(/\b(\d+)\s*[vV]\b/);
  if (m3) return parseInt(m3[1], 10);
  return 0;
}
function tiktokHandle(raw) {
  if (!raw) return '';
  const t = String(raw).trim().replace(/\/$/, '');
  if (t.startsWith('http')) { const last = t.split('/').pop() || ''; return last.startsWith('@') ? last : `@${last}`; }
  return t.startsWith('@') ? t : `@${t}`;
}
function tiktokUrl(raw) {
  if (!raw) return '#';
  const t = String(raw).trim();
  if (t.startsWith('http')) return t;
  return `https://www.tiktok.com/${tiktokHandle(t)}`;
}
function formatHireDate(d) {
  if (!d) return '-';
  const [y, m, day] = d.split('-');
  if (!y) return d;
  return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(day, 10)}, ${y}`;
}

/* ════════ MAIN SHELL ════════ */
/*
 * THEIR TOP BAR, MOVED INTO OURS.
 *
 * Rashid, 2026-08-28: *"the header as u see should be at top replace our simple
 * header... no need to have logo because we already have in left side, the
 * notification and clock should obviulsy exist... i want to give it native look
 * of our own app now"*.
 *
 * Rather than cut their header apart and rebuild half of it in our shell, the
 * whole element is PORTALED into a slot our top bar renders, and CSS strips it
 * down to the three things he asked to keep: the WURX CREATORS DATABASE
 * wordmark, the bell and the clock. The logo, the app name, the user chip and
 * the sign-out button all go, because our own shell already carries every one
 * of them a few pixels to the left.
 *
 * WHY A PORTAL AND NOT A PROP. The bell opens their notification panel and the
 * clock opens their activity log; both are state deep inside this component and
 * inside a lazily-loaded chunk. Passing callbacks up through our route to our
 * shell would mean our shell holding a handle on their internals. A portal
 * moves the DOM and leaves the ownership exactly where it was.
 *
 * IF THE SLOT IS NOT THERE the header renders where it always did, which is
 * what happens for anyone running this file outside our shell. It degrades to
 * the app it used to be rather than to nothing.
 */
function ChromeSlot({ embedded, children }) {
  const [slot, setSlot] = useState(() =>
    typeof document === 'undefined' ? null : document.getElementById('wurxbase-topbar-slot'));

  useEffect(() => {
    if (!embedded || slot) return undefined;
    /* Our shell renders the slot above this in the tree, so it is normally
       there on the first pass. One retry on the next frame covers the case
       where this chunk finishes loading first. */
    let raf = requestAnimationFrame(() => setSlot(document.getElementById('wurxbase-topbar-slot')));
    return () => cancelAnimationFrame(raf);
  }, [embedded, slot]);

  if (!embedded) return children;
  if (!slot) return null;
  return createPortal(children, slot);
}

export default function WurxUI({
  /*
   * EMBEDDED CHROME, added 2026-08-28.
   *
   * Rashid: *"pull them out and create new menus item on main menu as Paid
   * Collabs and put all these tabs there as menu item section... we need to
   * remove those tabs from top also the header... i want to give it native
   * look of our own app now"*.
   *
   * So when `embedded` is on, this component stops drawing its own top bar
   * and its own tab rail. The tab arrives as a prop from the route and changes
   * by calling back, and the two chrome buttons worth keeping — notifications
   * and the activity log — are portaled into OUR top bar instead.
   *
   * It stays optional. Uncontrolled and unembedded, this file still renders
   * the standalone app it was written as, which is what makes the change safe
   * to reason about: nothing was deleted, one branch was added.
   */
  tab: tabProp,
  onTabChange,
  embedded = false,
  creators,
  currentUser,
  perms,
  isSuper,
  onSelectCreator,
  reportingNode,
  // chrome props from App.js
  search = '',
  onSearchChange,
  onSaveCreator,        // (data) => Promise · Afflix-style add/edit save (replaces old BottomSheetV2)
  onDeleteCreator,      // (id) => Promise · Asad-only hard delete from the edit modal
  onDeleteBrand,
  onSetCreatorStatus,
  onUpdateCreator,
  onOpenSettings,
  /* WURX-ADDED · see the settings button below */
  canOpenSettings = false,
  onOpenLogs,
  onSignOut,
  notificationsCount = 0,
  onOpenNotifications,
  pendingApprovalsCount = 0,
  onOpenPendingApprovals,
}) {
  // Restore last UI state on mount so refresh keeps the user where they were
  const __initialState = useMemo(() => loadUIState(), []);
  /* Whatever tab you were last on wins on a refresh · the God Mode
     "opening tab" is the fallback for a fresh session, which is what
     that setting actually means. */
  const [ownTab, setOwnTab] = useState(() => __initialState.tab || godGet().home || 'brands');
  /* Controlled when the route drives it, uncontrolled otherwise. Everything
     below calls setTab and does not care which of the two it is. */
  const controlled = typeof tabProp === 'string' && !!onTabChange;
  const tab = controlled ? tabProp : ownTab;
  const setTab = useCallback(
    (next) => {
      const value = typeof next === 'function' ? next(tab) : next;
      if (controlled) onTabChange(value);
      else setOwnTab(value);
    },
    [controlled, onTabChange, tab],
  );

  /* ── EUKA L30 GMV · per-store fetch with progressive merge ──
     One store's export takes ~7 s, so we pull stores one URL each
     (3 in flight) and merge into state as each lands — the L30 columns
     fill in store-by-store instead of waiting for everything. Final
     merged map is cached in localStorage for 30 min. */
  const [eukaL30, setEukaL30] = useState(null);
  useEffect(() => {
    const CK = 'wurx_euka_l30_v10';   // v9 · tier/avgViews survive the merge
    try {
      const c = JSON.parse(localStorage.getItem(CK));
      if (c && c.handles && Date.now() - c.fetchedAt < 30 * 60 * 1000) { setEukaL30(c); return; }
    } catch { /* corrupt cache → refetch */ }

    /* Cold sweep is ~7s per store. Tier / L30 GMV already arrive on the row
       from the DB, so nothing on screen is waiting for this — defer it past
       first paint so the tables never feel like they're loading. */
    let started = false;
    const startId = window.requestIdleCallback
      ? window.requestIdleCallback(() => { started = true; go(); }, { timeout: 6000 })
      : setTimeout(() => { started = true; go(); }, 2000);

    let cancelled = false;
    function go() { (async () => {
      try {
        const meta = await eukaJson();
        if (!meta || !Array.isArray(meta.stores) || cancelled) return;
        const merged = {};
        const profiles = {};
        const shopByStore = {};   // normalized store name → { handle: shopL30Gmv }
        let okStores = 0;
        /* stores that fail get ONE retry at the end of the queue — a cold
           function or CDN hiccup shouldn't leave creators without GMV */
        const queue = meta.stores.map(s => ({ ...s, tries: 0 }));
        await Promise.all(Array.from({ length: 6 }, async () => {
          while (queue.length && !cancelled) {
            const s = queue.shift();
            let ok = false;
            try {
              const d = await eukaJson({ store: s.id });
              if (d && d.handles && !cancelled) {
                ok = true;
                okStores += 1;
                Object.entries(d.handles).forEach(([h, g]) => {
                  const v = Number(g) || 0;
                  if (merged[h] == null || v > merged[h]) merged[h] = v;
                });
                Object.entries(d.profiles || {}).forEach(([h, p]) => {
                  const cur = profiles[h] || {};
                  profiles[h] = {
                    email: cur.email || p.email || '',
                    phone: cur.phone || p.phone || '',
                    followers: cur.followers || p.followers || 0,
                    postRate: cur.postRate != null ? cur.postRate : (p.postRate != null ? p.postRate : null),
                    tier: cur.tier || p.tier || '',
                    avgViews: cur.avgViews || p.avgViews || 0,
                  };
                });
                if (d.shop) shopByStore[_normEukaBrand(s.name)] = d.shop;
                setEukaL30({ fetchedAt: Date.now(), handles: { ...merged }, profiles: { ...profiles }, shopByStore: { ...shopByStore }, stores: meta.stores });
              }
            } catch { /* fall through to retry */ }
            if (!ok && s.tries < 1) queue.push({ ...s, tries: s.tries + 1 });
          }
        }));
        if (cancelled) return;
        const complete = okStores >= meta.stores.length;
        const payload = { fetchedAt: Date.now(), handles: merged, profiles, shopByStore, stores: meta.stores, complete };
        setEukaL30(payload);
        /* Only cache COMPLETE sweeps — a partial sweep cached for 30 min is
           exactly the "GMV missing" symptom; partial data stays session-only
           so the next load retries automatically. */
        if (complete && Object.keys(merged).length) {
          try { localStorage.setItem(CK, JSON.stringify(payload)); } catch { /* full */ }
        }
      } catch { /* offline → columns stay '…' */ }
    })(); }
    return () => {
      cancelled = true;
      if (!started) {
        if (window.cancelIdleCallback) window.cancelIdleCallback(startId);
        else clearTimeout(startId);
      }
    };
  }, []);

  /* ── EUKA → DB AUTO VIDEO SYNC ─────────────────────────────────────
     Runs in the background for EVERY brand that has an EUKA store —
     except Flywell and Vidge Pets (excluded per ops decision). Each
     store syncs at most once per 6 h (timestamp in localStorage), and
     merged videos persist in Supabase, so states stick without anyone
     pressing the manual button. Completing the committed video count
     flips the creator to Payment Pending automatically. */
  const vidAutoRef = useRef(false);
  useEffect(() => {
    if (vidAutoRef.current) return;
    if (!(isSuper || perms?.canEdit)) return;
    if (!creators?.length || !onUpdateCreator) return;
    vidAutoRef.current = true;

    const EXCLUDE = EUKA_SYNC_EXCLUDE;
    const SYNC_KEY = 'wurx_euka_vidsync_v11';  // v10 · brand-scoped again · tier/GMV now come from the DB
    const INTERVAL = 6 * 60 * 60 * 1000;

    /* Wait for the app to settle before touching the network. This sweep is
       pure background maintenance — it must never compete with first paint
       or make the tables feel laggy. */
    const idle = (fn) => (window.requestIdleCallback
      ? window.requestIdleCallback(fn, { timeout: 8000 })
      : setTimeout(fn, 2500));

    idle(() => (async () => {
      try {
        const meta = await eukaJson();
        if (!meta || !Array.isArray(meta.stores)) return;
        let last = {};
        try { last = JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch { /* fresh */ }

        /* Only sweep stores that actually own creators here. Tier / L30 GMV
           are store-independent and now arrive pre-resolved on the row
           (creators.monthly.euka, written nightly by the euka-checkin
           background job across ~1.5M invite rows + full video history),
           so the browser no longer needs to sweep unrelated stores just to
           harvest them — it only fetches what video_codes needs. */
        const due = [];
        const taken = new Set();
        [...new Set(creators.map(c => (c.brand || '').trim()).filter(Boolean))].forEach(bn => {
          if (EXCLUDE.has(_normEukaBrand(bn))) return;
          const store = eukaStoreForBrand(meta.stores, bn);
          if (!store || taken.has(store.id)) return;
          if (EXCLUDE.has(_normEukaBrand(store.name))) return;
          if (Date.now() - (last[_normEukaBrand(store.name)] || 0) <= INTERVAL) return;
          taken.add(store.id);
          due.push(store);
        });

        for (const s of due) {
          const sNorm = _normEukaBrand(s.name);
          const brandCreators = creators.filter(c => eukaStoreForBrand([s], c.brand));
          if (!brandCreators.length) continue;
          /* Chunked history so a creator onboarded months ago still gets
             their older posts picked up (EUKA caps each export at ~60 days). */
          const hireDates = brandCreators.map(c => c.hiring_date).filter(Boolean).sort();
          const windows = eukaVideoWindows(hireDates[0] || '');
          try {
            const byHandle = {};
            for (const w of windows) {
              const d = await eukaJson({ store: s.id, type: 'videos', from: w.from, to: w.to });
              if (!d || !d.videos) continue;
              mergeAvatars(d.avatars);
              mergeVidProfile(d.tiers);
              if (d.brandPhoto) mergeBrandPhoto(s.name, d.brandPhoto);
              Object.entries(d.videos).forEach(([h, vids]) => { (byHandle[h] = byHandle[h] || []).push(...vids); });
            }
            // video_codes writes + items-enrichment only apply to creators
            // whose OWN brand is this store (collab-window logic is brand-scoped)
            for (const c of brandCreators) {
              const hs = [c.tiktok_account, c.tiktok_account_2].map(_normEukaHandle).filter(Boolean);
              const vids = hs.flatMap(h => byHandle[h] || []);
              const res = buildEukaVideoPatch(c, vids);
              if (res) { try { await onUpdateCreator(c.id, res.patch); } catch { /* row skip */ } }
            }
            /* items-sold enrichment · creator_video_level per creator gives an
               items count + thumbnail for EVERY video (dashboard covers only
               the top 50). Only creators with a revenue video still missing
               its items count · bounded per sweep to keep the sync light. */
            let quota = 10;
            const isoD = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
            for (const c of brandCreators) {
              if (quota <= 0) break;
              const rows = Array.isArray(c.video_codes) ? c.video_codes : [];
              // needs enrichment if a video is missing its items count OR its
              // engagement figures — both only exist on creator_video_level
              if (!rows.some(r => String(r?.video || '').trim() &&
                    ((Number(r?.revenue) > 0 && !(Number(r?.items) > 0)) || !(Number(r?.likes) > 0)))) continue;
              const hs = [c.tiktok_account, c.tiktok_account_2].map(_normEukaHandle).filter(Boolean);
              const win = collabWindowFor(c.hiring_date);
              if (!hs.length || !win || win.start > shopNow()) continue;
              quota -= 1;
              const cvFrom = isoD(win.start);
              const cvTo = isoD(win.end < shopNow() ? win.end : shopNow());
              const all = [];
              for (const h of hs) {
                const cd = await eukaJson({ store: s.id, type: 'cvideos', handle: h, from: cvFrom, to: cvTo });
                if (cd && cd.videos) Object.values(cd.videos).forEach(v => all.push(...v));
              }
              if (!all.length) continue;
              const res2 = buildEukaVideoPatch(c, all);
              if (res2) { try { await onUpdateCreator(c.id, res2.patch); } catch { /* row skip */ } }
            }
            last[sNorm] = Date.now();
            try { localStorage.setItem(SYNC_KEY, JSON.stringify(last)); } catch { /* full */ }
          } catch { /* store skip · retried next interval */ }
        }
      } catch (e) { console.warn('[euka video auto-sync]', e?.message || e); }
    })());
  }, [creators, isSuper, perms, onUpdateCreator]);

  /* ── EUKA → DB enrichment · auto-fill EMPTY email/phone on onboarded
     creators from EUKA profiles. Never overwrites values someone typed;
     runs once per session after a complete sweep; edit-permission only. */
  const eukaSyncedRef = useRef(false);
  useEffect(() => {
    if (eukaSyncedRef.current) return;
    if (!eukaL30?.profiles || !eukaL30.complete) return;
    if (!(isSuper || perms?.canEdit)) return;
    if (!onUpdateCreator || !creators?.length) return;
    eukaSyncedRef.current = true;
    const updates = [];
    creators.forEach(c => {
      const hs = [c.tiktok_account, c.tiktok_account_2].map(_normEukaHandle).filter(Boolean);
      let email = '', phone = '';
      hs.forEach(h => {
        const p = eukaL30.profiles[h];
        if (p) { email = email || p.email || ''; phone = phone || p.phone || ''; }
      });
      const patch = {};
      if (email && !String(c.email || '').trim()) patch.email = email;
      if (phone && !String(c.whatsapp_number || '').trim()) patch.whatsapp_number = phone;
      if (Object.keys(patch).length) updates.push([c.id, patch]);
    });
    if (!updates.length) return;
    (async () => {
      for (const [id, patch] of updates) {
        try { await onUpdateCreator(id, patch); } catch { /* skip row on error */ }
      }
    })();
  }, [eukaL30, creators, isSuper, perms, onUpdateCreator]);
  /* WURX-ADDED · a month remembered on another day is not restored. See
     `rememberedMonth`. WURX-END */
  const [month, setMonth] = useState(rememberedMonth(__initialState) || currentMonthKey()); // default = current month
  const [allTime, setAllTime] = useState(__initialState.allTime === true);
  useEffect(() => { patchUIState({ tab }); }, [tab]);
  /* God Mode writes to localStorage from a different component tree, so
     it announces itself and the nav re-reads on the next render. */
  const [godRev, setGodRev] = useState(0);
  useEffect(() => {
    const bump = () => setGodRev(v => v + 1);
    window.addEventListener('wurx-god-changed', bump);
    return () => window.removeEventListener('wurx-god-changed', bump);
  }, []);
  /* WURX-ADDED · stamped with the day, so tomorrow starts on the real month. */
  useEffect(() => { patchUIState({ month, monthSavedOn: todayStamp() }); }, [month]);
  /* WURX-END */
  useEffect(() => { patchUIState({ allTime }); }, [allTime]);
  // Afflix-style creator editor state: { mode: 'add'|'edit', creator?, defaultBrand? }
  const [editorState, setEditorState] = useState(null);
  // Keep the audit-log actor up to date so every logAudit() call attributes
  // the change to the signed-in user automatically.
  //
  // SET IT DURING RENDER, NOT ONLY IN THE EFFECT. `_actorUser` is a module
  // variable, so writing it from an effect leaves it null for the whole first
  // paint — and the effect sets no state, so nothing re-renders to correct it.
  // While it was only feeding logAudit() that cost an attribution at worst.
  // Now canEditStatus(), canExport() and canSelectRows() read it too, and a
  // stale null would silently strip an admin of the status dropdown, the
  // exports and the row checkboxes until some unrelated fetch happened to
  // re-render them. This is the same shape as the vendored app latching
  // identity at mount, which has bitten this integration before.
  if (currentUser) setAuditActor(currentUser);
  useEffect(() => { setAuditActor(currentUser); }, [currentUser]);
  const openAddCreator = useCallback((defaultBrand) => setEditorState({ mode: 'add', defaultBrand: defaultBrand || '' }), []);
  const openEditCreator = useCallback((c) => setEditorState({ mode: 'edit', creator: c }), []);

  // Derive autocomplete sources from existing creators
  const allBrandsList = useMemo(() => Array.from(new Set(creators.map(c => (c.brand || '').trim()).filter(Boolean))).sort(), [creators]);
  const allCategories = useMemo(() => Array.from(new Set(creators.map(c => (c.category || '').trim()).filter(Boolean))).sort(), [creators]);
  const directory = useMemo(() => {
    // De-dupe creators by name · pick the most recent record for each name (used for "have you worked with them?" autocomplete)
    const map = {};
    creators.forEach(c => {
      const k = (c.name || '').trim().toLowerCase();
      if (!k) return;
      if (!map[k] || (c.hiring_date || '') > (map[k].hiring_date || '')) map[k] = c;
    });
    return Object.values(map);
  }, [creators]);

  // Brand monthly budgets (per-brand, per-month manual budgets)
  const [budgets, setBudgets] = useState([]);
  const refetchBudgets = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('brand_monthly_budgets').select('*');
      if (!error) setBudgets(data || []);
    } catch {}
  }, []);
  useEffect(() => {
    refetchBudgets();
    // Unique channel name per mount so a stale subscription (created before the SQL existed)
    // doesn't silently swallow events forever.
    const ch = supabase
      .channel(`bmb_${Math.random().toString(36).slice(2, 9)}`)
      .on('postgres_changes', { event: '*', schema: 'wurxbase', table: 'brand_monthly_budgets' }, refetchBudgets)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetchBudgets]);

  // Apply month + search filters across all data
  const filtered = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    return creators.filter(c => {
      if (!allTime && month && monthKey(c.hiring_date) !== month) return false;
      if (q) {
        const hay = `${c.name || ''} ${c.brand || ''} ${c.tiktok_account || ''} ${c.category || ''} ${c.deal || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [creators, month, allTime, search]);

  // ── Per-brand Active / Inactive state ─────────────────────────────
  // Lifted here so Reporting tab can filter by active brands too.
  // Override map: { brandName: 'active' | 'inactive' }. Without an override,
  // a brand is auto-active if any of its creators has c.monthly data.
  const BRAND_STATE_KEY = 'wurx_perf_brand_state_v1';
  const [brandState, setBrandState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(BRAND_STATE_KEY) || '{}') || {}; }
    catch { return {}; }
  });
  const setBrandStateFor = useCallback((brand, state) => {
    setBrandState(prev => {
      const next = { ...prev, [brand]: state };
      try { localStorage.setItem(BRAND_STATE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // A brand is "active" for Reporting unless the user explicitly parked it as
  // inactive in the Performance tab. Default = active (so every brand in the
  // Brands tab shows in Reporting until manually moved). This is intentionally
  // looser than PerformanceTab's auto-split (which uses has-data as a default)
  // · that section is just a visual hint inside Performance, not a Reporting filter.
  const activeBrandSet = useMemo(() => {
    const set = new Set();
    creators.forEach(c => {
      const b = (c.brand || '').trim();
      if (!b) return;
      if (brandState[b] !== 'inactive') set.add(b);
    });
    return set;
  }, [creators, brandState]);

  /* God Mode can reorder these and switch some off. Read at render time so
     the change lands the moment the panel is closed. Anything the settings
     do not mention still appears, so adding a tab to the app never needs a
     matching settings edit. */
  const TABS = useMemo(() => {
    const ALL = [
      { id: 'brands',      label: 'Brands',      cap: 'tabBrands' },
      { id: 'creators',    label: 'Creators',    cap: 'tabCreators' },
      { id: 'performance', label: 'Performance', cap: 'tabPerformance' },
      { id: 'reporting',   label: 'Reporting',   cap: 'tabReporting' },
      { id: 'leaderboard', label: 'Leaderboard', cap: 'tabLeaderboard' },
      { id: 'discovery',   label: 'Discovery',   cap: 'tabDiscovery' },
    ].filter(t => can(currentUser, t.cap));
    let g = {};
    try { g = JSON.parse(localStorage.getItem('wurx_godmode_v1')) || {}; } catch (e) {}
    const hidden = Array.isArray(g.hidden) ? g.hidden : [];
    const wanted = Array.isArray(g.tabs) && g.tabs.length ? g.tabs : ALL.map(t => t.id);
    const ordered = [
      ...wanted.map(id => ALL.find(t => t.id === id)).filter(Boolean),
      ...ALL.filter(t => !wanted.includes(t.id)),
    ];
    const labels = g.labels || {};
    const out = ordered
      .filter(t => !hidden.includes(t.id))
      .map(t => ({ ...t, label: (labels[t.id] || '').trim() || t.label }));
    return out.length ? out : ALL;
    /* godRev is not read inside · it is the signal that the stored
       settings changed, which is the only thing that can alter this. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [godRev, currentUser]);

  useEffect(() => {
    if (TABS.length && !TABS.some(t => t.id === tab)) setTab(TABS[0].id);
  }, [TABS, tab]);

  /* On a phone the tab rail scrolls, so the live tab can sit off the
     right edge. Nudge the RAIL, never the element: scrollIntoView walks
     up to the nearest scrollable ancestor and will happily move the
     whole page, and doing that on every render is what made the app
     feel like it had lost its scroll. scrollLeft cannot leave the rail. */
  const tabsRailRef = useRef(null);
  useEffect(() => {
    const rail = tabsRailRef.current;
    if (!rail) return;
    const active = rail.querySelector('.pc-tab.active');
    if (!active) return;
    if (rail.scrollWidth <= rail.clientWidth + 4) return;   // nothing to scroll
    const want = active.offsetLeft - (rail.clientWidth - active.offsetWidth) / 2;
    const max = rail.scrollWidth - rail.clientWidth;
    const to = Math.max(0, Math.min(max, want));
    if (Math.abs(rail.scrollLeft - to) < 4) return;
    try { rail.scrollTo({ left: to, behavior: 'smooth' }); }
    catch (e) { rail.scrollLeft = to; }
  }, [tab]);

  const userInitial = ((currentUser?.display || '?')[0] || '?').toUpperCase();
  const userGrad = gradFor(currentUser?.display);

  return (
    <div className="pc-app" style={{ paddingTop: 6, paddingBottom: 32 }}>
      <div className="pc-shell">
        {/* ═══ HEADER ROW 1 · dark brown bar · brand · actions · profile ═══ */}
        <ChromeSlot embedded={embedded}>
        <header className={'pc-header pc-header-dark' + (embedded ? ' pc-header-embedded' : '')} style={{ gap: 10, background: 'linear-gradient(180deg, var(--wx-warning-soft) 0%, var(--wx-warning-soft) 100%)', border: '1px solid var(--wx-warning)', boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--wx-text) 7%, transparent), 0 6px 18px rgba(48,39,28,0.28)', padding: '2px 16px 2px 18px', marginBottom: 10, position: 'relative' }}>
          <div className="pc-brand" style={{ gap: 12 }}>
            <span className="pc-brand-logo" style={{ width: 60, height: 60, padding: 0, background: 'transparent', boxShadow: 'none', overflow: 'hidden', borderRadius: 13, flex: '0 0 60px' }}>
              <img
                src="/wurx-logo.png"
                alt="Wurx Media"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={e => { e.currentTarget.style.display = 'none'; const sib = e.currentTarget.nextElementSibling; if (sib) sib.style.display = 'flex'; }}
              />
              <span style={{ display: 'none', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,var(--wx-surface-2),var(--wx-surface-3))', color: 'var(--wx-warning)', fontSize: 22, fontWeight: 900, letterSpacing: '-0.5px', borderRadius: 13 }}>W</span>
            </span>
            <span className="pc-brand-sub" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.2px', color: 'var(--wx-text-muted)', paddingLeft: 12, borderLeft: '1px solid color-mix(in srgb, var(--wx-border) 20%, transparent)', whiteSpace: 'nowrap' }}>Paid Collaborations</span>
          </div>

          {/* Centered app title · absolutely centered so side widths never shift it */}
          <div className="pc-head-title" aria-hidden>
            <span className="pc-head-title-line" />
            <span className="pc-head-title-text">Wurx Creators Database</span>
            <span className="pc-head-title-line flip" />
          </div>

          <div style={{ flex: 1 }} />

          {/* Actions · light treatment for visibility on dark coffee bg */}
          <div className="pc-head-actions" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isSuper && pendingApprovalsCount > 0 && (
              <button onClick={onOpenPendingApprovals} title={`${pendingApprovalsCount} pending`} style={{
                position: 'relative', width: 44, height: 44, borderRadius: '50%', border: 0, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', color: 'var(--wx-warning)', transition: 'background 0.15s',
              }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--wx-surface-2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <span style={{ position: 'absolute', top: 5, right: 5, minWidth: 17, height: 17, padding: '0 5px', borderRadius: 999, background: 'var(--wx-warning-soft)', color: 'var(--wx-warning)', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{pendingApprovalsCount > 9 ? '9+' : pendingApprovalsCount}</span>
              </button>
            )}
            <PresenceAvatars currentUser={currentUser} />
            <button className="pc-head-bell" onClick={onOpenNotifications} title="Notifications" style={{
              position: 'relative', width: 44, height: 44, borderRadius: '50%', border: 0, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', color: 'var(--wx-text-muted)', transition: 'background 0.15s',
            }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--wx-surface-2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
              {notificationsCount > 0 && (
                /* SOLID danger, ringed in the bar behind it. It was painted in
                   --wx-danger-soft — a 10% wash meant for surfaces, not for a
                   9px dot — and ringed in a hardcoded near-black that is a dark
                   smudge on a light top bar. An unread marker nobody can see
                   is the same as no unread marker. */
                <span aria-label={notificationsCount + ' unread'} style={{
                  position: 'absolute', top: 7, right: 7,
                  minWidth: 10, height: 10, borderRadius: 999,
                  background: 'var(--wx-danger)',
                  boxShadow: '0 0 0 2px var(--wx-bg)',
                }} />
              )}
            </button>
            <button className="pc-head-logs" onClick={onOpenLogs} title="Activity Logs" style={{
              width: 44, height: 44, borderRadius: '50%', border: 0, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', color: 'var(--wx-text-muted)', transition: 'background 0.15s',
            }} onMouseEnter={e => { e.currentTarget.style.background = 'var(--wx-surface-2)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </button>
            {/* WURX-ADDED · the only door to Settings
                Their Settings panel was opened by the user chip, and embedded
                we hide that chip because our own top bar already says who you
                are. That closed the door on everything behind it: User
                Management, Access Control, God Mode. This is a gear, not a
                second profile — it says "settings for this section", which is
                what it now is. Shown only to somebody who has something in
                there; a viewer's click did nothing, and a control that does
                nothing is worse than no control. */}
            {onOpenSettings && canOpenSettings && (
              <button className="pc-head-settings" onClick={onOpenSettings} title="Paid Collabs settings" aria-label="Paid Collabs settings" style={{
                width: 44, height: 44, borderRadius: '50%', border: 0, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', color: 'var(--wx-text-muted)', transition: 'background 0.15s',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
            )}
            {/* WURX-END */}
            <div className="pc-head-sep" style={{ width: 1, height: 30, background: 'color-mix(in srgb, var(--wx-surface-2) 18%, transparent)', margin: '0 5px' }} />
            {(() => {
              const isViewer = currentUser?.role === 'viewer';
              const Tag = isViewer ? 'div' : 'button';
              const interactive = !isViewer;
              return (
                <Tag
                  className="pc-userchip"
                  onClick={interactive ? onOpenSettings : undefined}
                  title={interactive ? 'Profile · Settings' : `Signed in as ${currentUser?.display || 'User'}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 9,
                    height: 44, padding: '0 14px 0 5px', borderRadius: 999,
                    background: 'transparent', border: 0,
                    cursor: interactive ? 'pointer' : 'default',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={interactive ? e => { e.currentTarget.style.background = 'var(--wx-surface-2)'; } : undefined}
                  onMouseLeave={interactive ? e => { e.currentTarget.style.background = 'transparent'; } : undefined}
                >
                  <span style={{ width: 34, height: 34, borderRadius: 999, background: userGrad, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </span>
                  <span className="pc-userchip-txt" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--wx-text-muted)', letterSpacing: '-0.1px' }}>{currentUser?.display || 'User'}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--wx-text-muted)' }}>{isViewer ? 'Viewer' : (currentUser?.role || '')}</span>
                  </span>
                </Tag>
              );
            })()}
            {/* NO SIGN-OUT HERE WHEN EMBEDDED. There is one session, the hub's,
                and its top bar already ends it. This button ended a session
                that no longer exists: it cleared `ch_user` and left a blank
                screen behind, with the person still signed in. Rendered only
                if somebody passes `onSignOut`, which nothing does. */}
            {onSignOut && <button className="pc-head-out" onClick={onSignOut} title="Sign out" style={{
              width: 44, height: 44, borderRadius: '50%', border: 0, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'color-mix(in srgb, var(--wx-danger-soft) 12%, transparent)', color: 'var(--wx-danger)', transition: 'background 0.15s',
            }} onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,107,107,0.22)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,107,107,0.12)'; }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>}
          </div>
        </header>
        </ChromeSlot>

        {/* ═══ TAB BAR + month filter controls ═══
             Embedded, the six tabs are six rows in our sidebar and six routes,
             so the rail is not drawn at all — two navigations for one thing is
             worse than either. The month controls stay: they filter the screen
             you are already on, which is not navigation. */}
        <div className={embedded ? 'pc-filterbar' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: embedded ? 0 : 16, flexWrap: 'wrap' }}>
          {embedded ? <div style={{ flex: 1, minWidth: 0 }} /> : (
          <div className="pc-tabs" ref={tabsRailRef} style={{ marginTop: 0, flex: 1, minWidth: 0 }}>
            {TABS.map(t => (
              <button key={t.id} className={`pc-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          )}

          {/* Right-side filter cluster: month nav + All Time */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, opacity: allTime ? 0.45 : 1, pointerEvents: allTime ? 'none' : 'auto', transition: 'opacity 0.2s ease' }}>
              <button aria-label="Previous month" onClick={() => setMonth(m => addMonth(m, -1))}
                style={{ width: 34, height: 34, borderRadius: 999, border: '1px solid var(--pc-divider)', background: 'var(--pc-card)', color: 'var(--pc-text)', fontSize: 17, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >‹</button>
              <label title="Pick a month" style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                height: 34, padding: '0 12px', borderRadius: 999,
                background: 'var(--pc-card)', border: '1px solid var(--pc-divider)', cursor: 'pointer',
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                {/* WURX-ADDED class · this input is flush inside the pill above,
                    which already draws the surface and the edge. Our field rule
                    paints every input a field colour, and on this one that put a
                    band behind "September 2026" — the box-inside-a-box again.
                    Named so the rule can leave it alone. */}
                <input type="month" className="pc-chrome-input" value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }}
                  style={{ border: 0, background: 'transparent', outline: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: 'var(--pc-text)', cursor: 'pointer', minWidth: 100 }}
                />
              </label>
              <button aria-label="Next month" onClick={() => setMonth(m => addMonth(m, 1))}
                style={{ width: 34, height: 34, borderRadius: 999, border: '1px solid var(--pc-divider)', background: 'var(--pc-card)', color: 'var(--pc-text)', fontSize: 17, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >›</button>
            </div>
            <button onClick={() => setAllTime(v => !v)}
              title={allTime ? 'Showing all-time data · click to filter by month' : 'Show data across all months'}
              style={{
                height: 34, padding: '0 16px', borderRadius: 999,
                border: '1px solid ' + (allTime ? 'var(--pc-accent)' : 'var(--pc-divider)'),
                fontSize: 13, fontWeight: 700, letterSpacing: '-0.1px',
                background: allTime ? 'var(--pc-accent)' : 'var(--pc-card)',
                color: allTime ? 'white' : 'var(--pc-text)',
                cursor: 'pointer',
                boxShadow: allTime ? '0 4px 12px rgba(18,89,195,0.20)' : 'var(--pc-shadow)',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >All Time</button>
          </div>
        </div>

        {tab === 'brands' && (
          <BrandsTab creators={filtered} allCreators={creators} budgets={budgets} refetchBudgets={refetchBudgets} month={allTime ? '' : month} allTime={allTime} isSuper={isSuper} perms={perms} eukaL30={eukaL30} currentUser={currentUser} onSelectCreator={onSelectCreator} onAddCreator={openAddCreator} onEditCreator={openEditCreator} onDeleteBrand={onDeleteBrand} onSetCreatorStatus={onSetCreatorStatus} onUpdateCreator={onUpdateCreator}
            /* WURX-ADDED · the "brand is in another month" notice needs to be
               able to take you there. The month lives up here, so the setter
               has to come down — without it the button rendered, looked
               clickable, and threw a ReferenceError into the console that
               nobody would ever read. WURX-END */
            onPickMonth={(m) => { setAllTime(false); setMonth(m); }} />
        )}
        {tab === 'creators' && (
          <CreatorsTab
            creators={filtered}
            allCreators={creators}
            allTime={allTime}
            month={month}
            eukaL30={eukaL30}
            onSetCreatorStatus={onSetCreatorStatus}
            onUpdateCreator={onUpdateCreator}
            onEditCreator={openEditCreator}
          />
        )}
        {tab === 'performance' && (
          <PerformanceTab
            creators={filtered}
            allCreators={creators}
            allTime={allTime}
            month={month}
            onUpdateCreator={onUpdateCreator}
            onDeleteCreator={onDeleteCreator}
            brandState={brandState}
            setBrandStateFor={setBrandStateFor}
          />
        )}
        {tab === 'reporting' && (
          <div style={{ marginTop: 14 }}>
            {typeof reportingNode === 'function'
              ? reportingNode({
                  // `creators` (hire-date filtered) drives the brand LIST and per-creator
                  // metrics (count, allocated, paid, videos delivered) · same scope as
                  // Brands tab. `allCreators` is the unfiltered pool used only to source
                  // GMV / Ad Spent / ROAS from c.monthly, exactly like Performance tab's
                  // brand rows do. That way May data entered for an April-hired creator
                  // still counts in May Reporting.
                  creators: filtered,
                  allCreators: creators,
                  activeBrands: activeBrandSet,
                  /* Lets an empty Creative Angles screen jump to the month the
                     tests were actually saved in. The month lives HERE, so the
                     setter has to come from here. */
                  goToMonth: (year, month0) => {
                    setAllTime(false);
                    setMonth(String(year) + '-' + String(month0 + 1).padStart(2, '0'));
                  },
                  dateFilter: (() => {
                    if (allTime || !month) return { mode: 'all' };
                    const parts = month.split('-');
                    if (parts.length !== 2) return { mode: 'all' };
                    const y = parseInt(parts[0], 10);
                    const m = parseInt(parts[1], 10) - 1; // ReportingViewV2 expects 0-indexed month
                    if (isNaN(y) || isNaN(m)) return { mode: 'all' };
                    return { mode: 'month', year: y, month: m };
                  })(),
                })
              : (reportingNode || <EmptyState icon="chart" title="Reporting" text="Reporting view will load here." />)}
          </div>
        )}

        {tab === 'leaderboard' && (
          <div style={{ marginTop: 14 }}>
            <LeaderboardTab
              creators={filtered}
              allCreators={creators}
              month={month}
              allTime={allTime}
              onPickMonth={(m) => { setAllTime(false); setMonth(m); }}
            />
          </div>
        )}

        {/* Discovery · fully self-contained · reads only `creators` (to know
            who we already have) and its own EUKA fetch. Writes nothing. */}
        {tab === 'discovery' && (
          <div style={{ marginTop: 14 }}>
            <DiscoveryTab creators={creators} currentUser={currentUser} />
          </div>
        )}
      </div>

      {editorState && (
        <CreatorEditModal
          mode={editorState.mode}
          creator={editorState.creator}
          defaultBrand={editorState.defaultBrand}
          brands={allBrandsList}
          directory={directory}
          categories={allCategories}
          budgets={budgets}
          allCreators={creators}
          euka={eukaL30}
          currentUser={currentUser}
          onDelete={onDeleteCreator}
          onSave={async (data) => {
            if (!onSaveCreator) return;
            await onSaveCreator(data);
            setEditorState(null);
          }}
          onClose={() => setEditorState(null)}
        />
      )}
    </div>
  );
}

/* ════════ BRANDS TAB ════════ */
function BrandsTab({ creators, allCreators, budgets, refetchBudgets, month, allTime, isSuper, perms, eukaL30, currentUser, onSelectCreator, onAddCreator, onEditCreator, onDeleteBrand, onSetCreatorStatus, onUpdateCreator, onDeleteCreator, onPickMonth }) {
  const [search, setSearch] = useState('');
  // Track only brand name (string), so re-renders pick up live data from brandRows automatically
  const [drillBrandName, setDrillBrandName] = useState(() => loadUIState().brandsDrill || null);
  useEffect(() => { patchUIState({ brandsDrill: drillBrandName }); }, [drillBrandName]);
  const [notesBrand, setNotesBrand] = useState(null);
  const [showNewBrand, setShowNewBrand] = useState(false);
  const canAddBrand = !!(isSuper || perms?.canAdd || perms?.canEdit);
  // Sortable columns · persisted so the preferred order survives refresh
  const [sortKey, setSortKey] = useState(() => loadUIState().brandsSortKey || 'allocated');
  const [sortDir, setSortDir] = useState(() => loadUIState().brandsSortDir || 'desc');
  useEffect(() => { patchUIState({ brandsSortKey: sortKey, brandsSortDir: sortDir }); }, [sortKey, sortDir]);
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const brandRows = useMemo(() => {
    const map = {};
    const ensure = (b) => {
      if (!map[b]) map[b] = { brand: b, allocated: 0, paid: 0, creators: 0, videos: 0, videosDone: 0, list: [] };
      return map[b];
    };
    creators.forEach(c => {
      const b = (c.brand || '').trim();
      if (!b) return;
      const row = ensure(b);
      const amt = parseDealAmount(c.deal);
      const vids = parseDealVideos(c.deal);
      row.allocated += amt;
      row.creators += 1;
      row.videos += vids;
      if (c.payment_status === 'Paid') row.paid += amt;
      // Delivered = actual video URLs filled in video_codes (not the c.videos status flag)
      row.videosDone += deliveredVideoCount(c);
      row.list.push(c);
    });
    // Also pull in any brand that has a budget record for the picked scope but
    // doesn't have any creators yet. Without this, a freshly-added brand for
    // a new month was invisible (the iteration started from creators only).
    (budgets || []).forEach(b => {
      const name = (b?.brand || '').trim();
      if (!name) return;
      const inScope = allTime ? true : (b.month === month);
      if (!inScope) return;
      ensure(name);
    });
    Object.values(map).forEach(row => {
      if (allTime) {
        row.budget = budgets.filter(x => x.brand === row.brand).reduce((s, x) => s + (Number(x.budget) || 0), 0);
        row.budgetRecord = null;
      } else if (month) {
        const b = budgets.find(x => x.brand === row.brand && x.month === month);
        row.budget = b ? Number(b.budget) || 0 : 0;
        row.budgetRecord = b || null;
        row.notes = b?.notes || '';
        row.contentGuideUrl = b?.content_guide_url || '';
        row.focusProducts = Array.isArray(b?.focus_product_url) ? b.focus_product_url : [];
      }
      row.remaining = (row.budget || 0) - row.allocated;
      row.usage = row.budget > 0 ? (row.allocated / row.budget) * 100 : 0;
      // Cost / video = allocated / committed videos (Afflix semantics · not delivered)
      row.costPerVideo = row.videos > 0 ? row.allocated / row.videos : 0;
    });
    return Object.values(map).sort((a, b) => b.allocated - a.allocated);
  }, [creators, budgets, month, allTime]);

  /* WURX-ADDED · BRANDS THAT EXIST, BUT NOT IN THE MONTH ON SCREEN.
     The list above is built from this month's creators and this month's budget
     rows, so a brand set up for another month is simply absent — and absent is
     exactly what "it was never saved" looks like. This finds them so the screen
     can say where they are.

     Budget rows only: a brand with CREATORS in another month is a brand that
     was worked then and is not news. A brand with a BUDGET and nowhere to be
     seen is somebody wondering where their brand went. Matched
     case-insensitively, because a budget saved as "HoneySticks" and a creator
     row saying "Honeysticks" are the same brand to everyone but a string
     comparison.

     AND ONLY THE PRESENT OR THE FUTURE. The first cut of this listed every
     brand from every month and read "6 brands are not here" on an ordinary
     September — Aqua Sonic, Bentgo, Flywell and three more that nobody had
     lost. A notice that is on the screen every day is wallpaper, and wallpaper
     is exactly how the real one would be missed. Somebody hunting for a brand
     is hunting for one that was set up NOW; history is not news. */
  const wxElsewhere = useMemo(() => {
    if (allTime || !month) return [];
    const now = currentMonthKey();
    const here = new Set(brandRows.map((r) => r.brand.trim().toLowerCase()));
    const out = new Map();
    (budgets || []).forEach((b) => {
      const name = (b?.brand || '').trim();
      const key = name.toLowerCase();
      if (!name || !b.month || b.month === month || here.has(key)) return;
      if (b.month < now) return;                 /* history is not news */
      const prev = out.get(key);
      if (!prev || b.month < prev.month) out.set(key, { brand: name, month: b.month });
    });
    return [...out.values()].sort((a, b) => a.month.localeCompare(b.month) || a.brand.localeCompare(b.brand));
  }, [budgets, brandRows, month, allTime]);
  /* WURX-END */

  const filteredBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? brandRows.filter(r => r.brand.toLowerCase().includes(q)) : brandRows;
    const dir = sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (sortKey === 'brand') return dir * a.brand.localeCompare(b.brand);
      const av = Number(a[sortKey]) || 0, bv = Number(b[sortKey]) || 0;
      return dir * (av - bv) || a.brand.localeCompare(b.brand);
    });
    return list;
  }, [brandRows, search, sortKey, sortDir]);

  const totals = useMemo(() => brandRows.reduce((acc, r) => ({
    budget: acc.budget + (r.budget || 0),
    allocated: acc.allocated + r.allocated,
    paid: acc.paid + r.paid,
    remaining: acc.remaining + r.remaining,
    videos: acc.videos + r.videos,
    videosDone: acc.videosDone + r.videosDone,
  }), { budget: 0, allocated: 0, paid: 0, remaining: 0, videos: 0, videosDone: 0 }), [brandRows]);

  /* WURX-ADDED · NEW VIDEO GMV ACROSS EVERY BRAND, for the sixth card.
     Rashid, 2026-09-21: "sum the new video gmv of all the brands and add it in
     the first row of brand's main page".

     Brand by brand, with the very function the brand page's GMV card uses, over
     the very rows it is given (`row.list` is this screen's creators for that
     brand, which is what BrandDrilldown receives). So it follows the month
     picker and All Time exactly as those cards do, and ignores the search box
     as the other five cards here do. Summed unrounded and rounded once, so it
     can differ from a calculator run over the rounded brand cards by under a
     dollar a brand, never more. */
  const wxGmvAll = useMemo(() => {
    let gmv = 0, videos = 0, brands = 0, dupes = 0;
    brandRows.forEach((r) => {
      const t = wxVideoTotals(r.list);
      gmv += t.gmv;
      videos += t.all.length;
      dupes += t.dupes;
      if (t.gmv > 0) brands += 1;
    });
    return { gmv, videos, brands, dupes };
  }, [brandRows]);
  /* WURX-END */

  /* ══ INSIGHTS · computed signals worth acting on, shown under the KPIs ══
     Budget philosophy: DEPLOYING the full budget is the goal — 100% used
     is a win, UNDER-spending late in the month is the real problem. */
  const insights = useMemo(() => {
    const out = [];
    const now = shopNow();

    // month progress (only meaningful when viewing the current month)
    const viewingCurrent = !allTime && month === currentMonthKey();
    let monthFrac = 0, daysLeft = 0;
    if (viewingCurrent) {
      const [yy, mm] = month.split('-').map(Number);
      const dim = new Date(yy, mm, 0).getDate();
      monthFrac = now.getDate() / dim;
      daysLeft = dim - now.getDate();
    }

    // 1 · budget fully deployed = WIN · far over-allocated = flag
    brandRows
      .filter(r => r.budget > 0 && r.usage >= 100)
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 2)
      .forEach(r => {
        if (r.usage > 115) out.push({ tone: 'warn', text: `${r.brand} over-allocated · ${Math.round(r.usage)}% of budget` });
        else out.push({ tone: 'good', text: `${r.brand} budget fully deployed` });
      });

    // 2 · UNDER-spend alert · >60% of the month gone but <50% allocated
    if (viewingCurrent && monthFrac > 0.6) {
      brandRows
        .filter(r => r.budget > 0 && r.usage < 50)
        .sort((a, b) => a.usage - b.usage)
        .slice(0, 2)
        .forEach(r => out.push({ tone: 'warn', text: `${r.brand} underspent · only ${Math.round(r.usage)}% allocated, ${daysLeft}d left` }));
    }

    // 3 · deadline nudge · budget still open with ≤5 days to deploy it
    if (viewingCurrent && daysLeft > 0 && daysLeft <= 5) {
      brandRows
        .filter(r => r.budget > 0 && r.remaining > 0 && r.usage < 100)
        .sort((a, b) => b.remaining - a.remaining)
        .slice(0, 1)
        .forEach(r => out.push({ tone: 'warn', text: `${r.brand}: ${fmt$Exact(r.remaining)} left to deploy · ${daysLeft}d` }));
    }

    // 4 · creators whose collab window is closing with videos still due
    let closing = 0, ended = 0;
    creators.forEach(cr => {
      const v = parseDealVideos(cr.deal) || 0;
      if (!v) return;
      const w = collabWindowFor(cr.hiring_date);
      if (!w) return;
      const filled = deliveredVideoCount(cr);
      if (filled >= v) return;
      if (now > w.end) ended += 1;
      else if ((w.end - now) / 86400000 <= 5) closing += 1;
    });
    if (closing) out.push({ tone: 'warn', text: `${closing} creator${closing !== 1 ? 's' : ''} at delivery risk · window closing` });
    if (ended)   out.push({ tone: 'danger', text: `${ended} collab${ended !== 1 ? 's' : ''} ended incomplete` });

    // 5 · strongest onboarded creator by overall L30 GMV
    if (eukaL30) {
      let best = null;
      creators.forEach(cr => {
        const v = eukaL30For(eukaL30, [cr.tiktok_account, cr.tiktok_account_2]);
        if (v != null && v > 0 && (!best || v > best.v)) best = { v, name: cr.name };
      });
      if (best) out.push({ tone: 'good', text: `Top L30: ${best.name} · ${fmt$Exact(Math.round(best.v))}` });
    }

    // 6 · best value · lowest $ per DELIVERED video (min 3 delivered)
    let bv = null;
    creators.forEach(cr => {
      const amt = parseDealAmount(cr.deal);
      const del = deliveredVideoCount(cr);
      if (amt > 0 && del >= 3) {
        const r = amt / del;
        if (!bv || r < bv.r) bv = { r, name: cr.name };
      }
    });
    if (bv) out.push({ tone: 'good', text: `Best value: ${bv.name} · ${fmt$Exact(Math.round(bv.r))}/video` });

    // dangers first, then warnings, then wins · cap at 5 chips
    const rank = { danger: 0, warn: 1, good: 2 };
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 5);
  }, [brandRows, creators, eukaL30, allTime, month]);

  // Look up live drill-brand data from brandRows so it auto-updates after budget/notes save
  const drillBrand = drillBrandName ? brandRows.find(r => r.brand === drillBrandName) : null;
  if (drillBrand) {
    return <BrandDrilldown
      brand={drillBrand}
      currentUser={currentUser}
      creators={creators.filter(c => (c.brand || '').trim() === drillBrand.brand)}
      brandCreators={(allCreators || creators).filter(c => (c.brand || '').trim() === drillBrand.brand)}
      allCreators={allCreators || creators}
      budgets={budgets}
      refetchBudgets={refetchBudgets}
      month={month}
      allTime={allTime}
      eukaL30={eukaL30}
      onBack={() => setDrillBrandName(null)}
      onSelectCreator={onSelectCreator}
      canEdit={isSuper || perms?.canEdit}
      canAdd={perms?.canAdd}
      canDeleteBrand={isSuper}
      onAddCreator={onAddCreator}
      onEditCreator={onEditCreator}
      onDeleteBrand={onDeleteBrand}
      onSetCreatorStatus={onSetCreatorStatus}
      onUpdateCreator={onUpdateCreator}
      onDeleteCreator={onDeleteCreator}
    />;
  }

  return (
    <>
      {/* WURX-ADDED · six cards, not five: the grid is ours to size now
          (`wx-kpis-6` in wurxbase-overrides.css) and the sixth is New Video GMV.
          Theirs read: className="pc-kpis pc-kpis-5" style={{ marginTop: 16,
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }} */}
      <div className="wx-kpis-wrap">
      <div className="pc-kpis pc-kpis-5 wx-kpis-6" style={{ marginTop: 16 }}>
      {/* WURX-END */}
        <KPI label="Total Budget"     value={totals.budget > 0 ? fmt$Exact(totals.budget) : '-'} color="#1259C3" />
        <KPI label="Allocated"        value={fmt$Exact(totals.allocated)}                       color="#8B5CF6" />
        <KPI label="Paid"             value={fmt$Exact(totals.paid)}                            color="#2E7D32" />
        <KPI label="Remaining"        value={fmt$Exact(totals.remaining)}                       color={totals.remaining < 0 ? '#C62828' : '#E65100'} />
        <KPI label="Videos Delivered" value={`${totals.videosDone} / ${totals.videos}`}    color="#0A0A0A" />
        {/* WURX-ADDED · the same card as the five before it, in GMV green, and
            carrying its exact figure for the check and the hover. */}
        <div className="pc-kpi pc-kpi-simple wx-kpi-gmv" style={{ '--kpi-color': 'var(--wx-success)' }}
          data-value={wxGmvAll.gmv.toFixed(2)}
          title={`$${wxGmvAll.gmv.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} new video GMV · ${wxGmvAll.videos} video${wxGmvAll.videos === 1 ? '' : 's'} across ${brandRows.length} brand${brandRows.length === 1 ? '' : 's'} · ${allTime ? 'all time' : monthLabel(month)}${wxGmvAll.dupes ? ` · ${wxGmvAll.dupes} video${wxGmvAll.dupes === 1 ? '' : 's'} listed under two deals, counted once` : ''} · the brand pages' GMV cards added up to the cent, then rounded once`}>
          <div className="pc-kpi-row" style={{ marginBottom: 10 }}>
            <span className="pc-kpi-dot" style={{ background: 'var(--wx-success)' }} />
            <div className="pc-kpi-label">New Video GMV</div>
          </div>
          <div className="pc-kpi-value">{fmt$Exact(Math.round(wxGmvAll.gmv))}</div>
        </div>
      </div>
      </div>
      {/* WURX-END */}

      <div className="pc-toolbar" style={{ marginTop: 14 }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search brands…" />
        <span style={{ display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px', borderRadius: 999, background: 'var(--pc-card-2)', color: 'var(--pc-text-2)', fontSize: 12.5, fontWeight: 700, letterSpacing: '-0.1px', border: '1px solid var(--pc-divider)' }}>
          {filteredBrands.length} {filteredBrands.length === 1 ? 'brand' : 'brands'} · {allTime ? 'all time' : monthLabel(month)}
        </span>
        {canExport() && <button
          className="pc-btn pc-btn-ghost pc-btn-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          title="Download this table as CSV"
          onClick={() => {
            const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
            const rows = [
              ['Brand', 'Budget', 'Allocated', 'Paid', 'Remaining', 'Usage %', 'Videos done', 'Videos total', 'Creators', 'Cost per video'],
              ...filteredBrands.map(r => [
                r.brand, r.budget || 0, r.allocated, r.paid, r.remaining,
                r.budget > 0 ? Math.round(r.usage) : '', r.videosDone, r.videos, r.creators,
                r.costPerVideo > 0 ? Math.round(r.costPerVideo) : '',
              ]),
            ];
            const csv = rows.map(row => row.map(esc).join(',')).join('\r\n');
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `brands-${allTime ? 'all-time' : month}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export
        </button>}
        {canAddBrand && (
          <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={() => setShowNewBrand(true)} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Brand
          </button>
        )}
      </div>

      {/* WURX-ADDED · A BRAND THAT EXISTS IN ANOTHER MONTH SAYS SO.
          Rashid, 2026-10-09: Asad added HoneySticks and nobody else could find
          it. It was never missing — it has an October budget and no creators,
          and everyone else's browser was still on September, so the list it
          belongs to was not the list they were looking at.

          The screen had no way to say that. It showed eleven brands and no
          hint that a twelfth existed one month over, which is indistinguishable
          from the brand never having been saved — and that is what the whole
          team concluded, twice. So: name them, say which month, and switch on
          a click. One line, and only when there is something to say. */}
      {!allTime && wxElsewhere.length > 0 && (
        <div
          data-wx="brands-elsewhere"
          style={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
            margin: '0 0 12px', padding: '10px 14px',
            border: '1px solid color-mix(in srgb, var(--wx-accent) 32%, transparent)',
            background: 'color-mix(in srgb, var(--wx-accent) 7%, transparent)',
            borderRadius: 12, fontSize: 13, color: 'var(--pc-text)',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--pc-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
          <span>
            {wxElsewhere.length === 1 ? (
              <><b>{wxElsewhere[0].brand}</b> is set up in {monthLabel(wxElsewhere[0].month)}, not in {monthLabel(month)}.</>
            ) : (
              <>
                <b>{wxElsewhere.length} brands</b> are set up in a later month, not in {monthLabel(month)}
                {': '}
                {wxElsewhere.map((b) => b.brand).slice(0, 4).join(', ')}
                {wxElsewhere.length > 4 ? ` +${wxElsewhere.length - 4}` : ''}.
              </>
            )}
          </span>
          {[...new Set(wxElsewhere.map((b) => b.month))].sort().slice(0, 3).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onPickMonth && onPickMonth(m)}
              title={`Show ${monthLabel(m)}`}
              style={{
                border: '1px solid var(--pc-accent)', background: 'transparent',
                color: 'var(--pc-accent)', borderRadius: 999, padding: '2px 10px',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Show {monthLabel(m)}
            </button>
          ))}
        </div>
      )}
      {/* WURX-END */}

      {filteredBrands.length === 0 ? (
        <EmptyState icon="brands" title="No active brands this month" text={search ? 'Try a different search' : 'Switch to a different month or enable All time'} />
      ) : (
        <div className="pc-card">
          <div className="pc-bt-head">
            {[
              ['brand', 'Brand'], ['budget', 'Budget'], ['allocated', 'Allocated'],
              ['paid', 'Paid'], ['remaining', 'Remaining'], ['usage', 'Usage'],
              ['videosDone', 'Videos'], ['creators', 'Creators'], ['costPerVideo', 'Cost / Video'],
            ].map(([key, label]) => (
              <div
                key={key}
                className={`pc-bt-sort ${sortKey === key ? 'on' : ''}`}
                onClick={() => toggleSort(key)}
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') toggleSort(key); }}
                title={`Sort by ${label}`}
              >
                {label}
                <span className="pc-bt-arrow">{sortKey === key ? (sortDir === 'desc' ? '▼' : '▲') : ''}</span>
              </div>
            ))}
            <div />
          </div>
          {filteredBrands.map(r => {
            const hasNotes = !!((r.notes || '').trim());
            return (
            <div key={r.brand} className="pc-bt-row" onClick={() => setDrillBrandName(r.brand)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setDrillBrandName(r.brand); }}>
              <div className="pc-brandcell">
                <BrandFace brand={r.brand} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="pc-brandname">{r.brand}</div>
                  <small className="pc-brandsub">{r.creators} creator{r.creators !== 1 ? 's' : ''} · {r.videosDone}/{r.videos} videos</small>
                </div>
                {canEditStatus() && <button
                  className={`pc-note-btn ${hasNotes ? 'has' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setNotesBrand(r); }}
                  title={hasNotes ? 'View / edit notes' : 'Add notes'}
                  aria-label="Notes"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="13" y2="17" />
                  </svg>
                </button>}
              </div>
              <div className="pc-num pc-money" data-label="Budget">{r.budget > 0 ? fmt$Exact(r.budget) : <span className="pc-money muted">-</span>}</div>
              <div className="pc-num pc-money" data-label="Allocated">{fmt$Exact(r.allocated)}</div>
              <div className="pc-num pc-money pc-green" data-label="Paid">{fmt$Exact(r.paid)}</div>
              <div className="pc-num pc-money" data-label="Remaining" style={{ color: r.remaining < 0 ? 'var(--pc-error-fg)' : 'inherit' }}>{fmt$Exact(r.remaining)}</div>
              {(() => {
                if (!r.budget || r.budget <= 0) {
                  return <div className="pc-usage" data-label="Usage"><span className="pc-money muted">-</span></div>;
                }
                const c = r.usage >= 80 ? 'var(--pc-success-fg)'
                        : r.usage >= 20 ? 'var(--pc-warn-fg)'
                        : 'var(--pc-error-fg)';
                return (
                  <div className="pc-usage" data-label="Usage">
                    <span className="pc-usage-pct" style={{ color: c }}>{Math.round(r.usage)}%</span>
                    <div className="pc-usage-track">
                      <div className="pc-usage-fill" style={{ width: `${Math.min(100, r.usage)}%`, background: c }} />
                    </div>
                  </div>
                );
              })()}
              <div className="pc-num" data-label="Videos">
                {r.videos > 0 ? (
                  <div className="pc-vidprog">
                    <span className="pc-vidprog-n">{r.videosDone}<span className="pc-vidprog-of">/{r.videos}</span></span>
                    <div className="pc-vidprog-track">
                      <div className="pc-vidprog-fill" style={{ width: `${Math.min(100, (r.videosDone / r.videos) * 100)}%` }} />
                    </div>
                  </div>
                ) : <span className="pc-money muted">-</span>}
              </div>
              <div className="pc-num" data-label="Creators">{r.creators}</div>
              <div className="pc-num pc-money" data-label="Cost / Vid">{r.costPerVideo > 0 ? fmt$Exact(Math.round(r.costPerVideo)) : <span className="pc-money muted">-</span>}</div>
              <div style={{ color: 'var(--pc-text-3)', textAlign: 'center', fontSize: 18 }}>›</div>
            </div>
            );
          })}
        </div>
      )}

      {notesBrand && (
        <NotesDrawer
          brand={notesBrand.brand}
          month={month || currentMonthKey()}
          initial={notesBrand.notes || ''}
          onSaved={refetchBudgets}
          onClose={() => setNotesBrand(null)}
        />
      )}
      {showNewBrand && (
        <BudgetEditor
          brand=""
          month={month || currentMonthKey()}
          brandNames={Array.from(new Set(brandRows.map(r => r.brand))).sort()}
          allBudgets={budgets}
          onSaved={refetchBudgets}
          onClose={() => setShowNewBrand(false)}
        />
      )}
    </>
  );
}

/* ════════ BRAND DRILLDOWN · Afflix exact UI ════════ */
/* Stable dedupe key for a TikTok video URL · numeric video id when present */
function _vidKey(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  const m = s.match(/video\/(\d+)/);
  return m ? m[1] : s.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '');
}

/* Match a Wurx brand name to its EUKA store.
   Exact normalized match first; otherwise a UNIQUE prefix match in either
   direction — so DB "Swisse" finds store "Swisse Wellness", and a longer DB
   name finds a shorter store name. Ambiguous prefixes (2+ candidates) do
   not match — never guess between stores. */
const _normEukaBrand = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function eukaStoreForBrand(stores, brandName) {
  const nb = _normEukaBrand(brandName);
  if (!nb || !Array.isArray(stores)) return null;
  const exact = stores.find(s => _normEukaBrand(s.name) === nb);
  if (exact) return exact;
  const cands = stores.filter(s => {
    const ns = _normEukaBrand(s.name);
    return ns && (ns.startsWith(nb) || nb.startsWith(ns));
  });
  return cands.length === 1 ? cands[0] : null;
}

/* EUKA's video export silently returns ZERO rows past ~60 days — split any
   longer span into ≤55-day windows (newest first, max 8) and merge results. */
function eukaVideoWindows(fromStr) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  let from = fromStr && /^\d{4}-\d{2}-\d{2}$/.test(fromStr) ? new Date(`${fromStr}T00:00:00Z`) : null;
  if (!from || isNaN(from) || from > today) {
    from = new Date(today); from.setUTCDate(from.getUTCDate() - 55);
  }
  const windows = [];
  let end = new Date(today);
  while (end > from && windows.length < 8) {
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 55);
    windows.push({ from: iso(start < from ? from : start), to: iso(end) });
    end = new Date(start); end.setUTCDate(end.getUTCDate() - 1);
  }
  return windows;
}

/* Per-creator collaboration VIDEO window · FULL CALENDAR MONTH:
     the 1st of the month through its true last day
     (Jul 1–31 · Aug 1–31 · Sep 1–30 · Feb 1–28/29 — automatic).
   Everything posted outside that month is ignored for the collab.
   The creator's month = onboarding month (rolls to next month when
   onboarded after the 25th, same as the contract's effective month). */
function collabWindowFor(hiringDate) {
  if (!hiringDate) return null;
  const eff = new Date(`${String(hiringDate).slice(0, 10)}T00:00:00`);
  if (isNaN(eff)) return null;
  let y = eff.getFullYear(), m = eff.getMonth();
  if (eff.getDate() > 25) { m += 1; if (m > 11) { m = 0; y += 1; } }
  return {
    start: new Date(y, m, 1, 0, 0, 0, 0),
    end:   new Date(y, m + 1, 0, 23, 59, 59, 999),   // day 0 of next month = true month end
  };
}

/* Merge EUKA-posted videos into one creator's video_codes — TIMELINE-SCOPED.
   · Only videos posted inside the creator's collab window are added
     (a June post can never count toward a July collab).
   · Rows previously imported from EUKA that fall OUTSIDE the window are
     REMOVED (cleans up the earlier unscoped sync). Manual rows whose
     video id is unknown to EUKA are never touched.
   · Delivery flag syncs BOTH ways: reaches committed → 'Done'
     (→ Payment Pending) · drops below after cleanup → 'In Progress'. */
function buildEukaVideoPatch(c, vids) {
  const win = collabWindowFor(c.hiring_date);
  if (!win || !vids || !vids.length) return null;

  const inWindow = [];
  const outIds = new Set();
  vids.forEach(v => {
    const k = _vidKey(v.video);
    if (!k) return;
    const d = v.date ? new Date(v.date) : null;
    if (d && !isNaN(d) && d >= win.start && d <= win.end) inWindow.push(v);
    else outIds.add(k);           // dated outside window, or undated → not this collab
  });

  let rows = (Array.isArray(c.video_codes) ? c.video_codes : [])
    .map(v => ({
      video: v?.video || '', adCode: v?.adCode || '', auth: !!v?.auth,
      date: v?.date || '', views: Number(v?.views) || 0,
      revenue: Number(v?.revenue) || 0, items: Number(v?.items) || 0,
      product: v?.product || '', thumb: v?.thumb || '',
      likes: Number(v?.likes) || 0, comments: Number(v?.comments) || 0,
      secs: Number(v?.secs) || 0,
    }));

  /* cleanup · drop rows that EUKA says were posted outside this collab */
  const before = rows.length;
  rows = rows.filter(r => { const k = _vidKey(r.video); return !k || !outIds.has(k); });
  const removed = before - rows.length;

  /* BACKFILL + METRIC REFRESH ·
     · adCode / posted-date fill in once (never overwrite manual values)
     · views / revenue / items / product / thumb are LIVE METRICS —
       refreshed on every sweep so the table stays current */
  const infoById = {};
  inWindow.forEach(v => {
    const k = _vidKey(v.video);
    if (!k) return;
    infoById[k] = {
      code: String(v.adCode || '').trim(),
      date: v.date ? String(v.date).slice(0, 10) : '',
      views: Number(v.views) || 0,
      revenue: Number(v.revenue) || 0,
      items: Number(v.items) || 0,
      product: String(v.product || '').trim(),
      thumb: String(v.thumb || '').trim(),
      /* engagement · only the per-creator creator_video_level export
         carries these, so they arrive on the lazy expand / quota sweep.
         Zero means "this source didn't have it" — never overwrite a
         known value with 0. */
      likes: Number(v.likes) || 0,
      comments: Number(v.comments) || 0,
      secs: Number(v.secs) || 0,
    };
  });
  let codes = 0, dated = 0, metrics = 0;
  rows.forEach(r => {
    const k = _vidKey(r.video);
    const m = k && infoById[k];
    if (!m) return;
    if (m.code && !String(r.adCode || '').trim()) { r.adCode = m.code; r.auth = true; codes += 1; }
    if (m.date && !String(r.date || '').trim()) { r.date = m.date; dated += 1; }
    /* WURX-ADDED · `items` is guarded like every field beside it.
       It was the ONLY one of the six written unconditionally, and the only one
       the posted-videos sweep does not actually know: `views` and `revenue`
       come from the export and are real for every row, but `items` comes from
       the dashboard's enrichment, which returns FIVE videos however many you
       ask for. So a store-wide sweep wrote items:0 over every video outside
       that five — including the true counts the per-creator sweep had just
       written from `items_sold_count`, which only reaches ten creators a pass.
       The column oscillated instead of filling. */
    if (m.views !== r.views || m.revenue !== r.revenue || (m.items && m.items !== r.items) ||
        (m.product && m.product !== r.product) || (m.thumb && m.thumb !== r.thumb)) {
      r.views = m.views; r.revenue = m.revenue;
      if (m.items) r.items = m.items;
      if (m.product) r.product = m.product;
      if (m.thumb) r.thumb = m.thumb;
      metrics += 1;
    }
    if ((m.likes && m.likes !== r.likes) || (m.comments && m.comments !== r.comments) || (m.secs && m.secs !== r.secs)) {
      if (m.likes) r.likes = m.likes;
      if (m.comments) r.comments = m.comments;
      if (m.secs) r.secs = m.secs;
      metrics += 1;
    }
  });

  const seen = new Set(rows.map(r => _vidKey(r.video)).filter(Boolean));
  let added = 0;
  inWindow
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .forEach(v => {
      const k = _vidKey(v.video);
      if (!k || seen.has(k)) return;
      seen.add(k);
      const row = {
        video: v.video, adCode: v.adCode || '', auth: !!v.adCode,
        date: v.date ? String(v.date).slice(0, 10) : '',
        views: Number(v.views) || 0, revenue: Number(v.revenue) || 0,
        items: Number(v.items) || 0, product: String(v.product || '').trim(),
        thumb: String(v.thumb || '').trim(),
        likes: Number(v.likes) || 0, comments: Number(v.comments) || 0,
        secs: Number(v.secs) || 0,
      };
      const empty = rows.findIndex(r => !String(r.video || '').trim());
      if (empty >= 0) rows[empty] = row; else rows.push(row);
      added += 1;
    });

  const committed = parseDealVideos(c.deal) || 0;
  const filled = rows.filter(r => String(r.video || '').trim()).length;
  const patch = { video_codes: rows };
  let flagChanged = false;
  if (committed > 0 && filled >= committed && c.videos !== 'Done') { patch.videos = 'Done'; flagChanged = true; }
  else if (committed > 0 && filled < committed && c.videos === 'Done') { patch.videos = 'In Progress'; flagChanged = true; }
  if (!added && !removed && !codes && !dated && !metrics && !flagChanged) return null;
  return { patch, added, removed, codes };
}

/* ── Memoized localStorage maps ──────────────────────────────────────
   These are read from RENDER paths (once per creator row, sometimes
   several times), so a naive JSON.parse(localStorage…) per call turns
   into thousands of synchronous parses per render and visibly janks the
   table. Parse once, keep the object, drop the cache only on write. */
function _lsMapReader(key) {
  let cache = null;
  const read = () => {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(key)) || {}; } catch { cache = {}; }
    return cache;
  };
  read.write = (next) => {
    cache = next;
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota full */ }
  };
  return read;
}

/* ── Creator avatars harvested from EUKA video syncs (device-local) ── */
const AVATAR_KEY = 'wurx_avatars_v1';
const getAvatarMap = _lsMapReader(AVATAR_KEY);
function mergeAvatars(map) {
  if (!map) return;
  const cur = { ...getAvatarMap() };
  let changed = false;
  Object.entries(map).forEach(([h, u]) => {
    if (u && !cur[h]) { cur[h] = u; changed = true; }
  });
  if (changed) getAvatarMap.write(cur);
}

/* ── Tier + overall L30 GMV harvested from EUKA video-export rows ──
   Secondary to the DB-persisted `creators.monthly.euka` (written nightly
   by the euka-checkin background sync, which sweeps far more sources).
   This only tops up handles the nightly job hasn't covered yet. */
const VIDPROFILE_KEY = 'wurx_euka_vidprofile_v1';
const getVidProfileMap = _lsMapReader(VIDPROFILE_KEY);
function mergeVidProfile(map) {
  if (!map) return;
  const cur = { ...getVidProfileMap() };
  let changed = false;
  Object.entries(map).forEach(([h, v]) => {
    if (!v) return;
    const c = { ...(cur[h] || {}) };
    if (v.tier && v.tier !== c.tier) { c.tier = v.tier; changed = true; }
    if (v.gmv > 0 && v.gmv !== c.gmv) { c.gmv = v.gmv; changed = true; }
    cur[h] = c;
  });
  if (changed) getVidProfileMap.write(cur);
}

/* Avatar with graceful fallback chain: EUKA pic → unavatar.io → gradient initial.
   `noRemote` skips the unavatar hop. Discovery lists ~100 rows of creators we
   have never worked with, so none of them have a cached EUKA picture: every
   row fired a third-party request, unavatar rate-limited the burst (429) and
   the rows sat on blank circles. There, the initial is the right answer. */
function CreatorFace({ handle, name, size = 34, noRemote }) {
  const h = _normEukaHandle(handle);
  const euka = h ? getAvatarMap()[h] : '';
  const [stage, setStage] = useState(0);   // 0 euka · 1 unavatar · 2 initial
  const src = stage === 0 && euka ? euka
    : (!noRemote && stage <= 1 && h ? `https://unavatar.io/tiktok/${h}?fallback=false` : null);
  if (!src || stage >= 2) {
    return (
      <span className="pc-face" style={{ width: size, height: size, background: gradFor(name || h || '?'), fontSize: size * 0.42 }}>
        {(name || h || '?')[0].toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className="pc-face"
      src={src}
      alt=""
      loading="lazy"
      style={{ width: size, height: size }}
      onError={() => setStage(s => (s === 0 && euka ? 1 : 2))}
    />
  );
}

/* ── Brands excluded from EUKA video auto-sync (shared) ── */
const EUKA_SYNC_EXCLUDE = new Set(['flywell', 'vidgepets']);

/* ── Brand photos harvested from EUKA (top product photo · closest thing
   the API exposes to a store logo) · device-local cache ── */
const BRANDPHOTO_KEY = 'wurx_brandphotos_v2';   // v2 · sample-request fallback for brands with no videos yet
const getBrandPhotoMap = _lsMapReader(BRANDPHOTO_KEY);
function mergeBrandPhoto(storeName, url) {
  if (!storeName || !url) return;
  const key = _normEukaBrand(storeName);
  const cur = getBrandPhotoMap();
  if (cur[key] === url) return;
  getBrandPhotoMap.write({ ...cur, [key]: url });
}
/* one shared stores fetch per session + one photo fetch per store */
let _eukaStoresPromise = null;
function getEukaStores() {
  if (!_eukaStoresPromise) {
    _eukaStoresPromise = eukaJson()
      .then(d => (d && d.stores) || [])
      .catch(() => []);
  }
  return _eukaStoresPromise;
}
/* WURX-ADDED · one SHARED promise per store, not a 'has it started' flag.
   It was a Set: the first BrandFace to mount added the store id and every
   later one saw it and returned, having never read the result. Whichever
   mounted second kept its gradient initial until a full page reload — and
   opening a brand mounts a second face for the same store while the list's
   fetch is still in the air, so the drilldown's logo was the one that lost.
   Sharing the promise means every face awaits the same call and all of them
   get the answer. */
const _brandPhotoPromise = new Map();

/* Drop-in for the pc-ava brand initial · shows the EUKA brand photo when
   available, falls back to the gradient initial. Same markup shape, so all
   contextual pc-ava sizing keeps working. */
function BrandFace({ brand }) {
  const [photo, setPhoto] = useState('');
  const [err, setErr] = useState(false);
  /* WURX-ADDED · a face for a brand EUKA has no store for.
     Rashid, 2026-09-23: "can we have a photo (dp) of the brand as well like we
     have of other brands", about Irwin Naturals, which sells through Reacher.
     Their lookup below asks Euka for the store's photo and gives up when there
     is no store; ours is the fallback, never the first choice, so every brand
     Euka does describe keeps exactly the picture it has today. */
  const wxOurPhoto = wxAdsHook().brandPhotos.get(String(brand || '').trim().toLowerCase()) || '';
  /* WURX-END */
  useEffect(() => {
    let alive = true;
    setErr(false);
    (async () => {
      const stores = await getEukaStores();
      const store = eukaStoreForBrand(stores, brand);
      if (!store || !alive) return;
      const key = _normEukaBrand(store.name);
      const cached = getBrandPhotoMap()[key];
      if (cached) { setPhoto(cached); return; }
      let pending = _brandPhotoPromise.get(store.id);
      if (!pending) {
        pending = eukaJson({ store: store.id, type: 'photo' });
        _brandPhotoPromise.set(store.id, pending);
      }
      const d = await pending;
      if (d && d.photo) { mergeBrandPhoto(store.name, d.photo); if (alive) setPhoto(d.photo); }
    })();
    return () => { alive = false; };
  }, [brand]);
  /* WURX-ADDED · ours only when Euka has nothing, or when Euka's own image
     fails to load — a broken URL and no URL are the same thing to a reader. */
  const wxSrc = (photo && !err) ? photo : wxOurPhoto;
  if (wxSrc) {
    return (
      <span className="pc-ava pc-ava-photo">
        <img src={wxSrc} alt="" loading="lazy" onError={() => setErr(true)} data-wx-photo={wxSrc === wxOurPhoto ? 'ours' : 'euka'} />
      </span>
    );
  }
  /* WURX-END */
  return <span className="pc-ava" style={{ background: gradFor(brand) }}>{initial(brand)}</span>;
}

function BrandDrilldown({ brand, creators, brandCreators, allCreators, budgets, refetchBudgets, month, allTime, eukaL30, currentUser, onBack, onSelectCreator, canEdit, canAdd, canDeleteBrand, onAddCreator, onEditCreator, onDeleteBrand, onSetCreatorStatus, onUpdateCreator, onDeleteCreator }) {
  /* WURX-ADDED · tell our ad figures which month is on screen.

     THIS IS THE WHOLE REASON THE COLUMNS MATCH THE ROW THEY SIT IN. Everything
     else on this screen — the budget, the allocation, the GMV — is filtered by
     the month selector above, so an ad spend summed over all time would be a
     different period sitting in the same line of numbers, inviting a
     comparison that is not valid. 'All Time' sends '' and means no bounds.

     ONE COMPONENT OWNS THIS because only one brand drilldown is ever open, so
     a single period is enough and every row and video panel below inherits it
     without a prop being threaded through them. */
  const wxSetMonth = wxAdsHook().setMonth;
  const wxAdsB = wxAdsHook(); /* WURX-ADDED · for the Top videos ad spend total */
  useEffect(() => {
    wxSetMonth(allTime ? '' : (month || ''));
  }, [wxSetMonth, allTime, month]);
  /* WURX-END */
  /* ── EUKA posted-videos sync · pulls this brand's creator_videos export,
     matches handles to onboarded creators, merges NEW links into each
     creator's video_codes (existing rows never touched · dedupe by video id).
     Spark code lands in adCode with auth=true. ── */
  const [vidSync, setVidSync] = useState({ state: 'idle', msg: '' });
  const [contractEditC, setContractEditC] = useState(null);   // creator being contract-edited

  /* ══ Per-brand insights · scoped signals for THIS brand ══ */
  const brandInsights = useMemo(() => {
    const out = [];
    const now = shopNow();
    const viewingCurrent = !allTime && month === currentMonthKey();
    let daysLeft = 0;
    if (viewingCurrent) {
      const [yy, mm] = month.split('-').map(Number);
      daysLeft = new Date(yy, mm, 0).getDate() - now.getDate();
    }
    // budget state · full deployment is the goal
    if (brand.budget > 0) {
      if (brand.usage >= 100 && brand.usage <= 115) out.push({ tone: 'good', text: 'Budget fully deployed' });
      else if (brand.usage > 115) out.push({ tone: 'warn', text: `Over-allocated · ${Math.round(brand.usage)}% of budget` });
      else if (viewingCurrent && daysLeft > 0 && daysLeft <= 7 && brand.remaining > 0)
        out.push({ tone: 'warn', text: `${fmt$Exact(brand.remaining)} left to deploy · ${daysLeft}d` });
    }
    // delivery risk inside this brand
    let closing = 0, ended = 0;
    creators.forEach(cr => {
      const v = parseDealVideos(cr.deal) || 0;
      if (!v) return;
      const w = collabWindowFor(cr.hiring_date);
      if (!w) return;
      if (deliveredVideoCount(cr) >= v) return;
      if (now > w.end) ended += 1;
      else if ((w.end - now) / 86400000 <= 5) closing += 1;
    });
    if (closing) out.push({ tone: 'warn', text: `${closing} creator${closing !== 1 ? 's' : ''} at delivery risk` });
    if (ended)   out.push({ tone: 'danger', text: `${ended} collab${ended !== 1 ? 's' : ''} ended incomplete` });
    // strongest creator here by overall L30
    if (eukaL30) {
      let best = null;
      creators.forEach(cr => {
        const v = eukaL30For(eukaL30, [cr.tiktok_account, cr.tiktok_account_2]);
        if (v != null && v > 0 && (!best || v > best.v)) best = { v, name: cr.name };
      });
      if (best) out.push({ tone: 'good', text: `Top L30: ${best.name} · ${fmt$Exact(Math.round(best.v))}` });
    }
    const rank = { danger: 0, warn: 1, good: 2, info: 3 };
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 4);
  }, [brand, creators, eukaL30, month, allTime]);
  /* WURX-ADDED · WHICH PLATFORM THIS BRAND'S VIDEOS COME FROM.
     Rashid, 2026-09-23: "when we click euka videos it says no store found
     obviously because we are using reacher for Irwin Naturals".

     The button below used to be Euka or nothing. It now follows the brand: Euka
     where Euka has the store, Reacher where Reacher has the shop, and the label
     says which before it is pressed rather than after it fails. Asked once per
     brand, cheaply — `probe` skips the catalogue. */
  const [wxSource, setWxSource] = useState('');
  useEffect(() => {
    let alive = true;
    setWxSource('');
    (async () => {
      const res = await brandSource(brand.brand);
      if (alive && res) setWxSource(res.source);
    })();
    return () => { alive = false; };
  }, [brand.brand]);

  /* Reacher's equivalent of the Euka sweep: the same job — this brand's posted
     videos, filed onto the creators they belong to — done by the function that
     already does it every fifteen minutes. */
  const syncReacherVideos = async () => {
    if (vidSync.state === 'busy') return;
    const flash = (state, msg, detail) => {
      setVidSync({ state, msg, detail: detail || '' });
      setTimeout(() => setVidSync({ state: 'idle', msg: '', detail: '' }), detail ? 22000 : 7000);
    };
    setVidSync({ state: 'busy', msg: 'Asking Reacher…' });
    const res = await runReacherSync();
    if (!res.ok) { flash('err', 'Reacher sync failed', res.message); return; }
    const bits = [];
    if (res.videosFiled) bits.push(`+${res.videosFiled} video${res.videosFiled === 1 ? '' : 's'}`);
    if (res.creatorsMatched) bits.push(`${res.creatorsMatched} creator${res.creatorsMatched === 1 ? '' : 's'}`);
    if (res.spendWritten) bits.push(`+${res.spendWritten} ad figure${res.spendWritten === 1 ? '' : 's'}`);
    /* "Nothing new" is the usual answer, because the scheduled run got there
       first. Say that rather than nothing, or the button looks broken.
       NO COUNT HERE. It used to read "Already up to date · 207 videos", and
       Rashid asked what 207 was — fairly, because it is every video Reacher
       holds for the whole shop, not this brand's filed videos and not anything
       that just happened. A number nobody can act on, sitting where a result
       belongs, only invites that question. */
    flash('done', bits.length ? bits.join(' · ') : 'Already up to date', res.note || '');
    if (res.videosFiled) window.location.reload();
  };
  /* WURX-END */

  const syncEukaVideos = async () => {
    if (vidSync.state === 'busy') return;
    setVidSync({ state: 'busy', msg: 'Finding store…' });
    /* Seven seconds is enough for "Already up to date" and nowhere near enough
       to read why something failed, so a failure stays up three times as long
       and carries its explanation beside the button rather than inside it. */
    const flash = (state, msg, detail) => {
      setVidSync({ state, msg, detail: detail || '' });
      setTimeout(() => setVidSync({ state: 'idle', msg: '', detail: '' }), detail ? 22000 : 7000);
    };
    try {
      const meta = await eukaJson();
      /* THESE ARE TWO DIFFERENT FAULTS AND THEY USED TO READ THE SAME.
         `meta` is null when the CALL failed — blocked, signed out, not
         allowed, EUKA down. Only once it comes back can "this brand has no
         store" mean anything. Saying the second when the first happened is
         what sent people hunting through store names. */
      if (!meta) {
        const f = lastEukaFailure();
        const err = new Error("Can't reach EUKA");
        err.detail = f
          ? (f.status ? `${f.status} · ` : '') + f.hint + '. Try: ' + f.fix + '.'
          : 'The request failed and gave no reason.';
        throw err;
      }
      const store = eukaStoreForBrand(meta.stores, brand.brand);
      if (!store) {
        const err = new Error('No store for this brand');
        const names = (meta.stores || []).map(st => st.name).filter(Boolean);
        err.detail = `EUKA answered, but none of its stores is called "${brand.brand}". `
          + (names.length ? 'It has: ' + names.slice(0, 12).join(', ') + '.' : 'It returned no stores at all.');
        throw err;
      }

      // Full backfill from the brand's earliest onboarding · EUKA caps each
      // export at ~60 days, so we sweep ≤55-day windows and merge.
      const hireDates = creators.map(c => c.hiring_date).filter(Boolean).sort();
      const windows = eukaVideoWindows(hireDates[0] || '');

      const byHandle = {};
      for (let i = 0; i < windows.length; i++) {
        setVidSync({ state: 'busy', msg: `Fetching videos… (${i + 1}/${windows.length})` });
        const w = windows[i];
        const d = await eukaJson({ store: store.id, type: 'videos', from: w.from, to: w.to });
        if (!d || !d.videos) continue;   // empty/old window → keep sweeping
        mergeAvatars(d.avatars);
        mergeVidProfile(d.tiers);
        if (d.brandPhoto) mergeBrandPhoto(store.name, d.brandPhoto);
        Object.entries(d.videos).forEach(([h, vids]) => {
          (byHandle[h] = byHandle[h] || []).push(...vids);
        });
      }
      if (!Object.keys(byHandle).length) { flash('done', 'No posted videos yet'); return; }

      setVidSync({ state: 'busy', msg: 'Matching creators…' });
      let added = 0, removed = 0, codes = 0, touched = 0;
      for (const c of creators) {
        const hs = [c.tiktok_account, c.tiktok_account_2].map(_normEukaHandle).filter(Boolean);
        const vids = hs.flatMap(h => byHandle[h] || []);
        const res = buildEukaVideoPatch(c, vids);
        if (!res) continue;
        await onUpdateCreator(c.id, res.patch);
        added += res.added; removed += res.removed; codes += res.codes || 0; touched += 1;
      }
      const bits = [];
      if (added) bits.push(`+${added} video${added !== 1 ? 's' : ''}`);
      if (codes) bits.push(`+${codes} ad code${codes !== 1 ? 's' : ''}`);
      if (removed) bits.push(`−${removed} off-timeline`);
      flash('done', bits.length ? `${bits.join(' · ')} · ${touched} creator${touched !== 1 ? 's' : ''}` : 'Already up to date');
    } catch (e) {
      flash('err', e?.message || 'Sync failed', e?.detail);
    }
  };
  const [showBudget, setShowBudget] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showBrandContract, setShowBrandContract] = useState(false);
  /* repaint the dot on the button when the terms are saved from the modal */
  const [bcRev, setBcRev] = useState(0);
  useEffect(() => {
    const on = () => setBcRev(v => v + 1);
    window.addEventListener('wurx-brand-contracts', on);
    return () => window.removeEventListener('wurx-brand-contracts', on);
  }, []);
  const brandContractOn = useMemo(() => {
    const bc = getBrandContract(brand.brand, month);
    return !!(bc && (Object.keys(bc.fields || {}).length || Object.keys(bc.custom || {}).length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.brand, month, bcRev]);
  const [videosCreatorId, setVideosCreatorId] = useState(null);  // store ID so popup re-reads live data on every render
  const [expandedId, setExpandedId] = useState(null);            // inline row expansion (EUKA-style video sub-table)
  // Look up the LIVE creator data from props each render · so saves reflect immediately and refresh shows persisted values
  const videosCreator = videosCreatorId ? creators.find(c => c.id === videosCreatorId) : null;

  const notesHas = !!(brand.notes || '').trim();
  const products = brand.focusProducts || [];

  // Brand-aware status setter · fallback to internal supabase if no prop supplied
  const setStatus = async (id, patch) => {
    if (onSetCreatorStatus) return onSetCreatorStatus(id, patch);
    try { await supabase.from('creators').update(patch).eq('id', id); }
    catch (e) { alert('Could not update: ' + e.message); }
  };

  /* WURX-ADDED · deals per person in the month on screen, across every brand.
     This screen's `month` is already '' when All Time is on, which counts the lot. */
  const wxDealsNow = useMemo(() => wxDealsByPerson(allCreators || brandCreators || creators, month), [allCreators, brandCreators, creators, month]);
  /* WURX-END */
  const sortedCreators = useMemo(() => [...creators].sort((a, b) => (a.hiring_date || '').localeCompare(b.hiring_date || '')), [creators]);

  /* WURX-ADDED · SEARCHING AND FILTERING ONE BRAND'S LIST.
     Rashid, 2026-09-23: "we need to let users search the creators there should
     be search and filter functionality without disturbing ui".

     IT NARROWS THE TABLE AND NOTHING ELSE. The five cards and the top-videos
     totals describe the brand's month, not the rows you happen to be looking
     at, and a budget that moved when you typed a name would be a different
     number every time somebody searched. The count beside the search box says
     how many of the month's creators are showing, so a narrowed list can never
     be mistaken for the whole one. */
  const [wxSearch, setWxSearch] = useState('');
  const [wxFilterOpen, setWxFilterOpen] = useState(false);
  const [wxStatusF, setWxStatusF] = useState(null);
  const [wxHiredByF, setWxHiredByF] = useState(null);
  const [wxTierF, setWxTierF] = useState(null);
  const [wxDeliveryF, setWxDeliveryF] = useState(null);
  const wxFilterRef = useRef(null);
  const wxActiveFilters = [wxStatusF, wxHiredByF, wxTierF, wxDeliveryF].filter(Boolean).length;
  const wxResetFilters = () => { setWxStatusF(null); setWxHiredByF(null); setWxTierF(null); setWxDeliveryF(null); };

  /* Close on a click outside or Escape, like their own filter popover. */
  useEffect(() => {
    if (!wxFilterOpen) return;
    const onDown = (e) => { if (wxFilterRef.current && !wxFilterRef.current.contains(e.target)) setWxFilterOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setWxFilterOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [wxFilterOpen]);

  /* One lower-cased haystack per row, built once. Searching rebuilds nothing. */
  const wxSearchable = useMemo(() => {
    const m = new Map();
    sortedCreators.forEach((c) => {
      m.set(c.id, [c.name, c.tiktok_account, c.tiktok_account_2, c.category, c.product, c.deal, c.hired_by]
        .map((v) => String(v || '')).join(' ').toLowerCase());
    });
    return m;
  }, [sortedCreators]);

  /* Delivery, the question a brand page is actually for: who still owes videos.
     `completed` here is the row's own rule — the status flag OR delivery having
     reached the commitment — so the filter and the progress bar can never
     disagree. */
  const wxDeliveryOf = (c) => {
    const want = parseDealVideos(c.deal);
    const got = deliveredVideoCount(c);
    if (c.videos === 'Done' || (want > 0 && got >= want)) return 'complete';
    return 'outstanding';
  };

  /* Only the values this brand-month really contains get a chip. A filter for
     somebody who is not on this brand is a dead end you can click. */
  const wxHiredByOptions = useMemo(() => {
    const t = new Map();
    sortedCreators.forEach((c) => {
      const k = String(c.hired_by || '').trim();
      if (k) t.set(k, (t.get(k) || 0) + 1);
    });
    return [...t.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [sortedCreators]);

  const wxTierOptions = useMemo(() => {
    const t = new Map();
    sortedCreators.forEach((c) => {
      const k = creatorTier(c, eukaL30) || 'none';
      t.set(k, (t.get(k) || 0) + 1);
    });
    return [...t.entries()].sort((a, b) => (a[0] === 'none' ? 1 : b[0] === 'none' ? -1 : a[0].localeCompare(b[0])));
  }, [sortedCreators, eukaL30]);

  const wxStatusCounts = useMemo(() => {
    const t = new Map();
    sortedCreators.forEach((c) => t.set(statusOf(c), (t.get(statusOf(c)) || 0) + 1));
    return t;
  }, [sortedCreators]);

  const wxDeliveryCounts = useMemo(() => {
    const t = new Map();
    sortedCreators.forEach((c) => { const k = wxDeliveryOf(c); t.set(k, (t.get(k) || 0) + 1); });
    return t;
  }, [sortedCreators]);

  const wxVisible = useMemo(() => {
    let list = sortedCreators;
    if (wxStatusF) list = list.filter((c) => statusOf(c) === wxStatusF);
    if (wxHiredByF) list = list.filter((c) => String(c.hired_by || '').trim() === wxHiredByF);
    if (wxTierF) list = list.filter((c) => (creatorTier(c, eukaL30) || 'none') === wxTierF);
    if (wxDeliveryF) list = list.filter((c) => wxDeliveryOf(c) === wxDeliveryF);
    const q = wxSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => (wxSearchable.get(c.id) || '').includes(q));
  }, [sortedCreators, wxSearch, wxStatusF, wxHiredByF, wxTierF, wxDeliveryF, wxSearchable, eukaL30]);

  const wxNarrowed = wxVisible.length !== sortedCreators.length;
  /* WURX-END */

  const groups = useMemo(() => groupByStatus(wxVisible), [wxVisible]);

  /* WURX-ADDED · PRODUCT BANDS INSIDE EACH STATUS SECTION.
     Rashid's mockup keeps the Payment Pending / In Progress / Payment Sent
     dividers exactly where they are and puts the product groups underneath
     them, which is the right way round: the payment state is how this team
     works the list, and the product is how they read it. */
  const wxProdPics = wxUseProductPics(brand.brand);
  const wxKnownProds = useMemo(() => wxKnownProducts(sortedCreators), [sortedCreators]);
  const wxPlaced = useMemo(() => {
    const m = new Map();
    sortedCreators.forEach((c) => m.set(c.id, wxCreatorProduct(c, wxKnownProds)));
    return m;
  }, [sortedCreators, wxKnownProds]);
  const wxProdRank = useMemo(() => wxProductOrder(sortedCreators), [sortedCreators]);

  /* GROUP ONLY WHEN THERE IS SOMETHING TO GROUP BY. Fifteen of the brands on
     dev carry no product on any video and none on any creator; wrapping those
     in a single "No product recorded" band would be pure furniture, so they
     keep the flat list they have today. One product is the same case: a lone
     band around the whole table tells nobody anything. */
  const wxBandProducts = useMemo(() => {
    const keys = new Set();
    wxVisible.forEach((c) => { const pl = wxPlaced.get(c.id); if (pl && pl.key) keys.add(pl.key); });
    return keys.size >= 2;
  }, [wxVisible, wxPlaced]);

  const [wxShut, setWxShut] = useState(() => new Set());
  /* The row number is the row's PLACE IN THE LIST, so it is handed out here, in
     reading order, once the bands are known. Collapsing a band still consumes
     its numbers — #14 must not become #9 because somebody folded a group.

     EACH BAND FOLDS ALONE, hence `uid`. The same product appears once under
     every payment status it has creators in — Dr Tobias's Colon Cleanse is a
     band under all three — and keying the collapsed set on the product alone
     meant folding the one you clicked also folded its twins further down the
     page. Thirteen rows vanished for a click that promised nine. */
  const wxTable = useMemo(() => {
    let n = 0;
    return groups.map((g) => {
      const bands = wxBandProducts
        ? wxSplitByProduct(g.items, wxPlaced, wxProdRank)
        : [{ key: '\u0000flat', name: '', flat: true, items: g.items }];
      return {
        ...g,
        bands: bands.map((b) => ({
          ...b,
          uid: `${g.key}::${b.key}`,
          rows: b.items.map((c) => ({ c, n: ++n })),
        })),
      };
    });
  }, [groups, wxBandProducts, wxPlaced, wxProdRank]);

  const wxAllBandKeys = useMemo(() => {
    const keys = [];
    wxTable.forEach((g) => g.bands.forEach((b) => { if (!b.flat) keys.push(b.uid); }));
    return keys;
  }, [wxTable]);
  /* WURX-END */

  return (
    <>
      <button className="pc-back" onClick={onBack} style={{ marginTop: 14 }}>‹ All brands</button>

      <div className="pc-ddhero">
        <div className="pc-ddhero-top">
        <BrandFace brand={brand.brand} />
        <div className="pc-dd-info">
          <h2 className="pc-dd-title">{brand.brand}</h2>
          <div className="pc-dd-sub">{allTime ? 'All time' : monthLabel(month)}</div>
        </div>
        <div className="pc-dd-links">
          {brand.contentGuideUrl
            ? <a className="pc-link-chip set" href={brand.contentGuideUrl} target="_blank" rel="noreferrer">Content guide ↗</a>
            : canEdit && <button className="pc-link-chip" onClick={() => setShowBudget(true)}>+ Content guide</button>}
          {products.length > 0
            ? products.map((p, i) => (p.name || p.url) ? (
                <a key={i} className="pc-link-chip pc-chip-orange" href={p.url || undefined} target="_blank" rel="noreferrer">
                  {p.name || `Focus product ${i + 1}`} ↗
                </a>
              ) : null)
            : canEdit && <button className="pc-link-chip" onClick={() => setShowBudget(true)}>+ Focus product</button>}
        </div>
        <div className="pc-dd-actions">
          {canEdit && (
            /* WURX-ADJUSTED · the button follows the brand's platform. */
            <button
              className={`pc-btn pc-btn-sm pc-btn-ghost pc-vidsync ${vidSync.state}`}
              onClick={wxSource === 'reacher' ? syncReacherVideos : syncEukaVideos}
              disabled={vidSync.state === 'busy'}
              data-wx-source={wxSource || 'unknown'}
              title={wxSource === 'reacher'
                ? "Fetch this brand's posted videos from Reacher now (it also runs by itself every 15 minutes)"
                : "Fetch this brand's posted videos from EUKA now (also runs automatically every 6 hours) · only videos inside each creator's collab window count"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" />
              </svg>
              {vidSync.state === 'idle' ? (wxSource === 'reacher' ? 'Reacher videos' : 'EUKA videos')
                : vidSync.state === 'busy' ? (vidSync.msg || 'Syncing…')
                : vidSync.msg}
            </button>
          )}
          <button className={`pc-btn pc-btn-sm ${notesHas ? 'pc-btn-accentlight' : 'pc-btn-ghost'}`} onClick={() => setShowNotes(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="8" y1="13" x2="16" y2="13" />
              <line x1="8" y1="17" x2="13" y2="17" />
            </svg>
            Notes{notesHas ? ' •' : ''}
          </button>
          {canEdit && (
            <button className={`pc-btn pc-btn-sm ${brandContractOn ? 'pc-btn-accentlight' : 'pc-btn-ghost'}`}
              onClick={() => setShowBrandContract(true)}
              disabled={allTime || !month}
              title={allTime || !month
                ? 'Pick a month first · a contract covers one cycle'
                : 'Terms every creator added this month inherits'}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12h6M9 16h4" />
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Contract{brandContractOn ? ' •' : ''}
            </button>
          )}
          {canEdit && (
            <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => setShowBudget(true)}>Edit budget</button>
          )}
          {canAdd && (
            <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={() => onAddCreator && onAddCreator(brand.brand)}>+ Creator</button>
          )}
          {canDeleteBrand && (
            <button className="pc-iconbtn pc-iconbtn-danger" title="Delete brand" aria-label="Delete brand" onClick={() => onDeleteBrand && onDeleteBrand(brand.brand)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          )}
        </div>
        </div>{/* /pc-ddhero-top */}

        {/* WHY it failed, where there is room for a sentence. The button can
            only hold three words, and "No EUKA store named X" in three words
            is what sent people hunting through store names for an hour. */}
        {vidSync.state === 'err' && vidSync.detail && (
          <div className="pc-euka-why" role="status">
            <b>{vidSync.msg}</b>
            <span>{vidSync.detail}</span>
          </div>
        )}

      </div>{/* /pc-ddhero */}

      {/* ── same cards as the Brands tab top strip · identical component ── */}
      <div className="pc-kpis pc-kpis-5" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <KpiSub label="Budget"       color="#1259C3" value={brand.budget > 0 ? fmt$Exact(brand.budget) : '-'}
          sub={brand.budget > 0 ? `${Math.round(brand.usage)}% used` : 'not set'}
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><circle cx="12" cy="14" r="1.5"/></svg>
          } />
        <KpiSub label="Allocated"    color="#8B5CF6" value={fmt$Exact(brand.allocated)}
          sub={`${brand.creators} creator${brand.creators === 1 ? '' : 's'}`}
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          } />
        <KpiSub label="Paid"         color="#2E7D32" value={fmt$Exact(brand.paid)}
          sub={`${brand.allocated > 0 ? Math.round((brand.paid / brand.allocated) * 100) : 0}% paid out`}
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          } />
        <KpiSub label="Videos"       color="#0EA5E9" value={`${brand.videosDone}/${brand.videos}`}
          sub={`${brand.videos > 0 ? Math.round((brand.videosDone / brand.videos) * 100) : 0}% completed`}
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          } />
        <KpiSub label="Cost / Video" color="#E65100" value={brand.costPerVideo > 0 ? fmt$Exact(Math.round(brand.costPerVideo)) : '-'}
          sub="per delivered video"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="12" x2="12" y2="12"/><line x1="8" y1="16" x2="14" y2="16"/></svg>
          } />
      </div>

      {/* ── EUKA-style top videos strip · this brand's best performers ── */}
      {(() => {
        const tops = creators
          .flatMap(c => (Array.isArray(c.video_codes) ? c.video_codes : [])
            .filter(r => r && String(r.video || '').trim() && Number(r.revenue) > 0)
            .map(r => ({ ...r, name: c.name })))
          .sort((a, b) => Number(b.revenue) - Number(a.revenue))
          .slice(0, 10);
        if (!tops.length) return null;
        /*
         * WURX-ADDED · THREE TOTALS: VIEWS, GMV AND AD SPEND.
         *
         * Rashid, 2026-09-16, for his boss, in place of the single New video
         * GMV total: "3 vertical mini cards ... the sum of views (in blue), GMV
         * (green) and ad spend (red)", for the month when a month is chosen and
         * for all time under All Time. They cover every row in the table below,
         * which is already scoped exactly that way.
         *
         * EACH VIDEO IS COUNTED ONCE. On dev the same TikTok video sits under two
         * deals of one creator 32 times inside a single brand-month (84 across
         * months), and adding the columns would count its views, its GMV and its
         * ad money twice. So a total can come in under a calculator run down the
         * column, and the card's hover text says by how many videos. Where two
         * rows carry different synced figures for one video the larger is kept:
         * views and GMV only grow, so the larger is the newer sync.
         *
         * Ad spend is Euka's, from the same reader and for the same period as the
         * Ad spend column. No Euka data is a dash, never $0, and two currencies
         * are never added together.
         *
         * The counting lives in wxVideoTotals, shared with the Brands screen's
         * New Video GMV card, so that card is always these cards added up.
         */
        const wxVT = wxVideoTotals(sortedCreators);
        const wxDupes = wxVT.dupes;
        const wxAll = wxVT.all;
        const wxViews = wxVT.views;
        const wxGmv = Math.round(wxVT.gmv);
        const wxIdsAll = wxAll.map((v) => v.id).filter(Boolean);
        wxAdsB.ensure(wxIdsAll);
        const wxSpend = wxTotals(wxAdsB.get, wxIdsAll);
        const wxPeriod = allTime ? 'all time' : monthLabel(month);
        const wxOnce = wxDupes ? ` · ${wxDupes} video${wxDupes === 1 ? '' : 's'} listed under two deals, counted once` : '';
        const wxVidsIn = `${wxAll.length} video${wxAll.length === 1 ? '' : 's'} in the table below · ${wxPeriod}${wxOnce}`;
        const wxSpendState = wxSpend.withData
          ? (wxSpend.mixedCurrency ? 'mixed' : 'ok')
          : ((!wxAdsB.ready || wxAdsB.loading) && wxIdsAll.length ? 'pending' : (wxAdsB.error ? 'error' : 'none'));
        const wxSpendText = { ok: wxMoney(wxSpend.cost, wxSpend.currency), mixed: 'Mixed', pending: '…', error: '–', none: '–' }[wxSpendState];
        const wxSpendTitle = {
          ok: `Euka ad spend on ${wxSpend.withData} of ${wxIdsAll.length} videos in the table below · ${wxPeriod}${wxOnce}`,
          mixed: 'These videos were paid for in more than one currency, so they are not added together',
          pending: 'Loading ad spend from Euka',
          error: `Ad spend could not be loaded: ${wxAdsB.error}`,
          none: `Euka has no ad spend for these videos · ${wxPeriod}`,
        }[wxSpendState];
        /* WURX-END */
        return (
          <div className="pc-topvids">
            <div className="pc-topvids-head">
              Top videos by GMV · {allTime ? 'All time' : monthLabel(month)}
              {/* WURX-ADJUSTED · name the platform this brand really sells on. */}
              <span className="pc-topvids-sub">{wxSource === 'reacher' ? 'live from Reacher' : 'live from EUKA'}</span>
            </div>
            <div className="pc-topvids-body">
            <div className="pc-topvids-row">
              {tops.map((v, i) => (
                <a key={i} className="pc-topvid" href={v.video} target="_blank" rel="noreferrer" title={`${v.name} · ${fmt$Exact(Math.round(v.revenue))} GMV · open on TikTok`}>
                  <span className="pc-topvid-frame">
                    {/* WURX-ADDED · falls back to the placeholder rather than
                        a broken-image icon. WURX-END */}
                    <WxVideoThumb src={v.thumb} className="pc-topvid-thumb"
                      phClassName="pc-topvid-thumb pc-topvid-ph" />
                    <span className="pc-topvid-rank">#{i + 1}</span>
                    <span className="pc-topvid-gmv">{fmt$Exact(Math.round(v.revenue))}</span>
                  </span>
                  <span className="pc-topvid-name">{v.name}</span>
                  <span className="pc-topvid-views">{Number(v.views) > 0 ? `${kNum(v.views)} views` : ' '}</span>
                </a>
              ))}
            </div>
            {/* WURX-ADDED · views, GMV and ad spend for the period, stacked */}
            <div className="pc-topvids-totalwrap">
              <div className="pc-topvids-stats" aria-label={`Totals for ${wxPeriod}`}>
                <div className="pc-topvids-stat views" data-value={wxViews} title={`${wxViews.toLocaleString()} views across ${wxVidsIn}`}>
                  <span className="pc-topvids-stat-ico" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  </span>
                  <span className="pc-topvids-stat-lbl">Views</span>
                  <span className={`pc-topvids-stat-val${wxViews > 0 ? '' : ' none'}`}>{wxViews > 0 ? kNum(wxViews) : '–'}</span>
                </div>
                <div className="pc-topvids-stat gmv" data-value={wxGmv} title={`${fmt$Exact(wxGmv)} new video GMV across ${wxVidsIn}`}>
                  <span className="pc-topvids-stat-ico" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
                  </span>
                  <span className="pc-topvids-stat-lbl">GMV</span>
                  <span className="pc-topvids-stat-val">{fmt$Exact(wxGmv)}</span>
                </div>
                <div className="pc-topvids-stat spend" data-state={wxSpendState} data-value={wxSpendState === 'ok' ? wxSpend.cost.toFixed(2) : ''} title={wxSpendTitle}>
                  <span className="pc-topvids-stat-ico" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>
                  </span>
                  <span className="pc-topvids-stat-lbl">Ad spend</span>
                  <span className={`pc-topvids-stat-val${wxSpendState === 'ok' ? '' : ' none'}`}>{wxSpendText}</span>
                </div>
              </div>
            </div>
            {/* WURX-END */}
            </div>
          </div>
        );
      })()}

      {/* WURX-ADDED · BY PRODUCT, for the month on screen.
          Rashid, 2026-09-24: "product wise gmv, product wise creators and
          product wise videos ... a beautifully iconed and pilled style display
          without disturbing the ui ... for the current month that user
          selected".

          It reads the same `sortedCreators` the table below does, so it is
          scoped to the same month by construction rather than by a second
          filter that could drift from it, and `wxProductTotals` counts each
          video once with the same rule as the GMV card above — so the pills add
          up to that card instead of quietly exceeding it. */}
      <ProductBand creators={sortedCreators} brand={brand.brand} period={allTime ? 'All time' : monthLabel(month)} />

      {/* WURX-ADDED · search and filter for this brand's creators. Their own
          toolbar shape, the one the Brands screen and the Creators tab already
          use, so this row is not a new piece of furniture. */}
      {sortedCreators.length > 0 && (
        <div className="pc-toolbar" style={{ marginTop: 14 }}>
          <SearchBox value={wxSearch} onChange={setWxSearch} placeholder="Search name, handle, category, product…" />

          <div ref={wxFilterRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setWxFilterOpen((o) => !o)}
              title="Filter this brand's creators"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                height: 36, padding: '0 14px', borderRadius: 999,
                background: wxFilterOpen || wxActiveFilters > 0 ? 'var(--pc-accent-light)' : 'var(--pc-card-2)',
                color: wxFilterOpen || wxActiveFilters > 0 ? 'var(--pc-accent)' : 'var(--pc-text-2)',
                border: `1px solid ${wxActiveFilters > 0 ? 'color-mix(in srgb, var(--pc-accent) 30%, transparent)' : 'var(--pc-divider)'}`,
                fontSize: 12.5, fontWeight: 700, letterSpacing: '-0.1px',
                cursor: 'pointer', transition: 'background .15s, color .15s, border-color .15s', lineHeight: 1,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filter
              {wxActiveFilters > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 18, height: 18, padding: '0 6px', borderRadius: 99,
                  background: 'var(--pc-accent)', color: 'var(--wx-on-accent)',
                  fontSize: 10.5, fontWeight: 800, lineHeight: 1,
                }}>{wxActiveFilters}</span>
              )}
            </button>

            {wxFilterOpen && (() => {
              const pill = (active) => ({
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 28, padding: '0 12px', borderRadius: 8,
                fontSize: 11.5, fontWeight: 600, letterSpacing: '-0.05px',
                cursor: 'pointer', lineHeight: 1, fontFamily: 'inherit',
                transition: 'background .12s, color .12s, border-color .12s',
                background: active ? 'var(--wx-text)' : 'transparent',
                color: active ? 'var(--wx-text-inverse)' : 'var(--pc-text-2)',
                border: `1px solid ${active ? 'var(--wx-text)' : 'var(--pc-divider)'}`,
              });
              const sectionTitle = {
                fontSize: 10, fontWeight: 700, color: 'var(--pc-text-3)',
                textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8,
              };
              const section = { marginBottom: 14 };
              const row = { display: 'flex', flexWrap: 'wrap', gap: 5 };
              const count = (n) => (n == null ? null : <span style={{ opacity: 0.55, fontWeight: 700 }}>{n}</span>);
              const Chips = ({ options, value, onPick }) => (
                <div style={row}>
                  {options.map((o) => (
                    <button key={o.key ?? 'all'} type="button" onClick={() => onPick(o.key)} style={pill(value === o.key)}>
                      {o.label}{count(o.n)}
                    </button>
                  ))}
                </div>
              );

              return (
                <div data-wx="brand-filters" style={{
                  position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                  width: 320, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
                  background: 'var(--pc-card)', border: '1px solid var(--pc-divider)',
                  borderRadius: 12, padding: '16px 16px 14px', zIndex: 100,
                  boxShadow: '0 18px 50px rgba(15,23,42,0.10), 0 4px 12px rgba(15,23,42,0.05)',
                  animation: 'pc-rise .18s var(--pc-ease)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--pc-divider)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pc-text)', letterSpacing: '-0.15px' }}>Filters</div>
                    {wxActiveFilters > 0 && (
                      <button type="button" onClick={wxResetFilters}
                        style={{ background: 'transparent', border: 0, color: 'var(--pc-text-3)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '2px 6px', borderRadius: 6 }}>
                        Reset all
                      </button>
                    )}
                  </div>

                  <div style={section}>
                    <div style={sectionTitle}>Payment status</div>
                    <Chips
                      value={wxStatusF}
                      onPick={setWxStatusF}
                      options={[
                        { key: null, label: 'All' },
                        { key: 'pending', label: 'Payment Pending', n: wxStatusCounts.get('pending') || 0 },
                        { key: 'progress', label: 'Videos in Progress', n: wxStatusCounts.get('progress') || 0 },
                        { key: 'sent', label: 'Payment Sent', n: wxStatusCounts.get('sent') || 0 },
                      ]}
                    />
                  </div>

                  <div style={section}>
                    <div style={sectionTitle}>Videos</div>
                    <Chips
                      value={wxDeliveryF}
                      onPick={setWxDeliveryF}
                      options={[
                        { key: null, label: 'All' },
                        { key: 'outstanding', label: 'Still owed', n: wxDeliveryCounts.get('outstanding') || 0 },
                        { key: 'complete', label: 'Delivered in full', n: wxDeliveryCounts.get('complete') || 0 },
                      ]}
                    />
                  </div>

                  {wxHiredByOptions.length > 0 && (
                    <div style={section}>
                      <div style={sectionTitle}>Hired by</div>
                      <Chips
                        value={wxHiredByF}
                        onPick={setWxHiredByF}
                        options={[{ key: null, label: 'All' }, ...wxHiredByOptions.map(([name, n]) => ({ key: name, label: name, n }))]}
                      />
                    </div>
                  )}

                  {wxTierOptions.length > 1 && (
                    <div style={{ marginBottom: 2 }}>
                      <div style={sectionTitle}>EUKA tier</div>
                      <Chips
                        value={wxTierF}
                        onPick={setWxTierF}
                        options={[
                          { key: null, label: 'All' },
                          ...wxTierOptions.map(([t, n]) => ({ key: t, label: t === 'none' ? 'No tier yet' : t.toUpperCase(), n })),
                        ]}
                      />
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* How many of the month's creators are showing. A narrowed list must
              never be mistaken for the whole one. */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px',
            borderRadius: 999, background: 'var(--pc-card-2)', color: 'var(--pc-text-2)',
            fontSize: 12.5, fontWeight: 700, letterSpacing: '-0.1px', border: '1px solid var(--pc-divider)',
          }}>
            {wxNarrowed
              ? `${wxVisible.length} of ${sortedCreators.length} creators`
              : `${sortedCreators.length} creator${sortedCreators.length === 1 ? '' : 's'}`}
          </span>
        </div>
      )}
      {/* WURX-END */}

      {sortedCreators.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <span className="pc-empty-ico" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg>
          </span>
          <h3>No creators in {monthLabel(month)}</h3>
          <p>Onboard a creator for this brand & month.</p>
          {canAdd && <button className="pc-btn-primary" style={{ marginTop: 16 }} onClick={() => onAddCreator && onAddCreator(brand.brand)}>+ Add creator</button>}
        </div></div>
      ) : wxVisible.length === 0 ? (
        /* WURX-ADDED · the search and filters excluded everybody. Say which,
           and offer the way back, rather than showing an empty table. */
        <div className="pc-card"><div className="pc-empty">
          <span className="pc-empty-ico" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          </span>
          <h3>No creators match</h3>
          <p>
            {wxSearch.trim() ? <>Nothing here matches &ldquo;{wxSearch.trim()}&rdquo;</> : 'No creator on this brand matches those filters'}
            {wxSearch.trim() && wxActiveFilters > 0 ? ' with those filters' : ''}. {sortedCreators.length} creator{sortedCreators.length === 1 ? '' : 's'} on {monthLabel(month)}.
          </p>
          <button className="pc-btn-primary" style={{ marginTop: 16 }} onClick={() => { setWxSearch(''); wxResetFilters(); }}>
            Clear search and filters
          </button>
        </div></div>
      ) : (
        <div className="pc-card">
          <div className="pc-ct-head">
            <div className="pc-num">#</div>
            <div>Completed on</div>
            <div>Creator</div>
            <div className="pc-num">Deal</div>
            <div className="pc-num">Videos</div>
            <div className="pc-num">Total views</div>
            <div className="pc-num">New video GMV</div>
            <div className="pc-num">L30 GMV</div>
            <div className="pc-num">Items sold</div>
            {/* WURX-ADDED · from OUR TikTok ads data, summed over this
                creator's DISTINCT delivered videos. */}
            <div className="pc-num">Ad spend</div>
            <div className="pc-num">ROI</div>
            {/* WURX-END */}
            <div>Contract</div>
            <div>Status</div>
            <div>Actions</div>
          </div>
          {/* WURX-ADDED · the same rows, read out of `wxTable` so the product
              bands and the flat list share one renderer and one numbering. */}
          {wxTable.map((g) => {
            // Show divider above every group (including the first) when there's
            // more than one status to separate. Single-status lists stay clean.
            const showDivider = wxTable.length > 1;
            const creatorRow = ({ c, n }) => (
              <React.Fragment key={c.id}>
                <DrilldownCreatorRow
                  c={c}
                  idx={n}
                  euka={eukaL30}
                  deals={wxDealsNow.get(wxPersonKey(c)) || 0}
                  dealsMonth={month}
                  open={expandedId === c.id}
                  onSelect={() => setExpandedId(id => (id === c.id ? null : c.id))}
                  onSetStatus={setStatus}
                  onEditContract={() => setContractEditC(c)}
                  onView={() => setVideosCreatorId(c.id)}
                  onEditCreator={onEditCreator ? () => onEditCreator(c) : null}
                  onDelete={onDeleteCreator && isAsadActor() ? () => onDeleteCreator(c.id).catch(() => {}) : null}
                />
                {expandedId === c.id && (
                  <DrilldownVideosPanel
                    c={c}
                    euka={eukaL30}
                    allTime={allTime}
                    siblings={brandCreators || creators}
                    onUpdateCreator={onUpdateCreator}
                    onManage={() => setVideosCreatorId(c.id)}
                  />
                )}
              </React.Fragment>
            );
            return (
              <React.Fragment key={g.key}>
                {showDivider && (
                  <div className={`pc-ct-divider pc-ct-divider-${g.key}`} aria-hidden>
                    <span className="pc-ct-divider-line" />
                    <span className="pc-ct-divider-label">
                      {g.label}
                      <span className="pc-ct-divider-count">{g.items.length}</span>
                    </span>
                    <span className="pc-ct-divider-line" />
                  </div>
                )}
                {g.bands.map((b) => {
                  if (b.flat) return <React.Fragment key={b.key}>{b.rows.map(creatorRow)}</React.Fragment>;
                  const shut = wxShut.has(b.uid);
                  const named = !!b.name;
                  /* How many of these people ALSO posted for another product.
                     Said out loud, because the alternative is a reader assuming
                     this band is everything that creator did. */
                  const also = b.rows.filter(({ c }) => ((wxPlaced.get(c.id) || {}).alsoOn || 0) > 0).length;
                  const label = named ? b.name : 'No product recorded';
                  return (
                    <section
                      className={`wx-pgroup${shut ? ' is-shut' : ''}`}
                      key={b.uid}
                      data-wx="product-group"
                      data-product={named ? b.name : ''}
                      data-count={b.rows.length}
                    >
                      <div className="wx-pgroup-head">
                        <button
                          type="button"
                          className="wx-pgroup-toggle"
                          aria-expanded={!shut}
                          title={`${label} · ${b.rows.length} creator${b.rows.length === 1 ? '' : 's'} in ${g.label}${also > 0 ? `, ${also} of whom also posted for another product` : ''}. Each creator is listed once, under the product most of their videos are for.`}
                          onClick={() => setWxShut((prev) => {
                            const next = new Set(prev);
                            if (next.has(b.uid)) next.delete(b.uid); else next.add(b.uid);
                            return next;
                          })}
                        >
                          <span className="wx-pgroup-chev" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                          </span>
                          <span className="wx-pgroup-shot">
                            <ProductTile
                              product={{ name: label, image: named && wxProdPics ? (wxProdPics.get(b.key) || '') : '' }}
                              size={34}
                            />
                          </span>
                          {/* Shortened the SAME WAY the band above shortens it,
                              and in the middle rather than at the end: five of
                              NUTRAHARMONY's products begin "NUTRA HARMONY" and
                              an end-clip makes every band read alike. */}
                          <span className={`wx-pgroup-name${named ? '' : ' is-none'}`}>
                            {named ? wxShortProduct(b.name, 58) : label}
                          </span>
                          <span className="wx-pgroup-count">
                            {b.rows.length} creator{b.rows.length === 1 ? '' : 's'}
                          </span>
                          {also > 0 && (
                            <span className="wx-pgroup-also">
                              {also} also posted elsewhere
                            </span>
                          )}
                        </button>
                        <WxGroupMenu
                          onExpandAll={() => setWxShut(new Set())}
                          onCollapseAll={() => setWxShut(new Set(wxAllBandKeys))}
                        />
                      </div>
                      {!shut && (
                        <div className="wx-pgroup-rows">
                          {b.rows.map((r) => <div className="wx-prow" key={r.c.id}>{creatorRow(r)}</div>)}
                        </div>
                      )}
                    </section>
                  );
                })}
              </React.Fragment>
            );
          })}
          {/* WURX-END */}
        </div>
      )}

      {showBudget && (
        <BudgetEditor
          brand={brand.brand}
          month={month || currentMonthKey()}
          currentBudget={brand.budget}
          currentRecord={brand.budgetRecord}
          contentGuideUrl={brand.contentGuideUrl}
          focusProducts={brand.focusProducts || []}
          onSaved={refetchBudgets}
          onClose={() => setShowBudget(false)}
        />
      )}
      {showBrandContract && (
        <BrandContractModal
          brand={brand.brand}
          month={month}
          monthLabel={monthLabel(month)}
          creators={brandCreators || creators}
          currentUser={currentUser}
          onClose={() => setShowBrandContract(false)}
        />
      )}

      {showNotes && (
        <NotesDrawer
          brand={brand.brand}
          month={month || currentMonthKey()}
          initial={brand.notes || ''}
          onSaved={refetchBudgets}
          onClose={() => setShowNotes(false)}
        />
      )}
      {videosCreator && (
        <CreatorVideosPopup
          creator={videosCreator}
          onUpdateCreator={onUpdateCreator}
          onEdit={onEditCreator ? () => { onEditCreator(videosCreator); setVideosCreatorId(null); } : null}
          onClose={() => setVideosCreatorId(null)}
        />
      )}
      {contractEditC && (
        <ContractEditModal creator={contractEditC} onClose={() => setContractEditC(null)} />
      )}
    </>
  );
}

/* Creator row inside Brand Drilldown · Afflix .pc-ct-row pattern */
/* ════════ CONTRACT EDITOR · fully-customizable per-creator contract ════════
   Fields (names, counts, payment, dates, signer) regenerate the section
   texts live. Any section can be hand-edited — it then freezes as "custom"
   until reset. Everything persists per creator in localStorage, so edits
   survive reopening. Download renders exactly what's on screen. */
const CONTRACT_EDITS_KEY = 'wurx_contract_edits_v1';
function loadContractEdits() {
  try { return JSON.parse(localStorage.getItem(CONTRACT_EDITS_KEY)) || {}; } catch { return {}; }
}
function saveContractEdits(creatorId, data) {
  const all = loadContractEdits();
  if (data) all[creatorId] = data; else delete all[creatorId];
  try { localStorage.setItem(CONTRACT_EDITS_KEY, JSON.stringify(all)); } catch { /* full */ }
}

/* ════════════════════════════════════════════════════════════════
   BrandContractModal · terms set once, inherited by the whole brand

   Only the fields you deliberately switch on are saved. A field left
   off is not written at all, so each creator keeps deriving it from
   their own deal · which is why "Videos" and "Payment" are not offered
   here: those belong to the individual agreement, never to the brand.
   ════════════════════════════════════════════════════════════════ */
const BRAND_CONTRACT_FIELDS = [
  ['paymentMethod', 'Payment method', 'PayPal', 'text'],
  ['paymentProvider', 'Payment provider', 'EUKA', 'text'],
  ['periodStart', 'Period start', '', 'date'],
  ['periodEnd', 'Period end', '', 'date'],
  ['cycleClose', 'Payment cycle closes', '', 'date'],
  ['signerName', 'Brand signer', 'Aris', 'text'],
];

/* Contracts read dates as long prose ("August 2, 2026") but a date field
   is the only sane way to pick one. These convert between the two so the
   picker stays a picker and the document keeps its wording.
   Effective date is deliberately not offered at brand level: it is the
   day a particular creator's agreement starts, so a single brand-wide
   value would be wrong for everyone but the first signing. */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
function longToISO(v) {
  const t = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return '';
  const mi = MONTH_NAMES.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
  if (mi < 0) return '';
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}
function isoToLong(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(v || '');
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function BrandContractModal({ brand, month, monthLabel, creators, currentUser, onClose }) {
  const existing = useMemo(() => getBrandContract(brand, month) || {}, [brand, month]);
  const [fields, setFields] = useState(() => ({ ...(existing.fields || {}) }));
  const [custom, setCustom] = useState(() => ({ ...(existing.custom || {}) }));
  const [tab, setTab] = useState('terms');
  const [editIdx, setEditIdx] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const on = (k) => Object.prototype.hasOwnProperty.call(fields, k);
  const toggle = (k, dflt) => setFields(prev => {
    const next = { ...prev };
    if (Object.prototype.hasOwnProperty.call(next, k)) delete next[k];
    else next[k] = dflt;
    return next;
  });
  const setVal = (k, v) => setFields(prev => ({ ...prev, [k]: v }));

  /* The creators of this brand in THIS month. A contract carries period
     dates, so it belongs to one cycle · applying it to every month would
     stamp these dates onto creators hired long before or after. */
  const list = useMemo(
    () => creators.filter(c => (c.brand || '').trim() === brand
      && monthKey(c.hiring_date) === month),
    [creators, brand, month]);

  /* How many carry a personal edit today. Saving overrules those for the
     fields this brand fixes, so the number is context rather than a
     limit. */
  const reach = useMemo(() => {
    const edits = loadContractEdits();
    let touched = 0;
    list.forEach(c => {
      const e = edits[c.id];
      if (e && e.fields && Object.keys(e.fields).length) touched += 1;
    });
    return { total: list.length, touched };
  }, [list]);

  const activeKeys = Object.keys(fields);
  const sectionCount = Object.keys(custom).length;

  async function save() {
    setBusy(true);
    try {
      await saveBrandContract(brand, month, { fields, custom }, currentUser);
      /* The brand contract is the authority for whatever it fixes, so a
         creator who had edited one of these fields is brought back onto
         the brand value. Anything the brand does NOT fix is left exactly
         as that creator set it, which is what keeps per-creator editing
         useful. */
      const keys = Object.keys(fields);
      const sects = Object.keys(custom);
      if (keys.length || sects.length) {
        const edits = loadContractEdits();
        list.forEach(c => {
          const e = edits[c.id];
          if (!e) return;
          const f = { ...(e.fields || {}) };
          const cu = { ...(e.custom || {}) };
          keys.forEach(k => { delete f[k]; });
          sects.forEach(k => { delete cu[k]; });
          const empty = !Object.keys(f).length && !Object.keys(cu).length;
          saveContractEdits(c.id, empty ? null : { fields: f, custom: cu });
        });
      }
      setMsg({ tone: 'good', text: `Saved. ${list.length} creator${list.length === 1 ? '' : 's'} on ${brand} in ${monthLabel} now use these terms.` });
      setTimeout(() => onClose(), 1400);
    } catch (e) {
      setMsg({ tone: 'bad', text: 'Could not save: ' + (e.message || 'unknown error') });
      setBusy(false);
    }
  }
  async function clearAll() {
    setBusy(true);
    try {
      await saveBrandContract(brand, month, { fields: {}, custom: {} }, currentUser);
      setFields({}); setCustom({});
      setMsg({ tone: 'good', text: 'Brand contract cleared. Creators fall back to their own terms.' });
      setBusy(false);
    } catch (e) { setMsg({ tone: 'bad', text: 'Could not clear: ' + (e.message || '') }); setBusy(false); }
  }

  /* preview text uses a stand-in creator so the wording reads naturally */
  const previewFields = useMemo(() => {
    const sample = list[0];
    const base = defaultContractFields({
      brand,
      name: sample ? (sample.name || 'Creator') : 'Creator',
      username: sample ? tiktokHandle(sample.tiktok_account || '') : '@creator',
      videos: sample ? parseDealVideos(sample.deal) : 5,
      amount: sample ? parseDealAmount(sample.deal) : 250,
      hiringDate: sample ? sample.hiring_date : '',
    });
    return { ...base, ...fields };
  }, [brand, list, fields]);

  return (
    <div className="bc-root" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bc-box">
        <div className="bc-top">
          <span className="bc-badge">GLOBAL</span>
          <div className="bc-ttl">
            <b>{brand} contract</b>
            <small>{monthLabel} cycle · every creator added this month inherits it</small>
          </div>
          <button className="bc-x" onClick={onClose} title="Close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="bc-reach">
          <span>Applies to <b>{reach.total}</b> creator{reach.total === 1 ? '' : 's'} added in {monthLabel}</span>
          {reach.touched > 0 && (
            <span className="bc-note">
              {reach.touched} {reach.touched === 1 ? 'has an' : 'have'} edited contract{reach.touched === 1 ? '' : 's'} · saving overrules them on these fields
            </span>
          )}
        </div>

        <div className="bc-tabs">
          <button className={'bc-tab' + (tab === 'terms' ? ' on' : '')} onClick={() => setTab('terms')}>
            Terms{activeKeys.length > 0 && <i>{activeKeys.length}</i>}
          </button>
          <button className={'bc-tab' + (tab === 'text' ? ' on' : '')} onClick={() => setTab('text')}>
            Clauses{sectionCount > 0 && <i>{sectionCount}</i>}
          </button>
        </div>

        <div className="bc-body">
          {tab === 'terms' && (
            <>
              <p className="bc-lead">
                Switch on only what this cycle fixes. Saving pushes those values onto the{' '}
                {reach.total} creator{reach.total === 1 ? '' : 's'} added to {brand} in {monthLabel}.
                Anything left off keeps coming from each creator's own deal, and you can still
                edit any single creator afterwards.
              </p>
              {BRAND_CONTRACT_FIELDS.map(([k, label, dflt, type]) => {
                const isDate = type === 'date';
                const fallback = isDate ? isoToLong(new Date().toISOString().slice(0, 10)) : dflt;
                return (
                  <div key={k} className={'bc-field' + (on(k) ? ' on' : '')}>
                    <button className={'bc-switch' + (on(k) ? ' on' : '')} onClick={() => toggle(k, fallback)}><i /></button>
                    <div className="bc-f-l">
                      <b>{label}</b>
                      {!on(k) && <small>from each creator's deal</small>}
                    </div>
                    {on(k) && (isDate ? (
                      <span className="bc-datewrap">
                        <input className="bc-input bc-date" type="date"
                          value={longToISO(fields[k])}
                          onChange={e => setVal(k, e.target.value ? isoToLong(e.target.value) : '')} />
                        <em>{fields[k] || 'pick a date'}</em>
                      </span>
                    ) : (
                      <input className="bc-input" value={fields[k]} placeholder={dflt}
                        onChange={e => setVal(k, e.target.value)} />
                    ))}
                  </div>
                );
              })}
            </>
          )}

          {tab === 'text' && (
            <>
              <p className="bc-lead">
                Rewrite a clause for the whole brand. An untouched clause still generates
                itself from each creator's own figures.
              </p>
              {CONTRACT_SECTIONS.map((d, i) => {
                const isCustom = custom[i] != null;
                const body = isCustom ? custom[i] : d.tmpl(previewFields);
                return (
                  <div key={i} className={'bc-sec' + (isCustom ? ' on' : '')}>
                    <div className="bc-sec-h">
                      <b>{d.title}</b>
                      {isCustom && <span className="bc-tag">brand wording</span>}
                      <span className="bc-sec-a">
                        {editIdx === i ? (
                          <button onClick={() => setEditIdx(null)}>Done</button>
                        ) : (
                          <button onClick={() => { setEditIdx(i); if (!isCustom) setCustom(p2 => ({ ...p2, [i]: body })); }}>Edit</button>
                        )}
                        {isCustom && (
                          <button className="bad" onClick={() => {
                            setCustom(p2 => { const nx = { ...p2 }; delete nx[i]; return nx; });
                            if (editIdx === i) setEditIdx(null);
                          }}>Reset</button>
                        )}
                      </span>
                    </div>
                    {editIdx === i ? (
                      <textarea className="bc-area" value={custom[i] != null ? custom[i] : body}
                        onChange={e => setCustom(p2 => ({ ...p2, [i]: e.target.value }))} />
                    ) : (
                      <p className="bc-sec-b">{body}</p>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="bc-foot">
          {msg && <span className={'bc-msg ' + msg.tone}>{msg.text}</span>}
          <span className="bc-spacer" />
          {(activeKeys.length > 0 || sectionCount > 0) && (
            <button className="bc-btn" disabled={busy} onClick={clearAll}>Clear brand contract</button>
          )}
          <button className="bc-btn" onClick={onClose}>Cancel</button>
          <button className="bc-btn primary" disabled={busy} onClick={save}>
            {busy ? 'Saving...' : 'Save for ' + brand}
          </button>
        </div>
      </div>
    </div>
  );
}

const CONTRACT_FIELD_DEFS = [
  ['brand', 'Brand'], ['creatorName', 'Creator name'], ['username', 'TikTok username'],
  ['videos', 'Videos (count)'], ['amount', 'Payment (USD)'],
  ['paymentMethod', 'Payment method'], ['paymentProvider', 'Payment provider'],
  ['effectiveDate', 'Effective date'], ['periodStart', 'Period start'],
  ['periodEnd', 'Period end'], ['cycleClose', 'Payment cycle closes'],
  ['signerName', 'Brand signer (signature)'],
];

function ContractEditModal({ creator: c, onClose }) {
  const info = useMemo(() => ({
    brand: c.brand,
    name: c.name || '-',
    username: (c.tiktok_account ? tiktokHandle(c.tiktok_account) : '') || (c.tiktok_account_2 ? tiktokHandle(c.tiktok_account_2) : ''),
    videos: parseDealVideos(c.deal),
    amount: parseDealAmount(c.deal),
    hiringDate: c.hiring_date,
  }), [c]);

  const saved = useMemo(() => loadContractEdits()[c.id] || null, [c.id]);
  /* Base terms, then whatever the brand has set, then this creator's own
     edits. A creator who has never been touched therefore picks up the
     brand contract automatically, and one who has been edited keeps what
     was set for them. */
  /* a creator inherits the contract of the month they were hired in */
  const hireMonth = monthKey(c.hiring_date);
  const merged = useMemo(
    () => mergeContract(defaultContractFields(info), c.brand, hireMonth, saved),
    [info, c.brand, hireMonth, saved]);
  /* the brand terms can be saved from another panel while this is open */
  useEffect(() => {
    const on = () => {
      const m = mergeContract(defaultContractFields(info), c.brand, hireMonth, loadContractEdits()[c.id] || null);
      setFields(m.fields);
      setCustom(m.custom);
    };
    window.addEventListener('wurx-brand-contracts', on);
    return () => window.removeEventListener('wurx-brand-contracts', on);
  }, [c.id, c.brand, hireMonth, info]);
  const [fields, setFields] = useState(() => merged.fields);
  const [custom, setCustom] = useState(() => merged.custom);
  const brandKeys = useMemo(() => Object.keys(merged.fromBrand || {}), [merged]);
  const [editIdx, setEditIdx] = useState(null);                      // section in edit mode
  const setField = (k, v) => setFields(prev => ({ ...prev, [k]: v }));

  /* inline **bold** → <b> for the rendered document view */
  const inlineBold = (text) => String(text).split('**').map((part, i) =>
    i % 2 === 1 ? <b key={i}>{part}</b> : <React.Fragment key={i}>{part}</React.Fragment>);

  /* body text → real document markup (what the PDF will look like) */
  const renderPreview = (body) => String(body || '').split('\n').map((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return <div key={i} className="pc-cf-gap" />;
    if (line.startsWith('-- ')) return (
      <div key={i} className="pc-cf-li sub"><span className="pc-cf-dot">◦</span><span>{inlineBold(line.slice(3))}</span></div>
    );
    if (line.startsWith('- ')) return (
      <div key={i} className="pc-cf-li"><span className="pc-cf-dot">•</span><span>{inlineBold(line.slice(2))}</span></div>
    );
    return <p key={i} className="pc-cf-p">{inlineBold(line)}</p>;
  });

  /* One-shot focus on open (inline refs re-run every render — guard!).
     Sizing is pure CSS now: a proper large scrollable editor. */
  const focusInit = (el) => {
    if (!el || el.dataset.cfInit) return;
    el.dataset.cfInit = '1';
    el.focus();
    const n = el.value.length;
    el.setSelectionRange(n, n);
  };

  // Live sections · custom text wins, otherwise regenerated from fields
  const sections = useMemo(() =>
    CONTRACT_SECTIONS.map((d, i) => ({
      title: d.title,
      body: custom[i] != null ? custom[i] : d.tmpl(fields),
      isCustom: custom[i] != null,
    })), [fields, custom]);

  /* Persist ONLY what this creator genuinely differs on.
     This used to write the whole merged object the moment the editor
     opened, which quietly gave every creator a full personal snapshot
     and made the brand contract unable to ever reach them again. Storing
     a diff means an untouched creator keeps following the brand, and a
     later change to the brand terms still lands on them. */
  useEffect(() => {
    const baseline = mergeContract(defaultContractFields(info), c.brand, hireMonth, null);
    const fDiff = {};
    Object.keys(fields).forEach(k => {
      if (String(fields[k] ?? '') !== String(baseline.fields[k] ?? '')) fDiff[k] = fields[k];
    });
    const cDiff = {};
    Object.keys(custom).forEach(i => {
      const inherited = baseline.custom[i] != null
        ? baseline.custom[i]
        : CONTRACT_SECTIONS[i].tmpl(baseline.fields);
      if (String(custom[i]) !== String(inherited)) cDiff[i] = custom[i];
    });
    const empty = !Object.keys(fDiff).length && !Object.keys(cDiff).length;
    saveContractEdits(c.id, empty ? null : { fields: fDiff, custom: cDiff });
  }, [c.id, c.brand, hireMonth, info, fields, custom]);

  const resetAll = () => {
    saveContractEdits(c.id, null);
    /* back to "no personal edits" · which still means the brand terms,
       not the bare defaults, otherwise a reset would silently opt this
       creator out of the brand contract */
    const m = mergeContract(defaultContractFields(info), c.brand, hireMonth, null);
    setFields(m.fields);
    setCustom(m.custom);
  };

  return (
    <div className="pc-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pc-modal pc-contract-modal">

        {/* ── Sticky header band ── */}
        <div className="pc-cf-head">
          <span className="pc-cf-headicon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="8" y1="13" x2="16" y2="13" />
              <line x1="8" y1="17" x2="13" y2="17" />
            </svg>
          </span>
          <div className="pc-cf-headtext">
            <h3>Contract editor</h3>
            <div className="pc-cf-headsub">{fields.creatorName || 'Creator'} <span>×</span> {fields.brand || 'Brand'}</div>
          </div>
          <span className="pc-cf-saved"><span className="pc-cf-saveddot" />Auto-saves</span>
          <button className="pc-cf-x" onClick={onClose} aria-label="Close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="pc-cf-body">
          {/* ── Left · details panel (grouped) ── */}
          <aside className="pc-cf-side">
            {[
              ['Brand', ['brand', 'creatorName', 'username']],
              ['Deal', ['videos', 'amount', 'paymentMethod', 'paymentProvider']],
              ['Dates', ['effectiveDate', 'periodStart', 'periodEnd', 'cycleClose']],
              ['Signature', ['signerName']],
            ].map(([group, keys]) => (
              <div className="pc-cf-group" key={group}>
                <div className="pc-cf-sidetitle"><span>{group}</span></div>
                {keys.map(key => {
                  const label = (CONTRACT_FIELD_DEFS.find(d => d[0] === key) || [])[1] || key;
                  return (
                    <div className="pc-field pc-cf-field" key={key}>
                      <label>{label}</label>
                      <input
                        className="pc-input"
                        type={key === 'videos' || key === 'amount' ? 'number' : 'text'}
                        inputMode={key === 'videos' || key === 'amount' ? 'numeric' : undefined}
                        value={fields[key] ?? ''}
                        onChange={e => setField(key, (key === 'videos' || key === 'amount') ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value)}
                        onWheel={e => e.currentTarget.blur()}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="pc-cf-sidehint">
              Details rewrite <b>auto</b> sections instantly · hand-edited sections freeze as <b>custom</b>.
            </div>
          </aside>

          {/* ── Right · the document itself ── */}
          <div className="pc-cf-paper">
            <div className="pc-cf-papertitle">CONTENT CREATION AGREEMENT</div>
            <div className="pc-cf-papermeta">
              <span><b>Brand:</b> {fields.brand || '-'}</span>
              <span><b>Creator:</b> {fields.creatorName || '-'}</span>
              <span><b>Effective:</b> {fields.effectiveDate || '-'}</span>
            </div>
            {sections.map((s, i) => (
              <div className={`pc-cf-section ${editIdx === i ? 'editing' : ''}`} key={i}>
                <div className="pc-cf-sectitle">
                  <span className="pc-cf-secnum">{i + 1}</span>
                  <span className="pc-cf-secname">{s.title.replace(/^\d+\.\s*/, '')}</span>
                  {s.isCustom && (
                    <button type="button" className="pc-cf-secreset" onClick={() => setCustom(prev => { const n = { ...prev }; delete n[i]; return n; })} title="Back to auto-generated text">
                      custom · reset
                    </button>
                  )}
                  {editIdx === i && <span className="pc-cf-editing-pill">editing</span>}
                </div>
                {editIdx === i ? (
                  <div className="pc-cf-editor">
                    <textarea
                      className="pc-cf-text"
                      value={s.body}
                      ref={focusInit}
                      onChange={e => setCustom(prev => ({ ...prev, [i]: e.target.value }))}
                      /* guarded close · if a mousedown already moved editing to
                         another section, this stale blur must NOT clobber it */
                      onBlur={() => setEditIdx(prev => (prev === i ? null : prev))}
                      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditIdx(null); } }}
                      spellCheck={false}
                    />
                    <div className="pc-cf-editbar">
                      <span className="pc-cf-edithint">"- " bullet · "-- " sub-bullet · **bold**</span>
                      <button type="button" className="pc-cf-donebtn" onMouseDown={e => e.preventDefault()} onClick={() => setEditIdx(null)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="pc-cf-read"
                    /* mousedown (not click) · fires BEFORE the open editor's
                       blur, so switching sections works in one tap */
                    onMouseDown={e => { e.preventDefault(); setEditIdx(i); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter') setEditIdx(i); }}
                    title="Click to edit this section"
                  >
                    {renderPreview(s.body)}
                    <span className="pc-cf-editcue">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                      edit
                    </span>
                  </div>
                )}
              </div>
            ))}
            <div className="pc-cf-sig">
              <div><b>Brand Representative</b> · signs as <i>{fields.signerName || '-'}</i> · {fields.effectiveDate}</div>
              <div><b>Creator</b> · @{fields.username || '-'} · signature on paper</div>
            </div>
          </div>
        </div>

        {/* ── Sticky footer ── */}
        <div className="pc-cf-foot">
          <button className="pc-btn pc-modal-del" onClick={resetAll} title="Discard every edit and regenerate from the creator's data">Reset all</button>
          <div className="pc-cf-foot-spacer" />
          <button className="pc-btn pc-btn-ghost" onClick={onClose}>Close</button>
          <button
            className="pc-btn pc-btn-primary"
            onClick={() => { renderContractPdf(fields, sections); markContractDl(c.id); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}

/* Contract download tracking · device-local map creatorId → ISO timestamp.
   Drives the little green "sent" dot on the PDF chip. */
const CONTRACT_DL_KEY = 'wurx_contract_dl_v1';
function getContractDlMap() {
  try { return JSON.parse(localStorage.getItem(CONTRACT_DL_KEY)) || {}; } catch { return {}; }
}
function markContractDl(id) {
  const m = getContractDlMap();
  m[id] = new Date().toISOString();
  try { localStorage.setItem(CONTRACT_DL_KEY, JSON.stringify(m)); } catch { /* storage full/blocked */ }
}

function DrilldownCreatorRow({ c, idx, euka, deals, dealsMonth, open, onSelect, onSetStatus, onEditContract, onView, onEditCreator, onDelete }) {
  const amount = parseDealAmount(c.deal);
  const videoCount = parseDealVideos(c.deal);
  const filled = deliveredVideoCount(c);
  // "Completed" = status flag OR actual delivery hit the commitment
  const completed = c.videos === 'Done' || (videoCount > 0 && filled >= videoCount);
  const handle1 = c.tiktok_account ? tiktokHandle(c.tiktok_account) : '';
  const handle2 = c.tiktok_account_2 ? tiktokHandle(c.tiktok_account_2) : '';
  const url1 = c.tiktok_account ? tiktokUrl(c.tiktok_account) : null;
  const [contractDl, setContractDl] = useState(() => !!getContractDlMap()[c.id]);

  const profile = eukaProfileFor(euka, [c.tiktok_account, c.tiktok_account_2]);
  const tier = creatorTier(c, euka);
  /* WURX-ADDED · our ad figures for this creator's videos.

     DEDUPED BY TIKTOK VIDEO ID, which is about money rather than tidiness:
     the same link can sit in video_codes twice after a bulk paste, and adding
     its cost twice would inflate a brand's real ad spend.

     ROI is revenue over cost computed from the SUMS, never an average of the
     per-video ratios. A ratio cannot be summed; only this version agrees with
     what TikTok itself reports. */
  const wxAds = wxAdsHook();
  const wxIds = wxVideoIds(c.video_codes);
  wxAds.ensure(wxIds);
  const wxT = wxTotals(wxAds.get, wxIds);
  const wxNote = wxT.withData && wxT.withData < wxIds.length
    ? ` · from ${wxT.withData} of ${wxIds.length} videos`
    : '';
  /* WURX-END */

  /* live performance · summed from this collab's synced video rows */
  const vidRows = (Array.isArray(c.video_codes) ? c.video_codes : []).filter(r => r && String(r.video || '').trim());
  const totViews = vidRows.reduce((s, r) => s + (Number(r.views) || 0), 0);
  const newGmv = vidRows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const itemsSold = vidRows.reduce((s, r) => s + (Number(r.items) || 0), 0);

  return (
    <div
      className={`pc-ct-row ${open ? 'open' : ''}`}
      /* WURX-ADDED · data-wx-id, so a guard can tell two ROWS apart.
         `verify:product-groups` proves that grouping by product never lists the
         same row twice, which matters because every row carries that creator's
         money. It keyed on the name, and across a brand's whole history that is
         wrong: one person hired in January and again in July is two legitimate
         rows, and the check read 272 rows / 114 people as a duplication bug.
         The row id is the only exact key, and nobody ever sees it. WURX-END */
      data-wx-id={c.id}
      onClick={onSelect} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onSelect(); }}
    >
      <div className="pc-cell pc-num pc-idxcell" data-label="#"><span className="pc-idx">#{idx}</span></div>
      <div className="pc-cell" data-label="Completed on">
        {(() => {
          if (!completed) return <span className="pc-handle">-</span>;
          /* completion date = posted date of the video that FILLED the
             commitment (the committed-th delivered video, by date) */
          const dates = (Array.isArray(c.video_codes) ? c.video_codes : [])
            .filter(r => r && String(r.video || '').trim() && String(r.date || '').trim())
            .map(r => String(r.date).slice(0, 10))
            .sort();
          if (!dates.length) return <span className="pc-handle">-</span>;
          const idx = videoCount > 0 ? Math.min(videoCount, dates.length) - 1 : dates.length - 1;
          return formatHireDate(dates[idx]);
        })()}
      </div>
      <div className="pc-cell" data-label="Creator">
        <span className="pc-creatorcell">
          {/* WURX-ADDED */}<span className="pc-facewrap"><CreatorFace handle={handle1 || handle2} name={c.name} /><DealsBadge n={deals} month={dealsMonth} /></span>{/* WURX-END */}
          <span className="pc-creatorcell-txt">
            <span className="pc-cname">{c.name || '-'}</span>
            {handle1
              ? <a className="pc-handle pc-handle-sub" href={url1} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                  {handle1}{handle2 && <span className="pc-more" title={handle2}> +1</span>}
                  {profile?.followers > 0 && <span className="pc-followers" title={`${profile.followers.toLocaleString()} TikTok followers`}> · {kNum(profile.followers)}</span>}
                </a>
              : <span className="pc-handle pc-handle-sub">-</span>}
          </span>
          {tier && <span className={`pc-tierbadge ${String(tier).toLowerCase()}`} title={`EUKA creator tier ${tier}`}>{tier}</span>}
          <HiredByTag who={c.hired_by} />
        </span>
      </div>
      <div className="pc-cell pc-num" data-label="Deal" title={c.deal || ''}>
        {amount > 0
          ? <span className="pc-money">
              {fmt$Exact(amount)}
              {videoCount > 0 && <span className="pc-deal-per"> · {fmt$Exact(Math.round(amount / videoCount))}/vid</span>}
            </span>
          : <span className="pc-handle">-</span>}
      </div>
      <div className="pc-cell pc-num" data-label="Videos">
        {videoCount > 0 ? (
          <div className="pc-vidprog">
            <span className="pc-vidprog-n" style={filled >= videoCount ? { color: 'var(--wx-success)' } : undefined}>
              {filled}<span className="pc-vidprog-of">/{videoCount}</span>
              {(() => {
                /* delivery-risk intelligence · collab window closing or closed */
                if (filled >= videoCount) return null;
                const w = collabWindowFor(c.hiring_date);
                if (!w) return null;
                const now = shopNow();
                const daysLeft = (w.end - now) / 86400000;
                if (now > w.end) return <span className="pc-risk-dot late" title={`Collab window ended · ${videoCount - filled} video${videoCount - filled !== 1 ? 's' : ''} short`} />;
                if (daysLeft <= 5) return <span className="pc-risk-dot soon" title={`Window closes in ${Math.max(1, Math.ceil(daysLeft))}d · ${videoCount - filled} to go`} />;
                return null;
              })()}
            </span>
            <div className="pc-vidprog-track">
              <div className="pc-vidprog-fill" style={{ width: `${Math.min(100, (filled / videoCount) * 100)}%` }} />
            </div>
          </div>
        ) : (filled || <span className="pc-handle">-</span>)}
      </div>
      <div className="pc-cell pc-num" data-label="Total views">
        {totViews > 0 ? <span className="pc-metric">{kNum(totViews)}</span> : <span className="pc-handle">-</span>}
      </div>
      <div className="pc-cell pc-num" data-label="New video GMV">
        {newGmv > 0 ? <span className="pc-metric pc-metric-gmv">{fmt$Exact(Math.round(newGmv))}</span> : <span className="pc-handle">-</span>}
      </div>
      <div className="pc-cell pc-num" data-label="L30 GMV">
        <EukaL30Cell euka={euka} c={c} handles={[c.tiktok_account, c.tiktok_account_2]} />
      </div>
      <div className="pc-cell pc-num" data-label="Items sold">
        {itemsSold > 0 ? <span className="pc-metric">{kNum(itemsSold)}</span> : <span className="pc-handle">-</span>}
      </div>
      {/* WURX-ADDED · ad spend and ROI for this creator's videos.

          A DASH IS NOT A ZERO. No ad data means we cannot answer, which is a
          different statement from "nothing was spent" — and a wrong zero about
          money is the kind somebody acts on. */}
      <div className="pc-cell pc-num wx-collab-figure" data-label="Ad spend"
        title={wxT.withData
          ? 'Ad spend across this creator\'s videos' + wxNote
          : (wxIds.length ? 'No ad data for these videos' : 'No TikTok video links yet')}>
        {/* In red, like the Ad spend card above the table (Rashid,
            2026-09-21). Only a figure is red; the dash stays grey. */}
        {wxT.withData && !wxT.mixedCurrency
          ? <span className="pc-metric wx-metric-spend">{wxMoney(wxT.cost, wxT.currency)}</span>
          : <span className="pc-handle">-</span>}
      </div>
      <div className="pc-cell pc-num wx-collab-figure" data-label="ROI"
        title={wxT.roi === null
          ? 'No ad spend, so there is no return to divide by it'
          : wxMoney(wxT.revenue, wxT.currency) + ' back on ' + wxMoney(wxT.cost, wxT.currency) + wxNote}>
        {wxT.roi === null
          ? <span className="pc-handle">-</span>
          : <span className="pc-metric">{wxRoi(wxT.roi)}</span>}
      </div>
      {/* WURX-END */}
      <div className="pc-cell" data-label="Contract">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <button
            className="pc-contract-btn pc-iconbtn"
            onClick={(e) => {
              e.stopPropagation();
              /* customized contract (if any edits saved) — else default */
              const saved = loadContractEdits()[c.id];
              const info = {
                brand: c.brand, name: c.name || '-',
                username: handle1 || handle2 || '',
                videos: videoCount, amount, hiringDate: c.hiring_date,
              };
              /* Same three-layer merge the editor shows, so the file that
                 downloads is exactly what is on screen · including the
                 brand terms for a creator who was never edited. */
              const m = mergeContract(defaultContractFields(info), c.brand, monthKey(c.hiring_date), saved);
              const hasAny = Object.keys(m.fromBrand || {}).length
                || (saved && (saved.fields || saved.custom));
              if (hasAny) {
                const sections = CONTRACT_SECTIONS.map((d, i) => ({
                  title: d.title,
                  body: m.custom[i] != null ? m.custom[i] : d.tmpl(m.fields),
                }));
                renderContractPdf(m.fields, sections);
              } else {
                generateContractPdf(info);
              }
              markContractDl(c.id);
              setContractDl(true);
            }}
            title={contractDl ? `Contract downloaded · click to download again` : `Download ${c.name || 'creator'}'s contract PDF`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <polyline points="9 15 12 18 15 15" />
            </svg>
            {contractDl && <span className="pc-contract-dot" aria-label="Contract already downloaded" />}
          </button>
          <button
            className="pc-contract-btn pc-iconbtn"
            onClick={(e) => { e.stopPropagation(); onEditContract && onEditContract(); }}
            title="Customize this contract · edit any field or section text, then download"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
        </span>
      </div>
      <div className="pc-cell" data-label="Status"><WurxStatusDropdown c={c} onChange={(patch) => onSetStatus(c.id, patch)} /></div>
      <div className="pc-cell" data-label="Actions">
        <span className="pc-rowactions">
          <button
            className="pc-actbtn"
            title="View videos & ad codes"
            onClick={(e) => { e.stopPropagation(); onView && onView(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          </button>
          {onEditCreator && (
            <button
              className="pc-actbtn"
              title="Edit creator"
              onClick={(e) => { e.stopPropagation(); onEditCreator(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </button>
          )}
          {onDelete && (
            <button
              className="pc-actbtn danger"
              title="Delete creator (Asad only)"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete ${c.name || 'this creator'} from ${c.brand}?\n\nThis removes the creator and all their videos permanently.`)) onDelete();
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

/* ── Inline video expansion · EUKA-style sub-table under a creator row ──
   On expand it lazily pulls creator_video_level from EUKA (items sold +
   thumbnail for EVERY video, not just the top 50) and persists the refresh.
   "Manage videos" opens the full editor popup (add/edit links & codes). */
const _cvidFetched = new Set();   // one live refresh per creator per session
function DrilldownVideosPanel({ c, euka, allTime, siblings, onUpdateCreator, onManage }) {
  /* WURX-ADDED · ad figures for the videos this panel lists. */
  const wxAdsP = wxAdsHook();
  /* The spark code to show for a video: the one saved on this row, else the
     one EUKA holds for the same TikTok video (euka_spark_codes, synced daily
     by euka-ads-sync). Rashid, 2026-09-15: spark codes from Euka too. A code
     saved on the row always wins; Euka only fills a blank. */
  const wxCode = (r) => {
    const own = String((r && r.adCode) || '').trim();
    if (own) return { code: own, expired: false, fromEuka: false };
    const vid = wxVideoId(r && r.video);
    const s = vid ? wxAdsP.spark(vid) : null;
    return s ? { code: s.code, expired: !!s.expired, fromEuka: true } : null;
  };
  /* WURX-END */
  const [copiedIdx, setCopiedIdx] = useState(-1);
  const [live, setLive] = useState(false);
  /*
   * ONE ROW IS ONE COLLAB, and its videos are that collab's month.
   *
   * Erin Cooper has nine Penetrex deals and 88 videos, and every row carries
   * only its own — so in All time she appears nine times and each expansion
   * showed fifteen videos, not eighty-eight. Nothing was filtered or lost;
   * that is simply the shape of the data, and Rashid reasonably read it as a
   * month filter that All time was ignoring.
   *
   * So in ALL TIME the panel gathers the person's videos across every collab
   * they have on THIS brand. Pick a month and it goes back to that one collab,
   * because then the collab is what you asked about.
   *
   * Deduped by video url: the same post can sit on two rows when collab
   * windows overlap, and counting it twice would overstate both the count and
   * the GMV underneath it.
   */
  const merged = useMemo(() => {
    const own = Array.isArray(c.video_codes) ? c.video_codes : [];
    if (!allTime) return { list: own, collabs: 1 };
    const key = (c.name || '').trim().toLowerCase();
    const brand = (c.brand || '').trim();
    if (!key) return { list: own, collabs: 1 };
    const seen = new Set();
    const list = [];
    let collabs = 0;
    (siblings || []).forEach((s2) => {
      if ((s2.name || '').trim().toLowerCase() !== key) return;
      if ((s2.brand || '').trim() !== brand) return;
      collabs += 1;
      (Array.isArray(s2.video_codes) ? s2.video_codes : []).forEach((v) => {
        const u = String((v && v.video) || '').trim();
        if (!u || seen.has(u)) return;
        seen.add(u);
        list.push(v);
      });
    });
    return { list: list.length || collabs ? list : own, collabs: collabs || 1 };
  }, [allTime, siblings, c]);

  const rows = merged.list
    .filter(r => r && String(r.video || '').trim())
    .sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
  /* AFTER `rows`, not before it. Moving this above the merge put a const in
     its own temporal dead zone and the whole panel threw "Cannot access
     before initialization" — the expansion simply stopped opening. */
  wxAdsP.ensure(wxVideoIds(rows));
  const totGmv = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  /* Engagement rate = (likes + comments) / views. Averaged across only the
     videos that actually carry engagement data — EUKA fills likes on ~85%
     of videos and comments on ~45%, so averaging over all rows would
     understate creators whose newest posts haven't been enriched yet. */
  const engRows = rows.filter(r => Number(r.views) > 0 && (Number(r.likes) > 0 || Number(r.comments) > 0));
  const avgEng = engRows.length
    ? engRows.reduce((s, r) => s + ((Number(r.likes) || 0) + (Number(r.comments) || 0)) / Number(r.views), 0) / engRows.length * 100
    : null;
  /* brands with no EUKA store (or excluded from sync) have no live metrics —
     their panel shows a clean manual layout instead of empty EUKA columns */
  const isEuka = !EUKA_SYNC_EXCLUDE.has(_normEukaBrand(c.brand))
    && !!(euka && Array.isArray(euka.stores) && eukaStoreForBrand(euka.stores, c.brand));

  useEffect(() => {
    if (_cvidFetched.has(c.id)) return;
    if (EUKA_SYNC_EXCLUDE.has(_normEukaBrand(c.brand))) return;
    const store = euka && eukaStoreForBrand(euka.stores, c.brand);
    const hs = [c.tiktok_account, c.tiktok_account_2].map(_normEukaHandle).filter(Boolean);
    if (!store || !hs.length) return;
    _cvidFetched.add(c.id);
    const win = collabWindowFor(c.hiring_date);
    if (!win) return;
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = shopNow();
    if (win.start > today) return;
    const from = iso(win.start);
    const to = iso(win.end < today ? win.end : today);
    setLive(true);
    (async () => {
      try {
        const all = [];
        for (const h of hs) {
          const d = await eukaJson({ store: store.id, type: 'cvideos', handle: h, from, to });
          if (d && d.videos) Object.values(d.videos).forEach(v => all.push(...v));
        }
        if (all.length && onUpdateCreator) {
          const res = buildEukaVideoPatch(c, all);
          if (res) await onUpdateCreator(c.id, res.patch);
        }
      } catch { /* live refresh is best-effort */ }
      setLive(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  const copy = async (i, code) => {
    try { await navigator.clipboard.writeText(code); setCopiedIdx(i); setTimeout(() => setCopiedIdx(x => (x === i ? -1 : x)), 1400); } catch {}
  };
  return (
    <div className="pc-vxp" onClick={e => e.stopPropagation()}>
      <div className="pc-vxp-card">
        <div className="pc-vxp-top">
          <span className="pc-vxp-title">
            Posted videos <b>{rows.length}</b>
            {/* A GMV total across nine collabs must never be mistaken for one
                deal's. If the panel is showing more than this row, it says so. */}
            {allTime && merged.collabs > 1 && (
              <span className="pc-vxp-scope">across {merged.collabs} collabs</span>
            )}
            {isEuka && totGmv > 0 && <span className="pc-vxp-gmvchip">{fmt$Exact(Math.round(totGmv))} GMV</span>}
            {isEuka && avgEng != null && (
              <span className={`pc-vxp-engchip ${avgEng >= 8 ? 'hot' : avgEng >= 4 ? 'ok' : 'low'}`}
                title={`Average engagement across ${engRows.length} video${engRows.length !== 1 ? 's' : ''} with EUKA engagement data · (likes + comments) ÷ views`}>
                {avgEng.toFixed(1)}% eng
              </span>
            )}
            {!isEuka && <span className="pc-vxp-manualtag">Manual tracking · brand not on EUKA</span>}
          </span>
          {live && <span className="pc-vxp-live"><span className="pc-vxp-livedot" />Syncing EUKA…</span>}
          <button className="pc-contract-btn" onClick={onManage}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
            Manage videos
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="pc-vxp-empty">No videos posted yet for this collab.</div>
        ) : !isEuka ? (
          /* ── manual brands · numbered video cards (link + date + ad code) ── */
          <div className="pc-vxm-grid">
            {rows.map((r, i) => (
              <div className="pc-vxm-card" key={i}>
                <div className="pc-vxm-top">
                  <span className="pc-vxm-num">{i + 1}</span>
                  <span className="pc-vxm-title">Video {i + 1}</span>
                  <a className="pc-vxm-open" href={r.video} target="_blank" rel="noreferrer" title="Open video on TikTok">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                  </a>
                </div>
                <div className="pc-vxm-meta">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  {r.date ? `Posted ${formatHireDate(String(r.date).slice(0, 10))}` : 'Posted date not set'}
                </div>
                {/* WURX-ADDED · the row's own code, else EUKA's for the same video (wxCode). */}
                {(() => {
                  const k = wxCode(r);
                  return k
                    ? <button className={`pc-vxm-code ${copiedIdx === i ? 'copied' : ''}`} onClick={() => copy(i, k.code)} title={`Copy ad code\n${k.code}${k.fromEuka ? '\nfrom EUKA' : ''}${k.expired ? ' · expired' : ''}`}>
                        {copiedIdx === i
                          ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>Copied</>
                          : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg><span className="pc-vxm-codetxt">{k.code}</span></>}
                      </button>
                    : <div className="pc-vxm-nocode">No ad code yet</div>;
                })()}
                {/* WURX-END */}
                {/* WURX-ADDED · the same two figures on the CARD layout.

                    THERE ARE TWO LAYOUTS AND BOTH NEED THIS. Brands on EUKA get
                    the table below; every other brand gets these cards. Adding
                    the figures only to the table would have shipped a feature
                    that worked on some brands and silently did nothing on the
                    rest — and the brand somebody opened first would decide
                    which impression they formed of it. */}
                {(() => {
                  const vid = wxVideoId(r.video);
                  const f = vid ? wxAdsP.get(vid) : null;
                  const roi = f && f.cost > 0 ? f.revenue / f.cost : null;
                  return (
                    <div className="wx-collab-vm-figures">
                      <span>
                        <em>Ad spend</em>
                        <b>{f && !f.mixedCurrency ? wxMoney(f.cost, f.currency) : '-'}</b>
                      </span>
                      <span>
                        <em>ROI</em>
                        <b>{roi === null ? '-' : wxRoi(roi)}</b>
                      </span>
                    </div>
                  );
                })()}
                {/* WURX-END */}
              </div>
            ))}
          </div>
        ) : (
          <div className="pc-vxp-table">
            <div className="pc-vxp-head">
              <div>Video</div>
              <div className="pc-num">Views</div>
              <div className="pc-num">Engagement</div>
              <div className="pc-num">GMV</div>
              <div className="pc-num">Items sold</div>
              {/* WURX-ADDED · the same two figures, per video. */}
              <div className="pc-num">Ad spend</div>
              <div className="pc-num">ROI</div>
              {/* WURX-END */}
              <div>Spark code</div>
            </div>
            {rows.map((r, i) => (
              <div className="pc-vxp-row" key={i}>
                <a className="pc-vxp-vid" href={r.video} target="_blank" rel="noreferrer" title="Open video on TikTok">
                  {/* WURX-ADDED · same fallback as the strip above. WURX-END */}
                  <WxVideoThumb src={r.thumb} className="pc-vxp-thumb"
                    phClassName="pc-vxp-thumb pc-vxp-thumb-ph" />
                  <span className="pc-vxp-vidtxt">
                    <span className="pc-vxp-prod">{(r.product || '').trim() || 'View video'}</span>
                    <span className="pc-vxp-date">
                      {r.date ? formatHireDate(String(r.date).slice(0, 10)) : 'Posted date unknown'}
                      {Number(r.secs) > 0 && <span className="pc-vxp-dur"> · {Math.floor(r.secs / 60) ? `${Math.floor(r.secs / 60)}m ` : ''}{r.secs % 60}s</span>}
                    </span>
                  </span>
                </a>
                <div className="pc-num">{Number(r.views) > 0 ? kNum(r.views) : <span className="pc-vxp-dash">-</span>}</div>
                <div className="pc-num">
                  {(() => {
                    const likes = Number(r.likes) || 0, comments = Number(r.comments) || 0, views = Number(r.views) || 0;
                    if (!views || (!likes && !comments)) return <span className="pc-vxp-dash">-</span>;
                    const pct = (likes + comments) / views * 100;
                    return (
                      <span className={`pc-engrate ${pct >= 8 ? 'hot' : pct >= 4 ? 'ok' : 'low'}`}
                        title={`${likes.toLocaleString()} likes · ${comments.toLocaleString()} comments · ${views.toLocaleString()} views`}>
                        {pct.toFixed(1)}%
                      </span>
                    );
                  })()}
                </div>
                <div className="pc-num">{Number(r.revenue) > 0 ? <span className="pc-metric-gmv">{fmt$Exact(Math.round(Number(r.revenue)))}</span> : <span className="pc-vxp-dash">-</span>}</div>
                <div className="pc-num">{Number(r.items) > 0 ? kNum(r.items) : <span className="pc-vxp-dash">-</span>}</div>
                {/* WURX-ADDED · what THIS video cost to advertise, and what came
                    back. Keyed on TikTok's own video id, so it is exact. */}
                {(() => {
                  const vid = wxVideoId(r.video);
                  const f = vid ? wxAdsP.get(vid) : null;
                  const roi = f && f.cost > 0 ? f.revenue / f.cost : null;
                  return (
                    <>
                      <div className="pc-num wx-collab-figure">
                        {f && !f.mixedCurrency
                          ? <span className="pc-metric">{wxMoney(f.cost, f.currency)}</span>
                          : <span className="pc-vxp-dash">-</span>}
                      </div>
                      <div className="pc-num wx-collab-figure">
                        {roi === null
                          ? <span className="pc-vxp-dash">-</span>
                          : <span className="pc-metric">{wxRoi(roi)}</span>}
                      </div>
                    </>
                  );
                })()}
                {/* WURX-END */}
                <div>
                  {/* WURX-ADDED · the row's own code, else EUKA's for the same video (wxCode). */}
                  {(() => {
                    const k = wxCode(r);
                    return k
                      ? <button className={`pc-vxp-code ${copiedIdx === i ? 'copied' : ''}`} onClick={() => copy(i, k.code)} title={`Copy spark code\n${k.code}${k.fromEuka ? '\nfrom EUKA' : ''}${k.expired ? ' · expired' : ''}`}>
                          {copiedIdx === i
                            ? <>Copied<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></>
                            : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>Copy code</>}
                        </button>
                      : <span className="pc-vxp-dash">-</span>;
                  })()}
                  {/* WURX-END */}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* Inline status dropdown · derives 3-state status from Wurx fields, saves both fields */
function WurxStatusDropdown({ c, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);

  const derived =
    c.payment_status === 'Paid'
      ? { label: 'Payment Sent', cls: 'sent' }
      : (c.videos === 'Done')
        ? { label: 'Payment Pending', cls: 'pending' }
        : { label: 'Videos in Progress', cls: 'progress' };

  /* "Payment Sent" appears ONLY for Asad — for everyone else the option
     doesn't exist in the menu at all (and the App-level gate blocks it too). */
  const OPTIONS = [
    { cls: 'progress', label: 'Videos in Progress', apply: { payment_status: 'Not Yet', videos: 'In Progress' } },
    { cls: 'pending',  label: 'Payment Pending',   apply: { payment_status: 'Not Yet', videos: 'Done' } },
    { cls: 'sent',     label: 'Payment Sent',      apply: { payment_status: 'Paid' } },
  ].filter(o => o.cls !== 'sent' || canMarkPaid());

  function toggle(e) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const menuW = Math.max(r.width, 184);
      const left = Math.max(10, Math.min(r.left, window.innerWidth - menuW - 10));
      const top = (r.bottom + 6 + 160 > window.innerHeight && r.top - 6 - 160 > 0) ? r.top - 6 : r.bottom + 6;
      setPos({ left, top, width: r.width, flip: top < r.top });
    }
    setOpen(o => !o);
  }
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { clearTimeout(t); document.removeEventListener('click', close); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);

  /* After every hook, never before — this component must keep its hook order
     stable whichever branch it takes. */
  if (!canEditStatus()) {
    return (
      <span className={`pc-badge ${derived.cls}`} title="Read only">
        <span className="dot" />{derived.label}
      </span>
    );
  }

  return (
    <>
      <button ref={btnRef} className={`pc-badge ${derived.cls} pc-badge-btn`} onClick={toggle} title="Change status">
        <span className="dot" />{derived.label}<span className="pc-bcaret">▾</span>
      </button>
      {open && pos && createPortal(
        <div className="pc-statusmenu" style={{ left: pos.left, top: pos.top, minWidth: Math.max(pos.width, 184), transform: pos.flip ? 'translateY(-100%)' : 'none' }} onClick={e => e.stopPropagation()}>
          {OPTIONS.map(s => (
            <button key={s.cls} className={`pc-statusopt ${derived.cls === s.cls ? 'active' : ''}`} onClick={() => { onChange(s.apply); setOpen(false); }}>
              <span className={`pc-statusdot ${s.cls}`} />{s.label}
            </button>
          ))}
        </div>, wxPortalHost())}
    </>
  );
}

function KpiSub({ label, color, value, sub, icon }) {
  /* "62% used" · "45% paid out" style subs get a live micro progress bar */
  const pct = (() => {
    const m = String(sub || '').match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? Math.max(0, Math.min(100, parseFloat(m[1]))) : null;
  })();
  return (
    <div className="pc-kpi" style={{ '--kpi-color': color }}>
      <div className="pc-kpi-row">
        <span className="pc-kpi-badge" aria-hidden>
          {icon}
        </span>
        <div className="pc-kpi-label">{label}</div>
      </div>
      <div>
        <div className="pc-kpi-value">{value}</div>
        {pct != null && (
          <div className="pc-kpi-track" aria-hidden>
            <div className="pc-kpi-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
        {sub && <div className="pc-kpi-sub">{sub}</div>}
      </div>
    </div>
  );
}

/* ════════ BUDGET EDITOR ════════ */
function BudgetEditor({ brand, month: initialMonth, currentBudget, currentRecord, contentGuideUrl, focusProducts, brandNames = [], allBudgets = [], onSaved, onClose }) {
  const isAddBrand = !brand;
  const [brandName, setBrandName] = useState(brand || '');
  const [pickedMonth, setPickedMonth] = useState(initialMonth || currentMonthKey());
  const [budget, setBudget] = useState(String(currentBudget || ''));
  const [contentGuide, setContentGuide] = useState(contentGuideUrl || '');
  const [products, setProducts] = useState(focusProducts && focusProducts.length ? focusProducts : [{ name: '', url: '' }]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  // When this banner is set, we just auto-filled content guide / products from
  // a previous month's record for the brand the user typed. The user can edit
  // freely after — we only fill blanks, never overwrite typed values.
  const [restoredFrom, setRestoredFrom] = useState(null); // null or "YYYY-MM"

  // Full pool of every brand we've ever seen — union of the current view's
  // brandNames prop with every distinct brand in allBudgets. Drives both the
  // datalist and the inline chip suggestions so typing "B" surfaces "Biostime"
  // even if Biostime has no record for the picked month yet.
  const allBrandNames = useMemo(() => {
    const set = new Set();
    (brandNames || []).forEach(b => { if (b && b.trim()) set.add(b.trim()); });
    (allBudgets || []).forEach(b => { if (b?.brand && b.brand.trim()) set.add(b.brand.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [brandNames, allBudgets]);

  // Live suggestions — case-insensitive substring match, top 6 best matches.
  // Hidden until the user types something AND it's not an exact hit.
  const suggestions = useMemo(() => {
    const q = (brandName || '').trim().toLowerCase();
    if (!q) return [];
    const exactHit = allBrandNames.some(b => b.toLowerCase() === q);
    if (exactHit) return [];
    return allBrandNames
      .filter(b => b.toLowerCase().includes(q))
      .sort((a, b) => {
        // Prefix matches before substring matches
        const ap = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.toLowerCase().startsWith(q) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.localeCompare(b);
      })
      .slice(0, 6);
  }, [brandName, allBrandNames]);

  // Auto-fill content guide + focus products from the most recent prior month
  // record. Fires when the typed brand name exactly matches an existing brand.
  // Determines what to restore from CURRENT state (not setter callbacks — those
  // run lazily and can't mutate variables in time for the banner check).
  useEffect(() => {
    if (!isAddBrand) return;
    const typed = (brandName || '').trim().toLowerCase();
    if (!typed) { setRestoredFrom(null); return; }
    const matches = (allBudgets || []).filter(b => (b.brand || '').trim().toLowerCase() === typed);
    if (matches.length === 0) { setRestoredFrom(null); return; }
    const latest = [...matches].sort((a, b) => (b.month || '').localeCompare(a.month || ''))[0];
    if (!latest || latest.month === pickedMonth) { setRestoredFrom(null); return; }

    const willRestoreContent  = !contentGuide && !!latest.content_guide_url;
    const productsBlank       = products.length === 1 && !products[0].name && !products[0].url;
    const willRestoreProducts = productsBlank
      && Array.isArray(latest.focus_product_url)
      && latest.focus_product_url.length > 0;

    if (willRestoreContent)  setContentGuide(latest.content_guide_url);
    if (willRestoreProducts) setProducts(latest.focus_product_url.map(p => ({ name: p?.name || '', url: p?.url || '' })));

    setRestoredFrom((willRestoreContent || willRestoreProducts) ? latest.month : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandName, pickedMonth, allBudgets, isAddBrand]);

  const save = async () => {
    const finalBrand = (brand || brandName || '').trim();
    if (isAddBrand && !finalBrand) { setErr('Brand name is required'); return; }
    if (!pickedMonth) { setErr('Please pick a month'); return; }
    setSaving(true);
    setErr('');
    const cleanedProducts = products.filter(p => (p.name || '').trim() || (p.url || '').trim());
    const payload = {
      budget: parseFloat(budget) || 0,
      content_guide_url: (contentGuide || '').trim(),
      focus_product_url: cleanedProducts,
      updated_at: new Date().toISOString(),
    };
    try {
      const { data: existing, error: selErr } = await supabase
        .from('brand_monthly_budgets')
        .select('id')
        .eq('brand', finalBrand)
        .eq('month', pickedMonth)
        .limit(1);
      if (selErr) throw selErr;

      if (existing && existing.length > 0) {
        const { error } = await supabase.from('brand_monthly_budgets').update(payload).eq('id', existing[0].id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('brand_monthly_budgets').insert([{ brand: finalBrand, month: pickedMonth, ...payload }]);
        if (error) throw error;
      }
      if (onSaved) { try { await onSaved(); } catch {} }   // refetch in parent so UI updates without realtime
      onClose();
    } catch (e) {
      setErr(e?.message || 'Save failed · make sure the brand_monthly_budgets table exists in Supabase');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pc-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pc-modal" style={{ maxWidth: 520 }}>
        <h3>{isAddBrand ? 'Add brand' : (currentBudget > 0 ? 'Edit budget' : 'Set budget')}</h3>
        <div className="pc-modal-sub">{(brand || brandName) || 'New brand'} · {monthLabel(pickedMonth)}</div>

        {isAddBrand && (
          <div className="pc-field">
            <label>Brand name</label>
            <input className="pc-input" list="wurx-brandnames" placeholder="e.g. Penetrex" value={brandName} onChange={e => setBrandName(e.target.value)} autoFocus />
            <datalist id="wurx-brandnames">{allBrandNames.map(b => <option key={b} value={b} />)}</datalist>
            {suggestions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--pc-text-3)', textTransform: 'uppercase', letterSpacing: 0.4, alignSelf: 'center', marginRight: 2 }}>Suggestions</span>
                {suggestions.map(b => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBrandName(b)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      height: 26, padding: '0 10px', borderRadius: 999,
                      background: 'var(--pc-accent-light)',
                      color: 'var(--pc-accent)',
                      border: '1px solid color-mix(in srgb, var(--pc-accent) 22%, transparent)',
                      fontSize: 12, fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'background .15s, transform .12s var(--pc-ease)',
                    }}
                    onMouseDown={e => e.preventDefault()}
                    title={`Use "${b}"`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}
            {restoredFrom && (
              <div style={{
                marginTop: 6, padding: '6px 10px',
                background: 'color-mix(in srgb, var(--wx-success-soft) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--wx-success) 28%, transparent)',
                color: 'var(--pc-success-fg)',
                borderRadius: 10,
                fontSize: 11.5, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', gap: 7,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
                Restored from {monthLabel(restoredFrom)} · content guide &amp; focus products auto-filled
              </div>
            )}
          </div>
        )}

        <div className="pc-field">
          <label>Month</label>
          <input type="month" className="pc-input" value={pickedMonth} onChange={e => setPickedMonth(e.target.value)} />
        </div>

        <div className="pc-field">
          <label>Budget (USD)</label>
          <input type="number" className="pc-input" placeholder="0" value={budget} onChange={e => setBudget(e.target.value)} onWheel={e => e.currentTarget.blur()} autoFocus />
        </div>

        <div className="pc-field">
          <label>Content guide URL</label>
          <input type="url" className="pc-input" placeholder="https://…" value={contentGuide} onChange={e => setContentGuide(e.target.value)} />
        </div>

        <div className="pc-field">
          <label>Focus products</label>
          {products.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input className="pc-input" placeholder="Product name" value={p.name} onChange={e => { const nx = [...products]; nx[i] = { ...p, name: e.target.value }; setProducts(nx); }} style={{ flex: '0 0 38%' }} />
              <input className="pc-input" placeholder="https://…" value={p.url} onChange={e => { const nx = [...products]; nx[i] = { ...p, url: e.target.value }; setProducts(nx); }} style={{ flex: 1 }} />
              {products.length > 1 && (
                <button type="button" onClick={() => setProducts(products.filter((_, j) => j !== i))} style={{ flex: '0 0 40px', height: 40, borderRadius: 12, border: '1px solid var(--pc-divider)', background: 'var(--pc-card-2)', color: 'var(--pc-error-fg)', cursor: 'pointer', fontSize: 17, fontWeight: 700 }}>×</button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setProducts([...products, { name: '', url: '' }])} className="pc-btn pc-btn-ghost pc-btn-sm" style={{ marginTop: 6 }}>+ Add another</button>
        </div>

        {err && (
          <div style={{ background: 'var(--pc-error-bg)', color: 'var(--pc-error-fg)', borderRadius: 12, padding: '10px 13px', fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{err}</div>
        )}

        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onClose} disabled={saving} style={{ flex: 1 }}>Cancel</button>
          <button className="pc-btn pc-btn-primary" onClick={save} disabled={saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

/* ════════ CREATOR EDIT MODAL · Afflix CreatorEditor pattern
   Add or edit a creator. Replaces the old Wurx BottomSheetV2.
════════ */
/* Default hiring date for a new creator · SHOP time, not the browser's.
   On local time an 01:00 PKT signing lands on tomorrow's date while the
   shop is still on the previous day, which silently files the creator
   under the wrong month everywhere downstream. */
function todayISO() {
  return shopToday();
}

function CreatorEditModal({ mode, creator, defaultBrand, brands = [], directory = [], categories = [], budgets = [], allCreators = [], euka, currentUser, onDelete, onSave, onClose }) {
  const c = creator || {};
  const isAdd = mode === 'add';
  /* WURX-ADJUSTED · WHO MAY DELETE A CREATOR.
     This was `(currentUser?.id === 'asad') || (currentUser?.username === 'Asad')`,
     and NEITHER HALF COULD EVER BE TRUE: `id` is our auth uuid, and `username`
     comes from the profile's display name, which is lower case for all eight
     team accounts — "asad" never equals "Asad". So the button was never
     rendered for anybody, Asad included, and the report was "there is no
     delete button" rather than "I am not allowed".
     Same fault as the payment gates fixed on 2026-08-31; missed then because
     the sweep searched the negative form (`!==`) and this one is positive.
     Note the OTHER delete, on the performance matrix, uses the repaired
     `isAsadActor()` and does work — which is why the two disagreed.
     Rashid, asked on 2026-09-02, chose their own capability over a name, as he
     did for `canEditPay`: `canDelete` is "Delete creators · Remove rows
     permanently", so it is a setting Asad flips per person rather than a
     literal in this file. */
  const mayDelete = can(currentUser, 'canDelete');
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Parse existing deal text into amount + videos count
  const initAmount = c.deal ? String(parseDealAmount(c.deal) || '') : '';
  const initVideos = c.deal ? String(parseDealVideos(c.deal) || '') : '';

  const [f, setF] = useState({
    name: c.name || '',
    brand: c.brand || defaultBrand || '',
    phone: c.whatsapp_number || '',
    email: c.email || '',
    category: c.category || '',
    amount: initAmount,
    videos_count: initVideos,
    paypal: c.paypal || '',
    zelle: c.zelle || '',
    onboarded_on: c.hiring_date || todayISO(),
    hired_by: c.hired_by || '',
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  // TikTok accounts · up to 2 (matches Wurx schema: tiktok_account + tiktok_account_2)
  const [tiktoks, setTiktoks] = useState(() => {
    const arr = [];
    if (c.tiktok_account) arr.push(c.tiktok_account);
    if (c.tiktok_account_2) arr.push(c.tiktok_account_2);
    return arr.length ? arr : [''];
  });

  // Brand's promoting products · from budgets table for current month, OR product list inferred
  const brandProducts = useMemo(() => {
    const b = budgets.find(x => x.brand === f.brand);
    return Array.isArray(b?.focus_product_url) ? b.focus_product_url : [];
  }, [budgets, f.brand]);

  const [prods, setProds] = useState(() => {
    const existing = Array.isArray(c.products) ? c.products : [];
    if (existing.length) return existing;
    // For add mode with exactly one focus product on the brand · auto-select it
    return [];
  });
  const [prodInput, setProdInput] = useState('');
  /* WURX-ADDED · the dropdown is CLOSED until it is opened, and the chevron,
     Escape, a click outside and picking one all close it again. Theirs listed
     everything permanently, which is what Rashid asked to be rid of. */
  const [prodOpen, setProdOpen] = useState(false);
  const prodPanelRef = useRef(null);
  const prodWrapRef = useRef(null);
  useEffect(() => {
    if (!prodOpen) return;
    const onDown = (e) => { if (prodWrapRef.current && !prodWrapRef.current.contains(e.target)) setProdOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setProdOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [prodOpen]);
  /* WURX-END */
  const prodKey = (p) => (p.name || p.url || '').toLowerCase().trim();
  const hasProd = (p) => prods.some(x => prodKey(x) === prodKey(p));
  const toggleProd = (p) => setProds(prev => prev.some(x => prodKey(x) === prodKey(p)) ? prev.filter(x => prodKey(x) !== prodKey(p)) : [...prev, { name: p.name || '', url: p.url || '', productId: p.id || p.productId || '', image: p.image || '' }]);

  /* WURX-ADDED · THE BRAND'S REAL CATALOGUE, FROM WHICHEVER PLATFORM SELLS IT.
     Rashid, 2026-09-23: "we want to fetch products for that brand from the api
     so when we onboard creator it will show us the dropdown to choose the
     product from, we can also search product because list may be long".

     `collab-products` answers for Euka brands and Reacher ones alike, in one
     shape, so nothing here knows which platform a brand is on. It is asked once
     per brand and remembered for as long as the modal is open: onboarding
     several creators for one brand should not be several round trips.

     NULL IS NOT AN EMPTY LIST. A brand on neither platform, or a call that
     failed, leaves the typed box and the brand's own focus products exactly as
     they were — an empty dropdown would say "this brand has no products",
     which is a different and usually false statement. */
  const [apiProds, setApiProds] = useState([]);
  const [apiState, setApiState] = useState('idle');   // idle | loading | ok | none
  const [apiNote, setApiNote] = useState('');
  const apiCache = useRef(new Map());
  useEffect(() => {
    const brand = (f.brand || '').trim();
    if (!brand) { setApiProds([]); setApiState('idle'); setApiNote(''); return; }
    if (apiCache.current.has(brand)) {
      const hit = apiCache.current.get(brand);
      setApiProds(hit.products); setApiState(hit.products.length ? 'ok' : 'none'); setApiNote(hit.note || '');
      return;
    }
    let alive = true;
    setApiState('loading'); setApiNote('');
    (async () => {
      const res = await collabProducts(brand);
      if (!alive) return;
      const products = res?.products ?? [];
      apiCache.current.set(brand, { products, note: res?.note || '' });
      setApiProds(products);
      setApiNote(res?.note || '');
      setApiState(products.length ? 'ok' : 'none');
    })();
    return () => { alive = false; };
  }, [f.brand]);

  /* One list to choose from: the catalogue first, then any focus product the
     brand carries that the catalogue does not, so nothing already typed by the
     team disappears. Already-chosen products drop out. */
  const wxPickable = useMemo(() => {
    const seen = new Set(prods.map(prodKey));
    const out = [];
    for (const p of apiProds) {
      const k = (p.name || '').toLowerCase().trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      /* `image` MUST be carried across. This list is rebuilt into fresh objects,
         and when it was written no product had a picture, so the field was
         simply never copied — which is why the catalogue went on drawing letter
         tiles for hours after the pictures had actually started arriving. */
      out.push({ name: p.name, url: p.url || '', id: p.id || '', price: p.price || '', image: p.image || '', from: 'api' });
    }
    for (const p of brandProducts) {
      const k = (p.name || p.url || '').toLowerCase().trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ name: p.name || '', url: p.url || '', id: '', price: '', from: 'brand' });
    }
    return out;
  }, [apiProds, brandProducts, prods]);

  /* The search box filters that list; with nothing typed it shows the lot,
     scrolled. Every word must appear, so "kidney cleanse" finds a product whose
     name puts them apart. */
  const wxProdMatches = useMemo(() => {
    const q = prodInput.trim().toLowerCase();
    if (!q) return wxPickable;
    const words = q.split(/\s+/);
    return wxPickable.filter((p) => {
      const hay = `${p.name} ${p.url}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [wxPickable, prodInput]);

  /* PER-PRODUCT DEALS. Rashid: "if user has chosen only one product it's fine
     but more than one he may have different deal of videos and amount on that
     ... their total sum will be auto in the row below".

     With one product the two fields at the bottom are the deal, exactly as
     before. With more than one, each product carries its own amount and video
     count and those two fields become the TOTAL — computed, never typed, so
     they cannot disagree with the parts. The total is what goes into `deal`,
     which is the field every other screen reads: the budget, cost per video,
     the delivery bar and the brand cards all parse that text, and they must
     keep seeing one number for the row. */
  const wxMulti = prods.length > 1;
  /* WURX-ADJUSTED 2026-09-24 · VIDEOS SPLIT PER PRODUCT, MONEY DOES NOT.
     Rashid: "we only need one checkbox and that should be videos, users will
     only input no of videos that would be auto sum and amount will be entered
     manually only, no of videos would be per product".

     It is the right way round. A deal is one sum of money for a body of work;
     splitting it per product was asking whoever onboards to invent an
     allocation nobody had agreed, and two typed numbers that must add up to a
     third is how they come to disagree. The video count genuinely is per
     product — that is what gets delivered — so that is the only thing split. */
  const wxSplitTotals = useMemo(() => {
    let videos = 0, missing = 0;
    for (const p of prods) {
      const v = Number(p.videos);
      if (!Number.isFinite(v) || String(p.videos ?? '') === '') missing++;
      videos += Number.isFinite(v) ? v : 0;
    }
    return { videos, missing };
  }, [prods]);
  const setProdField = (i, key, value) => setProds((prev) => prev.map((p, j) => (j === i ? { ...p, [key]: value } : p)));

  /* A PRODUCT IS COMPULSORY FROM OCTOBER, AND NOT ONE DAY EARLIER.
     Rashid, 2026-09-24: "I want from october and onwards (not before october
     please) it should be compulsory to choose the product while onboarding".

     THE RULE KEYS ON THE ROW'S OWN ONBOARDING DATE, not on today's. That is
     what makes it safe: the same modal edits creators hired months ago, and a
     rule read off the clock would refuse to save a September row every time
     somebody opened it to fix a phone number — hundreds of existing rows turned
     unsaveable overnight, which is exactly what "not before October please"
     forbids. A row dated 2026-09-30 is never blocked; the same row moved to
     October is, which is correct, because it is then an October deal.

     `onboarded_on` is always filled — today for a new creator, its own date for
     an existing one — and the fallback below only covers a hand-cleared field,
     where "today" is the honest reading of what is being created. */
  const WX_PRODUCT_REQUIRED_FROM = '2026-10-01';
  const wxProductRequired = useMemo(() => {
    const raw = String(f.onboarded_on || '').trim();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayISO();
    return day >= WX_PRODUCT_REQUIRED_FROM;
  }, [f.onboarded_on]);
  /* WURX-END */
  const removeProd = (idx) => setProds(prev => prev.filter((_, j) => j !== idx));
  const addCustomProd = () => {
    const name = prodInput.trim();
    if (!name) return;
    if (!prods.some(x => (x.name || '').toLowerCase().trim() === name.toLowerCase())) {
      const match = brandProducts.find(bp => (bp.name || '').toLowerCase().trim() === name.toLowerCase());
      setProds(prev => [...prev, { name, url: match?.url || '' }]);
    }
    setProdInput('');
  };
  /* WURX-ADJUSTED · theirs, kept because `hasProd` and the chips still read it,
     but the picker below now builds its own list from the brand's real
     catalogue with these folded in — see `wxPickable`. */
  const pickableProducts = brandProducts.filter(p => !hasProd(p));
  void pickableProducts;

  // Name autocomplete from directory · ranked (prefix > word > substring),
  // also matches on TikTok handles, exact matches stay visible for autofill
  const [showSug, setShowSug] = useState(false);
  /* WURX-ADJUSTED · the directory suggestions work while EDITING too.
     They were rendered only when adding, but everything behind them was
     already written for edit mode — `personHistory` below carries an explicit
     "editing → exclude self" line, which only makes sense if editing was meant
     to show them. Rashid: the picker appears when adding a creator and not
     when editing one.
     The one thing edit mode does need is to leave the record being edited out
     of its own suggestion list, so "Hailry" does not offer to auto-fill
     "Hailry" over itself. */
  const matches = useMemo(() => {
    const list = rankDirectory(directory, f.name);
    if (isAdd || !c.id) return list;
    return list.filter((d) => String(d.id ?? '') !== String(c.id));
  }, [f.name, directory, isAdd, c.id]);

  // TikTok handle autocomplete · same directory, matched by handle. If the
  // typed username already exists, one tap pulls the whole record in — same
  // autofill behavior as the Name field.
  const [tkSugIdx, setTkSugIdx] = useState(null);      // which tiktok input is focused
  const tkMatches = useMemo(() => {
    if (tkSugIdx == null) return [];
    const q = _normEukaHandle(tiktoks[tkSugIdx] || '');
    if (q.length < 2) return [];
    return directory
      .filter(d => [d.tiktok_account, d.tiktok_account_2].some(h => {
        const hh = _normEukaHandle(h);
        return hh && hh.includes(q);
      }))
      .sort((a, b) => {
        const ap = [a.tiktok_account, a.tiktok_account_2].some(h => _normEukaHandle(h).startsWith(q)) ? 0 : 1;
        const bp = [b.tiktok_account, b.tiktok_account_2].some(h => _normEukaHandle(h).startsWith(q)) ? 0 : 1;
        return ap - bp || (a.name || '').localeCompare(b.name || '');
      })
      .slice(0, 6);
  }, [isAdd, tkSugIdx, tiktoks, directory]);

  /* ══ INTELLIGENCE · live insights computed while you type ══ */
  const _sameNorm = (s) => String(s || '').trim().toLowerCase();
  // All past records of THIS person (matched by handle first, else exact name)
  const personHistory = useMemo(() => {
    const h1 = _normEukaHandle(tiktoks[0] || ''), h2 = _normEukaHandle(tiktoks[1] || '');
    const nm = _sameNorm(f.name);
    const rows = allCreators.filter(x => {
      if (!isAdd && x.id === c.id) return false;      // editing → exclude self
      const xh = [x.tiktok_account, x.tiktok_account_2].map(_normEukaHandle).filter(Boolean);
      if ((h1 && xh.includes(h1)) || (h2 && xh.includes(h2))) return true;
      return nm.length > 1 && _sameNorm(x.name) === nm;
    });
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => (b.hiring_date || '').localeCompare(a.hiring_date || ''));
    const last = sorted[0];
    const delivered = rows.reduce((s, x) => s + deliveredVideoCount(x), 0);
    return { count: rows.length, last, delivered };
  }, [allCreators, tiktoks, f.name, isAdd, c.id]);

  // Overall L30 GMV from EUKA for the typed/matched handles
  const liveL30 = useMemo(() => {
    const hs = [tiktoks[0], tiktoks[1], personHistory?.last?.tiktok_account, personHistory?.last?.tiktok_account_2];
    return eukaL30For(euka, hs);
  }, [euka, tiktoks, personHistory]);

  // Same handle already onboarded for this brand in this month → duplicate!
  const dupWarn = useMemo(() => {
    if (!isAdd || !f.brand.trim()) return false;
    const h1 = _normEukaHandle(tiktoks[0] || ''), h2 = _normEukaHandle(tiktoks[1] || '');
    if (!h1 && !h2) return false;
    const mo = monthKey(f.onboarded_on) || currentMonthKey();
    const nb = _sameNorm(f.brand);
    return allCreators.some(x => {
      if (_sameNorm(x.brand) !== nb) return false;
      if (monthKey(x.hiring_date) !== mo) return false;
      const xh = [x.tiktok_account, x.tiktok_account_2].map(_normEukaHandle).filter(Boolean);
      return (h1 && xh.includes(h1)) || (h2 && xh.includes(h2));
    });
  }, [isAdd, f.brand, f.onboarded_on, tiktoks, allCreators]);

  // Live rate per video + the brand's average rate for benchmarking
  const rate = (Number(f.amount) > 0 && Number(f.videos_count) > 0)
    ? Number(f.amount) / Number(f.videos_count) : null;
  const brandAvgRate = useMemo(() => {
    const nb = _sameNorm(f.brand);
    if (!nb) return null;
    const rates = allCreators
      .filter(x => _sameNorm(x.brand) === nb)
      .map(x => { const a = parseDealAmount(x.deal), v = parseDealVideos(x.deal); return v > 0 ? a / v : null; })
      .filter(r => r != null && isFinite(r) && r > 0);
    if (rates.length < 2) return null;
    return rates.reduce((s, r) => s + r, 0) / rates.length;
  }, [allCreators, f.brand]);

  // EUKA-known contact info for the typed handle · offered as one-tap fill
  const eukaContact = useMemo(() => {
    if (!euka?.profiles) return null;
    for (const t of [tiktoks[0], tiktoks[1]]) {
      const h = _normEukaHandle(t || '');
      const p = h && euka.profiles[h];
      if (p && (p.email || p.phone)) return p;
    }
    return null;
  }, [euka, tiktoks]);

  // Editing an existing deal · its own delivery progress
  const curDeal = useMemo(() => {
    if (isAdd) return null;
    const committed = parseDealVideos(c.deal) || 0;
    if (!committed) return null;
    return { committed, delivered: deliveredVideoCount(c) };
  }, [isAdd, c]);

  const _cNum = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
  const hasAudience = !!(eukaContact && (eukaContact.followers || eukaContact.postRate != null));
  const hasInsights = liveL30 != null || personHistory || dupWarn || curDeal || hasAudience;
  // Auto-fetch hired_by from the most recent record for this creator name.
  // Fires when the typed name exactly matches a directory entry. Only fills
  // when hired_by is currently empty so user edits are never overwritten.
  useEffect(() => {
    const typed = (f.name || '').trim().toLowerCase();
    if (!typed) return;
    if ((f.hired_by || '').trim()) return; // user already chose / record had it
    const match = directory.find(d => (d.name || '').trim().toLowerCase() === typed);
    if (match && (match.hired_by || '').trim()) {
      set('hired_by', match.hired_by.trim());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.name, directory]);

  const pickFromDirectory = (d) => {
    setF(prev => ({
      ...prev,
      name: d.name,
      paypal: d.paypal || prev.paypal,
      zelle: d.zelle || prev.zelle,
      phone: d.whatsapp_number || prev.phone,
      email: d.email || prev.email,
      category: d.category || prev.category,
      hired_by: prev.hired_by || d.hired_by || '',
    }));
    const arr = [];
    if (d.tiktok_account) arr.push(d.tiktok_account);
    if (d.tiktok_account_2) arr.push(d.tiktok_account_2);
    setTiktoks(arr.length ? arr : ['']);
    setShowSug(false);
    setTkSugIdx(null);
  };

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!f.name.trim()) { setErr('Name is required'); return; }
    if (!f.brand.trim()) { setErr('Brand is required'); return; }
    /* WURX-ADDED · the October rule, checked here as well as shown above,
       because a message beside a field is a prompt and this is a condition. */
    if (wxProductRequired && !prods.some(p => (p.name || '').trim() || (p.url || '').trim())) {
      setErr('Choose at least one product — required for creators onboarded from 1 October.');
      return;
    }
    setSaving(true);
    setErr('');
    /* Build the Wurx `deal` text from amount + videos_count.
       WURX-ADJUSTED · with several products those two are the TOTAL of the
       per-product rows. `deal` stays one line of free text holding the whole
       deal, because the budget, cost per video, the delivery bar, the brand
       cards and every check parse exactly that; the split lives beside it on
       `products` and is additive. */
    const wxAmount = f.amount;
    const wxVideos = wxMulti ? (wxSplitTotals.videos || '') : f.videos_count;
    let dealText = '';
    if (wxAmount && wxVideos) dealText = `$${wxAmount} / ${wxVideos} videos`;
    else if (wxAmount) dealText = `$${wxAmount}`;
    else if (wxVideos) dealText = `${wxVideos} videos`;

    const cleanTiktoks = tiktoks.map(t => (t || '').trim()).filter(Boolean);
    const cleanProds = prods
      .filter(p => (p.name || '').trim() || (p.url || '').trim())
      /* WURX-ADJUSTED · carry the per-product split, as numbers rather than the
         strings the inputs hand back, and only when there is one to carry. A
         single product keeps the shape it has always had. */
      .map(p => {
        const out = { name: p.name || '', url: p.url || '' };
        if (p.productId) out.productId = String(p.productId);
        if (wxMulti) {
          /* Videos only. The money is one figure for the whole deal and lives
             on `deal`, where every other screen already reads it. */
          const v = Number(p.videos);
          if (Number.isFinite(v) && String(p.videos ?? '') !== '') out.videos = v;
        }
        return out;
      });

    const payload = {
      ...(isAdd ? {} : { id: c.id }),
      name: f.name.trim(),
      brand: f.brand.trim(),
      tiktok_account: cleanTiktoks[0] || '',
      tiktok_account_2: cleanTiktoks[1] || '',
      whatsapp_number: fmtPhone(f.phone),
      email: f.email.trim(),
      category: f.category.trim(),
      deal: dealText,
      paypal: f.paypal.trim(),
      zelle: f.zelle.trim(),
      hiring_date: f.onboarded_on,
      hired_by: (f.hired_by || '').trim(),
      products: cleanProds,
    };
    try {
      await onSave(payload);
    } catch (e) {
      setErr(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  /* WURX-ADJUSTED · A DRAWER, NOT A POPUP.
     Rashid, 2026-09-23: "instead of showing the popup, we need to use drawer
     which will actually open a side drawer with all options ... now as we are
     using drawer you will have enough space to distribute".

     Theirs was `pc-overlay` centring a `pc-modal` capped at 620px inline. The
     classes stay so every rule they wrote still applies; `wx-drawer` moves the
     panel to the right edge and gives it the full height, and the inline cap is
     gone because an inline style beats any stylesheet. */
  return (
    <div className="pc-overlay wx-drawer-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pc-modal pc-contract-modal pc-cm wx-drawer" role="dialog" aria-modal="true" aria-label={isAdd ? 'Onboard creator' : 'Edit creator'}>

        {/* ── Sticky header ── */}
        <div className="pc-cf-head">
          <span className="pc-cf-headicon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
          </span>
          <div className="pc-cf-headtext">
            <h3>{isAdd ? 'Onboard creator' : 'Edit creator'}</h3>
            <div className="pc-cf-headsub">{monthLabel(monthKey(f.onboarded_on) || currentMonthKey())}{f.brand ? <> <span>×</span> {f.brand}</> : null}</div>
          </div>
          <button className="pc-cf-x" onClick={onClose} aria-label="Close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="pc-cm-body">
        <div className="pc-cm-sec"><span>Creator</span></div>

        {/* Name with autocomplete */}
        <div className="pc-field" style={{ position: 'relative' }}>
          <label>Name</label>
          <input className="pc-input" placeholder="Creator name" value={f.name} autoFocus
            onChange={e => { set('name', e.target.value); setShowSug(true); }}
            onFocus={() => setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 150)} />
          {showSug && matches.length > 0 && (
            <div className="pc-suggest">
              <div className="pc-suggest-head">Already worked with · tap to auto-fill</div>
              {matches.map((d, i) => (
                <button type="button" key={i} className="pc-suggest-item" onClick={() => pickFromDirectory(d)}>
                  <span className="pc-suggest-name"><SugHighlight text={d.name} q={f.name.trim()} /></span>
                  <span className="pc-suggest-meta">{[d.tiktok_account, d.tiktok_account_2].filter(Boolean).map(h => tiktokHandle(h)).join(' · ') || (d.whatsapp_number || d.email || '-')}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Brand */}
        <div className="pc-field">
          <label>Brand</label>
          <input className="pc-input" list="wurx-brandlist" placeholder="e.g. Wetcat" value={f.brand} onChange={e => set('brand', e.target.value)} />
          <datalist id="wurx-brandlist">{brands.map(b => <option key={b} value={b} />)}</datalist>
        </div>

        {/* ══ Smart insights · appears when the system recognizes this creator ══ */}
        {hasInsights && (
          <div className={`pc-cm-smart ${dupWarn ? 'warn' : ''}`}>
            {dupWarn && (
              <div className="pc-cm-smart-row danger">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                Already onboarded for <b>{f.brand}</b> this month · double-check before adding again
              </div>
            )}
            {liveL30 != null && (
              <div className="pc-cm-smart-row good">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                L30 GMV <b>{fmt$Exact(Math.round(liveL30))}</b> <span className="pc-cm-smart-dim">· overall, via EUKA</span>
              </div>
            )}
            {hasAudience && (
              <div className="pc-cm-smart-row">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                {eukaContact.followers ? <><b>{_cNum(eukaContact.followers)}</b>&nbsp;followers</> : null}
                {eukaContact.followers && eukaContact.postRate != null ? <>&nbsp;·&nbsp;</> : null}
                {eukaContact.postRate != null ? <>post rate <b className={eukaContact.postRate >= 70 ? 'pr-good' : eukaContact.postRate < 40 ? 'pr-low' : ''}>{Math.round(eukaContact.postRate)}%</b></> : null}
              </div>
            )}
            {personHistory && (
              <div className="pc-cm-smart-row">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                Worked <b>{personHistory.count}×</b> before · last: <b>{personHistory.last.brand || '-'}</b>{personHistory.last.deal ? ` (${personHistory.last.deal})` : ''} · {personHistory.delivered} videos delivered
              </div>
            )}
            {curDeal && (
              <div className={`pc-cm-smart-row ${curDeal.delivered >= curDeal.committed ? 'good' : ''}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                This deal: <b>{curDeal.delivered}/{curDeal.committed}</b> videos delivered{curDeal.delivered >= curDeal.committed ? ' · complete' : ''}
              </div>
            )}
          </div>
        )}

        <div className="pc-cm-sec"><span>TikTok</span></div>

        {/* TikTok account(s) · max 2 · with existing-creator autocomplete */}
        <div className="pc-field">
          <label>TikTok account(s)</label>
          {tiktoks.map((t, i) => (
            <div key={i} style={{ position: 'relative', display: 'flex', gap: 6, marginBottom: 6 }}>
              <input className="pc-input" placeholder="@handle or URL" value={t}
                onChange={e => setTiktoks(prev => prev.map((x, j) => (j === i ? e.target.value : x)))}
                onFocus={() => setTkSugIdx(i)}
                onBlur={() => setTimeout(() => setTkSugIdx(idx => (idx === i ? null : idx)), 150)} />
              {tiktoks.length > 1 && (
                <button type="button" onClick={() => setTiktoks(prev => prev.filter((_, j) => j !== i))} style={{ flex: '0 0 40px', height: 40, borderRadius: 12, border: '1px solid var(--pc-divider)', background: 'var(--pc-card-2)', color: 'var(--pc-error-fg)', cursor: 'pointer', fontSize: 17, fontWeight: 700 }}>×</button>
              )}
              {tkSugIdx === i && tkMatches.length > 0 && (
                <div className="pc-suggest" style={{ top: '100%' }}>
                  <div className="pc-suggest-head">Username already in database · tap to auto-fill</div>
                  {tkMatches.map((d, k) => (
                    <button type="button" key={k} className="pc-suggest-item" onClick={() => pickFromDirectory(d)}>
                      <span className="pc-suggest-name">
                        <SugHighlight
                          text={[d.tiktok_account, d.tiktok_account_2].filter(Boolean).map(h => tiktokHandle(h)).join(' · ')}
                          q={_normEukaHandle(t)}
                        />
                      </span>
                      <span className="pc-suggest-meta">{d.name || '-'}{d.brand ? ` · last: ${d.brand}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {tiktoks.length < 2 && (
            <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" style={{ marginTop: 4 }} onClick={() => setTiktoks(prev => [...prev, ''])}>+ Add another account</button>
          )}
        </div>

        {/* Phone + Email (2-col) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="pc-field"><label>Phone</label><input className="pc-input" placeholder="WhatsApp number" value={f.phone}
            onChange={e => set('phone', e.target.value)}
            onBlur={e => set('phone', fmtPhone(e.target.value))} /></div>
          <div className="pc-field"><label>Email</label><input className="pc-input" placeholder="email" value={f.email} onChange={e => set('email', e.target.value)} /></div>
        </div>

        {/* EUKA contact prefill · one tap fills the blanks */}
        {eukaContact && ((!f.email.trim() && eukaContact.email) || (!f.phone.trim() && eukaContact.phone)) && (
          <div className="pc-cm-prefill">
            <span className="pc-cm-prefill-l">Found on EUKA:</span>
            {!f.email.trim() && eukaContact.email && (
              <button type="button" className="pc-cm-prefill-chip" onClick={() => set('email', eukaContact.email)} title="Tap to fill email">
                {eukaContact.email}
              </button>
            )}
            {!f.phone.trim() && eukaContact.phone && (
              <button type="button" className="pc-cm-prefill-chip" onClick={() => set('phone', eukaContact.phone)} title="Tap to fill phone">
                {eukaContact.phone}
              </button>
            )}
          </div>
        )}

        {/* Category */}
        <div className="pc-field">
          <label>Category</label>
          <input className="pc-input" list="wurx-catlist" placeholder="e.g. Beauty · Tech · Fitness" value={f.category} onChange={e => set('category', e.target.value)} />
          <datalist id="wurx-catlist">{categories.map(cat => <option key={cat} value={cat} />)}</datalist>
        </div>

        <div className="pc-cm-sec"><span>Deal</span></div>

        {/* Promoting products */}
        <div className="pc-field">
          <label>
            Promoting product{prods.length === 1 ? '' : '(s)'}
            {/* WURX-ADDED · required from October. Said here as well as on save,
                so it is a known condition before the form is filled in rather
                than a refusal after it. */}
            {wxProductRequired && (
              <span data-wx="product-required" style={{
                marginLeft: 6, fontSize: 10, fontWeight: 800, letterSpacing: '.06em',
                color: prods.length ? 'var(--pc-text-3)' : 'var(--pc-warn-fg)',
              }}>REQUIRED</span>
            )}
          </label>
          {/* WURX-ADJUSTED · the chosen products as cards with their picture.
              Theirs were pills holding a 120-character product name, which
              overlapped each other and the field below. */}
          {prods.length > 0 && (
            <div data-wx="chosen-products" style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
              {prods.map((p, i) => (
                <div key={(p.name || '') + '-' + i} style={{
                  display: 'flex', alignItems: 'center', gap: 9, minWidth: 0,
                  padding: '6px 8px', borderRadius: 10,
                  border: '1px solid var(--pc-divider)', background: 'var(--pc-card-2)',
                }}>
                  <ProductTile product={p} size={30} />
                  <span title={p.name || p.url} style={{
                    flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: 'var(--pc-text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{p.name || p.url}</span>
                  <button type="button" onClick={() => removeProd(i)} aria-label="Remove this product"
                    style={{
                      width: 22, height: 22, flexShrink: 0, borderRadius: 999, border: 0,
                      background: 'transparent', color: 'var(--pc-text-3)', cursor: 'pointer',
                      fontSize: 14, lineHeight: 1,
                    }}>×</button>
                </div>
              ))}
            </div>
          )}
          {/* WURX-ADDED · A DROPDOWN, NOT A PERMANENT LIST.
              Rashid, 2026-09-23: "it should be the dropdown and searchable and
              it means it should only show the list only when we open the
              dropdown, click arrow should close the list but currently it
              remains. also use product images as well and show selected images
              properly".

              So: a closed control that says how many are chosen, a chevron that
              turns, a panel that appears on click and closes on the chevron, on
              Escape, on a click outside and after a pick. The chosen products
              are cards with their picture, not a row of pills. */}
          <div ref={prodWrapRef} style={{ position: 'relative' }}>
          <button type="button" data-wx="product-trigger" onClick={() => setProdOpen((o) => !o)}
            aria-expanded={prodOpen}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              height: 40, padding: '0 12px', borderRadius: 12,
              border: '1px solid var(--pc-divider)', background: 'var(--wx-surface-1)',
              color: prods.length ? 'var(--pc-text)' : 'var(--pc-text-3)',
              fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
            }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {apiState === 'loading' ? 'Loading this brand\u2019s products\u2026'
                : prods.length === 0 ? 'Choose products'
                : `${prods.length} product${prods.length === 1 ? '' : 's'} chosen`}
            </span>
            {apiState === 'ok' && <span style={{ color: 'var(--pc-text-3)', fontSize: 11 }}>{wxPickable.length + prods.length}</span>}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: prodOpen ? 'rotate(180deg)' : 'none', transition: 'transform .16s ease', flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {prodOpen && (
            <div data-wx="product-panel" ref={prodPanelRef} style={{
              marginTop: 6, border: '1px solid var(--pc-divider)', borderRadius: 12,
              background: 'var(--wx-surface-1)', overflow: 'hidden',
              boxShadow: '0 14px 40px rgba(15,23,42,0.10)',
            }}>
              <div style={{ padding: 8, borderBottom: '1px solid var(--pc-divider)' }}>
                <input className="pc-input" data-wx="product-search" autoFocus
                  placeholder="Search products, or type a new one"
                  value={prodInput}
                  onChange={e => setProdInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addCustomProd(); }
                    if (e.key === 'Escape') { e.preventDefault(); setProdOpen(false); }
                  }}
                  style={{ height: 34, fontSize: 12.5 }} />
              </div>
              <div data-wx="product-list" style={{ maxHeight: '15rem', overflowY: 'auto' }}>
                {wxProdMatches.map((p, i) => (
                  <button key={(p.id || p.name) + '-' + i} type="button"
                    onClick={() => { toggleProd(p); setProdInput(''); setProdOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                      padding: '7px 9px', border: 0,
                      borderBottom: i === wxProdMatches.length - 1 ? 0 : '1px solid var(--pc-divider)',
                      background: 'transparent', color: 'var(--pc-text)', textAlign: 'left',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    <ProductTile product={p} size={30} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.url}</span>
                    {p.price && <span style={{ color: 'var(--pc-text-3)', fontSize: 11 }}>${p.price}</span>}
                    {p.from === 'brand' && <span style={{ color: 'var(--pc-text-3)', fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em' }}>FOCUS</span>}
                  </button>
                ))}
                {wxProdMatches.length === 0 && (
                  <div style={{ padding: '10px 11px', fontSize: 11.5, color: 'var(--pc-text-3)' }}>
                    {apiState === 'loading'
                      ? 'Reading this brand’s catalogue…'
                      : apiState === 'none'
                      ? (apiNote || 'No catalogue for this brand — type the product and press +.')
                      : prodInput.trim()
                        ? <>Nothing matches &ldquo;{prodInput.trim()}&rdquo;. Press Enter to add it anyway.</>
                        : 'Everything in this brand\u2019s catalogue is already chosen.'}
                  </div>
                )}
              </div>
              {prodInput.trim() && (
                <button type="button" onClick={() => { addCustomProd(); setProdOpen(false); }}
                  style={{
                    display: 'block', width: '100%', padding: '8px 11px', border: 0,
                    borderTop: '1px solid var(--pc-divider)', background: 'var(--pc-card-2)',
                    color: 'var(--pc-accent)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'inherit', textAlign: 'left',
                  }}>
                  + Add &ldquo;{prodInput.trim()}&rdquo; as a product of your own
                </button>
              )}
            </div>
          )}
          </div>
          {/* WURX-ADDED · WHAT TO DO WHEN IT IS REQUIRED AND THERE IS NOTHING
              TO PICK. Of the brands actually being worked (11 in September
              2026), 9 have a catalogue we can read and 2 do not — Aqua Sonic
              and Pure Daily Care, both on Cruva. Rarer than it first looked,
              but still the difference between a rule and a dead end. */}
          {wxProductRequired && prods.length === 0 && (
            <div data-wx="product-required-hint" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--pc-warn-fg)' }}>
              {apiState === 'none'
                ? 'A product is required from October, and this brand has no catalogue to read — open the list and type the product name, then press Enter.'
                : 'A product is required for creators onboarded from October.'}
            </div>
          )}
          {/* WURX-END */}
        </div>

        {/* WURX-ADDED · VIDEOS PER PRODUCT, once there is more than one.
            It began (2026-09-23) as an amount and a video count per product.
            Rashid, 2026-09-24: "we only need one checkbox and that should be
            videos ... amount will be entered manually only, no of videos would
            be per product". So the Videos field below is the computed total and
            the Amount field beside it is typed, as it always was with one
            product. */}
        {wxMulti && (
          <div className="pc-field" data-wx="per-product-deals">
            <label>Videos per product</label>
            <div style={{ display: 'grid', gap: 6 }}>
              {prods.map((p, i) => (
                /* `minmax(0, 1fr)` and not `1fr`: a grid track refuses to go
                   below its content's minimum, so one long product name pushed
                   the amount and video fields off the side of the drawer. The
                   two fields are in rem so a zoomed browser keeps them usable. */
                <div key={(p.name || '') + '-' + i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 5.5rem', gap: 6, alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <ProductTile product={p} size={26} />
                    <span title={p.name || p.url} style={{
                      fontSize: 12, fontWeight: 600, color: 'var(--pc-text-2)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{p.name || p.url}</span>
                  </span>
                  <input className="pc-input" data-wx={'videos-' + i} type="number" inputMode="numeric" placeholder="videos"
                    value={p.videos ?? ''} onWheel={e => e.currentTarget.blur()}
                    onChange={e => setProdField(i, 'videos', e.target.value)} />
                </div>
              ))}
            </div>
            {wxSplitTotals.missing > 0 && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--pc-warn-fg)' }}>
                {wxSplitTotals.missing} product{wxSplitTotals.missing === 1 ? '' : 's'} still {wxSplitTotals.missing === 1 ? 'needs' : 'need'} a video count.
              </div>
            )}
          </div>
        )}
        {/* WURX-END */}

        {/* Amount + Videos (2-col).
            WURX-ADJUSTED · with more than one product these are the TOTAL, added
            up from the rows above and not typed. Two ways to say the same number
            is how they come to disagree, and this one is the number every other
            screen reads off `deal`. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }} data-wx={wxMulti ? 'deal-total' : 'deal-single'}>
          <div className="pc-field">
            {/* THE MONEY IS TYPED, ALWAYS, however many products there are.
                It is one deal for one creator, and nobody has agreed a split of
                it per product. */}
            <label>Amount ($)</label>
            <input className="pc-input" data-wx="total-amount" type="number" inputMode="numeric" placeholder="200"
              value={f.amount}
              onChange={e => set('amount', e.target.value)} onWheel={e => e.currentTarget.blur()} />
          </div>
          <div className="pc-field">
            <label>{wxMulti ? 'Total videos' : 'Videos'}</label>
            <input className="pc-input" data-wx="total-videos" type="number" inputMode="numeric" placeholder="5"
              value={wxMulti ? (wxSplitTotals.videos || '') : f.videos_count}
              readOnly={wxMulti}
              title={wxMulti ? 'Added up from the products above' : undefined}
              style={wxMulti ? { background: 'var(--pc-card-2)', color: 'var(--pc-text)', fontWeight: 800 } : undefined}
              onChange={e => set('videos_count', e.target.value)} onWheel={e => e.currentTarget.blur()} />
          </div>
        </div>

        {/* Live rate intelligence · computed as you type */}
        {rate != null ? (
          <div className="pc-cm-rate">
            = <b>{fmt$Exact(Math.round(rate))}</b> per video
            {brandAvgRate != null && (
              <span className={`pc-cm-rate-cmp ${rate <= brandAvgRate ? 'good' : 'high'}`}>
                brand avg {fmt$Exact(Math.round(brandAvgRate))}{rate > brandAvgRate * 1.25 ? ' · above usual' : rate <= brandAvgRate ? ' · good rate' : ''}
              </span>
            )}
          </div>
        ) : brandAvgRate != null && (
          <div className="pc-cm-rate hint">
            {f.brand.trim()} usually pays around <b>{fmt$Exact(Math.round(brandAvgRate))}</b> per video
          </div>
        )}

        <div className="pc-cm-sec"><span>Timeline & team</span></div>

        {/* Onboarded on + Hired by (2-col) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="pc-field">
            <label>Onboarded on</label>
            <input className="pc-input" type="date" value={f.onboarded_on} onChange={e => set('onboarded_on', e.target.value)} />
          </div>
          <div className="pc-field">
            <label>Hired by</label>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6,
              padding: '4px 4px 0',
            }}>
              {HIRED_BY_OPTIONS.map(name => {
                const { fg, bg } = hiredByPalette(name);
                const selected = f.hired_by === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => set('hired_by', selected ? '' : name)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      height: 32, padding: selected ? '0 13px 0 11px' : '0 12px',
                      borderRadius: 999,
                      background: selected ? fg : bg,
                      color: selected ? '#fff' : fg,
                      border: selected ? `1px solid ${fg}` : `1px solid color-mix(in srgb, ${fg} 22%, transparent)`,
                      fontSize: 12.5, fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'background .15s, transform .12s, box-shadow .15s',
                      boxShadow: selected ? `0 4px 12px color-mix(in srgb, ${fg} 35%, transparent)` : 'none',
                      lineHeight: 1,
                    }}
                    onMouseDown={e => e.preventDefault()}
                    title={selected ? `Selected · click to unselect` : `Set Hired by to ${name}`}
                  >
                    {selected && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                    <span>{name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="pc-cm-sec"><span>Payment</span></div>

        {/* PayPal + Zelle (2-col) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="pc-field"><label>PayPal</label><input className="pc-input" placeholder="email" value={f.paypal} onChange={e => set('paypal', e.target.value)} /></div>
          <div className="pc-field"><label>Zelle</label><input className="pc-input" placeholder="email / phone" value={f.zelle} onChange={e => set('zelle', e.target.value)} /></div>
        </div>

        {err && (
          /* WURX-ADJUSTED · a hook to test against. It had only inline styles,
             so a check could not tell "the save was refused with a reason" from
             "the save silently did nothing" — which is the whole difference. */
          <div data-wx="save-error" style={{ background: 'var(--pc-error-bg)', color: 'var(--pc-error-fg)', borderRadius: 12, padding: '10px 13px', fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{err}</div>
        )}

        </div>{/* /pc-cm-body */}

        {/* ── Sticky footer · live deal summary + actions ── */}
        <div className="pc-cf-foot">
          <div className="pc-cm-summary">
            {f.name.trim() ? (
              <>
                <b>{f.name.trim()}</b>
                {f.brand.trim() && <> × <b>{f.brand.trim()}</b></>}
                {(Number(f.amount) > 0 || Number(f.videos_count) > 0) && (
                  <span className="pc-cm-summary-deal">
                    {Number(f.amount) > 0 ? fmt$Exact(Number(f.amount)) : ''}
                    {Number(f.amount) > 0 && Number(f.videos_count) > 0 ? ' / ' : ''}
                    {Number(f.videos_count) > 0 ? `${f.videos_count} videos` : ''}
                  </span>
                )}
                {rate != null && <span className="pc-cm-summary-rate">{fmt$Exact(Math.round(rate))}/video</span>}
              </>
            ) : <span className="pc-cm-summary-hint">Fill in the creator's details</span>}
          </div>
          {!isAdd && mayDelete && onDelete && (
            <button
              className={`pc-btn pc-modal-del ${confirmDel ? 'arm' : ''}`}
              disabled={saving || deleting}
              onClick={async () => {
                if (!confirmDel) {
                  setConfirmDel(true);
                  setTimeout(() => setConfirmDel(false), 3500);   // auto-disarm
                  return;
                }
                setDeleting(true);
                try { await onDelete(c.id); onClose(); }
                catch (e) { setErr(e?.message || 'Delete failed'); setDeleting(false); setConfirmDel(false); }
              }}
              title={confirmDel ? 'Click again to permanently delete' : `Delete ${c.name || 'creator'} · permanent, takes this deal and its videos with it`}
            >
              {deleting ? 'Deleting…' : confirmDel ? 'Confirm delete?' : 'Delete'}
            </button>
          )}
          <button className="pc-btn pc-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="pc-btn pc-btn-primary" onClick={save} disabled={saving || !f.name.trim() || !f.brand.trim()}>{saving ? 'Saving…' : (isAdd ? 'Add creator' : 'Save changes')}</button>
        </div>
      </div>
    </div>
  );
}

/* ════════ CREATOR VIDEOS POPUP · Afflix CreatorExpand pattern
   Opens when clicking a creator in BrandDrilldown.
   Editable list: video URL · ad code (copy-able) · authorized checkbox
   Saves to creators.video_codes JSONB via Supabase with debounced auto-save.
════════ */
function CreatorVideosPopup({ creator: c, onUpdateCreator, onEdit, onClose }) {
  const committed = parseDealVideos(c.deal) || 1;
  const initialRowCount = Math.max(committed, Array.isArray(c.video_codes) ? c.video_codes.length : 0, 1);
  const [codes, setCodes] = useState(() => {
    const existing = Array.isArray(c.video_codes) ? c.video_codes : [];
    // Spread the existing row FIRST · preserves EUKA metric fields
    // (views/revenue/items/product/thumb) through manual edits + saves.
    return Array.from({ length: initialRowCount }, (_, i) => ({
      ...(existing[i] || {}),
      video: existing[i]?.video || '',
      adCode: existing[i]?.adCode || '',
      auth: !!existing[i]?.auth,
      date: existing[i]?.date || '',
    }));
  });
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState('');
  const [copiedIdx, setCopiedIdx] = useState(-1);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkErr, setBulkErr] = useState('');
  /* WURX-ADDED · '' is every video; 'YYYY-MM-DD' is the videos posted that day. */
  const [dayFilter, setDayFilter] = useState('');
  const debounce = useRef(null);
  const latest = useRef(codes);
  const dirty = useRef(false);
  const saving = useRef(false);

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  // Re-sync from props when the source row updates externally (realtime sync)
  // But never while user has unsaved edits or save in flight · would clobber their input.
  useEffect(() => {
    if (dirty.current || saving.current) return;
    const existing = Array.isArray(c.video_codes) ? c.video_codes : [];
    const rc = Math.max(committed, existing.length, 1);
    const synced = Array.from({ length: rc }, (_, i) => ({
      ...(existing[i] || {}),
      video: existing[i]?.video || '',
      adCode: existing[i]?.adCode || '',
      auth: !!existing[i]?.auth,
      date: existing[i]?.date || '',
    }));
    setCodes(synced);
    latest.current = synced;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.video_codes]);

  const isValidUrl = (s) => /^https?:\/\//i.test((s || '').trim());

  const persist = async (next) => {
    dirty.current = false;
    saving.current = true;
    setSaveState('saving');
    setSaveError('');
    // Auto-sync c.videos status flag from delivery progress
    const committed = parseDealVideos(c.deal) || 0;
    const filledNow = next.filter(v => v?.video && String(v.video).trim()).length;
    const patch = { video_codes: next };
    if (committed > 0 && filledNow >= committed && c.videos !== 'Done') {
      patch.videos = 'Done';
    } else if (committed > 0 && filledNow < committed && c.videos === 'Done') {
      patch.videos = 'In Progress';
    }
    try {
      if (onUpdateCreator) {
        // Uses App.js optimistic local update + supabase persist; throws on error
        await onUpdateCreator(c.id, patch);
      } else {
        // Fallback to direct supabase, with .select() so we know the write took effect
        const { data, error } = await supabase
          .from('creators')
          .update(patch)
          .eq('id', c.id)
          .select('id');
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('Row not found or write blocked by RLS');
      }
      saving.current = false;
      setSaveState('saved');
      setTimeout(() => setSaveState(s => s === 'saved' ? 'idle' : s), 1800);
    } catch (e) {
      saving.current = false;
      setSaveState('idle');
      setSaveError(e?.message || 'Save failed');
    }
  };

  // Bulk paste · accepts multi-line input. Each line can be:
  //   - just a TikTok URL
  //   - just an ad code (#abc=)
  //   - URL + code separated by space / tab / comma
  // Strategy: fill the first empty rows; extend the list with new rows after that.
  const handleBulkParse = () => {
    setBulkErr('');
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { setBulkErr('Paste at least one line.'); return; }

    const parsed = [];
    for (const line of lines) {
      const parts = line.split(/[\s,;\t]+/).filter(Boolean);
      let video = '', adCode = '';
      for (const p of parts) {
        if (/^https?:\/\//i.test(p)) video = p;
        else if (p.startsWith('#') && p.endsWith('=')) adCode = p;
        else if (!video && p.toLowerCase().includes('tiktok.com')) video = p;
      }
      if (video || adCode) parsed.push({ video, adCode, auth: false });
    }
    if (parsed.length === 0) { setBulkErr('Could not parse any videos or ad codes from that text.'); return; }

    // Count duplicates that the paste introduces · against existing list + within
    // the parsed batch itself. Doesn't block: we still add them so the row-level
    // red flag tells the user which ones to fix.
    const existingKeys = new Map();
    latest.current.forEach(r => {
      const k = videoKey(r.video);
      if (k) existingKeys.set(k, (existingKeys.get(k) || 0) + 1);
    });
    let dupesIntroduced = 0;
    parsed.forEach(p => {
      const k = videoKey(p.video);
      if (!k) return;
      const seen = existingKeys.get(k) || 0;
      if (seen >= 1) dupesIntroduced++;
      existingKeys.set(k, seen + 1);
    });

    const next = [...latest.current];
    let i = 0, idx = 0;
    // First pass · fill empty rows
    while (i < next.length && idx < parsed.length) {
      if (!next[i].video && !next[i].adCode) next[i] = { ...next[i], ...parsed[idx++] };
      i++;
    }
    // Second pass · extend with any leftover parsed entries
    while (idx < parsed.length) next.push(parsed[idx++]);

    dirty.current = true;
    latest.current = next;
    setCodes(next);
    setBulkText('');
    setBulkOpen(false);
    setDayFilter('');   // WURX-ADDED · pasted rows have no date yet; a filter would hide them
    if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
    persist(next);
    if (dupesIntroduced > 0) {
      setSaveError(`Added ${parsed.length} entries · ${dupesIntroduced} duplicate${dupesIntroduced === 1 ? '' : 's'} flagged in red below.`);
      setTimeout(() => setSaveError(''), 5000);
    }
  };

  const change = (idx, field, value) => {
    dirty.current = true;
    setCodes(prev => {
      const next = prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row));
      latest.current = next;
      if (debounce.current) clearTimeout(debounce.current);
      // Tighter debounce so the brand-level "X/Y delivered" tile + status pill reflect input
      // almost as fast as the user can paste · optimistic update is instant after this fires.
      debounce.current = setTimeout(() => persist(next), 350);
      return next;
    });
  };

  const flush = () => {
    if (!dirty.current) return;
    if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
    persist(latest.current);
  };

  const toggleAuth = (idx) => {
    dirty.current = true;
    setCodes(prev => {
      const next = prev.map((row, i) => (i === idx ? { ...row, auth: !row.auth } : row));
      latest.current = next;
      if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
      persist(next);
      return next;
    });
  };

  const copyCode = async (i, code) => {
    try { await navigator.clipboard.writeText(code); setCopiedIdx(i); setTimeout(() => setCopiedIdx(x => x === i ? -1 : x), 1400); } catch {}
  };

  // Add N blank rows to the end. No persist · blank rows don't need saving;
  // they save when the user types into them.
  const addRows = (n = 1) => {
    setDayFilter('');   // WURX-ADDED · a new row has no date, so a day filter would hide it
    setCodes(prev => {
      const next = [...prev, ...Array.from({ length: n }, () => ({ video: '', adCode: '', auth: false }))];
      latest.current = next;
      return next;
    });
    // Scroll the list to the bottom so the new row is visible
    setTimeout(() => {
      const list = document.querySelector('.pc-vx-scroll');
      if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }, 0);
  };

  // Remove an empty extra row (never deletes data; never drops below committed)
  const removeRow = (idx) => {
    setCodes(prev => {
      const r = prev[idx];
      if (r?.video || r?.adCode || r?.auth) return prev;
      if (prev.length <= Math.max(committed, 1)) return prev;
      const next = prev.filter((_, i) => i !== idx);
      latest.current = next;
      dirty.current = true;
      if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
      persist(next);
      return next;
    });
  };

  const filledCount = codes.filter(v => isValidUrl(v.video)).length;
  const total = codes.length;
  const pct = total ? filledCount / total : 0;
  const complete = total > 0 && filledCount === total;
  const adCount = codes.filter(v => (v.adCode || '').trim()).length;
  const authCount = codes.filter(v => v.auth).length;
  const allAuth = adCount > 0 && authCount === adCount;
  const initials = (c.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  const handle = c.tiktok_account ? tiktokHandle(c.tiktok_account) : '';
  const RING = 2 * Math.PI * 19;

  const isEmpty = (r) => !r?.video && !r?.adCode && !r?.auth;

  // Duplicate-video detection. Normalise URL → comparable key so the same TikTok
  // video pasted in different forms (with/without www, http/https, trailing
  // slash, m.tiktok.com) collapses to one key.
  const videoKey = (url) => {
    if (!url) return '';
    const s = String(url).trim().toLowerCase().replace(/\/+$/, '');
    if (!s) return '';
    const idMatch = s.match(/\/video\/(\d+)/);
    if (idMatch) return `vid:${idMatch[1]}`;          // canonical TikTok video id
    return `url:${s.replace(/^https?:\/\//, '').replace(/^(www\.|m\.)/, '')}`;
  };
  const dupKeys = useMemo(() => {
    const counts = new Map();
    codes.forEach(r => {
      const k = videoKey(r.video);
      if (!k) return;
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    const out = new Set();
    counts.forEach((n, k) => { if (n > 1) out.add(k); });
    return out;
  }, [codes]);
  const dupCount = useMemo(() => {
    let n = 0;
    codes.forEach(r => { if (dupKeys.has(videoKey(r.video))) n++; });
    return n;
  }, [codes, dupKeys]);

  /*
   * WURX-ADDED · SEE ONE DAY'S VIDEOS.
   *
   * Rashid, 2026-09-15: "let them view the videos of a certain date … today
   * or … any date". The date is the POSTED date EUKA reports, written onto
   * each row by the sweep as YYYY-MM-DD — 89% of saved videos carry one.
   *
   * The other 11% are links pasted before EUKA has matched them, and a day
   * filter can never show those. So the bar SAYS how many are undated rather
   * than letting a day look emptier than it is.
   *
   * The list is filtered, never re-indexed: every row keeps its position in
   * `codes`, so an edit or a tick made while filtered lands on the right video.
   * "Today" is the viewer's own calendar day.
   */
  const dayOf = (r) => String(r?.date || '').slice(0, 10);
  const localDay = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const today = localDay(0);
  const yesterday = localDay(-1);
  const shortDay = (d) => { const [, m, dd] = d.split('-'); return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(dd, 10)}`; };
  const dayCounts = useMemo(() => {
    const m = new Map();
    codes.forEach(r => {
      if (!isValidUrl(r.video)) return;
      const d = dayOf(r);
      if (d) m.set(d, (m.get(d) || 0) + 1);
    });
    return m;
  }, [codes]);
  const undated = codes.filter(r => isValidUrl(r.video) && !dayOf(r)).length;
  const latestDay = [...dayCounts.keys()].sort().pop() || '';
  const visibleRows = codes
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => !dayFilter || dayOf(row) === dayFilter);
  const pickedOther = Boolean(dayFilter) && dayFilter !== today && dayFilter !== yesterday;

  return createPortal(
    <div className="pc-overlay pc-vx-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pc-vx-modal" onClick={e => e.stopPropagation()}>

        {/* ── Sticky header ── */}
        <header className="pc-vx-modal-head">
          <div className="pc-vx-title">
            <span className="pc-vx-mono">{initials}</span>
            <div className="pc-vx-titletext">
              <div className="pc-vx-h">Videos &amp; Ad Codes</div>
              <div className="pc-vx-sub">{c.name}{handle ? <> · <span className="pc-vx-sub-h">{handle}</span></> : ''}</div>
            </div>
          </div>
          <div className="pc-vx-actions">
            <span className={`pc-savestate ${saveState === 'saved' ? 'saved' : ''}`}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}</span>
            {adCount > 0 && (
              <span className={`pc-vx-authtally ${allAuth ? 'done' : ''}`} title="Ad codes authorised">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                {authCount}/{adCount} auth
              </span>
            )}
            <span className={`pc-vx-posted ${complete ? 'done' : ''}`} title={`${filledCount} of ${total} videos posted`}>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              <b>{filledCount}</b><span className="pc-vx-posted-slash">/{total}</span>
              <span className="pc-vx-posted-lbl">posted</span>
            </span>
            {dupCount > 0 && (
              <span className="pc-vx-dupe-chip" title={`${dupCount} duplicate video URL${dupCount === 1 ? '' : 's'} found in this list`}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v4"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/>
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                </svg>
                <b>{dupCount}</b>
                <span>duplicate{dupCount === 1 ? '' : 's'}</span>
              </span>
            )}
            <button
              className={`pc-btn pc-btn-ghost pc-btn-sm pc-vx-bulk-tog${bulkOpen ? ' on' : ''}`}
              onClick={() => { setBulkOpen(v => !v); setBulkErr(''); }}
              title="Paste multiple videos & ad codes at once"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 3 }}>
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Bulk
            </button>
            {onEdit && (
              <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={onEdit} title="Edit creator details">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 3 }}>
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Edit
              </button>
            )}
            <button onClick={onClose} title="Close" aria-label="Close" className="pc-iconbtn" style={{ width: 34, height: 34, fontSize: 14 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {/* Inline progress bar */}
          <div className={`pc-vx-progress ${complete ? 'done' : ''}`} aria-hidden>
            <div className="pc-vx-progress-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>

          {saveError && <div className="pc-vx-save-err">{saveError}</div>}
        </header>

        {/* ── Bulk paste panel (collapsible) ── */}
        {bulkOpen && (
          <div className="pc-vx-bulk-wrap">
            <div className="pc-vx-bulk">
              <div className="pc-vx-bulk-head">
                <div>
                  <div className="pc-vx-bulk-t">Paste multiple entries</div>
                  <div className="pc-vx-bulk-s">
                    One per line · TikTok URL and ad code on the same line, separated by space, comma, or tab. Either field optional.
                  </div>
                </div>
              </div>
              <textarea
                className="pc-vx-bulk-ta"
                rows={5}
                placeholder={'https://www.tiktok.com/@user/video/123  #abc=\nhttps://www.tiktok.com/@user/video/456  #xyz=\n…'}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                autoFocus
              />
              {bulkErr && <div className="pc-vx-bulk-err">{bulkErr}</div>}
              <div className="pc-vx-bulk-acts">
                <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => { setBulkOpen(false); setBulkText(''); setBulkErr(''); }}>Cancel</button>
                <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={handleBulkParse} disabled={!bulkText.trim()}>Parse &amp; Add</button>
              </div>
            </div>
          </div>
        )}

        {/* WURX-ADDED · posted-day filter */}
        <div className="pc-vx-days" role="group" aria-label="Show the videos posted on one day">
          <span className="pc-vx-days-lbl">Posted</span>
          <button type="button" className={`pc-vx-day ${!dayFilter ? 'on' : ''}`} aria-pressed={!dayFilter} onClick={() => setDayFilter('')}>
            All <b>{filledCount}</b>
          </button>
          <button type="button" className={`pc-vx-day ${dayFilter === today ? 'on' : ''}`} aria-pressed={dayFilter === today} onClick={() => setDayFilter(today)}>
            Today <b>{dayCounts.get(today) || 0}</b>
          </button>
          <button type="button" className={`pc-vx-day ${dayFilter === yesterday ? 'on' : ''}`} aria-pressed={dayFilter === yesterday} onClick={() => setDayFilter(yesterday)}>
            Yesterday <b>{dayCounts.get(yesterday) || 0}</b>
          </button>
          <label className={`pc-vx-daypick ${pickedOther ? 'on' : ''}`} title="Pick any day">
            <input type="date" value={dayFilter} max={today} onChange={e => setDayFilter(e.target.value)} aria-label="Pick a day" />
            {pickedOther && <b>{dayCounts.get(dayFilter) || 0}</b>}
          </label>
          {undated > 0 && (
            <span className="pc-vx-days-note" title="Links EUKA has not matched to a posted date yet. No day filter can show these.">
              {undated} without a posted date yet
            </span>
          )}
        </div>

        {/* ── Sticky column labels ── */}
        <div className="pc-vx-collabels">
          <span />
          <span>Video URL</span>
          <span>Ad code</span>
          <span className="pc-vx-cl-auth">Auth</span>
          <span />
        </div>

        {/* ── Scrollable list ── */}
        <div className="pc-vx-scroll">
          <div className="pc-vx-list">
            {dayFilter && visibleRows.length === 0 && (
              <div className="pc-vx-dayempty">
                No videos posted on {formatHireDate(dayFilter)}.
                {latestDay && latestDay !== dayFilter && (
                  <> The latest posted day is{' '}
                    <button type="button" className="pc-vx-daylink" onClick={() => setDayFilter(latestDay)}>{formatHireDate(latestDay)}</button>.
                  </>
                )}
                {undated > 0 && <> {undated} video{undated === 1 ? ' has' : 's have'} no posted date yet.</>}
              </div>
            )}
            {visibleRows.map(({ row, i }) => {
              const vOk = isValidUrl(row.video);
              const isDup = vOk && dupKeys.has(videoKey(row.video));
              const canDelete = isEmpty(row) && codes.length > Math.max(committed, 1) && i >= committed;
              return (
                <div className={`pc-vx-row ${vOk ? 'done' : ''} ${isDup ? 'dup' : ''}`} key={i}>
                  <span className="pc-vx-num" title={isDup ? 'Duplicate of another video in this list' : undefined}>{
                    isDup
                      ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg>
                      : vOk
                        ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        : i + 1
                  }</span>
                  <label className={`pc-vx-inp ${row.video && !vOk ? 'bad' : ''} ${isDup ? 'dup' : ''}`} title={isDup ? 'This TikTok video is already in the list above' : undefined}>
                    <span className="pc-vx-inp-ico"><svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M8 5v14l11-7z" /></svg></span>
                    <input placeholder="Paste TikTok video URL" value={row.video} onChange={e => change(i, 'video', e.target.value)} onBlur={flush} />
                    {isDup && <span className="pc-vx-dupe-pill" title="Duplicate video">DUPE</span>}
                    {!isDup && dayOf(row) && (
                      <span className="pc-vx-daytag" title={`Posted ${formatHireDate(dayOf(row))}`}>{shortDay(dayOf(row))}</span>
                    )}
                  </label>
                  <label className="pc-vx-inp pc-vx-inp-ad">
                    <span className="pc-vx-inp-ico">#</span>
                    <input placeholder="ad code" value={row.adCode} onChange={e => change(i, 'adCode', e.target.value)} onBlur={flush} />
                    {row.adCode ? (
                      <button type="button" className={`pc-vx-copy ${copiedIdx === i ? 'ok' : ''}`} title="Copy ad code" onClick={e => { e.preventDefault(); copyCode(i, row.adCode); }}>
                        {copiedIdx === i
                          ? <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                          : <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
                      </button>
                    ) : null}
                  </label>
                  <button type="button" className={`pc-vx-auth ${row.auth ? 'on' : ''}`} role="checkbox" aria-checked={row.auth}
                    title={row.auth ? 'Ad code authorised · click to unmark' : 'Mark ad code authorised'} onClick={() => toggleAuth(i)}>
                    {row.auth && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                  </button>
                  {canDelete ? (
                    <button type="button" className="pc-vx-del" onClick={() => removeRow(i)} title="Remove this empty row" aria-label="Remove empty row">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6M14 11v6"/>
                      </svg>
                    </button>
                  ) : (
                    <a className="pc-vx-open" href={vOk ? row.video : undefined} target="_blank" rel="noreferrer" aria-disabled={!vOk} title="Open video">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Sticky footer · add rows + tally ── */}
        <footer className="pc-vx-modal-foot">
          <div className="pc-vx-foot-left">
            <button className="pc-btn pc-btn-ghost pc-btn-sm pc-vx-addbtn" onClick={() => addRows(1)} title="Add one empty row">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add row
            </button>
            <button className="pc-btn pc-btn-ghost pc-btn-sm pc-vx-addbtn" onClick={() => addRows(5)} title="Add 5 rows">+5</button>
            <button className="pc-btn pc-btn-ghost pc-btn-sm pc-vx-addbtn" onClick={() => addRows(10)} title="Add 10 rows">+10</button>
          </div>
          <div className="pc-vx-foot-right">
            <span className="pc-vx-foot-tally">
              <b>{filledCount}</b><span className="pc-vx-foot-of"> / {total}</span> posted
              {complete && <span className="pc-vx-foot-done">· all done</span>}
            </span>
          </div>
        </footer>

      </div>
    </div>,
    wxPortalHost()
  );
}

/* ════════ NOTES DRAWER ════════ */
function NotesDrawer({ brand, month, initial, onSaved, onClose }) {
  const [notes, setNotes] = useState(initial || '');
  const [savedStatus, setSavedStatus] = useState('');
  const tRef = useRef(null);

  useEffect(() => {
    if (notes === initial) return;
    setSavedStatus('⟳ Saving…');
    clearTimeout(tRef.current);
    tRef.current = setTimeout(async () => {
      try {
        const { data, error: selErr } = await supabase.from('brand_monthly_budgets').select('id').eq('brand', brand).eq('month', month).limit(1);
        if (selErr) throw selErr;
        if (data && data[0]) {
          const { error } = await supabase.from('brand_monthly_budgets').update({ notes, updated_at: new Date().toISOString() }).eq('id', data[0].id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('brand_monthly_budgets').insert([{ brand, month, notes }]);
          if (error) throw error;
        }
        if (onSaved) { try { await onSaved(); } catch {} }
        setSavedStatus('Saved');
        setTimeout(() => setSavedStatus(''), 1500);
      } catch (e) {
        setSavedStatus(e?.message || 'Failed');
      }
    }, 600);
    return () => clearTimeout(tRef.current);
  }, [notes, brand, month, initial, onSaved]);

  return createPortal(
    <div className="pc-overlay" style={{ justifyContent: 'flex-end', padding: 0 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: '100%', maxWidth: 440, height: '100%', background: 'white', display: 'flex', flexDirection: 'column', animation: 'pc-rise 0.28s var(--pc-ease, cubic-bezier(0.33,1,0.68,1))' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--pc-divider)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="pc-ava" style={{ background: gradFor(brand) }}>{initial.length ? initial[0].toUpperCase() : brand[0]?.toUpperCase()}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.3px' }}>{brand}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pc-text-2)' }}>{monthLabel(month)} · notes</div>
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--pc-text-2)' }}>{savedStatus}</span>
          <button onClick={onClose} className="pc-iconbtn" aria-label="Close"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Strategy notes, content angles, must-mention points…"
          style={{ flex: 1, padding: 22, border: 0, outline: 'none', fontSize: 14, fontFamily: 'inherit', resize: 'none', color: 'var(--pc-text)', background: 'white' }}
        />
      </div>
    </div>,
    wxPortalHost()
  );
}

/* ════════ CREATORS TAB ════════ */
/* "2025-08-20" → Aug 20 with a small, quiet '25.
   The year only matters when scanning across years, so it is present but
   never competes with the day for attention. */
function HireDate({ d }) {
  const p = godDateParts(d);
  if (!p) return <span className="pc-handle">-</span>;
  return <span className="pc-hdate">{p.main}{p.year && <i>{p.year}</i>}</span>;
}

/* Every place that renders from God Mode settings subscribes here, so a
   change in the panel repaints the table instead of waiting for a reload. */
function useGod() {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump(v => v + 1);
    window.addEventListener('wurx-god-changed', on);
    return () => window.removeEventListener('wurx-god-changed', on);
  }, []);
  return godGet();
}

function CreatorsTab({ creators, allCreators, allTime, month, eukaL30, onSetCreatorStatus, onUpdateCreator, onEditCreator }) {
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [videosCreatorId, setVideosCreatorId] = useState(null);
  // Filter state — null means "all"
  const [statusFilter, setStatusFilter]     = useState(null);  // 'pending' | 'progress' | 'sent' | null
  const [hiredByFilter, setHiredByFilter]   = useState(null);  // 'Aris' | 'Emily' | 'Myles' | 'Khushi' | null
  const [tierFilter, setTierFilter]         = useState(null);  // 'L0'..'L5' | 'none' (unmatched) | null
  /* How many DEALS one person is on. Asad's team asked for it as "how many
     creators do we have on 1 deal, on 2, on 3" — a retention question, not a
     row question, so it counts PEOPLE and filters ROWS. */
  const [dealsFilter, setDealsFilter]       = useState(null);  // 1, 2, 3 … | null
  /* WURX-ADDED · Rashid, 2026-09-18: "we also need to have filter so users can
     filter creators on follower". Buckets rather than a number box: the question
     is "who is big enough for this brief", and nobody knows whether they mean
     40,000 or 50,000. 'none' is its own answer — Euka has no profile for that
     handle, which is not the same as a small following. */
  const [followersFilter, setFollowersFilter] = useState(null); // '1m'|'100k'|'10k'|'under10k'|'none'|null
  const [filterOpen, setFilterOpen]         = useState(false);
  const filterRef                            = useRef(null);

  // Close popover on outside click / Esc
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e) => { if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false); };
    const onKey  = (e) => { if (e.key === 'Escape') setFilterOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [filterOpen]);

  const activeFilterCount = (statusFilter ? 1 : 0) + (hiredByFilter ? 1 : 0) + (tierFilter ? 1 : 0) + (dealsFilter ? 1 : 0)
    + (followersFilter ? 1 : 0);   /* WURX-ADDED */

  // Precomputed lowercase haystack per creator · rebuilt only when data changes,
  // so each search keystroke is a cheap Map lookup instead of string-building.
  const searchable = useMemo(() => {
    const m = new Map();
    creators.forEach(c => m.set(c.id,
      `${c.name || ''} ${c.brand || ''} ${c.category || ''} ${c.tiktok_account || ''} ${c.tiktok_account_2 || ''} ${c.email || ''} ${c.whatsapp_number || ''}`.toLowerCase()
    ));
    return m;
  }, [creators]);

  /*
   * DEALS PER PERSON, keyed by name exactly the way the Unique Creators list
   * keys them. Two places counting "collabs" by different keys would disagree
   * on screen, and the number people would trust is whichever they saw last.
   *
   * Counted from the WHOLE tab scope, never from the filtered list: a count
   * that shrinks as you filter cannot answer "how many are on two deals".
   */
  /*
   * ONE TIER PER PERSON, and the count and the filter read the SAME map.
   *
   * Their own comment already says it — "their tier is a property of the
   * person, not the deal, so it must only count once" — but only the COUNT
   * obeyed it. The filter tested every row on its own, so a person whose two
   * deal rows disagree (a handle typed on one row and not the other) was
   * counted once by the chip and matched twice by the filter.
   *
   * Invisible while the chips were decoration. The moment they became filters
   * it showed: the L2 chip said 20 and produced 23 creators. A control whose
   * label does not predict its result is worse than no control.
   *
   * Built from the WHOLE list, not the filtered one, so a person's tier does
   * not change depending on what else is selected.
   */
  /* WURX-ADDED · followers per PERSON, largest across their handles and rows,
     so the filter and the column agree about one human being. */
  const wxStoredFollowers = wxAdsHook().storedFollowers;
  const wxFollowersByPerson = useMemo(() => {
    const m = new Map();
    creators.forEach((c) => {
      const k = (c.name || '').trim().toLowerCase();
      if (!k) return;
      const n = wxFollowersOf(eukaL30, wxStoredFollowers, [c.tiktok_account, c.tiktok_account_2]).n;
      if (n > (m.get(k) || 0)) m.set(k, n);
    });
    return m;
  }, [creators, eukaL30, wxStoredFollowers]);
  /* WURX-END */

  const tierByPerson = useMemo(() => {
    const m = new Map();
    creators.forEach((c) => {
      const k = (c.name || '').trim().toLowerCase();
      if (!k || m.get(k)) return;              // first row that knows a tier wins
      const t = creatorTier(c, eukaL30);
      if (t) m.set(k, t);
    });
    return m;
  }, [creators, eukaL30]);

  /* WURX-ADDED · deals in the month on screen, across every brand. Not
     dealsByPerson below: that one counts the rows in THIS TAB's view, which the
     search and the filters narrow too, because it drives the deals filter. */
  const wxDealsMonth = allTime ? '' : month;
  const wxDealsNow = useMemo(() => wxDealsByPerson(allCreators || creators, wxDealsMonth), [allCreators, creators, wxDealsMonth]);
  /* WURX-END */
  const dealsByPerson = useMemo(() => {
    const m = new Map();
    creators.forEach((c) => {
      const k = (c.name || '').trim().toLowerCase();
      if (!k) return;
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  }, [creators]);

  /* How many PEOPLE sit on exactly n deals, ascending. Every count that really
     occurs gets a chip — no "4+" bucket, because "how many are on seven" is a
     question somebody will eventually ask and a bucket cannot answer it. */
  const dealTally = useMemo(() => {
    const t = new Map();
    for (const n of dealsByPerson.values()) t.set(n, (t.get(n) || 0) + 1);
    return [...t.entries()].sort((a, b) => a[0] - b[0]);
  }, [dealsByPerson]);

  const filtered = useMemo(() => {
    let list = creators;
    if (statusFilter)   list = list.filter(c => statusOf(c) === statusFilter);
    if (hiredByFilter)  list = list.filter(c => (c.hired_by || '').trim() === hiredByFilter);
    if (tierFilter) {
      list = list.filter(c => {
        const t = tierByPerson.get((c.name || '').trim().toLowerCase());
        return tierFilter === 'none' ? !t : t === tierFilter;
      });
    }
    if (dealsFilter) {
      list = list.filter(c => dealsByPerson.get((c.name || '').trim().toLowerCase()) === dealsFilter);
    }
    /* WURX-ADDED · followers. Read per PERSON, like the tier filter above, so
       somebody with two rows cannot be in one bucket on one and another on the
       next. */
    if (followersFilter) {
      list = list.filter(c => wxFollowerBucket(wxFollowersByPerson.get((c.name || '').trim().toLowerCase())) === followersFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(c => (searchable.get(c.id) || '').includes(q));
  }, [creators, search, statusFilter, hiredByFilter, tierFilter, dealsFilter, followersFilter,
      dealsByPerson, tierByPerson, wxFollowersByPerson, eukaL30, searchable]);

  // All-time: collapse to a single bucket so the status dividers below group
  // EVERY creator (across every month) into one Pending / Progress / Sent
  // section. Month filter: single bucket of that month's creators — the inner
  // status grouping then splits it.
  const grouped = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => (b.hiring_date || '').localeCompare(a.hiring_date || ''));
    if (allTime) return [{ key: 'all', label: 'All time', rows: sorted }];
    return [{ key: month, label: monthLabel(month), rows: sorted }];
  }, [filtered, allTime, month]);

  const [showUnique, setShowUnique] = useState(false);
  /* re-read on the God Mode signal so column and format changes land
     without a reload */
  const god = useGod();
  const uniqueCount = useMemo(() => {
    const set = new Set();
    filtered.forEach(c => set.add((c.name || '').trim().toLowerCase()));
    return set.size;
  }, [filtered]);

  // Selection helpers
  const allSelected = filtered.length > 0 && filtered.every(c => sel.has(c.id));
  const toggle = (id) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAllVisible = () => setSel(prev => {
    const n = new Set(prev);
    if (allSelected) filtered.forEach(c => n.delete(c.id));
    else filtered.forEach(c => n.add(c.id));
    return n;
  });
  const clearSel = () => setSel(new Set());

  const copyUsernames = async () => {
    if (!canExport()) return;
    const handles = new Set();
    creators.filter(c => sel.has(c.id)).forEach(c => {
      [c.tiktok_account, c.tiktok_account_2].forEach(t => {
        if (t) {
          const h = tiktokHandle(t).replace(/^@/, '').trim();
          if (h) handles.add(h);
        }
      });
    });
    try { await navigator.clipboard.writeText([...handles].join('\n')); } catch {}
  };

  const setStatus = async (id, patch) => {
    if (onSetCreatorStatus) return onSetCreatorStatus(id, patch);
    try { await supabase.from('creators').update(patch).eq('id', id); } catch (e) { alert('Update failed: ' + e.message); }
  };

  // ── Bulk action handlers ──
  // Each loops over the currently selected creators and applies the patch.
  // Uses onSetCreatorStatus when available so App-level optimistic updates fire,
  // otherwise falls back to direct supabase write.
  const [bulkMenu, setBulkMenu] = useState(null);     // 'status' | 'hired_by' | null
  const [bulkBusy, setBulkBusy] = useState(false);

  const bulkApply = async (patch) => {
    if (bulkBusy) return;
    /* Marking paid needs the capability their own access model defines for
       it. Was a hardcoded check against the username "asad". */
    if (patch && patch.payment_status === 'Paid' && !canMarkPaid()) {
      alert('You do not have permission to mark a creator paid.');
      return;
    }
    setBulkBusy(true);
    const ids = [...sel];
    try {
      if (onSetCreatorStatus) {
        await Promise.all(ids.map(id => onSetCreatorStatus(id, patch)));
      } else {
        await supabase.from('creators').update(patch).in('id', ids);
      }
      logAudit({ action: 'bulk.update', target_type: 'creator', target_id: ids.join(','), target_label: ids.length + ' creator(s)', changes: { patch } });
    } catch (e) { alert('Bulk update failed: ' + e.message); }
    setBulkBusy(false);
    setBulkMenu(null);
  };
  const bulkMarkPaid     = () => bulkApply({ payment_status: 'Paid' });
  const bulkSetStatus    = (state) => bulkApply(
    state === 'sent'    ? { payment_status: 'Paid' } :
    state === 'pending' ? { payment_status: 'Not Yet', videos: 'Done' } :
                          { payment_status: 'Not Yet', videos: 'In Progress' }
  );
  const bulkSetHiredBy   = (name) => bulkApply({ hired_by: name });

  // Export selected (or filtered if no selection) to CSV
  const exportCsv = () => {
    if (!canExport()) return;
    const rows = sel.size > 0 ? creators.filter(c => sel.has(c.id)) : filtered;
    if (rows.length === 0) return;
    /* L30 GMV comes from creatorL30, the SAME helper the Unique Creators list
       exports and the screen renders, so the three can never disagree. It is
       EUKA's last-30-days figure for that creator, not a month total and not
       the sheet's typed GMV — see the note in docs about the three sources. */
    const headers = ['Name', 'TikTok', 'Brand', 'Category', 'Deal', 'Amount', 'Videos', 'L30 GMV', 'Payment Status', 'Hired By', 'Hired Date', 'Email', 'WhatsApp', 'PayPal', 'Zelle'];
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    rows.forEach(c => {
      lines.push([
        c.name || '', c.tiktok_account || '', c.brand || '', c.category || '',
        c.deal || '', parseDealAmount(c.deal) || '', parseDealVideos(c.deal) || '',
        Math.round(creatorL30(c, eukaL30) || 0) || '',
        c.payment_status || '', c.hired_by || '', c.hiring_date || '',
        c.email || '', fmtPhone(c.whatsapp_number), c.paypal || '', c.zelle || '',
      ].map(esc).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `wurx-creators-${today}-${rows.length}rows.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* Export one row per PERSON, for outreach lists.
     The main CSV is deal-shaped — a creator working four brands is four
     rows there. This collapses them to one, keeping the best contact
     details found on any of their records and the average rate they were
     actually paid per video. */
  const exportUniqueCsv = () => {
    if (!canExport()) return;
    const src = sel.size > 0 ? creators.filter(c => sel.has(c.id)) : filtered;
    if (!src.length) return;

    const people = new Map();
    src.forEach(c => {
      const key = creatorDedupKey(c);
      if (!key) return;
      if (!people.has(key)) {
        people.set(key, { name: '', handles: new Set(), contact: '', email: '', amount: 0, videos: 0 });
      }
      const p = people.get(key);
      // keep the fullest version of the name
      const nm = String(c.name || '').trim();
      if (nm.length > p.name.length) p.name = nm;
      [c.tiktok_account, c.tiktok_account_2].forEach(t => {
        if (!t) return;
        const h = tiktokHandle(t).replace(/^@/, '').trim();
        if (h) p.handles.add(h);
      });
      if (!p.contact) {
        const ph = fmtPhone(c.whatsapp_number);
        if (ph) p.contact = ph;
      }
      if (!p.email) {
        const em = String(c.email || '').trim();
        if (em) p.email = em;
      }
      // rate per video is averaged over every deal that states both figures
      const amt = parseDealAmount(c.deal) || 0;
      const vids = parseDealVideos(c.deal) || 0;
      if (amt > 0 && vids > 0) { p.amount += amt; p.videos += vids; }
    });

    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [['Name', 'Username', 'Contact', 'Rate per video', 'Email'].join(',')];
    [...people.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(p => {
        const rate = p.videos > 0 ? Math.round((p.amount / p.videos) * 100) / 100 : '';
        lines.push([
          p.name,
          [...p.handles].map(h => '@' + h).join(' · '),
          p.contact,
          rate,
          p.email,
        ].map(esc).join(','));
      });

    // BOM so Excel opens @handles and accents correctly
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wurx-unique-creators-${shopToday()}-${people.size}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };

  // Live look-up so popup edits reflect immediately
  const videosCreator = videosCreatorId ? creators.find(c => c.id === videosCreatorId) : null;

  // EUKA creator-tier distribution · computed BEFORE the tier filter itself
  // so the pill/filter counts always reflect the full (status/hiredBy/search)
  // selection, not collapse to one number once a tier is picked.
  const listForTierCounts = useMemo(() => {
    let list = creators;
    if (statusFilter)  list = list.filter(c => statusOf(c) === statusFilter);
    if (hiredByFilter) list = list.filter(c => (c.hired_by || '').trim() === hiredByFilter);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(c => (searchable.get(c.id) || '').includes(q));
  }, [creators, search, statusFilter, hiredByFilter, searchable]);

  // Count DISTINCT CREATORS per tier, not deal rows — the same person can
  // have several deal rows (one per brand collab), and their tier is a
  // property of the person, not the deal, so it must only count once.
  const tierCounts = useMemo(() => {
    const out = {};
    const seen = new Set();
    let matched = 0;
    listForTierCounts.forEach(c => {
      const key = (c.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const t = tierByPerson.get(key);
      if (t) { out[t] = (out[t] || 0) + 1; matched += 1; }
    });
    if (!matched && !eukaL30) return null;   // nothing known yet · hide the pill
    return { out, matched, total: seen.size };
  }, [eukaL30, listForTierCounts, tierByPerson]);

  /* WURX-ADDED · how many PEOPLE sit in each followers bucket, counted over the
     same scope the tier chips use, so the numbers beside the two filters mean
     the same thing. */
  const wxFollowerCounts = useMemo(() => {
    const out = {};
    const seen = new Set();
    listForTierCounts.forEach((c) => {
      const k = (c.name || '').trim().toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      const b = wxFollowerBucket(wxFollowersByPerson.get(k));
      out[b] = (out[b] || 0) + 1;
    });
    return out;
  }, [listForTierCounts, wxFollowersByPerson]);
  /* WURX-END */

  return (
    <>
      {/* KPI pills */}
      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <KpiPill label="Unique Creators" value={uniqueCount}
          title="Open the list · one row per person"
          onClick={() => setShowUnique(true)} />
        <KpiPill label="Total Deals" value={filtered.length} />
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/*
            * THESE READ AS FILTERS, SO THEY ARE FILTERS.
            *
            * They were spans: six tier counts sitting at the top of the screen
            * that looked exactly like the pills everywhere else in this app and
            * did nothing when pressed. The filter they imply already existed —
            * buried in the Filter popover — so this wires the obvious control
            * to the state that was already there rather than adding a second
            * way to say the same thing.
            */}
          {tierCounts && (
            <span className="pc-tierpill" title={`${tierCounts.matched}/${tierCounts.total} matched to an EUKA creator profile · click a tier to filter`}>
              <span className="pc-tierpill-l">EUKA Tiers</span>
              {['L0', 'L1', 'L2', 'L3', 'L4', 'L5'].filter(t => tierCounts.out[t] > 0).map(t => (
                <button
                  key={t}
                  type="button"
                  className={`pc-tierpill-chip ${t.toLowerCase()}${tierFilter === t ? ' on' : ''}`}
                  aria-pressed={tierFilter === t}
                  title={tierFilter === t ? `Showing ${t} only · click to clear` : `Show only ${t}`}
                  onClick={() => setTierFilter(tierFilter === t ? null : t)}
                >{t}<b>{tierCounts.out[t]}</b></button>
              ))}
              {tierCounts.total - tierCounts.matched > 0 && (
                <button
                  type="button"
                  className={`pc-tierpill-chip none${tierFilter === 'none' ? ' on' : ''}`}
                  aria-pressed={tierFilter === 'none'}
                  title={tierFilter === 'none' ? 'Showing unmatched only · click to clear' : 'Show only creators with no EUKA match'}
                  onClick={() => setTierFilter(tierFilter === 'none' ? null : 'none')}
                >Unmatched<b>{tierCounts.total - tierCounts.matched}</b></button>
              )}
            </span>
          )}

          {/*
            * DEALS PER PERSON, as chips rather than a dropdown, because the
            * COUNT is half the answer: "how many creators are on two deals"
            * is readable without pressing anything, and pressing narrows to
            * them. A dropdown would hide the number being asked for.
            */}
          {dealTally.length > 0 && (
            <span className="pc-tierpill" title="How many people are on this many deals · click to filter">
              <span className="pc-tierpill-l">Deals</span>
              {dealTally.map(([n, people]) => (
                <button
                  key={n}
                  type="button"
                  className={`pc-tierpill-chip deals${dealsFilter === n ? ' on' : ''}`}
                  aria-pressed={dealsFilter === n}
                  title={`${people} creator${people === 1 ? '' : 's'} on ${n} deal${n === 1 ? '' : 's'}`}
                  onClick={() => setDealsFilter(dealsFilter === n ? null : n)}
                >{n}&times;<b>{people}</b></button>
              ))}
            </span>
          )}
        </span>
      </div>

      {/* Toolbar · search + filter + count */}
      <div className="pc-toolbar" style={{ marginTop: 14 }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search creators, brands, categories…" />

        {/* Filter button + popover */}
        <div ref={filterRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setFilterOpen(o => !o)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              height: 36, padding: '0 14px',
              borderRadius: 999,
              background: filterOpen || activeFilterCount > 0 ? 'var(--pc-accent-light)' : 'var(--pc-card-2)',
              color: filterOpen || activeFilterCount > 0 ? 'var(--pc-accent)' : 'var(--pc-text-2)',
              border: `1px solid ${activeFilterCount > 0 ? 'color-mix(in srgb, var(--pc-accent) 30%, transparent)' : 'var(--pc-divider)'}`,
              fontSize: 12.5, fontWeight: 700, letterSpacing: '-0.1px',
              cursor: 'pointer', transition: 'background .15s, color .15s, border-color .15s',
              lineHeight: 1,
            }}
            title="Filter creators by status and Hired by"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filter
            {activeFilterCount > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 18, height: 18, padding: '0 6px', borderRadius: 99,
                background: 'var(--pc-accent)', color: 'var(--wx-text-muted)',
                fontSize: 10.5, fontWeight: 800, lineHeight: 1,
              }}>{activeFilterCount}</span>
            )}
          </button>

          {filterOpen && (() => {
            // Neutral pill style — same look for every filter section. Active =
            // dark filled, inactive = light bg with quiet text. No color noise.
            const pillBase = {
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 28, padding: '0 12px', borderRadius: 8,
              fontSize: 11.5, fontWeight: 600, letterSpacing: '-0.05px',
              cursor: 'pointer', lineHeight: 1,
              transition: 'background .12s, color .12s, border-color .12s',
              fontFamily: 'inherit',
            };
            const pill = (active) => ({
              ...pillBase,
              background: active ? '#1F2937' : 'transparent',
              color:      active ? '#fff'    : 'var(--pc-text-2)',
              border:     `1px solid ${active ? '#1F2937' : 'var(--pc-divider)'}`,
            });
            const sectionTitle = {
              fontSize: 10, fontWeight: 700, color: 'var(--pc-text-3)',
              textTransform: 'uppercase', letterSpacing: 0.7,
              marginBottom: 8,
            };
            const sectionGap = { marginBottom: 14 };
            const checkSvg = (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            );

            return (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                width: 340, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
                background: 'var(--pc-card)',
                border: '1px solid var(--pc-divider)',
                borderRadius: 12,
                boxShadow: '0 18px 50px rgba(15,23,42,0.10), 0 4px 12px rgba(15,23,42,0.05)',
                padding: '16px 16px 14px',
                zIndex: 100,
                animation: 'pc-rise .18s var(--pc-ease)',
              }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid var(--pc-divider)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pc-text)', letterSpacing: '-0.15px' }}>Filters</div>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={() => { setStatusFilter(null); setHiredByFilter(null); setTierFilter(null); setDealsFilter(null); setFollowersFilter(null); }}
                      style={{ background: 'transparent', border: 0, color: 'var(--pc-text-3)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '2px 6px', borderRadius: 6 }}
                    >
                      Reset all
                    </button>
                  )}
                </div>

                {/* Payment Status */}
                <div style={sectionGap}>
                  <div style={sectionTitle}>Payment Status</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {[
                      { key: null,       label: 'All' },
                      { key: 'pending',  label: 'Payment Pending' },
                      { key: 'progress', label: 'Videos in Progress' },
                      { key: 'sent',     label: 'Payment Sent' },
                    ].map(opt => {
                      const active = statusFilter === opt.key;
                      return (
                        <button key={opt.key || 'all'} type="button" onClick={() => setStatusFilter(opt.key)} style={pill(active)}>
                          {active && checkSvg}{opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Hired By */}
                <div style={sectionGap}>
                  <div style={sectionTitle}>Hired By</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    <button type="button" onClick={() => setHiredByFilter(null)} style={pill(hiredByFilter === null)}>
                      {hiredByFilter === null && checkSvg}All
                    </button>
                    {HIRED_BY_OPTIONS.map(name => {
                      const active = hiredByFilter === name;
                      return (
                        <button key={name} type="button" onClick={() => setHiredByFilter(active ? null : name)} style={pill(active)}>
                          {active && checkSvg}{name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* WURX-ADDED · Followers */}
                <div style={sectionGap}>
                  <div style={sectionTitle}>Followers</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    <button type="button" onClick={() => setFollowersFilter(null)} style={pill(followersFilter === null)}>
                      {followersFilter === null && checkSvg}All
                    </button>
                    {WX_FOLLOWER_BUCKETS.filter(b => (wxFollowerCounts[b.key] || 0) > 0).map(b => {
                      const active = followersFilter === b.key;
                      return (
                        <button key={b.key} type="button" onClick={() => setFollowersFilter(active ? null : b.key)} style={pill(active)}
                          title={b.key === 'none' ? 'Neither EUKA\'s shop data nor a lookup by handle has a follower count for these creators yet. Lookups keep running in the background.' : undefined}>
                          {active && checkSvg}{b.label} · {wxFollowerCounts[b.key]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* WURX-END */}

                {/* EUKA Tier */}
                {tierCounts && (
                  <div style={{ marginBottom: 2 }}>
                    <div style={sectionTitle}>EUKA Tier</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      <button type="button" onClick={() => setTierFilter(null)} style={pill(tierFilter === null)}>
                        {tierFilter === null && checkSvg}All
                      </button>
                      {['L0', 'L1', 'L2', 'L3', 'L4', 'L5'].filter(t => tierCounts.out[t] > 0).map(t => {
                        const active = tierFilter === t;
                        return (
                          <button key={t} type="button" onClick={() => setTierFilter(active ? null : t)} style={pill(active)}>
                            {active && checkSvg}{t} · {tierCounts.out[t]}
                          </button>
                        );
                      })}
                      {tierCounts.total - tierCounts.matched > 0 && (
                        <button type="button" onClick={() => setTierFilter(tierFilter === 'none' ? null : 'none')} style={pill(tierFilter === 'none')}>
                          {tierFilter === 'none' && checkSvg}Unmatched · {tierCounts.total - tierCounts.matched}
                        </button>
                      )}
                    </div>
                  </div>
                )}

              </div>
            );
          })()}
        </div>

      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="creators" title="No creators in this period" text={search ? 'Try a different search' : 'Pick a different month or enable All time'} />
      ) : (
        <div className="pc-card">
          {/* Sticky table header · 12 columns (added Hired By at right) */}
          <div className="pc-cv-head" style={{ gridTemplateColumns: colTemplate(god), textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {canSelectRows() && <input type="checkbox" checked={allSelected} onChange={toggleAllVisible} onClick={e => e.stopPropagation()} style={{ width: 16, height: 16, cursor: 'pointer' }} />}
            </div>
            {visibleCols(god).map(c => <div key={c.id}>{c.label}</div>)}
          </div>

          {grouped.map(g => {
            // Sub-group rows by status (Pending → Progress → Sent). In all-time
            // mode that means every creator collapses into one of three status
            // sections regardless of hire month. With a month filter on, it's
            // just that month's rows split the same way.
            const statusGroups = groupByStatus(g.rows);
            const showStatusDivider = statusGroups.length > 1;
            return (
              <React.Fragment key={g.key}>
                {statusGroups.map((sg, sgi) => {
                  const offset = statusGroups.slice(0, sgi).reduce((s, x) => s + x.items.length, 0);
                  return (
                    <React.Fragment key={sg.key}>
                      {showStatusDivider && (
                        <div className={`pc-ct-divider pc-ct-divider-${sg.key}`} aria-hidden>
                          <span className="pc-ct-divider-line" />
                          <span className="pc-ct-divider-label">
                            {sg.label}
                            <span className="pc-ct-divider-count">{sg.items.length}</span>
                          </span>
                          <span className="pc-ct-divider-line" />
                        </div>
                      )}
                      {sg.items.map((c, i) => (
                        <CreatorsTabRow
                          key={c.id}
                          c={c}
                          idx={offset + i + 1}
                          selected={sel.has(c.id)}
                          euka={eukaL30}
                          deals={wxDealsNow.get(wxPersonKey(c)) || 0}
                          dealsMonth={wxDealsMonth}
                          onToggle={() => toggle(c.id)}
                          onOpen={() => setVideosCreatorId(c.id)}
                          onSetStatus={setStatus}
                        />
                      ))}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {showUnique && (
        <UniqueCreatorsModal rows={filtered} euka={eukaL30} onClose={() => setShowUnique(false)} />
      )}

      {/* Bulk action bar · floating bottom pill */}
      {sel.size > 0 && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'var(--pc-card)', padding: '8px 10px', borderRadius: 999,
          boxShadow: '0 18px 50px rgba(0,0,0,0.20), 0 2px 10px rgba(0,0,0,0.08)',
          border: '1px solid var(--pc-divider)', zIndex: 2000,
          animation: 'pc-rise 0.28s var(--pc-ease)',
          opacity: bulkBusy ? 0.6 : 1,
          pointerEvents: bulkBusy ? 'none' : 'auto',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 32, padding: '0 12px', borderRadius: 999,
            background: 'var(--pc-accent)', color: 'white',
            fontSize: 12.5, fontWeight: 700,
          }}>
            <span style={{ minWidth: 18, height: 18, borderRadius: 999, background: 'color-mix(in srgb, var(--wx-surface-1) 25%, transparent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>{sel.size}</span>
            selected
          </span>

          {/* Mark Paid · anyone with canEditPay */}
          {canMarkPaid() && (
            <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={bulkMarkPaid} title="Mark all selected as Paid">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M20 6 9 17l-5-5"/></svg>
              Mark Paid
            </button>
          )}

          {canEditStatus() && <>
          {/* Status menu */}
          <div style={{ position: 'relative' }}>
            <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => setBulkMenu(m => m === 'status' ? null : 'status')} title="Set status for all selected">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/></svg>
              Status
            </button>
            {bulkMenu === 'status' && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
                background: 'var(--pc-card)', border: '1px solid var(--pc-divider)',
                borderRadius: 12, padding: 6, minWidth: 180,
                boxShadow: '0 12px 32px rgba(15,23,42,0.12)',
                display: 'flex', flexDirection: 'column', gap: 2,
                animation: 'pc-rise .15s var(--pc-ease)',
              }}>
                {[
                  { k: 'pending',  l: 'Payment Pending' },
                  { k: 'progress', l: 'Videos in Progress' },
                  ...(canMarkPaid() ? [{ k: 'sent', l: 'Payment Sent' }] : []),
                ].map(opt => (
                  <button key={opt.k} type="button" onClick={() => bulkSetStatus(opt.k)} style={{
                    background: 'transparent', border: 0, cursor: 'pointer',
                    padding: '8px 10px', borderRadius: 8, textAlign: 'left',
                    fontSize: 12.5, fontWeight: 600, color: 'var(--pc-text)',
                    transition: 'background .12s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--pc-card-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >{opt.l}</button>
                ))}
              </div>
            )}
          </div>

          {/* Hired By menu */}
          <div style={{ position: 'relative' }}>
            <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => setBulkMenu(m => m === 'hired_by' ? null : 'hired_by')} title="Reassign Hired By for all selected">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Hired By
            </button>
            {bulkMenu === 'hired_by' && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
                background: 'var(--pc-card)', border: '1px solid var(--pc-divider)',
                borderRadius: 12, padding: 6, minWidth: 160,
                boxShadow: '0 12px 32px rgba(15,23,42,0.12)',
                display: 'flex', flexDirection: 'column', gap: 2,
                animation: 'pc-rise .15s var(--pc-ease)',
              }}>
                {HIRED_BY_OPTIONS.map(name => {
                  const { fg, bg } = hiredByPalette(name);
                  return (
                    <button key={name} type="button" onClick={() => bulkSetHiredBy(name)} style={{
                      background: 'transparent', border: 0, cursor: 'pointer',
                      padding: '7px 10px', borderRadius: 8, textAlign: 'left',
                      fontSize: 12.5, fontWeight: 600, color: 'var(--pc-text)',
                      display: 'flex', alignItems: 'center', gap: 8,
                      transition: 'background .12s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--pc-card-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 999, background: bg, color: fg, fontSize: 10.5, fontWeight: 800, lineHeight: 1 }}>{name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          </>}

          {canExport() && <>
          {/* Export CSV · every selected row, deal by deal */}
          <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={exportCsv} title="Export the selected rows to CSV · one row per deal, all fields">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            CSV
          </button>

          {/* Export unique people · outreach list */}
          <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={exportUniqueCsv} title="Export unique creators · one row per person with name, username, contact, rate per video and email">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
            Unique CSV
          </button>

          {/* Copy usernames */}
          <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={copyUsernames} title="Copy unique TikTok usernames">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
          </button>
          </>}

          <button className="pc-iconbtn" onClick={() => { clearSel(); setBulkMenu(null); }} title="Clear selection" style={{ width: 32, height: 32 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {videosCreator && (
        <CreatorVideosPopup
          creator={videosCreator}
          onUpdateCreator={onUpdateCreator}
          onEdit={onEditCreator ? () => { onEditCreator(videosCreator); setVideosCreatorId(null); } : null}
          onClose={() => setVideosCreatorId(null)}
        />
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   DISCOVERY · sourcing pool from EUKA
   ────────────────────────────────────────────────────────────────────
   Self-contained by design: it fetches its own data (euka ?type=discovery)
   only when opened, keeps its own cache key, and writes nothing back —
   so it cannot affect Brands / Creators / Performance / Reporting.

   Pool = every contactable creator across our EUKA stores, MINUS everyone
   already in our own database. EUKA exposes no per-creator category, so
   each row shows the store(s) they surfaced on as the vertical hint.
   ════════════════════════════════════════════════════════════════════ */
const DISCOVERY_CK = 'wurx_discovery_v3';    // v2 · multi-window sweep (v1 held the capped 1000-per-store pool)
const DISCOVERY_TTL = 6 * 60 * 60 * 1000;   // 6 h · roster barely moves

/* ── Outreach marks · SHARED across the team ───────────────────────────
   Stored in Supabase so everyone sees who has already been messaged —
   one persistent row per creator handle in activity_logs
   (action='DISCOVERY_MARK', target=handle, details={color}). That table
   is the only writable store available to this key, and the Logs viewer
   filters these rows out so the audit feed stays clean.

   localStorage is kept purely as an offline mirror for instant paint. */
const DISCOVERY_MARK_KEY = 'wurx_discovery_marks_v1';
const getDiscoveryMarks = _lsMapReader(DISCOVERY_MARK_KEY);

async function fetchDiscoveryMarks() {
  /* Paged · a .limit() above 1000 is silently clamped by the server, so
     once outreach passes a thousand marks a plain limit would quietly stop
     returning the older ones. */
  const { data, error } = await selectAll(() => supabase
    .from('activity_logs')
    .select('id,target,details,user_display,created_at')
    .eq('action', 'DISCOVERY_MARK')
    .order('target', { ascending: true }));
  if (error) throw error;
  const map = {};
  (data || []).forEach(row => {
    const h = String(row.target || '').toLowerCase().trim();
    /* One row per handle is enforced by a partial unique index now, so there
       are no duplicates to pick between. The guard stays because a map is
       cheap and a wrong mark is somebody messaging a creator twice. */
    if (!h || map[h]) return;
    const color = row.details && row.details.color;
    if (!color) return;
    map[h] = { color, by: row.user_display || '', at: row.created_at, id: row.id };
  });
  return map;
}

async function saveDiscoveryMark(handle, colorId, actor) {
  const h = String(handle || '').toLowerCase().trim();
  if (!h) return;

  /*
   * ═══ THE DELETE USED TO RUN FIRST, WITH NOTHING TO ROLL IT BACK ═══
   *
   * "Clear any existing, then insert the new state" — two requests with a
   * network between them. Change a mark from Messaged to Under review and lose
   * the connection in the gap, and the mark is simply gone: not reverted, not
   * reported, gone. The row that stops the team messaging the same creator
   * twice. And the UI would then restore the old colour it had just destroyed,
   * so the screen disagreed with the database until somebody reloaded.
   *
   * There is one row per handle now, enforced by a partial unique index, so
   * setting a mark is an UPDATE, and only an INSERT when there is nothing to
   * update. No delete in that path at all.
   *
   * Last write wins on the colour itself, deliberately: a mark is one small
   * value that somebody is choosing on purpose by clicking a swatch, and
   * refusing their click because a colleague clicked first would be worse than
   * accepting it. What must never happen is the value vanishing, and that is
   * what this removes.
   */
  const who = {
    user_id: String(actor?.id || 'unknown'),
    user_display: actor?.display || actor?.username || 'Unknown',
  };

  /* Clearing a mark is deliberate, and there is nothing to preserve. */
  if (!colorId) {
    const { error } = await supabase.from('activity_logs')
      .delete().eq('action', 'DISCOVERY_MARK').eq('target', h);
    if (error) throw error;
    return;
  }

  const stamp = new Date().toISOString();
  const row = { details: { color: colorId }, updated_at: stamp, ...who };

  const upd = await supabase.from('activity_logs')
    .update(row).eq('action', 'DISCOVERY_MARK').eq('target', h).select('id');
  if (upd.error) throw upd.error;
  if (upd.data && upd.data.length) return;

  /* Nothing to update, so this handle has never been marked. */
  const ins = await supabase.from('activity_logs')
    .insert({ action: 'DISCOVERY_MARK', target: h, ...row });
  if (!ins.error) return;

  /* 23505 means somebody marked the same creator between our update and our
     insert — which is exactly the race the unique index exists to catch.
     Their row is there; write ours over it rather than failing the click. */
  if (ins.error.code === '23505') {
    const retry = await supabase.from('activity_logs')
      .update(row).eq('action', 'DISCOVERY_MARK').eq('target', h);
    if (retry.error) throw retry.error;
    return;
  }
  throw ins.error;
}

/* Outreach states a creator can be marked with. Dropping an entry here also
   drops its filter button and its swatch in the mark menu · any row already
   saved under a removed id keeps its activity_logs record but reads as
   unmarked, so remove one only when that is intended. */
const MARK_COLORS = [
  { id: 'sent',    label: 'Messaged',       hex: '#0E7A3A' },
  { id: 'follow',  label: 'Follow up',      hex: '#D97706' },
  { id: 'warm',    label: 'Interested',     hex: '#8B5CF6' },
  { id: 'review',  label: 'Under review',   hex: '#0E7490' },
  { id: 'reject',  label: 'Rejected',       hex: '#BE185D' },
];

function DiscoveryTab({ creators, currentUser }) {
  const [pool, setPool] = useState(null);        // { people, stores, fetchedAt }
  const [state, setState] = useState('idle');    // idle | loading | done | error
  const [progress, setProgress] = useState('');
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState(null);
  const [contactFilter, setContactFilter] = useState('any');  // any | phone | email
  const [minFollowers, setMinFollowers] = useState(0);
  const [sortKey, setSortKey] = useState('gmv');
  const [copied, setCopied] = useState('');
  /* how many rows Discovery paints at a time · God Mode owns the default */
  const [limit, setLimit] = useState(() => Number(godGet().discoverySize) || 40);
  /* marks · localStorage mirror paints instantly, DB is the truth */
  const [marks, setMarks] = useState(() => getDiscoveryMarks());
  const [markOpen, setMarkOpen] = useState('');
  const [markPos, setMarkPos] = useState(null);   // viewport coords for the portalled menu      // handle whose palette is open
  const [markFilter, setMarkFilter] = useState('all'); // all | unmarked | <colorId>
  const [byFilter, setByFilter] = useState('all');     // all | <teammate name>
  const [markErr, setMarkErr] = useState('');
  const ranRef = useRef(false);

  // pull the shared marks whenever the tab mounts, then keep in sync
  useEffect(() => {
    let alive = true;
    fetchDiscoveryMarks()
      .then(m => { if (!alive) return; setMarks(m); getDiscoveryMarks.write(m); })
      .catch(() => { /* offline → keep the mirrored copy */ });
    return () => { alive = false; };
  }, []);

  // realtime · another teammate marking someone shows up here without a refresh
  useEffect(() => {
    const ch = supabase
      .channel('discovery-marks')
      .on('postgres_changes', { event: '*', schema: 'wurxbase', table: 'activity_logs', filter: 'action=eq.DISCOVERY_MARK' }, () => {
        fetchDiscoveryMarks().then(m => { setMarks(m); getDiscoveryMarks.write(m); }).catch(() => {});
      })
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, []);

  const setMark = async (handle, colorId) => {
    setMarkOpen('');
    setMarkErr('');
    const prev = marks;
    // optimistic · the row recolours immediately
    const next = { ...marks };
    if (colorId) next[handle] = { color: colorId, by: currentUser?.display || currentUser?.username || 'You', at: new Date().toISOString() };
    else delete next[handle];
    setMarks(next);
    getDiscoveryMarks.write(next);
    try {
      await saveDiscoveryMark(handle, colorId, currentUser);
    } catch (e) {
      setMarks(prev);
      getDiscoveryMarks.write(prev);
      setMarkErr(`Could not save mark: ${e?.message || 'unknown error'}`);
      setTimeout(() => setMarkErr(''), 5000);
    }
  };

  /* handles we already work with · excluded from the pool */
  const ownedHandles = useMemo(() => {
    const s = new Set();
    (creators || []).forEach(c => {
      [c.tiktok_account, c.tiktok_account_2].map(_normEukaHandle).filter(Boolean).forEach(h => s.add(h));
    });
    return s;
  }, [creators]);

  const load = useCallback(async (force) => {
    if (state === 'loading') return;
    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(DISCOVERY_CK));
        if (cached && cached.people && Date.now() - cached.fetchedAt < DISCOVERY_TTL) { setPool(cached); setState('done'); return; }
      } catch { /* corrupt → refetch */ }
    }
    setState('loading');
    setProgress('Finding stores…');
    try {
      const meta = await eukaJson();
      if (!meta || !Array.isArray(meta.stores)) throw new Error('Could not reach EUKA');

      /* creator_level caps at 1000 rows per call and ignores pagination,
         but each DATE WINDOW returns a different slice of the roster — one
         Penetrex window gives 1000 creators, five windows give 4,421. So
         sweep back through ~14 months in 2-month windows and union them. */
      const iso = (d) => d.toISOString().slice(0, 10);
      const windows = [];
      let cur = new Date(); cur.setUTCHours(0, 0, 0, 0);
      for (let i = 0; i < 7; i++) {
        const start = new Date(cur); start.setUTCDate(start.getUTCDate() - 60);
        windows.push({ from: iso(start), to: iso(cur) });
        cur = new Date(start); cur.setUTCDate(cur.getUTCDate() - 1);
      }

      const people = {};
      const jobs = [];
      meta.stores.forEach(s => windows.forEach(w => jobs.push({ s, w })));
      const totalJobs = jobs.length;
      let done = 0;

      const absorb = (storeName, map) => {
        Object.entries(map).forEach(([h, p]) => {
          const c = people[h];
          if (!c) { people[h] = { ...p, stores: [storeName] }; return; }
          // same person from another store/window · keep the strongest figures
          if ((p.gmv || 0) > (c.gmv || 0)) { c.gmv = p.gmv; if (p.tier) c.tier = p.tier; }
          if (!c.tier && p.tier) c.tier = p.tier;
          if (!c.email && p.email) c.email = p.email;
          if (!c.phone && p.phone) c.phone = p.phone;
          if ((p.followers || 0) > (c.followers || 0)) c.followers = p.followers;
          if ((p.avgViews || 0) > (c.avgViews || 0)) c.avgViews = p.avgViews;
          if (p.postRate != null && c.postRate == null) c.postRate = p.postRate;
          if (p.sampled) c.sampled = true;
          if (p.posted) c.posted = true;
          if (!c.stores.includes(storeName)) c.stores.push(storeName);
        });
      };

      const queue = [...jobs];
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const { s, w } = queue.shift();
          try {
            const d = await eukaJson({ store: s.id, type: 'discovery', from: w.from, to: w.to });
            if (d && d.people) absorb(s.name, d.people);
          } catch { /* one window failing shouldn't kill the pool */ }
          done += 1;
          setProgress(`Building pool… ${done}/${totalJobs} · ${Object.keys(people).length.toLocaleString()} creators found`);
          // show results as they land rather than a long blank wait
          if (done % 6 === 0 || done === totalJobs) {
            setPool({ people: { ...people }, fetchedAt: Date.now() });
            setState(done === totalJobs ? 'done' : 'partial');
          }
        }
      }));

      const payload = { people, fetchedAt: Date.now() };
      setPool(payload);
      setState('done');
      try { localStorage.setItem(DISCOVERY_CK, JSON.stringify(payload)); } catch { /* quota → session-only */ }
    } catch (e) {
      setState('error');
      setProgress(e?.message || 'Failed to load');
    }
  }, [state]);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    load(false);
  }, [load]);

  /* pool → rows, EVERY filter except the tier one.
     Tier is applied separately below so the tier tally can be counted here:
     counting it after the tier filter meant picking L3 collapsed the tally to
     just L3 and every other tier button vanished, so you had to go back
     through "All" to reach L4. */
  const baseRows = useMemo(() => {
    if (!pool || !pool.people) return [];
    const q = search.trim().toLowerCase();
    const out = [];
    Object.entries(pool.people).forEach(([h, p]) => {
      if (ownedHandles.has(h)) return;                       // already ours
      if (contactFilter === 'phone' && !p.phone) return;
      if (contactFilter === 'email' && !p.email) return;
      if (minFollowers && (p.followers || 0) < minFollowers) return;
      if (q && !h.includes(q) && !(p.stores || []).some(s => s.toLowerCase().includes(q))) return;
      if (markFilter === 'unmarked' && marks[h]) return;
      if (markFilter !== 'all' && markFilter !== 'unmarked' && marks[h]?.color !== markFilter) return;
      if (byFilter !== 'all' && (marks[h]?.by || '') !== byFilter) return;
      out.push({ handle: h, ...p });
    });
    const by = {
      gmv: (a, b) => (b.gmv || 0) - (a.gmv || 0),
      followers: (a, b) => (b.followers || 0) - (a.followers || 0),
      views: (a, b) => (b.avgViews || 0) - (a.avgViews || 0),
      rate: (a, b) => (b.postRate ?? -1) - (a.postRate ?? -1),
    };
    return out.sort(by[sortKey] || by.gmv);
  }, [pool, ownedHandles, search, contactFilter, minFollowers, sortKey, markFilter, byFilter, marks]);

  const rows = useMemo(
    () => (tierFilter ? baseRows.filter(r => r.tier === tierFilter) : baseRows),
    [baseRows, tierFilter]);

  /* counted over baseRows · every tier button stays visible and keeps its
     real count while one tier is selected, so you can hop L3 → L4 directly */
  const tierTally = useMemo(() => {
    const t = {};
    baseRows.forEach(r => { if (r.tier) t[r.tier] = (t[r.tier] || 0) + 1; });
    return t;
  }, [baseRows]);

  /* how many creators sit in each outreach state · counted over the whole
     pool, not the filtered slice, so the numbers do not vanish the moment
     one of these filters is applied */
  /* who on the team has marked how many · drives the "Marked by" filter
     and is counted over the whole pool so the numbers stay put */
  const byTally = useMemo(() => {
    const t = {};
    Object.entries(marks).forEach(([h, m]) => {
      if (m && m.color && m.by && !ownedHandles.has(h)) t[m.by] = (t[m.by] || 0) + 1;
    });
    return t;
  }, [marks, ownedHandles]);

  const markTally = useMemo(() => {
    const t = {};
    Object.entries(marks).forEach(([h, m]) => {
      if (m && m.color && !ownedHandles.has(h)) t[m.color] = (t[m.color] || 0) + 1;
    });
    return t;
  }, [marks, ownedHandles]);

  const copyVal = async (key, val) => {
    try { await navigator.clipboard.writeText(val); setCopied(key); setTimeout(() => setCopied(c => (c === key ? '' : c)), 1400); } catch {}
  };

  const exportCsv = () => {
    if (!canExport()) return;
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [['Handle', 'Tier', 'Followers', 'Avg views', 'L30 GMV', 'Post rate %', 'Phone', 'Email', 'Seen on', 'Sampled', 'Posted', 'Outreach', 'Marked by'].map(esc).join(',')];
    rows.forEach(r => lines.push([
      '@' + r.handle, r.tier || '', r.followers || 0, r.avgViews || 0, Math.round(r.gmv || 0),
      r.postRate != null ? r.postRate : '', r.phone || '', r.email || '',
      (r.stores || []).join(' · '), r.sampled ? 'yes' : 'no', r.posted ? 'yes' : 'no',
      (MARK_COLORS.find(m => m.id === marks[r.handle]?.color) || {}).label || '',
      marks[r.handle]?.by || '',
    ].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `discovery-creators-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const visible = rows.slice(0, limit);
  const totalPool = pool && pool.people ? Object.keys(pool.people).length : 0;
  const ready = state === 'done' || state === 'partial';

  /* headline numbers for the filtered slice */
  const stats = useMemo(() => {
    let phone = 0, high = 0, gmv = 0, marked = 0;
    rows.forEach(r => {
      if (r.phone) phone += 1;
      if (['L3', 'L4', 'L5', 'L6'].includes(r.tier)) high += 1;
      gmv += r.gmv || 0;
      if (marks[r.handle]) marked += 1;
    });
    return { phone, high, gmv, marked };
  }, [rows, marks]);

  return (
    <>
      <div className="pc-ddhero pc-disc-hero">
        <div className="pc-ddhero-top">
          <span className="pc-disc-ico" aria-hidden>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </span>
          <div className="pc-dd-info">
            <h2 className="pc-dd-title">Discovery</h2>
            <div className="pc-dd-sub">
              Creators reachable through our EUKA stores who are not in the database yet
            </div>
          </div>
          <div className="pc-dd-actions">
            {rows.length > 0 && canExport() && (
              <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={exportCsv} title="Download the filtered list as CSV">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Export CSV
              </button>
            )}
            <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => load(true)} disabled={state === 'loading'}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
              {state === 'loading' ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="pc-ddhero-stats">
          <div className="pc-stat pc-stat-blue">
            <span className="pc-stat-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" fill="currentColor" fillOpacity="0.15" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg></span>
            <span className="pc-stat-body">
              <span className="pc-stat-label">Matching</span>
              <span className="pc-stat-value">{rows.length.toLocaleString()}</span>
              <span className="pc-stat-sub">of {totalPool.toLocaleString()} in pool</span>
            </span>
          </div>
          <div className="pc-stat pc-stat-green">
            <span className="pc-stat-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg></span>
            <span className="pc-stat-body">
              <span className="pc-stat-label">With phone</span>
              <span className="pc-stat-value">{stats.phone.toLocaleString()}</span>
              <span className="pc-stat-sub">rest are email only</span>
            </span>
          </div>
          <div className="pc-stat pc-stat-purple">
            <span className="pc-stat-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" fillOpacity="0.15" /></svg></span>
            <span className="pc-stat-body">
              <span className="pc-stat-label">L3 and above</span>
              <span className="pc-stat-value">{stats.high.toLocaleString()}</span>
              <span className="pc-stat-sub">proven sellers</span>
            </span>
          </div>
          <div className="pc-stat pc-stat-amber">
            <span className="pc-stat-ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="currentColor" fillOpacity="0.15" /></svg></span>
            <span className="pc-stat-body">
              <span className="pc-stat-label">Contacted</span>
              <span className="pc-stat-value">{stats.marked.toLocaleString()}</span>
              <span className="pc-stat-sub">shared with the team</span>
            </span>
          </div>
        </div>
      </div>

      {(state === 'loading' || state === 'partial') && (
        <div className="pc-card pc-disc-loading">
          <span className="pc-vxp-livedot" />
          {progress || 'Loading…'}
        </div>
      )}
      {state === 'error' && (
        <div className="pc-card pc-disc-loading err">Could not load the pool · {progress}</div>
      )}
      {markErr && (
        <div className="pc-card pc-disc-loading err">{markErr}</div>
      )}

      {ready && (
        <>
          <div className="pc-disc-filters">
            {/* labelled like every other control · without its own label the
                search box was 15px shorter and sat off the shared baseline */}
            <div className="pc-disc-group pc-disc-group-search">
              <span className="pc-disc-glabel">Search</span>
              <SearchBox value={search} onChange={setSearch} placeholder="Search handle or store…" />
            </div>
            <div className="pc-disc-group">
              <span className="pc-disc-glabel">Contact</span>
              <div className="pc-disc-seg">
                {[['any', 'Any'], ['phone', 'Phone'], ['email', 'Email']].map(([k, label]) => (
                  <button key={k} className={`pc-disc-segbtn ${contactFilter === k ? 'on' : ''}`} onClick={() => setContactFilter(k)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="pc-disc-group">
              <span className="pc-disc-glabel">Tier</span>
              <div className="pc-disc-seg">
                <button className={`pc-disc-segbtn ${!tierFilter ? 'on' : ''}`} onClick={() => setTierFilter(null)}>All</button>
                {/* built from the tiers actually present · EUKA issues L0 through
                    L7 and a fixed L1-L6 list silently hid the very top sellers */}
                {[...new Set([...Object.keys(tierTally), tierFilter].filter(Boolean))]
                  .sort()
                  .map(t => (
                  <button key={t} className={`pc-disc-segbtn ${tierFilter === t ? 'on' : ''}`} onClick={() => setTierFilter(tierFilter === t ? null : t)}>
                    {t}{tierTally[t] ? <b className="pc-disc-segn">{tierTally[t]}</b> : null}
                  </button>
                ))}
              </div>
            </div>
            <div className="pc-disc-group">
              <span className="pc-disc-glabel">Followers</span>
              <div className="pc-disc-seg">
                {[[0, 'Any'], [10000, '10K+'], [50000, '50K+'], [100000, '100K+']].map(([n, label]) => (
                  <button key={n} className={`pc-disc-segbtn ${minFollowers === n ? 'on' : ''}`} onClick={() => setMinFollowers(n)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="pc-disc-group">
              <span className="pc-disc-glabel">Sort by</span>
              <div className="pc-disc-seg">
                {[['gmv', 'GMV'], ['followers', 'Followers'], ['views', 'Views'], ['rate', 'Post rate']].map(([k, label]) => (
                  <button key={k} className={`pc-disc-segbtn ${sortKey === k ? 'on' : ''}`} onClick={() => setSortKey(k)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="pc-disc-group">
              <span className="pc-disc-glabel">Outreach</span>
              <div className="pc-disc-seg">
                <button className={`pc-disc-segbtn ${markFilter === 'all' ? 'on' : ''}`} onClick={() => setMarkFilter('all')}>All</button>
                <button className={`pc-disc-segbtn ${markFilter === 'unmarked' ? 'on' : ''}`} onClick={() => setMarkFilter('unmarked')}>Not contacted</button>
                {/* dot AND label · a bare swatch gave no clue these were even
                    filters, and the counts show how much is in each state */}
                {MARK_COLORS.map(mc => {
                  const n = markTally[mc.id] || 0;
                  return (
                    <button
                      key={mc.id}
                      className={`pc-disc-segbtn pc-disc-dotbtn ${markFilter === mc.id ? 'on' : ''}`}
                      onClick={() => setMarkFilter(markFilter === mc.id ? 'all' : mc.id)}
                      title={`Show only creators marked ${mc.label}`}
                      style={markFilter === mc.id ? { color: mc.hex } : undefined}
                    >
                      <span className="pc-mark-dot" style={{ background: mc.hex }} />
                      {mc.label}
                      {n > 0 && <span className="pc-disc-count">{n}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* who did the outreach · only shown once somebody has marked
                anyone, so it stays out of the way on a fresh pool */}
            {Object.keys(byTally).length > 0 && (
              <div className="pc-disc-group">
                <span className="pc-disc-glabel">Marked by</span>
                <div className="pc-disc-seg">
                  <button className={`pc-disc-segbtn ${byFilter === 'all' ? 'on' : ''}`} onClick={() => setByFilter('all')}>Anyone</button>
                  {Object.keys(byTally).sort().map(name => {
                    const col = hiredByPalette(name);
                    const on = byFilter === name;
                    return (
                      <button
                        key={name}
                        className={`pc-disc-segbtn pc-disc-dotbtn ${on ? 'on' : ''}`}
                        onClick={() => setByFilter(on ? 'all' : name)}
                        title={`Only creators marked by ${name}`}
                        style={on ? { color: col.fg } : undefined}
                      >
                        <span className="pc-mark-dot" style={{ background: col.fg }} />
                        {name}
                        <span className="pc-disc-count">{byTally[name]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="pc-card"><div className="pc-empty">
              <h3>No creators match</h3>
              <p>Loosen the filters, or everyone in this slice is already in your database.</p>
            </div></div>
          ) : (
            <div className="pc-card">
              <div className="pc-disc-headrow">
                <div className="pc-num">#</div>
                <div>Creator</div>
                <div className="pc-num">Followers</div>
                <div className="pc-num">Avg views</div>
                <div className="pc-num">L30 GMV</div>
                <div className="pc-num">Post rate</div>
                <div>Contact</div>
                <div>Seen on</div>
              </div>
              {visible.map((r, i) => {
                const markRec = marks[r.handle] || null;
                const mark = markRec ? (MARK_COLORS.find(m => m.id === markRec.color) || null) : null;
                return (
                <div className={`pc-disc-row ${mark ? 'marked' : ''}`} key={r.handle}
                  style={mark ? { '--mark': mark.hex } : undefined}>
                  <div className="pc-cell pc-num" data-label="#">
                    <span className="pc-mark-wrap">
                      <button
                        className={`pc-mark-btn ${mark ? 'on' : ''}`}
                        style={mark ? { background: mark.hex, borderColor: mark.hex } : undefined}
                        onClick={(e) => {
                          if (markOpen === r.handle) { setMarkOpen(''); return; }
                          /* anchor the portalled menu to this button · the card
                             clips overflow, so an absolute menu vanished on the
                             lower rows and could also fall below the fold */
                          const b = e.currentTarget.getBoundingClientRect();
                          /* menu height tracks the option count · 7 statuses + the clear row */
                          const H = 30 * (MARK_COLORS.length + 1) + 22, W = 168;
                          const below = window.innerHeight - b.bottom;
                          // open upward when there is no room below, then clamp
                          // to the viewport so it can never land off-screen
                          const wanted = below < H && b.top > H ? b.top - H - 4 : b.bottom + 7;
                          setMarkPos({
                            left: Math.max(10, Math.min(b.left, window.innerWidth - W - 10)),
                            top: Math.max(10, Math.min(wanted, window.innerHeight - H - 10)),
                          });
                          setMarkOpen(r.handle);
                        }}
                        title={mark
                          ? `${mark.label}${markRec.by ? ` · by ${markRec.by}` : ''}${markRec.at ? ` · ${formatHireDate(String(markRec.at).slice(0, 10))}` : ''} · click to change`
                          : 'Mark this creator (e.g. after messaging) · shared with the team'}
                      >
                        {!mark && <span className="pc-mark-plus">+</span>}
                      </button>
                      {/* who did it · the name was only ever in a tooltip, so
                          nobody could tell Aris from Emily at a glance */}
                      {mark && markRec.by && (() => {
                        const col = hiredByPalette(markRec.by);
                        return (
                          <span
                            className="pc-mark-by"
                            style={{ background: col.bg, color: col.fg, borderColor: col.border }}
                            title={`${mark.label} by ${markRec.by}${markRec.at ? ` · ${formatHireDate(String(markRec.at).slice(0, 10))}` : ''}`}
                          >
                            {String(markRec.by).trim().charAt(0).toUpperCase()}
                          </span>
                        );
                      })()}
                      {markOpen === r.handle && markPos && createPortal(
                        <>
                          <span className="pc-mark-scrim" onClick={() => setMarkOpen('')} />
                          <span className="pc-mark-pop" style={{ position: 'fixed', left: markPos.left, top: markPos.top }}>
                            {MARK_COLORS.map(mc => (
                              <button key={mc.id} className="pc-mark-opt" onClick={() => setMark(r.handle, mc.id)}>
                                <span className="pc-mark-dot" style={{ background: mc.hex }} />
                                {mc.label}
                              </button>
                            ))}
                            {mark && (
                              <button className="pc-mark-opt clear" onClick={() => setMark(r.handle, null)}>
                                <span className="pc-mark-dot clear" />
                                Clear
                              </button>
                            )}
                          </span>
                        </>,
                        wxPortalHost()
                      )}
                    </span>
                  </div>
                  <div className="pc-cell" data-label="Creator">
                    <span className="pc-creatorcell">
                      <CreatorFace handle={r.handle} name={r.handle} size={28} noRemote />
                      <a className="pc-cname pc-disc-handle" href={`https://www.tiktok.com/@${r.handle}`} target="_blank" rel="noreferrer">@{r.handle}</a>
                      {r.tier && <span className={`pc-tierbadge ${String(r.tier).toLowerCase()}`} title={`EUKA creator tier ${r.tier}`}>{r.tier}</span>}
                    </span>
                  </div>
                  <div className="pc-cell pc-num" data-label="Followers">{r.followers > 0 ? <span className="pc-metric">{kNum(r.followers)}</span> : <span className="pc-handle">-</span>}</div>
                  <div className="pc-cell pc-num" data-label="Avg views">{r.avgViews > 0 ? <span className="pc-metric">{kNum(r.avgViews)}</span> : <span className="pc-handle">-</span>}</div>
                  <div className="pc-cell pc-num" data-label="L30 GMV">{r.gmv > 0 ? <span className="pc-metric pc-metric-gmv">{fmt$Exact(Math.round(r.gmv))}</span> : <span className="pc-handle">-</span>}</div>
                  <div className="pc-cell pc-num" data-label="Post rate">
                    {r.postRate != null
                      ? <span className={`pc-engrate ${r.postRate >= 80 ? 'hot' : r.postRate >= 50 ? 'ok' : 'low'}`} title="EUKA's estimated share of accepted collabs this creator actually posts">{Math.round(r.postRate)}%</span>
                      : <span className="pc-handle">-</span>}
                  </div>
                  <div className="pc-cell" data-label="Contact">
                    <span className="pc-disc-contact">
                      {r.phone && (
                        <button className={`pc-disc-cbtn ${copied === r.handle + 'p' ? 'copied' : ''}`} onClick={() => copyVal(r.handle + 'p', r.phone)} title={`Copy phone · ${r.phone}`}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                          {copied === r.handle + 'p' ? 'Copied' : 'Phone'}
                        </button>
                      )}
                      {r.email && (
                        <button className={`pc-disc-cbtn ${copied === r.handle + 'e' ? 'copied' : ''}`} onClick={() => copyVal(r.handle + 'e', r.email)} title={`Copy email · ${r.email}`}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                          {copied === r.handle + 'e' ? 'Copied' : 'Email'}
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="pc-cell" data-label="Seen on">
                    <span className="pc-disc-stores" title={(r.stores || []).join(' · ')}>
                      {(r.stores || []).slice(0, 2).map(s => <span key={s} className="pc-disc-store">{s}</span>)}
                      {(r.stores || []).length > 2 && <span className="pc-disc-store more">+{r.stores.length - 2}</span>}
                    </span>
                  </div>
                </div>
                );
              })}
              {rows.length > visible.length && (
                <div className="pc-disc-more">
                  <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => setLimit(n => n + 200)}>
                    Show more · {(rows.length - visible.length).toLocaleString()} left
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   LEADERBOARD · who actually performed
   ────────────────────────────────────────────────────────────────────
   One row per PERSON, not per deal — the same creator working three
   brands is one competitor here, with their brands listed. Ratio
   metrics (ROAS, cost per video, return on fee) carry a floor so a
   creator with $12 of spend can't top the table on a rounding artefact.
   ════════════════════════════════════════════════════════════════════ */
const LB_METRICS = [
  {
    id: 'gmv', label: 'GMV', short: 'GMV', desc: 'Revenue driven for the brand',
    get: a => a.gmv, fmt: v => fmt$Exact(Math.round(v)), better: 'high', tone: 'green',
  },
  {
    id: 'videos', label: 'Videos delivered', short: 'Videos', desc: 'Posts actually delivered',
    get: a => a.videos, fmt: v => String(Math.round(v)), better: 'high', tone: 'blue',
  },
  {
    id: 'ad', label: 'Ad spend', short: 'Ad spend', desc: 'Spend put behind their content',
    get: a => a.ad, fmt: v => fmt$Exact(Math.round(v)), better: 'high', tone: 'red',
  },
  {
    id: 'roas', label: 'ROAS', short: 'ROAS', desc: 'GMV per $1 of ad spend',
    get: a => (a.ad > 0 ? a.gmv / a.ad : null), fmt: v => `${v.toFixed(2)}×`,
    better: 'high', tone: 'purple', floor: a => a.ad >= 50, floorNote: 'needs $50+ ad spend',
  },
  {
    id: 'fee', label: 'Amount paid', short: 'Amount paid', desc: 'What we paid them in total',
    get: a => a.fee, fmt: v => fmt$Exact(Math.round(v)), better: 'high', tone: 'amber',
  },
  {
    id: 'deals', label: 'Deals', short: 'Deals', desc: 'How many times we have hired them',
    get: a => a.deals, fmt: v => String(Math.round(v)), better: 'high', tone: 'teal',
  },
];

/* Secondary figures shown on every row. The metric being ranked by is
   filtered out of this set — otherwise the same number printed twice,
   once here and once as the headline value. */
const LB_STATS = [
  { id: 'gmv',    label: 'GMV',    val: r => fmt$Exact(Math.round(r.gmv)) },
  { id: 'videos', label: 'Videos', val: r => String(r.videos) },
  { id: 'ad',     label: 'Ad',     val: r => fmt$Exact(Math.round(r.ad)) },
  { id: 'fee',    label: 'Paid',   val: r => fmt$Exact(Math.round(r.fee)) },
  { id: 'deals',  label: 'Deals',  val: r => String(r.deals) },
  { id: 'roas',   label: 'ROAS',   val: r => (r.ad > 0 ? `${(r.gmv / r.ad).toFixed(2)}×` : '–'),
    cls: r => (r.ad <= 0 ? 'muted' : r.gmv / r.ad >= 2 ? 'tone-green' : r.gmv / r.ad >= 1 ? '' : 'tone-red') },
];
const LB_TOPS = [3, 5, 10, 20, 50, 0];   // 0 = everyone

function LeaderboardTab({ creators, allCreators, month, allTime, onPickMonth }) {
  const [metricId, setMetricId] = useState('deals');
  const [topN, setTopN] = useState(() => Number(godGet().leaderTop) || 10);
  const [brandFilter, setBrandFilter] = useState('all');
  const [copied, setCopied] = useState('');

  const metric = LB_METRICS.find(m => m.id === metricId) || LB_METRICS[0];

  /* ── aggregate one row per person ── */
  const board = useMemo(() => {
    const pool = allCreators || creators || [];
    const inScope = (mk) => allTime || !month || mk === month;
    const agg = {};

    pool.forEach(c => {
      const brand = (c.brand || '').trim();
      if (brandFilter !== 'all' && brand !== brandFilter) return;
      const key = creatorDedupKey(c);
      if (!key) return;

      if (!agg[key]) {
        agg[key] = {
          key, name: c.name || '(no name)', handles: new Set(), brands: new Set(),
          gmv: 0, ad: 0, videos: 0, fee: 0, vidGmv: 0, views: 0, items: 0,
          tier: '', l30: 0, deals: 0,
        };
      }
      const a = agg[key];
      if (brand) a.brands.add(brand);
      [c.tiktok_account, c.tiktok_account_2].map(_normEukaHandle).filter(Boolean).forEach(h => a.handles.add(h));
      if ((c.name || '').trim().length > (a.name || '').trim().length) a.name = c.name;

      // money entered in the Performance matrix · month-scoped
      const m = c.monthly || {};
      Object.keys(m).forEach(k => {
        if (k === 'l30' || k.startsWith('l30@') || k === 'euka' || k === 'perf') return;
        const mk = k.split('@')[0];
        if (!/^\d{4}-\d{2}$/.test(mk) || !inScope(mk)) return;
        a.gmv += Number((m[k] || {}).gmv) || 0;
        a.ad  += Number((m[k] || {}).adSpent) || 0;
      });

      // delivered posts + EUKA metrics · scoped by each video's posted date
      (Array.isArray(c.video_codes) ? c.video_codes : []).forEach(r => {
        if (!r || !String(r.video || '').trim()) return;
        const mk = String(r.date || '').slice(0, 7);
        if (mk && !inScope(mk)) return;
        if (!mk && !allTime) return;          // undated posts only count all-time
        a.videos += 1;
        a.vidGmv += Number(r.revenue) || 0;
        a.views  += Number(r.views) || 0;
        a.items  += Number(r.items) || 0;
      });

      // what we paid · a deal belongs to its onboarding month
      if (inScope(monthKey(c.hiring_date))) {
        a.fee += parseDealAmount(c.deal) || 0;
        a.deals += 1;
      }

      const e = dbEuka(c);
      if (e) { if (e.tier && !a.tier) a.tier = e.tier; if (Number(e.l30) > a.l30) a.l30 = Number(e.l30); }
    });

    const rows = Object.values(agg).map(a => ({
      ...a,
      handles: [...a.handles],
      brands: [...a.brands],
      value: metric.get(a),
      eligible: metric.floor ? metric.floor(a) : true,
    }));

    // ineligible + valueless rows drop out of the ranking entirely
    const ranked = rows
      .filter(r => r.value != null && isFinite(r.value) && r.value > 0 && r.eligible)
      .sort((x, y) => (metric.better === 'low' ? x.value - y.value : y.value - x.value));

    const total = ranked.reduce((s, r) => s + r.value, 0);
    // `all` powers the headline figure on each metric chip, so every chip
    // shows its own total rather than the currently-selected metric's
    return { ranked, total, benched: rows.length - ranked.length, all: rows };
  }, [creators, allCreators, month, allTime, metric, brandFilter]);

  const shown = topN === 0 ? board.ranked : board.ranked.slice(0, topN);

  const brandOptions = useMemo(() => {
    const s = new Set();
    (allCreators || creators || []).forEach(c => { const b = (c.brand || '').trim(); if (b) s.add(b); });
    return [...s].sort();
  }, [creators, allCreators]);

  const copyText = async (txt, tag) => {
    try { await navigator.clipboard.writeText(txt); setCopied(tag); setTimeout(() => setCopied(c => (c === tag ? '' : c)), 1500); } catch {}
  };
  const copyHandles = () => {
    if (!canExport()) return;
    const list = shown.map(r => (r.handles[0] ? '@' + r.handles[0] : r.name)).join('\n');
    copyText(list, 'handles');
  };
  const exportCsv = () => {
    if (!canExport()) return;
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const head = ['Rank', 'Creator', 'Username', 'Tier', 'Brands', metric.label, 'GMV', 'Ad spend', 'ROAS', 'Videos', 'Video GMV', 'Views', 'Items sold', 'Fees paid'];
    const lines = [head.map(esc).join(',')];
    shown.forEach((r, i) => lines.push([
      i + 1, r.name, r.handles[0] ? '@' + r.handles[0] : '', r.tier || '', r.brands.join(' · '),
      metric.fmt(r.value), Math.round(r.gmv), Math.round(r.ad),
      r.ad > 0 ? (r.gmv / r.ad).toFixed(2) : '', r.videos, Math.round(r.vidGmv),
      r.views, r.items, Math.round(r.fee),
    ].map(esc).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `leaderboard-${metric.id}-${allTime ? 'all-time' : month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const scopeLabel = allTime ? 'All time' : monthLabel(month);
  const lead = board.ranked[0];
  const podium = shown.slice(0, 3);
  const rest = shown.slice(3);

  const barPct = (v) => {
    if (!lead || !isFinite(v) || v <= 0) return 0;
    const pct = metric.better === 'low' ? (lead.value / v) * 100 : (v / lead.value) * 100;
    return Math.max(4, Math.min(100, pct));
  };
  const medal = ['gold', 'silver', 'bronze'];
  // never repeat the ranked metric in the supporting figures
  const stats = LB_STATS.filter(s => s.id !== metricId).slice(0, 4);

  /* Newest month that actually holds figures. A month is filled in after it
     closes, so the current month is normally empty and the board would look
     broken on the 1st. Offer the real answer instead of a blank card. */
  const latestWithData = useMemo(() => {
    let best = '';
    (allCreators || creators || []).forEach(c => {
      Object.entries(c.monthly || {}).forEach(([k, v]) => {
        const mk = k.split('@')[0];
        if (!/^\d{4}-\d{2}$/.test(mk) || !v) return;
        if ((Number(v.gmv) || 0) > 0 || (Number(v.adSpent) || 0) > 0) { if (mk > best) best = mk; }
      });
    });
    return best && best !== month ? best : '';
  }, [allCreators, creators, month]);

  return (
    <>
      {/* ══ toolbar · plain labelled selects so the controls can never be
             mistaken for decoration, and no custom CSS can hide them ══ */}
      <div className="lb-tools">
        <label className="lb-field">
          <span className="lb-field-l">Rank by</span>
          <select className="lb-field-in" value={metricId} onChange={e => setMetricId(e.target.value)}>
            {LB_METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>

        <label className="lb-field">
          <span className="lb-field-l">Show</span>
          <select className="lb-field-in" value={topN} onChange={e => setTopN(Number(e.target.value))}>
            {LB_TOPS.map(n => <option key={n} value={n}>{n === 0 ? 'Everyone' : `Top ${n}`}</option>)}
          </select>
        </label>

        <label className="lb-field">
          <span className="lb-field-l">Brand</span>
          <select className="lb-field-in" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
            <option value="all">All brands</option>
            {brandOptions.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>

        <div className="lb-tools-sp" />

        {canExport() && <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={copyHandles} disabled={!shown.length}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          {copied === 'handles' ? 'Copied' : 'Copy usernames'}
        </button>}
{canExport() && <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={exportCsv} disabled={!shown.length}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Export CSV
        </button>}
      </div>

      <div className="lb-caption">
        <b>{metric.label}</b> · {metric.desc} · {scopeLabel}
        {brandFilter !== 'all' ? ` · ${brandFilter}` : ''}
        {metric.floorNote ? ` · only creators with ${metric.floorNote}` : ''}
      </div>

      {board.ranked.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <span className="pc-empty-ico" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
          </span>
          <h3>No {metric.label} for {scopeLabel}</h3>
          <p>
            {latestWithData
              ? <>Figures for a month are entered once it closes, so the current month is usually empty. {monthShort(latestWithData)} is the most recent month with data.</>
              : <>Nothing has been recorded for this metric yet.</>}
          </p>
          {latestWithData && onPickMonth && (
            <button className="pc-btn pc-btn-primary pc-btn-sm" style={{ marginTop: 14 }} onClick={() => onPickMonth(latestWithData)}>
              Show {monthShort(latestWithData)}
            </button>
          )}
        </div></div>
      ) : (
        <>
          {podium.length > 0 && (
            <div className={`lb-podium tone-${metric.tone} n${podium.length}`}>
              {podium.map((r, i) => {
                const share = board.total > 0 ? (r.value / board.total) * 100 : 0;
                return (
                  <article className={`lb-pod lb-pod-${i + 1} ${medal[i]}`} key={r.key}>
                    <div className="lb-pod-crown">
                      <span className="lb-pod-medal">{i + 1}</span>
                      {i === 0 && <span className="lb-pod-lead">Leader</span>}
                    </div>
                    <CreatorFace handle={r.handles[0]} name={r.name} size={i === 0 ? 64 : 52} />
                    <h3 className="lb-pod-name" title={r.name}>{r.name}</h3>
                    <div className="lb-pod-meta">
                      {r.handles[0]
                        ? <a className="lb-pod-handle" href={`https://www.tiktok.com/@${r.handles[0]}`} target="_blank" rel="noreferrer">@{r.handles[0]}</a>
                        : <span className="lb-pod-handle muted">no username</span>}
                      {r.tier && <span className={`pc-tierbadge ${r.tier.toLowerCase()}`}>{r.tier}</span>}
                    </div>
                    <div className={`lb-pod-value tone-${metric.tone}`}>{metric.fmt(r.value)}</div>
                    <div className="lb-pod-label">{metric.label}</div>
                    {metric.better === 'high' && share > 0 && (
                      <div className="lb-pod-share">
                        <span className="lb-pod-sharebar"><span style={{ width: `${Math.min(100, share)}%` }} /></span>
                        <span className="lb-pod-sharetxt">{share.toFixed(1)}% of total</span>
                      </div>
                    )}
                    <div className="lb-pod-stats">
                      {stats.map(s => (
                        <span key={s.id}>
                          <b className={s.cls ? s.cls(r) : ''}>{s.val(r)}</b>
                          <i>{s.label}</i>
                        </span>
                      ))}
                    </div>
                    <span className="lb-pod-brands" title={r.brands.join(' · ')}>
                      {r.brands.length === 1 ? r.brands[0] : `${r.brands.length} brands`}
                    </span>
                  </article>
                );
              })}
            </div>
          )}

          {rest.length > 0 && (
            <div className={`lb-list tone-${metric.tone}`}>
              <div className="lb-listhead">
                <span className="lb-lh-rank">#</span>
                <span className="lb-lh-who">Creator</span>
                <span className="lb-lh-stats">{stats.map(s => <i key={s.id}>{s.label}</i>)}</span>
                <span className="lb-lh-val">{metric.short}</span>
              </div>
              {rest.map((r, i) => {
                return (
                  <div className="lb-row" key={r.key}>
                    <span className="lb-fill" style={{ width: `${barPct(r.value)}%` }} aria-hidden />
                    <span className="lb-rank">{i + 4}</span>
                    <span className="lb-who">
                      <CreatorFace handle={r.handles[0]} name={r.name} size={34} />
                      <span className="lb-whotxt">
                        <span className="lb-name">
                          {r.name}
                          {r.tier && <span className={`pc-tierbadge ${r.tier.toLowerCase()}`}>{r.tier}</span>}
                        </span>
                        <span className="lb-meta">
                          {r.handles[0]
                            ? <a className="lb-handle" href={`https://www.tiktok.com/@${r.handles[0]}`} target="_blank" rel="noreferrer">@{r.handles[0]}</a>
                            : <span className="lb-handle muted">no username</span>}
                          <span className="lb-dot" aria-hidden />
                          <span className="lb-brands" title={r.brands.join(' · ')}>
                            {r.brands.length === 1 ? r.brands[0] : `${r.brands.length} brands`}
                          </span>
                        </span>
                      </span>
                    </span>
                    <span className="lb-stats">
                      {stats.map(s => (
                        <span className="lb-stat" key={s.id}>
                          <b className={s.cls ? s.cls(r) : ''}>{s.val(r)}</b>
                        </span>
                      ))}
                    </span>
                    <span className={`lb-value tone-${metric.tone}`}>{metric.fmt(r.value)}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="lb-foot">
            Showing {shown.length.toLocaleString()} of {board.ranked.length.toLocaleString()} ranked
            {board.benched > 0 && <> · {board.benched.toLocaleString()} not ranked for this period</>}
          </div>
        </>
      )}
    </>
  );
}

/* Sortable column header · shows which way the active column runs */
function Th({ k, sort, on, title, children }) {
  const active = sort && sort.key === k;
  return (
    <button type="button" className={'pc-uc-th' + (active ? ' on' : '')}
      onClick={() => on(k)} title={title || `Sort by ${children}`}>
      {children}
      <span className="pc-uc-arrow" aria-hidden>
        {active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════
   UniqueCreatorsModal · one row per PERSON
   The Creators table is deal-shaped: somebody who worked four brands
   is four rows there. This is that same set collapsed to people, which
   is what the "Unique Creators" pill counts.

   Grouped on the lowercased name — deliberately the SAME key the pill
   uses, so the row count here always equals the number on the pill.
   (creatorDedupKey() matches on handle first and would give a different
   total, which is exactly the mismatch to avoid.)

   Deal, Brand and Status are left out on purpose: they describe one
   collab, not a person. Where a person-level value still has to come
   from a single deal, the rule is stated on the column header:
     · Onboarded  → their EARLIEST hire date (first time we worked with them)
     · Rate/Vid   → their LATEST rate (what they cost now)
   ════════════════════════════════════════════════════════════════ */
function UniqueCreatorsModal({ rows, euka, onClose }) {
  const [sel, setSel] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState(false);
  /* null = the default order (most recently active first) · clicking any
     column header takes over from there */
  const [sort, setSort] = useState(null);
  const [tier, setTier] = useState(null);   // 'L3' | 'none' (no EUKA match) | null

  const people = useMemo(() => {
    const map = new Map();
    rows.forEach(c => {
      const key = (c.name || '').trim().toLowerCase();
      if (!key) return;
      if (!map.has(key)) map.set(key, {
        key, name: '', handles: [], contact: '', email: '', category: '',
        tier: '', l30: 0, first: '', last: '', rate: 0, hiredBy: '', deals: 0,
      });
      const p = map.get(key);
      p.deals += 1;

      const nm = String(c.name || '').trim();
      if (nm.length > p.name.length) p.name = nm;

      [c.tiktok_account, c.tiktok_account_2].forEach(t => {
        if (!t) return;
        const h = tiktokHandle(t).replace(/^@/, '').trim();
        if (h && !p.handles.includes(h)) p.handles.push(h);
      });

      if (!p.contact)  p.contact  = fmtPhone(c.whatsapp_number);
      if (!p.email)    p.email    = String(c.email || '').trim();
      if (!p.category) p.category = String(c.category || '').trim();
      if (!p.tier)     p.tier     = creatorTier(c, euka) || '';

      const l = creatorL30(c, euka) || 0;
      if (l > p.l30) p.l30 = l;

      const d = String(c.hiring_date || '').slice(0, 10);
      if (d) {
        if (!p.first || d < p.first) p.first = d;
        /* latest deal wins for the "what do they cost now" figures */
        if (!p.last || d >= p.last) {
          p.last = d;
          if (c.hired_by) p.hiredBy = c.hired_by;
          const amt = parseDealAmount(c.deal) || 0;
          const vid = parseDealVideos(c.deal) || 0;
          if (amt > 0 && vid > 0) p.rate = Math.round(amt / vid);
        }
      } else if (!p.rate) {
        /* no date at all · still take a rate rather than showing nothing */
        const amt = parseDealAmount(c.deal) || 0;
        const vid = parseDealVideos(c.deal) || 0;
        if (amt > 0 && vid > 0) p.rate = Math.round(amt / vid);
        if (!p.hiredBy && c.hired_by) p.hiredBy = c.hired_by;
      }
    });
    return [...map.values()].sort((a, b) =>
      String(b.last).localeCompare(String(a.last)) || a.name.localeCompare(b.name));
  }, [rows, euka]);

  /* Search first · the tier buttons count over THIS list, not the final one,
     so picking L5 never makes the other tier buttons collapse to zero and
     strand you (the same trap the Discovery tier filter fell into). */
  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^@/, '');
    if (!needle) return people;
    return people.filter(p =>
      p.name.toLowerCase().includes(needle)
      || p.handles.some(h => h.toLowerCase().includes(needle))
      || (p.category || '').toLowerCase().includes(needle));
  }, [people, q]);

  const tierTally = useMemo(() => {
    const t = { none: 0 };
    searched.forEach(p => { if (p.tier) t[p.tier] = (t[p.tier] || 0) + 1; else t.none += 1; });
    return t;
  }, [searched]);
  const tierKeys = useMemo(
    () => Object.keys(tierTally).filter(k => k !== 'none' && tierTally[k] > 0).sort(),
    [tierTally]);

  const shown = useMemo(() => {
    const list = !tier ? searched
      : searched.filter(p => (tier === 'none' ? !p.tier : p.tier === tier));
    if (!sort) return list;

    const get = {
      name:     p => p.name.toLowerCase(),
      contact:  p => p.contact || '',
      handle:   p => (p.handles[0] || '').toLowerCase(),
      category: p => (p.category || '').toLowerCase(),
      first:    p => p.first || '',          // YYYY-MM-DD sorts as text
      rate:     p => p.rate || 0,
      l30:      p => p.l30 || 0,
      hiredBy:  p => (p.hiredBy || '').toLowerCase(),
    }[sort.key];
    if (!get) return list;

    /* Blanks always sink to the bottom · a column sorted "highest first"
       that opens with a screen of dashes is useless either way. */
    const isBlank = v => v === '' || v === 0 || v == null;
    return [...list].sort((a, b) => {
      const A = get(a), B = get(b);
      if (isBlank(A) !== isBlank(B)) return isBlank(A) ? 1 : -1;
      const c = typeof A === 'number' ? A - B : String(A).localeCompare(String(B));
      return sort.dir === 'desc' ? -c : c;
    });
  }, [searched, tier, sort]);

  /* Numbers and dates are most useful biggest-first, text A-Z · so each
     column starts on the direction people actually want, and a second
     click flips it. */
  const NUMERIC = ['first', 'rate', 'l30'];
  const clickSort = (key) => setSort(prev => (
    prev && prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: NUMERIC.includes(key) ? 'desc' : 'asc' }
  ));

  const allSelected = shown.length > 0 && shown.every(p => sel.has(p.key));
  const toggle = (k) => setSel(prev => {
    const nx = new Set(prev);
    if (nx.has(k)) nx.delete(k); else nx.add(k);
    return nx;
  });
  const toggleAll = () => setSel(prev => {
    const nx = new Set(prev);
    if (allSelected) shown.forEach(p => nx.delete(p.key));
    else shown.forEach(p => nx.add(p.key));
    return nx;
  });

  /* Selection drives both actions · with nothing ticked they act on
     everything currently listed, which is what a "download this list"
     button is expected to do. */
  const target = sel.size > 0 ? shown.filter(p => sel.has(p.key)) : shown;

  function copyUsernames() {
    if (!canExport()) return;
    const txt = target.map(p => (p.handles[0] ? '@' + p.handles[0] : '')).filter(Boolean).join('\n');
    if (!txt) return;
    navigator.clipboard?.writeText(txt).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    });
  }
  function exportCsv() {
    if (!canExport()) return;
    if (!target.length) return;
    const esc = v => {
      const t = String(v == null ? '' : v);
      return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const head = ['Name', 'Username', 'Contact', 'Email', 'Category', 'Tier', 'Onboarded', 'Rate per video', 'L30 GMV', 'Hired By', 'Collabs'];
    const lines = [head.join(',')];
    target.forEach(p => lines.push([
      p.name, p.handles[0] ? '@' + p.handles[0] : '', p.contact, p.email,
      p.category, p.tier, p.first, p.rate || '', Math.round(p.l30) || '',
      p.hiredBy, p.deals,
    ].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wurx-unique-creators-' + new Date().toISOString().slice(0, 10) + '-' + target.length + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  const GRID = '40px 46px 1.3fr 0.95fr 1.05fr 0.9fr 0.9fr 0.62fr 0.75fr 0.62fr';

  return (
    <div className="pc-uc-root" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pc-uc-box">
        <div className="pc-uc-top">
          <div className="pc-uc-ttl">
            <span>Unique Creators</span>
            <b>{people.length}</b>
          </div>
          <div className="pc-uc-sub">One row per person · a creator working several brands is counted once</div>
          <button className="pc-uc-x" onClick={onClose} title="Close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="pc-uc-tools">
          <div className="pc-uc-toolrow">
            <span className="pc-uc-searchwrap">
              <svg className="pc-uc-sicon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.7" y2="16.7" /></svg>
              <input className="pc-uc-search" value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search name, @handle or category…" />
              {q && <button className="pc-uc-clear" onClick={() => setQ('')} title="Clear search">✕</button>}
            </span>
            <span className="pc-uc-count">
              <b>{shown.length}</b> shown{sel.size > 0 && <em> · {sel.size} selected</em>}
            </span>
          </div>

          <div className="pc-uc-toolrow">
            <span className="pc-uc-flabel">EUKA tier</span>
            <div className="pc-uc-seg">
              <button className={'pc-uc-segbtn' + (!tier ? ' on' : '')} onClick={() => setTier(null)}>
                All<b>{searched.length}</b>
              </button>
              {tierKeys.map(t => (
                <button key={t} className={'pc-uc-segbtn t-' + t.toLowerCase() + (tier === t ? ' on' : '')}
                  onClick={() => setTier(tier === t ? null : t)}>
                  {t}<b>{tierTally[t]}</b>
                </button>
              ))}
              {tierTally.none > 0 && (
                <button className={'pc-uc-segbtn' + (tier === 'none' ? ' on' : '')}
                  onClick={() => setTier(tier === 'none' ? null : 'none')}
                  title="No matching EUKA creator profile">
                  Unmatched<b>{tierTally.none}</b>
                </button>
              )}
            </div>
            {(tier || sort) && (
              <button className="pc-uc-reset" onClick={() => { setTier(null); setSort(null); }}>Reset</button>
            )}
          </div>
        </div>

        <div className="pc-uc-scroll">
          <div className="pc-uc-head" style={{ gridTemplateColumns: GRID }}>
            <div><input type="checkbox" checked={allSelected} onChange={toggleAll} /></div>
            <div>#</div>
            <Th k="name"     sort={sort} on={clickSort}>Name</Th>
            <Th k="contact"  sort={sort} on={clickSort}>Contact</Th>
            <Th k="handle"   sort={sort} on={clickSort}>TikTok</Th>
            <Th k="category" sort={sort} on={clickSort}>Category</Th>
            <Th k="first"    sort={sort} on={clickSort} title="First time this creator was onboarded">Onboarded</Th>
            <Th k="rate"     sort={sort} on={clickSort} title="Rate from their most recent deal">Rate/Vid</Th>
            <Th k="l30"      sort={sort} on={clickSort}>L30 GMV</Th>
            <Th k="hiredBy"  sort={sort} on={clickSort}>Hired By</Th>
          </div>
          {shown.length === 0 ? (
            <div className="pc-uc-empty">
              <div className="pc-uc-emptyt">No creators here</div>
              <div className="pc-uc-emptys">
                {tier ? 'Nobody in this tier' + (q ? ' matches that search' : '') : 'Nothing matches that search'}
              </div>
            </div>
          ) : shown.map((p, i) => (
            <div key={p.key} className={'pc-uc-row' + (sel.has(p.key) ? ' on' : '')}
              style={{ gridTemplateColumns: GRID }} onClick={() => toggle(p.key)}>
              <div onClick={e => e.stopPropagation()}>
                <input type="checkbox" checked={sel.has(p.key)} onChange={() => toggle(p.key)} />
              </div>
              <div className="pc-uc-n">{i + 1}</div>
              <div className="pc-uc-name">
                <CreatorFace handle={p.handles[0]} name={p.name} size={26} />
                <span className="pc-uc-nm">{p.name}</span>
                {p.tier && <span className={'pc-tierbadge ' + String(p.tier).toLowerCase()}>{p.tier}</span>}
              </div>
              <div className="pc-uc-mut"><span className="pc-uc-txt">{p.contact || '-'}</span></div>
              <div>
                {p.handles[0]
                  ? <a className="pc-handle" href={tiktokUrl(p.handles[0])} target="_blank" rel="noreferrer"
                    onClick={e => e.stopPropagation()}>@{p.handles[0]}
                    {p.handles.length > 1 && <span className="pc-more"> +{p.handles.length - 1}</span>}
                  </a>
                  : <span className="pc-handle">-</span>}
              </div>
              <div className="pc-uc-mut pc-uc-cat"><span className="pc-uc-txt">{p.category || '-'}</span></div>
              <div className="pc-uc-mut"><span className="pc-uc-txt"><HireDate d={p.first} /></span></div>
              <div>{p.rate > 0 ? <span className="pc-money">{fmt$Round(p.rate)}</span> : <span className="pc-handle">-</span>}</div>
              <div>{p.l30 > 0 ? <span className="pc-metric pc-metric-gmv">{fmt$Exact(Math.round(p.l30))}</span> : <span className="pc-handle">-</span>}</div>
              <div><HiredByTag who={p.hiredBy} /></div>
            </div>
          ))}
        </div>

        <div className="pc-uc-foot">
          <span className="pc-uc-footlab">
            {sel.size > 0 ? sel.size + ' selected' : shown.length + ' creators'}
          </span>
          {canExport() && <>
          <button className="pc-uc-btn" onClick={copyUsernames}>
            {copied ? 'Copied' : 'Copy usernames'}
          </button>
          <button className="pc-uc-btn primary" onClick={exportCsv}>Download CSV</button>
          </>}
        </div>
      </div>
    </div>
  );
}

function KpiPill({ label, value, onClick, title }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      onClick={onClick}
      title={title}
      className={onClick ? 'pc-kpipill-btn' : undefined}
      style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      height: 36, padding: '0 6px 0 16px', borderRadius: 999,
      background: 'var(--pc-card)', border: '1px solid var(--pc-divider)',
      boxShadow: 'var(--pc-shadow)',
      fontSize: 13, fontWeight: 700, letterSpacing: '-0.1px', color: 'var(--pc-text)',
      fontFamily: 'inherit', cursor: onClick ? 'pointer' : 'default',
    }}>
      {label}
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 28, height: 26, padding: '0 10px', borderRadius: 999,
        /* WURX-ADDED · the number wears text ink. Muted ink on this warning-soft
           chip measures 4.47:1 at 12.5px, three hundredths under AA — and a
           count is the one thing on the pill somebody actually reads. */
        background: 'var(--wx-warning-soft)', color: 'var(--wx-text)',
        fontSize: 12.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
      }}>{value}</span>
    </Tag>
  );
}

const cellCenter = { display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0 };
const cellEllipsis = { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

function CreatorsTabRow({ c, idx, selected, euka, deals, dealsMonth, onToggle, onOpen, onSetStatus }) {
  const god = useGod();
  const amount = parseDealAmount(c.deal);
  const videoCount = parseDealVideos(c.deal);
  const ratePerVid = videoCount > 0 ? amount / videoCount : 0;
  const handle = c.tiktok_account ? tiktokHandle(c.tiktok_account) : '';
  const url = c.tiktok_account ? tiktokUrl(c.tiktok_account) : null;
  const handle2 = c.tiktok_account_2 ? tiktokHandle(c.tiktok_account_2) : '';
  const url2 = c.tiktok_account_2 ? tiktokUrl(c.tiktok_account_2) : null;
  /* formatted at render time, so records saved before this looked right too */
  const contact = c.whatsapp_number ? fmtPhone(c.whatsapp_number) : (c.email || '');
  const tier = creatorTier(c, euka);
  /* WURX-ADDED · followers, from the same EUKA profile the brand page prints
     under a handle. It arrives with the L30 sweep, so it fills in a moment
     after the table paints, exactly as the tier and L30 columns do. */
  const wxF = wxFollowersOf(euka, wxAdsHook().storedFollowers, [c.tiktok_account, c.tiktok_account_2]);
  const wxFollowers = wxF.n;
  /* WURX-END */
  return (
    <div className={`pc-cv-row ${selected ? 'sel' : ''}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }} style={{ gridTemplateColumns: colTemplate(god) }}>
      <div className="pc-cv-check" onClick={e => e.stopPropagation()} style={cellCenter}>
        {canSelectRows() && <input type="checkbox" checked={selected} onChange={onToggle} style={{ width: 16, height: 16, cursor: 'pointer' }} />}
      </div>
      <div className="pc-cell" data-label="#" style={{ ...cellCenter, ...colStyle("#", god) }}><span className="pc-idx">#{idx}</span></div>
      <div className="pc-cell" data-label="Name" style={{ ...colStyle("Name", god),  display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* WURX-ADDED */}<span className="pc-facewrap"><CreatorFace handle={handle || handle2} name={c.name} size={26} /><DealsBadge n={deals} month={dealsMonth} /></span>{/* WURX-END */}
        <span className="pc-cname" style={{ ...cellEllipsis, flex: 1, minWidth: 0 }}>{c.name || '-'}</span>
        {tier && <span className={`pc-tierbadge ${String(tier).toLowerCase()}`} title={`EUKA creator tier ${tier}`} style={{ flexShrink: 0 }}>{tier}</span>}
      </div>
      <div className="pc-cell" data-label="Contact" style={{ ...colStyle("Contact", god),  ...cellCenter, fontSize: 12.5, color: 'var(--pc-text-2)', overflow: 'hidden' }}>
        <span style={cellEllipsis}>{contact || <span className="pc-handle">-</span>}</span>
      </div>
      <div className="pc-cell" data-label="TikTok" style={{ ...cellCenter, ...colStyle("TikTok", god) }}>
        {handle
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              <a className="pc-handle" href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--pc-accent)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis' }}>{handle}</a>
              {handle2 && (
                <a className="pc-more" href={url2 || undefined} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title={handle2} style={{ textDecoration: 'none', flexShrink: 0 }}>+1</a>
              )}
            </span>
          : <span className="pc-handle">-</span>}
      </div>
      {/* WURX-ADDED · Followers */}
      <div className="pc-cell pc-num" data-label="Followers" style={{ ...cellCenter, ...colStyle("Followers", god) }}>
        {wxFollowers > 0
          ? <span className="pc-metric" title={`${wxFollowers.toLocaleString()} TikTok followers · ${wxF.source === 'shop' ? 'EUKA shop data, live' : 'looked up by handle in EUKA market intelligence'}`} data-source={wxF.source}>{kNum(wxFollowers)}</span>
          : <span className="pc-handle">{euka ? '-' : '…'}</span>}
      </div>
      {/* WURX-END */}
      <div className="pc-cell" data-label="Category" style={{ ...cellCenter, ...colStyle("Category", god) }}>{c.category ? <span className="pc-cat" title={c.category}>{c.category}</span> : <span className="pc-handle">-</span>}</div>
      <div className="pc-cell" data-label="Brand" style={{ ...colStyle("Brand", god),  ...cellCenter, fontWeight: 600 }}>{c.brand || <span className="pc-handle">-</span>}</div>
      <div className="pc-cell" data-label="Onboarded" style={{ ...colStyle("Onboarded", god),  ...cellCenter, fontSize: 12.5, color: 'var(--pc-text-2)' }}><HireDate d={c.hiring_date} /></div>
      <div className="pc-cell" data-label="Deal" style={{ ...cellCenter, ...colStyle("Deal", god) }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
          {amount > 0 ? <span className="pc-money">{fmt$Round(amount)}</span> : <span className="pc-handle">-</span>}
          {videoCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 6px', borderRadius: 999, background: 'var(--pc-accent-light)', color: 'var(--pc-accent)', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.02em', fontVariantNumeric: 'tabular-nums' }}>{videoCount}v</span>
          )}
        </span>
      </div>
      <div className="pc-cell" data-label="Rate/Vid" style={{ ...cellCenter, ...colStyle("Rate/Vid", god) }}>{ratePerVid > 0 ? <span className="pc-money">{fmt$Round(ratePerVid)}</span> : <span className="pc-handle">-</span>}</div>
      <div className="pc-cell" data-label="L30 GMV" style={{ ...cellCenter, ...colStyle("L30 GMV", god) }}>
        <EukaL30Cell euka={euka} c={c} handles={[c.tiktok_account, c.tiktok_account_2]} />
      </div>
      <div className="pc-cell" data-label="Status" style={{ ...cellCenter, ...colStyle("Status", god) }} onClick={e => e.stopPropagation()}>
        <WurxStatusDropdown c={c} onChange={(patch) => onSetStatus(c.id, patch)} />
      </div>
      <div className="pc-cell" data-label="Hired By" style={{ ...cellCenter, ...colStyle("Hired By", god) }}>
        {c.hired_by ? (() => {
          const col = hiredByPalette(c.hired_by);
          return (
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              height: 23, padding: '0 11px', borderRadius: 999,
              background: col.bg, color: col.fg,
              border: `1px solid ${col.border}`,
              fontSize: 11, fontWeight: 800, letterSpacing: '0.02em',
              lineHeight: 1,
            }}>
              {c.hired_by}
            </span>
          );
        })() : <span className="pc-handle">-</span>}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Performance tab · presentation pieces
   Label → big number → movement chip, the shape an analytics report is
   read in: what it is, how big, which way it is going.
   ════════════════════════════════════════════════════════════════ */

function PfDelta({ pct, invert }) {
  if (pct == null || !isFinite(pct)) return null;
  const up = pct >= 0;
  /* On ad spend a rise is not automatically good, so the arrow still
     points up but the colour stays neutral. */
  const tone = invert ? 'flat' : (up ? 'up' : 'down');
  return (
    <span className={'pf-delta ' + tone}>
      {up ? '↑' : '↓'} {up ? '+' : ''}{pct}%
    </span>
  );
}

function PfKpi({ label, value, sub, delta, invert, accent }) {
  return (
    <div className="pf-kpi" style={accent ? { '--pf-accent': accent } : undefined}>
      <div className="pf-kpi-l">{label}</div>
      <div className="pf-kpi-v">{value}</div>
      <div className="pf-kpi-f">
        <PfDelta pct={delta} invert={invert} />
        {sub && <span className="pf-kpi-s">{sub}</span>}
      </div>
    </div>
  );
}

/* GMV as a line over ad spend as bars · the two numbers only mean
   something next to each other, which a single combined chart shows and
   two separate ones do not. */
function PfTrend({ series }) {
  const W = 760, H = 250;
  const P = { l: 56, r: 58, t: 30, b: 34 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  if (!series.length) {
    return <div className="pf-card pf-chart"><div className="pf-empty">No month data recorded yet</div></div>;
  }
  const maxG = Math.max(...series.map(s => s.gmv), 1);
  const maxA = Math.max(...series.map(s => s.ad), 1);
  const yG = v => P.t + ih - (v / maxG) * ih;
  const barW = Math.min(42, (iw / Math.max(series.length, 1)) * 0.5);
  /* Inset the plot so the first and last bar cannot sit under the axis
     figures printed in the gutters on either side. */
  const inset = barW / 2 + 10;
  const span = Math.max(iw - inset * 2, 1);
  const x = i => P.l + inset + (series.length === 1 ? span / 2 : (i * span) / (series.length - 1));

  const pts = series.map((s, i) => [x(i), yG(s.gmv)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ` L${pts[pts.length - 1][0].toFixed(1)} ${(P.t + ih).toFixed(1)} L${pts[0][0].toFixed(1)} ${(P.t + ih).toFixed(1)} Z`;
  const last = series.length - 1;

  return (
    <div className="pf-card pf-chart">
      <div className="pf-card-top">
        <span className="pf-card-t">GMV &amp; Ad spend · last {series.length} months</span>
        <span className="pf-legend">
          <i className="pf-lg bar" />Ad spend
          <i className="pf-lg line" />GMV
          <i className="pf-lg now" />Latest
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pf-svg" preserveAspectRatio="xMidYMid meet">
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={P.l} x2={P.l + iw} y1={P.t + ih * f} y2={P.t + ih * f} className="pf-grid" />
            <text x={P.l - 10} y={P.t + ih * f + 4} className="pf-ax" textAnchor="end">
              {fmt$Compact(maxG * (1 - f))}
            </text>
            <text x={P.l + iw + 10} y={P.t + ih * f + 4} className="pf-ax ad" textAnchor="start">
              {fmt$Compact(maxA * (1 - f))}
            </text>
          </g>
        ))}
        {series.map((s, i) => {
          const h = (s.ad / maxA) * ih;
          return <rect key={s.mk} x={x(i) - barW / 2} y={P.t + ih - h} width={barW}
            height={Math.max(h, s.ad > 0 ? 2 : 0)} rx="4" className="pf-bar" />;
        })}
        <path d={area} className="pf-area" />
        <path d={line} className="pf-line" />
        {series.map((s, i) => (
          <g key={s.mk}>
            <circle cx={x(i)} cy={yG(s.gmv)} r={i === last ? 6 : 4}
              className={'pf-dot' + (i === last ? ' now' : '')} />
            {(i === last || i === 0 || s.gmv === maxG) && (
              <text x={x(i)} y={yG(s.gmv) - 13} className="pf-pt" textAnchor="middle">
                {fmt$Compact(s.gmv)}
              </text>
            )}
          </g>
        ))}
        {series.map((s, i) => (
          <text key={s.mk} x={x(i)} y={H - 12} className="pf-ax" textAnchor="middle">
            {monthShortLabel(s.mk)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ROAS as a dial · "is a dollar of ads coming back as more than a dollar"
   is a pass/fail question, and a dial answers it faster than a figure. */
function PfGauge({ roas, gmv, ad }) {
  const MAX = 5;
  const v = roas == null ? 0 : Math.max(0, Math.min(MAX, roas));
  const R = 78, CX = 100, CY = 100, SW = 17;
  const pol = (deg) => {
    const r = (Math.PI / 180) * deg;
    return [CX + R * Math.cos(r), CY + R * Math.sin(r)];
  };
  const arc = (from, to) => {
    const [x1, y1] = pol(from), [x2, y2] = pol(to);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };
  const end = 180 + (v / MAX) * 180;
  const band = roas == null ? 'none' : roas >= 2 ? 'great' : roas >= 1 ? 'ok' : 'bad';
  const verdict = roas == null ? 'no ad spend recorded'
    : roas >= 2 ? 'strong return'
      : roas >= 1 ? 'above break-even'
        : 'below break-even';

  return (
    <div className="pf-card pf-gauge">
      <div className="pf-card-top"><span className="pf-card-t">Return on ad spend</span></div>
      <svg viewBox="0 0 200 132" className="pf-gsvg">
        <path d={arc(180, 360)} className="pf-gtrack" strokeWidth={SW} />
        {roas != null && <path d={arc(180, end)} className={'pf-gfill ' + band} strokeWidth={SW} />}
        <text x={CX} y={CY - 6} className="pf-gnum" textAnchor="middle">
          {roas != null ? roas.toFixed(2) + '×' : '-'}
        </text>
        <text x={CX} y={CY + 14} className="pf-gsub" textAnchor="middle">{verdict}</text>
        <text x={CX - R} y={CY + 22} className="pf-ax" textAnchor="middle">0</text>
        <text x={CX + R} y={CY + 22} className="pf-ax" textAnchor="middle">{MAX}</text>
      </svg>
      <div className="pf-gfoot">
        <span><b>{fmt$Compact(gmv)}</b> GMV</span>
        <span className="pf-gsep" />
        <span><b>{fmt$Compact(ad)}</b> ad spend</span>
      </div>
    </div>
  );
}

function PfSection({ n, title, sub, right }) {
  return (
    <div className="pf-sec">
      <div className="pf-sec-l">
        <span className="pf-sec-n">{n}</span>
        <div>
          <h3 className="pf-sec-t">{title}</h3>
          {sub && <div className="pf-sec-s">{sub}</div>}
        </div>
      </div>
      {right}
    </div>
  );
}

/* $1,672.14 → "$1.7K" · axis and dial labels have no room for full figures */
function fmt$Compact(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1000000) return '$' + (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(v) >= 1000) return '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + v;
}
function monthShortLabel(mk) {
  const [y, m] = String(mk).split('-');
  return (MONTHS[parseInt(m, 10) - 1] || m) + ' ' + String(y).slice(2);
}

/* ════════ PERFORMANCE TAB ════════
   Aggregates ONLY from the manually-entered monthly matrix data (creators.monthly JSONB).
   Per-deal c.gmv / c.ad_spent fields are NOT used here · they live in the legacy table.
════════ */
function PerformanceTab({ creators, allCreators, allTime, month, onUpdateCreator, onDeleteCreator, brandState, setBrandStateFor }) {
  // Persist drill brand by name (string) so refresh keeps user inside the matrix
  // and live brand data flows in (rather than a stale snapshot).
  const [drillBrandName, setDrillBrandName] = useState(() => loadUIState().perfDrill || null);
  useEffect(() => { patchUIState({ perfDrill: drillBrandName }); }, [drillBrandName]);

  const setBrandTo = (brand, state) => setBrandStateFor(brand, state);
  const [dragging, setDragging] = useState(null);     // brand currently being dragged
  const [overZone, setOverZone] = useState(null);     // 'active' | 'inactive'

  // Brand aggregation:
  //  • GMV / Ad / L30 / Creators  → ALWAYS all-time sum across c.monthly. This
  //    mirrors the drill-down matrix's grand totals exactly · so the brand row
  //    in the list shows the same number as the matrix when you open it.
  //  • Videos delivered → month-scoped via `creators` (hire-date filtered by
  //    parent), matching Brands tab's posted-videos column per month.
  const source = allCreators || creators;
  const brands = useMemo(() => {
    const map = {};
    const ensure = (b) => {
      if (!map[b]) map[b] = { brand: b, gmv: 0, ad: 0, l30: 0, names: new Set(), l30seen: new Set(), videosDelivered: 0, lastActive: '', months: {} };
      return map[b];
    };
    const touch = (row, mk) => { if (mk && mk > row.lastActive) row.lastActive = mk; };

    // Pass 1 · ALL-TIME money + creator names from the full pool
    source.forEach(c => {
      const b = (c.brand || '').trim();
      if (!b) return;
      const row = ensure(b);
      row.gmv += sumMonthly(c, 'gmv');
      row.ad  += sumMonthly(c, 'adSpent');
      /* WURX-ADDED · HOW MUCH OF THIS BRAND WAS EVER TYPED IN.
         Rashid, 2026-10-07, looking at a column of dashes: "figure out why data
         is not being shown".

         The answer is that these columns have exactly one source, the month
         cells somebody types into the matrix below, and 35 of 44 brands have
         never had a single one. A bare "-" cannot say that. It reads as "this
         brand earned nothing", which against NUTRAHARMONY's 440 delivered
         videos is the opposite of the truth.

         So count two different things. `wxCells` is whether ANY money was ever
         entered for the brand, which separates "nobody has filled this in" from
         a real recorded zero. `wxEntered` over `wxRows` is how far the filling
         got, because a brand is not either-or: 80 of Penetrex's 286 rows carry
         money and the total is the sum of whatever somebody got round to.

         Counted here rather than in a pass of its own because the row object is
         spread into the returned brand, so these ride along without touching
         their aggregation. The skip-list is copied from the loop below on
         purpose: if the two ever disagreed about what counts as a month cell,
         the note would contradict the figure beside it. */
      let wxMoneyCells = 0;
      const wxM = c.monthly || {};
      Object.keys(wxM).forEach(kk => {
        if (kk === 'l30' || kk.startsWith('l30@') || kk === 'euka' || kk === 'perf') return;
        if (!/^\d{4}-\d{2}$/.test(kk.split('@')[0])) return;
        const cell = wxM[kk] || {};
        if ((Number(cell.gmv) || 0) > 0 || (Number(cell.adSpent) || 0) > 0) wxMoneyCells += 1;
      });
      row.wxRows = (row.wxRows || 0) + 1;
      row.wxCells = (row.wxCells || 0) + wxMoneyCells;
      if (wxMoneyCells > 0) row.wxEntered = (row.wxEntered || 0) + 1;
      /* THE BRAND'S VIDEOS, so a brand nobody ever typed can still be priced
         from the Euka figures our own side holds. Deduped on TikTok's id, the
         same key every other money reader here uses; a row without one is not
         a video we failed to price, it is not a video. */
      if (!row.wxIdSet) row.wxIdSet = new Set();
      (Array.isArray(c.video_codes) ? c.video_codes : []).forEach(r => {
        const id = wxVideoId(r && r.video);
        if (id) row.wxIdSet.add(id);
      });
      /* WURX-END */
      const k = creatorDedupKey(c);
      if (k) row.names.add(k);
      /* L30 is a property of the PERSON, and the nightly sync stores it under
         monthly.euka. Reading monthly.l30 (which nothing writes) was why the
         tile sat at $0, and adding it per deal row would count a creator
         working four brands four times. */
      const l30v = Number(((c.monthly || {}).euka || {}).l30) || Number((c.monthly || {}).l30) || 0;
      if (l30v > 0 && k && !row.l30seen.has(k)) { row.l30seen.add(k); row.l30 += l30v; }
      /* Most recent month this brand actually did something · a month cell
         carrying money, or a creator hired that month. Drives active vs
         inactive below so a brand that stopped months ago drops out. */
      touch(row, monthKey(c.hiring_date));
      const m = c.monthly || {};
      Object.keys(m).forEach(kk => {
        if (kk === 'l30' || kk.startsWith('l30@') || kk === 'euka' || kk === 'perf') return;
        const mk = kk.split('@')[0];
        if (!/^\d{4}-\d{2}$/.test(mk)) return;
        const cell = m[kk] || {};
        const g = Number(cell.gmv) || 0, ad = Number(cell.adSpent) || 0;
        if (g > 0 || ad > 0) touch(row, mk);
        if (!row.months[mk]) row.months[mk] = { gmv: 0, ad: 0 };
        row.months[mk].gmv += g;
        row.months[mk].ad += ad;
      });
    });

    // Pass 2 · videos delivered ONLY from hire-date-filtered creators
    // so the column mirrors Brands tab's posted-videos number per month.
    creators.forEach(c => {
      const b = (c.brand || '').trim();
      if (!b) return;
      const row = ensure(b);
      row.videosDelivered += deliveredVideoCount(c);
    });

    return Object.values(map).map(b => {
      /* Movement is measured between the last two months this brand actually
         earned in · comparing against a silent month would read as a total
         collapse when really nothing was recorded. */
      const earned = Object.keys(b.months).filter(k => b.months[k].gmv > 0).sort();
      let delta = null;
      if (earned.length >= 2) {
        const cur = b.months[earned[earned.length - 1]].gmv;
        const prev = b.months[earned[earned.length - 2]].gmv;
        if (prev > 0) delta = Math.round(((cur - prev) / prev) * 100);
      }
      return { ...b, uniqueCreators: b.names.size, roas: b.ad > 0 ? b.gmv / b.ad : null, delta };
    });
  }, [source, creators]);

  /* One row per month across every brand · drives the trend chart and the
     movement chips on the tiles. */
  const series = useMemo(() => {
    const m = {};
    brands.forEach(b => Object.entries(b.months).forEach(([mk, v]) => {
      if (!m[mk]) m[mk] = { gmv: 0, ad: 0 };
      m[mk].gmv += v.gmv; m[mk].ad += v.ad;
    }));
    return Object.keys(m).sort()
      .filter(k => m[k].gmv > 0 || m[k].ad > 0)
      .slice(-8)
      .map(k => ({ mk: k, ...m[k] }));
  }, [brands]);

  const mom = useMemo(() => {
    if (series.length < 2) return {};
    const cur = series[series.length - 1], prev = series[series.length - 2];
    const pc = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
    const cr = cur.ad > 0 ? cur.gmv / cur.ad : null;
    const pr = prev.ad > 0 ? prev.gmv / prev.ad : null;
    return {
      gmv: pc(cur.gmv, prev.gmv),
      ad: pc(cur.ad, prev.ad),
      roas: (cr != null && pr != null && pr > 0) ? Math.round(((cr - pr) / pr) * 100) : null,
      label: monthShortLabel(prev.mk),
    };
  }, [series]);

  /* Brands live in the month-scoped `creators` pool exactly when the Brands
     tab shows them for the month being viewed · that keeps the two tabs in
     step, which is the whole point of this block. */
  const liveThisMonth = useMemo(() => {
    const set = new Set();
    creators.forEach(c => { const b = (c.brand || '').trim(); if (b) set.add(b); });
    return set;
  }, [creators]);

  /* Reference month · whatever period is on screen, or the shop's current
     month when viewing all time. */
  const refMonth = (!allTime && month) ? month : currentMonthKey();

  /* Whole months between two "YYYY-MM" keys. */
  const monthsBack = (mk) => {
    if (!mk) return Infinity;
    const [ay, am] = refMonth.split('-').map(Number);
    const [by, bm] = mk.split('-').map(Number);
    return (ay * 12 + am) - (by * 12 + bm);
  };

  /* Decide which section a brand belongs to. A manual drag still wins.
     Otherwise: active if the Brands tab lists it for this month, or it did
     something within the last 2 months · anything quieter than that drops
     to inactive instead of sitting in Active forever on old all-time data. */
  const BRAND_STALE_MONTHS = Number(godGet().staleMonths) || 2;
  const isActive = (b) => liveThisMonth.has(b.brand) || monthsBack(b.lastActive) <= BRAND_STALE_MONTHS;
  const sectionOf = (b) => brandState[b.brand] || (isActive(b) ? 'active' : 'inactive');

  const activeBrands = useMemo(
    () => brands
      .filter(b => sectionOf(b) === 'active')
      .sort((a, b) => (b.gmv - a.gmv) || (b.uniqueCreators - a.uniqueCreators) || a.brand.localeCompare(b.brand)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brands, brandState, liveThisMonth, refMonth]
  );
  const inactiveBrands = useMemo(
    () => brands
      .filter(b => sectionOf(b) === 'inactive')
      .sort((a, b) => String(b.lastActive).localeCompare(String(a.lastActive)) || a.brand.localeCompare(b.brand)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brands, brandState, liveThisMonth, refMonth]
  );

  const totals = useMemo(() => brands.reduce((acc, b) => ({
    gmv: acc.gmv + b.gmv, ad: acc.ad + b.ad, l30: acc.l30 + b.l30, videos: acc.videos + b.videosDelivered,
  }), { gmv: 0, ad: 0, l30: 0, videos: 0 }), [brands]);
  const totalRoas = totals.ad > 0 ? totals.gmv / totals.ad : null;

  /* ══ Performance insights · ROAS winners and money-losers ══ */
  const perfInsights = useMemo(() => {
    const out = [];
    const withSpend = brands.filter(b => b.ad >= 100 && b.roas != null);
    if (withSpend.length) {
      const best = [...withSpend].sort((a, b) => b.roas - a.roas)[0];
      if (best.roas >= 1.5) out.push({ tone: 'good', text: `Best ROAS: ${best.brand} · ${best.roas.toFixed(2)}×` });
      const losing = withSpend.filter(b => b.roas < 1).sort((a, b) => a.roas - b.roas)[0];
      if (losing) out.push({ tone: 'danger', text: `${losing.brand} below break-even · ${losing.roas.toFixed(2)}×` });
    }
    const topGmv = [...brands].sort((a, b) => b.gmv - a.gmv)[0];
    if (topGmv && topGmv.gmv > 0) out.push({ tone: 'info', text: `Top GMV: ${topGmv.brand} · ${fmt$Exact(Math.round(topGmv.gmv))}` });
    const rank = { danger: 0, warn: 1, good: 2, info: 3 };
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 3);
  }, [brands]);

  // Look up live brand data from `brands` each render so totals stay fresh during matrix edits
  const drillBrand = drillBrandName ? brands.find(b => b.brand === drillBrandName) : null;
  if (drillBrand) {
    // Use UNFILTERED creators so the matrix can show all months for the brand
    return <BrandMatrix
      brand={drillBrand}
      creators={(allCreators || creators).filter(c => (c.brand || '').trim() === drillBrand.brand)}
      allCreators={allCreators || creators}
      onBack={() => setDrillBrandName(null)}
      onUpdateCreator={onUpdateCreator}
      onDeleteCreator={onDeleteCreator}
    />;
  }

  return (
    <>
      <div className="pc-kpis" style={{ marginTop: 16, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <KPI label="Total GMV"      value={fmt$(totals.gmv)}                                color="#2E7D32" />
        <KPI label="Total Ad Spent" value={fmt$(totals.ad)}                                 color="#C62828" />
        <KPI label="ROAS"           value={totalRoas != null ? `${totalRoas.toFixed(2)}×` : '-'} color="#1259C3" />
        <KPI label="Videos"         value={totals.videos}                                   color="#E65100" />
      </div>

      {brands.length === 0 ? (
        <EmptyState
          icon="trend"
          title="No brands yet"
          text="Onboard a creator under a brand to start tracking performance · totals are entered manually per month inside each brand."
        />
      ) : (
        <>
          <PerfBrandSection
            title="Active brands"
            zone="active"
            tone="green"
            list={activeBrands}
            dragging={dragging}
            isOver={overZone === 'active'}
            onEnter={() => setOverZone('active')}
            onLeave={() => setOverZone(z => (z === 'active' ? null : z))}
            onDrop={(brand) => { setBrandTo(brand, 'active'); setOverZone(null); setDragging(null); }}
            onDragStart={(brand) => setDragging(brand)}
            onDragEnd={() => { setDragging(null); setOverZone(null); }}
            onOpen={(brand) => setDrillBrandName(brand)}
          />
          <div style={{ height: 16 }} />
          <PerfBrandSection
            title="Inactive brands"
            zone="inactive"
            tone="muted"
            list={inactiveBrands}
            dragging={dragging}
            isOver={overZone === 'inactive'}
            onEnter={() => setOverZone('inactive')}
            onLeave={() => setOverZone(z => (z === 'inactive' ? null : z))}
            onDrop={(brand) => { setBrandTo(brand, 'inactive'); setOverZone(null); setDragging(null); }}
            onDragStart={(brand) => setDragging(brand)}
            onDragEnd={() => { setDragging(null); setOverZone(null); }}
            onOpen={(brand) => setDrillBrandName(brand)}
          />
        </>
      )}
    </>
  );
}

/* WURX-ADDED · A BLANK THAT SAYS WHY IT IS BLANK.

   THREE DIFFERENT SILENCES WERE ALL DRAWN AS "-" on this tab, and a reader had
   no way to tell them apart:

     nobody ever typed a figure in       35 of 44 brands
     figures exist, this one is a zero   a real, recorded fact
     no creator was hired this period    the Videos column only

   Only the middle one means "nothing happened". The other two mean "we are not
   saying", and printing them identically is how a brand with 440 delivered
   videos comes to look like a brand that earned nothing.

   IT CHANGES NO FIGURE. Every number already on screen is untouched; this only
   fills the gaps where there was never a number to show. That was the point of
   doing this first, ahead of the larger question of whether these columns
   should be fed by the Euka sync instead of by hand — that one moves money
   people have been reading for months and is Rashid's call, not a side effect
   of a label.

   The wording avoids "none" and "0" for the same reason the ad-spend cells
   elsewhere avoid them: a dash is not a zero. */
function WxBlank({ label, reason }) {
  return <span className="pc-money muted wx-blank" title={reason}>{label}</span>;
}

/* A FIGURE THAT CAME FROM THE SYNC RATHER THAN FROM A PERSON.

   PROVENANCE HAS TO BE ON THE SCREEN, because the two sources do not measure
   the same thing and sometimes disagree by half. Printing a synced figure in
   the same ink as a typed one would quietly merge two different claims into
   one column and leave nobody able to tell which they were reading.

   A dotted underline and a tooltip, not a coloured badge: it is the same kind
   of fact as the number beside it, just differently sourced, and a loud chip
   would make the brands we know LEAST about the most eye-catching rows. */
function WxSynced({ value, brand, kind, compact }) {
  return (
    <span
      className="wx-synced"
      title={`No ${kind} has ever been typed into the matrix for ${brand}, so this is the figure our own Euka sync holds for their videos, all time. It is not part of the typed record, and the two sources do not always agree where both exist.`}
    >
      {value}
      {/* THE WORD IS DROPPED IN THE NARROW COLUMN, not shrunk to fit. ROAS is
          the tightest column on the row (0.85fr) and at 1024px "1.23×·synced"
          measured wider than the cell holding it — caught by a geometry check,
          invisible at 1440px where it was drawn. The dotted underline and the
          tooltip still say where the figure came from, and the two columns
          beside it already say "synced" in words on the same row. */}
      {compact ? null : (
        <>
          <span className="wx-synced-dot" aria-hidden="true">·</span>
          <span className="wx-synced-tag">synced</span>
        </>
      )}
    </span>
  );
}

/* The brand's own answer for its money columns: never filled in, or filled in
   and genuinely nil. `wxCells` is the whole test. */
function wxMoneyBlank(b) {
  return b.wxCells
    ? <WxBlank label="-" reason="Figures have been entered for this brand, and this one is nil." />
    : <WxBlank label="Not entered" reason={`No monthly figures have ever been entered for ${b.brand} in the performance matrix below. This column is typed in by hand; it is not synced, so a blank here says nothing about what the brand earned.`} />;
}
/* WURX-END */

/* ── Active / Inactive brand section (Performance tab) ──────────
   Drop zone + brand rows. Each row is draggable; section header is the drop target. */
function PerfBrandSection({ title, zone, tone, list, dragging, isOver, onEnter, onLeave, onDrop, onDragStart, onDragEnd, onOpen }) {
  const isDraggingSomething = !!dragging;
  /* WURX-ADDED · FALL BACK TO THE SYNCED FIGURES, NEVER OVERRIDE THE TYPED ONES.
     Rashid, 2026-10-07: "suggest the appropriate fix and make the fix for me".

     THE OBVIOUS FIX WOULD HAVE DESTROYED HISTORY, which is why this is not it.
     Measured on dev before writing a line: the Euka rows begin 2026-06 while
     the typed cells go back to 2025-12, so feeding these columns from the sync
     would have deleted 21 brand-months — every Penetrex month before June, and
     Biostime, Aqua Sonic and Pure Daily Care entirely, since those three have
     no Euka rows at all and would have gone from real figures to nothing.

     And where the two DO overlap they disagree: Apothecary's August matches to
     the dollar ($23,553 both ways) while Penetrex's June is $24,594 typed
     against $13,275 synced. With no way to say which is right, the one a human
     put there wins — it is the record of what was agreed, and it is the number
     people have been reading for months.

     So: typed if it exists, synced only where nothing was ever typed. That
     changes no figure on screen and fills 35 brands that had none, including
     NUTRAHARMONY and Irwin Naturals, which have never been typed at all and
     together have 581 delivered videos.

     ALL TIME, because that is what this column already means — the comment on
     the aggregation says "ALWAYS all-time sum across c.monthly", so the synced
     side has to be asked the same question or the two halves of one column
     would cover different periods. */
  const wxAds = wxAdsHook();
  const wxSetMonth = wxAds.setMonth;
  useEffect(() => { wxSetMonth(''); }, [wxSetMonth]);
  /* ONLY the brands with nothing typed. Asking for every brand's videos would
     be thousands of ids fetched to be thrown away, since a typed brand's
     figures win regardless. */
  const wxNeedIds = useMemo(
    () => list.filter(b => !b.wxCells).flatMap(b => [...(b.wxIdSet || [])]),
    [list]
  );
  wxAds.ensure(wxNeedIds);
  /*
   * TOKENS, not hex. These five were the last hardcoded light-mode colours on
   * the Performance tab and they are why the count badges failed contrast in
   * dark mode at 1.10:1 and 1.11:1 — the pill stayed `#F1F1F4` on a near-black
   * page while its ink flipped to near-white.
   *
   * "Active" is a real state, so it keeps the success family; "Inactive" is not
   * a warning, it is simply the quieter of the two, so it takes neutrals.
   *
   * `ringOver` used to build its faint ring by concatenating an alpha suffix
   * onto the hex (`${accent}55`), which a `var()` cannot do. `color-mix`
   * gives the same 33% without needing to know the colour.
   */
  const accent  = tone === 'green' ? 'var(--wx-success)' : 'var(--wx-border-interactive)';
  const pillBg  = tone === 'green' ? 'var(--wx-success-soft)' : 'var(--wx-surface-2)';
  /* WURX-ADDED · the pill's label wears text ink, not the tone.
     Green-on-green-soft measures 4.31:1 at 12px, under the 4.5 AA asks of text
     that size. The dot and the fill already say "active"; the word does not
     have to be the same hue as the thing behind it to mean it. */
  const pillFg  = 'var(--wx-text)';
  const countBg = tone === 'green' ? 'var(--wx-success)' : 'var(--wx-text-faint)';
  const ringOver = isOver
    ? {
        boxShadow: `0 0 0 2px ${accent}`,
        background: `color-mix(in srgb, ${accent} 5%, transparent)`,
      }
    : isDraggingSomething
      ? { boxShadow: `0 0 0 1px color-mix(in srgb, ${accent} 33%, transparent)` }
      : {};

  return (
    <div style={{ marginLeft: -4 }}>
      {/* Refined MacBook-style section pill · softer shadow, tighter tracking */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 9,
        height: 32, padding: '0 8px 0 13px', borderRadius: 999,
        background: pillBg, color: pillFg,
        fontSize: 11.5, fontWeight: 800, letterSpacing: 1,
        marginBottom: 10,
        boxShadow: '0 1px 2px rgba(15,23,42,0.05), 0 4px 12px -6px rgba(15,23,42,0.10)',
        border: '1px solid color-mix(in srgb, var(--wx-warning) 5%, transparent)',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: accent, display: 'inline-block', boxShadow: `0 0 0 3px ${accent}22` }} />
        <span style={{ textTransform: 'uppercase' }}>{title}</span>
        <span style={{
          minWidth: 22, height: 20, padding: '0 7px', borderRadius: 999,
          background: 'var(--wx-accent-soft)', color: 'var(--wx-text)',
          fontSize: 10.5, fontWeight: 800, letterSpacing: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{list.length}</span>
      </div>

      <div
        className="pc-card"
        style={{ transition: 'box-shadow .15s, background .15s', marginLeft: 4, ...ringOver }}
        onDragOver={(e) => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
        onDragEnter={(e) => { if (dragging) { e.preventDefault(); onEnter(); } }}
        onDragLeave={(e) => {
          const rt = e.relatedTarget;
          if (rt && e.currentTarget.contains(rt)) return;
          onLeave();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const brand = e.dataTransfer.getData('text/plain');
          if (brand) onDrop(brand);
        }}
      >

      {list.length === 0 ? (
        <div style={{
          padding: '28px 14px', textAlign: 'center', border: '1.5px dashed var(--pc-border)',
          borderRadius: 14, color: 'var(--pc-text-3)', fontSize: 13, background: 'var(--pc-surface-2)',
        }}>
          {isDraggingSomething ? `Drop here to move into ${title.toLowerCase()}` : `No brands here yet`}
        </div>
      ) : (
        <>
          <div className="pc-bt-head" style={{ gridTemplateColumns: '18px 2.2fr 0.85fr 1fr 1fr 0.85fr 0.75fr 28px' }}>
            <div />
            <div>Brand</div>
            <div>Creators</div>
            <div>Total GMV</div>
            <div>Total Ad</div>
            <div>ROAS</div>
            <div>Videos</div>
            <div />
          </div>
          {list.map(b => {
            const isMe = dragging === b.brand;
            /* WURX-ADDED · the synced answer, computed only for a brand with
               nothing typed. `totalsOf` derives ROI from the SUMS, never from
               an average of per-video ratios. */
            const sy = b.wxCells ? null : wxTotals(wxAds.get, [...(b.wxIdSet || [])]);
            /* WURX-END */
            return (
              <div
                key={b.brand}
                className="pc-bt-row"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', b.brand);
                  e.dataTransfer.effectAllowed = 'move';
                  onDragStart(b.brand);
                }}
                onDragEnd={onDragEnd}
                style={{
                  gridTemplateColumns: '18px 2.2fr 0.85fr 1fr 1fr 0.85fr 0.75fr 28px',
                  opacity: isMe ? 0.45 : 1,
                  cursor: 'grab',
                }}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(b.brand)}
                onKeyDown={e => { if (e.key === 'Enter') onOpen(b.brand); }}
                title="Drag to move between Active / Inactive · Click to open"
              >
                <div style={{ color: 'var(--pc-text-3)', textAlign: 'center', fontSize: 14, userSelect: 'none' }}>⋮⋮</div>
                <div className="pc-brandcell">
                  <BrandFace brand={b.brand} />
                  <span>
                    <div className="pc-brandname">{b.brand}</div>
                    <small className="pc-brandsub">
                      {b.uniqueCreators} creator{b.uniqueCreators === 1 ? '' : 's'} tracked
                      {/* WURX-ADDED · HOW COMPLETE THE TYPED-IN MONEY IS.
                          A brand is rarely all-or-nothing: Penetrex's $184,167
                          is 80 of 286 rows, so the total is not wrong so much
                          as partial, and the row above gives no hint of that.
                          Said only where it is true and worth saying. */}
                      {b.wxCells && b.wxEntered < b.wxRows
                        ? <span className="wx-brandsub-part" title={`Money has been typed in for ${b.wxEntered} of this brand's ${b.wxRows} creator rows. The totals beside this are the sum of those rows only.`}>
                            {' · '}{b.wxEntered} of {b.wxRows} rows entered
                          </span>
                        : null}
                      {/* WURX-END */}
                    </small>
                  </span>
                </div>
                <div className="pc-num" data-label="Creators">{b.uniqueCreators}</div>
                {/* WURX-ADDED · typed figures exactly as they were; synced ones
                    only where nothing was ever typed, and marked as such. */}
                <div className={`pc-num pc-money ${b.gmv > 0 ? 'pc-green' : ''}`} data-label="Total GMV">
                  {b.gmv > 0 ? fmt$(b.gmv) : (sy && sy.revenue > 0 ? <WxSynced value={fmt$(sy.revenue)} brand={b.brand} kind="GMV" /> : wxMoneyBlank(b))}
                </div>
                <div className={`pc-num pc-money ${b.ad > 0 ? 'pc-red' : ''}`} data-label="Total Ad">
                  {b.ad > 0 ? fmt$(b.ad) : (sy && sy.cost > 0 ? <WxSynced value={fmt$(sy.cost)} brand={b.brand} kind="ad spend" /> : wxMoneyBlank(b))}
                </div>
                <div className="pc-num" data-label="ROAS">
                  {b.roas != null
                    ? <span className={`pc-roas-chip ${b.roas >= 2 ? 'good' : b.roas >= 1 ? 'ok' : 'bad'}`}>{b.roas.toFixed(2)}×</span>
                    : (sy && sy.roi != null
                        ? <WxSynced compact value={<span className={`pc-roas-chip ${sy.roi >= 2 ? 'good' : sy.roi >= 1 ? 'ok' : 'bad'}`}>{sy.roi.toFixed(2)}×</span>} brand={b.brand} kind="ROAS" />
                        : (b.wxCells
                            ? <WxBlank label="-" reason="No ad spend is recorded for this brand, so there is no return to divide by it." />
                            : wxMoneyBlank(b)))}
                </div>
                {/* The Videos blank has a DIFFERENT cause and must not borrow
                    the money one. This column is scoped to the month on screen
                    by hire date, so a brand with plenty of videos shows nothing
                    here in a month it hired nobody. */}
                <div className="pc-num" data-label="Videos">{b.videosDelivered || <WxBlank label="-" reason="No creator was hired for this brand in the period on screen, so no delivered videos fall inside it. This is not a count of all their videos." />}</div>
                {/* WURX-END */}
                <div style={{ color: 'var(--pc-text-3)', textAlign: 'center', fontSize: 18 }}>›</div>
              </div>
            );
          })}
        </>
      )}
      </div>
    </div>
  );
}

/* ════════ BRAND PERFORMANCE MATRIX (Performance drill-down) ════════
   Afflix-style editable matrix:  Name | Username | L30 GMV | <month>(GMV/Ad)... | Total Videos | Total GMV | Total Ad
   Data lives in creators.monthly JSONB column · { "YYYY-MM": { gmv, adSpent }, l30: N }
   Per-creator (canonical row = earliest hire_date for that name in this brand)
   ════════════════════════════════════════════════════════════════ */

function sumMonthly(rec, field) {
  // Sums every month cell in c.monthly across all handles. Per-handle data uses
  // suffixed keys like "2026-05@<handle>" (see getCreatorHandles helpers below).
  // Both primary "YYYY-MM" and "YYYY-MM@handle" cells are summed; only l30
  // markers ("l30" and "l30@<handle>") are excluded.
  const m = rec.monthly || {};
  let s = 0;
  Object.keys(m).forEach(k => {
    if (k === 'l30' || k.startsWith('l30@')) return;
    const v = (m[k] || {})[field];
    if (v != null) s += Number(v) || 0;
  });
  return s;
}

// ── Per-handle multi-row support ────────────────────────────────
// Some creators have two TikTok accounts. The drill-down matrix should show
// one row per username so each can have its own GMV/Ad data. Storage trick:
// the primary handle keeps the existing keys ("2026-05", "l30") while the
// secondary handle's data uses suffixed keys ("2026-05@<handle>", "l30@<handle>")
// inside the same c.monthly JSONB. This avoids any schema migration and stays
// backwards-compatible with single-handle creators.
function getCreatorHandles(c) {
  const arr = [
    _extractTikTokHandle(c?.tiktok_account),
    _extractTikTokHandle(c?.tiktok_account_2),
  ].filter(Boolean);
  return [...new Set(arr)]; // dedupe in case both fields hold the same handle
}
function isPrimaryHandle(c, handle) {
  // No handle on the row → fall back to primary slot (backward-compat for
  // creators with no TikTok stored at all).
  if (!handle) return true;
  // Only the handle that's actually stored in c.tiktok_account / tiktok_account_2
  // as the FIRST entry counts as primary. Virtual rows added via the global
  // handle lookup (`getAllHandlesForPerson`) — i.e., handles that don't live on
  // this brand's record — are always secondary and use the suffixed key so
  // their data stays isolated from the primary row.
  const hs = getCreatorHandles(c);
  return hs.length > 0 && hs[0] === handle;
}
function monthKeyForHandle(c, month, handle) {
  return isPrimaryHandle(c, handle) ? month : `${month}@${handle}`;
}
function l30KeyForHandle(c, handle) {
  return isPrimaryHandle(c, handle) ? 'l30' : `l30@${handle}`;
}
function readCellForHandle(c, month, handle) {
  return (c.monthly || {})[monthKeyForHandle(c, month, handle)] || {};
}
function readL30ForHandle(c, handle) {
  return (c.monthly || {})[l30KeyForHandle(c, handle)];
}
function sumMonthlyForHandle(rec, handle, field) {
  // Only sum cells belonging to this specific handle.
  const m = rec.monthly || {};
  const primary = isPrimaryHandle(rec, handle);
  let s = 0;
  Object.keys(m).forEach(k => {
    if (k === 'l30' || k.startsWith('l30@')) return;
    if (primary) {
      // Primary handle owns cells WITHOUT an @ suffix
      if (k.includes('@')) return;
    } else {
      // Secondary handle owns cells ending in @<handle>
      if (!k.endsWith('@' + handle)) return;
    }
    const v = (m[k] || {})[field];
    if (v != null) s += Number(v) || 0;
  });
  return s;
}
function monthRange(start, end) {
  if (!start) return [];
  if (!end || start > end) return [start];
  const out = []; let m = start, g = 0;
  while (m <= end && g++ < 240) { out.push(m); m = addMonth(m, 1); }
  return out;
}

function BrandMatrix({ brand, creators, allCreators, onBack, onUpdateCreator, onDeleteCreator }) {
  // Use the shared creatorDedupKey so PerformanceTab brand-row creator counts
  // and the matrix rows agree on what "same person" means.
  const dedupKey = creatorDedupKey;

  // For each canonical creator, gather EVERY TikTok handle they've ever used
  // — across all brands. So even if this brand's record only stores one of
  // her two handles, we still surface both as separate rows.
  const globalHandlesByName = useMemo(() => {
    const out = {};
    (allCreators || creators).forEach(c => {
      const nameKey = _normCreatorString(c?.name);
      if (!nameKey) return;
      const hs = [
        _extractTikTokHandle(c?.tiktok_account),
        _extractTikTokHandle(c?.tiktok_account_2),
      ].filter(Boolean);
      if (!out[nameKey]) out[nameKey] = new Set();
      hs.forEach(h => out[nameKey].add(h));
    });
    return out;
  }, [allCreators, creators]);

  const getAllHandlesForPerson = (rec) => {
    const nameKey = _normCreatorString(rec?.name);
    const set = nameKey && globalHandlesByName[nameKey];
    if (set && set.size > 0) return [...set];
    // Fallback: just this record's handles
    return getCreatorHandles(rec);
  };
  // eslint-disable-next-line no-unused-vars
  const _dead_kept_for_no_op_edit = (c) => {
    const norm = (s) => String(s || '')
      .normalize('NFKD')                       // unicode-normalize
      .replace(/[̀-ͯ]/g, '')         // strip combining accents
      .replace(/ /g, ' ')                 // nbsp → space
      .trim()
      .toLowerCase()
      .replace(/^@+/, '')                      // strip leading @
      .replace(/\s+/g, ' ');                   // collapse internal whitespace
    return norm(c?.name) || norm(c?.tiktok_account) || norm(c?.id);
  };

  // Canonical creator per dedup key · keep earliest hire_date as the surviving row.
  // THEN expand each canonical creator into one row per TikTok handle so creators
  // with two usernames (tiktok_account + tiktok_account_2) appear as two separate
  // matrix rows. Each row reads/writes its own slot in c.monthly via the handle-key
  // suffix system, so the two rows can have independent GMV/Ad data.
  const canon = useMemo(() => {
    const map = {};
    creators.forEach(c => {
      if ((c.monthly || {}).perf?.hidden) return;   // removed from this view only
      const k = dedupKey(c);
      if (!k) return;
      if (!map[k] || String(c.hiring_date || '9999') < String(map[k].hiring_date || '9999')) map[k] = c;
    });
    const rows = [];
    /* One row per HANDLE, never more. getAllHandlesForPerson() resolves by
       NAME, so when the same person has two records whose primary handles
       differ (dedupKey is handle-first, so both survive), each record used
       to expand into the full handle set — printing every username twice.
       Claim each handle once; the earliest-hired record owns it. */
    const claimed = new Set();
    Object.values(map)
      .sort((a, b) => String(a.hiring_date || '9999').localeCompare(String(b.hiring_date || '9999')))
      .forEach(c => {
        const handles = getAllHandlesForPerson(c);
        if (handles.length === 0) {
          const nameKey = _normCreatorString(c?.name) || String(c?.id || '');
          if (claimed.has(`name:${nameKey}`)) return;
          claimed.add(`name:${nameKey}`);
          rows.push({ rec: c, handle: '' });
          return;
        }
        handles.forEach(h => {
          if (claimed.has(h)) return;
          claimed.add(h);
          rows.push({ rec: c, handle: h });
        });
      });
    // Sort by Total GMV descending so the highest earners always sit at the
    // top — list re-sorts itself automatically as the user types new data.
    // Tiebreaks: alphabetical name then handle.
    return rows.sort((a, b) => {
      const ga = sumMonthlyForHandle(a.rec, a.handle, 'gmv');
      const gb = sumMonthlyForHandle(b.rec, b.handle, 'gmv');
      if (gb !== ga) return gb - ga;
      const n = (a.rec.name || '').localeCompare(b.rec.name || '');
      return n !== 0 ? n : (a.handle || '').localeCompare(b.handle || '');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creators, globalHandlesByName]);

  // Month range = earliest hire_date → LAST COMPLETED month.
  // A month only becomes a column on the 1st of the NEXT month
  // (June's column appears July 1st, July's appears Aug 1st, etc.) so the
  // matrix never invites data entry for an in-progress month.
  const months = useMemo(() => {
    const ms = creators.map(c => monthKey(c.hiring_date)).filter(Boolean).sort();
    const start = ms[0] || currentMonthKey();
    const end = addMonth(currentMonthKey(), -1);
    if (start > end) return [];
    return monthRange(start, end);
  }, [creators]);

  // Total videos delivered per creator (across all their deals for THIS brand).
  // Keyed by the same dedupKey as canon so duplicate creator records roll into one row.
  const videosByName = useMemo(() => {
    const out = {};
    creators.forEach(c => {
      const k = dedupKey(c);
      if (!k) return;
      out[k] = (out[k] || 0) + deliveredVideoCount(c);
    });
    return out;
  }, [creators]);

  // Persist a monthly update · onUpdateCreator does both optimistic local state AND supabase.
  // For multi-handle creators we use suffixed month keys ("2026-05@<handle>") so
  // each handle row keeps independent data inside the same c.monthly JSONB.
  const commit = (rec, handle, m, field, raw) => {
    const num = raw === '' ? undefined : (Number(raw) || 0);
    const cur = rec.monthly || {};
    const key = monthKeyForHandle(rec, m, handle);
    const cell = { ...(cur[key] || {}) };
    if (num == null || num === 0 || raw === '') delete cell[field]; else cell[field] = num;
    const next = { ...cur, [key]: cell };
    if (cell.gmv == null && cell.adSpent == null) delete next[key];
    if (onUpdateCreator) onUpdateCreator(rec.id, { monthly: next });
  };
  const commitL30 = (rec, handle, raw) => {
    const num = raw === '' ? undefined : (Number(raw) || 0);
    const next = { ...(rec.monthly || {}) };
    const key = l30KeyForHandle(rec, handle);
    if (num == null || num === 0 || raw === '') delete next[key]; else next[key] = num;
    if (onUpdateCreator) onUpdateCreator(rec.id, { monthly: next });
  };

  // Grand totals across all handle rows (each row contributes only its own slice)
  let grandGmv = 0, grandAd = 0;
  canon.forEach(({ rec, handle }) => {
    grandGmv += sumMonthlyForHandle(rec, handle, 'gmv');
    grandAd  += sumMonthlyForHandle(rec, handle, 'adSpent');
  });
  const roas = grandAd > 0 ? grandGmv / grandAd : null;
  const grandVideos = Object.values(videosByName).reduce((a, b) => a + b, 0);

  // Per-month exclusive totals · feeds the new "Monthly Totals" summary strip
  // that sits above the table header. Each cell shows that month's GMV and Ad
  // summed across every creator+handle combination currently visible.
  const monthTotals = useMemo(() => {
    const out = {};
    months.forEach(m => {
      let gmv = 0, ad = 0;
      canon.forEach(({ rec, handle }) => {
        const cell = readCellForHandle(rec, m, handle);
        gmv += Number(cell.gmv) || 0;
        ad  += Number(cell.adSpent) || 0;
      });
      out[m] = { gmv, ad };
    });
    return out;
  }, [canon, months]);
  // Compact money formatter for the summary strip · keeps numbers tight inside
  // narrow month columns ($12,345 → $12.3k · $1,200,000 → $1.2M).
  const fmtCompact = (n) => {
    if (!n) return '$0';
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000)    return `$${(n / 1000).toFixed(0)}k`;
    if (n >= 1000)      return `$${(n / 1000).toFixed(1)}k`;
    return `$${Math.round(n)}`;
  };

  // Grid template · v186 · compact widths (Creators-tab density)
  /* WURX-ADJUSTED · the sheet's geometry, which was cutting the numbers off.
     A month column holds two figures side by side. At 170px each half had 53px
     of room for a number that measures 61px, so every five-figure GMV in the
     table was truncated mid-digit ("10,160.0", "12,077.1").

     184px gives each half 78px, and the figure it is sized against is
     123,456.78 (70px) rather than anything currently in the database. One
     creator, one good month, is six figures on TikTok Shop, and the day that
     arrives is exactly the day nobody would notice the number had started
     printing short. `pnpm verify:collab-controls` asserts on that reference
     string, because a version of it that measured only today's values passed
     on the broken geometry.

     The identity column pays for part of that: 392 was a quarter of the screen
     for a name and a handle. 344 fits every name on the roster and every pixel
     saved is a month you do not have to scroll to. */
  const FROZEN_W = 344;    // 38 rank + name (flex) + 140 handle
  const MONTH_W = 184;
  const SUM = { videos: 82, gmv: 152, ad: 152, del: 58 };
  /* Removing someone here takes them out of THIS matrix only — the creator
     record, their deals and their videos stay untouched everywhere else.
     Stored as monthly.perf = { hidden: true }; every monthly reader sums
     `.gmv` / `.adSpent` off each key, so this one is inert to them. */
  /* Alternating month shading · the newest month is banded, then every
     other one going back (Jul grey, Jun plain, May grey, Apr plain …).
     Keyed off the last index so the pattern stays anchored as months are
     added rather than flipping the whole table each month. */
  const monthBand = (i) => (months.length - 1 - i) % 2 === 0;

  /* ── Floating column header ──────────────────────────────────────
     The matrix flows down the page (one scrollbar) and scrolls sideways
     inside its wrapper. That combination means `position: sticky` can
     only pin to the wrapper, which never scrolls vertically — so the
     header would slide away. Instead we mirror it into a fixed bar that
     appears once the real header leaves the viewport and mirrors the
     wrapper's horizontal scroll. */
  const wrapRef = useRef(null);
  const headRef = useRef(null);
  const cloneRef = useRef(null);
  const [stick, setStick] = useState(null);   // { left, width, height } | null

  const onWrapScroll = useCallback(() => {
    const w = wrapRef.current, c = cloneRef.current;
    if (w && c) c.scrollLeft = w.scrollLeft;
  }, []);

  /* WURX-ADDED · open on the months that have numbers in them.
     The sheet is wider than any screen and it was opening at scrollLeft 0,
     which is the OLDEST month — for a brand with ten months of history that is
     a screen of padlocks and empty cells, and you have to scroll to find out
     the table has anything in it at all. It opens at the newest month now,
     which is also the one the header focuses by default, and only on the way
     in: after that the scroll position is the reader's. */
  const openedAt = useRef('');
  useEffect(() => {
    const w = wrapRef.current;
    const key = `${brand?.brand || ''}::${months.length}`;
    if (!w || !months.length || openedAt.current === key) return;
    /* Land with the NEWEST MONTH against the right edge, measured off the
       header rather than computed from the column widths — scrolling all the
       way to the end instead would push every month off-screen behind the
       three total columns, which is how the first version of this got it
       wrong on a 1024px laptop. */
    const tiles = w.querySelectorAll('.pc-mx-head .pc-mxh-tile:not(.mx-sum)');
    const last = tiles[tiles.length - 1];
    if (!last) return;
    openedAt.current = key;
    w.scrollLeft += last.getBoundingClientRect().right - w.getBoundingClientRect().right;
  }, [brand?.brand, months.length]);

  useEffect(() => {
    let raf = 0;
    /* WURX-ADJUSTED · the mirror has to know WHICH BOX IS SCROLLING.
       Their app scrolls the window, so a window listener and a pin line of y=0
       were right there. Embedded in ours the page never scrolls: the fence
       does, and a scroll event on an element does not reach a window listener.
       So on a sheet of a hundred creators the month labels went off the top
       after twelve rows and never came back, which on a grid whose columns are
       ONLY distinguished by their heading is the same class of problem as the
       cut-off numbers. Pin against the scroller's own top edge, not zero,
       because ours starts below the top bar. */
    const scrollerOf = (el) => {
      let n = el?.parentElement;
      while (n && n !== document.body) {
        if (/(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n;
        n = n.parentElement;
      }
      return null;
    };
    const scroller = scrollerOf(wrapRef.current);
    const measure = () => {
      raf = 0;
      const w = wrapRef.current, h = headRef.current;
      if (!w || !h) return;
      const wr = w.getBoundingClientRect();
      const hh = h.offsetHeight;
      const line = scroller ? Math.max(0, Math.round(scroller.getBoundingClientRect().top)) : 0;
      // pin while the header is above the scroll line but the table is still in view
      const on = wr.top < line && wr.bottom > line + hh + 40;
      setStick(prev => {
        if (!on) return prev === null ? prev : null;
        const next = { left: Math.round(wr.left), width: Math.round(wr.width), height: hh, top: line };
        if (prev && prev.left === next.left && prev.width === next.width && prev.height === next.height && prev.top === next.top) return prev;
        return next;
      });
      if (cloneRef.current && w) cloneRef.current.scrollLeft = w.scrollLeft;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (scroller) scroller.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [months.length, canon.length]);

  /* WURX-ADDED · line the mirror up the moment it appears.
     The sync lives inside the measure loop, which runs BEFORE the clone is
     rendered — on the pass that decides to show it, `cloneRef.current` is still
     null. Nothing corrected it afterwards unless you happened to scroll
     sideways, so the pinned header opened at column zero over a body scrolled
     to July: five months of figures under five wrong month labels, which is a
     worse failure than having no pinned header at all. */
  useEffect(() => {
    if (stick && cloneRef.current && wrapRef.current) {
      cloneRef.current.scrollLeft = wrapRef.current.scrollLeft;
    }
  }, [stick]);

  /* ── Focus month ──────────────────────────────────────────────────
     The newest column is the one being filled in (August shows July as
     the last completed month), so that is what the table focuses on by
     default. Creators onboarded in that month are marked so they are
     easy to find in a list of hundreds. Clicking any month header moves
     the focus, and the default rolls forward on its own each month. */
  const [focusPick, setFocusPick] = useState(null);
  const focusMonth = (focusPick && months.includes(focusPick)) ? focusPick : (months[months.length - 1] || '');
  const cohortCount = useMemo(
    () => canon.filter(r => monthKey(r.rec.hiring_date) === focusMonth).length,
    [canon, focusMonth]
  );

  const canDelete = isAsadActor();
  const [confirmHide, setConfirmHide] = useState(null);   // { rec, handle }
  const [hiding, setHiding] = useState(false);
  const hideFromMatrix = async (rec) => {
    setHiding(true);
    try {
      const monthly = { ...(rec.monthly || {}), perf: { hidden: true } };
      await onUpdateCreator(rec.id, { monthly });
      setConfirmHide(null);
    } catch (e) {
      alert('Could not remove: ' + (e?.message || 'unknown error'));
    }
    setHiding(false);
  };
  /* The identity column's width is a CUSTOM PROPERTY, not a number, so a media
     query can narrow it on a small laptop without this component measuring the
     viewport. 344px of name and handle beside 176px months leaves a 1024px
     screen showing two months; below that breakpoint the handle goes and the
     column halves. See "the identity column" in wurxbase-overrides.css. */
  const tpl = `var(--mx-frozen-w, ${FROZEN_W}px) ${months.map(() => `${MONTH_W}px`).join(' ')} ${SUM.videos}px ${SUM.gmv}px ${SUM.ad}px${canDelete ? ` ${SUM.del}px` : ''}`;
  const rowStyle = { gridTemplateColumns: tpl };

  return (
    <>
      <button className="pc-back" onClick={onBack} style={{ marginTop: 14 }}>‹ All brands</button>

      {/* Brand identity on the left, the four headline figures pinned hard
          right — one bar instead of a header plus a separate stats strip. */}
      <div className="pc-pfhero">
        <BrandFace brand={brand.brand} />
        <div className="pc-pfhero-id">
          <h2 className="pc-pfhero-title">{brand.brand}</h2>
          {(() => {
            const uniqCreators = new Set(canon.map(r => dedupKey(r.rec))).size;
            return (
              <div className="pc-pfhero-sub">
                Performance · {uniqCreators} creator{uniqCreators !== 1 ? 's' : ''} · {months.length} month{months.length !== 1 ? 's' : ''}
                {focusMonth && (
                  <>
                    {' · '}
                    <span className="pc-pfhero-focus">
                      {monthShort(focusMonth)} highlighted
                      {cohortCount > 0 ? ` · ${cohortCount} joined then` : ''}
                    </span>
                  </>
                )}
              </div>
            );
          })()}
        </div>
        <div className="pc-pfhero-stats">
          <div className="pc-pfhero-stat">
            <span className="pc-pfhero-l">Total GMV</span>
            <span className="pc-pfhero-v pc-green">{fmt$(grandGmv)}</span>
          </div>
          <div className="pc-pfhero-stat">
            <span className="pc-pfhero-l">Total Ad Spent</span>
            <span className="pc-pfhero-v pc-red">{fmt$(grandAd)}</span>
          </div>
          <div className="pc-pfhero-stat">
            <span className="pc-pfhero-l">ROAS</span>
            <span className={`pc-pfhero-v ${roas == null ? '' : roas >= 2 ? 'pc-green' : roas >= 1 ? '' : 'pc-red'}`}>
              {roas != null ? `${roas.toFixed(2)}×` : '–'}
            </span>
          </div>
          <div className="pc-pfhero-stat">
            <span className="pc-pfhero-l">Videos</span>
            <span className="pc-pfhero-v">{grandVideos}</span>
          </div>
        </div>
      </div>

      {canon.length === 0 ? (
        <div className="pc-card"><div className="pc-empty"><span className="pc-empty-ico" aria-hidden><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg></span><h3>No creators for this brand</h3><p>Nobody has been onboarded here yet.</p></div></div>
      ) : (
        <>
          <div className="pc-pf-stats" hidden>
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">Total GMV</div><div className="pc-pf-stat-v pc-green">{fmt$(grandGmv)}</div></div>
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">Total Ad Spent</div><div className="pc-pf-stat-v pc-red">{fmt$(grandAd)}</div></div>
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">ROAS</div><div className="pc-pf-stat-v">{roas != null ? `${roas.toFixed(2)}×` : '–'}</div></div>
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">Videos</div><div className="pc-pf-stat-v">{grandVideos}</div></div>
          </div>

          <div className="pc-matrix-wrap" ref={wrapRef} onScroll={onWrapScroll}>
            <div className="pc-mx">
              {/* Header is rendered twice: once in flow, and once as a fixed
                  clone that appears after it scrolls out of view (see
                  stickyHead below). The page owns vertical scrolling, so CSS
                  sticky can't reach the viewport from inside the horizontal
                  scroll container — the clone is what makes it pin. */}
              <div className="pc-mx-row pc-mx-head" ref={headRef} style={rowStyle}>
                <div className="pc-mx-frozen pc-mx-frozen-head">
                  <div className="pc-mxh pc-mxh-c">#</div>
                  <div className="pc-mxh">Creator</div>
                  <div className="pc-mxh">Handle</div>
                </div>
                {months.map((m, mi) => {
                  const t = monthTotals[m] || { gmv: 0, ad: 0 };
                  const on = m === focusMonth;
                  return (
                    <button
                      type="button"
                      key={m}
                      className={'pc-mxh-tile' + (monthBand(mi) ? ' mx-band' : '') + (on ? ' mx-focus' : '')}
                      onClick={() => setFocusPick(m)}
                      title={`Highlight creators onboarded in ${monthShort(m)}`}
                    >
                      <span className="pc-mxh-tile-name">{monthShort(m)}</span>
                      {/* a month with nothing in it stays blank rather than
                          printing $0.00 twice across the whole header */}
                      <span className="pc-mxh-tile-gmv">{t.gmv > 0 ? fmt$(t.gmv) : ''}</span>
                      <span className="pc-mxh-tile-ad">{t.ad > 0 ? fmt$(t.ad) : ''}</span>
                    </button>
                  );
                })}
                <div className="pc-mxh-tile pc-mxh-tile-total mx-sum mx-sum-videos">
                  <span className="pc-mxh-tile-name">Videos</span>
                  <span className="pc-mxh-tile-tval">{grandVideos}</span>
                </div>
                <div className="pc-mxh-tile pc-mxh-tile-total mx-sum mx-sum-gmv">
                  <span className="pc-mxh-tile-name">Total GMV for us</span>
                  <span className="pc-mxh-tile-tval pc-mxh-tile-tval-gmv">{fmt$(grandGmv)}</span>
                </div>
                <div className="pc-mxh-tile pc-mxh-tile-total mx-sum mx-sum-ad">
                  <span className="pc-mxh-tile-name">Total Ad for us</span>
                  <span className="pc-mxh-tile-tval pc-mxh-tile-tval-ad">{fmt$(grandAd)}</span>
                </div>
                {canDelete && (
                  <div className="pc-mxh-tile pc-mxh-tile-total mx-sum mx-sum-del">
                    <span className="pc-mxh-tile-name">Del</span>
                  </div>
                )}
              </div>
                {(() => {
                  // Show the video-count column only on the FIRST row of each
                  // creator (since video_codes are stored per record, not per
                  // handle · showing the same count on every row would mislead).
                  const seenCreators = new Set();
                  return canon.map(({ rec, handle }, i) => {
                    const nk = dedupKey(rec);
                    const isFirstRowOfCreator = !seenCreators.has(nk);
                    if (isFirstRowOfCreator) seenCreators.add(nk);
                    const rowKey = handle ? `${rec.id}::${handle}` : rec.id;
                    const hiredMonth = monthKey(rec.hiring_date);
                    const isCohort = !!hiredMonth && hiredMonth === focusMonth;
                    return (
                      <div className={'pc-mx-row' + (isCohort ? ' mx-cohort' : '')} key={rowKey} style={rowStyle}>
                        <div className="pc-mx-frozen">
                          <div className="pc-mx-rank">{String(i + 1).padStart(2, '0')}</div>
                          <div className="pc-mx-name" title={rec.name}>
                            {rec.name}
                            {isCohort && (
                              <span className="pc-mx-newtag" title={`Onboarded in ${monthShort(focusMonth)}`}>
                                {MONTHS[parseInt(focusMonth.split('-')[1], 10) - 1] || ''}
                              </span>
                            )}
                          </div>
                          {/* WURX-ADDED · title, because a long handle ellipses
                              in this column and the name above it already has
                              one · nothing on this sheet should be unreadable
                              with no way to recover it */}
                          <div className="pc-mx-user" title={handle ? tiktokHandle(handle) : ''}>{handle ? tiktokHandle(handle) : '–'}</div>
                        </div>
                        {months.map((m, mi) => {
                          const cell = readCellForHandle(rec, m, handle);
                          /* Months before this creator existed on the roster are
                             sealed, so a mis-click can't file revenue against a
                             period they were not working. A cell that already
                             holds a figure stays editable: a few creators really
                             did sell organically before their deal started, and
                             that history must remain correctable. */
                          const beforeJoining = !!hiredMonth && m < hiredMonth;
                          const hasValue = Number(cell.gmv) > 0 || Number(cell.adSpent) > 0;
                          const sealed = beforeJoining && !hasValue;
                          const why = `${rec.name} was onboarded in ${monthShort(hiredMonth)}`;
                          return (
                            <div key={m} className={'pc-mx-month-pair' + (monthBand(mi) ? ' mx-band' : '') + (sealed ? ' mx-sealed' : '') + (beforeJoining && hasValue ? ' mx-early' : '')}>
                              {sealed ? (
                                /* one marker for the whole month · a padlock in
                                   both halves read as an error state */
                                <span className="pc-mx-locked" title={why} aria-disabled="true">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                                  </svg>
                                </span>
                              ) : (
                                <>
                                  <MatrixCell value={cell.gmv}     onCommit={v => commit(rec, handle, m, 'gmv', v)} />
                                  <MatrixCell value={cell.adSpent} ad onCommit={v => commit(rec, handle, m, 'adSpent', v)} />
                                </>
                              )}
                            </div>
                          );
                        })}
                        {/* mx-sum-* · these three pin to the right edge, see sumVars */}
                        <div className="pc-mx-num strong mx-sum mx-sum-videos">{isFirstRowOfCreator ? (videosByName[nk] || 0) : <span style={{ color: 'var(--pc-text-3)' }}>·</span>}</div>
                        <div className="pc-mx-num strong pc-green mx-sum mx-sum-gmv">{fmt$(sumMonthlyForHandle(rec, handle, 'gmv'))}</div>
                        <div className="pc-mx-num strong pc-red mx-sum mx-sum-ad">{fmt$(sumMonthlyForHandle(rec, handle, 'adSpent'))}</div>
                        {canDelete && (
                          /* every row gets the button · a creator with two
                             handles renders two rows off the SAME record, so
                             gating it to the first row just looked like the
                             button was randomly missing */
                          <div className="pc-mx-num mx-sum mx-sum-del">
                            <button
                              className="pc-actbtn danger"
                              title={`Remove ${rec.name || 'this creator'} from this performance table (Asad only)`}
                              onClick={() => setConfirmHide({ rec, handle })}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
        </>
      )}

      {/* fixed mirror of the column header · shown once the real one scrolls off */}
      {stick && createPortal(
        <div
          className="pc-mx-stickhead"
          ref={cloneRef}
          style={{ left: stick.left, width: stick.width, height: stick.height, top: stick.top }}
          aria-hidden
        >
          <div className="pc-mx">
            <div className="pc-mx-row pc-mx-head" style={rowStyle}>
              <div className="pc-mx-frozen pc-mx-frozen-head">
                <div className="pc-mxh pc-mxh-c">#</div>
                <div className="pc-mxh">Creator</div>
                <div className="pc-mxh">Handle</div>
              </div>
              {months.map((m, mi) => {
                const t = monthTotals[m] || { gmv: 0, ad: 0 };
                return (
                  <div key={m} className={'pc-mxh-tile' + (monthBand(mi) ? ' mx-band' : '') + (m === focusMonth ? ' mx-focus' : '')}>
                    <span className="pc-mxh-tile-name">{monthShort(m)}</span>
                    {/* WURX-ADJUSTED · blank, not "$0", for a month with nothing
                        in it — matching the real header this mirrors. It printed
                        $0 twice per empty month, so the pinned copy did not look
                        like the thing it is a copy of. */}
                    <span className="pc-mxh-tile-gmv">{t.gmv > 0 ? fmt$(t.gmv) : ''}</span>
                    <span className="pc-mxh-tile-ad">{t.ad > 0 ? fmt$(t.ad) : ''}</span>
                  </div>
                );
              })}
              <div className="pc-mxh-tile pc-mxh-tile-total mx-sum mx-sum-videos">
                <span className="pc-mxh-tile-name">Videos</span>
                <span className="pc-mxh-tile-tval">{grandVideos}</span>
              </div>
              <div className="pc-mxh-tile pc-mxh-tile-total mx-sum mx-sum-gmv">
                <span className="pc-mxh-tile-name">Total GMV for us</span>
                <span className="pc-mxh-tile-tval pc-mxh-tile-tval-gmv">{fmt$(grandGmv)}</span>
              </div>
              <div className="pc-mxh-tile pc-mxh-tile-total mx-sum mx-sum-ad">
                <span className="pc-mxh-tile-name">Total Ad for us</span>
                <span className="pc-mxh-tile-tval pc-mxh-tile-tval-ad">{fmt$(grandAd)}</span>
              </div>
              {canDelete && (
                <div className="pc-mxh-tile pc-mxh-tile-total mx-sum mx-sum-del">
                  <span className="pc-mxh-tile-name">Del</span>
                </div>
              )}
            </div>
          </div>
        </div>,
        wxPortalHost()
      )}

      {confirmHide && createPortal(
        <div className="pc-modal-backdrop" onClick={() => !hiding && setConfirmHide(null)}>
          <div className="pc-confirm" onClick={e => e.stopPropagation()}>
            <span className="pc-confirm-ico" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
            </span>
            <h3 className="pc-confirm-title">Remove from this table?</h3>
            <p className="pc-confirm-body">
              <b>{confirmHide.rec.name || 'This creator'}</b>
              {confirmHide.handle ? <> ({tiktokHandle(confirmHide.handle)})</> : null}
              {' '}will disappear from <b>{brand.brand}</b>&rsquo;s performance table.
            </p>
            <div className="pc-confirm-note">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
              <span>Performance only. The creator, their deal and their videos stay exactly as they are in Brands and Creators.</span>
            </div>
            <div className="pc-confirm-acts">
              <button className="pc-btn pc-btn-ghost pc-btn-sm" disabled={hiding} onClick={() => setConfirmHide(null)}>Cancel</button>
              <button className="pc-btn pc-btn-sm pc-confirm-go" disabled={hiding} onClick={() => hideFromMatrix(confirmHide.rec)}>
                {hiding ? 'Removing…' : 'Remove from table'}
              </button>
            </div>
          </div>
        </div>,
        wxPortalHost()
      )}
    </>
  );
}

function MatrixCell({ value, onCommit, ad, l30, locked, lockWhy }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  const [isFocused, setIsFocused] = useState(false);
  const skipCommit = useRef(false);
  const focused = useRef(false);
  // Sync from server value only while NOT editing — otherwise a realtime echo
  // (own commit or a teammate's edit) would wipe in-progress typing.
  useEffect(() => {
    if (!focused.current) setV(value == null ? '' : String(value));
  }, [value]);

  /* A number input can't render thousands separators, so the cell shows a
     grouped, 2-decimal string while idle (37,414.13) and swaps to the raw
     editable number the moment it takes focus. */
  const display = (() => {
    if (isFocused || v === '' || v == null) return v;
    const n = Number(v);
    if (!isFinite(n)) return v;
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  })();

  /* Sealed months render as plain text · not a disabled input, so keyboard
     navigation skips straight past them while filling a row. */
  if (locked) {
    return (
      <span className={`pc-mx-input pc-mx-locked ${ad ? 'ad' : ''}`} title={lockWhy || 'Before this creator joined'} aria-disabled="true">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </span>
    );
  }

  // Move focus to the same column-cell in the row above/below (Numbers/Excel).
  const navRow = (input, dir) => {
    const row = input.closest('.pc-mx-row');
    if (!row) return false;
    const cols = Array.from(row.querySelectorAll('.pc-mx-input'));
    const col = cols.indexOf(input);
    let t = dir > 0 ? row.nextElementSibling : row.previousElementSibling;
    while (t) {
      const targets = t.querySelectorAll('.pc-mx-input');
      if (targets.length > col) { targets[col].focus(); return true; }
      t = dir > 0 ? t.nextElementSibling : t.previousElementSibling;
    }
    return false;
  };

  return (
    <input
      className={`pc-mx-input ${ad ? 'ad' : ''} ${l30 ? 'l30' : ''}`}
      type={isFocused ? 'number' : 'text'} inputMode="decimal" placeholder="–"
      value={display}
      onChange={e => setV(e.target.value)}
      onBlur={() => {
        focused.current = false;
        setIsFocused(false);
        if (skipCommit.current) { skipCommit.current = false; return; }
        onCommit(v);
      }}
      onClick={e => e.stopPropagation()}
      onFocus={e => { focused.current = true; setIsFocused(true); const el = e.target; setTimeout(() => { try { el.select(); } catch {} }, 0); }}
      /* focused number inputs change value on scroll — blur first so a stray
         wheel over the cell can never silently corrupt data */
      onWheel={e => e.currentTarget.blur()}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (!navRow(e.currentTarget, +1)) e.currentTarget.blur();   // last row → just commit
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();                    // stop native decrement
          navRow(e.currentTarget, +1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();                    // stop native increment
          navRow(e.currentTarget, -1);
        } else if (e.key === 'Escape') {
          skipCommit.current = true;
          setV(value == null ? '' : String(value));   // revert to saved value
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/* ════════ CREATOR LIST (shared by Brand-drilldown & Creators tab) ════════ */
function CreatorList({ creators, onSelectCreator, showBrand = true }) {
  if (creators.length === 0) {
    return <div className="pc-card"><div className="pc-empty"><span className="pc-empty-ico" aria-hidden><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></svg></span><h3>No creators</h3><p>Nothing to show for this selection.</p></div></div>;
  }
  // Custom grid (Wurx-specific 7 columns) · overrides .pc-cv-head/row's 11-col default
  const cols = showBrand
    ? '44px 0.6fr 0.9fr 0.95fr 0.7fr 0.95fr 120px'   // #, Name, TikTok, Brand, Hired, Deal, Status
    : '44px 0.6fr 1fr 0.7fr 1fr 120px';              // #, Name, TikTok, Hired, Deal, Status
  return (
    <div className="pc-card">
      <div style={{ display: 'grid', gridTemplateColumns: cols, alignItems: 'center', gap: 12, padding: '14px 22px', borderBottom: '1.5px solid var(--pc-divider)' }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--pc-text-2)' }}>#</div>
        <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--pc-text-2)' }}>Name</div>
        <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--pc-text-2)' }}>TikTok</div>
        {showBrand && <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--pc-text-2)' }}>Brand</div>}
        <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--pc-text-2)' }}>Hired</div>
        <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--pc-text-2)' }}>Deal</div>
        <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--pc-text-2)' }}>Status</div>
      </div>
      {creators.map((c, i) => {
        const isPaid = c.payment_status === 'Paid';
        const isUnpaid = c.payment_status === 'Not Yet';
        return (
          <div
            key={c.id}
            onClick={() => onSelectCreator && onSelectCreator(c)}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') onSelectCreator && onSelectCreator(c); }}
            style={{
              display: 'grid', gridTemplateColumns: cols, alignItems: 'center', gap: 12,
              padding: '12px 22px', borderBottom: '1px solid var(--pc-divider)',
              fontSize: 13, cursor: 'pointer', transition: 'background 0.15s',
              background: 'transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--pc-card-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--pc-text-3)', fontVariantNumeric: 'tabular-nums' }}>{String(i + 1).padStart(2, '0')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className="pc-ava" style={{ width: 32, height: 32, fontSize: 13, borderRadius: 10, background: gradFor(c.name) }}>{initial(c.name)}</span>
              <div style={{ minWidth: 0, lineHeight: 1.2 }}>
                <div style={{ fontWeight: 700, color: 'var(--pc-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || '-'}</div>
                {c.category && <div style={{ fontSize: 11, color: 'var(--pc-text-2)', fontWeight: 500 }}>{c.category}</div>}
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--pc-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tiktokHandle(c.tiktok_account) || '-'}</div>
            {showBrand && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pc-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.brand || '-'}</div>}
            <div style={{ fontSize: 12, color: 'var(--pc-text-2)' }}>{formatHireDate(c.hiring_date)}</div>
            <div style={{ fontWeight: 700, color: 'var(--pc-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.deal || '-'}</div>
            <div>
              <span className={`pc-badge ${isPaid ? 'sent' : isUnpaid ? 'pending' : 'progress'}`}>
                {isPaid ? 'Paid' : isUnpaid ? 'Unpaid' : c.payment_status || 'Open'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ════════ SHARED UI ════════ */
function SectionLabel({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--pc-text-2)', marginBottom: 8, padding: '0 4px' }}>
      {children}
    </div>
  );
}

/* Search input with magnifier icon + one-click clear (×) + Esc-to-clear */
function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="pc-searchwrap">
      <svg className="pc-search-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        className="pc-search"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange(''); } }}
        placeholder={placeholder}
      />
      {value && (
        <button className="pc-search-x" onClick={() => onChange('')} aria-label="Clear search" title="Clear search (Esc)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}

/* Named line icons · replaces the emoji that used to sit above empty
   states. Emoji render differently per OS and sat oddly against the rest
   of the UI, which is all stroked icons. */
const EMPTY_ICONS = {
  creators: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /></>,
  brands: <><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>,
  chart: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
  trend: <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>,
};
function EmptyState({ icon, title, text }) {
  const path = EMPTY_ICONS[icon] || EMPTY_ICONS.creators;
  return (
    <div className="pc-empty" style={{ marginTop: 14 }}>
      <span className="pc-empty-ico" aria-hidden>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function KPI({ label, value, color }) {
  return (
    <div className="pc-kpi pc-kpi-simple" style={{ '--kpi-color': color }}>
      <div className="pc-kpi-row" style={{ marginBottom: 10 }}>
        <span className="pc-kpi-dot" style={{ background: color }} />
        <div className="pc-kpi-label">{label}</div>
      </div>
      <div className="pc-kpi-value">{value}</div>
    </div>
  );
}

/* ════════ REAL-TIME PRESENCE · who else is in the workspace right now ════════
   Lightweight Supabase Realtime Presence channel. Joins on mount, shows up to
   3 colored avatars stacked, hidden when no peers. */
function PresenceAvatars({ currentUser }) {
  const [peers, setPeers] = useState([]);
  useEffect(() => {
    if (!currentUser?.display && !currentUser?.username) return;
    const me = {
      id:      currentUser.username || currentUser.display,
      display: currentUser.display  || currentUser.username || 'User',
      at:      Date.now(),
    };
    const ch = supabase.channel('wurx_presence', { config: { presence: { key: me.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState();
      const all = [];
      Object.values(state).forEach(arr => arr.forEach(p => all.push(p)));
      // Drop self, dedupe by id, sort newest first
      const others = all.filter(p => p?.id && p.id !== me.id);
      const dedup = {};
      others.forEach(p => { dedup[p.id] = p; });
      setPeers(Object.values(dedup));
    });
    ch.subscribe(status => { if (status === 'SUBSCRIBED') ch.track(me); });
    return () => { try { ch.untrack(); supabase.removeChannel(ch); } catch {} };
  }, [currentUser?.display, currentUser?.username]);

  if (peers.length === 0) return null;
  const shown = peers.slice(0, 3);
  const extra = peers.length - shown.length;
  return (
    <div className="pc-presence" title={peers.map(p => p.display).join(', ') + ' viewing now'} style={{ display: 'inline-flex', alignItems: 'center', marginRight: 4 }}>
      {shown.map((p, i) => {
        const grad = gradFor(p.display || '?');
        return (
          <span key={p.id} style={{
            width: 26, height: 26, borderRadius: 999,
            background: grad, color: 'var(--wx-text-muted)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--wx-warning)',
            marginLeft: i === 0 ? 0 : -8,
            position: 'relative',
            zIndex: shown.length - i,
            boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <span aria-hidden style={{
              position: 'absolute', right: -1, bottom: -1,
              width: 8, height: 8, borderRadius: 999,
              background: 'var(--wx-success-soft)', border: '2px solid var(--wx-warning)',
            }} />
          </span>
        );
      })}
      {extra > 0 && (
        <span style={{
          minWidth: 26, height: 26, padding: '0 6px',
          borderRadius: 999, background: 'color-mix(in srgb, var(--wx-surface-2) 18%, transparent)',
          color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800,
          border: '2px solid var(--wx-warning)',
          marginLeft: -8, position: 'relative', lineHeight: 1,
        }}>+{extra}</span>
      )}
    </div>
  );
}


