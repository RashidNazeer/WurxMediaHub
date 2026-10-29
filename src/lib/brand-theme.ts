/**
 * A brand's colours in, a readable accent and hero out, in both themes.
 *
 * SCOPE CHANGED ON 2026-10-09. This module used to derive a whole palette (page,
 * cards, menu rail, every text colour) that a Brand Hub rebound over the PRISM
 * tokens, so a hub was a separate-looking "world". A hub is now an ordinary PRISM
 * screen inside the shell, wearing the brand's ACCENT and hero (see
 * `paletteToAccentVars`). The full palette is still DERIVED and AUDITED here,
 * because the derivation is the one source for the accent and hero, but the page,
 * surface, text, border and rail fields are no longer rendered. See the note on
 * `paletteToAccentVars` for what that does to the audit.
 * WHY THIS EXISTS AT ALL. Every other colour in this product lives in
 * `src/styles/tokens.css`, and `pnpm check:contrast` fails the build if dark
 * and light drift apart or if any pair drops below WCAG AA. A Brand Hub's
 * colours do NOT live there: they come out of the database, chosen by an admin
 * in a colour picker. The build guard cannot see them. Nothing would fail.
 *
 * So the guarantee has to move into the code that USES those colours:
 *
 *   THE ADMIN PICKS FILLS. THE PRODUCT PICKS INKS.
 *
 * Nothing an admin can touch is a text colour. Every one of them is computed
 * here, by MEASURING contrast against every fill it will ever cross, including
 * all four stops of a gradient. A pale yellow brand and a near-black one both
 * come out readable, because the foreground is chosen last, against whatever
 * the background turned out to be.
 *
 * WHY OKLCH AND NOT HSL. HSL's lightness is a lie: `hsl(60 100% 50%)` (yellow)
 * and `hsl(240 100% 50%)` (blue) claim the same lightness and are wildly
 * different to the eye. Building a ramp in HSL gives a set of steps that look
 * even for a blue brand and collapse for a yellow one. OKLab is perceptually
 * uniform, so one ramp works for every hue, which is the whole point when the
 * hue is somebody else's decision.
 *
 * WHY IT IS ALL ONE FILE. `scripts/build/check-brand-theme.mjs` transpiles this
 * module with raw `tsc` and imports the result from plain Node. The moment it
 * imports a sibling, the emitted specifier has no `.js` on it and Node refuses
 * to resolve it, and the guard that protects every brand's readability stops
 * running inside the build. Splitting this file is a two line change that
 * silently disarms the alarm, so it stays whole.
 *
 * Rashid, on what a hub should feel like. On 2026-08-24 he asked for "a new
 * world" that is the brand's, not Wurx's. On 2026-10-09 he reversed that: the
 * hub "has a completely different design language ... it loads like a completely
 * separate app ... it is a part of the app". So the brand now tints the product
 * rather than replacing it. This is still the machinery under that. He picks the
 * colours; the readability is not his problem.
 */

/* ------------------------------------------------------------- colour maths -- */

type RGB = { r: number; g: number; b: number };
type OKLCH = { l: number; c: number; h: number };

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function hexToRgb(hex: string): RGB | null {
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

const toHex2 = (n: number) =>
  Math.round(clamp01(n) * 255)
    .toString(16)
    .padStart(2, '0');

const rgbToHex = ({ r, g, b }: RGB) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

/* sRGB transfer function, both directions. */
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function rgbToOklch({ r, g, b }: RGB): OKLCH {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

function oklchToRgb({ l, c, h }: OKLCH): RGB {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);

  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;

  return {
    r: clamp01(toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_)),
    g: clamp01(toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_)),
    b: clamp01(toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_)),
  };
}

/*
 * CLAMPING TO SOMETHING THE SCREEN CAN ACTUALLY SHOW.
 *
 * Most (l, c, h) triples are outside sRGB, and `oklchToRgb` clamps each channel
 * on its own, which shifts the hue: a vivid green asked for at high lightness
 * comes back yellowed. Binary-searching the chroma instead keeps the hue and
 * the lightness and gives up only saturation, which is the one of the three
 * nobody notices losing.
 */
function inGamut({ l, c, h }: OKLCH): boolean {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const b = toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
  const ok = (v: number) => v >= -0.0001 && v <= 1.0001;
  return ok(r) && ok(g) && ok(b);
}

function oklchToHex(want: OKLCH): string {
  if (inGamut(want)) return rgbToHex(oklchToRgb(want));
  let lo = 0;
  let hi = want.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ ...want, c: mid })) lo = mid;
    else hi = mid;
  }
  return rgbToHex(oklchToRgb({ ...want, c: lo }));
}

/* ------------------------------------------------------------------ contrast -- */

