# Contests

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

**Written:** 2026-08-12, from Rashid's brief plus a full audit of the schema, the
Edge Functions, the RLS split, both dashboards and the design system.
**Nothing in here is built.** This is the plan Rashid approves from, one step at
a time.

**Settled 2026-08-12.** Rashid answered the first four open product questions on
the day this was written. Q1 to Q4 in section 5 are now DECIDED, with the cost of
each recorded under it, and nothing downstream of them asks a question any more.
Two of those answers came with a promise attached, and both promises are rules in
this document rather than options: a brand's contest money is shown beside its
offer money on every surface and never merged into it (D2, rule M10), and a
creator files every kind of work through one route while staff review contest and
offer content as one job with a filter (D4, joins 14 and 16).

**Settled 2026-08-13, four more.** D5, an exclusion is scoped to one contest.
Q5, what ranks a ranked contest, deferred by choice into the performance tracking
conversation. **Q7, which is now closed and went further than the default this
plan was written to: an entry, once made, cannot be revoked by an admin at all,
so `remove_contest_entry` is cut from the whole document and rule X9 is settled
and stronger.** The consequence he accepted with it, that there is no lever to
remove a bad actor mid contest, is written out in **3.4.1** rather than left to be
discovered. And **D6**, a contest carries an optional staff-uploaded banner image,
which brings section 2.2.1 and rules B1 to B7 with it. Q6 and the raised items in
Q8 to Q10 were still open at that point; the paragraph below is what happened to
them later the same day.

**Settled 2026-08-13, second pass, after the design review.** Four more rulings
and nine corrections to this plan's own text. **D7, no creator ever sees anything
about another entrant**, which closes Q6 in its strongest form and cuts the
published standing from the design. **D8, the banner sits inside the reading
column at a fixed 3:1**, which cuts the full width strip. Plus two rulings that
correct documents rather than add features: the colour contradiction between
`docs/archive/UI_BRIEF_CONTESTS.md` and `docs/archive/UI_BRIEF_CONTESTS_HANDBACK2.md` is settled in favour
of what the designer actually built (3.12, rule C1), and the light mode contrast
failure is fixed in the layout rather than in the product wide tokens (3.12,
rules C2 to C4).

**Nine gaps the review found in THIS DOCUMENT, not in the design, are fixed in
place.** Two of them mattered: **rule X8 was not true as the policies stood**,
and it was untrue in a bigger way than the review noticed, so both `contests`
select policies changed (2.10, and the ruling under X8); and **rule L6 could not
be satisfied by the schema as drawn**, because a `timestamptz` does not preserve
the zone it was written in, so `contests` gains `expires_at_timezone` (2.2, rule
L6). The other seven are the contest indexes (2.2), the neutral state dot (rule
C4), realtime connection status (rule S9), one vocabulary (3.11), one definition
of days left (rule L15), where a sent-back video sits in the tracker (2.11, rule
W6) and the email promise coming out of the copy while `PARKED.md` items 1 and 2
are unfixed (rule W7).

**Settled 2026-08-13, third pass, after the seven agent review of design turn 3.**
Eleven rulings we made ourselves, plus three notes, because every one of them was
already decided by a rule in this document and only needed writing down: rules
**L16**, **L17**, **F8** to **F10**, **X10**, **W8**, **B8** and **C6** to **C8**,
plus notes under **L6**, **C2** and **C4** saying those three are ours to execute
rather than the designer's homework. One new token comes with them, **`--wx-scrim`
(rule C7)**, with a real value in both modes and parity enforced by the guard.
**Twelve findings from that review were checked and rejected**, and they are
recorded in **3.13** with the reason each one is wrong, so no later turn spends
itself on them again. **Four things only Rashid could answer were raised in
section 5 as AWAITING RASHID**, because until they came back the admin setup form
had no layout, and **step 1 in section 6 was split around them**: everything that
did not need that layout was buildable that day, and the list of what did was
short and named.

**Settled 2026-08-13, fourth pass. He answered all four, the same day, after the
run that recorded them had already been launched.** Q11 to Q14 are DECIDED and
nothing in this document asks them any more. **Q11, the admin types every reward
row's title, every time**, against the recommendation, so nothing anywhere
generates one (rule F11). **Q12, a half filled contest lives in the browser only**,
there is no draft row and no nullable column, and the cost, that it does not
follow an admin to another computer, is written out in rule F12 and owed to the
designer in **3.14**. **Q13 is the only real schema change of the four**:
`contests.judging_basis` is its own nullable column (2.2), REQUIRED whenever the
contest carries an active deliverable of the `rank` kind, enforced in
`save_contest` and in `save_contest_deliverable` because a CHECK cannot see
another table (rule N7).
**Q14, the setup form is a full screen of its own, not a dialog**, which changes
step 1's file list, turns join 15's modal case into a page case, and brings the
owner's admin layout rules to bear on it in full (rule F13). The entry panel for
CREATORS is untouched and stays a dialog.

Where an analyst and a reviewer disagreed, this document picks one and says
which and why. Those calls are marked **RULED HERE** and are the places worth
arguing with before anything is built.

---

## 1. What a contest is

A contest is an ongoing event that belongs to one brand and that creators ask to
be part of. An admin sets it up on the brand: a name, a description, an expiry
date, the products it covers, a content brief link, whether it needs manual
approval, the deliverables and what each one pays, and a total budget that only
an admin can see or set. A creator opens the brand, sees the contest, and taps
Apply. If the contest needs manual approval they wait for a decision; if it does
not, that tap puts them in. An admin can bar a specific creator by handle or
email, and if that person tries to apply we want to know they tried, and they
must not get in. Both sides get a real dashboard: the admin sees who applied and
when and what they were promised, the creator sees what they entered, what they
owe and what it pays.

Everything else in this document is what that paragraph costs once it has to be
true at the same time as the rest of the product.

---

## 2. The data model

Written in the idiom of `supabase/migrations/`: a comment block explaining the
decision rather than the SQL, checks on trimmed length, money as `numeric` with a
`>= 0` guard, `is_active` rather than deletion, RLS on from creation with no
write policy of any kind, explicit grants including `service_role`, and every
function revoked from `public, anon, authenticated` and granted to `service_role`
in the same breath.

Eleven tables, three views, eighteen write functions and three shared
definitions, split across five migrations in the build order in section 6. They
are presented together here so the shape can be argued with as one thing.

**The eleventh table arrived on 2026-08-13 and points the other way from the
first ten.** `contest_entry_targets` (2.6.1) holds the creator's own private
target from decision D7, and it is the first table in this product with a
creator policy and **no staff policy at all**. `contest_commercials` exists to
keep a number away from creators; this one exists to keep a number away from
staff, by exactly the same mechanism and for exactly the same reason, that
column level SELECT grants cannot separate the two when both are the Postgres
`authenticated` role.

### 2.0 Where the money lives, and the one line that decides it

**`contests` carries no budget column. The total budget lives in
`contest_commercials`, a staff-only sibling keyed on `contest_id`, because a
creator can and must read `contests`, and column level SELECT grants cannot
separate staff from creators when both are the Postgres `authenticated` role,
which is the exact reason `brand_commercials` was split off `brands` at
`supabase/migrations/20260730170000_brand_about_products_and_creator_access.sql:6-13`.**

That precedent also rejected a column-limited view in favour of the split
(`docs/DECISIONS.md`, 2026-07-30), because a view leaves the money one careless
policy away and forces every future read to remember to use it. The same
reasoning applies here with more force, not less: creators never read
`brand_commercials`' parent table with a creator policy, they will read
`contests` on day one.

**RULED HERE, currency.** `brand_commercials` carries its own `currency` column
that denominates only the budget, and `budget_used` then adds an offer's
`reward_amount` into it with no check that they match
(`20260811200000_deliverables_freeze_and_job_progress.sql:148-152`). Contests do
not repeat that. `contests.currency` is the single currency dimension for the
whole contest, creator readable, and `contest_commercials.total_budget` has no
currency of its own: it is denominated in `contests.currency` by definition. One
column cannot disagree with another column that does not exist.

**RULED HERE, no maintained running total.** `brand_commercials.budget_used` is a
maintained total with exactly one writer, and `scripts/ops/reconcile-budgets.mjs`
exists only because a hand cleanup made it drift
(`docs/FEATURE_MAP.md:541-547`). Contests keep no `budget_used` column at all.
Every contest money figure is derived by summing the frozen per entrant rows,
through the staff-only `contest_totals` view. The cap and budget checks that need
a number inside a transaction take the contest row `for update` and sum the rows
under that lock, which is exactly as correct and cannot drift. The cost is one
aggregate per read instead of one column read; the indexes in 2.11 pay for it.

**RULED HERE, two honest figures rather than one misleading one.** Rashid decided
on 2026-08-12 that a contest budget is its own separate pot:
`contest_commercials.total_budget` is its own allocation and
`brand_commercials.budget_used` keeps meaning offers only, with its single writer
(section 5, decision 2). The accepted cost is that a brand's true exposure is now
two numbers, and the mitigation he was promised in return is binding here. **Every
surface that shows a brand's committed money shows the contest money beside it, in
its own clearly labelled block, never added into the offer figure and never left
off.** The eighty percent warning on the brand budget bar continues to mean offers
only and says so in words. `brand_contest_totals` in 2.11 exists to make that
second block cheap enough that nobody is tempted to skip it. One column cannot
disagree with another column that does not exist; two figures side by side, each
saying what it counts, cannot disagree either. One figure standing in for both
can, and that is the only failure this rule is written against.

### 2.1 Enums

```sql
-- Mirrors offer_status exactly, because Rashid's word for this axis is
-- "active or not". Settlement and cancellation are timestamps with an actor,
-- not enum values, so the switch on the form keeps meaning one thing.
create type public.contest_status as enum ('active', 'inactive');

create type public.contest_entry_status as enum (
  'pending',
  'approved',
  'rejected',
  /*
   * The creator changed their mind. Kept rather than deleted, the same reason
   * offer_applications keeps 'withdrawn'. This is the ONLY way a live entry
   * leaves the live set, and only the creator themselves can cause it.
   *
   * There is deliberately no 'removed'. That value existed to record an admin
   * pulling a live entrant out, and Rashid ruled on 2026-08-13 that no such
   * action exists anywhere in the product (Q7, rule X9), which leaves nothing
   * that could ever write it. An enum value nothing can write is a promise an
   * admin screen will eventually try to keep. See 3.4.1 for the risk that
   * ruling knowingly accepts.
   */
  'withdrawn'
);

/*
 * The three shapes "deliverables with rewards" turned out to mean, in one
 * type, so that none of them is a migration later.
 *
 *   fixed      post N videos, get paid X. Time boxed by the contest expiry.
 *   rank       finish Nth by some measure, get paid X.
 *   milestone  reach a threshold on some measure, get paid X.
 *
 * A contest may hold any mixture. Decided by Rashid on 2026-08-12: the admin
 * adds as many deliverable-and-reward rows as they like, and a row is either
 * something you do or a place you finish in. See section 5, decision 1.
 */
create type public.contest_deliverable_kind as enum ('fixed', 'rank', 'milestone');
```

### 2.2 `contests`

```sql
create table public.contests (
  id uuid primary key default gen_random_uuid(),

  -- Cascades, the same as offers. A contest for a brand that no longer exists
  -- means nothing, and audit_log keeps the record of what it was. delete_brand
  -- does not exist; a brand is retired, never deleted.
  brand_id uuid not null references public.brands (id) on delete cascade,

  name text not null check (length(trim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 4000),

  /*
   * HOW THIS CONTEST IS JUDGED, in the admin's own words. Decided by Rashid on
   * 2026-08-13, Q13, and it is the only schema change the four answers of that
   * day carried.
   *
   * Named for what it is rather than for the screen it appears on. It is the
   * BASIS a placing is decided on, so it stays right if the creator surface is
   * redrawn, and nothing later has to explain why a column is called after a
   * panel that no longer exists.
   *
   * Creator readable, like every other column on this table, and deliberately
   * NOT commercial: it is the sentence rule N5 counts as one of exactly three
   * sources of motivation on a live contest, so it belongs where a creator can
   * read it in the same select that draws the contest.
   *
   * Nullable HERE, and required by a function rather than by a constraint. A
   * contest carrying any ACTIVE deliverable of the `rank` kind must have it,
   * because with Q5 deferred this sentence is the only thing standing in for a
   * scoreboard and a placing with no stated basis is the one thing that would
   * make a contest feel arbitrary. A CHECK constraint cannot see another table,
   * so the requirement is enforced in save_contest AND in
   * save_contest_deliverable, both directions, since either one could create
   * the illegal combination. See rule N7.
   *
   * Trimmed length in the idiom cancel_message uses, not the raw <= idiom
   * description uses, because a sentence made of spaces is exactly the value a
   * form leaves behind when somebody tabs through the field.
   */
  judging_basis text check (
    judging_basis is null or length(trim(judging_basis)) between 1 and 600
  ),

  /*
   * The content brief. Staff write it, every entrant clicks it, so it is a
   * one to many surface and gets the same check content_submissions.video_url
   * carries: https only, bounded, no javascript: or data: URL can ever reach a
   * creator's screen through it.
   */
  brief_url text check (
    brief_url is null
    or (brief_url ~* '^https://' and length(brief_url) between 12 and 2048)
  ),

  /*
   * Optional banner artwork, uploaded by a staff member inside the contest
   * setup form. Decided by Rashid on 2026-08-13, decision 6. Same URL check as
   * brief_url and for the same reason: it is a string an admin supplies that
   * every entrant's browser then fetches.
   *
   * It sits HERE, on contests, and NOT on contest_commercials, because a
   * banner is not commercial information. contest_commercials exists for one
   * job, keeping the total budget out of a creator read path; the artwork is
   * the exact opposite of that, it is the part of a contest we most want a
   * creator to see. Putting it behind the staff-only sibling would force a
   * second, staff-only read on every creator surface that draws a contest, and
   * would end with somebody widening a policy on the budget table to make a
   * picture load.
   *
   * Nullable, and NULL is the normal case rather than a fallback: the database
   * is empty and the first contests will have none. See rules B1 to B7.
   *
   * There is deliberately no aspect ratio, no width and no height column. The
   * crop is OURS and it is one crop everywhere, 3:1 inside the reading column
   * (decision D8, rule B4). A stored ratio would be a second place for that
   * fact to live and the first thing somebody would widen for one contest.
   */
  banner_url text check (
    banner_url is null
    or (banner_url ~* '^https://' and length(banner_url) between 12 and 2048)
  ),

  status public.contest_status not null default 'inactive',

  -- Defaults to the safe side, exactly as offers.needs_application does.
  needs_admin_approval boolean not null default true,

  /*
   * timestamptz, and the admin sets a date AND a time. Wurx targets US and UK
   * creators while the team sits in one place, so a date-only expiry would
   * close at three different moments for three people and the client and the
   * server would disagree about who got in.
   */
  opens_at timestamptz not null default now(),
  expires_at timestamptz not null,

  /*
   * THE ZONE THE DEADLINE WAS SET IN. Added 2026-08-13, gap 2.
   *
   * Rule L6 requires every creator facing deadline to name its timezone, and
   * the design's own mock data legitimately carries two, "11:59pm BST" on one
   * contest and "11:59pm PDT" on another. A timestamptz cannot serve that: it
   * stores one instant in UTC and throws away the offset it was written with,
   * so "31 Aug 23:59 Europe/London" and "31 Aug 15:59 America/Los_Angeles" are
   * the SAME VALUE and nothing in the row can tell them apart afterwards. L6
   * was unsatisfiable by the schema as drawn.
   *
   * An IANA zone name, not an offset and not an abbreviation. An offset is
   * wrong twice a year: this contest closes at 11:59pm BST in August and
   * 11:59pm GMT in December, and the stored zone is 'Europe/London' both
   * times. The abbreviation is DERIVED at render time from the instant plus
   * this zone, which is the only way it can be right on both sides of a
   * clock change.
   *
   * ONE zone per contest, applying to opens_at as well as expires_at. Two
   * columns would be two things that can disagree, and no admin has ever
   * wanted a contest that opens in London and closes in Los Angeles.
   *
   * NOT nullable and no silent default at the database level beyond this one:
   * a contest whose deadline names no zone is exactly the support call L6 was
   * written against, so there must be no way to write one. The value is
   * validated against pg_timezone_names inside save_contest rather than in a
   * check constraint, because that catalogue lookup is not immutable and
   * Postgres will not accept it in a CHECK.
   */
  expires_at_timezone text not null default 'Europe/London'
    check (length(trim(expires_at_timezone)) between 3 and 64),

  /*
   * The single currency dimension of the whole contest. Every deliverable
   * reward and the total budget are quoted in it. Nothing in the product may
   * ever add across two of these.
   */
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),

  -- Settlement and cancellation are terminal, have an actor, and have a time.
  -- Two values in a status enum could not carry either.
  settled_at timestamptz,
  settled_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  /*
   * MESSAGE, not reason. Ruled 2026-08-13, see decision D14.
   *
   * Every column on this table is creator facing, and the cancel screen labels
   * this field as what the entrants will read. A field called "reason" invites
   * somebody to type "client pulled the budget" into a box two creators open.
   * The exclusion table keeps its own "reason" column, correctly, because that
   * one is staff only.
   */
  cancel_message text check (
    cancel_message is null or length(trim(cancel_message)) between 1 and 500
  ),

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (expires_at > opens_at),
  check (settled_at is null or cancelled_at is null),
  check ((settled_at is null) = (settled_by is null)),
  check ((cancelled_at is null) = (cancelled_by is null)),

  -- Lets contest_products carry a composite foreign key, so a product from
  -- another brand cannot be attached even by a direct service-key write.
  unique (id, brand_id)
);

/*
 * INDEXES. Added 2026-08-13, gap 3. The table had none proposed, while the
 * default sort on every contest surface is the expiry column and the row
 * security predicate calls a function per row.
 */

-- Every admin surface and every creator hub tab reads one brand's contests,
-- newest deadline order. Leading column is the FK, which CLAUDE.md requires
-- indexing anyway, and the second column serves the sort inside it.
create index contests_brand_idx on public.contests (brand_id, expires_at);

-- "Closing soonest", the default order on the creator contests screen, over
-- the only rows that can appear on it. Partial, so it stays small for ever:
-- settled and cancelled contests leave the index rather than accumulating in
-- it, and a year of dead contests costs nothing.
create index contests_soonest_idx on public.contests (expires_at)
  where status = 'active' and settled_at is null and cancelled_at is null;
```

**RULED HERE, the per row function calls in the policy, and what actually pays
for them.** `contests_select_creator` calls `contest_is_open(id)` and (from
2026-08-13) `contest_excludes_caller(id)` once per candidate row. Neither can be
inlined, because both are `security definer` and Postgres never inlines a definer
function, so an index on `expires_at` cannot be substituted for them however the
predicate is spelled. Three things make that affordable and they are all
required, not optional:

1. **Both functions are single primary key probes.** `contest_is_open` is one
   lookup on `contests` and one on `brands`; `contest_excludes_caller` is one
   lookup on `contest_exclusions_user_idx`. Neither scans.
2. **The candidate set is bounded before the policy runs.** Equality on `uuid`
   is leakproof, so a user qual of `brand_id = eq.<id>` or `id = eq.<id>` is
   evaluated ahead of the policy quals and `contests_brand_idx` serves it. **So
   every creator side contest read carries a brand filter or an id filter, or
   is paged.** A bare `select * from contests` from a creator's token evaluates
   two definer calls for every contest in the product, and that is the read
   that gets slower every month.
3. **`contest_excludes_caller` short circuits on the pinned uuid** and only
   falls through to the handle and email comparison when the contest actually
   carries an unresolved exclusion, which rule X3 says is the temporary case.

```sql
comment on table public.contests is
  'A brand''s contest. Every column here is creator facing by design. The total budget is deliberately NOT here: it is in contest_commercials, staff only.';
```

### 2.2.1 Where the banner file lives, and why there is no new bucket

**No storage migration ships with this feature.** The banner is uploaded into
`brand-assets`, exactly as it was migrated at
`supabase/migrations/20260730170100_brand_assets_storage.sql`, with every
property that file already set:

- **Public read.** One policy, `brand_assets_read`, with no owner test at all.
- **Staff-only write.** Insert, update and delete are three separate policies,
  all gated on the same `public.is_staff()` as the rest of the admin panel.
- **2 MB.** `file_size_limit` is 2097152 on the bucket, and
  `src/lib/admin/useImageUpload.ts` repeats the check in the browser so an admin
  who picks a 9 MB photo is told before the upload rather than after it.
- **`image/png`, `image/jpeg`, `image/webp`, and nothing else.**
- **No SVG, deliberately.** An SVG is a script host. The bucket's
  `allowed_mime_types` omits it and `ACCEPTED_TYPES` omits it, and neither list
  gains it for a contest banner.

**A separate `contest-banners` bucket was considered and rejected.** It would
have carried the identical four policies, the identical size limit and the
identical MIME list, so it buys one thing only, a second place for those five
facts to be kept in step. The one argument for it, different retention or
different privacy for contest artwork, is not a thing anybody has asked for, and
the day it is asked for the bucket can be added then with a real reason attached
to it. Files go under a `contests/<contest_id>` folder, the same shape brand
logos and product images already use, so a contest's artwork is still findable
without a table to look it up in.

**The bucket is PUBLICLY READABLE, so nothing commercial may appear in the
artwork.** Anybody holding the URL fetches the file with no token, and a banner
URL sits on a row every approved creator can read. So the image must never carry
the total budget, an internal note, a client's name that is not already public, a
margin, a rate card, or a screenshot of an admin screen. This is a rule about
what staff put in a picture, which no check constraint can enforce, so it is
written into the upload control's helper text as well as here. It is the same
sentence the brand assets migration already carries, "Nothing private is ever
placed here", pointed at a field where the temptation is larger because a banner
is where a contest gets sold.

### 2.3 `contest_commercials`, staff only

```sql
create table public.contest_commercials (
  -- Primary key as well as foreign key: there is no such thing as two budgets
  -- for one contest. Same shape as brand_commercials.
  contest_id uuid primary key references public.contests (id) on delete cascade,

  /*
   * Denominated in contests.currency. No currency column here on purpose: a
   * second currency column is a second thing that can disagree, and
   * brand_commercials.currency versus offers.currency is already the one place
   * in the product where money is added across two.
   */
  total_budget numeric(14, 2) check (total_budget is null or total_budget >= 0),

  -- Internal only. Never rendered on any creator surface.
  internal_note text check (internal_note is null or length(internal_note) <= 2000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contest_commercials is
  'The contest''s total budget and internal note. Staff only, and deliberately NOT part of the contests table, so a creator read path cannot reach it by accident. There is NO creator policy here and there must never be one.';
```

### 2.4 `contest_deliverables`, the definition

```sql
create table public.contest_deliverables (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,

  kind public.contest_deliverable_kind not null,

  /*
   * THE ADMIN TYPES THIS, EVERY TIME. Decided by Rashid on 2026-08-13, Q11,
   * against the recommendation, which had been to generate a title from the
   * row's own numbers and let him override it.
   *
   * The column is unchanged by that answer and always was going to be: both
   * answers wrote the same column. What the answer settles is that NOTHING
   * generates a value for it, ever. Not the client, not the Edge Function, not
   * a database default, not a fallback at render time. The trimmed length check
   * is therefore load bearing rather than cosmetic: it is what refuses a row
   * whose title is spaces, which is what a form leaves behind when somebody
   * tabs through the field. See rule F11.
   */
  title text not null check (length(trim(title)) between 1 and 160),
  detail text check (detail is null or length(detail) <= 1000),

  -- kind = 'fixed'
  video_count integer check (video_count is null or video_count between 1 and 1000),

  -- kind = 'rank'. 1 is first place.
  rank_position integer check (rank_position is null or rank_position between 1 and 1000),

  -- kind = 'milestone'. `metric` is a label, not a computed field: see
  -- section 5, question 5. Nothing in this product measures GMV yet.
  metric text check (metric is null or length(trim(metric)) between 1 and 40),
  threshold numeric(14, 2) check (threshold is null or threshold >= 0),

  reward_amount numeric(12, 2) check (reward_amount is null or reward_amount >= 0),

  sort_order integer not null default 0,

  -- Soft disable, never delete, because entrants have snapshotted these rows.
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (kind <> 'fixed' or video_count is not null),
  check (kind <> 'rank' or rank_position is not null),
  check (kind <> 'milestone' or (metric is not null and threshold is not null))
);

-- Two people cannot both be second place.
create unique index contest_deliverables_rank_idx
  on public.contest_deliverables (contest_id, rank_position)
  where kind = 'rank' and is_active;

create index contest_deliverables_contest_idx
  on public.contest_deliverables (contest_id, sort_order, created_at);

comment on table public.contest_deliverables is
  'What a contest asks for and what each thing pays. Three kinds in one table so a fixed job, ranked prizes and a mixed list all fit without a migration.';
```

**RULED HERE, against jsonb.** An analyst proposed freezing the terms as a jsonb
array so all three shapes fit one column. Rejected. Money in this product is
`numeric(12,2)` with a `>= 0` check and a currency with a `^[A-Z]{3}$` check,
and none of that is expressible per element inside jsonb; `contest_totals` has
to `sum()` committed rewards per currency, which over jsonb means a lateral
`jsonb_array_elements` on every entry; and the only jsonb in the schema today is
`audit_log.detail`, which is deliberately never queried. The `kind` enum with
nullable columns and three check constraints expresses all three shapes without a
migration and keeps every guarantee the rest of the product relies on.

### 2.5 `contest_products`, the dropdown, enforced

```sql
create table public.contest_products (
  contest_id uuid not null references public.contests (id) on delete cascade,

  -- RESTRICT, not cascade. A product cannot be deleted out from under a live
  -- contest. delete_product also gains a human-readable refusal (2.10), but
  -- this is the guarantee that holds against a direct service-key delete,
  -- which is exactly the gap delete_offer's function-only protection leaves.
  product_id uuid not null references public.brand_products (id) on delete restrict,

  brand_id uuid not null references public.brands (id) on delete cascade,

  -- Snapshotted, so deactivating or renaming a product never blanks the brief
  -- an entrant is working to.
  product_name text not null check (length(trim(product_name)) between 1 and 160),
  external_product_id text not null check (length(trim(external_product_id)) between 1 and 64),

  created_at timestamptz not null default now(),

  primary key (contest_id, product_id),

  -- The product must belong to the contest's brand, and the contest must
  -- belong to that same brand. Declarative, not a check somebody can forget.
  foreign key (product_id, brand_id) references public.brand_products (id, brand_id),
  foreign key (contest_id, brand_id) references public.contests (id, brand_id)
);

-- brand_products.id is already the primary key, so this is free, and it is what
-- makes the composite foreign key above legal.
alter table public.brand_products add constraint brand_products_id_brand_key
  unique (id, brand_id);

create index contest_products_product_idx on public.contest_products (product_id);
```

### 2.6 `contest_entries`

```sql
create table public.contest_entries (
  id uuid primary key default gen_random_uuid(),

  contest_id uuid not null references public.contests (id) on delete cascade,

  -- Denormalised from the contest so the admin queue filters by brand without
  -- a join, and so a row still says which brand it belonged to. Same reason
  -- offer_applications.brand_id exists.
  brand_id uuid not null references public.brands (id) on delete cascade,

  creator_id uuid not null references public.profiles (id) on delete cascade,

  -- Who they were when they entered. Snapshotted, never joined from profiles,
  -- so the queue still reads correctly after a rename or a closed account and
  -- search stays one trigram index on one table.
  creator_handle text,
  creator_name text,
  creator_email text,

  status public.contest_entry_status not null default 'pending',

  -- True when the contest was on auto approve at the moment they entered. The
  -- flag on the contest can be changed afterwards; this cannot.
  auto_approved boolean not null default false,

  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),

  /*
   * Frozen at approval, exactly as committed_amount and committed_video_count
   * are on a job. This is the sum of the FIXED deliverable rewards only.
   * Ranked and milestone rewards are contingent and commit at settlement into
   * contest_awards, because at approval nobody knows who won.
   */
  committed_amount numeric(12, 2) check (committed_amount is null or committed_amount >= 0),
  committed_video_count integer
    check (committed_video_count is null or committed_video_count > 0),

  note text check (note is null or length(note) <= 1000),

  -- There is no self_target column HERE, and there must never be one. The
  -- creator's own private target lives in contest_entry_targets (2.6.1),
  -- because staff can select every column of this table and the target is the
  -- one number in the feature staff must not be able to read. Same argument as
  -- contest_commercials in 2.0, pointed the other way.

  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),

  -- There is no removed_reason column. It existed to carry the reason an admin
  -- pulled a live entrant out, and that action was cut on 2026-08-13 (Q7, rule
  -- X9), so the column has no writer. A reason field with nothing to explain is
  -- how a removal action gets rebuilt by somebody who finds it.

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/*
 * One live entry per creator per contest. Partial, not a plain constraint, and
 * this is what lets somebody rejected in March enter again in June, or somebody
 * who withdrew change their mind. What must not happen is two open entries.
 * Copied verbatim in shape from offer_applications_one_open_idx.
 */
create unique index contest_entries_one_open_idx
  on public.contest_entries (contest_id, creator_id)
  where status in ('pending', 'approved');

create index contest_entries_queue_idx on public.contest_entries (status, created_at desc);
create index contest_entries_contest_idx on public.contest_entries (contest_id, status);
create index contest_entries_brand_idx on public.contest_entries (brand_id, status);
create index contest_entries_creator_idx on public.contest_entries (creator_id, created_at desc);
create index contest_entries_handle_trgm_idx
  on public.contest_entries using gin (creator_handle extensions.gin_trgm_ops);
```

Note what is **not** on this row: no rank, no rank-out-of-N, no entrant count, no
budget-derived figure. A rank of 3 of 14 is a fact about thirteen other people
delivered through a row the creator is allowed to read, and
`20260731093000_offer_applications.sql:126-127` currently says "No policy lets
anybody see what another creator asked for, or what they were paid." That
sentence stays true.

**Since D7 on 2026-08-13 that is a ruling rather than a preference, and it now
covers contests explicitly.** A creator never sees a headcount of entrants, never
sees another person's approved count, and never sees their position in a field. A
bare placing is the one exception and it is not an exception to the sentence
above, because "you placed 5th" is the creator's own result and names nobody. See
rules N1 to N6, and note that the placing has a cost at settlement which is paid
in `contest_awards`, 2.9.

