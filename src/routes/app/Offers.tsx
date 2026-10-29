import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ContestsView } from '@/components/creator/earn/ContestsView';
import {
  isLiveForThem,
  useCreatorContests,
  type CreatorContest,
} from '@/lib/creator/useCreatorContests';
import { ApplyDialog } from '@/components/creator/ApplyDialog';
import { LockedUntilApproved } from '@/components/creator/LockedUntilApproved';
import { OfferCard } from '@/components/creator/OfferCard';
import {
  EarnGrid,
  EarnGroup,
  EarnPanel,
  EarnTileSkeleton,
} from '@/components/creator/earn/EarnPanel';
import { EarnFilters } from '@/components/creator/earn/EarnFilters';
import { CreatorSearch } from '@/components/creator/SearchField';
import { TileIn } from '@/components/creator/earn/TileIn';
import { DataError } from '@/components/ui/DataState';
import { useAuth } from '@/lib/auth/auth-context';
import { useProfile } from '@/lib/auth/useProfile';
import {
  stateFor,
  useAllCreatorOffers,
  useAllMyRequests,
  type CreatorOfferRow,
  type CreatorOfferState,
} from '@/lib/creator/useAllOffers';
import type { MyOfferApplication } from '@/lib/creator/useOfferApplications';
import { useCatalogueLive } from '@/lib/creator/useCatalogueLive';
import { needsFilming, useMyJobProgress, type JobProgress } from '@/lib/work/job-progress';

/**
 * Every offer open to this creator, across every brand.
 *
 * The brand hub answers "what is this brand offering me". This answers "what is
 * on the table anywhere", which is the question a creator actually opens the
 * app with. Before this, seeing everything meant remembering every brand and
 * visiting each hub in turn.
 *
 * FILTERING HAPPENS IN THE BROWSER RATHER THAN THE DATABASE, AND THAT IS A
 * DELIBERATE EXCEPTION TO THE PROJECT'S USUAL RULE. The grouping that matters
 * here is "am I in", "am I waiting", "have I not asked", and those live in a
 * different table from the offers themselves. Fetching the offers and her own
 * requests once, then sorting them out here, is ONE ROUND TRIP instead of a
 * join she would feel on every tap. §8.2 keeps this as it is.
 *
 * WHAT CHANGED, 2026-10-16, SECOND PASS — THE CONTROLS WENT AWAY.
 *
 * Rashid: "the tabs that are loaded with buttons and toggles or sub tabs make
 * them simpler to use and ditch the buttons where you can for easier
 * usability." This screen met a creator with five status chips, a brand select
 * and a search box before a single offer. Three of those answered the same
 * question — which offers do I care about — and two of them made her answer it
 * before she could see anything.
 *
 *   THE CHIP ROW IS GONE, AND THE LIST IS GROUPED BY STATUS INSTEAD. The five
 *   states are now five headed groups she scrolls past, each with the count the
 *   chip used to carry. The information survives; the interaction does not. A
 *   filter whose job is to hide four fifths of a short list is a question the
 *   screen can answer for her, and a chip row cannot show her that she has one
 *   offer waiting AND two open at the same time, which is the actual state of
 *   her week.
 *
 *   THE BRAND SELECT IS GONE. It duplicated the search box exactly — the
 *   search already matches a brand's name, and it always has (see `shown`
 *   below). Two controls for one question, one of them a dropdown that had to
 *   be opened to find out what was in it. Filtering to one brand is still
 *   reachable two ways: type its name, or tap the brand chip on any card and
 *   land in its hub, which is a place rather than a toggle.
 *
 *   WHAT IS LEFT IS ONE CONTROL: the search box. It earns it — it is the only
 *   thing on the screen that can answer "where was that offer about the
 *   serum", which neither a group nor a chip can.
 *
 * THIS IS NOT `/app/earn`. §8 asked for Offers and Contests to be merged behind
 * a segmented control; Rashid overruled it — "keep all the current tabs please"
 * — so the two routes and the two nav labels stay exactly as they are.
 */