/** WCAG relative luminance. */
function luminance({ r, g, b }: RGB): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(aHex: string, bHex: string): number {
  const a = hexToRgb(aHex);
  const b = hexToRgb(bHex);
  if (!a || !b) return 0;
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A readable foreground FOR a background, in the brand's own hue.
 *
 * Walks the brand hue away from the background's lightness until it clears the
 * ratio, so labels still feel like the brand rather than defaulting to grey.
 * If the hue genuinely cannot make it, it falls back to near-black or
 * near-white, because READABLE BEATS ON-BRAND, every time. Nobody has ever
 * praised a tint they could not read.
 */
function readableOn(
  bgs: string | string[],
  hue: number,
  chroma: number,
  ratio: number
): string {
  /*
   * AGAINST EVERY BACKGROUND IT WILL EVER SIT ON, not just the first one.
   *
   * The first version of this took a single background, and the guard caught it
   * immediately on all 88 test colours. Body text was derived against the page
   * and then printed on a card, which is lighter; hero text was derived against
   * the dark end of the gradient and shown over the light end. Each looked fine
   * where it was measured and failed a few pixels away. A foreground has to
   * clear the WORST background it is used on, so they all come in together.
   *
   * Multi-colour themes made this load-bearing rather than defensive: a four
   * stop hero has two fills in the MIDDLE that no named pair mentions, and the
   * middle of a gradient is exactly where a heading quietly stops being read.
   */
  const list = typeof bgs === 'string' ? [bgs] : bgs;
  const worstOf = (fg: string) => Math.min(...list.map((bg) => contrast(fg, bg)));

  // Which way to walk: away from the lightest background it must survive.
  const lightest = Math.max(...list.map((bg) => rgbToOklch(hexToRgb(bg)!).l));
  const goDark = lightest > 0.5;

  for (let step = 0; step <= 24; step++) {
    const l = goDark ? 0.52 - step * 0.022 : 0.48 + step * 0.022;
    if (l < 0 || l > 1) break;
    const candidate = oklchToHex({ l, c: chroma, h: hue });
    if (worstOf(candidate) >= ratio) return candidate;
  }
  /* READABLE BEATS ON-BRAND. Drop the hue rather than the legibility. */
  for (const plain of goDark ? ['#0a0a0a', '#000000'] : ['#ffffff', '#fbfbfb']) {
    if (worstOf(plain) >= ratio) return plain;
  }
  return goDark ? '#000000' : '#ffffff';
}

/* -------------------------------------------------- what an admin chose -- */

/**
 * A brand's look, BEYOND the one colour.
 *
 * Rashid, 2026-08-25: *"we currently let admin choose only one color but I need
 * full customization here ... admin can decide a particular area such as hero
 * section menu items all pages in menu section each with 3 to 4 colors (then we
 * will derive gradient fror that) ... some brands have multo color themes"*.
 *
 * He is right, and the original one-colour design was solving the wrong half of
 * the problem. A brand is rarely one colour: it is a red AND a navy AND a gold,
 * and a hub built from only the red is not that brand's hub. What the single
 * colour was really protecting was READABILITY, not simplicity.
 *
 * So the protection moved into the two rules at the top of this file, and the
 * freedom arrives here. The second rule is the one that makes this real
 * customisation rather than a suggestion box:
 *
 *   A PICKED COLOUR KEEPS ITS HUE AND ITS SATURATION. Only its BRIGHTNESS is
 *   held inside the band its area can support, and only when it falls outside
 *   that band. A colour already in range is used byte for byte.
 *
 * An admin's hues therefore survive exactly, which is what anybody means when
 * they say "our brand colours", while the thing that decides whether text can
 * be read stays ours.
 */

/** The four things an admin can colour independently. */
export type BrandAreaKey = 'hero' | 'rail' | 'page' | 'accent';

/**
 * Whether an area is a deep surface with light text, or a pale one with dark.
 *
 * `auto` is what every hub was before this existed: a dark hero and a dark
 * rail, in both modes. `light` is the escape hatch for the cream-and-charcoal
 * brands, and it changes only the BAND. The ink still follows by measurement,
 * so choosing it cannot make anything unreadable.
 */
export type BrandTone = 'auto' | 'light';

export type BrandArea = {
  /** One to four colours. Two or more become a gradient. */
  stops: string[];
  /** Hero only. Degrees, CSS convention, so 115 runs left to right. */
  angle?: number;
  /** Hero and rail only. */
  tone?: BrandTone;
};

export type BrandThemeConfig = {
  /** Bumped only if the shape changes, so an old row can be read rather than guessed at. */
  v: 1;
  hero?: BrandArea;
  rail?: BrandArea;
  page?: BrandArea;
  accent?: BrandArea;
};

export const AREA_KEYS = ['hero', 'rail', 'page', 'accent'] as const;

/**
 * The areas an admin can still actually change.
 *
 * `rail` and `page` are RETIRED. A brand hub now renders inside the PRISM shell
 * and only supplies an accent, a logo and a hero, so nothing reads a brand's
 * menu or page colours any more. Leaving them in the editor would be a control
 * that lies: you pick a colour, you save it, and the product ignores it.
 *
 * They stay in `AREA_KEYS` and in the Zod schema on purpose, because brands
 * saved before the change still have those values stored and must keep
 * validating. They are simply never offered and never read.
 */
export const EDITABLE_AREA_KEYS = ['hero', 'accent'] as const;

/**
 * How each area is described to an admin, and what it is allowed to carry.
 * The `rail` and `page` entries are retired (see `EDITABLE_AREA_KEYS`): they are
 * kept so stored themes still read, and are never shown to an admin.
 */
export const AREA_META: Record<
  BrandAreaKey,
  { label: string; hint: string; max: number; tone: boolean; angle: boolean }
> = {
  hero: {
    label: 'Hero banner',
    hint: 'The big panel at the top of the brand. Two or more colours blend across it.',
    max: 4,
    tone: true,
    angle: true,
  },
  rail: {
    label: 'Menu',
    hint: 'The navigation down the left, and the drawer on a phone.',
    max: 3,
    tone: true,
    angle: false,
  },
  page: {
    label: 'Pages and cards',
    hint: 'Behind every section. Held very pale in light mode and very deep in dark, because people read on top of it. A second colour tints the cards.',
    max: 3,
    tone: false,
    angle: false,
  },
  accent: {
    label: 'Buttons and highlights',
    hint: 'Every button, link and figure a creator is meant to notice.',
    max: 3,
    tone: false,
    angle: false,
  },
};

/** The hero gradient's angle when nobody has chosen one. */
export const DEFAULT_ANGLE = 115;

type Mode = 'light' | 'dark';

/**
 * The brightness and saturation an area can support, per mode.
 *
 * THIS TABLE IS THE SAFETY, so every number in it is a measurement rather than
 * a preference:
 *
 * - A hero at 0.46 lightness is the exact point where white still clears 4.5:1
 *   at EVERY hue. That was already the ceiling on the derived hero and it stays
 *   the ceiling here.
 * - The rail is allowed deeper than the hero because it carries small text, and
 *   small text needs more headroom than a headline does.
 * - The page is pinned near the ends, because it is the background to
 *   everything. A "page colour" is a wash, not a poster, in any product where
 *   people read for a living.
 * - Chroma has a ceiling per area because a full-chroma field the size of a
 *   hero vibrates against text whatever its contrast ratio says. That is a
 *   comfort limit rather than a WCAG one, and no ratio would have caught it.
 */
type Band = { lo: number; hi: number; cMax: number };

function bandFor(area: BrandAreaKey, mode: Mode, tone: BrandTone): Band {
  if (area === 'page') {
    return mode === 'light'
      ? { lo: 0.95, hi: 0.995, cMax: 0.04 }
      : { lo: 0.13, hi: 0.24, cMax: 0.05 };
  }
  if (area === 'accent') {
    /*
     * THE NARROWEST BAND OF THE FOUR, and the guard is why.
     *
     * The first attempt gave the accent 0.38 to 0.62 in light mode, on the
     * reasoning that a button is a button. 869 of 1200 random themes failed on
     * it within a minute of the sweep existing. A button's LABEL is one colour,
     * and a band straddling the middle of the lightness axis has no single ink
     * that can cross it: white fails at the pale end, black fails at the deep
     * end, and an admin picking one colour from each half ships a button nobody
     * can read the words on.
     *
     * So each mode's band sits entirely on ONE SIDE of that divide: deep
     * buttons carrying white in light mode, bright buttons carrying dark ink in
     * dark mode. That is what the derived theme always did, at 0.45 and 0.72.
     * The band is only those two points given room for somebody else's hue.
     */
    return mode === 'light'
      ? { lo: 0.36, hi: 0.46, cMax: 0.17 }
      : { lo: 0.64, hi: 0.84, cMax: 0.16 };
  }
  const pale = tone === 'light';
  if (area === 'hero') {
    if (!pale) {
      return mode === 'light'
        ? { lo: 0.2, hi: 0.46, cMax: 0.17 }
        : { lo: 0.16, hi: 0.44, cMax: 0.16 };
    }
    return mode === 'light'
      ? { lo: 0.86, hi: 0.985, cMax: 0.09 }
      : { lo: 0.78, hi: 0.9, cMax: 0.08 };
  }
  /* rail */
  if (!pale) {
    return mode === 'light'
      ? { lo: 0.14, hi: 0.38, cMax: 0.15 }
      : { lo: 0.1, hi: 0.34, cMax: 0.14 };
  }
  return mode === 'light'
    ? { lo: 0.88, hi: 0.985, cMax: 0.07 }
    : { lo: 0.8, hi: 0.91, cMax: 0.06 };
}

const clampTo = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/**
 * One picked colour, made safe for one area of one mode.
 *
 * Hue is never touched. Chroma and lightness are touched only if they fall
 * outside the band, and then only as far as its edge. An admin who picks a
 * colour that was already in range gets their own hex back unchanged.
 */
function fitStop(
  hex: string,
  area: BrandAreaKey,
  mode: Mode,
  tone: BrandTone = 'auto'
): { used: string; adjusted: boolean } {
  const rgb = hexToRgb(hex);
  if (!rgb) return { used: DEFAULT_BRAND_COLOR, adjusted: true };
  const band = bandFor(area, mode, tone);
  const o = rgbToOklch(rgb);
  const used = oklchToHex({
    l: clampTo(o.l, band.lo, band.hi),
    c: Math.min(o.c, band.cMax),
    h: o.h,
  });
  /*
   * COMPARED ON THE ROUND TRIP, not on the numbers. A colour that survives the
   * band untouched can still come back a bit different through OKLCH and back,
   * and telling an admin we adjusted their colour when we did not is a small
   * lie that would cost the whole feature its credibility.
   */
  return { used, adjusted: rgbToHex(rgb).toLowerCase() !== used.toLowerCase() };
}

/** Every stop of an area, fitted, next to what it started as. For the admin. */
export function fitArea(
  area: BrandAreaKey,
  cfg: BrandArea | undefined,
  mode: Mode
): { picked: string; used: string; adjusted: boolean }[] {
  if (!cfg?.stops?.length) return [];
  const tone = cfg.tone ?? 'auto';
  return cfg.stops
    .slice(0, AREA_META[area].max)
    .map((picked) => ({ picked, ...fitStop(picked, area, mode, tone) }));
}

/** The same colour, moved along the lightness axis and kept inside a band. */
function shiftL(hex: string, by: number, band: Band): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const o = rgbToOklch(rgb);
  return oklchToHex({ l: clampTo(o.l + by, band.lo, band.hi), c: o.c, h: o.h });
}

