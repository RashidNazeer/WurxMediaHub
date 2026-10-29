# Contests, follow up after handback 2

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

You have the original brief and both earlier notes. This does not repeat them. It
carries two rulings that change work you have already done, what landed, what is
still missing, and a fix list.

## Two rulings

**No creator ever sees anything about another entrant.** The open question from
the brief, whether an entrant's handle can ever be seen, is now closed in the
strongest form. Not a handle, not a headcount of entrants, not how many have been
approved, not a position in a field. **Direction 2F, competing with a published
standing, is cut. 2E, competing against yourself, is the one we build.** No
standings table, no published snapshot, nothing anywhere that reports one creator
to another.

Two things survive that ruling and we want them kept. "You placed 5th" stays,
because a creator's own placing is their own result and names nobody. And the
self set target you drew in 2E stays: one private number per entry, seen only by
the creator who set it. It is the only genuinely new thing your design asks us to
store, and we are storing it.

**The banner sits inside the reading column at a fixed 3:1.** The full width
strip in the one 1440 frame is cut. One crop everywhere, so no contest can be
twice the height of the next, and the upload preview in the setup form shows
exactly the crop the creator will see.

## What you got right this turn

Three things, named because they are the ones that are usually got wrong.

- **You invented no new state colours.** The four entry states are expressed
  through the three stage tokens we already have, exactly as asked, and you did
  not quietly keep your own palette alongside ours.
- **The banner is drawn at 3:1 on the contest page and nowhere in a list.** You
  read the constraint as a design problem rather than a slot.
- **Your four new tokens carry real contrast ratios against our real surfaces,**
  to two decimals, on every surface they actually land on. That is the format we
  can act on.

One thing you flagged and we owe you an answer on: our two documents contradicted
each other about the stage tokens, and you obeyed the later one. The settlement is
that the three stage tokens **are** used for an entry state, because an entry
state is where work and money have got to, which is what those tokens mean. They
are not used for a rank, a countdown or decoration. That is what you did, and you
proposed a separate deadline token for the countdown. Your reading was right. We
are correcting the brief line so the two documents stop disagreeing.

## What is still absent

**Nothing for the team has been drawn in two turns.** Twenty six frames, not one
of them an admin screen. The first thing we build from this engagement is an
admin screen, because a contest cannot exist for a creator until somebody on the
team has created it. Every creator frame you have drawn is currently unreachable.

Also still missing, and both were named in the brief as directions:

- **Direction 5, how the entry panel resolves on instant success.** One direction
  where the panel becomes the thing they now own in place, one where it leaves
  and the screen behind it has already changed, with your argument for which is
  better. The owner asked for this by name in the brief and again in the first
  note.
- **Direction 6, the setup form, two structurally different answers to a long
  form that does not feel long,** plus the date and time control and the multiple
  product picker.

Neither appears in your "considered and skipped this turn" list. That list is
good work, the three entries in it are honest and well reasoned, but it names
only things you invented and dropped. It does not name the two directions we
asked for and did not receive. That is the one rule both earlier notes repeated,
and this is the second turn it has been broken.

Beyond those: the states index, which the brief calls the deliverable we read
first, the creator dashboard, and the admin dashboard.

## Fix list, in the order that matters

1. **Open and never entered is only ever drawn with a banner.** No banner is the
   case that ships first, and your own header claims every frame exists in both
   versions. It does not.
2. **One entry is described three ways on one screen:** "1 of 3 approved with 1
   in review", "two still to file", "1 of 3 filed and approved so far". One
   sentence, everywhere, and we have picked the words for you so the screens and
   our database agree: **approved**, **in review**, **needs another take**,
   **still to film**. "Still to film" means nothing exists yet, so a video we
   sent back is never in it, which is why the tracker needs a fourth segment
   rather than three.
3. **At 375 the 1A card drops both what to film and how the contest is judged,**
   while the 1440 card carries both. Creators are mostly on phones, and with no
   scoreboard that judging sentence is the whole argument.
4. **1B has no rule for what earns the big slot.** The data gives it to the
   contest closing last, the page says closing soonest first, and the position
   reads "1 of 5".
5. **The 1B Up next rail leads with a contest the creator was rejected from and
   one they are already in.** On a phone those are the only two rows.
6. **Neither contest page direction can carry more than one reward row,** which
   is the normal shape. The mixed contest we praised in turn 1, $90 for 1 video
   plus $300 if you finish 1st, appears nowhere in turn 2.
7. **2E reads as a different screen rather than a state of the contest page:** no
   route back, no products, no brief link, no terms card, no banner. One screen
   carries every kind of contest.
8. **The same contest shows 50 days on one screen and 49 on another** in the same
   file.
9. **A settled contest somebody did not win is painted the amber that everywhere
   else means money is about to reach you.** Wrong promise at the worst moment.
10. **Reward tiers on a finished contest read "1st took $1,000".** Those are the
    contest's own public terms, not a report of what people received. The word is
    "pays".
11. **A finished contest card cross sells another brand's contest,** which can
    point at a contest that creator is not allowed to see.
12. **The waiting screen must stop promising email.** It also promises
    applications are read in the order they arrive. We cannot send an email yet,
    and the queue is newest first. Say what is true: a person decides, and the
    answer appears here.

## Widths and states

We have 7 frames at 1440 and 19 at 375, nothing at 768 or 1024. We need those two
widths wherever the layout reflows, including light 1440 for 1B and 1440 for the
whole 2C to 2E group. Not 2F. That direction is cut by the ruling above, so
nothing more is owed on it at any width.

The states we are still missing: error on every surface, empty because a filter
matched nothing, and the creator states that exist only as a browsing card and
were never carried onto the contest page: settled and won, settled and lost,
cancelled, ended while I am in it, and the state after a creator withdraws.

## The rule, once more

Every direction you explore is delivered, or is named in your handover as
considered and skipped with one line on why. It was broken this turn, and it was
broken last turn. The work itself is good and the judgement in it is good, which
is why we would rather have one line saying "direction 5 skipped, ran out of
room" than find it missing ourselves.
