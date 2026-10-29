# Documentation index

These documents are the team's memory. `CLAUDE.md` at the repo root holds the rules; the files
here hold what happened, what is true now and what is deferred. If reality and a doc disagree,
fix the doc in the same commit.

## Read every session (top level)

| File | What it is | When to read it |
| --- | --- | --- |
| [`PROJECT_STATE.md`](PROJECT_STATE.md) | Where we are: environments, what shipped, what is in flight, how to verify | Always, first |
| [`PARKED.md`](PARKED.md) | Work deliberately deferred, each item with the trigger that brings it back | Always. Also the answer to "what is pending?" |
| [`OPERATIONS.md`](OPERATIONS.md) | Project ids, credentials, every command, deploy flow, Windows traps | Before running any CLI |
| [`FEATURE_MAP.md`](FEATURE_MAP.md) | Append-only map of how features depend on each other | Only the entries you are about to touch |
| [`DECISIONS.md`](DECISIONS.md) | Append-only dated decisions, with the reason | When a decision is in question |

`FEATURE_MAP.md` and `DECISIONS.md` are logs: repair a path or mark a removal, never rewrite history.

## `guides/`: reference that is still true

| File | What it is | When to read it |
| --- | --- | --- |
| [`guides/NEW_MACHINE.md`](guides/NEW_MACHINE.md) | Moving the project to a new laptop; where everything lives; the traps that cost time | Setting up a machine; section 6 is the 2026-10-13 status snapshot |
| [`guides/DEPENDENCIES.md`](guides/DEPENDENCIES.md) | What is installed, why, and what is deliberately absent | Before adding, removing or swapping a package |
| [`guides/MOTION.md`](guides/MOTION.md) | Which animation tool to use, the rules, and what must never animate | Before animating anything |
| [`guides/GLASS_PLAN.md`](guides/GLASS_PLAN.md) | The glass material rules (fence law, blur budget, palette) that two guards and many source comments cite | Before touching blur, backdrop-filter, card material or the landing page |
| [`guides/BACKUPS.md`](guides/BACKUPS.md) | Backup data feature: what a backup holds, how to restore, disaster recovery | Backup or restore work, or a bad day |
| [`guides/CREATIVE_ANGLE_AUTOMATION.md`](guides/CREATIVE_ANGLE_AUTOMATION.md) | Plan and change record of the Categorise automation, with the audit backend contract | Anything touching creative angles or `collab-angles*` |
| [`guides/WURXBASE_WRITE_SAFETY.md`](guides/WURXBASE_WRITE_SAFETY.md) | Audit of the vendored Paid Collabs app's data-loss bugs and the fixes | Before editing or re-vendoring `src/vendor/wurxbase/` |
| [`guides/CREATOR_INTERFACE.md`](guides/CREATOR_INTERFACE.md) | Snapshot (2026-10-16) of every creator screen and its data hooks, read from the code | Orientation in the creator app; the code wins where they differ |

## `plans/`: live plans

| File | What it is | When to read it |
| --- | --- | --- |
| [`plans/PAGE_PLAN.md`](plans/PAGE_PLAN.md) | The page-by-page "minimal and practical" rules and contracts for the creator app (2026-10-19) | Before changing any creator page |

## `archive/`: finished or superseded, kept for history

Each file carries an "Archived 2026-10-30" banner. File names inside them may no longer exist.

| File | What it was |
| --- | --- |
| [`archive/PROJECT_STATE_to_2026-10-13.md`](archive/PROJECT_STATE_to_2026-10-13.md) | The old project-state build log, up to 2026-10-13 |
| [`archive/CONTESTS_PLAN.md`](archive/CONTESTS_PLAN.md) | The Contests plan and rules (2026-08-12); contests have shipped |
| [`archive/UI_BRIEF_CONTESTS.md`](archive/UI_BRIEF_CONTESTS.md), [`HANDBACK2`](archive/UI_BRIEF_CONTESTS_HANDBACK2.md), [`HANDBACK3`](archive/UI_BRIEF_CONTESTS_HANDBACK3.md), [`HANDBACK4`](archive/UI_BRIEF_CONTESTS_HANDBACK4.md) | The design brief for Contests and the three follow-up notes to the design agent |
| [`archive/UI_BRIEF_CREATOR.md`](archive/UI_BRIEF_CREATOR.md) | The brief for the creator experience |
| [`archive/CREATOR_HOME_UI_BRIEF.md`](archive/CREATOR_HOME_UI_BRIEF.md) | The UI-generation prompt for the creator Home screen (2026-10-09) |
| [`archive/UI_CONNECTIONS_PLAN.md`](archive/UI_CONNECTIONS_PLAN.md) | "Joining the product up", eight steps (2026-08-11); built |
| [`archive/UI_NEXT.md`](archive/UI_NEXT.md) | What to build next in the UI after the rebrand (2026-10-09) |
| [`archive/PRISM_PROGRESS.md`](archive/PRISM_PROGRESS.md) | Progress log of the neomorphic PRISM rebuild; superseded by the glass redesign |
| [`archive/REDESIGN_HANDOFF.md`](archive/REDESIGN_HANDOFF.md) | End-of-session handoff of the creator redesign (2026-10-16) |
| [`archive/CREATOR_NAVIGATION_REVIEW.md`](archive/CREATOR_NAVIGATION_REVIEW.md) | Creator navigation reviewed against Cruva (2026-10-17); partly superseded by the Brand hub decision |
| [`archive/ADMIN_UI_PLAN.md`](archive/ADMIN_UI_PLAN.md) | Brief for moving the admin onto the creator visual language (2026-10-20); done |
| [`archive/NEXT_UNATTENDED.md`](archive/NEXT_UNATTENDED.md) | The 2026-08-29 Monday-cutover status of the WurxBase write-safety work |

## Elsewhere

- [`../README.md`](../README.md): project overview and commands.
- [`../CLAUDE.md`](../CLAUDE.md): working rules, security, auth and design rules.
- [`../design/README.md`](../design/README.md): the brand kit, token map and screen references.
