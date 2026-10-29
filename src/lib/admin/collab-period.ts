/**
 * SCOPING THE PAID COLLABS BRAND PAGE TO A DATE RANGE.
 *
 * Rashid, 2026-10-13, after testing the first attempt: "only the ad spend is
 * changing according to the date range whereas in this whole page everything we
 * are getting from the EUKA must change according to date range".
 *
 * ── WHAT THE DATA ACTUALLY SUPPORTS, WHICH DECIDES WHAT A RANGE MEANS ────────
 *
 * Every EUKA figure on that screen — top videos, views, GMV, items sold, the
 * video counts, product performance — is read from each creator's `video_codes`
 * array. One entry per video, carrying:
 *
 *   date      the day it was POSTED
 *   views     the video's view count
 *   revenue   the video's GMV
 *   items     units sold
 *
 * The sync that fills those is explicit that the figures are LIVE TOTALS:
 * "views / revenue / items are LIVE METRICS — refreshed on every sweep so the
 * table stays current". They are the video's running total to date, not what it
 * earned inside any window, and nothing anywhere stores a per-day breakdown of
 * them.
 *
 * So a date range over this data can only mean ONE thing honestly: the videos
 * POSTED inside it. That is not a compromise invented here — it is exactly what
 * the month filter has always done. `collabWindowFor` keeps a video against a
 * creator's collab only when it was posted inside that creator's month, so
 * "September" has always meant "videos posted in September, with their totals
 * to date". A range is the same rule with the month boundary removed, which is
 * why the numbers stay comparable with what the page showed before.
 *
 * The alternative — GMV *earned* within the range — would need a per-day video
 * cache that does not exist. PARKED 0a describes it. It is a much larger job
 * and it would also make the figures disagree with every number the team has
 * read off this page for months.
 *
 * ── ONE DELIBERATE INCONSISTENCY, WORTH KNOWING ──────────────────────────────
 *
 * Ad spend IS stored per day, so it is genuinely spend *within* the range,
 * while GMV is the to-date total of videos posted within it. Those are
 * different notions of "in this period". That mismatch is not new: the month
 * view has always paired a month's ad spend with the running totals of that
 * month's videos. Making the range behave differently from the month would be
 * the surprising choice.
 */

type PeriodRange = { from: string; to: string } | null;

type VideoRow = { date?: string | null } & Record<string, unknown>;
type CreatorLike = { video_codes?: unknown } & Record<string, unknown>;

/** `YYYY-MM-DD` from whatever the row holds, or '' when there is no usable date. */
function postedDay(row: VideoRow): string {
  const raw = String(row?.date ?? '').trim();
  if (!raw) return '';
  /* Already a plain day, which is what the sync stores. */
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Each creator with `video_codes` narrowed to the videos posted inside the
 * range. Returns the SAME array when there is nothing to do, so React sees no
 * change and nothing re-renders for free.
 *
 * A video with no usable date is KEPT. Those rows are hand-added ad codes and
 * entries EUKA has not dated yet; dropping them would silently delete figures
 * a person typed in, and an undated row is already excluded from the collab by
 * the sync when EUKA does know better.
 */
export function clipCreatorsToRange<T extends CreatorLike>(creators: T[], range: PeriodRange): T[] {
  if (!range || !Array.isArray(creators) || !creators.length) return creators;
  const { from, to } = range;
  if (!from || !to) return creators;

  let changed = false;
  const out = creators.map((c) => {
    const rows = Array.isArray(c.video_codes) ? (c.video_codes as VideoRow[]) : null;
    if (!rows || !rows.length) return c;
    const kept = rows.filter((r) => {
      const day = postedDay(r);
      if (!day) return true;
      return day >= from && day <= to;
    });
    if (kept.length === rows.length) return c;
    changed = true;
    return { ...c, video_codes: kept };
  });
  return changed ? out : creators;
}

/** A range as a label, for the headings that used to say a month's name. */
export function rangeHeading(range: PeriodRange): string {
  if (!range) return 'All time';
  const fmt = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) return d;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${Number(m[3])} ${months[Number(m[2]) - 1]}`;
  };
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return sameYear
    ? `${fmt(range.from)} – ${fmt(range.to)} ${range.to.slice(0, 4)}`
    : `${fmt(range.from)} ${range.from.slice(0, 4)} – ${fmt(range.to)} ${range.to.slice(0, 4)}`;
}
