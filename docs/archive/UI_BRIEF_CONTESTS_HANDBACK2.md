# Contests, follow up after handback 1

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

You still have the original brief. This does not repeat it. It says what landed,
what is still outstanding, one new requirement, and one piece of work that has
been cut.

## What landed, and it was good

We have "Contests Browsing.dc.html", turn 1, handback item 1: the browsing list
in both directions, dark and light, 1440 and 375, plus empty, skeleton and
locked.

**1A, the deadline board** is the stronger of the two for us. Ordering by which
clock runs out first is the right argument, and the right hand well holding
money and deadline means the eye lands on the two things a creator decides on.
**1B, one at a time** earns its place too, and the Up next rail keeps it from
feeling like a dead end.

Four specific things you got right, and we are naming them because they are the
ones people usually miss:

- Deadlines carry their timezone. Nobody has to guess whose midnight it is.
- The closed group says work already under way carries on and still pays. That
  is the sentence that stops a creator panicking, and you found the place for it.
- An unset reward reads "Not set yet" rather than a zero. A zero would have
  read as "this pays nothing".
- One contest shows a mixed reward, "$90 for 1 video, plus $300 if you finish
  1st". You designed against the awkward case instead of the tidy one.

## What is still outstanding

Five surfaces, with the direction numbers from the brief where they exist:

1. **The single contest page** (direction 2). Direction 3, the waiting state, is
   currently answered on a card rather than on its own screen, so it needs
   finishing here. Direction 4, the competing state, is untouched.
2. **The join popup and its animation** (direction 5). The owner asked for this
   one by name.
3. **The admin setup form** (direction 6). Untouched. The banner below lives here.
4. **The creator dashboard.**
5. **The admin dashboard.**

## New requirement: an optional banner image on a contest

Staff upload it inside the contest setup form, using the same upload control
brand logos and product images already use. No pasted URLs. Treat it as a design
problem, not a slot:

- **It is optional, and no banner is the normal case.** The database is empty and
  the first contests will have none. Every screen must look deliberate without
  one. It is not a fallback, it is the default.
- **It appears where a contest is being sold**: the contest's own page, and the
  top of the join popup. In a scrollable list it is small or absent, never full
  bleed. 1A's whole argument is that you can scan six contests deep with one
  thumb, and a banner per row destroys that.
- **Words never sit on it without a solid scrim.** Preferred: the banner is a
  band and the text sits below it on a solid surface. Our contrast script cannot
  evaluate text over a photograph, so this is the one place a WCAG failure could
  ship silently.
- **Fixed wide crop, about 3:1, space reserved before it loads** so nothing
  jumps. Lazy loaded. Creators are on phones.
- The store is publicly readable, so nothing commercial can appear in the
  artwork. PNG, JPEG or WebP only, 2 MB.

## Work that has been cut

**There is no admin control anywhere that removes a creator from a contest they
have already joined.** Do not draw one. An exclusion list is set when the
contest is created and can be edited later, but editing it only stops new people
joining. A creator withdrawing themselves still exists, up to the point they
have filed work, so that flow stays.

## Two corrections

The sidebar you drew (Home, My work, Contests, Leaderboards, Payments) is not
our navigation. Leaderboards does not exist yet, Payments does not exist at all.
Please do not invent navigation.

Your state colours (green for In, red for Not accepted, grey for Waiting, gold
for Delivered) must be expressed as the three stage tokens the product already
has, `--wx-stage-live`, `--wx-stage-due` and `--wx-stage-paid`, not as new
colours. Otherwise we ship two colour systems both claiming to say where money
has got to.

## The rule that still matters most

Every direction you explore is delivered, or is named in your handover as
considered and skipped, with one line on why. Nothing quietly dropped.