/**
 * The first and last of a list this file has already guaranteed is not empty.
 *
 * `noUncheckedIndexedAccess` is on across this repo, so `stops[0]` is typed
 * `string | undefined` even three lines under a `.length` check that makes that
 * impossible. A `!` would silence it. These carry a real fallback instead, so a
 * future edit that genuinely CAN empty a list produces one wrong colour rather
 * than a blank world and a stack trace in a creator's console.
 */
const firstOf = (list: string[], fallback: string) => list[0] ?? fallback;
const lastOf = (list: string[], fallback: string) => list[list.length - 1] ?? fallback;

/** One CSS value for a set of stops. A single stop is a flat colour, not a gradient. */
export function stopsToCss(stops: string[], angle: number): string {
  if (stops.length === 0) return 'transparent';
  if (stops.length === 1) return firstOf(stops, 'transparent');
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

/**
 * Is this shape a theme we are willing to paint with?
 *
 * The same rule is written three more times: in Zod in the browser, in Zod in
 * the Edge Function, and as a check constraint on the column. This copy exists
 * because a value read BACK from the database is still untrusted by the code
 * that paints with it. A row written before a rule existed, or by a migration
 * written later, must degrade to the one-colour derivation rather than throw
 * inside a creator's render.
 */
export function readBrandThemeConfig(raw: unknown): BrandThemeConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: BrandThemeConfig = { v: 1 };
  let any = false;

  for (const key of AREA_KEYS) {
    const area = src[key];
    if (!area || typeof area !== 'object' || Array.isArray(area)) continue;
    const a = area as Record<string, unknown>;
    if (!Array.isArray(a.stops)) continue;

    const stops = a.stops
      .filter((s): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.trim()))
      .map((s) => s.trim().toLowerCase())
      .slice(0, AREA_META[key].max);
    if (stops.length === 0) continue;

    const built: BrandArea = { stops };
    if (AREA_META[key].angle && typeof a.angle === 'number' && Number.isFinite(a.angle)) {
      built.angle = clampTo(Math.round(a.angle), 0, 360);
    }
    if (AREA_META[key].tone && a.tone === 'light') built.tone = 'light';

    out[key] = built;
    any = true;
  }

  return any ? out : null;
}

