import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { ContestsView } from '@/components/creator/earn/ContestsView';
import type { CreatorContest, CreatorContestEntry } from '@/lib/creator/useCreatorContests';

/**
 * THE CONTESTS SCREEN, RENDERED AGAINST FIXTURES. DEV ONLY (`/dev/contests`).
 *
 * It renders the REAL `ContestsView` that `/app/contests` renders.
 *
 * `?case=`:
 *   empty    no contests at all: one sentence, no controls (her real state)
 *   joinable one open contest she has not entered: no switch, no search
 *   entered  an approved entry in an open contest, a declined one, one open
 *   shut     an approved entry in a contest whose door has SHUT, plus one open:
 *            the entry stays in "Your entries", never greyed
 *   many     eleven contests: the search box appears
 * `?theme=dark|light` shows one theme, otherwise both are stacked.
 */

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const brandOf = (name: string, slug: string) => ({ id: slug, name, slug, logoUrl: null });

function contest(
  id: string,
  name: string,
  b: ReturnType<typeof brandOf>,
  daysLeft: number,
  over: Partial<CreatorContest> = {}
): CreatorContest {
  return {
    id,
    brandId: b.id,
    brand: b,
    name,
    description: 'Hit the targets before the deadline and the rewards are yours.',
    briefUrl: null,
    bannerUrl: null,
    cardImageUrl: null,
    perks: null,
    status: 'active',
    needsAdminApproval: false,
    opensAt: iso(-20),
    expiresAt: iso(daysLeft),
    expiresAtTimezone: 'UTC',
    currency: 'USD',
    settledAt: null,
    cancelledAt: null,
    cancelMessage: null,
    deliverables: [
      {
        id: `${id}-d1`, contestId: id, type: 'gmv', title: 'Sell $2,000', detail: null,
        targetValue: 2000, rewardAmount: 150, sortOrder: 0,
      },
      {
        id: `${id}-d2`, contestId: id, type: 'video_count', title: 'Post 8 videos', detail: null,
        targetValue: 8, rewardAmount: 100, sortOrder: 1,
      },
    ],
    products: [],
    entry: null,
    terms: [],
    progress: null,
    target: null,
    progressUpdates: [],
    pendingClaim: null,
    confirmed: null,
    awards: [],
    ...over,
  };
}

function entry(
  contestId: string,
  b: ReturnType<typeof brandOf>,
  status: CreatorContestEntry['status']
): CreatorContestEntry {
  return {
    id: `e-${contestId}`,
    contestId,
    brandId: b.id,
    status,
    autoApproved: false,
    currency: 'USD',
    committedAmount: status === 'approved' ? 250 : null,
    committedVideoCount: status === 'approved' ? 8 : null,
    note: null,
    decisionNote: status === 'rejected' ? 'We have enough creators for this one.' : null,
    decidedAt: iso(-3),
    createdAt: iso(-5),
  };
}

const swisse = brandOf('Swisse', 'swisse');
const aurelia = brandOf('Aurelia', 'aurelia');
const glow = brandOf('Glow Lab', 'glow-lab');

const joinable = contest('c-open', 'Autumn glow sprint', glow, 12);

const inIt = contest('c-in', 'Swisse October push', swisse, 6, {
  entry: entry('c-in', swisse, 'approved'),
  terms: [
    { id: 't1', entryId: 'e-c-in', deliverableId: 'c-in-d1', type: 'gmv', title: 'Sell $2,000', detail: null, targetValue: 2000, rewardAmount: 150, currency: 'USD' },
    { id: 't2', entryId: 'e-c-in', deliverableId: 'c-in-d2', type: 'video_count', title: 'Post 8 videos', detail: null, targetValue: 8, rewardAmount: 100, currency: 'USD' },
  ],
  target: 2000,
  progress: {
    entryId: 'e-c-in', contestId: 'c-in', required: 8, approved: 3, waiting: 1,
    needsAnotherTake: 0, posted: 4, stillToFilm: 4,
  },
  confirmed: {
    entryId: 'e-c-in', contestId: 'c-in', confirmedGmv: 820, confirmedVideoCount: 3,
    confirmedAt: iso(-1), claimsWaiting: 0,
  },
});

const declined = contest('c-no', 'Aurelia night routine', aurelia, 9, {
  entry: entry('c-no', aurelia, 'rejected'),
});

// The door has shut (past its deadline) but she holds an approved entry: it
// stays, ungreyed, and still pays what it promised.
const shutButIn = contest('c-shut', 'Swisse September sprint', swisse, -2, {
  entry: entry('c-shut', swisse, 'approved'),
  terms: inIt.terms.map((t) => ({ ...t, id: `${t.id}s`, entryId: 'e-c-shut' })),
  target: 2000,
  progress: {
    entryId: 'e-c-shut', contestId: 'c-shut', required: 8, approved: 6, waiting: 0,
    needsAnotherTake: 0, posted: 6, stillToFilm: 2,
  },
  confirmed: {
    entryId: 'e-c-shut', contestId: 'c-shut', confirmedGmv: 1500, confirmedVideoCount: 6,
    confirmedAt: iso(-3), claimsWaiting: 0,
  },
});

// Deadline order is the DATABASE's. The fixtures are listed soonest first, the
// way the query returns them; nothing in the page re-sorts.
export const CONTEST_CASES: Record<string, CreatorContest[]> = {
  empty: [],
  joinable: [joinable],
  entered: [inIt, declined, joinable],
  shut: [shutButIn, inIt, joinable],
  many: [
    shutButIn,
    inIt,
    declined,
    joinable,
    ...Array.from({ length: 7 }, (_, i) =>
      contest(`c-x${i}`, `Seasonal contest ${i + 1}`, i % 2 ? glow : aurelia, 14 + i)
    ),
  ],
};

function Frame({ theme, caseKey }: { theme: 'dark' | 'light'; caseKey: string }) {
  return (
    <div data-theme={theme} className="bg-bg text-text mx-auto min-h-screen w-full max-w-[90rem] px-3 pb-8 sm:px-6">
      <p className="text-faint pt-3 text-[0.6875rem] tracking-widest uppercase">
        {caseKey} / {theme}
      </p>
      <ContestsView
        approved
        isCreator
        contests={CONTEST_CASES[caseKey] ?? []}
        isLoading={false}
        isError={false}
        retry={() => undefined}
      />
    </div>
  );
}

export function ContestsPreview() {
  const [params] = useSearchParams();
  const raw = params.get('case') ?? 'entered';
  const caseKey = raw in CONTEST_CASES ? raw : 'entered';
  const theme = params.get('theme');
  useEffect(() => {
    const t = params.get('theme');
    if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  }, [params]);
  const themes: ('dark' | 'light')[] =
    theme === 'dark' || theme === 'light' ? [theme] : ['dark', 'light'];
  return (
    <div>
      {themes.map((t) => (
        <Frame key={t} theme={t} caseKey={caseKey} />
      ))}
    </div>
  );
}
