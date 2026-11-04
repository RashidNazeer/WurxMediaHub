/* ════════════════════════════════════════════════════════════════
   God Mode · the settings themselves
   Kept in their own module so the formatters in WurxUI and App can read
   them WITHOUT importing the panel (which would drag the whole UI into
   every bundle that only needs to format a number).

   A live cache is held here rather than reading localStorage on every
   call: fmt$ runs thousands of times per render, and JSON.parse in that
   path is exactly the kind of thing that makes a table feel slow.
   ════════════════════════════════════════════════════════════════ */

export const KEY = 'wurx_godmode_v1';

export const GOD_DEFAULTS = {
  /* look */
  accent: '#1259C3',
  surface: 'neutral',      // neutral | warm | cool | paper
  cardStyle: 'elevated',   // elevated | flat | outlined
  density: 'cozy',         // comfy | cozy | compact
  radius: 'round',         // sharp | soft | round | pill
  fontScale: 100,          // 90 - 115
  avatar: 'circle',        // circle | squircle | square
  tableLines: 'grid',      // grid | rows | clean
  motion: 'full',          // full | reduced

  /* format */
  numbers: 'full',         // full | compact
  cents: false,            // show decimals on money
  currency: '$',
  dateStyle: 'short',      // short (Aug 20 '26) | long (20 Aug 2026) | iso

  /* navigation */
  tabs: null,              // order of ids, null = built in
  hidden: [],              // tab ids switched off
  labels: {},              // id -> custom label
  home: 'brands',

  /* creators table */
  cols: null,              // order of column ids, null = built in
  colsOff: [],             // hidden column ids

  /* rules that the app actually reads */
  staleMonths: 2,          // brand drops to Inactive after this many quiet months
  discoverySize: 40,       // rows shown per page in Discovery
  leaderTop: 10,           // default Top N on the Leaderboard tab
};

let cache = null;