/**
 * The smallest row that means the same thing, for the way IN.
 *
 * `readBrandThemeConfig` is permissive on purpose, because it reads whatever is
 * already stored. This is its opposite number and it is strict, because it
 * decides what gets WRITTEN: an area nobody customised, a tone that is the
 * default, an angle that is the default and a hex in capitals all mean exactly
 * what their absence means, and storing them anyway leaves four ways to write
 * the same theme and four ways for a later comparison to think it changed.
 */
export function canonicalBrandTheme(raw: unknown): BrandThemeConfig | null {
  const cfg = readBrandThemeConfig(raw);
  if (!cfg) return null;
  const out: BrandThemeConfig = { v: 1 };
  let any = false;
  for (const key of AREA_KEYS) {
    const area = cfg[key];
    if (!area) continue;
    const built: BrandArea = { stops: area.stops };
    if (area.angle !== undefined && area.angle !== DEFAULT_ANGLE) built.angle = area.angle;
    if (area.tone === 'light') built.tone = 'light';
    out[key] = built;
    any = true;
  }
  return any ? out : null;
}

/* -------------------------------------------------------------- the palette -- */

/**
 * Everything derived for one brand in one mode. Only the accent and hero fields
 * reach the screen now (via `paletteToAccentVars`); the page, surface, line,
 * text, muted and rail fields are still derived and audited but unrendered.
 */
