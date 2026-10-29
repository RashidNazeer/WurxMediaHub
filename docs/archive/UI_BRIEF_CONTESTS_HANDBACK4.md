# Contests, follow up after handback 3

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

You have the brief and three earlier notes. This does not repeat them. It says
what improved, the one thing that stopped us building, a ruling that settles the
layout in your favour, and a fix list.

## What improved

The twelve item fix list from handback 3 is six done and six partly done, and
nothing was left untouched. That is the first turn where every item was at least
picked up, and it shows.

- **2F is properly gone**, including from the mock data, not just hidden. You
  removed the frames rather than leaving them to be found later, and you said so
  in the skipped list. That is exactly the handling we asked for.
- **The banner ruling is met everywhere.** One 3:1 crop inside the reading
  column, no full width strip left anywhere in the file.
- **The 375 card now carries what to film and how it is judged.** With no
  scoreboard, that judging sentence is the whole argument, and it is now on the
  screen most creators will actually use.
- **The waiting screens stopped promising email** and stopped promising a queue
  order we do not have. They now say a person decides and the answer appears
  here, which is true.

Also worth naming: your skipped list is honest again, and this time it names the
directions we asked for rather than only the ones you invented.

## The one thing that stopped us

**Nobody chose a setup direction.** 3a carries "my recommendation, because the
proof is where the tap was" in bold. 3c and 3d carry nothing of the kind. The
setup form is the first thing we build, ahead of every creator screen in this
file, because a contest cannot exist for a creator until somebody on the team has
made one. So the one place a recommendation was load bearing is the one place it
is missing, and we cannot lay the form out until it arrives.

Pick one, 3c or 3d, and argue it in two or three sentences the way you argued 3a.
Not which is prettier: which one survives the fourth contest of the week, typed
by somebody who already knows the answers. If you think they are genuinely close,
say what would decide it and what you would need to know.

## The layout is settled, and it went your way

Our plan had this form as a **dialog**, beside every other admin form in the
product. You drew both directions as full pages without being asked to. On
looking at it you were right: a contest carries around twelve fields plus three
lists inside it, the products, the reward rows and the people barred from it.
That is not a dialog. **It is now ruled a full screen, and we are changing our
plan rather than your drawing.**

It also means 3c's live preview column is no longer impossible, so judge the two
on their merits rather than on whether they fit.

Two things follow, and both are on you:

- **Draw the admin sidebar.** Neither 3c nor 3d has it, so neither can be checked
  against the rule that admin content sits left against the sidebar at a max
  width and is never centred. The usable width is not 1440, and a full screen
  that ignores the sidebar is a full screen designed for a page we do not have.
- **375 for both.** A full screen has to survive a phone. Neither direction
  exists at any width other than 1440.

## Fix list, in the order that matters

1. **The reward row editor, properly.** You have drawn one row in one of the
   three shapes decision D1 accepts, and no field for the deliverable title,
   which our schema will not accept as empty. We need: a fixed row, a place row,
   a milestone row, a contest with six rows, a mixed contest mid typing, the
   refusal when two rows claim the same place, and a reorder affordance. Once
   entries exist a row cannot be deleted, so the control is **Retire**, not the
   delete cross you have drawn. That cross currently sits on a row the database
   will refuse to remove.
2. **The banner upload.** Asked for by name in the brief and unmet for three
   turns. It exists as a collapsed row reading "Banner image, none". We need it
   at rest, mid upload, holding a picture, refusing a file, with the clear
   control, with the 3:1 preview at exactly the crop the creator sees, and the
   sentence telling staff the store is publicly readable so nothing commercial
   goes in the artwork.
3. **The four segment tracker, drawn.** It is described in prose twice and every
   bar in the file still has two coloured spans. The only entry in your data with
   a sent back video sits on a browsing card that carries no bar at all. Four
   segments: approved, in review, needs another take, still to film.
4. **Rule L6 copy is wrong in two places, and one of them is inside a creator
   preview card**, so it reads as creator copy telling a creator in Los Angeles
   they see their own clock. That is the exact failure the timezone column exists
   to prevent. Your own creator frames already say it correctly, so this is a
   copy fix, not a rethink.
5. **The dashed placeholder captioned "no banner, this is the normal case" is
   inside the creator preview panel.** Rule B1 bans exactly that box, and this is
   the one panel whose whole job is to predict the creator screen. A creator with
   no banner sees no box at all, so the preview must show none either.
6. **Refusal and error states on the setup form.** Rewards exceeding the total
   budget with both figures named, a deadline at or before the opening instant,
   two rows claiming one place, an invalid timezone, and a save that failed.
7. **The word cancel appears nowhere in the file**, in any frame, in the data, in
   either index or in the skipped list. Our schema carries three cancellation
   columns and a function. Either draw it or name it as skipped.
8. **Stop 1 in 3d is headed "What is the contest, and when does it close?" and
   has no deadline control in it.**
9. **The date and time control contradicts itself.** Its five leading blanks put
   1 October 2026 on a Saturday when it was a Thursday, the highlighted cell is
   day 31, and the echo underneath reads a different date again. This control has
   no precedent in the product, so we build it from your frame.
10. **Two data slips.** One contest is 32 days in the data and 33 on a frame. The
    featured slot is labelled "soonest you can enter" while showing a contest
    that closes later than an enterable one, which is the 1B slot rule from
    handback 3 reappearing.
11. **The mixed reward is presented as frozen at entry.** Rule F1 freezes the
    fixed part only. A ranked row commits at settlement, and the copy has to say
    so or we promise money we have not decided.
12. **One rejection note reads "we have filled this one for now"**, which implies
    a capacity. There is no cap column anywhere, and rule N1 bans anything shaped
    like spots filling up.
13. **`--wx-deadline` is declared in many frames and applied to nothing**, while
    the legend still describes a state no frame draws. Draw the deadline inside
    48 hours somewhere, or drop the token.

## The states index

The brief says the states index is the deliverable we read first, and this is the
third turn where a claim in your handover has not matched the file. It defines
drawn as existing at 375 and 1440. Contest setup Loading is marked drawn and
there is no setup skeleton at any width. The entry panel row claims four refusals
and one is drawn. The 3b caption promises "same frames, both resolutions, so you
can compare them directly" on a section with one frame.

We are not asking for more frames to be marked drawn. We are asking that the
index be a thing we can trust without opening every section to check it. Marking
something turn 4 costs you nothing and costs us nothing. Marking it drawn when it
is not costs us a planning session.

## Widths

Third time of asking: **768 and 1024, everywhere the layout reflows.** Your
reflow rules in the skipped list are good, and they are exactly what we cannot
verify without frames.

Still owed from handback 3 and not in the skipped list: **light 1440 for 1B**,
and **1440 for the 2C to 2E group**. New this turn: **375 for both setup
directions**. Creators are on phones and the team is not, but the team is on
laptops at 1024 and on tablets, and the admin panel is checked at every width
before it ships.
