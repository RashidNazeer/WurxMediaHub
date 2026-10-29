# UI design brief: Contests for WurxMediaHub

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

Everything below is the brief. It is written to be pasted whole into a design
agent or handed to a designer as it stands.

---

## Read this first

We are going to give you a problem, a set of people, a feeling, some materials
that cannot bend, and the rulings we have already made. We are deliberately not
going to show you our current screens or walk you through them section by
section.

We have made that mistake once already. The first version of our last brief
described our own screens top to bottom, with the copy, the section order and
the layout. The design came back nearly identical to what we already had. That
was the brief working exactly as written, not the designer failing. The second
version deleted three quarters of that detail and got us something so much
better that we rebuilt the product's colour system, its type and its motion
around it.

So: materials and truths, not layouts. Where we give you exact values (colour
tokens, type, the easing curve) it is because a script in our build fails the
deploy if a colour is not one of ours, and because what you design has to sit
next to screens that already exist. Materials are not a design. Nothing about
our current layout, navigation, section order or copy is worth preserving. If a
screen works better as something other than a grid of cards, do that.

## Who Wurx is, and who this is for

Wurx Media runs TikTok Shop brands. Creators make short videos, those videos
sell products, and money comes back. Historically a creator has no idea how
much. They post, and a month later somebody tells them a number, and they have
no way to check it.

WurxMediaHub is the platform that fixes that. A creator applies once, gets
approved, and enters branded hubs where they see their real numbers: the sales
their own videos drove, the commission they earned, the stage each job has
reached, and what they are owed. We call it transparency and it is not a feature
of the product. It is the product. The moment that matters, across the whole
platform, is a creator logging in and seeing their own real numbers for the
first time.

Two audiences use what you are designing.

**Creators.** Mostly US and UK TikTok Shop creators. Mostly young.
Overwhelmingly on a phone, often in bad light, one handed, often at night after
filming. Some are full time, most are not. They are ambitious, and they are used
to platforms being vague with them. They notice when a product is straight with
them, and they notice faster when it is not. They usually decide in about ten
seconds whether something is worth their time.

**The Wurx team.** Two to five people on laptops, running several brands at
once, working queues all day. Their time is the scarcest thing in the company.
The product owner tests everything himself, in a browser, on a phone and on a
laptop, and he finds anything left half done.

## What a contest is, in the owner's words

Read this twice. It is the whole source of truth for scope, unedited.

> "Contest is basically an ongoing event on brands that creators can participate
> in. Each contest belongs to the brand and creator must need to apply on the
> contest. Admin can decide whether the contest needs manual admin approval or
> not; if admin chooses manual approval it means creators cannot be approved
> without admin approval, otherwise creators would simply need to click apply in
> the contest and he will be the part of that contest. The contest belongs to
> the brand and admin needs to set it up properly: name of the contest, expiry
> date of the contest, deliverables with rewards, the brand it is for,
> description of the contest, status active or not, products included in contest
> (dropdown, product must be added in brands detail page), total budget for a
> contest (only can be seen by the admin and set by the admin), content brief
> (link, admin will add that), let admin also exclude a specific creator by
> providing the handle of that user or maybe email if available, and if that
> creator applies we need to track them differently and they should not be able
> to apply. Creators and admin will have separate proper dashboards where they
> will be managing all that, like who applied, when applied, and everything."

## The moment that matters, stated as a feeling

A creator who already films for a brand opens the app at eleven at night. There
is a contest running. It has a prize, a deadline and a clear thing to do. For
about four seconds they understand exactly what it takes to win and exactly what
it pays, and they think: **I could actually win this.**

Then they tap to enter.

If the contest lets anyone in, the answer has to land before they have finished
doubting themselves, and it has to feel like a door opening rather than a form
submitting. **I am in. It is mine to lose.**

If a person has to review them, the answer cannot land now, and the moment has
to survive that. What they must feel instead is: **a real human at Wurx has my
name in front of them and will answer, here, on this screen.** Not "request
received". Not a spinner ending in a grey banner.

Then, hours or days later, while they are looking at that screen or some other
one, the decision arrives with no refresh and no reload. That is the proudest
behaviour this platform has and today it happens in silence somewhere almost
nobody looks. Contests are where we make it unmissable.

The team's version of the moment is quieter and just as important: opening a
contest and seeing, without reading anything twice, who is waiting on them.

Judge every screen you draw against those paragraphs.

## Design the system, not six screens

This is the part we care most about.

One contest is a single fact. That fact appears on six surfaces, three a creator
sees and three the team sees, and it has to read as the same fact every time. If
a creator is told a contest pays $250 for three videos, the team member looking
at that creator's row must be looking at the same $250 and the same three, in
the same words and the same shape. When those two drift apart, the only promise
this product makes is broken.

So design the vocabulary first and the screens second. We would rather receive a
small system of pieces that compose across all six surfaces than six beautiful
unrelated screens.

| Surface | Who | The only question it has to answer |
| --- | --- | --- |
| Contests, browsing | Creator | What is running right now that I could win something from |
| One contest | Creator | What exactly do I have to do, what do I get, when does it close, am I in |
| My contests | Creator | Which am I in, what do I still owe, what am I owed, what changed |
| Contest setup | Team | Set one up correctly, in one sitting, without dread |
| One contest, team view | Team | Who is in, who is waiting on me, what has been delivered, what will it cost |
| Contests across brands | Team | Which contests are live, which need a decision from me today |

How many screens that becomes, what they are called and how they are laid out is
yours. The table is the set of questions, not a sitemap.

Five things must be true on every one of those surfaces, and they are the system:

1. **A reward is frozen per person.** The moment somebody is in, what they were
   promised is theirs and it never changes, even if the team edits the contest
   afterwards. Every surface reads that frozen promise, never the contest's
   current numbers, and both audiences see the same frozen figure for the same
   person.
2. **One state has one name.** Whatever you call the state a creator is in, the
   team's screens use the same word for the same person. Never two vocabularies
   for one fact. A phone call between an admin and a creator has to use one set
   of words.
3. **Money never crosses currencies.** A contest is in one currency. Anywhere the
   team totals across contests, it is one block per currency, never one confident
   added-up number. This is the one arithmetic mistake this product must never
   make.
4. **Creator surfaces contain no cost data at all.** Not the budget, not what has
   been spent, not a percentage, not a "funded" bar, not "spots left because the
   money ran out". Not filtered out in the UI: absent. The creator dataset below
   physically does not contain it, and that is a boundary in our database, not a
   display preference.
5. **Creator surfaces contain no other creator.** No entrant list, no handles, no
   headcount, no "you are 3rd of 14", in any form and with no exception: that is
   decision 7 and there is no published standing sitting behind it. Designing in a
   rival count would be designing a number we cannot truthfully supply.

