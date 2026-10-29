# Joining the product up

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

**Written:** 2026-08-11, from a 12 agent audit of every screen and the whole
data layer. Nothing in here is built. This is the plan Rashid approves from,
one step at a time.

**Rashid's ask, in his words:** things are scattered. Each menu item has its own
data and there is no close connection between them. A creator who posts content
sees it only under My content, when the offers page should show how much of that
offer has been filmed, and a brand hub should show how many offers that brand
has and where the creator stands with it. Same for admin, every page should show
everything related to it.

---

## What the audit found

The product is **joined up in the database and siloed in the interface**. Every
table is correctly related to every other one. Almost none of those relationships
are ever read together.

Three findings shape everything below.

**1. The number Rashid asked for already exists.** `progressFor()` in
`src/lib/content.ts` already computes, for one job, how many videos are
required, approved, waiting and sent back. `useMyContent()` already returns
every submission with the job it belongs to. Both are imported by exactly two
files out of the nine screens that render a job. The bar Rashid wants is, on the
creator side, mostly a matter of showing a number we already work out and throw
away.

**2. There are no database views at all.** `FEATURE_MAP.md` says the project
relies on "shared SQL views so every screen reads the same truth". No view has
ever been created. Every cross-table number in the product is assembled in
JavaScript. That is why two screens can disagree.

**3. One rule governs every creator-facing count.** Under row level security a
creator asking "how many creators are on this offer" does not get an error and
does not get zero. They get **1**, their own row. So a headcount on a creator
screen is both a privacy breach and a wrong number that looks like a working
feature. Job level counts are safe because a job belongs to exactly one creator.
Offer level and brand level counts are not, ever.

---

## The seven connections

1. **A job should know how much of it has been filmed.** One join, six screens.
2. **A brand should say where I stand with it.** Creator side.
3. **A brand should know who is working on it.** The same hole in reverse.
4. **A creator should be a thing you can open.** There is a screen for every
   entity in the product except a person.
5. **Every name on a screen should be a door.** The brand on a job is text. The
   offer on a video is text. Most rows in the activity log are dead links that
   look alive.
6. **A screen should never say the opposite of what the database knows.** Four
   real defects, listed below.
7. **The operations home should tell you what today is.** It reads one table out
   of three and can say the day is clear while two queues are full.

---

## The steps, in order

One step per approval, each one clickable on its own.

### Step 1. A job says how much of it has been filmed  **BUILT 2026-08-11**

Shipped as described, plus four things the build turned up: the offer card was
extracted (it was written out twice and had drifted), the add a video dialog and
My content were switched off browser arithmetic onto the view, `progressFor()`
was deleted so there is genuinely one source, and the three scripts that write
jobs directly had to start snapshotting the count themselves the way the real
approval does. See PROJECT_STATE and the FEATURE_MAP entry.


Wherever a creator sees a job they have taken they see how much of it they have
done: a small bar and the words "3 of 5 approved, 1 with the team, 1 still to
film". Identical on the home screen, the offers list and inside a brand hub. A
job with no set number of videos says how many have been posted and draws no
bar. The Add a video picker says how many each job still needs, and picks for
them when only one is short. **Every screen that says "1 still to film" gets a
way to film it**, which today it does not.

Data work: the project's first view, `job_progress`, one row per job. New
indexes. A ceiling on two creator reads that have none. A lint rule so creator
code can never import admin code, which is the rule five parts of this plan
depend on and nothing currently enforces.

Also ships: a demo data script, so every state has something to render on dev.

### Step 2. The admin side sees the same job, and stops quoting the wrong money  **BUILT 2026-08-11**

Shipped as described. No migration was needed: every new read rides an index
that already existed, two of which had never been used by a query. It also
turned up two checks in `verify:offer-requests` that had been failing silently
since the creator UI rebuild, on copy that redesign deleted; both were fixed
against the current design rather than removed, and OPERATIONS now says a
redesign re-runs every suite that asserts copy.


The requests queue shows what was actually agreed with that creator instead of
what the offer says today. It shows how many videos have landed, how long the
job has stood where it is, and the last move made on it. Every video on the
admin content screen says who filmed it and which job it belongs to, and the
Approve button says out loud when this is the last one, because approving it
finishes the job.

