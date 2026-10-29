import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-context';
import { money } from '@/lib/money';
import { STAGE_META, type OfferStage } from '@/lib/offer-stages';
import type { ContentStatus } from '@/lib/content';
import {
  useMyStageEvents,
  useMyWork,
  type MyWorkRow,
  type StageEvent,
} from '@/lib/creator/useMyWork';

/*
 * BOTH OF THESE ARE DYNAMIC IMPORTS, AND IT IS THE ENTRY CHUNK THAT DECIDES IT.
 *
 * `AppShell` renders `NotificationBell`, which calls this hook, and
 * `router.tsx` imports `AppShell` at the top level. So this module sits in the
 * graph the browser downloads and EVALUATES before first paint on every page,
 * the public landing page included — and a top-level `getSupabase` put the
 * whole Supabase client (204 KB raw, 52.5 KB gzipped) in there with it.
 * `@/lib/realtime` is the other static edge to the same client, so it goes the
 * same way. Measured 2026-10-16; see the matching note in `useMyWork.ts`.
 *
 * Behaviour is unchanged: both are used inside an async `queryFn` or an effect
 * that only runs for a signed-in creator, by which point `AuthProvider` has
 * already loaded the one shared client.
 */
const supabaseClient = () => import('@/lib/supabase').then((m) => m.getSupabase());
const realtime = () => import('@/lib/realtime');

/**
 * NOTIFICATIONS, DERIVED IN THE BROWSER. There is no notifications table.
 *
 * Both external reviewers asked for a bell, and a notifications table is a
 * product decision rather than a UI one: read state, fan-out, retention and
 * "who gets told what" all have to be settled before a schema is worth
 * writing, and none of that can be reviewed or deployed in this pass. So this
 * builds the feed out of the four things that have ALREADY happened to a
 * creator and that the app already reads:
 *
 *   - `offer_stage_events`  — a job moved along the pipeline.
 *   - `offer_applications.status` — a request was approved or declined.
 *   - `content_submissions` — a video was reviewed: approved, or another take.
 *   - `contest_awards`      — a reward was confirmed, and later paid.
 *
 * Every item is therefore a real event with a real timestamp and a link to the
 * screen it concerns. Nothing here is invented.
 *
 * WHAT THIS CANNOT DO, stated plainly rather than implied:
 *
 *   - It only knows about events her own rows carry. An announcement with no
 *     row behind it ("the leaderboard resets on Monday") has nowhere to come
 *     from and does not appear.
 *   - Read state is PER DEVICE AND PER BROWSER. See `readStateFor` below.
 *   - It is pull, not push. Nothing reaches a phone with the app shut.
 *
 * All three want a `notifications` table with a `read_at` column and a
 * server-side writer. That is the proper fix and this is not pretending to be
 * it.
 */

/* --------------------------------------------------------------- shapes -- */

export type NotificationKind = 'stage' | 'request' | 'content' | 'reward';

export interface CreatorNotification {
  /**
   * Stable across reloads, because read state is stored against it. Built from
   * the row id plus the moment that made it an event, so a request decided
   * twice is two notifications rather than one that silently changed its mind.
   */
  id: string;
  kind: NotificationKind;
  /** The headline. Short enough for one line in a 20rem panel. */
  title: string;
  /** One sentence of context: which brand, which offer, what to do. */
  body: string;
  /** The screen this concerns. Always a route that exists today. */
  to: string;
  /** ISO, from the database. Never `Date.now()`. */
  at: string;
  unread: boolean;
}

/** How many items the panel will ever show. Newest first, the rest dropped. */
const NOTIFICATION_CAP = 20;

/** How far back each underlying read looks. */
const FEED_CAP = 25;

/* ----------------------------------------------------------- read state -- */

/**
 * "READ" LIVES IN `localStorage`, AND THAT IS A REAL LIMITATION.
 *
 * It is per device and per browser. It does NOT sync. A creator who clears the
 * bell on her laptop still sees the same unread count on her phone, and a
 * private window starts from scratch every time. There is no server-side read
 * state because there is no notifications table to put it in, and inventing
 * one here would be exactly the schema change this pass cannot review.
 *
 * The honest fix is a `notifications` table with a `read_at` per row per user,
 * written by the same code that creates the event. Until then this is a
 * convenience that stops the same items shouting at her forever on the machine
 * she actually uses, and it is not claimed to be anything more.
 *
 * Every read and write is wrapped: Safari in private mode throws on access
 * rather than returning null, and a bell that crashes the shell is worse than
 * a bell that forgets.
 */
