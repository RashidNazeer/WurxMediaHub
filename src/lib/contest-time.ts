/**
 * Deadlines, in the timezone they were SET in.
 *
 * This is the first date formatter in the product and it exists because of one
 * failure: a creator in California reads "closes today" at 16:00 their time,
 * taps Enter, and is refused because the instant was 23:59 in London. There is
 * nothing anyone can point at on a support call.
 *
 * So rule L6: every creator facing deadline names its zone, and the zone it
 * names is the one an admin chose, not the one the reader happens to be in. A
 * timestamptz does not remember the offset it was written with, which is why
 * `contests.expires_at_timezone` exists as a column beside it.
 */

/**
 * "31 Aug 2026, 11:59pm BST".
 *
 * The abbreviation comes from Intl rather than a lookup table, so it follows a
 * clock change on its own. Europe/London prints BST in July and GMT in January
 * without anybody editing anything.
 */
export function formatDeadline(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  try {
    const date = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);

    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .format(d)
      // "11:59 pm" reads better as "11:59pm" beside a date.
      .replace(/\s(am|pm)$/i, (_m, p: string) => p.toLowerCase());

    const zone =
      new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
        .formatToParts(d)
        .find((p) => p.type === 'timeZoneName')?.value ?? '';

    return zone ? `${date}, ${time} ${zone}` : `${date}, ${time}`;
  } catch {
    // An unknown zone should be impossible, since save_contest checks the value
    // against pg_timezone_names before it stores it. Falling back to the raw
    // instant is still better than a blank space where a deadline should be.
    return d.toISOString().slice(0, 16).replace('T', ', ');
  }
}

/** How long is left, as one short phrase. Rule L15. */
export function timeLeft(iso: string, now: number = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'Closed';

  const hours = ms / 3_600_000;

  /*
   * Under an hour it counts MINUTES, ceiled. Rule L15 calls this "the only
   * window where a creator can lose a place by reading a rounded figure", and
   * "Closes within the hour" was exactly that figure: it read the same at
   * fifty nine minutes and at forty seconds.
   */
  if (hours < 1) {
    const m = Math.max(1, Math.ceil(ms / 60_000));
    return m === 1 ? 'Closes in 1 minute' : `Closes in ${m} minutes`;
  }

  // Under two days it counts in hours, because "1 day left" at 23:00 and
  // "1 day left" at 01:00 are twenty two hours apart and only one of them is
  // worth dropping everything for.
  if (hours < 48) {
    const h = Math.ceil(hours);
    return h === 1 ? 'Closes in 1 hour' : `Closes in ${h} hours`;
  }

  // Ceil, so the last full day reads "2 days left" rather than "1", and so
  // nothing ever prints "0 days left", which is a zero standing in for
  // something we actually know.
  return `${Math.ceil(hours / 24)} days left`;
}

/* -------------------------------------------------------------------------- */
/* Wall clock arithmetic, the other direction                                  */
/* -------------------------------------------------------------------------- */

/** The five numbers an admin actually typed, read back out of an instant. */
interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * What the clock on the wall says in `timeZone` at that instant.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, because the latter prints
 * midnight as "24" on several ICU builds. The old code papered over that with
 * `hour % 24`, which maps 24 back to 0 WITHOUT moving the day with it, so a
 * deadline at midnight silently landed twenty four hours early.
 */
function wallClockInZone(instantMs: number, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(instantMs));

  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/** The same numbers as the two strings an `<input type="date">` and a `<input type="time">` hold. */
export function wallClockFields(instantMs: number, timeZone: string): { date: string; time: string } {
  try {
    const w = wallClockInZone(instantMs, timeZone);
    const p = (n: number, len = 2) => String(n).padStart(len, '0');
    return {
      date: `${p(w.year, 4)}-${p(w.month)}-${p(w.day)}`,
      time: `${p(w.hour)}:${p(w.minute)}`,
    };
  } catch {
    // A zone Postgres accepted and this browser's ICU has never heard of. Two
    // empty boxes and a refusal on save beat a white screen on a form.
    return { date: '', time: '' };
  }
}

/** How far ahead of UTC `timeZone` was AT that instant, in milliseconds. */
function offsetAt(instantMs: number, timeZone: string): number {
  const w = wallClockInZone(instantMs, timeZone);
  const d = new Date(0);
  // setUTCFullYear rather than Date.UTC: Date.UTC maps a year of 26 to 1926,
  // and a contest typed as 0026 would otherwise land in the distant past.
  d.setUTCFullYear(w.year, w.month - 1, w.day);
  d.setUTCHours(w.hour, w.minute, 0, 0);
  return d.getTime() - instantMs;
}

type InstantResult =
  | { ok: true; iso: string }
  | { ok: false; message: string };

/**
 * A wall clock date and time IN A NAMED ZONE, turned into a real instant.
 *
 * TWO PASSES, and the second one is the whole point. Sampling the zone's offset
 * at the typed wall clock read as UTC samples it at a DIFFERENT POINT ON THE
 * DST CURVE from the answer, so a deadline near a clock change came out an hour
 * out, and reopening the form and saving again moved it another hour every
 * time. Pass one produces a candidate; pass two re-samples the offset AT that
 * candidate, which is the instant the answer actually lands on.
 *
 * Then it CHECKS, by formatting the result back in the zone. If the numbers
 * that come back are not the numbers that were typed, that wall clock does not
 * exist that day: 01:30 on 29 March 2026 in Europe/London is skipped entirely
 * by the clocks going forward. A refusal the form can show beats an instant
 * that is quietly an hour from what the admin asked for, which is the exact
 * failure rule L6 exists to prevent.
 */
export function instantFromWallClock(
  date: string,
  time: string,
  timeZone: string
): InstantResult | null {
  if (!date || !time) return null;

  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  if (![y, mo, d, h, mi].every((n) => Number.isFinite(n))) return null;

  const wall = new Date(0);
  wall.setUTCFullYear(y!, mo! - 1, d!);
  wall.setUTCHours(h!, mi!, 0, 0);
  const wallMs = wall.getTime();
  if (Number.isNaN(wallMs)) return null;

  try {
    let ms = wallMs - offsetAt(wallMs, timeZone);
    ms = wallMs - offsetAt(ms, timeZone);

    const back = wallClockInZone(ms, timeZone);
    if (
      back.year !== y ||
      back.month !== mo ||
      back.day !== d ||
      back.hour !== h ||
      back.minute !== mi
    ) {
      return {
        ok: false,
        message:
          'The clocks change that night, so that time never happens on that date in that timezone. Pick a time an hour either side.',
      };
    }

    return { ok: true, iso: new Date(ms).toISOString() };
  } catch {
    return { ok: false, message: 'That timezone was not recognised' };
  }
}
