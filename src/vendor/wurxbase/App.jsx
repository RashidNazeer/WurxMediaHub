import React, {
  useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo
} from 'react';
import { createPortal } from 'react-dom';
import SqlQuest from './SqlQuest';
import GodMode, { applyGod, loadGod } from './GodMode';
import { fetchBrandContracts } from './brandContract';
import CreativeAngles from './CreativeAngles';
import AccessControl from './AccessControl';
import { can } from './access';
import { createFetchGate, createSettingsMirror } from './settingsSync';

/* WURX-ADDED · IS THIS ASAD?
   Their gates asked `currentUser?.id !== 'asad' && currentUser?.username !==
   'Asad'`, in seven places. Neither half could ever be false here: `id` is our
   auth uuid, and the session writes `username: 'asad'` in lower case against a
   capital 'Asad'. So every one of those gates refused EVERYBODY, Asad included,
   and did it with a notification. That is why marking a creator paid appeared
   to do nothing at all.
   One case-insensitive check, so the same question gets the same answer. */
function isAsadUser(u) {
  const a = String(u?.username || u?.id || '').trim().toLowerCase();
  return a === 'asad';
}

import { fetchAngles } from './angleStore';
import './App.css';
import './responsive.css';
import './theme.css';
import './tailwind.css';
import { supabase, selectAll, wurxbaseRest, wurxbaseHeaders, WURXBASE_ORIGIN, WURXBASE_ENDPOINT_LABEL } from './supabaseClient';
import WurxUI from './WurxUI';

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


/* ─── Constants ──────────────────────────────────────────── */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const LOGIN_GREETINGS = [
  "Welcome back, boss.",
  "Ready to close some deals?",
  "Let's make today count.",
  "The creators are waiting.",
  "Your deals, your rules.",
  "Another day, another dollar.",
  "Time to run it back.",
  "Focus mode: activated.",
  "The empire is growing.",
  "Good to see you again.",
  "Let's make magic happen.",
  "Your hustle awaits.",
  "Deals don't close themselves.",
  "Let's ship something today.",
  "The grind continues.",
  "Another week, another win.",
  "Let's lock in.",
  "Back to building.",
  "Your moves, your money.",
  "Let's cook something good.",
  "Fresh day, fresh wins.",
  "Dominate the day.",
  "Let's eat today.",
  "Your vision, your victory.",
  "Building while others sleep.",
  "Let's make moves.",
  "The boss is in the building.",
  "Time to level up.",
  "Empire mode: on.",
  "Close strong today.",
  "Let's stack some wins.",
  "New day, new possibilities.",
  "Your rules, your domain.",
  "Focus. Close. Repeat.",
  "Ready to run it up?",
  "Another win incoming.",
  "Let's make headlines.",
  "Back in business.",
  "Shine bright today.",
  "Paper chase continues.",
  "Your throne awaits.",
  "Own the day.",
];

/* ── Shop time ────────────────────────────────────────────────────────
   Deadlines, "overdue" flags and month rollovers describe TikTok Shop US,
   but the team works from Pakistan (UTC+5) — ~12 hours ahead of Pacific.
   On browser-local time the app flips to the next day/month half a day
   early, which is what turns collabs red before they are actually late.
   shopNow() re-expresses "now" in America/Los_Angeles. */
const SHOP_TZ = 'America/Los_Angeles';
function shopNow() {
  const now = new Date();
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: SHOP_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(now).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
    const hour = p.hour === '24' ? '00' : p.hour;
    const d = new Date(`${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}`);
    return isNaN(d) ? now : d;
  } catch { return now; }
}
/* Midnight today, shop-local — the correct baseline for "is this overdue" */
function shopMidnight() {
  const d = shopNow();
  d.setHours(0, 0, 0, 0);
  return d;
}
/* Shop-local YYYY-MM. Must be built from the date's own fields — calling
   toISOString() on a shopNow() value re-applies the browser's UTC offset
   and can slide the answer back a day (and with it, a month). */
function shopMonthKey() {
  const d = shopNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* Returns current seasonal theme or null. 2026 Islamic dates approximated. */
function getCurrentSeason() {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const y = now.getFullYear();
  // New Year · Dec 28-31 + Jan 1-7
  if ((m === 12 && d >= 28) || (m === 1 && d <= 7))
    return { id: 'newyear', emoji: '🎆', label: 'Happy New Year' };
  // Pakistan Independence · Aug 13-15
  if (m === 8 && d >= 13 && d <= 15)
    return { id: 'pkday', emoji: '🇵🇰', label: 'Pakistan Day' };
  // Ramadan 2026 · Feb 18 – Mar 19
  if (y === 2026 && ((m === 2 && d >= 18) || (m === 3 && d <= 19)))
    return { id: 'ramadan', emoji: '🌙', label: 'Ramadan Mubarak' };
  // Eid-ul-Fitr 2026 · Mar 20-22
  if (y === 2026 && m === 3 && d >= 20 && d <= 22)
    return { id: 'eidfitr', emoji: '🌙', label: 'Eid Mubarak' };
  // Eid-ul-Adha 2026 · May 27-29 (approx)
  if (y === 2026 && m === 5 && d >= 27 && d <= 29)
    return { id: 'eidadha', emoji: '🕌', label: 'Eid Mubarak' };
  return null;
}

function getDailyGreeting(userId) {
  const key = `ch_greet_${userId || 'anon'}`;
  const today = new Date().toISOString().slice(0, 10);
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
  if (stored.date === today && stored.greeting) return stored.greeting;
  const shown = Array.isArray(stored.shown) ? stored.shown : [];
  const available = LOGIN_GREETINGS.filter(g => !shown.includes(g));
  const pool = available.length > 0 ? available : LOGIN_GREETINGS;
  const greeting = pool[Math.floor(Math.random() * pool.length)];
  const newShown = available.length > 0 ? [...shown, greeting] : [greeting];
  try { localStorage.setItem(key, JSON.stringify({ date: today, greeting, shown: newShown })); } catch {}
  return greeting;
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

const DEFAULT_TEAM = [
  { id: 'aris',   name: 'Aris',   color: 'var(--wx-text-faint)', bg: '#DBEAFE' },
  { id: 'emily',  name: 'Emily',  color: 'var(--wx-text-faint)', bg: '#FCE7F3' },
  { id: 'myles',  name: 'Myles',  color: 'var(--wx-text-faint)', bg: '#F3F4F6' },
  { id: 'khushi', name: 'Khushi', color: 'var(--wx-danger)', bg: '#FEE2E2' },
];

const PAYMENT_OPTIONS = ['Paid', 'Not Yet'];
const VIDEOS_OPTIONS  = ['Done', 'In Progress'];

/* WURX-ADDED · the same seven hues, deep enough for the name to be read.
   These carry a white label, and at the original
   shades white measured 2.15:1 to 4.23:1 on them — every one under AA, with
   teal at 2.49:1. They are identity colours, so the hues are kept and only the
   depth changes; white now clears 5:1 on all seven. Near-black instead of
   white was the other option and it fails on the violet, so it would have
   needed two inks and a rule about which. */
const CURSOR_COLORS = ['#4F46E5','#BE185D','#0F766E','#B45309','#047857','#2563EB','#7C3AED'];
function getCursorColor(name) {
  if (!name) return CURSOR_COLORS[0];
  return CURSOR_COLORS[name.charCodeAt(0) % CURSOR_COLORS.length];
}

/* ── Sound effects (Web Audio API · no files needed) ── */
function playSound(type) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    function tone(freq, start, dur, vol = 0.22, wave = 'sine') {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      g.gain.setValueAtTime(0, ctx.currentTime + start);
      g.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.015);
    }
    if (type === 'notification') {
      // Soft two-tone ding
      tone(880, 0,    0.14, 0.20);
      tone(1174.66, 0.10, 0.22, 0.14); // A5 → D6
    } else if (type === 'paid') {
      // Ascending victory chime C5→E5→G5→C6
      tone(523.25, 0,    0.32, 0.24);
      tone(659.25, 0.13, 0.32, 0.24);
      tone(783.99, 0.26, 0.32, 0.24);
      tone(1046.5, 0.39, 0.55, 0.28);
    }
  } catch (_) { /* silent fail · browser blocked AudioContext */ }
}

/* ─── Roles ─────────────────────────────────────────────── */
/*
 * NOT CREDENTIALS. This used to carry a plaintext password per person and it
 * shipped in the browser bundle, readable by anyone who opened devtools. There
 * is no login here any more — identity comes from the hub's own sign-in — so
 * all this is now is the starting roster used to seed an empty `app_users`.
 */
const USERS = [
  { id: 'asad',  username: 'Asad',  role: 'superadmin', display: 'Asad' },
  { id: 'ipc',   username: 'IPC',   role: 'ipc',        display: 'IPC' },
  { id: 'apc',   username: 'APC',   role: 'apc',        display: 'APC' },
  { id: 'admin', username: 'Admin', role: 'admin',      display: 'Admin' },
  { id: 'lead',  username: 'Lead',  role: 'viewer',     display: 'Lead' },
];
function getBasePerms(role) {
  switch (role) {
    case 'superadmin': return { canAdd: true,  canEdit: true,  canDelete: true,  deleteBlocked: false, canSeeHiredBy: true,  viewOnly: false, brandLimit: null, canEditVideos: true,  canSetDeadline: true  };
    case 'ipc':        return { canAdd: true,  canEdit: true,  canDelete: false, deleteBlocked: false, canSeeHiredBy: false, viewOnly: false, brandLimit: null, canEditVideos: true,  canSetDeadline: false };
    case 'apc':        return { canAdd: false, canEdit: false, canDelete: false, deleteBlocked: false, canSeeHiredBy: true,  viewOnly: true,  brandLimit: 3,    canEditVideos: false, canSetDeadline: false };
    case 'admin':      return { canAdd: true,  canEdit: true,  canDelete: false, deleteBlocked: true,  canSeeHiredBy: false, viewOnly: false, brandLimit: null, canEditVideos: false, canSetDeadline: true  };
    case 'viewer':     return { canAdd: false, canEdit: false, canDelete: false, deleteBlocked: false, canSeeHiredBy: true,  viewOnly: true,  brandLimit: null, canEditVideos: false, canSetDeadline: false };
    case 'client':     return { canAdd: false, canEdit: false, canDelete: false, deleteBlocked: false, canSeeHiredBy: false, viewOnly: true,  brandLimit: null, canEditVideos: false, canSetDeadline: false };
    default:           return { canAdd: false, canEdit: false, canDelete: false, deleteBlocked: false, canSeeHiredBy: true,  viewOnly: true,  brandLimit: null, canEditVideos: false, canSetDeadline: false };
  }
}
function getPerms(role, customPerms = null) {
  const base = getBasePerms(role);
  if (!customPerms || Object.keys(customPerms).length === 0) return base;
  return { ...base, ...customPerms };
}

/* Anything gated on a capability asks through here, so a grant made in
   Access control is felt the moment that person signs in. */
function allowed(user, key) { return can(user, key); }

function relativeTime(ts) {
  if (!ts) return 'Never';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60)   return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ─── Helpers ───────────────────────────────────────────── */
function getGradient(name) {
  if (!name) return AVATAR_GRADIENTS[0];
  const idx = name.charCodeAt(0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

function parseTikTok(raw) {
  if (!raw) return { url: '', handle: '' };
  const trimmed = raw.trim();
  if (trimmed.startsWith('http')) {
    const parts = trimmed.replace(/\/$/, '').split('/');
    const last = parts[parts.length - 1] || '';
    const handle = last.startsWith('@') ? last : `@${last}`;
    return { url: trimmed, handle };
  }
  const handle = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  const url = `https://www.tiktok.com/${handle}`;
  return { url, handle };
}

function normalizeTikTokForStorage(raw) {
  const { url } = parseTikTok(raw);
  return url;
}

function getBadgeClass(status) {
  if (!status) return '';
  const s = status.toLowerCase();
  if (s === 'paid')        return 'badge-paid';
  if (s === 'not yet')     return 'badge-notyet';
  if (s === 'done')        return 'badge-done';
  if (s === 'in progress') return 'badge-inprogress';
  return '';
}

function getHiredClass(name) {
  if (!name) return '';
  const n = name.toLowerCase();
  if (n === 'aris')   return 'tag-aris';
  if (n === 'emily')  return 'tag-emily';
  if (n === 'myles')  return 'tag-myles';
  if (n === 'khushi') return 'tag-khushi';
  return '';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)     return 'just now';
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatWhatsApp(raw) {
  if (!raw) return raw;
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length < 7) return raw; // too short, leave as-is
  // Try to split: country code (1-3 digits) + 10 remaining = 11-13 total
  // Heuristic: if starts with + or has 11+ digits treat first digit(s) as country code
  if (digits.length >= 11) {
    const cc = digits.slice(0, digits.length - 10);
    const area = digits.slice(digits.length - 10, digits.length - 7);
    const mid  = digits.slice(digits.length - 7, digits.length - 4);
    const end  = digits.slice(digits.length - 4);
    return `+${cc} (${area}) ${mid}-${end}`;
  }
  // 10 digits - assume US/local, no country code
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  return raw; // fallback
}

function parseDeal(deal) {
  if (!deal) return { amount: 0, videos: 0 };
  const amtMatch = deal.match(/\$?([\d,]+(?:\.\d+)?)/);
  const vidMatch = deal.match(/for\s+(\d+)/i);
  return {
    amount: amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) : 0,
    videos: vidMatch ? parseInt(vidMatch[1], 10) : 0,
  };
}

/* Fuzzy match · returns true if query chars appear in order in text.
   Handles typos like "ahmd" → "Ahmed", "ayeha" → "Ayesha" */
function fuzzyMatch(query, text) {
  if (!query) return true;
  if (!text) return false;
  const q = String(query).toLowerCase();
  const t = String(text).toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function useOutsideClick(ref, handler) {
  useEffect(() => {
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) handler(e);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ref, handler]);
}

/* ─── StatusBadge ──────────────────────────────────────── */
function StatusBadge({ value }) {
  if (!value) return <span className="text-muted"></span>;
  const cls = getBadgeClass(value);
  return (
    <span className={`badge ${cls}`}>
      <span className="badge-dot" />
      {value}
    </span>
  );
}

/* ─── HiredTag ──────────────────────────────────────────── */
function HiredTag({ value }) {
  if (!value) return <span className="text-muted"></span>;
  const cls = getHiredClass(value);
  return <span className={cls || ''}>{value}</span>;
}

/* ─── DatePicker ────────────────────────────────────────── */
function DatePicker({ filter, onChange, onClose }) {
  const [year, setYear] = useState(filter.year || new Date().getFullYear());
  const ref = useRef(null);
  useOutsideClick(ref, onClose);

  function selectMonth(m) {
    onChange({ mode: 'month', year, month: m });
    onClose();
  }
  function selectYear() {
    onChange({ mode: 'year', year });
    onClose();
  }
  function selectAll() {
    onChange({ mode: 'all' });
    onClose();
  }

  return createPortal(
    <div className="date-popover" ref={ref}>
      <button
        className={`dp-alltime${filter.mode === 'all' ? ' selected' : ''}`}
        onClick={selectAll}
      >All Time</button>
      <div className="dp-year-row">
        <button className="dp-arrow" onClick={() => setYear(y => y - 1)}>‹</button>
        <button
          className={`dp-year-btn${filter.mode === 'year' && filter.year === year ? ' selected' : ''}`}
          onClick={selectYear}
        >{year} - Full Year</button>
        <button className="dp-arrow" onClick={() => setYear(y => y + 1)}>›</button>
      </div>
      <div className="dp-months">
        {MONTHS.map((m, i) => (
          <button
            key={m}
            className={`dp-month-btn${filter.mode === 'month' && filter.year === year && filter.month === i ? ' selected' : ''}`}
            onClick={() => selectMonth(i)}
          >{m}</button>
        ))}
      </div>
    </div>,
    wxPortalHost()
  );
}

/* ─── InlineDropdown ────────────────────────────────────── */
function InlineDropdown({ options, onSelect, onClose, position }) {
  const ref = useRef(null);
  useOutsideClick(ref, onClose);

  // Self-correct position after render so it never goes off-screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let { top, left } = position;
    if (r.bottom > window.innerHeight - 4) top = position.top - r.height - 4;
    if (top < 4)                           top = 4;
    if (r.right  > window.innerWidth  - 4) left = window.innerWidth - r.width - 4;
    if (left < 4)                          left = 4;
    el.style.top  = top  + 'px';
    el.style.left = left + 'px';
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="inline-dropdown"
      ref={ref}
      style={{ top: position.top, left: position.left }}
    >
      {options.map(opt => (
        <div
          key={opt.value}
          className="inline-dropdown-item"
          data-value={opt.value}
          onMouseDown={() => { onSelect(opt.value); onClose(); }}
        >
          {opt.label || opt.value}
        </div>
      ))}
    </div>
  );
}

/* ─── ContextMenu ────────────────────────────────────────── */
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useOutsideClick(ref, onClose);
  return (
    <div className="context-menu" ref={ref} style={{ top: y, left: x }}>
      {items.map((item, i) => (
        <button
          key={i}
          className={`context-menu-item${item.danger ? ' danger' : ''}`}
          onClick={() => { item.onClick(); onClose(); }}
        >
          <span>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ─── FilterChip ─────────────────────────────────────────── */
function FilterChip({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutsideClick(ref, () => setOpen(false));
  const active = !!value;
  return (
    <div className="fchip-wrap" ref={ref}>
      <button className={`fchip${active ? ' active' : ''}`} onClick={() => setOpen(o => !o)}>
        <span className="fchip-label">{active ? value : label}</span>
        {active
          ? <span className="fchip-x" onClick={e => { e.stopPropagation(); onChange(''); setOpen(false); }}>×</span>
          : <span className="fchip-caret">▾</span>
        }
      </button>
      {open && (
        <div className="fchip-drop">
          {active && (
            <button className="fchip-drop-item fchip-drop-clear" onMouseDown={e => { e.preventDefault(); onChange(''); setOpen(false); }}>
              ✕ Clear
            </button>
          )}
          {options.map(o => (
            <button
              key={o}
              className={`fchip-drop-item${value === o ? ' selected' : ''}`}
              onMouseDown={e => { e.preventDefault(); onChange(o); setOpen(false); }}
            >{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── DeleteConfirmModal · Tailwind premium V2 ─── */
function DeleteConfirmModal({ type, name, count, pending = 0, hidden = 0, onConfirm, onCancel }) {
  const isBrand = type === 'brand';
  const isBulk  = type === 'bulk';
  const emoji = isBrand ? '💣' : isBulk ? '☠️' : '🗑️';
  const heroFrom = isBrand ? 'tw-from-rose-500' : isBulk ? 'tw-from-rose-600' : 'tw-from-orange-500';
  const heroTo   = isBrand ? 'tw-to-rose-700'   : isBulk ? 'tw-to-rose-800'   : 'tw-to-rose-600';
  const badge    = isBrand ? 'Brand Wipeout' : isBulk ? 'Mass Delete' : 'Delete Creator';
  const ctaLabel = isBrand ? `Nuke "${name}" 💣` : isBulk ? `Delete all ${count} ☠️` : 'Delete it 🗑️';

  const subject = isBrand ? `"${name}" brand` : isBulk ? `${count} creator${count !== 1 ? 's' : ''}` : name;
  /*
   * The unreviewed applications are named, because they are the ones nobody
   * expects to lose. "17 records, 12 of them pending applications" is a
   * different decision from "5 deals", and it is the true one.
   */
  const subText = isBrand
    ? `${count} record${count !== 1 ? 's' : ''} carry this brand` +
      (pending ? ` · ${pending} ${pending === 1 ? 'is an unreviewed application' : 'are unreviewed applications'}` : '') +
      (!pending && hidden ? ` · ${hidden} not shown on this screen` : '')
    : isBulk
    ? 'All selected rows will be removed at once'
    : 'This creator and their entire record';

  return (
    <div
      className="tw-fixed tw-inset-0 tw-z-[2100] tw-bg-black/60 tw-backdrop-blur-md tw-flex tw-items-center tw-justify-center tw-p-4 tw-font-sans"
      style={{ animation: 'bsv2-fade 0.22s ease' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="tw-relative tw-w-full tw-max-w-[420px] tw-bg-white tw-rounded-[28px] tw-shadow-oneui_lg tw-overflow-hidden"
        style={{ animation: 'bsv2-pop 0.32s cubic-bezier(0.33,1,0.68,1)' }}
      >
        {/* Hero strip */}
        <div className={`tw-relative tw-h-[140px] tw-bg-gradient-to-br ${heroFrom} ${heroTo} tw-flex tw-items-center tw-justify-center tw-overflow-hidden`}>
          <div className="tw-absolute tw-inset-0 tw-opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.6) 1px, transparent 1px), radial-gradient(circle at 70% 70%, rgba(255,255,255,0.4) 1px, transparent 1px)', backgroundSize: '24px 24px, 32px 32px' }} />
          <div className="tw-text-[64px] tw-relative tw-z-10" style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.25))' }}>{emoji}</div>
          <span className="tw-absolute tw-top-4 tw-left-4 tw-inline-flex tw-items-center tw-h-6 tw-px-2.5 tw-rounded-full tw-bg-white/22 tw-backdrop-blur-md tw-border tw-border-white/30 tw-text-white tw-text-[10px] tw-font-extrabold tw-tracking-wider tw-uppercase">{badge}</span>
          <button
            onClick={onCancel}
            className="tw-absolute tw-top-3 tw-right-3 tw-w-8 tw-h-8 tw-rounded-full tw-bg-white/20 hover:tw-bg-white/35 tw-backdrop-blur-md tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[13px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-90 tw-leading-none"
            aria-label="Close"
          >✕</button>
        </div>

        {/* Body */}
        <div className="tw-p-6">
          <div className="tw-text-[22px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.5px] tw-leading-tight">Whoa, hold up! ✋</div>
          <div className="tw-text-[13.5px] tw-font-medium tw-text-oneui-mute tw-mt-1.5 tw-mb-4">
            {isBulk ? <>Bohat bary level ka delete hai boss. Confirm karo.</> :
             isBrand ? <>Brand aur uske andar k saare creators delete ho jayenge.</> :
             <>This creator's record will be removed. They won't be happy 😢</>}
          </div>

          {/* Info card */}
          <div className="tw-bg-rose-50 tw-rounded-2xl tw-p-4 tw-mb-4 tw-ring-1 tw-ring-rose-100">
            <div className="tw-flex tw-items-start tw-gap-3">
              <div className="tw-flex-shrink-0 tw-w-9 tw-h-9 tw-rounded-full tw-bg-rose-500 tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[15px] tw-font-bold tw-shadow-md tw-leading-none">
                {isBulk ? count : '!'}
              </div>
              <div className="tw-flex-1 tw-min-w-0">
                <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-rose-700">Target</div>
                <div className="tw-text-[14px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.3px] tw-truncate">{subject}</div>
                <div className="tw-text-[11.5px] tw-font-medium tw-text-rose-700/80 tw-mt-0.5">{subText}</div>
              </div>
            </div>
          </div>

          {/* Undo hint */}
          <div className="tw-flex tw-items-center tw-gap-2 tw-bg-blue-50 tw-text-blue-700 tw-rounded-2xl tw-px-3.5 tw-py-2.5 tw-mb-5 tw-ring-1 tw-ring-blue-100">
            <span className="tw-w-5 tw-h-5 tw-rounded-full tw-bg-blue-500 tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[10px] tw-font-bold tw-flex-shrink-0 tw-leading-none">↶</span>
            <span className="tw-text-[12px] tw-font-semibold tw-leading-snug">Chill, you get 5 seconds to undo if you regret it.</span>
          </div>

          {/* Actions */}
          <div className="tw-flex tw-gap-2.5">
            <button
              onClick={onCancel}
              className="tw-flex-1 tw-h-12 tw-rounded-full tw-bg-black/[0.05] hover:tw-bg-black/[0.1] tw-text-oneui-ink tw-text-[13.5px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-[0.98]"
            >Wait no, go back 🙅</button>
            <button
              onClick={onConfirm}
              className="tw-flex-1 tw-h-12 tw-rounded-full tw-bg-gradient-to-r tw-from-rose-500 tw-to-rose-600 hover:tw-from-rose-600 hover:tw-to-rose-700 tw-text-white tw-text-[13.5px] tw-font-extrabold tw-tracking-[-0.2px] tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-[0.98] tw-shadow-md hover:tw-shadow-lg"
            >{ctaLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── UndoToast ──────────────────────────────────────────── */
function UndoToast({ message, timeLeft, onUndo, onDismiss }) {
  return (
    <div className="undo-toast">
      <div className="undo-toast-left">
        <span className="undo-check">✓</span>
        <span className="undo-msg">{message}</span>
      </div>
      <div className="undo-toast-right">
        <button className="undo-btn" onClick={onUndo}>↩ Undo</button>
        <span className="undo-timer">{timeLeft}s</span>
        <button className="undo-dismiss" onClick={onDismiss}>✕</button>
      </div>
    </div>
  );
}

/* ─── MobileCreatorListV2 · Tailwind production card list ─── */
function MobileCreatorListV2({ creators, perms, currentUser, retentionMap, onOpen, onEdit, onDelete, selectedIds, onToggleSelect, onLoadMore, hasMore, totalCount, visibleCount, onRefresh }) {
  // Pull-to-refresh state
  const containerRef = useRef(null);
  const startY = useRef(null);
  const [pullDist, setPullDist] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  function onTouchStart(e) {
    if (window.scrollY > 8) return;
    startY.current = e.touches[0].clientY;
  }
  function onTouchMove(e) {
    if (startY.current == null || refreshing) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0 && window.scrollY <= 0) {
      setPullDist(Math.min(dy * 0.55, 100));
    }
  }
  async function onTouchEnd() {
    if (startY.current == null) return;
    if (pullDist > 60 && onRefresh) {
      setRefreshing(true);
      try { await onRefresh(); } catch {}
      setTimeout(() => { setRefreshing(false); setPullDist(0); }, 600);
    } else {
      setPullDist(0);
    }
    startY.current = null;
  }

  return (
    <div
      ref={containerRef}
      className="tw-block md:tw-hidden tw-px-3 tw-pb-24 tw-font-sans tw-relative"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div
        className="tw-absolute tw-left-1/2 tw-top-2 tw-z-10 tw-pointer-events-none tw-flex tw-items-center tw-justify-center"
        style={{
          transform: `translate(-50%, ${pullDist - 40}px)`,
          opacity: Math.min(pullDist / 50, 1),
          transition: refreshing || pullDist === 0 ? 'transform 0.3s cubic-bezier(0.33,1,0.68,1), opacity 0.2s' : 'none',
        }}
      >
        <div className="tw-w-10 tw-h-10 tw-rounded-full tw-bg-white tw-shadow-oneui_lg tw-ring-1 tw-ring-black/[0.06] tw-flex tw-items-center tw-justify-center">
          {refreshing ? (
            <span className="tw-w-4 tw-h-4 tw-border-2 tw-border-[#1259C3]/30 tw-border-t-[#1259C3] tw-rounded-full tw-animate-spin" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1259C3" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${Math.min(pullDist * 4, 360)}deg)`, transition: 'transform 0.1s' }}>
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          )}
        </div>
      </div>

      {/* Mobile bulk bar (when items selected) */}
      {selectedIds.size > 0 && (
        <div className="tw-sticky tw-top-2 tw-z-20 tw-mb-3" style={{ animation: 'mclv-in 0.32s cubic-bezier(0.33,1,0.68,1)' }}>
          <div className="tw-flex tw-items-center tw-gap-2 tw-bg-gradient-to-r tw-from-[#1259C3] tw-to-[#0E4DAD] tw-text-white tw-rounded-full tw-px-3 tw-py-2 tw-shadow-oneui_blue">
            <div className="tw-w-7 tw-h-7 tw-rounded-full tw-bg-white/25 tw-flex tw-items-center tw-justify-center tw-text-[12px] tw-font-extrabold">{selectedIds.size}</div>
            <span className="tw-text-[13px] tw-font-bold tw-flex-1">selected</span>
            <button onClick={() => selectedIds.forEach(id => onToggleSelect(id))} className="tw-h-7 tw-px-3 tw-rounded-full tw-bg-white/20 tw-text-white tw-text-[11.5px] tw-font-bold tw-border-0 active:tw-scale-95 tw-transition">Clear</button>
          </div>
        </div>
      )}

      {/* Cards */}
      <div className="tw-flex tw-flex-col tw-gap-2.5" style={{ transform: `translateY(${pullDist}px)`, transition: refreshing || pullDist === 0 ? 'transform 0.3s cubic-bezier(0.33,1,0.68,1)' : 'none' }}>
        {creators.map((c, idx) => (
          <MobileCreatorCard
            key={c.id}
            creator={c}
            index={idx}
            perms={perms}
            currentUser={currentUser}
            isRetainer={retentionMap[(c.name || '').trim().toLowerCase()] >= 4}
            isSelected={selectedIds.has(c.id)}
            onOpen={() => onOpen(c)}
            onEdit={() => onEdit(c)}
            onDelete={() => onDelete(c)}
            onToggleSelect={() => onToggleSelect(c.id)}
            anySelected={selectedIds.size > 0}
          />
        ))}
      </div>

      {hasMore && (
        <div className="tw-mt-4 tw-flex tw-justify-center">
          <button onClick={onLoadMore} className="tw-h-10 tw-px-5 tw-rounded-full tw-bg-white tw-text-oneui-ink tw-text-[13px] tw-font-bold tw-shadow-oneui tw-ring-1 tw-ring-black/[0.05] tw-border-0 active:tw-scale-95 tw-transition">
            Show more <span className="tw-text-oneui-mute tw-font-medium tw-ml-1">({visibleCount} of {totalCount})</span>
          </button>
        </div>
      )}
    </div>
  );
}

function MobileCreatorCard({ creator, index, perms, currentUser, isRetainer, isSelected, onOpen, onEdit, onDelete, onToggleSelect, anySelected }) {
  const { handle } = parseTikTok(creator.tiktok_account);
  const { amount } = parseDeal(creator.deal);
  const status = (() => {
    if (creator.payment_status === 'Paid' && creator.videos === 'Done') return 'green';
    if (creator.hiring_date) {
      const days = Math.floor((Date.now() - new Date(creator.hiring_date).getTime()) / 86400000);
      if (days >= 30 && creator.payment_status !== 'Paid') return 'red';
    }
    return 'amber';
  })();
  const statusBar = {
    green: 'tw-from-emerald-400 tw-to-emerald-600',
    amber: 'tw-from-amber-400 tw-to-orange-500',
    red:   'tw-from-rose-500 tw-to-rose-700',
  }[status];

  const longPressTimer = useRef(null);
  function onTouchStart(e) {
    longPressTimer.current = setTimeout(() => onToggleSelect(), 450);
  }
  function onTouchEnd() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }

  return (
    <div
      className={`tw-relative tw-overflow-hidden tw-rounded-2xl tw-bg-white tw-shadow-oneui tw-ring-1 tw-transition tw-duration-200 ${isSelected ? 'tw-ring-[#1259C3] tw-ring-2' : 'tw-ring-black/[0.05]'} active:tw-scale-[0.98]`}
      onClick={() => anySelected ? onToggleSelect() : onOpen()}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchEnd}
      style={{ animation: `mclv-card 0.32s cubic-bezier(0.33,1,0.68,1) ${Math.min(index * 0.02, 0.3)}s both` }}
    >
      {/* Status bar left edge */}
      <div className={`tw-absolute tw-left-0 tw-top-2 tw-bottom-2 tw-w-1 tw-rounded-full tw-bg-gradient-to-b ${statusBar}`} />

      <div className="tw-flex tw-items-center tw-gap-3 tw-pl-3.5 tw-pr-2 tw-py-3">
        {/* Avatar / checkbox toggle */}
        {anySelected ? (
          <div className={`tw-flex-shrink-0 tw-w-11 tw-h-11 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-transition ${isSelected ? 'tw-bg-[#1259C3] tw-text-white tw-shadow-oneui_blue' : 'tw-bg-black/[0.06] tw-text-oneui-mute'}`}>
            {isSelected ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> : <span className="tw-w-5 tw-h-5 tw-rounded-full tw-border-2 tw-border-current" />}
          </div>
        ) : (
          <div className="tw-relative tw-flex-shrink-0">
            <div className="tw-w-11 tw-h-11 tw-rounded-full tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[15px] tw-font-extrabold tw-shadow-md tw-leading-none" style={{ background: getGradient(creator.name || '?') }}>
              {(creator.name || '?')[0].toUpperCase()}
            </div>
            {creator.payment_status === 'Paid' && (
              <span className="tw-absolute -tw-bottom-0.5 -tw-right-0.5 tw-w-4 tw-h-4 tw-rounded-full tw-bg-emerald-500 tw-text-white tw-flex tw-items-center tw-justify-center tw-ring-2 tw-ring-white tw-leading-none">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </span>
            )}
          </div>
        )}

        {/* Info */}
        <div className="tw-flex-1 tw-min-w-0">
          <div className="tw-flex tw-items-center tw-gap-1.5">
            {isRetainer && <span className="tw-flex-shrink-0 tw-h-4 tw-min-w-4 tw-px-1 tw-rounded tw-bg-amber-100 tw-text-amber-700 tw-text-[9px] tw-font-extrabold tw-flex tw-items-center tw-justify-center">R</span>}
            <div className="tw-text-[14.5px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.3px] tw-truncate">{creator.name || <span className="tw-text-oneui-mute tw-font-medium tw-italic">Unnamed</span>}</div>
          </div>
          <div className="tw-flex tw-items-center tw-gap-1.5 tw-mt-0.5">
            {handle && <span className="tw-text-[11.5px] tw-font-medium tw-text-oneui-mute tw-truncate">{handle}</span>}
            {handle && creator.brand && <span className="tw-w-0.5 tw-h-0.5 tw-rounded-full tw-bg-oneui-mute/50 tw-flex-shrink-0" />}
            {creator.brand && <span className="tw-text-[11px] tw-font-bold tw-text-[#1259C3] tw-truncate">{creator.brand}</span>}
          </div>
          {(amount > 0 || creator.payment_status) && (
            <div className="tw-flex tw-items-center tw-gap-1.5 tw-mt-1.5 tw-flex-wrap">
              {amount > 0 && (
                <span className="tw-h-5 tw-px-2 tw-rounded-full tw-bg-emerald-50 tw-text-emerald-700 tw-text-[10.5px] tw-font-extrabold tw-inline-flex tw-items-center">${amount.toLocaleString()}</span>
              )}
              {creator.payment_status === 'Paid' ? (
                <span className="tw-h-5 tw-px-2 tw-rounded-full tw-bg-emerald-100 tw-text-emerald-700 tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-inline-flex tw-items-center">Paid</span>
              ) : creator.payment_status === 'Not Yet' ? (
                <span className="tw-h-5 tw-px-2 tw-rounded-full tw-bg-rose-100 tw-text-rose-700 tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-inline-flex tw-items-center">Unpaid</span>
              ) : null}
              {creator.videos === 'Done' && <span className="tw-h-5 tw-px-2 tw-rounded-full tw-bg-blue-100 tw-text-blue-700 tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-inline-flex tw-items-center">▶ Done</span>}
              {creator.videos === 'In Progress' && <span className="tw-h-5 tw-px-2 tw-rounded-full tw-bg-amber-100 tw-text-amber-700 tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-inline-flex tw-items-center">⋯ Active</span>}
            </div>
          )}
        </div>

        {/* Chevron */}
        {!anySelected && (
          <div className="tw-flex-shrink-0 tw-w-7 tw-h-7 tw-rounded-full tw-bg-black/[0.04] tw-text-oneui-mute tw-flex tw-items-center tw-justify-center">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── MobileBottomNavV2 · Tailwind floating capsule ─── */
function MobileBottomNavV2({ activeTab, onHome, onSearch, onCompare, onSettings, onAdd, hasCompare, perms, bulkMode, bulkCount, onMarkPaid, onBulkStatus, onClearSelection }) {
  if (bulkMode) {
    return (
      <div className="tw-fixed tw-bottom-3 tw-left-3 tw-right-3 tw-z-[1700] tw-font-sans md:tw-hidden" style={{ animation: 'mbn-rise 0.32s cubic-bezier(0.33,1,0.68,1)' }}>
        <div
          className="tw-flex tw-items-center tw-gap-1.5 tw-bg-white/85 tw-backdrop-blur-xl tw-rounded-full tw-shadow-oneui_lg tw-ring-1 tw-ring-black/[0.06] tw-py-1.5 tw-pl-2 tw-pr-1.5"
          onTouchStart={e => { e.currentTarget.dataset.startY = e.touches[0].clientY; }}
          onTouchMove={e => {
            const startY = parseFloat(e.currentTarget.dataset.startY || '0');
            const dy = e.touches[0].clientY - startY;
            if (dy > 0) {
              e.currentTarget.style.transform = `translateY(${Math.min(dy, 120)}px)`;
              e.currentTarget.style.opacity = String(Math.max(1 - dy / 160, 0.3));
            }
          }}
          onTouchEnd={e => {
            const startY = parseFloat(e.currentTarget.dataset.startY || '0');
            const dy = e.changedTouches[0].clientY - startY;
            if (dy > 60) onClearSelection();
            e.currentTarget.style.transform = '';
            e.currentTarget.style.opacity = '';
          }}
        >
          <div className="tw-flex tw-items-center tw-gap-1.5 tw-h-9 tw-pl-2 tw-pr-3 tw-rounded-full tw-bg-gradient-to-r tw-from-[#1259C3] tw-to-[#0E4DAD] tw-text-white tw-shadow-oneui_blue">
            <div className="tw-w-5 tw-h-5 tw-rounded-full tw-bg-white/25 tw-flex tw-items-center tw-justify-center tw-text-[10px] tw-font-extrabold">{bulkCount}</div>
            <span className="tw-text-[12px] tw-font-bold tw-tracking-[-0.2px]">selected</span>
          </div>
          <button onClick={onMarkPaid} className="tw-flex-1 tw-h-9 tw-rounded-full tw-bg-emerald-500 tw-text-white tw-text-[12px] tw-font-bold tw-flex tw-items-center tw-justify-center tw-gap-1.5 tw-border-0 active:tw-scale-95 tw-transition tw-shadow-md tw-leading-none">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            Paid
          </button>
          <button onClick={onBulkStatus} className="tw-h-9 tw-px-3 tw-rounded-full tw-bg-violet-100 tw-text-violet-700 tw-text-[12px] tw-font-bold tw-border-0 active:tw-scale-95 tw-transition">Status</button>
          <button onClick={onClearSelection} aria-label="Clear" className="tw-w-9 tw-h-9 tw-rounded-full tw-bg-black/[0.05] tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-border-0 active:tw-scale-90 tw-transition">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'home', label: 'Home', onClick: onHome,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
    { id: 'search', label: 'Search', onClick: onSearch,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> },
    ...(hasCompare ? [{ id: 'compare', label: 'Compare', onClick: onCompare,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="9" height="18" rx="2"/><rect x="13" y="3" width="9" height="18" rx="2"/></svg> }] : []),
    { id: 'more', label: 'More', onClick: onSettings,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg> },
  ];

  return (
    <>
      {/* FAB · center add button with halo glow */}
      {perms.canAdd && (
        <button
          onClick={onAdd}
          aria-label="Add Creator"
          className="md:tw-hidden tw-fixed tw-z-[1701] tw-w-14 tw-h-14 tw-rounded-full tw-bg-gradient-to-br tw-from-[#1259C3] tw-to-[#0E4DAD] tw-text-white tw-flex tw-items-center tw-justify-center tw-shadow-oneui_bluemax tw-border-0 active:tw-scale-90 tw-transition tw-duration-200 tw-ease-oneui tw-leading-none"
          style={{ bottom: 28, left: '50%', transform: 'translateX(-50%)' }}
        >
          <span className="tw-absolute tw-inset-0 tw-rounded-full tw-bg-[#1259C3]/30 tw-animate-ping" style={{ animationDuration: '2.4s' }} />
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" className="tw-relative tw-z-10"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      )}

      <nav className="md:tw-hidden tw-fixed tw-bottom-3 tw-left-3 tw-right-3 tw-z-[1700] tw-font-sans" style={{ animation: 'mbn-rise 0.36s cubic-bezier(0.33,1,0.68,1)' }}>
        <div className="tw-flex tw-items-center tw-justify-around tw-bg-white/85 tw-backdrop-blur-xl tw-rounded-full tw-shadow-oneui_lg tw-ring-1 tw-ring-black/[0.06] tw-h-14 tw-px-1.5">
          {tabs.slice(0, Math.ceil(tabs.length / 2)).map(t => (
            <MobileNavTab key={t.id} active={activeTab === t.id} {...t} />
          ))}
          {/* Center spacer for FAB */}
          {perms.canAdd && <div className="tw-w-14 tw-h-1 tw-flex-shrink-0" />}
          {tabs.slice(Math.ceil(tabs.length / 2)).map(t => (
            <MobileNavTab key={t.id} active={activeTab === t.id} {...t} />
          ))}
        </div>
      </nav>
    </>
  );
}

function MobileNavTab({ id, label, icon, onClick, active }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`tw-flex tw-flex-col tw-items-center tw-justify-center tw-gap-0.5 tw-w-14 tw-h-12 tw-rounded-full tw-border-0 tw-cursor-pointer tw-transition tw-duration-200 tw-ease-oneui active:tw-scale-90 ${active ? 'tw-bg-blue-50 tw-text-[#1259C3]' : 'tw-bg-transparent tw-text-oneui-mute hover:tw-text-oneui-ink'}`}
    >
      {icon}
      <span className={`tw-text-[9.5px] tw-font-bold tw-tracking-[0.02em] ${active ? '' : 'tw-opacity-70'}`}>{label}</span>
    </button>
  );
}

/* ─── CalendarViewV2 · Tailwind month grid with events ─── */
function CalendarViewV2({ creators, onCardClick, onMonthFilter }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(null);

  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Build events map keyed by YYYY-MM-DD
  const events = useMemo(() => {
    const map = {};
    creators.forEach(c => {
      if (c.hiring_date) {
        const k = String(c.hiring_date).slice(0, 10);
        if (!map[k]) map[k] = { hire: [], deadline: [] };
        map[k].hire.push(c);
      }
      if (c.deadline) {
        const k = String(c.deadline).slice(0, 10);
        if (!map[k]) map[k] = { hire: [], deadline: [] };
        map[k].deadline.push(c);
      }
    });
    return map;
  }, [creators]);

  // Build 6-week grid (42 days)
  const grid = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startDayOfWeek = firstOfMonth.getDay(); // 0 = Sun
    const start = new Date(firstOfMonth);
    start.setDate(start.getDate() - startDayOfWeek);
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({
        date: d,
        key,
        inMonth: d.getMonth() === cursor.getMonth(),
        isToday: d.getTime() === today.getTime(),
        events: events[key] || { hire: [], deadline: [] },
      });
    }
    return days;
  }, [cursor, events, today]);

  function nav(delta) {
    setCursor(c => new Date(c.getFullYear(), c.getMonth() + delta, 1));
    setSelectedDay(null);
  }

  // Month KPIs
  const monthStats = useMemo(() => {
    const ys = cursor.getFullYear();
    const ms = String(cursor.getMonth() + 1).padStart(2, '0');
    const prefix = `${ys}-${ms}`;
    let hires = 0, deadlines = 0;
    Object.entries(events).forEach(([k, v]) => {
      if (k.startsWith(prefix)) { hires += v.hire.length; deadlines += v.deadline.length; }
    });
    return { hires, deadlines };
  }, [cursor, events]);

  const selectedEvents = selectedDay ? (events[selectedDay] || { hire: [], deadline: [] }) : null;

  return (
    <div className="tw-px-4 md:tw-px-6 tw-pb-24 md:tw-pb-12 tw-font-sans">
      <div className="tw-max-w-[1200px] tw-mx-auto tw-bg-white tw-rounded-[24px] tw-shadow-oneui_lg tw-ring-1 tw-ring-black/[0.05] tw-overflow-hidden">
        {/* Header */}
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-px-5 md:tw-px-6 tw-py-4 tw-border-b tw-border-black/[0.06]">
          <div className="tw-flex tw-items-center tw-gap-3">
            <button onClick={() => nav(-1)} aria-label="Previous month" className="tw-w-9 tw-h-9 tw-rounded-full tw-bg-black/[0.04] hover:tw-bg-black/[0.08] tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-border-0 tw-cursor-pointer active:tw-scale-90 tw-transition">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div>
              <div className="tw-text-[18px] md:tw-text-[20px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.5px] tw-leading-tight">{monthLabel}</div>
              <div className="tw-text-[11.5px] tw-font-semibold tw-text-oneui-mute tw-mt-0.5">
                <span className="tw-text-emerald-700">{monthStats.hires} hires</span>
                <span className="tw-mx-1.5">·</span>
                <span className="tw-text-rose-700">{monthStats.deadlines} deadlines</span>
              </div>
            </div>
            <button onClick={() => nav(1)} aria-label="Next month" className="tw-w-9 tw-h-9 tw-rounded-full tw-bg-black/[0.04] hover:tw-bg-black/[0.08] tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-border-0 tw-cursor-pointer active:tw-scale-90 tw-transition">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div className="tw-flex tw-items-center tw-gap-1.5">
            <button
              onClick={() => { setCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDay(null); }}
              className="tw-h-9 tw-px-3.5 tw-rounded-full tw-bg-blue-50 tw-text-[#1259C3] tw-text-[12px] tw-font-bold tw-border-0 tw-cursor-pointer active:tw-scale-95 tw-transition"
            >Today</button>
            {onMonthFilter && (
              <button
                onClick={() => onMonthFilter(cursor.getFullYear(), cursor.getMonth())}
                title="Filter table to this month"
                className="tw-hidden md:tw-inline-flex tw-items-center tw-gap-1.5 tw-h-9 tw-px-3.5 tw-rounded-full tw-bg-[#1259C3] tw-text-white tw-text-[12px] tw-font-bold tw-border-0 tw-cursor-pointer active:tw-scale-95 tw-transition tw-shadow-oneui_blue"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                Filter table
              </button>
            )}
          </div>
        </div>

        {/* Day-of-week header */}
        <div className="tw-grid tw-grid-cols-7 tw-gap-1 tw-px-3 md:tw-px-5 tw-py-2 tw-border-b tw-border-black/[0.04]">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="tw-text-center tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-py-1">{d}</div>
          ))}
        </div>

        {/* Grid */}
        <div className="tw-grid tw-grid-cols-7 tw-gap-1 tw-px-3 md:tw-px-5 tw-py-2">
          {grid.map(d => {
            const hCount = d.events.hire.length, dCount = d.events.deadline.length;
            const isSelected = selectedDay === d.key;
            return (
              <button
                key={d.key}
                onClick={() => setSelectedDay(isSelected ? null : d.key)}
                disabled={!d.inMonth && false}
                className={`tw-relative tw-aspect-square md:tw-aspect-auto md:tw-min-h-[78px] tw-flex tw-flex-col tw-items-stretch tw-text-left tw-px-1.5 md:tw-px-2 tw-py-1.5 tw-rounded-xl md:tw-rounded-2xl tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-95 tw-overflow-hidden ${
                  isSelected ? 'tw-bg-blue-50 tw-ring-2 tw-ring-[#1259C3]' :
                  d.isToday ? 'tw-bg-amber-50 tw-ring-1 tw-ring-amber-300' :
                  d.inMonth ? 'tw-bg-white hover:tw-bg-black/[0.025] tw-ring-1 tw-ring-black/[0.04]' :
                  'tw-bg-black/[0.015] tw-ring-1 tw-ring-transparent'
                }`}
              >
                <div className={`tw-flex tw-items-center tw-justify-between tw-mb-1 ${d.inMonth ? '' : 'tw-opacity-40'}`}>
                  <span className={`tw-text-[12.5px] tw-font-bold tw-tracking-[-0.2px] ${d.isToday ? 'tw-text-amber-700' : isSelected ? 'tw-text-[#1259C3]' : 'tw-text-oneui-ink'}`}>{d.date.getDate()}</span>
                  {d.isToday && <span className="tw-w-1.5 tw-h-1.5 tw-rounded-full tw-bg-amber-500" />}
                </div>
                {d.inMonth && (hCount > 0 || dCount > 0) && (
                  <div className="tw-flex-1 tw-flex tw-flex-col tw-gap-0.5 tw-overflow-hidden">
                    {/* Mobile: tiny dot row. Desktop: pill chips */}
                    <div className="md:tw-hidden tw-flex tw-items-center tw-gap-0.5 tw-mt-auto">
                      {hCount > 0 && <span className="tw-w-1.5 tw-h-1.5 tw-rounded-full tw-bg-emerald-500" />}
                      {dCount > 0 && <span className="tw-w-1.5 tw-h-1.5 tw-rounded-full tw-bg-rose-500" />}
                    </div>
                    <div className="tw-hidden md:tw-flex tw-flex-col tw-gap-0.5">
                      {hCount > 0 && (
                        <span className="tw-inline-flex tw-items-center tw-gap-1 tw-h-4 tw-px-1.5 tw-rounded tw-bg-emerald-100 tw-text-emerald-700 tw-text-[9.5px] tw-font-bold tw-truncate">
                          <span className="tw-w-1 tw-h-1 tw-rounded-full tw-bg-emerald-500 tw-flex-shrink-0" />
                          {hCount} hire{hCount > 1 ? 's' : ''}
                        </span>
                      )}
                      {dCount > 0 && (
                        <span className="tw-inline-flex tw-items-center tw-gap-1 tw-h-4 tw-px-1.5 tw-rounded tw-bg-rose-100 tw-text-rose-700 tw-text-[9.5px] tw-font-bold tw-truncate">
                          <span className="tw-w-1 tw-h-1 tw-rounded-full tw-bg-rose-500 tw-flex-shrink-0" />
                          {dCount} deadline{dCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Selected day events */}
        {selectedEvents && (selectedEvents.hire.length > 0 || selectedEvents.deadline.length > 0) && (
          <div className="tw-border-t tw-border-black/[0.06] tw-px-5 md:tw-px-6 tw-py-4" style={{ animation: 'cal-day 0.28s cubic-bezier(0.33,1,0.68,1)' }}>
            <div className="tw-flex tw-items-center tw-justify-between tw-mb-3">
              <div>
                <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Events</div>
                <div className="tw-text-[15px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.3px]">{new Date(selectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
              </div>
              <button onClick={() => setSelectedDay(null)} className="tw-w-8 tw-h-8 tw-rounded-full tw-bg-black/[0.04] hover:tw-bg-black/[0.08] tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-text-[11px] tw-font-bold tw-border-0 tw-cursor-pointer">✕</button>
            </div>
            <div className="tw-flex tw-flex-col tw-gap-1.5">
              {selectedEvents.hire.map(c => (
                <CalEventRow key={`h-${c.id}`} creator={c} kind="hire" onClick={() => onCardClick(c)} />
              ))}
              {selectedEvents.deadline.map(c => (
                <CalEventRow key={`d-${c.id}`} creator={c} kind="deadline" onClick={() => onCardClick(c)} />
              ))}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="tw-flex tw-items-center tw-justify-center tw-gap-4 tw-px-5 tw-py-3 tw-border-t tw-border-black/[0.06] tw-bg-black/[0.015]">
          <div className="tw-flex tw-items-center tw-gap-1.5">
            <span className="tw-w-2 tw-h-2 tw-rounded-full tw-bg-emerald-500" />
            <span className="tw-text-[11px] tw-font-semibold tw-text-oneui-mute">Hire date</span>
          </div>
          <div className="tw-flex tw-items-center tw-gap-1.5">
            <span className="tw-w-2 tw-h-2 tw-rounded-full tw-bg-rose-500" />
            <span className="tw-text-[11px] tw-font-semibold tw-text-oneui-mute">Deadline</span>
          </div>
          <div className="tw-flex tw-items-center tw-gap-1.5">
            <span className="tw-w-2 tw-h-2 tw-rounded-full tw-bg-amber-500" />
            <span className="tw-text-[11px] tw-font-semibold tw-text-oneui-mute">Today</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CalEventRow({ creator, kind, onClick }) {
  const { handle } = parseTikTok(creator.tiktok_account);
  const tone = kind === 'hire' ? { dot: 'tw-bg-emerald-500', bg: 'tw-bg-emerald-50/60', label: 'Hired', text: 'tw-text-emerald-700' } : { dot: 'tw-bg-rose-500', bg: 'tw-bg-rose-50/60', label: 'Deadline', text: 'tw-text-rose-700' };
  return (
    <button onClick={onClick} className={`tw-flex tw-items-center tw-gap-3 tw-w-full tw-px-3 tw-py-2.5 tw-rounded-2xl ${tone.bg} hover:tw-brightness-95 tw-border-0 tw-cursor-pointer tw-text-left active:tw-scale-[0.98] tw-transition`}>
      <span className={`tw-w-2 tw-h-2 tw-rounded-full ${tone.dot} tw-flex-shrink-0`} />
      <div className="tw-w-9 tw-h-9 tw-rounded-full tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[13px] tw-font-extrabold tw-shadow-sm tw-flex-shrink-0 tw-leading-none" style={{ background: getGradient(creator.name || '?') }}>{(creator.name || '?')[0].toUpperCase()}</div>
      <div className="tw-flex-1 tw-min-w-0">
        <div className="tw-text-[13.5px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.3px] tw-truncate">{creator.name}</div>
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-[11px] tw-text-oneui-mute tw-font-medium">
          <span className={`tw-h-4 tw-px-1.5 tw-rounded ${tone.text} tw-bg-white tw-text-[9.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-inline-flex tw-items-center`}>{tone.label}</span>
          {handle && <span className="tw-truncate">{handle}</span>}
          {creator.brand && <><span className="tw-w-0.5 tw-h-0.5 tw-rounded-full tw-bg-oneui-mute/50" /><span className="tw-text-[#1259C3] tw-font-bold tw-truncate">{creator.brand}</span></>}
        </div>
      </div>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="tw-text-oneui-mute tw-flex-shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  );
}

/* ─── MobileSearchDrawerV2 · slide-down full-screen overlay ─── */
const RECENT_SEARCHES_KEY = 'ch_recent_searches';
function loadRecentSearches() {
  try { return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]'); } catch { return []; }
}
function saveRecentSearch(q) {
  if (!q || !q.trim()) return;
  try {
    const list = loadRecentSearches();
    const trimmed = q.trim();
    const next = [trimmed, ...list.filter(x => x !== trimmed)].slice(0, 8);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {}
}

function MobileSearchDrawerV2({ creators, allBrands, onClose, onSelect }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  const [recents, setRecents] = useState(loadRecentSearches);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, []);

  const suggestions = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return { creators: [], brands: [] };
    const cMatches = creators.filter(c => fuzzyMatch(query, c.name) || fuzzyMatch(query, c.tiktok_account)).slice(0, 6);
    const bMatches = allBrands.filter(b => b.toLowerCase().includes(query)).slice(0, 4);
    return { creators: cMatches, brands: bMatches };
  }, [q, creators, allBrands]);

  function commit(value) {
    saveRecentSearch(value);
    setRecents(loadRecentSearches());
    onSelect(value);
    onClose();
  }
  function clearRecents() {
    try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch {}
    setRecents([]);
  }

  return (
    <div className="md:tw-hidden tw-fixed tw-inset-0 tw-z-[2050] tw-bg-white tw-font-sans tw-flex tw-flex-col" style={{ animation: 'msd-down 0.32s cubic-bezier(0.33, 1, 0.68, 1)' }}>
      {/* Search bar */}
      <div className="tw-flex tw-items-center tw-gap-2 tw-px-3 tw-pt-3 tw-pb-3 tw-border-b tw-border-black/[0.06] tw-bg-white tw-z-10">
        <div className="tw-flex-1 tw-flex tw-items-center tw-gap-2 tw-h-11 tw-px-4 tw-rounded-full tw-bg-black/[0.05] focus-within:tw-bg-white focus-within:tw-ring-2 focus-within:tw-ring-[#1259C3]/30 tw-transition">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="tw-flex-shrink-0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && q.trim()) commit(q.trim()); }}
            placeholder="Search creators, brands…"
            className="tw-flex-1 tw-bg-transparent tw-border-0 tw-outline-none tw-text-[14.5px] tw-font-semibold tw-text-oneui-ink tw-placeholder:text-oneui-mute/70"
            autoComplete="off"
          />
          {q && (
            <button onClick={() => { setQ(''); inputRef.current?.focus(); }} className="tw-w-6 tw-h-6 tw-rounded-full tw-bg-black/10 tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-text-[10px] tw-font-bold tw-border-0 tw-cursor-pointer">✕</button>
          )}
        </div>
        <button onClick={onClose} className="tw-h-11 tw-px-3 tw-text-[14px] tw-font-bold tw-text-[#1259C3] tw-bg-transparent tw-border-0 tw-cursor-pointer active:tw-scale-95 tw-transition">Cancel</button>
      </div>

      {/* Body */}
      <div className="tw-flex-1 tw-overflow-y-auto">
        {!q.trim() ? (
          <div className="tw-px-4 tw-py-4">
            {recents.length > 0 ? (
              <>
                <div className="tw-flex tw-items-center tw-justify-between tw-mb-2.5">
                  <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Recent</div>
                  <button onClick={clearRecents} className="tw-text-[11px] tw-font-bold tw-text-rose-600 tw-bg-transparent tw-border-0 tw-cursor-pointer">Clear</button>
                </div>
                <div className="tw-flex tw-flex-wrap tw-gap-1.5">
                  {recents.map(r => (
                    <button key={r} onClick={() => commit(r)} className="tw-inline-flex tw-items-center tw-gap-1.5 tw-h-9 tw-px-3 tw-rounded-full tw-bg-black/[0.04] hover:tw-bg-black/[0.08] tw-text-oneui-ink tw-text-[12.5px] tw-font-semibold tw-border-0 tw-cursor-pointer active:tw-scale-95 tw-transition">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="tw-text-oneui-mute"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      {r}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-pt-16 tw-text-center">
                <div className="tw-w-16 tw-h-16 tw-rounded-full tw-bg-blue-50 tw-flex tw-items-center tw-justify-center tw-text-[#1259C3] tw-mb-3">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </div>
                <div className="tw-text-[15px] tw-font-bold tw-text-oneui-ink tw-tracking-[-0.3px]">Search the workspace</div>
                <div className="tw-text-[12.5px] tw-text-oneui-mute tw-font-medium tw-mt-1 tw-max-w-[260px]">Find creators, brands, deals · start typing.</div>
              </div>
            )}

            <div className="tw-mt-6">
              <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mb-2.5">Quick filters</div>
              <div className="tw-flex tw-flex-wrap tw-gap-1.5">
                {['Unpaid', 'Paid this week', 'Overdue', 'In progress'].map(qf => (
                  <button key={qf} onClick={() => commit(qf)} className="tw-inline-flex tw-items-center tw-gap-1.5 tw-h-9 tw-px-3 tw-rounded-full tw-bg-blue-50 tw-text-[#1259C3] tw-text-[12.5px] tw-font-bold tw-border-0 tw-cursor-pointer active:tw-scale-95 tw-transition">
                    <span className="tw-w-1.5 tw-h-1.5 tw-rounded-full tw-bg-[#1259C3]" />
                    {qf}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="tw-px-4 tw-py-3">
            {suggestions.brands.length > 0 && (
              <div className="tw-mb-4">
                <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mb-2 tw-px-1">Brands</div>
                <div className="tw-flex tw-flex-wrap tw-gap-1.5">
                  {suggestions.brands.map(b => (
                    <button key={b} onClick={() => commit(b)} className="tw-inline-flex tw-items-center tw-gap-1.5 tw-h-9 tw-px-3 tw-rounded-full tw-bg-violet-50 tw-text-violet-700 tw-text-[12.5px] tw-font-bold tw-border-0 tw-cursor-pointer active:tw-scale-95 tw-transition">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {suggestions.creators.length > 0 ? (
              <div>
                <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mb-2 tw-px-1">Creators</div>
                <div className="tw-flex tw-flex-col tw-gap-1">
                  {suggestions.creators.map(c => {
                    const { handle } = parseTikTok(c.tiktok_account);
                    return (
                      <button key={c.id} onClick={() => commit(c.name)} className="tw-flex tw-items-center tw-gap-3 tw-w-full tw-px-3 tw-py-2.5 tw-rounded-2xl hover:tw-bg-black/[0.03] tw-bg-transparent tw-border-0 tw-cursor-pointer tw-text-left active:tw-scale-[0.98] tw-transition">
                        <div className="tw-w-10 tw-h-10 tw-rounded-full tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[14px] tw-font-extrabold tw-shadow-md tw-flex-shrink-0 tw-leading-none" style={{ background: getGradient(c.name || '?') }}>{(c.name || '?')[0].toUpperCase()}</div>
                        <div className="tw-flex-1 tw-min-w-0">
                          <div className="tw-text-[14px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.3px] tw-truncate">{c.name}</div>
                          <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-[11.5px] tw-text-oneui-mute tw-font-medium tw-mt-0.5">
                            {handle && <span className="tw-truncate">{handle}</span>}
                            {handle && c.brand && <span className="tw-w-0.5 tw-h-0.5 tw-rounded-full tw-bg-oneui-mute/50" />}
                            {c.brand && <span className="tw-text-[#1259C3] tw-font-bold tw-truncate">{c.brand}</span>}
                          </div>
                        </div>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="tw-text-oneui-mute tw-flex-shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : suggestions.brands.length === 0 && (
              <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-12 tw-text-center">
                <div className="tw-text-[36px] tw-mb-2">🔍</div>
                <div className="tw-text-[14px] tw-font-bold tw-text-oneui-ink">No matches</div>
                <div className="tw-text-[12px] tw-text-oneui-mute tw-font-medium tw-mt-1">Try a different keyword. Press Enter to search anyway.</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── MobileMenuSheetV2 · Tailwind iOS-style bottom sheet ─── */
function MobileMenuSheetV2({ user, role, items, onClose }) {
  const sheetRef = useRef(null);
  const startY = useRef(null);
  function onTouchStart(e) { startY.current = e.touches[0].clientY; }
  function onTouchMove(e) {
    if (startY.current == null || !sheetRef.current) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 0) {
      sheetRef.current.style.transform = `translateY(${Math.min(dy, 320)}px)`;
      sheetRef.current.style.transition = 'none';
    }
  }
  function onTouchEnd(e) {
    if (startY.current == null || !sheetRef.current) return;
    const dy = e.changedTouches[0].clientY - startY.current;
    startY.current = null;
    if (dy > 100) { onClose(); return; }
    sheetRef.current.style.transform = '';
    sheetRef.current.style.transition = '';
  }

  return (
    <div className="tw-fixed tw-inset-0 tw-z-[2000] tw-bg-black/55 tw-backdrop-blur-md tw-flex tw-items-end tw-font-sans" onClick={onClose} style={{ animation: 'bsv2-fade 0.22s ease' }}>
      <div
        ref={sheetRef}
        className="tw-w-full tw-bg-white tw-rounded-t-[28px] tw-shadow-oneui_lg tw-overflow-hidden"
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ animation: 'mms-up 0.36s cubic-bezier(0.33,1,0.68,1)' }}
      >
        {/* Drag handle */}
        <div className="tw-flex tw-justify-center tw-pt-2.5 tw-pb-1">
          <div className="tw-w-9 tw-h-1 tw-rounded-full tw-bg-black/15" />
        </div>

        {/* User card */}
        <div className="tw-px-5 tw-pt-3 tw-pb-4">
          <div className="tw-flex tw-items-center tw-gap-3 tw-bg-gradient-to-br tw-from-blue-50 tw-to-violet-50 tw-rounded-2xl tw-p-3.5">
            <div className="tw-w-12 tw-h-12 tw-rounded-full tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[17px] tw-font-extrabold tw-shadow-md tw-leading-none" style={{ background: getGradient(user) }}>
              {(user || '?')[0].toUpperCase()}
            </div>
            <div className="tw-flex-1 tw-min-w-0">
              <div className="tw-text-[15px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.3px] tw-truncate">{user}</div>
              <div className="tw-text-[11.5px] tw-font-bold tw-text-[#1259C3] tw-uppercase tw-tracking-wider tw-mt-0.5">{role}</div>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="tw-px-3 tw-pb-6 tw-flex tw-flex-col tw-gap-1">
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { item.onClick(); onClose(); }}
              className={`tw-flex tw-items-center tw-gap-3 tw-px-3 tw-py-3 tw-rounded-2xl tw-border-0 tw-bg-transparent tw-cursor-pointer tw-text-left tw-transition active:tw-scale-[0.98] ${item.danger ? 'tw-text-rose-600 active:tw-bg-rose-50' : 'tw-text-oneui-ink active:tw-bg-black/[0.04]'}`}
            >
              <div className={`tw-w-10 tw-h-10 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-flex-shrink-0 ${item.danger ? 'tw-bg-rose-100 tw-text-rose-600' : 'tw-bg-blue-50 tw-text-[#1259C3]'}`}>
                {item.icon}
              </div>
              <span className="tw-text-[14px] tw-font-bold tw-tracking-[-0.2px] tw-flex-1">{item.label}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="tw-text-oneui-mute"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── RowActionBtn · Tailwind row action with portal tooltip ─── */
const ROW_BTN_TONES = {
  blue:   { idle: 'tw-text-oneui-mute hover:tw-bg-blue-50 hover:tw-text-blue-600',       tip: '#2563EB' },
  violet: { idle: 'tw-text-oneui-mute hover:tw-bg-violet-50 hover:tw-text-violet-600',   tip: '#7C3AED' },
  rose:   { idle: 'tw-text-oneui-mute hover:tw-bg-rose-50 hover:tw-text-rose-600',       tip: '#E11D48' },
};
function RowActionBtn({ label, tone = 'blue', onClick, children }) {
  const t = ROW_BTN_TONES[tone] || ROW_BTN_TONES.blue;
  const btnRef = useRef(null);
  const [tip, setTip] = useState(null);
  function showTip() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top - 6 });
  }
  function hideTip() { setTip(null); }
  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { hideTip(); onClick(e); }}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        aria-label={label}
        className={`tw-relative tw-w-7 tw-h-7 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-border-0 tw-cursor-pointer tw-transition tw-duration-200 tw-ease-oneui active:tw-scale-90 ${t.idle}`}
      >
        {children}
      </button>
      {tip && createPortal(
        <span
          className="tw-pointer-events-none tw-fixed tw-z-[3000] tw-px-2 tw-py-0.5 tw-rounded-full tw-text-white tw-text-[10px] tw-font-bold tw-tracking-[0.04em] tw-uppercase tw-whitespace-nowrap tw-shadow-md tw-font-sans"
          style={{ left: tip.x, top: tip.y, transform: 'translate(-50%, -100%)', backgroundColor: t.tip, animation: 'rab-tip 0.16s cubic-bezier(0.33,1,0.68,1)' }}
        >{label}</span>,
        wxPortalHost()
      )}
    </>
  );
}

/* ─── BulkBarV2 · Tailwind floating glass pill bar ─── */
function BulkBarV2({ count, perms, isSuper, onEditStatus, onExportVideos, onExportCsv, onCopyUsernames, onDelete, onClear }) {
  const [animCount, setAnimCount] = useState(count);
  const [bump, setBump] = useState(false);
  useEffect(() => {
    if (count !== animCount) {
      setBump(true);
      setAnimCount(count);
      const t = setTimeout(() => setBump(false), 280);
      return () => clearTimeout(t);
    }
  }, [count, animCount]);

  const btn = "tw-h-9 tw-px-3.5 tw-rounded-full tw-flex tw-items-center tw-gap-1.5 tw-text-[12px] tw-font-bold tw-tracking-[-0.1px] tw-border-0 tw-cursor-pointer tw-transition tw-duration-200 tw-ease-oneui active:tw-scale-95";
  return (
    <div
      className="tw-fixed tw-bottom-6 tw-left-1/2 tw-z-[1800] tw-font-sans tw-pointer-events-none"
      style={{ transform: 'translateX(-50%)', animation: 'bbv2-rise 0.36s cubic-bezier(0.33,1,0.68,1)' }}
    >
      <div className="tw-pointer-events-auto tw-flex tw-items-center tw-gap-1.5 tw-bg-white/85 tw-backdrop-blur-xl tw-rounded-full tw-shadow-oneui_lg tw-ring-1 tw-ring-black/[0.06] tw-py-1.5 tw-pl-2 tw-pr-1.5">
        {/* Count pill */}
        <div className={`tw-flex tw-items-center tw-gap-2 tw-h-9 tw-pl-2.5 tw-pr-3 tw-rounded-full tw-bg-gradient-to-r tw-from-[#1259C3] tw-to-[#0E4DAD] tw-text-white tw-shadow-oneui_blue tw-transition tw-duration-300 ${bump ? 'tw-scale-105' : 'tw-scale-100'}`}>
          <div className="tw-w-5 tw-h-5 tw-rounded-full tw-bg-white/25 tw-flex tw-items-center tw-justify-center tw-text-[10.5px] tw-font-extrabold">{count}</div>
          <span className="tw-text-[12px] tw-font-bold tw-tracking-[-0.2px] tw-hidden md:tw-inline">selected</span>
        </div>

        {/* Divider */}
        <div className="tw-w-px tw-h-6 tw-bg-black/10 tw-mx-1" />

        {/* Actions */}
        {perms.canEditVideos && (
          <button onClick={onEditStatus} className={`${btn} tw-bg-violet-50 tw-text-violet-700 hover:tw-bg-violet-100`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>
            <span className="tw-hidden md:tw-inline">Edit Status</span>
          </button>
        )}
        <button onClick={onExportVideos} className={`${btn} tw-bg-amber-50 tw-text-amber-700 hover:tw-bg-amber-100`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="5" width="15" height="14" rx="2"/><polygon points="23 7 16 12 23 17 23 7" fill="currentColor" stroke="none"/></svg>
          <span className="tw-hidden md:tw-inline">Videos+Codes</span>
        </button>
        <button onClick={onExportCsv} className={`${btn} tw-bg-emerald-50 tw-text-emerald-700 hover:tw-bg-emerald-100`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span className="tw-hidden md:tw-inline">Export CSV</span>
        </button>
        <button onClick={onCopyUsernames} title="Copy unique usernames to clipboard" className={`${btn} tw-bg-sky-50 tw-text-sky-700 hover:tw-bg-sky-100`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span className="tw-hidden md:tw-inline">Copy Usernames</span>
        </button>
        {isSuper && (
          <button onClick={onDelete} className={`${btn} tw-bg-rose-50 tw-text-rose-700 hover:tw-bg-rose-100`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
            <span className="tw-hidden md:tw-inline">Delete</span>
          </button>
        )}

        <div className="tw-w-px tw-h-6 tw-bg-black/10 tw-mx-1" />

        <button onClick={onClear} title="Clear selection" className="tw-w-9 tw-h-9 tw-rounded-full tw-bg-black/[0.04] hover:tw-bg-black/[0.08] tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-90">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  );
}

/* ─── ViewSwitcherV2 · Tailwind premium dropdown selector ─── */
const VIEW_OPTIONS = [
  { id: 'table',    label: 'Table',    sub: 'Detailed rows & cells', tone: 'blue',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
  { id: 'calendar', label: 'Calendar', sub: 'Hire & deadline events', tone: 'amber',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
  { id: 'pivot',    label: 'Pivot',    sub: 'Cross-tab summary', tone: 'cyan',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg> },
  { id: 'stats',    label: 'Stats',    sub: 'KPIs & charts', tone: 'emerald',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
  { id: 'reporting', label: 'Reporting', sub: 'Executive report · GMV & ROAS', tone: 'amber',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg> },
  { id: 'creators',  label: 'Creators',  sub: 'Per-creator deals & GMV', tone: 'rose',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
];
const VIEW_TONES = {
  blue:    { ring: 'tw-ring-blue-300',    bg: 'tw-bg-blue-50',    text: 'tw-text-blue-700',    iconBg: 'tw-bg-blue-100' },
  violet:  { ring: 'tw-ring-violet-300',  bg: 'tw-bg-violet-50',  text: 'tw-text-violet-700',  iconBg: 'tw-bg-violet-100' },
  amber:   { ring: 'tw-ring-amber-300',   bg: 'tw-bg-amber-50',   text: 'tw-text-amber-700',   iconBg: 'tw-bg-amber-100' },
  cyan:    { ring: 'tw-ring-cyan-300',    bg: 'tw-bg-cyan-50',    text: 'tw-text-cyan-700',    iconBg: 'tw-bg-cyan-100' },
  emerald: { ring: 'tw-ring-emerald-300', bg: 'tw-bg-emerald-50', text: 'tw-text-emerald-700', iconBg: 'tw-bg-emerald-100' },
  rose:    { ring: 'tw-ring-rose-300',    bg: 'tw-bg-rose-50',    text: 'tw-text-rose-700',    iconBg: 'tw-bg-rose-100' },
};

function ViewSwitcherV2({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, []);
  const cur = VIEW_OPTIONS.find(o => o.id === value) || VIEW_OPTIONS[0];
  const curTone = VIEW_TONES[cur.tone];
  return (
    <div ref={ref} className="tw-relative tw-font-sans">
      <button
        onClick={() => setOpen(s => !s)}
        className={`tw-h-10 tw-pl-2.5 tw-pr-3 tw-rounded-full tw-flex tw-items-center tw-gap-2 tw-border-0 tw-cursor-pointer tw-transition tw-duration-200 tw-ease-oneui active:tw-scale-95 tw-ring-1 tw-ring-black/[0.05] tw-shadow-sm tw-bg-white hover:tw-shadow-md ${open ? 'tw-shadow-md' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch view"
      >
        <span className={`tw-w-7 tw-h-7 tw-rounded-full tw-flex tw-items-center tw-justify-center ${curTone.iconBg} ${curTone.text}`}>{cur.icon}</span>
        <span className="tw-flex tw-flex-col tw-items-start tw-leading-none">
          <span className="tw-text-[9.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">View</span>
          <span className={`tw-text-[12.5px] tw-font-extrabold tw-tracking-[-0.2px] ${curTone.text}`}>{cur.label}</span>
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={`tw-text-oneui-mute tw-transition tw-duration-200 ${open ? 'tw-rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {open && (
        <div
          className="tw-absolute tw-top-full tw-mt-2 tw-right-0 tw-z-30 tw-w-[260px] tw-bg-white tw-rounded-[20px] tw-shadow-oneui_lg tw-ring-1 tw-ring-black/[0.06] tw-overflow-hidden"
          style={{ animation: 'vsv-down 0.22s cubic-bezier(0.33, 1, 0.68, 1)' }}
        >
          <div className="tw-px-4 tw-pt-3 tw-pb-2 tw-border-b tw-border-black/[0.05]">
            <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Choose view</div>
            <div className="tw-text-[12px] tw-font-medium tw-text-oneui-mute/80 tw-mt-0.5">{VIEW_OPTIONS.length} ways to see your creators</div>
          </div>
          <div className="tw-py-1.5">
            {VIEW_OPTIONS.map(o => {
              const t = VIEW_TONES[o.tone];
              const active = o.id === value;
              return (
                <button
                  key={o.id}
                  onClick={() => { onChange(o.id); setOpen(false); }}
                  className={`tw-flex tw-items-center tw-gap-3 tw-w-full tw-px-3 tw-py-2.5 tw-mx-1.5 tw-mb-0.5 tw-rounded-2xl tw-border-0 tw-cursor-pointer tw-text-left tw-transition tw-duration-150 ${active ? `${t.bg} ${t.ring} tw-ring-1` : 'tw-bg-transparent hover:tw-bg-black/[0.04]'}`}
                  style={{ width: 'calc(100% - 12px)' }}
                >
                  <span className={`tw-flex-shrink-0 tw-w-9 tw-h-9 tw-rounded-full tw-flex tw-items-center tw-justify-center ${t.iconBg} ${t.text}`}>{o.icon}</span>
                  <span className="tw-flex-1 tw-min-w-0">
                    <div className={`tw-text-[13.5px] tw-font-extrabold tw-tracking-[-0.2px] tw-leading-none ${active ? t.text : 'tw-text-oneui-ink'}`}>{o.label}</div>
                    <div className="tw-text-[11px] tw-font-medium tw-text-oneui-mute tw-mt-1 tw-truncate">{o.sub}</div>
                  </span>
                  {active && (
                    <span className={`tw-flex-shrink-0 tw-w-5 tw-h-5 tw-rounded-full ${t.text} tw-flex tw-items-center tw-justify-center`}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── GalleryViewV2 · Tailwind visual card grid ─── */
function GalleryViewV2({ creators, onCardClick }) {
  return (
    <div className="tw-px-4 md:tw-px-6 tw-pb-24 md:tw-pb-12 tw-font-sans">
      {creators.length === 0 ? (
        <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-20 tw-text-center">
          <div className="tw-text-[44px] tw-mb-2">🖼️</div>
          <div className="tw-text-[15px] tw-font-bold tw-text-oneui-ink">No creators in gallery</div>
          <div className="tw-text-[12.5px] tw-text-oneui-mute tw-font-medium tw-mt-1">Add creators or adjust filters.</div>
        </div>
      ) : (
        <div className="tw-grid tw-grid-cols-1 sm:tw-grid-cols-2 md:tw-grid-cols-3 xl:tw-grid-cols-4 tw-gap-3.5">
          {creators.map((c, i) => <GalleryCard key={c.id} creator={c} idx={i} onClick={() => onCardClick(c)} />)}
        </div>
      )}
    </div>
  );
}

function GalleryCard({ creator, idx, onClick }) {
  const { handle } = parseTikTok(creator.tiktok_account);
  const { amount } = parseDeal(creator.deal);
  const grad = getGradient(creator.name || '?');
  const isPaid = creator.payment_status === 'Paid';
  const isOverdue = (() => {
    if (!creator.hiring_date || isPaid) return false;
    const days = Math.floor((Date.now() - new Date(creator.hiring_date).getTime()) / 86400000);
    return days >= 30;
  })();
  return (
    <button
      onClick={onClick}
      className="tw-relative tw-bg-white tw-rounded-[20px] tw-shadow-oneui hover:tw-shadow-oneui_lg tw-ring-1 tw-ring-black/[0.05] tw-overflow-hidden tw-text-left tw-border-0 tw-cursor-pointer tw-transition tw-duration-300 tw-ease-oneui hover:-tw-translate-y-1 active:tw-scale-[0.98] tw-flex tw-flex-col tw-font-sans"
      style={{ animation: `gv-pop 0.32s cubic-bezier(0.33,1,0.68,1) ${Math.min(idx * 0.012, 0.4)}s both` }}
    >
      {/* Hero strip · gradient avatar background */}
      <div className="tw-relative tw-h-[110px] tw-overflow-hidden" style={{ background: grad }}>
        <div className="tw-absolute tw-inset-0 tw-pointer-events-none" style={{ background: 'radial-gradient(ellipse 70% 80% at 80% 0%, color-mix(in srgb, var(--wx-surface-1) 32%, transparent), transparent 60%), radial-gradient(ellipse 70% 80% at 0% 100%, color-mix(in srgb, var(--wx-accent) 32%, transparent), transparent 60%)' }} />
        <div className="tw-absolute tw-inset-0 tw-pointer-events-none tw-opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.7) 1px, transparent 0)', backgroundSize: '20px 20px' }} />
        {/* Top row: status pill + brand pill */}
        <div className="tw-relative tw-z-10 tw-flex tw-items-start tw-justify-between tw-p-2.5">
          {creator.brand ? (
            <span className="tw-inline-flex tw-items-center tw-h-5 tw-px-2 tw-rounded-full tw-bg-white/25 tw-backdrop-blur-md tw-border tw-border-white/30 tw-text-white tw-text-[10px] tw-font-extrabold tw-truncate tw-max-w-[140px]">{creator.brand}</span>
          ) : <span />}
          <span className={`tw-inline-flex tw-items-center tw-h-5 tw-px-2 tw-rounded-full tw-text-[10px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-backdrop-blur-md tw-border tw-border-white/30 ${isPaid ? 'tw-bg-emerald-500/80 tw-text-white' : isOverdue ? 'tw-bg-rose-500/80 tw-text-white' : 'tw-bg-white/25 tw-text-white'}`}>
            {isPaid ? 'Paid' : isOverdue ? 'Overdue' : creator.payment_status || 'Pending'}
          </span>
        </div>
      </div>

      {/* Avatar overlapping hero */}
      <div className="tw-relative tw-px-4 tw--mt-9 tw-flex tw-items-end tw-justify-between">
        <div className="tw-w-[68px] tw-h-[68px] tw-rounded-full tw-bg-white tw-p-1 tw-shadow-md">
          <div className="tw-w-full tw-h-full tw-rounded-full tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[24px] tw-font-extrabold tw-leading-none" style={{ background: grad }}>
            {(creator.name || '?')[0].toUpperCase()}
          </div>
        </div>
        {amount > 0 && (
          <span className="tw-mb-2 tw-inline-flex tw-items-center tw-h-7 tw-px-2.5 tw-rounded-full tw-bg-emerald-50 tw-text-emerald-700 tw-text-[12px] tw-font-extrabold tw-ring-1 tw-ring-emerald-200">${amount.toLocaleString()}</span>
        )}
      </div>

      {/* Body */}
      <div className="tw-px-4 tw-pt-3 tw-pb-4 tw-flex-1 tw-flex tw-flex-col">
        <div className="tw-text-[15px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.4px] tw-leading-tight tw-truncate">{creator.name || <span className="tw-text-oneui-mute tw-italic tw-font-medium">Unnamed</span>}</div>
        {handle && <div className="tw-text-[11.5px] tw-font-semibold tw-text-oneui-mute tw-mt-0.5 tw-truncate">{handle}</div>}

        <div className="tw-flex tw-items-center tw-gap-1.5 tw-mt-3 tw-flex-wrap">
          {creator.category && <span className="tw-inline-flex tw-items-center tw-h-5 tw-px-2 tw-rounded-full tw-bg-blue-50 tw-text-blue-700 tw-text-[10px] tw-font-bold tw-truncate tw-max-w-[110px]">{creator.category}</span>}
          {creator.videos === 'Done' && <span className="tw-inline-flex tw-items-center tw-h-5 tw-px-2 tw-rounded-full tw-bg-blue-100 tw-text-blue-700 tw-text-[10px] tw-font-bold">▶ Done</span>}
          {creator.videos === 'In Progress' && <span className="tw-inline-flex tw-items-center tw-h-5 tw-px-2 tw-rounded-full tw-bg-amber-100 tw-text-amber-700 tw-text-[10px] tw-font-bold">⋯ Active</span>}
          {creator.hired_by && <span className="tw-inline-flex tw-items-center tw-h-5 tw-px-2 tw-rounded-full tw-bg-violet-50 tw-text-violet-700 tw-text-[10px] tw-font-bold tw-truncate tw-max-w-[100px]">by {creator.hired_by}</span>}
        </div>

        <div className="tw-flex-1" />

        {creator.hiring_date && (
          <div className="tw-text-[10.5px] tw-font-bold tw-text-oneui-mute tw-mt-3 tw-uppercase tw-tracking-wider">Hired {formatDate(creator.hiring_date)}</div>
        )}
      </div>
    </button>
  );
}

/* ─── StatsViewV2 · Tailwind premium analytics dashboard (full) ─── */
function StatsViewV2({ creators, onSelectBrand }) {
  const [trendMode, setTrendMode] = useState('amount'); // amount | count
  const [hoveredMonth, setHoveredMonth] = useState(null);

  const stats = useMemo(() => {
    const totalDeals = creators.length;
    const uniqueNames = new Set(creators.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean)).size;
    let totalRevenue = 0, paidRevenue = 0, paidCount = 0, doneCount = 0, overdueCount = 0;
    let totalVideos = 0, deliveredVideos = 0;
    const brandMap = {}, hiredMap = {}, payStatusMap = {};
    const monthly = {};
    const today = new Date(); today.setHours(0,0,0,0);
    const dailyHires = {};
    const paymentTiming = { d0_7: 0, d8_14: 0, d15_30: 0, d31_60: 0, d60p: 0 };
    const dealAmts = [];
    let biggestDeal = null, fastestPay = null, slowestPay = null;
    const nameOccurrences = {};
    const brandCountMap = {};
    creators.forEach(c => {
      const k = (c.name || '').trim().toLowerCase();
      if (k) nameOccurrences[k] = (nameOccurrences[k] || 0) + 1;
    });
    creators.forEach(c => {
      const { amount, videos: vidCount } = parseDeal(c.deal);
      totalRevenue += amount || 0;
      totalVideos += vidCount || 0;
      if (amount > 0) dealAmts.push({ creator: c, amount });
      if (c.payment_status === 'Paid') {
        paidRevenue += amount || 0; paidCount += 1;
        if (c.hiring_date) {
          const daysToday = Math.floor((today - new Date(c.hiring_date).getTime()) / 86400000);
          if (daysToday >= 0) {
            if (daysToday <= 7) paymentTiming.d0_7 += 1;
            else if (daysToday <= 14) paymentTiming.d8_14 += 1;
            else if (daysToday <= 30) paymentTiming.d15_30 += 1;
            else if (daysToday <= 60) paymentTiming.d31_60 += 1;
            else paymentTiming.d60p += 1;
            if (!fastestPay || daysToday < fastestPay.days) fastestPay = { days: daysToday, creator: c };
            if (!slowestPay || daysToday > slowestPay.days) slowestPay = { days: daysToday, creator: c };
          }
        }
      }
      if (c.videos === 'Done') { doneCount += 1; deliveredVideos += vidCount || 0; }
      if (c.brand) {
        brandMap[c.brand] = (brandMap[c.brand] || 0) + (amount || 0);
        brandCountMap[c.brand] = (brandCountMap[c.brand] || 0) + 1;
      }
      if (c.hired_by) hiredMap[c.hired_by] = (hiredMap[c.hired_by] || 0) + 1;
      const ps = c.payment_status || 'Unknown';
      payStatusMap[ps] = (payStatusMap[ps] || 0) + 1;
      if (c.hiring_date && c.payment_status !== 'Paid') {
        const days = Math.floor((today - new Date(c.hiring_date).getTime()) / 86400000);
        if (days >= 30) overdueCount += 1;
      }
      if (c.hiring_date) {
        const ym = c.hiring_date.slice(0, 7);
        if (!monthly[ym]) monthly[ym] = { count: 0, revenue: 0 };
        monthly[ym].count += 1;
        monthly[ym].revenue += amount || 0;
        const dKey = c.hiring_date.slice(0, 10);
        dailyHires[dKey] = (dailyHires[dKey] || 0) + 1;
      }
      if (!biggestDeal || amount > biggestDeal.amount) biggestDeal = { creator: c, amount };
    });
    const repeatUnique = Object.values(nameOccurrences).filter(v => v >= 2).length;
    const repeatRate = uniqueNames > 0 ? Math.round((repeatUnique / uniqueNames) * 100) : 0;
    const avgDealSize = dealAmts.length > 0 ? Math.round(totalRevenue / dealAmts.length) : 0;
    const topDeals = [...dealAmts].sort((a, b) => b.amount - a.amount).slice(0, 5);
    const topBrands = Object.entries(brandMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const topHired = Object.entries(hiredMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const monthsSorted = Object.keys(monthly).sort().slice(-12);
    const monthlyData = monthsSorted.map(m => ({ month: m, ...monthly[m] }));
    const paymentBreakdown = Object.entries(payStatusMap);
    const mostActiveBrand = Object.entries(brandCountMap).sort((a, b) => b[1] - a[1])[0];
    const last = monthlyData[monthlyData.length - 1];
    const prev = monthlyData[monthlyData.length - 2];
    const mom = last && prev ? {
      lastMonth: last.month, prevMonth: prev.month,
      countDelta: last.count - prev.count, revenueDelta: last.revenue - prev.revenue,
      countPct: prev.count > 0 ? Math.round(((last.count - prev.count) / prev.count) * 100) : null,
      revenuePct: prev.revenue > 0 ? Math.round(((last.revenue - prev.revenue) / prev.revenue) * 100) : null,
    } : null;
    const outlierThreshold = avgDealSize * 3;
    const outliers = avgDealSize > 0 ? dealAmts.filter(d => d.amount > outlierThreshold).slice(0, 3) : [];
    const veryOverdue = creators.filter(c => {
      if (c.payment_status === 'Paid' || !c.hiring_date) return false;
      const days = Math.floor((today - new Date(c.hiring_date).getTime()) / 86400000);
      return days >= 60;
    });
    return {
      totalDeals, uniqueNames, totalRevenue, paidRevenue, paidCount, doneCount, overdueCount,
      totalVideos, deliveredVideos, topBrands, topHired, monthlyData, paymentBreakdown,
      avgDealSize, biggestDeal, fastestPay, slowestPay, repeatRate, repeatUnique,
      mostActiveBrand, dailyHires, paymentTiming, topDeals, mom, outliers, veryOverdue,
    };
  }, [creators]);

  const paidPct = stats.totalDeals > 0 ? Math.round((stats.paidCount / stats.totalDeals) * 100) : 0;
  const donePct = stats.totalDeals > 0 ? Math.round((stats.doneCount / stats.totalDeals) * 100) : 0;
  const collectedPct = stats.totalRevenue > 0 ? Math.round((stats.paidRevenue / stats.totalRevenue) * 100) : 0;
  const videoDeliveredPct = stats.totalVideos > 0 ? Math.round((stats.deliveredVideos / stats.totalVideos) * 100) : 0;

  // Trend data based on toggle
  const trendData = stats.monthlyData.map(d => ({ month: d.month, value: trendMode === 'amount' ? d.revenue : d.count }));
  const trendMax = Math.max(...trendData.map(d => d.value), 1);
  const trendAvg = trendData.length > 0 ? trendData.reduce((s, d) => s + d.value, 0) / trendData.length : 0;
  const peakMonth = trendData.length > 0 ? trendData.reduce((p, d) => d.value > p.value ? d : p, trendData[0]) : null;

  // SVG paths for redesigned trend
  const trendW = 760, trendH = 200;
  const trendPath = trendData.length >= 2 ? trendData.map((d, i) => {
    const x = (i / (trendData.length - 1)) * trendW;
    const y = trendH - (d.value / trendMax) * (trendH - 30) - 10;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ') : '';
  const trendArea = trendPath ? `${trendPath} L ${trendW} ${trendH} L 0 ${trendH} Z` : '';
  const avgY = trendH - (trendAvg / trendMax) * (trendH - 30) - 10;

  const maxBrand = stats.topBrands[0]?.[1] || 1;
  const maxHired = stats.topHired[0]?.[1] || 1;

  return (
    <div className="tw-px-4 md:tw-px-6 tw-pb-24 md:tw-pb-12 tw-font-sans">
      <div className="tw-max-w-[1280px] tw-mx-auto tw-flex tw-flex-col tw-gap-3.5">

        {/* ── Quick Stats Strip ── */}
        <div className="tw-flex tw-gap-2 tw-overflow-x-auto tw-pb-1 tw--mx-1 tw-px-1">
          <QuickChip icon="🏆" label="Biggest" value={stats.biggestDeal && stats.biggestDeal.amount > 0 ? `$${stats.biggestDeal.amount.toLocaleString()}` : '-'} sub={stats.biggestDeal?.creator?.name} tone="emerald" />
          <QuickChip icon="⚡" label="Fastest Pay" value={stats.fastestPay ? `${stats.fastestPay.days}d` : '-'} sub={stats.fastestPay?.creator?.name} tone="violet" />
          <QuickChip icon="🐢" label="Slowest Pay" value={stats.slowestPay ? `${stats.slowestPay.days}d` : '-'} sub={stats.slowestPay?.creator?.name} tone="amber" />
          <QuickChip icon="📈" label="Most Active" value={stats.mostActiveBrand ? stats.mostActiveBrand[0] : '-'} sub={stats.mostActiveBrand ? `${stats.mostActiveBrand[1]} deals` : ''} tone="cyan" />
          <QuickChip icon="🔁" label="Repeat Rate" value={`${stats.repeatRate}%`} sub={`${stats.repeatUnique} creators`} tone="rose" />
        </div>

        {/* ── Hero KPI cards ── */}
        <div className="tw-grid tw-grid-cols-2 md:tw-grid-cols-4 tw-gap-3">
          <KpiBigCard tone="emerald" icon="💰" label="Allocated Budget" value={`$${stats.totalRevenue.toLocaleString()}`} sub={`${stats.totalDeals} deals`} />
          <KpiBigCard tone="blue" icon="✅" label="Paid Amount" value={`$${stats.paidRevenue.toLocaleString()}`} sub={`${collectedPct}% of budget`} progressPct={collectedPct} />
          <KpiBigCard tone="violet" icon="🎬" label="Creators Delivered" value={`${stats.doneCount} / ${stats.totalDeals}`} sub={`${donePct}% delivered · ${stats.deliveredVideos} videos`} progressPct={donePct} />
          <KpiBigCard tone="rose" icon="⚠️" label="Overdue Creators" value={stats.overdueCount} sub="unpaid 30+ days since hiring" />
        </div>

        {/* ── Budget Allocation Trend · Premium glassy bar chart ── */}
        <div className="tw-relative tw-overflow-hidden tw-rounded-[28px] tw-shadow-oneui_lg tw-bg-gradient-to-br tw-from-slate-900 tw-via-[#0E1F4D] tw-to-slate-900 tw-p-5 md:tw-p-6">
          {/* Decorative orbs */}
          <div className="tw-absolute tw--top-20 tw--right-20 tw-w-[260px] tw-h-[260px] tw-rounded-full tw-pointer-events-none tw-opacity-50" style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--wx-success-soft) 40%, transparent), transparent 70%)', filter: 'blur(40px)' }} />
          <div className="tw-absolute tw--bottom-24 tw--left-16 tw-w-[260px] tw-h-[260px] tw-rounded-full tw-pointer-events-none tw-opacity-50" style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--wx-accent) 40%, transparent), transparent 70%)', filter: 'blur(40px)' }} />
          <div className="tw-absolute tw-inset-0 tw-pointer-events-none tw-opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)', backgroundSize: '24px 24px' }} />

          {/* Header */}
          <div className="tw-relative tw-z-10 tw-flex tw-items-start tw-justify-between tw-mb-5 tw-flex-wrap tw-gap-3">
            <div>
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-h-5 tw-px-2 tw-rounded-full tw-bg-emerald-400/20 tw-backdrop-blur tw-text-emerald-300 tw-text-[10px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-mb-2 tw-ring-1 tw-ring-emerald-400/30">📈 Trend</div>
              <div className="tw-text-white tw-text-[20px] tw-font-extrabold tw-tracking-[-0.5px] tw-leading-tight">Budget Allocation</div>
              <div className="tw-text-white/70 tw-text-[12.5px] tw-font-medium tw-mt-0.5">{stats.monthlyData.length} month{stats.monthlyData.length !== 1 ? 's' : ''} · {trendMode === 'amount' ? `$${stats.totalRevenue.toLocaleString()} total` : `${stats.totalDeals} deals total`}</div>
            </div>
            <div className="tw-flex tw-items-center tw-gap-1 tw-bg-white/10 tw-backdrop-blur tw-rounded-full tw-p-1 tw-ring-1 tw-ring-white/15">
              {[{ id: 'amount', label: '$ Amount' }, { id: 'count', label: 'Deal Count' }].map(t => (
                <button key={t.id} onClick={() => setTrendMode(t.id)} className={`tw-h-7 tw-px-3 tw-rounded-full tw-text-[11px] tw-font-bold tw-tracking-[-0.1px] tw-border-0 tw-cursor-pointer tw-transition ${trendMode === t.id ? 'tw-bg-white tw-text-slate-900 tw-shadow-md' : 'tw-bg-transparent tw-text-white/70 hover:tw-text-white'}`}>{t.label}</button>
              ))}
            </div>
          </div>

          {/* Average + Peak hero stats */}
          {stats.monthlyData.length > 0 && (
            <div className="tw-relative tw-z-10 tw-grid tw-grid-cols-3 tw-gap-2 tw-mb-5">
              <div className="tw-bg-white/8 tw-backdrop-blur tw-rounded-2xl tw-p-3 tw-ring-1 tw-ring-white/10">
                <div className="tw-text-white/60 tw-text-[9.5px] tw-font-bold tw-uppercase tw-tracking-wider">Avg / month</div>
                <div className="tw-text-white tw-text-[17px] tw-font-extrabold tw-tracking-[-0.4px]">{trendMode === 'amount' ? `$${Math.round(trendAvg).toLocaleString()}` : Math.round(trendAvg)}</div>
              </div>
              {peakMonth && (
                <div className="tw-bg-emerald-400/15 tw-backdrop-blur tw-rounded-2xl tw-p-3 tw-ring-1 tw-ring-emerald-400/30">
                  <div className="tw-text-emerald-300 tw-text-[9.5px] tw-font-bold tw-uppercase tw-tracking-wider">⭐ Peak</div>
                  <div className="tw-text-white tw-text-[17px] tw-font-extrabold tw-tracking-[-0.4px]">{trendMode === 'amount' ? `$${peakMonth.value.toLocaleString()}` : peakMonth.value}</div>
                  <div className="tw-text-emerald-200 tw-text-[10px] tw-font-bold tw-mt-0.5">{peakMonth.month}</div>
                </div>
              )}
              <div className="tw-bg-white/8 tw-backdrop-blur tw-rounded-2xl tw-p-3 tw-ring-1 tw-ring-white/10">
                <div className="tw-text-white/60 tw-text-[9.5px] tw-font-bold tw-uppercase tw-tracking-wider">Latest</div>
                <div className="tw-text-white tw-text-[17px] tw-font-extrabold tw-tracking-[-0.4px]">{trendMode === 'amount' ? `$${trendData[trendData.length - 1].value.toLocaleString()}` : trendData[trendData.length - 1].value}</div>
                <div className="tw-text-white/60 tw-text-[10px] tw-font-bold tw-mt-0.5">{trendData[trendData.length - 1].month}</div>
              </div>
            </div>
          )}

          {/* Bar chart */}
          {stats.monthlyData.length === 0 ? (
            <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-12 tw-text-center tw-relative tw-z-10">
              <div className="tw-text-[40px] tw-mb-2">📉</div>
              <div className="tw-text-[14px] tw-font-bold tw-text-white">No trend data yet</div>
              <div className="tw-text-[12px] tw-text-white/60 tw-font-medium tw-mt-1">Add hiring dates to your creators.</div>
            </div>
          ) : (
            <div className="tw-relative tw-z-10">
              <div className="tw-flex tw-items-end tw-justify-between tw-gap-1.5 md:tw-gap-2 tw-h-[200px] tw-px-1">
                {trendData.map((d, i) => {
                  const heightPct = (d.value / trendMax) * 100;
                  const isPeak = peakMonth && d.month === peakMonth.month && d.value === peakMonth.value;
                  const isHovered = hoveredMonth === d.month;
                  const display = trendMode === 'amount' ? `$${d.value >= 1000 ? `${(d.value/1000).toFixed(d.value >= 10000 ? 0 : 1)}k` : d.value}` : d.value;
                  return (
                    <button
                      key={i}
                      onMouseEnter={() => setHoveredMonth(d.month)}
                      onMouseLeave={() => setHoveredMonth(null)}
                      onClick={() => setHoveredMonth(d.month === hoveredMonth ? null : d.month)}
                      className="tw-flex-1 tw-flex tw-flex-col tw-items-center tw-justify-end tw-h-full tw-bg-transparent tw-border-0 tw-cursor-pointer tw-relative tw-group tw-min-w-0"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      {/* Tooltip */}
                      {isHovered && (
                        <div className="tw-absolute tw--top-2 tw-left-1/2 -tw-translate-x-1/2 tw-z-20 tw-bg-white tw-rounded-xl tw-px-3 tw-py-2 tw-shadow-lg tw-whitespace-nowrap tw-pointer-events-none" style={{ animation: 'rab-tip 0.16s cubic-bezier(0.33,1,0.68,1)' }}>
                          <div className="tw-text-[10px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">{d.month}</div>
                          <div className="tw-text-[14px] tw-font-extrabold tw-text-emerald-700">{trendMode === 'amount' ? `$${d.value.toLocaleString()}` : `${d.value} deals`}</div>
                        </div>
                      )}
                      {/* Value label on top of bar */}
                      <div className={`tw-text-[9.5px] tw-font-extrabold tw-tracking-[-0.1px] tw-mb-1 tw-transition ${isPeak ? 'tw-text-amber-300' : 'tw-text-white/70 group-hover:tw-text-white'}`}>{display}</div>
                      {/* Bar */}
                      <div
                        className={`tw-w-full tw-rounded-t-[10px] tw-relative tw-overflow-hidden tw-shadow-lg group-hover:tw-shadow-xl tw-transition tw-duration-300`}
                        style={{
                          height: `${Math.max(heightPct, 4)}%`,
                          background: isPeak
                            ? 'linear-gradient(180deg, #FCD34D 0%, #F59E0B 60%, #D97706 100%)'
                            : isHovered
                            ? 'linear-gradient(180deg, #34D399 0%, #10B981 60%, #047857 100%)'
                            : 'linear-gradient(180deg, rgba(52,211,153,0.95) 0%, rgba(16,185,129,0.85) 60%, rgba(4,120,87,0.78) 100%)',
                          animation: 'sv-bar-grow 0.7s cubic-bezier(0.33, 1, 0.68, 1) backwards',
                          animationDelay: `${i * 50}ms`,
                        }}
                      >
                        {/* Glossy top highlight */}
                        <div className="tw-absolute tw-top-0 tw-left-0 tw-right-0 tw-h-[35%] tw-rounded-t-[10px] tw-pointer-events-none" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--wx-surface-1) 35%, transparent), transparent)' }} />
                        {/* Inner shimmer line */}
                        <div className="tw-absolute tw-top-0 tw-left-1/4 tw-right-1/4 tw-h-px tw-bg-white/40" />
                        {isPeak && <div className="tw-absolute tw-top-1.5 tw-left-1/2 -tw-translate-x-1/2 tw-text-[12px]">⭐</div>}
                      </div>
                      {/* Month label */}
                      <div className={`tw-text-[9px] tw-font-bold tw-mt-2 tw-transition ${isHovered || isPeak ? 'tw-text-white' : 'tw-text-white/50'}`}>{d.month.slice(5)}</div>
                    </button>
                  );
                })}
              </div>
              {/* Average line overlay (positioned via percentage) */}
              {trendAvg > 0 && (
                <div className="tw-absolute tw-left-0 tw-right-0 tw-pointer-events-none" style={{ bottom: `${24 + (trendAvg / trendMax) * 200}px` }}>
                  <div className="tw-flex tw-items-center tw-gap-2 tw-px-1">
                    <div className="tw-flex-1 tw-h-px tw-bg-white/30" style={{ background: 'repeating-linear-gradient(90deg, color-mix(in srgb, var(--wx-surface-1) 40%, transparent) 0 6px, transparent 6px 12px)' }} />
                    <span className="tw-text-[9.5px] tw-font-bold tw-text-white/60 tw-bg-slate-900/40 tw-px-1.5 tw-rounded-full">avg</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Status Pipeline Funnel (full width) ── */}
        <div className="tw-bg-white tw-rounded-[24px] tw-shadow-oneui tw-ring-1 tw-ring-black/[0.05] tw-p-5">
          <div className="tw-mb-4">
            <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Status Pipeline</div>
            <div className="tw-text-[16px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.4px]">Conversion funnel</div>
          </div>
          {(() => {
            const stages = [
              { label: 'Total Hired', count: stats.totalDeals, color: 'tw-bg-blue-500',    text: 'tw-text-blue-700',    bg: 'tw-bg-blue-50' },
              { label: 'Videos Done', count: stats.doneCount,  color: 'tw-bg-violet-500',  text: 'tw-text-violet-700',  bg: 'tw-bg-violet-50' },
              { label: 'Paid',        count: stats.paidCount,  color: 'tw-bg-emerald-500', text: 'tw-text-emerald-700', bg: 'tw-bg-emerald-50' },
            ];
            const max = stages[0].count || 1;
            return (
              <div className="tw-flex tw-flex-col tw-gap-2.5">
                {stages.map((s, i) => {
                  const pct = (s.count / max) * 100;
                  const prevCount = i > 0 ? stages[i - 1].count : null;
                  const drop = prevCount && prevCount > 0 ? Math.round(((prevCount - s.count) / prevCount) * 100) : null;
                  return (
                    <div key={s.label}>
                      <div className="tw-flex tw-items-center tw-justify-between tw-mb-1">
                        <span className={`tw-text-[12.5px] tw-font-bold ${s.text}`}>{s.label}</span>
                        <div className="tw-flex tw-items-center tw-gap-1.5">
                          {drop != null && drop > 0 && <span className="tw-text-[10.5px] tw-font-bold tw-text-rose-600">−{drop}%</span>}
                          <span className="tw-text-[14.5px] tw-font-extrabold tw-text-oneui-ink">{s.count}</span>
                        </div>
                      </div>
                      <div className={`tw-relative tw-h-10 ${s.bg} tw-rounded-xl tw-overflow-hidden`}>
                        <div className={`tw-h-full ${s.color} tw-rounded-xl tw-transition-all tw-duration-700 tw-flex tw-items-center tw-justify-end tw-pr-3`} style={{ width: `${Math.max(pct, 8)}%` }}>
                          <span className="tw-text-white tw-text-[11px] tw-font-extrabold">{Math.round(pct)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="tw-mt-2 tw-pt-2 tw-border-t tw-border-black/[0.05] tw-text-[12px] tw-font-bold tw-text-center">
                  <span className="tw-text-oneui-mute">Overall: </span>
                  <span className="tw-text-emerald-700">{paidPct}% paid</span>
                  <span className="tw-mx-1.5 tw-text-oneui-mute">·</span>
                  <span className="tw-text-violet-700">{donePct}% delivered</span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── 2-col: Top Brands (polished) + Payment Mix Donut (REDESIGNED) ── */}
        <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-2 tw-gap-3.5">
          {/* Top brands · polished with avatar circles + percentages */}
          <div className="tw-bg-white tw-rounded-[24px] tw-shadow-oneui tw-ring-1 tw-ring-black/[0.05] tw-p-5">
            <div className="tw-flex tw-items-center tw-justify-between tw-mb-3">
              <div>
                <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Top Brands</div>
                <div className="tw-text-[16px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.4px]">By budget allocation</div>
              </div>
              <span className="tw-text-[10.5px] tw-font-bold tw-text-oneui-mute">{stats.topBrands.length} brands · click to filter</span>
            </div>
            {stats.topBrands.length === 0 ? (
              <div className="tw-text-[12.5px] tw-text-oneui-mute tw-text-center tw-py-8">No brand data yet.</div>
            ) : (
              <div className="tw-flex tw-flex-col tw-gap-2.5">
                {stats.topBrands.map(([brand, rev], i) => {
                  const pct = (rev / maxBrand) * 100;
                  const totalPct = stats.totalRevenue > 0 ? Math.round((rev / stats.totalRevenue) * 100) : 0;
                  return (
                    <button key={brand} onClick={() => onSelectBrand && onSelectBrand(brand)} className="tw-flex tw-items-center tw-gap-3 tw-w-full tw-text-left tw-bg-transparent tw-border-0 tw-cursor-pointer tw-py-1.5 tw-px-2 tw--mx-2 tw-rounded-xl hover:tw-bg-blue-50/50 tw-transition tw-group">
                      <div className="tw-w-9 tw-h-9 tw-rounded-full tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[13px] tw-font-extrabold tw-shadow-sm tw-flex-shrink-0 tw-leading-none" style={{ background: getGradient(brand) }}>{brand[0].toUpperCase()}</div>
                      <div className="tw-flex-1 tw-min-w-0">
                        <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-mb-1">
                          <span className="tw-text-[12.5px] tw-font-extrabold tw-text-oneui-ink tw-truncate">{brand}</span>
                          <span className="tw-text-[11px] tw-font-bold tw-text-oneui-mute tw-flex-shrink-0">{totalPct}%</span>
                        </div>
                        <div className="tw-h-1.5 tw-bg-black/[0.05] tw-rounded-full tw-overflow-hidden">
                          <div className="tw-h-full tw-rounded-full tw-transition-all tw-duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${['#3B82F6','#8B5CF6','#EC4899','#F59E0B','#10B981','#06B6D4','#EF4444','#6366F1'][i % 8]}, ${['#1D4ED8','#6D28D9','#BE185D','#B45309','#047857','#0E7490','#B91C1C','#4338CA'][i % 8]})` }} />
                        </div>
                      </div>
                      <span className="tw-text-[12px] tw-font-extrabold tw-text-emerald-700 tw-flex-shrink-0 tw-w-[80px] tw-text-right">${rev.toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Payment Mix donut · REDESIGNED */}
          <div className="tw-bg-white tw-rounded-[24px] tw-shadow-oneui tw-ring-1 tw-ring-black/[0.05] tw-p-5">
            <div className="tw-mb-3">
              <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Payment Mix</div>
              <div className="tw-text-[16px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.4px]">Status breakdown</div>
            </div>
            <div className="tw-flex tw-flex-col md:tw-flex-row tw-items-center tw-gap-4">
              <DonutBig data={stats.paymentBreakdown} total={stats.totalDeals} centerLabel={`${paidPct}%`} centerSub="paid" />
              <div className="tw-flex-1 tw-w-full tw-flex tw-flex-col tw-gap-2">
                {stats.paymentBreakdown.map(([k, v], i) => {
                  const pct = stats.totalDeals > 0 ? Math.round((v / stats.totalDeals) * 100) : 0;
                  const c = k === 'Paid' ? '#10B981' : k === 'Not Yet' ? '#EF4444' : k === 'Pending' ? '#F59E0B' : k === 'Unknown' ? '#94A3B8' : '#6366F1';
                  const ic = k === 'Paid' ? '✓' : k === 'Not Yet' ? '✕' : '⏳';
                  return (
                    <div key={k} className="tw-flex tw-items-center tw-gap-2.5 tw-bg-black/[0.02] tw-rounded-xl tw-px-2.5 tw-py-2">
                      <span className="tw-w-7 tw-h-7 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-text-white tw-text-[13px] tw-font-bold tw-flex-shrink-0" style={{ background: c }}>{ic}</span>
                      <div className="tw-flex-1 tw-min-w-0">
                        <div className="tw-text-[12.5px] tw-font-extrabold tw-text-oneui-ink">{k}</div>
                        <div className="tw-h-1 tw-bg-black/[0.06] tw-rounded-full tw-overflow-hidden tw-mt-1">
                          <div className="tw-h-full tw-rounded-full tw-transition-all tw-duration-700" style={{ width: `${pct}%`, background: c }} />
                        </div>
                      </div>
                      <span className="tw-text-[14px] tw-font-extrabold tw-text-oneui-ink tw-flex-shrink-0">{v}</span>
                      <span className="tw-text-[10.5px] tw-font-bold tw-text-oneui-mute tw-w-9 tw-text-right tw-flex-shrink-0">{pct}%</span>
                    </div>
                  );
                })}
                {/* Money split bar */}
                <div className="tw-mt-1 tw-pt-2 tw-border-t tw-border-black/[0.05]">
                  <div className="tw-flex tw-items-center tw-justify-between tw-text-[10.5px] tw-font-bold tw-mb-1">
                    <span className="tw-text-emerald-700">Paid ${stats.paidRevenue.toLocaleString()}</span>
                    <span className="tw-text-rose-700">Pending ${(stats.totalRevenue - stats.paidRevenue).toLocaleString()}</span>
                  </div>
                  <div className="tw-flex tw-h-2 tw-rounded-full tw-overflow-hidden tw-bg-rose-200">
                    <div className="tw-h-full tw-bg-emerald-500 tw-transition-all tw-duration-700" style={{ width: `${collectedPct}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── 2-col: Top 5 Biggest Deals + Payment Timing ── */}
        <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-2 tw-gap-3.5">
          {/* Top 5 Biggest Deals */}
          <div className="tw-bg-white tw-rounded-[24px] tw-shadow-oneui tw-ring-1 tw-ring-black/[0.05] tw-p-5">
            <div className="tw-mb-3">
              <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Top Deals</div>
              <div className="tw-text-[16px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.4px]">5 biggest by amount</div>
            </div>
            {stats.topDeals.length === 0 ? (
              <div className="tw-text-[12.5px] tw-text-oneui-mute tw-text-center tw-py-8">No deals with amount yet.</div>
            ) : (
              <div className="tw-flex tw-flex-col tw-gap-1.5">
                {stats.topDeals.map((d, i) => {
                  const medals = ['🥇','🥈','🥉'];
                  return (
                    <div key={d.creator.id} className={`tw-flex tw-items-center tw-gap-2.5 tw-px-2.5 tw-py-2 tw-rounded-xl ${i === 0 ? 'tw-bg-gradient-to-r tw-from-amber-50/80 tw-to-transparent' : ''}`}>
                      <span className="tw-flex-shrink-0 tw-w-6 tw-text-[15px] tw-text-center">{medals[i] || <span className="tw-text-[10.5px] tw-font-bold tw-text-oneui-mute">#{i+1}</span>}</span>
                      <div className="tw-w-9 tw-h-9 tw-rounded-full tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[13px] tw-font-extrabold tw-shadow-sm tw-flex-shrink-0 tw-leading-none" style={{ background: getGradient(d.creator.name || '?') }}>{(d.creator.name || '?')[0].toUpperCase()}</div>
                      <div className="tw-flex-1 tw-min-w-0">
                        <div className="tw-text-[12.5px] tw-font-extrabold tw-text-oneui-ink tw-truncate">{d.creator.name}</div>
                        <div className="tw-text-[10.5px] tw-font-semibold tw-text-oneui-mute tw-truncate">{d.creator.brand || '-'}</div>
                      </div>
                      <span className="tw-text-[14px] tw-font-extrabold tw-text-emerald-700 tw-flex-shrink-0">${d.amount.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Payment Timing Distribution */}
          <div className="tw-bg-white tw-rounded-[24px] tw-shadow-oneui tw-ring-1 tw-ring-black/[0.05] tw-p-5">
            <div className="tw-mb-3">
              <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Payment Timing</div>
              <div className="tw-text-[16px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.4px]">Days from hiring to paid</div>
            </div>
            {(() => {
              const buckets = [
                { id: 'd0_7',   label: '0-7 days',   color: 'tw-bg-emerald-500', text: 'Lightning' },
                { id: 'd8_14',  label: '8-14 days',  color: 'tw-bg-emerald-400', text: 'Quick' },
                { id: 'd15_30', label: '15-30 days', color: 'tw-bg-amber-500',   text: 'Normal' },
                { id: 'd31_60', label: '31-60 days', color: 'tw-bg-orange-500',  text: 'Slow' },
                { id: 'd60p',   label: '60+ days',   color: 'tw-bg-rose-500',    text: 'Very slow' },
              ];
              const max = Math.max(...buckets.map(b => stats.paymentTiming[b.id]), 1);
              const totalPaid = buckets.reduce((s, b) => s + stats.paymentTiming[b.id], 0);
              if (totalPaid === 0) return <div className="tw-text-[12.5px] tw-text-oneui-mute tw-text-center tw-py-8">No paid deals yet.</div>;
              return (
                <div className="tw-flex tw-flex-col tw-gap-2">
                  {buckets.map(b => {
                    const v = stats.paymentTiming[b.id];
                    const pct = (v / max) * 100;
                    const totalPct = totalPaid > 0 ? Math.round((v / totalPaid) * 100) : 0;
                    return (
                      <div key={b.id} className="tw-flex tw-items-center tw-gap-2.5">
                        <span className="tw-text-[10.5px] tw-font-bold tw-text-oneui-mute tw-w-[78px] tw-flex-shrink-0">{b.label}</span>
                        <div className="tw-flex-1 tw-h-7 tw-bg-black/[0.04] tw-rounded-lg tw-overflow-hidden tw-relative">
                          <div className={`tw-h-full ${b.color} tw-rounded-lg tw-transition-all tw-duration-700 tw-flex tw-items-center tw-pl-2`} style={{ width: `${Math.max(pct, 6)}%` }}>
                            {v > 0 && <span className="tw-text-white tw-text-[10.5px] tw-font-extrabold">{v}</span>}
                          </div>
                        </div>
                        <span className="tw-text-[10.5px] tw-font-bold tw-text-oneui-mute tw-w-8 tw-text-right tw-flex-shrink-0">{totalPct}%</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── Top Team ── */}
        {stats.topHired.length > 0 && (
          <div className="tw-bg-white tw-rounded-[24px] tw-shadow-oneui tw-ring-1 tw-ring-black/[0.05] tw-p-5">
            <div className="tw-flex tw-items-center tw-justify-between tw-mb-3">
              <div>
                <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Top Team</div>
                <div className="tw-text-[16px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.4px]">Hired-by performance</div>
              </div>
            </div>
            <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-2 lg:tw-grid-cols-3 tw-gap-2.5">
              {stats.topHired.map(([name, count]) => {
                const pct = (count / maxHired) * 100;
                return (
                  <div key={name} className="tw-flex tw-items-center tw-gap-2.5 tw-bg-black/[0.02] tw-rounded-2xl tw-px-3 tw-py-2.5">
                    <div className="tw-w-9 tw-h-9 tw-rounded-full tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[13px] tw-font-extrabold tw-shadow-sm tw-flex-shrink-0 tw-leading-none" style={{ background: getGradient(name) }}>{name[0].toUpperCase()}</div>
                    <div className="tw-flex-1 tw-min-w-0">
                      <div className="tw-text-[13px] tw-font-extrabold tw-text-oneui-ink tw-truncate">{name}</div>
                      <div className="tw-h-1.5 tw-bg-black/[0.05] tw-rounded-full tw-overflow-hidden tw-mt-1">
                        <div className="tw-h-full tw-bg-gradient-to-r tw-from-violet-500 tw-to-fuchsia-500 tw-rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="tw-text-[15px] tw-font-extrabold tw-text-violet-700">{count}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickChip({ icon, label, value, sub, tone = 'blue' }) {
  const tones = {
    blue:    'tw-from-blue-50 tw-to-cyan-50 tw-text-blue-700',
    emerald: 'tw-from-emerald-50 tw-to-teal-50 tw-text-emerald-700',
    violet:  'tw-from-violet-50 tw-to-fuchsia-50 tw-text-violet-700',
    amber:   'tw-from-amber-50 tw-to-orange-50 tw-text-amber-700',
    cyan:    'tw-from-cyan-50 tw-to-sky-50 tw-text-cyan-700',
    rose:    'tw-from-rose-50 tw-to-pink-50 tw-text-rose-700',
  };
  return (
    <div className={`tw-flex-shrink-0 tw-flex tw-items-center tw-gap-2.5 tw-bg-gradient-to-br ${tones[tone]} tw-rounded-2xl tw-px-3 tw-py-2 tw-min-w-[150px] tw-ring-1 tw-ring-black/[0.04]`}>
      <span className="tw-text-[20px] tw-flex-shrink-0">{icon}</span>
      <div className="tw-flex-1 tw-min-w-0">
        <div className="tw-text-[9.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">{label}</div>
        <div className="tw-text-[13px] tw-font-extrabold tw-tracking-[-0.3px] tw-truncate">{value}</div>
        {sub && <div className="tw-text-[10px] tw-font-medium tw-text-oneui-mute tw-truncate tw-mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function MomTile({ label, current, delta, pct, prefix = '' }) {
  const up = (delta || 0) >= 0;
  const tone = up ? 'tw-text-emerald-700 tw-bg-emerald-50' : 'tw-text-rose-700 tw-bg-rose-50';
  return (
    <div className="tw-bg-black/[0.02] tw-rounded-2xl tw-p-3 tw-ring-1 tw-ring-black/[0.04]">
      <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">{label}</div>
      <div className="tw-text-[20px] tw-font-extrabold tw-tracking-[-0.4px] tw-text-oneui-ink tw-mt-0.5">{prefix}{current.toLocaleString()}</div>
      <div className={`tw-inline-flex tw-items-center tw-gap-1 tw-mt-1.5 tw-h-5 tw-px-2 tw-rounded-full tw-text-[10.5px] tw-font-extrabold ${tone}`}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          {up ? <polyline points="6 15 12 9 18 15"/> : <polyline points="6 9 12 15 18 9"/>}
        </svg>
        {up ? '+' : ''}{prefix}{Math.abs(delta).toLocaleString()}
        {pct != null && <span className="tw-opacity-70">· {up ? '+' : ''}{pct}%</span>}
      </div>
    </div>
  );
}

function DonutBig({ data, total, centerLabel, centerSub }) {
  const size = 180, stroke = 22, r = (size - stroke) / 2, c = size / 2, circ = 2 * Math.PI * r;
  const colorByKey = (k) => {
    if (k === 'Paid') return '#10B981';        // emerald
    if (k === 'Not Yet') return '#EF4444';     // rose
    if (k === 'Pending') return '#F59E0B';     // amber
    if (k === 'Unknown') return '#94A3B8';     // slate
    return '#6366F1';                           // indigo fallback
  };
  let offset = 0;
  return (
    <div className="tw-relative tw-flex-shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} stroke="#F1F5F9" strokeWidth={stroke} fill="none" />
        {data.map(([k, v], i) => {
          const pct = total > 0 ? v / total : 0;
          const dash = pct * circ;
          const el = <circle key={i} cx={c} cy={c} r={r} stroke={colorByKey(k)} strokeWidth={stroke} fill="none" strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset} transform={`rotate(-90 ${c} ${c})`} strokeLinecap="butt" style={{ transition: 'stroke-dasharray 0.7s ease' }} />;
          offset += dash;
          return el;
        })}
      </svg>
      <div className="tw-absolute tw-inset-0 tw-flex tw-flex-col tw-items-center tw-justify-center tw-pointer-events-none">
        <div className="tw-text-[28px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.6px] tw-leading-none">{centerLabel}</div>
        <div className="tw-text-[10px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mt-1">{centerSub}</div>
        <div className="tw-text-[11px] tw-font-bold tw-text-oneui-mute tw-mt-0.5">of {total} deals</div>
      </div>
    </div>
  );
}

function KpiBigCard({ tone, icon, label, value, sub, progressPct }) {
  const styles = {
    emerald: { bg: 'tw-bg-gradient-to-br tw-from-emerald-50 tw-to-teal-50',  ring: 'tw-ring-emerald-200', text: 'tw-text-emerald-800', bar: 'tw-bg-emerald-500' },
    blue:    { bg: 'tw-bg-gradient-to-br tw-from-blue-50 tw-to-cyan-50',     ring: 'tw-ring-blue-200',    text: 'tw-text-blue-800',    bar: 'tw-bg-blue-500' },
    violet:  { bg: 'tw-bg-gradient-to-br tw-from-violet-50 tw-to-fuchsia-50',ring: 'tw-ring-violet-200',  text: 'tw-text-violet-800',  bar: 'tw-bg-violet-500' },
    rose:    { bg: 'tw-bg-gradient-to-br tw-from-rose-50 tw-to-pink-50',     ring: 'tw-ring-rose-200',    text: 'tw-text-rose-800',    bar: 'tw-bg-rose-500' },
  }[tone] || { bg: 'tw-bg-slate-50', ring: 'tw-ring-slate-200', text: 'tw-text-slate-800', bar: 'tw-bg-slate-500' };
  return (
    <div className={`tw-relative tw-overflow-hidden tw-rounded-[20px] tw-ring-1 ${styles.bg} ${styles.ring} tw-p-4`}>
      <div className="tw-flex tw-items-center tw-justify-between">
        <div className="tw-text-[22px]">{icon}</div>
      </div>
      <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mt-1">{label}</div>
      <div className={`tw-text-[20px] md:tw-text-[22px] tw-font-extrabold tw-tracking-[-0.5px] tw-mt-0.5 ${styles.text}`}>{value}</div>
      <div className="tw-text-[11px] tw-font-semibold tw-text-oneui-mute tw-mt-1">{sub}</div>
      {typeof progressPct === 'number' && (
        <div className="tw-h-1.5 tw-bg-black/[0.05] tw-rounded-full tw-overflow-hidden tw-mt-2">
          <div className={`tw-h-full tw-rounded-full ${styles.bar} tw-transition-all tw-duration-700`} style={{ width: `${progressPct}%` }} />
        </div>
      )}
    </div>
  );
}

function Donut({ data, total }) {
  const size = 110, stroke = 18, r = (size - stroke) / 2, c = size / 2, circ = 2 * Math.PI * r;
  const colorByKey = (k) => {
    if (k === 'Paid') return '#10B981';        // emerald
    if (k === 'Not Yet') return '#EF4444';     // rose
    if (k === 'Pending') return '#F59E0B';     // amber
    if (k === 'Unknown') return '#94A3B8';     // slate
    return '#6366F1';                           // indigo fallback
  };
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={r} stroke="#F1F5F9" strokeWidth={stroke} fill="none" />
      {data.map(([k, v], i) => {
        const pct = total > 0 ? v / total : 0;
        const dash = pct * circ;
        const stroke2 = k === 'Paid' ? '#10B981' : k === 'Not Yet' ? '#EF4444' : k === 'Pending' ? '#F59E0B' : k === 'Unknown' ? '#94A3B8' : '#6366F1';
        const el = <circle key={i} cx={c} cy={c} r={r} stroke={stroke2} strokeWidth={stroke} fill="none" strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset} transform={`rotate(-90 ${c} ${c})`} strokeLinecap="butt" />;
        offset += dash;
        return el;
      })}
      <text x={c} y={c - 2} textAnchor="middle" className="tw-fill-oneui-ink" style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.5px' }}>{total}</text>
      <text x={c} y={c + 14} textAnchor="middle" style={{ fontSize: 9, fontWeight: 700, fill: 'var(--wx-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>deals</text>
    </svg>
  );
}

/* ─── CreatorsViewV2 · premium per-creator aggregation ─── */
const TIER_RANK = { poor: 1, healthy: 2, strong: 3, elite: 4 };
const TIER_LABEL = { elite: '👑 Elite', strong: '🌟 Strong', healthy: '✓ Healthy', poor: '⚠ Negative' };

function CreatorsViewV2({ creators, activeBrand, onCardClick, onTierUpgrade }) {
  const [sortBy, setSortBy] = useState('gmv'); // gmv | deals | roas | name
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('all'); // all | elite | strong | healthy | poor
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [showCompare, setShowCompare] = useState(false);
  const [showDealsFor, setShowDealsFor] = useState(null); // aggregated creator obj when clicked

  // Aggregate by creator name (lowercased)
  const aggregated = useMemo(() => {
    const map = {};
    creators.forEach(c => {
      const key = (c.name || '').trim().toLowerCase();
      if (!key) return;
      if (!map[key]) {
        map[key] = {
          name: c.name, key,
          firstCreator: c, // for display info
          deals: 0,
          brands: new Set(),
          allocated: 0,
          paid: 0,
          paidCount: 0,
          videosCommitted: 0,
          videosDelivered: 0,
          videosDoneCount: 0,
          adSpent: 0,
          gmv: 0,
          totalGmvBrand: 0, // sum of brand-specific Total GMV entries
          tikTok: c.tiktok_account || '',
          hiredBy: new Set(),
          handle: '',
        };
      }
      const m = map[key];
      const { amount, videos } = parseDeal(c.deal);
      m.deals += 1;
      if (c.brand) m.brands.add(c.brand);
      if (c.hired_by) m.hiredBy.add(c.hired_by);
      m.allocated += amount || 0;
      m.videosCommitted += videos || 0;
      if (c.payment_status === 'Paid') { m.paid += amount || 0; m.paidCount += 1; }
      if (c.videos === 'Done') { m.videosDoneCount += 1; m.videosDelivered += videos || 0; }
      m.adSpent += parseFloat(c.ad_spent) || 0;
      m.gmv += parseFloat(c.gmv) || 0;
      m.totalGmvBrand += parseFloat(c.total_gmv) || 0;
      if (!m.tikTok && c.tiktok_account) m.tikTok = c.tiktok_account;
      // pick most recent for name display
      if (!m.firstCreator.hiring_date || (c.hiring_date && c.hiring_date > m.firstCreator.hiring_date)) {
        m.firstCreator = c;
      }
    });
    return Object.values(map).map(m => {
      const { handle } = parseTikTok(m.tikTok);
      const roas = m.adSpent > 0 ? m.gmv / m.adSpent : null;
      const profit = m.gmv - m.adSpent;
      const tier = roas == null ? null : roas >= 3 ? 'elite' : roas >= 2 ? 'strong' : roas >= 1 ? 'healthy' : 'poor';
      return {
        ...m,
        handle,
        brandsArr: [...m.brands].sort(),
        hiredByArr: [...m.hiredBy].sort(),
        roas, profit, tier,
        deliveryPct: m.videosCommitted > 0 ? Math.round((m.videosDelivered / m.videosCommitted) * 100) : 0,
        paidPct: m.deals > 0 ? Math.round((m.paidCount / m.deals) * 100) : 0,
      };
    });
  }, [creators]);

  // Filter + sort
  const filtered = useMemo(() => {
    let list = aggregated;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q));
    }
    if (tierFilter !== 'all') {
      list = list.filter(c => c.tier === tierFilter);
    }
    // Sort-based filter: when sorting by a metric, hide creators that don't have it
    if (sortBy === 'gmv')   list = list.filter(c => c.gmv > 0);
    if (sortBy === 'roas')  list = list.filter(c => c.roas != null);
    if (sortBy === 'deals') list = list.filter(c => c.deals > 0);
    list = [...list].sort((a, b) => {
      if (sortBy === 'gmv') return b.gmv - a.gmv;
      if (sortBy === 'deals') return b.deals - a.deals;
      if (sortBy === 'roas') return (b.roas || 0) - (a.roas || 0);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return 0;
    });
    return list;
  }, [aggregated, sortBy, search, tierFilter]);

  // Aggregate totals
  const totals = useMemo(() => {
    return aggregated.reduce((acc, c) => ({
      creators: acc.creators + 1,
      deals: acc.deals + c.deals,
      allocated: acc.allocated + c.allocated,
      paid: acc.paid + c.paid,
      gmv: acc.gmv + c.gmv,
      adSpent: acc.adSpent + c.adSpent,
      videosCommitted: acc.videosCommitted + c.videosCommitted,
      videosDelivered: acc.videosDelivered + c.videosDelivered,
    }), { creators: 0, deals: 0, allocated: 0, paid: 0, gmv: 0, adSpent: 0, videosCommitted: 0, videosDelivered: 0 });
  }, [aggregated]);

  const tierCounts = useMemo(() => {
    const c = { all: aggregated.length, elite: 0, strong: 0, healthy: 0, poor: 0 };
    aggregated.forEach(x => { if (x.tier) c[x.tier] += 1; });
    return c;
  }, [aggregated]);

  // Tier-upgrade detection · celebrate when creator climbs ranks
  useEffect(() => {
    if (!onTierUpgrade) return;
    let prev;
    try { prev = JSON.parse(localStorage.getItem('ch_creator_tiers') || '{}'); } catch { prev = {}; }
    const next = {};
    aggregated.forEach(c => {
      if (c.tier) next[c.key] = c.tier;
      const prevTier = prev[c.key];
      const curTier = c.tier;
      if (prevTier && curTier && TIER_RANK[curTier] > TIER_RANK[prevTier]) {
        onTierUpgrade(c.name, prevTier, curTier);
      }
    });
    try { localStorage.setItem('ch_creator_tiers', JSON.stringify(next)); } catch {}
  }, [aggregated, onTierUpgrade]);

  function fmt$(n) { return `$${Math.round(n).toLocaleString()}`; }

  function toggleSelect(key) {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < 3) next.add(key);
      return next;
    });
  }
  function clearSelection() { setSelectedKeys(new Set()); }
  const selectedCreators = aggregated.filter(c => selectedKeys.has(c.key));

  return (
    <div className="tw-px-4 md:tw-px-6 tw-pb-24 md:tw-pb-12 tw-font-sans">
      <div className="tw-max-w-[1280px] tw-mx-auto tw-flex tw-flex-col tw-gap-3.5">

        {/* ── HERO STRIP ── */}
        <div className="tw-relative tw-overflow-hidden tw-rounded-[28px] tw-bg-gradient-to-br tw-from-[#0F172A] tw-via-[#1E1B4B] tw-to-[#0F172A] tw-p-5 md:tw-p-6 tw-shadow-oneui_lg">
          <div className="tw-absolute tw--top-24 tw--left-12 tw-w-[300px] tw-h-[300px] tw-rounded-full tw-pointer-events-none tw-opacity-50" style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--wx-accent) 45%, transparent), transparent 70%)', filter: 'blur(40px)' }} />
          <div className="tw-absolute tw--bottom-24 tw--right-12 tw-w-[300px] tw-h-[300px] tw-rounded-full tw-pointer-events-none tw-opacity-50" style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--wx-accent) 40%, transparent), transparent 70%)', filter: 'blur(40px)' }} />
          <div className="tw-absolute tw-inset-0 tw-pointer-events-none tw-opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)', backgroundSize: '22px 22px' }} />

          <div className="tw-relative tw-z-10 tw-flex tw-items-start tw-justify-between tw-flex-wrap tw-gap-4">
            <div>
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-h-5 tw-px-2 tw-rounded-full tw-bg-fuchsia-400/25 tw-backdrop-blur tw-text-fuchsia-200 tw-text-[10px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-mb-2 tw-ring-1 tw-ring-fuchsia-400/40">⭐ Creators Performance</div>
              <div className="tw-flex tw-items-baseline tw-gap-3 tw-flex-wrap">
                <div className="tw-text-white tw-text-[28px] md:tw-text-[34px] tw-font-extrabold tw-tracking-[-0.7px] tw-leading-tight">{activeBrand === 'All' ? 'All Creators' : activeBrand + ' Creators'}</div>
                <div className="tw-flex tw-items-center tw-gap-1.5 tw-h-8 tw-px-3 tw-rounded-full tw-bg-fuchsia-400/15 tw-backdrop-blur tw-ring-1 tw-ring-fuchsia-400/30">
                  <span className="tw-text-fuchsia-100 tw-text-[18px] md:tw-text-[20px] tw-font-extrabold tw-tabular-nums tw-tracking-[-0.5px]">{totals.creators}</span>
                  <span className="tw-text-fuchsia-50/85 tw-text-[11px] tw-font-bold tw-uppercase tw-tracking-wider">Unique</span>
                </div>
              </div>
              <div className="tw-text-white/70 tw-text-[12.5px] tw-font-medium tw-mt-2">
                <strong className="tw-text-white tw-font-extrabold">{totals.deals}</strong> total deals
                <span className="tw-mx-1.5 tw-text-white/30">·</span>
                <strong className="tw-text-emerald-300 tw-font-extrabold">{fmt$(totals.gmv)}</strong> GMV
                <span className="tw-mx-1.5 tw-text-white/30">·</span>
                <strong className="tw-text-rose-300 tw-font-extrabold">{fmt$(totals.adSpent)}</strong> ad
              </div>
            </div>
            {/* Search */}
            <div className="tw-flex tw-items-center tw-gap-2 tw-h-10 tw-px-3 tw-rounded-full tw-bg-white/10 tw-backdrop-blur tw-ring-1 tw-ring-white/20 tw-min-w-[220px]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search creators…" className="tw-flex-1 tw-bg-transparent tw-border-0 tw-outline-none tw-text-white tw-text-[13px] tw-font-semibold tw-placeholder-white/40 tw-min-w-0" />
              {search && <button onClick={() => setSearch('')} className="tw-w-5 tw-h-5 tw-rounded-full tw-bg-white/20 tw-text-white tw-text-[10px] tw-font-bold tw-border-0 tw-cursor-pointer">✕</button>}
            </div>
          </div>

          {/* Tier filters */}
          <div className="tw-relative tw-z-10 tw-mt-5 tw-flex tw-flex-wrap tw-gap-1.5">
            {[
              { id: 'all',     label: 'All',     count: tierCounts.all,     cls: 'tw-bg-white/15 tw-text-white tw-ring-white/25' },
              { id: 'elite',   label: '👑 Elite',   count: tierCounts.elite,   cls: 'tw-bg-amber-400/25 tw-text-amber-100 tw-ring-amber-300/40' },
              { id: 'strong',  label: '🌟 Strong',  count: tierCounts.strong,  cls: 'tw-bg-emerald-400/25 tw-text-emerald-100 tw-ring-emerald-300/40' },
              { id: 'healthy', label: '✓ Healthy', count: tierCounts.healthy, cls: 'tw-bg-blue-400/25 tw-text-blue-100 tw-ring-blue-300/40' },
              { id: 'poor',    label: '⚠ Negative', count: tierCounts.poor, cls: 'tw-bg-rose-400/25 tw-text-rose-100 tw-ring-rose-300/40' },
            ].map(t => (
              <button key={t.id} onClick={() => setTierFilter(t.id)} className={`tw-h-8 tw-px-3 tw-rounded-full tw-text-[11.5px] tw-font-extrabold tw-tracking-[-0.1px] tw-border-0 tw-cursor-pointer tw-transition tw-flex tw-items-center tw-gap-1.5 tw-ring-1 ${tierFilter === t.id ? `${t.cls} tw-shadow-md` : 'tw-bg-white/5 tw-text-white/60 tw-ring-white/10 hover:tw-bg-white/10'}`}>
                {t.label}
                <span className="tw-text-[10px] tw-font-bold tw-opacity-75">{t.count}</span>
              </button>
            ))}
          </div>

          {/* Sort selector */}
          <div className="tw-relative tw-z-10 tw-mt-3 tw-flex tw-items-center tw-justify-between tw-gap-2">
            <div className="tw-text-white/60 tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider">Showing {filtered.length} creator{filtered.length !== 1 ? 's' : ''}</div>
            <div className="tw-flex tw-items-center tw-gap-1 tw-bg-white/8 tw-backdrop-blur tw-rounded-full tw-p-1 tw-ring-1 tw-ring-white/15">
              <span className="tw-text-white/60 tw-text-[10px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-px-2">Sort</span>
              {[{ id: 'gmv', label: 'GMV' }, { id: 'deals', label: 'Deals' }, { id: 'roas', label: 'ROAS' }, { id: 'name', label: 'A-Z' }].map(s => (
                <button key={s.id} onClick={() => setSortBy(s.id)} className={`tw-h-7 tw-px-2.5 tw-rounded-full tw-text-[11px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition ${sortBy === s.id ? 'tw-bg-white tw-text-slate-900 tw-shadow-sm' : 'tw-bg-transparent tw-text-white/70 hover:tw-text-white'}`}>{s.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ── CREATOR CARDS GRID ── */}
        {filtered.length === 0 ? (
          <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-20 tw-text-center tw-bg-white tw-rounded-[24px] tw-shadow-oneui">
            <div className="tw-text-[44px] tw-mb-2">🔍</div>
            <div className="tw-text-[15px] tw-font-bold tw-text-oneui-ink">No creators match</div>
            <div className="tw-text-[12.5px] tw-text-oneui-mute tw-font-medium tw-mt-1">Try a different search or tier.</div>
          </div>
        ) : (
          <div className="tw-grid tw-grid-cols-1 lg:tw-grid-cols-2 tw-gap-3.5 tw-pb-20">
            {filtered.map((c, i) => (
              <CreatorAggregateCard
                key={c.key}
                c={c}
                idx={i}
                onClick={() => setShowDealsFor(c)}
                fmt$={fmt$}
                isSelected={selectedKeys.has(c.key)}
                onToggleSelect={() => toggleSelect(c.key)}
                selectionMode={selectedKeys.size > 0}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Floating Compare bar ── */}
      {selectedKeys.size > 0 && (
        <div className="tw-fixed tw-bottom-6 tw-left-1/2 tw-z-[1750] tw-font-sans tw-pointer-events-none" style={{ transform: 'translateX(-50%)', animation: 'bbv2-rise 0.36s cubic-bezier(0.33,1,0.68,1)' }}>
          <div className="tw-pointer-events-auto tw-flex tw-items-center tw-gap-1.5 tw-bg-white/90 tw-backdrop-blur-xl tw-rounded-full tw-shadow-oneui_lg tw-ring-1 tw-ring-black/[0.06] tw-py-1.5 tw-pl-2 tw-pr-1.5">
            <div className="tw-flex tw-items-center tw-gap-2 tw-h-9 tw-pl-2.5 tw-pr-3 tw-rounded-full tw-bg-gradient-to-r tw-from-fuchsia-600 tw-to-pink-600 tw-text-white tw-shadow-md">
              <div className="tw-w-5 tw-h-5 tw-rounded-full tw-bg-white/25 tw-flex tw-items-center tw-justify-center tw-text-[10.5px] tw-font-extrabold">{selectedKeys.size}</div>
              <span className="tw-text-[12px] tw-font-bold tw-tracking-[-0.2px]">selected</span>
            </div>
            <div className="tw-w-px tw-h-6 tw-bg-black/10 tw-mx-1" />
            <button
              onClick={() => setShowCompare(true)}
              disabled={selectedKeys.size < 2}
              className="tw-h-9 tw-px-4 tw-rounded-full tw-bg-gradient-to-r tw-from-blue-600 tw-to-violet-700 tw-text-white tw-text-[12px] tw-font-extrabold tw-tracking-[-0.1px] tw-flex tw-items-center tw-gap-1.5 tw-border-0 tw-cursor-pointer active:tw-scale-95 tw-transition tw-shadow-md disabled:tw-opacity-40 disabled:tw-cursor-not-allowed"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="9" height="18" rx="2"/><rect x="13" y="3" width="9" height="18" rx="2"/></svg>
              Compare
              {selectedKeys.size < 2 && <span className="tw-text-[10px] tw-font-medium tw-opacity-80">(pick 1 more)</span>}
            </button>
            <button onClick={clearSelection} title="Clear" className="tw-w-9 tw-h-9 tw-rounded-full tw-bg-black/[0.05] hover:tw-bg-black/[0.1] tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-90">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* ── Compare Modal ── */}
      {showCompare && selectedCreators.length >= 2 && (
        <CompareCreatorsModalV2 creators={selectedCreators} onClose={() => setShowCompare(false)} fmt$={fmt$} />
      )}

      {/* ── Creator Deals Modal (intermediate) ── */}
      {showDealsFor && (
        <CreatorDealsModalV2
          aggregate={showDealsFor}
          deals={creators.filter(d => (d.name || '').trim().toLowerCase() === showDealsFor.key)}
          fmt$={fmt$}
          onClose={() => setShowDealsFor(null)}
          onSelectDeal={(deal) => {
            setShowDealsFor(null);
            if (onCardClick) onCardClick(deal);
          }}
        />
      )}
    </div>
  );
}

/* ─── CreatorDealsModalV2 · Performance Pass + Magazine Deal Cards ─── */
function CreatorDealsModalV2({ aggregate, deals, onClose, onSelectDeal, fmt$ }) {
  const c = aggregate;
  const grad = getGradient(c.name || '?');
  const initial = (c.name || '?')[0].toUpperCase();
  const [statusFilter, setStatusFilter] = useState('all'); // all|paid|unpaid|done|active
  const [hoverDealId, setHoverDealId] = useState(null);

  const tierMeta = c.tier === 'elite' ? { label: 'Elite', emoji: '👑', from: '#FBBF24', to: '#B45309' }
    : c.tier === 'strong' ? { label: 'Strong', emoji: '🌟', from: '#34D399', to: '#047857' }
    : c.tier === 'healthy' ? { label: 'Healthy', emoji: '✓', from: '#60A5FA', to: '#1D4ED8' }
    : c.tier === 'poor' ? { label: 'Negative', emoji: '⚠', from: '#FB7185', to: '#B91C1C' }
    : null;

  // Performance Score → letter grade chip
  const scoreVal = useMemo(() => {
    const paid = c.paidPct || 0;
    const deliver = c.deliveryPct || 0;
    const roasH = Math.min(((c.roas || 0) / 3) * 100, 100);
    if (c.roas == null) return Math.round((paid + deliver) / 2);
    return Math.round((paid * 0.35) + (deliver * 0.30) + (roasH * 0.35));
  }, [c.paidPct, c.deliveryPct, c.roas]);

  const grade = scoreVal >= 90 ? { letter: 'S', color: 'var(--wx-warning)', glow: '#F59E0B' }
    : scoreVal >= 75 ? { letter: 'A', color: 'var(--wx-success)', glow: '#10B981' }
    : scoreVal >= 60 ? { letter: 'B', color: 'var(--wx-text-muted)', glow: '#2563EB' }
    : scoreVal >= 45 ? { letter: 'C', color: 'var(--wx-text-muted)', glow: '#7C3AED' }
    : scoreVal >= 30 ? { letter: 'D', color: 'var(--wx-warning)', glow: '#EA580C' }
    : { letter: 'E', color: 'var(--wx-danger)', glow: '#DC2626' };

  // Per-status counts for filter pill badges
  const counts = useMemo(() => {
    const co = { all: deals.length, paid: 0, unpaid: 0, done: 0, active: 0 };
    deals.forEach(d => {
      if (d.payment_status === 'Paid') co.paid += 1;
      if (d.payment_status === 'Not Yet') co.unpaid += 1;
      if (d.videos === 'Done') co.done += 1;
      if (d.videos === 'In Progress') co.active += 1;
    });
    return co;
  }, [deals]);

  // Filtered deals, sorted by hiring_date desc
  const sortedDeals = useMemo(() => {
    let list = [...deals];
    if (statusFilter === 'paid')   list = list.filter(d => d.payment_status === 'Paid');
    if (statusFilter === 'unpaid') list = list.filter(d => d.payment_status === 'Not Yet');
    if (statusFilter === 'done')   list = list.filter(d => d.videos === 'Done');
    if (statusFilter === 'active') list = list.filter(d => d.videos === 'In Progress');
    list.sort((a, b) => (b.hiring_date || '').localeCompare(a.hiring_date || ''));
    return list;
  }, [deals, statusFilter]);

  const STATUS_FILTERS = [
    { id: 'all',    label: 'All',     count: counts.all },
    { id: 'paid',   label: 'Paid',    count: counts.paid,   accent: 'emerald' },
    { id: 'unpaid', label: 'Unpaid',  count: counts.unpaid, accent: 'rose' },
    { id: 'done',   label: 'Done',    count: counts.done,   accent: 'blue' },
    { id: 'active', label: 'Active',  count: counts.active, accent: 'amber' },
  ];

  return (
    <div
      className="cdm-v2 tw-fixed tw-inset-0 tw-z-[1900] tw-flex tw-items-end md:tw-items-center tw-justify-center tw-p-0 md:tw-p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        background: 'color-mix(in srgb, var(--wx-accent) 42%, transparent)',
        backdropFilter: 'blur(14px) saturate(140%)',
        WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        animation: 'bsv2-fade 0.24s ease',
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: 'var(--wx-text)',
      }}
    >
      <div
        className="tw-relative tw-w-full md:tw-max-w-[520px] tw-rounded-t-[36px] md:tw-rounded-[36px] tw-overflow-hidden tw-flex tw-flex-col"
        style={{
          maxHeight: '92vh',
          background: 'var(--wx-bg)',
          boxShadow: '0 32px 80px rgba(15,23,42,0.22), 0 4px 12px rgba(15,23,42,0.06)',
          animation: 'bsv2-pop 0.42s cubic-bezier(0.33,1,0.68,1)',
        }}
      >
        {/* Mobile pull handle */}
        <div className="tw-flex tw-justify-center tw-pt-3 tw-pb-2 md:tw-hidden">
          <div style={{ width: 38, height: 5, borderRadius: 999, background: 'color-mix(in srgb, var(--wx-accent) 18%, transparent)' }} />
        </div>

        {/* ── HERO: clean white card, iOS Settings style ── */}
        <div style={{
          background: 'var(--wx-surface-1)',
          padding: '20px 22px 22px',
          position: 'relative',
        }}>
          {/* Close (top-right) */}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              position: 'absolute', top: 16, right: 16,
              width: 32, height: 32, borderRadius: 999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--wx-bg)', color: 'var(--wx-text-faint)',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#E5E5EA'; e.currentTarget.style.color = '#1C1C1E'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#F2F2F7'; e.currentTarget.style.color = '#8E8E93'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>

          {/* Identity row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingRight: 40 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: 'white',
                background: grad,
                boxShadow: '0 6px 16px rgba(15,23,42,0.18), inset 0 1px 2px rgba(255,255,255,0.4)',
              }}>{initial}</div>
              {tierMeta && (
                <div style={{
                  position: 'absolute', bottom: -3, right: -3,
                  width: 22, height: 22, borderRadius: 999,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
                  background: `linear-gradient(135deg, ${tierMeta.from}, ${tierMeta.to})`,
                  boxShadow: '0 0 0 3px white, 0 2px 6px rgba(15,23,42,0.15)',
                }}>{tierMeta.emoji}</div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--wx-text)', letterSpacing: '-0.5px', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
              {c.handle && <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--wx-text-faint)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.handle}</div>}
              {tierMeta && (
                <div style={{ marginTop: 6 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    height: 22, padding: '0 9px', borderRadius: 999,
                    fontSize: 11, fontWeight: 800, letterSpacing: '0.04em',
                    background: `linear-gradient(135deg, ${tierMeta.from}, ${tierMeta.to})`,
                    color: tierMeta.label === 'Elite' ? '#451A03' : 'white',
                    boxShadow: '0 2px 6px rgba(15,23,42,0.12)',
                  }}>{tierMeta.emoji} {tierMeta.label}</span>
                </div>
              )}
            </div>
          </div>

          {/* Stats · 4 columns separated by hairlines */}
          <div style={{
            marginTop: 18,
            background: 'var(--wx-bg)',
            borderRadius: 16,
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            overflow: 'hidden',
          }}>
            {[
              { label: 'Deals',  value: c.deals,                                                color: 'var(--wx-text)' },
              { label: 'Budget', value: fmt$(c.allocated),                                      color: 'var(--wx-text)' },
              { label: 'GMV',    value: c.gmv > 0 ? fmt$(c.gmv) : '-',                          color: c.gmv > 0 ? '#34C759' : '#8E8E93' },
              { label: 'ROAS',   value: c.roas != null ? `${c.roas.toFixed(2)}×` : '-',         color: c.roas == null ? '#8E8E93' : c.roas >= 2 ? '#34C759' : c.roas >= 1 ? '#007AFF' : '#FF3B30' },
            ].map((s, i) => (
              <div key={s.label} style={{
                padding: '12px 8px',
                textAlign: 'center',
                borderLeft: i > 0 ? '0.5px solid #D1D1D6' : 'none',
              }}>
                <div style={{ fontSize: 15.5, fontWeight: 800, color: s.color, letterSpacing: '-0.3px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--wx-text-faint)', marginTop: 4, letterSpacing: '0.02em' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── FILTER PILLS ── */}
        <div style={{ padding: '14px 18px 12px', display: 'flex', gap: 6, overflowX: 'auto' }}>
          {STATUS_FILTERS.map(f => {
            const active = statusFilter === f.id;
            const accentMap = {
              emerald: { solid: '#34C759', tint: '#E8F8EE', text: '#1F8D44' },
              rose:    { solid: '#FF3B30', tint: '#FFE9E7', text: '#C92516' },
              blue:    { solid: '#007AFF', tint: '#E1EFFF', text: '#0058C4' },
              amber:   { solid: '#FF9500', tint: '#FFF1DC', text: '#B96A00' },
            };
            const a = f.accent ? accentMap[f.accent] : { solid: '#1C1C1E', tint: '#E5E5EA', text: '#1C1C1E' };
            return (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                style={{
                  flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  height: 32, padding: '0 14px', borderRadius: 999,
                  fontSize: 13, fontWeight: 700, letterSpacing: '-0.1px',
                  background: active ? a.solid : 'white',
                  color: active ? 'white' : '#1C1C1E',
                  boxShadow: active ? `0 2px 6px ${a.solid}40` : 'inset 0 0 0 0.5px #D1D1D6',
                  transition: 'all 0.15s ease',
                }}
                onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.96)'; }}
                onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <span>{f.label}</span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
                  fontSize: 10, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                  background: active ? 'rgba(255,255,255,0.28)' : '#F2F2F7',
                  color: active ? 'white' : '#8E8E93',
                }}>{f.count}</span>
              </button>
            );
          })}
        </div>

        {/* ── DEALS LIST (iOS grouped) ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px 22px', overscrollBehavior: 'contain' }}>
          {sortedDeals.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--wx-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--wx-text)' }}>No deals match</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--wx-text-faint)', marginTop: 4 }}>Try a different filter</div>
            </div>
          ) : (
            <>
              {/* Section header */}
              <div style={{ padding: '6px 4px 8px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--wx-text)', letterSpacing: '-0.1px' }}>
                  {sortedDeals.length} {sortedDeals.length === 1 ? 'deal' : 'deals'}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--wx-text-faint)' }}>Tap to view</span>
              </div>

              {/* iOS-grouped white container with internal hairlines */}
              <div style={{
                background: 'white',
                borderRadius: 14,
                overflow: 'hidden',
                boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
              }}>
                {sortedDeals.map((d, i) => {
                  const { amount, videos } = parseDeal(d.deal);
                  const isPaid = d.payment_status === 'Paid';
                  const isUnpaid = d.payment_status === 'Not Yet';
                  const isDone = d.videos === 'Done';
                  const isInProg = d.videos === 'In Progress';
                  const isHovered = hoverDealId === d.id;

                  // Status icon definition (24px circle with vector glyph)
                  const statusIcon = isPaid ? {
                      bg: '#34C759', glyph: <polyline points="20 6 9 17 4 12"/>, sw: 3.4,
                      label: 'Paid', color: 'var(--wx-success)',
                    } : isUnpaid ? {
                      bg: '#FF3B30', glyph: <><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>, sw: 2.4,
                      label: 'Unpaid', color: 'var(--wx-danger)',
                    } : isInProg ? {
                      bg: '#FF9500', glyph: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>, sw: 2.4,
                      label: 'In Progress', color: 'var(--wx-warning)',
                    } : isDone ? {
                      bg: '#007AFF', glyph: <polygon points="6 4 20 12 6 20" />, sw: 0,
                      label: 'Done', color: 'var(--wx-text-faint)',
                    } : {
                      bg: '#8E8E93', glyph: <circle cx="12" cy="12" r="3"/>, sw: 0,
                      label: 'Open', color: 'var(--wx-text)',
                    };

                  return (
                    <button
                      key={d.id}
                      onClick={() => onSelectDeal(d)}
                      onMouseEnter={() => setHoverDealId(d.id)}
                      onMouseLeave={() => setHoverDealId(null)}
                      style={{
                        display: 'block',
                        width: '100%', textAlign: 'left',
                        padding: '14px 16px',
                        background: isHovered ? '#F2F2F7' : 'white',
                        borderBottom: i < sortedDeals.length - 1 ? '0.5px solid #E5E5EA' : 'none',
                        transition: 'background 0.12s ease',
                        animation: `gv-pop 0.36s cubic-bezier(0.33,1,0.68,1) ${Math.min(i * 0.025, 0.3)}s both`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {/* Status icon */}
                        <div style={{
                          flexShrink: 0, width: 32, height: 32, borderRadius: 999,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: statusIcon.bg, color: 'white',
                          boxShadow: `0 2px 6px ${statusIcon.bg}40`,
                        }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={statusIcon.sw === 0 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={statusIcon.sw} strokeLinecap="round" strokeLinejoin="round">
                            {statusIcon.glyph}
                          </svg>
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* Top: brand · status */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            {d.brand && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--wx-text)', letterSpacing: '-0.1px' }}>{d.brand}</span>}
                            {d.brand && <span style={{ width: 2, height: 2, borderRadius: 999, background: 'var(--wx-surface-3)' }} />}
                            <span style={{ fontSize: 11.5, fontWeight: 700, color: statusIcon.color, letterSpacing: '0.02em' }}>{statusIcon.label}</span>
                          </div>
                          {/* Headline */}
                          <div style={{
                            fontSize: 14.5, fontWeight: 700, color: 'var(--wx-text)', letterSpacing: '-0.2px', lineHeight: 1.3,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {d.deal || <span style={{ color: 'var(--wx-text-faint)', fontWeight: 500, fontStyle: 'italic' }}>No description</span>}
                          </div>
                          {/* Sub-meta */}
                          <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 500, color: 'var(--wx-text-faint)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {d.hiring_date && <span>{formatDate(d.hiring_date)}</span>}
                            {d.hiring_date && videos > 0 && <span style={{ color: 'var(--wx-text-muted)' }}>·</span>}
                            {videos > 0 && <span>{videos} {videos === 1 ? 'video' : 'videos'}</span>}
                            {d.hired_by && (
                              <>
                                <span style={{ color: 'var(--wx-text-muted)' }}>·</span>
                                <span>by <strong style={{ color: 'var(--wx-text)', fontWeight: 700 }}>{d.hired_by}</strong></span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Amount + chevron */}
                        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {amount > 0 && (
                            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--wx-text)', letterSpacing: '-0.4px', fontVariantNumeric: 'tabular-nums' }}>{fmt$(amount)}</div>
                          )}
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}

/* ─── CompareCreatorsModalV2 · side-by-side comparison ─── */
function CompareCreatorsModalV2({ creators, onClose, fmt$ }) {
  // Find best in each metric
  const best = {
    deals: Math.max(...creators.map(c => c.deals)),
    allocated: Math.max(...creators.map(c => c.allocated)),
    paid: Math.max(...creators.map(c => c.paid)),
    paidPct: Math.max(...creators.map(c => c.paidPct)),
    videosDelivered: Math.max(...creators.map(c => c.videosDelivered)),
    deliveryPct: Math.max(...creators.map(c => c.deliveryPct)),
    gmv: Math.max(...creators.map(c => c.gmv)),
    adSpentLowest: Math.min(...creators.map(c => c.adSpent || Infinity)),
    profit: Math.max(...creators.map(c => c.profit)),
    roas: Math.max(...creators.map(c => c.roas || 0)),
    brands: Math.max(...creators.map(c => c.brandsArr.length)),
  };

  const tierBadge = (tier) => {
    if (!tier) return null;
    const meta = tier === 'elite' ? 'tw-bg-gradient-to-r tw-from-amber-300 tw-to-amber-500 tw-text-amber-950'
      : tier === 'strong' ? 'tw-bg-emerald-100 tw-text-emerald-800 tw-ring-1 tw-ring-emerald-300'
      : tier === 'healthy' ? 'tw-bg-blue-100 tw-text-blue-800 tw-ring-1 tw-ring-blue-300'
      : 'tw-bg-rose-100 tw-text-rose-800 tw-ring-1 tw-ring-rose-300';
    return <span className={`tw-inline-flex tw-items-center tw-h-5 tw-px-2 tw-rounded-full tw-text-[9.5px] tw-font-extrabold tw-uppercase tw-tracking-wider ${meta}`}>{TIER_LABEL[tier]}</span>;
  };

  return (
    <div className="tw-fixed tw-inset-0 tw-z-[1900] tw-bg-black/55 tw-backdrop-blur-md tw-flex tw-items-end md:tw-items-center tw-justify-center tw-p-0 md:tw-p-4 tw-font-sans" onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ animation: 'bsv2-fade 0.22s ease' }}>
      <div className="tw-relative tw-w-full md:tw-max-w-[920px] tw-bg-white tw-rounded-t-[28px] md:tw-rounded-[28px] tw-shadow-oneui_lg tw-overflow-hidden tw-flex tw-flex-col" style={{ maxHeight: '92vh', animation: 'bsv2-pop 0.34s cubic-bezier(0.33,1,0.68,1)' }}>
        <div className="tw-flex tw-justify-center tw-pt-2.5 tw-pb-1 md:tw-hidden"><div className="tw-w-9 tw-h-1 tw-rounded-full tw-bg-black/15" /></div>

        {/* Hero */}
        <div className="tw-relative tw-bg-gradient-to-br tw-from-blue-600 tw-via-violet-700 tw-to-fuchsia-700 tw-px-6 tw-pt-5 tw-pb-5 tw-overflow-hidden">
          <div className="tw-absolute tw-inset-0 tw-opacity-15" style={{ backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
          <div className="tw-relative tw-z-10 tw-flex tw-items-start tw-justify-between tw-gap-3">
            <div>
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-h-5 tw-px-2 tw-rounded-full tw-bg-white/25 tw-backdrop-blur tw-text-white tw-text-[10px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-mb-2">📊 Head-to-Head</div>
              <div className="tw-text-white tw-text-[22px] tw-font-extrabold tw-tracking-[-0.6px] tw-leading-tight">Creator Comparison</div>
              <div className="tw-text-white/85 tw-text-[12.5px] tw-font-medium tw-mt-1">{creators.length} creators · best metrics highlighted</div>
            </div>
            <button onClick={onClose} className="tw-flex-shrink-0 tw-w-9 tw-h-9 tw-rounded-full tw-bg-white/20 hover:tw-bg-white/35 tw-backdrop-blur tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[13px] tw-font-bold tw-border-0 tw-cursor-pointer active:tw-scale-90 tw-transition tw-leading-none">✕</button>
          </div>
        </div>

        {/* Body · scrollable comparison */}
        <div className="tw-flex-1 tw-overflow-y-auto tw-overscroll-contain tw-bg-slate-50">
          {/* Header row with creator cards */}
          <div className="tw-sticky tw-top-0 tw-z-10 tw-bg-slate-50 tw-px-4 tw-py-3 tw-border-b tw-border-black/[0.06]">
            <div className="tw-grid tw-gap-2" style={{ gridTemplateColumns: `120px repeat(${creators.length}, minmax(0, 1fr))` }}>
              <div /> {/* spacer for label column */}
              {creators.map(c => (
                <div key={c.key} className="tw-flex tw-flex-col tw-items-center tw-text-center">
                  <div className="tw-w-12 tw-h-12 tw-rounded-full tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[18px] tw-font-extrabold tw-shadow-md tw-mb-1.5 tw-leading-none" style={{ background: getGradient(c.name) }}>
                    {(c.name || '?')[0].toUpperCase()}
                  </div>
                  <div className="tw-text-[12.5px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.2px] tw-truncate tw-w-full">{c.name}</div>
                  {c.handle && <div className="tw-text-[10px] tw-font-semibold tw-text-oneui-mute tw-truncate tw-w-full">{c.handle}</div>}
                  <div className="tw-mt-1">{tierBadge(c.tier)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Stats rows */}
          <div className="tw-px-4 tw-py-3 tw-flex tw-flex-col tw-gap-1.5">
            <CmpRow label="Deals" creators={creators} value={c => c.deals} format={v => v} bestValue={best.deals} bestColor="tw-bg-blue-100 tw-text-blue-800" />
            <CmpRow label="Allocated" creators={creators} value={c => c.allocated} format={v => fmt$(v)} bestValue={best.allocated} bestColor="tw-bg-blue-100 tw-text-blue-800" />
            <CmpRow label="Paid" creators={creators} value={c => c.paid} format={v => fmt$(v)} bestValue={best.paid} bestColor="tw-bg-emerald-100 tw-text-emerald-800" sub={c => `${c.paidPct}%`} />
            <CmpRow label="Videos Posted" creators={creators} value={c => c.videosDelivered} format={(v, c) => `${v} / ${c.videosCommitted}`} bestValue={best.videosDelivered} bestColor="tw-bg-violet-100 tw-text-violet-800" sub={c => `${c.deliveryPct}%`} />
            <CmpRow label="GMV" creators={creators} value={c => c.gmv} format={v => v > 0 ? fmt$(v) : '-'} bestValue={best.gmv} bestColor="tw-bg-emerald-100 tw-text-emerald-800" highlightWhenAbove={0} />
            <CmpRow label="Ad Spent" creators={creators} value={c => c.adSpent} format={v => v > 0 ? fmt$(v) : '-'} bestValue={best.adSpentLowest} bestColor="tw-bg-emerald-100 tw-text-emerald-800" lowerIsBetter highlightWhenAbove={0} />
            <CmpRow label="Profit / Loss" creators={creators} value={c => c.profit} format={(v, c) => (c.gmv > 0 || c.adSpent > 0) ? `${v >= 0 ? '+' : '−'}${fmt$(Math.abs(v))}` : '-'} bestValue={best.profit} bestColor="tw-bg-emerald-100 tw-text-emerald-800" colorByValue />
            <CmpRow label="ROAS" creators={creators} value={c => c.roas || 0} format={(v, c) => c.roas != null ? `${c.roas.toFixed(2)}×` : '-'} bestValue={best.roas} bestColor="tw-bg-amber-100 tw-text-amber-800" highlightWhenAbove={0} />
            <CmpRow label="Brands" creators={creators} value={c => c.brandsArr.length} format={v => v} bestValue={best.brands} bestColor="tw-bg-fuchsia-100 tw-text-fuchsia-800" />
          </div>

          {/* Brand pills row */}
          <div className="tw-px-4 tw-pb-4">
            <div className="tw-text-[10px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-px-2 tw-mb-2">Brands worked with</div>
            <div className="tw-grid tw-gap-2" style={{ gridTemplateColumns: `120px repeat(${creators.length}, minmax(0, 1fr))` }}>
              <div className="tw-text-[11px] tw-font-bold tw-text-oneui-mute tw-px-2 tw-pt-1.5">Brands</div>
              {creators.map(c => (
                <div key={c.key} className="tw-flex tw-flex-wrap tw-gap-1 tw-justify-center">
                  {c.brandsArr.length === 0 ? <span className="tw-text-oneui-mute tw-text-[10px]">-</span> :
                    c.brandsArr.slice(0, 4).map(b => (
                      <span key={b} className="tw-inline-flex tw-items-center tw-h-5 tw-px-2 tw-rounded-full tw-bg-blue-50 tw-text-blue-700 tw-text-[10px] tw-font-extrabold">{b}</span>
                    ))
                  }
                  {c.brandsArr.length > 4 && <span className="tw-text-[10px] tw-text-oneui-mute tw-font-bold">+{c.brandsArr.length - 4}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="tw-px-5 tw-py-3 tw-border-t tw-border-black/[0.06] tw-bg-white tw-flex tw-items-center tw-justify-between">
          <div className="tw-text-[10.5px] tw-font-bold tw-text-oneui-mute"><span className="tw-inline-block tw-w-2.5 tw-h-2.5 tw-rounded-full tw-bg-emerald-200 tw-mr-1.5" />Best in metric highlighted</div>
          <button onClick={onClose} className="tw-h-9 tw-px-4 tw-rounded-full tw-bg-[#1259C3] hover:tw-bg-[#0E4DAD] tw-text-white tw-text-[12px] tw-font-bold tw-border-0 tw-cursor-pointer active:tw-scale-95 tw-transition tw-shadow-oneui_blue">Done</button>
        </div>
      </div>
    </div>
  );
}

function CmpRow({ label, creators, value, format, bestValue, bestColor, lowerIsBetter, highlightWhenAbove, colorByValue, sub }) {
  return (
    <div className="tw-grid tw-gap-2 tw-items-center tw-bg-white tw-rounded-2xl tw-px-3 tw-py-2.5 tw-shadow-oneui tw-ring-1 tw-ring-black/[0.04]" style={{ gridTemplateColumns: `120px repeat(${creators.length}, minmax(0, 1fr))` }}>
      <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-px-1">{label}</div>
      {creators.map(c => {
        const v = value(c);
        const isBest = bestValue != null && v === bestValue && (highlightWhenAbove == null || v > highlightWhenAbove);
        let cls = 'tw-text-oneui-ink';
        if (colorByValue) cls = v >= 0 ? 'tw-text-emerald-700' : 'tw-text-rose-700';
        const subText = sub ? sub(c) : null;
        return (
          <div key={c.key} className="tw-flex tw-flex-col tw-items-center tw-text-center">
            <div className={`tw-inline-flex tw-items-center tw-gap-1 tw-px-2 tw-py-0.5 tw-rounded-md tw-text-[14px] tw-font-extrabold tw-tabular-nums tw-tracking-[-0.3px] ${isBest ? `${bestColor}` : cls}`}>
              {isBest && <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3 8.2 13.9 2 9.4h7.6z"/></svg>}
              {format(v, c)}
            </div>
            {subText && <div className="tw-text-[9.5px] tw-font-bold tw-text-oneui-mute tw-mt-0.5">{subText}</div>}
          </div>
        );
      })}
    </div>
  );
}

function CreatorAggregateCard({ c, idx, onClick, fmt$, isSelected, onToggleSelect, selectionMode }) {
  const tierMeta = c.tier === 'elite' ? { label: 'Elite', emoji: '👑', from: '#FFB800', to: '#FF8A00' }
    : c.tier === 'strong' ? { label: 'Strong', emoji: '🌟', from: '#34C759', to: '#1F8D44' }
    : c.tier === 'healthy' ? { label: 'Healthy', emoji: '✓', from: '#007AFF', to: '#0058C4' }
    : c.tier === 'poor' ? { label: 'Negative', emoji: '⚠', from: '#FF6B6B', to: '#C92516' }
    : { label: 'New', emoji: '·', from: '#8E8E93', to: '#3A3A3C' };
  const grad = getGradient(c.name || '?');
  const initial = (c.name || '?')[0].toUpperCase();

  const handleClick = () => {
    if (selectionMode) onToggleSelect();
    else onClick();
  };

  return (
    <div
      onClick={handleClick}
      style={{
        position: 'relative',
        background: 'white',
        borderRadius: 22,
        cursor: 'pointer',
        overflow: 'hidden',
        animation: `gv-pop 0.36s cubic-bezier(0.33,1,0.68,1) ${Math.min(idx * 0.025, 0.4)}s both`,
        boxShadow: isSelected
          ? `0 0 0 2px #FF2D92, 0 10px 24px rgba(255,45,146,0.18)`
          : `0 1px 2px rgba(15,23,42,0.04), 0 4px 14px rgba(15,23,42,0.06)`,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = isSelected ? `0 0 0 2px #FF2D92, 0 12px 30px rgba(255,45,146,0.20)` : '0 2px 4px rgba(15,23,42,0.05), 0 14px 32px rgba(15,23,42,0.10)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = isSelected ? `0 0 0 2px #FF2D92, 0 10px 24px rgba(255,45,146,0.18)` : '0 1px 2px rgba(15,23,42,0.04), 0 4px 14px rgba(15,23,42,0.06)'; }}
    >
      {/* Compare checkbox (top-right) */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
        title={isSelected ? 'Deselect' : 'Select to compare'}
        style={{
          position: 'absolute', top: 14, right: 14, zIndex: 3,
          width: 28, height: 28, borderRadius: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isSelected ? '#FF2D92' : '#F2F2F7',
          color: isSelected ? 'white' : '#8E8E93',
          transition: 'all 0.15s ease',
        }}
      >
        {isSelected ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="9" height="18" rx="2"/><rect x="13" y="3" width="9" height="18" rx="2"/></svg>
        )}
      </button>

      {/* HEADER · avatar + name + tier */}
      <div style={{ padding: '18px 18px 14px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          flexShrink: 0, width: 52, height: 52, borderRadius: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 800, color: 'white', letterSpacing: '-0.5px',
          background: grad,
          boxShadow: '0 4px 12px rgba(15,23,42,0.16), inset 0 1px 2px rgba(255,255,255,0.4)',
        }}>{initial}</div>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 36 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--wx-text)', letterSpacing: '-0.4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
          {c.handle && <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--wx-text-faint)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.handle}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              height: 20, padding: '0 8px', borderRadius: 999,
              fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em',
              background: `linear-gradient(135deg, ${tierMeta.from}, ${tierMeta.to})`,
              color: tierMeta.label === 'Elite' ? '#451A03' : 'white',
              boxShadow: `0 2px 5px ${tierMeta.from}40`,
            }}>{tierMeta.emoji} {tierMeta.label}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--wx-text-faint)' }}>{c.deals} {c.deals === 1 ? 'deal' : 'deals'}{c.brandsArr.length > 0 ? ` · ${c.brandsArr.length} ${c.brandsArr.length === 1 ? 'brand' : 'brands'}` : ''}</span>
          </div>
        </div>
      </div>

      {/* iOS-style stats group · 4 columns */}
      <div style={{
        margin: '0 14px',
        background: 'var(--wx-bg)',
        borderRadius: 14,
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        overflow: 'hidden',
      }}>
        {[
          { label: 'Budget', value: fmt$(c.allocated),                                color: 'var(--wx-text)' },
          { label: 'Paid',   value: fmt$(c.paid),                                     color: 'var(--wx-success)',  sub: `${c.paidPct}%` },
          { label: 'Videos', value: `${c.videosDelivered}/${c.videosCommitted}`,      color: 'var(--wx-text-muted)',  sub: `${c.deliveryPct}%` },
          { label: 'ROAS',   value: c.roas != null ? `${c.roas.toFixed(2)}×` : '-',   color: c.roas == null ? '#8E8E93' : c.roas >= 2 ? '#1F8D44' : c.roas >= 1 ? '#0058C4' : '#C92516' },
        ].map((s, i) => (
          <div key={s.label} style={{
            padding: '10px 6px',
            textAlign: 'center',
            borderLeft: i > 0 ? '0.5px solid #D1D1D6' : 'none',
          }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: s.color, letterSpacing: '-0.3px', lineHeight: 1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.value}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--wx-text-faint)', marginTop: 3, letterSpacing: '0.02em' }}>{s.label}{s.sub ? ` · ${s.sub}` : ''}</div>
          </div>
        ))}
      </div>

      {/* PRIMARY metric (GMV/Profit) row */}
      {(c.gmv > 0 || c.adSpent > 0) && (
        <div style={{
          margin: '12px 14px 0',
          padding: '12px 14px',
          background: c.profit >= 0 ? 'linear-gradient(135deg, #E8F8EE 0%, #FFFFFF 75%)' : 'linear-gradient(135deg, #FFE9E7 0%, #FFFFFF 75%)',
          borderRadius: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: c.profit >= 0 ? '#1F8D44' : '#C92516' }}>
              {c.gmv > 0 ? 'GMV' : 'Ad Spent'}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--wx-text)', letterSpacing: '-0.4px', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              {fmt$(c.gmv > 0 ? c.gmv : c.adSpent)}
            </div>
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            height: 26, padding: '0 12px', borderRadius: 999,
            fontSize: 12.5, fontWeight: 800, letterSpacing: '-0.1px', fontVariantNumeric: 'tabular-nums',
            background: c.profit >= 0 ? '#34C759' : '#FF3B30',
            color: 'white',
            boxShadow: c.profit >= 0 ? '0 3px 10px rgba(52,199,89,0.30)' : '0 3px 10px rgba(255,59,48,0.30)',
          }}>
            {c.profit >= 0 ? '+' : '−'}{fmt$(Math.abs(c.profit))}
          </span>
        </div>
      )}

      {/* BRANDS strip */}
      {c.brandsArr.length > 0 && (
        <div style={{ padding: '12px 18px 16px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {c.brandsArr.slice(0, 4).map(b => (
            <span key={b} style={{
              display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px', borderRadius: 999,
              fontSize: 11, fontWeight: 700, letterSpacing: '-0.1px',
              background: 'var(--wx-bg)', color: 'var(--wx-text)',
            }}>{b}</span>
          ))}
          {c.brandsArr.length > 4 && (
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--wx-text-faint)' }}>+{c.brandsArr.length - 4}</span>
          )}
        </div>
      )}
      {c.brandsArr.length === 0 && <div style={{ height: 16 }} />}
    </div>
  );
}

function StatTile({ label, value, sub, color, pct }) {
  const tones = {
    slate:   { bg: 'tw-bg-slate-50',   text: 'tw-text-slate-800',   accent: 'tw-text-slate-600',   bar: 'tw-bg-slate-400' },
    emerald: { bg: 'tw-bg-emerald-50', text: 'tw-text-emerald-800', accent: 'tw-text-emerald-700', bar: 'tw-bg-emerald-500' },
    violet:  { bg: 'tw-bg-violet-50',  text: 'tw-text-violet-800',  accent: 'tw-text-violet-700',  bar: 'tw-bg-violet-500' },
  }[color] || { bg: 'tw-bg-slate-50', text: 'tw-text-slate-800', accent: 'tw-text-slate-600', bar: 'tw-bg-slate-400' };
  return (
    <div className={`tw-relative tw-overflow-hidden tw-rounded-[16px] ${tones.bg} tw-p-2.5 tw-ring-1 tw-ring-black/[0.04]`}>
      <div className={`tw-text-[9.5px] tw-font-extrabold tw-uppercase tw-tracking-wider ${tones.accent}`}>{label}</div>
      <div className={`tw-text-[14px] tw-font-extrabold tw-tabular-nums tw-tracking-[-0.3px] tw-mt-0.5 ${tones.text}`}>{value}</div>
      {sub != null && <div className={`tw-text-[9px] tw-font-bold ${tones.accent} tw-opacity-80 tw-mt-0.5`}>{sub}</div>}
      {pct != null && (
        <div className="tw-h-0.5 tw-bg-black/[0.06] tw-rounded-full tw-overflow-hidden tw-mt-1.5">
          <div className={`tw-h-full ${tones.bar} tw-rounded-full tw-transition-all tw-duration-700`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
    </div>
  );
}

/* A ring reads "how far along" before you have parsed the number, so the
   two ratios that have a meaningful ceiling get one: 100% delivered, and
   3x ROAS as a practical top of scale. */
function Ring({ value, color, center }) {
  const R = 34, C = 2 * Math.PI * R;
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  return (
    <svg viewBox="0 0 88 88" className="rb-ring">
      <circle cx="44" cy="44" r={R} className="rb-ring-bg" />
      <circle cx="44" cy="44" r={R} stroke={color}
        strokeDasharray={(C * v).toFixed(1) + " " + C.toFixed(1)}
        className="rb-ring-fg" />
      <text x="44" y="49" textAnchor="middle" className="rb-ring-num">{center}</text>
    </svg>
  );
}

/* ─── Reporting · one stat, told in three lines ───────────────────
   Small caps label, the figure at full weight, then how it moved. The
   accent stripe is the only colour on the card so six of them in a row
   stay scannable instead of turning into a paint chart. */
function fmt$Round(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
}
function RepStat({ label, value, sub, delta, neutral, bar, accent }) {
  const up = delta != null && delta >= 0;
  return (
    <div className="rep-stat" style={{ '--rep-accent': accent }}>
      <div className="rep-stat-l">{label}</div>
      <div className="rep-stat-v">{value}</div>
      {bar != null && (
        <div className="rep-stat-bar"><i style={{ width: Math.min(100, bar) + '%' }} /></div>
      )}
      <div className="rep-stat-f">
        {delta != null && isFinite(delta) && (
          /* On ad spend a rise is neither good nor bad on its own — ROAS is
             the row that judges it — so that one chip stays neutral. */
          <span className={'rep-delta ' + (neutral ? 'flat' : up ? 'up' : 'down')}>
            {up ? '↑' : '↓'} {up ? '+' : ''}{Math.round(delta)}%
          </span>
        )}
        {sub && <span className="rep-stat-s">{sub}</span>}
      </div>
    </div>
  );
}

/* ─── ReportingViewV2 · premium executive report ─── */
function ReportingViewV2({ creators, allCreators, activeBrand, dateFilter, currentUser, onExportCsv, onGoToMonth }) {
  // `creators` = hire-date filtered list (matches Brands tab scope).
  // `allCreators` = full pool restricted only to Active brands. Used solely for
  // GMV / Ad Spent / ROAS so reporting numbers mirror Performance tab brand rows -
  // e.g. May data entered for an April-hired creator still rolls into May Reporting.
  const gmvPool = allCreators || creators;

  /* Two jobs live in this tab and they are read at different moments:
     the executive report is what you send out, the angle test is what
     you work in. Stacking them made one long scroll where the test sat
     below the fold, so they are now two panes of one switch. */
  const [repTab, setRepTab] = useState('report');
  /* Creative angle testing owns the brand picker, so it owns what its CSV
     contains. It registers its exporter here and the one header button
     routes to whichever pane is open. */
  const anglesCsvRef = useRef(null);
  const provideAnglesExport = useCallback((fn) => { anglesCsvRef.current = fn; }, []);

  // Brand parity: parse all 3 deal formats Brands tab understands. The top-level
  // parseDeal only catches "for N" · so deals like "5 videos $100", "$200/5",
  // "5v" were missing from totalVideosCommitted, making Reporting underreport
  // vs Brands tab (e.g. 604 vs 702). This matches src/WurxUI.js parseDealVideos.
  const parseDealVideosFull = (deal) => {
    if (!deal) return 0;
    const s = String(deal);
    const m1 = s.match(/(\d+)\s*(?:videos?|vids?|clips?|posts?)\b/i);
    if (m1) return parseInt(m1[1], 10);
    const m2 = s.match(/\$\s*\d[\d,]*(?:\.\d+)?\s*(?:[/\-x×*]|for)\s*(\d+)\b/i);
    if (m2) return parseInt(m2[1], 10);
    const m3 = s.match(/\b(\d+)\s*[vV]\b/);
    if (m3) return parseInt(m3[1], 10);
    return 0;
  };
  // Count actually-delivered videos from video_codes rows (single source of truth · same
  // helper concept as Wurx UI uses, so brand cards / reporting / matrix all agree).
  const deliveredVideoCount = (c) => Array.isArray(c?.video_codes)
    ? c.video_codes.filter(v => v?.video && String(v.video).trim()).length
    : 0;

  // GMV / Ad now live in c.monthly (Performance matrix writes there). Read scoped
  // by the active dateFilter so May filter shows only May data, etc. Fallback to
  // legacy per-deal c.gmv / c.ad_spent when no monthly data exists for that period.
  const monthlyKey = (df) => (!df || df.mode !== 'month') ? null
    : `${df.year}-${String(df.month + 1).padStart(2, '0')}`;
  // Sum month-keyed cells across every handle a creator owns. Per-handle data
  // uses suffixed keys like "2026-05@<handle>" alongside the primary "YYYY-MM"
  // key · both get summed. The "l30" markers (and "l30@<handle>") are excluded.
  const _readMonthlySum = (c, field) => {
    const m = c?.monthly || {};
    let s = 0;
    Object.keys(m).forEach(k => {
      if (k === 'l30' || k.startsWith('l30@')) return;
      const v = m[k] && m[k][field];
      if (v != null) s += Number(v) || 0;
    });
    return s;
  };
  // Sum data for a specific month across all handles (primary "YYYY-MM" +
  // every suffixed "YYYY-MM@<handle>"). Catches multi-handle creators that
  // would otherwise be undercounted by single-key reads.
  const _readMonthCellAllHandles = (c, month, field) => {
    const m = c?.monthly || {};
    let s = 0;
    Object.keys(m).forEach(k => {
      if (k === month || k.startsWith(month + '@')) {
        const v = m[k] && m[k][field];
        if (v != null) s += Number(v) || 0;
      }
    });
    return s;
  };
  const periodGmv = (c) => {
    const k = monthlyKey(dateFilter);
    if (k) return _readMonthCellAllHandles(c, k, 'gmv');
    if (!dateFilter || dateFilter.mode === 'all') {
      const ms = _readMonthlySum(c, 'gmv');
      return ms > 0 ? ms : (parseFloat(c?.gmv) || 0);
    }
    return parseFloat(c?.gmv) || 0;
  };
  const periodAd = (c) => {
    const k = monthlyKey(dateFilter);
    if (k) return _readMonthCellAllHandles(c, k, 'adSpent');
    if (!dateFilter || dateFilter.mode === 'all') {
      const ms = _readMonthlySum(c, 'adSpent');
      return ms > 0 ? ms : (parseFloat(c?.ad_spent) || 0);
    }
    return parseFloat(c?.ad_spent) || 0;
  };

  const stats = useMemo(() => {
    let totalVideosCompleted = 0;
    let totalVideosCommitted = 0;
    let amountAllocated = 0;
    let amountPaid = 0;
    let amountOutstanding = 0;
    let totalGMV = 0;
    let totalAdSpent = 0;
    let creatorsWithGmv = 0;
    let topROASCreator = null;
    let worstROASCreator = null;

    // Hire-date-scoped metrics · matches Brands tab counts
    creators.forEach(c => {
      const { amount } = parseDeal(c.deal);
      const videos = parseDealVideosFull(c.deal);
      amountAllocated += amount || 0;
      totalVideosCommitted += videos || 0;
      if (c.payment_status === 'Paid') amountPaid += amount || 0;
      else amountOutstanding += amount || 0;
      totalVideosCompleted += deliveredVideoCount(c);
    });

    // GMV / Ad sourced from the full Active-brand pool · same as Performance tab
    // brand rows, scoped to selected month via periodGmv/periodAd.
    gmvPool.forEach(c => {
      const g = periodGmv(c);
      const a = periodAd(c);
      totalGMV += g;
      totalAdSpent += a;
      if (g > 0) creatorsWithGmv += 1;
      if (g > 0 && a > 0) {
        const r = g / a;
        if (!topROASCreator || r > topROASCreator.roas) topROASCreator = { creator: c, roas: r, gmv: g, ad: a };
        if (!worstROASCreator || r < worstROASCreator.roas) worstROASCreator = { creator: c, roas: r, gmv: g, ad: a };
      }
    });
    const roas = totalAdSpent > 0 ? totalGMV / totalAdSpent : null;
    const profit = totalGMV - totalAdSpent;
    const profitMargin = totalGMV > 0 ? (profit / totalGMV) * 100 : null;
    const collectedPct = amountAllocated > 0 ? Math.round((amountPaid / amountAllocated) * 100) : 0;
    const deliveredPct = totalVideosCommitted > 0 ? Math.round((totalVideosCompleted / totalVideosCommitted) * 100) : 0;
    const avgDeal = creators.length > 0 ? amountAllocated / creators.length : 0;
    const costPerVideoDelivered = totalVideosCompleted > 0 ? totalAdSpent / totalVideosCompleted : null;
    const costPerGmvDollar = totalGMV > 0 ? totalAdSpent / totalGMV : null;
    return {
      totalVideosCompleted, totalVideosCommitted, amountAllocated, amountPaid, amountOutstanding,
      totalGMV, totalAdSpent, roas, profit, profitMargin, collectedPct, deliveredPct,
      avgDeal, creatorsWithGmv, topROASCreator, worstROASCreator,
      costPerVideoDelivered, costPerGmvDollar,
      totalCreators: creators.length,
    };
  }, [creators, gmvPool, dateFilter]);

  const topByGMV = useMemo(() => {
    // Pull from full Active-brand pool so May data of an April-hired creator
    // can still appear in the May Top Performers list.
    return [...gmvPool]
      .filter(c => periodGmv(c) > 0)
      .sort((a, b) => periodGmv(b) - periodGmv(a))
      .slice(0, 5);
  }, [gmvPool, dateFilter]);

  const brandBreakdown = useMemo(() => {
    const map = {};
    const ensure = (brand) => {
      if (!map[brand]) map[brand] = { brand, count: 0, allocated: 0, paid: 0, gmv: 0, adSpent: 0, videosDone: 0 };
      return map[brand];
    };

    // Pass 1 · count / allocated / paid / videos delivered from hire-date filtered list
    // (Brands tab parity: brand only appears here if it has creators in current scope).
    creators.forEach(c => {
      if (!c.brand) return;
      const row = ensure(c.brand);
      const { amount } = parseDeal(c.deal);
      row.count += 1;
      row.allocated += amount || 0;
      if (c.payment_status === 'Paid') row.paid += amount || 0;
      row.videosDone += deliveredVideoCount(c);
    });

    // Pass 2 · GMV / Ad Spent sourced from full Active-brand pool, scoped to month
    // via periodGmv/periodAd. Matches Performance tab brand row totals exactly.
    gmvPool.forEach(c => {
      const b = (c.brand || '').trim();
      if (!b || !map[b]) return; // only roll into brands already shown in the breakdown
      map[b].gmv     += periodGmv(c);
      map[b].adSpent += periodAd(c);
    });

    return Object.values(map).map(b => ({
      ...b, roas: b.adSpent > 0 ? b.gmv / b.adSpent : null, profit: b.gmv - b.adSpent,
    })).sort((a, b) => (b.gmv - a.gmv) || a.brand.localeCompare(b.brand));
  }, [creators, gmvPool, dateFilter]);

  /* The month this section works in · a creative test lives inside one
     cycle, so year and all-time views deliberately leave it empty. */
  const angleMonth = (dateFilter && dateFilter.mode === 'month')
    ? `${dateFilter.year}-${String(dateFilter.month + 1).padStart(2, '0')}`
    : '';

  const periodLabel = (() => {
    if (!dateFilter || dateFilter.mode === 'all') return 'All time';
    if (dateFilter.mode === 'year') return `${dateFilter.year}`;
    if (dateFilter.mode === 'month') {
      const d = new Date(dateFilter.year, dateFilter.month, 1);
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    return 'All time';
  })();

  const today = new Date();
  const generatedAt = today.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const roasGood = stats.roas != null && stats.roas >= 1;
  const roasTier = stats.roas == null ? null : stats.roas >= 3 ? 'gold' : stats.roas >= 2 ? 'green' : stats.roas >= 1 ? 'blue' : 'red';

  function fmt$(n) { return `$${Math.round(n).toLocaleString()}`; }
  function handlePrint() { window.print(); }

  /* 6-month GMV trend · real numbers from creators' monthly JSONB
     (primary "YYYY-MM" keys + multi-handle "YYYY-MM@handle" keys).
     ANCHORED to the selected period — viewing June ends the chart at June,
     it never leaks months after the selected one. */
  const gmvTrend = useMemo(() => {
    const src = allCreators || creators || [];
    const now = new Date();
    let anchor;
    if (dateFilter?.mode === 'month') anchor = new Date(dateFilter.year, dateFilter.month, 1);
    else if (dateFilter?.mode === 'year') {
      anchor = dateFilter.year === now.getFullYear()
        ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(dateFilter.year, 11, 1);
    } else anchor = new Date(now.getFullYear(), now.getMonth(), 1);
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      let gmv = 0, ad = 0;
      src.forEach(c => {
        const mo = c.monthly || {};
        Object.keys(mo).forEach(k => {
          if (k === key || k.startsWith(`${key}@`)) {
            gmv += Number(mo[k]?.gmv) || 0;
            ad += Number(mo[k]?.adSpent) || 0;
          }
        });
      });
      months.push({
        key, gmv, ad,
        label: d.toLocaleDateString('en-US', { month: 'short' }),
        full: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      });
    }
    return months;
  }, [allCreators, creators, dateFilter]);
  const trendDelta = useMemo(() => {
    const cur = gmvTrend[gmvTrend.length - 1]?.gmv || 0;
    const prev = gmvTrend[gmvTrend.length - 2]?.gmv || 0;
    if (!prev) return null;
    return ((cur - prev) / prev) * 100;
  }, [gmvTrend]);

  /* Movement for the tile rail · measured between the last two months of the
     trend window, and only where the earlier month actually has a figure to
     compare against. */
  const mom = useMemo(() => {
    /* Compare the last two months that actually CARRY figures, not simply the
       last two slots. The current month is usually still empty — measuring
       against it reported a flat "-100%" on every tile, which reads as a
       collapse when really nothing has been entered yet. */
    const filled = gmvTrend.filter(m => m.gmv > 0 || m.ad > 0);
    if (filled.length < 2) return {};
    const cur = filled[filled.length - 1], prev = filled[filled.length - 2];
    const pc = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
    const cr = cur.ad > 0 ? cur.gmv / cur.ad : null;
    const pr = prev.ad > 0 ? prev.gmv / prev.ad : null;
    return {
      gmv: pc(cur.gmv, prev.gmv),
      ad: pc(cur.ad, prev.ad),
      roas: (cr != null && pr != null) ? pc(cr, pr) : null,
      label: prev.full,
      curLabel: cur.full,
    };
  }, [gmvTrend]);

  /* The sentence at the top · assembled from the same figures shown below,
     so it can never drift from them. Written as something a person would
     actually say, which is the whole point of a brief. */
  const brief = useMemo(() => {
    const top = [...brandBreakdown].sort((a, b) => b.gmv - a.gmv)[0];
    const scope = activeBrand === 'All' ? 'across every brand' : activeBrand;
    let headline, detail;
    if (!stats.totalGMV && !stats.totalAdSpent) {
      headline = 'Nothing recorded for this period yet.';
      detail = `${stats.totalCreators} deals are on the books, but no GMV or ad spend has been entered against them.`;
    } else if (top && top.gmv > 0 && activeBrand === 'All') {
      const shareP = stats.totalGMV > 0 ? Math.round((top.gmv / stats.totalGMV) * 100) : 0;
      headline = `${top.brand} is carrying this period.`;
      detail = `${fmt$Round(top.gmv)} of ${fmt$Round(stats.totalGMV)} GMV, ${shareP}% of everything ${scope}`
        + (top.roas != null ? `, at ${top.roas.toFixed(2)}× on ads.` : '.');
    } else {
      headline = stats.roas == null ? 'Sales recorded, no ad spend behind them.'
        : stats.roas >= 1 ? 'Ads are paying for themselves.' : 'Ads are costing more than they return.';
      detail = `${fmt$Round(stats.totalGMV)} GMV on ${fmt$Round(stats.totalAdSpent)} of spend ${scope}.`;
    }
    return { headline, detail };
  }, [stats, brandBreakdown, activeBrand]);

  const chart = (() => {
              /* Drop trailing months that hold nothing. The window always ends
                 on the current month, which normally has no figures entered
                 yet — plotting it pulled the line down to zero and read as a
                 collapse rather than as "not filled in". */
              let plot = gmvTrend.slice();
              while (plot.length && plot[plot.length - 1].gmv === 0 && plot[plot.length - 1].ad === 0) plot.pop();
              const skipped = gmvTrend.length - plot.length;
              if (plot.length < 2) {
                /* INK IS NEVER FADED. Muted at 50% measured 2.38:1 in dark and 1.94:1
                   in light at 11px — an empty state nobody could read, which is
                   worse than no empty state. Our palette answers 'quieter ink'
                   with tokens that check:contrast verifies; alpha cannot be. */
                return <div className="tw-text-[11px] tw-italic tw-py-10 tw-text-center" style={{ color: 'var(--wx-text-muted)' }}>
                  Not enough months with figures to draw a trend yet.
                </div>;
              }

              /* Everything — bars, line, dots and the month names — is drawn
                 from the SAME x(i). The labels used to live in a separate flex
                 row spanning edge to edge while the plot was inset, so no
                 point ever sat above its own month. */
              const W = 620, H = 168;
              const P = { l: 46, r: 46, t: 22, b: 30 };
              const iw = W - P.l - P.r, ih = H - P.t - P.b;
              const maxG = Math.max(...plot.map(d => d.gmv), 1);
              const maxA = Math.max(...plot.map(d => d.ad), 1);
              const barW = Math.min(30, (iw / plot.length) * 0.44);
              const inset = barW / 2 + 4;
              const span = Math.max(iw - inset * 2, 1);
              const x = i => P.l + inset + (plot.length === 1 ? span / 2 : (i * span) / (plot.length - 1));
              const yG = v => P.t + ih - (v / maxG) * ih;
              const pts = plot.map((d, i) => [x(i), yG(d.gmv)]);
              const line = pts.map((pt, i) => {
                if (i === 0) return `M${pt[0].toFixed(1)},${pt[1].toFixed(1)}`;
                const pr = pts[i - 1];
                const cx = ((pr[0] + pt[0]) / 2).toFixed(1);
                return `C${cx},${pr[1].toFixed(1)} ${cx},${pt[1].toFixed(1)} ${pt[0].toFixed(1)},${pt[1].toFixed(1)}`;
              }).join(' ');
              const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${P.t + ih} L${pts[0][0].toFixed(1)},${P.t + ih} Z`;
              const last = plot.length - 1;
              const kd = v => (Math.abs(v) >= 1000 ? '$' + (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : '$' + Math.round(v));

              return (
                <>
                  <svg viewBox={`0 0 ${W} ${H}`} className="tw-w-full tw-mt-1.5" style={{ height: 186 }}>
                    <defs>
                      <linearGradient id="repAreaC" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34D399" stopOpacity="0.30" />
                        <stop offset="100%" stopColor="#34D399" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>

                    {[0, 0.5, 1].map(f => (
                      <g key={f}>
                        <line x1={P.l} x2={P.l + iw} y1={P.t + ih * f} y2={P.t + ih * f}
                          stroke="rgba(245,233,214,0.10)" strokeWidth="1" strokeDasharray={f === 1 ? '0' : '3 5'} />
                        <text x={P.l - 8} y={P.t + ih * f + 3.5} textAnchor="end"
                          style={{ fontSize: 8.5, fontWeight: 800, fill: 'color-mix(in srgb, var(--wx-text-muted) 72%, transparent)' }}>{kd(maxG * (1 - f))}</text>
                        <text x={P.l + iw + 8} y={P.t + ih * f + 3.5} textAnchor="start"
                          style={{ fontSize: 8.5, fontWeight: 800, fill: 'color-mix(in srgb, var(--wx-text-muted) 34%, transparent)' }}>{kd(maxA * (1 - f))}</text>
                      </g>
                    ))}

                    {plot.map((d, i) => {
                      const h = (d.ad / maxA) * ih;
                      return (
                        <rect key={'b' + d.key} x={x(i) - barW / 2} y={P.t + ih - h} width={barW}
                          height={Math.max(h, d.ad > 0 ? 2 : 0)} rx="3" fill="rgba(245,233,214,0.13)">
                          <title>{d.full} · {fmt$Round(d.ad)} ad spend</title>
                        </rect>
                      );
                    })}

                    <path d={area} fill="url(#repAreaC)" />
                    <path d={line} fill="none" stroke="#34D399" strokeWidth="2.4"
                      strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

                    {pts.map((pt, i) => (
                      <circle key={'d' + plot[i].key} cx={pt[0]} cy={pt[1]} r={i === last ? 4.5 : 3}
                        fill={i === last ? '#34D399' : '#241C13'} stroke="#34D399" strokeWidth="2">
                        <title>{plot[i].full} · {fmt$Round(plot[i].gmv)} GMV</title>
                      </circle>
                    ))}

                    <text x={x(last)} y={Math.max(pts[last][1] - 9, 10)}
                      textAnchor={last === plot.length - 1 ? 'end' : 'middle'}
                      style={{ fontSize: 10, fontWeight: 900, fill: 'var(--wx-text-muted)' }}>
                      {fmt$Round(plot[last].gmv)}
                    </text>

                    {/* month names, drawn on the same scale as the data */}
                    {plot.map((d, i) => (
                      <text key={'l' + d.key} x={x(i)} y={H - 10} textAnchor="middle"
                        style={{ fontSize: 9, fontWeight: 800, fill: i === last ? '#6EE7B7' : 'rgba(245,233,214,0.42)' }}>
                        {d.full}
                      </text>
                    ))}
                  </svg>

                  <div className="rep-legend">
                    <i className="rep-lg bar" />Ad spend
                    <i className="rep-lg line" />GMV
                    {skipped > 0 && (
                      <span className="rep-note">
                        {gmvTrend[gmvTrend.length - 1].full} not recorded yet
                      </span>
                    )}
                  </div>
                </>
              );
            })();

  return (
    <div className="tw-px-4 md:tw-px-6 tw-pb-24 md:tw-pb-12 tw-font-sans report-print-root">
      <div className="tw-max-w-[1280px] tw-mx-auto tw-flex tw-flex-col tw-gap-3.5">

        {/* ═══ REPORTING · COMPACT MODULAR DASHBOARD ═══ */}

        {/* slim header */}
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-flex-wrap">
          <div className="tw-min-w-0">
            <div className="tw-flex tw-items-center tw-gap-2 tw-flex-wrap">
              <span className="tw-text-[21px] md:tw-text-[23px] tw-font-extrabold tw-tracking-[-0.6px]" style={{ color: 'var(--wx-text)' }}>{activeBrand === 'All' ? 'All Brands' : activeBrand}</span>
              <span className="tw-h-[22px] tw-px-2.5 tw-rounded-full tw-text-[9px] tw-font-extrabold tw-uppercase tw-tracking-[1px] tw-flex tw-items-center" style={{ background: 'linear-gradient(180deg,var(--wx-surface-1),var(--wx-surface-2))', color: 'var(--wx-text-faint)', border: '1px solid color-mix(in srgb, var(--wx-warning) 12%, transparent)' }}>Executive Report</span>
            </div>
            <div className="tw-text-[11.5px] tw-font-semibold tw-mt-0.5" style={{ color: 'var(--wx-text-faint)' }}>
              {periodLabel}{activeBrand === 'All' && brandBreakdown.length > 0 && <> · {brandBreakdown.length} brands</>} · Generated {generatedAt}
            </div>
          </div>
          <div className="tw-flex tw-items-center tw-gap-2 print-hide">
            {can(currentUser, 'canExportCsv') && <button onClick={() => {
              if (repTab === 'angles' && anglesCsvRef.current) return anglesCsvRef.current();
              if (onExportCsv) onExportCsv();
            }} className="tw-h-9 tw-px-3.5 tw-rounded-full tw-text-[11.5px] tw-font-bold tw-cursor-pointer tw-transition active:tw-scale-95 tw-flex tw-items-center tw-gap-1.5" style={{ background: 'var(--wx-surface-2)', color: 'var(--wx-text)', border: '1px solid var(--wx-border)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              CSV
            </button>}
            {can(currentUser, 'canPrintReport') && <button onClick={handlePrint} className="tw-h-9 tw-px-3.5 tw-rounded-full tw-text-[11.5px] tw-font-extrabold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-95 tw-flex tw-items-center tw-gap-1.5" style={{ background: 'var(--wx-warning-soft)', color: 'var(--wx-text)', boxShadow: '0 3px 10px rgba(48,39,28,0.28)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Print PDF
            </button>}
          </div>
        </div>

        {/* two panes, one switch · full bleed so it reads as the spine of
            the tab rather than a control floating in the corner */}
        <div className="rp-seg print-hide" role="tablist">
          <span className="rp-seg-ink" style={{ transform: repTab === 'report' ? 'translateX(0%)' : 'translateX(100%)' }} aria-hidden />
          <button role="tab" aria-selected={repTab === 'report'}
            className={'rp-seg-b' + (repTab === 'report' ? ' on' : '')}
            onClick={() => setRepTab('report')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="m7 14 3.5-4 3 3L19 7" />
            </svg>
            Reporting
          </button>
          <button role="tab" aria-selected={repTab === 'angles'}
            className={'rp-seg-b' + (repTab === 'angles' ? ' on' : '')}
            onClick={() => setRepTab('angles')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3h6M10 3v6L5.2 17.4A2 2 0 0 0 6.9 20.5h10.2a2 2 0 0 0 1.7-3.1L14 9V3" /><path d="M8 15h8" />
            </svg>
            Creative angle testing
          </button>
        </div>

        {repTab === 'report' && (<>

        {/* ═══════════════════════════════════════════════════════════
            THE BOARD · one surface, one arrangement
            The previous version showed GMV in a chip AND again in a tile,
            ROAS in a chip AND again in a ring — the same figure twice in two
            different visual languages, which is what made it read as
            scattered. Each number now appears exactly once, and the headline,
            the hero figure, the chart and the supporting metrics all sit on
            the SAME surface so the eye never has to change gear.
            ═══════════════════════════════════════════════════════════ */}
        <div className="rp-board">
          <div className="rp-board-aura" aria-hidden />

          <div className="rp-board-top">
            <div className="rp-board-say">
              <span className="rp-eyebrow">{periodLabel}{activeBrand !== 'All' && ` · ${activeBrand}`}</span>
              <h2 className="rp-say">{brief.headline}</h2>
              <p className="rp-say-sub">{brief.detail}</p>

              <div className="rp-hero">
                <span className="rp-hero-num">{fmt$Round(stats.totalGMV)}</span>
                <span className="rp-hero-tag">
                  GMV
                  {mom.gmv != null && (
                    <i className={mom.gmv >= 0 ? 'up' : 'down'}>
                      {mom.gmv >= 0 ? '↑' : '↓'}{Math.abs(mom.gmv)}% vs {mom.label}
                    </i>
                  )}
                </span>
              </div>
            </div>

            <div className="rp-board-chart">{chart}</div>
          </div>

          {/* the supporting cast · read left to right as one sentence:
              this much spend, at this return, delivering this much, with
              this much still owed */}
          <div className="rp-strip">
            <div className="rp-strip-cell">
              <span className="rp-s-l">Ad spend</span>
              <span className="rp-s-v">{fmt$Round(stats.totalAdSpent)}</span>
              <span className="rp-s-s">
                {mom.ad != null ? `${mom.ad >= 0 ? '+' : ''}${mom.ad}% vs ${mom.label}` : 'behind creator content'}
              </span>
            </div>
            <div className="rp-strip-cell">
              <span className="rp-s-l">Return on spend</span>
              <span className={'rp-s-v ' + (stats.roas == null ? '' : stats.roas >= 1 ? 'good' : 'bad')}>
                {stats.roas != null ? stats.roas.toFixed(2) + '×' : '-'}
              </span>
              <span className="rp-s-s">
                {stats.roas == null ? 'no ad spend' : stats.roas >= 2 ? 'strong return' : stats.roas >= 1 ? 'above break-even' : 'below break-even'}
              </span>
            </div>
            <div className="rp-strip-cell">
              <span className="rp-s-l">Videos delivered</span>
              <span className="rp-s-v">{stats.deliveredPct}%</span>
              <span className="rp-s-bar"><i style={{ width: Math.min(100, stats.deliveredPct) + '%' }} /></span>
              <span className="rp-s-s">{stats.totalVideosCompleted} of {stats.totalVideosCommitted}</span>
            </div>
          </div>
        </div>

        {/* ═══ one row of three · people, unit economics, the two extremes ═══ */}
        <div className="rp-row3">
          <section className="rp-card rp-people">
            <header className="rp-c-head">
              <span className="rp-c-title">Top creators</span>
              <span className="rp-c-note">by GMV</span>
            </header>
            {topByGMV.length === 0 ? (
              <div className="rp-empty">No creator GMV in this period</div>
            ) : topByGMV.map((c, i) => {
              const g = periodGmv(c), a = periodAd(c);
              const r = a > 0 ? g / a : null;
              const top = topByGMV[0] ? periodGmv(topByGMV[0]) : 0;
              return (
                <div key={c.id} className="rp-p-row">
                  <span className="rp-p-n">{i + 1}</span>
                  <span className="rp-p-m">
                    <b>{c.name}</b>
                    <small>{c.brand || 'no brand'}{a > 0 ? ` · ${fmt$Round(a)} ad` : ''}</small>
                    {/* bar against the leader · ranks without reading digits */}
                    <i className="rp-p-bar"><em style={{ width: (top > 0 ? (g / top) * 100 : 0) + '%' }} /></i>
                  </span>
                  <span className="rp-p-r">
                    <b>{fmt$Round(g)}</b>
                    {r != null && <small className={r >= 2 ? 'great' : r >= 1 ? 'ok' : 'bad'}>{r.toFixed(2)}×</small>}
                  </span>
                </div>
              );
            })}
          </section>

          <section className="rp-card rp-ends">
            <header className="rp-c-head">
              <span className="rp-c-title">The two ends</span>
              <span className="rp-c-note">ROAS</span>
            </header>
            {stats.topROASCreator ? (
              <div className="rp-end best">
                <span className="rp-end-tag">Best</span>
                <b>{stats.topROASCreator.creator.name}</b>
                <span className="rp-end-v">{stats.topROASCreator.roas.toFixed(2)}×</span>
                <small>{fmt$Round(stats.topROASCreator.gmv)} on {fmt$Round(stats.topROASCreator.ad)}</small>
              </div>
            ) : <div className="rp-empty">Not enough ad spend to rank</div>}
            {stats.worstROASCreator && (
              <div className="rp-end worst">
                <span className="rp-end-tag">Lowest</span>
                <b>{stats.worstROASCreator.creator.name}</b>
                <span className="rp-end-v">{stats.worstROASCreator.roas.toFixed(2)}×</span>
                <small>{fmt$Round(stats.worstROASCreator.gmv)} on {fmt$Round(stats.worstROASCreator.ad)}</small>
              </div>
            )}
          </section>
        </div>

        {/* ═══ BRAND BREAKDOWN ═══
            Rows are separate capsules rather than lines in a grid. A ruled
            table asks you to trace across a line; a capsule is one object you
            take in at once, which is the whole reason phone UIs moved to them.
            The three biggest earners carry a coloured rail so the shape of the
            month is visible before a single figure is read. */}
        {activeBrand === 'All' && brandBreakdown.length > 0 && (() => {
          const rows = [...brandBreakdown].sort((a, b) => (b.gmv - a.gmv) || (b.allocated - a.allocated));
          const topGmv = rows.reduce((m, r) => Math.max(m, r.gmv || 0), 0);
          const earning = rows.filter(r => r.gmv > 0).length;
          return (
            <div className="bx report-brand-table">
              <div className="bx-top">
                <div>
                  <span className="bx-title">Brand breakdown</span>
                  <span className="bx-sub">{rows.length} brands, {earning} with GMV recorded</span>
                </div>
                <span className="bx-flag">Ranked by GMV</span>
              </div>

              <div className="bx-scroll">
                <div className="bx-head">
                  <div />
                  <div className="bx-l">Brand</div>
                  <div>GMV</div>
                  <div>Ad spend</div>
                  <div>ROAS</div>
                  <div>Paid</div>
                  <div>Profit</div>
                </div>

                <div className="bx-list">
                  {rows.map((b, i) => {
                    const share = topGmv > 0 ? Math.round((b.gmv / topGmv) * 100) : 0;
                    const paidPct = b.allocated > 0 ? Math.round((b.paid / b.allocated) * 100) : 0;
                    const live = b.gmv > 0 || b.adSpent > 0;
                    return (
                      <article key={b.brand} className={'bx-row' + (i < 3 ? ' lead' : '') + (live ? '' : ' quiet')}>
                        <span className="bx-rail" style={{ background: getGradient(b.brand) }} aria-hidden />
                        <span className={'bx-rank r' + (i < 3 ? i + 1 : 'n')}>{i + 1}</span>

                        <span className="bx-brand">
                          <span className="bx-face" style={{ background: getGradient(b.brand) }}>{b.brand[0].toUpperCase()}</span>
                          <span className="bx-bmeta">
                            <b>{b.brand}</b>
                            <small>{b.count} deal{b.count === 1 ? '' : 's'}{b.videosDone > 0 ? ` · ${b.videosDone} videos` : ''}</small>
                          </span>
                        </span>

                        <span className="bx-gmv">
                          {b.gmv > 0 ? (<>
                            <b>{fmt$Round(b.gmv)}</b>
                            <i className="bx-fill"><em style={{ width: share + '%' }} /></i>
                          </>) : <span className="bx-none">not recorded</span>}
                        </span>

                        <span className="bx-ad">{b.adSpent > 0 ? fmt$Round(b.adSpent) : <span className="bx-none">-</span>}</span>

                        <span className="bx-roasw">
                          {b.roas != null
                            ? <span className={'bx-roas ' + (b.roas >= 2 ? 'great' : b.roas >= 1 ? 'ok' : 'bad')}>{b.roas.toFixed(2)}×</span>
                            : <span className="bx-none">-</span>}
                        </span>

                        <span className="bx-paid">
                          <b>{fmt$Round(b.paid)}</b>
                          <i className="bx-fill paid"><em style={{ width: paidPct + '%' }} /></i>
                          <small>{paidPct}% of {fmt$Round(b.allocated)}</small>
                        </span>

                        <span className={'bx-pl ' + (!live ? 'off' : b.profit >= 0 ? 'pos' : 'neg')}>
                          {live ? (b.profit >= 0 ? '+' : '−') + fmt$Round(Math.abs(b.profit)) : <span className="bx-none">-</span>}
                        </span>
                      </article>
                    );
                  })}
                </div>

                <div className="bx-foot">
                  <span className="bx-f-l">All brands</span>
                  <span className="bx-f-c"><small>GMV</small><b>{fmt$Round(stats.totalGMV)}</b></span>
                  <span className="bx-f-c"><small>Ad spend</small><b>{fmt$Round(stats.totalAdSpent)}</b></span>
                  <span className="bx-f-c"><small>ROAS</small><b>{stats.roas != null ? stats.roas.toFixed(2) + '×' : '-'}</b></span>
                  <span className="bx-f-c"><small>Paid</small><b>{fmt$Round(stats.amountPaid)}</b></span>
                  <span className={'bx-f-c ' + (stats.profit >= 0 ? 'pos' : 'neg')}>
                    <small>Profit</small><b>{(stats.profit >= 0 ? '+' : '−') + fmt$Round(Math.abs(stats.profit))}</b>
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Footer ── */}
        <div className="tw-text-center tw-text-[11px] tw-font-semibold tw-py-3" style={{ color: 'var(--wx-text-muted)' }}>
          Creator Hub · Executive Report · {periodLabel} · {activeBrand === 'All' ? 'All Brands' : activeBrand}
        </div>
        </>)}

        {/* ═══ CREATIVE ANGLE TESTING ═══
            Which hook is working, for one brand in one month. Views come off
            the videos themselves, and so does GMV wherever EUKA reports it,
            so they always match the Brands tab. Ad spend is typed per video,
            and so is GMV for the brands EUKA does not cover. */}
        {repTab === 'angles' && (
          <CreativeAngles
            creators={allCreators || creators}
            brand={activeBrand}
            month={angleMonth}
            monthLabel={periodLabel}
            currentUser={currentUser}
            money={fmt$Round}
            canEdit={can(currentUser, 'canEditAngles')}
            canType={can(currentUser, 'canEditAdSpend')}
            onGoToMonth={onGoToMonth}
            onProvideExport={provideAnglesExport}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Resizable + reorderable column header ─── */
const MOVABLE_COLS = [
  { key: 'tiktok_account', label: 'Username',     defaultWidth: 110, sortable: false },
  { key: 'brand',          label: 'Brand',        defaultWidth: 110, sortable: false },
  { key: 'category',       label: 'Category',     defaultWidth: 100, sortable: false },
  { key: 'deal',           label: 'Deal',         defaultWidth: 110, sortable: false },
  { key: 'whatsapp_number',label: 'WhatsApp',     defaultWidth: 130, sortable: false },
  { key: 'payment_status', label: 'Payment',      defaultWidth: 100, sortable: false },
  { key: 'videos',         label: 'Videos',       defaultWidth: 100, sortable: false },
  { key: 'hiring_date',    label: 'Hiring Date',  defaultWidth: 110, sortable: true },
  { key: 'hired_by',       label: 'Hired By',     defaultWidth: 110, sortable: false, gated: 'canSeeHiredBy' },
];
const DEFAULT_COL_ORDER = MOVABLE_COLS.map(c => c.key);

// Inject width style into a child <td> element returned by renderCell
function CellSized({ children, style }) {
  if (!React.isValidElement(children)) return children;
  return React.cloneElement(children, { style: { ...(children.props.style || {}), ...style } });
}

function ResizableHeader({ colKey, label, sortable, sortDir, onSortClick, width, onResize, onDragStart, onDragOver, onDrop, isDragOver, isDragging, align, isSelected, onSelect }) {
  const startX = useRef(null);
  const startW = useRef(0);
  function onMouseDown(e) {
    e.stopPropagation(); e.preventDefault();
    startX.current = e.clientX;
    startW.current = width;
    function move(ev) {
      const dx = ev.clientX - startX.current;
      const next = Math.max(60, Math.min(420, startW.current + dx));
      onResize(next);
    }
    function up() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
  function handleHeaderClick(e) {
    // Don't trigger select if user is interacting with resize handle
    if (e.target.closest && e.target.closest('[data-resize-handle]')) return;
    if (sortable && onSortClick) onSortClick();
    if (onSelect) onSelect(colKey);
  }
  const align_ = align || 'left';
  return (
    <th
      style={{ width, minWidth: width, maxWidth: width, position: 'relative', cursor: 'pointer', userSelect: 'none', textAlign: align_, opacity: isDragging ? 0.4 : 1, background: isSelected ? 'rgba(59, 130, 246, 0.12)' : isDragOver ? 'rgba(59, 130, 246, 0.08)' : undefined, boxShadow: isSelected ? 'inset 0 -2px 0 #2563EB' : isDragOver ? 'inset 3px 0 0 #2563EB' : undefined, transition: 'background 0.15s, box-shadow 0.15s' }}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/col', colKey); onDragStart(colKey); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(colKey); }}
      onDragLeave={() => onDragOver(null)}
      onDrop={(e) => { e.preventDefault(); const k = e.dataTransfer.getData('text/col'); onDrop(k, colKey); }}
      onClick={handleHeaderClick}
      className={sortable ? 'sort-th' : ''}
    >
      <span className="tw-inline-flex tw-items-center tw-gap-1 tw-pr-3" style={{ justifyContent: align_ === 'right' ? 'flex-end' : align_ === 'center' ? 'center' : 'flex-start' }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="tw-opacity-30 hover:tw-opacity-60 tw-transition tw-cursor-grab"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>
        <span>{label}</span>
        {sortable && (
          <span className={`sort-icon${sortDir ? ' sort-active' : ''}`}>
            {sortDir === 'asc' ? ' ↑' : sortDir === 'desc' ? ' ↓' : ' ↕'}
          </span>
        )}
      </span>
      <span
        data-resize-handle
        onMouseDown={onMouseDown}
        onClick={e => e.stopPropagation()}
        title="Drag to resize"
        style={{
          position: 'absolute', right: 0, top: '15%', bottom: '15%', width: 6,
          cursor: 'col-resize', zIndex: 5,
        }}
        className="tw-group hover:tw-bg-blue-500/30 tw-transition"
      >
        <span className="tw-block tw-w-px tw-h-full tw-mx-auto tw-bg-black/10 group-hover:tw-bg-blue-500/80 tw-transition" />
      </span>
    </th>
  );
}

/* ─── LatencyIndicator · small live DB latency dot in topbar ─── */
function LatencyIndicator() {
  const [latency, setLatency] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function ping() {
      const t0 = performance.now();
      try {
        const res = await wurxbaseRest('creators?select=id&limit=1');
        const ms = Math.round(performance.now() - t0);
        if (cancelled) return;
        if (res.ok) { setLatency(ms); setError(false); }
        else { setError(true); setLatency(null); }
      } catch {
        if (!cancelled) { setError(true); setLatency(null); }
      }
    }
    ping();
    const id = setInterval(ping, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  const tone = error ? 'rose' : latency == null ? 'slate' : latency < 500 ? 'emerald' : latency < 1500 ? 'amber' : 'rose';
  const dotCls = { emerald: 'tw-bg-emerald-500', amber: 'tw-bg-amber-500', rose: 'tw-bg-rose-500', slate: 'tw-bg-slate-400' }[tone];
  const labelCls = { emerald: 'tw-text-emerald-700', amber: 'tw-text-amber-700', rose: 'tw-text-rose-700', slate: 'tw-text-slate-500' }[tone];
  const status = error ? 'Offline' : latency == null ? 'Pinging…' : latency < 500 ? 'Healthy' : latency < 1500 ? 'Slow' : 'Lagging';
  return (
    <div title={`DB · ${status} · ${latency != null ? latency + 'ms' : 'unknown'}`} className="tw-hidden md:tw-inline-flex tw-items-center tw-gap-1.5 tw-h-7 tw-px-2.5 tw-rounded-full tw-bg-black/[0.04] hover:tw-bg-black/[0.08] tw-cursor-default tw-transition tw-font-sans">
      <span className={`tw-w-1.5 tw-h-1.5 tw-rounded-full ${dotCls} ${tone === 'emerald' ? 'tw-animate-pulse' : ''}`} style={tone === 'emerald' ? { animationDuration: '2.4s' } : undefined} />
      <span className={`tw-text-[10.5px] tw-font-bold tw-tracking-[-0.1px] ${labelCls}`}>{latency != null ? `${latency}ms` : status}</span>
    </div>
  );
}

/* ─── SystemHealthV2 · full diagnostic page (superadmin) ─── */
function SystemHealthV2({ onClose, currentUser, creatorsLive = [] }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [latency, setLatency] = useState(null);
  const [pingHistory, setPingHistory] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const t0 = performance.now();
      try {
        // Counts via Range header. The project and the key come from the one
        // client now; the schema header is what keeps these off `public`.
        async function countQuery(path) {
          const res = await wurxbaseRest(path, { headers: { Prefer: 'count=exact', Range: '0-0' } });
          const cr = res.headers.get('content-range') || '0-0/0';
          const m = cr.match(/\/(\d+)$/);
          return m ? parseInt(m[1], 10) : 0;
        }
        const since24h = new Date(Date.now() - 86400000).toISOString();
        const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
        const [
          rawCreators, activeCreators, pendingCreators, missingNames,
          app_users, activity_logs, join_requests, revoked_sessions, logs24h, logs7d
        ] = await Promise.all([
          countQuery(`creators?select=*&limit=0`),                                                              // raw total
          countQuery(`creators?select=*&limit=0&name=not.is.null&name=neq.&or=(status.eq.approved,status.is.null)`), // active (matches app)
          countQuery(`creators?select=*&limit=0&status=eq.pending`),                                            // pending review
          countQuery(`creators?select=*&limit=0&or=(name.is.null,name.eq.)`),                                   // empty names
          countQuery(`app_users?select=*&limit=0`),
          countQuery(`activity_logs?select=*&limit=0`),
          countQuery(`join_requests?select=*&limit=0`),
          countQuery(`revoked_sessions?select=*&limit=0`),
          countQuery(`activity_logs?select=*&limit=0&created_at=gte.${since24h}`),
          countQuery(`activity_logs?select=*&limit=0&created_at=gte.${since7d}`),
        ]);
        const ms = Math.round(performance.now() - t0);
        if (cancelled) return;
        setStats({ rawCreators, activeCreators, pendingCreators, missingNames, app_users, activity_logs, join_requests, revoked_sessions, logs24h, logs7d });
        setLatency(ms);
        setLoading(false);
      } catch (e) {
        if (!cancelled) { setLoading(false); setStats({ error: e.message }); }
      }
    }
    load();
    // Sample ping every 5s for live latency chart
    const samples = [];
    async function ping() {
      const t0 = performance.now();
      try {
        await wurxbaseRest('creators?select=id&limit=1');
        const ms = Math.round(performance.now() - t0);
        if (!cancelled) {
          samples.push(ms);
          if (samples.length > 20) samples.shift();
          setPingHistory([...samples]);
        }
      } catch {}
    }
    ping();
    const id = setInterval(ping, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const swVersion = (() => {
    try {
      // Best-effort: read from sw.js by parsing the cache name in caches API
      return navigator.serviceWorker?.controller ? 'Active' : 'Inactive';
    } catch { return 'Unknown'; }
  })();

  // Live deduped count from the actual rendered creators array
  const uniqueCreators = useMemo(() => {
    const set = new Set();
    creatorsLive.forEach(c => { if (c.name) set.add(c.name.trim().toLowerCase()); });
    return set.size;
  }, [creatorsLive]);

  const cards = stats && !stats.error ? [
    { label: 'Active Creators', value: stats.activeCreators, tone: 'blue', icon: '👥', sub: 'visible in table' },
    { label: 'Unique Names',    value: uniqueCreators,        tone: 'violet', icon: '🧬', sub: 'deduped' },
    { label: 'Pending Review',  value: stats.pendingCreators, tone: 'amber', icon: '⏳', sub: 'awaiting approval' },
    { label: 'Missing Names',   value: stats.missingNames,    tone: 'rose', icon: '⚠️', sub: 'data hygiene' },
    { label: 'Team Users',      value: stats.app_users,       tone: 'emerald', icon: '🧑‍💼' },
    { label: 'Activity Logs',   value: stats.activity_logs.toLocaleString(), tone: 'slate', icon: '📜' },
    { label: 'Logs · 24h',      value: stats.logs24h,         tone: 'slate', icon: '⏱️' },
    { label: 'Round Trip',      value: latency != null ? `${latency}ms` : '-', tone: latency == null ? 'slate' : latency < 500 ? 'emerald' : latency < 1500 ? 'amber' : 'rose', icon: '⚡' },
  ] : [];

  const toneStyles = {
    blue:    { bg: 'tw-bg-blue-50', text: 'tw-text-blue-700', ring: 'tw-ring-blue-200' },
    violet:  { bg: 'tw-bg-violet-50', text: 'tw-text-violet-700', ring: 'tw-ring-violet-200' },
    emerald: { bg: 'tw-bg-emerald-50', text: 'tw-text-emerald-700', ring: 'tw-ring-emerald-200' },
    amber:   { bg: 'tw-bg-amber-50', text: 'tw-text-amber-700', ring: 'tw-ring-amber-200' },
    rose:    { bg: 'tw-bg-rose-50', text: 'tw-text-rose-700', ring: 'tw-ring-rose-200' },
    slate:   { bg: 'tw-bg-slate-50', text: 'tw-text-slate-700', ring: 'tw-ring-slate-200' },
  };

  // Sparkline path for ping history
  const sparkPath = (() => {
    if (pingHistory.length < 2) return '';
    const w = 220, h = 50;
    const max = Math.max(...pingHistory, 100);
    const min = Math.min(...pingHistory, 0);
    const range = Math.max(1, max - min);
    return pingHistory.map((v, i) => {
      const x = (i / (pingHistory.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  })();
  const lastPing = pingHistory[pingHistory.length - 1];

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1900,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        background: 'color-mix(in srgb, var(--wx-warning-soft) 50%, transparent)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        fontFamily: 'inherit',
      }}
    >
      <div style={{
        position: 'relative', width: '100%', maxWidth: 640, maxHeight: '92vh',
        background: 'var(--wx-bg)', borderRadius: 22,
        boxShadow: '0 32px 80px rgba(48,39,28,0.25), 0 8px 24px rgba(48,39,28,0.10)',
        animation: 'sp-pop 0.32s cubic-bezier(0.33,1,0.68,1)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* ── Header · dark coffee ── */}
        <div style={{ background: 'var(--wx-warning-soft)', padding: '16px 22px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--wx-text-muted)' }}>System Health</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 2 }}>Real-time database &amp; app performance</div>
          </div>
          <button onClick={onClose} title="Close" style={{ width: 34, height: 34, borderRadius: 999, border: 0, cursor: 'pointer', background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.10)'; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Sparkline strip */}
        <div style={{ padding: '14px 22px', background: 'linear-gradient(135deg, var(--wx-surface-1) 0%, var(--wx-surface-2) 100%)', borderBottom: '1px solid var(--wx-border)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--wx-text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Latency · 5s</div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--wx-warning)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{lastPing != null ? `${lastPing}ms` : '-'}</div>
          </div>
          <svg width="240" height="44" viewBox="0 0 220 50" style={{ flex: 1 }}>
            <path d={sparkPath} fill="none" stroke="#30271C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
            {pingHistory.map((v, i) => {
              const w = 220, h = 50;
              const max = Math.max(...pingHistory, 100);
              const min = Math.min(...pingHistory, 0);
              const range = Math.max(1, max - min);
              const x = (i / Math.max(1, pingHistory.length - 1)) * w;
              const y = h - ((v - min) / range) * h;
              return <circle key={i} cx={x} cy={y} r={i === pingHistory.length - 1 ? 2.5 : 1.2} fill="#30271C" opacity={i === pingHistory.length - 1 ? 1 : 0.4} />;
            })}
          </svg>
        </div>

        {/* Body */}
        <div className="tw-flex-1 tw-overflow-y-auto tw-px-5 tw-py-4 tw-overscroll-contain">
          {loading ? (
            <div className="tw-flex tw-items-center tw-justify-center tw-py-12"><span className="tw-w-7 tw-h-7 tw-border-2 tw-border-emerald-500/30 tw-border-t-emerald-500 tw-rounded-full tw-animate-spin" /></div>
          ) : stats?.error ? (
            <div className="tw-bg-rose-50 tw-rounded-2xl tw-p-4 tw-ring-1 tw-ring-rose-200">
              <div className="tw-text-[12.5px] tw-font-bold tw-text-rose-800">Error: {stats.error}</div>
            </div>
          ) : (
            <>
              <div className="tw-grid tw-grid-cols-2 md:tw-grid-cols-4 tw-gap-2.5 tw-mb-5">
                {cards.map(c => {
                  const t = toneStyles[c.tone] || toneStyles.slate;
                  return (
                    <div key={c.label} className={`tw-relative tw-rounded-2xl tw-p-3 tw-ring-1 ${t.bg} ${t.ring}`}>
                      <div className="tw-text-[18px] tw-mb-1">{c.icon}</div>
                      <div className={`tw-text-[18px] tw-font-extrabold tw-tracking-[-0.4px] ${t.text}`}>{c.value}</div>
                      <div className="tw-text-[10px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mt-0.5">{c.label}</div>
                      {c.sub && <div className="tw-text-[9.5px] tw-font-medium tw-text-oneui-mute/80 tw-mt-0.5">{c.sub}</div>}
                    </div>
                  );
                })}
              </div>

              <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mb-2">DB Breakdown</div>
              <div className="tw-bg-slate-50 tw-rounded-2xl tw-p-4 tw-mb-3 tw-ring-1 tw-ring-black/[0.04] tw-space-y-2 tw-text-[12px]">
                <div className="tw-flex tw-items-center tw-justify-between"><span className="tw-font-bold tw-text-oneui-mute">Total rows in `creators`</span><span className="tw-font-extrabold tw-text-oneui-ink">{stats.rawCreators}</span></div>
                <div className="tw-flex tw-items-center tw-justify-between"><span className="tw-font-bold tw-text-oneui-mute">Approved + visible</span><span className="tw-font-extrabold tw-text-blue-700">{stats.activeCreators}</span></div>
                <div className="tw-flex tw-items-center tw-justify-between"><span className="tw-font-bold tw-text-oneui-mute">Pending review</span><span className="tw-font-extrabold tw-text-amber-700">{stats.pendingCreators}</span></div>
                <div className="tw-flex tw-items-center tw-justify-between"><span className="tw-font-bold tw-text-oneui-mute">Empty / missing names</span><span className={`tw-font-extrabold ${stats.missingNames > 0 ? 'tw-text-rose-700' : 'tw-text-emerald-700'}`}>{stats.missingNames}</span></div>
                <div className="tw-flex tw-items-center tw-justify-between"><span className="tw-font-bold tw-text-oneui-mute">Unique by name (deduped)</span><span className="tw-font-extrabold tw-text-violet-700">{uniqueCreators}</span></div>
              </div>

              <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mb-2">Service Worker</div>
              <div className="tw-bg-slate-50 tw-rounded-2xl tw-p-4 tw-mb-3 tw-ring-1 tw-ring-black/[0.04]">
                <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
                  <div className="tw-flex tw-items-center tw-gap-3">
                    <div className="tw-w-9 tw-h-9 tw-rounded-full tw-bg-blue-100 tw-text-blue-700 tw-flex tw-items-center tw-justify-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
                    <div>
                      <div className="tw-text-[13px] tw-font-extrabold tw-text-oneui-ink">Service Worker</div>
                      <div className="tw-text-[11px] tw-font-medium tw-text-oneui-mute">{swVersion === 'Active' ? 'Cached & ready · offline-capable' : 'Not active'}</div>
                    </div>
                  </div>
                  <span className={`tw-h-6 tw-px-2.5 tw-rounded-full tw-text-[10.5px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-inline-flex tw-items-center ${swVersion === 'Active' ? 'tw-bg-emerald-100 tw-text-emerald-700' : 'tw-bg-rose-100 tw-text-rose-700'}`}>{swVersion}</span>
                </div>
              </div>

              <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mb-2 tw-mt-4">Connection</div>
              <div className="tw-bg-slate-50 tw-rounded-2xl tw-p-4 tw-ring-1 tw-ring-black/[0.04] tw-space-y-2">
                <div className="tw-flex tw-items-center tw-justify-between"><span className="tw-text-[12px] tw-font-bold tw-text-oneui-mute">Endpoint</span><span className="tw-text-[11.5px] tw-font-mono tw-font-semibold tw-text-oneui-ink tw-truncate tw-max-w-[260px]">{WURXBASE_ENDPOINT_LABEL}</span></div>
                <div className="tw-flex tw-items-center tw-justify-between"><span className="tw-text-[12px] tw-font-bold tw-text-oneui-mute">Online</span><span className={`tw-text-[11.5px] tw-font-bold ${navigator.onLine ? 'tw-text-emerald-700' : 'tw-text-rose-700'}`}>{navigator.onLine ? 'Yes' : 'No'}</span></div>
                <div className="tw-flex tw-items-center tw-justify-between"><span className="tw-text-[12px] tw-font-bold tw-text-oneui-mute">Avg ping (last {pingHistory.length})</span><span className="tw-text-[11.5px] tw-font-bold tw-text-oneui-ink">{pingHistory.length > 0 ? `${Math.round(pingHistory.reduce((a, b) => a + b, 0) / pingHistory.length)}ms` : '-'}</span></div>
                <div className="tw-flex tw-items-center tw-justify-between"><span className="tw-text-[12px] tw-font-bold tw-text-oneui-mute">User</span><span className="tw-text-[11.5px] tw-font-bold tw-text-[#1259C3]">{currentUser?.display}</span></div>
              </div>

              <div className="tw-text-[10.5px] tw-text-oneui-mute tw-text-center tw-mt-4">Auto-refreshes every 5 seconds · Read-only diagnostic</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── WordCloudInsightsV2 · REMOVED per user request ─── */
// eslint-disable-next-line no-unused-vars
function WordCloudInsightsV2_REMOVED({ creators, onClose, onSelect }) {
  const [tab, setTab] = useState('categories');

  const data = useMemo(() => {
    const cats = {}, brands = {}, products = {};
    creators.forEach(c => {
      if (c.category) cats[c.category] = (cats[c.category] || 0) + 1;
      if (c.brand)    brands[c.brand] = (brands[c.brand] || 0) + 1;
      if (c.product)  products[c.product] = (products[c.product] || 0) + 1;
    });
    function toCloud(map) {
      const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 80);
      const max = entries[0]?.[1] || 1;
      const min = entries[entries.length - 1]?.[1] || 1;
      return entries.map(([label, count]) => ({
        label, count,
        weight: (count - min) / Math.max(1, max - min), // 0-1
      }));
    }
    return { categories: toCloud(cats), brands: toCloud(brands), products: toCloud(products) };
  }, [creators]);

  const active = data[tab] || [];
  const palettes = {
    categories: ['#1259C3', '#0E4DAD', '#3B82F6', '#60A5FA', '#93C5FD'],
    brands:     ['#7C3AED', '#A78BFA', '#C4B5FD', '#8B5CF6', '#6D28D9'],
    products:   ['#F59E0B', '#FBBF24', '#FCD34D', '#D97706', '#B45309'],
  };
  const palette = palettes[tab];

  function pickColor(weight, label) {
    // Hash label for consistent color assignment within palette
    let hash = 0;
    for (let i = 0; i < label.length; i++) hash = (hash << 5) - hash + label.charCodeAt(i);
    return palette[Math.abs(hash) % palette.length];
  }

  return (
    <div className="tw-fixed tw-inset-0 tw-z-[1900] tw-bg-black/55 tw-backdrop-blur-md tw-flex tw-items-end md:tw-items-center tw-justify-center tw-p-0 md:tw-p-4 tw-font-sans" onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ animation: 'bsv2-fade 0.22s ease' }}>
      <div className="tw-relative tw-w-full md:tw-max-w-[680px] tw-bg-white tw-rounded-t-[28px] md:tw-rounded-[28px] tw-shadow-oneui_lg tw-overflow-hidden tw-flex tw-flex-col" style={{ maxHeight: '92vh', animation: 'bsv2-pop 0.34s cubic-bezier(0.33,1,0.68,1)' }}>
        <div className="tw-flex tw-justify-center tw-pt-2.5 tw-pb-1 md:tw-hidden"><div className="tw-w-9 tw-h-1 tw-rounded-full tw-bg-black/15" /></div>

        <div className="tw-relative tw-bg-gradient-to-br tw-from-violet-500 tw-via-fuchsia-600 tw-to-pink-600 tw-px-6 tw-pt-5 tw-pb-5 tw-overflow-hidden">
          <div className="tw-absolute tw-inset-0 tw-opacity-15" style={{ backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
          <div className="tw-relative tw-z-10 tw-flex tw-items-start tw-justify-between tw-gap-3">
            <div>
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-h-5 tw-px-2 tw-rounded-full tw-bg-white/25 tw-backdrop-blur tw-text-white tw-text-[10px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-mb-2">☁ Insights</div>
              <div className="tw-text-white tw-text-[22px] tw-font-extrabold tw-tracking-[-0.6px] tw-leading-tight">Word Cloud</div>
              <div className="tw-text-white/85 tw-text-[12.5px] tw-font-medium tw-mt-1">Most common values across {creators.length} creators</div>
            </div>
            <button onClick={onClose} className="tw-flex-shrink-0 tw-w-9 tw-h-9 tw-rounded-full tw-bg-white/20 hover:tw-bg-white/35 tw-backdrop-blur tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[13px] tw-font-bold tw-border-0 tw-cursor-pointer active:tw-scale-90 tw-transition tw-leading-none">✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="tw-px-5 tw-pt-3 tw-border-b tw-border-black/[0.06]">
          <div className="tw-flex tw-gap-1 tw-bg-black/[0.04] tw-rounded-full tw-p-1">
            {[{ id: 'categories', label: 'Categories' }, { id: 'brands', label: 'Brands' }, { id: 'products', label: 'Products' }].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`tw-flex-1 tw-h-9 tw-rounded-full tw-text-[12.5px] tw-font-bold tw-tracking-[-0.1px] tw-border-0 tw-cursor-pointer tw-transition ${tab === t.id ? 'tw-bg-white tw-text-violet-700 tw-shadow-sm' : 'tw-bg-transparent tw-text-oneui-mute hover:tw-text-oneui-ink'}`}>
                {t.label} <span className="tw-text-oneui-mute tw-font-medium tw-ml-1">{data[t.id].length}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="tw-flex-1 tw-overflow-y-auto tw-px-5 tw-py-5 tw-overscroll-contain">
          {active.length === 0 ? (
            <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-12 tw-text-center">
              <div className="tw-text-[36px] tw-mb-2">🌫️</div>
              <div className="tw-text-[14px] tw-font-bold tw-text-oneui-ink">No data yet</div>
              <div className="tw-text-[12px] tw-text-oneui-mute tw-font-medium tw-mt-1">Add some {tab} to your creators first.</div>
            </div>
          ) : (
            <div className="tw-flex tw-flex-wrap tw-gap-2 tw-justify-center tw-items-center" style={{ animation: 'bsv2-step 0.3s cubic-bezier(0.33,1,0.68,1)' }}>
              {active.map(({ label, count, weight }) => {
                const fontSize = 11 + weight * 24; // 11px → 35px
                const padY = 4 + weight * 6;
                const padX = 9 + weight * 8;
                const color = pickColor(weight, label);
                return (
                  <button
                    key={label}
                    onClick={() => onSelect && onSelect(tab, label)}
                    style={{ fontSize, padding: `${padY}px ${padX}px`, backgroundColor: `${color}1a`, color }}
                    className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-full tw-font-extrabold tw-tracking-[-0.3px] tw-border-0 tw-cursor-pointer tw-transition hover:tw-brightness-110 hover:-tw-translate-y-0.5 active:tw-scale-95 tw-shadow-sm"
                  >
                    {label}
                    <span className="tw-opacity-60 tw-text-[0.65em] tw-font-bold">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── PivotTableV2 · drag-drop dimension cross-tab summary ─── */
function PivotTableV2({ creators }) {
  const DIMS = [
    { id: 'brand', label: 'Brand', get: c => c.brand || '(none)' },
    { id: 'hired_by', label: 'Hired By', get: c => c.hired_by || '(none)' },
    { id: 'category', label: 'Category', get: c => c.category || '(none)' },
    { id: 'payment_status', label: 'Payment', get: c => c.payment_status || '(none)' },
    { id: 'videos', label: 'Videos', get: c => c.videos || '(none)' },
    { id: 'month', label: 'Hire Month', get: c => c.hiring_date ? c.hiring_date.slice(0, 7) : '(none)' },
    { id: 'product', label: 'Product', get: c => c.product || '(none)' },
  ];
  const AGGS = [
    { id: 'count',   label: 'Count', compute: (rows) => rows.length },
    { id: 'sum',     label: 'Total $', compute: (rows) => rows.reduce((s, c) => s + (parseDeal(c.deal).amount || 0), 0) },
    { id: 'paid',    label: 'Paid Count', compute: (rows) => rows.filter(c => c.payment_status === 'Paid').length },
    { id: 'paidsum', label: 'Paid $', compute: (rows) => rows.filter(c => c.payment_status === 'Paid').reduce((s, c) => s + (parseDeal(c.deal).amount || 0), 0) },
    { id: 'videos',  label: 'Videos Done', compute: (rows) => rows.filter(c => c.videos === 'Done').length },
  ];

  const [rowDim, setRowDim] = useState(() => { try { return localStorage.getItem('ch_pivot_row') || 'brand'; } catch { return 'brand'; } });
  const [colDim, setColDim] = useState(() => { try { return localStorage.getItem('ch_pivot_col') || 'payment_status'; } catch { return 'payment_status'; } });
  const [agg,    setAgg]    = useState(() => { try { return localStorage.getItem('ch_pivot_agg') || 'count'; } catch { return 'count'; } });

  useEffect(() => {
    try {
      localStorage.setItem('ch_pivot_row', rowDim);
      localStorage.setItem('ch_pivot_col', colDim);
      localStorage.setItem('ch_pivot_agg', agg);
    } catch {}
  }, [rowDim, colDim, agg]);

  const pivot = useMemo(() => {
    const rGetter = DIMS.find(d => d.id === rowDim).get;
    const cGetter = DIMS.find(d => d.id === colDim).get;
    const aggFn = AGGS.find(a => a.id === agg).compute;
    const rowsSet = new Set(), colsSet = new Set();
    const grid = {};
    creators.forEach(c => {
      const r = rGetter(c), col = cGetter(c);
      rowsSet.add(r); colsSet.add(col);
      const key = `${r}|||${col}`;
      if (!grid[key]) grid[key] = [];
      grid[key].push(c);
    });
    const rows = [...rowsSet].sort();
    const cols = [...colsSet].sort();
    const cells = {};
    let max = 0;
    rows.forEach(r => {
      cols.forEach(co => {
        const v = aggFn(grid[`${r}|||${co}`] || []);
        cells[`${r}|||${co}`] = v;
        if (v > max) max = v;
      });
    });
    // Row totals + col totals
    const rowTotals = {}; rows.forEach(r => { rowTotals[r] = aggFn(creators.filter(c => rGetter(c) === r)); });
    const colTotals = {}; cols.forEach(co => { colTotals[co] = aggFn(creators.filter(c => cGetter(c) === co)); });
    const grandTotal = aggFn(creators);
    return { rows, cols, cells, max, rowTotals, colTotals, grandTotal };
  }, [creators, rowDim, colDim, agg]); // eslint-disable-line react-hooks/exhaustive-deps

  function fmt(v) {
    if (agg === 'sum' || agg === 'paidsum') return v > 0 ? `$${v.toLocaleString()}` : '-';
    return v > 0 ? String(v) : '-';
  }

  function exportCsv() {
    const cols = pivot.cols;
    const lines = [['', ...cols, 'Total'].map(s => `"${String(s).replace(/"/g, '""')}"`).join(',')];
    pivot.rows.forEach(r => {
      const row = [r, ...cols.map(co => pivot.cells[`${r}|||${co}`] ?? 0), pivot.rowTotals[r] ?? 0];
      lines.push(row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    });
    lines.push(['Total', ...cols.map(co => pivot.colTotals[co] ?? 0), pivot.grandTotal].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `pivot_${rowDim}_${colDim}_${agg}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const rowDimMeta = DIMS.find(d => d.id === rowDim);
  const colDimMeta = DIMS.find(d => d.id === colDim);
  const aggMeta = AGGS.find(a => a.id === agg);

  return (
    <div className="tw-px-4 md:tw-px-6 tw-pb-24 md:tw-pb-12 tw-font-sans">
      <div className="tw-max-w-[1280px] tw-mx-auto tw-bg-white tw-rounded-[24px] tw-shadow-oneui_lg tw-ring-1 tw-ring-black/[0.05] tw-overflow-hidden">
        {/* Controls */}
        <div className="tw-flex tw-flex-col md:tw-flex-row tw-items-start md:tw-items-center tw-gap-3 tw-px-5 md:tw-px-6 tw-py-4 tw-border-b tw-border-black/[0.06] tw-bg-gradient-to-r tw-from-blue-50 tw-to-violet-50">
          <div className="tw-flex tw-items-center tw-gap-2">
            <div className="tw-w-9 tw-h-9 tw-rounded-xl tw-bg-gradient-to-br tw-from-blue-500 tw-to-violet-600 tw-text-white tw-flex tw-items-center tw-justify-center tw-shadow-md">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            </div>
            <div>
              <div className="tw-text-[16px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.4px] tw-leading-tight">Pivot Table</div>
              <div className="tw-text-[11px] tw-font-semibold tw-text-oneui-mute">{aggMeta.label} of creators by {rowDimMeta.label} × {colDimMeta.label}</div>
            </div>
          </div>
          <div className="tw-flex tw-flex-wrap tw-gap-2 md:tw-ml-auto">
            <PivotPicker label="Rows" value={rowDim} onChange={setRowDim} options={DIMS} tone="blue" />
            <PivotPicker label="Columns" value={colDim} onChange={setColDim} options={DIMS} tone="violet" />
            <PivotPicker label="Value" value={agg} onChange={setAgg} options={AGGS} tone="emerald" />
            <button onClick={exportCsv} className="tw-h-9 tw-px-3 tw-rounded-full tw-bg-emerald-600 hover:tw-bg-emerald-700 tw-text-white tw-text-[11.5px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-95 tw-flex tw-items-center tw-gap-1.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              CSV
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="tw-overflow-auto tw-max-h-[calc(100vh-260px)]">
          {pivot.rows.length === 0 || pivot.cols.length === 0 ? (
            <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-14 tw-text-center">
              <div className="tw-text-[36px] tw-mb-2">📊</div>
              <div className="tw-text-[14px] tw-font-bold tw-text-oneui-ink">No data to pivot</div>
              <div className="tw-text-[12px] tw-text-oneui-mute tw-font-medium tw-mt-1">Try different dimensions or add more creators.</div>
            </div>
          ) : (
            <table className="tw-w-full tw-text-[12.5px] tw-border-collapse">
              <thead className="tw-sticky tw-top-0 tw-z-10 tw-bg-white tw-shadow-sm">
                <tr>
                  <th className="tw-sticky tw-left-0 tw-z-20 tw-bg-slate-50 tw-px-3 tw-py-3 tw-text-left tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-border-b-2 tw-border-r tw-border-slate-200 tw-min-w-[140px]">{rowDimMeta.label} ↓ / {colDimMeta.label} →</th>
                  {pivot.cols.map(co => (
                    <th key={co} className="tw-px-3 tw-py-3 tw-text-right tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-violet-700 tw-border-b-2 tw-border-slate-200 tw-bg-violet-50/50 tw-whitespace-nowrap">{co}</th>
                  ))}
                  <th className="tw-px-3 tw-py-3 tw-text-right tw-text-[10.5px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-text-emerald-800 tw-border-b-2 tw-border-l tw-border-slate-200 tw-bg-emerald-50">Total</th>
                </tr>
              </thead>
              <tbody>
                {pivot.rows.map((r, ri) => (
                  <tr key={r} className={ri % 2 === 0 ? 'tw-bg-white' : 'tw-bg-slate-50/40'}>
                    <th className="tw-sticky tw-left-0 tw-bg-inherit tw-px-3 tw-py-2.5 tw-text-left tw-text-[12.5px] tw-font-extrabold tw-text-blue-700 tw-border-r tw-border-slate-200 tw-whitespace-nowrap">{r}</th>
                    {pivot.cols.map(co => {
                      const v = pivot.cells[`${r}|||${co}`] ?? 0;
                      const intensity = pivot.max > 0 ? Math.min(1, v / pivot.max) : 0;
                      return (
                        <td key={co} className="tw-px-3 tw-py-2.5 tw-text-right tw-font-bold tw-tabular-nums tw-text-oneui-ink tw-border-b tw-border-slate-100" style={{ background: v > 0 ? `rgba(124, 58, 237, ${0.04 + intensity * 0.18})` : undefined }}>
                          {fmt(v)}
                        </td>
                      );
                    })}
                    <td className="tw-px-3 tw-py-2.5 tw-text-right tw-font-extrabold tw-text-emerald-800 tw-border-b tw-border-l tw-border-slate-200 tw-bg-emerald-50/60 tw-tabular-nums">{fmt(pivot.rowTotals[r])}</td>
                  </tr>
                ))}
                <tr className="tw-bg-emerald-50 tw-sticky tw-bottom-0 tw-z-10">
                  <th className="tw-sticky tw-left-0 tw-bg-emerald-100 tw-px-3 tw-py-3 tw-text-left tw-text-[11px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-text-emerald-900 tw-border-r tw-border-emerald-200 tw-border-t-2 tw-whitespace-nowrap">Total</th>
                  {pivot.cols.map(co => (
                    <td key={co} className="tw-px-3 tw-py-3 tw-text-right tw-font-extrabold tw-text-emerald-800 tw-border-t-2 tw-border-emerald-200 tw-tabular-nums">{fmt(pivot.colTotals[co])}</td>
                  ))}
                  <td className="tw-px-3 tw-py-3 tw-text-right tw-font-extrabold tw-text-emerald-900 tw-border-t-2 tw-border-l tw-border-emerald-300 tw-bg-emerald-100 tw-text-[14px] tw-tabular-nums">{fmt(pivot.grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Footer info */}
        <div className="tw-flex tw-items-center tw-justify-center tw-gap-4 tw-px-5 tw-py-3 tw-border-t tw-border-black/[0.06] tw-bg-black/[0.015] tw-text-[10.5px] tw-font-semibold tw-text-oneui-mute tw-text-center">
          <span><strong className="tw-text-blue-700">{pivot.rows.length}</strong> rows</span>
          <span>·</span>
          <span><strong className="tw-text-violet-700">{pivot.cols.length}</strong> cols</span>
          <span>·</span>
          <span><strong className="tw-text-emerald-700">{creators.length}</strong> creators total</span>
        </div>
      </div>
    </div>
  );
}

function PivotPicker({ label, value, onChange, options, tone }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const tones = {
    blue:    'tw-bg-blue-100 tw-text-blue-800 hover:tw-bg-blue-200',
    violet:  'tw-bg-violet-100 tw-text-violet-800 hover:tw-bg-violet-200',
    emerald: 'tw-bg-emerald-100 tw-text-emerald-800 hover:tw-bg-emerald-200',
  };
  const cur = options.find(o => o.id === value);
  return (
    <div ref={ref} className="tw-relative">
      <button onClick={() => setOpen(s => !s)} className={`tw-h-9 tw-pl-3 tw-pr-2 tw-rounded-full tw-text-[11.5px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition tw-flex tw-items-center tw-gap-1.5 ${tones[tone]}`}>
        <span className="tw-opacity-60 tw-text-[10px] tw-uppercase tw-tracking-wider">{label}:</span>
        <span>{cur?.label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="tw-absolute tw-top-full tw-mt-1 tw-left-0 tw-z-30 tw-bg-white tw-rounded-2xl tw-shadow-oneui_lg tw-ring-1 tw-ring-black/5 tw-min-w-[160px] tw-overflow-hidden">
          {options.map(o => (
            <button key={o.id} onClick={() => { onChange(o.id); setOpen(false); }} className={`tw-block tw-w-full tw-text-left tw-px-3 tw-py-2 tw-text-[12px] tw-font-semibold tw-border-0 tw-cursor-pointer tw-transition ${value === o.id ? 'tw-bg-blue-50 tw-text-[#1259C3]' : 'tw-bg-white tw-text-oneui-ink hover:tw-bg-black/[0.03]'}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── SqlPlaygroundV2 · read-only SQL editor for superadmin ─── */
const SQL_PRESETS = [
  { label: 'Top 10 paying creators', sql: 'SELECT name, brand, deal, payment_status, hired_by\nFROM creators\nWHERE payment_status = \'Paid\'\nORDER BY id DESC\nLIMIT 10' },
  { label: 'Unpaid 30+ days',         sql: 'SELECT name, brand, deal, hiring_date\nFROM creators\nWHERE payment_status = \'Not Yet\'\n  AND hiring_date < (CURRENT_DATE - INTERVAL \'30 days\')\nORDER BY hiring_date ASC\nLIMIT 100' },
  { label: 'Activity last 7 days',    sql: 'SELECT user_display, action, target, created_at\nFROM activity_logs\nWHERE created_at > (CURRENT_DATE - INTERVAL \'7 days\')\nORDER BY created_at DESC\nLIMIT 100' },
  { label: 'Brands by deal count',    sql: 'SELECT brand, COUNT(*) AS total_deals\nFROM creators\nWHERE brand IS NOT NULL AND brand != \'\'\nGROUP BY brand\nORDER BY total_deals DESC\nLIMIT 50' },
  { label: 'Payment breakdown',       sql: 'SELECT payment_status, COUNT(*) AS count\nFROM creators\nGROUP BY payment_status\nORDER BY count DESC' },
  { label: 'My team members',         sql: 'SELECT id, username, display, role, last_seen\nFROM app_users\nORDER BY last_seen DESC NULLS LAST\nLIMIT 50' },
  { label: 'Pending join requests',   sql: 'SELECT name, email, username, status, created_at\nFROM join_requests\nWHERE status = \'pending\'\nORDER BY created_at DESC' },
  { label: 'Creators by category',    sql: 'SELECT category, COUNT(*) AS count\nFROM creators\nWHERE category IS NOT NULL AND category != \'\'\nGROUP BY category\nORDER BY count DESC\nLIMIT 30' },
];
const SQL_TABLES = [
  { name: 'creators',         cols: ['id', 'name', 'tiktok_account', 'brand', 'deal', 'hiring_date', 'deadline', 'payment_status', 'videos', 'product', 'category', 'hired_by', 'whatsapp_number', 'email', 'paypal', 'zelle', 'comments', 'video_codes', 'status', 'inserted_at'] },
  { name: 'app_users',        cols: ['id', 'username', 'display', 'role', 'brand_access', 'custom_perms', 'last_seen'] },
  { name: 'activity_logs',    cols: ['id', 'user_id', 'user_display', 'action', 'target', 'details', 'created_at'] },
  { name: 'join_requests',    cols: ['id', 'name', 'email', 'username', 'status', 'created_at'] },
  { name: 'app_settings',     cols: ['id', 'hidden_brands', 'updated_at'] },
  { name: 'revoked_sessions', cols: ['session_id', 'revoked_by', 'revoked_at'] },
];
const SQL_HISTORY_KEY = 'ch_sql_history';
const SQL_SAVED_KEY = 'ch_sql_saved';

function sqlIsSafe(sql) {
  // Allow only single SELECT statements
  const cleaned = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!cleaned) return { ok: false, reason: 'Query is empty.' };
  // Block multiple statements (semicolons in middle)
  const noTrailingSemi = cleaned.replace(/;+\s*$/, '');
  if (noTrailingSemi.includes(';')) return { ok: false, reason: 'Multiple statements not allowed. Run one query at a time.' };
  // Must start with SELECT (or WITH for CTEs that lead to SELECT)
  const firstWord = noTrailingSemi.split(/\s+/)[0].toUpperCase();
  if (firstWord !== 'SELECT' && firstWord !== 'WITH') return { ok: false, reason: `Only SELECT/WITH queries allowed. Got: ${firstWord}` };
  // Block destructive keywords anywhere
  const blocked = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXECUTE)\b/i;
  if (blocked.test(noTrailingSemi)) return { ok: false, reason: 'Destructive keywords blocked. Read-only mode.' };
  return { ok: true, sql: noTrailingSemi };
}

function SqlPlaygroundV2({ onClose, currentUser }) {
  const [sql, setSql] = useState('SELECT name, brand, deal, payment_status\nFROM creators\nORDER BY id DESC\nLIMIT 25');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(null);
  const [history, setHistory] = useState(() => { try { return JSON.parse(localStorage.getItem(SQL_HISTORY_KEY) || '[]'); } catch { return []; } });
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem(SQL_SAVED_KEY) || '[]'); } catch { return []; } });
  const [showSchema, setShowSchema] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmedSafety, setConfirmedSafety] = useState(() => {
    try { return localStorage.getItem('ch_sql_confirmed') === '1'; } catch { return false; }
  });
  const editorRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
      if (e.key === 'Escape' && !running) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, running]);

  function pushHistory(q) {
    const next = [{ sql: q, at: Date.now() }, ...history.filter(h => h.sql !== q)].slice(0, 20);
    setHistory(next);
    try { localStorage.setItem(SQL_HISTORY_KEY, JSON.stringify(next)); } catch {}
  }

  function saveQuery() {
    const name = window.prompt('Save query as:');
    if (!name) return;
    const next = [{ name, sql, at: Date.now() }, ...saved].slice(0, 30);
    setSaved(next);
    try { localStorage.setItem(SQL_SAVED_KEY, JSON.stringify(next)); } catch {}
  }
  function deleteSaved(idx) {
    const next = saved.filter((_, i) => i !== idx);
    setSaved(next);
    try { localStorage.setItem(SQL_SAVED_KEY, JSON.stringify(next)); } catch {}
  }

  async function run() {
    if (running) return;
    setError(''); setResults(null); setElapsed(null);
    const check = sqlIsSafe(sql);
    if (!check.ok) { setError(check.reason); return; }
    // Auto-append LIMIT if missing
    let finalSql = check.sql;
    if (!/\bLIMIT\s+\d+/i.test(finalSql)) finalSql += '\nLIMIT 1000';
    setRunning(true);
    const t0 = performance.now();
    try {
      const SUPABASE_URL = WURXBASE_ORIGIN;
      // Use Supabase RPC to run a raw SQL via the rest layer requires a custom function.
      // Fallback: parse FROM/SELECT and use the REST API directly for table queries.
      const parsed = parseSimpleSelect(finalSql);
      if (!parsed) { setError('Complex SQL not supported in this client. Use simple SELECT col1, col2 FROM table WHERE ... ORDER BY ... LIMIT N. Joins and CTEs require an RPC function.'); setRunning(false); return; }
      const url = buildRestUrl(SUPABASE_URL, parsed);
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, { headers: await wurxbaseHeaders(), signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      const data = await res.json();
      const ms = Math.round(performance.now() - t0);
      setResults(Array.isArray(data) ? data : [data]);
      setElapsed(ms);
      pushHistory(sql);
    } catch (e) {
      setError(e.name === 'AbortError' ? 'Query timed out (10s limit)' : (e.message || 'Query failed'));
    }
    setRunning(false);
  }

  function exportCsv() {
    if (!results || results.length === 0) return;
    const cols = Object.keys(results[0]);
    const escape = v => {
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(','), ...results.map(r => cols.map(c => escape(r[c])).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `sql_results_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  function copyJson() {
    if (!results) return;
    navigator.clipboard.writeText(JSON.stringify(results, null, 2));
  }

  function insertAtCursor(text) {
    const ta = editorRef.current;
    if (!ta) { setSql(s => s + text); return; }
    const start = ta.selectionStart, end = ta.selectionEnd;
    const next = sql.slice(0, start) + text + sql.slice(end);
    setSql(next);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + text.length, start + text.length); }, 0);
  }

  if (!confirmedSafety) {
    return (
      <div className="tw-fixed tw-inset-0 tw-z-[2050] tw-bg-black/60 tw-backdrop-blur-md tw-flex tw-items-center tw-justify-center tw-p-4 tw-font-sans" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="tw-relative tw-w-full tw-max-w-[440px] tw-bg-white tw-rounded-[28px] tw-shadow-oneui_lg tw-overflow-hidden" style={{ animation: 'bsv2-pop 0.32s cubic-bezier(0.33,1,0.68,1)' }}>
          <div className="tw-relative tw-h-[140px] tw-bg-gradient-to-br tw-from-violet-500 tw-via-indigo-600 tw-to-blue-700 tw-flex tw-items-center tw-justify-center tw-overflow-hidden">
            <div className="tw-absolute tw-inset-0 tw-opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
            <div className="tw-text-[60px] tw-relative tw-z-10" style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.25))' }}>🛠️</div>
            <span className="tw-absolute tw-top-4 tw-left-4 tw-inline-flex tw-items-center tw-h-6 tw-px-2.5 tw-rounded-full tw-bg-white/22 tw-backdrop-blur-md tw-border tw-border-white/30 tw-text-white tw-text-[10px] tw-font-extrabold tw-tracking-wider tw-uppercase">Debug Tool</span>
          </div>
          <div className="tw-p-6">
            <div className="tw-text-[22px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.5px] tw-leading-tight">SQL Playground</div>
            <div className="tw-text-[13.5px] tw-font-medium tw-text-oneui-mute tw-mt-1.5 tw-mb-4">Read-only SQL access to your Supabase database. Superadmin only.</div>
            <div className="tw-bg-emerald-50 tw-rounded-2xl tw-p-4 tw-mb-4 tw-ring-1 tw-ring-emerald-100 tw-space-y-2">
              <div className="tw-flex tw-items-start tw-gap-2"><span className="tw-text-emerald-600 tw-font-bold">✓</span><span className="tw-text-[12px] tw-font-semibold tw-text-emerald-800">Only <code className="tw-bg-white tw-px-1 tw-rounded">SELECT</code> queries allowed</span></div>
              <div className="tw-flex tw-items-start tw-gap-2"><span className="tw-text-emerald-600 tw-font-bold">✓</span><span className="tw-text-[12px] tw-font-semibold tw-text-emerald-800">10s timeout · 1000 row limit auto-applied</span></div>
              <div className="tw-flex tw-items-start tw-gap-2"><span className="tw-text-emerald-600 tw-font-bold">✓</span><span className="tw-text-[12px] tw-font-semibold tw-text-emerald-800">No INSERT / UPDATE / DELETE / DROP · blocked</span></div>
            </div>
            <div className="tw-flex tw-gap-2.5">
              <button onClick={onClose} className="tw-flex-1 tw-h-12 tw-rounded-full tw-bg-black/[0.05] hover:tw-bg-black/[0.1] tw-text-oneui-ink tw-text-[13.5px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-[0.98]">Cancel</button>
              <button onClick={() => { setConfirmedSafety(true); try { localStorage.setItem('ch_sql_confirmed', '1'); } catch {} }} className="tw-flex-1 tw-h-12 tw-rounded-full tw-bg-gradient-to-r tw-from-[#1259C3] tw-to-[#0E4DAD] tw-text-white tw-text-[13.5px] tw-font-extrabold tw-tracking-[-0.2px] tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-[0.98] tw-shadow-oneui_blue">Got it, open</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1900,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        background: 'color-mix(in srgb, var(--wx-warning-soft) 50%, transparent)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        fontFamily: 'inherit',
      }}
    >
      <div style={{
        position: 'relative', width: '100%', maxWidth: 1100, height: '92vh',
        background: 'var(--wx-bg)', borderRadius: 22,
        boxShadow: '0 32px 80px rgba(48,39,28,0.25), 0 8px 24px rgba(48,39,28,0.10)',
        animation: 'sp-pop 0.32s cubic-bezier(0.33,1,0.68,1)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* ── Header · dark coffee ── */}
        <div style={{ background: 'var(--wx-warning-soft)', padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--wx-text-muted)' }}>SQL Playground</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--wx-success-soft)', display: 'inline-block' }} />
              Read-only · {currentUser?.display}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => setShowSchema(s => !s)} title="Toggle schema" style={{ height: 32, padding: '0 12px', borderRadius: 999, border: 0, cursor: 'pointer', background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, lineHeight: 1, fontFamily: 'inherit' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(245,233,214,0.18)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(245,233,214,0.10)'}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              Schema
            </button>
            <button onClick={() => setShowHistory(s => !s)} title="History" style={{ height: 32, padding: '0 12px', borderRadius: 999, border: 0, cursor: 'pointer', background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, lineHeight: 1, fontFamily: 'inherit' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(245,233,214,0.18)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(245,233,214,0.10)'}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              History
            </button>
            <button onClick={onClose} title="Close" style={{ width: 32, height: 32, borderRadius: 999, border: 0, cursor: 'pointer', background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(245,233,214,0.18)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(245,233,214,0.10)'}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* Main split */}
        <div className="tw-flex-1 tw-flex tw-overflow-hidden">
          {/* Schema sidebar (desktop) */}
          {showSchema && (
            <div className="tw-hidden md:tw-flex tw-flex-col tw-w-[230px] tw-border-r tw-border-black/[0.06] tw-bg-slate-50 tw-overflow-y-auto tw-flex-shrink-0">
              <div className="tw-px-4 tw-py-3 tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Tables</div>
              {SQL_TABLES.map(t => (
                <details key={t.name} className="tw-px-2 tw-mb-1">
                  <summary className="tw-flex tw-items-center tw-gap-2 tw-px-2 tw-py-1.5 tw-rounded-lg hover:tw-bg-black/[0.04] tw-cursor-pointer tw-text-[12.5px] tw-font-bold tw-text-oneui-ink tw-list-none">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="tw-text-violet-500"><polyline points="9 18 15 12 9 6"/></svg>
                    <span onClick={(e) => { e.preventDefault(); insertAtCursor(t.name); }}>{t.name}</span>
                    <span className="tw-ml-auto tw-text-[9.5px] tw-text-oneui-mute tw-font-medium">{t.cols.length}</span>
                  </summary>
                  <div className="tw-pl-5 tw-py-1 tw-space-y-0.5">
                    {t.cols.map(c => (
                      <button key={c} onClick={() => insertAtCursor(c)} className="tw-block tw-w-full tw-text-left tw-px-2 tw-py-0.5 tw-rounded tw-text-[11px] tw-font-mono tw-text-oneui-mute hover:tw-bg-violet-50 hover:tw-text-violet-700 tw-bg-transparent tw-border-0 tw-cursor-pointer">{c}</button>
                    ))}
                  </div>
                </details>
              ))}

              <div className="tw-px-4 tw-py-3 tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mt-2">Presets</div>
              <div className="tw-px-2 tw-pb-4 tw-space-y-1">
                {SQL_PRESETS.map(p => (
                  <button key={p.label} onClick={() => setSql(p.sql)} className="tw-block tw-w-full tw-text-left tw-px-3 tw-py-2 tw-rounded-lg hover:tw-bg-violet-50 hover:tw-text-violet-700 tw-text-[11.5px] tw-font-semibold tw-text-oneui-ink tw-bg-transparent tw-border-0 tw-cursor-pointer tw-transition">{p.label}</button>
                ))}
              </div>
            </div>
          )}

          {/* History/Saved panel */}
          {showHistory && (
            <div className="tw-flex tw-flex-col tw-w-[260px] tw-border-r tw-border-black/[0.06] tw-bg-white tw-overflow-y-auto tw-flex-shrink-0" style={{ animation: 'msd-down 0.22s ease' }}>
              <div className="tw-flex tw-items-center tw-justify-between tw-px-4 tw-py-3 tw-border-b tw-border-black/[0.04]">
                <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Saved</div>
                <button onClick={saveQuery} className="tw-h-6 tw-px-2 tw-rounded-full tw-bg-[#1259C3] tw-text-white tw-text-[10px] tw-font-bold tw-border-0 tw-cursor-pointer">+ Save current</button>
              </div>
              {saved.length === 0 ? (
                <div className="tw-px-4 tw-py-4 tw-text-[11.5px] tw-text-oneui-mute tw-font-medium">No saved queries yet.</div>
              ) : saved.map((s, i) => (
                <div key={i} className="tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2 hover:tw-bg-black/[0.03] tw-border-b tw-border-black/[0.04]">
                  <button onClick={() => setSql(s.sql)} className="tw-flex-1 tw-text-left tw-text-[12px] tw-font-bold tw-text-oneui-ink tw-bg-transparent tw-border-0 tw-cursor-pointer tw-truncate">{s.name}</button>
                  <button onClick={() => deleteSaved(i)} className="tw-w-5 tw-h-5 tw-rounded-full tw-bg-rose-50 tw-text-rose-600 tw-flex tw-items-center tw-justify-center tw-text-[9px] tw-font-bold tw-border-0 tw-cursor-pointer">✕</button>
                </div>
              ))}

              <div className="tw-px-4 tw-py-3 tw-mt-2 tw-border-b tw-border-black/[0.04] tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute">Recent History</div>
              {history.length === 0 ? (
                <div className="tw-px-4 tw-py-4 tw-text-[11.5px] tw-text-oneui-mute tw-font-medium">No history yet. Run a query to start.</div>
              ) : history.map((h, i) => (
                <button key={i} onClick={() => setSql(h.sql)} className="tw-block tw-w-full tw-text-left tw-px-3 tw-py-2 hover:tw-bg-black/[0.03] tw-border-b tw-border-black/[0.04] tw-bg-transparent tw-border-x-0 tw-border-t-0 tw-cursor-pointer">
                  <div className="tw-text-[11px] tw-font-mono tw-text-oneui-ink tw-truncate">{h.sql.split('\n')[0]}</div>
                  <div className="tw-text-[10px] tw-font-medium tw-text-oneui-mute tw-mt-0.5">{new Date(h.at).toLocaleTimeString()}</div>
                </button>
              ))}
            </div>
          )}

          {/* Editor + results */}
          <div className="tw-flex-1 tw-flex tw-flex-col tw-overflow-hidden tw-bg-slate-900">
            {/* Editor */}
            <div className="tw-flex tw-flex-col tw-border-b tw-border-white/10" style={{ minHeight: '180px', maxHeight: '40%' }}>
              <textarea
                ref={editorRef}
                value={sql}
                onChange={e => setSql(e.target.value)}
                spellCheck={false}
                placeholder="SELECT * FROM creators LIMIT 10"
                className="tw-flex-1 tw-w-full tw-bg-slate-900 tw-text-emerald-200 tw-font-mono tw-text-[13px] tw-p-4 tw-border-0 tw-outline-none tw-resize-none placeholder:tw-text-white/30"
                style={{ minHeight: '160px', tabSize: 2 }}
              />
              <div className="tw-flex tw-items-center tw-justify-between tw-px-4 tw-py-2 tw-bg-slate-800/80 tw-border-t tw-border-white/10">
                <div className="tw-flex tw-items-center tw-gap-1.5">
                  <span className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-white/50">⌘ + Enter to run</span>
                </div>
                <div className="tw-flex tw-items-center tw-gap-1.5">
                  <button onClick={() => setSql('')} className="tw-h-7 tw-px-2.5 tw-rounded-full tw-bg-white/10 hover:tw-bg-white/20 tw-text-white tw-text-[10.5px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition">Clear</button>
                  <button onClick={saveQuery} className="tw-h-7 tw-px-2.5 tw-rounded-full tw-bg-white/10 hover:tw-bg-white/20 tw-text-white tw-text-[10.5px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition">★ Save</button>
                  <button
                    onClick={run}
                    disabled={running || !sql.trim()}
                    className="tw-h-7 tw-px-3 tw-rounded-full tw-bg-emerald-500 hover:tw-bg-emerald-600 disabled:tw-opacity-40 tw-text-white tw-text-[10.5px] tw-font-extrabold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-95 tw-flex tw-items-center tw-gap-1"
                  >
                    {running ? <><span className="tw-w-2.5 tw-h-2.5 tw-border-2 tw-border-white/30 tw-border-t-white tw-rounded-full tw-animate-spin" /> Running</> : <>▶ Run</>}
                  </button>
                </div>
              </div>
            </div>

            {/* Results */}
            <div className="tw-flex-1 tw-flex tw-flex-col tw-overflow-hidden tw-bg-white">
              {error ? (
                <div className="tw-flex tw-items-start tw-gap-3 tw-m-4 tw-p-4 tw-rounded-2xl tw-bg-rose-50 tw-ring-1 tw-ring-rose-200">
                  <span className="tw-w-7 tw-h-7 tw-rounded-full tw-bg-rose-500 tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[13px] tw-font-bold tw-flex-shrink-0 tw-leading-none">!</span>
                  <div>
                    <div className="tw-text-[12px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-text-rose-700">Error</div>
                    <div className="tw-text-[13px] tw-font-semibold tw-text-rose-900 tw-font-mono tw-mt-0.5">{error}</div>
                  </div>
                </div>
              ) : results === null ? (
                <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-text-center tw-px-6">
                  <div className="tw-text-[48px] tw-mb-2">🗃️</div>
                  <div className="tw-text-[15px] tw-font-bold tw-text-oneui-ink tw-tracking-[-0.3px]">Ready to query</div>
                  <div className="tw-text-[12.5px] tw-text-oneui-mute tw-font-medium tw-mt-1 tw-max-w-[360px]">Type a SELECT query and press <kbd className="tw-inline-block tw-px-1.5 tw-py-0.5 tw-rounded tw-bg-black/[0.08] tw-text-[11px] tw-font-mono tw-font-bold">⌘+Enter</kbd>. Click a preset on the left to start.</div>
                </div>
              ) : (
                <>
                  <div className="tw-flex tw-items-center tw-justify-between tw-px-4 tw-py-2.5 tw-border-b tw-border-black/[0.06] tw-bg-emerald-50">
                    <div className="tw-text-[12px] tw-font-bold tw-text-emerald-800">
                      <span className="tw-text-[14px] tw-font-extrabold">{results.length}</span> row{results.length !== 1 ? 's' : ''} {elapsed != null && <span className="tw-text-emerald-700/70 tw-font-semibold tw-ml-1">· {elapsed}ms</span>}
                    </div>
                    <div className="tw-flex tw-items-center tw-gap-1.5">
                      <button onClick={copyJson} className="tw-h-7 tw-px-2.5 tw-rounded-full tw-bg-white tw-text-emerald-800 tw-text-[10.5px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-95 tw-shadow-sm">Copy JSON</button>
                      <button onClick={exportCsv} className="tw-h-7 tw-px-2.5 tw-rounded-full tw-bg-emerald-600 hover:tw-bg-emerald-700 tw-text-white tw-text-[10.5px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-95">Export CSV</button>
                    </div>
                  </div>
                  {results.length === 0 ? (
                    <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-text-center tw-px-6">
                      <div className="tw-text-[36px] tw-mb-2">🌫️</div>
                      <div className="tw-text-[14px] tw-font-bold tw-text-oneui-ink">No rows returned</div>
                      <div className="tw-text-[12px] tw-text-oneui-mute tw-font-medium tw-mt-1">Query ran successfully but matched zero records.</div>
                    </div>
                  ) : (
                    <div className="tw-flex-1 tw-overflow-auto">
                      <table className="tw-w-full tw-text-[12.5px] tw-font-sans tw-border-collapse">
                        <thead className="tw-sticky tw-top-0 tw-z-10 tw-bg-slate-100 tw-shadow-sm">
                          <tr>
                            {Object.keys(results[0]).map(c => (
                              <th key={c} className="tw-px-3 tw-py-2.5 tw-text-left tw-text-[10.5px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-text-slate-700 tw-border-b tw-border-slate-300 tw-whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {results.map((row, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'tw-bg-white' : 'tw-bg-slate-50/60'}>
                              {Object.keys(results[0]).map(c => {
                                const v = row[c];
                                const display = v === null ? <span className="tw-text-rose-400 tw-italic tw-font-medium">null</span>
                                  : typeof v === 'object' ? <span className="tw-text-violet-700 tw-font-mono">{JSON.stringify(v).slice(0, 80)}{JSON.stringify(v).length > 80 ? '…' : ''}</span>
                                  : typeof v === 'boolean' ? <span className={v ? 'tw-text-emerald-700 tw-font-bold' : 'tw-text-rose-700 tw-font-bold'}>{String(v)}</span>
                                  : <span className="tw-text-oneui-ink">{String(v)}</span>;
                                return <td key={c} className="tw-px-3 tw-py-2 tw-border-b tw-border-slate-100 tw-whitespace-nowrap tw-max-w-[280px] tw-truncate" title={typeof v === 'object' ? JSON.stringify(v) : String(v)}>{display}</td>;
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Parse simple SELECT · supports: SELECT col1, col2 [FROM table] [WHERE ...] [ORDER BY ...] [LIMIT N]
// Returns null if too complex (CTEs, JOINs, subqueries, aggregates).
function parseSimpleSelect(sql) {
  const s = sql.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  // Reject CTEs and JOINs
  if (/^\s*WITH\b/i.test(s)) return null;
  if (/\bJOIN\b/i.test(s)) return null;
  const m = s.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(.*)$/i);
  if (!m) return null;
  const [, selectPart, table, rest] = m;
  // Reject aggregates / functions in select unless it's just *
  const select = selectPart.trim();
  if (select !== '*' && /\b(COUNT|SUM|AVG|MIN|MAX|GROUP_CONCAT)\s*\(/i.test(select)) {
    // GROUP BY queries · special-case some presets
    return { table, select, rest, isAggregate: true };
  }
  return { table, select, rest, isAggregate: /\bGROUP\s+BY\b/i.test(rest) };
}

function buildRestUrl(base, parsed) {
  const url = new URL(`${base}/rest/v1/${parsed.table}`);
  // Select
  if (parsed.select === '*') url.searchParams.set('select', '*');
  else {
    // strip aggregate function names · Supabase REST doesn't run SQL aggregates
    const cols = parsed.select.split(',').map(c => c.trim().replace(/\s+AS\s+\w+/i, '').replace(/^[A-Z_]+\((.+?)\).*$/i, '$1')).filter(c => !/^\*$/.test(c));
    url.searchParams.set('select', cols.length ? cols.join(',') : '*');
  }
  // WHERE clause
  const whereMatch = parsed.rest.match(/WHERE\s+(.+?)(?=\s+ORDER\s+BY|\s+GROUP\s+BY|\s+LIMIT|$)/i);
  if (whereMatch) {
    parseWhereClause(whereMatch[1], url);
  }
  // ORDER BY
  const orderMatch = parsed.rest.match(/ORDER\s+BY\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(ASC|DESC)?(?:\s+NULLS\s+(FIRST|LAST))?/i);
  if (orderMatch) {
    const dir = (orderMatch[2] || 'asc').toLowerCase();
    const nulls = orderMatch[3] ? `.nulls${orderMatch[3].toLowerCase()}` : '';
    url.searchParams.set('order', `${orderMatch[1]}.${dir}${nulls}`);
  }
  // LIMIT
  const limitMatch = parsed.rest.match(/LIMIT\s+(\d+)/i);
  if (limitMatch) url.searchParams.set('limit', limitMatch[1]);
  return url.toString();
}

function parseWhereClause(where, url) {
  // Split on AND (top-level only · naive)
  const conds = where.split(/\s+AND\s+/i);
  for (const c of conds) {
    const cond = c.trim();
    let m;
    if ((m = cond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*'([^']*)'$/))) url.searchParams.append(m[1], `eq.${m[2]}`);
    else if ((m = cond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(\d+)$/))) url.searchParams.append(m[1], `eq.${m[2]}`);
    else if ((m = cond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*!=\s*'([^']*)'$/))) url.searchParams.append(m[1], `neq.${m[2]}`);
    else if ((m = cond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*<\s*'?([^']+?)'?$/))) url.searchParams.append(m[1], `lt.${m[2]}`);
    else if ((m = cond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*>\s*'?([^']+?)'?$/))) url.searchParams.append(m[1], `gt.${m[2]}`);
    else if ((m = cond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+IS\s+NULL$/i))) url.searchParams.append(m[1], 'is.null');
    else if ((m = cond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+IS\s+NOT\s+NULL$/i))) url.searchParams.append(m[1], 'not.is.null');
    else if ((m = cond.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+ILIKE\s+'([^']*)'$/i))) url.searchParams.append(m[1], `ilike.${m[2]}`);
  }
}

/* ─── ToastStackV2 · Tailwind iOS-style stacked slide-in ─── */
const TOAST_THEME = {
  add:     { ring: 'tw-ring-emerald-200', icon: 'tw-bg-emerald-500',  bar: 'tw-from-emerald-400 tw-to-emerald-600' },
  edit:    { ring: 'tw-ring-blue-200',    icon: 'tw-bg-blue-500',     bar: 'tw-from-blue-400 tw-to-blue-600' },
  delete:  { ring: 'tw-ring-rose-200',    icon: 'tw-bg-rose-500',     bar: 'tw-from-rose-400 tw-to-rose-600' },
  paid:    { ring: 'tw-ring-emerald-200', icon: 'tw-bg-emerald-500',  bar: 'tw-from-emerald-400 tw-to-emerald-600' },
  overdue: { ring: 'tw-ring-amber-200',   icon: 'tw-bg-amber-500',    bar: 'tw-from-amber-400 tw-to-amber-600' },
  backup:  { ring: 'tw-ring-sky-200',     icon: 'tw-bg-sky-500',      bar: 'tw-from-sky-400 tw-to-sky-600' },
  export:  { ring: 'tw-ring-indigo-200',  icon: 'tw-bg-indigo-500',   bar: 'tw-from-indigo-400 tw-to-indigo-600' },
  join:    { ring: 'tw-ring-violet-200',  icon: 'tw-bg-violet-500',   bar: 'tw-from-violet-400 tw-to-violet-600' },
  error:   { ring: 'tw-ring-rose-200',    icon: 'tw-bg-rose-600',     bar: 'tw-from-rose-500 tw-to-rose-700' },
  info:    { ring: 'tw-ring-slate-200',   icon: 'tw-bg-[#1259C3]',    bar: 'tw-from-[#1259C3] tw-to-[#0E4DAD]' },
};

function ToastStackV2({ stack, onDismiss, getIcon }) {
  return (
    <div className="tw-fixed tw-top-4 tw-right-4 tw-z-[2400] tw-flex tw-flex-col tw-gap-2.5 tw-pointer-events-none tw-w-[340px] tw-max-w-[calc(100vw-2rem)] tw-font-sans">
      {stack.map((t, i) => (
        <ToastCard key={t.id} toast={t} index={i} onDismiss={() => onDismiss(t.id)} getIcon={getIcon} />
      ))}
    </div>
  );
}

function ToastCard({ toast, index, onDismiss, getIcon }) {
  const theme = TOAST_THEME[toast.type] || TOAST_THEME.info;
  const [dragX, setDragX] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const startX = useRef(null);
  const cardRef = useRef(null);

  function onTouchStart(e) { startX.current = e.touches[0].clientX; }
  function onTouchMove(e) {
    if (startX.current == null) return;
    const dx = e.touches[0].clientX - startX.current;
    if (dx > 0) setDragX(dx);
  }
  function onTouchEnd() {
    if (dragX > 80) { setDismissing(true); setTimeout(onDismiss, 220); }
    else setDragX(0);
    startX.current = null;
  }

  const onMouseDown = (e) => { startX.current = e.clientX; };
  const onMouseMove = (e) => {
    if (startX.current == null) return;
    const dx = e.clientX - startX.current;
    if (dx > 0) setDragX(dx);
  };
  const onMouseUp = () => {
    if (dragX > 80) { setDismissing(true); setTimeout(onDismiss, 220); }
    else setDragX(0);
    startX.current = null;
  };

  return (
    <div
      ref={cardRef}
      className={`tw-pointer-events-auto tw-relative tw-bg-white tw-rounded-[20px] tw-shadow-oneui_lg tw-ring-1 ${theme.ring} tw-overflow-hidden tw-cursor-grab active:tw-cursor-grabbing tw-select-none`}
      style={{
        transform: `translateX(${dismissing ? 400 : dragX}px) scale(${1 - index * 0.025})`,
        opacity: dismissing ? 0 : 1 - index * 0.08,
        transition: dragX === 0 ? 'transform 0.3s cubic-bezier(0.33,1,0.68,1), opacity 0.22s' : 'opacity 0.22s',
        animation: index === 0 && dragX === 0 && !dismissing ? 'tst-in 0.36s cubic-bezier(0.33,1,0.68,1)' : undefined,
        zIndex: 100 - index,
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div className={`tw-absolute tw-left-0 tw-top-0 tw-bottom-0 tw-w-1 tw-bg-gradient-to-b ${theme.bar}`} />
      <div className="tw-flex tw-items-center tw-gap-3 tw-pl-4 tw-pr-3 tw-py-3">
        <div className={`tw-flex-shrink-0 tw-w-9 tw-h-9 tw-rounded-full ${theme.icon} tw-text-white tw-flex tw-items-center tw-justify-center tw-font-bold tw-text-[15px] tw-shadow-md`}>
          {getIcon(toast.type)}
        </div>
        <div className="tw-flex-1 tw-min-w-0">
          <div className="tw-text-[13.5px] tw-font-semibold tw-text-oneui-ink tw-leading-snug tw-tracking-[-0.2px]">{toast.message}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setDismissing(true); setTimeout(onDismiss, 220); }}
          className="tw-flex-shrink-0 tw-w-7 tw-h-7 tw-rounded-full tw-bg-black/[0.04] hover:tw-bg-black/[0.08] tw-text-oneui-mute hover:tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-text-[13px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition"
          aria-label="Dismiss"
        >✕</button>
      </div>
    </div>
  );
}

/* ─── NotifPanelV2 · Tailwind dropdown ─── */
function NotifPanelV2({ notifications, onClose, onClearAll, onDismissOne, getIcon, formatTime, soundsMuted, onToggleSounds }) {
  return (
    <div
      className="tw-fixed tw-z-[2300] tw-w-[380px] tw-max-w-[calc(100vw-1.5rem)] tw-bg-white tw-rounded-[24px] tw-shadow-oneui_lg tw-ring-1 tw-ring-black/5 tw-overflow-hidden tw-font-sans notif-panel"
      style={{ top: 64, right: 16, animation: 'np-in 0.26s cubic-bezier(0.33,1,0.68,1)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="tw-px-5 tw-pt-4 tw-pb-3 tw-flex tw-items-center tw-justify-between tw-gap-3 tw-border-b tw-border-black/[0.06]">
        <div>
          <div className="tw-text-[17px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.5px] tw-leading-tight">Notifications</div>
          <div className="tw-text-[11.5px] tw-font-semibold tw-text-oneui-mute tw-mt-0.5">
            {notifications.length === 0 ? 'You\'re all set' : `${notifications.length} unread`}
          </div>
        </div>
        <div className="tw-flex tw-items-center tw-gap-1.5">
          {onToggleSounds && (
            <button
              onClick={onToggleSounds}
              title={soundsMuted ? 'Unmute notification sounds' : 'Mute notification sounds'}
              className={`tw-w-8 tw-h-8 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-border-0 tw-cursor-pointer tw-transition ${soundsMuted ? 'tw-bg-rose-50 tw-text-rose-600' : 'tw-bg-emerald-50 tw-text-emerald-600'}`}
              aria-label={soundsMuted ? 'Unmute' : 'Mute'}
            >
              {soundsMuted ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              )}
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={onClearAll}
              className="tw-h-8 tw-px-3 tw-rounded-full tw-bg-[#1259C3] tw-text-white tw-text-[11.5px] tw-font-bold tw-border-0 tw-cursor-pointer hover:tw-bg-[#0E4DAD] active:tw-scale-95 tw-transition tw-shadow-oneui_blue tw-tracking-[-0.1px]"
            >Mark all read</button>
          )}
          <button
            onClick={onClose}
            className="tw-w-8 tw-h-8 tw-rounded-full tw-bg-black/[0.04] hover:tw-bg-black/[0.08] tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-text-[13px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition"
            aria-label="Close"
          >✕</button>
        </div>
      </div>
      <div className="tw-max-h-[60vh] tw-overflow-y-auto tw-overscroll-contain">
        {notifications.length === 0 ? (
          <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-14 tw-px-6 tw-text-center">
            <div className="tw-w-16 tw-h-16 tw-rounded-full tw-bg-gradient-to-br tw-from-emerald-400 tw-to-emerald-600 tw-flex tw-items-center tw-justify-center tw-text-white tw-text-[26px] tw-shadow-lg tw-mb-3">✓</div>
            <div className="tw-text-[15px] tw-font-bold tw-text-oneui-ink tw-tracking-[-0.3px]">All caught up</div>
            <div className="tw-text-[12.5px] tw-text-oneui-mute tw-font-medium tw-mt-1">No new notifications</div>
          </div>
        ) : (
          <div className="tw-py-2">
            {notifications.map(n => (
              <NotifItemV2 key={n.id} item={n} onDismiss={() => onDismissOne(n.id)} getIcon={getIcon} formatTime={formatTime} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotifItemV2({ item, onDismiss, getIcon, formatTime }) {
  const theme = TOAST_THEME[item.type] || TOAST_THEME.info;
  const [dragX, setDragX] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const startX = useRef(null);

  function onTouchStart(e) { startX.current = e.touches[0].clientX; }
  function onTouchMove(e) {
    if (startX.current == null) return;
    const dx = e.touches[0].clientX - startX.current;
    if (Math.abs(dx) > 0) setDragX(dx);
  }
  function onTouchEnd() {
    if (Math.abs(dragX) > 90) { setDismissing(true); setTimeout(onDismiss, 220); }
    else setDragX(0);
    startX.current = null;
  }

  return (
    <div
      className="tw-relative tw-overflow-hidden"
      style={{ height: dismissing ? 0 : undefined, opacity: dismissing ? 0 : 1, transition: 'height 0.2s, opacity 0.2s' }}
    >
      <div
        className="tw-flex tw-items-start tw-gap-3 tw-px-4 tw-py-3 tw-mx-2 tw-my-1 tw-rounded-2xl hover:tw-bg-black/[0.025] tw-transition tw-cursor-grab active:tw-cursor-grabbing tw-select-none"
        style={{
          transform: `translateX(${dragX}px)`,
          opacity: dismissing ? 0 : Math.max(0.3, 1 - Math.abs(dragX) / 250),
          transition: dragX === 0 ? 'transform 0.3s cubic-bezier(0.33,1,0.68,1), opacity 0.2s' : 'opacity 0.15s',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className={`tw-flex-shrink-0 tw-w-8 tw-h-8 tw-rounded-full ${theme.icon} tw-text-white tw-flex tw-items-center tw-justify-center tw-font-bold tw-text-[13px] tw-shadow-sm`}>
          {getIcon(item.type)}
        </div>
        <div className="tw-flex-1 tw-min-w-0">
          <div className="tw-text-[13px] tw-font-semibold tw-text-oneui-ink tw-leading-snug tw-tracking-[-0.2px]">{item.message}</div>
          <div className="tw-text-[10.5px] tw-font-medium tw-text-oneui-mute tw-mt-1 tw-uppercase tw-tracking-wider">{formatTime(item.time)}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setDismissing(true); setTimeout(onDismiss, 220); }}
          className="tw-flex-shrink-0 tw-w-6 tw-h-6 tw-rounded-full tw-bg-black/[0.05] hover:tw-bg-black/[0.1] tw-text-oneui-mute hover:tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-text-[11px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition tw-opacity-60 hover:tw-opacity-100"
          aria-label="Dismiss"
        >✕</button>
      </div>
    </div>
  );
}

/* ─── BrandSelector (APC only) ──────────────────────────── */
function BrandSelector({ allBrands, onSelect }) {
  const [selected, setSelected] = useState([]);
  const [query, setQuery]       = useState('');
  const [open, setOpen]         = useState(false);
  const inputRef                = useRef(null);
  const dropRef                 = useRef(null);

  const suggestions = allBrands.filter(b =>
    !selected.includes(b) && b.toLowerCase().includes(query.toLowerCase())
  );

  function pick(b) {
    setSelected(prev => [...prev, b]);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  }

  function remove(b) {
    setSelected(prev => prev.filter(x => x !== b));
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div className="login-root">
      <div className="login-bg-glow login-bg-1"/><div className="login-bg-glow login-bg-2"/>
      <div className="login-bg-glow login-bg-3"/><div className="login-bg-glow login-bg-4"/>
      <div className="login-card bsel-card">
        <div className="login-brand">
          <div className="login-brand-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          </div>
          <span className="login-brand-name">CREATOR HUB</span>
        </div>

        <h1 className="login-heading">Your Brands</h1>
        <p className="login-sub">Search and select up to <strong>3 brands</strong> you manage</p>

        {/* Selected pills */}
        {selected.length > 0 && (
          <div className="bsel-pills">
            {selected.map(b => (
              <span key={b} className="bsel-pill">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                {b}
                <button className="bsel-pill-x" onClick={() => remove(b)}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search input */}
        {selected.length < 3 && (
          <div className="bsel-search-wrap" ref={dropRef}>
            <div className="bsel-search-box">
              <svg className="bsel-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                ref={inputRef}
                className="bsel-search-input"
                placeholder={`Search brands… (${selected.length}/3 selected)`}
                value={query}
                onChange={e => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
              />
            </div>
            {open && suggestions.length > 0 && (
              <div className="bsel-dropdown">
                {suggestions.slice(0, 8).map(b => (
                  <button key={b} className="bsel-drop-item" onMouseDown={() => pick(b)}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                    {b}
                  </button>
                ))}
                {query && suggestions.length === 0 && (
                  <div className="bsel-drop-empty">No brands match "{query}"</div>
                )}
              </div>
            )}
          </div>
        )}

        <button className="login-btn" style={{ marginTop: 20 }}
          disabled={selected.length === 0} onClick={() => onSelect(selected)}>
          {selected.length === 0
            ? 'Select at least 1 brand'
            : `Enter Workspace (${selected.length}/3)`}
        </button>
      </div>
    </div>
  );
}

/* ─── DetailModalV2 · Tailwind + Samsung One UI premium ─── */
function DetailModalV2({ creator, onClose, onEdit, onDelete, onUpdate, perms = {} }) {
  const { handle, url } = parseTikTok(creator.tiktok_account);
  const gradient = getGradient(creator.name);
  const initial = creator.name ? creator.name[0].toUpperCase() : '?';
  const { videos: videoCount } = parseDeal(creator.deal);
  const { handle: handle2, url: url2 } = parseTikTok(creator.tiktok_account_2);

  // Video codes state
  const rowCount = Math.max(videoCount || 1, 1);
  const [showVideos, setShowVideos] = useState(false);
  const [videoCodes, setVideoCodes] = useState(() => {
    const existing = Array.isArray(creator.video_codes) ? creator.video_codes : [];
    return Array.from({ length: rowCount }, (_, i) => ({
      video: existing[i]?.video || '', adCode: existing[i]?.adCode || '',
    }));
  });
  const saveDebounceRef = useRef(null);
  const codesForBlurRef = useRef(videoCodes);
  useEffect(() => () => { if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current); }, []);

  // Mobile snap-point bottom sheet (iOS Maps style)
  // Sheet height = 92vh (top 8vh visible behind on full); bottom-anchored.
  // translateY pushes sheet down so less is visible: 0=full, mid=half, large=peek.
  const modalRef = useRef(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768);
  const [snap, setSnap] = useState('full'); // peek | half | full · open at full so it feels normal
  const dragStartY = useRef(null);
  const dragStartSnap = useRef(null);
  const dragOffset = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Sheet height in CSS units used as 92vh. Returns translateY in PIXELS.
  function getSnapTranslate(s) {
    if (typeof window === 'undefined') return 0;
    const vh = window.innerHeight;
    const sheetH = vh * 0.92;
    if (s === 'full') return 0;
    if (s === 'half') return Math.max(0, sheetH - vh * 0.5);
    return Math.max(0, sheetH - 180); // peek = 180px visible
  }

  function applyTransform(ty, withTransition) {
    if (!modalRef.current) return;
    modalRef.current.style.transform = `translateY(${ty}px)`;
    modalRef.current.style.transition = withTransition ? 'transform 0.42s cubic-bezier(0.33, 1, 0.68, 1)' : 'none';
  }

  function onTouchStart(e) {
    if (!isMobile) return;
    const t = e.target;
    const isHandle = t.closest && (t.closest('[data-sheet-handle]') || t.closest('[data-sheet-hero]'));
    // Find the inner scrollable body (data-sheet-scroll). If at top, allow drag.
    const scrollEl = modalRef.current?.querySelector('[data-sheet-scroll]');
    const atTop = !scrollEl || scrollEl.scrollTop <= 1;
    if (!isHandle && !atTop) return;
    dragStartY.current = e.touches[0].clientY;
    dragStartSnap.current = snap;
    dragOffset.current = 0;
    setIsDragging(true);
  }
  function onTouchMove(e) {
    if (dragStartY.current === null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    dragOffset.current = dy;
    const base = getSnapTranslate(dragStartSnap.current);
    // clamp so user can't drag past full (no negative) or past peek too far
    const next = Math.min(Math.max(0, base + dy), window.innerHeight);
    applyTransform(next, false);
  }
  function onTouchEnd() {
    if (dragStartY.current === null) return;
    setIsDragging(false);
    const dy = dragOffset.current;
    const startSnap = dragStartSnap.current;
    dragStartY.current = null;
    dragStartSnap.current = null;
    let nextSnap = startSnap;
    if (dy > 90) {
      if (startSnap === 'full') nextSnap = 'half';
      else if (startSnap === 'half') nextSnap = 'peek';
      else { onClose(); return; }
    } else if (dy < -90) {
      if (startSnap === 'peek') nextSnap = 'half';
      else if (startSnap === 'half') nextSnap = 'full';
    }
    setSnap(nextSnap);
    applyTransform(getSnapTranslate(nextSnap), true);
  }

  useEffect(() => {
    if (!isMobile || !modalRef.current) {
      if (modalRef.current) {
        modalRef.current.style.transform = '';
        modalRef.current.style.transition = '';
      }
      return;
    }
    applyTransform(getSnapTranslate(snap), true);
  }, [snap, isMobile]);

  function getAutoVideoStatus(codes) {
    const filled = codes.filter(v => v?.video).length;
    if (filled === 0) return null;
    if (filled >= codes.length) return 'Done';
    return 'In Progress';
  }
  async function persistVideoPatch(codes) {
    const autoStatus = getAutoVideoStatus(codes);
    const patch = { video_codes: codes, ...(autoStatus ? { videos: autoStatus } : {}) };
    if (onUpdate) onUpdate(creator.id, patch); // optimistic local update
    const { error } = await supabase.from('creators').update(patch).eq('id', creator.id);
    if (error) {
      console.error('video_codes save failed:', error);
      // Surface error so user knows the save didn't stick
      try { window.alert(`Couldn't save videos: ${error.message}`); } catch {}
    }
    return { error };
  }
  function updateField(idx, field, value) {
    setVideoCodes(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      codesForBlurRef.current = next;
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = setTimeout(() => persistVideoPatch(next), 600);
      return next;
    });
  }
  async function persistCodesNow() {
    const codes = codesForBlurRef.current;
    if (saveDebounceRef.current) { clearTimeout(saveDebounceRef.current); saveDebounceRef.current = null; }
    return persistVideoPatch(codes);
  }
  const isValidUrl = s => !!s && (s.startsWith('http://') || s.startsWith('https://'));
  const isValidAdCode = s => !s || (s.startsWith('#') && s.endsWith('='));

  // Compute deal info
  const { amount: dealAmount } = parseDeal(creator.deal);
  const isPaid = creator.payment_status === 'Paid';
  const isUnpaid = creator.payment_status === 'Not Yet';

  // Deadline meta
  let deadlineMeta = null;
  if (creator.deadline) {
    const today = shopMidnight();
    const dl = new Date(creator.deadline); dl.setHours(0,0,0,0);
    const days = Math.round((dl - today) / 86400000);
    if (days < 0) deadlineMeta = { txt: `Overdue ${Math.abs(days)}d`, tone: 'tw-text-rose-600' };
    else if (days === 0) deadlineMeta = { txt: 'Due today', tone: 'tw-text-amber-600' };
    else if (days <= 7) deadlineMeta = { txt: `${days}d left`, tone: 'tw-text-amber-600' };
    else deadlineMeta = { txt: `${days}d left`, tone: 'tw-text-emerald-600' };
  }

  const contactFields = [
    creator.whatsapp_number && { l: 'WhatsApp', v: creator.whatsapp_number, href: `https://wa.me/${String(creator.whatsapp_number).replace(/\D/g,'')}`, color: 'tw-bg-emerald-50 tw-text-emerald-700' },
    creator.email && { l: 'Email', v: creator.email, href: `mailto:${creator.email}`, color: 'tw-bg-blue-50 tw-text-blue-700' },
    creator.paypal && { l: 'PayPal', v: creator.paypal, color: 'tw-bg-indigo-50 tw-text-indigo-700' },
    creator.zelle && { l: 'Zelle', v: creator.zelle, color: 'tw-bg-purple-50 tw-text-purple-700' },
  ].filter(Boolean);

  const moreRows = [
    creator.product && { l: 'Product', v: creator.product },
    creator.category && { l: 'Category', v: creator.category },
    deadlineMeta && { l: 'Deadline', v: deadlineMeta.txt, vClass: deadlineMeta.tone + ' tw-font-bold' },
  ].filter(Boolean);

  return (
    <div className={`tw-fixed tw-inset-0 tw-z-[1000] tw-bg-black/40 tw-backdrop-blur-md tw-flex tw-justify-center tw-font-sans ${isMobile ? 'tw-items-end tw-p-0' : 'tw-items-center tw-p-4 sm:tw-p-6'}`}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={modalRef}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        className={`tw-relative tw-bg-[#F4F5F7] tw-shadow-oneui_lg tw-flex tw-flex-col ${isMobile ? 'tw-w-full tw-rounded-t-[28px] tw-overflow-hidden' : 'tw-w-full tw-max-w-[500px] tw-max-h-[88vh] tw-rounded-[32px] tw-overflow-hidden'}`}
        style={isMobile
          ? { height: '92vh', willChange: 'transform', transform: `translateY(${getSnapTranslate(snap)}px)`, transition: isDragging ? 'none' : 'transform 0.42s cubic-bezier(0.33,1,0.68,1)', animation: 'ndm-up 0.36s cubic-bezier(0.33,1,0.68,1)' }
          : { animation: 'sp-pop 0.32s cubic-bezier(0.33,1,0.68,1)' }}>
        {/* Mobile drag handle */}
        {isMobile && (
          <div data-sheet-handle onClick={() => setSnap(s => s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek')}
            className="tw-sticky tw-top-0 tw-z-20 tw-flex tw-justify-center tw-py-2.5 tw-bg-[#F4F5F7] tw-cursor-grab active:tw-cursor-grabbing tw-flex-shrink-0">
            <div className="tw-w-10 tw-h-1 tw-rounded-full tw-bg-black/20" />
          </div>
        )}

        {/* HERO · premium magazine-cover redesign */}
        <div data-sheet-hero className="tw-relative tw-overflow-hidden" style={{ background: gradient, height: 200 }}>
          {/* Atmospheric multi-layer overlays */}
          <div className="tw-absolute tw-inset-0 tw-pointer-events-none" style={{
            background: 'radial-gradient(ellipse 80% 90% at 85% 10%, color-mix(in srgb, var(--wx-surface-1) 38%, transparent), transparent 55%), radial-gradient(ellipse 80% 90% at 15% 95%, color-mix(in srgb, var(--wx-accent) 42%, transparent), transparent 60%)'
          }} />
          {/* Diagonal sheen */}
          <div className="tw-absolute tw-inset-0 tw-pointer-events-none tw-opacity-20" style={{
            background: 'linear-gradient(135deg, transparent 30%, color-mix(in srgb, var(--wx-surface-1) 18%, transparent) 50%, transparent 70%)'
          }} />
          {/* Soft mesh */}
          <div className="tw-absolute tw-inset-0 tw-pointer-events-none tw-opacity-25" style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.55) 1px, transparent 0)',
            backgroundSize: '20px 20px'
          }} />
          {/* Bottom fade so name area is darker for contrast */}
          <div className="tw-absolute tw-inset-x-0 tw-bottom-0 tw-h-[55%] tw-pointer-events-none" style={{ background: 'linear-gradient(180deg, transparent, color-mix(in srgb, var(--wx-accent) 55%, transparent))' }} />

          {/* Top bar: hire date pill + close */}
          <div className="tw-relative tw-z-10 tw-flex tw-items-start tw-justify-between tw-gap-2 tw-px-5 tw-pt-4">
            {creator.hiring_date ? (
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-h-7 tw-px-2.5 tw-rounded-full tw-bg-white/18 tw-backdrop-blur-md tw-ring-1 tw-ring-white/25 tw-text-white tw-text-[11px] tw-font-bold tw-tracking-wide">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Hired {formatDate(creator.hiring_date)}
              </div>
            ) : <div />}
            <div className="tw-flex tw-items-center tw-gap-1.5">
              {creator.brand && (
                <div className="tw-inline-flex tw-items-center tw-h-7 tw-px-3 tw-rounded-full tw-bg-white tw-text-oneui-ink tw-text-[10.5px] tw-font-extrabold tw-tracking-wider tw-uppercase tw-shadow-md">
                  {creator.brand}
                </div>
              )}
              <button onClick={onClose} title="Close" className="tw-w-7 tw-h-7 tw-rounded-full tw-bg-white/18 tw-backdrop-blur-md tw-ring-1 tw-ring-white/25 tw-text-white tw-flex tw-items-center tw-justify-center tw-cursor-pointer hover:tw-bg-white/95 hover:tw-text-oneui-ink active:tw-scale-95 tw-transition tw-duration-200 tw-border-0 tw-leading-none">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          {/* Identity block · avatar + name pinned to bottom of hero */}
          <div className="tw-absolute tw-bottom-0 tw-left-0 tw-right-0 tw-z-10 tw-px-5 tw-pb-4 tw-flex tw-items-end tw-gap-3">
            <div className="tw-relative tw-shrink-0">
              <div className="tw-w-[78px] tw-h-[78px] tw-rounded-full tw-bg-white tw-p-[3px] tw-shadow-2xl">
                <div className="tw-w-full tw-h-full tw-rounded-full tw-flex tw-items-center tw-justify-center tw-text-[30px] tw-font-extrabold tw-text-white" style={{ background: gradient, letterSpacing: '-0.5px' }}>
                  {initial}
                </div>
              </div>
              <span className={`tw-absolute tw-bottom-0.5 tw-right-0.5 tw-w-4 tw-h-4 tw-rounded-full tw-ring-[3px] tw-ring-white ${isPaid ? 'tw-bg-emerald-500' : creator.videos === 'In Progress' ? 'tw-bg-amber-500' : 'tw-bg-slate-400'}`} />
            </div>
            <div className="tw-flex-1 tw-min-w-0 tw-pb-1">
              <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-white tw-text-[22px] tw-font-extrabold tw-tracking-[-0.5px] tw-leading-tight" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.35)' }}>
                <span className="tw-truncate">{creator.name}</span>
                {creator.tiktok_account && (
                  <span className="tw-shrink-0" title="Verified TikTok creator">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path fill="#3B82F6" d="M12 2l2.4 1.8 3 .1 1.1 2.8 2.6 1.5-.5 3 1.5 2.6-2.1 2.1.1 3-2.8 1.1-1.8 2.4-3-.5-3 .5-1.8-2.4-2.8-1.1.1-3L1 13.2 2.5 10.6 2 7.6l2.6-1.5 1.1-2.8 3-.1z"/><path d="M8.5 12.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>
                )}
              </div>
              <div className="tw-flex tw-flex-wrap tw-gap-x-2.5 tw-gap-y-0 tw-mt-0.5 tw-text-[12.5px] tw-font-semibold tw-text-white/85" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.35)' }}>
                {handle && <span className="tw-truncate">{handle}</span>}
                {handle2 && (
                  <a href={url2} target="_blank" rel="noopener noreferrer" className="tw-no-underline tw-text-white/70 hover:tw-text-white tw-truncate">{handle2}</a>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Spacer between hero and body · no avatar overlap mode */}
        <div className="tw-h-3 tw-bg-[#F4F5F7]" />

        {/* BODY */}
        <div data-sheet-scroll className="tw-flex-1 tw-overflow-y-auto tw-px-5 tw-pt-2 tw-pb-2">
          {/* Quick actions · slim pill row */}
          {(() => {
            const items = [
              creator.whatsapp_number && { icon: 'wa',   l: 'Message',  cls: 'tw-bg-emerald-50 tw-text-emerald-700 hover:tw-bg-emerald-100',   href: `https://wa.me/${String(creator.whatsapp_number).replace(/\D/g,'')}` },
              creator.email           && { icon: 'mail', l: 'Email',    cls: 'tw-bg-blue-50 tw-text-blue-700 hover:tw-bg-blue-100',           href: `mailto:${creator.email}` },
              creator.tiktok_account  && { icon: 'tt',  l: 'TikTok',   cls: 'tw-bg-rose-50 tw-text-rose-700 hover:tw-bg-rose-100',           href: url },
              handle2 && url2         && { icon: 'tt',  l: 'TikTok 2', cls: 'tw-bg-fuchsia-50 tw-text-fuchsia-700 hover:tw-bg-fuchsia-100', href: url2 },
            ].filter(Boolean);
            if (items.length === 0) return null;
            return (
              <div className="tw-flex tw-flex-wrap tw-gap-1.5 tw-mb-3">
                {items.map((a, i) => (
                  <a key={i} href={a.href} target="_blank" rel="noopener noreferrer"
                    className={`tw-inline-flex tw-items-center tw-gap-1.5 tw-h-8 tw-px-3 tw-rounded-full tw-text-[12px] tw-font-bold tw-tracking-[-0.1px] tw-no-underline tw-cursor-pointer active:tw-scale-95 tw-transition tw-duration-200 tw-ease-oneui ${a.cls}`}>
                    {a.icon === 'wa' && <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-1 1.2-.3.2-.6.1c-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5l-.6 0c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.4M12 21.8a9.9 9.9 0 0 1-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4a9.9 9.9 0 0 1-1.5-5.3c0-5.5 4.4-9.9 9.9-9.9 2.6 0 5.1 1 6.9 2.9a9.8 9.8 0 0 1 2.9 7c0 5.4-4.4 9.9-9.9 9.9"/></svg>}
                    {a.icon === 'mail' && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>}
                    {a.icon === 'tt' && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>}
                    {a.l}
                  </a>
                ))}
              </div>
            );
          })()}

          {/* Hero stat · Deal Amount */}
          {(creator.deal || creator.payment_status) && (
            <div className={`tw-relative tw-overflow-hidden tw-rounded-[24px] tw-mb-3 tw-p-5 ${isPaid ? 'tw-bg-gradient-to-br tw-from-emerald-50 tw-to-emerald-100' : isUnpaid ? 'tw-bg-gradient-to-br tw-from-rose-50 tw-to-rose-100' : 'tw-bg-gradient-to-br tw-from-blue-50 tw-to-blue-100'}`}>
              <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
                <div>
                  <div className={`tw-text-[10.5px] tw-font-extrabold tw-uppercase tw-tracking-[1.4px] tw-mb-1 ${isPaid ? 'tw-text-emerald-700' : isUnpaid ? 'tw-text-rose-700' : 'tw-text-blue-700'}`}>
                    {isPaid ? 'Paid' : isUnpaid ? 'Outstanding' : 'Deal Value'}
                  </div>
                  <div className="tw-text-[32px] tw-font-extrabold tw-text-oneui-ink tw-tabular-nums tw-leading-none tw-tracking-[-1px]">
                    {creator.deal || '-'}
                  </div>
                  {videoCount > 0 && (
                    <div className={`tw-mt-2 tw-text-[11.5px] tw-font-semibold ${isPaid ? 'tw-text-emerald-700' : isUnpaid ? 'tw-text-rose-700' : 'tw-text-blue-700'}`}>
                      {videoCount} video{videoCount !== 1 ? 's' : ''} · {videoCodes.filter(v => v.video || v.adCode).length}/{rowCount} filled
                    </div>
                  )}
                </div>
                <div className={`tw-w-12 tw-h-12 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-shrink-0 tw-shadow-md ${isPaid ? 'tw-bg-emerald-600 tw-text-white' : isUnpaid ? 'tw-bg-rose-600 tw-text-white' : 'tw-bg-blue-600 tw-text-white'}`}>
                  {isPaid ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  ) : isUnpaid ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Performance pills · clean, no leading icons, ROAS smaller */}
          {(() => {
            const gmv = parseFloat(creator.gmv) || 0;
            const adSpent = parseFloat(creator.ad_spent) || 0;
            const totalGmv = parseFloat(creator.total_gmv) || 0;
            const roas = adSpent > 0 ? gmv / adSpent : null;
            const roasGood = roas != null && roas >= 1;
            if (gmv === 0 && adSpent === 0 && totalGmv === 0) return null;
            return (
              <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5 tw-mb-3">
                {gmv > 0 && (
                  <span className="tw-inline-flex tw-items-center tw-h-8 tw-px-3.5 tw-rounded-full tw-bg-emerald-600 tw-text-white tw-text-[12.5px] tw-font-extrabold tw-tabular-nums tw-tracking-[-0.2px] tw-shadow-[0_4px_14px_rgba(5,150,105,0.32)]">
                    GMV <span className="tw-mx-1.5 tw-h-3 tw-w-px tw-bg-white/30" />${gmv.toLocaleString()}
                  </span>
                )}
                {adSpent > 0 && (
                  <span className="tw-inline-flex tw-items-center tw-h-8 tw-px-3.5 tw-rounded-full tw-bg-rose-600 tw-text-white tw-text-[12.5px] tw-font-extrabold tw-tabular-nums tw-tracking-[-0.2px] tw-shadow-[0_4px_14px_rgba(225,29,72,0.32)]">
                    Ad Spent <span className="tw-mx-1.5 tw-h-3 tw-w-px tw-bg-white/30" />${adSpent.toLocaleString()}
                  </span>
                )}
                {roas != null && (
                  <span className={`tw-inline-flex tw-items-center tw-h-6 tw-px-2 tw-rounded-full tw-text-[10.5px] tw-font-extrabold tw-tabular-nums tw-tracking-[-0.1px] ${roasGood ? 'tw-bg-emerald-50 tw-text-emerald-700 tw-ring-1 tw-ring-emerald-200' : 'tw-bg-rose-50 tw-text-rose-700 tw-ring-1 tw-ring-rose-200'}`}>
                    {roas.toFixed(2)}×
                  </span>
                )}
                {totalGmv > 0 && (
                  <span className="tw-inline-flex tw-items-center tw-h-8 tw-px-3.5 tw-rounded-full tw-bg-gradient-to-r tw-from-blue-600 tw-via-indigo-600 tw-to-violet-700 tw-text-white tw-text-[12.5px] tw-font-extrabold tw-tabular-nums tw-tracking-[-0.2px] tw-shadow-[0_4px_14px_rgba(79,70,229,0.32)]">
                    Brand Total <span className="tw-mx-1.5 tw-h-3 tw-w-px tw-bg-white/30" />${totalGmv.toLocaleString()}
                  </span>
                )}
              </div>
            );
          })()}

          {/* 2x2 mini stats grid */}
          <div className="tw-grid tw-grid-cols-2 tw-gap-2 tw-mb-3">
            {creator.hired_by && perms.canSeeHiredBy !== false && (
              <div className="tw-bg-white tw-rounded-[16px] tw-shadow-oneui tw-p-3.5">
                <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mb-1">Hired By</div>
                <div className="tw-text-[14px] tw-font-extrabold tw-text-oneui-ink tw-truncate">{creator.hired_by}</div>
              </div>
            )}
            {creator.category && (
              <div className="tw-bg-white tw-rounded-[16px] tw-shadow-oneui tw-p-3.5">
                <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mb-1">Category</div>
                <div className="tw-text-[14px] tw-font-extrabold tw-text-oneui-ink tw-truncate">{creator.category}</div>
              </div>
            )}
            {creator.product && (
              <div className="tw-bg-white tw-rounded-[16px] tw-shadow-oneui tw-p-3.5">
                <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mb-1">Product</div>
                <div className="tw-text-[14px] tw-font-extrabold tw-text-oneui-ink tw-truncate">{creator.product}</div>
              </div>
            )}
            {deadlineMeta && (
              <div className="tw-bg-white tw-rounded-[16px] tw-shadow-oneui tw-p-3.5">
                <div className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-mb-1">Deadline</div>
                <div className={`tw-text-[14px] tw-font-extrabold tw-truncate ${deadlineMeta.tone}`}>{deadlineMeta.txt}</div>
              </div>
            )}
          </div>

          {/* Contact section removed per user request · quick action pills above provide messaging shortcuts */}

          {/* Notes */}
          {creator.comments && (
            <div className="tw-mb-3">
              <div className="tw-text-[11px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-px-2 tw-mb-1.5">Notes</div>
              <div className="tw-bg-white tw-rounded-[18px] tw-shadow-oneui tw-px-4 tw-py-3.5 tw-text-[13.5px] tw-font-medium tw-text-oneui-ink2 tw-leading-relaxed">
                {creator.comments}
              </div>
            </div>
          )}

          {/* Videos & Ad Codes button */}
          <button onClick={() => setShowVideos(true)}
            className="tw-w-full tw-flex tw-items-center tw-justify-between tw-px-4 tw-py-4 tw-bg-white tw-rounded-[18px] tw-shadow-oneui tw-border-0 tw-cursor-pointer hover:tw-bg-gradient-to-br hover:tw-from-[#1259C3] hover:tw-to-[#0E4DAD] hover:tw-text-white active:tw-scale-[0.99] tw-transition tw-duration-200 tw-ease-oneui tw-group">
            <div className="tw-flex tw-items-center tw-gap-2.5 tw-text-[13px] tw-font-bold tw-text-oneui-ink group-hover:tw-text-white tw-uppercase tw-tracking-wider">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
              Videos &amp; Ad Codes
              <span className="tw-h-[22px] tw-px-2.5 tw-rounded-full tw-bg-black/[0.06] group-hover:tw-bg-white/25 tw-text-[11px] tw-font-extrabold tw-flex tw-items-center tw-tabular-nums tw-tracking-normal tw-normal-case">
                {videoCodes.filter(v => v.video || v.adCode).length}/{rowCount}
              </span>
            </div>
            <svg className="tw-w-3.5 tw-h-3.5 tw-text-oneui-mute group-hover:tw-text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        {/* FOOTER */}
        <div className="tw-flex tw-gap-2 tw-px-5 tw-py-4 tw-bg-white tw-border-t tw-border-black/[0.05]">
          {(perms.canDelete || perms.deleteBlocked) && (
            <button onClick={onDelete}
              className="tw-h-12 tw-px-5 tw-rounded-[16px] tw-bg-rose-50 tw-text-rose-700 tw-text-[13.5px] tw-font-bold tw-tracking-[-0.1px] tw-flex tw-items-center tw-gap-1.5 tw-border-0 tw-cursor-pointer hover:tw-bg-rose-600 hover:tw-text-white active:tw-scale-95 tw-transition tw-duration-200 tw-ease-oneui">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
              Delete
            </button>
          )}
          {perms.canEdit !== false && (
            <button onClick={onEdit}
              className="tw-flex-1 tw-h-12 tw-rounded-[16px] tw-bg-gradient-to-br tw-from-[#1259C3] tw-to-[#0E4DAD] tw-text-white tw-text-[14px] tw-font-bold tw-tracking-[-0.2px] tw-flex tw-items-center tw-justify-center tw-gap-2 tw-border-0 tw-cursor-pointer tw-shadow-oneui_blue hover:tw-shadow-oneui_bluemax hover:-tw-translate-y-0.5 active:tw-scale-[0.97] tw-transition tw-duration-200 tw-ease-oneui">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit Creator
            </button>
          )}
        </div>

        {/* Videos modal */}
        {showVideos && (
          <VideosModal
            creator={creator}
            videoCodes={videoCodes}
            rowCount={rowCount}
            canEdit={perms.canEditVideos}
            onChange={(idx, field, value) => updateField(idx, field, value)}
            onBulkSet={(nextCodes) => {
              setVideoCodes(nextCodes);
              codesForBlurRef.current = nextCodes;
              const autoStatus = getAutoVideoStatus(nextCodes);
              const patch = { video_codes: nextCodes, ...(autoStatus ? { videos: autoStatus } : {}) };
              supabase.from('creators').update(patch).eq('id', creator.id);
              if (onUpdate) onUpdate(creator.id, patch);
            }}
            onPersist={persistCodesNow}
            onClose={() => setShowVideos(false)}
            isValidUrl={isValidUrl}
            isValidAdCode={isValidAdCode}
          />
        )}
      </div>
    </div>
  );
}

/* ─── DetailModal (legacy) ────────────────────────────────────────── */
function DetailModal({ creator, onClose, onEdit, onDelete, onUpdate, perms = {} }) {
  const { handle, url } = parseTikTok(creator.tiktok_account);
  const gradient = getGradient(creator.name);
  const initial = creator.name ? creator.name[0].toUpperCase() : '?';

  /* ── Video codes panel ── */
  const { videos: videoCount } = parseDeal(creator.deal);
  const rowCount = Math.max(videoCount || 1, 1);

  const [showVideos, setShowVideos] = useState(false);
  const [videoCodes, setVideoCodes] = useState(() => {
    const existing = Array.isArray(creator.video_codes) ? creator.video_codes : [];
    return Array.from({ length: rowCount }, (_, i) => ({
      video: existing[i]?.video || '',
      adCode: existing[i]?.adCode || '',
    }));
  });
  const saveDebounceRef = useRef(null);
  const codesForBlurRef = useRef(videoCodes);
  useEffect(() => () => { if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current); }, []);

  /* ── Swipe to close (mobile bottom sheet) ── */
  const modalRef = useRef(null);
  const touchStartY = useRef(null);
  function onTouchStart(e) {
    if (window.innerWidth > 768) return;
    touchStartY.current = e.touches[0].clientY;
  }
  function onTouchMove(e) {
    if (touchStartY.current === null || !modalRef.current) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) {
      modalRef.current.style.transform = `translateY(${Math.min(dy, 280)}px)`;
      modalRef.current.style.transition = 'none';
      modalRef.current.style.opacity = String(Math.max(1 - dy / 300, 0.4));
    }
  }
  function onTouchEnd(e) {
    if (touchStartY.current === null) return;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;
    if (!modalRef.current) return;
    if (dy > 90) { onClose(); return; }
    modalRef.current.style.transform = '';
    modalRef.current.style.transition = '';
    modalRef.current.style.opacity = '';
  }

  function getAutoVideoStatus(codes) {
    const filled = codes.filter(v => v?.video).length;
    if (filled === 0) return null; // no change
    if (filled >= codes.length) return 'Done';
    return 'In Progress';
  }

  async function persistVideoPatch(codes) {
    const autoStatus = getAutoVideoStatus(codes);
    const patch = { video_codes: codes, ...(autoStatus ? { videos: autoStatus } : {}) };
    if (onUpdate) onUpdate(creator.id, patch);
    const { error } = await supabase.from('creators').update(patch).eq('id', creator.id);
    if (error) {
      console.error('video_codes save failed:', error);
      try { window.alert(`Couldn't save videos: ${error.message}`); } catch {}
    }
    return { error };
  }

  function updateField(idx, field, value) {
    setVideoCodes(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      codesForBlurRef.current = next;
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = setTimeout(() => persistVideoPatch(next), 600);
      return next;
    });
  }

  async function persistCodesNow() {
    const codes = codesForBlurRef.current;
    if (saveDebounceRef.current) { clearTimeout(saveDebounceRef.current); saveDebounceRef.current = null; }
    return persistVideoPatch(codes);
  }

  function isValidUrl(str) {
    try { return !!str && (str.startsWith('http://') || str.startsWith('https://')); }
    catch { return false; }
  }

  function isValidAdCode(str) {
    return !str || (str.startsWith('#') && str.endsWith('='));
  }

  const contactFields = [
    { l: 'WhatsApp', v: creator.whatsapp_number },
    { l: 'Email',    v: creator.email },
    { l: 'PayPal',   v: creator.paypal },
    { l: 'Zelle',    v: creator.zelle },
  ].filter(f => f.v);

  const dealFields = [
    { l: 'Product',  v: creator.product },
    { l: 'Category', v: creator.category },
  ].filter(f => f.v);

  // Deadline urgency calculation
  let deadlineMeta = null;
  if (creator.deadline) {
    const today = shopMidnight();
    const dl = new Date(creator.deadline); dl.setHours(0,0,0,0);
    const days = Math.round((dl - today) / 86400000);
    if (days < 0) deadlineMeta = { txt: `Overdue ${Math.abs(days)}d`, tone: 'overdue' };
    else if (days === 0) deadlineMeta = { txt: 'Due today', tone: 'today' };
    else if (days <= 7) deadlineMeta = { txt: `${days}d left`, tone: 'soon' };
    else deadlineMeta = { txt: `${days}d left`, tone: 'ok' };
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ndm" ref={modalRef} style={{ '--ndm-grad': gradient }} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div className="ndm-drag-handle" />

        {/* ══ HERO BANNER · full identity inside ══ */}
        <div className="ndm-hero" style={{ background: gradient }}>
          <div className="ndm-hero-top">
            {creator.hiring_date && (
              <div className="ndm-hero-meta">Hired {formatDate(creator.hiring_date)}</div>
            )}
            <div className="ndm-hero-actions">
              {creator.tiktok_account && (
                <a href={url} target="_blank" rel="noopener noreferrer" className="ndm-hero-btn" title="Open TikTok">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              )}
              {perms.canEdit !== false && (
                <button className="ndm-hero-btn" onClick={onEdit} title="Edit">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
              )}
              <button className="ndm-hero-btn ndm-hero-close" onClick={onClose} title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
          <div className="ndm-hero-bottom">
            <div className="ndm-hero-av-wrap">
              <div className="ndm-hero-av">{initial}</div>
              <span className={`ndm-hero-dot${creator.payment_status === 'Paid' ? ' paid' : creator.videos === 'In Progress' ? ' active' : ''}`} />
            </div>
            <div className="ndm-hero-ident">
              <div className="ndm-hero-name">
                {creator.name}
                {creator.tiktok_account && (
                  <span className="ndm-verified" title="TikTok verified">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path fill="#4F6FFF" d="M12 2l2.4 1.8 3 .1 1.1 2.8 2.6 1.5-.5 3 1.5 2.6-2.1 2.1.1 3-2.8 1.1-1.8 2.4-3-.5-3 .5-1.8-2.4-2.8-1.1.1-3L1 13.2 2.5 10.6 2 7.6l2.6-1.5 1.1-2.8 3-.1z"/><path d="M8.5 12.5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>
                )}
              </div>
              {handle && <div className="ndm-hero-handle">{handle}</div>}
            </div>
          </div>
        </div>

        {/* ══ ACTION PILLS ══ */}
        <div className="ndm-actpills">
          {creator.whatsapp_number && (
            <a href={`https://wa.me/${String(creator.whatsapp_number).replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer" className="ndm-actpill">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884"/></svg>
              Message
            </a>
          )}
          {creator.email && (
            <a href={`mailto:${creator.email}`} className="ndm-actpill">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              Email
            </a>
          )}
          {creator.brand && (
            <span className="ndm-actpill ndm-actpill-info">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              {creator.brand}
            </span>
          )}
          {perms.canSeeHiredBy !== false && creator.hired_by && (
            <span className="ndm-actpill ndm-actpill-info">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              {creator.hired_by}
            </span>
          )}
        </div>

        {/* ══ SUBSCRIPTION-STYLE STATUS CARD ══ */}
        {(creator.payment_status || creator.deal) && (
          <div className={`ndm-subcard ndm-subcard-${creator.payment_status === 'Paid' ? 'paid' : creator.payment_status === 'Not Yet' ? 'unpaid' : 'neutral'}`}>
            <span className="ndm-subcard-check">
              {creator.payment_status === 'Paid' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              ) : creator.payment_status === 'Not Yet' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10"/></svg>
              )}
            </span>
            <span className="ndm-subcard-label">
              {creator.payment_status === 'Paid' ? 'PAID' : creator.payment_status === 'Not Yet' ? 'NOT YET' : 'DEAL'}
            </span>
            {creator.deal && <span className="ndm-subcard-value">{creator.deal}</span>}
          </div>
        )}

        {/* ══ ADDITIONAL DETAILS · collapsible ══ */}
        {(dealFields.length > 0 || creator.deadline || creator.videos) && (
          <details className="ndm-more">
            <summary className="ndm-more-tog">
              <span className="ndm-more-lbl">
                Additional Details
                <svg className="ndm-more-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
              {creator.deadline && (
                <span className={`ndm-more-expires${deadlineMeta ? ' ndm-more-expires-' + deadlineMeta.tone : ''}`}>
                  Expires {formatDate(creator.deadline)}
                </span>
              )}
            </summary>
            <div className="ndm-more-body">
              {dealFields.map(f => (
                <div key={f.l} className="ndm-more-row">
                  <span className="ndm-more-row-l">{f.l}</span>
                  <span className="ndm-more-row-v">{f.v}</span>
                </div>
              ))}
              {creator.videos && (
                <div className="ndm-more-row">
                  <span className="ndm-more-row-l">Video Status</span>
                  <span className="ndm-more-row-v"><StatusBadge value={creator.videos} /></span>
                </div>
              )}
              {creator.deadline && deadlineMeta && (
                <div className="ndm-more-row">
                  <span className="ndm-more-row-l">Deadline</span>
                  <span className={`ndm-more-row-v ndm-more-row-v-${deadlineMeta.tone}`}>{deadlineMeta.txt}</span>
                </div>
              )}
            </div>
          </details>
        )}


        {/* ══ CONTACT · iOS-style list ══ */}
        {contactFields.length > 0 && (
          <div className="ndm-sect">
            <div className="ndm-sh">Contact</div>
            <div className="ndm-list">
              {contactFields.map((f, i) => {
                const type = f.l.toLowerCase();
                const href = type === 'whatsapp'
                  ? `https://wa.me/${f.v.replace(/\D/g,'')}`
                  : type === 'email' ? `mailto:${f.v}` : undefined;
                const El = href ? 'a' : 'div';
                const icons = {
                  whatsapp: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>,
                  email:    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>,
                  paypal:   <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c1.379 3.024.494 5.549-2.614 7.03-1.086.517-2.369.8-3.828.912l-.942 5.97h3.273c.459 0 .85-.334.923-.787l.38-2.411.03-.19.002-.014.544-3.438c.073-.453.464-.787.923-.787h.58c3.755 0 6.693-1.528 7.552-5.943.396-2.02.023-3.618-.616-4.811z"/></svg>,
                  zelle:    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 9h8l-6 6h6"/></svg>,
                };
                return (
                  <El key={f.l} className={`ndm-row row-${type}${i === 0 ? ' row-first' : ''}${i === contactFields.length - 1 ? ' row-last' : ''}`}
                    {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    <div className="ndm-row-icon">{icons[type]}</div>
                    <div className="ndm-row-info">
                      <span className="ndm-row-lbl">{f.l}</span>
                      <span className="ndm-row-val">{f.v}</span>
                    </div>
                    {href && (
                      <svg className="ndm-row-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                    )}
                  </El>
                );
              })}
            </div>
          </div>
        )}

        {/* ══ NOTES ══ */}
        {creator.comments && (
          <div className="ndm-sect">
            <div className="ndm-sh">Notes</div>
            <div className="ndm-notes-card">
              <p className="ndm-notes-text">{creator.comments}</p>
            </div>
          </div>
        )}

        {/* ══ Videos & Ad Codes · opens modal ══ */}
        <div className="ndm-sect ndm-vids-sect">
          <button className="ndm-vids-hd" onClick={() => setShowVideos(true)}>
            <span className="ndm-sh ndm-sh-row">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
              Videos &amp; Ad Codes
              <span className="ndm-vids-badge">{videoCodes.filter(v => v.video || v.adCode).length}/{rowCount}</span>
            </span>
            <svg className="ndm-vids-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        {showVideos && (
          <VideosModal
            creator={creator}
            videoCodes={videoCodes}
            rowCount={rowCount}
            canEdit={perms.canEditVideos}
            onChange={(idx, field, value) => updateField(idx, field, value)}
            onBulkSet={(nextCodes) => {
              setVideoCodes(nextCodes);
              codesForBlurRef.current = nextCodes;
              const autoStatus = getAutoVideoStatus(nextCodes);
              const patch = { video_codes: nextCodes, ...(autoStatus ? { videos: autoStatus } : {}) };
              supabase.from('creators').update(patch).eq('id', creator.id)
                .then(({ error }) => { if (error) console.error('video_codes bulk save failed:', error); });
              if (onUpdate) onUpdate(creator.id, patch);
            }}
            onPersist={persistCodesNow}
            onClose={() => setShowVideos(false)}
            isValidUrl={isValidUrl}
            isValidAdCode={isValidAdCode}
          />
        )}

        {/* ══ Footer ══ */}
        <div className="ndm-foot">
          {(perms.canDelete || perms.deleteBlocked) && (
            <button className="ndm-del" onClick={onDelete}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6M9 6V4h6v2"/></svg>
              Delete
            </button>
          )}
          {perms.canEdit !== false && (
            <button className="ndm-edit" onClick={onEdit}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit Creator
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

/* ─── VideosModal · inline player + bulk paste ───────────── */
function getTikTokVideoId(url) {
  if (!url) return null;
  const m = String(url).match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

function VideosModal({ creator, videoCodes, rowCount, canEdit, onChange, onBulkSet, onPersist, onClose, isValidUrl, isValidAdCode }) {
  const firstValid = videoCodes.findIndex(r => getTikTokVideoId(r.video));
  const [activeIdx, setActiveIdx] = useState(firstValid >= 0 ? firstValid : null);
  const [muted, setMuted] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkErr, setBulkErr] = useState('');

  // Always flush pending edits to DB before closing
  async function safeClose() {
    if (canEdit && onPersist) {
      try { await onPersist(); } catch {}
    }
    onClose();
  }

  function handleBulkParse() {
    setBulkErr('');
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { setBulkErr('Paste at least one line.'); return; }

    const parsed = [];
    for (const line of lines) {
      // Match patterns: "<url> <code>" | "<url>, <code>" | "<url>\t<code>" | just <url> | just <code>
      const parts = line.split(/[\s,;\t]+/).filter(Boolean);
      let video = '';
      let adCode = '';
      for (const p of parts) {
        if (p.startsWith('http')) video = p;
        else if (p.startsWith('#') && p.endsWith('=')) adCode = p;
        else if (!video && p.includes('tiktok.com')) video = p;
      }
      if (video || adCode) parsed.push({ video, adCode });
    }
    if (parsed.length === 0) { setBulkErr('Could not parse any videos or ad codes.'); return; }

    // Merge into existing codes · fill empty slots first, then extend
    const next = [...videoCodes];
    let parsedIdx = 0;
    for (let i = 0; i < next.length && parsedIdx < parsed.length; i++) {
      if (!next[i].video && !next[i].adCode) { next[i] = parsed[parsedIdx++]; }
    }
    while (parsedIdx < parsed.length) {
      next.push(parsed[parsedIdx++]);
    }
    onBulkSet(next);
    setBulkText('');
    setBulkOpen(false);
  }

  const filledCount = videoCodes.filter(v => v.video || v.adCode).length;

  return (
    <div className="vm-overlay" onClick={e => { if (e.target === e.currentTarget) safeClose(); }}>
      <div className="vm-modal">

        {/* Header */}
        <div className="vm-head">
          <div className="vm-head-l">
            <div className="vm-head-ic">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            </div>
            <div>
              <div className="vm-title">Videos &amp; Ad Codes</div>
              <div className="vm-sub">{creator.name} · {filledCount}/{videoCodes.length} filled</div>
            </div>
          </div>
          <div className="vm-head-r">
            {canEdit && (
              <button className={`vm-bulk-tog${bulkOpen ? ' on' : ''}`} onClick={() => setBulkOpen(v => !v)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Bulk Paste
              </button>
            )}
            <button className="vm-close" onClick={safeClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* Bulk paste panel */}
        {bulkOpen && canEdit && (
          <div className="vm-bulk">
            <div className="vm-bulk-head">
              <div>
                <div className="vm-bulk-t">Paste multiple entries</div>
                <div className="vm-bulk-s">One per line. Format: <code>video_url #adcode=</code> · separator can be space, comma, tab</div>
              </div>
            </div>
            <textarea
              className="vm-bulk-ta"
              placeholder={`https://tiktok.com/@user/video/123 #abc=\nhttps://tiktok.com/@user/video/456 #xyz=\n…`}
              rows={5}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
            />
            {bulkErr && <div className="vm-bulk-err">{bulkErr}</div>}
            <div className="vm-bulk-acts">
              <button className="vm-bulk-cancel" onClick={() => { setBulkOpen(false); setBulkText(''); setBulkErr(''); }}>Cancel</button>
              <button className="vm-bulk-apply" onClick={handleBulkParse} disabled={!bulkText.trim()}>Parse &amp; Add</button>
            </div>
          </div>
        )}

        {/* Split body: list (left) + phone player (right) */}
        <div className="vm-split">

          {/* LIST */}
          <div className="vm-list">
            {videoCodes.map((row, i) => {
              const st = row.video && row.adCode ? 'full' : row.video || row.adCode ? 'partial' : 'empty';
              const vid = getTikTokVideoId(row.video);
              const valid = isValidUrl(row.video);
              const isActive = activeIdx === i;
              return (
                <div key={i} className={`vm-row vm-row-${st}${isActive ? ' active' : ''}`}>
                  <div className="vm-row-head">
                    <span className="vm-row-num">#{String(i + 1).padStart(2, '0')}</span>
                    <span className={`vm-row-st vm-row-st-${st}`}>
                      {st === 'full' ? 'Complete' : st === 'partial' ? 'In progress' : 'Empty'}
                    </span>
                    <div className="vm-row-acts">
                      <button
                        className="vm-row-play"
                        onClick={() => vid && setActiveIdx(i)}
                        disabled={!vid}
                        title={vid ? 'Play in player' : 'No valid video link'}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                      </button>
                      {valid && (
                        <a href={row.video} target="_blank" rel="noopener noreferrer" className="vm-row-ext" title="Open on TikTok">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="vm-row-fields">
                    <input
                      className="vm-input"
                      value={row.video}
                      placeholder={canEdit ? 'TikTok video URL…' : '-'}
                      onChange={canEdit ? e => onChange(i, 'video', e.target.value) : undefined}
                      onBlur={canEdit ? onPersist : undefined}
                      readOnly={!canEdit}
                    />
                    <input
                      className={`vm-input vm-input-code${row.adCode && !isValidAdCode(row.adCode) ? ' vm-input-invalid' : ''}`}
                      value={row.adCode}
                      placeholder={canEdit ? '#adcode=' : '-'}
                      onChange={canEdit ? e => onChange(i, 'adCode', e.target.value) : undefined}
                      onBlur={canEdit ? onPersist : undefined}
                      readOnly={!canEdit}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* SHARED PHONE PLAYER · Samsung Galaxy white */}
          <div className="vm-phone-col">
            <div className="vm-phone">
              {/* Left side: volume rocker */}
              <span className="vm-phone-btn vm-phone-btn-volrocker" />
              {/* Right side: power button */}
              <span className="vm-phone-btn vm-phone-btn-power" />
              <div className="vm-phone-frame">
                <div className="vm-phone-punch" />
                <div className="vm-phone-screen">
                  {(() => {
                    const row = activeIdx !== null ? videoCodes[activeIdx] : null;
                    const vid = row ? getTikTokVideoId(row.video) : null;
                    if (vid) {
                      return (
                        <>
                          <iframe
                            key={`vm-${activeIdx}-${vid}-${muted ? 'm' : 'u'}`}
                            title={`video-${activeIdx}`}
                            src={`https://www.tiktok.com/embed/v2/${vid}?autoplay=1${muted ? '&muted=1' : ''}`}
                            allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
                            scrolling="no"
                            frameBorder="0"
                          />
                          <button
                            className={`vm-phone-mute${muted ? ' muted' : ''}`}
                            onClick={() => setMuted(m => !m)}
                            title={muted ? 'Unmute' : 'Mute'}
                            aria-label={muted ? 'Unmute' : 'Mute'}
                          >
                            {muted ? (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                            ) : (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
                            )}
                          </button>
                        </>
                      );
                    }
                    return (
                      <div className="vm-phone-empty">
                        <div className="vm-phone-empty-ic">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
                        </div>
                        <div className="vm-phone-empty-t">No video selected</div>
                        <div className="vm-phone-empty-s">Tap ▶ on any row to preview</div>
                      </div>
                    );
                  })()}
                </div>
                <div className="vm-phone-home" />
              </div>
            </div>
            {activeIdx !== null && videoCodes[activeIdx]?.video && (
              <div className="vm-phone-caption">
                <span className="vm-phone-caption-num">#{String(activeIdx + 1).padStart(2, '0')}</span>
                <span className="vm-phone-caption-dot">·</span>
                <span className="vm-phone-caption-lbl">Now playing</span>
                <a href={videoCodes[activeIdx].video} target="_blank" rel="noopener noreferrer" className="vm-phone-caption-ext">
                  TikTok
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

/* ─── LeaderboardModal V2 · Tailwind podium + ranked cards ─── */
/* "2026-08" → "Aug 26" */
function monthLabelShort(mk) {
  const [y, m] = String(mk).split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[Number(m) - 1] || m} ${String(y).slice(2)}`;
}

/* Sum one field of a creator's monthly cells · monthly holds "YYYY-MM" plus
   per-handle "YYYY-MM@handle" keys; pass null for month to total everything. */
function _lbSum(c, month, field) {
  const m = c?.monthly || {};
  let s = 0;
  Object.keys(m).forEach(k => {
    if (k === 'l30' || k.startsWith('l30@') || k === 'euka' || k === 'perf') return;
    const mk = k.split('@')[0];
    if (!/^\d{4}-\d{2}$/.test(mk)) return;
    if (month && mk !== month) return;
    s += Number((m[k] || {})[field]) || 0;
  });
  return s;
}
const _lbGmv = (c, month) => _lbSum(c, month, 'gmv');
const _lbAd  = (c, month) => _lbSum(c, month, 'adSpent');

/* DISTINCT delivered videos · the same link can sit in video_codes twice (a
   bulk paste that overlapped an existing row), and counting it twice inflates
   delivery. Match on the numeric TikTok id when there is one. */
function distinctVideoCount(c) {
  if (!Array.isArray(c?.video_codes)) return 0;
  const seen = new Set();
  c.video_codes.forEach(v => {
    const u = String(v?.video || '').trim();
    if (!u) return;
    const m = u.match(/video\/(\d+)/);
    seen.add(m ? m[1] : u.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, ''));
  });
  return seen.size;
}

function LeaderboardModalV2({ creators, hiredByTeam, onClose }) {
  const [metric, setMetric] = useState('revenue');
  const [month, setMonth] = useState('');       // '' = all time

  /* Months that actually carry activity · newest first, capped at 12 */
  const months = useMemo(() => {
    const set = new Set();
    creators.forEach(c => {
      const h = String(c.hiring_date || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(h)) set.add(h);
      Object.keys(c.monthly || {}).forEach(k => {
        const mk = k.split('@')[0];
        if (/^\d{4}-\d{2}$/.test(mk)) set.add(mk);
      });
    });
    return [...set].sort().reverse().slice(0, 12);
  }, [creators]);

  /* Stats for a given month (or all time when month is '') */
  const statsFor = useCallback((mk) => {
    const map = {};
    creators.forEach(c => {
      const by = c.hired_by;
      if (!by) return;
      const hired = String(c.hiring_date || '').slice(0, 7);
      const gmv = _lbGmv(c, mk || null);
      // in scope if the deal was signed that month, or it earned GMV that month
      if (mk && hired !== mk && gmv <= 0) return;
      if (!map[by]) map[by] = { name: by, deals: 0, revenue: 0, paid: 0, paidCount: 0, videosDone: 0, videosTotal: 0, gmv: 0 };
      map[by].gmv += gmv;
      if (mk && hired !== mk) return;   // GMV counts, but the deal belongs to its own month
      const { amount, videos } = parseDeal(c.deal);
      map[by].deals += 1;
      map[by].revenue += amount || 0;
      map[by].videosTotal += videos || 0;
      if (c.videos === 'Done') map[by].videosDone += 1;
      if (c.payment_status === 'Paid') { map[by].paidCount += 1; map[by].paid += amount || 0; }
    });
    return Object.values(map).map(s => ({
      ...s,
      color: (hiredByTeam.find(m => m.name === s.name) || {}).color || '#475569',
      bg:    (hiredByTeam.find(m => m.name === s.name) || {}).bg    || '#EDF1F6',
      paidPct: s.deals > 0 ? Math.round((s.paidCount / s.deals) * 100) : 0,
      deliveryPct: s.deals > 0 ? Math.round((s.videosDone / s.deals) * 100) : 0,
    }));
  }, [creators, hiredByTeam]);

  const stats = useMemo(() => statsFor(month), [statsFor, month]);

  /* Same figures for the month before · powers the movement chip */
  const prevMonth = useMemo(() => {
    if (!month) return '';
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, [month]);
  const prevStats = useMemo(() => (prevMonth ? statsFor(prevMonth) : []), [statsFor, prevMonth]);

  const key = metric === 'revenue' ? 'revenue' : metric === 'gmv' ? 'gmv' : metric === 'deals' ? 'deals' : metric === 'paid' ? 'paidPct' : 'deliveryPct';
  const sorted = useMemo(() => [...stats].sort((a, b) => b[key] - a[key]), [stats, key]);
  const maxVal = sorted.length > 0 ? sorted[0][key] : 1;
  const tabs = [
    { id: 'revenue',  label: 'Allocated' },
    { id: 'gmv',      label: 'GMV' },
    { id: 'deals',    label: 'Deals' },
    { id: 'paid',     label: 'Paid %' },
    { id: 'delivery', label: 'Delivered %' },
  ];

  function fmt(s) {
    return metric === 'revenue' ? '$' + Math.round(s.revenue).toLocaleString()
         : metric === 'gmv'     ? '$' + Math.round(s.gmv).toLocaleString()
         : metric === 'deals'   ? String(s.deals)
         : metric === 'paid'    ? s.paidPct + '%'
         :                        s.deliveryPct + '%';
  }
  /* movement against the previous month · null when there is nothing to compare */
  function movement(name) {
    if (!month) return null;
    const now = stats.find(s => s.name === name);
    const was = prevStats.find(s => s.name === name);
    const a = now ? now[key] : 0;
    const b = was ? was[key] : 0;
    if (!b && !a) return null;
    if (!b) return { dir: 'new', text: 'new' };
    const pct = Math.round(((a - b) / b) * 100);
    if (pct === 0) return { dir: 'flat', text: 'no change' };
    return { dir: pct > 0 ? 'up' : 'down', text: `${pct > 0 ? '+' : ''}${pct}%` };
  }
  const top = sorted[0];

  return (
    <div
      className="tw-fixed tw-inset-0 tw-z-[1900] tw-flex tw-items-center tw-justify-center tw-p-4 sm:tw-p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ animation: 'sp-fade 0.22s ease', background: 'color-mix(in srgb, var(--wx-warning-soft) 50%, transparent)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
    >
      <div style={{
        position: 'relative', width: '100%', maxWidth: 560, maxHeight: '92vh',
        background: 'var(--wx-bg)', borderRadius: 22,
        boxShadow: '0 32px 80px rgba(48,39,28,0.25), 0 8px 24px rgba(48,39,28,0.10)',
        animation: 'sp-pop 0.32s cubic-bezier(0.33,1,0.68,1)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        fontFamily: 'inherit',
      }}>
        {/* ── Header · dark coffee ── */}
        <div style={{ background: 'var(--wx-warning-soft)', padding: '16px 22px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--wx-text-muted)' }}>Leaderboard</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 2 }}>
              {month
                ? `Hired-by performance · ${monthLabelShort(month)}${prevMonth ? ` vs ${monthLabelShort(prevMonth)}` : ''}`
                : 'Hired-by performance across all deals'}
            </div>
          </div>
          <button onClick={onClose} title="Close" style={{ width: 34, height: 34, borderRadius: 999, border: 0, cursor: 'pointer', background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.10)'; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* ── Period strip · all time + the last 12 active months ── */}
        <div style={{ background: 'var(--wx-surface-1)', borderBottom: '1px solid var(--wx-border)', padding: '10px 0 10px 22px' }}>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingRight: 22, scrollbarWidth: 'none' }}>
            {[{ id: '', label: 'All time' }, ...months.map(m => ({ id: m, label: monthLabelShort(m) }))].map(p => {
              const active = month === p.id;
              return (
                <button key={p.id || 'all'} onClick={() => setMonth(p.id)} style={{
                  flexShrink: 0, height: 28, padding: '0 12px', borderRadius: 999, cursor: 'pointer',
                  border: '1px solid ' + (active ? '#30271C' : '#E7E2D7'),
                  background: active ? '#30271C' : '#FBFAF7',
                  color: active ? '#F5E9D6' : '#6B7280',
                  fontSize: 11.5, fontWeight: 700, letterSpacing: '-0.1px', fontFamily: 'inherit',
                  transition: 'background .15s, color .15s, border-color .15s',
                }}>{p.label}</button>
              );
            })}
          </div>
        </div>

        {/* ── Top performer hero ── */}
        {top && (
          <div style={{ padding: '18px 22px 16px', background: 'linear-gradient(135deg, var(--wx-surface-1) 0%, var(--wx-surface-2) 100%)', borderBottom: '1px solid var(--wx-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
                <span style={{ width: 56, height: 56, borderRadius: 999, background: top.bg, color: top.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{(top.name || '?')[0].toUpperCase()}</span>
                <span style={{ position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 999, background: 'var(--wx-warning-soft)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, lineHeight: 1, border: '2px solid var(--wx-border)' }}>#1</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--wx-text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Leading by {tabs.find(t => t.id === metric).label}{month ? ` · ${monthLabelShort(month)}` : ''}</div>
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--wx-text)', marginTop: 1 }}>{top.name}</div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 2 }}>{top.deals} deal{top.deals !== 1 ? 's' : ''} · {top.paidCount} paid · {top.videosDone} delivered</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--wx-warning)', fontVariantNumeric: 'tabular-nums' }}>{fmt(top)}</div>
                {(() => {
                  const mv = movement(top.name);
                  if (!mv) return null;
                  return <MoveChip mv={mv} prev={prevMonth} />;
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── Metric tabs · neutral pill toggle ── */}
        <div style={{ padding: '14px 22px 0' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--wx-surface-1)', borderRadius: 999, padding: 4, border: '1px solid var(--wx-border)' }}>
            {tabs.map(t => {
              const active = metric === t.id;
              return (
                <button key={t.id} onClick={() => setMetric(t.id)} style={{
                  flex: 1, height: 32, borderRadius: 999, border: 0, cursor: 'pointer',
                  background: active ? '#30271C' : 'transparent',
                  color: active ? '#F5E9D6' : '#6B7280',
                  fontSize: 11.5, fontWeight: 700, letterSpacing: '-0.1px',
                  transition: 'background .15s, color .15s', lineHeight: 1,
                  fontFamily: 'inherit',
                }}>{t.label}</button>
              );
            })}
          </div>
        </div>

        {/* ── Ranking list ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px 22px' }}>
          {sorted.length === 0 ? (
            <div style={{ padding: '60px 16px', textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--wx-bg)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--wx-text)', letterSpacing: '-0.2px' }}>No rankings yet</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--wx-text-muted)', marginTop: 4 }}>Assign "Hired By" to creators to see leaderboard</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Nobody scored on this metric · say so instead of a wall of -100% */}
              {maxVal === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', marginBottom: 2, borderRadius: 12, background: 'var(--wx-bg)', border: '1px solid var(--wx-border)', color: 'var(--wx-warning)', fontSize: 11.5, fontWeight: 600, lineHeight: 1.45 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <span>No {tabs.find(t => t.id === metric).label} recorded for {month ? monthLabelShort(month) : 'this period'} yet{metric === 'gmv' ? ' · EUKA month data may not be synced' : ''}.</span>
                </div>
              )}
              {sorted.map((s, i) => {
                const val = s[key];
                const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                return <LbCardV2 key={s.name} s={s} rank={i} pct={pct} display={fmt(s)} mv={movement(s.name)} prev={prevMonth} />;
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Movement against the previous month · green up, red down, neutral otherwise */
function MoveChip({ mv, prev }) {
  const tone = mv.dir === 'up'   ? { bg: '#EAF6EE', fg: '#1E7A44' }
             : mv.dir === 'down' ? { bg: '#FBEDEC', fg: '#B4362F' }
             : mv.dir === 'new'  ? { bg: '#EEF1F8', fg: '#3F5A9E' }
             :                     { bg: '#F4F2EE', fg: '#9C8F7C' };
  return (
    <span
      title={prev ? `vs ${monthLabelShort(prev)}` : ''}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 3,
        height: 17, padding: '0 6px', borderRadius: 999,
        background: tone.bg, color: tone.fg,
        fontSize: 10, fontWeight: 800, letterSpacing: '-0.1px', lineHeight: 1,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>
      {mv.dir === 'up' && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 15 12 9 18 15"/></svg>}
      {mv.dir === 'down' && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>}
      {mv.text}
    </span>
  );
}

function LbCardV2({ s, rank, pct, display, mv, prev }) {
  const isTop = rank === 0;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px',
      borderRadius: 14,
      background: 'var(--wx-surface-1)',
      border: '1px solid ' + (isTop ? '#30271C' : '#E7E2D7'),
      transition: 'border-color .15s',
    }}>
      <div style={{ width: 26, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 800, color: isTop ? '#30271C' : '#9C8F7C', fontVariantNumeric: 'tabular-nums' }}>#{rank + 1}</div>
      <div style={{ width: 38, height: 38, borderRadius: 999, background: s.bg, color: s.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, lineHeight: 1, flexShrink: 0 }}>{(s.name || '?')[0].toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--wx-text)', letterSpacing: '-0.2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 2 }}>
          <span>{s.deals} deal{s.deals !== 1 ? 's' : ''}</span>
          <span style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--wx-accent)', opacity: 0.6 }} />
          <span>{s.paidCount} paid</span>
          <span style={{ width: 3, height: 3, borderRadius: 999, background: 'var(--wx-accent)', opacity: 0.6 }} />
          <span>{s.videosDone} delivered</span>
        </div>
        <div style={{ marginTop: 6, height: 4, borderRadius: 999, background: 'var(--wx-surface-2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 999, background: s.color, width: pct + '%', transition: 'width .5s cubic-bezier(.4,.0,.2,1)' }} />
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.3px', color: isTop ? '#30271C' : '#1F1F1F', fontVariantNumeric: 'tabular-nums' }}>{display}</div>
        {mv && <MoveChip mv={mv} prev={prev} />}
      </div>
    </div>
  );
}

/* ─── ReviewQueueModalV2 · Tailwind premium card list ─── */
function ReviewQueueModalV2({ onClose, onAfterAction }) {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [confirmReject, setConfirmReject] = useState(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('creators').select('*').eq('status', 'pending').order('inserted_at', { ascending: false });
    setPending(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function approve(c) {
    setBusyId(c.id);
    const { error } = await supabase.from('creators').update({ status: 'approved' }).eq('id', c.id);
    setBusyId(null);
    if (error) { alert('Approve failed: ' + error.message); return; }
    setPending(prev => prev.filter(p => p.id !== c.id));
    onAfterAction?.();
  }
  async function rejectConfirmed(c) {
    setBusyId(c.id);
    const { error } = await supabase.from('creators').delete().eq('id', c.id);
    setBusyId(null); setConfirmReject(null);
    if (error) { alert('Reject failed: ' + error.message); return; }
    setPending(prev => prev.filter(p => p.id !== c.id));
    onAfterAction?.();
  }

  return (
    <div className="tw-fixed tw-inset-0 tw-z-[1900] tw-bg-black/55 tw-backdrop-blur-md tw-flex tw-items-end md:tw-items-center tw-justify-center tw-p-0 md:tw-p-4 tw-font-sans" onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ animation: 'bsv2-fade 0.22s ease' }}>
      <div className="tw-relative tw-w-full md:tw-max-w-[520px] tw-bg-white tw-rounded-t-[28px] md:tw-rounded-[28px] tw-shadow-oneui_lg tw-overflow-hidden tw-flex tw-flex-col" style={{ maxHeight: '92vh', animation: 'bsv2-pop 0.34s cubic-bezier(0.33,1,0.68,1)' }}>
        <div className="tw-flex tw-justify-center tw-pt-2.5 tw-pb-1 md:tw-hidden"><div className="tw-w-9 tw-h-1 tw-rounded-full tw-bg-black/15" /></div>

        <div className="tw-px-6 tw-pt-4 tw-pb-4 tw-flex tw-items-start tw-justify-between tw-gap-3 tw-border-b tw-border-black/[0.06]">
          <div className="tw-flex tw-items-center tw-gap-3">
            <div className="tw-w-11 tw-h-11 tw-rounded-2xl tw-bg-gradient-to-br tw-from-amber-400 tw-to-orange-500 tw-text-white tw-flex tw-items-center tw-justify-center tw-shadow-md">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div>
              <div className="tw-text-[20px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.5px] tw-leading-tight">Pending Approvals</div>
              <div className="tw-text-[12.5px] tw-font-medium tw-text-oneui-mute tw-mt-0.5">{loading ? 'Loading…' : `${pending.length} creator${pending.length !== 1 ? 's' : ''} awaiting review`}</div>
            </div>
          </div>
          <button onClick={onClose} className="tw-w-9 tw-h-9 tw-rounded-full tw-bg-black/[0.05] hover:tw-bg-black/[0.1] tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-text-[13px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-90" aria-label="Close">✕</button>
        </div>

        <div className="tw-flex-1 tw-overflow-y-auto tw-px-4 tw-py-3 tw-overscroll-contain">
          {loading ? (
            <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-14"><span className="tw-w-6 tw-h-6 tw-border-2 tw-border-[#1259C3]/30 tw-border-t-[#1259C3] tw-rounded-full tw-animate-spin" /></div>
          ) : pending.length === 0 ? (
            <div className="tw-flex tw-flex-col tw-items-center tw-justify-center tw-py-14 tw-text-center">
              <div className="tw-w-16 tw-h-16 tw-rounded-full tw-bg-gradient-to-br tw-from-emerald-400 tw-to-emerald-600 tw-flex tw-items-center tw-justify-center tw-text-white tw-text-[26px] tw-shadow-lg tw-mb-3">✓</div>
              <div className="tw-text-[15px] tw-font-bold tw-text-oneui-ink tw-tracking-[-0.3px]">All caught up</div>
              <div className="tw-text-[12.5px] tw-text-oneui-mute tw-font-medium tw-mt-1">No pending submissions</div>
            </div>
          ) : pending.map(c => {
            const { handle } = parseTikTok(c.tiktok_account);
            const { amount, videos } = parseDeal(c.deal);
            return (
              <div key={c.id} className="tw-flex tw-items-center tw-gap-3 tw-bg-white tw-ring-1 tw-ring-black/[0.05] tw-rounded-2xl tw-px-3 tw-py-3 tw-mb-2 tw-shadow-oneui">
                <div className="tw-w-11 tw-h-11 tw-rounded-full tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[15px] tw-font-extrabold tw-shadow-md tw-flex-shrink-0 tw-leading-none" style={{ background: getGradient(c.name || '?') }}>{(c.name || '?')[0].toUpperCase()}</div>
                <div className="tw-flex-1 tw-min-w-0">
                  <div className="tw-text-[14px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.3px] tw-truncate">{c.name}</div>
                  <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-[11px] tw-font-semibold tw-text-oneui-mute tw-mt-0.5 tw-flex-wrap">
                    {handle && <span className="tw-truncate">{handle}</span>}
                    {handle && c.brand && <span className="tw-w-0.5 tw-h-0.5 tw-rounded-full tw-bg-oneui-mute/50" />}
                    {c.brand && <span className="tw-text-[#1259C3]">{c.brand}</span>}
                  </div>
                  {amount > 0 && (
                    <span className="tw-inline-flex tw-items-center tw-h-5 tw-px-2 tw-rounded-full tw-bg-emerald-50 tw-text-emerald-700 tw-text-[10.5px] tw-font-extrabold tw-mt-1.5">${amount.toLocaleString()}{videos > 0 && `/${videos}vid`}</span>
                  )}
                </div>
                <div className="tw-flex tw-flex-col tw-gap-1.5 tw-flex-shrink-0">
                  <button disabled={busyId === c.id} onClick={() => approve(c)} className="tw-h-8 tw-px-3 tw-rounded-full tw-bg-emerald-500 hover:tw-bg-emerald-600 tw-text-white tw-text-[11.5px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-95 disabled:tw-opacity-50 tw-shadow-md">Approve</button>
                  <button disabled={busyId === c.id} onClick={() => setConfirmReject(c)} className="tw-h-8 tw-px-3 tw-rounded-full tw-bg-rose-50 hover:tw-bg-rose-100 tw-text-rose-700 tw-text-[11.5px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-95 disabled:tw-opacity-50">Reject</button>
                </div>
              </div>
            );
          })}
        </div>

        {confirmReject && (
          <DeleteConfirmModal
            type="creator"
            name={confirmReject.name}
            onCancel={() => setConfirmReject(null)}
            onConfirm={() => rejectConfirmed(confirmReject)}
          />
        )}
      </div>
    </div>
  );
}

/* ─── LeaderboardModal (legacy) ───────────────────────────── */
function LeaderboardModal({ creators, hiredByTeam, onClose }) {
  const [metric, setMetric] = useState('revenue');

  const stats = useMemo(() => {
    const map = {};
    creators.forEach(c => {
      const by = c.hired_by;
      if (!by) return;
      if (!map[by]) map[by] = { name: by, deals: 0, revenue: 0, paid: 0, paidCount: 0, videosDone: 0, videosTotal: 0 };
      const { amount, videos } = parseDeal(c.deal);
      map[by].deals += 1;
      map[by].revenue += amount || 0;
      map[by].videosTotal += videos || 0;
      if (c.videos === 'Done') map[by].videosDone += 1;
      if (c.payment_status === 'Paid') {
        map[by].paidCount += 1;
        map[by].paid += amount || 0;
      }
    });
    return Object.values(map).map(s => ({
      ...s,
      color: (hiredByTeam.find(m => m.name === s.name) || {}).color || '#64748B',
      bg:    (hiredByTeam.find(m => m.name === s.name) || {}).bg    || '#F1F5F9',
      paidPct: s.deals > 0 ? Math.round((s.paidCount / s.deals) * 100) : 0,
      deliveryPct: s.deals > 0 ? Math.round((s.videosDone / s.deals) * 100) : 0,
    }));
  }, [creators, hiredByTeam]);

  const sorted = useMemo(() => {
    const key = metric === 'revenue' ? 'revenue'
              : metric === 'deals' ? 'deals'
              : metric === 'paid' ? 'paidPct'
              : 'deliveryPct';
    return [...stats].sort((a, b) => b[key] - a[key]);
  }, [stats, metric]);

  const maxVal = sorted.length > 0 ? sorted[0][
    metric === 'revenue' ? 'revenue' : metric === 'deals' ? 'deals' : metric === 'paid' ? 'paidPct' : 'deliveryPct'
  ] : 1;

  const MEDALS = ['🥇', '🥈', '🥉'];

  return (
    <div className="lb-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lb-modal">
        <div className="lb-head">
          <div className="lb-head-l">
            <div className="lb-head-ic">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
            </div>
            <div>
              <div className="lb-title">Team Leaderboard</div>
              <div className="lb-sub">Hired-By performance rankings</div>
            </div>
          </div>
          <button className="lb-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="lb-tabs">
          {[
            { id: 'revenue',  label: 'Allocated' },
            { id: 'deals',    label: 'Deals' },
            { id: 'paid',     label: 'Paid %' },
            { id: 'delivery', label: 'Delivered %' },
          ].map(t => (
            <button key={t.id} className={`lb-tab${metric === t.id ? ' active' : ''}`} onClick={() => setMetric(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="lb-body">
          {sorted.length === 0 ? (
            <div className="lb-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
              <div>No data yet</div>
              <span>Assign "Hired By" to creators to see rankings</span>
            </div>
          ) : sorted.map((s, i) => {
            const val = metric === 'revenue' ? s.revenue : metric === 'deals' ? s.deals : metric === 'paid' ? s.paidPct : s.deliveryPct;
            const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
            const display = metric === 'revenue' ? `$${s.revenue.toLocaleString()}`
                          : metric === 'deals' ? String(s.deals)
                          : metric === 'paid' ? `${s.paidPct}%`
                          : `${s.deliveryPct}%`;
            return (
              <div key={s.name} className={`lb-card${i < 3 ? ' lb-card-podium lb-podium-' + i : ''}`}>
                <div className="lb-rank">
                  {i < 3 ? <span className="lb-medal">{MEDALS[i]}</span> : <span className="lb-rank-num">#{i + 1}</span>}
                </div>
                <div className="lb-av" style={{ background: s.bg, color: s.color }}>
                  {(s.name || '?')[0].toUpperCase()}
                </div>
                <div className="lb-info">
                  <div className="lb-name">{s.name}</div>
                  <div className="lb-meta">
                    <span>{s.deals} deal{s.deals !== 1 ? 's' : ''}</span>
                    <span className="lb-dot">·</span>
                    <span>{s.paidCount} paid</span>
                    <span className="lb-dot">·</span>
                    <span>{s.videosDone} delivered</span>
                  </div>
                  <div className="lb-bar">
                    <div className="lb-bar-fill" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${s.color}, ${s.color}dd)` }} />
                  </div>
                </div>
                <div className="lb-value" style={{ color: i === 0 ? '#B45309' : '#0F172A' }}>{display}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── AIAssistantChat ────────────────────────────────────── */
const AI_STORAGE_KEY = 'ai_chat_history_v1';
const AI_GREETING = {
  id: 1,
  from: 'ai',
  text: 'Hi! I can help you search creators, deals, brands, and team performance. You can also ask me to **generate reports** (PDF / Excel / Word / PPT). Urdu bhi chal jati hai. Try:',
  suggestions: [
    'Show unpaid creators',
    'Top 5 deals',
    'Hired by Aris',
    'This month stats',
    'Export unpaid as PDF',
    'Aj kitny deals han?',
  ],
};

function AIAssistantChat({ creators, allBrands, hiredByTeam = [], currentUser, onClose, onOpenCreator, onOpenCompare, onOpenLeaderboard }) {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(AI_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [AI_GREETING];
  });
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [pendingReport, setPendingReport] = useState(null);
  const scrollRef = useRef(null);
  const isSuperAdmin = currentUser?.role === 'superadmin';

  // Unique creator count (by name+tiktok) vs total deals
  const uniqueCreatorCount = useMemo(() => {
    const normTT = t => (t || '').toLowerCase().replace(/[@\s]/g, '').replace(/^https?:\/\/(www\.)?tiktok\.com\//, '').replace(/\/.*$/, '');
    const seen = new Set();
    creators.forEach(c => {
      const key = (c.name || '').trim().toLowerCase() + '|' + normTT(c.tiktok_account);
      if (key !== '|') seen.add(key);
    });
    return seen.size;
  }, [creators]);

  // Dynamic vocabulary learned from data (re-computed whenever data changes)
  const vocabulary = useMemo(() => {
    const hiredByNames = [...new Set(creators.map(c => c.hired_by).filter(Boolean))];
    const categories  = [...new Set(creators.map(c => c.category).filter(Boolean))];
    const products    = [...new Set(creators.map(c => c.product).filter(Boolean))];
    const creatorNames = creators.map(c => (c.name || '').trim()).filter(Boolean);
    return {
      hiredByNames: hiredByNames.map(n => n.toLowerCase()),
      hiredByOrig: hiredByNames,
      brands: allBrands.map(b => b.toLowerCase()),
      brandsOrig: allBrands,
      categories: categories.map(c => c.toLowerCase()),
      categoriesOrig: categories,
      products: products.map(p => p.toLowerCase()),
      productsOrig: products,
      creatorNames: creatorNames.map(n => n.toLowerCase()),
      creatorNamesOrig: creatorNames,
    };
  }, [creators, allBrands]);

  // Persist messages (strip non-serializable fields like onClick / _raw)
  useEffect(() => {
    try {
      const sanitized = messages.slice(-50).map(m => {
        const copy = { ...m };
        if (copy.action) { copy.action = { label: copy.action.label, _kind: copy.action._kind }; }
        if (copy.list) { copy.list = copy.list.map(it => ({ ...it, _raw: undefined })); copy.listClick = undefined; }
        return copy;
      });
      localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(sanitized));
    } catch {}
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  function newChat() {
    setMessages([AI_GREETING]);
    localStorage.removeItem(AI_STORAGE_KEY);
    setInput('');
  }

  function getScopeData(scope) {
    if (scope === 'unpaid') return creators.filter(c => c.payment_status !== 'Paid');
    if (scope === 'paid')   return creators.filter(c => c.payment_status === 'Paid');
    if (scope === 'overdue') {
      const today = shopMidnight();
      return creators.filter(c => c.deadline && new Date(c.deadline) < today && c.videos !== 'Done');
    }
    if (scope === 'month') {
      const monthKey = shopMonthKey();
      return creators.filter(c => c.hiring_date?.startsWith(monthKey));
    }
    return creators;
  }

  async function downloadReport({ scope, format, title }) {
    const data = getScopeData(scope);
    const fileBase = title.toLowerCase().replace(/\s+/g, '-') + '-' + new Date().toISOString().slice(0, 10);
    const total = data.reduce((s, c) => s + (parseDeal(c.deal).amount || 0), 0);
    const paid  = data.filter(c => c.payment_status === 'Paid').length;
    const delivered = data.filter(c => c.videos === 'Done').length;
    const kpi = [
      ['Total Creators', data.length],
      ['Allocated', '$' + total.toLocaleString()],
      ['Paid', paid],
      ['Delivered', delivered],
    ];
    const headers = ['#', 'Name', 'TikTok', 'Brand', 'Deal', 'Payment', 'Videos', 'Hired By', 'Hiring Date', 'Deadline'];
    const rows = data.map((c, i) => [
      i + 1,
      c.name || '',
      parseTikTok(c.tiktok_account).handle || '',
      c.brand || '',
      c.deal || '',
      c.payment_status || '',
      c.videos || '',
      c.hired_by || '',
      c.hiring_date ? formatDate(c.hiring_date) : '',
      c.deadline ? formatDate(c.deadline) : '',
    ]);

    try {
      if (format === 'pdf') {
        const { default: jsPDF } = await import('jspdf');
        const autoTableMod = await import('jspdf-autotable');
        const doc = new jsPDF();
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 210, 30, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.text('Creator Hub', 14, 14);
        doc.setFontSize(11);
        doc.text(title, 14, 23);
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(9);
        doc.text(`Generated ${new Date().toLocaleString()}`, 196, 14, { align: 'right' });
        // KPIs
        doc.setTextColor(15, 23, 42);
        let y = 40;
        kpi.forEach(([l, v], i) => {
          const x = 14 + i * 46;
          doc.setFillColor(241, 245, 249);
          doc.roundedRect(x, y, 44, 18, 3, 3, 'F');
          doc.setFontSize(13);
          doc.setFont(undefined, 'bold');
          doc.text(String(v), x + 4, y + 8);
          doc.setFontSize(8);
          doc.setFont(undefined, 'normal');
          doc.setTextColor(100, 116, 139);
          doc.text(String(l), x + 4, y + 14);
          doc.setTextColor(15, 23, 42);
        });
        (autoTableMod.default || autoTableMod)(doc, {
          startY: 65,
          head: [headers],
          body: rows,
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8 },
          styles: { fontSize: 7.5, cellPadding: 2 },
          alternateRowStyles: { fillColor: [250, 251, 252] },
        });
        doc.save(`${fileBase}.pdf`);
      } else if (format === 'xlsx') {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        // Summary sheet
        const summary = [['Creator Hub · ' + title], [`Generated ${new Date().toLocaleString()}`], [], ...kpi];
        const ws1 = XLSX.utils.aoa_to_sheet(summary);
        XLSX.utils.book_append_sheet(wb, ws1, 'Summary');
        // Data sheet
        const ws2 = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        XLSX.utils.book_append_sheet(wb, ws2, 'Creators');
        XLSX.writeFile(wb, `${fileBase}.xlsx`);
      } else if (format === 'docx') {
        // Simple Word-compatible HTML approach · opens in Word as .doc
        const htmlRows = rows.map(r => `<tr>${r.map(c => `<td style="padding:6px;border:1px solid #ddd;font-size:11px">${String(c).replace(/</g,'&lt;')}</td>`).join('')}</tr>`).join('');
        const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:Calibri,sans-serif;padding:24px">
          <h1 style="color:#0F172A;border-bottom:2px solid #0F172A;padding-bottom:8px">Creator Hub</h1>
          <h2 style="color:#334155;margin:4px 0 2px">${title}</h2>
          <p style="color:#64748B;font-size:11px">Generated ${new Date().toLocaleString()}</p>
          <h3 style="color:#0F172A;margin-top:20px">Summary</h3>
          <table style="border-collapse:collapse;width:60%"><tbody>${kpi.map(([l,v])=>`<tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold;background:#F1F5F9">${l}</td><td style="padding:6px;border:1px solid #ddd">${v}</td></tr>`).join('')}</tbody></table>
          <h3 style="color:#0F172A;margin-top:20px">Creators</h3>
          <table style="border-collapse:collapse;width:100%"><thead><tr>${headers.map(h=>`<th style="padding:6px;border:1px solid #0F172A;background:#0F172A;color:#fff;font-size:11px;text-align:left">${h}</th>`).join('')}</tr></thead><tbody>${htmlRows}</tbody></table>
        </body></html>`;
        const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${fileBase}.doc`;
        a.click();
        URL.revokeObjectURL(url);
      } else if (format === 'pptx') {
        const PptxGenJS = (await import('pptxgenjs')).default;
        const pres = new PptxGenJS();
        // Slide 1 · Cover
        const s1 = pres.addSlide();
        s1.background = { color: '0F172A' };
        s1.addText('Creator Hub', { x: 0.5, y: 1.8, w: 9, h: 1, fontSize: 44, bold: true, color: 'FFFFFF', align: 'center' });
        s1.addText(title, { x: 0.5, y: 2.8, w: 9, h: 0.6, fontSize: 22, color: '94A3B8', align: 'center' });
        s1.addText(`Generated ${new Date().toLocaleString()}`, { x: 0.5, y: 5, w: 9, h: 0.4, fontSize: 12, color: '64748B', align: 'center' });
        // Slide 2 · KPIs
        const s2 = pres.addSlide();
        s2.addText(title + ' · KPIs', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, bold: true, color: '0F172A' });
        kpi.forEach(([l, v], i) => {
          const x = 0.5 + (i * 2.3); const y = 2;
          s2.addShape(pres.ShapeType.roundRect, { x, y, w: 2.1, h: 1.6, fill: { color: 'F1F5F9' }, line: { color: 'E5EAF2' }, rectRadius: 0.12 });
          s2.addText(String(v), { x: x + 0.1, y: y + 0.25, w: 1.9, h: 0.7, fontSize: 26, bold: true, color: '0F172A', align: 'left' });
          s2.addText(String(l), { x: x + 0.1, y: y + 0.95, w: 1.9, h: 0.4, fontSize: 10, bold: true, color: '64748B', align: 'left' });
        });
        // Slide 3 · Table (first 20 rows)
        const s3 = pres.addSlide();
        s3.addText('Creators', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 22, bold: true, color: '0F172A' });
        const tableData = [headers.map(h => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: '0F172A' } } })),
          ...rows.slice(0, 20).map(r => r.map(c => String(c)))];
        s3.addTable(tableData, { x: 0.3, y: 1, w: 9.4, fontSize: 9, colW: [0.4, 1.5, 1.2, 1, 0.8, 0.9, 0.9, 0.9, 1, 0.9] });
        if (rows.length > 20) s3.addText(`+ ${rows.length - 20} more rows in full data`, { x: 0.5, y: 7, w: 9, h: 0.3, fontSize: 10, color: '94A3B8', align: 'center' });
        await pres.writeFile({ fileName: `${fileBase}.pptx` });
      }
      setMessages(prev => [...prev, { id: Date.now(), from: 'ai', text: `Done! **${title}.${format}** downloaded (${data.length} row${data.length !== 1 ? 's' : ''}).` }]);
    } catch (err) {
      console.error('Report generation failed:', err);
      setMessages(prev => [...prev, { id: Date.now(), from: 'ai', text: `Sorry, I couldn't generate the ${format.toUpperCase()} · ${err.message || 'unknown error'}.` }]);
    }
  }

  function handleSubmit(text) {
    const query = (text || input).trim();
    if (!query) return;
    const userMsg = { id: Date.now(), from: 'user', text: query };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setThinking(true);

    setTimeout(() => {
      const response = runQuery(query);
      // Rehydrate onClick handlers
      if (response.action?._kind === 'compare') response.action.onClick = onOpenCompare;
      if (response.action?._kind === 'leaderboard') response.action.onClick = onOpenLeaderboard;
      if (response.list) response.listClick = onOpenCreator;
      setMessages(prev => [...prev, { id: Date.now() + 1, from: 'ai', ...response }]);
      setThinking(false);
    }, 420);
  }

  // ── Urdu / Roman-Urdu translation layer ──
  function normalizeUrdu(text) {
    let t = ' ' + text + ' ';
    // Phrase-level first (longest-match)
    const PHRASES = [
      [/\b(kia haal|kya haal|kaisy ho|kesy ho|kaise ho|kese ho|how are you)\b/gi, ' hi '],
      [/\b(bata sakte ho|btaa sakty ho|btaa do|bataa do|bta do|btao|bata do|btaao|bata do na|batao na|tell me|pta kro|pta chaly|pta chale|pata kro)\b/gi, ' tell '],
      [/\b(dekha do|dikha do|dakha do|dakha dain|dakha sky|dekhao|dikhao|show kro|show kr do|show me)\b/gi, ' show '],
      [/\b(kr skty ho|kr sakte ho|kr skty|ho sakta|can you|could you|please)\b/gi, ' '],
      [/\b(mil skti|mil sakti|mil jaye|milegi|mil jaye gi)\b/gi, ' get '],
      [/\b(kr do|krdo|kardo|kar do|kr dain|kr den)\b/gi, ' do '],
      [/\b(me bta do|mujhe btaao|mujhe batao|mujhe btao|mujhe bta do)\b/gi, ' tell '],
      [/\b(jo b han|jo bhi han|jo hain|jitne b|jitny b|jitne bhi|sary|sb kuch)\b/gi, ' all '],
      [/\b(ka data|ki list|ki report|ki info|ke baary me|ke barre me|ke bare mein|ka info|ki detail|ki details)\b/gi, ' info '],
      [/\b(kya hai|kya ha|kia hai|kia ha|kya han|kia han|what is|what are)\b/gi, ' what '],
      [/\b(yaar|yar|bro|brother|bhai|boss|sir|dude|man)\b/gi, ' '],
      [/\b(thora|thoda|zara|zra|zarra|bit|little|kuch)\b/gi, ' '],
      [/\b(theek hai|thik hai|thk hai|thk ha|ok|okay)\b/gi, ' '],
      [/\b(pls|plz|please)\b/gi, ' '],
    ];
    for (const [re, repl] of PHRASES) t = t.replace(re, repl);

    const MAP = [
      // Question words
      [/\b(kitne|kitny|kitna|kitni|kitney|kitani|kitnay|how many|how much)\b/gi, ' count '],
      [/\b(kon|kaun|kaunsa|konsa|konsi|konse|who|jo|jis ne|jisne|kon kon)\b/gi, ' who '],
      [/\b(kya|kiya|kia|what)\b/gi, ' what '],
      [/\b(kahan|kahaan|where)\b/gi, ' where '],
      [/\b(kab|kab tak|when)\b/gi, ' when '],
      [/\b(kyun|kyon|why)\b/gi, ' why '],
      [/\b(kesy|kaise|how)\b/gi, ' how '],
      // Actions
      [/\b(dakhao|dakhaao|dakho|dekho|dikhao|dikha|show|view|display|see)\b/gi, ' show '],
      [/\b(batao|btao|bta|tell|explain|inform)\b/gi, ' tell '],
      [/\b(mujhe|mujhey|me ny|me ne|mera|meri|mery|mere|mujhay)\b/gi, ' '],
      [/\b(chahie|chahiye|chahi|chhiye|chaahiye|need|want)\b/gi, ' need '],
      [/\b(dena|give|send|bhejo|bhej do)\b/gi, ' give '],
      // Payment
      [/\b(paisay|paisy|paise|paisa|rupay|rupee|money|amount|dollars?|\$)\b/gi, ' money '],
      [/\b(udhar|udhaar|baqaya|bakaya|owe|owed|due|baki|pending payment|nai mily|ni mily|nahi mily|nae mily|nahi dey|nahi dia|nai dia|nae dia)\b/gi, ' unpaid '],
      [/\b(paid|de dieay|de dieye|de dia|mil gay|mil gaye|mil gai|paisy mil|paisay mil|paise mil|pay ho gya|payment ho gya|ada ho gya)\b/gi, ' paid '],
      [/\b(paisa nahi|paisa nae|paisa ni|payment nahi|payment ni|payment nae|pending|pay nahi)\b/gi, ' unpaid '],
      [/\b(kul paisa|total money|total amount|kitna paisa|sum|allocated)\b/gi, ' allocated '],
      // Videos / delivery
      [/\b(video nahi|video ni|video nae|incomplete|adhura|adhoora|pending video|banaya nahi|banaya nae|banai nahi|banai nae|banai ni)\b/gi, ' not delivered '],
      [/\b(video khatm|video ho gya|video done|videos khatm|khatm|ho gya|ho gai|bn gya|bn gai|bana di|bana dia|banai|banaya|delivered|deliver|complete|poora|pora)\b/gi, ' delivered '],
      [/\b(chal raha|chal rahi|working|progress|banaa raha|bnaa raha|ban raha|ban rahi|in progress)\b/gi, ' in progress '],
      // Deadlines / time
      [/\b(deadline khatm|time khatm|guzar gaya|guzr gya|guzar|guzr|over|late|der ho|der ho gai|late ho gya|miss ho gya|overdue)\b/gi, ' overdue '],
      [/\b(is hafty|is haftay|iss hafte|iss haftay|this week|hafte me)\b/gi, ' this week '],
      [/\b(is mahiny|is maheenay|is month|iss month|this month|ess maheenay|iss mahine|is mahine)\b/gi, ' this month '],
      [/\b(pichla mahina|pichly mahinay|last month|gzra mahina|pichlay month|pichlay mahine|pichla month)\b/gi, ' last month '],
      [/\b(aj|aaj|ajj|today|aaj ka|aj ka)\b/gi, ' today '],
      [/\b(kal|yesterday|tomorrow)\b/gi, ' yesterday '],
      [/\b(jaldi|soon|upcoming|next|agla|aglay)\b/gi, ' upcoming '],
      // Scope
      [/\b(sara|saary|saari|saarey|sare|sab|sb|sari|all|every|har|hr|poora|poori|pora)\b/gi, ' all '],
      [/\b(sirf|sirif|only|bs|bas|just|simply)\b/gi, ' only '],
      [/\b(nahi|nae|ni|no|bilkul nae|not|nhi|nai)\b/gi, ' no '],
      [/\b(han|haan|haa|yes|jee|ji|bilkul)\b/gi, ' yes '],
      // Contact
      [/\b(email nahi|no email|email ni|bina email|without email|email ni ha)\b/gi, ' no email '],
      [/\b(whatsapp nahi|no whatsapp|whatsapp ni|bina whatsapp|number nahi|number ni|phone nahi)\b/gi, ' no whatsapp '],
      [/\b(contact nahi|no contact|contact ni|koi contact nae)\b/gi, ' no contact '],
      // Entities
      [/\b(creator|creators|banda|bandy|bande|log|logon|people|person|aadmi)\b/gi, ' creator '],
      [/\b(brand|brands|company|companies|firm)\b/gi, ' brand '],
      [/\b(deal|deals|contract|sauda|order|ordaar)\b/gi, ' deal '],
      // Superlatives
      [/\b(sab se acha|sab se behtr|sab se bara|sab se barra|sab se zyada|top|barra|bara|highest|sb se|sabse|best|max|maximum|bohat|bhot)\b/gi, ' top '],
      [/\b(kam|kum|lowest|sb se kam|sab se kam|minimum|min)\b/gi, ' lowest '],
      // Compare
      [/\b(compare|muqabala|muqabla|vs|versus|fark|difference)\b/gi, ' compare '],
      // Leaderboard
      [/\b(leaderboard|ranking|rankings|board|standings|team.*performance|positions)\b/gi, ' leaderboard '],
      // Retainer
      [/\b(retainer|retainers|regular|repeat|wapis|purany|purana|old customer|returning)\b/gi, ' retainer '],
      // Average
      [/\b(average|avg|awsat|normal|typical|mean)\b/gi, ' average '],
      // Report
      [/\b(report|reports|file|sheet|document)\b/gi, ' report '],
      [/\b(download|export|save|dl|niklo)\b/gi, ' download '],
      [/\b(bnaa|banaao|banao|bnaa do|generate|create|bna do)\b/gi, ' create '],
      // Greetings + thanks
      [/\b(salam|assalam|adab|hi|hello|hey|hola|namaste)\b/gi, ' hi '],
      [/\b(shukriya|thank you|thanks|thnx|thx|shukria)\b/gi, ' thanks '],
      // Fillers
      [/\b(yeh|ye|wo|woh|is ki|is ka|un ki|un ka|is me|us me|in me|ab|phr|fir|then|kabhi|kahin)\b/gi, ' '],
    ];
    for (const [re, repl] of MAP) t = t.replace(re, repl);
    return t.replace(/\s+/g, ' ').trim();
  }

  function runQuery(q) {
    const raw = q.toLowerCase().trim();
    const lower = normalizeUrdu(raw);

    // Help / what can you do
    if (lower === 'help' || lower === '?' || lower.includes('what can you') || lower.includes('capabilities') || raw.includes('madad')) {
      return {
        text: "Here's a quick snapshot of your workspace. You can ask me anything in English or Urdu · or request reports.",
        stats: [
          { l: 'Unique Creators', v: uniqueCreatorCount },
          { l: 'Total Deals',     v: creators.length },
          { l: 'Brands',          v: allBrands.length },
          { l: 'Paid Deals',      v: creators.filter(c => c.payment_status === 'Paid').length },
        ],
        suggestions: [
          'Unpaid creators',
          'Top 10 deals',
          'Hired by Emily',
          'Overdue',
          'This month stats',
          'Retainers',
          'Missing email',
          'Avg deal size',
          'Export this month as PDF',
          'Download report',
        ],
      };
    }

    // Greeting
    if (/^(hi|hello|hey|salam|assalam|yo|hola)\b/i.test(lower)) {
      return { text: 'Hey! What do you need? Ask about creators, deals, brands, or team.', suggestions: ['Unpaid', 'Top 5 deals', 'This month'] };
    }
    if (lower.includes('thank')) {
      return { text: "You're welcome! Anything else?" };
    }

    // Compare brands
    if (/\bcompar/.test(lower)) {
      return { text: 'Opening Brand Comparison…', action: { label: 'Open Compare', _kind: 'compare' } };
    }

    // Leaderboard / rankings / team performance
    if (/leaderboard|top team|ranking|best performer|team performance|who.*best/.test(lower)) {
      return { text: 'Here is the team leaderboard.', action: { label: 'Open Leaderboard', _kind: 'leaderboard' } };
    }

    // ── Total counts / how many ──
    if (/how many|count|total/.test(lower)) {
      if (lower.includes('creator')) return {
        text: `You have ${uniqueCreatorCount} unique creator${uniqueCreatorCount !== 1 ? 's' : ''} (across ${creators.length} deal${creators.length !== 1 ? 's' : ''}).`,
        stats: [
          { l: 'Unique Creators', v: uniqueCreatorCount },
          { l: 'Total Deals',     v: creators.length },
        ],
      };
      if (lower.includes('brand'))   return numberAnswer('Total brands',   allBrands.length);
      if (lower.includes('deal'))    return numberAnswer('Total deals',    creators.length);
      if (lower.includes('paid'))    return numberAnswer('Paid deals',     creators.filter(c => c.payment_status === 'Paid').length);
      if (lower.includes('unpaid') || lower.includes('pending'))
        return numberAnswer('Unpaid deals', creators.filter(c => c.payment_status !== 'Paid').length);
      if (lower.includes('delivered') || lower.includes('done'))
        return numberAnswer('Delivered deals', creators.filter(c => c.videos === 'Done').length);
    }

    // ── Sensitive queries (superadmin only) ──
    if (/password|credential|secret|login|email address|contact of|contact for/.test(lower) ||
        (lower.includes('user') && (lower.includes('list') || lower.includes('all users') || lower.includes('show users')))) {
      if (!isSuperAdmin) {
        return {
          text: "Sorry · sensitive information like passwords, user credentials and account details are restricted. Only Asad (superadmin) can access this.",
          suggestions: ['Unpaid creators', 'Top 5 deals', 'This month'],
        };
      }
      // Superadmin can see user list
      if (lower.includes('user') || lower.includes('all users') || lower.includes('list users')) {
        return {
          text: "I can't query the users table directly from here for safety · use Settings → User Management for the full list.",
          action: { label: 'Open User Management', _kind: 'users' },
        };
      }
    }

    // ── Report generation ──
    if (/report|download|export|excel|xlsx|pdf|powerpoint|pptx|word|docx/.test(lower)) {
      const fmt = lower.includes('pdf') ? 'pdf'
                : lower.includes('xlsx') || lower.includes('excel') ? 'xlsx'
                : lower.includes('pptx') || lower.includes('powerpoint') ? 'pptx'
                : lower.includes('docx') || lower.includes('word') ? 'docx'
                : null;
      const scope = lower.includes('unpaid') ? 'unpaid'
                  : lower.includes('paid') ? 'paid'
                  : lower.includes('overdue') ? 'overdue'
                  : lower.includes('this month') ? 'month'
                  : 'all';
      const title = scope === 'unpaid' ? 'Unpaid Creators'
                  : scope === 'paid' ? 'Paid Creators'
                  : scope === 'overdue' ? 'Overdue Deliverables'
                  : scope === 'month' ? 'This Month Report'
                  : 'Full Creator Report';
      if (fmt) {
        return {
          text: `Ready to generate **${title}** as ${fmt.toUpperCase()}. I'll download it when you click below.`,
          reportReady: { scope, format: fmt, title },
        };
      }
      return {
        text: `Sure · what format for the **${title}**? Pick one:`,
        reportChoice: { scope, title },
      };
    }

    // Unpaid / not paid / pending payment
    if (/unpaid|not paid|pending payment|payment due|owe/.test(lower)) {
      const list = creators.filter(c => c.payment_status !== 'Paid');
      const total = list.reduce((s, c) => s + (parseDeal(c.deal).amount || 0), 0);
      return formatCreatorList(`${list.length} unpaid · $${total.toLocaleString()} outstanding`, list);
    }

    // Paid this month
    if (/paid/.test(lower) && /this month|current month/.test(lower)) {
      const monthKey = shopMonthKey();
      const list = creators.filter(c => c.payment_status === 'Paid' && c.hiring_date?.startsWith(monthKey));
      const total = list.reduce((s, c) => s + (parseDeal(c.deal).amount || 0), 0);
      return { text: `${list.length} creators paid this month · $${total.toLocaleString()}`, list: list.slice(0, 12).map(creatorSummary), more: Math.max(list.length - 12, 0) };
    }

    // All paid creators
    if (/^(who|show).*paid/.test(lower) || /paid creators/.test(lower)) {
      const list = creators.filter(c => c.payment_status === 'Paid');
      return formatCreatorList(`${list.length} paid creators`, list);
    }

    // Overdue deadlines
    if (/overdue|late|past deadline|missed/.test(lower)) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const list = creators.filter(c => c.deadline && new Date(c.deadline) < today && c.videos !== 'Done');
      return formatCreatorList(`${list.length} overdue deliverable${list.length !== 1 ? 's' : ''}`, list);
    }

    // Deadline soon (next 7 days)
    if (/upcoming|soon|next week|deadline.*soon|due soon/.test(lower)) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
      const list = creators.filter(c => c.deadline && new Date(c.deadline) >= today && new Date(c.deadline) <= in7 && c.videos !== 'Done');
      return formatCreatorList(`${list.length} due within 7 days`, list);
    }

    // Deadlines in general
    if (/deadline/.test(lower)) {
      const list = creators.filter(c => c.deadline && c.videos !== 'Done').sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
      return formatCreatorList(`${list.length} active deadlines`, list);
    }

    // Top N by amount / value / deal
    const topMatch = lower.match(/top\s*(\d+)?/);
    if (topMatch) {
      const n = parseInt(topMatch[1], 10) || 5;
      const list = [...creators].sort((a, b) => (parseDeal(b.deal).amount || 0) - (parseDeal(a.deal).amount || 0)).slice(0, n);
      return formatCreatorList(`Top ${n} by deal value`, list);
    }

    // Retainers (4+ deals with same name)
    if (/retain|repeat|return|loyal|regular/.test(lower)) {
      const counts = {};
      creators.forEach(c => {
        const k = (c.name || '').trim().toLowerCase();
        if (k) counts[k] = (counts[k] || 0) + 1;
      });
      const retainerNames = Object.keys(counts).filter(n => counts[n] >= 4);
      const list = creators.filter(c => retainerNames.includes((c.name || '').trim().toLowerCase()));
      // Unique by name
      const seen = new Set();
      const unique = list.filter(c => {
        const k = (c.name || '').trim().toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return formatCreatorList(`${unique.length} retainer${unique.length !== 1 ? 's' : ''} (4+ deals)`, unique);
    }

    // Missing contact info
    if (/(missing|no|without)\s+(email|whatsapp|contact|phone|paypal|zelle)/.test(lower)) {
      let list = [];
      let label = '';
      if (lower.includes('email')) { list = creators.filter(c => !c.email); label = 'no email'; }
      else if (lower.includes('whatsapp') || lower.includes('phone')) { list = creators.filter(c => !c.whatsapp_number); label = 'no WhatsApp'; }
      else if (lower.includes('paypal')) { list = creators.filter(c => !c.paypal); label = 'no PayPal'; }
      else if (lower.includes('zelle')) { list = creators.filter(c => !c.zelle); label = 'no Zelle'; }
      else { list = creators.filter(c => !c.email && !c.whatsapp_number); label = 'no contact info'; }
      return formatCreatorList(`${list.length} with ${label}`, list);
    }

    // Hired by dynamic · matches ANY known team member name
    const hbMatch = lower.match(/(?:hired by|by|from|ka banda)\s+([a-zA-Z]+)/);
    let memberNameHit = null;
    if (hbMatch) {
      const who = hbMatch[1];
      memberNameHit = vocabulary.hiredByOrig.find(n => n.toLowerCase() === who.toLowerCase()) ||
                      vocabulary.hiredByOrig.find(n => n.toLowerCase().includes(who.toLowerCase()));
    } else {
      // Check if any known team member is simply mentioned in the query
      memberNameHit = vocabulary.hiredByOrig.find(n => {
        const nl = n.toLowerCase();
        return new RegExp(`\\b${nl}\\b`, 'i').test(lower);
      });
    }
    if (memberNameHit) {
      const list = creators.filter(c => (c.hired_by || '').toLowerCase() === memberNameHit.toLowerCase());
      const total = list.reduce((s, c) => s + (parseDeal(c.deal).amount || 0), 0);
      const paid = list.filter(c => c.payment_status === 'Paid').length;
      return {
        text: `${memberNameHit} · ${list.length} creator${list.length !== 1 ? 's' : ''} · $${total.toLocaleString()}`,
        stats: [
          { l: 'Deals',      v: list.length },
          { l: 'Allocated', v: `$${total.toLocaleString()}` },
          { l: 'Paid',       v: paid },
          { l: 'Pending',    v: list.length - paid },
        ],
        list: list.slice(0, 10).map(creatorSummary),
        more: Math.max(list.length - 10, 0),
      };
    }

    // Brand dynamic · matches any known brand from data
    const brandMatch = vocabulary.brandsOrig.find(b => {
      const bl = b.toLowerCase();
      return new RegExp(`\\b${bl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower);
    });
    if (brandMatch) {
      const list = creators.filter(c => c.brand === brandMatch);
      const total = list.reduce((s, c) => s + (parseDeal(c.deal).amount || 0), 0);
      const paid = list.filter(c => c.payment_status === 'Paid').length;
      const delivered = list.filter(c => c.videos === 'Done').length;
      return {
        text: `${brandMatch} · ${list.length} creator${list.length !== 1 ? 's' : ''}`,
        stats: [
          { l: 'Creators',   v: list.length },
          { l: 'Allocated', v: `$${total.toLocaleString()}` },
          { l: 'Paid',       v: paid },
          { l: 'Delivered',  v: delivered },
        ],
        list: list.slice(0, 10).map(creatorSummary),
        more: Math.max(list.length - 10, 0),
      };
    }

    // Top brands by deal count
    if (/top brand|best brand|by brand|brands? overview|brands? breakdown/.test(lower)) {
      const counts = {};
      const totals = {};
      creators.forEach(c => {
        if (!c.brand) return;
        counts[c.brand] = (counts[c.brand] || 0) + 1;
        totals[c.brand] = (totals[c.brand] || 0) + (parseDeal(c.deal).amount || 0);
      });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      return {
        text: 'Top brands by deal count',
        stats: sorted.map(([b, n]) => ({ l: b, v: `${n} · $${(totals[b] || 0).toLocaleString()}` })),
      };
    }

    // Avg deal size
    if (/avg|average|mean.*deal|deal size/.test(lower)) {
      const amounts = creators.map(c => parseDeal(c.deal).amount || 0).filter(n => n > 0);
      const avg = amounts.length ? Math.round(amounts.reduce((s, n) => s + n, 0) / amounts.length) : 0;
      const max = amounts.length ? Math.max(...amounts) : 0;
      const min = amounts.length ? Math.min(...amounts) : 0;
      return {
        text: 'Deal value statistics',
        stats: [
          { l: 'Average', v: `$${avg.toLocaleString()}` },
          { l: 'Highest', v: `$${max.toLocaleString()}` },
          { l: 'Lowest',  v: `$${min.toLocaleString()}` },
          { l: 'Count',   v: amounts.length },
        ],
      };
    }

    // Category · dynamic
    const categoryMatch = vocabulary.categoriesOrig.find(c => {
      const cl = c.toLowerCase();
      return new RegExp(`\\b${cl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower);
    });
    if (categoryMatch && (lower.includes('category') || lower.includes('niche'))) {
      const list = creators.filter(c => c.category === categoryMatch);
      return formatCreatorList(`${list.length} in "${categoryMatch}" category`, list);
    }
    if (lower.includes('all categories') || lower.includes('categories breakdown') || lower.includes('niches')) {
      const breakdown = {};
      creators.forEach(c => { if (c.category) breakdown[c.category] = (breakdown[c.category] || 0) + 1; });
      const sorted = Object.entries(breakdown).sort((a,b) => b[1] - a[1]);
      return { text: 'Categories breakdown', stats: sorted.map(([k, v]) => ({ l: k, v })) };
    }

    // Product · dynamic
    const productMatch = vocabulary.productsOrig.find(p => {
      const pl = p.toLowerCase();
      return new RegExp(`\\b${pl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower);
    });
    if (productMatch && (lower.includes('product'))) {
      const list = creators.filter(c => c.product === productMatch);
      return formatCreatorList(`${list.length} for product "${productMatch}"`, list);
    }

    // Payment method breakdown
    if (/paypal/.test(lower)) {
      const list = creators.filter(c => c.paypal);
      return formatCreatorList(`${list.length} with PayPal`, list);
    }
    if (/zelle/.test(lower)) {
      const list = creators.filter(c => c.zelle);
      return formatCreatorList(`${list.length} with Zelle`, list);
    }

    // Specific creator detail · if name is in query, show full detail
    const creatorHit = vocabulary.creatorNamesOrig.find(n => {
      if (!n || n.length < 3) return false;
      return raw.toLowerCase().includes(n.toLowerCase());
    });
    if (creatorHit) {
      const matches = creators.filter(c => (c.name || '').toLowerCase() === creatorHit.toLowerCase());
      if (matches.length === 1) {
        const c = matches[0];
        const { amount, videos } = parseDeal(c.deal);
        const dealsCount = creators.filter(x => (x.name || '').toLowerCase() === creatorHit.toLowerCase()).length;
        return {
          text: `${c.name} · ${c.brand || 'No brand'} · ${c.hired_by || 'Unassigned'}`,
          stats: [
            { l: 'Deal',       v: amount > 0 ? `$${amount.toLocaleString()}` : '-' },
            { l: 'Videos',     v: videos || 0 },
            { l: 'Payment',    v: c.payment_status || '-' },
            { l: 'Status',     v: c.videos || '-' },
          ],
          list: [creatorSummary(c)],
          ...(dealsCount > 1 ? { text: `${c.name} · has ${dealsCount} deals total` } : {}),
        };
      } else if (matches.length > 1) {
        return formatCreatorList(`${matches.length} deals for "${creatorHit}"`, matches);
      }
    }

    // Videos done / in progress / not started
    if (/videos? done|delivered|completed/.test(lower)) {
      const list = creators.filter(c => c.videos === 'Done');
      return formatCreatorList(`${list.length} delivered`, list);
    }
    if (/videos? in progress|in progress|working/.test(lower)) {
      const list = creators.filter(c => c.videos === 'In Progress');
      return formatCreatorList(`${list.length} in progress`, list);
    }
    if (/not started|pending video/.test(lower)) {
      const list = creators.filter(c => !c.videos || (c.videos !== 'Done' && c.videos !== 'In Progress'));
      return formatCreatorList(`${list.length} not started`, list);
    }

    // Recent additions
    if (/recent|new|latest|added/.test(lower)) {
      const sorted = [...creators].sort((a, b) => new Date(b.hiring_date || 0) - new Date(a.hiring_date || 0)).slice(0, 10);
      return formatCreatorList('Latest 10 additions', sorted);
    }

    // This month stats / summary
    if (/this month|month stat|month summary|month.*overview/.test(lower)) {
      const monthKey = shopMonthKey();
      const thisMonth = creators.filter(c => c.hiring_date?.startsWith(monthKey));
      const total = thisMonth.reduce((s, c) => s + (parseDeal(c.deal).amount || 0), 0);
      const paid = thisMonth.filter(c => c.payment_status === 'Paid').length;
      const delivered = thisMonth.filter(c => c.videos === 'Done').length;
      return {
        text: 'This month at a glance',
        stats: [
          { l: 'New Deals',  v: thisMonth.length },
          { l: 'Allocated', v: `$${total.toLocaleString()}` },
          { l: 'Paid',       v: paid },
          { l: 'Delivered',  v: delivered },
        ]
      };
    }

    // Last month
    if (/last month|previous month/.test(lower)) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
      const monthKey = d.toISOString().slice(0, 7);
      const last = creators.filter(c => c.hiring_date?.startsWith(monthKey));
      const total = last.reduce((s, c) => s + (parseDeal(c.deal).amount || 0), 0);
      const paid = last.filter(c => c.payment_status === 'Paid').length;
      return {
        text: 'Last month',
        stats: [
          { l: 'Deals',      v: last.length },
          { l: 'Allocated', v: `$${total.toLocaleString()}` },
          { l: 'Paid',       v: paid },
          { l: 'Delivered',  v: last.filter(c => c.videos === 'Done').length },
        ],
      };
    }

    // Fuzzy name search · if all else fails
    const nameMatches = creators.filter(c => c.name?.toLowerCase().includes(lower));
    if (nameMatches.length > 0) {
      return formatCreatorList(`${nameMatches.length} creator${nameMatches.length !== 1 ? 's' : ''} matching "${q}"`, nameMatches);
    }

    // TikTok handle search
    if (lower.includes('@')) {
      const handle = lower.replace(/^@/, '');
      const list = creators.filter(c => (c.tiktok_account || '').toLowerCase().includes(handle));
      if (list.length > 0) return formatCreatorList(`${list.length} matching @${handle}`, list);
    }

    // Default fallback
    return {
      text: "Hmm, I didn't quite catch that. Try one of these, or type 'help' for all commands:",
      suggestions: ['Unpaid', 'Top 10 deals', 'Overdue', 'This month', 'Retainers', 'Missing email', 'Avg deal', 'By brand'],
    };
  }

  function numberAnswer(label, val) {
    return { text: `${label}: ${val}`, stats: [{ l: label, v: String(val) }] };
  }

  function formatCreatorList(headline, list) {
    if (list.length === 0) return { text: `${headline} · nothing matches.` };
    return {
      text: headline,
      list: list.slice(0, 12).map(creatorSummary),
      more: Math.max(list.length - 12, 0),
    };
  }

  function creatorSummary(c) {
    const { amount } = parseDeal(c.deal);
    return {
      id: c.id,
      name: c.name || 'Unnamed',
      brand: c.brand,
      amount,
      paid: c.payment_status === 'Paid',
      video: c.videos === 'Done',
      _raw: c,
    };
  }

  const QUICK = [
    'Unpaid',
    'Top 5 deals',
    'Overdue',
    'This month',
    'Retainers',
    'Missing email',
    'Leaderboard',
  ];

  return (
    <div className={`ai-panel${maximized ? ' ai-panel-max' : ''}`}>
      <div className="ai-head">
        <div className="ai-head-l">
          <div className="ai-head-av">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.5 3 3.5.5-2.5 2.5.5 3.5L12 10l-3 1.5.5-3.5L7 5.5 10.5 5z"/></svg>
          </div>
          <div>
            <div className="ai-title">Creator Hub AI</div>
            <div className="ai-status"><span className="ai-status-dot" />{thinking ? 'Thinking…' : `${messages.length - 1} message${messages.length - 1 !== 1 ? 's' : ''}`}</div>
          </div>
        </div>
        <div className="ai-head-r">
          <button className="ai-icon-btn" onClick={newChat} title="New chat" aria-label="New chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button className="ai-icon-btn" onClick={() => setMaximized(m => !m)} title={maximized ? 'Restore' : 'Maximize'} aria-label={maximized ? 'Restore' : 'Maximize'}>
            {maximized ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            )}
          </button>
          <button className="ai-icon-btn" onClick={onClose} title="Minimize" aria-label="Minimize">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button className="ai-icon-btn" onClick={onClose} title="Close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <div className="ai-body" ref={scrollRef}>
        {messages.map(m => (
          <div key={m.id} className={`ai-msg ai-msg-${m.from}`}>
            {m.from === 'ai' && (
              <div className="ai-msg-av">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.5 3 3.5.5-2.5 2.5.5 3.5L12 10l-3 1.5.5-3.5L7 5.5 10.5 5z"/></svg>
              </div>
            )}
            <div className="ai-msg-body">
              <div className="ai-msg-text">{m.text}</div>
              {m.stats && (
                <div className="ai-stats-grid">
                  {m.stats.map(s => (
                    <div key={s.l} className="ai-stat">
                      <div className="ai-stat-v">{s.v}</div>
                      <div className="ai-stat-l">{s.l}</div>
                    </div>
                  ))}
                </div>
              )}
              {m.list && (
                <div className="ai-list">
                  {m.list.map(item => (
                    <button key={item.id} className="ai-list-row" onClick={() => m.listClick?.(item._raw)}>
                      <div className="ai-list-av" style={{ background: getGradient(item.name) }}>
                        {item.name[0]?.toUpperCase()}
                      </div>
                      <div className="ai-list-info">
                        <div className="ai-list-name">{item.name}</div>
                        <div className="ai-list-sub">
                          {item.brand && <span>{item.brand}</span>}
                          {item.amount > 0 && <>{item.brand && <span className="ai-dot">·</span>}<span>${item.amount.toLocaleString()}</span></>}
                        </div>
                      </div>
                      <div className="ai-list-pills">
                        {item.paid && <span className="ai-pill ai-pill-paid">Paid</span>}
                        {item.video && <span className="ai-pill ai-pill-done">✓</span>}
                      </div>
                    </button>
                  ))}
                  {m.more > 0 && <div className="ai-list-more">+ {m.more} more…</div>}
                </div>
              )}
              {m.action && (
                <button className="ai-action-btn" onClick={m.action.onClick}>
                  {m.action.label}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              )}
              {m.reportReady && (
                <button className="ai-report-btn" onClick={() => downloadReport(m.reportReady)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download {m.reportReady.format.toUpperCase()}
                </button>
              )}
              {m.reportChoice && (
                <div className="ai-report-grid">
                  {[
                    { f: 'pdf',  l: 'PDF',   ic: '📄' },
                    { f: 'xlsx', l: 'Excel', ic: '📊' },
                    { f: 'docx', l: 'Word',  ic: '📝' },
                    { f: 'pptx', l: 'PPT',   ic: '🎯' },
                  ].map(opt => (
                    <button key={opt.f} className="ai-report-card" onClick={() => downloadReport({ ...m.reportChoice, format: opt.f })}>
                      <span className="ai-report-ic">{opt.ic}</span>
                      <span className="ai-report-l">{opt.l}</span>
                    </button>
                  ))}
                </div>
              )}
              {m.suggestions && (
                <div className="ai-chips">
                  {m.suggestions.map(s => (
                    <button key={s} className="ai-chip" onClick={() => handleSubmit(s)}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="ai-msg ai-msg-ai">
            <div className="ai-msg-av">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.5 3 3.5.5-2.5 2.5.5 3.5L12 10l-3 1.5.5-3.5L7 5.5 10.5 5z"/></svg>
            </div>
            <div className="ai-msg-body">
              <div className="ai-msg-text ai-typing">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="ai-quick">
        {QUICK.map(q => (
          <button key={q} className="ai-quick-btn" onClick={() => handleSubmit(q)}>{q}</button>
        ))}
      </div>

      <form className="ai-input-row" onSubmit={e => { e.preventDefault(); handleSubmit(); }}>
        <input
          className="ai-input"
          placeholder="Ask me anything…"
          value={input}
          onChange={e => setInput(e.target.value)}
          autoFocus
        />
        <button className="ai-send" type="submit" disabled={!input.trim()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </form>
    </div>
  );
}

/* ─── BottomSheet ────────────────────────────────────────── */
function BottomSheet({ editCreator, allBrands, onSave, onClose, hiredByTeam, canSetDeadline }) {
  const isEdit = !!editCreator;
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [brandSearch, setBrandSearch] = useState('');
  const [showBrandDrop, setShowBrandDrop] = useState(false);
  const brandRef = useRef(null);
  const debounceRef = useRef(null);

  // Creator name autocomplete
  const [nameSuggestions, setNameSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const [scrapingTT, setScrapingTT] = useState(false);
  const [ttScrapeOk, setTtScrapeOk] = useState(false);
  const suggDebounceRef = useRef(null);
  const nameInputRef = useRef(null);
  const suggestionsRef = useRef(null);

  const initialForm = {
    name: '', tiktok_account: '', tiktok_account_2: '', brand: '', deal: '', hiring_date: '', deadline: '',
    payment_status: '', videos: '', product: '', category: '',
    hired_by: '', whatsapp_number: '', email: '', paypal: '', zelle: '', comments: '',
    ...(editCreator || {}),
  };

  // Normalize tiktok for display
  if (initialForm.tiktok_account) {
    const { handle } = parseTikTok(initialForm.tiktok_account);
    initialForm._tiktokDisplay = handle;
  } else {
    initialForm._tiktokDisplay = '';
  }
  if (initialForm.tiktok_account_2) {
    const { handle } = parseTikTok(initialForm.tiktok_account_2);
    initialForm._tiktokDisplay2 = handle;
  } else {
    initialForm._tiktokDisplay2 = '';
  }

  const [form, setForm] = useState(initialForm);
  const [showSecondTT, setShowSecondTT] = useState(!!initialForm._tiktokDisplay2);

  const steps = [
    { label: 'Identity' },
    { label: 'Deal' },
    { label: 'Contact' },
  ];

  // Auto-fetch category when name/tiktok changes (debounced)
  useEffect(() => {
    if (isEdit) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const name = form.name.trim();
      const tiktok = form._tiktokDisplay.trim();
      if (!name && !tiktok) return;
      const conditions = [];
      if (name) conditions.push(`name.ilike.${name}`);
      if (tiktok) {
        const url = normalizeTikTokForStorage(tiktok);
        conditions.push(`tiktok_account.eq.${url}`);
      }
      if (conditions.length === 0) return;
      const { data } = await supabase
        .from('creators')
        .select('category')
        .or(conditions.join(','))
        .not('name', 'is', null)
        .neq('name', '')
        .limit(1);
      if (data && data.length > 0 && data[0].category) {
        setForm(f => ({ ...f, category: data[0].category }));
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [form.name, form._tiktokDisplay, isEdit]);

  // Fetch name suggestions as user types
  useEffect(() => {
    if (isEdit) return;
    const name = form.name.trim();
    if (!name) { setNameSuggestions([]); setShowSuggestions(false); return; }
    if (suggDebounceRef.current) clearTimeout(suggDebounceRef.current);
    suggDebounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('creators')
        .select('name, tiktok_account, whatsapp_number, email, paypal, zelle, category, product, comments')
        .ilike('name', `%${name}%`)
        .order('name')
        .limit(30);
      if (data && data.length > 0) {
        // Deduplicate by name + tiktok handle · same name with different handles are different people
        const normTT = t => (t || '').toLowerCase().replace(/[@\s]/g, '').replace(/^https?:\/\/(www\.)?tiktok\.com\//, '').replace(/\/.*$/, '');
        const seen = new Set();
        const unique = data.filter(c => {
          const key = c.name.toLowerCase().trim() + '|' + normTT(c.tiktok_account);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 8);
        setNameSuggestions(unique);
        setShowSuggestions(true);
      } else {
        setNameSuggestions([]);
        setShowSuggestions(false);
      }
    }, 280);
    return () => { if (suggDebounceRef.current) clearTimeout(suggDebounceRef.current); };
  }, [form.name, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close suggestions on outside click
  useEffect(() => {
    if (!showSuggestions) return;
    function handler(e) {
      if (
        nameInputRef.current && !nameInputRef.current.contains(e.target) &&
        suggestionsRef.current && !suggestionsRef.current.contains(e.target)
      ) setShowSuggestions(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSuggestions]);

  // Close brand dropdown on outside click
  useEffect(() => {
    if (!showBrandDrop) return;
    function handler(e) {
      if (brandRef.current && !brandRef.current.contains(e.target)) setShowBrandDrop(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showBrandDrop]);

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    if (errors[field]) setErrors(e => ({ ...e, [field]: '' }));
  }

  function applyCreatorTemplate(creator) {
    const { handle } = parseTikTok(creator.tiktok_account);
    setForm(f => ({
      ...f,
      name:            creator.name,
      _tiktokDisplay:  handle || f._tiktokDisplay,
      whatsapp_number: creator.whatsapp_number || f.whatsapp_number,
      email:           creator.email           || f.email,
      paypal:          creator.paypal          || f.paypal,
      zelle:           creator.zelle           || f.zelle,
      category:        creator.category        || f.category,
      product:         creator.product         || f.product,
      comments:        creator.comments        || f.comments,
      // brand / deal / hiring_date / deadline / payment_status / videos / hired_by stay as-is
    }));
    setErrors({});
    setAutoFilled(true);
    setShowSuggestions(false);
    setNameSuggestions([]);
  }

  function validateStep0() {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form._tiktokDisplay.trim()) e.tiktok_account = 'TikTok is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleNext() {
    if (step === 0 && !validateStep0()) return;
    if (step < 2) setStep(s => s + 1);
    else handleSave();
  }

  function handleBack() {
    if (step > 0) setStep(s => s - 1);
    else onClose();
  }

  async function handleSave() {
    const tiktokUrl = normalizeTikTokForStorage(form._tiktokDisplay);
    const tiktokUrl2 = form._tiktokDisplay2 ? normalizeTikTokForStorage(form._tiktokDisplay2) : null;
    const payload = {
      name:           form.name.trim(),
      tiktok_account: tiktokUrl,
      tiktok_account_2: tiktokUrl2,
      brand:          form.brand,
      deal:           form.deal,
      hiring_date:    form.hiring_date || null,
      deadline:       canSetDeadline ? (form.deadline || null) : undefined,
      payment_status: form.payment_status,
      videos:         form.videos,
      product:        form.product,
      category:       form.category,
      hired_by:       form.hired_by,
      whatsapp_number:formatWhatsApp(form.whatsapp_number),
      email:          form.email,
      paypal:         form.paypal,
      zelle:          form.zelle,
      comments:       form.comments,
    };
    onSave(payload, isEdit ? editCreator.id : null);
  }

  const tiktokPreview = parseTikTok(form._tiktokDisplay);
  const filteredBrands = allBrands.filter(b =>
    b.toLowerCase().includes(brandSearch.toLowerCase())
  );

  const brandPickerItems = [
    ...filteredBrands,
    '+ Add new brand',
  ];

  return (
    <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bottom-sheet">
        <div className="sheet-handle-bar"><div className="sheet-handle" /></div>

        <div className="sheet-header">
          <div className="sheet-title">{isEdit ? 'Edit Creator' : 'Add Creator'}</div>
          <div className="sheet-steps">
            {steps.map((s, i) => (
              <React.Fragment key={i}>
                {i > 0 && <div className={`step-divider${i <= step ? ' done' : ''}`} />}
                <span className={`step-circle${i === step ? ' active' : i < step ? ' done' : ''}`}>
                  {i < step ? '✓' : i + 1}
                </span>
                <span className={`step-label${i === step ? ' active' : ''}`}>{s.label}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="sheet-body">
          {step === 0 && (
            <>
              <div className="bs-section">
                <div className="bs-section-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div>
                  <div className="bs-section-title">Basic Info</div>
                  <div className="bs-section-sub">Identify the creator</div>
                </div>
              </div>
              <div className="form-group cs-wrap">
                <label className="form-label required">Name</label>
                <input
                  ref={nameInputRef}
                  className={`form-input${errors.name ? ' error' : ''}`}
                  placeholder="Creator full name"
                  value={form.name}
                  autoComplete="off"
                  onChange={e => { set('name', e.target.value); setAutoFilled(false); }}
                  onFocus={() => { if (nameSuggestions.length > 0) setShowSuggestions(true); }}
                />
                {errors.name && <div className="error-msg">{errors.name}</div>}
                {showSuggestions && nameSuggestions.length > 0 && (
                  <div className="cs-drop" ref={suggestionsRef}>
                    {nameSuggestions.map((c, idx) => {
                      const { handle } = parseTikTok(c.tiktok_account);
                      const av = c.name ? c.name[0].toUpperCase() : '?';
                      return (
                        <div
                          key={idx}
                          className="cs-item"
                          onMouseDown={e => { e.preventDefault(); applyCreatorTemplate(c); }}
                        >
                          <div className="cs-av">{av}</div>
                          <div className="cs-info">
                            <span className="cs-name">{c.name}</span>
                            {handle && <span className="cs-handle">{handle}</span>}
                          </div>
                          <span className="cs-pill">Auto-fill</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {autoFilled && (
                <div className="cs-banner">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Contact info pre-filled. Just add deal &amp; date on the next step
                  <button className="cs-banner-x" onClick={() => setAutoFilled(false)}>×</button>
                </div>
              )}
              <div className="form-group">
                <label className="form-label required">TikTok Account</label>
                <div className="tt-input-row">
                  <input
                    className={`form-input${errors.tiktok_account ? ' error' : ''}`}
                    placeholder="@username or full URL"
                    value={form._tiktokDisplay}
                    onChange={e => set('_tiktokDisplay', e.target.value)}
                    onPaste={async (e) => {
                      const pasted = e.clipboardData.getData('text');
                      if (pasted && (pasted.includes('tiktok.com') || pasted.startsWith('@'))) {
                        e.preventDefault();
                        const { handle } = parseTikTok(pasted);
                        set('_tiktokDisplay', handle || pasted);
                        // Try oEmbed if video URL · get author name
                        if (pasted.includes('/video/') && !form.name) {
                          setScrapingTT(true);
                          try {
                            const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(pasted)}`);
                            if (res.ok) {
                              const data = await res.json();
                              if (data.author_name) {
                                setForm(f => ({ ...f, name: f.name || data.author_name, _tiktokDisplay: handle || pasted, _ttAvatar: data.thumbnail_url || '' }));
                                setTtScrapeOk(true);
                              }
                            }
                          } catch {}
                          setScrapingTT(false);
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="tt-scrape-btn"
                    title="Fetch profile info from URL"
                    disabled={!form._tiktokDisplay || scrapingTT}
                    onClick={async () => {
                      const val = form._tiktokDisplay.trim();
                      if (!val) return;
                      setScrapingTT(true);
                      setTtScrapeOk(false);
                      try {
                        const url = val.includes('tiktok.com') ? val : `https://www.tiktok.com/@${val.replace(/^@/, '')}`;
                        if (url.includes('/video/')) {
                          const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
                          if (res.ok) {
                            const data = await res.json();
                            if (data.author_name) {
                              setForm(f => ({ ...f, name: f.name || data.author_name, _ttAvatar: data.thumbnail_url || '' }));
                              setTtScrapeOk(true);
                            }
                          }
                        } else {
                          const { handle } = parseTikTok(val);
                          if (handle && !form.name) setForm(f => ({ ...f, name: handle.replace('@', '') }));
                          setTtScrapeOk(true);
                        }
                      } catch {}
                      setScrapingTT(false);
                    }}
                  >
                    {scrapingTT ? (
                      <span className="tt-scrape-spin" />
                    ) : ttScrapeOk ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/></svg>
                        Fetch
                      </>
                    )}
                  </button>
                </div>
                {errors.tiktok_account && <div className="error-msg">{errors.tiktok_account}</div>}
                {form._tiktokDisplay && (
                  <div className="tiktok-preview">
                    <span>Preview:</span>
                    <a href={tiktokPreview.url} target="_blank" rel="noopener noreferrer">
                      {tiktokPreview.handle}
                    </a>
                    {ttScrapeOk && <span className="tt-fetched-tag">✓ Fetched</span>}
                  </div>
                )}
                {!showSecondTT && (
                  <button type="button" className="tt-add-second" onClick={() => setShowSecondTT(true)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add another TikTok account
                  </button>
                )}
              </div>
              {showSecondTT && (
                <div className="form-group">
                  <label className="form-label">
                    Secondary TikTok Account
                    <span className="form-label-opt">Optional</span>
                  </label>
                  <div className="tt-input-row">
                    <input
                      className="form-input"
                      placeholder="@username or full URL"
                      value={form._tiktokDisplay2}
                      onChange={e => set('_tiktokDisplay2', e.target.value)}
                      onPaste={e => {
                        const pasted = e.clipboardData.getData('text');
                        if (pasted && pasted.includes('tiktok.com')) {
                          e.preventDefault();
                          const { handle } = parseTikTok(pasted);
                          set('_tiktokDisplay2', handle || pasted);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="tt-remove-second"
                      title="Remove secondary account"
                      onClick={() => { set('_tiktokDisplay2', ''); setShowSecondTT(false); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  {form._tiktokDisplay2 && (() => {
                    const tt2 = parseTikTok(form._tiktokDisplay2);
                    return (
                      <div className="tiktok-preview">
                        <span>Preview:</span>
                        <a href={tt2.url} target="_blank" rel="noopener noreferrer">{tt2.handle}</a>
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <div className="bs-section">
                <div className="bs-section-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                </div>
                <div>
                  <div className="bs-section-title">Deal &amp; Status</div>
                  <div className="bs-section-sub">Brand, payment, videos, hired-by</div>
                </div>
              </div>
              <div className="form-group brand-searchable" ref={brandRef}>
                <label className="form-label">Brand</label>
                <input
                  className="form-input"
                  placeholder="Search or select brand..."
                  value={brandSearch || form.brand}
                  onFocus={() => { setBrandSearch(''); setShowBrandDrop(true); }}
                  onChange={e => { setBrandSearch(e.target.value); setShowBrandDrop(true); }}
                />
                {showBrandDrop && (
                  <div className="brand-dropdown-list">
                    {brandPickerItems.map((b, i) => (
                      <div
                        key={i}
                        className={`brand-dropdown-item${b === '+ Add new brand' ? ' add-new' : ''}`}
                        onMouseDown={() => {
                          if (b === '+ Add new brand') {
                            const newBrand = brandSearch.trim();
                            if (newBrand) set('brand', newBrand);
                          } else {
                            set('brand', b);
                          }
                          setBrandSearch('');
                          setShowBrandDrop(false);
                        }}
                      >{b}</div>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Deal</label>
                  <input className="form-input" placeholder='e.g. $500 for 3 videos' value={form.deal} onChange={e => set('deal', e.target.value)} />
                  {(() => {
                    const { amount, videos } = parseDeal(form.deal);
                    if (amount > 0 && videos > 0) {
                      const rate = Math.round(amount / videos);
                      return (
                        <div className="deal-calc">
                          <span className="deal-calc-pill deal-calc-amt">${amount.toLocaleString()}</span>
                          <span className="deal-calc-div">/</span>
                          <span className="deal-calc-pill deal-calc-vids">{videos} vid{videos > 1 ? 's' : ''}</span>
                          <span className="deal-calc-eq">=</span>
                          <span className="deal-calc-pill deal-calc-rate">${rate}/vid</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div className="form-group">
                  <label className="form-label">Hiring Date</label>
                  <input className="form-input" type="date" value={form.hiring_date || ''} onChange={e => set('hiring_date', e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Payment Status</label>
                <div className="payment-chips">
                  {PAYMENT_OPTIONS.map(opt => {
                    const cls = opt === 'Paid' ? 'selected-paid' : 'selected-notyet';
                    return (
                      <button
                        key={opt}
                        type="button"
                        className={`chip${form.payment_status === opt ? ` ${cls}` : ''}`}
                        onClick={() => set('payment_status', form.payment_status === opt ? '' : opt)}
                      >{opt}</button>
                    );
                  })}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Videos Status</label>
                <div className="videos-chips">
                  {VIDEOS_OPTIONS.map(opt => {
                    const cls = opt === 'Done' ? 'selected-videos' : 'selected-inprogress';
                    return (
                      <button
                        key={opt}
                        type="button"
                        className={`chip${form.videos === opt ? ` ${cls}` : ''}`}
                        onClick={() => set('videos', form.videos === opt ? '' : opt)}
                      >{opt}</button>
                    );
                  })}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Product</label>
                  <input className="form-input" placeholder="Product name" value={form.product} onChange={e => set('product', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <input className="form-input" placeholder="e.g. Skincare" value={form.category} onChange={e => set('category', e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Hired By</label>
                <div className="hired-by-buttons">
                  {hiredByTeam.map(member => {
                    const key = member.name.toLowerCase();
                    return (
                      <button
                        key={member.id}
                        type="button"
                        className={`hired-btn hired-btn-${key}${form.hired_by === member.name ? ' selected' : ''}`}
                        onClick={() => set('hired_by', form.hired_by === member.name ? '' : member.name)}
                      >
                        <span className="hired-btn-avatar" style={{ background: member.bg, color: member.color, fontSize: 11 }}>
                          {member.name[0]}
                        </span>
                        {member.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              {canSetDeadline && (
                <div className="form-group">
                  <label className="form-label">
                    Deadline
                    {form.deadline && new Date(form.deadline) < new Date() && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--wx-danger)', fontWeight: 700 }}>⚠ Overdue</span>
                    )}
                  </label>
                  <input className="form-input" type="date" value={form.deadline || ''}
                    onChange={e => set('deadline', e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="bs-section">
                <div className="bs-section-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                </div>
                <div>
                  <div className="bs-section-title">Contact &amp; Notes</div>
                  <div className="bs-section-sub">How to reach this creator</div>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">WhatsApp</label>
                  <input className="form-input" placeholder="+1 555 000 0000" value={form.whatsapp_number} onChange={e => set('whatsapp_number', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" placeholder="email@example.com" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">PayPal</label>
                  <input className="form-input" placeholder="PayPal username or email" value={form.paypal} onChange={e => set('paypal', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Zelle</label>
                  <input className="form-input" placeholder="Zelle phone or email" value={form.zelle} onChange={e => set('zelle', e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Comments</label>
                <textarea className="form-textarea" placeholder="Any notes..." value={form.comments} onChange={e => set('comments', e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div className="sheet-footer">
          <button className="btn-ghost" onClick={handleBack}>
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          <button
            className="btn-continue"
            onClick={handleNext}
            disabled={step === 0 && !form.name.trim() && !form._tiktokDisplay.trim()}
          >
            {step === 2 ? (isEdit ? 'Save Changes' : 'Add Creator') : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── BottomSheetV2 · Tailwind premium Add/Edit Creator ─── */
function BottomSheetV2({ editCreator, allBrands, onSave, onClose, hiredByTeam, canSetDeadline }) {
  const isEdit = !!editCreator;
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [brandSearch, setBrandSearch] = useState('');
  const [showBrandDrop, setShowBrandDrop] = useState(false);
  const brandRef = useRef(null);
  const debounceRef = useRef(null);

  const [nameSuggestions, setNameSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  const [scrapingTT, setScrapingTT] = useState(false);
  const [ttScrapeOk, setTtScrapeOk] = useState(false);
  const suggDebounceRef = useRef(null);
  const nameInputRef = useRef(null);
  const suggestionsRef = useRef(null);

  const initialForm = {
    name: '', tiktok_account: '', tiktok_account_2: '', brand: '', deal: '', hiring_date: '', deadline: '',
    payment_status: '', videos: '', product: '', category: '',
    hired_by: '', whatsapp_number: '', email: '', paypal: '', zelle: '', comments: '',
    gmv: '', ad_spent: '', total_gmv: '',
    ...(editCreator || {}),
  };
  if (initialForm.tiktok_account) {
    const { handle } = parseTikTok(initialForm.tiktok_account);
    initialForm._tiktokDisplay = handle;
  } else { initialForm._tiktokDisplay = ''; }
  if (initialForm.tiktok_account_2) {
    const { handle } = parseTikTok(initialForm.tiktok_account_2);
    initialForm._tiktokDisplay2 = handle;
  } else { initialForm._tiktokDisplay2 = ''; }
  // Coerce numeric fields to string for input rendering
  if (initialForm.gmv != null && typeof initialForm.gmv !== 'string') initialForm.gmv = String(initialForm.gmv);
  if (initialForm.ad_spent != null && typeof initialForm.ad_spent !== 'string') initialForm.ad_spent = String(initialForm.ad_spent);
  if (initialForm.total_gmv != null && typeof initialForm.total_gmv !== 'string') initialForm.total_gmv = String(initialForm.total_gmv);

  const [form, setForm] = useState(initialForm);
  const [showSecondTT, setShowSecondTT] = useState(!!initialForm._tiktokDisplay2);

  const steps = [
    { label: 'Identity', sub: 'Who is this creator?', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
    { label: 'Deal',     sub: 'Brand, payment, performance',  icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
    { label: 'Contact',  sub: 'Reach + payment info',    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> },
  ];

  useEffect(() => {
    if (isEdit) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const name = form.name.trim();
      const tiktok = form._tiktokDisplay.trim();
      if (!name && !tiktok) return;
      const conditions = [];
      if (name) conditions.push(`name.ilike.${name}`);
      if (tiktok) {
        const url = normalizeTikTokForStorage(tiktok);
        conditions.push(`tiktok_account.eq.${url}`);
      }
      if (conditions.length === 0) return;
      const { data } = await supabase.from('creators').select('category').or(conditions.join(','))
        .not('name', 'is', null).neq('name', '').limit(1);
      if (data && data.length > 0 && data[0].category) {
        setForm(f => ({ ...f, category: data[0].category }));
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [form.name, form._tiktokDisplay, isEdit]);

  useEffect(() => {
    if (isEdit) return;
    const name = form.name.trim();
    if (!name) { setNameSuggestions([]); setShowSuggestions(false); return; }
    if (suggDebounceRef.current) clearTimeout(suggDebounceRef.current);
    suggDebounceRef.current = setTimeout(async () => {
      const { data } = await supabase.from('creators')
        .select('name, tiktok_account, whatsapp_number, email, paypal, zelle, category, product, comments')
        .ilike('name', `%${name}%`).order('name').limit(30);
      if (data && data.length > 0) {
        const normTT = t => (t || '').toLowerCase().replace(/[@\s]/g, '').replace(/^https?:\/\/(www\.)?tiktok\.com\//, '').replace(/\/.*$/, '');
        const seen = new Set();
        const unique = data.filter(c => {
          const key = c.name.toLowerCase().trim() + '|' + normTT(c.tiktok_account);
          if (seen.has(key)) return false;
          seen.add(key); return true;
        }).slice(0, 8);
        setNameSuggestions(unique); setShowSuggestions(true);
      } else { setNameSuggestions([]); setShowSuggestions(false); }
    }, 280);
    return () => { if (suggDebounceRef.current) clearTimeout(suggDebounceRef.current); };
  }, [form.name, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showSuggestions) return;
    function handler(e) {
      if (nameInputRef.current && !nameInputRef.current.contains(e.target) &&
          suggestionsRef.current && !suggestionsRef.current.contains(e.target)) setShowSuggestions(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSuggestions]);

  useEffect(() => {
    if (!showBrandDrop) return;
    function handler(e) { if (brandRef.current && !brandRef.current.contains(e.target)) setShowBrandDrop(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showBrandDrop]);

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    if (errors[field]) setErrors(e => ({ ...e, [field]: '' }));
  }

  function applyCreatorTemplate(creator) {
    const { handle } = parseTikTok(creator.tiktok_account);
    setForm(f => ({
      ...f,
      name: creator.name,
      _tiktokDisplay: handle || f._tiktokDisplay,
      whatsapp_number: creator.whatsapp_number || f.whatsapp_number,
      email: creator.email || f.email,
      paypal: creator.paypal || f.paypal,
      zelle: creator.zelle || f.zelle,
      category: creator.category || f.category,
      product: creator.product || f.product,
      comments: creator.comments || f.comments,
    }));
    setErrors({}); setAutoFilled(true); setShowSuggestions(false); setNameSuggestions([]);
  }

  function validateStep0() {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form._tiktokDisplay.trim()) e.tiktok_account = 'TikTok is required';
    setErrors(e); return Object.keys(e).length === 0;
  }
  function handleNext() {
    if (step === 0 && !validateStep0()) return;
    if (step < 2) setStep(s => s + 1); else handleSave();
  }
  function handleBack() { if (step > 0) setStep(s => s - 1); else onClose(); }
  async function handleSave() {
    const tiktokUrl = normalizeTikTokForStorage(form._tiktokDisplay);
    const tiktokUrl2 = form._tiktokDisplay2 ? normalizeTikTokForStorage(form._tiktokDisplay2) : null;
    onSave({
      name: form.name.trim(), tiktok_account: tiktokUrl, tiktok_account_2: tiktokUrl2,
      brand: form.brand, deal: form.deal, hiring_date: form.hiring_date || null,
      deadline: canSetDeadline ? (form.deadline || null) : undefined,
      payment_status: form.payment_status, videos: form.videos, product: form.product, category: form.category,
      hired_by: form.hired_by, whatsapp_number: formatWhatsApp(form.whatsapp_number),
      email: form.email, paypal: form.paypal, zelle: form.zelle, comments: form.comments,
      gmv: form.gmv ? parseFloat(form.gmv) : null,
      ad_spent: form.ad_spent ? parseFloat(form.ad_spent) : null,
      total_gmv: form.total_gmv ? parseFloat(form.total_gmv) : null,
    }, isEdit ? editCreator.id : null);
  }

  const tiktokPreview = parseTikTok(form._tiktokDisplay);
  const filteredBrands = allBrands.filter(b => b.toLowerCase().includes(brandSearch.toLowerCase()));
  const brandPickerItems = [...filteredBrands, '+ Add new brand'];

  const inputCls = (hasErr) =>
    `tw-w-full tw-h-12 tw-px-4 tw-rounded-2xl tw-bg-black/[0.03] tw-text-oneui-ink tw-text-[14px] tw-font-medium tw-border tw-border-transparent tw-outline-none tw-transition tw-placeholder:text-oneui-mute/60 ${hasErr ? 'tw-bg-rose-50 tw-border-rose-300 focus:tw-border-rose-400' : 'focus:tw-bg-white focus:tw-border-[#1259C3] focus:tw-shadow-oneui_blue'}`;

  const sectionHeader = (s, idx) => (
    <div className="tw-flex tw-items-center tw-gap-3 tw-mb-5">
      <div className="tw-w-11 tw-h-11 tw-rounded-2xl tw-bg-gradient-to-br tw-from-[#1259C3] tw-to-[#0E4DAD] tw-text-white tw-flex tw-items-center tw-justify-center tw-shadow-oneui_blue">{s.icon}</div>
      <div className="tw-flex-1 tw-min-w-0">
        <div className="tw-text-[18px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.5px] tw-leading-tight">{s.label}</div>
        <div className="tw-text-[12px] tw-font-medium tw-text-oneui-mute tw-mt-0.5">{s.sub}</div>
      </div>
      <div className="tw-text-[10.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-bg-black/[0.04] tw-px-2.5 tw-py-1 tw-rounded-full">Step {idx + 1}/3</div>
    </div>
  );

  return (
    <div
      className="tw-fixed tw-inset-0 tw-z-[1900] tw-bg-black/55 tw-backdrop-blur-md tw-flex tw-items-end md:tw-items-center tw-justify-center tw-font-sans"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ animation: 'bsv2-fade 0.22s ease' }}
    >
      <div
        className="tw-relative tw-w-full md:tw-max-w-[640px] tw-bg-white tw-rounded-t-[28px] md:tw-rounded-[28px] tw-shadow-oneui_lg tw-overflow-hidden tw-flex tw-flex-col"
        style={{ maxHeight: '92vh', animation: 'bsv2-pop 0.34s cubic-bezier(0.33,1,0.68,1)' }}
      >
        {/* Drag handle (mobile aesthetic) */}
        <div className="tw-flex tw-justify-center tw-pt-2.5 tw-pb-1 md:tw-hidden">
          <div className="tw-w-9 tw-h-1 tw-rounded-full tw-bg-black/15" />
        </div>

        {/* Header · title + close + stepper */}
        <div className="tw-px-6 tw-pt-3 tw-pb-4 tw-border-b tw-border-black/[0.06]">
          <div className="tw-flex tw-items-start tw-justify-between tw-gap-3 tw-mb-4">
            <div>
              <div className="tw-text-[22px] tw-font-extrabold tw-text-oneui-ink tw-tracking-[-0.6px] tw-leading-tight">
                {isEdit ? 'Edit Creator' : 'Add Creator'}
              </div>
              <div className="tw-text-[12.5px] tw-font-medium tw-text-oneui-mute tw-mt-0.5">
                {isEdit ? 'Update details' : 'Track a new creator deal'}
              </div>
            </div>
            <button
              onClick={onClose}
              className="tw-w-9 tw-h-9 tw-rounded-full tw-bg-black/[0.05] hover:tw-bg-black/[0.1] tw-text-oneui-ink tw-flex tw-items-center tw-justify-center tw-text-[15px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-95"
              aria-label="Close"
            >✕</button>
          </div>

          {/* Tailwind stepper · pill segments */}
          <div className="tw-flex tw-items-center tw-gap-1.5">
            {steps.map((s, i) => {
              const done = i < step, active = i === step;
              return (
                <React.Fragment key={i}>
                  <div className={`tw-flex tw-items-center tw-gap-2 tw-h-9 tw-px-3 tw-rounded-full tw-transition tw-duration-300 ${active ? 'tw-bg-[#1259C3] tw-text-white tw-shadow-oneui_blue tw-flex-1' : done ? 'tw-bg-emerald-100 tw-text-emerald-700' : 'tw-bg-black/[0.04] tw-text-oneui-mute'}`}>
                    <div className={`tw-w-5 tw-h-5 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-text-[10px] tw-font-extrabold tw-flex-shrink-0 ${active ? 'tw-bg-white/25 tw-text-white' : done ? 'tw-bg-emerald-500 tw-text-white' : 'tw-bg-black/10 tw-text-oneui-mute'}`}>
                      {done ? '✓' : i + 1}
                    </div>
                    <span className={`tw-text-[12px] tw-font-bold tw-tracking-[-0.2px] tw-truncate ${active ? '' : 'tw-hidden md:tw-inline'}`}>{s.label}</span>
                  </div>
                  {i < steps.length - 1 && <div className={`tw-h-0.5 tw-w-2 tw-rounded-full ${done ? 'tw-bg-emerald-400' : 'tw-bg-black/10'}`} />}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="tw-flex-1 tw-overflow-y-auto tw-px-6 tw-py-5 tw-overscroll-contain">
          {step === 0 && (
            <div style={{ animation: 'bsv2-step 0.3s cubic-bezier(0.33,1,0.68,1)' }}>
              {sectionHeader(steps[0], 0)}

              {/* Name w/ suggestions */}
              <div className="tw-mb-4 tw-relative">
                <label className="tw-flex tw-items-center tw-gap-1.5 tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2">
                  Name <span className="tw-text-rose-500 tw-text-[13px]">*</span>
                  {errors.name && <span className="tw-ml-auto tw-inline-flex tw-items-center tw-gap-1 tw-text-[10.5px] tw-text-rose-600 tw-font-bold tw-bg-rose-100 tw-px-2 tw-py-0.5 tw-rounded-full tw-normal-case tw-tracking-normal">⚠ {errors.name}</span>}
                </label>
                <input
                  ref={nameInputRef}
                  className={inputCls(errors.name)}
                  placeholder="Creator full name"
                  value={form.name}
                  autoComplete="off"
                  onChange={e => { set('name', e.target.value); setAutoFilled(false); }}
                  onFocus={() => { if (nameSuggestions.length > 0) setShowSuggestions(true); }}
                />
                {showSuggestions && nameSuggestions.length > 0 && (
                  <div ref={suggestionsRef} className="tw-absolute tw-left-0 tw-right-0 tw-top-full tw-mt-2 tw-bg-white tw-rounded-2xl tw-shadow-oneui_lg tw-ring-1 tw-ring-black/5 tw-overflow-hidden tw-z-10 tw-max-h-[280px] tw-overflow-y-auto">
                    {nameSuggestions.map((c, idx) => {
                      const { handle } = parseTikTok(c.tiktok_account);
                      const av = c.name ? c.name[0].toUpperCase() : '?';
                      return (
                        <div
                          key={idx}
                          className="tw-flex tw-items-center tw-gap-3 tw-px-4 tw-py-3 hover:tw-bg-blue-50 tw-cursor-pointer tw-border-b tw-border-black/[0.04] last:tw-border-0 tw-transition"
                          onMouseDown={e => { e.preventDefault(); applyCreatorTemplate(c); }}
                        >
                          <div className="tw-w-9 tw-h-9 tw-rounded-full tw-bg-gradient-to-br tw-from-[#1259C3] tw-to-[#0E4DAD] tw-text-white tw-flex tw-items-center tw-justify-center tw-font-bold tw-text-[13px] tw-leading-none">{av}</div>
                          <div className="tw-flex-1 tw-min-w-0">
                            <div className="tw-text-[13.5px] tw-font-bold tw-text-oneui-ink tw-truncate">{c.name}</div>
                            {handle && <div className="tw-text-[11px] tw-font-medium tw-text-oneui-mute tw-truncate">{handle}</div>}
                          </div>
                          <span className="tw-h-6 tw-px-2.5 tw-rounded-full tw-bg-[#1259C3] tw-text-white tw-text-[10px] tw-font-bold tw-uppercase tw-tracking-wider tw-inline-flex tw-items-center">Auto-fill</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Autofill banner */}
              {autoFilled && (
                <div className="tw-flex tw-items-center tw-gap-2 tw-bg-emerald-50 tw-text-emerald-700 tw-rounded-2xl tw-px-3.5 tw-py-2.5 tw-mb-4 tw-text-[12.5px] tw-font-semibold tw-ring-1 tw-ring-emerald-200" style={{ animation: 'bsv2-banner 0.34s cubic-bezier(0.33,1,0.68,1)' }}>
                  <span className="tw-w-5 tw-h-5 tw-rounded-full tw-bg-emerald-500 tw-text-white tw-flex tw-items-center tw-justify-center tw-text-[11px] tw-font-bold tw-leading-none">✓</span>
                  <span className="tw-flex-1">Contact info pre-filled. Just add deal &amp; date next.</span>
                  <button onClick={() => setAutoFilled(false)} className="tw-w-5 tw-h-5 tw-rounded-full hover:tw-bg-emerald-100 tw-text-emerald-700 tw-flex tw-items-center tw-justify-center tw-text-[11px] tw-border-0 tw-bg-transparent tw-cursor-pointer">✕</button>
                </div>
              )}

              {/* TikTok */}
              <div className="tw-mb-4">
                <label className="tw-flex tw-items-center tw-gap-1.5 tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2">
                  TikTok Account <span className="tw-text-rose-500 tw-text-[13px]">*</span>
                  {errors.tiktok_account && <span className="tw-ml-auto tw-inline-flex tw-items-center tw-gap-1 tw-text-[10.5px] tw-text-rose-600 tw-font-bold tw-bg-rose-100 tw-px-2 tw-py-0.5 tw-rounded-full tw-normal-case tw-tracking-normal">⚠ {errors.tiktok_account}</span>}
                </label>
                <div className="tw-flex tw-gap-2">
                  <input
                    className={inputCls(errors.tiktok_account)}
                    placeholder="@username or full URL"
                    value={form._tiktokDisplay}
                    onChange={e => set('_tiktokDisplay', e.target.value)}
                    onPaste={async (e) => {
                      const pasted = e.clipboardData.getData('text');
                      if (pasted && (pasted.includes('tiktok.com') || pasted.startsWith('@'))) {
                        e.preventDefault();
                        const { handle } = parseTikTok(pasted);
                        set('_tiktokDisplay', handle || pasted);
                        if (pasted.includes('/video/') && !form.name) {
                          setScrapingTT(true);
                          try {
                            const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(pasted)}`);
                            if (res.ok) {
                              const data = await res.json();
                              if (data.author_name) {
                                setForm(f => ({ ...f, name: f.name || data.author_name, _tiktokDisplay: handle || pasted, _ttAvatar: data.thumbnail_url || '' }));
                                setTtScrapeOk(true);
                              }
                            }
                          } catch {}
                          setScrapingTT(false);
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    title="Fetch profile info from URL"
                    disabled={!form._tiktokDisplay || scrapingTT}
                    onClick={async () => {
                      const val = form._tiktokDisplay.trim();
                      if (!val) return;
                      setScrapingTT(true); setTtScrapeOk(false);
                      try {
                        const url = val.includes('tiktok.com') ? val : `https://www.tiktok.com/@${val.replace(/^@/, '')}`;
                        if (url.includes('/video/')) {
                          const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
                          if (res.ok) {
                            const data = await res.json();
                            if (data.author_name) {
                              setForm(f => ({ ...f, name: f.name || data.author_name, _ttAvatar: data.thumbnail_url || '' }));
                              setTtScrapeOk(true);
                            }
                          }
                        } else {
                          const { handle } = parseTikTok(val);
                          if (handle && !form.name) setForm(f => ({ ...f, name: handle.replace('@', '') }));
                          setTtScrapeOk(true);
                        }
                      } catch {}
                      setScrapingTT(false);
                    }}
                    className="tw-h-12 tw-px-4 tw-rounded-2xl tw-bg-[#1259C3] tw-text-white tw-text-[12px] tw-font-bold tw-border-0 tw-cursor-pointer hover:tw-bg-[#0E4DAD] active:tw-scale-95 tw-transition tw-shadow-oneui_blue tw-flex tw-items-center tw-gap-1.5 tw-flex-shrink-0 disabled:tw-opacity-40 disabled:tw-cursor-not-allowed"
                  >
                    {scrapingTT ? <span className="tw-w-3 tw-h-3 tw-border-2 tw-border-white/40 tw-border-t-white tw-rounded-full tw-inline-block tw-animate-spin" /> : ttScrapeOk ? <span className="tw-text-[14px]">✓</span> : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/></svg> Fetch</>}
                  </button>
                </div>
                {form._tiktokDisplay && (
                  <div className="tw-flex tw-items-center tw-gap-2 tw-mt-2 tw-text-[11.5px] tw-font-medium">
                    <span className="tw-text-oneui-mute">Preview:</span>
                    <a href={tiktokPreview.url} target="_blank" rel="noopener noreferrer" className="tw-text-[#1259C3] tw-font-semibold hover:tw-underline">{tiktokPreview.handle}</a>
                    {ttScrapeOk && <span className="tw-h-5 tw-px-2 tw-rounded-full tw-bg-emerald-100 tw-text-emerald-700 tw-text-[10px] tw-font-bold tw-uppercase tw-tracking-wider tw-inline-flex tw-items-center">✓ Fetched</span>}
                  </div>
                )}
                {!showSecondTT && (
                  <button type="button" onClick={() => setShowSecondTT(true)} className="tw-mt-3 tw-inline-flex tw-items-center tw-gap-1.5 tw-text-[12px] tw-font-bold tw-text-[#1259C3] tw-bg-blue-50 hover:tw-bg-blue-100 tw-h-8 tw-px-3 tw-rounded-full tw-border-0 tw-cursor-pointer tw-transition">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add another TikTok
                  </button>
                )}
              </div>

              {/* Secondary TikTok */}
              {showSecondTT && (
                <div className="tw-mb-4">
                  <label className="tw-flex tw-items-center tw-gap-2 tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2">
                    Secondary TikTok
                    <span className="tw-h-4 tw-px-1.5 tw-rounded-full tw-bg-black/[0.06] tw-text-[9.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-text-oneui-mute tw-inline-flex tw-items-center tw-normal-case">Optional</span>
                  </label>
                  <div className="tw-flex tw-gap-2">
                    <input className={inputCls(false)} placeholder="@username or full URL" value={form._tiktokDisplay2} onChange={e => set('_tiktokDisplay2', e.target.value)}
                      onPaste={e => {
                        const pasted = e.clipboardData.getData('text');
                        if (pasted && pasted.includes('tiktok.com')) {
                          e.preventDefault();
                          const { handle } = parseTikTok(pasted);
                          set('_tiktokDisplay2', handle || pasted);
                        }
                      }}
                    />
                    <button type="button" title="Remove" onClick={() => { set('_tiktokDisplay2', ''); setShowSecondTT(false); }} className="tw-h-12 tw-w-12 tw-rounded-2xl tw-bg-rose-50 tw-text-rose-600 tw-flex tw-items-center tw-justify-center tw-border-0 tw-cursor-pointer hover:tw-bg-rose-100 active:tw-scale-95 tw-transition tw-flex-shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                  {form._tiktokDisplay2 && (() => {
                    const tt2 = parseTikTok(form._tiktokDisplay2);
                    return (
                      <div className="tw-flex tw-items-center tw-gap-2 tw-mt-2 tw-text-[11.5px] tw-font-medium">
                        <span className="tw-text-oneui-mute">Preview:</span>
                        <a href={tt2.url} target="_blank" rel="noopener noreferrer" className="tw-text-[#1259C3] tw-font-semibold hover:tw-underline">{tt2.handle}</a>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div style={{ animation: 'bsv2-step 0.3s cubic-bezier(0.33,1,0.68,1)' }}>
              {sectionHeader(steps[1], 1)}

              {/* Brand */}
              <div className="tw-mb-4 tw-relative" ref={brandRef}>
                <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">Brand</label>
                <input className={inputCls(false)} placeholder="Search or select brand…" value={brandSearch || form.brand}
                  onFocus={() => { setBrandSearch(''); setShowBrandDrop(true); }}
                  onChange={e => { setBrandSearch(e.target.value); setShowBrandDrop(true); }} />
                {showBrandDrop && (
                  <div className="tw-absolute tw-left-0 tw-right-0 tw-top-full tw-mt-2 tw-bg-white tw-rounded-2xl tw-shadow-oneui_lg tw-ring-1 tw-ring-black/5 tw-overflow-hidden tw-z-10 tw-max-h-[240px] tw-overflow-y-auto">
                    {brandPickerItems.map((b, i) => (
                      <div key={i}
                        className={`tw-px-4 tw-py-2.5 tw-text-[13.5px] tw-font-medium tw-cursor-pointer hover:tw-bg-blue-50 tw-border-b tw-border-black/[0.04] last:tw-border-0 tw-transition ${b === '+ Add new brand' ? 'tw-text-[#1259C3] tw-font-bold' : 'tw-text-oneui-ink'}`}
                        onMouseDown={() => {
                          if (b === '+ Add new brand') {
                            const newBrand = brandSearch.trim();
                            if (newBrand) set('brand', newBrand);
                          } else { set('brand', b); }
                          setBrandSearch(''); setShowBrandDrop(false);
                        }}
                      >{b}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Deal + Hiring date row */}
              <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-2 tw-gap-4 tw-mb-4">
                <div>
                  <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">Deal</label>
                  <input className={inputCls(false)} placeholder='e.g. $500 for 3 videos' value={form.deal} onChange={e => set('deal', e.target.value)} />
                  {(() => {
                    const { amount, videos } = parseDeal(form.deal);
                    if (amount > 0 && videos > 0) {
                      const rate = Math.round(amount / videos);
                      return (
                        <div className="tw-flex tw-items-center tw-gap-1.5 tw-mt-2 tw-flex-wrap">
                          <span className="tw-h-6 tw-px-2.5 tw-rounded-full tw-bg-emerald-100 tw-text-emerald-700 tw-text-[10.5px] tw-font-extrabold tw-inline-flex tw-items-center">${amount.toLocaleString()}</span>
                          <span className="tw-text-oneui-mute tw-text-[11px] tw-font-bold">/</span>
                          <span className="tw-h-6 tw-px-2.5 tw-rounded-full tw-bg-blue-100 tw-text-blue-700 tw-text-[10.5px] tw-font-extrabold tw-inline-flex tw-items-center">{videos} vid{videos > 1 ? 's' : ''}</span>
                          <span className="tw-text-oneui-mute tw-text-[11px] tw-font-bold">=</span>
                          <span className="tw-h-6 tw-px-2.5 tw-rounded-full tw-bg-violet-100 tw-text-violet-700 tw-text-[10.5px] tw-font-extrabold tw-inline-flex tw-items-center">${rate}/vid</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div>
                  <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">Hiring Date</label>
                  <input className={inputCls(false)} type="date" value={form.hiring_date || ''} onChange={e => set('hiring_date', e.target.value)} />
                </div>
              </div>

              {/* GMV + Ad Spent (Performance) */}
              <div className="tw-mb-4">
                <label className="tw-flex tw-items-center tw-gap-1.5 tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2">
                  Performance
                  <span className="tw-text-[9.5px] tw-font-semibold tw-text-oneui-mute/70 tw-normal-case tw-tracking-normal">· revenue & ad spend</span>
                </label>
                <div className="tw-grid tw-grid-cols-2 tw-gap-2">
                  <div className="tw-relative tw-overflow-hidden tw-rounded-2xl tw-bg-gradient-to-br tw-from-emerald-500 tw-to-emerald-700 tw-p-3 tw-shadow-md">
                    <div className="tw-absolute tw-inset-0 tw-pointer-events-none tw-opacity-15" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
                    <div className="tw-relative tw-z-10 tw-flex tw-items-center tw-gap-2 tw-mb-2">
                      <div className="tw-w-7 tw-h-7 tw-rounded-full tw-bg-white/22 tw-backdrop-blur tw-flex tw-items-center tw-justify-center tw-text-white tw-text-[14px] tw-font-extrabold">📈</div>
                      <div className="tw-text-white tw-text-[10.5px] tw-font-extrabold tw-uppercase tw-tracking-wider">GMV</div>
                    </div>
                    <div className="tw-relative tw-z-10 tw-flex tw-items-center tw-gap-1">
                      <span className="tw-text-white tw-text-[15px] tw-font-extrabold">$</span>
                      <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={form.gmv} onChange={e => set('gmv', e.target.value)} className="tw-flex-1 tw-w-full tw-bg-transparent tw-border-0 tw-outline-none tw-text-white tw-placeholder-white/40 tw-text-[18px] tw-font-extrabold tw-tracking-[-0.5px] tw-tabular-nums tw-min-w-0" />
                    </div>
                  </div>
                  <div className="tw-relative tw-overflow-hidden tw-rounded-2xl tw-bg-gradient-to-br tw-from-rose-500 tw-to-rose-700 tw-p-3 tw-shadow-md">
                    <div className="tw-absolute tw-inset-0 tw-pointer-events-none tw-opacity-15" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
                    <div className="tw-relative tw-z-10 tw-flex tw-items-center tw-gap-2 tw-mb-2">
                      <div className="tw-w-7 tw-h-7 tw-rounded-full tw-bg-white/22 tw-backdrop-blur tw-flex tw-items-center tw-justify-center tw-text-white tw-text-[14px] tw-font-extrabold">💸</div>
                      <div className="tw-text-white tw-text-[10.5px] tw-font-extrabold tw-uppercase tw-tracking-wider">Ad Spent</div>
                    </div>
                    <div className="tw-relative tw-z-10 tw-flex tw-items-center tw-gap-1">
                      <span className="tw-text-white tw-text-[15px] tw-font-extrabold">$</span>
                      <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={form.ad_spent} onChange={e => set('ad_spent', e.target.value)} className="tw-flex-1 tw-w-full tw-bg-transparent tw-border-0 tw-outline-none tw-text-white tw-placeholder-white/40 tw-text-[18px] tw-font-extrabold tw-tracking-[-0.5px] tw-tabular-nums tw-min-w-0" />
                    </div>
                  </div>
                </div>
                {parseFloat(form.gmv) > 0 && parseFloat(form.ad_spent) > 0 && (
                  <div className="tw-mt-2 tw-flex tw-items-center tw-justify-center tw-gap-1.5 tw-text-[11px] tw-font-bold tw-text-oneui-mute">
                    <span>ROAS:</span>
                    <span className={`tw-font-extrabold ${(parseFloat(form.gmv) / parseFloat(form.ad_spent)) >= 1 ? 'tw-text-emerald-700' : 'tw-text-rose-700'}`}>
                      {(parseFloat(form.gmv) / parseFloat(form.ad_spent)).toFixed(2)}×
                    </span>
                    <span>· profit ${(parseFloat(form.gmv) - parseFloat(form.ad_spent)).toLocaleString()}</span>
                  </div>
                )}
                {/* Lifetime / Total GMV */}
                <div className="tw-mt-2 tw-relative tw-overflow-hidden tw-rounded-2xl tw-bg-gradient-to-br tw-from-blue-500 tw-via-indigo-600 tw-to-violet-700 tw-p-3 tw-shadow-md">
                  <div className="tw-absolute tw-inset-0 tw-pointer-events-none tw-opacity-15" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
                  <div className="tw-absolute tw--top-6 tw--right-3 tw-w-16 tw-h-16 tw-rounded-full tw-opacity-30 tw-pointer-events-none" style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--wx-surface-1) 60%, transparent), transparent 70%)' }} />
                  <div className="tw-relative tw-z-10 tw-flex tw-items-center tw-justify-between tw-gap-2">
                    <div className="tw-flex tw-items-center tw-gap-2">
                      <div className="tw-w-7 tw-h-7 tw-rounded-full tw-bg-white/22 tw-backdrop-blur tw-flex tw-items-center tw-justify-center tw-text-white tw-text-[14px]">🏆</div>
                      <div>
                        <div className="tw-text-white tw-text-[10.5px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-leading-none">Total GMV</div>
                        <div className="tw-text-white/65 tw-text-[9.5px] tw-font-bold tw-mt-0.5">for this brand · all deals</div>
                      </div>
                    </div>
                    <div className="tw-flex tw-items-center tw-gap-1">
                      <span className="tw-text-white tw-text-[15px] tw-font-extrabold">$</span>
                      <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={form.total_gmv} onChange={e => set('total_gmv', e.target.value)}
                        className="tw-w-[140px] tw-bg-transparent tw-border-0 tw-outline-none tw-text-white tw-placeholder-white/40 tw-text-[18px] tw-font-extrabold tw-tracking-[-0.5px] tw-tabular-nums tw-text-right" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment chips */}
              <div className="tw-mb-4">
                <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">Payment Status</label>
                <div className="tw-flex tw-gap-2 tw-flex-wrap">
                  {PAYMENT_OPTIONS.map(opt => {
                    const sel = form.payment_status === opt;
                    const cls = sel ? (opt === 'Paid' ? 'tw-bg-emerald-500 tw-text-white tw-shadow-md tw-ring-emerald-300' : 'tw-bg-rose-500 tw-text-white tw-shadow-md tw-ring-rose-300') : 'tw-bg-black/[0.04] tw-text-oneui-ink hover:tw-bg-black/[0.08] tw-ring-transparent';
                    return (
                      <button key={opt} type="button" className={`tw-h-10 tw-px-4 tw-rounded-full tw-text-[12.5px] tw-font-bold tw-border-0 tw-cursor-pointer active:tw-scale-95 tw-transition tw-ring-2 ${cls}`} onClick={() => set('payment_status', sel ? '' : opt)}>{opt}</button>
                    );
                  })}
                </div>
              </div>

              {/* Videos chips */}
              <div className="tw-mb-4">
                <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">Videos Status</label>
                <div className="tw-flex tw-gap-2 tw-flex-wrap">
                  {VIDEOS_OPTIONS.map(opt => {
                    const sel = form.videos === opt;
                    const cls = sel ? (opt === 'Done' ? 'tw-bg-blue-500 tw-text-white tw-shadow-md tw-ring-blue-300' : 'tw-bg-amber-500 tw-text-white tw-shadow-md tw-ring-amber-300') : 'tw-bg-black/[0.04] tw-text-oneui-ink hover:tw-bg-black/[0.08] tw-ring-transparent';
                    return (
                      <button key={opt} type="button" className={`tw-h-10 tw-px-4 tw-rounded-full tw-text-[12.5px] tw-font-bold tw-border-0 tw-cursor-pointer active:tw-scale-95 tw-transition tw-ring-2 ${cls}`} onClick={() => set('videos', sel ? '' : opt)}>{opt}</button>
                    );
                  })}
                </div>
              </div>

              {/* Product + Category row */}
              <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-2 tw-gap-4 tw-mb-4">
                <div>
                  <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">Product</label>
                  <input className={inputCls(false)} placeholder="Product name" value={form.product} onChange={e => set('product', e.target.value)} />
                </div>
                <div>
                  <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">Category</label>
                  <input className={inputCls(false)} placeholder="e.g. Skincare" value={form.category} onChange={e => set('category', e.target.value)} />
                </div>
              </div>

              {/* Hired by */}
              {hiredByTeam.length > 0 && (
                <div className="tw-mb-4">
                  <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">Hired By</label>
                  <div className="tw-flex tw-gap-2 tw-flex-wrap">
                    {hiredByTeam.map(member => {
                      const sel = form.hired_by === member.name;
                      return (
                        <button key={member.id} type="button" onClick={() => set('hired_by', sel ? '' : member.name)}
                          className={`tw-flex tw-items-center tw-gap-2 tw-h-10 tw-pl-1.5 tw-pr-3.5 tw-rounded-full tw-text-[12.5px] tw-font-bold tw-border-0 tw-cursor-pointer active:tw-scale-95 tw-transition tw-ring-2 ${sel ? 'tw-bg-[#1259C3] tw-text-white tw-shadow-md tw-ring-blue-300' : 'tw-bg-black/[0.04] tw-text-oneui-ink hover:tw-bg-black/[0.08] tw-ring-transparent'}`}>
                          <span className="tw-w-7 tw-h-7 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-text-[11px] tw-font-extrabold" style={{ background: member.bg, color: member.color }}>{member.name[0]}</span>
                          {member.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Deadline */}
              {canSetDeadline && (
                <div className="tw-mb-4">
                  <label className="tw-flex tw-items-center tw-gap-2 tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2">
                    Deadline
                    {form.deadline && new Date(form.deadline) < new Date() && (
                      <span className="tw-h-5 tw-px-2 tw-rounded-full tw-bg-rose-100 tw-text-rose-700 tw-text-[10px] tw-font-bold tw-uppercase tw-tracking-wider tw-inline-flex tw-items-center">⚠ Overdue</span>
                    )}
                  </label>
                  <input className={inputCls(false)} type="date" value={form.deadline || ''} onChange={e => set('deadline', e.target.value)} min={new Date().toISOString().split('T')[0]} />
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div style={{ animation: 'bsv2-step 0.3s cubic-bezier(0.33,1,0.68,1)' }}>
              {sectionHeader(steps[2], 2)}

              <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-2 tw-gap-4 tw-mb-4">
                <div>
                  <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">WhatsApp</label>
                  <input className={inputCls(false)} placeholder="+1 555 000 0000" value={form.whatsapp_number} onChange={e => set('whatsapp_number', e.target.value)} />
                </div>
                <div>
                  <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">Email</label>
                  <input className={inputCls(false)} type="email" placeholder="email@example.com" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
              </div>

              <div className="tw-grid tw-grid-cols-1 md:tw-grid-cols-2 tw-gap-4 tw-mb-4">
                <div>
                  <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">PayPal</label>
                  <input className={inputCls(false)} placeholder="PayPal username or email" value={form.paypal} onChange={e => set('paypal', e.target.value)} />
                </div>
                <div>
                  <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">Zelle</label>
                  <input className={inputCls(false)} placeholder="Zelle phone or email" value={form.zelle} onChange={e => set('zelle', e.target.value)} />
                </div>
              </div>

              <div className="tw-mb-2">
                <label className="tw-text-[11.5px] tw-font-bold tw-text-oneui-mute tw-uppercase tw-tracking-wider tw-mb-2 tw-block">Comments</label>
                <textarea
                  className="tw-w-full tw-min-h-[110px] tw-p-4 tw-rounded-2xl tw-bg-black/[0.03] tw-text-oneui-ink tw-text-[14px] tw-font-medium tw-border tw-border-transparent tw-outline-none tw-resize-y tw-transition tw-placeholder:text-oneui-mute/60 focus:tw-bg-white focus:tw-border-[#1259C3] focus:tw-shadow-oneui_blue tw-font-sans"
                  placeholder="Any notes…" value={form.comments} onChange={e => set('comments', e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer · back + continue */}
        <div className="tw-flex tw-items-center tw-gap-3 tw-px-6 tw-py-4 tw-border-t tw-border-black/[0.06] tw-bg-black/[0.015]">
          <button onClick={handleBack} className="tw-h-12 tw-px-5 tw-rounded-full tw-bg-black/[0.05] hover:tw-bg-black/[0.1] tw-text-oneui-ink tw-text-[13.5px] tw-font-bold tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-95">
            {step === 0 ? 'Cancel' : '← Back'}
          </button>
          <button
            onClick={handleNext}
            disabled={step === 0 && !form.name.trim() && !form._tiktokDisplay.trim()}
            className="tw-flex-1 tw-h-12 tw-rounded-full tw-bg-gradient-to-r tw-from-[#1259C3] tw-to-[#0E4DAD] tw-text-white tw-text-[14px] tw-font-extrabold tw-tracking-[-0.2px] tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-[0.98] tw-shadow-oneui_blue hover:tw-shadow-oneui_bluemax disabled:tw-opacity-40 disabled:tw-cursor-not-allowed disabled:tw-shadow-none"
          >
            {step === 2 ? (isEdit ? 'Save Changes' : 'Add Creator ✦') : 'Continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── SettingsPanel ──────────────────────────────────────── */
const ROLES = ['superadmin', 'ipc', 'apc', 'admin', 'viewer', 'client'];
const ROLE_META = {
  superadmin: { label: 'Super Admin', color: 'var(--wx-text-faint)', bg: '#EEF2FF' },
  ipc:        { label: 'IPC',         color: 'var(--wx-success)', bg: '#ECFDF5' },
  apc:        { label: 'APC',         color: 'var(--wx-warning)', bg: '#FFFBEB' },
  admin:      { label: 'Admin',       color: 'var(--wx-danger)', bg: '#FEF2F2' },
  viewer:     { label: 'Viewer',      color: 'var(--wx-text-faint)', bg: '#E0F2FE' },
  client:     { label: 'Client',      color: 'var(--wx-text-muted)', bg: '#F5F3FF' },
};

/* ─── SettingsPanelV2 · Tailwind + new One UI concept ─── */
function SettingsPanelV2({ onClose, hiredByTeam, setHiredByTeam, currentUser, onOpenLogs, onOpenUserMgmt, onCompare, canCompare, onOpenLeaderboard, onLogout, onOpenSql, onOpenGod, onOpenAccess }) {
  const [view, setView] = useState('home'); // home | team
  const [newName, setNewName] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const ref = useRef(null);

  const isSuperAdmin = currentUser?.role === 'superadmin';
  const meMeta = ROLE_META[currentUser?.role] || ROLE_META.admin;

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  function saveTeam(team) {
    setHiredByTeam(team);
    localStorage.setItem('hiredByTeam', JSON.stringify(team));
  }
  function deleteMember(id) { saveTeam(hiredByTeam.filter(m => m.id !== id)); setConfirmDel(null); }
  function renameMember(id, name) { saveTeam(hiredByTeam.map(m => m.id === id ? { ...m, name } : m)); }
  function addMember() {
    const name = newName.trim(); if (!name) return;
    const colors = ['#171717','#C2185B','#6D28D9','#9C5C5C','#475569','#92400E','#0E7490'];
    const bgs    = ['#F4F4F5','#FCE4EC','#EDE9FE','#F8E7E1','#EDF1F6','#FEF3C7','#ECFEFF'];
    const idx = hiredByTeam.length % colors.length;
    saveTeam([...hiredByTeam, { id: name.toLowerCase().replace(/\s+/g,'_')+'_'+Date.now(), name, color: colors[idx], bg: bgs[idx] }]);
    setNewName('');
  }

  // Shared icon-chip — neutral monochrome with subtle dark coffee accent.
  // No rainbow colors per-row · the section grouping is the visual structure.
  const iconChipStyle = {
    width: 38, height: 38, borderRadius: 11, flexShrink: 0,
    background: 'var(--wx-bg)', color: 'var(--wx-warning)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };

  const sections = [
    {
      title: 'Team',
      items: [
        {
          id: 'team', label: 'Hired By Team',
          sub: `${hiredByTeam.length} member${hiredByTeam.length !== 1 ? 's' : ''}`,
          icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>),
          action: () => setView('team'),
          hide: !allowed(currentUser, 'canManageTeam'),
        },
        {
          id: 'leaderboard', label: 'Team Leaderboard', sub: 'Hired-by performance',
          icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>),
          action: () => { onClose(); onOpenLeaderboard(); },
        },
        canCompare && allowed(currentUser, 'canCompareBrands') && {
          id: 'compare', label: 'Compare Brands', sub: 'Side-by-side analytics',
          icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="7" height="14" rx="1.5"/><rect x="14" y="3" width="7" height="17" rx="1.5"/></svg>),
          action: () => { onClose(); onCompare(); },
        },
      ].filter(Boolean).filter(i => !i.hide),
    },
    (isSuperAdmin || allowed(currentUser, 'canManageUsers') || allowed(currentUser, 'canGrantAccess') || allowed(currentUser, 'canSeeLogs')) && {
      title: 'Administration',
      items: [
        allowed(currentUser, 'canGrantAccess') && {
          id: 'access', label: 'Access Control', sub: 'Decide what each person can reach',
          icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.4"/></svg>),
          action: () => { onClose(); onOpenAccess(); },
        },
        allowed(currentUser, 'canManageUsers') && {
          id: 'users', label: 'User Management', sub: 'Roles, access, permissions',
          icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>),
          action: () => { onClose(); onOpenUserMgmt(); },
        },
        allowed(currentUser, 'canSeeLogs') && {
          id: 'logs', label: 'Activity Logs', sub: 'Workspace audit trail',
          icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>),
          action: () => { onClose(); onOpenLogs(); },
        },
      ].filter(Boolean),
    },
    /* System Health was removed · the diagnostics it showed were not used
       in practice and the panel only added noise to Settings. */
    (allowed(currentUser, 'canGodMode') || allowed(currentUser, 'canSqlQuest')) && {
      title: 'Superadmin',
      items: [
        allowed(currentUser, 'canGodMode') && {
          id: 'god', label: 'God Mode', sub: 'Appearance, navigation, brand surgery',
          icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.6 6.2 6.7.5-5.1 4.4 1.6 6.5L12 16.1 6.2 19.6l1.6-6.5L2.7 8.7l6.7-.5z"/></svg>),
          action: () => { onClose(); onOpenGod(); },
        },
        allowed(currentUser, 'canSqlQuest') && {
          id: 'sql', label: 'SQL Quest', sub: 'Learn SQL by playing · 11 levels',
          icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><line x1="7" y1="12" x2="11" y2="12"/><line x1="9" y1="10" x2="9" y2="14"/><circle cx="16" cy="11" r="1"/><circle cx="18.5" cy="13.5" r="1"/></svg>),
          action: () => { onClose(); onOpenSql(); },
        },
      ].filter(Boolean),
    },
    {
      title: 'About',
      items: [
        { id: 'workspace', label: 'Workspace', value: 'Wurx Base · Paid Collaborations',
          icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4"/><path d="M3 17l9 4 9-4"/></svg>) },
        { id: 'env', label: 'Environment', value: 'Production',
          icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>) },
        { id: 'credits', label: 'Built by', value: '© Wurx Media',
          icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>) },
      ],
    },
  ].filter(Boolean);

  return (
    <div
      className="tw-fixed tw-inset-0 tw-z-[1000] tw-flex tw-items-center tw-justify-center tw-p-4 sm:tw-p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ animation: 'sp-fade 0.22s ease-out', background: 'color-mix(in srgb, var(--wx-warning-soft) 50%, transparent)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
    >
      <div
        ref={ref}
        className="tw-relative tw-w-full tw-flex tw-flex-col tw-font-sans"
        style={{
          maxWidth: 560, maxHeight: '92vh',
          background: 'var(--wx-bg)', borderRadius: 22,
          boxShadow: '0 32px 80px rgba(48,39,28,0.25), 0 8px 24px rgba(48,39,28,0.10)',
          animation: 'sp-pop 0.32s cubic-bezier(0.33,1,0.68,1)',
          overflow: 'hidden',
        }}
      >
        {/* ── Header · dark coffee bar with cream text ── */}
        <div style={{
          background: 'var(--wx-warning-soft)', padding: '16px 22px 14px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          {view !== 'home' && (
            <button
              onClick={() => setView('home')}
              title="Back"
              style={{
                width: 34, height: 34, borderRadius: 999, border: 0, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', transition: 'background .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.18)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.10)'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--wx-text-muted)' }}>
              {view === 'home' ? 'Settings' : 'Hired By Team'}
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 2 }}>
              {view === 'home' ? 'Workspace preferences & administration' : 'Manage your team members'}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close"
            style={{
              width: 34, height: 34, borderRadius: 999, border: 0, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', transition: 'background .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.10)'; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 22px' }}>
          {view === 'home' && <>
            {/* Profile card — warm cream with role chip */}
            <div style={{
              padding: 18, borderRadius: 18,
              background: 'linear-gradient(135deg, var(--wx-surface-1) 0%, var(--wx-surface-2) 100%)',
              border: '1px solid var(--wx-border)',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 52, height: 52, borderRadius: 999,
                background: 'var(--wx-warning-soft)', color: 'var(--wx-text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--wx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUser?.display}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 1 }}>@{currentUser?.username}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px',
                    borderRadius: 999, background: 'var(--wx-warning-soft)', color: 'var(--wx-text-muted)',
                    fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, lineHeight: 1,
                  }}>{meMeta.label}</span>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 10px',
                    borderRadius: 999, background: 'color-mix(in srgb, var(--wx-success-soft) 10%, transparent)', color: 'var(--wx-success)',
                    fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, lineHeight: 1,
                    border: '1px solid color-mix(in srgb, var(--wx-success) 30%, transparent)',
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--wx-success-soft)', display: 'inline-block' }} />
                    Online
                  </span>
                </div>
              </div>
            </div>

            {/* Sections */}
            {sections.map(section => (
              <div key={section.title} style={{ marginTop: 18 }}>
                <div style={{
                  fontSize: 10.5, fontWeight: 800, color: 'var(--wx-text-muted)',
                  textTransform: 'uppercase', letterSpacing: 0.6,
                  padding: '0 4px 8px',
                }}>{section.title}</div>
                <div style={{
                  background: 'var(--wx-surface-1)', borderRadius: 16,
                  border: '1px solid var(--wx-border)',
                  overflow: 'hidden',
                }}>
                  {section.items.map((item, i) => (
                    <button
                      key={item.id}
                      onClick={item.action}
                      disabled={!item.action}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 13,
                        padding: '14px 16px', border: 0, background: 'transparent',
                        textAlign: 'left',
                        cursor: item.action ? 'pointer' : 'default',
                        borderTop: i > 0 ? '1px solid #F2EEE7' : 'none',
                        transition: 'background .15s',
                      }}
                      onMouseEnter={item.action ? e => { e.currentTarget.style.background = '#F8F7F4'; } : undefined}
                      onMouseLeave={item.action ? e => { e.currentTarget.style.background = 'transparent'; } : undefined}
                    >
                      <div style={iconChipStyle}>{item.icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--wx-text)', letterSpacing: '-0.1px' }}>{item.label}</div>
                        {item.sub && <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--wx-text-muted)', marginTop: 2 }}>{item.sub}</div>}
                      </div>
                      {item.value ? (
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--wx-text-muted)', textAlign: 'right', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.value}</span>
                      ) : item.action ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--wx-text-muted)', flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* SIGN OUT REMOVED. One session, the hub's, ended from the hub's
                own top bar. This ended a session that no longer exists. */}
          </>}

          {/* Team management view */}
          {view === 'team' && <div>
            <div style={{ background: 'var(--wx-surface-1)', borderRadius: 16, border: '1px solid var(--wx-border)', overflow: 'hidden' }}>
              {hiredByTeam.length === 0 && (
                <div style={{ padding: '22px 18px', textAlign: 'center', color: 'var(--wx-text-muted)', fontSize: 13, fontWeight: 600 }}>No team members yet</div>
              )}
              {hiredByTeam.map((m, i) => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px',
                  borderTop: i > 0 ? '1px solid #F2EEE7' : 'none',
                }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: 999, flexShrink: 0,
                    background: m.bg, color: m.color,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 800, lineHeight: 1,
                  }}>{(m.name || '?')[0]}</span>
                  <input
                    value={m.name}
                    onChange={e => renameMember(m.id, e.target.value)}
                    disabled={!isSuperAdmin}
                    style={{
                      flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none',
                      fontSize: 14, fontWeight: 700, color: 'var(--wx-text)', letterSpacing: '-0.1px',
                      fontFamily: 'inherit',
                    }}
                  />
                  {isSuperAdmin && (
                    <button
                      onClick={() => setConfirmDel(m)}
                      title="Remove"
                      style={{
                        width: 30, height: 30, borderRadius: 999, border: 0, cursor: 'pointer',
                        background: 'color-mix(in srgb, var(--wx-danger-soft) 8%, transparent)', color: 'var(--wx-danger)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'background .15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#B91C1C'; e.currentTarget.style.color = '#fff'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(220,38,38,0.08)'; e.currentTarget.style.color = '#B91C1C'; }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isSuperAdmin && (
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addMember()}
                  placeholder="Add new team member"
                  style={{
                    flex: 1, height: 44, padding: '0 14px', borderRadius: 12,
                    background: 'var(--wx-surface-1)', border: '1px solid var(--wx-border)',
                    fontSize: 13.5, fontWeight: 600, color: 'var(--wx-text)',
                    outline: 'none', fontFamily: 'inherit',
                    transition: 'border-color .15s, box-shadow .15s',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#30271C'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(48,39,28,0.10)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#E7E2D7'; e.currentTarget.style.boxShadow = 'none'; }}
                />
                <button
                  onClick={addMember}
                  disabled={!newName.trim()}
                  style={{
                    height: 44, padding: '0 18px', borderRadius: 12, border: 0,
                    background: 'var(--wx-warning-soft)', color: 'var(--wx-text-muted)',
                    fontSize: 13, fontWeight: 700,
                    cursor: newName.trim() ? 'pointer' : 'not-allowed',
                    opacity: newName.trim() ? 1 : 0.5,
                    transition: 'background .15s',
                  }}
                >Add</button>
              </div>
            )}
          </div>}
        </div>

        {/* Confirm delete */}
        {confirmDel && (
          <div onClick={() => setConfirmDel(null)} style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--wx-warning-soft) 45%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--wx-surface-1)', borderRadius: 18, padding: 22, width: '100%', maxWidth: 340, boxShadow: '0 24px 60px rgba(48,39,28,0.30)' }}>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--wx-text)' }}>Remove member?</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--wx-text-muted)', marginTop: 6, marginBottom: 16 }}>Remove <strong style={{ color: 'var(--wx-text)' }}>{confirmDel.name}</strong> from the team?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirmDel(null)} style={{ flex: 1, height: 42, borderRadius: 11, border: '1px solid var(--wx-border)', background: 'var(--wx-surface-1)', color: 'var(--wx-text)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => deleteMember(confirmDel.id)} style={{ flex: 1, height: 42, borderRadius: 11, border: 0, background: 'var(--wx-danger-soft)', color: 'var(--wx-text-muted)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Remove</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsPanel({ onClose, hiredByTeam, setHiredByTeam, currentUser, onOpenLogs, onlineUsers, onOpenUserMgmt, onCompare, canCompare, onOpenDevices, onOpenLeaderboard, uiPrefs, setUiPrefs }) {
  const [activeTab, setActiveTab] = useState('general');
  const [newName, setNewName] = useState('');
  const [confirmDeleteMember, setConfirmDeleteMember] = useState(null);
  const [appUsers, setAppUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const ref = useRef(null);

  const isSuperAdmin = currentUser?.role === 'superadmin';
  const onlineIds = new Set((onlineUsers || []).map(u => String(u.user_id)));

  // Lazy fetch app_users when team tab opens
  useEffect(() => {
    if (activeTab !== 'team' || !isSuperAdmin || appUsers.length > 0) return;
    setLoadingUsers(true);
    (async () => {
      const { data } = await supabase.from('app_users').select('*');
      if (data && data.length > 0) {
        setAppUsers(data);
      } else {
        const seed = USERS.map(u => ({ id: String(u.id), username: u.username, display: u.display, role: u.role }));
        const { data: seeded } = await supabase.from('app_users').upsert(seed, { onConflict: 'id' }).select();
        setAppUsers(seeded && seeded.length > 0 ? seeded : seed);
      }
      setLoadingUsers(false);
    })();
  }, [activeTab, isSuperAdmin, appUsers.length]);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // ── Hired By helpers ──
  function saveTeam(team) {
    setHiredByTeam(team);
    localStorage.setItem('hiredByTeam', JSON.stringify(team));
  }
  function deleteMember(id) { saveTeam(hiredByTeam.filter(m => m.id !== id)); setConfirmDeleteMember(null); }
  function renameMember(id, name) { saveTeam(hiredByTeam.map(m => m.id === id ? { ...m, name } : m)); }
  function addMember() {
    const name = newName.trim(); if (!name) return;
    const colors = ['#1D4ED8','#9D174D','#374151','#991B1B','#047857','#92400E','#5B21B6'];
    const bgs    = ['#DBEAFE','#FCE7F3','#F3F4F6','#FEE2E2','#D1FAE5','#FEF3C7','#EDE9FE'];
    const idx = hiredByTeam.length % colors.length;
    saveTeam([...hiredByTeam, { id: name.toLowerCase().replace(/\s+/g,'_')+'_'+Date.now(), name, color: colors[idx], bg: bgs[idx] }]);
    setNewName('');
  }

  const meMeta = ROLE_META[currentUser?.role] || ROLE_META.admin;
  const myAvatarBg = getGradient(currentUser?.display || currentUser?.username || '?');

  const TABS = [
    { id: 'general',  label: 'General',  icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>) },
    { id: 'profile',  label: 'Profile',  icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>) },
    { id: 'team',     label: 'Team',     icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>) },
    { id: 'security', label: 'Security', icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>), only: isSuperAdmin },
    { id: 'about',    label: 'About',    icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>) },
  ].filter(t => t.only === undefined || t.only);

  const activeLabel = TABS.find(t => t.id === activeTab)?.label || 'Settings';

  return (
    <div className="settings-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sp-pro" ref={ref}>
        {/* Sidebar */}
        <aside className="sp-side">
          <div className="sp-side-brand">
            <div className="sp-side-brand-ic">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/></svg>
            </div>
            <div>
              <div className="sp-side-brand-t">Settings</div>
              <div className="sp-side-brand-s">Creator Hub</div>
            </div>
          </div>
          <div className="sp-side-nav">
            {TABS.map(tab => (
              <button key={tab.id} className={`sp-nav${activeTab === tab.id ? ' active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                <span className="sp-nav-ic">{tab.icon}</span>
                <span className="sp-nav-l">{tab.label}</span>
                {tab.id === 'team' && isSuperAdmin && (() => {
                  const others = [...new Set(
                    (onlineUsers || [])
                      .map(u => String(u.user_id))
                      .filter(id => id && id !== String(currentUser?.id))
                  )];
                  return others.length > 0 ? <span className="sp-nav-badge">{others.length}</span> : null;
                })()}
              </button>
            ))}
          </div>
          <div className="sp-side-foot">
            <div className="sp-me">
              <div className="sp-me-av" style={{ background: myAvatarBg }}>
                {(currentUser?.display || currentUser?.username || '?')[0].toUpperCase()}
              </div>
              <div className="sp-me-info">
                <div className="sp-me-name">{currentUser?.display || currentUser?.username}</div>
                <div className="sp-me-role">{meMeta.label}</div>
              </div>
            </div>
          </div>
        </aside>

        {/* Content */}
        <section className="sp-main">
          <header className="sp-main-head">
            <h2 className="sp-main-title">{activeLabel}</h2>
            <button className="sp-main-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </header>

          <div className="sp-main-body">
            {/* GENERAL */}
            {activeTab === 'general' && (
              <div className="sp-rows">
                <div className="sp-row">
                  <div className="sp-row-l">Display name</div>
                  <div className="sp-row-r">
                    <span className="sp-row-v">{currentUser?.display || '-'}</span>
                  </div>
                </div>
                <div className="sp-row">
                  <div className="sp-row-l">Username</div>
                  <div className="sp-row-r">
                    <span className="sp-row-v sp-row-v-mono">@{currentUser?.username || '-'}</span>
                  </div>
                </div>
                <div className="sp-row">
                  <div className="sp-row-l">Role</div>
                  <div className="sp-row-r">
                    <span className="sp-role-pill" style={{ background: meMeta.bg, color: meMeta.color }}>{meMeta.label}</span>
                  </div>
                </div>
                <div className="sp-row-spacer" />
                {canCompare && (
                  <button className="sp-row sp-row-click" onClick={() => { onClose(); onCompare(); }}>
                    <div className="sp-row-l">Compare Brands</div>
                    <div className="sp-row-r">
                      <span className="sp-row-sub">Side-by-side brand analytics</span>
                      <svg className="sp-row-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </button>
                )}
                <button className="sp-row sp-row-click" onClick={() => { onClose(); onOpenLeaderboard(); }}>
                  <div className="sp-row-l">Team Leaderboard</div>
                  <div className="sp-row-r">
                    <span className="sp-row-sub">Hired-by performance rankings</span>
                    <svg className="sp-row-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </div>
                </button>
              </div>
            )}

            {/* PROFILE */}
            {activeTab === 'profile' && (
              <div className="sp-rows">
                <div className="sp-profile-hero">
                  <div className="sp-profile-av" style={{ background: myAvatarBg }}>
                    {(currentUser?.display || currentUser?.username || '?')[0].toUpperCase()}
                  </div>
                  <div className="sp-profile-info">
                    <div className="sp-profile-name">{currentUser?.display || currentUser?.username}</div>
                    <div className="sp-profile-sub">@{currentUser?.username}</div>
                    <div className="sp-profile-pills">
                      <span className="sp-role-pill" style={{ background: meMeta.bg, color: meMeta.color }}>{meMeta.label}</span>
                      <span className="sp-presence-pill"><span className="sp-presence-dot"/>Online</span>
                    </div>
                  </div>
                </div>
                <div className="sp-row">
                  <div className="sp-row-l">Signed in as</div>
                  <div className="sp-row-r"><span className="sp-row-v">{currentUser?.display}</span></div>
                </div>
                <div className="sp-row">
                  <div className="sp-row-l">Session</div>
                  <div className="sp-row-r"><span className="sp-row-v sp-row-v-mono">{(sessionStorage.getItem('ch_session_id') || '').slice(0, 12)}…</span></div>
                </div>
              </div>
            )}

            {/* TEAM */}
            {activeTab === 'team' && (
              <div className="sp-rows">
                <div className="sp-section-t">Hired By Team</div>
                <div className="sp-team-list">
                  {hiredByTeam.map(member => (
                    <div className="sp-team-row" key={member.id}>
                      <div className="sp-team-av" style={{ background: member.bg, color: member.color }}>{member.name[0]}</div>
                      <input className="sp-team-input" value={member.name} onChange={e => renameMember(member.id, e.target.value)} disabled={!isSuperAdmin} />
                      {isSuperAdmin && (
                        <button className="sp-team-del" onClick={() => setConfirmDeleteMember(member)} aria-label="Remove">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      )}
                    </div>
                  ))}
                  {isSuperAdmin && (
                    <div className="sp-team-add">
                      <input className="sp-team-add-in" placeholder="Add new team member..." value={newName}
                        onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addMember()} />
                      <button className="sp-team-add-btn" onClick={addMember}>Add</button>
                    </div>
                  )}
                </div>

                {isSuperAdmin && (<>
                  <div className="sp-section-t sp-section-t-gap">Team Activity {(() => {
                    const others = [...new Set((onlineUsers || []).map(u => String(u.user_id)).filter(id => id && id !== String(currentUser?.id)))];
                    return others.length > 0 ? <span className="sp-section-badge">{others.length} online</span> : null;
                  })()}</div>
                  {loadingUsers ? (
                    <div className="sp-loading"><div className="logs-spinner"/></div>
                  ) : (
                    <div className="sp-activity-list">
                      {appUsers.map(user => {
                        const isOnline = onlineIds.has(String(user.id));
                        const meta = ROLE_META[user.role] || ROLE_META.admin;
                        return (
                          <div key={user.id} className="sp-activity-row">
                            <div className="sp-activity-av" style={{ background: getGradient(user.display || user.username) }}>
                              {(user.display || user.username || '?')[0].toUpperCase()}
                              <span className={`sp-activity-dot${isOnline ? ' on' : ''}`} />
                            </div>
                            <div className="sp-activity-info">
                              <div className="sp-activity-name">{user.display || user.username}</div>
                              <div className="sp-activity-un">@{user.username}</div>
                            </div>
                            <span className="sp-role-pill" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                          </div>
                        );
                      })}
                      {appUsers.length === 0 && <div className="sp-empty">No users yet</div>}
                    </div>
                  )}
                </>)}
              </div>
            )}

            {/* SECURITY (superadmin only) */}
            {activeTab === 'security' && (
              <div className="sp-rows">
                <button className="sp-row sp-row-click" onClick={() => { onClose(); onOpenUserMgmt(); }}>
                  <div className="sp-row-ic sp-row-ic-purple">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M20 8v6"/><path d="M23 11h-6"/></svg>
                  </div>
                  <div className="sp-row-l-stack">
                    <div className="sp-row-l">User Management</div>
                    <div className="sp-row-sub">Roles, access and permissions</div>
                  </div>
                  <svg className="sp-row-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <button className="sp-row sp-row-click" onClick={() => { onClose(); onOpenLogs(); }}>
                  <div className="sp-row-ic sp-row-ic-amber">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </div>
                  <div className="sp-row-l-stack">
                    <div className="sp-row-l">Activity Logs</div>
                    <div className="sp-row-sub">Full audit trail of every action</div>
                  </div>
                  <svg className="sp-row-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
            )}

            {/* ABOUT */}
            {activeTab === 'about' && (
              <div className="sp-rows">
                <div className="sp-row">
                  <div className="sp-row-l">App</div>
                  <div className="sp-row-r"><span className="sp-row-v">Creator Hub</span></div>
                </div>
                <div className="sp-row">
                  <div className="sp-row-l">Version</div>
                  <div className="sp-row-r"><span className="sp-row-v sp-row-v-mono">v8.0</span></div>
                </div>
                <div className="sp-row">
                  <div className="sp-row-l">Environment</div>
                  <div className="sp-row-r"><span className="sp-row-v">Production</span></div>
                </div>
                <div className="sp-row">
                  <div className="sp-row-l">URL</div>
                  <div className="sp-row-r"><span className="sp-row-v sp-row-v-mono">wurx-base.netlify.app</span></div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Confirm delete hired-by member */}
      {confirmDeleteMember && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={e => { if (e.target === e.currentTarget) setConfirmDeleteMember(null); }}>
          <div className="dcm-modal">
            <div className="dcm-emoji">🔥</div>
            <h2 className="dcm-title">Whoa, hold on! 😳</h2>
            <p className="dcm-body">You're about to kick <strong>"{confirmDeleteMember.name}"</strong> off the team.<br/>They didn't even do anything wrong (probably). 😅</p>
            <p className="dcm-hint">Once they're gone, they're gone - no undo this time!</p>
            <div className="dcm-actions">
              <button className="dcm-cancel" onClick={() => setConfirmDeleteMember(null)}>Wait, my bad 🙏</button>
              <button className="dcm-confirm" onClick={() => deleteMember(confirmDeleteMember.id)}>Yeah, fire them 🔥</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── BrandAccessPicker ──────────────────────────────────── */
function BrandAccessPicker({ value = [], onChange, allBrands }) {
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const wrapRef           = useRef(null);

  const suggestions = allBrands.filter(b =>
    !value.includes(b) && b.toLowerCase().includes(query.toLowerCase())
  );

  function pick(b) { onChange([...value, b]); setQuery(''); setOpen(false); }
  function remove(b) { onChange(value.filter(x => x !== b)); }

  useEffect(() => {
    function handle(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div className="bap-wrap" ref={wrapRef}>
      {value.length > 0 && (
        <div className="bap-pills">
          {value.map(b => (
            <span key={b} className="bap-pill">
              {b}
              <button className="bap-pill-x" onClick={() => remove(b)}>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="bap-input-row">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          className="bap-input"
          placeholder={value.length === 0 ? 'Search and assign brands…' : 'Add more brands…'}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (query || value.length < allBrands.length) && (
        <div className="bap-dropdown">
          {suggestions.slice(0, 8).map(b => (
            <button key={b} className="bap-drop-item" onMouseDown={() => pick(b)}>{b}</button>
          ))}
          {suggestions.length === 0 && (
            <div className="bap-drop-empty">{query ? `No brands match "${query}"` : 'All brands assigned'}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── RolePicker ─────────────────────────────────────────── */
function RolePicker({ value, onChange }) {
  return (
    <div className="um-role-picker">
      {Object.entries(ROLE_META).map(([val, { label, color, bg }]) => (
        <button
          key={val}
          type="button"
          className={`um-rp-btn${value === val ? ' um-rp-btn-active' : ''}`}
          style={value === val ? { background: bg, color, borderColor: color + '60' } : {}}
          onClick={() => onChange(val)}
        >
          <span className="um-rp-dot" style={{ background: color }} />
          {label}
        </button>
      ))}
    </div>
  );
}

/* ─── UserManagementModalV2 · Tailwind + Samsung One UI ─── */
/* ─── UserManagement small Wurx-styled building blocks (UMDialog / UMInput / etc.) ─── */
function UMDialog({ onClose, title, sub, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 30,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 22, background: 'color-mix(in srgb, var(--wx-warning-soft) 45%, transparent)',
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      borderRadius: 22, animation: 'sp-fade 0.18s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 400,
        background: 'var(--wx-surface-1)', borderRadius: 18,
        boxShadow: '0 24px 60px rgba(48,39,28,0.28), 0 6px 16px rgba(48,39,28,0.10)',
        padding: '20px 22px 18px',
        animation: 'sp-pop 0.24s cubic-bezier(0.33,1,0.68,1)',
        display: 'flex', flexDirection: 'column', gap: 10,
        fontFamily: 'inherit',
      }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--wx-text)', lineHeight: 1.2 }}>{title}</div>
          {sub && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 4 }}>{sub}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
function UMInput({ placeholder, value, onChange, type = 'text' }) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        height: 42, padding: '0 14px', borderRadius: 11,
        background: 'var(--wx-bg)', border: '1px solid var(--wx-border)',
        fontSize: 13, fontWeight: 600, color: 'var(--wx-text)',
        outline: 'none', fontFamily: 'inherit',
        transition: 'border-color .15s, box-shadow .15s, background .15s',
      }}
      onFocus={e => { e.currentTarget.style.borderColor = '#30271C'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(48,39,28,0.10)'; }}
      onBlur={e => { e.currentTarget.style.borderColor = '#E7E2D7'; e.currentTarget.style.background = '#F8F7F4'; e.currentTarget.style.boxShadow = 'none'; }}
    />
  );
}
function UMRolePicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 2 }}>
      {ROLES.map(r => {
        const m = ROLE_META[r];
        const sel = value === r;
        return (
          <button key={r} type="button" onClick={() => onChange(r)} style={{
            height: 28, padding: '0 11px', borderRadius: 999, border: 0, cursor: 'pointer',
            background: sel ? m.color : 'transparent',
            color: sel ? '#fff' : m.color,
            boxShadow: sel ? 'none' : `inset 0 0 0 1px ${m.color}55`,
            fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4,
            lineHeight: 1, transition: 'background .15s, color .15s', fontFamily: 'inherit',
          }}>{m.label}</button>
        );
      })}
    </div>
  );
}
function UMActions({ children }) {
  return <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>{children}</div>;
}
function UMBtnGhost({ onClick, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex: 1, height: 42, borderRadius: 11,
      background: 'var(--wx-surface-1)', border: '1px solid var(--wx-border)',
      color: 'var(--wx-text)', fontSize: 13, fontWeight: 700,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
      transition: 'background .12s, border-color .12s', fontFamily: 'inherit',
    }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = '#F8F7F4'; e.currentTarget.style.borderColor = '#30271C'; } }}
      onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#E7E2D7'; }}
    >{children}</button>
  );
}
function UMBtnPrimary({ onClick, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex: 1, height: 42, borderRadius: 11,
      background: 'var(--wx-warning-soft)', border: 0,
      color: 'var(--wx-text-muted)', fontSize: 13, fontWeight: 700,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
      transition: 'transform .12s, box-shadow .15s', fontFamily: 'inherit',
      boxShadow: '0 4px 12px rgba(48,39,28,0.18)',
    }}>{children}</button>
  );
}
function UMBtnDanger({ onClick, children, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex: 1, height: 42, borderRadius: 11,
      background: 'var(--wx-danger-soft)', border: 0,
      color: 'var(--wx-text-muted)', fontSize: 13, fontWeight: 700,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
      transition: 'background .15s', fontFamily: 'inherit',
      boxShadow: '0 4px 12px rgba(185,28,28,0.22)',
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#991B1B'; }}
      onMouseLeave={e => { e.currentTarget.style.background = '#B91C1C'; }}
    >{children}</button>
  );
}

function UserManagementModalV2({ onClose, currentUser, onlineUsers = [], allBrands = [] }) {
  const [appUsers, setAppUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('members'); // members | requests
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', display: '', hub_email: '', role: 'admin' });
  const [addError, setAddError] = useState('');
  const [editing, setEditing] = useState(null); // user object
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [joinRequests, setJoinRequests] = useState([]);
  const [createdCreds, setCreatedCreds] = useState(null);
  const [pendingApproval, setPendingApproval] = useState(null);
  const ref = useRef(null);

  const onlineIds = new Set((onlineUsers || []).map(u => String(u.user_id)));

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('app_users').select('*');
      if (data && data.length > 0) setAppUsers(data);
      else {
        const seed = USERS.map(u => ({ id: String(u.id), username: u.username, display: u.display, role: u.role }));
        const { data: seeded } = await supabase.from('app_users').upsert(seed, { onConflict: 'id' }).select();
        setAppUsers(seeded && seeded.length > 0 ? seeded : seed);
      }
      const { data: reqs } = await supabase.from('join_requests').select('*').order('created_at', { ascending: false });
      setJoinRequests(reqs || []);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  async function addUser() {
    const { username, display, hub_email, role } = newUser;
    if (!username.trim() || !display.trim()) return;
    /* THE EMAIL IS THE WHOLE POINT OF THE ROW NOW. Without it this person is
       not recognised on arrival and falls back to a role derived from their
       hub role, which is the more generous of the two. Refusing here is
       cheaper than explaining later why somebody could edit money. */
    const email = hub_email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAddError('A hub email is required — it is how this person is recognised when they sign in.');
      return;
    }
    setAddError(''); setSaving(true);
    const id = username.trim().toLowerCase().replace(/\s+/g, '_');
    const payload = { id, username: username.trim(), display: display.trim(), hub_email: email, role, brand_access: [] };
    const { error } = await supabase.from('app_users').insert([payload]);
    if (error) { setAddError(error.message); setSaving(false); return; }
    const { data: fresh } = await supabase.from('app_users').select('*');
    setAppUsers(fresh || [...appUsers, payload]);
    setNewUser({ username: '', display: '', hub_email: '', role: 'admin' });
    setShowAdd(false); setSaving(false);
  }

  async function saveEdit() {
    if (!editForm.display?.trim()) return;
    const email = (editForm.hub_email || '').trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEditError('That does not look like an email address.');
      return;
    }
    setEditError(''); setSaving(true);
    /* Blank clears the link rather than storing an empty string, so the unique
       index sees a null and two unlinked people do not collide. */
    const patch = { display: editForm.display.trim(), hub_email: email || null, role: editForm.role };
    const { error } = await supabase.from('app_users').update(patch).eq('id', editing.id);
    if (!error) {
      setAppUsers(prev => prev.map(u => u.id === editing.id ? { ...u, ...patch } : u));
      setEditing(null);
    } else setEditError(error.message);
    setSaving(false);
  }

  async function deleteUser(id) {
    await supabase.from('app_users').delete().eq('id', id);
    setAppUsers(prev => prev.filter(u => u.id !== id));
    setConfirmDel(null);
  }

  async function handleApprove(req, role) {
    const id = req.username.toLowerCase().replace(/\s+/g, '_');
    /* They asked for access with an email, so that is the address we link
       them by. No password is generated: there is nothing here to log into. */
    const email = (req.email || '').trim().toLowerCase() || null;
    const u = { id, username: req.username, display: req.name, hub_email: email, role, brand_access: [] };
    const { error } = await supabase.from('app_users').insert([u]);
    if (error) { alert(error.message); return; }
    const { data: fresh } = await supabase.from('app_users').select('*');
    setAppUsers(fresh || [...appUsers, u]);
    await supabase.from('join_requests').update({ status: 'approved' }).eq('id', req.id);
    setJoinRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'approved' } : r));
    setPendingApproval(null);
    setCreatedCreds({ username: req.username, hub_email: email, display: req.name });
  }

  async function handleReject(req) {
    await supabase.from('join_requests').update({ status: 'rejected' }).eq('id', req.id);
    setJoinRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'rejected' } : r));
  }

  const pendingReqs = joinRequests.filter(r => r.status === 'pending');
  const filtered = appUsers.filter(u =>
    !search ||
    u.display?.toLowerCase().includes(search.toLowerCase()) ||
    u.username?.toLowerCase().includes(search.toLowerCase()) ||
    u.hub_email?.toLowerCase().includes(search.toLowerCase()) ||
    u.role?.toLowerCase().includes(search.toLowerCase())
  );
  const onlineCount = appUsers.filter(u => onlineIds.has(String(u.id))).length;


  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 990,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        background: 'color-mix(in srgb, var(--wx-warning-soft) 50%, transparent)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        fontFamily: 'inherit',
      }}
    >
      <div ref={ref}
        style={{
          position: 'relative', width: '100%', maxWidth: 820, maxHeight: '92vh',
          background: 'var(--wx-bg)', borderRadius: 22,
          boxShadow: '0 32px 80px rgba(48,39,28,0.25), 0 8px 24px rgba(48,39,28,0.10)',
          animation: 'sp-pop 0.32s cubic-bezier(0.33,1,0.68,1)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>

        {/* ── Header · dark coffee ── */}
        <div style={{ background: 'var(--wx-warning-soft)', padding: '16px 22px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--wx-text-muted)' }}>Team</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span><strong style={{ color: 'var(--wx-text-muted)' }}>{appUsers.length}</strong> members</span>
              <span><strong style={{ color: 'var(--wx-success)' }}>{onlineCount}</strong> online</span>
              {pendingReqs.length > 0 && <span><strong style={{ color: 'var(--wx-warning)' }}>{pendingReqs.length}</strong> pending</span>}
            </div>
          </div>
          <button onClick={onClose} title="Close" style={{ width: 34, height: 34, borderRadius: 999, border: 0, cursor: 'pointer', background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.10)'; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* ── Toolbar · pill tabs + search + add ── */}
        <div style={{ padding: '14px 22px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--wx-surface-1)', borderRadius: 999, padding: 4, border: '1px solid var(--wx-border)' }}>
            {[{id:'members', l:'Members', n:appUsers.length}, {id:'requests', l:'Requests', n:pendingReqs.length}].map(t => {
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  height: 32, padding: '0 14px', borderRadius: 999, border: 0, cursor: 'pointer',
                  background: active ? '#30271C' : 'transparent',
                  color: active ? '#F5E9D6' : '#6B7280',
                  fontSize: 12, fontWeight: 700, letterSpacing: '-0.1px',
                  display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1,
                  transition: 'background .15s, color .15s', fontFamily: 'inherit',
                }}>
                  {t.l}
                  {t.n > 0 && <span style={{ minWidth: 18, height: 16, padding: '0 6px', borderRadius: 999, fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: active ? 'rgba(245,233,214,0.22)' : '#F4F2EE', color: active ? '#F5E9D6' : '#6B7280' }}>{t.n}</span>}
                </button>
              );
            })}
          </div>
          {tab === 'members' && (<>
            <div style={{ flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 14px', borderRadius: 999, background: 'var(--wx-surface-1)', border: '1px solid var(--wx-border)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9C8F7C" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members"
                style={{ flex: 1, background: 'transparent', border: 0, outline: 'none', fontSize: 12.5, fontWeight: 600, color: 'var(--wx-text)', fontFamily: 'inherit' }} />
            </div>
            <button onClick={() => setShowAdd(true)} style={{
              height: 36, padding: '0 14px', borderRadius: 999, border: 0, cursor: 'pointer',
              background: 'var(--wx-warning-soft)', color: 'var(--wx-text-muted)',
              fontSize: 12.5, fontWeight: 700, letterSpacing: '-0.1px',
              display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1,
              fontFamily: 'inherit', transition: 'transform .12s',
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add
            </button>
          </>)}
        </div>

        {/* Body */}
        <div className="tw-flex-1 tw-overflow-y-auto tw-px-6 sm:tw-px-8 tw-pb-7">
          {loading ? (
            <div className="tw-py-16 tw-text-center tw-text-[13.5px] tw-text-oneui-mute">Loading…</div>
          ) : tab === 'members' ? (
            <div className="tw-bg-white tw-rounded-[20px] tw-shadow-oneui tw-overflow-hidden">
              {filtered.length === 0 ? (
                <div className="tw-py-16 tw-text-center tw-text-[13.5px] tw-text-oneui-mute">No members match "{search}"</div>
              ) : filtered.map((u, i) => {
                const meta = ROLE_META[u.role] || ROLE_META.admin;
                const isSelf = String(u.id) === String(currentUser?.id);
                const isOnline = onlineIds.has(String(u.id));
                return (
                  <div key={u.id} data-member={u.id} className={`um-row tw-flex tw-items-center tw-gap-3 tw-px-5 tw-py-3.5 ${i > 0 ? 'tw-border-t tw-border-black/5' : ''} hover:tw-bg-black/[0.02] tw-transition`}>
                    <div className="tw-relative tw-shrink-0">
                      <div className="tw-w-11 tw-h-11 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-text-[16px] tw-font-extrabold" style={{ background: meta.bg, color: meta.color }}>
                        {(u.display || '?')[0].toUpperCase()}
                      </div>
                      <span className={`tw-absolute tw-bottom-0 tw-right-0 tw-w-3 tw-h-3 tw-rounded-full tw-border-2 tw-border-white ${isOnline ? 'tw-bg-emerald-600' : 'tw-bg-gray-300'}`} />
                    </div>
                    <div className="tw-flex-1 tw-min-w-0">
                      <div className="tw-flex tw-items-center tw-gap-2 tw-flex-wrap">
                        <span className="tw-text-[14.5px] tw-font-bold tw-text-oneui-ink tw-tracking-[-0.1px]">{u.display}</span>
                        {isSelf && <span className="tw-text-[10px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-px-2 tw-py-0.5 tw-rounded-full tw-bg-blue-50 tw-text-[#1259C3]">You</span>}
                      </div>
                      {/* The email is what decides whether this person is
                          recognised on arrival, so it is shown, not hidden in
                          the edit dialog. Unlinked is a warning, because an
                          unlinked person falls back to a wider role. */}
                      <div className="tw-text-[12px] tw-font-medium tw-text-oneui-mute tw-mt-0.5 tw-truncate">
                        @{u.username}
                        {u.hub_email
                          ? <> · {u.hub_email}</>
                          : <span style={{ color: 'var(--wx-danger)', fontWeight: 700 }}> · no hub email</span>}
                      </div>
                    </div>
                    <span className="tw-text-[10.5px] tw-font-bold tw-uppercase tw-tracking-wider tw-px-2.5 tw-h-6 tw-rounded-full tw-flex tw-items-center" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                    <div className="tw-flex tw-gap-1.5 tw-shrink-0">
                      <button onClick={() => { setEditing(u); setEditForm({ display: u.display, hub_email: u.hub_email || '', role: u.role }); setEditError(''); }}
                        className="um-edit-btn tw-w-9 tw-h-9 tw-rounded-full tw-bg-blue-50 tw-text-[#1259C3] tw-flex tw-items-center tw-justify-center tw-border-0 tw-cursor-pointer hover:tw-bg-[#1259C3] hover:tw-text-white active:tw-scale-95 tw-transition tw-duration-200 tw-ease-oneui">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      {!isSelf && (
                        <button onClick={() => setConfirmDel(u)}
                          className="tw-w-9 tw-h-9 tw-rounded-full tw-bg-rose-50 tw-text-rose-700 tw-flex tw-items-center tw-justify-center tw-border-0 tw-cursor-pointer hover:tw-bg-rose-600 hover:tw-text-white active:tw-scale-95 tw-transition tw-duration-200 tw-ease-oneui">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Requests tab */
            <div className="tw-bg-white tw-rounded-[20px] tw-shadow-oneui tw-overflow-hidden">
              {pendingReqs.length === 0 ? (
                <div className="tw-py-16 tw-text-center tw-text-[13.5px] tw-text-oneui-mute">No pending requests</div>
              ) : pendingReqs.map((req, i) => (
                <div key={req.id} className={`tw-flex tw-items-center tw-gap-3 tw-px-5 tw-py-4 ${i > 0 ? 'tw-border-t tw-border-black/5' : ''}`}>
                  <div className="tw-w-11 tw-h-11 tw-rounded-full tw-bg-gradient-to-br tw-from-[#1259C3] tw-to-[#0E4DAD] tw-text-white tw-text-[16px] tw-font-extrabold tw-flex tw-items-center tw-justify-center tw-shrink-0 tw-leading-none">
                    {(req.name || '?')[0].toUpperCase()}
                  </div>
                  <div className="tw-flex-1 tw-min-w-0">
                    <div className="tw-text-[14.5px] tw-font-bold tw-text-oneui-ink">{req.name}</div>
                    <div className="tw-text-[12px] tw-font-medium tw-text-oneui-mute tw-mt-0.5 tw-truncate">@{req.username} · {req.email}</div>
                  </div>
                  <button onClick={() => setPendingApproval({ req, role: 'admin' })}
                    className="tw-h-9 tw-px-4 tw-rounded-full tw-bg-emerald-600 tw-text-white tw-text-[12px] tw-font-bold tw-border-0 tw-cursor-pointer hover:tw-bg-emerald-700 active:tw-scale-95 tw-transition tw-duration-200 tw-ease-oneui">
                    Approve
                  </button>
                  <button onClick={() => handleReject(req)}
                    className="tw-h-9 tw-px-4 tw-rounded-full tw-bg-rose-50 tw-text-rose-700 tw-text-[12px] tw-font-bold tw-border-0 tw-cursor-pointer hover:tw-bg-rose-600 hover:tw-text-white active:tw-scale-95 tw-transition tw-duration-200 tw-ease-oneui">
                    Reject
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Add Member Dialog · Wurx style ── */}
        {showAdd && (
          <UMDialog onClose={() => setShowAdd(false)} title="Add member" sub="New workspace account">
            <UMInput placeholder="Username" value={newUser.username} onChange={v => setNewUser(f => ({ ...f, username: v }))} />
            <UMInput placeholder="Display name" value={newUser.display} onChange={v => setNewUser(f => ({ ...f, display: v }))} />
            <UMInput placeholder="Hub email · how they are recognised" value={newUser.hub_email} onChange={v => setNewUser(f => ({ ...f, hub_email: v }))} />
            <UMRolePicker value={newUser.role} onChange={v => setNewUser(f => ({ ...f, role: v }))} />
            {addError && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--wx-danger)', marginTop: 2 }}>⚠ {addError}</div>}
            <UMActions>
              <UMBtnGhost onClick={() => setShowAdd(false)}>Cancel</UMBtnGhost>
              <UMBtnPrimary onClick={addUser} disabled={saving}>{saving ? 'Creating…' : 'Create'}</UMBtnPrimary>
            </UMActions>
          </UMDialog>
        )}

        {/* ── Edit Member Dialog ── */}
        {editing && (
          <UMDialog onClose={() => setEditing(null)} title={`Edit ${editing.display}`} sub={`@${editing.username}`}>
            <UMInput placeholder="Display name" value={editForm.display || ''} onChange={v => setEditForm(f => ({ ...f, display: v }))} />
            <UMInput placeholder="Hub email · how they are recognised" value={editForm.hub_email || ''} onChange={v => setEditForm(f => ({ ...f, hub_email: v }))} />
            <UMRolePicker value={editForm.role} onChange={v => setEditForm(f => ({ ...f, role: v }))} />
            {editError && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--wx-danger)', marginTop: 2 }}>⚠ {editError}</div>}
            <UMActions>
              <UMBtnGhost onClick={() => setEditing(null)}>Cancel</UMBtnGhost>
              <UMBtnPrimary onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</UMBtnPrimary>
            </UMActions>
          </UMDialog>
        )}

        {/* ── Confirm Delete ── */}
        {confirmDel && (
          <UMDialog onClose={() => setConfirmDel(null)} title="Remove member?" sub={`${confirmDel.display} · @${confirmDel.username}`}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--wx-text-muted)', marginTop: 4, marginBottom: 4 }}>
              This will permanently remove their access to the workspace.
            </div>
            <UMActions>
              <UMBtnGhost onClick={() => setConfirmDel(null)}>Cancel</UMBtnGhost>
              <UMBtnDanger onClick={() => deleteUser(confirmDel.id)}>Remove</UMBtnDanger>
            </UMActions>
          </UMDialog>
        )}

        {/* ── Approve Role Picker ── */}
        {pendingApproval && (
          <UMDialog onClose={() => setPendingApproval(null)} title={`Approve ${pendingApproval.req.name}?`} sub="Pick a role to assign">
            <UMRolePicker value={pendingApproval.role} onChange={v => setPendingApproval(p => ({ ...p, role: v }))} />
            <UMActions>
              <UMBtnGhost onClick={() => setPendingApproval(null)}>Cancel</UMBtnGhost>
              <UMBtnPrimary onClick={() => handleApprove(pendingApproval.req, pendingApproval.role)}>Approve &amp; Create</UMBtnPrimary>
            </UMActions>
          </UMDialog>
        )}

        {/* ── Created creds ── */}
        {createdCreds && (
          <UMDialog onClose={() => setCreatedCreds(null)} title="Member added" sub={`${createdCreds.display} now has a role here`}>
            <div style={{ background: 'var(--wx-bg)', border: '1px solid var(--wx-border)', borderRadius: 12, padding: 14, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--wx-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Username</span>
                <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13, fontWeight: 700, color: 'var(--wx-text)' }}>{createdCreds.username}</span>
              </div>
              <div style={{ height: 1, background: 'var(--wx-surface-3)' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--wx-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Hub email</span>
                <span style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13, fontWeight: 700, color: 'var(--wx-text)' }}>{createdCreds.hub_email || 'not set'}</span>
              </div>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--wx-text-muted)', marginTop: 10, lineHeight: 1.5 }}>
              There is no password to share. They sign in to the hub with that
              email, and this is the role they arrive with.
            </div>
            <UMActions>
              <UMBtnGhost onClick={() => navigator.clipboard.writeText(createdCreds.hub_email || '')}>Copy email</UMBtnGhost>
              <UMBtnPrimary onClick={() => setCreatedCreds(null)}>Done</UMBtnPrimary>
            </UMActions>
          </UMDialog>
        )}
      </div>
    </div>
  );
}

/* ─── ActivityLogsPanel ──────────────────────────────────── */
const LOG_META = {
  LOGIN:             { icon: '🔑', color: 'var(--wx-text-faint)', bg: '#EEF2FF' },
  LOGOUT:            { icon: '🚪', color: 'var(--wx-text-muted)', bg: '#F1F5F9' },
  CREATOR_ADD:       { icon: '✨', color: 'var(--wx-success)', bg: '#ECFDF5' },
  CREATOR_UPDATE:    { icon: '✏️', color: 'var(--wx-warning)', bg: '#FFFBEB' },
  CREATOR_DELETE:    { icon: '🗑️', color: 'var(--wx-danger)', bg: '#FEF2F2' },
  BULK_DELETE:       { icon: '🗑️', color: 'var(--wx-danger)', bg: '#FEF2F2' },
  BULK_STATUS_EDIT:  { icon: '⚡', color: 'var(--wx-text-muted)', bg: '#F5F3FF' },
  BRAND_DELETE:      { icon: '🏷️', color: 'var(--wx-danger)', bg: '#FEF2F2' },
  EXPORT_CSV:        { icon: '📥', color: 'var(--wx-text-muted)', bg: '#EFF6FF' },
};

/* ─── BulkStatusModal ────────────────────────────────────── */
function BulkStatusModal({ count, onSave, onClose }) {
  const [payment, setPayment] = useState('');
  const [videos, setVideos]   = useState('');
  const canApply = payment || videos;

  return (
    <div className="bsm-overlay" onClick={onClose}>
      <div className="bsm-modal" onClick={e => e.stopPropagation()}>
        <div className="bsm-header">
          <div className="bsm-title">Edit Status</div>
          <div className="bsm-subtitle">{count} creator{count !== 1 ? 's' : ''} selected</div>
        </div>

        <div className="bsm-body">
          <div className="bsm-field">
            <div className="bsm-field-label">Payment Status</div>
            <div className="bsm-options">
              {[['', 'No change', ''], ['Paid', 'Paid ✓', '#059669'], ['Not Yet', 'Not Yet', '#DC2626']].map(([v, label, col]) => (
                <button key={v} className={`bsm-opt${payment === v ? ' active' : ''}`}
                  style={payment === v && col ? { background: col, color: 'var(--wx-text-muted)', borderColor: col } : {}}
                  onClick={() => setPayment(p => p === v ? '' : v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="bsm-field">
            <div className="bsm-field-label">Video Status</div>
            <div className="bsm-options">
              {[['', 'No change', ''], ['Done', 'Done ✓', '#059669'], ['In Progress', 'In Progress', '#D97706']].map(([v, label, col]) => (
                <button key={v} className={`bsm-opt${videos === v ? ' active' : ''}`}
                  style={videos === v && col ? { background: col, color: 'var(--wx-text-muted)', borderColor: col } : {}}
                  onClick={() => setVideos(p => p === v ? '' : v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="bsm-footer">
          <button className="bsm-cancel" onClick={onClose}>Cancel</button>
          <button className="bsm-apply" disabled={!canApply}
            onClick={() => onSave({ ...(payment ? { payment_status: payment } : {}), ...(videos ? { videos } : {}) })}>
            Apply to {count} creator{count !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

function logLabel(log) {
  switch (log.action) {
    case 'LOGIN':          return 'signed in';
    case 'LOGOUT':         return 'signed out';
    case 'CREATOR_ADD':    return `added "${log.target}"`;
    case 'CREATOR_UPDATE': return `updated "${log.target}"`;
    case 'CREATOR_DELETE': return `deleted "${log.target}"`;
    case 'BULK_DELETE':    return `bulk deleted ${log.details?.count || ''} creators`;
    case 'BULK_STATUS_EDIT': {
      const parts = [];
      if (log.details?.payment_status) parts.push(`payment - ${log.details.payment_status}`);
      if (log.details?.videos)         parts.push(`videos - ${log.details.videos}`);
      const what = parts.length ? ` (${parts.join(', ')})` : '';
      return `bulk updated ${log.details?.count || ''} creators${what}`;
    }
    case 'BRAND_DELETE':   return `deleted brand "${log.target}"`;
    case 'EXPORT_CSV':     return 'exported video codes CSV';
    default:               return log.action.toLowerCase().replace(/_/g, ' ');
  }
}

function logSub(log) {
  if (log.action === 'LOGIN' && log.details?.ip)
    return `IP: ${log.details.ip}`;
  if (log.action === 'EXPORT_CSV' && log.details?.count)
    return `${log.details.count} creator${log.details.count !== 1 ? 's' : ''} exported`;
  if (log.action === 'BRAND_DELETE' && log.details?.count != null)
    return `${log.details.count} creator${log.details.count !== 1 ? 's' : ''} removed`;
  if (log.details?.brand) return `Brand: ${log.details.brand}`;
  return null;
}

function LogEntry({ log, hideTop }) {
  const sub = logSub(log);
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 14px',
      borderTop: hideTop ? 'none' : '1px solid #F2EEE7',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
        background: 'var(--wx-bg)', color: 'var(--wx-warning)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--wx-text)', letterSpacing: '-0.1px', lineHeight: 1.4 }}>
          <span style={{ fontWeight: 700 }}>{log.user_display}</span>{' '}
          <span style={{ color: 'var(--wx-text-muted)' }}>{logLabel(log)}</span>
        </div>
        {sub && <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 3 }}>{sub}</div>}
        {log.action === 'CREATOR_UPDATE' && log.details?.changes?.length > 0 && (
          <div style={{ marginTop: 6, padding: 8, borderRadius: 8, background: 'var(--wx-bg)', border: '1px solid var(--wx-border)' }}>
            {log.details.changes.map((ch, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, marginTop: i > 0 ? 4 : 0 }}>
                <span style={{ color: 'var(--wx-text-muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.3, minWidth: 60 }}>{ch.field}</span>
                <span style={{ color: 'var(--wx-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{ch.from || '-'}</span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#9C8F7C" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <span style={{ color: 'var(--wx-text)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{ch.to || '-'}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
          {timeAgo(log.created_at)}
          <span style={{ width: 2, height: 2, borderRadius: 999, background: 'var(--wx-accent)', opacity: 0.5 }} />
          <span>{new Date(log.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
        </div>
      </div>
    </div>
  );
}

/* Parse a user-agent string into "Chrome on Mac" / "Safari on iPhone" etc. */
function parseUA(ua) {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', icon: '💻' };
  const u = ua.toLowerCase();
  let browser = 'Browser';
  if (u.includes('edg/')) browser = 'Edge';
  else if (u.includes('chrome') && !u.includes('edg')) browser = 'Chrome';
  else if (u.includes('firefox')) browser = 'Firefox';
  else if (u.includes('safari') && !u.includes('chrome')) browser = 'Safari';
  else if (u.includes('opera') || u.includes('opr/')) browser = 'Opera';
  let os = 'Desktop';
  let icon = '💻';
  if (u.includes('iphone')) { os = 'iPhone'; icon = '📱'; }
  else if (u.includes('ipad')) { os = 'iPad'; icon = '📱'; }
  else if (u.includes('android')) { os = 'Android'; icon = '📱'; }
  else if (u.includes('windows')) { os = 'Windows'; icon = '💻'; }
  else if (u.includes('mac')) { os = 'Mac'; icon = '💻'; }
  else if (u.includes('linux')) { os = 'Linux'; icon = '💻'; }
  return { browser, os, icon };
}

function ReviewQueueModal({ onClose, onAfterAction, currentUser }) {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('creators').select('*')
      .eq('status', 'pending').order('inserted_at', { ascending: false });
    setPending(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function approve(c) {
    setBusyId(c.id);
    const { error } = await supabase.from('creators').update({ status: 'approved' }).eq('id', c.id);
    setBusyId(null);
    if (error) { alert('Approve failed: ' + error.message); return; }
    setPending(prev => prev.filter(p => p.id !== c.id));
    onAfterAction?.();
  }
  async function reject(c) {
    if (!window.confirm(`Reject and delete "${c.name}"?`)) return;
    setBusyId(c.id);
    const { error } = await supabase.from('creators').delete().eq('id', c.id);
    setBusyId(null);
    if (error) { alert('Reject failed: ' + error.message); return; }
    setPending(prev => prev.filter(p => p.id !== c.id));
    onAfterAction?.();
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rq-modal">
        <div className="rq-head">
          <div>
            <h2 className="rq-title">Pending Approvals</h2>
            <div className="rq-sub">{pending.length} creator{pending.length !== 1 ? 's' : ''} awaiting your review</div>
          </div>
          <button className="ndm-close" onClick={onClose} style={{position:'static',flexShrink:0}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="rq-list">
          {loading ? (
            <div className="rq-empty">Loading...</div>
          ) : pending.length === 0 ? (
            <div className="rq-empty">
              <div className="rq-empty-icon">✓</div>
              <div>All caught up. No pending submissions</div>
            </div>
          ) : pending.map(c => {
            const { handle } = parseTikTok(c.tiktok_account);
            const { amount, videos } = parseDeal(c.deal);
            return (
              <div key={c.id} className="rq-row">
                <div className="rq-av" style={{ background: getGradient(c.name) }}>
                  {c.name ? c.name[0].toUpperCase() : '?'}
                </div>
                <div className="rq-info">
                  <div className="rq-name">{c.name}</div>
                  <div className="rq-meta">
                    {handle && <span>{handle}</span>}
                    {c.brand && <><span className="rq-dot">·</span><span>{c.brand}</span></>}
                    {amount > 0 && <><span className="rq-dot">·</span><span className="rq-amt">${amount.toLocaleString()}{videos > 0 && `/${videos}vid`}</span></>}
                  </div>
                </div>
                <div className="rq-actions">
                  <button className="rq-btn rq-reject" disabled={busyId === c.id} onClick={() => reject(c)}>Reject</button>
                  <button className="rq-btn rq-approve" disabled={busyId === c.id} onClick={() => approve(c)}>Approve</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DevicesModal({ onClose, currentUser }) {
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revokedIds, setRevokedIds] = useState(new Set());
  const [filter, setFilter] = useState('all');
  const [expandedUserId, setExpandedUserId] = useState(null);
  const mySessionId = sessionStorage.getItem('ch_session_id');
  const [now, setNow] = useState(Date.now());

  // Re-render every 30s so "active now" status stays accurate
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(iv);
  }, []);

  async function refresh() {
    setLoading(true);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [u, l, r] = await Promise.all([
      supabase.from('app_users').select('*').order('last_seen', { ascending: false, nullsLast: true }),
      supabase.from('activity_logs').select('*').eq('action', 'LOGIN').gte('created_at', since).order('created_at', { ascending: false }).limit(500),
      supabase.from('revoked_sessions').select('session_id'),
    ]);
    setUsers(u.data || []);
    setLogs(l.data || []);
    setRevokedIds(new Set((r.data || []).map(x => x.session_id)));
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function revoke(sessionId) {
    if (!sessionId) return;
    if (sessionId === mySessionId && !window.confirm('This is your current session. Revoking will log you out. Continue?')) return;
    const { error } = await supabase.from('revoked_sessions').insert({ session_id: sessionId, revoked_by: currentUser.display, revoked_at: new Date().toISOString() });
    if (error) { alert('Revoke failed: ' + error.message); return; }
    setRevokedIds(prev => new Set([...prev, sessionId]));
  }

  async function revokeAllForUser(userId) {
    const userLogs = logs.filter(log => String(log.user_id) === String(userId) && log.details?.sessionId);
    const sids = [...new Set(userLogs.map(log => log.details.sessionId))].filter(sid => !revokedIds.has(sid));
    if (sids.length === 0) { alert('No active sessions to revoke.'); return; }
    if (!window.confirm(`Force logout this user from ${sids.length} session${sids.length !== 1 ? 's' : ''}?`)) return;
    const rows = sids.map(sid => ({ session_id: sid, revoked_by: currentUser.display, revoked_at: new Date().toISOString() }));
    const { error } = await supabase.from('revoked_sessions').insert(rows);
    if (error) { alert('Revoke failed: ' + error.message); return; }
    setRevokedIds(prev => new Set([...prev, ...sids]));
  }

  // Group logs by user
  const logsByUser = useMemo(() => {
    const m = {};
    logs.forEach(log => {
      const uid = String(log.user_id);
      if (!m[uid]) m[uid] = [];
      m[uid].push(log);
    });
    return m;
  }, [logs]);

  // Compute status per user (online / recent / idle)
  function getStatus(user) {
    if (!user.last_seen) return { level: 'idle', label: 'Never seen' };
    const diff = now - new Date(user.last_seen).getTime();
    if (diff < 2 * 60 * 1000) return { level: 'online', label: 'Online now' };
    if (diff < 30 * 60 * 1000) return { level: 'online', label: 'Active' };
    if (diff < 24 * 60 * 60 * 1000) return { level: 'recent', label: 'Today' };
    if (diff < 7 * 24 * 60 * 60 * 1000) return { level: 'recent', label: relativeTime(user.last_seen) };
    return { level: 'idle', label: relativeTime(user.last_seen) };
  }

  const filtered = useMemo(() => {
    return users.map(u => ({ user: u, status: getStatus(u), userLogs: logsByUser[String(u.id)] || [] }))
      .filter(({ status }) => {
        if (filter === 'online') return status.level === 'online';
        if (filter === 'today') return status.level === 'online' || status.level === 'recent';
        if (filter === 'idle') return status.level === 'idle';
        return true;
      })
      .sort((a, b) => {
        const order = { online: 0, recent: 1, idle: 2 };
        if (order[a.status.level] !== order[b.status.level]) return order[a.status.level] - order[b.status.level];
        const at = a.user.last_seen ? new Date(a.user.last_seen).getTime() : 0;
        const bt = b.user.last_seen ? new Date(b.user.last_seen).getTime() : 0;
        return bt - at;
      });
  }, [users, logsByUser, filter, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const online = users.filter(u => u.last_seen && (now - new Date(u.last_seen).getTime()) < 30 * 60 * 1000).length;
    const today  = users.filter(u => u.last_seen && (now - new Date(u.last_seen).getTime()) < 24 * 60 * 60 * 1000).length;
    const totalSessions = logs.length;
    const activeRevoked = [...revokedIds].length;
    return { online, today, totalSessions, activeRevoked };
  }, [users, logs, revokedIds, now]);

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dev-modal">
        <div className="dev-head">
          <div>
            <h2 className="dev-title">Devices &amp; Sessions</h2>
            <div className="dev-sub">Real-time user activity & session management</div>
          </div>
          <button className="ndm-close" onClick={onClose} style={{position:'static',flexShrink:0}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Stat cards */}
        <div className="dev-stats">
          <div className="dev-stat dev-stat-online">
            <span className="dev-stat-dot" />
            <div>
              <div className="dev-stat-v">{stats.online}</div>
              <div className="dev-stat-l">Active</div>
            </div>
          </div>
          <div className="dev-stat">
            <div>
              <div className="dev-stat-v">{stats.today}</div>
              <div className="dev-stat-l">Today</div>
            </div>
          </div>
          <div className="dev-stat">
            <div>
              <div className="dev-stat-v">{users.length}</div>
              <div className="dev-stat-l">Users</div>
            </div>
          </div>
          <div className="dev-stat">
            <div>
              <div className="dev-stat-v">{stats.totalSessions}</div>
              <div className="dev-stat-l">30d Logins</div>
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="dev-filters">
          {[
            { id: 'all',    label: 'All' },
            { id: 'online', label: 'Active' },
            { id: 'today',  label: 'Last 24h' },
            { id: 'idle',   label: 'Idle' },
          ].map(t => (
            <button key={t.id} className={`dev-filter-btn${filter === t.id ? ' active' : ''}`} onClick={() => setFilter(t.id)}>
              {t.label}
            </button>
          ))}
          <button className="dev-refresh" onClick={refresh} title="Refresh">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>
          </button>
        </div>

        <div className="dev-list">
          {loading ? (
            <div className="dev-empty">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="dev-empty">No users match this filter</div>
          ) : filtered.map(({ user, status, userLogs }) => {
            const isExpanded = expandedUserId === user.id;
            const latestLog = userLogs[0];
            const ua = parseUA(latestLog?.details?.ua);
            const sid = latestLog?.details?.sessionId;
            const hasMySession = userLogs.some(l => l.details?.sessionId === mySessionId);
            const activeSessions = userLogs.filter(l => l.details?.sessionId && !revokedIds.has(l.details.sessionId));
            return (
              <div key={user.id} className={`dev-user-card dev-status-${status.level}`}>
                <div className="dev-user-row" onClick={() => setExpandedUserId(isExpanded ? null : user.id)}>
                  <div className="dev-user-av" style={{ background: getGradient(user.display) }}>
                    {(user.display || user.username || '?')[0].toUpperCase()}
                    <span className={`dev-presence dev-presence-${status.level}`} />
                  </div>
                  <div className="dev-user-info">
                    <div className="dev-user-top">
                      <span className="dev-user-name">{user.display || user.username}</span>
                      {hasMySession && <span className="dev-me-pill">You</span>}
                      <span className={`dev-role-pill role-${user.role}`}>{user.role}</span>
                    </div>
                    <div className="dev-user-meta">
                      <span className={`dev-status-text dev-status-text-${status.level}`}>{status.label}</span>
                      {latestLog && <>
                        <span className="dev-dot">·</span>
                        <span>{ua.icon} {ua.browser} on {ua.os}</span>
                        {latestLog.details?.ip && <><span className="dev-dot">·</span><span className="dev-ip">{latestLog.details.ip}</span></>}
                      </>}
                      {!latestLog && user.last_seen && <><span className="dev-dot">·</span><span>Last seen {relativeTime(user.last_seen)}</span></>}
                    </div>
                  </div>
                  <div className="dev-user-actions">
                    {activeSessions.length > 0 && (
                      <span className="dev-sessions-count" title={`${activeSessions.length} active session${activeSessions.length !== 1 ? 's' : ''}`}>
                        {activeSessions.length}
                      </span>
                    )}
                    <svg className={`dev-chev${isExpanded ? ' open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                  </div>
                </div>

                {isExpanded && (
                  <div className="dev-expand">
                    {userLogs.length === 0 ? (
                      <div className="dev-no-logs">No login history recorded</div>
                    ) : <>
                      <div className="dev-expand-head">
                        <span>Recent sessions ({userLogs.length})</span>
                        {activeSessions.length > 0 && user.id !== currentUser.id && (
                          <button className="dev-revoke-all" onClick={() => revokeAllForUser(user.id)}>
                            Force logout
                          </button>
                        )}
                      </div>
                      <div className="dev-session-list">
                        {userLogs.slice(0, 10).map(log => {
                          const lsid = log.details?.sessionId;
                          const isRevoked = lsid && revokedIds.has(lsid);
                          const isMe = lsid === mySessionId;
                          const lua = parseUA(log.details?.ua);
                          return (
                            <div key={log.id} className={`dev-session${isRevoked ? ' revoked' : ''}${isMe ? ' me' : ''}`}>
                              <div className="dev-session-icon">{lua.icon}</div>
                              <div className="dev-session-info">
                                <div className="dev-session-top">
                                  <span>{lua.browser} on {lua.os}</span>
                                  {isMe && <span className="dev-me-pill">This device</span>}
                                  {isRevoked && <span className="dev-revoked-pill">Revoked</span>}
                                </div>
                                <div className="dev-session-meta">
                                  {log.details?.ip && <span className="dev-ip">{log.details.ip}</span>}
                                  {log.details?.ip && <span className="dev-dot">·</span>}
                                  <span>{timeAgo(log.created_at)}</span>
                                </div>
                              </div>
                              {lsid && !isRevoked && (
                                <button className="dev-revoke-btn" onClick={(e) => { e.stopPropagation(); revoke(lsid); }}>
                                  Revoke
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ActivityLogsPanel({ onClose }) {
  const [logs, setLogs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [filter, setFilter]   = useState('all');

  async function fetchLogs() {
    // DISCOVERY_MARK rows are outreach state (one persistent row per creator
    // handle), not audit events — they'd flood this feed, so keep them out.
    const { data, error: err } = await supabase
      .from('activity_logs')
      .select('*')
      .neq('action', 'DISCOVERY_MARK')
      .neq('action', 'BRAND_CONTRACT')
      .neq('action', 'CREATIVE_ANGLE')
      .order('created_at', { ascending: false })
      .limit(200);
    if (err) { setError(err.message); setLoading(false); return; }
    setLogs(data || []);
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    fetchLogs();
    const channel = supabase
      .channel('activity_logs_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'wurxbase', table: 'activity_logs' },
        payload => setLogs(prev => [payload.new, ...prev].slice(0, 200))
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  const GROUPS = {
    all:     null,
    logins:  ['LOGIN', 'LOGOUT'],
    changes: ['CREATOR_ADD','CREATOR_UPDATE','CREATOR_DELETE','BULK_DELETE','BULK_STATUS_EDIT','BRAND_DELETE'],
    exports: ['EXPORT_CSV'],
  };
  const filtered = filter === 'all' ? logs : logs.filter(l => GROUPS[filter]?.includes(l.action));

  function dateLabel(iso) {
    const d = new Date(iso);
    const now = new Date();
    const todayStr = now.toDateString();
    const yest = new Date(now); yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === todayStr) return 'Today';
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
  }

  const grouped = filtered.reduce((acc, log) => {
    const lbl = dateLabel(log.created_at);
    if (!acc.length || acc[acc.length - 1].label !== lbl) acc.push({ label: lbl, items: [] });
    acc[acc.length - 1].items.push(log);
    return acc;
  }, []);

  const tabs = [
    { id: 'all',     label: 'All' },
    { id: 'logins',  label: 'Logins' },
    { id: 'changes', label: 'Changes' },
    { id: 'exports', label: 'Exports' },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1900,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        background: 'color-mix(in srgb, var(--wx-warning-soft) 50%, transparent)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        animation: 'sp-fade 0.22s ease',
        fontFamily: 'inherit',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative', width: '100%', maxWidth: 560, maxHeight: '92vh',
          background: 'var(--wx-bg)', borderRadius: 22,
          boxShadow: '0 32px 80px rgba(48,39,28,0.25), 0 8px 24px rgba(48,39,28,0.10)',
          animation: 'sp-pop 0.32s cubic-bezier(0.33,1,0.68,1)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* ── Header · dark coffee ── */}
        <div style={{ background: 'var(--wx-warning-soft)', padding: '16px 22px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--wx-text-muted)' }}>Activity Logs</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 2 }}>
              {loading ? 'Loading…' : error ? 'Error loading' : `${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}`}
            </div>
          </div>
          <button onClick={onClose} title="Close" style={{ width: 34, height: 34, borderRadius: 999, border: 0, cursor: 'pointer', background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.10)'; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* ── Filter pills ── */}
        <div style={{ padding: '14px 22px 0' }}>
          <div style={{ display: 'flex', gap: 4, background: 'var(--wx-surface-1)', borderRadius: 999, padding: 4, border: '1px solid var(--wx-border)' }}>
            {tabs.map(t => {
              const active = filter === t.id;
              return (
                <button key={t.id} onClick={() => setFilter(t.id)} style={{
                  flex: 1, height: 32, borderRadius: 999, border: 0, cursor: 'pointer',
                  background: active ? '#30271C' : 'transparent',
                  color: active ? '#F5E9D6' : '#6B7280',
                  fontSize: 12, fontWeight: 700, letterSpacing: '-0.1px',
                  transition: 'background .15s, color .15s', lineHeight: 1,
                  fontFamily: 'inherit',
                }}>{t.label}</button>
              );
            })}
          </div>
        </div>

        {/* ── List ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px 22px' }}>
          {loading ? (
            <div style={{ padding: '60px 16px', textAlign: 'center' }}>
              <span style={{ display: 'inline-block', width: 24, height: 24, borderRadius: 999, border: '2.5px solid var(--wx-border)', borderTopColor: '#30271C', animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : error ? (
            <div style={{ padding: '40px 16px', textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: 999, background: 'color-mix(in srgb, var(--wx-danger-soft) 10%, transparent)', color: 'var(--wx-danger)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--wx-text)', letterSpacing: '-0.2px' }}>Could not load logs</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--wx-text-muted)', marginTop: 4 }}>Make sure the <strong style={{ color: 'var(--wx-text)' }}>activity_logs</strong> table exists in Supabase.</div>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '60px 16px', textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: 999, background: 'var(--wx-bg)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--wx-text)', letterSpacing: '-0.2px' }}>No activity yet</div>
            </div>
          ) : (
            grouped.map(group => (
              <React.Fragment key={group.label}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0 10px', marginTop: 4 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--wx-text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{group.label}</span>
                  <span style={{ flex: 1, height: 1, background: 'var(--wx-surface-3)' }} />
                </div>
                <div style={{ background: 'var(--wx-surface-1)', borderRadius: 16, border: '1px solid var(--wx-border)', overflow: 'hidden', marginBottom: 8 }}>
                  {group.items.map((log, i) => <LogEntry key={log.id} log={log} hideTop={i === 0} />)}
                </div>
              </React.Fragment>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── CountUp ───────────────────────────────────────────── */
function CountUp({ value, prefix = '', suffix = '', duration = 700 }) {
  const [display, setDisplay] = useState(value);
  const rafRef  = useRef(null);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to   = typeof value === 'number' ? value : 0;
    if (from === to) { setDisplay(to); return; }
    const startTime = performance.now();
    function tick(now) {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = Math.round(from + (to - from) * eased);
      setDisplay(cur);
      if (t < 1) { rafRef.current = requestAnimationFrame(tick); }
      else { fromRef.current = to; }
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  return <>{prefix}{display.toLocaleString()}{suffix}</>;
}

/* ─── KanbanBoard ───────────────────────────────────────── */
function KanbanBoard({ creators, onUpdate, onCardClick }) {
  const COLS = [
    { id: 'in_progress', label: 'In Progress', color: 'var(--wx-warning)', bg: '#FFFBEB' },
    { id: 'delivered', label: 'Delivered', color: 'var(--wx-text-muted)', bg: '#EFF6FF' },
    { id: 'paid', label: 'Paid', color: 'var(--wx-success)', bg: '#F0FDF4' },
  ];

  function getCol(c) {
    if (c.payment_status === 'Paid') return 'paid';
    if (c.videos === 'Done') return 'delivered';
    return 'in_progress';
  }

  const grouped = useMemo(() => {
    const g = { in_progress: [], delivered: [], paid: [] };
    creators.forEach(c => g[getCol(c)].push(c));
    return g;
  }, [creators]);

  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  function handleDrop(colId) {
    if (!dragId) return;
    const patch = {};
    switch (colId) {
      case 'in_progress': patch.videos = 'In Progress'; break;
      case 'delivered': patch.videos = 'Done'; break;
      case 'paid': patch.payment_status = 'Paid'; break;
      default: break;
    }
    onUpdate(dragId, patch);
    setDragId(null);
    setDragOver(null);
  }

  return (
    <div className="kb-board">
      {COLS.map(col => (
        <div
          key={col.id}
          className={`kb-col${dragOver === col.id ? ' kb-col-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(col.id); }}
          onDragLeave={() => setDragOver(null)}
          onDrop={() => handleDrop(col.id)}
        >
          <div className="kb-col-head" style={{ background: col.bg }}>
            <span className="kb-col-dot" style={{ background: col.color }} />
            <span className="kb-col-label">{col.label}</span>
            <span className="kb-col-count">{grouped[col.id].length}</span>
          </div>
          <div className="kb-col-body">
            {grouped[col.id].map(c => {
              const { amount } = parseDeal(c.deal);
              return (
                <div
                  key={c.id}
                  className={`kb-card${dragId === c.id ? ' kb-card-drag' : ''}`}
                  draggable
                  onDragStart={() => setDragId(c.id)}
                  onDragEnd={() => { setDragId(null); setDragOver(null); }}
                  onClick={() => onCardClick(c)}
                >
                  <div className="kb-card-top">
                    <div className="kb-card-av" style={{ background: getGradient(c.name) }}>
                      {c.name ? c.name[0].toUpperCase() : '?'}
                    </div>
                    <div className="kb-card-info">
                      <div className="kb-card-name">{c.name}</div>
                      {c.brand && <span className="kb-card-brand">{c.brand}</span>}
                    </div>
                  </div>
                  <div className="kb-card-bottom">
                    {amount > 0 && <span className="kb-card-amt">${amount.toLocaleString()}</span>}
                    {c.deadline && <span className="kb-card-dl">{formatDate(c.deadline)}</span>}
                  </div>
                </div>
              );
            })}
            {grouped[col.id].length === 0 && (
              <div className="kb-empty">No creators</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── BrandPicker (searchable inline picker) ────────────── */
function BrandPicker({ value, onChange, brands, label }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useOutsideClick(wrapRef, () => setOpen(false));

  const filtered = search
    ? brands.filter(b => b.toLowerCase().includes(search.toLowerCase()))
    : brands;

  return (
    <div className="bp-wrap" ref={wrapRef}>
      <div className="bp-label">{label}</div>
      {value ? (
        <div className="bp-chip">
          <span className="bp-chip-name">{value}</span>
          <button className="bp-chip-x" onClick={() => { onChange(''); setSearch(''); }}>×</button>
        </div>
      ) : (
        <div className={`bp-field${open ? ' bp-field-open' : ''}`}>
          <svg className="bp-search-icon" width="12" height="12" viewBox="0 0 20 20" fill="none">
            <circle cx="9" cy="9" r="6" stroke="#9CA3AF" strokeWidth="1.8"/>
            <path d="M13.5 13.5L17 17" stroke="#9CA3AF" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <input
            className="bp-input"
            placeholder="Search brand…"
            value={search}
            onChange={e => { setSearch(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
          />
        </div>
      )}
      {open && !value && (
        <div className="bp-dropdown">
          {filtered.length === 0
            ? <div className="bp-empty">No results</div>
            : filtered.map(b => (
                <button key={b} className="bp-item"
                  onMouseDown={e => { e.preventDefault(); onChange(b); setSearch(''); setOpen(false); }}>
                  {b}
                </button>
              ))
          }
        </div>
      )}
    </div>
  );
}

/* ─── BrandCompareModal ──────────────────────────────────── */
/* ─── BrandCompareModalV2 · Tailwind + Samsung One UI ─── */
function BrandCompareModalV2({ creators, allBrands, onClose }) {
  const now = new Date();
  const [brandA, setBrandA] = useState('');
  const [brandB, setBrandB] = useState('');
  const [period, setPeriod] = useState('month');
  const [customYear,  setCustomYear]  = useState(now.getFullYear());
  const [customMonth, setCustomMonth] = useState(now.getMonth());

  function getPeriodRange() {
    if (period === 'all') return null;
    let y = now.getFullYear(), m = now.getMonth();
    if (period === 'last') { m -= 1; if (m < 0) { m = 11; y -= 1; } }
    if (period === 'custom') { y = customYear; m = customMonth; }
    return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0, 23, 59, 59) };
  }
  function periodLabel() {
    if (period === 'all') return 'All Time';
    const range = getPeriodRange();
    return range.start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  /* The period as a "YYYY-MM" key · null for all time.
     Deal figures are scoped by hiring_date, but GMV / ad spend are read from
     the monthly cells: a creator signed in July still earns in August. */
  function periodMonthKey() {
    const range = getPeriodRange();
    if (!range) return null;
    return `${range.start.getFullYear()}-${String(range.start.getMonth() + 1).padStart(2, '0')}`;
  }
  function calcStats(brand) {
    if (!brand) return null;
    const range = getPeriodRange();
    const mk = periodMonthKey();
    const brandList = creators.filter(c => c.brand === brand);
    const list = brandList.filter(c => {
      if (!range) return true;
      if (!c.hiring_date) return false;
      const d = new Date(c.hiring_date);
      return d >= range.start && d <= range.end;
    });
    let totalAmount = 0, totalVideos = 0, videosDone = 0, totalPaid = 0;
    list.forEach(c => {
      const { amount, videos } = parseDeal(c.deal);
      totalAmount += amount; totalVideos += videos;
      const done = distinctVideoCount(c);
      if (done > 0) videosDone += done;
      else if (c.videos === 'Done') videosDone += (videos || 1);
      if (c.payment_status === 'Paid') totalPaid += amount;
    });
    let gmv = 0, adSpent = 0, earners = 0;
    brandList.forEach(c => {
      const g = _lbGmv(c, mk);
      const a = _lbAd(c, mk);
      gmv += g; adSpent += a;
      if (g > 0) earners += 1;
    });
    const paidCreators = list.filter(c => c.payment_status === 'Paid').length;
    return {
      count: list.length, totalAmount, totalVideos, videosDone, totalPaid,
      gmv, adSpent, earners,
      roas:     adSpent > 0 ? +(gmv / adSpent).toFixed(2) : 0,
      gmvPerCr: earners > 0 ? Math.round(gmv / earners) : 0,
      avgRate:  totalVideos > 0 ? Math.round(totalAmount / totalVideos) : 0,
      paidPct:  list.length  > 0 ? Math.round(paidCreators / list.length * 100) : 0,
      videoPct: totalVideos  > 0 ? Math.round(videosDone   / totalVideos  * 100) : 0,
    };
  }

  const sA = calcStats(brandA);
  const sB = calcStats(brandB);
  const ready = brandA && brandB && brandA !== brandB;

  const monthOptions = [];
  for (let i = 0; i < 24; i++) {
    let y = now.getFullYear(), m = now.getMonth() - i;
    while (m < 0) { m += 12; y -= 1; }
    monthOptions.push({ y, m, label: new Date(y, m, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) });
  }

  /* getCursorColor hashes on the first letter only, so two brands often land on
     the same swatch · nudge B along the palette so A and B stay tellable apart. */
  const colorA = getCursorColor(brandA);
  const colorB = (() => {
    const c = getCursorColor(brandB);
    if (!brandB || c !== colorA) return c;
    const i = CURSOR_COLORS.indexOf(c);
    return CURSOR_COLORS[(i + 3) % CURSOR_COLORS.length] || c;
  })();

  const money = v => '$' + Math.round(v).toLocaleString();
  const ROWS = [
    { label: 'GMV',        a: 'gmv',         fmt: money, hero: true },
    /* Ad spend has no winner · spending more is neither good nor bad on its own,
       ROAS is the row that judges it. */
    { label: 'Ad spend',   a: 'adSpent',     fmt: money, neutral: true },
    { label: 'ROAS',       a: 'roas',        fmt: v => v > 0 ? v.toFixed(2) + '×' : '-' },
    { label: 'Creators',   a: 'count',       fmt: v => String(v) },
    { label: 'Budget',     a: 'totalAmount', fmt: money },
    { label: 'Paid out',   a: 'totalPaid',   fmt: money },
    { label: 'Videos',     a: 'videosDone',  fmt: v => String(v) },
    { label: 'Paid %',     a: 'paidPct',     fmt: v => v + '%' },
  ];

  /* One diverging row · bars mirror out from the centre label so the gap
     between the two brands is readable at a glance, not just the numbers. */
  function CmpRow({ label, av, bv, fmt, neutral }) {
    const max = Math.max(av, bv, 1);
    const aWins = neutral ? av > 0 : av > bv;
    const bWins = neutral ? bv > 0 : bv > av;
    const bar = (v, win, color) => (
      <div style={{ height: 8, borderRadius: 999, background: 'var(--wx-surface-2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 999, width: (v / max) * 100 + '%', background: color, opacity: win ? 1 : 0.34, transition: 'width .45s cubic-bezier(.4,0,.2,1)' }} />
      </div>
    );
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '86px 1fr 104px 1fr 86px', alignItems: 'center', gap: 10, padding: '9px 0' }}>
        <div style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.2px', fontVariantNumeric: 'tabular-nums', color: aWins ? '#1F1F1F' : '#9C8F7C' }}>{fmt(av)}</div>
        <div style={{ direction: 'rtl' }}>{bar(av, aWins, colorA)}</div>
        <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--wx-text-muted)' }}>{label}</div>
        <div>{bar(bv, bWins, colorB)}</div>
        <div style={{ textAlign: 'left', fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.2px', fontVariantNumeric: 'tabular-nums', color: bWins ? '#1F1F1F' : '#9C8F7C' }}>{fmt(bv)}</div>
      </div>
    );
  }

  /* Headline · who is ahead on GMV and by how much */
  const gmvLead = ready && sA && sB ? (() => {
    const hi = sA.gmv >= sB.gmv ? { n: brandA, v: sA.gmv, c: colorA } : { n: brandB, v: sB.gmv, c: colorB };
    const lo = sA.gmv >= sB.gmv ? { n: brandB, v: sB.gmv } : { n: brandA, v: sA.gmv };
    if (hi.v <= 0) return null;
    const x = lo.v > 0 ? (hi.v / lo.v) : 0;
    return { ...hi, gap: hi.v - lo.v, x };
  })() : null;

  return (
    <div
      className="tw-fixed tw-inset-0 tw-z-[950] tw-flex tw-items-center tw-justify-center tw-p-4 sm:tw-p-6"
      style={{ animation: 'sp-fade 0.22s ease', background: 'color-mix(in srgb, var(--wx-warning-soft) 50%, transparent)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        position: 'relative', width: '100%', maxWidth: 680, maxHeight: '92vh',
        background: 'var(--wx-bg)', borderRadius: 22,
        boxShadow: '0 32px 80px rgba(48,39,28,0.25), 0 8px 24px rgba(48,39,28,0.10)',
        animation: 'sp-pop 0.32s cubic-bezier(0.33,1,0.68,1)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: 'inherit',
      }}>
        {/* ── Header · dark coffee ── */}
        <div style={{ background: 'var(--wx-warning-soft)', padding: '16px 22px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 3l-7.5 7.5"/><path d="M3 21l7.5-7.5"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--wx-text-muted)' }}>Compare Brands</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 2 }}>GMV, spend and delivery side by side · {periodLabel()}</div>
          </div>
          <button onClick={onClose} title="Close" style={{ width: 34, height: 34, borderRadius: 999, border: 0, cursor: 'pointer', background: 'color-mix(in srgb, var(--wx-surface-2) 10%, transparent)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,233,214,0.10)'; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* ── Period strip ── */}
        <div style={{ background: 'var(--wx-surface-1)', borderBottom: '1px solid var(--wx-border)', padding: '10px 22px' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['month','This month'],['last','Last month'],['all','All time'],['custom','Pick month']].map(([k, lbl]) => {
              const active = period === k;
              return (
                <button key={k} onClick={() => setPeriod(k)} style={{
                  flex: 1, height: 30, borderRadius: 999, cursor: 'pointer',
                  border: '1px solid ' + (active ? '#30271C' : '#E7E2D7'),
                  background: active ? '#30271C' : '#FBFAF7',
                  color: active ? '#F5E9D6' : '#6B7280',
                  fontSize: 11.5, fontWeight: 700, letterSpacing: '-0.1px', fontFamily: 'inherit',
                  whiteSpace: 'nowrap', transition: 'background .15s, color .15s, border-color .15s',
                }}>{lbl}</button>
              );
            })}
          </div>
          {period === 'custom' && (
            <select
              value={`${customYear}-${customMonth}`}
              onChange={e => { const [y, m] = e.target.value.split('-'); setCustomYear(+y); setCustomMonth(+m); }}
              style={{ marginTop: 8, width: '100%', height: 34, padding: '0 10px', borderRadius: 10, border: '1px solid var(--wx-border)', background: 'var(--wx-surface-1)', fontSize: 12.5, fontWeight: 700, color: 'var(--wx-text)', cursor: 'pointer', outline: 'none', fontFamily: 'inherit' }}
            >
              {monthOptions.map(o => (<option key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>{o.label}</option>))}
            </select>
          )}
        </div>

        {/* ── Body · scrollable ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px 22px' }}>
          {/* Brand pickers */}
          <div style={{ background: 'var(--wx-surface-1)', border: '1px solid var(--wx-border)', borderRadius: 16, padding: 14, display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'end' }}>
            <BrandPickerV2 value={brandA} onChange={setBrandA} brands={allBrands} label="Brand A" color={colorA} />
            <div style={{ width: 38, height: 38, borderRadius: 999, background: 'var(--wx-warning-soft)', color: 'var(--wx-text-muted)', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 3 }}>VS</div>
            <BrandPickerV2 value={brandB} onChange={setBrandB} brands={allBrands} label="Brand B" color={colorB} />
          </div>

          {!ready ? (
            <div style={{ padding: '56px 16px', textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--wx-bg)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 3l-7.5 7.5"/><path d="M3 21l7.5-7.5"/></svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--wx-text)', letterSpacing: '-0.2px' }}>
                {brandA === brandB && brandA ? 'Pick two different brands' : 'Pick two brands'}
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--wx-text-muted)', marginTop: 4 }}>
                {!brandA && !brandB ? 'Choose Brand A and Brand B above' : brandA === brandB ? 'A and B are the same right now' : 'One more to go'}
              </div>
            </div>
          ) : (<>
            {/* Headline · GMV lead */}
            {gmvLead && (
              <div style={{ marginTop: 12, padding: '14px 16px', borderRadius: 16, background: 'linear-gradient(135deg, var(--wx-surface-1) 0%, var(--wx-surface-2) 100%)', border: '1px solid var(--wx-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 40, height: 40, borderRadius: 999, background: gmvLead.c + '22', color: gmvLead.c, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, flexShrink: 0 }}>{(gmvLead.n || '?')[0].toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--wx-text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Ahead on GMV</div>
                  <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.4px', color: 'var(--wx-text)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{gmvLead.n}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--wx-text-muted)', marginTop: 2 }}>
                    {gmvLead.gap > 0 ? `+${money(gmvLead.gap)} more` : 'Level on GMV'}{gmvLead.x > 1 ? ` · ${gmvLead.x.toFixed(1)}× the other` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--wx-warning)', fontVariantNumeric: 'tabular-nums' }}>{money(gmvLead.v)}</div>
              </div>
            )}

            {/* Brand name rail */}
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, padding: '0 2px' }}>
              <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 800, letterSpacing: '-0.3px', color: colorA, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brandA}</div>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--wx-text-muted)', padding: '3px 10px', borderRadius: 999, background: 'var(--wx-surface-2)', whiteSpace: 'nowrap' }}>{sA.count + sB.count} creators</div>
              <div style={{ textAlign: 'left', fontSize: 14, fontWeight: 800, letterSpacing: '-0.3px', color: colorB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brandB}</div>
            </div>

            {sA.count === 0 && sB.count === 0 && sA.gmv === 0 && sB.gmv === 0 ? (
              <div style={{ marginTop: 14, padding: '40px 16px', textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--wx-text-muted)', background: 'var(--wx-surface-1)', border: '1px solid var(--wx-border)', borderRadius: 16 }}>
                Nothing recorded for either brand in {periodLabel()}
              </div>
            ) : (
              <div style={{ marginTop: 10, background: 'var(--wx-surface-1)', border: '1px solid var(--wx-border)', borderRadius: 16, padding: '6px 16px' }}>
                {ROWS.map((r, i) => (
                  <div key={r.label} style={i > 0 ? { borderTop: '1px solid var(--wx-border)' } : undefined}>
                    <CmpRow label={r.label} av={sA[r.a] || 0} bv={sB[r.a] || 0} fmt={r.fmt} neutral={r.neutral} />
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 10, fontSize: 10.5, fontWeight: 600, color: 'var(--wx-text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
              GMV and ad spend come from EUKA month data · deal figures are scoped by hiring date
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}

/* Brand picker · Tailwind */
function BrandPickerV2({ value, onChange, brands, label, color }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useOutsideClick(wrapRef, () => setOpen(false));

  const filtered = search
    ? brands.filter(b => b.toLowerCase().includes(search.toLowerCase()))
    : brands;

  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--wx-text-muted)', marginBottom: 6 }}>{label}</div>
      {value ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 6px 0 10px', borderRadius: 999, background: `${color}1F` }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 800, letterSpacing: '-0.2px', color }}>{value}</span>
          <button onClick={() => { onChange(''); setSearch(''); }} title="Clear" style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--wx-surface-1)', color: 'var(--wx-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, cursor: 'pointer', flexShrink: 0, transition: 'background .15s, color .15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#B4362F'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#6B7280'; }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      ) : (
        <input
          value={search}
          onFocus={() => setOpen(true)}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          placeholder="Search brand…"
          style={{ width: '100%', height: 38, padding: '0 14px', borderRadius: 999, background: 'var(--wx-surface-1)', border: '1px solid var(--wx-border)', outline: 'none', fontSize: 13, fontWeight: 600, color: 'var(--wx-text)', fontFamily: 'inherit', transition: 'border-color .15s, box-shadow .15s' }}
          onFocusCapture={e => { e.currentTarget.style.borderColor = '#30271C'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(48,39,28,0.08)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = '#E7E2D7'; e.currentTarget.style.boxShadow = 'none'; }}
        />
      )}
      {open && !value && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, background: 'var(--wx-surface-1)', borderRadius: 14, border: '1px solid var(--wx-border)', boxShadow: '0 16px 40px rgba(48,39,28,0.16)', maxHeight: 240, overflowY: 'auto', zIndex: 30, padding: 5 }}>
          {filtered.slice(0, 12).map(b => (
            <button key={b} onMouseDown={() => { onChange(b); setSearch(''); setOpen(false); }} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: 'var(--wx-text)', border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', transition: 'background .12s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#F4F2EE'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              {b}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BrandCompareModal({ creators, allBrands, onClose }) {
  const now = new Date();
  const [brandA, setBrandA] = useState('');
  const [brandB, setBrandB] = useState('');
  // period: 'month' = this month, 'last' = last month, 'all' = all time, 'custom' = custom month
  const [period, setPeriod] = useState('month');
  const [customYear,  setCustomYear]  = useState(now.getFullYear());
  const [customMonth, setCustomMonth] = useState(now.getMonth()); // 0-indexed

  function getPeriodRange() {
    if (period === 'all') return null;
    let y = now.getFullYear(), m = now.getMonth();
    if (period === 'last') { m -= 1; if (m < 0) { m = 11; y -= 1; } }
    if (period === 'custom') { y = customYear; m = customMonth; }
    return {
      start: new Date(y, m, 1),
      end:   new Date(y, m + 1, 0, 23, 59, 59),
    };
  }

  function periodLabel() {
    if (period === 'all') return 'All Time';
    const range = getPeriodRange();
    return range.start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  function calcStats(brand) {
    if (!brand) return null;
    const range = getPeriodRange();
    const list = creators.filter(c => {
      if (c.brand !== brand) return false;
      if (range) {
        if (!c.hiring_date) return false;
        const d = new Date(c.hiring_date);
        return d >= range.start && d <= range.end;
      }
      return true;
    });
    let totalAmount = 0, totalVideos = 0, videosDone = 0, totalPaid = 0;
    list.forEach(c => {
      const { amount, videos } = parseDeal(c.deal);
      totalAmount += amount;
      totalVideos += videos;
      if (Array.isArray(c.video_codes) && c.video_codes.some(v => v?.video)) {
        videosDone += c.video_codes.filter(v => v?.video).length;
      } else if (c.videos === 'Done') {
        videosDone += (videos || 1);
      }
      if (c.payment_status === 'Paid') totalPaid += amount;
    });
    const paidCreators = list.filter(c => c.payment_status === 'Paid').length;
    return {
      count: list.length,
      totalAmount, totalVideos, videosDone, totalPaid,
      avgRate:   totalVideos > 0 ? Math.round(totalAmount / totalVideos) : 0,
      paidPct:   list.length   > 0 ? Math.round(paidCreators / list.length * 100) : 0,
      videoPct:  totalVideos   > 0 ? Math.round(videosDone   / totalVideos  * 100) : 0,
    };
  }

  const sA = calcStats(brandA);
  const sB = calcStats(brandB);
  const ready = brandA && brandB && brandA !== brandB;

  function StatRow({ label, a, b, format }) {
    const aNum = typeof a === 'number' ? a : 0;
    const bNum = typeof b === 'number' ? b : 0;
    const aWins = aNum > bNum, bWins = bNum > aNum;
    return (
      <div className="bcm-stat-row">
        <div className={`bcm-stat-val${aWins ? ' bcm-win' : bWins ? ' bcm-lose' : ''}`}>{format ? format(aNum) : aNum}</div>
        <div className="bcm-stat-label">{label}</div>
        <div className={`bcm-stat-val${bWins ? ' bcm-win' : aWins ? ' bcm-lose' : ''}`}>{format ? format(bNum) : bNum}</div>
      </div>
    );
  }

  // Build month options for custom picker (last 24 months)
  const monthOptions = [];
  for (let i = 0; i < 24; i++) {
    let y = now.getFullYear(), m = now.getMonth() - i;
    while (m < 0) { m += 12; y -= 1; }
    monthOptions.push({ y, m, label: new Date(y, m, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) });
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 950 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bcm-modal">

        {/* Header */}
        <div className="bcm-header">
          <div>
            <h2 className="bcm-title">Brand Comparison</h2>
            <div className="bcm-period-display">{periodLabel()}</div>
          </div>
          <button className="bcm-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Period filter */}
        <div className="bcm-period-bar">
          {[['month','This Month'],['last','Last Month'],['all','All Time'],['custom','Custom']].map(([k, lbl]) => (
            <button key={k} className={`bcm-period-btn${period === k ? ' bcm-period-active' : ''}`}
              onClick={() => setPeriod(k)}>{lbl}</button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="bcm-custom-row">
            <select className="bcm-custom-select"
              value={`${customYear}-${customMonth}`}
              onChange={e => { const [y, m] = e.target.value.split('-'); setCustomYear(+y); setCustomMonth(+m); }}>
              {monthOptions.map(o => (
                <option key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Brand pickers */}
        <div className="bcm-pickers">
          <BrandPicker value={brandA} onChange={setBrandA} brands={allBrands} label="Brand A" />
          <div className="bcm-vs">VS</div>
          <BrandPicker value={brandB} onChange={setBrandB} brands={allBrands} label="Brand B" />
        </div>

        {/* Empty state */}
        {!ready ? (
          <div className="bcm-empty-state">
            {!brandA && !brandB ? 'Search and pick two brands above to compare' :
             brandA === brandB ? 'Pick two different brands' :
             'Pick the second brand to start comparing'}
          </div>
        ) : (
          <div className="bcm-body">
            {/* Brand headers */}
            <div className="bcm-brand-row">
              <div className="bcm-brand-name" style={{ color: getCursorColor(brandA) }}>{brandA}</div>
              <div className="bcm-center-label">{sA.count + sB.count > 0 ? `${sA.count + sB.count} total` : '-'}</div>
              <div className="bcm-brand-name" style={{ color: getCursorColor(brandB) }}>{brandB}</div>
            </div>

            {sA.count === 0 && sB.count === 0 ? (
              <div className="bcm-no-data">No creators hired in {periodLabel()} for either brand</div>
            ) : (
              <>
                <StatRow label="Creators" a={sA.count} b={sB.count} />
                <StatRow label="Budget" a={sA.totalAmount} b={sB.totalAmount} format={v => `$${v.toLocaleString()}`} />
                <StatRow label="Paid Out" a={sA.totalPaid} b={sB.totalPaid} format={v => `$${v.toLocaleString()}`} />
                <StatRow label="Videos Total" a={sA.totalVideos} b={sB.totalVideos} />
                <StatRow label="Videos Done" a={sA.videosDone} b={sB.videosDone} />
                <StatRow label="Video %" a={sA.videoPct} b={sB.videoPct} format={v => `${v}%`} />
                <StatRow label="Paid %" a={sA.paidPct} b={sB.paidPct} format={v => `${v}%`} />
                <StatRow label="Avg Rate" a={sA.avgRate} b={sB.avgRate} format={v => v > 0 ? `$${v.toLocaleString()}` : '-'} />

                {/* Progress bars */}
                <div className="bcm-bars">
                  <div className="bcm-bar-wrap"><div className="bcm-bar-fill" style={{ width: `${sA.videoPct}%`, background: getCursorColor(brandA) }}/></div>
                  <div className="bcm-bar-label">Video %</div>
                  <div className="bcm-bar-wrap bcm-bar-right"><div className="bcm-bar-fill" style={{ width: `${sB.videoPct}%`, background: getCursorColor(brandB) }}/></div>
                </div>
                <div className="bcm-bars" style={{ marginTop: 6 }}>
                  <div className="bcm-bar-wrap"><div className="bcm-bar-fill" style={{ width: `${sA.paidPct}%`, background: getCursorColor(brandA) }}/></div>
                  <div className="bcm-bar-label">Paid %</div>
                  <div className="bcm-bar-wrap bcm-bar-right"><div className="bcm-bar-fill" style={{ width: `${sB.paidPct}%`, background: getCursorColor(brandB) }}/></div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main App ───────────────────────────────────────────── */
// ─── UI Preferences (live theme/density/radius/motion/accent) ───
const UI_PREFS_KEY = 'ui_prefs_v1';
const DEFAULT_PREFS = {
  theme: 'light',         // light | dark
  accent: 'ink',          // ink | teal | orange | blue | purple | green
  density: 'comfy',       // compact | comfy | spacious
  radius: 'rounded',      // sharp | medium | rounded
  motion: 'normal',       // reduced | normal
};
function loadPrefs() {
  try {
    const saved = localStorage.getItem(UI_PREFS_KEY);
    if (saved) {
      const parsed = { ...DEFAULT_PREFS, ...JSON.parse(saved) };
      // Migration: reset old experimental themes
      if (parsed.theme !== 'light' && parsed.theme !== 'dark') parsed.theme = 'light';
      return parsed;
    }
  } catch {}
  return DEFAULT_PREFS;
}
function savePrefs(p) {
  try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(p)); } catch {}
}
function applyPrefsToDOM(p) {
  const root = document.documentElement;
  root.setAttribute('data-theme', p.theme);
  root.setAttribute('data-accent', p.accent);
  root.setAttribute('data-density', p.density);
  root.setAttribute('data-radius', p.radius);
  root.setAttribute('data-motion', p.motion);
}

export default function App({ tab, onTabChange, embedded = false } = {}) {
  // UI preferences (live)
  const [uiPrefs, setUiPrefs] = useState(loadPrefs);
  useEffect(() => { applyPrefsToDOM(uiPrefs); savePrefs(uiPrefs); }, [uiPrefs]);

  // Date filter
  const now = new Date();
  const [dateFilter, setDateFilter] = useState({
    mode: 'month',
    year: now.getFullYear(),
    month: now.getMonth(),
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const dateRef = useRef(null);

  // Data
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allBrands, setAllBrands] = useState([]);

  // Filters
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ payment: '', videos: '', hiredBy: '', category: '' });

  // Brand tabs
  const [brandOrder, setBrandOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem('brandOrder')) || []; } catch { return []; }
  });
  const [hiddenBrands, setHiddenBrands] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hiddenBrands')) || []; } catch { return []; }
  });
  const [customBrands, setCustomBrands] = useState(() => {
    try { return JSON.parse(localStorage.getItem('customBrands')) || []; } catch { return []; }
  });
  const [activeBrand, setActiveBrand] = useState(() => {
    try {
      const u = JSON.parse(sessionStorage.getItem('ch_user'));
      if (u?.role === 'apc') {
        const brands = JSON.parse(sessionStorage.getItem('ch_apc_brands')) || [];
        return brands[0] || 'All';
      }
      if (u?.role === 'client') {
        const brands = Array.isArray(u.brand_access) ? u.brand_access : [];
        return brands[0] || 'All';
      }
    } catch {}
    return 'All';
  });
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [showHiddenDrop, setShowHiddenDrop] = useState(false);
  const hiddenRef = useRef(null);
  const addBrandRef = useRef(null);

  // Drag state
  const [dragBrand, setDragBrand] = useState(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState(null);

  // Modals
  const [detailCreator, setDetailCreator] = useState(null);
  const [editCreator, setEditCreator] = useState(null);
  const [showSheet, setShowSheet] = useState(false);

  // Inline editing
  const [inlineEdit, setInlineEdit] = useState(null); // { id, field, value }
  const [inlineDrop, setInlineDrop] = useState(null); // { id, field, options, position }
  const inlineInputRef = useRef(null);

  // Auth
  const [currentUser, setCurrentUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('ch_user')); } catch { return null; }
  });
  const [apcBrands, setApcBrands] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('ch_apc_brands')) || []; } catch { return []; }
  });
  const [showDeleteBlocked, setShowDeleteBlocked] = useState(false);
  const [showNoVideoModal, setShowNoVideoModal] = useState(false);
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [showCompare, setShowCompare] = useState(false);
  const [kpiPulse, setKpiPulse] = useState(false);
  const [soundsMuted, setSoundsMuted] = useState(() => {
    try { return localStorage.getItem('ch_sounds_muted') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('ch_sounds_muted', soundsMuted ? '1' : '0'); } catch {}
  }, [soundsMuted]);
  const [viewMode, setViewMode] = useState('table');
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showSqlPlayground, setShowSqlPlayground] = useState(false);
  const [showGod, setShowGod] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  /* appearance is CSS variables, so it has to be on <html> before the
     first paint of every session, not only when the panel is opened */
  useEffect(() => { applyGod(loadGod()); }, []);
  /* brand contracts live in activity_logs and are shared by the team,
     so they are pulled once at boot into the local mirror */
  useEffect(() => { fetchBrandContracts().catch(() => {}); }, []);
  /* creative angles are team-shared too, so they load once at boot */
  useEffect(() => { fetchAngles().catch(() => {}); }, []);
  const [colOrder, setColOrder] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('ch_col_order') || 'null'); return Array.isArray(s) && s.every(k => DEFAULT_COL_ORDER.includes(k)) ? s : DEFAULT_COL_ORDER; } catch { return DEFAULT_COL_ORDER; }
  });
  const [colWidths, setColWidths] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('ch_col_widths') || 'null') || {};
      const out = {}; MOVABLE_COLS.forEach(c => { out[c.key] = typeof s[c.key] === 'number' ? s[c.key] : c.defaultWidth; });
      return out;
    } catch { const out = {}; MOVABLE_COLS.forEach(c => { out[c.key] = c.defaultWidth; }); return out; }
  });
  const [colDragKey, setColDragKey] = useState(null);
  const [colOverKey, setColOverKey] = useState(null);
  const [colAligns, setColAligns] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ch_col_aligns') || '{}') || {}; } catch { return {}; }
  });
  const [selectedColKey, setSelectedColKey] = useState(null); // null | column key
  useEffect(() => { try { localStorage.setItem('ch_col_order', JSON.stringify(colOrder)); } catch {} }, [colOrder]);
  useEffect(() => { try { localStorage.setItem('ch_col_widths', JSON.stringify(colWidths)); } catch {} }, [colWidths]);
  useEffect(() => { try { localStorage.setItem('ch_col_aligns', JSON.stringify(colAligns)); } catch {} }, [colAligns]);
  function setColAlign(key, align) { setColAligns(prev => ({ ...prev, [key]: align })); }
  function handleColResize(key, w) { setColWidths(prev => ({ ...prev, [key]: w })); }
  function handleColDrop(srcKey, dstKey) {
    if (!srcKey || !dstKey || srcKey === dstKey) { setColDragKey(null); setColOverKey(null); return; }
    setColOrder(prev => {
      const next = prev.filter(k => k !== srcKey);
      const idx = next.indexOf(dstKey);
      next.splice(idx === -1 ? next.length : idx, 0, srcKey);
      return next;
    });
    setColDragKey(null); setColOverKey(null);
  }
  const [showScrollTop, setShowScrollTop] = useState(false);
  const tableScrollRef = useRef(null);
  const searchInputRef = useRef(null);
  const [showUserMgmt, setShowUserMgmt] = useState(false);
  const perms = getPerms(currentUser?.role || null, currentUser?.custom_perms || null);

  async function logActivity(actor, action, target, details = {}) {
    /* WURX-ADDED · do not fire a write we know the database will refuse.
       The read-only Paid Collabs roles (Affiliate Team Lead, Operations Lead,
       Ads Manager) cannot insert into wurxbase — that is the point of them —
       so this ran on every page load, got a 403, and printed an error nobody
       could act on. A console full of expected failures is how a real one goes
       unnoticed. `canEdit` is the capability every other write here answers to,
       so presence follows the same line rather than inventing its own. */
    if (!can(actor, 'canEdit')) return;
    const display = actor.display || actor.username || actor.id || 'Unknown';
    const { error } = await supabase.from('activity_logs').insert({
      user_id: String(actor.id), user_display: display,
      action, target: target || null, details,
    });
    if (error) console.error('logActivity failed:', error);
  }

  function handleLogout() {
    logActivity(currentUser, 'LOGOUT', null, {});
    sessionStorage.removeItem('ch_user');
    sessionStorage.removeItem('ch_apc_brands');
    setCurrentUser(null);
    setApcBrands([]);
  }
  function handleApcBrandSelect(brands) {
    sessionStorage.setItem('ch_apc_brands', JSON.stringify(brands));
    setApcBrands(brands);
    if (brands.length > 0) setActiveBrand(brands[0]); // land on first selected brand
  }

  // Settings & Logs
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [greeting, setGreeting] = useState(null);
  const season = useMemo(() => getCurrentSeason(), []);
  useEffect(() => {
    if (season) document.body.setAttribute('data-season', season.id);
    else document.body.removeAttribute('data-season');
    return () => document.body.removeAttribute('data-season');
  }, [season]);
  // Show daily greeting on mount if already logged in (session restore)
  useEffect(() => {
    if (!currentUser) return;
    // Only show if not already shown today (checked inside getDailyGreeting via localStorage)
    const key = `ch_greet_${currentUser.id}`;
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
    const today = new Date().toISOString().slice(0, 10);
    if (stored.date !== today) {
      setGreeting(getDailyGreeting(currentUser.id));
      setTimeout(() => setGreeting(null), 5500);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [hiredByTeam, setHiredByTeam] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('hiredByTeam'));
      if (!saved || !Array.isArray(saved)) return DEFAULT_TEAM;
      // Handle old string-array format ['Aris','Emily'...]
      if (saved.length && typeof saved[0] === 'string') {
        return saved.map(n => DEFAULT_TEAM.find(d => d.name === n) || { id: n.toLowerCase(), name: n, color: 'var(--wx-text-faint)', bg: '#F3F4F6' });
      }
      // Ensure every object has required fields
      return saved.filter(m => m && m.name);
    } catch { return DEFAULT_TEAM; }
  });

  // Delete confirm + undo
  const [deleteModal, setDeleteModal] = useState(null); // { type, id, name, count }
  const [undoToast, setUndoToast]     = useState(null); // { message, timeLeft }
  const undoTimerRef = useRef(null);
  const undoDataRef  = useRef(null);

  // Settings sync (Supabase)
  const settingsLoadedRef   = useRef(false);  // prevents saving before load completes
  const settingsSaveTimer   = useRef(null);
  const pendingSettingsPatch = useRef({});
  // what the server last told us each shared setting is (see settingsSync.js): a value that came FROM it is never written back
  const settingsMirror        = useRef(createSettingsMirror());
  const settingsGate          = useRef(null);

  // KPIs
  const [kpiCreators, setKpiCreators] = useState(0);

  // ── Export unique creators to Excel (click on KPI pill) ──
  async function exportUniqueCreators() {
    const normTT = t => (t || '').toLowerCase().replace(/[@\s]/g, '').replace(/^https?:\/\/(www\.)?tiktok\.com\//, '').replace(/\/.*$/, '');

    // Group deals by unique creator (name + tiktok)
    const groups = new Map();
    creators.forEach(c => {
      const key = (c.name || '').trim().toLowerCase() + '|' + normTT(c.tiktok_account);
      if (key === '|') return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    });

    // Build rows with aggregated rate per video
    const rows = [];
    groups.forEach((deals) => {
      const first = deals[0];
      const { handle, url } = parseTikTok(first.tiktok_account);
      const cleanHandle = handle ? handle.replace(/^@/, '') : '';

      // Per-deal rate per video
      let totalVideos = 0;
      let totalAmount = 0;
      const rates = [];
      let totalPaid = 0;
      let totalUnpaid = 0;
      deals.forEach(d => {
        const { amount, videos } = parseDeal(d.deal);
        if (videos > 0 && amount > 0) {
          rates.push(amount / videos);
          totalVideos += videos;
          totalAmount += amount;
        } else if (amount > 0) {
          totalAmount += amount;
          rates.push(amount);
        }
        if (d.payment_status === 'Paid') totalPaid += amount || 0;
        else totalUnpaid += amount || 0;
      });

      // Simple average rate (per deal, not weighted)
      const avgRate = rates.length > 0 ? Math.round(rates.reduce((s, n) => s + n, 0) / rates.length) : 0;
      // Weighted avg (total amount / total videos) · more accurate
      const weightedRate = totalVideos > 0 ? Math.round(totalAmount / totalVideos) : avgRate;

      rows.push({
        Name: first.name || '',
        Username: cleanHandle ? '@' + cleanHandle : '',
        TikTok: url || first.tiktok_account || '',
        'Rate per Video (USD)': weightedRate,
        'Deals Count': deals.length,
        'Total Videos': totalVideos,
        'Total Allocated': totalAmount,
        'Total Paid': totalPaid,
        'Total Unpaid': totalUnpaid,
        'Brands Worked With': [...new Set(deals.map(d => d.brand).filter(Boolean))].join(', '),
        'Is Retainer': deals.length >= 4 ? 'Yes' : 'No',
      });
    });

    // Sort by rate per video desc
    rows.sort((a, b) => b['Rate per Video (USD)'] - a['Rate per Video (USD)']);

    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      // Summary sheet
      const totalAllocated = rows.reduce((s, r) => s + r['Total Allocated'], 0);
      const avgPerVideo = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r['Rate per Video (USD)'], 0) / rows.length) : 0;
      const retainers = rows.filter(r => r['Is Retainer'] === 'Yes').length;
      const summary = [
        ['Creator Hub · Unique Creators Report'],
        [`Generated ${new Date().toLocaleString()}`],
        [],
        ['Unique Creators', rows.length],
        ['Total Deals', creators.length],
        ['Total Allocated', '$' + totalAllocated.toLocaleString()],
        ['Avg Rate per Video', '$' + avgPerVideo.toLocaleString()],
        ['Retainers (4+ deals)', retainers],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(summary);
      ws1['!cols'] = [{ wch: 28 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

      // Detail sheet
      const ws2 = XLSX.utils.json_to_sheet(rows);
      ws2['!cols'] = [
        { wch: 24 },  // Name
        { wch: 22 },  // Username
        { wch: 42 },  // TikTok
        { wch: 18 },  // Rate per Video
        { wch: 12 },  // Deals Count
        { wch: 13 },  // Total Videos
        { wch: 16 },  // Total Allocated
        { wch: 14 },  // Total Paid
        { wch: 14 },  // Total Unpaid
        { wch: 30 },  // Brands
        { wch: 12 },  // Is Retainer
      ];
      XLSX.utils.book_append_sheet(wb, ws2, 'Unique Creators');

      const fileName = `unique-creators-${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);

      logActivity(currentUser, 'EXPORT_CSV', `Unique Creators (${rows.length})`);
      addNotification(`Exported ${rows.length} unique creators to Excel`, 'export');
    } catch (err) {
      alert('Failed to export: ' + (err.message || 'unknown error'));
    }
  }
  const [kpiDeals, setKpiDeals]       = useState(0);

  // Sort + bulk select
  const [sortDateDir, setSortDateDir] = useState(null); // null | 'asc' | 'desc'
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Notifications + Samsung toast (per-user, persisted in localStorage)
  const notifKey = currentUser ? `ch_notifs_${currentUser.id}` : null;
  const [notifications, setNotifications] = useState(() => {
    if (!currentUser) return [];
    try { return JSON.parse(localStorage.getItem(`ch_notifs_${currentUser.id}`)) || []; } catch { return []; }
  });
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifPanelRef = useRef(null);
  const [toastStack, setToastStack] = useState([]);
  const dismissToast = useCallback((id) => {
    setToastStack(prev => prev.filter(t => t.id !== id));
  }, []);
  const [bellShake, setBellShake] = useState(false);
  const bellShakeTimerRef = useRef(null);

  // Table density: 'compact' | 'normal' | 'comfortable'
  const [tableDensity, setTableDensity] = useState(() => {
    try {
      const saved = localStorage.getItem('ch_table_density');
      return ['compact', 'normal', 'comfortable'].includes(saved) ? saved : 'normal';
    } catch { return 'normal'; }
  });
  useEffect(() => {
    try { localStorage.setItem('ch_table_density', tableDensity); } catch {}
  }, [tableDensity]);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // Confetti burst
  const [showConfetti, setShowConfetti] = useState(false);
  const confettiTimerRef = useRef(null);
  const confettiPieces = useRef(
    Array.from({ length: 32 }, (_, i) => ({
      delay: `${(i * 0.07).toFixed(2)}s`,
      x: `${Math.floor(Math.random() * 100)}vw`,
      rot: `${Math.floor(Math.random() * 360)}deg`,
      color: ['#1259C3','#0E4DAD','#34D399','#10B981','#FBBF24','#F59E0B','#60A5FA','#06B6D4'][i % 8],
    }))
  );


  /* ── Fetch ── */
  const fetchCreators = useCallback(async () => {
    setLoading(true);
    // Main list: only approved creators. Pending ones live in the review queue.
    /* Paged · this table is past 1000 rows and PostgREST hard-caps a single
       response there, so an unpaged select silently dropped the oldest deals
       and made the KPI counts drift as new ones were added. `id` is the
       tiebreaker that keeps page boundaries stable when hiring_date repeats
       or is null. */
    const { data, error } = await selectAll(() => supabase
      .from('creators')
      .select('*')
      .not('name', 'is', null)
      .neq('name', '')
      .or('status.eq.approved,status.is.null')
      .order('hiring_date', { ascending: false })
      .order('id', { ascending: true }));

    if (!error && data) {
      setCreators(data);
      // Collect unique brands - sorted A-Z, manual drag order applied on top
      const dbBrands = [...new Set(data.map(c => c.brand).filter(Boolean))];
      const merged = [...new Set([...dbBrands, ...customBrands])]
        .sort((a, b) => a.localeCompare(b));
      const ordered = brandOrder.length > 0
        ? [
            ...brandOrder.filter(b => merged.includes(b)),
            ...merged.filter(b => !brandOrder.includes(b)),
          ]
        : merged;
      setAllBrands(ordered);
      // KPIs from all data
      const unique = new Set(data.map(c => c.name?.trim().toLowerCase()).filter(Boolean));
      setKpiCreators(unique.size);
      setKpiDeals(data.length);
    }
    setLoading(false);
  }, [customBrands, brandOrder]);

  useEffect(() => { fetchCreators(); }, [fetchCreators]);

  /* ── Pending approval count (Asad only) ── */
  const fetchPendingCount = useCallback(async () => {
    if (currentUser?.role !== 'superadmin') { setPendingCount(0); return; }
    const { count } = await supabase.from('creators')
      .select('*', { count: 'exact', head: true }).eq('status', 'pending');
    setPendingCount(count || 0);
  }, [currentUser?.role]);
  useEffect(() => { fetchPendingCount(); }, [fetchPendingCount]);

  /* ── Real-time subscription for new pending submissions ── */
  useEffect(() => {
    if (currentUser?.role !== 'superadmin') return;
    const channel = supabase
      .channel('pending_creators_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'wurxbase', table: 'creators' },
        ({ new: row }) => {
          if (row?.status === 'pending') {
            setPendingCount(c => c + 1);
            addNotification(`"${row.name}" needs your approval`, 'info');
          }
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser?.id, currentUser?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Notification helper ── */
  const addNotification = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    const notif = { id, message, type, time: new Date().toISOString() };
    setNotifications(prev => {
      const next = [notif, ...prev].slice(0, 20);
      if (notifKey) {
        try { localStorage.setItem(notifKey, JSON.stringify(next)); } catch {}
      }
      return next;
    });
    setToastStack(prev => [{ ...notif, id: notif.id }, ...prev].slice(0, 4));
    setTimeout(() => setToastStack(prev => prev.filter(t => t.id !== notif.id)), 6500);
    // Sound · paid has its own chime played separately, others get notification ding
    if (type !== 'paid' && !soundsMuted) playSound('notification');
    // Bell shake animation
    setBellShake(false);
    requestAnimationFrame(() => {
      setBellShake(true);
      if (bellShakeTimerRef.current) clearTimeout(bellShakeTimerRef.current);
      bellShakeTimerRef.current = setTimeout(() => setBellShake(false), 700);
    });
  }, [notifKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Join requests realtime (Asad only) ── */
  useEffect(() => {
    if (currentUser?.role !== 'superadmin') return;
    // Request browser notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    const channel = supabase
      .channel('join_requests_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'wurxbase', table: 'join_requests' },
        ({ new: req }) => {
          const msg = `${req.name} (@${req.username}) wants to join the team!`;
          addNotification(msg, 'join');
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('New Join Request -Creator Hub', {
              body: msg,
              icon: '/favicon.ico',
              tag: `join_${req.id}`,
            });
          }
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Supabase Presence · who's online + live cursors ── */
  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase.channel('app_presence');
    let cursorThrottle = null;

    function syncPresence() {
      const state = channel.presenceState();
      const users = Object.values(state).flat();
      setOnlineUsers(users);
      const cursors = {};
      for (const u of users) {
        if (u.user_id !== String(currentUser.id) && u.cursor) {
          cursors[u.user_id] = { x: u.cursor.x, y: u.cursor.y, display: u.display };
        }
      }
      setRemoteCursors(cursors);
    }

    function handleMouseMove(e) {
      if (cursorThrottle) return;
      cursorThrottle = setTimeout(() => { cursorThrottle = null; }, 60);
      channel.track({
        user_id: String(currentUser.id),
        display: currentUser.display || currentUser.username,
        role: currentUser.role,
        cursor: {
          x: parseFloat(((e.clientX / window.innerWidth) * 100).toFixed(2)),
          y: parseFloat(((e.clientY / window.innerHeight) * 100).toFixed(2)),
        },
      });
    }

    channel
      .on('presence', { event: 'sync' }, syncPresence)
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: String(currentUser.id),
            display: currentUser.display || currentUser.username,
            role: currentUser.role,
          });
          window.addEventListener('mousemove', handleMouseMove);
        }
      });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (cursorThrottle) clearTimeout(cursorThrottle);
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Last-seen heartbeat + session revocation check (every 60s) ── */
  useEffect(() => {
    if (!currentUser) return;
    const update = async () => {
      supabase.from('app_users').update({ last_seen: new Date().toISOString() }).eq('id', String(currentUser.id));
      // Check if this session has been revoked by another admin
      const sid = sessionStorage.getItem('ch_session_id');
      if (sid) {
        const { data } = await supabase.from('revoked_sessions').select('session_id').eq('session_id', sid).maybeSingle();
        if (data) {
          sessionStorage.removeItem('ch_user');
          sessionStorage.removeItem('ch_session_id');
          setCurrentUser(null);
          alert('Your session has been revoked by an admin. Please login again.');
        }
      }
    };
    update();
    const iv = setInterval(update, 60000);
    return () => clearInterval(iv);
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Cross-user real-time notifications ── */
  useEffect(() => {
    if (!currentUser) return;
    const CROSS_MSGS = {
      CREATOR_ADD:      log => `${log.user_display} added "${log.target}"`,
      CREATOR_UPDATE:   log => `${log.user_display} updated "${log.target}"`,
      CREATOR_DELETE:   log => `${log.user_display} deleted "${log.target}"`,
      BULK_DELETE:      log => `${log.user_display} bulk deleted ${log.details?.count || ''} creators`,
      BULK_STATUS_EDIT: log => `${log.user_display} updated status for ${log.details?.count || ''} creators`,
      BRAND_DELETE:     log => `${log.user_display} deleted brand "${log.target}"`,
    };
    const channel = supabase
      .channel('cross_user_notifs')
      .on('postgres_changes', { event: 'INSERT', schema: 'wurxbase', table: 'activity_logs' },
        ({ new: log }) => {
          if (String(log.user_id) === String(currentUser.id)) return;
          const msgFn = CROSS_MSGS[log.action];
          if (msgFn) addNotification(msgFn(log), 'info');
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Real-time settings sync · when Asad hides/shows a brand,
        ALL other sessions see it immediately without waiting for the 30s poll ── */
  useEffect(() => {
    if (!currentUser) return;
    // Use unique channel name to avoid "already subscribed" error on re-render
    const chName = `app_settings_sync_${currentUser.id}`;
    const ch = supabase
      .channel(chName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'wurxbase', table: 'app_settings', filter: 'id=eq.1' },
        () => { fetchSettings(); }
      )
      // when the live connection comes up (first time, or after a dropped network) read the row once, so nothing missed while it was
      // down stays missed: this is what the timer below used to be for
      .subscribe((status) => { if (status === 'SUBSCRIBED') fetchSettings(); });
    return () => { supabase.removeChannel(ch); };
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* (A second subscription to the same row used to sit here: every settings change fetched twice per session. The one above
      already listens to every event on the row.) */

  /* ── Startup notifications disabled · user reported them as noise on app load.
       Overdue/deadline/due-today info is still visible inside the dashboard views. ── */
  // (intentionally empty · kept as a placeholder so callers don't break)

  /* ── Settings: save helpers ── */
  // Immediate save
  function saveSettingNow(patch) {
    if (!settingsLoadedRef.current) return;
    /*
     * ONLY WHAT WOULD CHANGE SOMETHING. A value that just came from the server (or that the server already accepted from us)
     * is not written back: that echo is what looped the whole team's sessions through this row, millions of times
     * (settingsSync.js has the story). A real edit still differs, so it still saves, once.
     */
    const keys = settingsMirror.current.changed(patch);
    if (!keys.length) return;
    const body = {};
    keys.forEach((k) => { body[k] = patch[k]; });
    supabase.from('app_settings')
      .upsert({ id: 1, ...body }, { onConflict: 'id' })
      .then(({ error }) => {
        if (error) console.error('saveSettingNow failed:', error);
        else keys.forEach((k) => settingsMirror.current.seen(k, body[k]));
      });
  }
  // An explicit click (hide or show a brand) saves even before the first load finished, as it always did; it still tells the
  // mirror what the server now holds, so the next fetch is not mistaken for a change.
  function saveSettingForced(patch, label) {
    supabase.from('app_settings')
      .upsert({ id: 1, ...patch }, { onConflict: 'id' })
      .then(({ error }) => {
        if (error) console.error(label + ' save failed:', error);
        else Object.entries(patch).forEach(([k, v]) => settingsMirror.current.seen(k, v));
      });
  }
  // Debounced save - for rapid changes like drag reorder
  function scheduleSettingsSave(patch) {
    /*
     * THE SAME GUARD `saveSettingNow` HAS, AND THIS ONE WAS MISSING IT.
     *
     * `app_settings` is ONE ROW SHARED BY THE WHOLE TEAM. The brandOrder
     * effect runs on mount with whatever localStorage held — `[]` on a new
     * machine, a private window, or after clearing site data — and scheduled a
     * write 600ms later. If the settings fetch had not landed by then, that
     * wrote an empty brand order over everybody's.
     *
     * Nothing is lost by refusing: the effect fires again when the real values
     * arrive and set the state.
     */
    if (!settingsLoadedRef.current) return;
    // nothing to schedule when it is what the server already holds (see saveSettingNow)
    if (!settingsMirror.current.changed(patch).length) return;
    Object.assign(pendingSettingsPatch.current, patch);
    if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current);
    settingsSaveTimer.current = setTimeout(() => {
      const wanted = { ...pendingSettingsPatch.current };
      pendingSettingsPatch.current = {};
      // checked again at the moment of writing: a fetch may have brought the same value in during the 600ms
      const keys = settingsMirror.current.changed(wanted);
      if (!keys.length) return;
      const toPatch = {};
      keys.forEach((k) => { toPatch[k] = wanted[k]; });
      supabase.from('app_settings')
        .upsert({ id: 1, ...toPatch }, { onConflict: 'id' })
        .then(({ error }) => {
          if (error) console.error('scheduleSettingsSave failed:', error);
          else keys.forEach((k) => settingsMirror.current.seen(k, toPatch[k]));
        });
    }, 600);
  }

  // Every caller (the first load, the realtime event, the 30 second poll) goes through one gate: at most one fetch at a time, and a burst
  // of "changed" events is ONE more fetch afterwards, not a pile of them.
  function fetchSettings() {
    if (!settingsGate.current) settingsGate.current = createFetchGate(loadSettings);
    return settingsGate.current();
  }

  async function loadSettings() {
    const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).single();
    /*
     * DID THIS ACTUALLY LOAD? The flag below used to be set at the end of this
     * function unconditionally, so a dropped connection or a 5xx left it
     * saying "loaded" over state that had come from nowhere. A guard that is
     * true after a failure is worse than no guard: it is believed.
     *
     * Two outcomes count as loaded. Data came back, or the row genuinely did
     * not exist and we have just created it — in which case there was nothing
     * to overwrite in the first place.
     */
    let loaded = Boolean(data);
    // Row doesn't exist yet · create it so future saves work
    if (error && (error.code === 'PGRST116' || error.code === '22P02')) {
      const { error: seedErr } = await supabase.from('app_settings').upsert(
        { id: 1, hidden_brands: [], brand_order: [], custom_brands: [] },
        { onConflict: 'id' }
      );
      loaded = !seedErr;
      if (!seedErr) { ['hidden_brands', 'brand_order', 'custom_brands'].forEach((k) => settingsMirror.current.seen(k, [])); }
    }
    if (data) {
      /*
       * A value is applied only when it DIFFERS from what the server last told us. Setting the same data again as a brand new
       * array made React run the persist effects below, which wrote it straight back: the echo that looped every session
       * through this row (see settingsSync.js). Whatever the server says is remembered either way.
       */
      const m = settingsMirror.current;
      const fresh = (key) => { const changed = m.differs(key, data[key]); m.seen(key, data[key]); return changed; };
      if (fresh('brand_order')   && Array.isArray(data.brand_order)  && data.brand_order.length)  { setBrandOrder(data.brand_order);  localStorage.setItem('brandOrder',   JSON.stringify(data.brand_order)); }
      if (fresh('hidden_brands') && Array.isArray(data.hidden_brands)) { setHiddenBrands(data.hidden_brands); localStorage.setItem('hiddenBrands', JSON.stringify(data.hidden_brands)); }
      if (fresh('custom_brands') && Array.isArray(data.custom_brands) && data.custom_brands.length) { setCustomBrands(data.custom_brands); localStorage.setItem('customBrands', JSON.stringify(data.custom_brands)); }
      if (fresh('hired_by_team') && Array.isArray(data.hired_by_team) && data.hired_by_team.length) {
        const saved = data.hired_by_team;
        if (typeof saved[0] === 'string') {
          setHiredByTeam(saved.map(n => DEFAULT_TEAM.find(d => d.name === n) || { id: n.toLowerCase(), name: n, color: 'var(--wx-text-faint)', bg: '#F3F4F6' }));
        } else {
          setHiredByTeam(saved.filter(m => m && m.name));
        }
      }
    }
    if (loaded) settingsLoadedRef.current = true;
    else console.error('fetchSettings failed; settings will not be saved from this session until it succeeds', error);
  }

  useEffect(() => { fetchSettings(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // NO TIMER. This used to re-fetch every 30 seconds "in case realtime missed a message", in every open tab, for ever. The live
  // subscription already delivers every change, reads the row again whenever it (re)connects (above), and here the row is read once
  // more whenever a tab that was in the background is looked at again, which is the one moment a message could really have been missed.
  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible') fetchSettings(); };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist settings - brandOrder debounced (rapid drag changes), rest immediate
  useEffect(() => {
    localStorage.setItem('brandOrder', JSON.stringify(brandOrder));
    scheduleSettingsSave({ brand_order: brandOrder });
  }, [brandOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  // hiddenBrands saved directly in hideBrand/showBrand (not here) to avoid timing issues
  useEffect(() => {
    localStorage.setItem('customBrands', JSON.stringify(customBrands));
    saveSettingNow({ custom_brands: customBrands });
  }, [customBrands]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    localStorage.setItem('hiredByTeam', JSON.stringify(hiredByTeam));
    saveSettingNow({ hired_by_team: hiredByTeam });
  }, [hiredByTeam]); // eslint-disable-line react-hooks/exhaustive-deps

  // Outside click for hidden dropdown
  useOutsideClick(hiddenRef, () => setShowHiddenDrop(false));
  // Outside click for notification panel · must also exclude the portaled panel itself
  useEffect(() => {
    if (!showNotifPanel) return;
    function onDown(e) {
      if (notifPanelRef.current && notifPanelRef.current.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.notif-panel')) return;
      setShowNotifPanel(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showNotifPanel]);

  // Focus inline input
  useEffect(() => {
    if (inlineEdit && inlineInputRef.current) {
      inlineInputRef.current.focus();
      inlineInputRef.current.select();
    }
  }, [inlineEdit]);

  /* ── Derived / filtered rows ── */
  const visibleBrands = useMemo(
    () => allBrands.filter(b => !hiddenBrands.includes(b)),
    [allBrands, hiddenBrands]
  );

  const filteredCreators = useMemo(() => creators.filter(c => {
    if (currentUser?.role === 'apc' && !apcBrands.includes(c.brand)) return false;
    if (currentUser?.role === 'client') {
      const allowed = Array.isArray(currentUser.brand_access) ? currentUser.brand_access : [];
      if (!allowed.includes(c.brand)) return false;
    }
    if (activeBrand !== 'All' && c.brand !== activeBrand) return false;
    if (filters.payment  && c.payment_status !== filters.payment)  return false;
    if (filters.videos   && c.videos         !== filters.videos)   return false;
    if (filters.hiredBy  && c.hired_by       !== filters.hiredBy)  return false;
    if (filters.category && c.category       !== filters.category) return false;
    // Date filter (client-side)
    if (dateFilter.mode === 'month') {
      if (!c.hiring_date) return false;
      const d = c.hiring_date.slice(0, 7);
      const target = `${dateFilter.year}-${String(dateFilter.month + 1).padStart(2, '0')}`;
      if (d !== target) return false;
    } else if (dateFilter.mode === 'year') {
      if (!c.hiring_date) return false;
      if (!c.hiring_date.startsWith(String(dateFilter.year))) return false;
    }
    if (search) {
      return (
        fuzzyMatch(search, c.name) ||
        fuzzyMatch(search, c.tiktok_account) ||
        fuzzyMatch(search, c.brand) ||
        fuzzyMatch(search, c.category)
      );
    }
    return true;
  }), [creators, activeBrand, filters, dateFilter, search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Calendar uses brand+filter context but ignores dateFilter so user can navigate any month
  const creatorsForCalendar = useMemo(() => creators.filter(c => {
    if (activeBrand !== 'All' && c.brand !== activeBrand) return false;
    if (filters.payment  && c.payment_status !== filters.payment)  return false;
    if (filters.videos   && c.videos         !== filters.videos)   return false;
    if (filters.hiredBy  && c.hired_by       !== filters.hiredBy)  return false;
    if (filters.category && c.category       !== filters.category) return false;
    return true;
  }), [creators, activeBrand, filters]);

  const sortedCreators = useMemo(() => {
    if (!sortDateDir) return filteredCreators;
    return [...filteredCreators].sort((a, b) => {
      const da = a.hiring_date || '';
      const db = b.hiring_date || '';
      if (sortDateDir === 'asc') return da < db ? -1 : da > db ? 1 : 0;
      return da > db ? -1 : da < db ? 1 : 0;
    });
  }, [filteredCreators, sortDateDir]);

  // Paged rendering - cap DOM rows to 100, load more on demand
  const PAGE_SIZE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Reset visible count whenever filter changes
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [sortedCreators.length]);
  const visibleCreators = sortedCreators.slice(0, visibleCount);
  const hasMore = visibleCount < sortedCreators.length;

  const allSelected = sortedCreators.length > 0 && selectedIds.size === sortedCreators.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleSelect = id => setSelectedIds(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });
  const toggleSelectAll = () => setSelectedIds(allSelected ? new Set() : new Set(sortedCreators.map(c => c.id)));

  const exportSelectedCSV = () => {
    const rows = sortedCreators.filter(c => selectedIds.has(c.id));
    const hdrs = 'Name,TikTok,Brand,Category,Deal,WhatsApp,Email,Payment,Videos,Hired By,Hire Date';
    const body = rows.map(c =>
      [c.name,c.tiktok_account,c.brand,c.category,c.deal,c.whatsapp_number,c.email,c.payment_status,c.videos,c.hired_by,c.hiring_date]
        .map(v => `"${(v||'').replace(/"/g,'""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([hdrs+'\n'+body], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='creators_export.csv'; a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem('lastExportTime', Date.now().toString());
    addNotification(`CSV exported - ${rows.length} creator${rows.length !== 1 ? 's' : ''}`, 'export');
  };

  const exportVideoCodesCSV = () => {
    const rows = sortedCreators.filter(c => selectedIds.has(c.id));
    const hasAny = rows.some(c => Array.isArray(c.video_codes) && c.video_codes.some(v => v.video || v.adCode));
    if (!hasAny) { setShowNoVideoModal(true); return; }
    const lines = ['Creator Name,Brand,Video #,Video Link,Ad Code'];
    rows.forEach(c => {
      const codes = (Array.isArray(c.video_codes) ? c.video_codes : []).filter(v => v.video || v.adCode);
      codes.forEach((v, i) => {
        lines.push([c.name, c.brand, i + 1, v.video || '', v.adCode || ''].map(x => `"${(x+'').replace(/"/g,'""')}"`).join(','));
      });
    });
    logActivity(currentUser, 'EXPORT_CSV', null, { count: rows.length });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'video_codes_export.csv'; a.click();
    URL.revokeObjectURL(url);
    addNotification(`Video codes exported - ${rows.length} creator${rows.length !== 1 ? 's' : ''}`, 'export');
  };

  const copyUsernamesToClipboard = async () => {
    const rows = sortedCreators.filter(c => selectedIds.has(c.id));
    const seen = new Set();
    const usernames = [];
    rows.forEach(c => {
      const handle = c.tiktok_account ? parseTikTok(c.tiktok_account).handle : '';
      const value = (handle || c.name || '').trim();
      if (!value) return;
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      usernames.push(value);
    });
    if (usernames.length === 0) {
      addNotification('No usernames to copy', 'export');
      return;
    }
    try {
      await navigator.clipboard.writeText(usernames.join('\n'));
      addNotification(`${usernames.length} unique username${usernames.length !== 1 ? 's' : ''} copied · from ${rows.length} selected`, 'export');
    } catch {
      addNotification('Copy failed · clipboard unavailable', 'export');
    }
  };

  const bulkDeleteSelected = () => {
    if (currentUser?.role !== 'superadmin') return;
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setDeleteModal({ type: 'bulk', count: ids.length, ids });
  };

  const confirmBulkDelete = async (ids) => {
    const records = creators.filter(c => ids.includes(c.id));
    undoDataRef.current = { type: 'bulk', records };
    setCreators(prev => prev.filter(c => !ids.includes(c.id)));
    setSelectedIds(new Set());
    const { error } = await supabase.from('creators').delete().in('id', ids);
    if (error) {
      addNotification('Bulk delete failed - ' + error.message, 'error');
      undoDataRef.current = null;
      return;
    }
    logActivity(currentUser, 'BULK_DELETE', null, { count: ids.length });
    startUndoToast(`${ids.length} creator${ids.length !== 1 ? 's' : ''} deleted`);
  };

  async function handleBulkStatusEdit(statusPatch) {
    // HARD RULE · Hired By never bulk-changes for anyone but Asad
    if (statusPatch && 'hired_by' in statusPatch && !isAsadUser(currentUser)) {
      delete statusPatch.hired_by;
      addNotification('Hired By can only be changed by Asad', 'error');
    }
    const ids = [...selectedIds];
    setCreators(prev => prev.map(c => ids.includes(c.id) ? { ...c, ...statusPatch } : c));
    await supabase.from('creators').update(statusPatch).in('id', ids);
    addNotification(`Updated ${ids.length} creator${ids.length !== 1 ? 's' : ''}`, 'edit');
    logActivity(currentUser, 'BULK_STATUS_EDIT', null, { count: ids.length, ...statusPatch });
    setShowBulkStatusModal(false);
    setSelectedIds(new Set());
  }

  // Brand counts per tab (from full creators list, not filtered by brand)
  const brandCounts = useMemo(() => {
    const counts = { All: creators.length };
    creators.forEach(c => {
      if (c.brand) counts[c.brand] = (counts[c.brand] || 0) + 1;
    });
    return counts;
  }, [creators]);

  // Brand stats - computed from filteredCreators so date/filter/search are all respected
  const brandStats = useMemo(() => {
    if (activeBrand === 'All') return null;
    let totalAmount = 0, totalVideos = 0, videosDone = 0, totalPaid = 0;
    filteredCreators.forEach(c => {
      const { amount, videos } = parseDeal(c.deal);
      totalAmount += amount;
      totalVideos += videos;
      if (Array.isArray(c.video_codes) && c.video_codes.some(v => v?.video)) {
        videosDone += c.video_codes.filter(v => v?.video).length;
      } else if (c.videos === 'Done') {
        videosDone += (videos || 1);
      }
      if (c.payment_status === 'Paid') totalPaid += amount;
    });
    const avgRate = totalVideos > 0 ? Math.round(totalAmount / totalVideos) : 0;
    return { count: filteredCreators.length, totalAmount, totalVideos, videosDone, totalPaid, avgRate };
  }, [activeBrand, filteredCreators]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Notification icon + time helpers ── */
  function getNotifIcon(type) {
    if (type === 'add')     return '✦';
    if (type === 'edit')    return '✎';
    if (type === 'delete')  return '✕';
    if (type === 'paid')    return '✓';
    if (type === 'overdue') return '⚠';
    if (type === 'backup')  return '☁';
    if (type === 'export')  return '↓';
    if (type === 'join')    return '🙋';
    if (type === 'error')   return '✕';
    if (type === 'info')    return '●';
    return '•';
  }

  function formatNotifTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const diff = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diff < 1)    return 'Just now';
    if (diff < 60)   return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /* ── Row status for color strip ── */
  function getRowStatus(creator) {
    if (creator.payment_status === 'Paid' && creator.videos === 'Done') return 'green';
    if (creator.hiring_date) {
      const days = Math.floor((Date.now() - new Date(creator.hiring_date).getTime()) / 86400000);
      if (days >= 30 && creator.payment_status === 'Not Yet') return 'red';
    }
    return 'amber';
  }

  /* ── Retention map (name → hire count) ── */
  const retentionMap = useMemo(() => {
    const map = {};
    creators.forEach(c => {
      if (!c.name) return;
      const key = c.name.trim().toLowerCase();
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [creators]);

  /* ── Date button label ── */
  function dateBtnLabel() {
    if (dateFilter.mode === 'all') return 'All Time';
    if (dateFilter.mode === 'year') return `${dateFilter.year}`;
    return `${MONTHS[dateFilter.month]} ${dateFilter.year}`;
  }

  /* ── CRUD ── */
  // Whitelist of columns that actually exist in the Supabase `creators` table.
  // Keeps payloads safe from schema drift (e.g. tiktok_account_2 was failing silently).
  const CREATOR_COLUMNS = [
    'name', 'tiktok_account', 'tiktok_account_2', 'brand', 'deal', 'hiring_date', 'deadline',
    'payment_status', 'videos', 'product', 'category', 'hired_by',
    'whatsapp_number', 'email', 'paypal', 'zelle', 'comments', 'video_codes', 'status',
    'gmv', 'ad_spent', 'total_gmv',
  ];
  /* Snap a typed brand onto the spelling already in use.
     "Bios Time" vs "Biostime" silently split one brand into two everywhere
     (separate Performance rows, separate budgets, creators missing from the
     brand you opened). Exact-string grouping is relied on across the app, so
     rather than change that, keep one canonical spelling at the door. */
  function canonicalBrand(input) {
    const raw = String(input || '').trim();
    if (!raw) return raw;
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = norm(raw);
    if (!target) return raw;
    const counts = {};
    creators.forEach(c => {
      const b = (c.brand || '').trim();
      if (b && norm(b) === target) counts[b] = (counts[b] || 0) + 1;
    });
    const known = Object.keys(counts);
    if (!known.length || known.includes(raw)) return raw;
    // most-used existing spelling wins
    return known.sort((a, b) => counts[b] - counts[a])[0];
  }

  function sanitizeCreatorPayload(payload) {
    const out = {};
    for (const k of CREATOR_COLUMNS) {
      if (payload[k] !== undefined) out[k] = payload[k];
    }
    if (out.brand !== undefined) out.brand = canonicalBrand(out.brand);
    return out;
  }

  async function handleSave(payload, id) {
    setShowSheet(false);
    setEditCreator(null);
    const cleanPayload = sanitizeCreatorPayload(payload);
    if (id) {
      // Compute diff for logs
      const old = creators.find(c => c.id === id);
      // HARD RULE · Hired By on an EXISTING creator is Asad-only (bulk
      // vandalism guard) — strip the change, keep the rest of the edit.
      const isAsadUser = currentUser?.id === 'asad' || currentUser?.username === 'Asad';
      if (old && !isAsadUser && (cleanPayload.hired_by ?? old.hired_by ?? '') !== (old.hired_by || '')) {
        delete cleanPayload.hired_by;
        addNotification('Hired By can only be changed by Asad', 'error');
      }
      const DIFF_FIELDS = { name: 'Name', payment_status: 'Payment', videos: 'Videos',
        deal: 'Deal', brand: 'Brand', product: 'Product', category: 'Category',
        hired_by: 'Hired By', deadline: 'Deadline' };
      const changes = [];
      if (old) {
        Object.entries(DIFF_FIELDS).forEach(([key, label]) => {
          const from = (old[key] || '').toString();
          const to   = (cleanPayload[key] || '').toString();
          if (from !== to) changes.push({ field: label, from: old[key] || '', to: cleanPayload[key] || '' });
        });
      }
      // Optimistic update - instant in UI
      setCreators(prev => prev.map(c => c.id === id ? { ...c, ...cleanPayload } : c));
      // Await Supabase + handle errors so failures aren't silent
      const { error } = await supabase.from('creators').update(cleanPayload).eq('id', id);
      if (error) {
        console.error('Update failed:', error);
        addNotification(`Update failed: ${error.message}`, 'error');
        // Revert optimistic update by refetching truth from DB
        fetchCreators();
        return;
      }
      addNotification(`${cleanPayload.name || 'Creator'} updated`, 'edit');
      logActivity(currentUser, 'CREATOR_UPDATE', cleanPayload.name, { brand: cleanPayload.brand, changes });
      if (cleanPayload.category) {
        await syncCategory(cleanPayload.name, cleanPayload.tiktok_account, cleanPayload.category);
      }
    } else {
      // Non-superadmin submissions go to pending review
      const needsReview = currentUser?.role !== 'superadmin';
      const insertPayload = sanitizeCreatorPayload(payload);
      insertPayload.status = needsReview ? 'pending' : 'approved';
      const { data, error } = await supabase.from('creators').insert([insertPayload]).select();
      if (error) {
        console.error('Insert failed:', error);
        addNotification(`Failed to add creator: ${error.message}`, 'error');
        return;
      }
      if (needsReview) {
        addNotification(`${payload.name || 'Creator'} submitted for Asad's approval`, 'info');
        logActivity(currentUser, 'CREATOR_ADD', payload.name, { brand: payload.brand, pending: true });
        fetchPendingCount();
      } else {
        if (data && data[0]) {
          setCreators(prev => [data[0], ...prev]);
          setKpiDeals(d => d + 1);
        }
        addNotification(`${payload.name || 'Creator'} added to ${payload.brand || 'Deals'}`, 'add');
        logActivity(currentUser, 'CREATOR_ADD', payload.name, { brand: payload.brand });
        if (payload.category) {
          await syncCategory(payload.name, payload.tiktok_account, payload.category);
        }
        fetchCreators();
      }
    }
  }

  async function syncCategory(name, tiktok, category) {
    if (!category) return;
    const conditions = [];
    if (name) conditions.push(`name.ilike.${name}`);
    if (tiktok) conditions.push(`tiktok_account.eq.${tiktok}`);
    if (conditions.length === 0) return;
    const { data } = await supabase
      .from('creators')
      .select('id')
      .or(conditions.join(','))
      .not('name', 'is', null)
      .neq('name', '');
    if (data && data.length > 0) {
      const ids = data.map(r => r.id);
      await supabase.from('creators').update({ category }).in('id', ids);
    }
  }

  function startUndoToast(message) {
    if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    let t = 5;
    setUndoToast({ message, timeLeft: t });
    undoTimerRef.current = setInterval(() => {
      t -= 1;
      if (t <= 0) {
        clearInterval(undoTimerRef.current);
        undoTimerRef.current = null;
        undoDataRef.current = null;
        setUndoToast(null);
      } else {
        setUndoToast(prev => prev ? { ...prev, timeLeft: t } : null);
      }
    }, 1000);
  }

  async function handleUndo() {
    if (undoTimerRef.current) { clearInterval(undoTimerRef.current); undoTimerRef.current = null; }
    const data = undoDataRef.current;
    undoDataRef.current = null;
    setUndoToast(null);
    if (!data || !data.records || data.records.length === 0) return;
    // eslint-disable-next-line no-unused-vars
    const cleaned = data.records.map(({ inserted_at, created_time, ...rest }) => rest);
    await supabase.from('creators').insert(cleaned);
    fetchCreators();
  }

  async function confirmDelete(type, id, name) {
    if (type !== 'brand') { setDeleteModal({ type, id, name, count: 0 }); return; }
    /*
     * ASK THE DATABASE, NOT THE LIST ON SCREEN.
     *
     * `creators` in state is filtered — approved or null status, and a name —
     * but the delete below matches on the brand STRING and takes everything
     * carrying it. So the dialog said "5 creator records" and removed
     * seventeen, the extra twelve being unreviewed APPLICATIONS that nobody
     * had looked at yet. Undo could not bring them back either, because it
     * only ever held the five.
     *
     * A confirmation that undercounts what it destroys is worse than no
     * confirmation: it is a promise.
     */
    const { data, error } = await supabase.from('creators').select('id,status,name').eq('brand', name);
    if (error) {
      addNotification('Could not check what is in this brand · nothing deleted', 'error');
      return;
    }
    const all = data || [];
    const visible = creators.filter(c => c.brand === name).length;
    const pending = all.filter(c => String(c.status || '').toLowerCase() === 'pending').length;
    setDeleteModal({ type, id, name, count: all.length, pending, hidden: Math.max(0, all.length - visible) });
  }

  async function handleDelete(id) {
    const creator = creators.find(c => c.id === id);
    logActivity(currentUser, 'CREATOR_DELETE', creator?.name, { brand: creator?.brand });
    undoDataRef.current = { type: 'creator', records: creator ? [creator] : [] };
    // Optimistic remove - instant in UI
    setCreators(prev => prev.filter(c => c.id !== id));
    setKpiDeals(d => d - 1);
    setDetailCreator(null);
    setDeleteModal(null);
    supabase.from('creators').delete().eq('id', id).then(() => {});
    startUndoToast(`${creator?.name || 'Creator'} deleted`);
  }

  async function deleteBrand(brand) {
    /*
     * EVERY ROW THE DELETE WILL TAKE, captured before it runs.
     *
     * This used to snapshot the on-screen list, which is filtered, while the
     * delete matched the brand string and took everything. Undo therefore
     * restored the approved deals and silently dropped the pending
     * applications — the rows nobody had reviewed yet, and the ones a person
     * pressing Undo is least likely to notice missing.
     */
    const { data: everything, error: readErr } = await supabase.from('creators').select('*').eq('brand', brand);
    if (readErr) {
      addNotification('Could not read this brand · nothing deleted', 'error');
      return;
    }
    const brandCreators = everything || [];
    const visible = creators.filter(c => c.brand === brand).length;
    logActivity(currentUser, 'BRAND_DELETE', brand, { count: brandCreators.length, visible });
    undoDataRef.current = { type: 'brand', brand, records: brandCreators };
    // Optimistic remove - instant in UI
    setCreators(prev => prev.filter(c => c.brand !== brand));
    setKpiDeals(d => d - visible);
    setAllBrands(prev => prev.filter(b => b !== brand));
    setBrandOrder(prev => prev.filter(b => b !== brand));
    setCustomBrands(prev => prev.filter(b => b !== brand));
    if (activeBrand === brand) setActiveBrand('All');
    setDeleteModal(null);
    supabase.from('creators').delete().eq('brand', brand).then(() => {});
    startUndoToast(`"${brand}" and ${brandCreators.length} record${brandCreators.length !== 1 ? 's' : ''} deleted`);
  }

  /* ── Inline save ── */
  async function saveInline(id, field, value) {
    setInlineEdit(null);
    const creator = creators.find(c => c.id === id);
    const oldValue = creator?.[field];
    // HARD RULE · Hired By changes are Asad-only
    if (field === 'hired_by' && !isAsadUser(currentUser)) {
      addNotification('Hired By can only be changed by Asad', 'error');
      return;
    }
    // Optimistic update - instant in UI
    setCreators(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
    supabase.from('creators').update({ [field]: value }).eq('id', id).then(() => {});
    // Log the change
    const FIELD_LABELS = { payment_status: 'Payment', videos: 'Videos', hired_by: 'Hired By', category: 'Category', name: 'Name', deal: 'Deal', brand: 'Brand', tiktok_account: 'TikTok', whatsapp_number: 'WhatsApp', product: 'Product' };
    if (FIELD_LABELS[field] && oldValue !== value) {
      logActivity(currentUser, 'CREATOR_UPDATE', creator?.name, {
        brand: creator?.brand,
        changes: [{ field: FIELD_LABELS[field], from: oldValue || '', to: value || '' }],
      });
    }
    // Paid confetti + notification + chime
    if (field === 'payment_status' && value === 'Paid') {
      addNotification(`Payment marked Paid for ${creator?.name || 'creator'}`, 'paid');
      if (!soundsMuted) playSound('paid');
      setKpiPulse(true);
      setTimeout(() => setKpiPulse(false), 1100);
      setShowConfetti(true);
      if (confettiTimerRef.current) clearTimeout(confettiTimerRef.current);
      confettiTimerRef.current = setTimeout(() => setShowConfetti(false), 3200);
    }
    // Category sync affects multiple rows - needs full reload
    if (field === 'category') {
      if (creator) {
        await syncCategory(creator.name, creator.tiktok_account, value);
        fetchCreators();
      }
    }
  }

  /* ── Brand actions ── */
  function hideBrand(brand) {
    const next = hiddenBrands.filter(b => b !== brand).concat(brand); // dedup + add
    setHiddenBrands(next);
    setAllBrands(prev => prev.filter(b => b !== brand)); // instant visual remove
    if (activeBrand === brand) setActiveBrand('All');
    saveSettingForced({ hidden_brands: next }, 'hideBrand');
    localStorage.setItem('hiddenBrands', JSON.stringify(next));
  }

  function showBrand(brand) {
    const next = hiddenBrands.filter(b => b !== brand);
    setHiddenBrands(next);
    saveSettingForced({ hidden_brands: next }, 'showBrand');
    localStorage.setItem('hiddenBrands', JSON.stringify(next));
    fetchCreators(); // repopulate allBrands so brand tab reappears
  }

  async function renameBrand(oldName, newName) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    await supabase.from('creators').update({ brand: trimmed }).eq('brand', oldName);
    setAllBrands(prev => prev.map(b => b === oldName ? trimmed : b));
    setBrandOrder(prev => prev.map(b => b === oldName ? trimmed : b));
    setCustomBrands(prev => prev.map(b => b === oldName ? trimmed : b));
    if (activeBrand === oldName) setActiveBrand(trimmed);
    fetchCreators();
  }

  async function duplicateBrand(srcBrand) {
    const newName = window.prompt(`Duplicate "${srcBrand}" as:`, `${srcBrand} Copy`);
    if (!newName || !newName.trim()) return;
    const trimmed = newName.trim();
    const { data } = await supabase
      .from('creators')
      .select('*')
      .eq('brand', srcBrand);
    if (data && data.length > 0) {
      const copies = data.map(c => {
        // eslint-disable-next-line no-unused-vars
        const { id, inserted_at, created_time, airtable_id, ...rest } = c;
        return { ...rest, brand: trimmed };
      });
      await supabase.from('creators').insert(copies);
    }
    if (!customBrands.includes(trimmed)) {
      const updated = [...customBrands, trimmed];
      setCustomBrands(updated);
    }
    fetchCreators();
  }

  function addBrandFromInput() {
    const name = newBrandName.trim();
    if (!name) { setShowAddBrand(false); return; }
    if (!customBrands.includes(name)) {
      setCustomBrands(prev => [...prev, name]);
    }
    setAllBrands(prev => prev.includes(name) ? prev : [...prev, name]);
    setNewBrandName('');
    setShowAddBrand(false);
  }

  /* ── Drag reorder ── */
  function onDragStart(brand) { setDragBrand(brand); }
  function onDragOver(e, brand) {
    e.preventDefault();
    if (!dragBrand || dragBrand === brand) return;
  }
  function onDrop(brand) {
    if (!dragBrand || dragBrand === brand) { setDragBrand(null); return; }
    const newOrder = [...allBrands];
    const fromIdx = newOrder.indexOf(dragBrand);
    const toIdx   = newOrder.indexOf(brand);
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, dragBrand);
    setAllBrands(newOrder);
    setBrandOrder(newOrder);
    setDragBrand(null);
  }

  /* ── Inline dropdown position ── */
  function openInlineDrop(e, id, field, options) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    // Use viewport coords directly (position:fixed). InlineDropdown self-corrects if it overflows.
    setInlineDrop({ id, field, options, position: { top: rect.bottom + 2, left: rect.left } });
  }

  /* ── Render cell ── */
  function renderCell(creator, field) {
    // hired_by - inline dropdown (only remaining inline field)
    if (field === 'hired_by') {
      const raw = creator[field];
      if (!perms.canEdit) {
        return (
          <td key={field}>
            <HiredTag value={raw} />
            {!raw && <span className="text-muted"></span>}
          </td>
        );
      }
      return (
        <td key={field} onClick={e => openInlineDrop(e, creator.id, field, hiredByTeam.map(m => ({ value: m.name })))} style={{ cursor: 'pointer' }}>
          <HiredTag value={raw} />
          {!raw && <span className="text-muted"></span>}
        </td>
      );
    }

    // TikTok - clickable link
    if (field === 'tiktok_account') {
      const { url, handle } = parseTikTok(creator.tiktok_account);
      return (
        <td key={field}>
          {handle
            ? <a className="tiktok-link" href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{handle}</a>
            : <span className="text-muted"></span>}
        </td>
      );
    }

    // WhatsApp - clickable WA deep link
    if (field === 'whatsapp_number') {
      const raw = creator[field];
      const waNum = raw ? raw.replace(/[^0-9]/g, '') : '';
      return (
        <td key={field}>
          {raw
            ? <a className="wa-link" href={`https://wa.me/${waNum}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                {raw}
              </a>
            : <span className="text-muted"></span>}
        </td>
      );
    }

    // Payment status · superadmin: dropdown, others: read-only
    if (field === 'payment_status') {
      if (currentUser?.role === 'superadmin') {
        return (
          <td key={field} style={{ cursor: 'pointer' }}
            onClick={e => openInlineDrop(e, creator.id, field, PAYMENT_OPTIONS.map(v => ({ value: v })))}>
            {creator[field] ? <StatusBadge value={creator[field]} /> : <span className="text-muted">-</span>}
          </td>
        );
      }
      return <td key={field}><StatusBadge value={creator[field]} />{!creator[field] && <span className="text-muted"></span>}</td>;
    }
    // Videos status · superadmin: dropdown, others: read-only
    if (field === 'videos') {
      if (currentUser?.role === 'superadmin') {
        return (
          <td key={field} style={{ cursor: 'pointer' }}
            onClick={e => openInlineDrop(e, creator.id, field, VIDEOS_OPTIONS.map(v => ({ value: v })))}>
            {creator[field] ? <StatusBadge value={creator[field]} /> : <span className="text-muted">-</span>}
          </td>
        );
      }
      return <td key={field}><StatusBadge value={creator[field]} />{!creator[field] && <span className="text-muted"></span>}</td>;
    }

    // Brand - colored pill (superadmin: inline editable)
    if (field === 'brand') {
      const raw = creator[field];
      if (currentUser?.role === 'superadmin') {
        if (inlineEdit?.id === creator.id && inlineEdit?.field === 'brand') {
          return (
            <td key={field}>
              <input autoFocus className="cell-inline-input" defaultValue={raw || ''}
                onBlur={e => saveInline(creator.id, 'brand', e.target.value.trim())}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setInlineEdit(null); }}
                onClick={e => e.stopPropagation()} />
            </td>
          );
        }
        return (
          <td key={field} className="cell-editable" title="Click to edit"
            onClick={e => { e.stopPropagation(); setInlineEdit({ id: creator.id, field: 'brand', value: raw }); }}>
            {raw ? <span className="brand-pill">{raw}</span> : <span className="text-muted">-</span>}
          </td>
        );
      }
      return <td key={field}>{raw ? <span className="brand-pill">{raw}</span> : <span className="text-muted"></span>}</td>;
    }

    // Generic text - superadmin: inline editable, others: read only
    const raw = creator[field];
    if (currentUser?.role === 'superadmin') {
      if (inlineEdit?.id === creator.id && inlineEdit?.field === field) {
        return (
          <td key={field}>
            <input autoFocus className="cell-inline-input" defaultValue={raw || ''}
              onBlur={e => saveInline(creator.id, field, e.target.value.trim())}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setInlineEdit(null); }}
              onClick={e => e.stopPropagation()} />
          </td>
        );
      }
      return (
        <td key={field} title={raw ? 'Click to edit' : 'Click to add'} className="cell-editable"
          onClick={e => { e.stopPropagation(); setInlineEdit({ id: creator.id, field, value: raw }); }}>
          {raw || <span className="text-muted">-</span>}
        </td>
      );
    }
    return (
      <td key={field} title={raw || ''}>
        {raw || <span className="text-muted"></span>}
      </td>
    );
  }

  /* ── Scroll-to-top FAB visibility ── */
  useEffect(() => {
    function check() {
      const winY = window.scrollY || document.documentElement.scrollTop;
      const elY  = tableScrollRef.current ? tableScrollRef.current.scrollTop : 0;
      setShowScrollTop(winY > 220 || elY > 220);
    }
    window.addEventListener('scroll', check, { passive: true });
    const el = tableScrollRef.current;
    if (el) el.addEventListener('scroll', check, { passive: true });
    return () => {
      window.removeEventListener('scroll', check);
      if (el) el.removeEventListener('scroll', check);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tableScrollRef.current) tableScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ── Close inline drop on outside ── */
  useEffect(() => {
    if (!inlineDrop) return;
    function handler() { setInlineDrop(null); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [inlineDrop]);

  /* ── Render ── */
  /*
   * NO SIGN-IN SCREEN. Identity arrives from the hub, written to sessionStorage
   * before this mounts. Landing here means the mount raced the session, not
   * that somebody needs a password — this app has none any more. Render
   * nothing for that instant rather than a login form that cannot work.
   */
  if (!currentUser) return null;
  if (currentUser.role === 'apc' && apcBrands.length === 0) {
    return <BrandSelector allBrands={allBrands} onSelect={handleApcBrandSelect} />;
  }

  return (
    <div className="app-root" style={{ background: 'var(--pc-bg, var(--wx-surface-1))' }}>
      {/* ═══ OLD CHROME HIDDEN · replaced by WurxUI shell ═══ */}
      {false && (<>
      {/* TOPBAR · Samsung One UI v2 */}
      <header className="tb2">
        {/* LEFT: brand cluster */}
        <div className="tb2-left">
          <button className="tb2-logo" onClick={scrollToTop} aria-label="Home">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </button>
          <div className="tb2-brand-text">
            <div className="tb2-brand-title">Creator Hub</div>
            <div className="tb2-brand-sub">Wurx Media Workspace</div>
          </div>
        </div>

        <div className="tb2-spacer" />

        {/* RIGHT: actions + profile */}
        <div className="tb2-right">
          {/* Notifications */}
          <div className="tb2-ic-wrap" ref={notifPanelRef}>
            <button
              className={`tb2-ic${showNotifPanel ? ' active' : ''}${bellShake ? ' bell-shake' : ''}`}
              onClick={() => setShowNotifPanel(s => !s)}
              title="Notifications"
              aria-label="Notifications"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
              </svg>
              {notifications.length > 0 && <span className="tb2-dot" />}
            </button>
            {showNotifPanel && createPortal(
              <NotifPanelV2
                notifications={notifications}
                onClose={() => setShowNotifPanel(false)}
                onClearAll={() => { setNotifications([]); if (notifKey) localStorage.removeItem(notifKey); setShowNotifPanel(false); }}
                onDismissOne={(id) => setNotifications(prev => {
                  const next = prev.filter(x => x.id !== id);
                  if (notifKey) { try { localStorage.setItem(notifKey, JSON.stringify(next)); } catch {} }
                  return next;
                })}
                getIcon={getNotifIcon}
                formatTime={formatNotifTime}
                soundsMuted={soundsMuted}
                onToggleSounds={() => setSoundsMuted(m => !m)}
              />,
              wxPortalHost()
            )}
          </div>

          {/* Pending approvals (superadmin) */}
          {currentUser?.role === 'superadmin' && pendingCount > 0 && (
            <button className="tb2-ic tb2-ic-amber" onClick={() => setShowReview(true)} title={`${pendingCount} pending approval${pendingCount !== 1 ? 's' : ''}`} aria-label="Pending approvals">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <span className="tb2-badge">{pendingCount > 9 ? '9+' : pendingCount}</span>
            </button>
          )}

          {/* Activity logs */}
          <button className="tb2-ic tb2-hide-md" onClick={() => setShowLogs(true)} title="Activity Logs" aria-label="Activity Logs">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>

          {/* Live DB latency indicator */}
          <LatencyIndicator />

          {/* Divider */}
          <div className="tb2-divider" />

          {/* Profile pill */}
          <button className="tb2-profile" onClick={() => setShowSettings(true)} aria-label="Profile">
            <div className="tb2-avatar" style={{ background: getGradient(currentUser.display) }}>
              {(currentUser.display || '?')[0].toUpperCase()}
              <span className="tb2-avatar-ring" />
            </div>
            <div className="tb2-profile-info">
              <span className="tb2-profile-name">{currentUser.display}</span>
              <span className="tb2-profile-role">{(ROLE_META[currentUser.role] || {}).label || currentUser.role}</span>
            </div>
            <svg className="tb2-profile-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>

          {/* Sign out icon */}
          <button className="tb2-ic tb2-ic-signout tb2-hide-sm" onClick={handleLogout} title="Sign out" aria-label="Sign out">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>

          {/* Mobile hamburger */}
          <button className="tb2-ic tb2-hamburger" onClick={() => setShowMobileMenu(s => !s)} title="Menu" aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        </div>
      </header>

      {/* MOBILE MENU SHEET · V2 Tailwind */}
      {showMobileMenu && (
        <MobileMenuSheetV2
          user={currentUser.display}
          role={(ROLE_META[currentUser.role] || {}).label || currentUser.role}
          onClose={() => setShowMobileMenu(false)}
          items={[
            { label: 'Activity Logs', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>, onClick: () => setShowLogs(true) },
            { label: 'Settings', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>, onClick: () => setShowSettings(s => !s) },
            ...(perms.canAdd ? [{ label: 'Team', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, onClick: () => setShowUserMgmt(true) }] : []),
            { label: 'Sign Out', danger: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>, onClick: handleLogout },
          ]}
        />
      )}

      {/* PAGE HEAD · Samsung One UI v2 (single row aligned) */}
      <section className="ph2">
        <div className="ph2-row">
          <div className="ph2-kpis">
            <button className={`ph2-kpi ph2-kpi-accent${kpiPulse ? ' ph2-kpi-pulse' : ''}`} onClick={exportUniqueCreators} title="Download unique creators as Excel">
              <div className="ph2-kpi-icon ph2-kpi-icon-accent">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div className="ph2-kpi-text">
                <div className="ph2-kpi-val">{kpiCreators}</div>
                <div className="ph2-kpi-lbl">Unique Creators</div>
              </div>
            </button>
            <div className={`ph2-kpi${kpiPulse ? ' ph2-kpi-pulse' : ''}`}>
              <div className="ph2-kpi-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              </div>
              <div className="ph2-kpi-text">
                <div className="ph2-kpi-val">{kpiDeals}</div>
                <div className="ph2-kpi-lbl">Total Deals</div>
              </div>
            </div>
          </div>
          <div className="ph2-actions">
            <ViewSwitcherV2 value={viewMode} onChange={setViewMode} />
            <div className="ph2-date-wrap" ref={dateRef}>
              <button className={`ph2-date-btn${showDatePicker ? ' active' : ''}`} onClick={() => setShowDatePicker(s => !s)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>{dateBtnLabel()}</span>
                <svg className="ph2-date-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {showDatePicker && (
                <DatePicker filter={dateFilter} onChange={f => setDateFilter(f)} onClose={() => setShowDatePicker(false)} />
              )}
            </div>
            {perms.canAdd && (
              <button className="ph2-add-btn" onClick={() => { setEditCreator(null); setShowSheet(true); }}>
                <span className="ph2-add-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </span>
                <span className="ph2-add-text">Add Creator</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* FILTER BAR · Tailwind v2 */}
      <div className="tw-px-6 sm:tw-px-7 tw-pb-3 tw-font-sans">
        <div className="tw-flex tw-items-center tw-gap-3 tw-flex-wrap tw-bg-white tw-rounded-[22px] tw-shadow-oneui tw-px-3 tw-py-2.5">
          {/* Search */}
          <div className="tw-relative tw-flex-1 tw-min-w-[220px] tw-max-w-[400px]">
            <svg className="tw-absolute tw-left-4 tw-top-1/2 -tw-translate-y-1/2 tw-w-4 tw-h-4 tw-text-oneui-mute tw-pointer-events-none" viewBox="0 0 20 20" fill="none">
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <input
              ref={searchInputRef}
              placeholder="Search creators, brands, categories…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="tw-w-full tw-h-10 tw-pl-11 tw-pr-9 tw-rounded-full tw-bg-black/[0.04] tw-border-2 tw-border-transparent focus:tw-bg-white focus:tw-border-[#1259C3] focus:tw-shadow-[0_0_0_4px_rgba(18,89,195,0.12)] tw-outline-none tw-text-[13.5px] tw-font-medium tw-text-oneui-ink placeholder:tw-text-oneui-mute tw-transition tw-duration-200 tw-ease-oneui"
              style={{ fontFamily: 'inherit' }}
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="tw-absolute tw-right-1.5 tw-top-1/2 -tw-translate-y-1/2 tw-w-7 tw-h-7 tw-rounded-full tw-bg-black/10 tw-text-oneui-ink tw-text-[13px] tw-flex tw-items-center tw-justify-center tw-border-0 tw-cursor-pointer hover:tw-bg-rose-600 hover:tw-text-white active:tw-scale-90 tw-transition tw-duration-200 tw-ease-oneui">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>

          {/* Filter chips */}
          <div className="tw-flex tw-items-center tw-gap-1.5 tw-flex-wrap">
            <FilterChip label="Payment" value={filters.payment} options={PAYMENT_OPTIONS} onChange={v => setFilters(f => ({ ...f, payment: v }))} />
            <FilterChip label="Videos" value={filters.videos} options={VIDEOS_OPTIONS} onChange={v => setFilters(f => ({ ...f, videos: v }))} />
            {perms.canSeeHiredBy && (
              <FilterChip label="Hired By" value={filters.hiredBy} options={hiredByTeam.map(m => m.name)} onChange={v => setFilters(f => ({ ...f, hiredBy: v }))} />
            )}
            {(filters.payment || filters.videos || filters.hiredBy) && (
              <button onClick={() => setFilters(f => ({ ...f, payment: '', videos: '', hiredBy: '' }))}
                className="tw-h-8 tw-px-3 tw-rounded-full tw-bg-transparent tw-text-rose-600 tw-text-[12px] tw-font-bold tw-border-0 tw-cursor-pointer hover:tw-bg-rose-50 active:tw-scale-95 tw-transition tw-duration-200 tw-ease-oneui">
                Clear
              </button>
            )}
          </div>

          <div className="tw-flex-1" />

          {/* Column alignment toggle · only when Table view + a column is selected */}
          {viewMode === 'table' && selectedColKey && (() => {
            const col = MOVABLE_COLS.find(c => c.key === selectedColKey);
            const curAlign = colAligns[selectedColKey] || 'left';
            const aligns = [
              { id: 'left',   icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><line x1="0" y1="3" x2="14" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="0" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="0" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="0" y1="15" x2="8" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg> },
              { id: 'center', icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="3" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="4" y1="15" x2="12" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg> },
              { id: 'right',  icon: <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><line x1="2" y1="3" x2="16" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="6" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="2" y1="11" x2="16" y2="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><line x1="8" y1="15" x2="16" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg> },
            ];
            return (
              <div className="tw-hidden md:tw-flex tw-items-center tw-gap-1.5 tw-h-10 tw-pl-2.5 tw-pr-1 tw-rounded-full tw-bg-blue-50 tw-ring-1 tw-ring-blue-200 tw-mr-1.5" style={{ animation: 'vsv-down 0.22s cubic-bezier(0.33,1,0.68,1)' }}>
                <span className="tw-text-[10px] tw-font-extrabold tw-uppercase tw-tracking-wider tw-text-blue-700 tw-truncate tw-max-w-[90px]" title={`Aligning ${col?.label}`}>
                  {col?.label || selectedColKey}
                </span>
                <div className="tw-flex tw-gap-0.5 tw-bg-white tw-rounded-full tw-p-0.5 tw-ring-1 tw-ring-blue-200">
                  {aligns.map(a => (
                    <button
                      key={a.id}
                      onClick={() => setColAlign(selectedColKey, a.id)}
                      title={`Align ${a.id}`}
                      className={`tw-w-7 tw-h-7 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-border-0 tw-cursor-pointer tw-transition active:tw-scale-90 ${curAlign === a.id ? 'tw-bg-[#1259C3] tw-text-white tw-shadow-sm' : 'tw-bg-transparent tw-text-oneui-mute hover:tw-text-oneui-ink'}`}
                    >
                      {a.icon}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setSelectedColKey(null)}
                  title="Done"
                  className="tw-w-6 tw-h-6 tw-rounded-full tw-bg-blue-100 hover:tw-bg-blue-200 tw-text-blue-700 tw-flex tw-items-center tw-justify-center tw-text-[10px] tw-font-bold tw-border-0 tw-cursor-pointer"
                >✕</button>
              </div>
            );
          })()}

          {/* Density toggle (desktop only · mobile uses card list, no density needed) */}
          <div className="tw-hidden md:tw-flex tw-gap-1 tw-p-1 tw-bg-black/[0.04] tw-rounded-full">
            {['compact', 'normal', 'comfortable'].map(d => (
              <button key={d} onClick={() => setTableDensity(d)} title={d.charAt(0).toUpperCase() + d.slice(1)}
                className={`tw-h-8 tw-px-3 tw-rounded-full tw-flex tw-items-center tw-gap-1.5 tw-text-[11.5px] tw-font-semibold tw-tracking-[-0.1px] tw-border-0 tw-cursor-pointer tw-transition tw-duration-200 tw-ease-oneui ${tableDensity === d ? 'tw-bg-white tw-text-[#1259C3] tw-shadow-sm' : 'tw-bg-transparent tw-text-oneui-mute hover:tw-text-oneui-ink'}`}>
                {d === 'compact' ? (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><line x1="0" y1="3" x2="16" y2="3" stroke="currentColor" strokeWidth="1.8"/><line x1="0" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="1.8"/><line x1="0" y1="11" x2="16" y2="11" stroke="currentColor" strokeWidth="1.8"/><line x1="0" y1="15" x2="16" y2="15" stroke="currentColor" strokeWidth="1.8"/></svg>
                ) : d === 'normal' ? (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><line x1="0" y1="4" x2="16" y2="4" stroke="currentColor" strokeWidth="1.8"/><line x1="0" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="1.8"/><line x1="0" y1="15" x2="16" y2="15" stroke="currentColor" strokeWidth="1.8"/></svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><line x1="0" y1="5" x2="16" y2="5" stroke="currentColor" strokeWidth="1.8"/><line x1="0" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1.8"/></svg>
                )}
                <span className="tw-hidden md:tw-inline">{d.charAt(0).toUpperCase() + d.slice(1)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* BRAND TABS */}
      <div className="brand-tabs-outer">
        <div className="brand-tabs-bar">
          {(currentUser?.role === 'apc') ? (
            /* APC: only their self-selected brands */
            apcBrands.map(brand => (
              <button key={brand} className={`brand-tab${activeBrand === brand ? ' active' : ''}`}
                onClick={() => setActiveBrand(brand)}>{brand}</button>
            ))
          ) : (currentUser?.role === 'client') ? (
            /* Client: only Asad-assigned brands */
            (currentUser.brand_access || []).map(brand => (
              <button key={brand} className={`brand-tab${activeBrand === brand ? ' active' : ''}`}
                onClick={() => setActiveBrand(brand)}>{brand}</button>
            ))
          ) : (currentUser?.role === 'viewer') ? (
            /* Viewer: all brands, All tab, read-only (no drag/add/context) */
            <>
              <button className={`brand-tab${activeBrand === 'All' ? ' active' : ''}`}
                onClick={() => setActiveBrand('All')}>All</button>
              {visibleBrands.map(brand => (
                <button key={brand} className={`brand-tab${activeBrand === brand ? ' active' : ''}`}
                  onClick={() => setActiveBrand(brand)}>{brand}</button>
              ))}
            </>
          ) : (
            /* Superadmin / IPC / Admin: full controls */
            <>
              <button
                className={`brand-tab${activeBrand === 'All' ? ' active' : ''}`}
                onClick={() => setActiveBrand('All')}
              >All</button>

              {visibleBrands.map(brand => (
                <button
                  key={brand}
                  className={`brand-tab${activeBrand === brand ? ' active' : ''}`}
                  onClick={() => setActiveBrand(brand)}
                  draggable
                  onDragStart={() => onDragStart(brand)}
                  onDragOver={e => onDragOver(e, brand)}
                  onDrop={() => onDrop(brand)}
                  onContextMenu={e => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, brand });
                  }}
                >{brand}</button>
              ))}

              {showAddBrand ? (
                <input
                  ref={addBrandRef}
                  className="brand-tab-input"
                  autoFocus
                  placeholder="Brand name"
                  value={newBrandName}
                  onChange={e => setNewBrandName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') addBrandFromInput();
                    if (e.key === 'Escape') { setShowAddBrand(false); setNewBrandName(''); }
                  }}
                  onBlur={addBrandFromInput}
                />
              ) : (
                <button className="brand-tab-add" onClick={() => setShowAddBrand(true)}>+</button>
              )}
            </>
          )}
        </div>

        {/* Hidden brands pill - only for full-access roles */}
        {hiddenBrands.length > 0 && !['apc','client','viewer'].includes(currentUser?.role) && (
          <div className="hidden-brands-wrap" ref={hiddenRef}>
            <button
              className={`hidden-brands-pill${showHiddenDrop ? ' active' : ''}`}
              onClick={() => setShowHiddenDrop(s => !s)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              <span className="tw-hidden md:tw-inline">{hiddenBrands.length} hidden</span>
              <span className="md:tw-hidden tw-ml-0.5 tw-inline-flex tw-items-center tw-justify-center tw-w-4 tw-h-4 tw-rounded-full tw-bg-rose-500 tw-text-white tw-text-[9.5px] tw-font-extrabold">{hiddenBrands.length}</span>
            </button>
            {showHiddenDrop && (
              <div className="hidden-brands-dropdown">
                <div className="hbd-header">
                  <span>Hidden Brands</span>
                  <span className="hbd-count">{hiddenBrands.length}</span>
                </div>
                {hiddenBrands.map(b => (
                  <div className="hidden-brand-row" key={b}>
                    <span className="hbd-brand-name">{b}</span>
                    <button className="hidden-brand-show-btn" onClick={() => showBrand(b)} title="Unhide brand">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      Unhide
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* BRAND STATS */}
      {brandStats && (
        <div className="brand-stats-row">
          {/* Creators */}
          <div className="bstat-card bstat-card-blue">
            <span className="bsc-icon bsc-icon-blue">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="8" r="4" fill="currentColor" fillOpacity="0.22"/><circle cx="9" cy="8" r="4"/>
                <path d="M3 21v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2"/>
                <path d="M16 3.5a4 4 0 0 1 0 9" strokeWidth="1.8" opacity="0.6"/>
                <path d="M22 21v-2a4 4 0 0 0-3-4" strokeWidth="1.8" opacity="0.6"/>
              </svg>
            </span>
            <div className="bsc-body">
              <div className="bsc-label">Creators</div>
              <div className="bsc-value"><CountUp value={brandStats.count} /></div>
              <div className="bsc-sub">signed this brand</div>
            </div>
          </div>

          {/* Allocated */}
          <div className="bstat-card bstat-card-purple">
            <span className="bsc-icon bsc-icon-purple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="2" y="6" width="20" height="13" rx="2.5" fill="currentColor" fillOpacity="0.18"/>
                <rect x="2" y="6" width="20" height="13" rx="2.5"/>
                <circle cx="12" cy="12.5" r="3" fill="currentColor" fillOpacity="0.3"/><circle cx="12" cy="12.5" r="3"/>
                <path d="M6 9v7M18 9v7"/>
              </svg>
            </span>
            <div className="bsc-body">
              <div className="bsc-label">Allocated</div>
              <div className="bsc-value"><CountUp value={brandStats.totalAmount} prefix="$" /></div>
              <div className="bsc-sub">total budget</div>
            </div>
          </div>

          {/* Videos Total */}
          <div className="bstat-card bstat-card-amber">
            <span className="bsc-icon bsc-icon-amber">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2.5" fill="currentColor" fillOpacity="0.18"/>
                <rect x="2" y="3" width="20" height="14" rx="2.5"/>
                <polygon points="10 7.5 10 13 15 10.2" fill="currentColor" fillOpacity="0.85" stroke="none"/>
                <path d="M8 21h8M12 17v4"/>
              </svg>
            </span>
            <div className="bsc-body">
              <div className="bsc-label">Videos Total</div>
              <div className="bsc-value"><CountUp value={brandStats.totalVideos} /></div>
              <div className="bsc-sub">contracted</div>
            </div>
          </div>

          {/* Videos Done */}
          <div className="bstat-card bstat-card-teal">
            <span className="bsc-icon bsc-icon-teal">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.18"/><circle cx="12" cy="12" r="9"/>
                <path d="M7.5 12l3 3 6-6" strokeWidth="2.4"/>
              </svg>
            </span>
            <div className="bsc-body">
              <div className="bsc-label">Videos Done</div>
              <div className="bsc-value"><CountUp value={brandStats.videosDone} /><span className="bsc-value-total">/<CountUp value={brandStats.totalVideos} /></span></div>
              <div className="bsc-progress-wrap">
                <div className="bsc-progress-bar bsc-progress-teal" style={{width: `${Math.round((brandStats.videosDone / Math.max(brandStats.totalVideos, 1)) * 100)}%`}}/>
              </div>
            </div>
          </div>

          {/* Paid Out */}
          <div className="bstat-card bstat-card-green">
            <span className="bsc-icon bsc-icon-green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z" fill="currentColor" fillOpacity="0.18"/>
                <path d="M21 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/>
                <path d="M3 11h18"/>
                <rect x="14.5" y="13" width="5" height="4" rx="1.5" fill="currentColor" fillOpacity="0.35"/>
                <rect x="14.5" y="13" width="5" height="4" rx="1.5" strokeWidth="1.5"/>
                <circle cx="17" cy="15" r="0.9" fill="currentColor" stroke="none"/>
              </svg>
            </span>
            <div className="bsc-body">
              <div className="bsc-label">Paid Out</div>
              <div className="bsc-value"><CountUp value={brandStats.totalPaid} prefix="$" /></div>
              <div className="bsc-progress-wrap">
                <div className="bsc-progress-bar bsc-progress-green" style={{width: `${Math.round((brandStats.totalPaid / Math.max(brandStats.totalAmount, 1)) * 100)}%`}}/>
              </div>
            </div>
          </div>

          {/* Avg Rate Per Video */}
          <div className="bstat-card bstat-card-rose">
            <span className="bsc-icon bsc-icon-rose">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </span>
            <div className="bsc-body">
              <div className="bsc-label">Avg Rate</div>
              <div className="bsc-value"><CountUp value={brandStats.avgRate} prefix="$" /></div>
              <div className="bsc-sub">per video</div>
            </div>
          </div>
        </div>
      )}
      </>)}
      {/* ═══ END OLD CHROME ═══ */}

      {/* SQL Playground V2 (superadmin) wired below */}

      {/* System Health (superadmin) */}
      {/* ═══════════════════════════════════════════════════════════════
          WURX MEDIA · month-centric 4-tab dashboard
          Brands · Creators · Performance · Reporting
      ═══════════════════════════════════════════════════════════════ */}
      <WurxUI
        tab={tab}
        onTabChange={onTabChange}
        embedded={embedded}
        creators={creators}
        currentUser={currentUser}
        perms={perms}
        isSuper={currentUser?.role === 'superadmin'}
        onSelectCreator={setDetailCreator}
        search={search}
        onSearchChange={setSearch}
        onSaveCreator={async (data) => {
          // Read-only viewer · block create/edit
          if (currentUser?.role === 'viewer') {
            addNotification('Read-only access · cannot save changes', 'error');
            throw new Error('viewer is read-only');
          }
          // Afflix-style add/edit save · direct supabase upsert with optimistic local update
          try {
            if (data.id) {
              const { id, ...patch } = data;
              const { error } = await supabase.from('creators').update(patch).eq('id', id).select();
              if (error) throw error;
              setCreators(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
              logActivity(currentUser, 'CREATOR_UPDATE', data.name, { brand: data.brand });
            } else {
              const insertRow = { ...data };
              delete insertRow.id;
              const { data: newRow, error } = await supabase.from('creators').insert([insertRow]).select().single();
              if (error) throw error;
              setCreators(prev => [...prev, newRow]);
              logActivity(currentUser, 'CREATOR_ADD', newRow.name, { brand: newRow.brand });
              addNotification(`Onboarded ${newRow.name} for ${newRow.brand}`, 'add');
            }
          } catch (e) {
            addNotification(`Save failed: ${e.message}`, 'error');
            throw e;
          }
        }}
        onDeleteCreator={async (id) => {
          // Hard gate: creator deletion is Asad-only, regardless of role flags
          if (!isAsadUser(currentUser)) {
            addNotification('Only Asad can delete creators', 'error');
            throw new Error('not allowed');
          }
          await handleDelete(id);
        }}
        onDeleteBrand={(brandName) => { if (currentUser?.role === 'superadmin') confirmDelete('brand', null, brandName); }}
        onSetCreatorStatus={async (id, patch) => {
          // Defense-in-depth: viewer role is strictly read-only · block any
          // status mutation even if it slipped past UI gating.
          if (currentUser?.role === 'viewer') {
            addNotification('Read-only access · status cannot be changed', 'error');
            return;
          }
          /* WURX-ADDED · this gate was unreachable-by-anyone, including Asad.
             It read `currentUser?.id !== 'asad' && currentUser?.username !==
             'Asad'`. Our session carries OUR auth uuid as `id`, so the first
             half never matched; and it writes `username: 'asad'` in lower
             case against a capital 'Asad', so neither did the second. Both
             conditions were therefore always true and every attempt to mark a
             creator paid was refused — Asad's included — with a notification
             nobody could read. Now the same capability the menu is built from,
             so the two cannot disagree. */
          if (patch && patch.payment_status === 'Paid' && !can(currentUser, 'canEditPay')) {
            addNotification('You do not have permission to mark a creator paid', 'error');
            return;
          }
          // Optimistic local update first · UI updates immediately
          setCreators(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
          try {
            const { error } = await supabase.from('creators').update(patch).eq('id', id);
            if (error) throw error;
          } catch (e) { addNotification(`Status update failed: ${e.message}`, 'error'); }
        }}
        onUpdateCreator={async (id, patch) => {
          // Read-only viewer · block any creator mutation
          if (currentUser?.role === 'viewer') {
            addNotification('Read-only access · changes are disabled', 'error');
            return;
          }
          /* WURX-ADDED · second copy of the same gate, with the same defect:
             `id` is our auth uuid and `username` is lower case 'asad' against
             a capital 'Asad', so it refused everyone. Same capability as the
             menu and the status path. */
          if (patch && patch.payment_status === 'Paid' && !can(currentUser, 'canEditPay')) {
            addNotification('You do not have permission to mark a creator paid', 'error');
            return;
          }
          // HARD RULE · Hired By changes are Asad-only — this path was
          // unlogged and ungated when July's hired_by got mass-overwritten.
          const _prevC = creators.find(c => c.id === id);
          if (patch && 'hired_by' in patch && (patch.hired_by || '') !== ((_prevC && _prevC.hired_by) || '')
              && !isAsadUser(currentUser)) {
            addNotification('Hired By can only be changed by Asad', 'error');
            return;
          }
          // Forensics · sensitive fields through the generic patcher now leave a log trail
          if (patch && _prevC && ('hired_by' in patch || 'payment_status' in patch)) {
            const chg = [];
            if ('hired_by' in patch && (patch.hired_by || '') !== (_prevC.hired_by || '')) chg.push({ field: 'Hired By', from: _prevC.hired_by || '', to: patch.hired_by || '' });
            if ('payment_status' in patch && (patch.payment_status || '') !== (_prevC.payment_status || '')) chg.push({ field: 'Payment', from: _prevC.payment_status || '', to: patch.payment_status || '' });
            if (chg.length) logActivity(currentUser, 'CREATOR_UPDATE', _prevC.name, { brand: _prevC.brand, changes: chg });
          }
          // Generic creator patcher with optimistic update · used by Performance matrix cells
          setCreators(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
          try {
            const { error } = await supabase.from('creators').update(patch).eq('id', id);
            if (error) throw error;
          } catch (e) { addNotification(`Update failed: ${e.message}`, 'error'); }
        }}
        onOpenSettings={() => { if (currentUser?.role !== 'viewer') setShowSettings(true); }}
        canOpenSettings={currentUser?.role !== 'viewer'}
        onOpenLogs={() => { if (currentUser?.role !== 'viewer') setShowLogs(true); }}
        notificationsCount={notifications.length}
        onOpenNotifications={() => setShowNotifPanel(s => !s)}
        pendingApprovalsCount={pendingCount}
        onOpenPendingApprovals={() => setShowReview(true)}
        reportingNode={({ creators: filteredCreators, allCreators, dateFilter: f, activeBrands, goToMonth }) => {
          // Exclude any brand the user has parked as Inactive in Performance tab.
          // `scoped` drives the brand list + per-creator stats; `scopedAll` is the
          // unfiltered pool used by ReportingViewV2 to compute GMV/Ad/ROAS per brand
          // (matching Performance tab's brand row logic).
          const inActive = (c) => !activeBrands || activeBrands.has((c.brand || '').trim());
          const scoped    = filteredCreators.filter(inActive);
          const scopedAll = (allCreators || filteredCreators).filter(inActive);
          return (
            <ReportingViewV2
              currentUser={currentUser}
              creators={scoped}
              allCreators={scopedAll}
              activeBrand="All"
              dateFilter={f}
              onExportCsv={exportSelectedCSV ? exportUniqueCreators : null}
              onGoToMonth={goToMonth}
            />
          );
        }}
      />

      {/* Notification panel rendered via portal · triggered from WurxUI bell button */}
      {showNotifPanel && createPortal(
        <NotifPanelV2
          notifications={notifications}
          onClose={() => setShowNotifPanel(false)}
          onClearAll={() => { setNotifications([]); if (notifKey) localStorage.removeItem(notifKey); setShowNotifPanel(false); }}
          onDismissOne={(id) => setNotifications(prev => {
            const next = prev.filter(x => x.id !== id);
            if (notifKey) { try { localStorage.setItem(notifKey, JSON.stringify(next)); } catch {} }
            return next;
          })}
          getIcon={getNotifIcon}
          formatTime={formatNotifTime}
          soundsMuted={soundsMuted}
          onToggleSounds={() => setSoundsMuted(m => !m)}
        />,
        wxPortalHost()
      )}

      {/* Old view conditional · gated to never render */}
      {false && (viewMode === 'creators' ? (
        <div className="tw-pt-3 md:tw-pt-4">
          <CreatorsViewV2
            creators={sortedCreators}
            activeBrand={activeBrand}
            onCardClick={setDetailCreator}
            onTierUpgrade={(name, fromTier, toTier) => {
              const labels = { elite: 'Elite 👑', strong: 'Strong 🌟', healthy: 'Healthy ✓', poor: 'Negative' };
              addNotification(`🎉 ${name} climbed to ${labels[toTier]} tier!`, 'paid');
            }}
          />
        </div>
      ) : viewMode === 'reporting' ? (
        <div className="tw-pt-3 md:tw-pt-4">
          <ReportingViewV2
              currentUser={currentUser}
            creators={sortedCreators}
            activeBrand={activeBrand}
            dateFilter={dateFilter}
            onExportCsv={exportSelectedCSV ? exportUniqueCreators : null}
            /* so an empty angle screen can jump to the month the tests are in */
            onGoToMonth={(year, month) => setDateFilter({ mode: 'month', year, month })}
          />
        </div>
      ) : viewMode === 'stats' ? (
        <div className="tw-pt-3 md:tw-pt-4">
          <StatsViewV2 creators={sortedCreators} onSelectBrand={(b) => { setActiveBrand(b); setViewMode('table'); setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80); }} />
        </div>
      ) : viewMode === 'pivot' ? (
        <div className="tw-pt-3 md:tw-pt-4">
          <PivotTableV2 creators={sortedCreators} />
        </div>
      ) : viewMode === 'calendar' ? (
        <div className="tw-pt-3 md:tw-pt-4">
          <CalendarViewV2
            creators={creatorsForCalendar}
            onCardClick={setDetailCreator}
            onMonthFilter={(year, month) => {
              setDateFilter({ mode: 'month', year, month });
              setViewMode('table');
              setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
            }}
          />
        </div>
      ) : (
      <div className="table-outer tw-hidden md:tw-block">
        {loading ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="col-check-th" />
                  <th className="col-num-th">#</th>
                  <th className="col-name-th">Name</th>
                  <th>Username</th><th>Brand</th><th>Category</th>
                  <th>Deal</th><th>WhatsApp</th><th>Payment</th>
                  <th>Videos</th><th>Hiring Date</th><th>Hired By</th>
                  <th className="col-actions-th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...Array(8)].map((_, i) => (
                  <tr key={i} className="skeleton-row">
                    {[40,28,130,95,65,72,105,85,62,62,62,85,55].map((w, j) => (
                      <td key={j}><div className="skeleton-cell" style={{width:w+(i%3)*8,height:j===0?16:13}}/></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : filteredCreators.length === 0 ? (
          (search || filters.payment || filters.videos || filters.hiredBy || filters.category) ? (
            <div className="empty-state-wrap">
              <div className="empty-illust empty-illust-search">
                <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
                  <rect x="20" y="28" width="60" height="72" rx="12" fill="#EBF1FF" stroke="#C7D7FE" strokeWidth="2"/>
                  <rect x="32" y="44" width="36" height="4" rx="2" fill="#C7D7FE"/>
                  <rect x="32" y="54" width="28" height="4" rx="2" fill="#DBEAFE"/>
                  <rect x="32" y="64" width="32" height="4" rx="2" fill="#DBEAFE"/>
                  <rect x="32" y="74" width="20" height="4" rx="2" fill="#E0E7FF"/>
                  <circle cx="82" cy="72" r="22" fill="#F0F5FF" stroke="#0066FF" strokeWidth="2.5"/>
                  <circle cx="82" cy="72" r="12" fill="#DBEAFE" stroke="#0066FF" strokeWidth="2" strokeDasharray="4 3"/>
                  <line x1="97" y1="87" x2="108" y2="98" stroke="#0066FF" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M78 72h8M82 68v8" stroke="#0066FF" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
                </svg>
              </div>
              <div className="empty-state-title">No creators found</div>
              <div className="empty-state-sub">
                {search ? `No results for "${search}"` : 'Try adjusting your filters or date range'}
              </div>
              <button className="empty-clear-btn" onClick={() => { setSearch(''); setFilters({ payment:'', videos:'', hiredBy:'', category:'' }); }}>
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="empty-state-wrap esm-wrap">
              <div className="empty-illust empty-illust-brand">
                <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
                  <rect x="25" y="22" width="70" height="52" rx="14" fill="#F4F6FB" stroke="#EDEEF4" strokeWidth="2"/>
                  <rect x="25" y="22" width="70" height="16" rx="14" fill="#EBF1FF"/>
                  <circle cx="38" cy="30" r="3" fill="#FCA5A5"/><circle cx="48" cy="30" r="3" fill="#FCD34D"/><circle cx="58" cy="30" r="3" fill="#86EFAC"/>
                  <rect x="38" y="48" width="44" height="4" rx="2" fill="#E0E7FF"/>
                  <rect x="38" y="58" width="30" height="4" rx="2" fill="#EDEEF4"/>
                  <path d="M60 82 L48 98 h24 Z" fill="#FFFBEB" stroke="#FCD34D" strokeWidth="2" strokeLinejoin="round"/>
                  <line x1="60" y1="88" x2="60" y2="93" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
                  <circle cx="60" cy="95.5" r="1.2" fill="#F59E0B"/>
                </svg>
              </div>
              <div className="esm-title">Nothing here yet</div>
              <div className="esm-sub">This brand has zero creators.<br/>Add your first one to get started.</div>
              {perms.canAdd && (
                <button className="esm-add-btn" onClick={() => setShowSheet(true)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add first creator
                </button>
              )}
            </div>
          )
        ) : (
          <>
            {selectedIds.size > 0 && (
              <BulkBarV2
                count={selectedIds.size}
                perms={perms}
                isSuper={currentUser?.role === 'superadmin'}
                onEditStatus={() => setShowBulkStatusModal(true)}
                onExportVideos={exportVideoCodesCSV}
                onExportCsv={exportSelectedCSV}
                onCopyUsernames={copyUsernamesToClipboard}
                onDelete={bulkDeleteSelected}
                onClear={() => setSelectedIds(new Set())}
              />
            )}
          <div className="table-scroll" ref={tableScrollRef}>
            <table>
              <thead>
                <tr>
                  <th className="col-check-th">
                    <input type="checkbox" className="bulk-checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected; }}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="col-num-th">#</th>
                  <th className="col-name-th">Name</th>
                  {colOrder
                    .map(k => MOVABLE_COLS.find(c => c.key === k))
                    .filter(Boolean)
                    .filter(c => !c.gated || perms[c.gated])
                    .map(c => (
                      <ResizableHeader
                        key={c.key}
                        colKey={c.key}
                        label={c.label}
                        sortable={c.sortable}
                        sortDir={c.key === 'hiring_date' ? sortDateDir : null}
                        onSortClick={c.key === 'hiring_date' ? () => setSortDateDir(d => d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc') : null}
                        width={colWidths[c.key]}
                        onResize={(w) => handleColResize(c.key, w)}
                        onDragStart={setColDragKey}
                        onDragOver={setColOverKey}
                        onDrop={handleColDrop}
                        isDragOver={colOverKey === c.key && colDragKey !== c.key}
                        isDragging={colDragKey === c.key}
                        align={colAligns[c.key]}
                        isSelected={selectedColKey === c.key}
                        onSelect={(k) => setSelectedColKey(prev => prev === k ? null : k)}
                      />
                    ))}
                  <th className="col-actions-th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleCreators.map((creator, idx) => (
                  <tr
                    key={creator.id}
                    className={[
                      selectedIds.has(creator.id) ? 'row-selected' : '',
                      `row-status-${getRowStatus(creator)}`,
                      `density-${tableDensity}`,
                      'tr-clickable',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setDetailCreator(creator)}
                  >
                    {/* Checkbox */}
                    <td className="col-check-td" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="bulk-checkbox"
                        checked={selectedIds.has(creator.id)}
                        onChange={() => toggleSelect(creator.id)}
                      />
                    </td>
                    {/* Row number */}
                    <td className="col-num-td">{idx + 1}</td>

                    {/* Name */}
                    <td className={`col-name-td${currentUser?.role === 'superadmin' ? ' cell-editable' : ''}`}
                      onClick={e => { if (currentUser?.role === 'superadmin') { e.stopPropagation(); setInlineEdit({ id: creator.id, field: 'name', value: creator.name }); } }}>
                      {inlineEdit?.id === creator.id && inlineEdit?.field === 'name'
                        ? <input autoFocus className="cell-inline-input" defaultValue={creator.name || ''}
                            onBlur={e => saveInline(creator.id, 'name', e.target.value.trim())}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setInlineEdit(null); }}
                            onClick={e => e.stopPropagation()} />
                        : <>
                            {retentionMap[(creator.name || '').trim().toLowerCase()] >= 4 && (
                              <span className="retainer-badge" title="Retainer (4+ deals)">R</span>
                            )}
                            {creator.name || <span className="text-muted"></span>}
                            {(() => {
                              const n = Array.isArray(creator.video_codes) ? creator.video_codes.filter(v => v?.video || v?.adCode).length : 0;
                              return n > 0 ? <span className="vc-badge" title={`${n} video code${n > 1 ? 's' : ''} added`}>▶ {n}</span> : null;
                            })()}
                          </>
                      }
                    </td>

                    {/* Movable columns · order + width + align per user prefs */}
                    {colOrder
                      .map(k => MOVABLE_COLS.find(c => c.key === k))
                      .filter(Boolean)
                      .filter(c => !c.gated || perms[c.gated])
                      .map(c => {
                        const w = colWidths[c.key];
                        const align = colAligns[c.key] || 'left';
                        const wStyle = { width: w, minWidth: w, maxWidth: w, textAlign: align };
                        if (c.key === 'hiring_date') {
                          return <td key={c.key} style={wStyle}>{formatDate(creator.hiring_date) || <span className="text-muted"></span>}</td>;
                        }
                        return <CellSized key={c.key} style={wStyle}>{renderCell(creator, c.key)}</CellSized>;
                      })}

                    {/* Actions */}
                    <td className="col-actions-td" onClick={e => e.stopPropagation()}>
                      <div className="row-actions tw-flex tw-items-center tw-gap-1 tw-justify-end">
                        <RowActionBtn label="View" tone="blue" onClick={e => { e.stopPropagation(); setDetailCreator(creator); }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </RowActionBtn>
                        {perms.canEdit && (
                          <RowActionBtn label="Edit" tone="violet" onClick={e => { e.stopPropagation(); setEditCreator(creator); setShowSheet(true); }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </RowActionBtn>
                        )}
                        {perms.canDelete && (
                          <RowActionBtn label="Delete" tone="rose" onClick={e => { e.stopPropagation(); confirmDelete('creator', creator.id, creator.name); }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
                          </RowActionBtn>
                        )}
                        {perms.deleteBlocked && !perms.canDelete && (
                          <RowActionBtn label="Delete" tone="rose" onClick={e => { e.stopPropagation(); setShowDeleteBlocked(true); }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
                          </RowActionBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && (
              <div className="load-more-row">
                <button className="load-more-btn" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, sortedCreators.length - visibleCount)} more
                  <span className="load-more-total">({visibleCount} of {sortedCreators.length})</span>
                </button>
              </div>
            )}
          </div>
          </>
        )}
      </div>
      ))}

      {/* Inline dropdown */}
      {inlineDrop && (
        <InlineDropdown
          options={inlineDrop.options}
          position={inlineDrop.position}
          onSelect={val => saveInline(inlineDrop.id, inlineDrop.field, val)}
          onClose={() => setInlineDrop(null)}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              icon: '✏',
              label: 'Rename',
              onClick: () => {
                const newName = window.prompt('Rename brand:', contextMenu.brand);
                if (newName) renameBrand(contextMenu.brand, newName);
              },
            },
            {
              icon: '⧉',
              label: 'Duplicate',
              onClick: () => duplicateBrand(contextMenu.brand),
            },
            {
              icon: '🙈',
              label: 'Hide',
              onClick: () => hideBrand(contextMenu.brand),
            },
            {
              icon: '🗑',
              label: 'Delete Brand',
              danger: true,
              onClick: () => confirmDelete('brand', null, contextMenu.brand),
            },
          ]}
        />
      )}

      {/* Mobile search drawer V2 */}
      {showMobileSearch && (
        <MobileSearchDrawerV2
          creators={creators}
          allBrands={allBrands}
          onClose={() => setShowMobileSearch(false)}
          onSelect={(value) => {
            setSearch(value);
            // Scroll to top so results are visible immediately
            setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
          }}
        />
      )}

      {/* Detail modal */}
      {detailCreator && (
        <DetailModalV2
          creator={detailCreator}
          onClose={() => setDetailCreator(null)}
          onEdit={() => {
            setEditCreator(detailCreator);
            setDetailCreator(null);
            setShowSheet(true);
          }}
          onDelete={() => {
            if (perms.deleteBlocked) { setShowDeleteBlocked(true); return; }
            if (!perms.canDelete) return;
            confirmDelete('creator', detailCreator.id, detailCreator.name);
          }}
          onUpdate={(id, patch) => {
            setCreators(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
            setDetailCreator(prev => prev ? { ...prev, ...patch } : prev);
          }}
          perms={perms}
        />
      )}

      {/* Add/Edit sheet · V2 Tailwind */}
      {showSheet && (
        <BottomSheetV2
          editCreator={editCreator}
          allBrands={allBrands}
          hiredByTeam={perms.canSeeHiredBy ? hiredByTeam : []}
          canSetDeadline={perms.canSetDeadline}
          onSave={handleSave}
          onClose={() => { setShowSheet(false); setEditCreator(null); }}
        />
      )}

      {/* Activity Logs */}
      {showLogs && <ActivityLogsPanel onClose={() => setShowLogs(false)} />}

      {/* Settings */}
      {showSettings && currentUser?.role !== 'viewer' && (
        <SettingsPanelV2
          onClose={() => setShowSettings(false)}
          hiredByTeam={hiredByTeam}
          setHiredByTeam={setHiredByTeam}
          currentUser={currentUser}
          onOpenLogs={() => { setShowSettings(false); setShowLogs(true); }}
          onOpenUserMgmt={() => { setShowSettings(false); setShowUserMgmt(true); }}
          onOpenLeaderboard={() => { setShowSettings(false); setShowLeaderboard(true); }}
          canCompare={allBrands.length >= 2}
          onCompare={() => setShowCompare(true)}
          onOpenSql={can(currentUser, 'canSqlQuest') ? (() => { setShowSettings(false); setShowSqlPlayground(true); }) : null}
          onOpenGod={() => { setShowSettings(false); setShowGod(true); }}
          onOpenAccess={() => { setShowSettings(false); setShowAccess(true); }}
        />
      )}

      {/* Access control · who is allowed to reach what */}
      {showAccess && can(currentUser, 'canGrantAccess') && (
        <AccessControl currentUser={currentUser} onClose={() => setShowAccess(false)} />
      )}

      {showGod && can(currentUser, 'canGodMode') && (
        <GodMode
          creators={creators}
          allBrands={allBrands}
          currentUser={currentUser}
          onRefresh={fetchCreators}
          onClose={() => setShowGod(false)}
        />
      )}

      {showSqlPlayground && can(currentUser, 'canSqlQuest') && (
        <SqlQuest onClose={() => setShowSqlPlayground(false)} />
      )}

      {/* Delete confirm modal */}
      {deleteModal && (
        <DeleteConfirmModal
          type={deleteModal.type}
          name={deleteModal.name}
          count={deleteModal.count}
          pending={deleteModal.pending}
          hidden={deleteModal.hidden}
          onCancel={() => setDeleteModal(null)}
          onConfirm={() => {
            if (deleteModal.type === 'creator') handleDelete(deleteModal.id);
            else if (deleteModal.type === 'bulk') { confirmBulkDelete(deleteModal.ids); setDeleteModal(null); }
            else deleteBrand(deleteModal.name);
          }}
        />
      )}

      {/* Seasonal decoration corner badge */}
      {season && (
        <div className={`season-badge season-${season.id}`} title={season.label}>
          <span className="season-emoji">{season.emoji}</span>
          <span className="season-label">{season.label}</span>
        </div>
      )}

      {/* Daily greeting banner */}
      {greeting && currentUser && (
        <div className="greet-banner" onClick={() => setGreeting(null)}>
          <div className="greet-wave">👋</div>
          <div className="greet-msg">
            <span className="greet-sub">Hey {currentUser.display}</span>
            <span className="greet-main">{greeting}</span>
          </div>
          <button className="greet-x" onClick={(e) => { e.stopPropagation(); setGreeting(null); }} aria-label="Dismiss">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}

      {/* Toast stack V2 · Tailwind iOS-style top-right */}
      {toastStack.length > 0 && (
        <ToastStackV2 stack={toastStack} onDismiss={dismissToast} getIcon={getNotifIcon} />
      )}

      {/* Confetti burst */}
      {showConfetti && (
        <div className="confetti-wrap" aria-hidden="true">
          {confettiPieces.current.map((p, i) => (
            <div
              key={i}
              className="confetti-piece"
              style={{ '--delay': p.delay, '--x': p.x, '--rot': p.rot, '--color': p.color }}
            />
          ))}
        </div>
      )}

      {/* Undo toast */}
      {undoToast && (
        <UndoToast
          message={undoToast.message}
          timeLeft={undoToast.timeLeft}
          onUndo={handleUndo}
          onDismiss={() => {
            if (undoTimerRef.current) { clearInterval(undoTimerRef.current); undoTimerRef.current = null; }
            undoDataRef.current = null;
            setUndoToast(null);
          }}
        />
      )}

      {/* User Management Modal */}
      {showUserMgmt && (
        <UserManagementModalV2
          onClose={() => setShowUserMgmt(false)}
          currentUser={currentUser}
          onlineUsers={onlineUsers}
          allBrands={allBrands}
        />
      )}

      {/* Bulk status edit modal */}
      {showBulkStatusModal && (
        <BulkStatusModal
          count={selectedIds.size}
          onSave={handleBulkStatusEdit}
          onClose={() => setShowBulkStatusModal(false)}
        />
      )}

      {/* No video data modal */}
      {showNoVideoModal && (
        <div className="modal-overlay" style={{ zIndex: 900 }} onClick={() => setShowNoVideoModal(false)}>
          <div className="dcm-modal">
            <div className="dcm-emoji">😶‍🌫️</div>
            <h2 className="dcm-title">Bro... nothing here 😭</h2>
            <p className="dcm-body">
              None of the selected creators have<br />any video links or ad codes yet.<br />
              <strong>Add some first, then download!</strong> 🎬
            </p>
            <p className="dcm-hint">Can't export what doesn't exist, unfortunately.</p>
            <div className="dcm-actions">
              <button className="dcm-confirm" onClick={() => setShowNoVideoModal(false)}>Ok my bad 💀</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete blocked modal (Admin role) */}
      {showDeleteBlocked && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setShowDeleteBlocked(false)}>
          <div className="dcm-modal">
            <div className="dcm-emoji">🚫</div>
            <h2 className="dcm-title">Nice try though 😂</h2>
            <p className="dcm-body">
              You don't have delete access, boss.<br />
              Come back later... or just never. 💀
            </p>
            <p className="dcm-hint">Hit up Asad if you really need this deleted 👀</p>
            <div className="dcm-actions">
              <button className="dcm-confirm" onClick={() => setShowDeleteBlocked(false)}>Fine, I get it 😤</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom nav V2 · Tailwind floating capsule */}
      <MobileBottomNavV2
        perms={perms}
        hasCompare={allBrands.length >= 2}
        bulkMode={selectedIds.size > 0}
        bulkCount={selectedIds.size}
        onHome={scrollToTop}
        onSearch={() => setShowMobileSearch(true)}
        onCompare={() => setShowCompare(true)}
        onSettings={() => setShowMobileMenu(true)}
        onAdd={() => { setEditCreator(null); setShowSheet(true); }}
        onMarkPaid={() => {
          if (!isAsadUser(currentUser)) {
            addNotification('Payment Sent can only be set by Asad', 'error');
            return;
          }
          const ids = [...selectedIds];
          setCreators(prev => prev.map(c => ids.includes(c.id) ? {...c, payment_status: 'Paid'} : c));
          supabase.from('creators').update({payment_status: 'Paid'}).in('id', ids);
          ids.forEach(id => {
            const c = creators.find(cr => cr.id === id);
            if (c) logActivity(currentUser, 'CREATOR_UPDATE', c.name, { changes: [{ field: 'Payment', from: c.payment_status || '', to: 'Paid' }] });
          });
          setSelectedIds(new Set());
          addNotification(`${ids.length} marked Paid`, 'paid');
          playSound('paid');
        }}
        onBulkStatus={() => setShowBulkStatusModal(true)}
        onClearSelection={() => setSelectedIds(new Set())}
      />

      {/* Footer - hover to reveal */}
      <div className="app-footer">
        <div className="footer-pill">
          <div className="footer-pill-dot" />
          <span className="footer-pill-name">Muhammad Asad Aman</span>
        </div>
      </div>
      <div className="footer-hover-zone" />

      {/* Back-to-top pill */}
      {showScrollTop && (
        <button className="scroll-fab" onClick={scrollToTop} title="Back to top" aria-label="Scroll to top">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
          <span className="scroll-fab-lbl">Back to top</span>
        </button>
      )}

      {/* Live cursors overlay */}
      {Object.entries(remoteCursors).map(([uid, cur]) => (
        <div key={uid} className="live-cursor" style={{ left: `${cur.x}vw`, top: `${cur.y}vh` }}>
          <svg className="live-cursor-svg" width="18" height="22" viewBox="0 0 18 22" fill="none">
            <path d="M2 2L16 9.5L9.5 11L7 18L2 2Z" fill={getCursorColor(cur.display)} stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
          </svg>
          <span className="live-cursor-label" style={{ background: getCursorColor(cur.display) }}>{cur.display}</span>
        </div>
      ))}

      {/* Brand Compare Modal */}
      {showCompare && (
        <BrandCompareModalV2
          creators={creators}
          allBrands={allBrands}
          onClose={() => setShowCompare(false)}
        />
      )}

      {/* Devices & Sessions section removed */}

      {showLeaderboard && (
        <LeaderboardModalV2
          creators={creators}
          hiredByTeam={hiredByTeam}
          onClose={() => setShowLeaderboard(false)}
        />
      )}

      {showReview && currentUser?.role === 'superadmin' && (
        <ReviewQueueModalV2
          onClose={() => setShowReview(false)}
          onAfterAction={() => { fetchPendingCount(); fetchCreators(); }}
        />
      )}

    </div>
  );
}