### 2.6.1 `contest_entry_targets`, the creator's own private number

```sql
/*
 * The self set target from design direction 2E, the direction D7 chose. One
 * number per entry, set by the creator, meaning "I am going for six approved
 * videos by the deadline". It is the ONLY genuinely new thing that design
 * needs stored, and it exists because with every fact about other entrants
 * removed, this is what is left to compete against.
 *
 * ITS OWN TABLE, and this is the whole point of it.
 *
 * contest_entries carries contest_entries_select_staff, an unrestricted
 * is_staff() SELECT over every column, and a column level SELECT grant cannot
 * take one column back off staff while leaving it with creators, because both
 * are the Postgres `authenticated` role. That is the same sentence as 2.0 and
 * the same sentence as brand_commercials at
 * 20260730170000_brand_about_products_and_creator_access.sql:6-13; only the
 * direction is reversed. So the target goes in a sibling with ONE policy on
 * it, the creator's own, and NO staff policy of any kind.
 *
 * WHY STAFF MUST NOT READ IT, since it is unusual in this product. The screen
 * that asks for it says, in words, "Nobody else sees it and you can change it
 * any time." If an admin can pull it up on the entries queue that sentence is
 * a lie told by us, on our own screen, to the person whose transparency is
 * the product. It is also worthless the moment it is visible: a private
 * commitment a creator will be judged on is a quota, and they would set it low
 * or not set it at all. There is no admin question that needs this number.
 */
create table public.contest_entry_targets (
  -- Primary key as well as foreign key: one target per entry, and changing it
  -- is an update rather than a second row, so there is no history to leak.
  entry_id uuid primary key references public.contest_entries (id) on delete cascade,

  -- Denormalised so the read policy never has to reach into contest_entries,
  -- which is the table the policy is protecting this row FROM.
  creator_id uuid not null references public.profiles (id) on delete cascade,

  -- A count of approved videos, the only measure this product can truthfully
  -- track today. Same bound as contest_deliverables.video_count, so a target
  -- can never be a number the contest could not accept.
  target integer not null check (target between 1 and 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The creator's own read of "all my targets" across contests, for the one
-- query that draws them on the creator home.
create index contest_entry_targets_creator_idx
  on public.contest_entry_targets (creator_id);

comment on table public.contest_entry_targets is
  'A creator''s own private target for one contest entry. There is NO staff policy on this table and there must never be one: the screen that collects it promises nobody else sees it. It appears in no view, in no rollup, in no audit_log detail and in no Edge Function response that is not returning it to the person who set it.';
```

### 2.7 `contest_entry_terms`, the frozen promise

```sql
create table public.contest_entry_terms (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.contest_entries (id) on delete cascade,

  -- SET NULL, not cascade. Retiring or removing a deliverable must never blank
  -- what somebody already agreed to, so every field below is copied, not
  -- joined, and this pointer is a convenience only.
  deliverable_id uuid references public.contest_deliverables (id) on delete set null,

  kind public.contest_deliverable_kind not null,
  title text not null check (length(trim(title)) between 1 and 160),
  detail text check (detail is null or length(detail) <= 1000),
  video_count integer check (video_count is null or video_count between 1 and 1000),
  rank_position integer check (rank_position is null or rank_position between 1 and 1000),
  metric text check (metric is null or length(trim(metric)) between 1 and 40),
  threshold numeric(14, 2) check (threshold is null or threshold >= 0),
  reward_amount numeric(12, 2) check (reward_amount is null or reward_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),

  created_at timestamptz not null default now()
);

create index contest_entry_terms_entry_idx on public.contest_entry_terms (entry_id);

comment on table public.contest_entry_terms is
  'What one entrant was promised, copied at the moment they were approved and never read live from the contest again. Rashid, 2026-08-11: once we have approved, an admin should never be able to edit the number of deliverables.';
```

### 2.8 `contest_exclusions`, staff only

```sql
create table public.contest_exclusions (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,

  /*
   * Three ways to name somebody, and only ONE of them is durable.
   *
   *   user_id  the only key that cannot be changed by the person being barred.
   *   email    profiles.email is not in the column-level UPDATE grant, but it
   *            IS synced from auth.users by on_auth_user_email_changed
   *            (20260729145631:212-232), so a creator CAN change it.
   *   handle   applications.tiktok_handle carries a standing column-level
   *            UPDATE grant to authenticated (20260729153108:107-108) and the
   *            guard trigger there protects only the review columns. A creator
   *            can rename their handle from the browser console.
   *
   * So handle and email exist to close the case where the person has no
   * account yet. save_contest_exclusion resolves them to a user_id the moment
   * it can and PINS it; from then on only the uuid is compared.
   */
  handle text check (handle is null or length(trim(handle)) between 1 and 64),
  email text check (email is null or length(trim(email)) between 3 and 320),
  user_id uuid references public.profiles (id) on delete set null,

  reason text check (reason is null or length(trim(reason)) between 1 and 500),

  -- "Track them differently" without an unbounded row per tap: a counter, not
  -- an entry row. See the rules in 3.4.
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (handle is not null or email is not null or user_id is not null)
);

create unique index contest_exclusions_user_idx
  on public.contest_exclusions (contest_id, user_id) where user_id is not null;
create unique index contest_exclusions_email_idx
  on public.contest_exclusions (contest_id, lower(email)) where email is not null;
create unique index contest_exclusions_handle_idx
  on public.contest_exclusions (contest_id, lower(handle)) where handle is not null;
```

### 2.9 `contest_entry_events`, `contest_submissions`, `contest_awards`

```sql
/*
 * Creator readable history, the counterpart of offer_stage_events. audit_log is
 * staff only, so anything a creator should be able to see about their own entry
 * goes here, with creator_id denormalised so the read policy never has to reach
 * into another table.
 */
create table public.contest_entry_events (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.contest_entries (id) on delete cascade,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (length(trim(kind)) between 3 and 40),
  note text check (note is null or length(note) <= 500),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index contest_entry_events_entry_idx
  on public.contest_entry_events (entry_id, created_at desc);
create index contest_entry_events_creator_idx
  on public.contest_entry_events (creator_id, created_at desc);

/*
 * Contest deliverables get their OWN submission path. Decided by Rashid on
 * 2026-08-12. See section 5, decision 4, for why content_submissions cannot
 * absorb them, and for the two things that decision obliges: ONE creator route
 * for filing any work, and two review queues that read as one job with a filter.
 */
create table public.contest_submissions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.contest_entries (id) on delete cascade,
  contest_id uuid not null references public.contests (id) on delete cascade,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  creator_handle text,
  creator_name text,
  video_url text not null
    check (video_url ~* '^https://' and length(video_url) between 12 and 2048),
  ad_code text not null check (length(trim(ad_code)) between 3 and 120),
  ad_authorized boolean not null default false,
  status public.content_status not null default 'submitted',
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  thumbnail_url text,
  video_title text,
  video_author text,
  embed_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, video_url)
);

create index contest_submissions_entry_idx on public.contest_submissions (entry_id, status);
create index contest_submissions_contest_idx on public.contest_submissions (contest_id, status);
create index contest_submissions_creator_idx on public.contest_submissions (creator_id, created_at desc);

/*
 * Settlement. A SECOND money event with its own moment of truth, because a rank
 * cannot be known at approval. Its own snapshot, its own uniqueness, its own
 * status guard, because this project has no idempotency keys anywhere and a
 * double click on Settle would otherwise pay the pot twice.
 *
 * CHANGED 2026-08-13 BY D7, and this is the cost of keeping "You placed 5th".
 * D7 removes every fact about other entrants from every creator surface, and
 * the one thing kept is a creator's own placing, because it is their own
 * result and names nobody. But a placing cannot be derived on the creator's
 * screen without a ranking, and a ranking is the exact object D7 forbids
 * existing. So the placing has to be a stored fact about ONE entry, written by
 * staff at settlement, and it has to be written for EVERY entrant rather than
 * only the ones being paid, or the fifth place finisher has nothing to read.
 *
 * That turns this table from an awards table into a SETTLEMENT OUTCOME table
 * that also carries money. Two shapes of row, and the checks below are what
 * keep them from blurring:
 *
 *   OUTCOME row.  term_id IS NULL, awarded_amount = 0, placement carries their
 *                 place (or NULL on a contest with no ranked deliverable, where
 *                 nobody placed in anything). Exactly ONE per entry, always
 *                 written, and it is also the idempotency guard for the whole
 *                 settlement.
 *   MONEY row.    term_id NOT NULL, awarded_amount > 0, placement NULL. One per
 *                 (entry, term) as before. Only for entrants who won something.
 *
 * Keeping money off the outcome row is what stops brand_contest_totals
 * double counting: an entrant who placed 1st has an outcome row worth 0 and a
 * money row worth the prize, and sum(awarded_amount) is still the prize.
 */
create table public.contest_awards (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests (id) on delete cascade,
  entry_id uuid not null references public.contest_entries (id) on delete cascade,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  term_id uuid references public.contest_entry_terms (id) on delete set null,
  placement integer check (placement is null or placement between 1 and 1000),
  awarded_amount numeric(12, 2) not null check (awarded_amount >= 0),
  awarded_currency text not null check (awarded_currency ~ '^[A-Z]{3}$'),
  note text check (note is null or length(note) <= 500),
  awarded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  -- An outcome row carries no money. Money is always attached to the frozen
  -- term it was promised by, so every payment can be traced to a sentence the
  -- creator agreed to.
  check (term_id is not null or awarded_amount = 0),

  -- A placing is only ever on the outcome row. Two rows carrying a placing for
  -- one entrant is how "you placed 5th" becomes "you placed 5th and 2nd".
  check (placement is null or term_id is null)
);

/*
 * The money uniqueness, unchanged in meaning. Written as a partial unique
 * INDEX rather than a table constraint because it now has to exclude the
 * outcome rows, whose term_id is NULL.
 */
create unique index contest_awards_money_idx
  on public.contest_awards (contest_id, entry_id, term_id)
  where term_id is not null;

/*
 * ONE outcome row per entrant, and this is the double-click guard for
 * settlement as a whole. The old `unique (contest_id, entry_id, term_id)`
 * would NOT have caught it: Postgres treats NULLs as distinct in a unique
 * constraint by default, so two clicks on Settle would have written two
 * outcome rows per entrant and told nobody.
 */
create unique index contest_awards_outcome_idx
  on public.contest_awards (contest_id, entry_id)
  where term_id is null;

-- Two people cannot both be fifth. The same shape as
-- contest_deliverables_rank_idx, and it is what makes the admin's typed
-- placings a set rather than a list of opinions.
create unique index contest_awards_placement_idx
  on public.contest_awards (contest_id, placement)
  where placement is not null;

create index contest_awards_contest_idx on public.contest_awards (contest_id);
create index contest_awards_entry_idx on public.contest_awards (entry_id);
create index contest_awards_creator_idx on public.contest_awards (creator_id, created_at desc);
```

**What the outcome row changes about the policies, which is nothing, and that is
the point.** `contest_awards_select_own` in 2.10 already reads
`creator_id = auth.uid()`, so an entrant reads their own outcome row and no
other, and adding a row for every entrant does not widen it by one byte. No new
policy is needed and none may be added: an outcome row per entrant is exactly
the shape somebody would later be tempted to expose as a standings table, so the
absence of any cross-entrant read here is now rule N4 rather than an accident of
which policies got written.

**What it changes about the admin settle flow.** The screen no longer collects
"who won what". It collects an outcome for every approved entrant, and the
function refuses to settle while any approved entry has no outcome, so a
contest cannot half settle. On a contest with no ranked deliverable the outcome
is a placing of NULL for everybody, which still writes the row, which is what
makes `settle_contest` idempotent even on a milestone-only contest.

### 2.10 Row security, grants, realtime

```sql
alter table public.contests               enable row level security;
alter table public.contest_commercials    enable row level security;
alter table public.contest_deliverables   enable row level security;
alter table public.contest_products       enable row level security;
alter table public.contest_entries        enable row level security;
alter table public.contest_entry_targets  enable row level security;
alter table public.contest_entry_terms    enable row level security;
alter table public.contest_exclusions     enable row level security;
alter table public.contest_entry_events   enable row level security;
alter table public.contest_submissions    enable row level security;
alter table public.contest_awards         enable row level security;

-- ---------------------------------------------------------------- staff ---
create policy "contests_select_staff" on public.contests
  for select to authenticated using (public.is_staff());
create policy "contest_commercials_select_staff" on public.contest_commercials
  for select to authenticated using (public.is_staff());
create policy "contest_deliverables_select_staff" on public.contest_deliverables
  for select to authenticated using (public.is_staff());
create policy "contest_products_select_staff" on public.contest_products
  for select to authenticated using (public.is_staff());
create policy "contest_entries_select_staff" on public.contest_entries
  for select to authenticated using (public.is_staff());
create policy "contest_entry_terms_select_staff" on public.contest_entry_terms
  for select to authenticated using (public.is_staff());
create policy "contest_exclusions_select_staff" on public.contest_exclusions
  for select to authenticated using (public.is_staff());
create policy "contest_entry_events_select_staff" on public.contest_entry_events
  for select to authenticated using (public.is_staff());
create policy "contest_submissions_select_staff" on public.contest_submissions
  for select to authenticated using (public.is_staff());
create policy "contest_awards_select_staff" on public.contest_awards
  for select to authenticated using (public.is_staff());

/*
 * There is NO creator policy on contest_commercials, and there must never be
 * one. That table is the reason the split exists.
 *
 * There is NO creator policy on contest_exclusions either. It names people and
 * states an internal judgement about them, which is a defamation-shaped leak
 * rather than a data leak.
 *
 * AND, THE OTHER DIRECTION: there is deliberately no
 * contest_entry_targets_select_staff above, and there must never be one. That
 * table is the ONLY object in this feature staff cannot read, and 2.6.1 says
 * why. Note that the absence is silent, which is the danger: adding the staff
 * policy would look exactly like completing a list, and every other line in
 * this block is one. It is called out here so the omission reads as a decision
 * rather than as a line somebody forgot to type. See rules T1 to T5.
 */

-- -------------------------------------------------------------- creators ---
/*
 * is_approved_creator(), never is_staff(). The JWT refreshes about once an
 * hour, so a creator approved thirty seconds ago is still carrying 'applicant'
 * and would watch their approval land and then find an empty contests screen
 * for up to an hour.
 *
 * TWO policies, not one, and they are different predicates on purpose:
 * openness decides what may be BROWSED, and an existing entry decides what may
 * be READ. See rule L1 in section 3.
 *
 * BOTH CARRY THE EXCLUSION CLAUSE, added 2026-08-13 as the fix for gap 1. See
 * the ruling under rule X8 for why it went here rather than in the function or
 * in the rule, and for the cost it accepts.
 */
create policy "contests_select_creator" on public.contests
  for select to authenticated
  using (
    (select public.is_approved_creator())
    and public.contest_is_open(id)
    and not public.contest_excludes_caller(id)
  );

create policy "contests_select_own_entries" on public.contests
  for select to authenticated
  using (
    exists (
      select 1 from public.contest_entries e
      where e.contest_id = contests.id and e.creator_id = (select auth.uid())
    )
    and not public.contest_excludes_caller(id)
  );

/*
 * contest_deliverables_select_creator and contest_products_select_creator
 * below need no clause of their own. Their subquery reads `contests` under the
 * caller's own row security, so an excluded creator's subquery finds nothing
 * and the child rows disappear with the parent. That is worth knowing rather
 * than guessing at, because it is the only reason those two policies are as
 * short as they look.
 */

-- The brand behind a contest somebody is in stays readable after it is
-- retired, for the same reason brands_select_own_requests exists.
create policy "brands_select_own_contest_entries" on public.brands
  for select to authenticated
  using (exists (
    select 1 from public.contest_entries e
    where e.brand_id = brands.id and e.creator_id = (select auth.uid())
  ));

create policy "contest_deliverables_select_creator" on public.contest_deliverables
  for select to authenticated
  using (is_active and exists (
    select 1 from public.contests c where c.id = contest_deliverables.contest_id
  ));

create policy "contest_products_select_creator" on public.contest_products
  for select to authenticated
  using (exists (
    select 1 from public.contests c where c.id = contest_products.contest_id
  ));

-- Own rows only. No policy lets anybody see another entrant's row.
create policy "contest_entries_select_own" on public.contest_entries
  for select to authenticated using (creator_id = (select auth.uid()));
create policy "contest_entry_terms_select_own" on public.contest_entry_terms
  for select to authenticated
  using (exists (
    select 1 from public.contest_entries e
    where e.id = contest_entry_terms.entry_id and e.creator_id = (select auth.uid())
  ));
create policy "contest_entry_events_select_own" on public.contest_entry_events
  for select to authenticated using (creator_id = (select auth.uid()));
-- The one table with a creator policy and no staff policy. See 2.6.1.
create policy "contest_entry_targets_select_own" on public.contest_entry_targets
  for select to authenticated using (creator_id = (select auth.uid()));
create policy "contest_submissions_select_own" on public.contest_submissions
  for select to authenticated using (creator_id = (select auth.uid()));
create policy "contest_awards_select_own" on public.contest_awards
  for select to authenticated using (creator_id = (select auth.uid()));

-- No insert, update or delete policy on any of the eleven, on purpose. Every
-- write goes through the functions below.

-- ---------------------------------------------------------------- grants ---
-- Auto expose is off, so nothing is reachable without an explicit grant, and
-- that includes service_role. Missing the second line of each pair is how four
-- content functions shipped returning "permission denied".
-- Table level, never column level. judging_basis (2.2) needs no grant of its own
-- and must never get one: it rides this line because it is creator facing by
-- design, and the day somebody reaches for a column level grant on contests is
-- the day the budget belongs on this table, which is what 2.0 refuses.
grant select on public.contests             to authenticated;
grant select on public.contest_commercials  to authenticated;
grant select on public.contest_deliverables to authenticated;
grant select on public.contest_products     to authenticated;
grant select on public.contest_entries      to authenticated;
grant select on public.contest_entry_targets to authenticated;
grant select on public.contest_entry_terms  to authenticated;
grant select on public.contest_exclusions   to authenticated;
grant select on public.contest_entry_events to authenticated;
grant select on public.contest_submissions  to authenticated;
grant select on public.contest_awards       to authenticated;

grant all privileges on table public.contests             to service_role;
grant all privileges on table public.contest_commercials  to service_role;
grant all privileges on table public.contest_deliverables to service_role;
grant all privileges on table public.contest_products     to service_role;
grant all privileges on table public.contest_entries      to service_role;
-- service_role reads this one because set_contest_entry_target has to write
-- it. Nothing else may read it: see rule T3, which binds the Edge Function.
grant all privileges on table public.contest_entry_targets to service_role;
grant all privileges on table public.contest_entry_terms  to service_role;
grant all privileges on table public.contest_exclusions   to service_role;
grant all privileges on table public.contest_entry_events to service_role;
grant all privileges on table public.contest_submissions  to service_role;
grant all privileges on table public.contest_awards       to service_role;

-- --------------------------------------------------------------- realtime ---
/*
 * Four tables join the publication. contest_commercials and contest_exclusions
 * deliberately do NOT: postgres_changes does not apply row security to DELETE
 * events and every table here carries replica identity full, so a deleted
 * exclusion row would broadcast a barred creator's handle and the admin's
 * reason to every subscriber.
 *
 * contest_entry_targets does NOT join either, for the same reason pointed at a
 * different audience: a deleted target row would broadcast a creator's private
 * number to every subscriber on the channel, staff included, which is the one
 * thing 2.6.1 exists to prevent. It needs no realtime anyway. A target only
 * ever changes because the creator themselves changed it, in a tab they are
 * looking at, so their own mutation invalidates their own query and there is
 * no second party waiting to hear about it.
 *
 * See rule S6: every creator-side subscription on the four below MUST pin
 * creator_id=eq.<uid>, and contests must never be hard-deleted while any
 * creator is subscribed to the catalogue channel. And rule S9: every one of
 * those subscribe calls passes a status handler, because a dot that claims a
 * live connection has to know when it no longer has one.
 */
alter publication supabase_realtime add table public.contests;
alter publication supabase_realtime add table public.contest_entries;
alter publication supabase_realtime add table public.contest_entry_events;
alter publication supabase_realtime add table public.contest_submissions;
alter table public.contests             replica identity full;
alter table public.contest_entries      replica identity full;
alter table public.contest_entry_events replica identity full;
alter table public.contest_submissions  replica identity full;
```

Touch triggers on every table with an `updated_at`, using the existing
`public.touch_updated_at()`.

### 2.11 The views

```sql
/*
 * ONE row per entry, keyed to exactly one creator, so it is safe to share.
 * This is the same property that makes job_progress the only shared view in
 * the product: a count over one person's own rows is COMPLETE, not silently
 * narrowed. No is_staff() gate, and that is deliberate.
 */
create view public.contest_entry_progress
with (security_invoker = true) as
select
  e.id            as entry_id,
  e.creator_id,
  e.contest_id,
  e.brand_id,
  e.committed_video_count                                     as required,
  count(s.id) filter (where s.status = 'approved')::int        as approved,
  count(s.id) filter (where s.status = 'submitted')::int       as waiting,
  count(s.id) filter (where s.status = 'needs_another_take')::int as needs_another_take,
  count(s.id)::int                                             as posted,
  /*
   * THE FOURTH SLOT, added 2026-08-13, gap 8. The tracker was drawn with three
   * segments while this view returned four counts, and the fourth, a video
   * sent back for another take, had nowhere to sit. It cannot go in "still to
   * film", because rule W3 fixes that phrase to mean nothing exists yet and
   * that video does exist. It cannot go in "in review" either, because we have
   * already reviewed it and the ball is back with the creator. So the bar has
   * FOUR segments and this is the fourth: what has not been shot at all.
   *
   * Derived rather than counted, and floored at zero, because a keen entrant
   * may file more than the count they committed to and a negative segment
   * would render as a bar growing backwards.
   *
   * NULL required means an open-ended entry. This column is then 0 and the
   * client must not draw the bar at all: see rule W6. A zero here means two
   * different things and only `required` tells them apart, which is why both
   * columns are on the row.
   */
  greatest(coalesce(e.committed_video_count, 0) - count(s.id), 0)::int as still_to_film
from public.contest_entries e
left join public.contest_submissions s on s.entry_id = e.id
where e.status = 'approved'
group by e.id;

grant select on public.contest_entry_progress to authenticated;
grant all privileges on table public.contest_entry_progress to service_role;

/*
 * Contest money, grouped by (contest, currency). Deliberately NOT one row per
 * contest: summing two currencies into one figure is the single arithmetic
 * error this product must never make. In practice contests.currency pins a
 * contest to one, and the grouping is what makes that provable rather than
 * assumed.
 *
 * STAFF ONLY, IN THE BODY, and is_service_role() is in the gate because
 * service_role carries no user_role claim, so is_staff() is FALSE for the
 * service key and every Edge Function would read zero rows.
 *
 * This is also where the contest budget total comes from. It carries no
 * total_budget column: a percentage of an unknown allocation plus one known
 * reward reconstructs the allocation, so the percentage is computed on the
 * admin screen from this view AND contest_commercials, never in a view a
 * grant could later widen.
 */
create view public.contest_totals
with (security_invoker = true) as
select
  e.contest_id,
  e.brand_id,
  e.currency,
  count(*) filter (where e.status = 'pending')::int   as entries_pending,
  count(*) filter (where e.status = 'approved')::int  as entries_approved,
  count(*) filter (where e.status = 'rejected')::int  as entries_rejected,
  count(*) filter (where e.status = 'withdrawn')::int as entries_withdrawn,
  -- No entries_removed. Nothing can write that status any more, so the column
  -- would be a permanent zero that reads on the admin screen as "we have never
  -- had to remove anybody" rather than as "we cannot".
  coalesce(sum(e.committed_amount) filter (where e.status = 'approved'), 0)::numeric(14, 2)
    as committed,
  coalesce(sum(e.committed_video_count) filter (where e.status = 'approved'), 0)::int
    as videos_promised,
  max(e.created_at) as last_entered_at
from public.contest_entries e
where (select public.is_staff() or public.is_service_role())
group by e.contest_id, e.brand_id, e.currency;

grant select on public.contest_totals to authenticated;
grant all privileges on table public.contest_totals to service_role;

/*
 * The same thing rolled to a brand, for the brand Overview and the admin home.
 * Grouped by (brand, currency) for the same reason brand_stage_totals is.
 * Awards are separate from commitments because they are a different money
 * event with a different moment of truth.
 */
create view public.brand_contest_totals
with (security_invoker = true) as
select
  t.brand_id,
  t.currency,
  count(distinct t.contest_id)::int         as contests,
  sum(t.entries_pending)::int               as entries_pending,
  sum(t.entries_approved)::int              as entries_approved,
  sum(t.committed)::numeric(14, 2)          as committed,
  coalesce(a.awarded, 0)::numeric(14, 2)    as awarded
from public.contest_totals t
left join lateral (
  select sum(w.awarded_amount) as awarded
  from public.contest_awards w
  where w.contest_id = t.contest_id and w.awarded_currency = t.currency
) a on true
group by t.brand_id, t.currency, a.awarded;

grant select on public.brand_contest_totals to authenticated;
grant all privileges on table public.brand_contest_totals to service_role;
```

**There is no contest leaderboard view, and after D7 there is no standings
snapshot either.** A leaderboard groups across every entrant, which is exactly
the shape `20260811230000_brand_rollups.sql:11-19` forbids sharing: a creator
querying it under `security_invoker` gets one row, their own, with **no error at
all**, and the screen renders it as the ranking. This paragraph used to end
"standings, if they are ever built, are a published snapshot written by a staff
action, not a view", which left the door open. **D7 closed it on 2026-08-13: no
standings table, no published snapshot, and no read policy anywhere that returns
one creator rows about another.** Design direction 2F, competing with a published
standing, is cut. See rules N1 to N6 and decision D7.

**Three columns that exist and are never in a view, deliberately.** The three
views above carry no `self_target`, no entrant headcount on a creator readable
row, and no `total_budget`. The first two are D7, the third is D2. A view is
where all three would arrive quietly, because a view looks like a read rather
than like a grant.

### 2.12 The one definition of open

```sql
/*
 * ONE definition of "open", quoted by the browse policy, by apply_for_contest
 * and by the admin list, so the three cannot drift apart. The precedent is
 * job_is_filmed, extracted for exactly that reason.
 *
 * SECURITY DEFINER, and job_is_filmed is NOT, and the difference matters.
 * job_is_filmed is safe as an invoker function because every one of its callers
 * is already a definer function that has checked who is asking. This one is
 * called from an RLS POLICY BODY, evaluated with the caller's own rights, so as
 * an invoker function it would read `brands` through brands_select_creator and
 * return a DIFFERENT ANSWER to an applicant than to an admin, which defeats the
 * whole point of extracting it. Same reason is_approved_creator() had to be
 * definer.
 */
create or replace function public.contest_is_open(p_contest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.status = 'active'
     and c.settled_at is null
     and c.cancelled_at is null
     and now() >= c.opens_at
     and now() < c.expires_at
     and b.is_active
  from public.contests c
  join public.brands b on b.id = c.brand_id
  where c.id = p_contest_id;
$$;

comment on function public.contest_is_open(uuid) is
  'Whether a contest is taking new entries right now. The single definition, quoted by the browse policy, by apply_for_contest and by the admin list. Says nothing about whether an existing entrant may still work or be paid.';

revoke all on function public.contest_is_open(uuid) from public, anon;
grant execute on function public.contest_is_open(uuid) to authenticated;
```

### 2.12.1 The one definition of excluded

Added 2026-08-13 as part of the gap 1 fix. Before it, the exclusion comparison
existed in exactly one place, spelled out inline inside `apply_for_contest`. It
now has two callers, so it is extracted for the same reason `contest_is_open`
was, and it is extracted as **two functions with one body**, because the two
callers need different powers.

```sql
/*
 * The internal form. Takes the user to test AS AN ARGUMENT, so it can be used
 * to ask about anybody, which is why it is granted to service_role only and to
 * nothing else. This is the body; everything else delegates to it.
 *
 * The coalesce on both sides of every comparison is load bearing and is the
 * reason this was worth extracting rather than copying. A creator with no
 * application row has a NULL handle, and `null = 'x'` is NULL rather than
 * false, so an OR chain without the coalesce silently evaluates to NULL and
 * the guard passes for EVERYBODY. That trap is now written once.
 */
create or replace function public.contest_excludes(
  p_contest_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.contest_exclusions x
    where x.contest_id = p_contest_id
      and (
        -- The pinned uuid first, and on its own index. This is the resolved
        -- case, which rule X3 says is the normal one, and it is the branch
        -- that has to be cheap because a policy body calls it per row.
        x.user_id = p_user_id
        or (
          -- The unresolved case only. Bounded by the same contest_id, so it
          -- reads at most the handful of rows an admin typed before the
          -- person had an account.
          x.user_id is null
          and exists (
            select 1
            from public.profiles p
            left join lateral (
              select a.tiktok_handle
              from public.applications a
              where a.user_id = p.id
              order by a.created_at desc
              limit 1
            ) h on true
            where p.id = p_user_id
              and (
                lower(coalesce(x.email, '')) = lower(coalesce(p.email, chr(1)))
                or lower(ltrim(coalesce(x.handle, ''), '@'))
                     = lower(ltrim(coalesce(h.tiktok_handle, chr(1)), '@'))
              )
          )
        )
      )
  );
$$;

/*
 * The policy form. Takes NO user argument and reads auth.uid() itself, so it
 * can answer only "am I barred from this one" and can never be used to probe
 * anybody else. That is the whole reason there are two: this one has to be
 * executable by `authenticated`, because it is evaluated inside an RLS policy
 * body, and a version that accepted a uuid would hand every creator a barred-
 * or-not oracle over every other creator.
 *
 * SECURITY DEFINER for the same reason contest_is_open is: contest_exclusions
 * has no creator policy at all, so an invoker function would read zero rows
 * and return false to every creator, which is exactly backwards.
 */
create or replace function public.contest_excludes_caller(p_contest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.contest_excludes(p_contest_id, (select auth.uid()));
$$;

comment on function public.contest_excludes_caller(uuid) is
  'Whether the CALLER is barred from this contest. Quoted by both creator select policies on contests and, through contest_excludes, by apply_for_contest, so the catalogue, the own-entry read and the write gate cannot drift apart. Takes no user argument on purpose.';

revoke all on function public.contest_excludes(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.contest_excludes(uuid, uuid) to service_role;

revoke all on function public.contest_excludes_caller(uuid) from public, anon;
grant execute on function public.contest_excludes_caller(uuid) to authenticated;
```