## The words that cannot move

An entry is in exactly one of these. Use the same word on both sides. You may
design how they look, and you may propose better words in your writeup, but one
word per state.

- **Waiting**, they entered a reviewed contest and no human has answered yet
- **In**, they are accepted and the work is theirs
- **Delivered**, they have done everything the contest asked of them
- **Not accepted**, the team said no, and they may enter again while it is open
- **Withdrawn**, they pulled out, and only before they have filed any work. Only
  they can put themselves here. The team has no equivalent move and never gets
  one. The verb is "withdraw", the state is "withdrawn", and on a card it reads
  "You withdrew". An earlier version of this list said "Left"; that word is cut,
  because our database already says `withdrawn`, the button already says
  "Withdraw", and "left" collides with "days left", which sits on every contest
  card in the product
- **Barred**, they are excluded from this contest. This one is a team word only.
  It exists in our data and on team screens, and it never reaches a creator's
  screen, because the contest is not there for them to see

A contest is in one of these. These are separate facts on purpose, so do not
collapse them into one status chip without telling us why.

- **Open**, new people can enter
- **Closed to new entries**, nobody new gets in, everybody already in carries on
  working and getting paid
- **Ended**, the deadline passed, same rule
- **Settled**, the outcome is decided and final

The consequence, and it is the single most important rule in this brief:
**nothing about a contest may ever outrank work already under way on it.** A
contest that closes, ends or gets switched off must never make somebody's entry,
their remaining deliverables or their money disappear from their screen. We have
shipped exactly that bug twice on the offers side. It is the worst thing we have
ever done to a creator, and it is a bug both times because a screen asked the
contest what to draw instead of asking the person's own record.

## Eight things now decided

The owner ruled on these. They are settled facts to design to, not options.
Do not draw an alternative to any of them.

**1. Rewards are a list of rows.** A contest carries as many reward rows as the
team adds, and a row is either something you do ("three in-feed videos, $250") or
a place you finish in ("first, $500"). One contest may mix both kinds. A contest
with one row and a contest with six rows must both look deliberate, and a ranked
contest and a task contest must not need two different screens. The mock data is
shaped exactly this way.

**2. Contest money is its own pot**, not a draw against the brand's existing offer
budget. So a brand's screen carries **two money figures side by side**, each
labelled for what it is, never merged and never quietly leaving one out. The
eighty percent warning on the offer budget bar goes on meaning offers only, and
has to say so. That is something to design, not something to explore.

**3. A barred creator never sees the contest at all.** It is absent from their
catalogue and from every screen they can reach, so there is no barred state to
draw on the creator side and no copy to write for one. Exclusion is visible only
to the team: a request fired straight at our API is refused with a deliberately
vague sentence, recorded, and surfaced as a blocked attempt. There was no button
for them to press, so the team's view of that attempt must not imply there was
one.

**4. Contest work is filed through its own path.** Contest deliverables do not
travel down the offers pipeline; they have their own submission and their own
review. Two things come with that and both are requirements. A creator must never
have two places to go to post a video: wherever they file work, contest entries
and offer jobs sit together in one route. And the team's two review queues must
read as **one job with a filter**, not two unrelated screens. Wherever a number
tells somebody they still owe two videos, there must be a way to file one from
there. A count with no route to act on it is decoration.

**5. A contest may carry a banner image, and most will not.** Somebody on the
team uploads it inside the setup form. There is no URL to paste. It is optional
on every contest, our database is empty, and the owner's first contests will have
none, so a contest with no banner is the normal case and every screen has to look
deliberate without one rather than look like a missing image. It belongs where a
contest is being sold: the contest's own screen, and the top of the entry panel.
In a list somebody thumbs through it is smaller or absent, at the same crop and
never full bleed,
because the whole argument for scanning six contests deep dies if each one takes
the screen. **Words never sit on top of it without a solid scrim**, and we would
rather it were a band with the words below it on a solid surface, because our
contrast script cannot read text over a photograph and that is the one place an
unreadable screen could ship without failing the build. The crop is fixed and
decision 8 settles it.

**6. Entry is irreversible, and nobody can take somebody out.** The bar list is
set when a contest is created and may still be edited later, but editing it only
ever stops new people getting in. It never touches anybody already in. **There is
no action anywhere, on either side, that removes a creator from a contest they
have joined**, so do not draw one: no remove, no eject, no undoing an approval,
not even a deliberate confirmed one. A creator leaving under their own hand still
exists and stays. The owner accepted the consequence on 13 August 2026 with his
eyes open: if somebody behaves badly mid contest, the levers left are rejecting
their work so it never completes and awarding them nothing at settlement, plus
cancelling the whole contest, which is deliberately blunt and hits everybody.

**7. No creator ever sees anything about another entrant.** Not a handle, not a
name, not a headcount, not "14 have entered", not how many have been approved,
not a position in a field. There is no standing to publish, so there is nothing
to draw and no hole in a layout where one used to go. The single thing a creator
sees about the rest of it is their own placing at the end, because a placing is
their own result and names nobody, so "you placed 5th" stays and every entrant
gets one, not only the paid ones. What takes the place of a field of rivals is a
private target the creator sets for themselves, described in direction 4.

**8. The banner sits inside the reading column, at a fixed 3 to 1.** One crop
everywhere it appears, never full bleed and never a wider strip on a big screen,
so one contest can never be twice the height of the next when somebody is
thumbing down a list. The space is held before the picture arrives so nothing
jumps, and the upload control in the setup form shows the person filling it in
exactly the crop the creator will see.

One hard fact stands behind decision 1. **We have no sales, GMV or view data
anywhere in this product yet.** So a ranked contest today is measured by a
sentence a human writes ("most approved videos by the deadline") and the placings
are decided by a person at the end, with each creator told their own and nobody
else's. Do not design a live scoreboard fed by numbers, because we would have to
fake it. Instead show us how a ranked contest stays motivating with no live
scoreboard at all, and separately what it becomes the day a real measure exists.

## Every screen, every state

We need screen times state times viewer, not screens. States are the job here,
not an appendix, and they are where designs usually fail. Deliver a states index
that names every cell and marks it delivered or deliberately skipped. Missing
cells are fine if you say so. Silently missing cells are what cost us trust last
time.

**Every surface, both audiences, needs:**

- **Loading.** A skeleton shaped like the content that is about to arrive, so
  nothing jumps. Never a spinner.
- **Error.** It would not load. Plain, calm, no jargon, says what failed, offers
  the way back.
- **Empty because nothing exists yet.** Our development database is deliberately
  empty right now, so an empty state is literally the first thing the owner will
  see of this feature. It is a screen, not a fallback. Write it properly.
