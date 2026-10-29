# Admin UI — one language with the creator app

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

Rashid, 2026-10-20: *"the whole app must carry the same UI language as we have been
working on for a few days. Do not change UX, just fix the UI."*

This is the brief every agent works from. Read all of it. The creator app
(`src/routes/app/*`, `src/components/creator/*`) is the reference: where an admin
screen differs from how the creator app does the same job, the admin screen moves.

## 0. The one rule

**UI only. Never UX.** You may change classes, CSS, tokens used, spacing, radii,
shadows, typography, colours, icon size and the markup needed to apply them. You
may NOT change: routes, what a control does, which controls exist, where they sit
in the flow, what data is fetched, any text a person reads, tab order, or what
opens what. If a visual fix needs a behaviour change, leave it and say so in your
report. Copy is not yours to rewrite.

## 1. The language (what "the same" means)

**Type.** One family, Figtree, everywhere (`--wx-font-sans`; `font-display` and
`font-mono` now resolve to it). Body weight 450; headings 700–800. No monospace
for labels or figures. Micro-labels stay uppercase with tracking, as in the
creator app. Use rem sizes only.

**Surfaces.** Two materials, nothing else:
- `wx-neo-raised` — a section panel.
- `wx-neo-raised-sm` — a tile, card, chip, pill or button face.
- `wx-neo-inset` — a well (an input, an image frame).
No surface blurs inside the app (the rail and top bar are the only blurred
things, and they are not yours). **Never add `backdrop-filter`.** Never draw a
card as a flat opaque `bg-surface-*` box with a 1px border; that is the old
language. Shadows, rims and edges come from the utility, so every card has the
same ones. Do not hand-write box-shadows except the one static drop shadow the
creator cards use: `shadow-[0_14px_32px_-14px_rgba(0,0,0,0.6)]` for large image
cards and `shadow-[0_8px_18px_-10px_rgba(0,0,0,0.65)]` under images.

**Shape.** Panels `rounded-xl`; tiles and cards `rounded-lg`/`rounded-xl`; pills
and buttons `rounded-full` or `rounded-md` exactly as the shared `Button` does;
avatars and logos round or `rounded-xl`. One radius per kind of thing across the
whole admin.

**Controls.** Use the shared components: `Button`, `ButtonLink`, `Field`/`Input`/
`Select`, the pill group used for Content's status filters. No bespoke gradient
buttons, no one-off input styles. A tap target is at least 2.75rem on touch.

**Colour.** Tokens only: `text-text`, `text-muted`, `text-faint`, `accent`,
`success`, `warning`, `danger` and their `-soft` fills. No hex literals except
brand data (a brand's own colour) and chart series already in `--chart-*`.
Status is a dot + words, never colour alone.

**Money and numbers.** Same helpers as the creator app (`exactMoney`,
`compactMoney` in `@/components/charts`). Shown as `$1,240`, never `US$1,240`.
`NOT_REPORTED` for a missing figure, never a zero.

**Spacing.** Page = top bar title, then content with `gap-4`; panels `p-4`;
tile grids `gap-3`; rows `min-h-11`. The same page header pattern on every page.
Do not add decorative elements.

**Images.** Brand logos, avatars and thumbnails get the same treatment as the
creator app: shown whole, never zoomed, with the soft static drop shadow above.
Use `brandLogo(slug, url)` from `@/lib/brand-logos` wherever a brand logo is
drawn; it knows the three logos we ship.

**Both themes.** Everything must be right in dark and light. In light mode no
heavy black bands or dark outlines on glass; in dark mode glass is 60% black.

## 2. Frozen — do not edit

`src/styles/**` (tokens, global.css), `src/components/layout/**`,
`src/components/charts/**`, `src/components/ui/**` (shared primitives),
`src/app/router.tsx`, `src/lib/nav.ts`, anything under `src/routes/app/**` or
`src/components/creator/**`, `docs/` except your own section of this file's
"Reports" appendix. If a shared primitive is the problem, do NOT fork it:
describe it in your report.

## 3. Ownership (each file has exactly one owner)

| Agent | Pages (routes) | Files |
|---|---|---|
| **A** | Dashboard `/admin`, Applications `/admin/applications`, Application detail `/admin/applications/:id` | `AdminDashboard.tsx`, `Applications.tsx`, `ApplicationDetail.tsx` |
| **B** | All offers, Offer requests, Contests, Contest claims, Contest rewards, Contest setup | `AllOffers.tsx`, `OfferRequests.tsx`, `AllContests.tsx`, `ContestClaims.tsx`, `ContestRewards.tsx`, `ContestSetup.tsx`, and the `src/components/admin/Offer*`, `Contest*` files only B's pages use |
| **C** | Content, Activity, TikTok, Client links | `Content.tsx`, `Activity.tsx`, `TikTokSettings.tsx`, `ClientLinks.tsx` (admin ones) |
| **D** | Brand hubs (`/admin/brands`, `/admin/brands/:id`), Creators (`/admin/creators`, `/admin/creators/:id`) | `Brands.tsx`, `BrandHub.tsx`, `Creators.tsx`, `CreatorDetail.tsx`, and the other `src/components/admin/*` (shared admin components are D's; others style at the call site) |
| **E** | Paid Collabs: Brands, Creators, Performance, Reporting, Leaderboard, Discovery tabs and the brand drill-down | `PaidCollabs.tsx`, `collab-*.tsx`, `wurxbase-overrides.css`, `wurxbase-chrome.css`, everything in `src/vendor/wurxbase/**` |

Rules for E's vendored code: it is third-party-shaped. Prefer re-mapping its own
CSS variables (`--pc-*`) and selectors in `wurxbase-overrides.css` to the creator
tokens over editing `WurxUI.jsx`. Edit JSX only to swap a class or inline style.
Keep every `WURX-ADDED`/`WURX-END` marker intact.

## 4. What to fix, in order

1. Every card, tile, KPI box, table shell, popover and dialog face moves onto the
   two materials above (no flat bordered boxes, no per-component shadows).
2. Every pill group, segmented control, filter chip and search field matches the
   creator app's.
3. Every button and input is the shared component (or visually identical).
4. Type: one family, rem sizes, the same heading/label hierarchy.
5. Brand logos and avatars: whole, shadowed, via `brandLogo`.
6. Money format.
7. Spacing and radii.
8. Dark AND light check at 1440 and 390 (no horizontal scroll on the page).

## 5. Verification

You cannot sign in as an admin (do not look for credentials). Work from the code
and from the audit screenshots in the scratchpad folder
`...\scratchpad\admin-shots\<page>-<dark|light>.png` (1440px, the real signed-in
app). After editing, run `pnpm typecheck` — nothing else (no `pnpm build`, no
git). The lead rebuilds, signs in and re-screenshots every page, so make each
change something that screenshot will show.

## 6. Report back

Short: what you changed per page, what you deliberately left (and why), anything
that needed a frozen file or a UX change. No narration of method.