export type BrandPalette = {
  /** The page behind everything, and the first stop of its wash. */
  page: string;
  /** Every stop of the page wash, in order. One is normal. */
  pageStops: string[];
  /** Cards and panels sitting on the page. */
  surface: string;
  /** A raised panel, for a card on a card. */
  surface2: string;
  /** Hairlines and card borders. */
  line: string;
  /** Body text on `page` and `surface`. */
  text: string;
  /** Secondary text: labels, captions, units. */
  muted: string;
  /** The navigation rail, and the first stop of its gradient. */
  rail: string;
  /** Every stop of the rail, in order. */
  railStops: string[];
  /** Text on the rail. */
  railText: string;
  /** Secondary text on the rail. */
  railMuted: string;
  /** The selected item in the rail. */
  railActive: string;
  /** The two ends of the hero, for anything that wants only two. */
  heroFrom: string;
  heroTo: string;
  /** Every stop of the hero, in order. */
  heroStops: string[];
  /** Which way the hero gradient runs, in degrees. */
  heroAngle: number;
  /** Text on the hero. */
  heroText: string;
  /** Secondary text on the hero. */
  heroMuted: string;
  /** Buttons and emphasis, and the first stop of the accent gradient. */
  accent: string;
  /** Every stop of the accent gradient, in order. */
  accentStops: string[];
  /** Text ON a filled accent button, legible across every accent stop. */
  accentText: string;
  /** The accent used as TEXT on `surface`, darkened or lightened until legible. */
  accentInk: string;
};

type BrandTheme = { light: BrandPalette; dark: BrandPalette };

/** The PRISM accent violet, used when a brand has chosen no colour of its own. */
export const DEFAULT_BRAND_COLOR = '#6A2FE0';

/*
 * A FLOOR AND A CEILING ON CHROMA, and both are there for a reason.
 *
 * Below the floor a "colour" is grey, and every derived surface is grey too, so
 * the hub reads as broken rather than as tasteful. Above the ceiling large
 * fills vibrate: a full-chroma hero behind white text is genuinely unpleasant
 * to sit in front of, whatever the contrast number says.
 */
const CHROMA_FLOOR = 0.02;
const CHROMA_CEIL = 0.16;

/** The hue and usable chroma of a colour, for tinting one area's own inks. */
function inkBase(hex: string, fallback: { h: number; c: number }) {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  const o = rgbToOklch(rgb);
  return { h: o.h, c: clampTo(o.c, CHROMA_FLOOR, CHROMA_CEIL) };
}

/**
 * The fills of one mode, before any text colour has been chosen.
 *
 * Split from the inks deliberately. Text is decided LAST, against whatever the
 * fills turned out to be, which is the only reason an admin can be handed four
 * colour pickers per area without also being handed four ways to ship a hub
 * nobody can read.
 */
type Fills = {
  pageStops: string[];
  surface: string;
  surface2: string;
  line: string;
  railStops: string[];
  railActive: string;
  heroStops: string[];
  heroAngle: number;
  accentStops: string[];
  ink: Record<BrandAreaKey, { h: number; c: number }>;
};

/**
 * Derive a brand's whole look from its base colour and whatever an admin
 * customised on top of it.
 *
 * Deterministic and pure, so the admin preview and the creator's screen cannot
 * disagree: both call this. `config` is optional, and an area it does not
 * mention falls straight back to the one-colour derivation BYTE FOR BYTE, so a
 * brand nobody has customised looks exactly as it did before any of this
 * existed. That is not politeness, it is what lets the 88-colour sweep keep
 * meaning what it meant.
 */