- **Empty because a filter matched nothing.** Different fact, different fix,
  different copy. It must not look like the state above.

**Creator side, additionally:**

- **Locked.** Somebody signed in but not yet an approved creator can reach these
  screens on purpose. They must see "not yet" in a way that reads as deliberate,
  never a broken page and never a working button that will refuse them.
- **Open, never entered.** The default, and the one that has to sell it in four
  seconds. Draw it twice, once with a banner and once without, because most
  contests will have none and that version is the one shipping first.
- **Waiting.** A held place, not a void.
- **In, nothing delivered yet.**
- **In, part delivered.** The requirement might be 1 or might be 40, so do not
  draw one segment per unit.
- **Delivered, waiting on the outcome.**
- **Not accepted**, with the team's note, and a route back in while it is open.
- **Closed to new entries while I am in it.** My work is untouched. Nothing may
  vanish.
- **Ended while I am in it.** Same again, and the deadline has to stop being the
  loudest thing on the screen.
- **Ended and I never entered.** Should it even be visible? Show us your call.
- **Settled and I won something.**
- **Settled and I did not.** Design this one properly. It is the state most
  likely to be skipped and it is the one a real person actually feels. It has to
  leave them wanting to enter the next one.

**Team side, additionally:**

- **A contest with nobody in it yet.**
- **A contest with people waiting on a decision.** This is the working state and
  it should be the loudest thing on the screen.
- **A contest that has ended with people still waiting on a decision.** A mess we
  need to be able to see and clear.
- **A settled contest**, read only, obviously finished.
- **A contest that cannot be deleted** because people are in it, with the reason
  in words rather than a dead button.
- **A blocked attempt by a barred creator**, surfacing somewhere the team will
  actually look. The owner asked for this by name. It was refused server side, so
  do not draw it as somebody having pressed something.
- **A brand's two money figures side by side**, offer money and contest money,
  each labelled, never added into one.
- **Two currencies side by side**, proving nothing adds them together.

## The entry moment, as an interaction

The owner asked for this specifically: tapping to enter should open something
beautiful. This is the centrepiece of the feature. We want a motion brief, not a
layout. Give us plain language for the feel, numbers for the build, and frames or
a prototype.

**Before the tap.** The action already has to say what will happen. An instant
contest and a reviewed contest cannot use the same button words. Nobody should
learn "actually a person has to approve this" from a panel that appears after
they committed.

**Acknowledging the finger.** Say what responds to the touch before anything else
has happened.