Both screens come onto the current design language here, because the blocks
being added to them are stage colours and those cannot sit next to the old amber
and green chips.

### Step 3. Where I stand with this brand

Open a brand and the first thing you see is your own relationship with it: how
many of its offers are yours, what has been agreed, what has been paid, how many
videos you have had approved for it. Under that, your jobs at that brand as
jobs, with a button to add a video without leaving. The brand list stops being a
wall of identical cards: brands you work with come first and carry your figures,
and a retired brand says so instead of telling you its products are on their way.

Nothing here reads a brand's client, budget or spend, and nothing counts other
creators.

### Step 4. Every job card tells its own story, and every name is a door

The cheapest step and the one that removes the siloed feeling from the most
screens, because almost all of it is data already on the wire and discarded. Job
cards show what the deal was and how long they have stood still, with their own
history behind a tap. Then everything becomes clickable, filters move into the
address bar so a shared link lands where it says, and the activity log stops
pointing every row at the applications screen whatever it was about.

### Step 5. A brand's overview says where its money and its content have got to  **BUILT 2026-08-11**

Shipped, plus the thing it forced: paging the Offers tab meant Overview could no
longer count by filtering that array, so those counts moved into the database in
the same step. The per-offer comparison table was NOT built; the Overview shows
brand totals and the offer counts, and comparing offers against each other is
still only possible on `/admin/offers`. Saying so rather than half-doing it.


The committed figure splits into paid, awaiting payment and in progress. Beside
it, how many videos have landed for this brand, how many are waiting to be
watched, how many were sent back. Then a comparison of the brand's own offers,
so you can see which one is pulling creators and which live offer nobody has
taken. The offers tab gets search, filter and real paging.

### Step 6. A brand knows who is working on it  **BUILT 2026-08-11**


The Creators tab, which the hub has advertised as coming for weeks, gets built.
One card per creator who has ever asked for one of this brand's offers, with
where they stand, what they were promised, what they have delivered and what has
been paid. Searchable and paged in the database.

### Step 7. A creator is a thing you can open  **BUILT 2026-08-11**

Built as its own screen, not as a promotion of the application detail. Two holes
are NAMED on the screen rather than papered over: the history is what STAFF did,
because posting a video writes no audit row, and a tier can still only be set
once at approval. Changing a tier is not built.


A creators list and a creator screen. Opening one lands on their work, not a
summary: every offer across every brand, the stage of each, what was agreed, how
much is filmed. Tabs for their videos and their history. The application screen
keeps its job as the record of a decision and gains a link across to the person.

### Step 8. The admin home tells you what today is  **BUILT 2026-08-11**

Also fixed three real defects in the activity log while in there: it never
selected subject_type so every row linked to the applications screen, its filter
skipped the leading column of its own index, and its label regex could not strip
a namespace containing an underscore.


Leads with what is waiting on us across all three queues, and will not say the
day is clear until all three are. Then what is waiting on creators, then money
across every brand, then what is at risk: brands near their budget, jobs that
have not moved in a fortnight, live offers nobody has taken. Every number links
into the screen already filtered for it. The brand list gains the one number
that should decide where an admin clicks.

---

## Defects the audit found, all confirmed in the code

**1. The requests queue quotes the wrong money.** `useOfferApplications.ts`
fetches `committed_amount`, the snapshot taken at approval, and
`OfferRequests.tsx` line 391 renders `row.offer.reward_amount` instead, which is
the offer's price today. Re-price an offer and the queue, the brand's budget and
the creator's own dashboard give two different answers about one promise. Fixed
in step 2.

**2. A job can get permanently stuck at "all filmed".**
`review_content` only carries a job to content completed when the job is at
`sample_shipped` or `content_pending` (migration `20260811160000`, line 377).
Approve the last video while the job is still at "sample requested" and it is
stuck forever: 5 of 5 approved, stage says the sample is on its way, and no
future approval can fix it because there are no videos left to approve. Nothing
re-checks afterwards. **This has to be decided before step 1**, because step 1
paints that contradiction onto six screens at once.

**3. An approved video can be un-approved and the job stays finished.**
`review_content` has no guard on the submission's previous status, so flipping an
approved video back to "needs another take" drops the approved count below what
was required while the job stays at content completed. Needs either a walk back
or a refusal.

