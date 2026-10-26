# PRISM, agent working notes

The product is **PRISM**. Wurx Media is the company that makes it — the brand
kit's own line is "Creator community by Wurx Media" — so the company name is
correct in an about or a footer, and wrong anywhere it names the product. The
old WurxMediaHub identity, its gold and cream and its dog mark, are retired.
Note the repo, the Vercel projects and the Supabase projects still carry the old
name, and the browser storage keys deliberately do too: renaming those keys
would sign out every existing user and reset their preferences.

Creator platform for Wurx Media's TikTok Shop brands. Creators apply once, get
approved, and enter branded **Brand Hubs** where they see their real numbers
(GMV, commission, ad spend behind their own videos), leaderboards, contests,
briefs and retainer offers. Admins manage brands, campaigns, users and data.

**Transparency is the product.** The moment that matters: a creator logs in and
sees their real GMV.

Owner: Rashid (product owner, tests everything in the browser, does not use Git
or the terminal). Claude runs the entire toolchain via CLI.

## Read this first, every session

1. `docs/PROJECT_STATE.md`, where we are, what's next. **Always.**
2. `docs/PARKED.md`, work we deliberately deferred. **Always.** Each item names
   the trigger that should bring it back up. Raise it yourself when that trigger
   arrives rather than waiting to be asked. When Rashid asks "what's pending?",
   answer from this file.
3. `docs/OPERATIONS.md`, project ids, credentials, commands, deploy flow, and
   the Windows quirks that have already cost time. Read before running any CLI.
4. `docs/FEATURE_MAP.md`, only the entries you are about to touch.
5. `docs/DECISIONS.md`, only when a decision is in question.

Chunked memory, not everything at once. If reality and the docs disagree, fix
the docs in the same commit.

## Stack (locked, change only with Rashid's approval)

React 19 + Vite + TypeScript strict · Tailwind v4 + shadcn/ui (heavily themed) ·
TanStack Query for all server state · React Router (code-split routes) ·
Motion for animation · Zod on every input · Supabase (Postgres, Auth, RLS,
Realtime, Storage, Edge Functions) · Vercel hosting · pnpm.

No Next.js. No ORM. No state library beyond TanStack Query.

## Commands

```bash
pnpm dev              # local dev server
pnpm build            # token guard + tsc + vite build  (must pass before commit)
pnpm typecheck        # tsc -b
pnpm lint             # oxlint
pnpm format           # prettier --write
pnpm check:contrast   # dark/light token parity + WCAG guard
pnpm verify:browser   # real Chromium: console errors, both themes, responsive
pnpm verify:rls       # attacks the database as a real user, proves RLS holds
pnpm verify:session   # section 11: refresh, two tabs, reopen, form survival
pnpm shots            # retina screenshots for design review
```

`verify:rls` and `verify:session` need `SUPABASE_SERVICE_KEY` in the
environment. Fetch it from the CLI at run time; never write it to a file.

`verify:browser` needs a server running, `pnpm build` then `pnpm preview` in
another shell, then point it at http://localhost:4173. Rashid cannot read a
console, so this is how "zero console errors" gets proven.

Supabase (always pass the token via env, never `supabase login`):

```bash
supabase migration new <name>     # create a migration file
supabase db push                  # apply migrations to the linked project
supabase gen types typescript --linked > src/types/database.ts
```

## Layout

```
src/
  app/        providers.tsx, router.tsx      # mounted once, never keyed on session
  components/ brand/ layout/ theme/ ui/
  lib/        supabase.ts env.ts query-client.ts utils.ts
  routes/     one file per screen, lazy-loaded
  styles/     tokens.css (all colour lives here) global.css
scripts/      check-contrast.mjs             # runs inside pnpm build
supabase/     migrations/                    # every schema change, committed
docs/         PROJECT_STATE.md FEATURE_MAP.md DECISIONS.md
```

## Step protocol

One roadmap step per approval. Never build two steps at once.

Read state → plan in 5-10 lines → build → report in plain English with a
click-by-click test checklist → **stop** and wait for "approved" / "next".
A bug report becomes the current step.

Definition of done: `pnpm build` passes · zero console errors · RLS verified on
any new table · docs updated in the same commit · pushed · deployed to dev.

Never force-push, drop tables, reset a database, or delete a project without
asking. On prod, ask twice.

## Security rules (non-negotiable)

- RLS on every table from creation, deny by default. No table ships without
  policies. The `automatic RLS` event trigger is enabled on both projects.
- `Automatically expose new tables` is OFF, grants are explicit, per table, in
  the migration. **This also switches off the default grants to `service_role`**,
  so every new table needs `grant all privileges on table X to service_role;`
  or the Edge Functions that use it will silently see nothing.
- Never `grant` a column to `authenticated` for convenience. Column-level
  UPDATE grants are how we stop users editing their own role and tier.
- Never trust a role, tier or `creator_id` from the client. Derive identity from
  `auth.uid()` and JWT claims (custom access token hook).
- Browser bundle may contain only the Supabase URL and anon key. Service-role
  keys live only in Edge Function secrets.
- Privileged actions (approvals, tier changes, brand edits, data upload, money)
  go through Edge Functions that re-check the caller's role server-side.
- Zod on the client *and* again in the Edge Function. Audit sensitive admin
  actions to `audit_log`.
- Hiding a button is never the security boundary. The database is.

## Auth rules (we are engineering against random logouts)

- Exactly one Supabase client, from `src/lib/supabase.ts`. Never construct one
  in a component, hook or route.