const keyFor = (userId: string) => `wurxmediahub-notifications-read:${userId}`;

/** Ids kept after a mark-all. Capped so one browser cannot grow forever. */
const SEEN_CAP = 200;

interface ReadState {
  /** Everything older than this is read. Epoch milliseconds, 0 when never. */
  allReadBefore: number;
  /** Individually opened items newer than `allReadBefore`. */
  seen: string[];
}

const EMPTY_READ_STATE: ReadState = { allReadBefore: 0, seen: [] };

function readStateFor(userId: string | undefined): ReadState {
  if (!userId) return EMPTY_READ_STATE;
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return EMPTY_READ_STATE;
    const parsed = JSON.parse(raw) as Partial<ReadState> | null;
    const before = Number(parsed?.allReadBefore ?? 0);
    return {
      allReadBefore: Number.isFinite(before) ? before : 0,
      seen: Array.isArray(parsed?.seen)
        ? parsed.seen.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    /* Private window, blocked storage, or a malformed value. Everything then
       reads as unread, which is the safe direction to fail in. */
    return EMPTY_READ_STATE;
  }
}

function writeReadState(userId: string | undefined, state: ReadState): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(
      keyFor(userId),
      JSON.stringify({ ...state, seen: state.seen.slice(0, SEEN_CAP) })
    );
  } catch {
    /* Nothing to do and nothing to report: the session keeps the state in
       memory, it just will not survive a reload. */
  }
}

/* ------------------------------------------------------------ the reads -- */

interface ReviewedContentRow {
  id: string;
  status: ContentStatus;
  decided_at: string;
  decision_note: string | null;
  video_title: string | null;
  brand: { name: string } | null;
  offer: { title: string } | null;
}

interface AwardRow {
  id: string;
  awarded_amount: number | string;
  awarded_currency: string;
  message: string | null;
  created_at: string;
  paid_at: string | null;
  contest: { name: string } | null;
}

interface NotificationFeed {
  content: ReviewedContentRow[];
  awards: AwardRow[];
}

/**
 * The two reads the rest of the creator app does not already do for us.
 *
 * LEAN ON PURPOSE. This mounts in the app shell, so it runs on every creator
 * screen, and `useMyContent` is 500 wide rows with two joins — far too much to
 * pay for a bell. Only REVIEWED videos are asked for (`decided_at is not
 * null`), because an unreviewed one is not an event that happened to her, and
 * the order is by the DECISION rather than the upload: a video filed in March
 * and approved today is today's news.
 *
 * Row level security returns her own rows and nothing else on both tables,
 * which is the same reason no `creator_id` filter appears in any other creator
 * query in this folder.
 */
function useNotificationFeed() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['creator', 'notification-feed'],
    staleTime: 30_000,
    queryFn: async (): Promise<NotificationFeed> => {
      const sb = await supabaseClient();
      const [reviewed, awards] = await Promise.all([
        sb
          .from('content_submissions')
          .select(
            'id, status, decided_at, decision_note, video_title, ' +
              'brand:brands (name), offer:offers (title)'
          )
          .not('decided_at', 'is', null)
          .order('decided_at', { ascending: false })
          .limit(FEED_CAP),
        sb
          .from('contest_awards')
          .select(
            'id, awarded_amount, awarded_currency, message, created_at, paid_at, ' +
              'contest:contests (name)'
          )
          .order('created_at', { ascending: false })
          .limit(FEED_CAP),
      ]);

      if (reviewed.error) throw reviewed.error;
      if (awards.error) throw awards.error;

      return {
        content: (reviewed.data ?? []) as unknown as ReviewedContentRow[],
        awards: (awards.data ?? []) as unknown as AwardRow[],
      };
    },
  });

  /*
   * THE SAME CHANNEL NAMES AND THE SAME BINDINGS the two owning hooks already
   * use, deliberately. `joinChannel` reference-counts by name and refuses two
   * DIFFERENT binding sets under one name, so matching them exactly means the
   * bell shares whatever socket `useMyContent` or the (since removed) `ContestEarnings` card has
   * already opened rather than adding a second subscription to the same rows.
   */
  /*
   * `joinChannel` ARRIVES ASYNCHRONOUSLY, SO THE TEARDOWN IS TRACKED BY HAND.
   *
   * React needs a cleanup function back synchronously and the module is now a
   * dynamic import, so the effect returns its own cleanup at once. It covers
   * both orders: after the two channels were joined, when it leaves them; and
   * before, when `cancelled` stops the join happening at all. Without that
   * flag an effect cleaned up mid-import would subscribe two channels nothing
   * ever unsubscribes, which is the leak `realtime.ts` reference-counts to
   * avoid.
   */
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    let cancelled = false;
    let leaveContent: (() => void) | undefined;
    let leaveAwards: (() => void) | undefined;

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['creator', 'notification-feed'] });
    };

    void realtime().then(({ joinChannel }) => {
      if (cancelled) return;
      leaveContent = joinChannel(
        `my-content:${userId}`,
        [{ table: 'content_submissions', filter: `creator_id=eq.${userId}` }],
        invalidate
      );
      leaveAwards = joinChannel(
        `contest-awards:${userId}`,
        [{ table: 'contest_awards', filter: `creator_id=eq.${userId}` }],
        invalidate
      );
    });

    return () => {
      cancelled = true;
      leaveContent?.();
      leaveAwards?.();
    };
  }, [user?.id, queryClient]);

  return query;
}