**Opening, about 220ms.** The panel arrives, rising roughly 16px as it fades in,
on our curve `cubic-bezier(0.22, 1, 0.36, 1)`. The scrim washes in over the same
time. What must stay perfectly still is the page behind: no scale, no push, no
parallax. On a phone this is a sheet from the bottom edge; from tablet up it is
centred. A tall panel scrolls inside itself; the page behind never scrolls.
Describe the easing in words as well as numbers ("overshoots slightly and
settles", "arrives fast and stops dead"), because the described feel is what we
will build to.

**Inside.** If the contest has a banner it sits at the top of this panel, and if
it does not the panel still has to open like something worth opening. Restate
exactly what they are agreeing to, in the frozen numbers they
will be held to: what to deliver, what it pays, when it closes, which products,
the brief link. This restatement is not decoration. It is the last honest moment
before somebody commits their week, and if they later find the terms were
different from what they thought, our whole promise is dead. If you think an
optional note to the team belongs here, make the case.

**The tap that commits.** The round trip is usually about 300ms and can be two
seconds when our backend is cold. Design an honest 0 to 2 second wait that does
not claim success, and make the action unavailable while it is in flight, because
a double tap must not enter twice.

**Success, instant contest.** This should be the most satisfying two hundred
milliseconds in the product, and it is one tap from an ordinary list, so anything
enormous will be tiring by the third contest. Find the level. They must not have
to go looking for proof it worked. We own a confetti component already, used when
somebody is approved onto the platform; use it here only if you can argue that
taking on work deserves the same celebration as being let in, and we suspect it
does not.

**Success, reviewed contest.** The answer is not coming now and nothing may imply
it might. Say who decides, say the answer lands here, and change the state behind
the panel to waiting before the panel is gone, so closing it does not feel like
nothing happened. Tell us what they see if they come back tomorrow and it is
still waiting, and whether the screen should say how long decisions normally take.

**Failure.** Four real ones: already entered, the contest closed while the panel
was open, not an approved creator yet, network. Barred is not on that list and
never will be, because a barred creator never reaches this panel. Each gets a
sentence a human understands, announced to assistive tech, with the action
returning to its
resting label. **The panel never closes on failure and never reports a success it
did not get.** We learned this the expensive way elsewhere: a cheerful success
for something the server refused is far worse than a refusal, because the creator
goes off and films for nothing.

**A decision arriving live while somebody is looking.** An admin approves an
entry and the creator has that screen open right now. Specify:

- Exactly one row changes, plus the money figure it affects. Nothing else moves.
- What must not move under a reading eye: scroll position, focus, any open panel,
  any half filled field, and the order of the list. If the change means the row
  now belongs elsewhere in the order, hold it in place while it is announced,
  then move it once in a single settled transition of about 420ms, after the
  announcement is over. Never announce and reorder in the same beat.
- It should be noticeable from across a room without the creator having been
  staring at the right pixel, and it must never fire on first page load, or
  people learn to ignore it.
- It is announced politely to a screen reader, not only drawn, and it never
  steals focus.

Our existing vocabulary for "this just changed", which you may keep, replace or
extend: a soft ring pulses out from the edge of a changed card twice over about
1.6 seconds; a figure that changed lifts a few pixels and settles over about
620ms without counting up, because the number is already right and what it needs
to say is "this moved"; a newly arrived row rises about 6px and settles over
560ms. The whole event is over inside about 2.6 seconds and then the screen is
completely still again. Persistent movement is reserved for exactly one thing, a
slow pulse meaning the connection is live.

**Reduced motion.** Every animation above needs an honest alternative, including
the celebration and the live arrival. Not "no animation": a version that still
carries the news, with something that stays on screen. Motion must never be the
only carrier of a change.

Focus behaviour inside the panel is part of this brief, not a later pass. See the
accessibility section.

## The setup form, which is long and must not feel long

Frame the whole team side this way: nothing on it exists for its own sake, it
exists so a creator gets a clean, fast, honest answer.

The form carries a name, the brand it belongs to, a description, a deadline as a
date and a time, whether entry is instant or reviewed, active or not, the
products it covers (chosen from products already added to that brand), a link to
a content brief, a total budget, a list of reward rows where each row is a thing
to do or a place to finish with an amount against it, an optional banner image
the team uploads, and a list of people to bar by handle or email.

That is a lot, and it is filled in by somebody with three other tabs open.
**Solve the length rather than accepting it.** We are not asking for a wizard by
default; we are asking for whatever means the person never feels the length.
Progressive disclosure, steps, two columns with a live preview of what the
creator will see, defaults that make most contests three fields and a button,
grouping by what creators see against what only we see: your call, but somebody
setting up their fourth contest of the week should be done in under a minute and
somebody setting up their first should never be lost. Show what it does when they
are halfway through and get interrupted.

Two controls have no precedent anywhere in our product and must be designed from
scratch, because we have no component library at all and a bare browser control
on a near black panel looks broken: a **date and time control**, and a **multiple
product picker**.

The **banner upload** is the third thing to design here, and it is a thing to
design rather than a spec. It behaves like the uploads we already have for brand
logos and product images: pick a file, see it, replace it, take it away again.
What it takes is a PNG, a JPEG or a WebP up to 2 MB, and never an SVG, because an
SVG can carry script. The store behind it is publicly readable by anybody holding
the address, so nothing commercial may appear in the artwork, and the person
filling the form has to be told that where they are choosing the picture.
Most contests will not have one, so show us the control at rest with nothing in
it, mid upload, holding a picture, and refusing a file it will not take, and show
us how the person filling the form can tell what the creator will actually see.

Four things in this form are not taste:

- **The deadline is a real instant, not a day.** Our creators are in the US and
  the UK and our team is in one place. The person setting it has to know which
  clock they are setting, and the creator reading it has to know which clock is
  closing on them.
- **The budget is admin only, permanently.** Not because we are squeamish: a
  creator physically cannot read it. Make it visually obvious which fields
  creators will see and which are internal, so the person filling it in knows
  without being told. It is also its own pot, so the form should make clear that
  this money is not coming out of the brand's offer budget.
- **The bar list names a person**, which is a slightly uncomfortable act. Make it
  deliberate rather than casual, show who is currently barred, and let somebody
  be taken off the list again. Say plainly what barring does and what it does
  not: the contest disappears for that person rather than telling them anything,
  and it only stops people getting in. Barring somebody who is already in the
  contest does nothing to them, so the form must never read as a way to take a
  competitor out.
- **Some fields stop being editable once anybody is in**, because editing them
  would rewrite a promise already made to a named person. Design what a locked
  field looks like and how the form says why, in words, rather than just going
  grey.

## The two dashboards

**The creator's** answers three things: which contests am I in, what do I still
owe on each, and what am I owed. Money on a creator's screen already belongs to
three buckets everywhere else in this product: paid, awaiting payment, in
progress, and those three add up to the total agreed. Contest money does not join
that total. It is its own clearly labelled block, because a contest can be in a
currency the rest of that sum is not, and that sum is supposed to close. Do not
quietly add a fourth thing into it. It is also one of the places contest work gets
filed, sitting beside offer jobs in the same route, because a creator never has
two places to post.

**The team's** answers: who applied, when, what state they are in, what has been
delivered, and what it will cost. It needs a decision queue where "waiting on me"
is impossible to miss and fifteen applicants can be worked through without the
screen fighting back. Decisions carry a note the creator reads, and a rejection
probably wants the option to stop that person entering again, which makes the
contest vanish for them rather than telling them anything. It shows the frozen
per person figure, never the contest's price today. Spend is split by currency,
and where a brand's money is shown it is two labelled figures, offer money and
contest money, never one. Blocked attempts surface here. Reviewing contest work
and reviewing offer work is one queue with a filter, not two screens, so design
the filter as part of the queue rather than a second destination.

One thing this queue must not have, and it is decision 6: **no way to take
somebody out of a contest they are in.** Barring stops new entries only, anybody
already competing stays, and there is no separate deliberate action behind a
confirmation either. A row for somebody who is in offers a decision, a note and a
route to their work, and nothing that ends their entry.

Both dashboards grow. Assume hundreds of entries eventually and design so paging
or progressive loading does not look bolted on afterwards.

Three layout rules the owner repeats, which apply to every team screen you draw:

- **The work starts high.** Headers stay compact. He should never scroll past a
  summary to reach the thing he came to do, and on a record with tabs the default
  tab is the job, not the summary.
- **Reference data lives in its own Overview area**, not stacked above the work.
- **The main area is left aligned against the sidebar with a maximum width**,
  never centred, or zooming out leaves a gap that reads as a broken page.

And one that applies everywhere: **never show a slug, an internal id or a route
to anybody**, on either side. The one exception is a real business identifier
such as a TikTok Shop store id.

## Where we want more than one direction

We were once handed a design with two directions for a screen, built one, and
were not told about the other. The owner found it himself. That cost trust, not
just time. So the rule for this engagement is:

**Every direction you explore is delivered, or is explicitly named in your
handover as considered and skipped, with one line on why. Nothing is quietly
dropped.**

At least two directions on each of these, unless the item says otherwise:

1. **How a creator first meets a contest.** A card in a list among everything
   else, an event with weight and a countdown, a poster, something that takes
   over the screen. A contest is not an offer. It is an event with a deadline and
   an unseen rival in it. See whether the design can carry that.
2. **The one contest screen for a creator.** The point of view, not the
   furniture: what it argues is the most important thing on the page.
3. **The waiting state under review.** The hardest emotional state in the
   feature.
4. **The competing state**, and this is the one item here we want a single
   direction on, because decision 7 ruled the alternative out. A creator can be
   told nothing at all about the other entrants, so the screen has to motivate
   using only their own progress against their own goal. It is what we are
   shipping, so give it real effort rather than treating it as the degraded case.
   It needs one thing we do not own yet: **a target the creator sets for
   themselves.** One number, "I am going for six videos", chosen by them, private
   to them, never compared with anybody and never a thing the screen ranks. Show
   us setting one, changing one, having none, and passing one.
5. **How the entry panel resolves on instant success.** One direction where the
   panel becomes the thing they now own, in place. One where it leaves and the
   screen behind it has already changed. Argue which is better and why.
6. **The setup form.** Two structurally different answers to "a long form that
   does not feel long".

## The materials

This is the only section that gives exact values, and it is here because visual
consistency is non negotiable and a script in our build fails the deploy if a
colour is not one of these. Materials are not a design. No layout, section order,
copy or component structure is prescribed anywhere in this brief.

### What we build in

React 19 with TypeScript, Tailwind CSS v4, Motion (`motion/react`) for animation,
lucide-react for icons. **No chart library, and no component library at all.** No
Radix, no shadcn, no MUI. Our entire shared UI folder is a `Button` and a `Field`;
every dialog, tab strip, badge, menu, tooltip and picker in this product is hand
built. So anything you specify has to be buildable from your spec by hand, and
anything you would normally take for granted from a kit is something we will draw
from scratch. Static typed mock data, no data fetching.

One icon clash to resolve rather than inherit: `Trophy` is already used for a
creator facing Leaderboards item in our sidebar, and the team side currently uses
`Trophy` for Contests. Propose how you want to fix that rather than shipping one
icon meaning two things.

### Colour

Every colour is a token. Both a dark and a light value must exist for every token
or the build fails, and every foreground must clear WCAG AA against the surface
it actually sits on, in both themes. **Dark and light are equal citizens.**
Neither is the real one.

| Role | Token | Dark | Light |
| --- | --- | --- | --- |
| Page | `--wx-bg` | `#100e0c` | `#f6f4f1` |
| Cards, panels | `--wx-surface-1` | `#1a1714` | `#ffffff` |
| Hover, nested cards | `--wx-surface-2` | `#221e1a` | `#f0ede8` |
| Wells, inputs | `--wx-surface-3` | `#2a251f` | `#e8e3da` |
| Text | `--wx-text` | `#f4f0ea` | `#191512` |
| Muted text | `--wx-text-muted` | `#9d9387` | `#736a61` |
| Faint text | `--wx-text-faint` | `#8a8175` | `#766d63` |
| Inverse text | `--wx-text-inverse` | `#100e0c` | `#f6f4f1` |
| Border, decorative | `--wx-border` | `#2c2721` | `#e3ded6` |
| Border, strong | `--wx-border-strong` | `#3d3730` | `#d2ccc1` |
| Border, interactive | `--wx-border-interactive` | `#6e675c` | `#8f8474` |
| Accent | `--wx-accent` | `#c8924b` | `#8a5f1f` |
| Accent hover, active | `--wx-accent-hover` `-active` | `#d8a35e` `#b8823b` | `#6f4c18` `#5c3f14` |
| On accent | `--wx-on-accent` | `#100e0c` | `#ffffff` |
| Success | `--wx-success` | `#3ecf8e` | `#0f7a43` |
| Danger | `--wx-danger` | `#f06a6a` | `#b02424` |
| Warning | `--wx-warning` | `#f0b429` | `#8a6410` |
| Info | `--wx-info` | `#5cb8e8` | `#186d92` |
| Reserved, in progress | `--wx-stage-live` | `#8ea0ff` | `#4e56d3` |
| Reserved, awaiting payment | `--wx-stage-due` | `#f5ae4b` | `#9f5b00` |
| Reserved, paid | `--wx-stage-paid` | `#5bcc80` | `#007c3a` |

The accent is the Wurx gold from wurxmedia.com. Light mode darkens it because the
raw brand gold is only 2.58:1 on paper. Semantic colours are for status only.
There are translucent `-soft` variants of the accent, the semantics and the three
reserved colours.

Four rules about that table:

- **The last three are reserved vocabulary.** They are the only thing in the whole
  product allowed to say where money or work has got to: indigo still moving,
  amber about to be yours, green in your account. **An entry state is exactly
  that**, so use them there and read this line as permission: waiting, in and
  delivered are precisely where one named person's work and money have got to,
  which is what these three say. What they may never be borrowed for is a rank, a
  countdown, **the contest's own lifecycle state** (open, closed to new entries,
  ended, settled), or anything decorative. Those four, and nothing else, are the
  ban. An earlier draft of this brief wrote "a contest state" without saying
  which kind of state it meant, and the designer reasonably read it as covering
  an entry state too. It never did: an entry state is one named person's work
  and money, which is what these tokens are for, while a contest's own state is
  a property of the event and still may not borrow them. They are deliberately not
  accent, warning and success, which is the obvious pick and unreadable: in light
  mode our gold `#8a5f1f` and our warning amber `#8a6410` are within a hair of
  each other, and two thirds of a money bar once looked like one solid block.