- `persistSession` + `autoRefreshToken` + PKCE, default token lifetimes.
- `onAuthStateChange` may only set state. Never reload or navigate on
  `TOKEN_REFRESHED` / `USER_UPDATED`. Redirect only on real sign-in/sign-out.
- Nothing in the provider tree may be keyed on the session, a token refresh
  must not remount React or wipe a half-filled form.

## Design rules

- **Every colour is a `var(--wx-*)` token in `src/styles/tokens.css`.** No
  hardcoded hex in components, ever.
- Dark and light are equal citizens. A token added to one mode MUST be added to
  the other, `pnpm check:contrast` enforces parity and WCAG AA in both and
  fails the build otherwise.
- Palette is PRISM's, from `Redesign UI/prism_brand_kit`. Ink `#14141C`, White,
  Mist `#F7F7FB`, Line `#ECECF3`, Body `#4A4A5A`, Muted `#6B6B7B`. The four
  spectrum colours are **accents only** — magenta `#FF2E8C`, violet `#9B5CFF`
  (the interactive one), blue `#2E8BFF`, cyan `#17E0D4` (growth/positive) —
  and the kit forbids them as paragraph text or full-bleed backgrounds. For
  text use the dark inks: `#5A1FD0`, `#0B6F69`, `#B0145C`.
- Fonts: Caprasimo (display, one weight, 24px and up only) and Figtree
  (interface, 400/500/600). Both self-hosted in `public/fonts`. The old Wurx
  faces are gone; `'Inter'` survives only as an ALIAS pointing at Figtree,
  because the vendored Paid Collabs app names it in dozens of rules.
- **No borders anywhere.** Shape comes from the `wx-neo-*` shadow utilities.
  The one exception is the `forced-colors` block in `global.css`: Windows High
  Contrast discards `box-shadow`, so a shadow-only control would be invisible
  there. Keep internal dividers — a rule between two rows inside a card is not
  an outline.
- **A Brand Hub is a PRISM screen wearing a brand's accent**, not a world of
  its own. Rashid, 2026-10-09: "it is a part of the app Prism please design it
  accordingly." It renders inside `AppShell` like every other creator screen —
  same rail, same top bar, same material — and the brand supplies its accent
  colour, its logo and its hero art inside the content area. It must never
  repaint the page ground, the rail, the top bar or the surface tokens. It used
  to mount outside `AppShell` with a whole derived palette, which both looked
  like a different product and forced a full shell remount on entry and exit.
- Skeletons, never bare spinners. Designed empty and error states.
- **Layout of every admin screen** (Rashid's rules, apply to new features too):
  the working content starts high, headers stay compact, and reference data
  (ids, client, budget, counts) goes in its own **Overview** tab rather than
  stacked above the work. On a record with tabs the default tab is the job, not
  the summary. Never show slugs, ids or routes to an admin. The main area is
  left aligned against the sidebar and **fills the full width**, never centred
  and no max-width cap, or zooming out leaves a gap that makes the page look
  broken.
- **Screen chrome, fixed on 2026-08-16 and not per-screen taste.** The top bar
  names the section, underlined, and that is the page's only `<h1>`; it comes
  from the sidebar's own labels via `sectionTitleFor`. A screen does **not**
  draw its own title row and does **not** draw a description of itself. Row one
  is the work: tabs, search and filters on one line inside `<FilterBar>`, with
  at most one primary action pinned right. A record screen keeps the record's
  name, as an `<h2>`. Corners are slight: `rounded-md` on controls, `rounded-xl`
  on cards, `rounded-full` only on icon buttons and status pills.
- **Every type size is a `rem`, never a `px`.** One root `font-size` set by
  `src/lib/ui-scale.ts` scales the whole signed-in app, and the person using it
  can change it from the top bar. A hardcoded `text-[13px]` opts out of that and
  is a bug.
- **Responsive on every device, not just mobile first.** Wurx targets US and UK
  TikTok Shop creators, who are mostly on phones and tablets, while the team
  works on laptops and desktops. Every screen, **including the admin panel**, is
  checked at roughly 375px, 768px, 1024px and 1440px before it is called done.
  No horizontal page scroll at any width: wide things scroll inside their own
  container, and tables become stacked cards on narrow screens. Anything only
  reachable by hover needs a tap equivalent.

## Performance habits (from step 1, not "later")

Server-side pagination on every growable list. Never `select('*')` on wide
tables. Index every FK and every common filter/sort. Aggregate in SQL, not in
the browser. Route-level code splitting. Sensible `staleTime` per resource.

## Environments

`dev` branch → wurxmediahubdev.vercel.app → Supabase `CreatorHub` (`qinxwfdwvpkzfhcijuqw`, org Prism, moved 2026-10-27; the old `wurxmediahub-dev` is retired, see OPERATIONS)
`main` branch → wurxmediahub.vercel.app → Supabase `wurxmediahub-prod`

**PRISM has its own home: prismwurx.vercel.app**, and Rashid asked that it not
be tied to the wurxmediahub domains. It is a separate Vercel project; confirm
which branch it builds before assuming a push will appear there.

**Two remotes.** `origin` is `RashidNazeer/WurxMediaHub`, `prism` is
`RashidNazeer/Prism`, and both carry every branch. Push to BOTH, or they drift.
The credential on this machine authenticates as GitHub user `umar551869`, while
commits are authored `RashidNazeer <wurxmedia@gmail.com>` — those are different
things and both are correct.

All work happens on `dev`. Prod changes only when Rashid says "make it live".
Dev may hold seed data. Prod never gets test data.