export function godGet() {
  if (cache) return cache;
  try { cache = { ...GOD_DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch (e) { cache = { ...GOD_DEFAULTS }; }
  return cache;
}
export function godSet(next) {
  cache = { ...GOD_DEFAULTS, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) {}
  applyGod(cache);
  /* the tables and the nav live in other component trees · tell them */
  window.dispatchEvent(new Event('wurx-god-changed'));
  return cache;
}
export function godReset() { return godSet({ ...GOD_DEFAULTS }); }

/* ── the columns of the Creators table ──
   Order and width live here so the header, the rows and the God Mode
   picker can never fall out of step with each other. */
/* WURX-ADJUSTED · 2026-11-04: with Brand GMV added the table was too narrow for a
   phone number or a long handle at 1745px ("+1(412) 583-91…"), while Name had
   room to spare. Name gives up width to Contact and TikTok. WURX-END */
export const CREATOR_COLS = [
  { id: 'num',       label: '#',         w: '46px'   },
  { id: 'name',      label: 'Name',      w: '1.12fr' },
  { id: 'contact',   label: 'Contact',   w: '1.02fr' },
  { id: 'tiktok',    label: 'TikTok',    w: '1.06fr' },
  /* WURX-ADDED · Rashid, 2026-09-18: "can we add a new column of followers as
     well i hope we can get followers count for our creators". EUKA already
     carries it per handle — the brand page prints it under the handle — so this
     column is the same figure, in the list where people are compared.
     A person who has saved a column order will find it appended at the end
     (visibleCols keeps unknown columns rather than dropping them), and can move
     it in the column settings like any other. */
  { id: 'followers', label: 'Followers', w: '0.62fr' },
  { id: 'category',  label: 'Category',  w: '0.7fr'  },
  { id: 'brand',     label: 'Brand',     w: '0.8fr'  },
  { id: 'onboarded', label: 'Onboarded', w: '0.8fr'  },
  { id: 'deal',      label: 'Deal',      w: '0.78fr' },
  { id: 'rate',      label: 'Rate/Vid',  w: '0.54fr' },
  { id: 'l30',       label: 'L30 GMV',   w: '0.7fr'  },
  /* WURX-ADDED · what THIS creator sold for THIS brand inside the chosen dates:
     their posted videos' GMV, not Euka's last-30-days figure for the account.
     Rashid, 2026-11-04. WURX-END */
  { id: 'brandgmv',  label: 'Brand GMV', w: '0.7fr'  },
  { id: 'status',    label: 'Status',    w: '0.96fr' },
  { id: 'hiredby',   label: 'Hired By',  w: '0.68fr' },
];
/* data-label on each cell in the row markup, mapped to a column id */
export const COL_BY_LABEL = {
  '#': 'num', 'Name': 'name', 'Contact': 'contact', 'TikTok': 'tiktok',
  'Followers': 'followers',
  'Category': 'category', 'Brand': 'brand', 'Onboarded': 'onboarded',
  'Deal': 'deal', 'Rate/Vid': 'rate', 'L30 GMV': 'l30', 'Brand GMV': 'brandgmv',
  'Status': 'status', 'Hired By': 'hiredby',
};

/* The visible columns in the chosen order. A column added to the app
   after these settings were saved still appears, so shipping a new
   column never needs a matching settings migration. */
export function visibleCols(g) {
  const s = g || godGet();
  const wanted = Array.isArray(s.cols) && s.cols.length ? s.cols : CREATOR_COLS.map(c => c.id);
  const ordered = [
    ...wanted.map(id => CREATOR_COLS.find(c => c.id === id)).filter(Boolean),
    ...CREATOR_COLS.filter(c => !wanted.includes(c.id)),
  ];
  const out = ordered.filter(c => !(s.colsOff || []).includes(c.id));
  return out.length ? out : CREATOR_COLS;
}
export function colTemplate(g) {
  return '34px ' + visibleCols(g).map(c => c.w).join(' ');
}
/* Cells stay in their hardcoded JSX order · CSS `order` moves them and
   `display:none` drops them, so reordering a column never means
   rewriting the row markup. */
export function colStyle(label, g) {
  const s = g || godGet();
  const id = COL_BY_LABEL[label];
  if (!id) return undefined;
  const vis = visibleCols(s);
  const i = vis.findIndex(c => c.id === id);
  return i < 0 ? { display: 'none' } : { order: i + 1 };
}

/* ── formatting the app reads everywhere ── */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function godMoney(n, opts) {
  const g = godGet();
  const v = Number(n) || 0;
  const sym = g.currency || '$';
  const forceFull = opts && opts.full;
  if (g.numbers === 'compact' && !forceFull && Math.abs(v) >= 1000) {
    const k = Math.abs(v) >= 1000000 ? [v / 1000000, 'M'] : [v / 1000, 'k'];
    return sym + k[0].toFixed(Math.abs(k[0]) >= 100 ? 0 : 1).replace(/\.0$/, '') + k[1];
  }
  const dec = g.cents ? 2 : 0;
  return sym + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/* Returns the pieces so a caller can style the year quietly if it wants,
   which is what the Onboarded column does. */
export function godDateParts(d) {
  const g = godGet();
  const p = String(d || '').split('-');
  if (p.length < 3) return null;
  const y = p[0], m = parseInt(p[1], 10), day = parseInt(p[2], 10);
  const mon = MON[m - 1] || p[1];
  if (g.dateStyle === 'iso') return { main: `${y}-${p[1]}-${String(day).padStart(2, '0')}`, year: '' };
  if (g.dateStyle === 'long') return { main: `${day} ${mon}`, year: ' ' + y };
  return { main: `${mon} ${day}`, year: '’' + String(y).slice(2) };
}
export function godDate(d) {
  const p = godDateParts(d);
  return p ? p.main + p.year : '-';
}

/* ── appearance · every control here is a real CSS variable ── */
const DENSITY = { comfy: 1.12, cozy: 1, compact: 0.88 };
const RADIUS = {
  sharp: ['10px', '8px', '6px'],
  soft: ['16px', '12px', '9px'],
  round: ['24px', '16px', '12px'],
  pill: ['32px', '22px', '16px'],
};
const SURFACE = {
  neutral: { bg: '#FAFAFA', card: '#FFFFFF', card2: '#F5F5F7', div: '#ECECEC' },
  warm:    { bg: '#FAF8F4', card: '#FFFFFF', card2: '#F5F2EC', div: '#ECE7DE' },
  cool:    { bg: '#F7F9FB', card: '#FFFFFF', card2: '#EFF3F7', div: '#E4EAF0' },
  paper:   { bg: '#F4F1EA', card: '#FFFDF8', card2: '#EEE9DE', div: '#E2DCCE' },
};
const AVATAR = { circle: '999px', squircle: '32%', square: '8px' };

export function tint(hex, amt) {
  const h = String(hex).replace('#', '');
  if (h.length !== 6) return '#E8F0FA';
  const n = parseInt(h, 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return '#' + c.map(v => Math.round(v + (255 - v) * amt).toString(16).padStart(2, '0')).join('');
}

export function applyGod(s) {
  const g = { ...GOD_DEFAULTS, ...(s || godGet()) };
  const root = document.documentElement;
  const [r1, r2, r3] = RADIUS[g.radius] || RADIUS.round;
  const sf = SURFACE[g.surface] || SURFACE.neutral;

  root.style.setProperty('--pc-accent', g.accent);
  root.style.setProperty('--pc-accent-light', tint(g.accent, 0.88));
  root.style.setProperty('--pc-radius', r1);
  root.style.setProperty('--pc-radius-sm', r2);
  root.style.setProperty('--pc-radius-xs', r3);
  root.style.setProperty('--pc-bg', sf.bg);
  root.style.setProperty('--pc-card', sf.card);
  root.style.setProperty('--pc-card-2', sf.card2);
  root.style.setProperty('--pc-divider', sf.div);
  root.style.setProperty('--god-font', (g.fontScale / 100).toFixed(3));
  root.style.setProperty('--god-density', String(DENSITY[g.density] || 1));
  root.style.setProperty('--god-avatar', AVATAR[g.avatar] || '999px');

  root.dataset.godMotion = g.motion;
  root.dataset.godDensity = g.density;
  root.dataset.godCard = g.cardStyle;
  root.dataset.godLines = g.tableLines;
}