**`apply_for_contest` loses its inline comparison and calls
`public.contest_excludes(p_contest_id, v_actor.id)` instead.** The behaviour is
identical, and the point is that it can no longer become identical-ish. An
exclusion that hides a contest but does not stop the write, or stops the write
but leaves the contest lit, is precisely the bug in gap 1, and the only durable
fix is that both answers come out of one body.

### 2.13 The write functions

Eighteen, all `security definer ... set search_path = ''`, all starting with
`assert_active_staff(p_actor_id)` or `assert_active_creator(p_actor_id)`, all
taking the row `for update` before deciding, all writing their `audit_log` entry
in the same transaction with `jsonb_strip_nulls(jsonb_build_object(...))`, all
returning `to_jsonb(v_row)`. **One of the eighteen breaks the audit half of that
sentence on purpose, and it is the last one in the list.**

`save_contest` · `set_contest_status` · `settle_contest` · `cancel_contest` ·
`delete_contest` · `save_contest_deliverable` · `retire_contest_deliverable` ·
`set_contest_products` · `save_contest_commercials` · `save_contest_exclusion` ·
`remove_contest_exclusion` · `record_contest_exclusion_attempt` ·
`apply_for_contest` · `withdraw_contest_entry` · `review_contest_entry` ·
`submit_contest_content` · `review_contest_content` ·
`set_contest_entry_target`.

Plus the three shared definitions that are not write functions:
`contest_is_open` (2.12), `contest_excludes` and `contest_excludes_caller`
(2.12.1).

**`save_contest` validates the timezone, and this is the only place it can be
done.** `p_expires_at_timezone text` is checked with
`exists (select 1 from pg_timezone_names where name = p_expires_at_timezone)`
and raises 22023 naming the value if it is not found. It cannot be a column
check, because that catalogue lookup is not immutable and Postgres refuses it in
a CHECK. Zod on both sides restricts the field to the list the form offers,
which is a convenience; this is the boundary. See rule L6 and gap 2.

**`save_contest` carries `p_judging_basis text default null`, and TWO functions
enforce the one rule behind it.** Added 2026-08-13 with the column (2.2, Q13,
rule N7). The value is trimmed to NULL when blank and stored on
`contests.judging_basis`; it is in the always-allowed tier of rule F2, because
saying more clearly how a contest is judged changes nothing anybody was promised,
and it is audited on `contest.created` and `contest.updated` through the usual
`jsonb_strip_nulls(jsonb_build_object(...))` so the activity log shows who wrote
the sentence and who changed it.

**The requirement it carries cannot live in a CHECK**, because a check constraint
cannot see `contest_deliverables`, so it is enforced in both functions that can
create the illegal combination, and both are needed because either direction gets
there on its own:

- **`save_contest`**, when the incoming `judging_basis` is null or blank while the
  contest already holds an active deliverable of the `rank` kind. Counted under
  the contest row lock the function already takes, and refused in the wording
  style `delete_offer` uses, with the count in it:
  `raise exception 'this contest has % ranked prize rows, so it needs a sentence
  saying how it is judged', v_rank_count using errcode = '22023';`
- **`save_contest_deliverable`**, when the row being written is of the `rank` kind
  and the contest's `judging_basis` is null or blank:
  `raise exception 'say how this contest is judged before you add a ranked prize'
  using errcode = '22023';`

`retire_contest_deliverable` needs no clause: retiring the last rank row leaves a
contest with a sentence and nothing ranked, which is legal and harmless. The Zod
schema refuses the same pair on both sides so the admin meets it in the form
rather than in a raise, and these two are the boundary.

**There is no draft row, and `save_contest` must never grow one.** Decided by
Rashid on 2026-08-13, Q12. `contests.name` and `contests.expires_at` stay
`not null`, there is no draft value in `contest_status`, no nullable column
exists to hold a half filled contest, and `save_contest` either writes a legal
contest or raises. A half finished form is held in the admin's own browser and
touches no database row at all (rule F12). Nothing incomplete can therefore reach
a count, a list, a policy or a screen, because there is nothing incomplete to
reach them.

**There is no `remove_contest_entry`, and there must never be one.** An earlier
draft of this plan carried it as a deliberate, audited admin removal. Rashid cut
it on 2026-08-13: an entry, once made, cannot be revoked by an admin at all
(Q7, rule X9). Nothing in the data model, the Edge Function, the client or the
suite refers to it, and 3.4.1 records the risk that decision accepts so nobody
adds it back as an obvious missing piece.

**The banner rides on `save_contest`, in the always-allowed tier.**
`save_contest` takes `p_banner_url text default null` alongside `p_brief_url`,
trims it to NULL when blank, and stores it on `contests.banner_url`. It is
validated three times over, exactly as the brief link is under rule S7: the Zod
schema in `src/lib/schemas/contest.ts`, the same schema again inside
`manage-contest`, and the column check in the database. Clearing it is a normal
edit, sending null. It is audited like every other field, so the `contest.updated`
detail carries `banner_url` through the usual
`jsonb_strip_nulls(jsonb_build_object(...))`, which means the activity log shows
who put the artwork up and who took it down. It is in the always-allowed tier of
rule F2, never the frozen tier: changing the picture changes nothing anybody was
promised.

The two that carry the weight:

```sql
create or replace function public.apply_for_contest(
  p_actor_id uuid,
  p_contest_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    public.profiles%rowtype;
  v_contest  public.contests%rowtype;
  v_brand    public.brands%rowtype;
  v_row      public.contest_entries%rowtype;
  v_handle   text;
  v_note     text := nullif(trim(coalesce(p_note, '')), '');
  v_excluded boolean;
  v_amount   numeric := null;
  v_videos   integer := null;
begin
  -- role = 'creator' exactly. is_approved_creator() admits ops and admin so
  -- they can BROWSE; entering is a narrower gate on purpose.
  v_actor := public.assert_active_creator(p_actor_id);

  -- Locked before ANY branch, so an admin flipping needs_admin_approval or the
  -- expiry between the card loading and this call cannot be raced.
  select * into v_contest from public.contests where id = p_contest_id for update;
  if not found then
    raise exception 'no such contest' using errcode = 'P0002';
  end if;

  select * into v_brand from public.brands where id = v_contest.brand_id;

  -- Every gate re-checked here. RLS hiding the row is cosmetic; this is the
  -- boundary. A creator who knows an id posts straight at the Edge Function.
  if not public.contest_is_open(p_contest_id) then
    if v_contest.settled_at is not null then
      raise exception 'that contest has been settled' using errcode = '22023';
    elsif v_contest.cancelled_at is not null then
      raise exception 'that contest was cancelled' using errcode = '22023';
    elsif now() >= v_contest.expires_at then
      raise exception 'that contest closed on %',
        to_char(v_contest.expires_at at time zone 'UTC', 'DD Mon YYYY HH24:MI') || ' UTC'
        using errcode = '22023';
    elsif not v_brand.is_active then
      raise exception 'that brand is not open' using errcode = '22023';
    else
      raise exception 'that contest is not taking entries' using errcode = '22023';
    end if;
  end if;

  -- The handle is read from the database, NEVER from the request body.
  select a.tiktok_handle into v_handle
  from public.applications a
  where a.user_id = v_actor.id
  order by a.created_at desc
  limit 1;

  /*
   * Exclusion, through the ONE definition in 2.12.1 and not spelled out again
   * here. Corrected 2026-08-13: this body used to carry the comparison inline
   * while the prose above 2.12.1 already said it had been extracted, which is
   * the gap 1 bug in miniature, two spellings of one gate in one document.
   *
   * user_id is still the only durable key; handle and email only ever close the
   * case where the exclusion was typed before that person had an account. The
   * coalesce on both sides of every comparison lives inside contest_excludes
   * now, and it is load bearing: a creator with no application row has a NULL
   * handle, and `null = 'x'` is NULL rather than false, so an OR chain without
   * it passes the guard for everybody.
   *
   * The two-argument form is the one used here because the actor is already
   * asserted; the caller-only wrapper is for the policy bodies.
   */
  v_excluded := public.contest_excludes(p_contest_id, v_actor.id);

  if v_excluded then
    /*
     * Raised, not inserted-then-raised. A raise aborts the transaction and
     * would take any audit row with it, so the record of the attempt is
     * written by the Edge Function AFTER this returns, through
     * record_contest_exclusion_attempt, exactly as every *.write_denied row is
     * written today. See rule X4.
     */
    raise exception 'you are not eligible for this contest' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.contest_entries e
    where e.contest_id = p_contest_id
      and e.creator_id = v_actor.id
      and e.status in ('pending', 'approved')
  ) then
    raise exception 'you have already entered this one' using errcode = '55006';
  end if;

  /*
   * Auto approve is a full approval, not a lighter "joined" row. Being part of
   * the contest is being owed the reward, so the terms freeze, the events are
   * written and the audit row says approved, all inside this transaction.
   */
  if not v_contest.needs_admin_approval then
    select coalesce(sum(d.reward_amount), 0), nullif(coalesce(sum(d.video_count), 0), 0)
    into v_amount, v_videos
    from public.contest_deliverables d
    where d.contest_id = p_contest_id and d.is_active and d.kind = 'fixed';
  end if;

  insert into public.contest_entries (
    contest_id, brand_id, creator_id, creator_handle, creator_name, creator_email,
    status, auto_approved, currency, committed_amount, committed_video_count, note,
    decided_at
  )
  values (
    p_contest_id, v_contest.brand_id, v_actor.id, v_handle, v_actor.display_name,
    v_actor.email,
    case when v_contest.needs_admin_approval then 'pending' else 'approved' end,
    not v_contest.needs_admin_approval,
    v_contest.currency, v_amount, v_videos, v_note,
    case when v_contest.needs_admin_approval then null else now() end
  )
  returning * into v_row;

  if not v_contest.needs_admin_approval then
    insert into public.contest_entry_terms (
      entry_id, deliverable_id, kind, title, detail, video_count, rank_position,
      metric, threshold, reward_amount, currency
    )
    select v_row.id, d.id, d.kind, d.title, d.detail, d.video_count, d.rank_position,
           d.metric, d.threshold, d.reward_amount, v_contest.currency
    from public.contest_deliverables d
    where d.contest_id = p_contest_id and d.is_active;
  end if;

  insert into public.contest_entry_events (entry_id, creator_id, kind, note, actor_id)
  values (
    v_row.id, v_actor.id,
    case when v_contest.needs_admin_approval then 'entered' else 'accepted' end,
    null, v_actor.id
  );

  insert into public.audit_log (
    actor_id, actor_email, actor_role, action, subject_type, subject_id,
    target_user_id, detail
  )
  values (
    v_actor.id, v_actor.email, v_actor.role,
    case when v_contest.needs_admin_approval
      then 'contest_entry.created' else 'contest_entry.approved' end,
    'contest_entry', v_row.id, v_actor.id,
    jsonb_strip_nulls(jsonb_build_object(
      'brand', v_brand.name,
      'brand_id', v_contest.brand_id,
      'contest', v_contest.name,
      'contest_id', v_contest.id,
      'creator', v_row.creator_handle,
      'automatic', not v_contest.needs_admin_approval,
      'committed_amount', v_row.committed_amount,
      'committed_video_count', v_row.committed_video_count,
      'currency', v_row.currency
    ))
  );

  return to_jsonb(v_row);
end;
$$;
```

```sql
create or replace function public.review_contest_entry(
  p_actor_id uuid,
  p_entry_id uuid,
  p_decision public.contest_entry_status,
  p_note text default null,
  -- Rejecting under a partial unique index is an invitation to re-enter within
  -- seconds. This is the switch that makes it stop, in the same transaction.
  p_block boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   public.profiles%rowtype;
  v_row     public.contest_entries%rowtype;
  v_contest public.contests%rowtype;
  v_note    text := nullif(trim(coalesce(p_note, '')), '');
  v_amount  numeric := null;
  v_videos  integer := null;
begin
  v_actor := public.assert_active_staff(p_actor_id);

  if p_decision not in ('approved', 'rejected') then
    raise exception 'a decision is approved or rejected' using errcode = '22023';
  end if;

  -- The entry AND the contest, both locked, so two admins cannot both decide
  -- the same entry and cannot both take the last place on a capped contest.
  select * into v_row from public.contest_entries where id = p_entry_id for update;
  if not found then
    raise exception 'no such entry' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'that was already %', v_row.status using errcode = '55006';
  end if;

  select * into v_contest from public.contests where id = v_row.contest_id for update;
  if v_contest.settled_at is not null then
    raise exception 'that contest has been settled' using errcode = '22023';
  end if;

  if p_decision = 'approved' then
    -- Read the terms ONCE, here, and keep them. The frozen rows are the
    -- promise; the contest may be edited afterwards and this must not move.
    select coalesce(sum(d.reward_amount), 0), nullif(coalesce(sum(d.video_count), 0), 0)
    into v_amount, v_videos
    from public.contest_deliverables d
    where d.contest_id = v_row.contest_id and d.is_active and d.kind = 'fixed';
  end if;

  update public.contest_entries
  set status                = p_decision,
      decided_by            = v_actor.id,
      decided_at            = now(),
      decision_note         = v_note,
      committed_amount      = v_amount,
      committed_video_count = v_videos,
      currency              = v_contest.currency
  where id = p_entry_id
  returning * into v_row;

  if p_decision = 'approved' then
    insert into public.contest_entry_terms (
      entry_id, deliverable_id, kind, title, detail, video_count, rank_position,
      metric, threshold, reward_amount, currency
    )
    select v_row.id, d.id, d.kind, d.title, d.detail, d.video_count, d.rank_position,
           d.metric, d.threshold, d.reward_amount, v_contest.currency
    from public.contest_deliverables d
    where d.contest_id = v_row.contest_id and d.is_active;
  end if;

  if p_decision = 'rejected' and p_block then
    insert into public.contest_exclusions (contest_id, user_id, handle, email, reason, created_by)
    values (v_row.contest_id, v_row.creator_id, v_row.creator_handle,
            v_row.creator_email, v_note, v_actor.id)
    on conflict (contest_id, user_id) where user_id is not null do nothing;
  end if;

  insert into public.contest_entry_events (entry_id, creator_id, kind, note, actor_id)
  values (v_row.id, v_row.creator_id, p_decision::text, v_note, v_actor.id);

  insert into public.audit_log (
    actor_id, actor_email, actor_role, action, subject_type, subject_id,
    target_user_id, detail
  )
  values (
    v_actor.id, v_actor.email, v_actor.role,
    'contest_entry.' || p_decision::text, 'contest_entry', v_row.id, v_row.creator_id,
    jsonb_strip_nulls(jsonb_build_object(
      'contest', v_contest.name,
      'contest_id', v_contest.id,
      'brand_id', v_row.brand_id,
      'creator', v_row.creator_handle,
      'committed_amount', v_row.committed_amount,
      'committed_video_count', v_row.committed_video_count,
      'currency', v_row.currency,
      'blocked', p_block,
      'note', v_note
    ))
  );

  return to_jsonb(v_row);
end;
$$;
```

`record_contest_exclusion_attempt(p_contest_id uuid, p_user_id uuid)` is a small
definer function that bumps `attempts` and `last_attempt_at` on the matching
exclusion row and writes one `contest_entry.excluded_attempt` audit row. It is
called by the Edge Function **after** `apply_for_contest` has already raised, so
it commits in its own transaction. It takes no note and no free text from the
client.

**`set_contest_entry_target`, the one function that deliberately writes no audit
row.**

```sql
create or replace function public.set_contest_entry_target(
  p_actor_id uuid,
  p_entry_id uuid,
  -- NULL clears the target. There is no separate clear function: "I am not
  -- going for a number any more" is the same act as changing it.
  p_target integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   public.profiles%rowtype;
  v_entry   public.contest_entries%rowtype;
  v_contest public.contests%rowtype;
  v_row     public.contest_entry_targets%rowtype;
begin
  -- role = 'creator' exactly, the same gate as entering. Staff have no
  -- business here even as themselves, and there is no p_creator_id to pass.
  v_actor := public.assert_active_creator(p_actor_id);

  -- Locked on id AND creator_id together, the withdraw_contest_entry shape. A
  -- creator who knows another entry's id gets "no such entry", never a
  -- permission error that confirms the row exists.
  select * into v_entry from public.contest_entries
  where id = p_entry_id and creator_id = v_actor.id for update;
  if not found then
    raise exception 'no such entry' using errcode = 'P0002';
  end if;

  -- A target only means something on a live entry. Pending has nothing to
  -- count yet, and the rest are over.
  if v_entry.status <> 'approved' then
    raise exception 'you can set a target once you are in' using errcode = '55006';
  end if;

  select * into v_contest from public.contests where id = v_entry.contest_id;
  if v_contest.settled_at is not null or v_contest.cancelled_at is not null then
    raise exception 'that contest is over' using errcode = '22023';
  end if;

  if p_target is null then
    delete from public.contest_entry_targets where entry_id = p_entry_id;
    return 'null'::jsonb;
  end if;

  insert into public.contest_entry_targets (entry_id, creator_id, target)
  values (p_entry_id, v_actor.id, p_target)
  on conflict (entry_id) do update
    set target = excluded.target, updated_at = now()
  returning * into v_row;

  /*
   * NO audit_log ROW, AND NO contest_entry_events ROW. Both deliberate, both
   * the same reason: audit_log carries an is_staff() read policy and
   * contest_entry_events carries contest_entry_events_select_staff, so writing
   * the target into either would hand staff, in a searchable table, the exact
   * number 2.6.1 refuses them through the policies. It would also outlive the
   * creator clearing it, so a withdrawn target could still be read.
   *
   * This is the only write in the whole feature with no trail, and the trade
   * is real: if a creator says their target vanished, there is nothing to look
   * at. It is worth paying. A private number is either private or it is not,
   * and a trail somebody else can read is not.
   */

  return to_jsonb(v_row);
end;
$$;
```

**What that costs, and what it does not.** It costs the audit trail on one
field. It does not cost the entry's trail: approval, money, submission,
withdrawal and settlement are audited exactly as before and the target touches
none of them. It is not a promise, nothing is owed because of it, and no reward
moves. It is a note the creator wrote to themselves inside our product.

### 2.14 The locks, every function, both lines

```sql
revoke all on function public.apply_for_contest(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.apply_for_contest(uuid, uuid, text) to service_role;

revoke all on function public.review_contest_entry(
  uuid, uuid, public.contest_entry_status, text, boolean
) from public, anon, authenticated;
grant execute on function public.review_contest_entry(
  uuid, uuid, public.contest_entry_status, text, boolean
) to service_role;

revoke all on function public.set_contest_entry_target(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.set_contest_entry_target(uuid, uuid, integer)
  to service_role;

-- ... and the same pair, spelled out with full argument types, for all
-- eighteen. Missing the second half is not a style slip: it is the entire
-- reason 20260811173000_grant_content_functions.sql exists.
--
-- The three shared definitions in 2.12 and 2.12.1 do NOT follow this pattern
-- and must not be made to: contest_is_open and contest_excludes_caller are
-- granted to `authenticated` on purpose, because they are evaluated inside RLS
-- policy bodies with the caller's own rights and a policy calling a function
-- the caller cannot execute fails the whole read. contest_excludes, which
-- takes a uuid and can therefore ask about anybody, follows the pattern above
-- exactly.
```

---

## 3. The connection rules

Every rule is one testable sentence, with where it is enforced and what breaks
without it. Grouped by theme, leading with status and expiry because that was
Rashid's own example.

**Four groups joined on 2026-08-13**, after the design review: **N**, nobody else
exists, which is what D7 forbids being built; **T**, the creator's own target,
which is what D7 keeps; **W**, the words and what the tracker counts; and **C**,
colour and contrast, which is where two rulings correcting our own documents
live. Rules **L15** and **S9** joined the existing groups.

**Eleven more rules joined on 2026-08-13 in the third pass**, after the seven
agent review of design turn 3: **L16**, **L17**, **F8** to **F10**, **X10**,
**W8**, **B8**, and **C6** to **C8**, which is also where the **C** group grows a
motion ruling. Every one of them implements a rule that was already here and
says which, so none of them is a new decision, and none of them needs a drawing
to be true. The findings from that review that were rejected are in **3.13**.

**Four more rules joined on 2026-08-13 in the fourth pass**, and unlike the
eleven above these ARE new decisions, because they are Rashid's four answers to
the AWAITING RASHID questions: **F11** (the admin types every reward row's
title), **F12** (a half filled contest lives in the browser only, there is no
draft row), **F13** (the setup form is a full screen of its own) and **N7** (the
judging sentence is its own column and is required by any ranked prize). N7 is
the only one of the four that reaches the schema. **3.14** is what they owe the
designer.

### 3.1 Status, expiry and the lifecycle (rules L1 to L17)

**L1. A contest has three independent axes, and no single admin control may move
more than one of them: openness (may a new creator enter), visibility (who may
read the row), and liveness of work (may an entrant still deliver and be paid).**
Enforced in the database: `contest_is_open()` carries openness and is quoted by
`contests_select_creator` and by `apply_for_contest`; visibility is the separate
`contests_select_own_entries` policy; liveness is checked nowhere in the
submission path, exactly as `submit_content` checks only that the job is
approved and deliberately not that the offer or brand is still active.
**Without it:** Rashid flips a contest to inactive to stop new entrants and
silently kills four creators mid deliverable. Their contest vanishes, their
submit button disappears, and their frozen rewards have no visible source. That
is the bug `20260801152000_read_offers_you_asked_for.sql` was written to fix for
offers, re-shipped.

**L2. There is exactly one definition of open, `public.contest_is_open(uuid)`,
and the browse policy, the apply function and the admin list all quote it rather
than each spelling out the conditions.** Enforced in the database. It is
`security definer`, unlike `job_is_filmed`, because it is evaluated inside an RLS
policy body with the caller's own rights and would otherwise return a different
answer to an applicant than to an admin.
**Without it:** the list hides expired contests while the apply function only
checks status, so a stale tab enters an expired contest, or the reverse, and the
card shows a button that does nothing.

**L3. Visibility is `open OR mine`, and that is a deliberately different
predicate from openness.** Enforced in two separate policies on `contests`, plus
`brands_select_own_contest_entries`. **Without it:** L2's "one definition"
quietly grows an `or exists(...)` clause and stops being one definition, or a
creator who won a contest last month opens their dashboard and sees a reward with
no contest name and no brand name attached to it. Transparency is the product,
and that is the screen where it fails.

**L4. Expired is derived from `now()` at every read and every write; nothing ever
writes `status = 'inactive'` because a date passed, and there is no scheduled
job.** Enforced in the database, inside `contest_is_open`. **Without it:**
`audit_log` fills with state changes nobody performed, and there is no way to
answer "who closed this".

**L5. Because expiry writes no row, it fires no realtime event, so every contest
surface must re-derive openness on a timer as well as on a change.** Enforced in
the client: a `refetchInterval` on the contests query and a ticking clock on any
card showing a countdown. **Without it:** a creator with the hub open at 23:58
still has a lit Apply button at 00:05, taps it, and gets a refusal nothing on the
screen can explain. Offers never had this, because an offer only ever closed
because somebody clicked something.

**L6. REWRITTEN 2026-08-13, gap 2. `expires_at` is a `timestamptz` set as a date
and a time IN A NAMED ZONE, that zone is stored on the contest as
`expires_at_timezone`, and every creator-facing deadline string is rendered in it
and names it.** Enforced in two columns rather than one, in `save_contest`
(which checks the zone against `pg_timezone_names` and raises 22023), in Zod on
both sides, and in the rendered string. There is no date formatter anywhere in
`src/lib/` today, so one is written in this feature and it takes the zone as an
argument rather than reading the browser's.

**Why the rule could not be kept as written.** It required the string to name
its zone, and the design's mock data legitimately carries two, "11:59pm BST" and
"11:59pm PDT". A `timestamptz` stores one instant in UTC and discards the offset
it was written with, so nothing in the row as originally drawn could say which
zone a deadline was set in, and the only zone available at render time was the
reader's own. The rule was unsatisfiable by the schema, which is worse than a
missing rule, because it reads as done.

**An IANA name, never an offset and never an abbreviation.** `Europe/London` is
BST in August and GMT in December, and the abbreviation is derived at render
time from the instant plus the zone. Storing `+01:00` would be right until the
clocks changed and wrong afterwards, silently, on a live contest.

**What the admin setup form asks for**, spelled out because this is where the
value comes from:

- **Three controls, not two:** a date, a time, and a timezone.
- The timezone is a **select of IANA names**, not free text, offering the zones
  Wurx actually works in first (`Europe/London`, `America/New_York`,
  `America/Chicago`, `America/Denver`, `America/Los_Angeles`) and the full list
  behind them, so a US brand's contest can close at midnight where its creators
  are. Same list in Zod on both sides.
- It is **pre-selected to the admin's own browser zone and always visible,
  never a hidden default.** A control that is right most of the time and
  invisible is how a US contest closes at 4pm.
- The form **echoes the resulting instant back in words as the creator will
  read it**, "Closes 31 Aug 2026, 11:59pm BST", under the controls, live as
  they type. That echo is the whole reason the three controls are worth the
  space: it is the only moment anybody can catch a deadline set in the wrong
  zone, and it costs nothing once the formatter from this rule exists.

**RULED 2026-08-13, third design turn: this control is built from THIS RULE and
not from the drawing.** Design turn 3 offers two city pills where the select
belongs. They are ignored, and the five bullets above are the specification. L6
already fixes the control in more detail than a frame could: which five zones lead
the list, that the full list sits behind them, that it is preselected to the
admin's own browser zone, that it is always visible, and that the resulting
instant is echoed back as the creator will read it. Two pills cannot express a
zone Wurx does not work in every day, and the first contest that needs a sixth
zone is back at a select nobody drew. This is also why the timezone control is
listed in 3.13 as a rejected blocker rather than as an open question.

**Without it:** a creator in California reads "Closes today" at 16:00 PT, taps
Apply, is refused because the instant was 23:59 Europe/London, and there is
nothing Rashid can point at on a support call. **And with the old wording but
without the column:** every deadline renders in the reader's own zone, so the
same contest says "11:59pm BST" to Rashid and "3:59pm PDT" to the creator, both
labelled honestly, and neither of them is the zone anybody set.

**L7. Expiry passing changes nothing about any existing entry: nothing is
auto-rejected, nothing is cancelled, no frozen reward is voided, no submitted
deliverable is discounted.** Enforced by the absence of any trigger, cron or
default keyed off `expires_at`. **Without it:** twelve people wake up rejected
from a contest they were mid way through, with no `decided_by`, no
`decision_note` and nobody to appeal to.