- **Do not put faint text on a nested card.** In light mode `--wx-text-faint` on
  `--wx-surface-2` measures about 4.3:1 and fails AA, and our guard deliberately
  does not catch it. Small quiet text on a card inside a card uses the muted
  value.
- **Translucent values are unverified by the guard.** If you invent a soft tint,
  name every surface it sits on.
- **If contests need colours we do not have, propose them as new tokens**, with a
  dark value, a light value, the surfaces they sit on and the contrast ratios. A
  ranked contest almost certainly needs a rank ramp we do not own, and so does
  anything urgent about a deadline. Light mode is where these die. Give us the
  values and we will run them through the guard.

### Type

Two self hosted variable faces, weights 400 to 700.

- **Sora** is the display face: all headings and every large figure. Headings run
  tight, weight 700, letter spacing about `-0.025em`, line height near 1.08,
  balanced wrapping.
- **Instrument Sans** is everything else.
- Small uppercase labels are sans, not mono: about 11px, semibold, letter spacing
  `0.14em`, uppercase, in muted text. There is a legacy mono label style lurking
  in older screens; ignore it, it is being retired.
- Numbers: tabular figures for columns that must line up between rows, and lining
  proportional figures for large animated figures, because a tabular comma renders
  at full digit width and turns "$48,920" into something with gaps in it.

### Motion

One easing curve for the entire product, `cubic-bezier(0.22, 1, 0.36, 1)`, and
three durations: 140ms for a hover or a small state flip, 240ms for a panel, 420ms
for something structural. You may exceed these for a deliberate moment (our
celebration and flash animations run 560ms to 1.6s), but that is the everyday
vocabulary. List entrances rise about 10px over 300ms with a 40ms stagger capped
after six items, so a long list never feels like it is dealing cards. Bars grow
from zero over about 900ms. Skeletons sweep rather than pulse, because a pulse on
a near black card reads as a slow flash.

Other non colour tokens: radii 6 / 10 / 16 / 24px and a pill, container maximum
1280px, gutter 1.5rem.

## Truths that cannot bend

These are about correctness, not taste. Breaking one is a bug we cannot ship.

1. **A creator can never see the contest budget or anything computed from it.**
   Not the total, not the spend, not a percentage, not a "62% funded" bar, not a
   "spots remaining because the money ran out" hint. All of those are arithmetic
   on a number they must not have.
2. **A creator can never see another creator's money, terms, handle or email**
   through their own screens. There is no version of this feature where entrants
   are shown to each other, so nothing to flag and nothing to rule on.
3. **There is no number about other entrants to draw.** "14 have entered" and
   "you are 3rd of 20" are not free reads for us, done naively our database would
   hand a creator the number 1 with no error and the screen would render it as
   truth, and the owner has now ruled that no such number reaches a creator
   anyway. Design as though they do not exist, because they do not. A creator's
   own placing is not one of these: it is their own result and it names nobody.
   Nor is their own private target, which nobody else can read either.
