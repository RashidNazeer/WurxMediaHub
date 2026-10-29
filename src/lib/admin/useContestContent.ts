import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import type { ContentStatus } from '@/lib/content';

interface ContestVideoRow {
  id: string;
  entryId: string;
  creatorId: string;
  creatorHandle: string | null;
  creatorName: string | null;
  contestId: string;
  contestName: string;
  brandName: string;
  videoUrl: string;
  videoTitle: string | null;
  adCode: string;
  status: ContentStatus;
  decisionNote: string | null;
  createdAt: string;
  /** How many of this entry's videos staff have approved so far. */
  approved: number;
  /** The next video target this entry has not reached, and what it pays. */
  nextTarget: number | null;
  nextReward: number | null;
  nextRewardTitle: string | null;
  currency: string;
}

interface ContestVideoPage {
  rows: ContestVideoRow[];
  total: number;
}

const PAGE = 20;

/**
 * Every contest video, filtered by what has been decided about it.
 *
 * WHY THIS EXISTS AT ALL. Until 2026-08-20 the only place a contest video
 * appeared in the admin was inside `ContestProgressQueue`, which reads only
 * PENDING claims. So the moment somebody confirmed or refused a claim, the
 * videos filed with it vanished from the entire product, and the audit log
 * could not bring them back either: `submit_contest_progress` records a count,
 * never the links. A video that arrived on a decided claim was unreachable.
 *
 * This is the contest twin of `/admin/content` and it is the screen that makes
 * `review_contest_content` reachable at all.
 *
 * THE ENTRY'S PROGRESS COMES WITH EACH ROW, because since 2026-08-20 approving
 * a video can owe money. A reviewer needs to know they are looking at the ninth
 * of ten before they click, not after.
 *
 * NOT LIVE, matching the other contest queues, and for the same documented
 * reason: `contest_submissions` is out of the realtime publication because row
 * security is not applied to DELETE events. It refetches on a timer, and a
 * decision invalidates the query directly.
 */
export function useContestContent(
  status: ContentStatus | 'all',
  page: number,
  contestId?: string
) {
  return useQuery<ContestVideoPage>({
    queryKey: ['admin', 'contest-content', status, page, contestId ?? 'every'],
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const sb = getSupabase();

      let q = sb
        .from('contest_submissions')
        .select(
          'id, entry_id, creator_id, creator_handle, creator_name, contest_id, video_url, ' +
            'video_title, ad_code, status, decision_note, created_at',
          { count: 'exact' }
        )
        // Oldest first. A queue is worked from the front, and the person who has
        // been waiting longest is the one being let down.
        .order('created_at', { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);

      if (status !== 'all') q = q.eq('status', status);
      if (contestId) q = q.eq('contest_id', contestId);

      const { data, error, count } = await q;
      if (error) throw error;

      const raw = (data ?? []) as unknown as {
        id: string;
        entry_id: string;
        creator_id: string;
        creator_handle: string | null;
        creator_name: string | null;
        contest_id: string;
        video_url: string;
        video_title: string | null;
        ad_code: string;
        status: ContentStatus;
        decision_note: string | null;
        created_at: string;
      }[];

      if (raw.length === 0) return { rows: [], total: count ?? 0 };

      /*
       * ONE GROUPED READ PER THING, never one query per row. Same rule the
       * offer queues follow, and the reason those screens stayed fast when dev
       * filled up with real data.
       */
      const contestIds = [...new Set(raw.map((r) => r.contest_id))];
      const entryIds = [...new Set(raw.map((r) => r.entry_id))];

      const [contestsRes, progressRes, termsRes] = await Promise.all([
        sb.from('contests').select('id, name, brand_id').in('id', contestIds),
        sb
          .from('contest_entry_progress')
          .select('entry_id, approved, required')
          .in('entry_id', entryIds),
        /*
         * THE TERMS, NOT THE COMMITTED COUNT, because those are two different
         * numbers and only one of them is money. `committed_video_count` is
         * what the entrant signed up to deliver; `contest_entry_terms` is what
         * actually pays, and a contest can carry several video targets at
         * different sizes. The reviewer needs the one their next click would
         * cross.
         */
        sb
          .from('contest_entry_terms')
          .select('entry_id, type, title, target_value, reward_amount, currency')
          .in('entry_id', entryIds)
          .eq('type', 'video_count'),
      ]);
      if (contestsRes.error) throw contestsRes.error;
      if (progressRes.error) throw progressRes.error;
      if (termsRes.error) throw termsRes.error;

      const contests = (contestsRes.data ?? []) as unknown as {
        id: string;
        name: string;
        brand_id: string;
      }[];

      const brandIds = [...new Set(contests.map((c) => c.brand_id))];
      const { data: brandRows, error: brandErr } = await sb
        .from('brands')
        .select('id, name')
        .in('id', brandIds);
      if (brandErr) throw brandErr;

      const brandName = new Map((brandRows ?? []).map((b) => [b.id, b.name as string]));
      const contestById = new Map(contests.map((c) => [c.id, c]));
      const progressBy = new Map(
        ((progressRes.data ?? []) as unknown as {
          entry_id: string;
          approved: number;
          required: number | null;
        }[]).map((p) => [p.entry_id, p])
      );

      const termsBy = new Map<
        string,
        { target_value: number; reward_amount: number; currency: string; title: string }[]
      >();
      for (const t of (termsRes.data ?? []) as unknown as {
        entry_id: string;
        title: string;
        target_value: number;
        reward_amount: number;
        currency: string;
      }[]) {
        const list = termsBy.get(t.entry_id) ?? [];
        list.push(t);
        termsBy.set(t.entry_id, list);
      }

      return {
        total: count ?? raw.length,
        rows: raw.map((r) => {
          const contest = contestById.get(r.contest_id);
          const progress = progressBy.get(r.entry_id);
          const approved = progress?.approved ?? 0;

          // The smallest target they have not reached: the one the next
          // approval could cross. Sorted here rather than in SQL because the
          // list is at most a handful per entry.
          const next = (termsBy.get(r.entry_id) ?? [])
            .filter((t) => Number(t.reward_amount) > 0 && Number(t.target_value) > approved)
            .sort((a, b) => Number(a.target_value) - Number(b.target_value))[0];

          return {
            id: r.id,
            entryId: r.entry_id,
            creatorId: r.creator_id,
            creatorHandle: r.creator_handle,
            creatorName: r.creator_name,
            contestId: r.contest_id,
            contestName: contest?.name ?? 'That contest',
            brandName: contest ? (brandName.get(contest.brand_id) ?? '') : '',
            videoUrl: r.video_url,
            videoTitle: r.video_title,
            adCode: r.ad_code,
            status: r.status,
            decisionNote: r.decision_note,
            createdAt: r.created_at,
            approved,
            nextTarget: next ? Number(next.target_value) : null,
            nextReward: next ? Number(next.reward_amount) : null,
            nextRewardTitle: next ? next.title : null,
            currency: next?.currency ?? 'USD',
          };
        }),
      };
    },
  });
}

export const CONTEST_CONTENT_PAGE = PAGE;