**L8. `status = 'inactive'` closes the door, not the work: an approved entrant
may still read their terms, still submit and still be paid.** Enforced in
`apply_for_contest` (refuses) and in `submit_contest_content` (does not check the
contest's status at all). **Without it:** one switch quietly cancels everybody's
work in progress and Rashid has no way to pause recruitment without doing that.

**L9. Settlement is a real terminal state with an actor and a time
(`settled_at`, `settled_by`), and past it there are no new entries, no
withdrawals, no submissions, no reward changes and no extension.** Enforced in
`settle_contest` and re-checked in every other write function.
**Without it:** either the outcome never locks and a late submission changes who
won after prizes were announced, or expiry has to mean both "closed to entries"
and "outcome final", which are days apart and mean different things to a
creator mid deliverable. (The word here used to be "standings", written before
D7; there is no standings object to lock, only a per entrant outcome row.)

**L10. Extending `expires_at` on an expired but unsettled contest is allowed and
audited; extending it on a settled contest is refused with 22023; reopening never
resurrects a withdrawn or rejected entry.** Enforced in `save_contest`.
**Without it:** either a typo permanently kills a live contest, or an admin
quietly reopens a settled one and a second set of winners appears against a
budget already spent.

**L11. `save_contest` refuses to move `expires_at` to now or earlier while any
entry is pending or approved, raising 22023. Ending early is `cancel_contest` or
`settle_contest`, both of which write a per entry outcome.** Enforced in
`save_contest`. **Without it:** an admin backdates the expiry to close a contest
quickly and twelve entrants are stranded in a state the system has no name for.

**L12. `settle_contest`, `cancel_contest` and `delete_contest` all refuse while
any entry is pending, raising 23503 naming the count, in the wording style of
`delete_offer`.** Enforced in the three functions. **Without it:** applicants sit
pending forever on a settled contest, in no queue, getting no decision, and the
FK cascade on delete sweeps their rows away with no record of what they asked
for.

**L13. Cancelling or settling a contest with live entrants writes a
`contest_entry_events` row per entrant. No entry is left sitting at approved on a
dead contest, and none is silently deleted.** Enforced in `settle_contest` and
`cancel_contest`. **Without it:** a creator's contest stops existing on their
dashboard one morning with no explanation, which is the exact opposite of the
product's stated purpose.

**L14. `delete_contest` writes its audit row before the delete, in the same
transaction, and refuses while any entry is pending or approved even though the
FK cascades.** Enforced in the function. Note the trap: `delete_offer`'s
protection lives only in its function while the FK still cascades, so a
service-key delete sweeps rows away regardless. **Without it:** a contest with
fourteen frozen promises disappears and `audit_log` holds nothing about what was
owed.

**L15. ADDED 2026-08-13, gap 7. "Days left" has exactly one definition, in one
exported function, and every surface calls it.** The design currently reads 50
days on one screen and 49 on another for the same contest, which is two
implementations, not two opinions. The definition:

- **It ceils.** `ceil((expires_at - now) / 24h)`. Any part of a day still to run
  counts as a day, because the alternative floors "23 hours left" to "0 days
  left" on a contest that is still open, which is the one number the string must
  never print.
- **Under 48 hours it stops counting days and counts hours**, ceiled the same
  way. "1 day left" covering anything from one minute to twenty-four is the
  point at which the unit is doing more harm than the number.
- **Under one hour it counts minutes**, ceiled. This is the only window where a
  creator can lose a place by reading a rounded figure.
- **It never prints zero.** On the closing day the string is the deadline
  itself: "Closes today, 11:59pm BST". Zero days left on a contest somebody can
  still enter is a lie the tracker tells while the Apply button works.
- **Past the deadline it prints no countdown at all**, in either direction. No
  "0 days left", no negative, no "ended 3 days ago" on a card whose whole job is
  what is still open. The closed group already has its own sentence and rule L8
  already says the work carries on.
- **`now` is an argument, never `Date.now()` read inside.** The ticking clock
  from rule L5 supplies it, so the string re-renders on the timer instead of
  going stale in a tab left open, and the function stays testable.

Enforced in one file in a neutral folder because both sides read it, exactly as
`contestState()` is. **Without it:** two screens quote two numbers for one
contest, which is the failure rule M10 was written against, arriving on the
deadline instead of on the money. The creator cannot tell which screen is
lying, and both are right about a different arithmetic.

**L16. ADDED 2026-08-13, third design turn. The deadline calendar disables every
instant at or before now once any entry is pending or approved, and says in one
line what to do instead.** This is rule L11 drawn rather than a new rule:
`save_contest` already refuses to move `expires_at` to now or earlier while
anybody is pending or approved, and a calendar that offers a day the function will
refuse turns a rule into an error message the admin meets after typing instead of
a door that was never open. The line under it is one sentence, no longer: ending a
contest early is Cancel or Settle, both of which write a per entry outcome (L11,
L13). On a contest with nobody in it nothing is disabled, because nothing is being
protected. Enforced in the client, with `save_contest` still the boundary.
**Without it:** an admin backdates the expiry to close a contest quickly, gets a
22023 quoting a rule they have never read, and reaches for the delete instead,
which L14 also refuses.

**L17. ADDED 2026-08-13, third design turn. Turning a contest off and deleting one
are both admin controls in step 1, and neither is drawn anywhere in the design. We
add both without asking.** `set_contest_status` and `delete_contest` ship in the
first migration (section 6), and a write function with no control is a capability
nobody has. Off is the `contest_status` switch, which means closed to new entrants
and nothing else, and the control says so where it sits, because L1 and L8 are the
whole reason that switch is safe. Delete is a separate, confirmed, destructive
action carrying the refusal this plan already specifies: it declines while any
entry is pending or approved, raising 23503 and naming the count, in the wording
style `delete_offer` already uses (L12, L14), so the refusal reads as a reason
rather than as a foreign key error.
**Without it:** the only way to stop a contest is to backdate its expiry, which
L11 refuses, or to leave it running, so a contest created by mistake on a live
brand sits on the admin's list for ever with no way to take it off.

### 3.2 The frozen promise and editing (rules F1 to F13)

**F1. At the moment an entry becomes approved, immediately under auto approve or
at the admin decision under manual, copy every active deliverable onto
`contest_entry_terms` and the fixed money onto `committed_amount` /
`committed_video_count`, and never read them live from the contest again.**
Enforced in `apply_for_contest` and `review_contest_entry`; every creator card
and every admin queue row reads the snapshot. **Without it:** an admin edits a
prize on Friday and everyone approved on Monday retroactively claims the new
number. The admin half of that bug already shipped once, at
`src/routes/admin/OfferRequests.tsx:419-431`.

**F2. Editing a contest is split into two tiers, and the tier decides the
refusal, not the presence of entries.** Enforced in `save_contest`.
- **Frozen once any entry carries frozen terms:** `currency`, `brand_id`, the
  `reward_amount` / `video_count` / `rank_position` / `threshold` on an existing
  deliverable row, and moving `expires_at` into the past.
- **Always allowed and always audited:** `name`, `description`, `brief_url`,
  `banner_url`, `judging_basis`, the product list, `needs_admin_approval`,
  extending `expires_at`, adding a NEW deliverable row, and retiring an existing
  one with `is_active`.
- **`judging_basis` is always allowed but not always CLEARABLE.** Added
  2026-08-13 with the column. Writing a better sentence changes nothing anybody
  was promised, so it is not frozen; emptying it on a contest that carries an
  active `rank` row is refused by `save_contest`, because that leaves a placing
  with no stated basis, which is the one state rule N7 exists to prevent.
- **`expires_at_timezone` moves only with `expires_at`, never on its own.**
  Added 2026-08-13 with the column. The two together are one fact, and editing
  the zone alone silently moves the instant for everybody already entered, or
  worse, does not move it and re-labels it, so a deadline that was 11:59pm BST
  starts reading 6:59pm EDT and nobody typed a new time. `save_contest` takes
  both or neither, and the audit detail carries both.

**RULED HERE.** Three rules in the source analysis disagreed about whether a
contest with entries may be edited at all. A blanket freeze is wrong: on an auto
approve contest the first entry carries frozen terms within seconds of
publishing, so the contest would freeze almost immediately and the rules
describing mode flips and soft-disabled deliverables could never fire. The two
tier split is what makes all three coherent. **Without it:** either an admin
cannot fix a typo in a description, or an admin halves the prize pot mid contest
and the creators still filming find out by reading their own frozen numbers.

**F3. `save_contest` writes only the contest's own rows. A deliverable is
retired with `is_active = false`, never deleted, and no edit path may ever update
`contest_entry_terms`.** Enforced in the database: no statement outside the
approval and settlement functions names that table. **Without it:** an entrant's
brief loses the row describing what they agreed to do while their reward stays on
the books.

**F4. Flipping `needs_admin_approval` decides nothing about existing entries in
either direction: true to false does not approve anybody pending, false to true
does not un-approve anybody already in.** Enforced in `save_contest`, which
updates the contest row only. Bulk approving the pending queue is a separate,
explicit, confirmed action. **Without it:** one checkbox approves fourteen
people, freezes fourteen reward snapshots and commits the money in a single
action that does not look like a money action.

**F5. The approval mode and the openness of the contest are read from the contest
row inside the same transaction as the entry write, with the row taken
`for update`, and the client never sends its belief about either.** Enforced in
`apply_for_contest` (locked before any branch) and in the Edge Function (no mode
field exists in the Zod body). **Without it:** a creator whose tab loaded during
auto approve is admitted instantly to a contest that now requires review, and the
entry looks like a normal approval.

**F6. `contests.brand_id` is never updatable, and every attached product is
constrained to the contest's brand by a composite foreign key rather than by the
dropdown being correct.** Enforced declaratively in `contest_products` plus the
absence of `brand_id` from `save_contest`'s update branch. **Without it:** a
contest quietly spends one brand's budget on another brand's products and the
brand rollups stop meaning anything.

**F7. Live entry beats every flag: every screen and every derived state decides
what a creator sees from their own entry row FIRST, and only then consults the
contest's status, mode or expiry.** Enforced in the client, in a `stateFor`
equivalent living in a neutral file because both sides read it. This is verbatim
the lesson of `src/lib/creator/useAllOffers.ts:137-149`, and a contest has three
flags where an offer had one, so it has three ways in. **Without it:** an entrant
mid deliverable on a contest that just expired sees "Closed" where their tracker,
their deliverables and their reward used to be, while the admin queue still shows
them working. One contest, two answers.

**F8. ADDED 2026-08-13, third design turn. The brand is context, not a field. The
setup form carries it as a heading and offers no way to change it.** This is rule
F6 drawn: `contests.brand_id` is never updatable, it is absent from
`save_contest`'s update branch, and the form is only ever opened from inside a
brand, so the only thing a change affordance can do is raise an expectation the
function is built to refuse. **The change control the design draws comes off**, and
the brand's name becomes the line that says whose contest this is.
**Without it:** an admin retargets a contest to another brand, is refused with no
sentence attached to the control that offered it, and the composite foreign key in
`contest_products` is the only thing standing between that and a contest spending
one brand's budget on another brand's products.

**F9. ADDED 2026-08-13, third design turn. The Instant and Reviewed toggle carries
rule F4's sentence beside it, in the form: flipping it approves nobody pending and
un-approves nobody already in.** F4 already enforces exactly that in
`save_contest`, which updates the contest row and touches no entry; this rule is
that guarantee said out loud at the moment the decision is made, because the
toggle looks precisely like a control that would sweep the queue. The sentence is
one line under the toggle, not a tooltip, because a hover has no tap equivalent on
a phone.
**Without it:** an admin flips it to Instant expecting the fourteen people waiting
to be let in, nothing happens to any of them, and the next move is either a
support question or somebody building the bulk approval F4 deliberately kept
separate.

**F10. ADDED 2026-08-13, third design turn. Every column with a writer gets a
control, and four of them have none in the design. They get one without asking.**
Each is a column that already ships in this plan and already has a function
argument behind it:
- **`contest_commercials.internal_note`** (2.3). Staff only, never rendered on a
  creator surface, and the only place an admin can write down why the budget is
  the number it is.
- **`contests.opens_at`** (2.2). It exists, it defaults to `now()`, and the table
  already checks that the expiry is later than it. A contest that opens on Monday
  is a thing the schema can already do and the form cannot say.
- **`contests.currency`** as a real select over the existing `CURRENCIES` list,
  not a word printed inside a money field's label. It is the single currency
  dimension of the whole contest (2.0) and rule M5 groups every total by it, so it
  is a decision, not a decoration.
- **`contest_deliverables.sort_order`** (2.4). It decides the order every entrant
  reads the reward rows in, and it is indexed for exactly that.
**Without it:** the migration ships four columns nothing can write, they take
their defaults for ever, and the first admin who needs one gets a second form
bolted on later rather than a field that was always meant to be there.
**A fifth column joined the form on 2026-08-13 and is not one of these four**,
because it is an answer rather than an omission: `contests.judging_basis` arrived
with Q13, it has a control from the day the column exists, and rule N7 is its
specification.

**F11. DECIDED BY RASHID 2026-08-13, Q11. The admin types every reward row's
title, every time, and nothing anywhere generates one.** Not the client, not
`manage-contest`, not `save_contest_deliverable`, not a database default, and not
a fallback at render time. A row arriving with a blank or whitespace-only title is
refused by the database, through the trimmed length check that
`contest_deliverables.title` has always carried (2.4), and refused by the form
first, **with a named message against that row rather than a form level error**,
because a contest with six reward rows and one untitled one is a form the admin
cannot fix from a sentence at the top of it. Enforced in three places, exactly as
rule S7's brief link is: the Zod schema, the same schema again inside the Edge
Function, and the column check.
**He chose this against the recommendation, which had been to generate a title
from the row's own numbers and let him override it, so the cost is his and is
recorded:** one more thing to type on an already long form, on every reward row,
and a contest with six rows means six titles typed. What he bought with it is
that the sentence every entrant reads on their frozen terms (2.7, rule F1) is his
sentence, the same words on the promise as on the form, and changing it later is
an edit rather than a code change.
**Without it:** the generated title ships as a fallback "for now", every contest
in the product carries the same six phrases, and the words on fourteen frozen
promises are ours.

**F12. DECIDED BY RASHID 2026-08-13, Q12. A half filled contest lives in the
browser and nowhere else. There is no draft row.** `contests.name` and
`contests.expires_at` stay `not null`, `contest_status` gains no draft value, no
column is made nullable to hold a partial contest, and `save_contest` either
writes a legal contest or raises (2.13). **Nothing incomplete can reach a count, a
list, a policy or a screen, because nothing incomplete exists in the database.**
That is the whole value of the answer, and it is why `contest_is_open`, both
creator select policies, `contest_totals` and every admin list need no draft
clause: there is no state for them to exclude.

**What is held, and where.** The in-progress form is kept client side, **keyed on
the admin's own user id AND the brand AND the contest being edited (or `new`)**,
so two admins sharing one machine and one admin working on two brands cannot
collide, and it is cleared on a successful save and on sign out. It survives a
reload and a closed tab, which is the whole of what it was asked to do.

**What is NOT held.** Nothing staff-only and commercially sensitive beyond what
that admin can already read on that screen, which is the bound rather than a
promise to be careful, and **never an uploaded file**: the banner is uploaded
first and only its URL is kept, once the upload has succeeded (rules B6, B8). A
half filled form holding a 2 MB image is a storage quota and a privacy question
that nobody asked for.

**The cost he accepted, plainly:** it does not follow an admin to a different
computer. The design promises "picked up where you left it yesterday", and that
sentence is only true on the same machine, in the same browser, signed in as the
same person. **The designer must be told**, and it is item 1 of what handback 5
owes them (3.14).
**Without it:** drafts become schema work, `name` and `expires_at` stop being
required, and then every creator read path, `contest_is_open`, both select
policies and five write functions each grow a clause excluding a contest that was
never finished, and the first one that forgets shows a creator a contest with no
name.

**F13. DECIDED BY RASHID 2026-08-13, Q14. The contest setup form is a FULL SCREEN
of its own, a route reached from the brand hub's Contests tab, and it is not a
dialog anywhere in this document.** His reasoning, recorded: a contest carries
around twelve fields plus three lists inside it, the products, the reward rows and
the people barred from it, which is beyond a dialog.

**What that binds, and all of it is the owner's admin layout rules applying in
full** rather than anything new: the working content starts high, the header stays
compact, reference data goes under an **Overview** rather than stacked above the
work, the content sits left against the sidebar at a max width and is never
centred, and no slug, id or route is ever shown to an admin. It is checked at
375px, 768px, 1024px and 1440px like every other admin screen, as a **page** case
in the responsive suite and not as a modal one (join 15).

**The entry panel for CREATORS is unaffected and stays a dialog.** It carries one
decision and a note, it is opened from a card the creator is looking at, and
nothing about this ruling reaches it.

**The precedent it sets, stated because it is real:** this is the only admin
editor in the product that is not a dialog, and every later form will be measured
against it. That is accepted; the alternative was a twelve field form with three
nested lists inside a panel that has to fit 375px.
**Without it:** the form ships as a dialog, the three lists inside it each get
their own scroll region, and on a phone the admin is scrolling a list inside a
panel inside a page, which is the shape that has to be unbuilt rather than fixed.

### 3.3 Money (rules M1 to M10)

**M1. The contest's total budget is in `contest_commercials`, never as a column
on `contests` or on anything else a creator can select from.** Enforced in the
database (separate table, one `is_staff()` policy, no creator policy), in the
client (a creator hook file that cannot import `@/lib/admin/*`), and in the
suite. **Without it:** a creator opens the network tab, reads
`/rest/v1/contests?select=*`, and learns what the brand is paying out on every
contest in the product.

**M2. No table, view or Edge Function response a creator can reach carries
`total_budget` or anything derived from it, including a percentage, a bar width
or a "spots left because the money ran out" hint.** Enforced in the database
(`contest_totals` carries no budget column at all) and in the client (explicit
`COLUMNS` constants, never `select('*')`). **Without it:** "this contest is 80%
funded" plus one known reward reconstructs the allocation, so the budget is on
the creator's screen dressed as a progress bar.

**M3. Contests keep no maintained running total. Every contest money figure is
derived by summing frozen entry rows through `contest_totals`.** Enforced in the
database (no `budget_used` column exists to write). **Without it:** contests
inherit the failure that produced `scripts/ops/reconcile-budgets.mjs`, and a second
writer on a running total with no shared helper is how the total and the rows
come to disagree.

**M4. Contest money does not touch `brand_commercials.budget_used`, and the
brand's budget bar therefore keeps meaning offers only, which every screen
rendering it must say in words.** **RULED HERE**, and decided by Rashid on
2026-08-12: see section 5, decision 2, and rule M10, which is the other half of
this one and ships with it.
Enforced in the database (nothing in the contest functions names
`brand_commercials`) and in the client (the bar's label, the brand list spend
filter's label, and the admin home "at risk" line). **Without it, either way:**
if contest money silently enters `budget_used`, the next run of
`scripts/ops/reconcile-budgets.mjs:51-84` recomputes the total from
`offer_applications` alone and deletes every contest commitment while printing it
as a correction. If it does not enter and nothing says so, a brand shows 78%
committed, is not flagged at risk, and is actually overspent.

**M5. Every contest money total is grouped by currency, and a mixed row says
"Mixed" rather than adding.** Enforced in the view's `group by` and in the
client, one money block per currency. `contests.currency` pins a contest to one,
and the grouping is what makes that provable rather than assumed. **Without it:**
an admin reads one number, decides the contest is within budget, and it is the
sum of dollars and pounds.

**M6. Contest money does NOT flow through `summarise()` in
`src/lib/creator/useMyWork.ts:190-230`; it is a separate, separately labelled
block on the creator home and never feeds the offers headline total.**
**RULED HERE.** Two source rules contradicted each other: one demanded contest
money go through `summarise` so the three cards still add up, the other demanded
nothing ever sum across currencies. `summarise` at line 207 does
`if (row.currency) money.currency = row.currency;`, one scalar overwritten by
whichever row came last, and then adds every row regardless of currency. Routing
contest money into it would push it into the one function in the product that
already commits the exact error M5 bans, and contests are more likely to be
mixed-currency than offers. It also buckets by `STAGE_META[stage].bucket` over
`Record<OfferStage, ...>`, which a contest entry has no value for.
**Without it:** either the three money cards stop adding up to the headline, or
they add dollars to pounds. Both are the worst possible bug on the one screen
whose whole promise is that the numbers are real. Note this leaves
`summarise()`'s pre-existing single-currency assumption untouched and unfixed; it
is now written down.

**M7. `save_contest` refuses when the sum of active `fixed` deliverable rewards
exceeds `contest_commercials.total_budget`, raising 22023 with both figures.**
Enforced in `save_contest`, under the contest row lock. This is a different case
from the deliberate call that approving is never blocked for going over budget:
that rule is about a running total drifting past an allocation over time, whereas
a single prize arithmetically larger than the whole pot on the day it is typed is
a typo. **Without it:** a contest budgeted at £2,000 carries a £2,500 prize and
nothing anywhere says so until somebody is owed it.

**M8. Ranked and milestone rewards commit at settlement, not at approval, into
`contest_awards` with their own `awarded_amount` / `awarded_currency` snapshot, a
`unique (contest_id, entry_id, term_id)` index and a `settled_at` guard raising
55006.** Enforced in `settle_contest`. **Without it:** clicking Settle twice pays
the prize pot twice, and there are no idempotency keys anywhere in this project
to catch it.

**M9. Nothing in the contest path accepts money, a rank, a deliverable count, a
`creator_id`, a handle or a `brand_id` from the client. `apply_for_contest` takes
`p_actor_id` and `p_contest_id` only.** Enforced in the function signature, in
the Zod body (which still accepts the dead fields purely so the Edge Function can
refuse them in a sentence, as `manage-offer-application/index.ts:34-46` does),
and in the payload type. **Without it:** a creator posts
`{ contestId, amount: 5000 }` and commits five thousand pounds of a brand's money
to themselves.

**M10. Any surface that shows a brand's offer money shows that brand's contest
money beside it, in its own block with its own label, in the same view, at the
same moment, and the two are never added together.** This is the mitigation
Rashid was promised in writing when he chose the separate pot on 2026-08-12, and
it is a requirement, not an option. It binds the brand Overview, the brand list's
spend column and its spend filter, `BudgetBar` wherever it renders, the admin
home's committed-money block and the admin home's at-risk line: each shows offers
committed, contest committed and contest awarded, each labelled, each grouped by
currency under M5, and a brand with no contests shows a zero rather than hiding
the block, because a missing block reads as "there is no contest money" exactly
when there is. Enforced in the client (every one of the surfaces in joins 6, 7 and
8 reads `brand_contest_totals` in the same query batch as the offer figure) and in
the suite (a brand with both kinds of money renders both numbers, and neither
equals the sum). **Without it:** a number disagrees with another number. The
Overview says a brand has committed 12,000 while the contest screens for the same
brand add up to 19,000, and there is nothing on either screen that explains the
gap, so Rashid has to hold the rule in his head to read his own money correctly.
That is worse than the single misleading figure the separate pot was chosen over.

### 3.4 Exclusion (rules X1 to X10)

**X1. Exclusions live in their own table with one `is_staff()` SELECT policy and
no creator policy, and are never joined into any view, realtime publication or
Edge Function response a creator can reach.** Enforced in the database and by
keeping `contest_exclusions` out of `supabase_realtime`. **Without it:** a
creator reads the list of people a brand has barred, with handles and the admin's
reason. That is a defamation-shaped leak, not a data leak.

**X2. Exclusion is enforced inside `apply_for_contest` against identity derived
from `auth.uid()`, and any hiding of the contest by RLS is cosmetic on top of
that.** Enforced in the database. RLS needs a uuid to compare against
`auth.uid()`, and the handle everybody types is not on `profiles` at all.
**Without it:** the excluded creator, who is exactly the person motivated to try,
posts the contest id straight at the Edge Function and is enrolled.

**X3. The only durable exclusion key is a resolved `user_id`. `handle` and
`email` are both editable by the person being barred, so
`save_contest_exclusion` resolves them to a uuid the moment it can and pins it,
and an exclusion that has never resolved is flagged as unresolved on the admin
screen.** Enforced in the database and surfaced in the admin UI.
`applications.tiktok_handle` carries a standing column-level UPDATE grant to
`authenticated` (`20260729153108:107-108`) whose guard trigger protects only the
review columns, and `profiles.email` is synced from `auth.users` by
`on_auth_user_email_changed` (`20260729145631:212-232`), so a creator can change
either from the browser. **Without it:** an excluded creator renames their handle
and walks straight in, and the admin who typed the exclusion never learns it did
nothing.

**X4. An excluded creator's attempt is recorded by the Edge Function AFTER the
refusal returns, never by an insert inside the refusing transaction.** Enforced
in `supabase/functions/manage-contest/index.ts`, which on a 42501 with the
exclusion marker calls `record_contest_exclusion_attempt` and writes a
`contest_entry.excluded_attempt` audit row, exactly as every `*.write_denied` row
is written today. **Without it:** a `raise` aborts the transaction and takes the
audit insert with it, so the admin opens `/admin/activity` to check whether the
exclusion was tested and sees nothing at all. No function in this codebase writes
an audit row and then raises, for this reason.

**X5. The attempt is tracked as a counter on the exclusion row
(`attempts`, `last_attempt_at`), not as an entry row with an `excluded` status.**
**RULED HERE.** An analyst proposed an entry row so the attempt appears in the
admin queue. Rejected: an `excluded` status sits outside the
`(contest_id, creator_id) where status in ('pending','approved')` partial index,
so nothing bounds how many an excluded creator can create, and holding the Apply
button fills the very queue the exclusion was meant to protect. The counter gives
the admin the same fact with a fixed row count. **Without it:** an unbounded row
per tap on a table nothing pages.

**X6. The refusal is loud: a non-2xx with a human sentence, never a cheerful
success, and never a silently stripped field.** Enforced in the database (42501),
in the Edge Function (403 through `reply()` so it carries CORS), and in the
client (inline `role="alert"`). **Without it:** the excluded creator believes
they entered and films for nothing. That is the failure
`manage-offer-application/index.ts:34-46` already paid for once.

**X7. Adding an exclusion has no effect on an entry that already exists. The
exclusion table is consulted at one moment only, inside `apply_for_contest`, and
`save_contest_exclusion` touches no entry row of any kind.** Enforced in the
database: no statement in `save_contest_exclusion` or
`remove_contest_exclusion` names `contest_entries`, `contest_entry_terms` or
`contest_submissions`. **Without it:** an admin types a handle to block a future
applicant and quietly kills a current entrant's work with no record and no
notification, which is the rule F4 shape, one field performing fourteen
decisions.
**Changed on 2026-08-13.** This rule used to end "removing somebody already in is
`remove_contest_entry`, its own audited action". That function is cut. There is
no second action to reach for and no admin control anywhere that takes a live
entrant out. See X9 and 3.4.1.

**X8. CORRECTED 2026-08-13, gap 1. It was not true as the policies stood, and it
was untrue in a bigger way than the review found. There is no clickable path to
an excluded contest anywhere in the product, so the refusal exists only server
side, is deliberately vague, and is recorded.**

**RULED HERE: the policies changed, not the rule and not the function.** The
review found one hole: `review_contest_entry` with `p_block` writes an exclusion
row on rejection, while `contests_select_own_entries` kept the contest readable
to anybody holding an entry row, so a rejected and blocked creator kept a
readable contest and a lit Apply button. Rule E2 is what lights it, correctly, on
purpose: the partial unique index is partial precisely so a rejected creator may
enter again. The client cannot tell those two rejected creators apart, and it
must not be able to, because `contest_exclusions` has no creator policy and D3
says an excluded creator is never told.

**Reading the policy block again while fixing it turned up the larger half.**
`contests_select_creator` was `is_approved_creator() and contest_is_open(id)`,
with nothing about exclusions in it at all. So an excluded creator who had never
applied saw the contest in the catalogue, with a working Apply button, and would
have been refused only at the Edge Function. D3's own sentence, "RLS hides it
from the catalogue and from every creator read", was never implemented anywhere.
The rule was describing an intention.

**Both policies now carry `and not public.contest_excludes_caller(id)`** (2.10),
resolved through the single definition in 2.12.1 that `apply_for_contest` also
calls, so the catalogue, the own-entry read and the write gate cannot answer
differently. **Why the policy and not the rule:** rewriting X8 to admit the lit
button would have contradicted D3, a decision Rashid made on 2026-08-12, and
this document does not get to reopen his decisions by softening a rule under
them. **Why not the function:** `review_contest_entry` writing the exclusion is
correct and is the point of the block flag; the defect was that nothing read it
back.

**The cost, stated because it is a real loss.** A creator who is rejected and
blocked loses the contest's name and the brand's name on their own history: the
`contest_entry_events` row survives, the contest behind it goes dark. That is
the same trade D3 already made for an excluded creator who never applied, and it
argues against rule L3's transparency instinct. It is accepted because the
alternative is one of two worse things: telling somebody they are barred, which
D3 refused, or leaving a live Apply button that returns a deliberately vague
refusal, which is the bug. **A rejected creator who is NOT blocked loses
nothing** and may still see the contest and enter again, which is what E2 is
for, and the suite proves the two cases separately.

Rashid decided on 2026-08-12 that an excluded creator simply never sees the
contest: RLS keeps it out of the catalogue and out of every creator read (X1, X2
and the two `contests` select policies, which as of 2026-08-13 actually do it).
Nothing renders an Apply button they can press. What remains reachable is the
API itself, by a creator who kept an id, or
who was excluded after having already seen the contest, and that attempt is
refused by `apply_for_contest` with one flat sentence that names no reason, then
counted by `record_contest_exclusion_attempt` (X4, X5) and surfaced to staff.
**The admin dashboard must therefore call this a blocked attempt on the contest,
never a click, a tap, an application or a rejected request**, and must not put it
in the entries queue, because there was no button and there is no entry. The
wording carries the whole meaning here: "3 blocked attempts", not "3 people tried
to apply". **Without it:** the admin screen tells Rashid somebody pressed a button
that does not exist, so he goes looking for the leak that let them see the
contest, and there was never a leak.

**X9. SETTLED 2026-08-13. An entry, once made, cannot be revoked by an admin at
all. Excluding somebody blocks NEW entries only; anyone already in stays in,
keeps their frozen terms, keeps their submission path, keeps their place at
settlement, and stays visible to staff carrying an excluded flag rather than
disappearing from the queue.** Rashid ruled it in these words: the admin decides
while creating the contest who to exclude, and if somebody has already joined
there is no need to exclude them. The exclusion list may still be edited after
the contest is created, and editing it only ever stops new people joining.
Enforced in `save_contest_exclusion` (which touches no entry row, X7), in the
absence of any function, Edge Function action, RLS policy or admin control that
takes a live entry out of a contest, the creator's own withdrawal aside, and on
the admin entries queue, which reads the exclusion table only to draw the flag.
**Without it:** two admins hold two different beliefs about what typing a handle
does to the four people already filming, and the first time it happens for real
is the time it matters. **The cost of the answer he gave is real and is written
down in full in 3.4.1 rather than left to be discovered.**

**X10. ADDED 2026-08-13, third design turn. The exclusion list editor shows three
things the design leaves off, and all three are columns that already exist because
rules X3 and X5 depend on them being seen.**
- **The `reason` field.** It is staff only and never leaves the table (X1), so it
  is safe to collect, and it is the only record anywhere of why a name is on the
  list. Without it the list is a set of handles nobody can defend six weeks later.
- **The unresolved flag, worded as "this bar has not matched an account yet".**
  That is rule X3 made visible, and the wording matters as much as the flag: an
  exclusion typed before that person has signed up is the NORMAL case, not an
  error, so it must not read as one. What it does mean is that only the handle or
  the email is being compared, and both are editable by the person being barred,
  until `save_contest_exclusion` resolves and pins a `user_id`.
- **The attempts counter and `last_attempt_at`.** This is the whole point of rule
  X5, and it is the fact Rashid asked for by name. Rule X8 fixes the words: "3
  blocked attempts", never a click, a tap, an application or a rejected request,
  because there was no button and there is no entry.
**Without it:** the admin who typed a handle never learns it resolved to nobody
(X3), and the counter on the exclusion row is a number no screen ever prints,
which costs exactly as much as not tracking it and looks like tracking it.

### 3.4.1 The accepted risk: there is no lever to pull a bad actor out

**Accepted by Rashid on 2026-08-13, deliberately, with the consequence stated to
him.** Because X9 admits no admin revocation of an entry, there is **no action
anywhere in this product that removes a creator from a contest they have
joined.** If somebody turns out mid contest to be a bad actor, nothing takes
their entry away. That is the trade he chose and it is not an oversight to be
tidied up later.

**The levers that remain, and they are the whole set:**

1. **Reject their submissions.** `review_contest_content` refuses the work, so
   the deliverables never complete and the fixed money is never earned. Their
   entry stays on the books at approved with nothing behind it.
2. **Award them nothing at settlement.** `settle_contest` writes
   `contest_awards` rows for the placings it is given, and a name that is not
   given a placing is paid nothing. Ranked and milestone money commits at
   settlement precisely because nobody knows at approval who deserves it (M8).
3. **Cancel the whole contest.** `cancel_contest` still exists and still works,
   and it is **deliberately blunt: it affects every entrant, not one.** It is
   the fire alarm, not a tool for handling one person, and any screen offering
   it must say what it does to everybody else.

**Why this is written here rather than left implicit.** A missing removal action
looks exactly like an unfinished feature. The next person to read the admin
entries queue will see a row they cannot act on and reach for the obvious fix,
and the obvious fix is a function that voids a frozen promise. So: **do not add
a removal action, a soft-remove, a disqualify flag, an `excluded` entry status or
an admin-side withdraw. Any of those is a change to a decision Rashid made on
2026-08-13 and needs his word first.** If the risk ever bites hard enough to be
worth paying for, the conversation to have is a named feature with its own audit
verb, its own confirmation and its own creator-facing explanation, not a quiet
re-addition of `remove_contest_entry`.

### 3.5 Entry, duplication and withdrawal (rules E1 to E6)

**E1. A duplicate entry is stopped twice: by the partial unique index
`contest_entries_one_open_idx` and by an `if exists ... raise 55006` inside
`apply_for_contest`.** Enforced in the database, both. There are no idempotency
keys anywhere in this project, so a row lock, a status guard and a partial unique
index are the entire defence. **Without it:** on an auto approve contest a double
tap creates two approved entries and two frozen rewards.

**E2. The index is partial, covering only pending and approved, so a withdrawn
or rejected creator may enter again while the contest is open, and every
re-entry is a NEW row with its own `created_at`, never a revival.** Enforced in
the index and by `apply_for_contest` always inserting. **Without it:** either a
single rejection bars somebody permanently with no admin decision behind it, or a
re-entry silently carries last month's reward terms.

**E3. Withdrawal is the creator's own act and nobody else's. It is always allowed
from pending; from approved it is allowed only while the entrant has submitted
nothing and been awarded nothing; past that the entry stands and there is
nothing that undoes it.** Enforced in `withdraw_contest_entry`, which locks on
`id AND creator_id` and raises 55006 with a sentence.
`withdraw_offer_application` refuses anything not pending, which is correct for
offers because approval is always an admin act; auto approve breaks that
assumption, because a creator who taps Apply is instantly in.
**Note what changed on 2026-08-13:** this rule used to end "and past that leaving
is an audited admin removal". There is no admin removal any more (X9), so past
that point the entry is simply final, for the creator as well as for staff, and
the outcome is decided by review and by settlement rather than by taking the row
away. A creator who wants out after filming is a support conversation, not a
button.
**Without it:** either a mistaken tap traps somebody in a contest with
commitments they never meant, or somebody withdraws after three approved videos
and the brand has paid for work attached to nobody.

**E4. Auto approve is one transaction. There is no insert-pending-then-approve
second call.** Enforced in `apply_for_contest`. **Without it:** half-entered
creators sit pending forever on a contest that has no review queue and an admin
who does not know to look.

**E5. Any check against a cap, a budget ceiling or a limited prize takes the
contest row `for update` before counting and re-checks after taking it.**
Enforced in every function that counts against a limit; the Edge Function
processes batches sequentially, as `review-application/index.ts:164-165` already
does. **Without it:** two creators take the last place, or two approvals spend the
last of the pot, and nothing ever notices.

**E6. Being able to see a contest never means being able to enter it: browsing is
`is_approved_creator()` (which admits ops and admin), entering is
`assert_active_creator` (which requires `role = 'creator'` exactly).** Enforced in
the two different gates, and in the client, which reads the profile row rather
than the JWT claim. **Without it:** an admin browsing a brand hub is shown Apply,
taps it, and gets a 42501 that reads like a permissions bug in the admin panel.

### 3.6 Security and the write path (rules S1 to S9)

**S1. No contest table has an INSERT, UPDATE or DELETE policy of any kind; every
write goes through one `manage-contest` Edge Function into a definer function
granted to `service_role` alone, and that includes contest submissions.**
Enforced in the database and the Edge Function. **Without it:** a creator PATCHes
their own entry to `status = 'approved'` and commits the brand's money to
themselves.

**S2. Every function is closed with `revoke all ... from public, anon,
authenticated;` immediately followed by `grant execute ... to service_role;`, and
every table and view gets `grant all privileges on table ... to service_role;`.**
Enforced in the migration. **Without it:** either every contest write returns
"permission denied for function", or every Edge Function reads zero rows and it
looks like RLS working rather than a missing grant.

**S3. Any change to a contest function's argument list requires an explicit
`drop function if exists public.<name>(<old arg types>);` before the new
definition.** Enforced in the migration. **Without it:** the looser old signature
survives, still granted to `service_role`, and a stale deployment binds to it.
That is how an accepted-then-withdrawn client-supplied amount comes back to life.

**S4. Every contest view that groups by contest, by brand or over entrants is
`security_invoker` AND carries
`and (select public.is_staff() or public.is_service_role())` in its WHERE clause;
only `contest_entry_progress`, which is keyed to exactly one creator, is shared.**
Enforced in the view bodies. **Without it:** a creator opens a leaderboard, the
view returns their own single row with no error, and the screen renders it as the
whole ranking. There is no error to debug and Rashid cannot read a console.

**S5. NARROWED 2026-08-13 BY D7. A creator sees no number about other entrants
at all, so there is nothing for this rule to permit and it now bans the whole
class.** It used to read "must come from a definer function or a staff-written
published snapshot, never from a count a creator's own query can run", which was
a rule about the safe way to build a headcount. D7 says there is no headcount, no
standings and no published snapshot (rules N1 to N4), so the safe route is
closed along with the unsafe one. Enforced in the database and in the client (no
`count: 'exact'` on `contest_entries` in any `src/lib/creator/` hook).
**The one number that survives is the creator's own placing**, which is a stored
fact about their own entry rather than a count over anybody (2.9, rule N3).
**Without it:** every headcount and every rank on the creator side is quietly the
number 1. **And with the old wording:** somebody builds the headcount through a
definer function, correctly, having read a rule that told them how.

**S6. Every creator-side realtime subscription on a contest table pins
`filter: creator_id=eq.${user.id}`, and `contests` joining the shared catalogue
channel means a contest is retired with `is_active`, never hard-deleted, while
creators are subscribed.** Enforced in the client hooks and in the publication
membership. `postgres_changes` does not apply row security to DELETE events and
these tables carry `replica identity full`, and
`src/lib/creator/useCatalogueLive.ts:19-21` currently claims otherwise in a
comment that is wrong for deletes. **Without it:** an admin deletes a contest
outright and every creator with a hub open receives the full old row, including
contests deliberately hidden from them.

**S7. The content brief link is validated as `^https://` with a length bound in
the database, in the Edge Function and in the client Zod schema, and is rendered
with `rel="noreferrer noopener"`.** Enforced in all three layers plus the anchor.
**Without it:** a `javascript:` or `data:` URL pasted into an admin field renders
as a link every entrant is told to click.

**S8. A suspended creator keeps their frozen terms and their money, keeps being
able to read their own entry, and cannot enter, withdraw or submit.** Enforced in
the database: the own-entry policies test only `auth.uid()` so they survive
suspension, while `assert_active_creator` raises 42501 on every write. The admin
screen shows a suspended entrant as suspended rather than as idle, and
`settle_contest` refuses to award a suspended entrant without an explicit
override. **Without it:** the current shape gives a suspended creator an entry
pointing at a contest whose name they can no longer read, because
`is_approved_creator()` requires `is_active` and the browse policy goes dark
while the own-entry policy does not. They can neither withdraw nor deliver, and
settlement can still pay them.

**S9. ADDED 2026-08-13, gap 5. Nothing may claim a live connection unless it is
reading one. Every `subscribe()` in the contest path passes the status callback,
that status is exposed as state, and any dot or sentence asserting the connection
renders three states from it.** Enforced in the client.

**The gap this closes.** Nothing in this codebase reads a realtime connection
status today: every `subscribe()` call in `src/lib/` passes no handler at all.
The design's waiting screen carries a dot and the sentence "Connected. The
answer appears here the second it is made." As things stand that dot is
hard-coded optimism. It would keep saying connected through a dropped socket, a
sleeping phone, a tunnel, and a Supabase restart, which is the worst possible
combination for the one screen whose entire job is "you do not have to keep
checking". A creator would take us at our word and miss the decision.

**The three states, and the copy each one is allowed:**

- **Connected** (`SUBSCRIBED`). The sentence stands as designed. Dot is
  `--wx-stage-live`, the one piece of persistent motion the design allows.
- **Reconnecting** (`CHANNEL_ERROR`, `TIMED_OUT`, and the window while
  `supabase.realtime` retries). The dot stops claiming anything, the copy drops
  to "Reconnecting. Pull down to check for an answer now." and the query's
  `refetchInterval` from rule L5 takes over, which is the reason the timer
  exists on this feature at all and is now doing two jobs.
- **Offline** (`CLOSED`, or the browser reporting offline). No dot, no claim,
  and the copy says plainly that the screen will not update by itself. This is
  the state that must never be silently rendered as the first one.

**The dot is never the only signal**, per the design's own rule: the word
changes with it. **Without it:** we tell a creator in writing that they can stop
checking, on a screen that has stopped listening, and the failure is invisible
to us because there is nothing logging it and Rashid cannot read a console.

### 3.7 The audit trail (rules A1 to A4)

**A1. Every contest transition writes its own dotted verb to `audit_log` in the
same transaction:** `contest.created`, `contest.updated`, `contest.status_changed`,
`contest.settled`, `contest.cancelled`, `contest.deleted`, `contest.products_set`,
`contest.exclusion_added`, `contest.exclusion_removed`, `contest_entry.created`,
`contest_entry.approved`, `contest_entry.rejected`, `contest_entry.withdrawn`,
`contest_entry.excluded_attempt`, `contest_entry.awarded`,
`contest_content.reviewed`, `contest.write_denied`. There is no
`contest_entry.removed` verb, because there is no action that would write one
(X9); registering a verb for an act that cannot happen is how the act gets built
to fill it. **There is no `contest_entry.target_set` verb either, and that
absence is the opposite case: the act happens, often, and is deliberately not
recorded**, because `audit_log` is staff readable and the verb's detail would
carry the one number `contest_entry_targets` exists to keep from staff (2.6.1,
rule T4). `contest_entry.awarded` now fires once per entrant rather than once per
winner, because settlement records a placing for everybody (D7, 2.9), so it is
the busiest verb in the feature and its detail carries the placing and the
amount, which is zero for most of them. Enforced in the definer
functions and the Edge Function. `audit_log.action` is `text` not an enum
precisely so a new verb is not a migration. **Without it:** nobody can
reconstruct who committed a brand's money to which creator, and the exclusion
attempts Rashid explicitly asked to track are lost.

**A2. Every one of those verbs is registered in BOTH
`src/lib/admin/useAuditLog.ts:96-112` and `src/routes/admin/CreatorDetail.tsx:341-351`,
using the exact strings the migration writes.** Enforced in the client, two
files. Note the two fallbacks also disagree: `useAuditLog` strips only the
namespace so `contest_entry.excluded_attempt` renders "excluded attempt", while
`CreatorDetail` replaces every `.` and `_` so the same string renders "contest
entry excluded attempt". **Without it:** the activity log prints machine output,
which is exactly how "offer application.stage changed" reached production. While
in the file, fix the four keys that already never match: the map holds
`brand.saved`, `brand.about`, `offer.saved` and `product.saved` while the database
writes `brand.created` / `brand.updated` / `brand.about_updated` /
`offer.created` / `offer.updated` / `product.created` / `product.updated`.

**A3. `linkForSubject` (`useAuditLog.ts:133-141`) gains a `contest` case pointing
at a real address, and every per-record contest history passes BOTH
`subjectType` and `subjectId`.** Enforced in the client. The index is
`(subject_type, subject_id)` and a btree cannot serve a predicate that skips its
leading column. **Without it:** every contest row in the log is dead text among
live links, and the history panel scans a table that only grows.

**A4. `audit_log` gains an index on `action` in the contests migration.**
Enforced in the database. `useAtRisk` (`src/lib/admin/useOpsHome.ts:186-190`)
counts rows with `action like '%_denied'` over the last week and there is no
index on `action` today (`20260729162827:59-63` lists all four). Contests add two
new denial verbs to that scan on the first screen Rashid opens.
**Without it:** the admin home gets slower every week that anybody probes a
contest.

### 3.8 The banner image (rules B1 to B8)

Decided by Rashid on 2026-08-13, decision 6. A contest carries optional banner
artwork that a staff member uploads inside the contest setup form.

**B1. The banner is optional on every contest, and a contest without one is the
NORMAL case rather than a fallback. Every screen that can show a banner must
look deliberate with none.** Enforced in the column (nullable), in Zod (optional
on both sides) and in the design: no dashed placeholder box, no grey rectangle,
no "no image" label, no reserved gap where a picture would have been. A contest
with no banner is a contest whose card simply starts at its name.
**Without it:** the dev database is empty and Rashid's first contests will have
no artwork, so the first thing he sees of this feature is six broken-looking
cards, and the fix somebody reaches for is a stock image that lies about which
brand it belongs to.

**B2. The banner appears where a contest is being SOLD: the contest's own page,
and the top of the join popup. In a scrollable list it is small or absent, never
full bleed.** Enforced in the client, in the one contest card component that both
the hub tab and the contests screen use. The whole argument for that scannable
list, direction 1A in `docs/archive/UI_BRIEF_CONTESTS_HANDBACK2.md`, is that a creator
can go six contests deep with one thumb; a full width image per row costs four of
those six.
**Without it:** the list becomes a carousel of pictures, the names stop being
comparable, and the thing the creator came to read, what it pays and when it
closes, is below the fold on every row.

**B3. No words ever sit on top of the banner without a solid scrim behind them.
The preferred shape is no overlay at all: the banner is a band, and the text sits
below it on a solid surface token.** Enforced in the component and in review,
because it CANNOT be enforced by the guard. `scripts/build/check-contrast.mjs` compares
token against token; it has no way to evaluate text over a photograph, whose
contrast changes pixel by pixel and changes again when the admin swaps the image.
**This is the one place in the whole product where a WCAG failure can ship
silently**, passing `pnpm build`, passing `pnpm check:contrast` and passing
`pnpm verify:browser`, and being unreadable on a phone in daylight.
**Without it:** cream text lands on a cream product shot, nothing in the
toolchain says a word, and the only person who finds out is a creator who cannot
read what the contest pays.

**B4. SETTLED 2026-08-13 AS DECISION D8. The banner sits INSIDE THE READING
COLUMN, at a fixed 3:1, on every surface and at every width, and its space is
reserved before the image loads so nothing on the page jumps.** Enforced in the
client with `aspect-ratio: 3 / 1` on the container plus `width` and `height` on
the element, never a bare `<img>` that sizes itself on arrival, and with the
container inside the same max-width the text sits in rather than breaking out of
it.

**The full width strip is CUT.** One 1440 frame in the design drew the banner as
a bleed across the whole content area while the other surfaces drew it inside
the column, and Rashid ruled on the column. One crop, everywhere. The reason is
comparability: two crops means one contest can be twice the height of the next
on the same screen, and the taller one reads as the more important one when all
that actually differs is which admin uploaded a wider file.

**The upload preview in the setup form shows exactly the crop the creator will
see**, at 3:1, not at whatever shape the file happens to be. An admin who is
shown their whole photograph and then finds the top of it on the live contest
uploads a second photograph, and neither of them is the one they wanted.

The admin uploads whatever they have and the crop is ours, so one contest cannot
be twice the height of the next.
**Without it:** the join popup reflows under the creator's thumb between the tap
and the read, which on a phone means they press the wrong button, and the layout
shift is worst on exactly the slow connections most of the roster is on. **And
without the column rule specifically:** the contest page has two column widths on
one screen, the eye has nothing to line up against, and every future full-bleed
element gets argued for on the grounds that the banner already does it.

**B5. The banner is `loading="lazy"` and `decoding="async"`, always.** Enforced
in the component. Most of the roster is on a phone on mobile data, and a list of
contests must not fetch every picture in it to render the first row.
**Without it:** the contests screen costs six images before it shows one word,
which is the same class of failure the performance habits in `CLAUDE.md` were
written against.

**B6. The banner URL is validated as `^https://` with a length bound in the
database, in the Edge Function and in the client Zod schema, it is only ever
produced by the upload control rather than typed, and the file lives in the
`brand-assets` bucket with staff-only write.** Enforced in all four places; see
2.2.1 for the bucket and rule S7 for the identical treatment of the brief link.
There is no paste-a-URL field, consistent with how brand logos and product images
already work, and the same `ImageUploadField` is used so the size and type
refusals are already worded.
**Without it:** an admin pastes a link to a host we do not control into a field
that renders on every entrant's screen, and the picture on a live contest changes
whenever somebody else's server decides it should.

**B7. ADDED 2026-08-13 with D8. The crop is one number in one place.** The 3:1
lives as a single class or token used by the card, the contest page, the join
popup and the setup form's preview, and no surface may set its own aspect ratio.
**Without it:** the four surfaces drift, the preview stops predicting the live
crop, and rule B4's whole argument, that one contest cannot be twice the height
of the next, is enforced by four separate people remembering the same number.

**B8. ADDED 2026-08-13, third design turn. The upload control is specified by this
document down to its component, so the frames the design still owes for it block
nothing.** It is **`ImageUploadField` over `useImageUpload` with
`folder="contests/<contest_id>"`**, the same pair the brand About tab and the
product dialog already use, which means the 2 MB refusal, the type refusal and the
"that upload did not go through" wording all exist already and are **not
rewritten** (2.2.1, rule B6). Three things are new and all three are named
elsewhere in this document rather than left to a drawing: a **3:1 preview at the
crop the creator will actually see** (rule B4), a **clear control** so a banner
can be taken off again, and **helper text saying the file is publicly readable and
must carry nothing commercial** (2.2.1). This is why the missing upload frames are
listed in 3.13 as a rejected blocker.
**Without it:** a control that already ships is redrawn from scratch, the size and
type refusals get worded a second way, and the two wordings disagree on the one
screen where the admin is already annoyed at a file that would not upload.

### 3.9 Nobody else exists (rules N1 to N7)

**Decided by Rashid on 2026-08-13 as D7, in its strongest form. No creator ever
sees anything about another entrant.** These rules exist because D7 forbids
building things, and a forbidden thing with no rule against it gets built by
somebody who reads the schema and finds nothing stopping them. Every one of them
is written as an absence that can be tested for.

**N1. No creator-reachable surface returns a count of entrants, in any form.**
Not a headcount, not "12 creators are in", not "spots filling up", not a
percentage of a cap, not a "popular" badge derived from one. Enforced in the
database (no view groups over entrants without the `is_staff() or
is_service_role()` gate from rule S4, and `contest_entries_select_own` returns
only the caller's row so a `count: 'exact'` returns 1) and in the client (no
`count` option on any `contest_entries` query in `src/lib/creator/`).
**Without it:** the headcount is quietly the number 1, with no error, which is
the failure S5 already describes, now with a decision behind it rather than a
preference.

**N2. No creator-reachable surface returns another creator's approved count,
handle, name, avatar, submission, reward or placing.** Enforced in the own-row
policies on all six creator readable tables, and in the absence of any definer
function that takes another creator's id and returns anything about them.
**Without it:** `20260731093000_offer_applications.sql:126-127`, "No policy lets
anybody see what another creator asked for, or what they were paid", becomes
false, and it is a sentence we wrote in a migration that ships.

**N3. No creator is shown their position in a field.** No "4th in line" on the
waiting screen, no "3 of 14" anywhere, no rank ramp on a live screen, and no
pace projection against anybody else. **A bare placing at settlement is the one
thing that is allowed**, because "you placed 5th" is the creator's own result
and names nobody, and it is a stored fact rather than a derived position (2.9).
The design already dropped a queue position of its own accord, calling it "a
number about other entrants and expensive to supply truthfully", which is
exactly right.
**Without it:** the waiting screen needs a count of pending entries ahead of
this one, which is N1 wearing a different hat, and it needs it live.

**N4. There is no standings object of any kind: no table, no view, no published
snapshot, no materialised ranking, and no read policy anywhere that returns one
creator rows about another.** This is the part of D7 that goes further than the
plan was written to. The earlier text left a door open, "standings, if they are
ever built, are a published snapshot written by a staff action, not a view", and
D7 closed it. Design direction 2F, competing with a published standing, is cut;
direction 2E, competing against yourself, is the one we build.
**Without it:** the snapshot arrives as the safe version of a leaderboard,
because it is staff written and therefore feels controlled, and it is the same
data.

**N5. Motivation on a live contest comes from three sources and there is no
fourth.** The sentence the contest is judged on, which since 2026-08-13 is a
column of its own rather than a paragraph somebody remembered to type (N7,
`contests.judging_basis`), the creator's own approved count going up, and the
target they set themselves (3.10). All three are facts about one person or about
the contest's own terms.
**Without it:** the competing screen has nothing on it, which is the pressure
that produces a leaderboard.

**N6. Staff surfaces are not bound by N1 to N5 and never leak into them.** The
admin entries queue counts, sorts and compares entrants freely, because that is
the job. What it may not do is feed any of those numbers into an Edge Function
response, a shared component's props, or a view a creator can select from. The
seam is the `src/lib/admin/*` import boundary that rule M1 already draws.
**Without it:** a shared contest card takes an `entrantCount` prop because the
admin side has one, and it renders as zero on the creator side, or worse, does
not.

**N7. DECIDED BY RASHID 2026-08-13, Q13. How a contest is judged is its own
field, `contests.judging_basis` (2.2), and it is REQUIRED on any contest carrying
an active deliverable of the `rank` kind.** It is not a paragraph inside
`description`.

**Why it is required rather than merely available.** Q5 is deferred by Rashid's
own choice, so nothing in this product computes a placing and nothing will for
now. That makes this sentence the only thing standing in for a scoreboard, and a
placing with no stated basis is the one thing that would make a contest feel
arbitrary, on the one product whose promise is that the numbers are real. The
copy Q5 already fixes, "A person at Wurx publishes the placings when it closes",
is honest about WHO decides; this column is what says HOW, and the two only work
as a pair.

**Where it is enforced, exactly, because a CHECK cannot see another table.** In
`save_contest`, which counts the contest's active `rank` rows under the lock it
already takes and refuses a null or blank sentence with a 22023 naming the count;
and in `save_contest_deliverable`, which refuses a `rank` row on a contest whose
`judging_basis` is null or blank, also 22023. **Both directions, because either
one alone leaves the illegal combination reachable**: adding a rank row to a
contest with no sentence, or clearing the sentence on a contest that already has
a rank row. The raise wording for both is in 2.13. Zod carries the same pair on
both sides so the admin meets it in the form, and `retire_contest_deliverable`
carries no clause because a sentence with nothing ranked is legal.

**What a creator gets.** It comes back on the same `contests` select that draws
everything else, so it costs no second query and no policy of its own, and it
renders **on its own, in a fixed place**, on the contest's own page and in the
join panel, rather than buried in the description where every admin puts it
somewhere different. It is a fact about the contest's terms, so N5 counts it, and
it names nobody, so N2 and N3 are untouched by it.
**Without it:** the basis is a paragraph, its position moves contest to contest,
the creator screen cannot point at it, and N5's first source of motivation
degrades to whatever somebody remembered to type.

### 3.10 The creator's own target (rules T1 to T5)

**Decided by Rashid on 2026-08-13 under D7.** With every fact about other
entrants gone, the self set target from design direction 2E is what a creator
competes against, and it is the only genuinely new thing that design needs
stored. It is one private number per entry.

**T1. The target is one integer per entry, set by the creator, and it lives in
`contest_entry_targets` (2.6.1), never as a column on `contest_entries`.**
Enforced in the database. A column on the entry row would be selectable by
`contest_entries_select_staff`, and a column level SELECT grant cannot take it
back off staff while leaving it with creators, because both are the Postgres
`authenticated` role. That is the same sentence as 2.0, pointed the other way.
**Without it:** the private number is on the admin entries queue the first time
somebody writes `select('*')`.

**T2. Staff cannot read it, and that is deliberate rather than an oversight.**
There is no `contest_entry_targets_select_staff` policy and there must never be
one. **Why, since it is unusual here:** the screen that collects the number says
in words "Nobody else sees it and you can change it any time", so a staff read
makes that sentence a lie told by us on our own screen. And a private commitment
that can be seen is a quota, which creators would set low or not at all, which
removes the only thing the screen was built to do.
**Without it:** we ship a promise in the copy and break it in the policy block,
and the person it is broken for cannot tell.

**T3. Nothing carries it outward.** It appears in no view, in no rollup, in no
`audit_log` detail, in no `contest_entry_events` row, in no realtime
publication, and in no Edge Function response except the one returning it to the
creator who set it. `service_role` can read it because
`set_contest_entry_target` has to write it, so this rule is the only thing
standing between that grant and a leak. Enforced in the migration (no view names
the table, it is not in `supabase_realtime`) and in `manage-contest` (the target
action returns the caller's own row and nothing else).
**Without it:** it reaches staff through the back of a function rather than
through a policy, which is harder to see and just as visible.

**T4. Setting it writes no audit row and no event row, uniquely in this
feature.** Enforced in `set_contest_entry_target` (2.13), which says why at
length. The trade is stated there and accepted: if a creator reports that their
target vanished there is nothing to look at.
**Without it:** the number staff cannot select is sitting in `audit_log`, which
staff can select, in a table with a text `action` column that is easy to search.

**T5. It is a target, never a commitment.** No money moves because of it, no
deliverable count changes, nothing is owed if it is met and nothing is withheld
if it is not, and no admin screen shows a creator as behind. It is cleared by
setting it to null, and clearing it is not a withdrawal or a signal of any kind.
Enforced in the absence of any read of `contest_entry_targets` from the money
path, from `settle_contest` and from every admin hook.
**Without it:** the first person to see the column joins it into the entries
queue as "promised 6, delivered 2", and a note a creator wrote to themselves
becomes something we hold them to.

### 3.11 The words, and what the tracker counts (rules W1 to W8)

**Added 2026-08-13, gaps 6, 8 and 9.** The design currently describes one entry
three different ways on one screen, and the brief and the schema use two
different words for a creator pulling out. Vocabulary is fixed here once and
used everywhere, in the client, in the Edge Function's sentences, in the
database's `raise` messages and in this document.

**W1. `filed` means submitted by the creator and not yet decided.** The creator
filed it; we have not looked at it. On a creator screen the phrase is "in
review", because that names what is happening rather than what they did. Never
"pending", which is what the database calls an entry, and never "uploaded",
because nothing is uploaded, a link is posted.

**W2. `approved` means reviewed by us and accepted.** Never "accepted" on a
video (that word belongs to an entry), never "live", never "verified", and never
"approved" for anything that has only been filed.

**W3. `still to film` means nothing exists yet.** It is the gap between what the
entry committed to and what has been filed at all. It is never used for a video
that exists in any state, which is the whole of gap 8.

**W4. `needs another take` means we reviewed it and sent it back.** It is its
own word, it is the creator's move next, and it is neither "rejected" (which
sounds final and is not) nor "still to film" (W3) nor "in review" (W1, and we
have already reviewed it).

**W5. `withdrawn` is the one word for a creator pulling out, in the database and
on every screen.** Gap 6: `docs/archive/UI_BRIEF_CONTESTS.md` said "Left", the enum says
`withdrawn`. **RULED HERE, `withdrawn` wins and "Left" is cut**, and the brief
was corrected on 2026-08-13 in both places it carried the word, the state list
and the mock data's `state` union, so the two documents no longer hand a
designer two words for one thing. Three reasons:
the enum already says it and matches `offer_applications`, so the alternative is
a migration plus a translation layer for a word; the design's own button already
says "Withdraw my application", so "Left" would have disagreed with the control
that causes it on the same screen; and "Left" is ambiguous with left as a
direction and with "days left", which appears on every contest card in the
product. The verb is "withdraw", the state is "withdrawn", and the past tense on
a card is "You withdrew".

**W6. The tracker has FOUR segments, not three, and they are W1 to W4 in that
order: approved, in review, needs another take, still to film.** Gap 8: the bar
was drawn with three slots while `contest_entry_progress` returns four counts,
so a video sent back had nowhere to sit and would have landed in "still to
film", contradicting W3. The view now returns `still_to_film` as a derived
column (2.11) so the bar and the sentence read the same numbers rather than each
doing their own arithmetic.
- The sentence below the bar names only the non-zero segments, in the same
  order, so a clean entry reads "2 approved, 1 still to film" rather than
  carrying two zeroes.
- **When `required` is null the entry is open-ended and the bar is not drawn at
  all.** The sentence then counts only what exists, "3 approved, 1 in review",
  with no denominator. A bar needs a total and there is not one; drawing it
  against the count filed so far makes every entry permanently 100 percent.
- The segments use the stage tokens per rule C1, and "still to film" carries no
  colour, because nothing has moved and nothing is owed.

**W7. While `PARKED.md` items 1 and 2 are open, no copy anywhere in contests
promises an email.** Gap 9, and **ruled by Rashid on 2026-08-13 after being told
the trigger had arrived**. The design's locked screen says "You will hear on
this screen and by email", and PARKED item 1 records that Resend's DKIM record
is published where nothing will read it and the bounce subdomain has no SPF
record, while item 2 records that the approval notification does not exist at
all and names its own trigger as any feature depending on an email arriving.
That trigger is this feature.
- The copy becomes "You will hear on this screen", full stop, on both the
  waiting screen and the locked screen, and the realtime dot from rule S9 is
  what makes that sentence true.
- **If email is fixed, the copy should come back**, and this rule is where to
  look for it. Restoring it is one string in two places and is not a design
  change.
**Without it:** we tell a creator to watch an inbox nothing will ever arrive in,
on a screen whose whole purpose is that they can stop watching, and the failure
is invisible to us because a mail that is never sent logs nothing.

**W8. ADDED 2026-08-13, third design turn. A brand new contest prints no zeroes on
its summary rows.** A contest with no entrants, nothing filed and no money
committed shows the row's own empty sentence rather than "0 entrants, 0 filed, £0
committed". This is rule L15's "it never prints zero" and rule W6's "the sentence
names only the non-zero segments", applied to the one screen where every number is
zero at once, which is the ninety seconds after a contest is created.
**Note what this does NOT change, because the two look alike.** Rule M10's contest
money block on a BRAND still shows a zero rather than hiding itself, deliberately,
because there the zero is the answer to a question the reader asked about that
brand and a missing block reads as "there is no contest money" exactly when there
is. A summary row on a contest nobody has entered yet is answering nothing.
**Without it:** the first thing Rashid sees after setting a contest up is a wall
of zeroes, which reads as a screen that failed to load rather than as a contest
that has not started.

### 3.12 Colour, contrast and motion, ruled (rules C1 to C8)

**C1. RULED BY RASHID 2026-08-13, settling a contradiction between two of our
own documents. The three stage tokens ARE used for an entry STATE. They are NOT
used for a rank, a countdown, or decoration.**

`docs/archive/UI_BRIEF_CONTESTS.md:640-655` says the three reserved tokens are "the only
thing in the whole product allowed to say where money or work has got to" and,
before it was corrected, told the designer not to borrow them "for a rank, a
countdown, a contest state or anything decorative".
`docs/archive/UI_BRIEF_CONTESTS_HANDBACK2.md:79-83` then says the four state colours "must be
expressed as the three stage tokens the product already has". The two disagreed,
and the designer obeyed the later one, which was the right call.

**The settlement, and why it is not a compromise.** An entry state is exactly
where work and money have got to for that creator, which is what those tokens
mean. In and in review are `--wx-stage-live`, delivered and awaiting an outcome
is `--wx-stage-due`, paid or won is `--wx-stage-paid`, and waiting and not
accepted carry no colour at all because nothing has moved and nothing is owed.
The original brief's "a contest state" meant the CONTEST's state, active or
expired or settled, which is a property of the event rather than of anybody's
work, and borrowing a money token for it is what the line was written against.
**`docs/archive/UI_BRIEF_CONTESTS.md` is the document that changes**, and the line now reads:
not for a rank, not for a countdown, not for the contest's own lifecycle state,
and not for decoration. **Corrected in the brief on 2026-08-13**, in the
reserved-vocabulary bullet and again in "What not to do", so the ban is four
things in both places and the permission for an entry state is explicit in both.
Note what the correction does NOT do: the contest's own lifecycle state, open or
closed to new entries or ended or settled, stays banned. It was always what that
line meant, and reading the ruling as "the ban on a contest state was a mistake"
would put a money token on the event's own status chip. Rank uses the rank ramp; a deadline
inside 48 hours uses `--wx-deadline`; both are new tokens the designer proposed
with measured ratios, and they exist precisely so nothing has to borrow.

**C2. RULED BY RASHID 2026-08-13. The light mode contrast failure is fixed in
the layout, not in the tokens.** Direction 1A puts muted text and accent text on
`--wx-surface-3`, measured at 4.15:1 and 4.40:1 in light mode, both under AA, and
`scripts/build/check-contrast.mjs` does not test that surface so the build passes.
**Do not darken `--wx-text-muted` or `--wx-accent`.** Both are product wide and
both are already shipped on every screen we have; moving them to fix one panel
on one unbuilt screen is a change to everything in exchange for a change to one
thing.
**The fix is to stop putting those two on surface 3.** Surface 3 is the input
well. Text that has to be read on it is `--wx-text`, which is checked and passes
(`check-contrast.mjs:72`). Where 1A wants a quiet well behind the money and the
deadline, the well is `--wx-surface-2`, where muted is checked and passes, and
where accent is checked and passes.
**OURS TO EXECUTE, and not the designer's homework. Ruled 2026-08-13, third design
turn.** Turn 3 still puts muted and accent strings on surface 3, and that is not
sent back for a fourth turn. At build time **every muted or accent string on
`--wx-surface-3` either moves to `--wx-surface-2` or becomes `--wx-text`**,
whichever the panel wants, and that is the whole of C2. It needs nobody's drawing,
it is a class per string, and waiting for a frame to say it would cost a turn to
learn something this rule already decided.
**Without it:** the two smallest strings on the most-read panel of the most
likely direction fail AA in light mode, on a phone, in daylight, and nothing in
the toolchain says a word.

**C3. THEN, and only after C2 is done in the layout, the guard learns the three
pairs it is missing, and it learns them as KNOWN BAD rather than as
assertions.** The pairs are `--wx-text-muted` on `--wx-surface-3`,
`--wx-accent` on `--wx-surface-3`, and `--wx-border-interactive` on
`--wx-surface-2`.

**Why they cannot simply be added to `PAIRS`.** All three fail today by
construction, at 4.15:1, 4.40:1 and 2.96:1, and `PAIRS` entries are pass-or-fail
assertions. Adding them there fails `pnpm build` on the next commit and the only
ways out are the two things C2 forbids, moving a product wide token or deleting
the entry again. The intent of the ruling is that the combination can never come
back; the mechanism has to match the arithmetic.

**So `check-contrast.mjs` gains a second list, `KNOWN_BAD`,** in the idiom of
the comment already sitting at `check-contrast.mjs:78-82` for
`--wx-text-faint` on `--wx-surface-2`, which is the same situation handled ad hoc
in a comment. Each entry carries the two tokens, the floor it fails, both
measured ratios, and the sentence saying what to use instead. The script
measures them on every run and **fails if a ratio has MOVED in either
direction**: improved into passing, which means the entry should be deleted and
promoted into `PAIRS`, or degraded further, which means somebody edited a token
and did not know these combinations were load bearing. That turns a comment
nobody has to read into a check nobody can ignore, and it costs no build.

**C4. ADDED 2026-08-13, gap 4. The neutral state dot is `--wx-text-muted`, never
`--wx-border-interactive`.** On `--wx-surface-2` in dark those measure 5.48:1 and
2.96:1, and a dot is a non-text graphic carrying meaning, so it needs 3:1 under
WCAG 1.4.11 and the second one misses it. The design uses the interactive border
token for the Waiting dot on a surface-2 panel in several frames; every one of
them changes.
**Nothing currently guards this**, because `PAIRS` checks
`--wx-border-interactive` on the page and on surface 1 only, and surface 2 is
where the dot actually lives. That third pair is the one in C3 above, so the
guard records it rather than permitting it.
**Also ours to execute, same date and same reason as the note under C2.** Every
neutral dot in every frame becomes `--wx-text-muted` when it is built, wherever it
appears and whichever direction it came from. There is nothing here to hand back
and nothing to wait for.
**Without it:** the one signal on the waiting screen that is not a word is
invisible on a phone in daylight, and the design's own rule that colour is never
the only signal is what saves us, which is not a plan.

**C5. Any colour contests need that we do not already own is proposed as a
token, with a dark value, a light value, every surface it lands on and the
measured ratio on each.** The designer already did this for `--wx-deadline`
(dark `#e8865c`, light `#9c3d12`, for a deadline inside 48 hours and nothing
else) and for `--wx-rank-1/-2/-3`, with a stated floor of 4.98:1 across surfaces
1, 2 and 3. Both go into `tokens.css` in both modes and into `PAIRS` on every
surface they are used on, in the same commit as the first screen that uses them.
**`--wx-deadline` is used by no frame in the design**, because no contest in the
mock data is inside its threshold, so it ships with rule L15's hours form or not
at all: a token in the file with no user is a colour somebody will find a use
for.
**Without it:** the rank ramp gets built out of `--wx-warning` and
`--wx-success`, which is the obvious pick and unreadable, because in light mode
our gold `#8a5f1f` and our warning amber `#8a6410` are within a hair of each
other.

**C6. ADDED 2026-08-13, third design turn. A secondary button is the existing
`Button` secondary variant, which already borders with `--wx-border-interactive`.
The inline borders drawn across fifteen controls in turn 3 are never copied.**
Those measure roughly 1.5:1 against the surface behind them, which is half the 3:1
WCAG 1.4.11 asks of a control's own boundary, and the variant that already ships
is both correct and one class. This is rule C4's failure shape, a non-text graphic
carrying meaning at a ratio nothing guards, arriving fifteen times instead of once.
**Without it:** contests ship a second button style at half the required contrast,
it reads as the house style precisely because there are fifteen of them, and the
next feature inherits it by copy and paste before anybody measures one.

**C7. ADDED 2026-08-13, third design turn. There is ONE scrim, `--wx-scrim`, a
token with a real value in BOTH modes, and no dialog backdrop is ever hardcoded
again.** Every panel frame in turn 3 hardcodes an rgba value; one of them does it
**inside the LIGHT frame**, where a scrim mixed for a near-black page is simply
the wrong colour on cream; the 1440 panel uses a different value again; and our
own shipped dialogs carry a third and a fourth, `bg-black/60` in
`src/components/creator/ApplyDialog.tsx:81` and in
`src/components/admin/BrandDialog.tsx:102`, with `bg-black/70` in
`src/components/content/VideoPlayer.tsx:36`. That is four spellings of one
decision before contests add a fifth.
- **Proposed values:** dark `rgba(6, 5, 4, 0.72)`, light `rgba(25, 21, 18, 0.46)`.
  The light value is our own ink `#191512`, the colour `--wx-grid-line` already
  mixes with in light mode, rather than pure black, which sits on cream like a
  hole rather than like a dimmed page.
- **Parity is enforced from the day it lands, for free.**
  `scripts/build/check-contrast.mjs` fails the build when a colour token exists in one
  mode and is missing from the other (`check-contrast.mjs:138-143`), which is
  exactly the failure a hand-mixed backdrop commits. It carries no `PAIRS` entry
  and needs none: the contrast pass deliberately skips translucent values
  (`check-contrast.mjs:161-162`) because a scrim sits over a backdrop the script
  cannot know.
- **The existing dialogs move onto it in the same commit**, or the token is the
  fifth spelling rather than the only one.
**Without it:** the light theme gets a backdrop mixed for the dark one, nothing in
the toolchain has an opinion about it because nothing checks a value nobody named,
and every future dialog picks its own number for want of a token to reach for.

**C8. ADDED 2026-08-13, third design turn. Motion snaps to the three durations
that already live in `tokens.css`: `--wx-dur-fast` 140ms, `--wx-dur-base` 240ms,
`--wx-dur-slow` 420ms.** The design's 90ms and 200ms are outside that set and
become 140 and 240 when they are built. Nobody can see the difference between 200
and 240; everybody can see a product where six components each chose their own
number.
**Without it:** durations arrive as literals inside class names, `tokens.css`
stops being where timing lives the way it is already where colour lives, and the
first component that wants a fourth duration invents one because there is nothing
saying it may not.

### 3.13 Twelve findings raised and rejected, 2026-08-13 (do not reopen)

The seven agent review of design turn 3 ran six readers past an adversarial
judge, and **the judge rejected twelve of their findings as wrong.** They collapse
into the five claims below, and the first of them accounts for three of the twelve
on its own. They are recorded here because a wrong finding that three readers
reached independently is a finding a fourth reader will reach again, and the cost
of it is a whole turn.

- **"A person at Wurx publishes the placings when it closes" does NOT breach
  decision D7, and three readers said it did, with eight or nine citations each.
  All three were wrong.** Q5 in section 5 already ruled on this exact sentence:
  it survives the cut of direction 2F and **should be reused verbatim**. It is
  the honest label on a placing that was typed by a person rather than computed,
  which is what settlement now writes for every entrant (2.9, rule N3), and it
  names nobody, counts nobody and compares nobody. The sentence that does NOT
  survive is 2F's "a snapshot from when the team last published, not a live
  count", and Q5 already says which is which and why they read alike. Nothing
  here is open.
- **The missing banner upload frames do not block step 1.** The plan specifies
  that control down to its component, its hook, its folder, its preview ratio and
  its refusal wording (rule B8, 2.2.1, step 1). There is nothing a frame would
  decide.
- **The timezone control is not a blocker.** Rule L6 specifies it in more detail
  than any frame would, down to the five zones that lead the list and the echoed
  instant, and the ruling under L6 says the drawing is ignored.
- **The states index overstating its own coverage is a trust problem with the
  designer, not an input to a build.** It changes nothing that gets built and
  nothing in this document reads that index as a source.
- **The entry panel's missing refusals are step 2 work, not a step 1 gap.** The
  function those refusals speak for, `apply_for_contest`, does not exist until the
  second migration (section 6), so there is nothing yet for the panel to refuse
  and no sentence to match word for word.

### 3.14 What handback 5 owes the designer, from the four answers of 2026-08-13

Rashid's answers to Q11 to Q14 change what the design has to say, and three of the
four change a screen that has already been drawn. This is the list, and it is
short on purpose: everything else in those four answers is ours to build.

1. **A half filled contest lives in the browser only, so "picked up where you left
   it yesterday" is true on that machine and nowhere else.** This is the one that
   must be told rather than inferred (Q12, rule F12). Both setup frames in turn 3
   assert a saved draft, and there is no draft row and never will be. The form
   remembers itself on the same computer, in the same browser, signed in as the
   same person; on a second machine it is a blank form. **Any copy promising more
   than that is copy we cannot keep**, so the sentence has to say the machine or
   say nothing.
2. **The setup form is a full screen, not a dialog, and it needs 375, 768 and
   1024 as well as the 1440 already drawn** (Q14, rule F13). It sits inside the
   admin shell with the sidebar present, which neither drawn direction shows, so
   the owner's layout rules can be checked against it: working content high,
   compact header, reference data under an Overview, content left against the
   sidebar at a max width, and never a slug, an id or a route on screen. **The
   creator entry panel stays a dialog and is not part of this.**
3. **Every reward row has a title field the admin types, on all three row shapes**
   (Q11, rule F11). The reward row editor drawn in turn 3 has no field for it, and
   nothing generates one, so a contest with six rows is six titles typed. The
   refusal for a blank one is named against that row, not at the top of the form,
   which is a state the row editor has to be able to draw.
4. **The judging sentence is its own field on the form and its own place on the
   creator surfaces** (Q13, rule N7), not a paragraph inside the description. On a
   contest with any ranked prize it is required, so the form needs the required
   state and the creator screen needs a fixed home for it where it is found rather
   than read past.

---

## 4. Every join into an existing screen

Contests are not a new silo. Sixteen existing surfaces change. Skipping any one
of them is a visible half-build. Joins 6, 7 and 8 carry the D2 mitigation (rule
M10, contest money beside offer money, never merged) and joins 14 and 16 carry
the D4 mitigation (one route for a creator to file work, one reviewing job with a
filter for staff). Those five are the price of the two decisions Rashid made on
2026-08-12 and they ship with the steps that create the need for them, not after.

| # | Where | What joins | What breaks if skipped |
|---|---|---|---|
| 1 | `src/routes/admin/BrandHub.tsx:69`, `:75`, `:237-253` | Remove `soon` from the Contests entry, add `'contests'` to `BUILT`, add a `section === 'contests'` branch, and **link from that tab to the setup form's own route** rather than opening a dialog in place (Q14, rule F13) | The switch at `:243` falls through to `<Offers>`, so an admin clicks Contests and gets the Offers list under a Contests heading, silently. And a New contest button with nothing behind it is the half of the tab that makes the other half pointless |
| 2 | `src/routes/app/BrandHub.tsx:48`, `:52`, `:152-167` | The identical three edits | The creator ternary at `:159` falls through to `<Overview>`, so a creator clicks Contests and lands on the brand's story. Building only the admin half is the thing that already cost trust once |
| 3 | `src/routes/app/BrandHub.tsx:122-148` | The remaining unbuilt tabs stop being `disabled` buttons whose only explanation is a `title` attribute, and their `soon: 'Step 8'` / `'Step 9'` labels become "Next" / "Later" | Most of the roster is on a phone, where four grey pills carry no explanation and cannot be reached by keyboard. This is confirmed defect 4 in `docs/archive/UI_CONNECTIONS_PLAN.md:211-214`, and a badge naming a step that already shipped reads as a broken promise |
| 4 | `src/lib/admin/useOpsHome.ts:37-56` | A fourth head-only count of pending contest entries, inside the SAME `Promise.all` | A second racing query lets the sentence flicker through "all clear" on the way to the truth, which the comment at `:14-16` forbids |
| 5 | `src/routes/admin/AdminDashboard.tsx:49-71`, `:100-102`, `:104`, `:110` | The `queues` array, the words "of the three queues", the all-clear sentence naming three things, and `sm:grid-cols-3` | The first screen Rashid opens says the day is clear while forty creators sit unanswered on a contest. That is the exact lie step 8 was built to stop telling |
| 6 | `src/routes/admin/AdminDashboard.tsx:355`, `src/lib/admin/useOpsHome.ts:133-157` | A second, separately labelled money block from `brand_contest_totals`, in the same query batch and the same view as the offer block, never summed with it (rule M10), and the heading "Committed across every brand" reworded to name what it counts | The home claims to be every brand's committed money while reading one view built from `offer_applications`. Contest money that is not in it makes the claim false while looking complete, and a number here disagrees with the number on the contest screens |
| 7 | `src/components/admin/BudgetBar.tsx`, `src/routes/admin/BrandHub.tsx` Overview, `src/routes/admin/Brands.tsx` spend filter, `AdminDashboard.tsx:218-230` | Every surface rendering `budget_used_percent` says in words that it counts offers, **and carries the brand's contest committed and contest awarded beside it as their own labelled block** (rule M10). The eighty percent at-risk warning keeps meaning offers and says so. A brand with no contests shows zeroes rather than an absent block | A brand shows 78% committed, is not flagged at risk, and is actually overspent once contest prizes are counted. Rashid approves somebody on the strength of a bar measuring half the money. With the label but without the second block he is told the bar is partial and given nothing to complete it with, so the Overview and the contest screens quote two different totals for one brand |
| 8 | `src/routes/admin/BrandHub.tsx` Overview, `:370-372` | A contest count from a head-only database read, the contest money block from join 7 living here on the record where reference data belongs, and the sentence "Campaigns, contests and promotions land here as those parts of the hub are built" edited | Overview once counted offers by filtering a paged array and silently became a description of the first twelve rows. Also the copy still promises contests are coming on a screen where they arrived |
| 9 | `src/routes/admin/CreatorDetail.tsx:34-38`, `:120-138` | Contest participation, as a fourth tab or as rows inside Work, with the three money cards agreeing with `/app` | An admin opens a creator to find out what they are doing for us and a creator mid-contest reads as idle |
| 10 | `src/lib/nav.ts` | A new admin Contests group (catalogue then queue, modelled on the Offers group at `:74-80`, with `activePrefixes`), a new creator item in the CREATOR group at `:118-142`, and that path added to `LOCKED_UNTIL_APPROVED` at `:151`. The `Trophy` clash is settled first: it is already Leaderboards at `:133` while the admin hub uses it for Contests | A screen nobody can reach from the sidebar, or an applicant shown a live-looking link to a screen that will refuse them, which `nav.ts:26-29` says never to do. And one icon standing for two things in one sidebar |
| 11 | `src/lib/creator/useCatalogueLive.ts:38-51` | A `contests` branch on the existing shared channel, every caller passing a unique key, **and the `subscribe()` status callback wired for the first time in this codebase, exposed as connected / reconnecting / offline** (rule S9) | An admin closes a contest and creators keep applying until they happen to refetch. Two channels with one name means the second subscribe is silently ignored. And without the status, the waiting screen's dot keeps promising a live connection through a dropped socket, on the one screen that tells a creator they can stop checking |
| 12 | `src/lib/creator/useCreatorBrands.ts` (`useOfferCounts` shape), `src/lib/admin/useBrands.ts:383-405` | Brand cards on `/app/brands` and `/admin/brands` say a contest is running, from one grouped read over the page | A creator scrolls past the brand running the contest they would have entered, because every card still looks identical |
| 13 | `src/components/work/JobProgress.tsx` | Contest deliverable progress uses `JobProgressBar` or a sibling in the same neutral folder, taking staff-only data as a prop | The seven-bar tracker is already drawn twice and agrees only by luck. Per-unit spans (`Content.tsx:480-493`) also fall apart on an open-ended deliverable count; the percentage-width bar does not |
| 14 | `src/components/creator/PostContentDialog.tsx:38-108` or a new dialog | **ONE route for a creator to file any work.** Wherever a creator posts a video today they are offered contest entries and offer jobs together in the same picker, from one dialog, and a contest card saying "2 still to film" carries that same button. Today that dialog builds its dropdowns from `MyWorkRow[]`, approved offer applications only, so the source becomes both. This is the D4 mitigation and is not optional | Step 1 of `docs/archive/UI_CONNECTIONS_PLAN.md` existed to remove dead-end counts. A count you cannot act on is decoration. And the separate `contest_submissions` table was chosen on the promise that a creator would never have two places to go to post a video: two dialogs is that promise broken on the creator's screen, where they are least able to tell which one their video belongs in |
| 15 | `scripts/verify/design/check-responsive.mjs:44-105` | Every new contest screen in `SCREENS`, a `via` selector for anything behind an id, a **PAGE case for the contest setup form at 375, 768, 1024 and 1440** (Q14, rule F13: it is a route, not a dialog, and this line asked for a modal case until he answered), and a modal case for the creator entry dialog, which is unaffected and stays a dialog | A screen behind an id is invisible to the suite. Adding the application detail screen found a 375px overflow that had existed since it was built, and a page can pass at every width while a modal opened on it does not. And a modal case pointed at a route tests nothing at all: it waits for a panel that never opens |
| 16 | `src/routes/admin/Content.tsx` and its queue hook, plus wherever `manage-contest`'s `contest_content.review` lands | **Two review queues that read as one job with a filter.** Contest submissions and offer submissions are reviewed from the same screen, with one set of controls, one approve and one needs-another-take action, and a filter that says which kind you are looking at. They stay two tables and two functions underneath (decision 4) and that seam never reaches the reviewer. The default view is everything waiting, not one kind | The second cost Rashid accepted when he chose the separate submission path was two queues in his team's day, and he was promised they would feel like one job with a filter. Two unrelated screens is that promise broken: the day's work is now in two places, one of them gets checked less often, and a creator waits on a video nobody is looking at |

Six more that are not screens but are the same class of omission:

- **`src/lib/schemas/contest.ts`** sits beside `brand.ts` and reuses
  `optionalMoney`, `optionalCount`, `CURRENCIES` and `collectFieldErrors`, with
  every `.refine()` message matching the Edge Function's sentence word for word.
  It also carries the IANA timezone list from rule L6 and the same list is
  re-checked in the Edge Function, with `pg_timezone_names` as the boundary
  underneath both. **Three things joined it on 2026-08-13 with Rashid's four
  answers:** `judging_basis`, optional in itself but required by a
  `.superRefine()` whenever the deliverable list holds an active `rank` row, in
  both directions and in the same words the two functions raise (Q13, rule N7);
  a **non-empty trimmed** reward row `title`, whose message is attached to that
  row's path rather than to the form, so the error lands on the row (Q11, rule
  F11); and nothing at all for drafts, because there are none (Q12, rule F12).
- **One client-side draft store for the setup form**, keyed on the admin's user
  id, the brand and the contest being edited or `new`, cleared on a successful
  save and on sign out (Q12, rule F12). It holds no file, only a banner URL once
  the upload has succeeded, and nothing beyond what that admin can already read
  on that screen. It is the whole implementation of "come back to it later", and
  it is a browser concern rather than a schema one, which is the answer.
- **`scripts/build/check-contrast.mjs`** gains the `KNOWN_BAD` list and its drift
  check (rule C3), and `src/styles/tokens.css` gains `--wx-deadline` and
  `--wx-rank-1/-2/-3` in **both** modes with their `PAIRS` entries, in the same
  commit as the first screen that uses them (rule C5). Skipping this leaves
  three combinations that fail AA in light mode with nothing in the toolchain
  mentioning them, which is how they got into a design in the first place.
- **`src/styles/tokens.css` also gains `--wx-scrim`** (rule C7), dark
  `rgba(6, 5, 4, 0.72)` and light `rgba(25, 21, 18, 0.46)`, and the four dialogs
  that hardcode a backdrop today move onto it in the same commit. It takes no
  `PAIRS` entry, because the guard skips translucent values on purpose
  (`check-contrast.mjs:161-162`), but the **parity check covers it from the first
  run**: a colour token present in one mode and missing from the other fails the
  build (`check-contrast.mjs:138-143`), which is the exact mistake a hand-mixed
  backdrop makes. This is the one new token contests add that is not a colour
  anybody reads text against.
- **One date and countdown formatter**, in a neutral folder, taking `now` and
  the contest's `expires_at_timezone` as arguments (rules L6 and L15). There is
  no date formatter anywhere in `src/lib/` today. Two of them is how the same
  contest comes to read 50 days on one screen and 49 on another, which it
  currently does in the design.
- **`scripts/seed/seed-brands.mjs`** grows a contest in each state, written through
  the real functions so seeded rows carry every snapshot column. The dev database
  has been deliberately empty since 2026-08-12, so without this the first thing
  Rashid sees of contests is six empty states, and six `SCREENS` entries in the
  responsive suite have nothing to render. **Ask before seeding; he may want it
  empty.**

---

## 5. The product questions, thirteen decided, one deferred

**Decisions 1 to 4 were made by Rashid on 2026-08-12, D5, D6 and Q7 on
2026-08-13, D7 and D8 later the same day after the design review, and Q11 to Q14
later still, after the third design turn. All thirteen
are recorded here as settled.** The reasoning under each is kept, compressed,
because it is the record of WHY, and because the cost he accepted is part of the
decision rather than a footnote to it. Nothing later in this document asks any of
them again. **Q6 is now CLOSED by D7 and is kept below in its old form with the
answer written over it, because the question is the record of what the answer
cost.** Q5 is deferred by his own choice, and the items in Q8 to Q10 are raises
rather than questions, one of which has now been ruled on (rule W7).

**Four new ones opened on 2026-08-13 after the third design turn, and he answered
all four the same day, after the run that recorded them had already been
launched.** They were the layout of the admin setup form and nothing else, and
they are now **Q11 to Q14, DECIDED**, kept under their own heading below between
Q7 and the raises, with their original question numbers so the cross references
elsewhere in this document still resolve. **Nothing in this feature is waiting on
him.** One of the four, Q13, is a real schema change and is in 2.2; the other
three change the form, the client and the suite.

### D1. What "deliverables with rewards" means. DECIDED 2026-08-12

**Decided:** a list of rows. The admin adds as many deliverable-and-reward rows as
they like, and a row is either something you do or a place you finish in. One
contest may mix them. `contest_deliverables` with its `kind` of `fixed`, `rank` or
`milestone` is exactly that, so nothing in the data model changes.

**The cost he accepted:** the admin form has three shapes of row and the creator
card has to render three, which is real design work rather than a field.

**Why, kept for the record:** fixed only is the simplest build and works today,
but the marketing copy already live at `src/content/site.ts:97-99` promises
"Tiered GMV sprints with real progress bars. Hit $1K, earn the bonus", which is a
milestone contest, so fixed only would have meant changing the copy or leaving the
promise unmet. Ranked only had nothing to rank by, see Q5. All three costs one
enum and three check constraints, and no migration when Rashid changes his mind.

### D2. Whether a contest budget draws on `brand_commercials`. DECIDED 2026-08-12

**Decided:** its own separate pot. `contest_commercials.total_budget` is its own
allocation, contest commitments are derived from frozen entry rows, and
`brand_commercials.budget_used` keeps meaning offers only with its single writer.

**The cost he accepted:** a brand's true exposure is now two numbers rather than
one. **The mitigation he was promised in return, now a requirement:** the brand
Overview carries contest money as its own clearly labelled block beside the offer
money, so there are two honest figures rather than one misleading one. That
applies to every surface showing a brand's committed money, never merged and never
silently omitted, and the eighty percent warning on the budget bar keeps meaning
offers only and says so. Written up as rule M10 in 3.3, ruled in 2.0, and carried
by joins 6, 7 and 8.

**Why, kept for the record:** `scripts/ops/reconcile-budgets.mjs` needs no change to
its truth query and cannot erase contest money; `budget_used` keeps its single
writer; the currency bug at `20260811200000:148-152` is not inherited. A shared
pot would have meant extracting the increment into one helper called by both
`review_offer_application` and `review_contest_entry`, teaching
`scripts/ops/reconcile-budgets.mjs:51-84` about contests in the SAME commit or the
next run silently deletes them and prints it as a correction, adding a currency
check `budget_used` does not have today, and giving `budget_used` a second writer,
which is exactly how the running total and the rows came to disagree on
2026-08-01.

### D3. Whether an excluded creator is told. DECIDED 2026-08-12

**Decided:** the contest never appears for them. RLS hides it from the catalogue
and from every creator read, and no card anywhere says "you are barred".

**The cost he accepted:** a creator who was sent the link by a friend gets a
message they cannot act on, and may contact support.

**What follows, and is explicit in rule X8:** the tracking he asked for still
exists, but it lives server side only. There is no button anywhere an excluded
creator can press. What remains is the API, and an excluded creator who holds an
id, or who was excluded after having already seen the contest, can still fire the
request at it. That attempt is refused with a deliberately vague sentence, "you
are not eligible for this contest", and is RECORDED, and it surfaces in the admin
dashboard as a **blocked attempt**. The dashboard must not imply anybody clicked
anything, because there was nothing to click.

**Why, kept for the record:** no creator code changes at all, because the client
queries carry no status filters on purpose so it stays visible that RLS is doing
the work, and the vague sentence is honest without being an accusation. Telling
them would have needed the exclusion row readable to that one creator, a second
policy on a row that has already resolved to a uuid, a new card state alongside
`declined`, and a decision about whether the admin's private `reason` is shown to
the person it is about. It would also have worked inconsistently, because an
exclusion typed before somebody has an account can never be shown to them.

**Settled underneath this one on 2026-08-13:** what happens to a creator who is
ALREADY ENTERED when an admin excludes them. Nothing happens to them, ever. See
Q7 and rule X9.

**Corrected later on 2026-08-13:** this decision's own sentence, "RLS hides it
from the catalogue and from every creator read", was true of nothing until the
exclusion clause was added to both `contests` select policies. Neither policy
mentioned exclusions. The decision did not change; the policies caught up with
it. See gap 1 and the ruling under rule X8.

### D4. Whether contest deliverables reuse `content_submissions`. DECIDED 2026-08-12

**Decided:** their own submission path, `contest_submissions`. Nothing in the data
model changes.

**The cost he accepted:** two review queues, which is a real cost in his team's
day. **The mitigation he was promised in return, now a requirement:** the two
review queues must feel like one job with a filter rather than two unrelated
screens (join 16). And the creator side is the same promise pointed the other way:
a creator must never have two places to go to post a video, so wherever a creator
files work, contest entries and offer jobs are offered together in one route
(join 14). Neither is optional and neither waits for a later step.

**Why, kept for the record:** reusing `content_submissions` would have meant
making `application_id` nullable, which silently changes `brand_content_totals`
and the LATERAL in `brand_creator_roster`, both of which count EVERY content row
for a brand, so the brand Overview would start saying 40 videos landed when 28
were for offers. `job_is_filmed` and `job_progress` would have needed explicit
exclusions or a contest video would finish an offer's job. Four existing objects
changing meaning in one migration, against one new table.

### D5. The scope of an exclusion. DECIDED 2026-08-13

**Decided: an exclusion is scoped to ONE contest.** Rashid's words: creators are
excluded from a specified contest, not from all contests, so if there are two
contests X and Y and a creator is competing in X but excluded from Y, show them X
and not Y. Contests are independent in this sense, while still belonging to a
brand.

This CONFIRMS the model already in section 2.8 rather than changing it.
`contest_exclusions` is keyed on the contest, so an exclusion cannot reach a
second contest even by accident, and there is no brand level or account level
block list anywhere in this plan. Barring somebody from a brand's September
contest leaves that brand's October contest untouched, and leaves every other
brand untouched.

**What this forbids being built:** a "block this creator" control that lives on a
brand or on a profile. If that is ever wanted it is a separate feature with its
own name, its own audit action and its own conversation, because one keystroke
removing a person from every contest they can see is a different act entirely.

**Enforced where:** rules X1 to X9 already read per contest, and the suite must
add one check proving that excluding a creator from contest Y leaves their entry
in contest X readable, enterable and payable.

### D6. Whether a contest carries a banner image. DECIDED 2026-08-13

**Decided: yes, optional, uploaded by staff inside the contest setup form.**
Rashid's words: the admin will have to upload the image, we need a banner image
upload in the contest. The agreed shape, which he was shown and accepted:

- **Optional on every contest**, and every screen must look deliberate WITHOUT
  one. The database is empty and his first contests will have none, so no banner
  is the normal case rather than a fallback (rule B1).
- **It appears where a contest is being sold:** the contest's own page and the
  top of the join popup. In a scrollable list it is small or absent, never full
  bleed, because direction 1A's entire argument in
  `docs/archive/UI_BRIEF_CONTESTS_HANDBACK2.md` is that a creator can scan six contests
  deep with one thumb (rule B2).
- **Words never sit on top of it without a solid scrim**, and the preferred shape
  is a band with the text below it on a solid surface. `scripts/build/check-contrast.mjs`
  cannot evaluate text over a photograph, so this is the one place in the product
  where a WCAG failure could ship silently (rule B3).
- **One fixed crop, 3:1, inside the reading column, with the space reserved
  before the image loads** so nothing jumps, and lazy loaded with async decoding
  because creators are on phones (rules B4, B5, B7). This bullet said "about
  3:1" when D6 was taken, and the "about" was settled to the exact number and
  the exact place by **D8** later the same day. There is one crop and one place,
  and no surface sets its own.
- **Storage reuses `brand-assets` exactly as migrated:** public read, staff-only
  write, 2 MB, `image/png`, `image/jpeg`, `image/webp`, and no SVG because an SVG
  can carry script. A separate bucket was considered and rejected as needless
  duplication of five facts that would then have to be kept in step. The bucket is
  PUBLICLY READABLE, so nothing commercial may appear in the artwork
  (section 2.2.1).
- **Schema: one nullable text column, `contests.banner_url`.** It is creator
  readable, because a banner is not commercial information, and it does NOT go in
  `contest_commercials`.
- **The admin form gains the same upload control brand logos and product images
  already use**, `ImageUploadField` over `useImageUpload`. No pasting URLs,
  consistent with how brand assets already work (rule B6).

**The cost he accepted:** the contest setup form grows a real upload control and
its states, and every contest surface has to be designed twice, once with artwork
and once without, with the version without being the one that has to look
intentional.

### Q5. What ranks a ranked contest? DEFERRED 2026-08-13

**Deferred by Rashid on 2026-08-13.** He is taking performance tracking as the
next conversation and will settle what ranks a contest inside it, rather than
now. Q5 therefore stays open by choice: step 5 of the build order stays gated on
it, and until it is answered nothing may ship that implies a placing was
computed. The reasoning below is kept because it is what makes the deferral safe.

**There is no answer available today, and this must be settled before any ranked
prize is built.** Verified across all 23 migrations: nothing in this schema holds
GMV, sales or views. `brand_products.external_product_id` carries a comment
saying sales data will arrive keyed on it
(`20260730170000:89-91`) and no such table was ever created. Leaderboards are
still `soon: 'Step 9'` at `src/lib/nav.ts:133`.

**Recommendation:** ship `fixed` and `milestone-with-a-manually-entered-value`
first, and make `settle_contest` an explicit human judgement that records the
placings it was given, audits them, and freezes them into `contest_awards`. Do
not build anything that implies the rank was computed.

**D7 makes that recommendation load bearing rather than cautious.** Since
settlement now records a placing for every entrant, the placings are typed by a
person for the whole field, not just for the top three, and every creator reads
one. So the copy around them has to be honest about where the number came from,
which the design already is: "A person at Wurx publishes the placings when it
closes". That sentence sits on the 2E page, survives the cut of 2F and should be
reused verbatim.

**The second sentence somebody will reach for does NOT survive, and this is
worth naming because it reads like the same idea.** "A snapshot from when the
team last published, not a live count" sits inside 2F's standings block
(`Contests Browsing.dc.html:750`). It describes a published standing, which D7
abolished, and there is no interim publishing moment left for it to date: a
creator learns one number, their own placing, once, at settlement. Reusing it
would put the word standing back on a creator's screen and imply a field behind
it, which is rule N4. Nothing anywhere may render a placing as a live figure
either.

- **If ranked prizes ship anyway:** the Settle button either does nothing or an
  admin types the placings into a table the rest of the design treats as a
  computed result, which is a made-up number on the one screen whose whole
  promise is that the numbers are real.
- **If ranked prizes wait for the GMV import:** contests ship smaller and honest,
  and the marketing copy at `src/content/site.ts:97-99` should be softened in the
  same commit rather than left promising progress bars that do not exist.

### Q6. May a creator ever see another entrant's handle? CLOSED 2026-08-13 BY D7

**Answered: no, and in the strongest form available.** See D7 below, which is
where the answer and its consequences live. Q6 is kept here rather than deleted
because the question is the record of what the answer cost, and because the
recommendation under it turned out to be right about the deadline.

**What the question said, kept for the record.** It was not decided, and
deferring it had a cost: `20260731093000_offer_applications.sql:126-127` states
"No policy lets anybody see what another creator asked for, or what they were
paid", and a standings screen makes that sentence untrue. The recommendation was
"decide now, build later", on the grounds that rules S4 and S5 made either answer
implementable, but that a leaderboard designed after live entries exist is a
leaderboard designed against a frozen data model under time pressure. It also
noted that the open decision "Leaderboard privacy default: opt-in or opt-out
(Step 9)" in `PROJECT_STATE.md` is the same question and should be answered once,
here. It was, and it was answered before a line was built, which is the whole
value of having asked it early.

### D7. May a creator ever see another entrant? DECIDED 2026-08-13

**Decided: no. NO CREATOR EVER SEES ANYTHING ABOUT ANOTHER ENTRANT.** Not a
headcount, not another person's approved count, not a position in a field.
Rashid closed Q6 in the strongest form the question had.

**What it cuts, immediately:**

- **Design direction 2F, "Competing with a published standing", is CUT.**
  Direction **2E, "Competing against yourself", is the one we build.**
- No standings table, no published snapshot, and no read policy anywhere that
  returns one creator rows about another. The paragraph in 2.11 that used to
  read "standings, if they are ever built, are a published snapshot written by a
  staff action, not a view" left a door open and is closed.
- The guarantee already written at
  `20260731093000_offer_applications.sql:126-127`, that no policy lets anybody
  see what another creator asked for or was paid, **stands untouched and now
  covers contests too.**

**The first consequence he decided, and he was told it is easy to overturn: the
copy "You placed 5th" is KEPT.** A creator's own placing is their own result and
names nobody. **What that costs, and it is a real cost paid in the schema:
settlement must record a placing for EVERY entrant, not only the ones being
paid.** A placing cannot be derived on the creator's screen without a ranking,
and a ranking is the object D7 forbids, so the placing has to be a stored fact
about one entry. `contest_awards` therefore changes shape (2.9): it becomes a
settlement outcome table carrying one **outcome row per entrant, always**, with
the money rows alongside it, and it gains three partial unique indexes to keep
the two shapes apart and to make settlement idempotent. The old
`unique (contest_id, entry_id, term_id)` would not have caught a double click on
Settle, because Postgres treats NULLs as distinct in a unique constraint.

**The second consequence he decided: the self set target drawn in 2E is KEPT.**
One private number per entry, visible only to the creator who set it, and the
only genuinely new thing the design needs stored. It brings
`contest_entry_targets` (2.6.1), `set_contest_entry_target` (2.13), one policy
with no staff counterpart (2.10) and rules T1 to T5. It is the first table in
this product with a creator policy and no staff policy, and 2.6.1 argues that
case rather than assuming it.

**What this forbids being built**, written as rules N1 to N6 so that nobody adds
a headcount or a standing later by accident: no entrant count on any creator
surface in any form, no other creator's numbers, no position in a field, no
standings object of any kind, and no fourth source of motivation beyond the
judging sentence, the creator's own approved count and their own target.

**The cost he accepted:** the competing screen has less on it than a leaderboard
would, and the honest answer to "how am I doing against everybody else" is that
we do not tell them. In exchange, one sentence in a shipped migration stays true,
and there is no version of this feature where a creator's numbers appear on
somebody else's screen.

**And the open decision in `PROJECT_STATE.md`, "Leaderboard privacy default:
opt-in or opt-out (Step 9)", is answered for contests and leans the same way for
leaderboards.** It should be recorded there as leaning to opt-in at the least,
and the argument for closing it the way D7 closed Q6 is now written down and
tested.

### D8. Where the banner sits and what shape it is. DECIDED 2026-08-13

**Decided: the banner sits INSIDE THE READING COLUMN, at a fixed 3:1, on every
surface and at every width. The full width strip is CUT.**

The design drew the banner as a bleed across the whole content area in one 1440
frame and inside the column everywhere else. Rashid ruled on the column, and on
one crop everywhere.

**Why, in his terms:** so one contest can never be twice the height of the next.
Two crops on one screen means the taller contest reads as the more important one
when all that actually differs is which admin uploaded a wider file.

**What ships with it:** **the upload preview in the setup form shows exactly the
crop the creator will see**, at 3:1, rather than the shape of the file. An admin
shown their whole photograph, who then finds the top third of it on the live
contest, uploads a second photograph and is unhappy with that one too.

**The cost he accepted:** the banner is smaller than the design's most dramatic
frame, and a contest page is less of a poster than it could be. In exchange
every contest looks like every other contest at the top, which is what makes a
list of them scannable.

Written up as rules B4 and B7 in 3.8, and as the "no aspect ratio column" note in
2.2.

### D14. What the cancellation text is called. DECIDED 2026-08-13

**Decided: the column is `cancel_message`, not `cancel_reason`.** Renamed in the
migration before it was applied, so it cost nothing. After it is applied this is
a data migration, which is why it was worth thirty seconds now.

**Why:** every column on `contests` is creator facing, and the cancel screen
labels this field as what the entrants will read. A field called "reason" invites
somebody at eleven at night to type "client pulled the budget" into a box that
two creators then open. The column name is the last thing standing between an
internal note and the person it is about.

**What did NOT change, deliberately:** `contest_exclusions.reason` keeps its
name. That one is staff only, no policy exposes it to anybody outside the team,
and there it is genuinely a reason rather than a message.

**The cost:** the word no longer matches `offer_applications`' rejection reason,
which is also creator facing and also badly named. That one is shipped and out of
scope here. Worth revisiting if it is ever touched for another purpose.

### D15. Whether product terms freeze when a creator enters. DECIDED 2026-08-13

**Decided: a creator always sees the brand's CURRENT price and commission.**
Nothing about a product is snapshotted onto a contest beyond what already is.

Rashid ruled against the recommendation, which had been to freeze price and
commission at entry the way `committed_amount` freezes money at approval.

**What this means in the schema:** nothing to build. `contest_products` already
carries `product_name` and `external_product_id` as a snapshot, so a rename
cannot blank a brief, and it carries no price or commission column at all.
Price and commission come from a live join to `brand_products` on every read.
**Do not add those columns later without asking him**, because adding them
silently changes what a creator sees.

**The cost he accepted, recorded plainly:** a creator who entered a contest at 25
percent commission can open it a week later and read 18 percent, with nothing on
the screen telling them it changed or when. That is different from the money
rules everywhere else in this feature, where what was promised is frozen. It is
defensible, because a commission is the brand's live term rather than a promise
Wurx made, but it is the one place in contests where the number a creator read
can move under them.

**Raise this again if:** a creator ever queries a commission figure, or the first
time a brand cuts one mid contest.

### Q7. What happens to a creator who is already entered when an admin excludes them? DECIDED 2026-08-13

**Decided: nothing happens to them, and there is no action that could make
anything happen to them.** Rashid's words: an admin should not be able to remove
somebody from a contest they are already in, because being in it means we
accepted them and they have already made videos; the admin decides while creating
the contest who to exclude, and if somebody has already joined there is no need to
exclude them.

**What that settles, in three parts:**

1. The exclusion list is set when the contest is created, and it may still be
   edited afterwards.
2. Editing it only ever stops NEW people joining. It never touches anybody
   already in, whatever their status.
3. **There is no action anywhere in the product that removes a creator from a
   contest they have joined.** This goes further than the default the plan was
   written to. The earlier draft carried `remove_contest_entry` in rule X7 as a
   deliberate audited removal; that capability is CUT, from the data model, the
   rules, the joins, the build order and the suite. Rule X9 is no longer a
   default awaiting a word, it is settled and stronger than it was.

**The cost he accepted, stated plainly because hiding it is how it gets
reversed:** there is no lever to remove a creator who misbehaves mid contest.
The levers that remain are rejecting their submissions so the work never
completes, and awarding them nothing at settlement. Cancelling the whole contest
also still exists and is deliberately blunt, because it affects every entrant
rather than one. This is written up in full as **3.4.1**, which exists so that
nobody re-adds a removal action later without asking him first.

**Why this is coherent rather than a gap:** exclusion is a gate on entry, and a
gate that reaches backwards through a door somebody already walked through is the
rule F4 shape, one field performing fourteen decisions. Pulling entrants out would
have made `save_contest_exclusion` a money action, voiding frozen terms and
writing an entry state, a reason, an event row and an audit row per entrant inside
one transaction, so a mistyped handle would destroy live work with one keystroke.
Combined with **D5** (an exclusion is scoped to ONE contest), the exclusion
feature is now fully specified: it is per contest, it is forward looking only, and
it has no reverse.

### Q11 to Q14, the four that held up the setup form. ALL DECIDED 2026-08-13

**Raised on 2026-08-13 after the third design turn as AWAITING RASHID, and
answered by him the same day, after the run that recorded them had already been
launched.** They were the layout of the admin setup form and nothing else, so
nothing else in step 1 ever waited on them. The question numbers are kept so the
cross references elsewhere in this document still resolve, and the reasoning under
each is kept because it is the record of WHY, and because the cost he accepted is
part of the decision rather than a footnote to it.

**Q11. The reward row's title. DECIDED 2026-08-13.**

**Decided: the admin types it, every time.** He chose this **against the
recommendation**, which had been to generate a title from the row's own numbers
and let him override it. So nothing generates a title, ever: not the client, not
the Edge Function, not `save_contest_deliverable`, not a default and not a
fallback at render time. `contest_deliverables.title` stays `not null` with its
existing trimmed length check (2.4) and no column changes. A row arriving with a
blank or whitespace-only title is refused by the database, and refused by the form
first, with a named message **against that row** rather than a form level error.

**The cost he accepted:** one more thing to type on an already long form, on every
reward row, and a contest with six reward rows means six titles typed.

**Why, kept for the record:** the title is the sentence every entrant reads on
their frozen terms (2.7, rule F1), and a generated one would have made those words
ours, identical on every contest in the product, and changeable only by a code
change rather than by an edit. Written up as rule **F11**, with the suite proving
a whitespace-only title is refused by the database even when the client is
bypassed (section 7).

**Q12. Whether a half filled contest can be saved. DECIDED 2026-08-13.**

**Decided: it lives in the browser only. There is NO draft row.**
`contests.name` and `contests.expires_at` stay `not null`, `contest_status` gains
no draft value, no column becomes nullable, there is no partial row of any kind,
and **nothing incomplete can ever reach a count, a list, a policy or a screen.**
The half filled form is held client side, keyed so that two admins on one machine
and one admin on two brands cannot collide, and it survives a reload and a closed
tab on **that machine only**. What is not held client side: nothing staff-only and
commercially sensitive beyond what that admin can already read on that screen, and
**never an uploaded file, only its URL once the upload has succeeded**.

**The cost he accepted, plainly:** it does not follow an admin to a different
computer. The design promises "picked up where you left it yesterday", and that
is only true on the same machine. **The designer must be told**, and it is item 1
of what handback 5 owes them (3.14).

**Why, kept for the record:** a real draft state was schema work rather than form
work. `name` and `expires_at` would have had to stop being required, and then
every creator read path, `contest_is_open`, both `contests` select policies and
five write functions would each need a clause excluding a contest nobody finished,
with the first one that forgot showing a creator a contest with no name. What
ships instead is one Save that writes the contest, its commercials, its
deliverables, its products and its exclusions in one call and refuses until the
name and the deadline exist, and the schema in 2.2 was already right for it.
Written up as rule **F12**, with the suite proving no contest row exists until it
is legal (section 7).

**Q13. Whether the judging sentence is its own field. DECIDED 2026-08-13.**

**Decided: its own field. This is the only real schema change of the four.**
`contests.judging_basis` is a nullable text column with a trimmed length check in
the idiom the other text columns use (2.2), named for what it is rather than for
the screen it appears on. It is creator readable like the rest of `contests` and
it is not commercial. It is **REQUIRED whenever the contest carries any active
deliverable of the `rank` kind**, and because a CHECK constraint cannot see
another table that requirement is enforced in `save_contest` and in
`save_contest_deliverable`, **both directions**, since either one could create the
illegal combination: adding a rank row to a contest with no sentence, or clearing
the sentence on a contest that already has a rank row. Both raises are written out
in 2.13.

**The cost he accepted:** one more column, one more argument on `save_contest`,
one more field on an already long form, one more thing Zod refuses on both sides,
and a second place a save can be turned down.

**Why, kept for the record:** rule N5 makes the sentence the contest is judged on
one of exactly three sources of motivation on a live contest, now that D7 has
removed the other entrants, so it carries more weight than a paragraph usually
does. And with Q5 deferred, nothing computes a placing, so this sentence is the
only thing standing in for a scoreboard: a placing with no stated basis is the one
thing that would make a contest feel arbitrary. As a paragraph inside
`description` every admin would have put it somewhere different and the creator
screen could not have pointed at it. **This is not Q5.** Q5 asks what actually
ranks a ranked contest and is deferred by his own choice; this settles only where
the sentence describing it lives. Written up as rule **N7**, carried into the
setup form's field list, the write path, Zod on both sides, the audit detail and
the creator read.

**Q14. Dialog or full page. DECIDED 2026-08-13.**

**Decided: a full screen of its own.** The setup form is a route, reached from the
brand hub's Contests tab, and it is not a dialog anywhere in this document.
**His reasoning, recorded:** a contest carries around twelve fields plus three
lists inside it, the products, the reward rows and the people barred from it,
which is beyond a dialog.

**What it changes:** step 1's file list gains a route and loses a dialog
component; join 15's **modal** case for this form becomes a **page** case at 375,
768, 1024 and 1440; and the owner's admin layout rules now apply to it in full,
working content starting high, a compact header, reference data under an Overview
rather than stacked above the work, content left against the sidebar at a max
width and never centred, and no slug, id or route ever shown to an admin. **The
entry panel for CREATORS is unaffected and stays a dialog.**

**The cost he accepted:** it is the only admin editor in the product that is not a
dialog, which is a precedent every later form will be measured against.

**Why, kept for the record:** both directions in turn 3 are drawn as full 1440
pages while this plan had put the form in a dialog, and neither drawing shows the
admin sidebar, so the owner's rule that content hugs the sidebar could not be
checked against either. A dialog would have had to fit twelve fields and three
nested lists at 375px, which neither drawn direction does, and the shape that
produces, a list scrolling inside a panel scrolling inside a page, has to be
unbuilt rather than fixed. **The form still needs 375, 768 and 1024**, which turn
3 has for neither direction; that is item 2 of what handback 5 owes the designer
(3.14). Written up as rule **F13**.

### Q8 to Q10, three that must be raised rather than answered

- **`docs/PARKED.md` items 1 and 2, approval notifications. The trigger arrived
  and Rashid has now ruled on it, 2026-08-13.**
  A manual-approval contest with an expiry date is strictly worse than an offer
  request with no deadline: a creator applies Monday, is approved Thursday, never
  opens the app because nothing tells them, and the contest expires Friday. They
  held a place, filmed nothing, and the first they hear of it is that it is over.
  Item 2's own note says "This is the single most important email in the product
  and it does not exist yet."
  **The ruling: email stays parked, and for now the copy stops promising it.**
  The design's waiting and locked screens both say the creator will hear by
  email; they now say "You will hear on this screen" and nothing more, and rule
  S9's connection status is what makes that sentence true rather than hopeful.
  This is written up as **rule W7**, which is also where to look if item 1 is
  ever fixed, because restoring the promise is one string in two places.
  **The underlying risk is not fixed by the copy change and is not claimed to
  be**: a creator who does not open the app still misses their own approval.
  Items 1 and 2 stay open in `PARKED.md`, and the trigger stays arrived.
- **`docs/PARKED.md` item 4, prod promotion rehearsal.** Contests land eleven tables,
  three views, twenty-one functions, a new Edge Function and a set of grants that
  have never been replayed against prod. Item 4 has been RAISED since 2026-07-29.
- **`docs/PARKED.md` item 6, Content-Security-Policy.** The content brief link is
  the first admin-authored outbound URL rendered to every creator in a group.

---

## 6. The build order

One step per approval, each one shippable and clickable on its own, in the style
of `docs/archive/UI_CONNECTIONS_PLAN.md`. Migration stamps continue from `20260812000000`.

### Step 0. Generate the database types  (half a day, no user-visible change)

`supabase gen types typescript --linked > src/types/database.ts`, then the hooks
that end in `as unknown as Row[]` start using it. **The order matters and is
easy to get wrong:** the types come FROM the applied schema, so the real sequence
per later step is migration, `supabase db push`, `gen types`, write the hooks,
deploy the Edge Function. `PROJECT_STATE.md:580-584` says this is worth doing
before the next schema change; contests is that change, and a misspelled
`committed_amount` on a creator hook would render blank, pass `pnpm build`, and
be found only in Rashid's browser with no error to report.

Ships alone because it touches every existing hook and nothing else.

### Step 1. A brand can run a contest  (admin only, no creator surface)

**SPLIT 2026-08-13, third design turn, and UNBLOCKED the same day. The setup
form's layout was the only unsettled part of this step, and Rashid answered all
four questions behind it** (section 5, Q11 to Q14). The split stands as the build
order, because it is still the right order: everything that is not the
arrangement of the form is specified to the level a build needs, so it is written
first and the form is laid out on top of it. **Build in this order.**

**What the four answers changed inside this step:** the form is a **route with
its own full screen**, not a dialog (Q14, rule F13); the migration carries one
more column, `contests.judging_basis`, with its requirement enforced in
`save_contest` and `save_contest_deliverable` (Q13, rule N7); every reward row
carries a title the admin types, with a blank one refused against that row (Q11,
rule F11); and there is **no draft row**, so the half filled form is a client-side
store keyed per admin, per brand, per contest, and the migration is untouched by
it (Q12, rule F12).

**The first tier, which never depended on an answer:**

1. **The migration**, exactly as listed below: the enums, the five tables, the
   two `contests` indexes, the `audit_log(action)` index, every check constraint
   and the `brand_products (id, brand_id)` unique key the composite foreign key
   needs. Four columns in it now have controls promised against them by rule F10,
   which changes nothing about the migration and is why it can ship first.
   **`contests.judging_basis` is in this migration** (Q13, rule N7) and Q12 adds
   nothing to it at all: there is no draft column, no draft status and no
   nullable name or expiry, which is the answer.
2. **The grants and the policies**, including the deliberate absences in 2.10 and
   a `grant all privileges on table ... to service_role;` on every new table,
   without which the Edge Function silently reads nothing and it looks like RLS
   working (rule S2).
3. **The write functions** in this step's half of 2.13, with their row locks,
   their refusals, their audit verbs and the `pg_timezone_names` check inside
   `save_contest`. `set_contest_status` and `delete_contest` are in this set and
   rule L17 now says both get a control. **`save_contest` also carries
   `p_judging_basis` and both halves of the N7 refusal, one here and one in
   `save_contest_deliverable`**, and both raises are audited like every other
   field.
4. **The Edge Function `manage-contest`**, its per action gate, its Zod body and
   its refusal sentences, which the client's Zod messages then match word for
   word. Its contract is settled (2.13, rule S1) and no part of it depends on how
   the form is arranged.
5. **`scripts/seed/seed-brands.mjs`'s contest seed** and `scripts/verify/creator/check-contests.mjs`
   phase one, including the three storage checks in section 7. Both drive the
   functions rather than the screens, so both run before a form exists. **Ask
   before seeding; he may want the database empty.**
6. **The two controls whose behaviour is already fully specified**, built in
   `src/components/ui/` as controls rather than as parts of a page: the **date,
   time and timezone control from rule L6** with its echoed instant and its
   calendar disabling under rule L16, and the **banner upload from rule B8**,
   `ImageUploadField` over `useImageUpload` at `contests/<contest_id>` with the
   3:1 preview, the clear control and the helper text. The date control has no
   precedent in this codebase at all; the banner upload has one and keeps it,
   adding only the three things rule B8 names. They are the two the design still
   owes frames for, and neither needs the layout to exist. The products
   multi-select described below is the same kind of object and can be built
   beside them.
7. **The design system work from 3.12**, listed further down, now including the
   new `--wx-scrim` token from rule C7 and the motion durations from rule C8.

**The second tier, the setup form itself, which is now fully specified.** It is a
**route with its own full screen** under the admin shell, reached from the brand
hub's Contests tab, holding the controls above plus the fields the four answers
settled: a typed title on every reward row (F11), the judging sentence as its own
field, required whenever an active reward row of the `rank` kind is present (N7),
and no Save-as-draft anywhere on it, because a half finished form is remembered
in the browser and written nowhere (F12). The owner's admin layout rules apply to
it in full and it is checked at 375, 768, 1024 and 1440 as a page (F13, join 15).
**What the design still owes for it is in 3.14 and blocks nothing**: the four
answers specify the form to the level a build needs, in the same way rule B8
specifies the upload control and rule L6 specifies the deadline control.

Migration `20260813090000_contests_are_a_real_thing.sql`: the enums, `contests`,
`contest_commercials`, `contest_deliverables`, `contest_products`,
`contest_exclusions`, `contest_is_open()`, `save_contest`,
`save_contest_commercials`, `save_contest_deliverable`,
`retire_contest_deliverable`, `set_contest_products`, `save_contest_exclusion`,
`remove_contest_exclusion`, `set_contest_status`, `delete_contest`, every policy,
every grant, **the two `contests` indexes from 2.2 and the `audit_log(action)`
index**, and the `brand_products (id, brand_id)` unique constraint the composite
FK needs. Plus the guard added to `delete_product` so a product attached to a
live contest refuses with a sentence rather than only with a foreign key error.

**`contests.expires_at_timezone` ships here, with the column** (gap 2, rule L6),
and so does the `pg_timezone_names` check inside `save_contest`. It cannot be
retrofitted cheaply: a `not null` column added later needs a backfill and a
guess at what zone the existing rows were set in, and the guess is exactly the
thing the column exists to stop anybody making.

**`contests.judging_basis` ships here too, with `save_contest`'s
`p_judging_basis` argument and both halves of the rule N7 refusal** (Q13). It is
nullable, so it could technically be added later, and it is not, for two reasons:
the requirement lives in two functions rather than in a constraint, so retrofitting
it means reopening `save_contest` and `save_contest_deliverable` after they have
shipped and been called, and a `rank` deliverable can be created from the day this
migration lands, which is the exact combination N7 refuses. A rule that arrives
after the rows it governs is a backfill and an argument about which contests are
exempt.

`supabase/functions/manage-contest/index.ts`: the Edge Function, copied from
`manage-brand` for its contract (`{ ok: true, result }`, 500 fallback) and from
`manage-offer-application` for its per-action gate, because contests are a
both-sides feature.

Client: `src/lib/schemas/contest.ts`, `src/lib/admin/useContests.ts`,
`src/lib/admin/useManageContest.ts`, `src/components/admin/BrandContests.tsx`
registered in the admin hub's section switch, **the setup form as its own route
and its own screen** rather than a dialog component (Q14, rule F13), reached from
the brand hub's Contests tab and code-split like every other route, and **the
client-side draft store behind it**, keyed on the admin's user id, the brand and
the contest being edited or `new`, cleared on a successful save and on sign out
(Q12, rule F12). **Two controls have no
precedent anywhere in this codebase and are real design work, not a field:** a
datetime picker, which after rule L6 is a **date, a time AND a timezone select
with the resulting instant echoed back in words as the creator will read it**
(there is no date control and no date formatter in `src/lib/`), and a products
multi-select (`Field.tsx` exports a single-value `Select` only, hand-built with
`appearance-none` because the OS arrow cannot be themed). Both are built here, in
`src/components/ui/`, or the setup form ships the first admin editor in the
product with unstyled OS controls on a `#1a1714` panel.

**The design system work from 3.12 also lands here**, before any screen is drawn
on top of it: `--wx-deadline` and `--wx-rank-1/-2/-3` into `tokens.css` in both
modes with their `PAIRS` entries, **`--wx-scrim` into `tokens.css` in both modes
with the four hardcoded dialog backdrops moved onto it in the same commit (rule
C7)**, the `KNOWN_BAD` list and its drift check in `scripts/build/check-contrast.mjs`
(rule C3), and the layout fix that keeps muted and accent text off surface 3 (rule
C2). The secondary button variant is used rather than an inline border (rule C6)
and every duration is one of the three already in `tokens.css` (rule C8), from the
first component onwards. Adding a guard after the screens it would have caught is
how the three light mode failures got as far as a design review.

**The banner upload ships in this step, in this form, and it is the third control
on it.** It is `ImageUploadField` over `useImageUpload` with
`folder="contests/<contest_id>"`, the same component the brand About tab and the
product dialog already use, so the 2 MB refusal, the type refusal and the "that
upload did not go through" wording all already exist and are not rewritten. New
here: helper text saying the image is publicly readable and must carry nothing
commercial (2.2.1), a clear control so a banner can be taken off again, and the
3:1 preview at the crop the creator will actually see rather than at whatever
shape the file happens to be (rule B4). `save_contest` carries `p_banner_url` and
audits it. The admin-side rendering of the banner is done to rules B3 to B5 here,
even though no creator can see anything yet, because the alternative is drawing it
twice and letting the two disagree.

Also here: joins 1, 8 and 10 (admin half), and `scripts/verify/creator/check-contests.mjs` phase
one, including the three storage checks in section 7.

At the end of this step an admin can set a contest up properly and nobody else
can see anything. **The form is still the last thing built rather than the
first**, which was the point of the split and stays the point of it now that the
four answers are in: the migration, the functions, the Edge Function, the seed and
the three controls all stand on their own, and the screen is arranged on top of
things that already work.

### Step 2. Creators can enter  (the moment the feature exists)

Migration `20260813120000_creators_enter_contests.sql`: `contest_entries`,
`contest_entry_terms`, `contest_entry_events`, the partial unique index,
`apply_for_contest`, `withdraw_contest_entry`, `review_contest_entry`,
`record_contest_exclusion_attempt`, **`contest_excludes` and
`contest_excludes_caller` (2.12.1)**, the creator policies
on `contests` and `contest_deliverables` **including the exclusion clause on
both of them**, `brands_select_own_contest_entries`,
the realtime publication membership for the three tables that exist by then, and
`contest_totals`.

**Three things in 2.10 and 2.11 cannot ship in this step, and saying so here is
cheaper than a migration that will not apply.** `contest_entry_progress` left
joins `contest_submissions`; the publication membership in 2.10 includes that
same table; and rule E3's "has submitted nothing and been awarded nothing" reads
`contest_submissions` and `contest_awards`. Those two tables arrive in steps 4
and 5. So the view and that table's publication membership land with
`contest_submissions` in step 4, and `withdraw_contest_entry` is replaced in the
migration that creates each table it has to read, gaining one half of its guard
each time. Until then withdrawal from approved is refused on the entry row alone,
which is the same answer, because a creator with no submissions and no awards is
every creator there is.

**The gap 1 fix ships in this step and cannot be deferred to a later one**, for
a reason worth stating: this is the step that creates the creator policies in
the first place, so shipping them without the clause means shipping a catalogue
that shows excluded creators a working Apply button, and then removing a button
somebody has already seen. It is one clause, written once, in the migration that
creates the policy.
**No removal function, and no admin control that would need one** (Q7, X9,
3.4.1): the admin entries queue built in this step approves, rejects and shows an
excluded flag, and that is the whole of what it can do to a row.

Client: `src/lib/creator/useContests.ts`, whose explicit `COLUMNS` constant
carries **`judging_basis`** so the sentence arrives on the same select as the rest
of the contest and costs no second query (Q13, rule N7), a shared `contestState()`
in a neutral file because both sides read it, **the one date and countdown
formatter from rules L6 and L15 in the same neutral folder**, the contest card
written ONCE and used by the creator hub tab and the creator contests screen,
**the judging sentence rendered on its own in a fixed place** on the contest's own
page and in the join panel rather than inside the description,
`ContestApplyDialog` copied from `ApplyDialog` **and staying a dialog, which Q14
did not touch**, the admin entries queue, joins
2, 3, 4, 5, 9, 10 (creator half), 11 and 12, the `refetchInterval` plus clock
tick from rule L5, **and the realtime status from rule S9, which the waiting
screen's dot and copy read.** The waiting and locked screens ship with rule W7's
copy, promising this screen and not an email.

`scripts/verify/creator/check-contests.mjs` reaches its full attack list.

At the end of this step the whole of Rashid's brief works except deliverable
submission and settlement.

### Step 3. Money is honest about itself  (admin only, one screen each)

`brand_contest_totals`, `contest_totals` wired into the brand Overview and the
admin home, joins 6, 7 and 8, and the M7 budget check on `save_contest`. This is
the step that puts decision 2 into code: the contest pot stays separate,
`brand_commercials.budget_used` is not touched by anything here, and
`scripts/ops/reconcile-budgets.mjs` is not opened at all.

**Rule M10 ships inside this step, not after it.** Every surface this step touches
comes out of it showing contest money beside offer money, each block labelled,
each grouped by currency, zeroes drawn rather than blocks hidden, and the budget
bar saying in words that it counts offers. A version of this step that adds the
contest totals to the contest screens and leaves the brand Overview quoting the
offer figure alone is not a smaller version of it, it is the failure it was
written to prevent: two screens, two totals for one brand, no explanation on
either.

### Step 4. Contest deliverables can be filed  (both sides)

Migration `20260813150000_contest_content.sql`: `contest_submissions`, its
publication membership, **`contest_entry_progress`, which held back from step 2
because it left joins that table**, `submit_contest_content`,
`review_contest_content`, **`contest_entry_targets` and
`set_contest_entry_target`**, the oEmbed refresh action on `manage-contest`.
Joins 13, 14 and 16. The progress bar comes from `src/components/work/`, not a
third drawing, **and it has four segments, not three** (rule W6), which is a
change to a shared component and therefore has to be agreed with the offer side
rather than forked.

**The self set target lands here rather than in step 2, and that is deliberate.**
It counts approved videos, so before `contest_submissions` exists there is
nothing for it to count and the screen it belongs to, direction 2E's competing
state, cannot be built. Shipping the table earlier would put a control on a
screen that could only ever read zero. It brings rules T1 to T5 with it,
including the one policy in the product with no staff counterpart, so **the
suite's staff-cannot-read assertions ship in the same step as the table**, not
after.

**Both halves of the decision 4 mitigation ship in this step, with the table that
creates the need for them.** The creator gets ONE route: the existing posting
dialog learns contest entries alongside offer jobs and there is no second place to
post (join 14). Staff get one job with a filter: contest and offer submissions are
reviewed on the same screen with the same controls and a filter naming which kind,
defaulting to everything waiting (join 16). The two tables and the two review
functions underneath are an implementation detail and neither side of the product
is allowed to see the seam. Shipping `contest_submissions` with its own creator
dialog and its own admin queue, intending to merge them later, is this step done
wrong: it is the exact cost Rashid was told would be mitigated, delivered
unmitigated, and both screens then have to be unbuilt to fix it.

### Step 5. Settlement  (gated on Q5)

`contest_awards` **in its post-D7 shape** (2.9), `settle_contest`,
`cancel_contest`, the admin settle flow with its confirmation, and
`contest_entry_events` rows for every entrant. **Do not start this until Q5 has
an answer.** If ranked prizes are deferred, this step still ships for `fixed` and
`milestone` contests as "close this contest and record what everybody was owed".

**D7 changed what this step collects.** The settle screen no longer asks "who
won what". It asks for **an outcome for every approved entrant**, and
`settle_contest` refuses while any approved entry has no outcome, so a contest
cannot half settle. On a contest with no ranked deliverable every outcome
carries a NULL placing, which still writes the row and is what keeps settlement
idempotent on a milestone-only contest. The three partial unique indexes in 2.9
are what make the double click safe, and the old table constraint would not
have: Postgres treats NULLs as distinct in a unique constraint.

### Not in the build order, deliberately

A leaderboard, an entrant headcount on a creator screen, GMV or commission per
contest, and any standings surface. **The first, second and fourth of those are
now forbidden rather than deferred**, by D7 and rules N1 to N6: they are not
waiting on an answer, they have one. GMV per contest still waits on Q5. Every
one of them is the shape that returns a creator the number 1 with no error.

---

## 7. What the verification suite must prove

`scripts/verify/creator/check-contests.mjs`, wired as `verify:contests` in `package.json`,
following `scripts/verify/brands/check-brands.mjs`: real accounts created and deleted in a
`finally` block, `asUser(page, path, init)` running `fetch` INSIDE the signed-in
page with the token pulled from `localStorage.getItem('wurxmediahub-auth')` so
the request is byte for byte what a creator's browser could send, a RIVAL
creator, and an anonymous tokenless call.

**Three suite-writing rules that are not optional here.**

1. **Every refusal is confirmed by reading the row back with the service key.**
   "An error message is not proof that nothing was written, so count the rows
   rather than trust the status code" (`check-offer-requests.mjs:477-484`).
   Contests return errors from four layers and only the row settles which one
   refused.
2. **Set-up failure throws rather than reporting as the thing under test
   failing** (`check-brands.mjs:490-507`). With an empty dev database, a contest
   that never got created reads exactly like RLS refusing.
3. **The console-error count excludes the deliberate refusals**, or the suite
   fails precisely because the security worked
   (`check-brands.mjs:969-975`).

### The attack book, as a signed-in approved creator

| # | Attack | Required outcome |
|---|---|---|
| 1 | `GET /rest/v1/contests?select=*` | Rows come back, and none of them carries a budget column |
| 2 | `GET /rest/v1/contests?select=total_budget` | HTTP >= 400, and neither the figure nor the words appear in the body |
| 3 | `GET /rest/v1/contest_commercials?select=*` | Zero rows |
| 4 | `GET /rest/v1/contest_exclusions?select=*` | Zero rows, including for a creator who IS on the list |
| 5 | `GET /rest/v1/contest_totals` and `/brand_contest_totals` | Zero rows each, and asking either for `total_budget` returns >= 400 |
| 6 | `GET /rest/v1/contest_entries?select=*` | Only the caller's own rows; a rival's entry id returns nothing |
| 7 | `GET /rest/v1/contest_entry_progress?entry_id=eq.<rival>` | Zero rows, proving `security_invoker` is doing its work, the shape `check-content.mjs:459-479` already uses |
| 8 | `PATCH` own entry setting `status='approved'` | >= 400, and a service-key re-read shows the row unchanged |
| 9 | `PATCH` own entry setting `committed_amount` | Same |
| 10 | `DELETE` own entry | Same |
| 11 | `POST manage-contest { action: 'contest.save' }` | 403, and a `contest.write_denied` audit row exists with the caller's `actor_id` |
| 12 | `POST manage-contest { action: 'contest.settle' }` | 403, same audit assertion |
| 13 | `POST manage-contest` apply with `creatorId`, `handle`, `amount` or `rank` in the body | 400 with a human sentence, not a silent strip, and no entry created |
| 14 | Excluded creator applies | Non-2xx, no entry row of any status, `attempts` on the exclusion incremented by exactly 1, one `contest_entry.excluded_attempt` audit row |
| 15 | Excluded creator changes `applications.tiktok_handle` via PATCH, then applies | Still refused, because the exclusion resolved to a `user_id` |
| 16 | Creator with no `applications` row at all applies to a contest excluding `@someone` | Admitted normally, proving the NULL handle comparison does not silently pass the guard for everybody |
| 17 | Two `apply` calls fired in the same instant | Exactly one entry exists; the second returns 409 |
| 18 | Apply to an expired contest, a settled contest, an inactive contest, and a contest on a retired brand | Four distinct human sentences, four non-2xx, zero entries |
| 19 | `POST /rest/v1/rpc/apply_for_contest` and `/rpc/review_contest_entry` by name | >= 400 |
| 20 | The same two with no `Authorization` header at all | 401 |
| 21 | `GET /rest/v1/contests?select=*` for an OPEN contest the creator is excluded from and has never applied to | Not in the result set. This is the half of gap 1 nothing implemented until 2026-08-13: `contests_select_creator` had no exclusion clause at all, so a bare catalogue read returned it with a working Apply button |
| 21b | Admin rejects a creator with the block flag, then that creator does `GET /rest/v1/contests?id=eq.<id>` and `GET /rest/v1/contest_entries?select=*` | The contest is gone from the result set; their OWN entry row still comes back, rejected. This is the other half of gap 1, and the two assertions together are what prove the exclusion narrowed the contest read without taking their own history away |
| 21c | Admin rejects a creator WITHOUT the block flag, then that creator reads the contest and applies again | The contest is still readable and the second entry is created. Rule E2 says a rejection is not a bar, and the fix for gap 1 must not have quietly made it one. **21b and 21c are the pair; either one alone proves nothing** |
| 21d | `POST /rest/v1/rpc/contest_excludes` by name, with a creator's token, passing a RIVAL's user id | >= 400. The two-argument form can ask about anybody and is granted to `service_role` only; the caller-only wrapper is the one `authenticated` may execute, and it takes no uuid |
| 22 | Creator reads a contest they entered, after an admin sets it inactive, after it expires, and after the brand is retired | Still readable all three times, with the name, the brand and the frozen terms intact |
| 23 | `POST` a PNG straight into the `brand-assets` bucket under `contests/<id>` with the creator's own token | >= 400, and a service-key list of that folder shows no new object. The banner upload is staff-only write and a creator holding a contest id must not be able to put a picture on somebody else's contest |
| 24 | `POST manage-contest { action: 'contest.save', bannerUrl: 'javascript:...' }`, then the same with `http://`, then with a 3,000 character string | Three non-2xx with a human sentence each, and a service-key re-read shows `banner_url` unchanged. Proves the check is in the Edge Function and the column, not only in the browser |
| 25 | `PATCH /rest/v1/contests?id=eq.<own contest>` setting `banner_url` | >= 400, and the row is unchanged. There is no UPDATE policy on `contests` at all (S1), and the banner is the newest field somebody might forget that covers |
| 26 | `GET /rest/v1/contest_entry_targets?select=*` as a creator holding a target, then as a RIVAL, then **as a real signed-in ADMIN**, then as an anonymous caller | Own row only for the first; zero rows for the second, **zero rows for the ADMIN**, 401 for the fourth. The admin case is the one that matters and is unusual in this suite: every other table in the feature returns everything to staff. See 2.6.1 and rules T1, T2 |
| 27 | `POST manage-contest { action: 'contest_entry.target.set' }` for a RIVAL's entry id | Non-2xx, and a service-key read shows no target row on the rival's entry. The function locks on `id AND creator_id`, so the refusal is "no such entry" rather than a permission error that would confirm the entry exists |
| 28 | `GET /rest/v1/audit_log?select=*` and `/contest_entry_events?select=*` with the SERVICE KEY after a target has been set and changed twice | The target value appears in neither, anywhere in the run. Rule T4 is the only reason it does not, and it is a rule about something NOT being written, which nothing else in the suite can catch |
| 29 | `GET /rest/v1/contest_entries?select=*&limit=1` with `Prefer: count=exact` as a creator, on a contest with four other entrants | The count header reads 1, not 5, and no creator surface anywhere in the run displays a number derived from it. Rules N1 and S5 |
| 30 | Search every creator-reachable response in the whole run for a rival's handle, display name, entry id, approved count or placing | Not present in any of them. This is the D7 assertion, run as a sweep over collected responses rather than as one request, because the failure it catches is a field somebody added to a shared component's props |

### What the suite must prove about money and freezing

- Approving an entry writes `contest_entry_terms` rows, and editing the contest's
  deliverable rewards afterwards leaves those rows byte for byte unchanged.
- `save_contest` refuses to change `currency` once any entry has frozen terms
  (409 or 400 with a sentence), and allows a `description` edit at the same
  moment.
- Flipping `needs_admin_approval` in both directions changes no entry's status.
- Auto approve produces an entry that is already `approved`, already has
  `contest_entry_terms`, already has a `contest_entry_events` row, and already has
  a `contest_entry.approved` audit row, all from one call.
- A reward set larger than `total_budget` is refused at save time with both
  figures in the message.
- `brand_commercials.budget_used` is byte for byte unchanged by every contest
  action in the whole run. **This is the assertion that catches decision 2, the
  separate pot, being broken by accident.**
- A brand carrying both offer money and contest money renders both figures, each
  labelled, on the brand Overview and the admin home, and neither figure equals
  the sum of the two. **This is the assertion that catches rule M10 being dropped
  quietly**, which is the failure Rashid was promised would not happen.
- `contest_totals` for a contest with entries in two currencies returns two rows,
  never one.

### What the suite must prove about the lifecycle

- `settle_contest` refuses while any entry is pending, naming the count.
- `delete_contest` refuses while any entry is pending or approved, and when it
  does succeed the `contest.deleted` audit row exists and was written before the
  delete.
- Deleting a `brand_products` row attached to a live contest is refused, by the
  function with a sentence and by the FK if the function is bypassed.
- Settling twice returns 409 and `contest_awards` holds exactly one row per
  `(contest, entry, term)` **and exactly one outcome row per entry**. Run it on
  a contest with NO ranked deliverable as well, where every outcome row carries
  a NULL placing: that is the case the old `unique (contest_id, entry_id,
  term_id)` constraint would have let through twice, because Postgres treats
  NULLs as distinct.
- **Settling a contest with five approved entrants and prizes for two writes
  five outcome rows**, not two. Each of the other three reads their own row from
  their own token and finds their placing. **This is the assertion that catches
  D7's "You placed 5th" being paid for only where the money is**, which is the
  version of settlement anybody would write from the old table shape.
- `settle_contest` refuses while any approved entry has no outcome, naming the
  count, so a contest cannot half settle.
- Two entrants cannot be given the same placing: the second write is refused by
  `contest_awards_placement_idx`.
- `brand_contest_totals.awarded` for that contest equals the two prizes, not
  five rows' worth of anything. Outcome rows are worth zero and must not
  double count.
- A suspended creator's entry still returns from their own token, and their
  apply, withdraw and submit calls all return 42501.

### What the suite must prove about the deadline

- A contest saved with `expires_at_timezone` of `America/Los_Angeles` renders
  the same instant as the same string for **two different creators in two
  different browser zones**, and that string names the zone the admin chose,
  not the zone the reader is in. Run it by overriding the browser timezone in
  the page context, which is the only way this failure is visible at all.
- The same contest renders correctly on both sides of a clock change: a
  deadline stored as 23:59 `Europe/London` reads BST in August and GMT in
  December. **This is the assertion that catches somebody storing an offset**,
  which passes every test taken on one day of the year.
- `save_contest` with a timezone of `Mars/Olympus`, of `+01:00`, and of `BST`
  are three non-2xx with a sentence naming the value, and a service-key re-read
  shows the column unchanged. The abbreviation case matters: `BST` looks
  plausible and is ambiguous between British Summer Time and Bougainville
  Standard Time.
- **One contest, every surface, one countdown.** The card, the contest page, the
  join popup and the admin record all print the same "days left" figure for the
  same contest at the same moment. The design currently prints 49 on one screen
  and 50 on another, which is the defect this proves is gone.
- The countdown ceils, never prints "0 days left", switches to hours under 48
  and to minutes under one, and prints no countdown at all past the deadline.
  Test it by supplying `now` rather than by waiting, which is why rule L15 makes
  `now` an argument.

### What the suite must prove about the four answers of 2026-08-13

**These are Q11 to Q14 made testable.** Three of them are rules about something
NOT existing, which nothing else in this file catches, so each one is written as
the read that would find it if it came back.

- **A reward row title of spaces is refused by the DATABASE, with the client
  bypassed** (Q11, rule F11). Insert a `contest_deliverables` row with a title of
  `'   '` using the **service key**, straight at the table: the trimmed length
  check refuses it. Then the same through `save_contest_deliverable`, which
  raises. Then through `manage-contest`, which refuses with the same sentence Zod
  uses. Three layers, one wording, and the service-key case is the one that
  matters here, because Zod passing is not proof.
- **Nothing generates a title** (Q11). Save a reward row of each of the three
  kinds through `manage-contest` with the title omitted entirely: three refusals,
  and a service-key read shows no row was written with a title our code composed.
  A default that quietly fills the column is exactly what this answer forbids.
- **The blank-title refusal names the row**, not the form. On a contest with six
  reward rows and one blank title, the message is attached to that row in the
  form. A form level error on a six row editor is unfixable by the person reading
  it.
- **No contest row exists until it is legal** (Q12, rule F12). Fill the setup form
  half way, abandon it, reload, and confirm with the **service key** that
  `contests` holds no new row of any kind. Then post at `manage-contest` with the
  name missing, then with the deadline missing: two refusals, and two service-key
  re-reads showing nothing written.
- **There is no draft anything**, asserted against the catalogue rather than
  inferred (Q12): `contest_status` has exactly `active` and `inactive`, and
  `contests.name` and `contests.expires_at` are both `NOT NULL` in
  `information_schema.columns`. This fails the day somebody makes room for a
  draft.
- **The half filled form survives a reload and a closed tab, and does not follow
  the admin anywhere else** (Q12). Restored in the same browser as the same
  admin; **absent** for a second admin signed in on the same browser, absent for
  the same admin on a second brand's new contest, and cleared after a successful
  save and after sign out. The keying is the whole rule and this is what proves
  it.
- **No file is held client side** (Q12), only a URL after the upload succeeded.
  Pick a banner, abandon the form, and confirm nothing image-shaped is in the
  stored draft.
- **A ranked prize cannot exist without a judging sentence, in both directions**
  (Q13, rule N7). `save_contest_deliverable` adding a `rank` row to a contest
  whose `judging_basis` is null is refused with a sentence; `save_contest`
  clearing `judging_basis` to null or to spaces on a contest that already carries
  an active `rank` row is refused with a sentence naming the count. **Both, or the
  test proves half a rule**, and a service-key re-read after each shows the row
  unchanged.
- **Retiring the last rank row then clearing the sentence succeeds** (Q13). That
  combination is legal, `retire_contest_deliverable` carries no clause, and a
  suite that refuses it has turned a rule into a trap.
- **A `fixed`-only and a `milestone`-only contest save with no judging sentence at
  all** (Q13). The requirement is about ranked prizes, not about every contest.
- **A creator reads `judging_basis` from their own token, on the same select as
  the rest of the contest** (Q13), and it appears in no `contest_commercials` read
  and in nothing gated on `is_staff()`. It is creator facing by design and this is
  what says so.
- **The setup form is driven as a PAGE at 375, 768, 1024 and 1440** (Q14, rule
  F13), with no horizontal page scroll at any width, the content left against the
  sidebar rather than centred, and no slug, id or route rendered anywhere on it.
  **The creator entry dialog is still driven as a modal case** in the same run,
  because Q14 did not touch it and a suite that converts both has lost the one
  that stayed.

### What the suite must prove about the private target

**These run as a real signed-in ADMIN as well as a creator, because the point is
that the person with every permission still cannot read it** (D7, 2.6.1, rules
T1 to T5). It is the mirror image of the removal assertions below.

- A creator sets a target, changes it, then clears it. Their own reads return
  the right thing at each step. A rival's token and an ADMIN's token return zero
  rows at every step.
- The target value appears in no `audit_log` row, no `contest_entry_events` row,
  no view, and no realtime message captured during the run (rules T3, T4).
- `contest_entry_targets` is not in `supabase_realtime`, checked against the
  publication with the service key rather than inferred.
- Setting a target on a pending entry, on a withdrawn entry, on a settled
  contest and on a cancelled contest are four refusals with four sentences.
- Nothing in the money path reads it: `committed_amount`,
  `committed_video_count`, `contest_totals` and `contest_awards` are byte for
  byte unchanged by every target write in the run (rule T5).

### What the suite must prove about the connection and the words

- With the realtime socket forcibly closed in the page, the waiting screen's dot
  and sentence change within a bounded time, and the screen no longer claims a
  live connection (rule S9). **A dot that never changes passes every other test
  in this file**, which is why this one drives the socket rather than the data.
- No creator-facing string anywhere in the run contains "email" on the waiting
  screen or the locked screen while `PARKED.md` items 1 and 2 are open (rule
  W7). This is a check on copy, it is cheap, and it is the only thing standing
  between a parked item and a promise.
- One entry is described with one vocabulary on one screen: the tracker, the
  sentence under it and any badge use `approved`, `in review`, `needs another
  take` and `still to film`, and nothing on that screen calls the same video two
  of those things (rules W1 to W4).
- An entry with a video sent back for another take renders **four** tracker
  segments summing to the committed count, with the sent-back video in its own
  segment and not in "still to film" (rule W6, gap 8).
- An entry with a NULL `committed_video_count` draws no bar at all and a
  sentence with no denominator.
- The word for a creator pulling out is `withdrawn` everywhere, and the string
  "Left" appears as a state on no contest surface (rule W5).

### What the suite must prove about removal, which is that there is none

**These run as a real signed-in ADMIN, not as a creator, because the point is
that the person with every permission still cannot do it** (Q7, rule X9, 3.4.1).

- An admin adds an exclusion for a creator who is ALREADY approved on that
  contest. The entry is byte for byte unchanged afterwards: same `status`, same
  `committed_amount`, same `committed_video_count`, same
  `contest_entry_terms` rows, and no new `contest_entry_events` row. The creator
  reads their entry from their own token and still sees all of it, and can still
  submit.
- `POST /rest/v1/rpc/remove_contest_entry` by name, with the admin's token and
  again with the service key: **the function does not exist**, so the first is a
  404 or 42883 and the second is `undefined function`. This is a check that a
  thing is absent, which is unusual and is the point: it fails the day somebody
  adds it back.
- `POST manage-contest { action: 'contest_entry.remove' }` and
  `{ action: 'contest_entry.removed' }` with an admin token: 400 unknown action,
  and no `contest_entry` row changes.
- An admin token `PATCH`ing a `contest_entries` row to any status at all is
  >= 400 and the row is unchanged, the same as for a creator. There is no
  UPDATE policy for anybody (S1), and an admin is still just `authenticated`.
- The string `removed` does not appear as a `contest_entry_status` value
  anywhere: the enum has exactly `pending`, `approved`, `rejected`, `withdrawn`.
- **A creator withdrawing themselves still works**, from pending and from
  approved-with-nothing-submitted, and still refuses with 55006 once they have
  an approved submission. Cutting admin removal must not have cut this, and this
  assertion is what proves the two were separate things.

### What the suite must prove about the banner

- A creator's own token cannot write to `brand-assets` at all: upload, update
  and delete under `contests/<id>` each return >= 400, confirmed by listing the
  folder with the service key rather than by trusting the status code.
- An upload larger than 2 MB is refused, and the refusal reaches the admin as a
  sentence naming the limit rather than as a failed request.
- An `image/svg+xml` upload is refused by the bucket's `allowed_mime_types` even
  when the browser-side check is bypassed by posting straight at storage, and
  renaming the file to `.png` while keeping the SVG content type does not get it
  in either.
- **A contest with `banner_url` null renders correctly on every surface that can
  show one:** the admin contest record, the contest's own creator page, the join
  popup and the contest card in a list. No empty box, no broken image icon, no
  reserved gap, no console error, in both themes and at 375px, 768px, 1024px and
  1440px. This is the assertion that keeps rule B1 true, and it is the case
  Rashid will see first because the database is empty.
- A contest WITH a banner renders no text over the image without a solid
  surface behind it. `check-contrast.mjs` cannot judge this (rule B3), so the
  suite asserts the structural fact it can judge: no text node is a descendant
  of the banner container.
- **The banner's rendered box is 3:1 within a pixel or two, and its width does
  not exceed the reading column's width, on all four surfaces and at 375px,
  768px, 1024px and 1440px** (decision D8, rules B4 and B7). Measured from the
  live element rather than read off a class, because the class is what somebody
  overrides. A banner wider than the text beside it is the cut full-width strip
  coming back.
- The setup form's upload preview measures the same 3:1 as the live surfaces.
  A preview that predicts a different crop is worse than no preview.

### What the suite must prove about contrast

- `pnpm check:contrast` passes with the `KNOWN_BAD` list present, and **fails
  when a `KNOWN_BAD` ratio is moved in either direction** (rule C3). Prove it by
  editing a token in a scratch copy of `tokens.css`: the guard has to notice
  both an improvement and a regression, or the list rots into a comment.
- No contest surface puts `--wx-text-muted` or `--wx-accent` on
  `--wx-surface-3`, in either theme, at any width (rule C2). Asserted
  structurally from the computed styles, since the ratio itself is what the
  guard cannot reach.
- The neutral state dot resolves to `--wx-text-muted` and not to
  `--wx-border-interactive`, everywhere it appears (rule C4).
- `--wx-deadline` and `--wx-rank-1/-2/-3` exist in **both** modes in
  `tokens.css` and appear in `PAIRS` for every surface they are used on, and
  `pnpm check:contrast` fails if either mode is missing a value. Parity is
  already enforced product wide; this is the reminder that a token added for
  contests is not exempt.
- **`--wx-scrim` exists in both modes and nothing hardcodes a backdrop** (rule
  C7). Two assertions, because the token alone proves nothing: `pnpm
  check:contrast` fails when either mode's value is deleted, and no contest
  surface, dialog or panel resolves its backdrop to a literal `rgba(...)` or a
  `bg-black/NN` class in either theme. The four dialogs that carry a literal today
  are re-checked in the same run, or the token becomes the fifth spelling instead
  of the only one.
- **No secondary control draws its own border** (rule C6). The border colour on
  every secondary button in the contest screens resolves to
  `--wx-border-interactive` through the shared variant, in both themes, since the
  inline borders it replaces measure roughly 1.5:1 and nothing in `PAIRS` reaches
  them.
- **Every transition duration on a contest surface is 140ms, 240ms or 420ms**
  (rule C8), read from the computed style rather than from a class name, because
  a literal in a class is exactly what the rule is against.

### What the suite must prove about the one route and the one queue

- A creator holding an approved offer job AND an approved contest entry opens the
  posting dialog and is offered both in the same picker, from one route, and no
  second dialog and no second path to post a video exists anywhere on the creator
  side. **This is the assertion that catches the join 14 half of the decision 4
  mitigation being dropped quietly.**
- A review queue holding a contest submission and an offer submission both waiting
  shows both by default, on one screen, with one approve and one
  needs-another-take control and a filter naming which kind. **This is the
  assertion that catches the join 16 half**, which is the cost Rashid was promised
  would be mitigated rather than paid in full.

### Two suites that are not new but must be re-run and extended

- **`pnpm verify:responsive`.** Every new contest screen in `SCREENS`, a `via`
  entry for anything behind an id, **a PAGE case for the contest setup form** at
  375, 768, 1024 and 1440 (Q14, rule F13, which replaced the modal case this line
  used to ask for), and a modal case for the creator entry dialog, which stays a
  dialog. `check-responsive.mjs:41-42` defaults `CREATOR_EMAIL` to a demo
  account that no longer exists on the empty dev database, so seeding is a
  precondition for this suite, not a nicety.
- **`pnpm verify:live`.** An admin closing a contest must remove the Apply button
  on a creator screen already open, with no reload, and an entry decision must
  land on the creator's screen the same way. This is the suite that drives the
  admin screen rather than the database, and contests are the first feature whose
  state can also change with no write at all, so it must additionally prove the
  timer from rule L5 by advancing past an expiry.