export function deriveBrandTheme(
  brandHex: string,
  config?: BrandThemeConfig | null
): BrandTheme {
  const rgb = hexToRgb(brandHex) ?? hexToRgb(DEFAULT_BRAND_COLOR)!;
  const base = rgbToOklch(rgb);
  const h = base.h;
  const c = clampTo(base.c, CHROMA_FLOOR, CHROMA_CEIL);

  /* Tints keep the hue and shed most of the chroma, or a page reads as a wash. */
  const tint = (l: number, mul: number) => oklchToHex({ l, c: c * mul, h });

  const build = (mode: Mode): Fills => {
    const derived =
      mode === 'light'
        ? {
            page: tint(0.973, 0.1),
            surface: tint(0.995, 0.03),
            surface2: tint(0.955, 0.12),
            line: tint(0.88, 0.18),
            rail: tint(0.28, 0.75),
            railActive: tint(0.4, 0.95),
            heroFrom: tint(0.34, 1),
            /*
             * The far end of the gradient is a CEILING, not a free choice. The
             * same heading crosses both ends, so the lighter end sets how light
             * either can be. 0.46 is the point where white still clears 4.5:1
             * at every hue, and it is why `bandFor` stops there too.
             */
            heroTo: tint(0.46, 0.85),
            /* Likewise: a filled button is mid-lightness, the hardest place to
             * put text. 0.45 keeps white above 4.5:1 whatever hue is picked. */
            accent: tint(0.45, 1),
          }
        : {
            /*
             * Dark is not "light, inverted". The page carries only a whisper of
             * hue, because a strongly tinted dark background makes white text
             * buzz, and the surfaces step UP in lightness rather than down,
             * which is how depth reads on a dark screen.
             */
            page: tint(0.17, 0.25),
            surface: tint(0.215, 0.3),
            surface2: tint(0.26, 0.35),
            line: tint(0.34, 0.4),
            rail: tint(0.135, 0.35),
            railActive: tint(0.36, 0.8),
            heroFrom: tint(0.3, 0.95),
            heroTo: tint(0.42, 0.8),
            accent: tint(0.72, 0.9),
          };

    const f: Fills = {
      pageStops: [derived.page],
      surface: derived.surface,
      surface2: derived.surface2,
      line: derived.line,
      railStops: [derived.rail],
      railActive: derived.railActive,
      heroStops: [derived.heroFrom, derived.heroTo],
      heroAngle: DEFAULT_ANGLE,
      /*
       * THE ACCENT GRADIENT IS NOW A TIGHT STEP, and this is a bug fix rather
       * than a preference.
       *
       * It used to run accent to heroTo, which in dark mode is 0.72 lightness
       * falling to 0.42: half of every gradient button far darker than the half
       * its label colour was chosen against. Nothing measured it, because the
       * contract named `accent` and the gradient was assembled separately down
       * in `paletteToVars` (now `paletteToAccentVars`). The moment every stop went into the audit, the
       * 88-colour sweep failed on it immediately.
       *
       * It now steps AWAY FROM THE INK by a fixed amount and no further: deeper
       * in light mode where the label is white, brighter in dark mode where the
       * label is dark. The same shape of gradient Wurx's own tokens use, and
       * every pixel of it is measured against the label that crosses it.
       */
      accentStops: [
        derived.accent,
        shiftL(
          derived.accent,
          mode === 'light' ? -0.06 : 0.06,
          bandFor('accent', mode, 'auto')
        ),
      ],
      ink: { hero: { h, c }, rail: { h, c }, page: { h, c }, accent: { h, c } },
    };

    if (!config) return f;

    /* ------------------------------------------------------------ hero -- */
    const hero = config.hero;
    if (hero?.stops?.length) {
      const tone = hero.tone ?? 'auto';
      const band = bandFor('hero', mode, tone);
      const stops = hero.stops
        .slice(0, AREA_META.hero.max)
        .map((s) => fitStop(s, 'hero', mode, tone).used);
      /*
       * ONE COLOUR IS STILL A GRADIENT, just a quiet one. A flat rectangle the
       * size of this hero reads as a placeholder rather than as a decision, so
       * a single pick gets a second stop lifted out of it inside the same band.
       */
      const only = firstOf(stops, derived.heroFrom);
      f.heroStops =
        stops.length > 1 ? stops : [only, shiftL(only, tone === 'light' ? -0.07 : 0.09, band)];
      f.heroAngle = clampTo(Math.round(hero.angle ?? DEFAULT_ANGLE), 0, 360);
      f.ink.hero = inkBase(firstOf(hero.stops, brandHex), { h, c });
    }

    /* ------------------------------------------------------------ rail -- */
    const rail = config.rail;
    if (rail?.stops?.length) {
      const tone = rail.tone ?? 'auto';
      const band = bandFor('rail', mode, tone);
      f.railStops = rail.stops
        .slice(0, AREA_META.rail.max)
        .map((s) => fitStop(s, 'rail', mode, tone).used);
      /*
       * THE SELECTED ITEM IS THE RAIL, LIFTED. It has to separate from every
       * stop behind it while staying somewhere the rail's single text colour
       * can still be read, so it steps a fixed distance from the last stop and
       * no further than the band's own edge plus a hair.
       */
      const last = lastOf(f.railStops, derived.rail);
      const up = tone !== 'light';
      f.railActive = shiftL(last, up ? 0.13 : -0.13, {
        cMax: band.cMax,
        lo: up ? band.lo + 0.06 : band.lo - 0.14,
        hi: up ? band.hi + 0.06 : band.hi - 0.05,
      });
      f.ink.rail = inkBase(firstOf(rail.stops, brandHex), { h, c });
    }

    /* ------------------------------------------------------------ page -- */
    const page = config.page;
    if (page?.stops?.length) {
      f.pageStops = page.stops
        .slice(0, AREA_META.page.max)
        .map((s) => fitStop(s, 'page', mode).used);
      /*
       * THE SECOND COLOUR TINTS THE CARDS, and that is the difference between
       * this area mattering and not. A page wash inside the band it has to stay
       * in is nearly invisible on its own, so customising "pages" would be the
       * one area where an admin changed something and saw nothing. Giving the
       * CARDS their own hue is what makes a warm page under cool cards
       * possible, and cards are most of what a working screen actually is.
       */
      const card = inkBase(page.stops[1] ?? firstOf(page.stops, brandHex), { h, c });
      f.ink.page = inkBase(firstOf(page.stops, brandHex), { h, c });
      const ct = (l: number, mul: number) => oklchToHex({ l, c: card.c * mul, h: card.h });
      if (mode === 'light') {
        f.surface = ct(0.995, 0.03);
        f.surface2 = ct(0.955, 0.12);
        f.line = ct(0.88, 0.18);
      } else {
        f.surface = ct(0.215, 0.3);
        f.surface2 = ct(0.26, 0.35);
        f.line = ct(0.34, 0.4);
      }
    }

    /* ---------------------------------------------------------- accent -- */
    const accent = config.accent;
    if (accent?.stops?.length) {
      const band = bandFor('accent', mode, 'auto');
      const stops = accent.stops
        .slice(0, AREA_META.accent.max)
        .map((s) => fitStop(s, 'accent', mode).used);
      const solo = firstOf(stops, derived.accent);
      f.accentStops =
        stops.length > 1 ? stops : [solo, shiftL(solo, mode === 'light' ? -0.06 : 0.06, band)];
      f.ink.accent = inkBase(firstOf(accent.stops, brandHex), { h, c });
    }

    return f;
  };

  /*
   * Each foreground is given EVERY fill it appears on, and a little more
   * headroom than the contract demands, so a later tweak to a surface does not
   * land exactly on the line. The contract is the floor, not the target.
   */
  const finish = (f: Fills): BrandPalette => {
    const pageBgs = [...f.pageStops, f.surface, f.surface2];
    const railBgs = [...f.railStops, f.railActive];
    return {
      page: firstOf(f.pageStops, DEFAULT_BRAND_COLOR),
      pageStops: f.pageStops,
      surface: f.surface,
      surface2: f.surface2,
      line: f.line,
      rail: firstOf(f.railStops, DEFAULT_BRAND_COLOR),
      railStops: f.railStops,
      railActive: f.railActive,
      heroFrom: firstOf(f.heroStops, DEFAULT_BRAND_COLOR),
      heroTo: lastOf(f.heroStops, DEFAULT_BRAND_COLOR),
      heroStops: f.heroStops,
      heroAngle: f.heroAngle,
      accent: firstOf(f.accentStops, DEFAULT_BRAND_COLOR),
      accentStops: f.accentStops,

      text: readableOn(pageBgs, f.ink.page.h, f.ink.page.c * 0.35, 4.8),
      muted: readableOn(pageBgs, f.ink.page.h, f.ink.page.c * 0.3, 3.3),
      railText: readableOn(railBgs, f.ink.rail.h, f.ink.rail.c * 0.2, 4.8),
      railMuted: readableOn(railBgs, f.ink.rail.h, f.ink.rail.c * 0.2, 3.3),
      heroText: readableOn(f.heroStops, f.ink.hero.h, f.ink.hero.c * 0.15, 4.8),
      heroMuted: readableOn(f.heroStops, f.ink.hero.h, f.ink.hero.c * 0.15, 3.3),
      accentText: readableOn(f.accentStops, f.ink.accent.h, f.ink.accent.c * 0.1, 4.8),
      accentInk: readableOn(
        [f.surface, ...f.pageStops, f.surface2],
        f.ink.accent.h,
        f.ink.accent.c,
        4.8
      ),
    };
  };

  return { light: finish(build('light')), dark: finish(build('dark')) };
}