/* ------------------------------------------------------------ the words -- */

/** "Penetrex · Spring restock", or whichever half of it we actually have. */
function jobLabel(brand: string | null | undefined, offer: string | null | undefined): string {
  return [brand, offer].filter(Boolean).join(' · ');
}

/** One sentence, with nothing left dangling when a part is missing. */
function sentence(...parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Which screen a stage move belongs on.
 *
 * The two content stages are the ones she acts on in My content; everything
 * else is the state of the deal itself, which lives on Offers. There is no
 * per-application route in the product, so neither link can be more precise
 * than this without inventing one.
 */
const stageRoute = (stage: OfferStage) =>
  stage === 'content_pending' || stage === 'content_completed' ? '/app/content' : '/app/offers';

function fromStageEvents(
  events: StageEvent[],
  byId: Map<string, MyWorkRow>
): CreatorNotification[] {
  return events.map((e) => {
    const job = byId.get(e.application_id);
    const meta = STAGE_META[e.to_stage];
    return {
      id: `stage:${e.id}`,
      kind: 'stage' as const,
      title: meta.label,
      body: sentence(jobLabel(job?.brand?.name, job?.offer?.title), meta.creatorHint, e.note),
      to: stageRoute(e.to_stage),
      at: e.created_at,
      unread: false,
    };
  });
}

function fromRequests(rows: MyWorkRow[]): CreatorNotification[] {
  const out: CreatorNotification[] = [];
  for (const row of rows) {
    // Only a DECIDED request is an event. A pending one is something she is
    // waiting for, and the waiting is already on the Offers screen.
    if (!row.decided_at) continue;
    if (row.status !== 'approved' && row.status !== 'rejected') continue;
    const approved = row.status === 'approved';
    out.push({
      id: `request:${row.id}:${row.decided_at}`,
      kind: 'request',
      title: approved ? 'Request approved' : 'Request declined',
      body: sentence(
        jobLabel(row.brand?.name, row.offer?.title),
        approved
          ? 'You are on this one. Open it to see what happens next.'
          : 'Not this one. There are other offers open.',
        row.decision_note
      ),
      to: '/app/offers',
      at: row.decided_at,
      unread: false,
    });
  }
  return out;
}

const CONTENT_TITLE: Record<ContentStatus, string> = {
  submitted: 'Video received',
  approved: 'Video approved',
  needs_another_take: 'Needs another take',
};

const CONTENT_BODY: Record<ContentStatus, string> = {
  submitted: 'It is with the team.',
  approved: 'It counts towards this job.',
  needs_another_take: 'Have another go and file the new link.',
};

function fromContent(rows: ReviewedContentRow[]): CreatorNotification[] {
  return rows.map((row) => ({
    id: `content:${row.id}:${row.decided_at}`,
    kind: 'content' as const,
    title: CONTENT_TITLE[row.status],
    body: sentence(
      jobLabel(row.brand?.name, row.offer?.title ?? row.video_title),
      CONTENT_BODY[row.status],
      row.decision_note
    ),
    to: '/app/content',
    at: row.decided_at,
    unread: false,
  }));
}

/**
 * A reward lands twice, and both times matter: the moment it is CONFIRMED (she
 * has earned it) and the moment it is PAID (the money has gone). Two items out
 * of one row, which is why `paid_at` gets an id of its own.
 */
function fromAwards(rows: AwardRow[]): CreatorNotification[] {
  const out: CreatorNotification[] = [];
  for (const row of rows) {
    const amount = money(row.awarded_amount, row.awarded_currency);
    const contest = row.contest?.name ?? 'a contest';
    out.push({
      id: `reward:${row.id}`,
      kind: 'reward',
      title: `Contest reward, ${amount}`,
      body: sentence(`You earned it on ${contest}.`, row.message),
      to: '/app/contests',
      at: row.created_at,
      unread: false,
    });
    if (row.paid_at) {
      out.push({
        id: `reward:${row.id}:paid`,
        kind: 'reward',
        title: `Reward paid, ${amount}`,
        body: `Your ${contest} reward has been sent.`,
        to: '/app/contests',
        at: row.paid_at,
        unread: false,
      });
    }
  }
  return out;
}

/* --------------------------------------------------------------- public -- */

interface CreatorNotifications {
  items: CreatorNotification[];
  unreadCount: number;
  /** Everything currently in the list becomes read, on this device only. */
  markAllRead: () => void;
  /** One item becomes read, on this device only. Called when she opens it. */
  markRead: (id: string) => void;
  /** True only while there is nothing to show yet. */
  isLoading: boolean;
  /** One of the reads failed. The panel says so rather than showing nothing. */
  failed: boolean;
}

export function useCreatorNotifications(): CreatorNotifications {
  const { user } = useAuth();
  const work = useMyWork();
  const stages = useMyStageEvents(FEED_CAP);
  const feed = useNotificationFeed();

  // Read once per user and then held here. Written through on every change, so
  // a second tab picks it up on its next mount rather than live — the same
  // limitation as the storage itself, and not worth a `storage` listener.
  const [read, setRead] = useState<ReadState>(() => readStateFor(user?.id));
  const [readFor, setReadFor] = useState(user?.id);

  if (user?.id !== readFor) {
    // Signing in as somebody else must not inherit the previous person's read
    // state. Done during render rather than in an effect so the first paint
    // after a swap is already correct.
    setReadFor(user?.id);
    setRead(readStateFor(user?.id));
  }

  const markAllRead = useCallback(() => {
    // `seen` is cleared rather than merged: everything older than now is read
    // by the timestamp alone, so keeping the ids would be dead weight.
    const next: ReadState = { allReadBefore: Date.now(), seen: [] };
    setRead(next);
    writeReadState(user?.id, next);
  }, [user?.id]);

  const markRead = useCallback(
    (id: string) => {
      setRead((prev) => {
        if (prev.seen.includes(id)) return prev;
        const next: ReadState = {
          allReadBefore: prev.allReadBefore,
          seen: [id, ...prev.seen].slice(0, SEEN_CAP),
        };
        writeReadState(user?.id, next);
        return next;
      });
    },
    [user?.id]
  );

  const items = useMemo(() => {
    const rows = work.data ?? [];
    const byId = new Map(rows.map((r) => [r.id, r] as const));

    const all = [
      ...fromStageEvents(stages.data ?? [], byId),
      ...fromRequests(rows),
      ...fromContent(feed.data?.content ?? []),
      ...fromAwards(feed.data?.awards ?? []),
    ];

    const seen = new Set(read.seen);
    return all
      .filter((n) => Boolean(n.at))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, NOTIFICATION_CAP)
      .map((n) => {
        const at = Date.parse(n.at);
        const unread = Number.isFinite(at) && at > read.allReadBefore && !seen.has(n.id);
        return unread === n.unread ? n : { ...n, unread };
      });
  }, [work.data, stages.data, feed.data, read]);

  const unreadCount = useMemo(() => items.filter((n) => n.unread).length, [items]);

  return {
    items,
    unreadCount,
    markAllRead,
    markRead,
    isLoading: items.length === 0 && (work.isLoading || stages.isLoading || feed.isLoading),
    failed: Boolean(work.isError || stages.isError || feed.isError),
  };
}

/**
 * "Just now", "4h ago", "12 Oct". Rough on purpose.
 *
 * `Intl.RelativeTimeFormat` would give "4 hours ago" in the reader's own
 * language, and it is the right tool the day this product is translated. It is
 * not translated, every other string in this file is English, and the short
 * form is what fits beside a title in a 20rem panel.
 */
export function whenLabel(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const mins = Math.round((now - at) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