**4. Two of the five unbuilt tabs in the creator brand hub are hover only.**
They are `disabled` buttons with a `title`, so on a phone, which is most of the
roster, five grey pills carry no explanation and cannot be reached by keyboard.
Standing rule in CLAUDE.md. Fixed in step 3, which opens that file anyway.

**One near miss worth recording.** The draft plan said an offer marked open to
everyone should show no progress. That would have reversed the fix documented at
`useAllOffers.ts` lines 133 to 152: a live request must always win over what the
offer says about itself, or an admin switching that flag hides the stage,
tracker and money of somebody already working on it. The rule is "no job row
means open to everyone", never "the flag is false". The security critic caught
it before it was written down as a step.

---

## Decisions, ruled by Rashid on 2026-08-11

**1. Deliverables freeze at approval. RULED: yes.** His words: once we have
approved, an admin should never be able to edit the number of deliverables. The
count is snapshotted onto the job at approval, exactly as `committed_amount`
already is, and never read live from the offer again. Editing an offer's video
count therefore only affects people approved after the edit, and the offer
dialog warns when creators are already on it. Needs a one time backfill for
existing approved jobs. Note the database's own completeness test currently
reads the offer live, so it moves to the snapshot in the same migration.

**2. Money means counted. Open offers never count. RULED.** His words: for
everything where money is involved it will be counted towards the offer, and it
should reflect in realtime wherever it is connected. Offers that do not need an
application are never counted towards an offer.

So the rules are:

- Progress is shown when there is a **job** behind it. Never decided from the
  `needs_application` flag, which is the mistake `useAllOffers.ts` lines 133 to
  152 already documents.
- An open to everyone offer has no job, cannot receive a video, and shows no
  progress at all. **The brand hub sentence "No application needed. Start
  posting whenever you are ready" is therefore false and is deleted in step 1**,
  not step 3.
- An offer with a reward but no fixed video count still counts, there is simply
  nothing to be short of. It says "4 posted" and draws no bar.
- **Realtime is a requirement, not a nicety.** Progress moves live on every
  screen it appears on. Creator side subscriptions pin `creator_id`, because
  delete events bypass row security and carry the whole old row.

**3. Admin screens take the current design language as they are touched.
RULED: yes.** Screen by screen, inside the step that opens the file.

**4. Releasing budget when an account closes. RULED: give back what was never
paid.** Today `budget_used` only ever goes up, so deleting a creator cascades
their jobs away and leaves the brand's committed total unchanged, permanently
shrinking an allocation for work nobody will do. From now on, closing an account
releases the committed amount of any approved job that never reached Paid, and
leaves anything that did reach Paid counted, because that money genuinely left.
Withdrawn and rejected requests never added anything, so there is nothing to
release. This lands with the brand money work in step 5, not step 1. Note the
product still prefers suspending an account to deleting one, and suspending
leaves everything intact.

### What "frozen" means, in Rashid's words, 2026-08-11

Confirmed after he read the above, because the word was doing too much work.

- **Frozen is the deal with one creator.** Once a request is approved, both
  sides have agreed a number of videos and a reward. Neither may be changed
  afterwards by editing the offer. The reward already worked this way; the video
  count is joining it.
- **The brand's budget is NOT frozen and nothing here touches it.** Approvals
  keep adding to what a brand has used, the bar keeps filling, the filters keep
  working, exactly as today.
- Editing an offer stays allowed. The next person approved gets the new terms,
  everyone already working keeps theirs.

---

## What will not be built, and why

- **Any count of other creators on a creator screen.** Silently returns 1.
- **A brand's client, budget or spend on any creator surface**, including as an
  input to a total. That separation is the only reason a creator can be shown a
  brand at all.
- **GMV or commission per video or per product.** Nothing links a video to a
  product, and multiplying a rate by anything would be a made up number on the
  one screen whose whole promise is that the numbers are real. Step 8 work.
- **Per row queries.** Every count is one grouped read over the rows on the page,
  or a view paged in the database.
- **Promoting the application screen into the creator screen.** It is keyed on a
  form somebody filled in once, and a creator can exist without one.