/**
 * The five states, in the order a creator cares about them, as headed groups.
 *
 * ORDER IS BY WHAT SHE CAN DO ABOUT IT, not by how many there are.
 *
 *   accepted  money and work already in flight. Hers, and it has a deadline.
 *   waiting   she has asked and is owed an answer. Nothing to do but worth
 *             seeing, because "did I ask for that one?" is a real question.
 *   yours     needs no application at all, so it is hers the moment she wants
 *             it. Above the ones she has to ask for, because it is a shorter
 *             path to the same thing.
 *   open      the browse list. Usually the longest, which is exactly why it is
 *             not first: a creator with work in flight should not scroll past
 *             forty opportunities to find it.
 *   declined  history. Last, never hidden. A rejection that appears nowhere is
 *             the complaint both reviewers filed.
 *
 * `note` is one short line, and only where the group's name does not already
 * say everything. A paragraph under every heading is the wall of text the
 * grouping was meant to replace.
 */
const GROUPS: {
  key: string;
  title: string;
  note?: string;
  matches: (s: CreatorOfferState) => boolean;
}[] = [
  {
    key: 'accepted',
    title: 'Accepted',
    matches: (s) => s === 'in',
  },
  {
    key: 'waiting',
    title: 'Waiting on the team',
    matches: (s) => s === 'waiting',
  },
  {
    key: 'yours',
    title: 'Yours already',
    matches: (s) => s === 'open',
  },
  { key: 'open', title: 'Open to apply for', matches: (s) => s === 'canApply' },
  {
    key: 'declined',
    title: 'Declined',
    matches: (s) => s === 'declined',
  },
];

/** Items (offers plus contests) beyond which the one search box earns its place. */
const SEARCH_AFTER = 8;

/*
 * THE EARN PAGE, 2026-10-19: OFFERS AND CONTESTS ARE ONE PAGE NOW.
 *
 * Rashid agreed to fold Contests into Offers, with the caveat "make sure pages
 * are easy to operate themselves as well". So this is NOT a segmented switch
 * (one more control, and a creator has to know which half holds her work). It
 * is two SECTIONS on one scroll, each with its own counted group headings.
 *
 *   - An empty section costs ONE LINE, no panel and no control. She has no
 *     contests today, so the Contests section is a sentence.
 *   - The section she can act on leads: contests lead only when she holds a
 *     contest entry and has no accepted offer waiting on her videos; otherwise
 *     offers lead (and offers lead on a tie, so the page does not reorder
 *     itself under her).
 *   - ONE search box for the page, drawn only above eight items combined, and
 *     it filters both sections.
 *   - `#contests` scrolls to the contests section; `/app/contests` redirects
 *     to `/app/offers#contests`.
 *   - The Brand hub still embeds `Contests({ hubBrandId })` and `OfferCard`:
 *     this page reuses `ContestsView` (embedded) and `OfferCard` rather than
 *     copying either.
 *
 * Blur budget: top bar + the Offers panel + the Contests panel = 3. Anything
 * inside a panel is `wx-neo-raised-sm` or `wx-neo-inset`.
 */
export function Offers() {
  const { claims } = useAuth();
  const { data: profile } = useProfile();
  const role = profile?.role ?? claims?.role;
  const approved = role === 'creator' || role === 'ops' || role === 'admin';
  const isCreator = role === 'creator';

  // Admin edits to brands, offers and products land here without a reload.
  useCatalogueLive();

  const { data: offers, isLoading, isError, refetch } = useAllCreatorOffers();
  const { data: requests } = useAllMyRequests();
  // How much of each job has been filmed. Keyed by REQUEST, not by offer: five
  // videos for three hundred is a promise made to one creator on one request.
  const { data: progress } = useMyJobProgress();
  const { contests, isLoading: contestsLoading, isError: contestsError } = useCreatorContests();
  const queryClient = useQueryClient();
  const retryContests = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['creator', 'contests'] }),
      queryClient.invalidateQueries({ queryKey: ['creator', 'contest-entries'] }),
    ]);

  return (
    <EarnPage
      approved={approved}
      isCreator={isCreator}
      offers={offers}
      requests={requests}
      progress={progress}
      offersLoading={isLoading}
      offersError={isError}
      refetchOffers={() => void refetch()}
      contests={contests}
      contestsLoading={contestsLoading}
      contestsError={contestsError}
      retryContests={retryContests}
    />
  );
}