4. **Money is never summed across currencies.**
5. **What was agreed is frozen at the moment it was agreed.** A creator approved
   for $250 on Monday still sees and is still owed $250 after an admin edits the
   contest on Tuesday. Their numbers come from their own record and must never
   look like they could move under them.
6. **Closing or expiring stops new entries only.** It never hides, voids or stops
   paying work already under way. Editing the bar list is the same: it stops new
   entries and never touches anybody already in, and no other action takes an
   entrant out either.
7. **A barred creator never sees the contest, and any attempt they still make is
   refused and recorded.** The refusal happens at our API, in a deliberately vague
   sentence, because there is no button for them to press. Never a silent success.
   The team sees the blocked attempt.
8. **Hiding a control is never our security.** Hide things for clarity if you
   like, but never present a hidden button as the reason something is safe. The
   database is the boundary.

## Accessibility, with the defects we actually shipped

An adversarial review of an earlier step found eight real defects in our own
work. These are the ones to design against, by name.

- **Explanations that only exist on hover.** We shipped disabled tabs whose only
  explanation was a `title` attribute. On a phone that is four grey pills with no
  explanation at all, and by keyboard it is nothing. Contests will have plenty of
  unavailable states. Anything reachable only by hover needs a tap equivalent and
  a visible equivalent.
- **Contrast that passed on the page and failed on a card.** Check foregrounds
  against the surface they actually land on, not the page background.
- **Tap targets of 16px in a dense queue.** Minimum 44 by 44 for anything anybody
  can tap, including state chips, filter tabs and icon only controls. If two small
  controls sit near each other, say how far apart.
- **No keyboard route into a row menu, and no focus handling on a dialog or a
  drawer.** So: focus moves into the panel when it opens, to the first meaningful
  control rather than the close button, is trapped while it is open, Escape closes
  it, and focus **returns to the control that opened it**. Say what happens to
  focus if a decision arrives live while the panel is open.
- **Widths that were fine until you opened something on them.** Our width checks
  missed modals for months. Your entry panel, your setup form and your settle
  confirmation each get checked independently at every width.

Also required:

- **Keyboard routes for everything**, including the product picker, the date and
  time control, the entrant queue and any row level actions.
- **Announcements.** State what a screen reader hears when an entry succeeds, when
  it is refused, and when a decision arrives with no user action.
- **Colour is never the only signal.** Every state, rank and deadline must survive
  being read in greyscale.
- **Long unbroken strings** (handles, emails, URLs) must never set a minimum width
  for a whole grid. Assume a thirty character handle.

## Responsive at four widths

Every screen and every panel, team screens included, at roughly **375, 768, 1024
and 1440**. Creators are mostly at the small end. The team is mostly at 1440 and
also uses these screens on a phone.

- **No horizontal page scroll at any width, ever.** Wide things scroll inside
  their own container.
- **Tables become stacked cards on narrow screens** rather than shrinking or
  scrolling sideways. The entrant queue is the obvious case. Do not hand us a
  horizontally scrolling table and call it responsive.
- Anything hover only needs a tap equivalent, as above.

## The data to design against

Two worlds, deliberately separate, plus the brand money block that only the team
sees. The creator data contains no budget, no spend, no other creator and no
barred entry. That is not an omission for you to fill in, it is the security
model. All amounts inside one contest share one currency. Several fields are
deliberately null: do not print a zero where nobody has set a number, and do not
invent artwork where `bannerUrl` is null, because that is most of them.