/**
 * The pairs that must stay legible, whatever an admin picks.
 *
 * Exported so the same list can be asserted in a test and shown in the admin
 * preview: one definition, so a pair can never be guarded in one and forgotten
 * in the other.
 */
export const CONTRACT: ReadonlyArray<{
  label: string;
  fg: keyof BrandPalette;
  bg: keyof BrandPalette;
  min: number;
}> = [
  { label: 'body text on the page', fg: 'text', bg: 'page', min: 4.5 },
  { label: 'body text on a card', fg: 'text', bg: 'surface', min: 4.5 },
  { label: 'body text on a raised card', fg: 'text', bg: 'surface2', min: 4.5 },
  { label: 'secondary text on the page', fg: 'muted', bg: 'page', min: 3 },
  { label: 'secondary text on a card', fg: 'muted', bg: 'surface', min: 3 },
  { label: 'rail text', fg: 'railText', bg: 'rail', min: 4.5 },
  { label: 'rail secondary text', fg: 'railMuted', bg: 'rail', min: 3 },
  { label: 'rail text on the selected item', fg: 'railText', bg: 'railActive', min: 4.5 },
  { label: 'hero heading', fg: 'heroText', bg: 'heroFrom', min: 4.5 },
  { label: 'hero heading at the far end', fg: 'heroText', bg: 'heroTo', min: 4.5 },
  { label: 'hero paragraph', fg: 'heroMuted', bg: 'heroFrom', min: 3 },
  { label: 'button label', fg: 'accentText', bg: 'accent', min: 4.5 },
  { label: 'accent as text on a card', fg: 'accentInk', bg: 'surface', min: 4.5 },
];

/**
 * The same promise, made across EVERY stop of a gradient rather than its ends.
 *
 * The pair list above predates multi-colour themes and names single colours. A
 * four stop hero has two fills in the MIDDLE that no pair mentions, and the
 * middle of a gradient is exactly where a heading quietly stops being readable.
 * These walk the whole set instead.
 */
const STOP_CONTRACT: ReadonlyArray<{
  label: string;
  fg: keyof BrandPalette;
  stops: keyof BrandPalette;
  min: number;
}> = [
  { label: 'hero heading, every stop', fg: 'heroText', stops: 'heroStops', min: 4.5 },
  { label: 'hero paragraph, every stop', fg: 'heroMuted', stops: 'heroStops', min: 3 },
  { label: 'rail text, every stop', fg: 'railText', stops: 'railStops', min: 4.5 },
  { label: 'rail secondary text, every stop', fg: 'railMuted', stops: 'railStops', min: 3 },
  { label: 'body text, every page stop', fg: 'text', stops: 'pageStops', min: 4.5 },
  { label: 'secondary text, every page stop', fg: 'muted', stops: 'pageStops', min: 3 },
  {
    label: 'button label, every accent stop',
    fg: 'accentText',
    stops: 'accentStops',
    min: 4.5,
  },
];