/** The page with its data handed in, so `/dev/offers` renders the real layout. */
export function EarnPage({
  approved,
  isCreator,
  offers,
  requests,
  progress,
  offersLoading,
  offersError,
  refetchOffers,
  contests,
  contestsLoading,
  contestsError,
  retryContests,
}: {
  approved: boolean;
  isCreator: boolean;
  offers: CreatorOfferRow[] | undefined;
  requests: MyOfferApplication[] | undefined;
  progress: Map<string, JobProgress> | undefined;
  offersLoading: boolean;
  offersError: boolean;
  refetchOffers: () => void;
  contests: CreatorContest[];
  contestsLoading: boolean;
  contestsError: boolean;
  retryContests: () => void | Promise<unknown>;
}) {
  const [searchText, setSearchText] = useState('');
  const { hash, search } = useLocation();
  const contestsRef = useRef<HTMLElement>(null);

  const total = (offers ?? []).length + contests.length;
  const searchable = total > SEARCH_AFTER;
  // A search box that is not drawn must not filter on a stale word.
  const query = searchable ? searchText : '';

  const ready = !offersLoading && !contestsLoading;
  useEffect(() => {
    if ((hash === '#contests' || search.includes('view=progress')) && ready && contestsRef.current) {
      contestsRef.current.scrollIntoView({ block: 'start' });
    }
  }, [hash, search, ready]);

  /* Which section leads: the one with something she can act on. */
  const offerNeedsHer = useMemo(() => {
    for (const r of requests ?? []) {
      if (r.status !== 'approved') continue;
      const p = progress?.get(r.id);
      if (p && needsFilming(p)) return true;
    }
    return false;
  }, [requests, progress]);
  const hasContestEntry = contests.some((c) => isLiveForThem(c));
  const noOffers = ready && (offers ?? []).length === 0 && (requests ?? []).length === 0;
  const contestsFirst = (hasContestEntry && !offerNeedsHer) || (noOffers && contests.length > 0);

  if (!approved) return <LockedUntilApproved className="mt-6" />;

  const offersSection = (
    <section
      key="offers"
      id="offers"
      aria-labelledby="earn-offers"
      className="mt-6 scroll-mt-20 first:mt-4"
    >
      <h2 id="earn-offers" className="font-display px-1 text-[1.125rem] font-semibold">
        Offers
      </h2>
      <OffersSection
        offers={offers}
        requests={requests}
        progress={progress}
        isLoading={offersLoading}
        isError={offersError}
        refetch={refetchOffers}
        query={query}
      />
    </section>
  );

  const contestsSection = (
    <section
      key="contests"
      id="contests"
      ref={contestsRef}
      aria-labelledby="earn-contests"
      className="mt-6 scroll-mt-20 first:mt-4"
    >
      <h2 id="earn-contests" className="font-display px-1 text-[1.125rem] font-semibold">
        Contests
      </h2>
      <div className="mt-1">
        <ContestsView
          approved
          embedded
          query={query}
          isCreator={isCreator}
          contests={contests}
          isLoading={contestsLoading}
          isError={contestsError}
          retry={retryContests}
        />
      </div>
    </section>
  );

  /* A long offers list pushes Contests below the fold, and on a phone she would
     never learn they exist. Two jump pills with counts sit at the top whenever
     is a Contests section to find (a zero count still says it exists). */
  const jump = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const jumpPill =
    'wx-neo-raised-sm text-text inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[0.8125rem] font-semibold';

  return (
    <>
      {ready ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {(contestsFirst ? ['contests', 'offers'] : ['offers', 'contests']).map((id) => (
            <button key={id} type="button" onClick={() => jump(id)} className={jumpPill}>
              {id === 'offers' ? 'Offers' : 'Contests'}
              <span className="text-accent tabular-nums">
                {id === 'offers' ? (offers ?? []).length : contests.length}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {searchable ? (
        <EarnFilters className="mt-4">
          <CreatorSearch
            value={searchText}
            onChange={setSearchText}
            placeholder="Search offers, contests or brands"
            label="Search offers, contests or brands"
          />
        </EarnFilters>
      ) : null}
      {contestsFirst ? [contestsSection, offersSection] : [offersSection, contestsSection]}
    </>
  );
}

/** The offers half: groups inside one panel, or one line when there is nothing. */
function OffersSection({
  offers,
  requests,
  progress,
  isLoading,
  isError,
  refetch,
  query,
}: {
  offers: CreatorOfferRow[] | undefined;
  requests: MyOfferApplication[] | undefined;
  progress: Map<string, JobProgress> | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  query: string;
}) {
  const [applyingTo, setApplyingTo] = useState<CreatorOfferRow | null>(null);

  /** The newest request per offer. A rejected creator can ask again, so an
   *  offer can carry several rows and only the newest describes today. */
  const latest = useMemo(() => {
    const map = new Map<string, MyOfferApplication>();
    for (const r of requests ?? []) if (!map.has(r.offer_id)) map.set(r.offer_id, r);
    return map;
  }, [requests]);

  /** The search matches the brand's name as well as the offer's. */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return offers ?? [];
    return (offers ?? []).filter(
      (o) =>
        o.title.toLowerCase().includes(needle) ||
        (o.brand?.name ?? '').toLowerCase().includes(needle) ||
        (o.description ?? '').toLowerCase().includes(needle)
    );
  }, [offers, query]);

  /* Counted AFTER the search: a heading labels the rows beneath it. */
  const groups = useMemo(() => {
    const byKey = new Map<string, CreatorOfferRow[]>(GROUPS.map((g) => [g.key, []]));
    for (const offer of shown) {
      const state = stateFor(offer, latest.get(offer.id));
      const group = GROUPS.find((g) => g.matches(state));
      if (group) byKey.get(group.key)!.push(offer);
    }
    return GROUPS.map((g) => ({ ...g, offers: byKey.get(g.key)! })).filter(
      (g) => g.offers.length > 0
    );
  }, [shown, latest]);

  const line = (text: string) => (
    <p className="text-muted max-w-prose px-1 text-[0.9375rem] leading-relaxed">{text}</p>
  );

  return (
    <>
      {isLoading ? (
        <EarnPanel className="mt-2">
          <EarnGrid min="20rem">
            {Array.from({ length: 3 }).map((_, i) => (
              <EarnTileSkeleton key={i} className="h-[14rem]" />
            ))}
          </EarnGrid>
        </EarnPanel>
      ) : isError ? (
        <DataError
          className="mt-2"
          title="We could not load the offers"
          body="Try again in a moment."
          onRetry={refetch}
        />
      ) : groups.length === 0 ? (
        line(
          (offers ?? []).length === 0
            ? 'No offers right now.'
            : 'Nothing matches that.'
        )
      ) : (
        /*
          ONE BLURRED PANEL FOR THE SECTION: every card in it is
          `wx-neo-raised-sm`. Layer B of the blur budget (see EarnPanel).
        */
        <EarnPanel className="mt-2">
          {groups.map((group) => (
            <EarnGroup
              key={group.key}
              title={group.title}
              count={group.offers.length}
              note={group.note}
            >
              <EarnGrid min="20rem">
                {group.offers.map((offer, i) => (
                  <TileIn key={offer.id} index={i}>
                    <OfferCard
                      offer={offer}
                      request={latest.get(offer.id)}
                      progress={progress?.get(latest.get(offer.id)?.id ?? '')}
                      showBrand
                      grouped
                      onApply={() => setApplyingTo(offer)}
                    />
                  </TileIn>
                ))}
              </EarnGrid>
            </EarnGroup>
          ))}
        </EarnPanel>
      )}

      {/* Layer C, and only while it is open: a bottom sheet on a phone and a
          centred dialog above `sm`. */}
      {applyingTo ? (
        <ApplyDialog
          offer={applyingTo}
          brandName={applyingTo.brand?.name ?? 'this brand'}
          onClose={() => setApplyingTo(null)}
        />
      ) : null}
    </>
  );
}