```ts
// ---------- WHAT A CREATOR CAN SEE ----------

export const me = { displayName: 'Maya Ellison', handle: 'mayaonmain', tier: 'Rising', approved: true };

// A reward row is either something you do, or a place you finish in.
// A contest can carry any mix, one row or many.
type RewardRow =
  | { id: string; kind: 'do'; what: string; count: number | null; pays: number | null }
  | { id: string; kind: 'place'; place: 1 | 2 | 3 | 4 | 5; pays: number | null };

type MyEntry = {
  state: 'waiting' | 'in' | 'delivered' | 'notAccepted' | 'withdrawn';  // never 'barred'
  enteredAt: string | null;
  decidedAt: string | null;
  note: string | null;          // the team's words, shown to them
  frozen: RewardRow[];          // what THEY were promised, never re-read from the contest
  delivered: number;            // approved videos so far
  awaitingReview: number;
  needsAnotherTake: number;
  required: number | null;
  target?: number | null;       // they set this for themselves. Nobody else can read it, us included
  result?: { placed: number | null; won: boolean; awarded: number | null };
};

export const contests = [
  {
    id: 'c1', brandName: 'Vitauthority', brandLogoUrl: '/vit.png',
    name: 'August hero push',
    bannerUrl: '/banners/vitauthority-august.jpg',   // 3 to 1, uploaded by the team
    description: 'Three in-feed videos featuring the hero product before the end of the month. Hook in the first two seconds, no before-and-after claims.',
    briefUrl: 'https://example.com/briefs/vitauthority-august',
    closesAt: '2026-08-31T23:59:00+01:00', entry: 'instant', status: 'open', currency: 'USD',
    products: [
      { name: 'Multi Collagen Burn, 30 servings', imageUrl: '/p1.jpg', price: 34.99, commission: 25 },
      { name: 'Lean Bliss Greens, 30 servings', imageUrl: null, price: null, commission: null },
    ],
    rewards: [{ id: 'r1', kind: 'do', what: 'in-feed video', count: 3, pays: 250 }] as RewardRow[],
    myEntry: { state: 'in', enteredAt: '2026-08-04', decidedAt: '2026-08-04', note: null,
      frozen: [{ id: 'r1', kind: 'do', what: 'in-feed video', count: 3, pays: 250 }],
      delivered: 1, awaitingReview: 1, needsAnotherTake: 0, required: 3, target: 6 },
  },
  {
    id: 'c2', brandName: 'BruMate', brandLogoUrl: null,
    name: 'Summer sprint',
    bannerUrl: null,                                 // no banner, and this is the usual case
    description: 'A ranked sprint. The team counts approved videos at the deadline and tells each creator their own placing. Outdoors footage only.',
    briefUrl: 'https://example.com/briefs/brumate-summer',
    closesAt: '2026-09-14T23:59:00+01:00', entry: 'reviewed', status: 'open', currency: 'USD',
    measuredBy: 'Most approved videos by the deadline',   // a sentence, not a live number
    products: [{ name: 'Hopsulator Trio, 16 oz', imageUrl: '/p3.jpg', price: 29.99, commission: 18 }],
    rewards: [
      { id: 'r2', kind: 'place', place: 1, pays: 500 },
      { id: 'r3', kind: 'place', place: 2, pays: 250 },
      { id: 'r4', kind: 'place', place: 3, pays: 100 },
    ] as RewardRow[],
    myEntry: { state: 'waiting', enteredAt: '2026-08-11', decidedAt: null, note: null,
      frozen: [], delivered: 0, awaitingReview: 0, needsAnotherTake: 0, required: null },
  },
  {
    id: 'c3', brandName: 'Physicians Choice', brandLogoUrl: null,
    name: 'Gut health story month', bannerUrl: null,
    description: 'Five videos telling one story across the month.',
    briefUrl: null,                                   // no brief written yet
    closesAt: '2026-08-09T23:59:00+01:00',            // ALREADY PASSED
    entry: 'reviewed', status: 'ended', currency: 'USD',
    products: [],                                     // this brand has listed nothing yet
    rewards: [{ id: 'r5', kind: 'do', what: 'video', count: 5, pays: 400 }] as RewardRow[],
    myEntry: { state: 'in', enteredAt: '2026-07-20', decidedAt: '2026-07-21', note: null,
      frozen: [{ id: 'r5', kind: 'do', what: 'video', count: 5, pays: 400 }],
      delivered: 4, awaitingReview: 0, needsAnotherTake: 1, required: 5, target: null },  // no target set
  },
  {
    id: 'c4', brandName: 'Skin by Amara', brandLogoUrl: null,
    name: 'Spring sprint',
    bannerUrl: '/banners/amara-spring.jpg',          // a settled contest that has one
    description: 'Ranked launch sprint, now finished. Top three paid.',
    briefUrl: 'https://example.com/briefs/amara-spring',
    closesAt: '2026-06-30T23:59:00+01:00', entry: 'instant', status: 'settled', currency: 'GBP',
    measuredBy: 'Most approved videos by the deadline',
    products: [{ name: 'Barrier Cream, 50ml', imageUrl: '/p4.jpg', price: 22.0, commission: 18 }],
    rewards: [
      { id: 'r6', kind: 'place', place: 1, pays: 1000 },
      { id: 'r7', kind: 'place', place: 2, pays: 500 },
      { id: 'r8', kind: 'place', place: 3, pays: 250 },
    ] as RewardRow[],
    myEntry: { state: 'delivered', enteredAt: '2026-06-02', decidedAt: '2026-06-02', note: null,
      frozen: [], delivered: 4, awaitingReview: 0, needsAnotherTake: 0, required: null,
      result: { placed: 5, won: false, awarded: null } },   // did not win, design this one.
      // Every entrant gets a placing, not only the paid ones, and it is their own. It names nobody
      // and it never comes with a field size next to it.
  },
  {
    id: 'c5', brandName: 'Bentgo', brandLogoUrl: null,
    name: 'Back to school', bannerUrl: null,
    description: 'Four videos before the end of August, parent facing.',
    briefUrl: 'https://example.com/briefs/bentgo-bts',
    closesAt: '2026-08-28T23:59:00+01:00', entry: 'reviewed', status: 'open', currency: 'USD',
    products: [{ name: 'Leakproof Lunchbox, 4 compartment', imageUrl: null, price: 39.99, commission: 15 }],
    rewards: [{ id: 'r9', kind: 'do', what: 'video', count: 4, pays: null }] as RewardRow[],  // amount not set
    myEntry: { state: 'notAccepted', enteredAt: '2026-08-01', decidedAt: '2026-08-03',
      note: 'We have filled this one for now. Come back for the winter push.',
      frozen: [], delivered: 0, awaitingReview: 0, needsAnotherTake: 0, required: null },
  },
  {
    id: 'c6', brandName: 'BruMate', brandLogoUrl: null,
    name: 'Autumn colourways',
    bannerUrl: '/banners/brumate-autumn.jpg',        // never entered, and it has artwork to sell it
    description: 'Two videos for the autumn range.',
    briefUrl: 'https://example.com/briefs/brumate-autumn',
    closesAt: '2026-10-01T23:59:00+01:00', entry: 'instant', status: 'open', currency: 'USD',
    products: [{ name: 'Era Tumbler, 25 oz', imageUrl: '/p5.jpg', price: 34.0, commission: 18 }],
    rewards: [{ id: 'r10', kind: 'do', what: 'video', count: 2, pays: 150 }] as RewardRow[],
    myEntry: null,                                   // never entered, the state that has to sell it
  },
  {
    id: 'c7', brandName: 'Northwind Supply', brandLogoUrl: null,
    name: 'Restock rush', bannerUrl: null,
    description: 'One video, one product.',
    briefUrl: null, closesAt: '2026-09-01T23:59:00-07:00',
    entry: 'reviewed', status: 'open', currency: 'USD',
    products: [{ name: 'Trail Bottle 1L', imageUrl: null, price: 18.5, commission: 12 }],
    rewards: [
      { id: 'r11', kind: 'do', what: 'video', count: 1, pays: 90 },
      { id: 'r12', kind: 'place', place: 1, pays: 300 },   // one contest, both kinds of row
    ] as RewardRow[],
    myEntry: null,
  },
  // No barred entry here, ever. A contest somebody is barred from never arrives.
];

// ---------- WHAT THE TEAM CAN SEE, AND ONLY THE TEAM ----------

export const teamContests = [
  {
    id: 'c1', brandName: 'Vitauthority', name: 'August hero push', status: 'open',
    entry: 'instant', closesAt: '2026-08-31T23:59:00+01:00', currency: 'USD',
    bannerUrl: '/banners/vitauthority-august.jpg',
    budget: 4000, committed: 1250,          // committed = frozen promises to named people
    waitingOnMe: 0,
    delivered: { approved: 14, awaitingReview: 3, promised: 27 },
    entrants: [
      { handle: 'mayaonmain', name: 'Maya Ellison', email: 'maya@example.com', state: 'in',
        enteredAt: '2026-08-04', decidedAt: '2026-08-04', frozenPays: 250, delivered: 1, required: 3,
        lastActivityAt: '2026-08-10' },
      { handle: 'jaycreates', name: null, email: 'jay@example.com', state: 'in',
        enteredAt: '2026-08-05', decidedAt: '2026-08-05', frozenPays: 250, delivered: 3, required: 3,
        lastActivityAt: '2026-08-11' },
      { handle: 'nataliehomeandgardenstudio', name: 'Natalie Okafor', email: 'nat@example.com',
        state: 'withdrawn', enteredAt: '2026-08-02', decidedAt: '2026-08-06', frozenPays: 250,
        delivered: 0, required: 3, lastActivityAt: '2026-08-06' },
    ],
    barred: [], barredAttempts: [],
  },
  {
    id: 'c2', brandName: 'BruMate', name: 'Summer sprint', status: 'open',
    entry: 'reviewed', closesAt: '2026-09-14T23:59:00+01:00', currency: 'USD',
    budget: 2500, committed: 0,
    waitingOnMe: 7,                          // the number this screen exists for
    delivered: { approved: 0, awaitingReview: 0, promised: 0 },
    entrants: [
      { handle: 'mayaonmain', name: 'Maya Ellison', email: 'maya@example.com', state: 'waiting',
        enteredAt: '2026-08-11', decidedAt: null, frozenPays: null, delivered: 0, required: null,
        lastActivityAt: null },
      { handle: 'dre.films', name: 'Andre Bell', email: 'dre@example.com', state: 'waiting',
        enteredAt: '2026-08-11', decidedAt: null, frozenPays: null, delivered: 0, required: null,
        lastActivityAt: null },
    ],
    barred: [{ handle: 'coldcallkev', email: null, addedAt: '2026-08-07' }],
    barredAttempts: [{ handle: 'coldcallkev', at: '2026-08-10T19:04:00+01:00' }],
  },
  {
    id: 'c3', brandName: 'Physicians Choice', name: 'Gut health story month', status: 'ended',
    entry: 'reviewed', closesAt: '2026-08-09T23:59:00+01:00', currency: 'USD',
    budget: 3000, committed: 1600,
    waitingOnMe: 2,                          // ended, and people still waiting. Make this mess visible.
    delivered: { approved: 6, awaitingReview: 2, promised: 20 },
    entrants: [], barred: [], barredAttempts: [],
  },
  {
    id: 'c7', brandName: 'Bentgo UK', name: 'Autumn term', status: 'open',
    entry: 'instant', closesAt: '2026-10-12T23:59:00+01:00', currency: 'GBP',  // never add this to the USD figures
    budget: 1800, committed: 600, waitingOnMe: 0,
    delivered: { approved: 2, awaitingReview: 0, promised: 8 },
    entrants: [], barred: [], barredAttempts: [],
  },
  {
    id: 'c8', brandName: 'BruMate', name: 'Winter gifting', status: 'open',
    entry: 'reviewed', closesAt: '2026-11-20T23:59:00+00:00', currency: 'USD',
    bannerUrl: null,                              // nothing uploaded, and nothing missing either
    budget: null, committed: 0, waitingOnMe: 0,   // budget not set yet
    delivered: { approved: 0, awaitingReview: 0, promised: 0 },
    entrants: [],                                 // nobody yet
    barred: [], barredAttempts: [],
  },
];

// A brand's committed money is two figures and they are never added together.
// The offer bar is the one that warns at eighty percent, and it means offers only.
export const brandMoney = [
  { brandName: 'Vitauthority', currency: 'USD',
    offers:   { budget: 20000, committed: 16800 },   // 84%, the warning is showing
    contests: { budget: 4000,  committed: 1250 } },
  { brandName: 'BruMate', currency: 'USD',
    offers:   { budget: 12000, committed: 3400 },
    contests: { budget: 2500,  committed: 0 } },
  { brandName: 'Bentgo UK', currency: 'GBP',
    offers:   { budget: 9000,  committed: 2200 },
    contests: { budget: null,  committed: 0 } },     // no contest pot set yet
];
```