/** Every pair that fails, with what it measured. Empty means the theme is safe. */
export function auditBrandTheme(brandHex: string, config?: BrandThemeConfig | null) {
  const theme = deriveBrandTheme(brandHex, config);
  const bad: { mode: Mode; label: string; got: number; min: number }[] = [];
  for (const mode of ['light', 'dark'] as const) {
    const p = theme[mode];
    for (const pair of CONTRACT) {
      const got = contrast(p[pair.fg] as string, p[pair.bg] as string);
      if (got < pair.min) bad.push({ mode, label: pair.label, got, min: pair.min });
    }
    for (const pair of STOP_CONTRACT) {
      for (const bg of p[pair.stops] as string[]) {
        const got = contrast(p[pair.fg] as string, bg);
        if (got < pair.min)
          bad.push({ mode, label: `${pair.label} (${bg})`, got, min: pair.min });
      }
    }
  }
  return bad;
}

/**
 * The custom properties a Brand Hub sets, ready to spread onto a style attribute.
 *
 * THE HUB IS INSIDE THE PRISM SHELL, so the brand is an ACCENT and not a world.
 * Rashid, 2026-10-09, on opening /app/brands/penetrex: "this page has a
 * completely different design language ... it is a part of the app". The first
 * version of this function repointed `--wx-bg`, the surfaces, the text and the
 * borders, which is what made a hub look like a separate app. Those four
 * families are PRISM's and stay PRISM's. What is left is deliberately small:
 *
 *   - the accent family, so every button, tab, link and ring inside the hub
 *     takes the brand's colour through the tokens the rest of the product
 *     already reads, with no component knowing a brand exists;
 *   - the hero's own colours, because the hero is the brand's imagery;
 *   - `--wx-brand-accent-ink`, the accent walked until it clears 4.5:1 as TEXT.
 *
 * EVERY MIX HERE IS AGAINST PRISM'S TOKENS (`--wx-text`, `--wx-surface-1`), not
 * against the brand's own page and card colours. Those colours are no longer on
 * screen, and mixing toward a surface that is not there would tint a hover with
 * a colour nothing else in the view shares. The variable is resolved on the hub's
 * own element, where the PRISM values are the inherited ones.
 *
 * WHAT IS DELIBERATELY LEFT ALONE: success, danger, warning and the stage
 * colours. Those are semantic. A rejection has to look like a rejection in
 * every brand, and a brand whose colour happens to be red must not turn every
 * approved badge into a warning.
 *
 * VACUOUS CONTRACT PAIRS, written down so nobody trusts them: with the brand's
 * own page, card and rail no longer rendered, these `CONTRACT` and
 * `STOP_CONTRACT` pairs still pass but protect nothing on screen: every `rail*`
 * pair, `text`/`muted` on `page`/`surface`/`surface2`/`pageStops`, and
 * `accentInk` on `surface`. The live pairs are the hero ones and the button
 * label on the accent. They are left in place rather than weakened, so the
 * guard cannot be loosened by accident.
 *
 * KNOWN GAP, written down so nobody assumes otherwise: the derivation measures
 * `accentInk` and the page text against the BRAND's derived surfaces. Those are
 * no longer what the accent sits on, so "accent as text on a card" in CONTRACT
 * now proves less than its label says. The accent band is pinned to one side of
 * the lightness axis per mode, which keeps it readable on any pale light-mode
 * or deep dark-mode surface in practice, but that is a property of the band and
 * not a measurement against PRISM's surfaces.
 */
export function paletteToAccentVars(p: BrandPalette): Record<string, string> {
  const accentWash = stopsToCss(p.accentStops, 135);
  const accentWashHover = stopsToCss([...p.accentStops].reverse(), 135);

  return {
    /* ---- the accent family, repointed for this subtree only ------------ */
    '--wx-accent': p.accent,
    '--wx-accent-hover': `color-mix(in srgb, ${p.accent} 86%, var(--wx-text))`,
    '--wx-accent-active': `color-mix(in srgb, ${p.accent} 74%, var(--wx-text))`,
    '--wx-accent-soft': `color-mix(in srgb, ${p.accent} 14%, var(--wx-surface-1))`,
    '--wx-accent-ring': `color-mix(in srgb, ${p.accent} 45%, transparent)`,
    '--wx-accent-shadow': `color-mix(in srgb, ${p.accent} 36%, transparent)`,
    '--wx-accent-gradient': accentWash,
    '--wx-accent-gradient-hover': accentWashHover,
    '--wx-on-accent': p.accentText,

    /* ---- and the brand's own, for the hero and the accent as text ------- */
    '--wx-brand-hero-from': p.heroFrom,
    '--wx-brand-hero-to': p.heroTo,
    '--wx-brand-hero-wash': stopsToCss(p.heroStops, p.heroAngle),
    '--wx-brand-hero-text': p.heroText,
    '--wx-brand-hero-muted': p.heroMuted,
    '--wx-brand-accent': p.accent,
    '--wx-brand-accent-wash': accentWash,
    '--wx-brand-accent-text': p.accentText,
    '--wx-brand-accent-ink': p.accentInk,
  };
}