## What to hand back

1. **The creator's contest surface first, on its own, before anything else.** Two
   directions, both themes, at 375 and 1440. Stop there and send it. We would
   rather agree on the point of view than receive everything at once.
2. Then the rest of the creator's surfaces, with **every state from the states
   section**, both themes, at 375, 768, 1024 and 1440 wherever the layout reflows.
   Anywhere a contest is sold, the banner and the far more common no banner
   version both, and the reserved space before the picture lands.
3. **The entry interaction as a motion spec**: plain language for the feel, frames
   or a prototype, timings and easing, all three outcomes (instant yes, reviewed
   and waiting, refused), the live decision arriving, and the reduced motion
   version of each.
4. The team's surfaces: setup form in two directions including the banner upload
   at rest, uploading, filled and refusing a file, entrant queue, the contest
   watch view, and the settle flow. Settling is a money event and is irreversible
   in practice, so design it to feel like one. It is not a checkbox on the edit
   form. Same states, same themes, same widths.
5. **A states index**: every screen against every state, marked delivered or
   deliberately skipped with a one line reason. This is the deliverable we read
   first.
6. **Any new colour tokens**, with dark value, light value, the surfaces each sits
   on, and its contrast ratios.
7. A short writeup, a page at most: what each direction is arguing, how the
   competing state stays motivating with nothing about the rest of the field in
   it, anything you explored and dropped and why, and anything in this brief you
   think is wrong.

Design files or a prototype are ideal. Static images are fine if the motion is
described well enough to build from.

## What not to do

- Do not repaint what we already have. You have not seen it on purpose. If you
  catch yourself designing something because it is what a platform like this
  usually has, design the better thing instead.
- Do not put a budget, a spend, a percentage of a budget, a client name, or
  anything you could reverse engineer them from, on any creator surface.
- Do not put another creator's handle, name or figures on a creator surface, and
  do not design an entrant count, a standing or a position in a field there at
  all. A creator's own placing at the end is theirs and is fine.
- Do not design a live scoreboard fed by sales, GMV or view counts. That data does
  not exist here yet and we will not fake it.
- Do not use the three reserved colours for anything except where work and money
  have got to. An entry state is that and may use them. A rank, a countdown, the
  contest's own lifecycle state and decoration are not and may not.
- Do not add a colour that exists in only one theme. The build fails.
- Do not put faint text on a nested card.
- Do not let a contest closing, ending or being switched off remove or hide the
  work, progress or money of somebody already in it.
- Do not design a success state for something that might have failed. A refusal
  that reads as a success is the worst thing this feature can do.
- Do not print a zero where a number nobody has set belongs.
- Do not show an internal id, a slug or a route to anybody, on either side.
- Do not reopen any of the eight decisions, and do not silently drop a direction.
  Deliver it or name it.
- Do not draw a barred state on a creator screen. There is not one.
- Do not draw any control, on any screen, that takes a creator out of a contest
  they have joined. A creator leaving by their own hand is a different thing and
  stays.
- Do not set words over a banner without a solid scrim, and do not treat a
  contest with no banner as a broken or lesser version of one that has it.
- Do not give the banner a second shape. One 3 to 1 crop inside the reading
  column, at every width and on every surface, never a full width strip.
- Do not merge a brand's offer money and contest money into one figure.
- Do not design one screen for ranked contests and a different one for task
  contests. One system, both shapes.
- Do not make hover the only way to reach or understand anything.
- Do not make motion the only carrier of a state change.
- Do not assume a component library, a date picker, a combobox, a tooltip
  primitive or a chart library. None of them exist here.
- Do not hand us a horizontally scrolling table and call it responsive.
- Do not use em dashes or en dashes anywhere, including microcopy, labels, mock
  data and your writeup. House rule.
