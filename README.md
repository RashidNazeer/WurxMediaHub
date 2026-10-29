# PRISM

The creator platform behind Wurx Media's TikTok Shop brands. **PRISM** is the product; Wurx
Media is the company that makes it. (The repository, the Vercel projects, the Supabase projects
and the browser storage keys still carry the old name, WurxMediaHub, on purpose: renaming the
storage keys would sign every user out. `CLAUDE.md` explains.)

Creators apply once, get approved, and enter branded **Brand Hubs** where they see their real
numbers (GMV, commission, and the ad spend behind their own videos) alongside leaderboards,
contests, briefs and retainer offers. Staff manage brands, offers, contests, creators and data in
an admin panel. Transparency is the product.

Private repository. Status and what is in flight: [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md).

## Stack (locked)

React 19 · Vite · TypeScript (strict) · Tailwind v4 + shadcn/ui · TanStack Query · React Router ·
Motion · Zod · Supabase (Postgres, Auth, RLS, Realtime, Storage, Edge Functions) · Vercel · pnpm.
Changing any of it needs the product owner's approval; the reasons are in
[`docs/guides/DEPENDENCIES.md`](docs/guides/DEPENDENCIES.md).

## Quick start

Node 24 (any v24 LTS) and pnpm 11 (`packageManager` in `package.json`).

```bash
pnpm install
cp .env.example .env.local            # then fill in the dev Supabase URL and publishable key
pnpm dev                              # http://localhost:5173
pnpm exec playwright install chromium # only for the browser verification suites
```

Never put a service-role key in a file: the browser bundle may contain only the Supabase URL and
the publishable key. Machine setup, credentials and Windows traps are in
[`docs/guides/NEW_MACHINE.md`](docs/guides/NEW_MACHINE.md) and [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Commands

`pnpm build` is the gate before every commit. The pnpm command names are the stable interface;
the files behind them live under `scripts/`. How each suite works, and what it needs, is in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) section 3.

### Build and develop

| Command | What it does |
| --- | --- |
| `pnpm dev` / `preview` | Dev server / serve `dist` on :4173 (browser suites run against it) |
| `pnpm build` | The guards (`entry-graph`, `check-contrast`, `check-brand-theme`, `check-isolation`), then `tsc -b`, then `vite build` |
| `pnpm typecheck` / `lint` | `tsc -b` / oxlint |
| `pnpm format` / `format:check` | Prettier write / check |
| `pnpm check:contrast` | Dark/light token parity and WCAG AA |
| `pnpm check:brand-theme` | Brand theme guard |
| `pnpm verify:entry-graph` | No heavy package reachable from the entry chunk without a dynamic import |
| `pnpm verify:isolation` | Creator and admin code may not import each other |

### Verify

Most suites sign in as real users against the linked **dev** database, so they need a server on
:4173 (`pnpm build`, then `pnpm preview`) and/or `SUPABASE_SERVICE_KEY` in the environment. Run
them all with `pnpm verify:all [url]`. Offline suites (no server, no key) are marked "offline".

| Area | Commands |
| --- | --- |
| Everything | `verify:all`, `verify:browser` (console errors, both themes, responsive), `verify:settings-sync` |
| Auth and access | `verify:rls`, `verify:session`, `verify:signin`, `verify:apply`, `verify:applicant-flow`, `verify:role-gates` |
| Creator app | `verify:offers`, `verify:offer-requests`, `verify:contests`, `verify:content`, `verify:leaderboard`, `verify:numbers`, `verify:performance`, `verify:review`, `verify:live`, `verify:alltime-videos`, `verify:video-days`, `verify:video-thumbs`, `verify:tier-deals`, `verify:topvids-stats`, `verify:followers`, `verify:deal-complete` |
| Brands | `verify:brands`, `verify:brand-numbers`, `verify:brand-theme`, `verify:brands-gmv`, `verify:brand-search`, `verify:brand-visibility`, `verify:product-picker`, `verify:product-images`, `verify:product-band`, `verify:product-groups`, `verify:october-product`, `verify:drawer` |
| Paid Collabs (admin) | `verify:collab-period`, `verify:collab-ads`, `verify:collab-ads-ui`, `verify:collab-contrast`, `verify:collab-controls`, `verify:collab-canvas`, `verify:collab-chrome`, `verify:collab-filters`, `verify:collab-share`, `verify:collab-share-ui`, `verify:client-links`, `verify:collabs-viewer`, `verify:collabs-viewer-rls`, `verify:ads-manager`, `verify:ads-manager-ui` |
| Creative angles | `verify:angles`, `verify:angles-import`, `verify:angles-live`, `verify:angle-products`; offline: `verify:angles-categorise`, `verify:angles-queue`, `verify:angles-backoff`, `verify:angles-worker`, `verify:angle-functions` |
| Euka and Reacher | `verify:euka`, `verify:euka-ui`, `verify:euka-errors`, `verify:euka-date-keys`, `verify:euka-accounts`, `verify:euka-ads`, `verify:euka-ads-ui`, `verify:reacher`, `verify:reacher-ads` |
| TikTok | `verify:tiktok`, `verify:creator-tiktok`, `verify:tiktok-identity`, `verify:oauth-strip`, `verify:tiktok-release`, `verify:tiktok-guards`, `verify:tiktok-signup` |
| WurxBase (vendored app) | `verify:wurxbase`, `verify:wurxbase-signin`, `verify:wurxbase-perms`, `verify:wurxbase-team`, `verify:wurxbase-roster`, `verify:write-safety` |
| Design | `verify:responsive`, `verify:chrome`, `verify:backdrop-ancestry`, `verify:blur-budget` |
| Public site | `verify:site`, `verify:legal`, `verify:prod-ready`, `verify:contract-pdf` |
| Backup data | `test:backup` (no setup), `test:backup:live`, `test:backup:function`, `test:backup:chaos` (the last three need `supabase start`) |

### Ops, seed and tooling

| Command | What it does |
| --- | --- |
| `pnpm backup:database` / `restore:database` | Whole-database backup and restore from the command line (`DATABASE_URL` in the environment only) |
| `pnpm vendor:wurxbase`, `wurxbase:copy`, `wurxbase:sync`, `wurxbase:link` | Re-vendor the Paid Collabs app; copy and sync its data; link its team to PRISM users |
| `pnpm collabs:viewer`, `staff:ads-manager` | Create the read-only Paid Collabs viewer and Ads Manager accounts |
| `pnpm seed:contests` | Seed dev with contest data (other seeders: `scripts/seed/`) |
| `pnpm probe:tiktok` | Probe the TikTok API from the command line |
| `pnpm shots`, `shots:creator`, `shots:admin` | Retina screenshots for design review (`shots/` is git-ignored) |
| `pnpm measure:nav` | Click-to-paint timing; always against the live URL |

Database changes: `supabase migration new <name>`, `supabase db push --dry-run`, then
`supabase db push`; regenerate types with `supabase gen types typescript --linked`. Pass tokens
by environment, never `supabase login`. Details: `docs/OPERATIONS.md` section 4.

## Environments

| Branch | Site | Database |
| --- | --- | --- |
| `dev` | wurxmediahubdev.vercel.app | Supabase `CreatorHub` (`qinxwfdwvpkzfhcijuqw`) |
| `main` | wurxmediahub.vercel.app | `wurxmediahub-prod` (`isqepjioowzqoyhlusqo`), currently paused |
| `main` of the separate `Prism` repo | prismwurx.vercel.app | `CreatorHub` (shared with `dev`) |

All day-to-day work happens on `dev`. `main` moves only on an explicit instruction from the
product owner, and production never receives test data. There are two remotes, `origin`
(`WurxMediaHub`) and `prism` (`Prism`); see `CLAUDE.md`.

## Repository map

| Path | What is in it |
| --- | --- |
| `src/` | The app. `app/` providers and router, `components/` by area (admin, creator, landing, charts, ui, layout ...), `lib/` hooks, schemas and helpers, `routes/` one lazy-loaded file per screen, `styles/` tokens and global CSS (every colour is a token in `tokens.css`), `vendor/wurxbase/` the vendored Paid Collabs app |
| `supabase/` | `migrations/` (every schema change, committed), `functions/` (Edge Functions and `_shared/`), `config.toml` |
| `scripts/` | `build/` guards that run inside `pnpm build`; `verify/` check suites by area (`angles`, `auth`, `backup`, `brands`, `collabs`, `creator`, `design`, `euka`, `site`, `tiktok`, `wurxbase`) plus `verify-all.mjs`; `ops/` operational scripts (`wurxbase/` inside); `seed/`; `perf/`; `shots/`; `lib/` shared helpers |
| `docs/` | The team's memory. Five canonical files at the top, then `guides/`, `plans/` and `archive/`. Start at [`docs/README.md`](docs/README.md) |
| `design/` | The PRISM brand kit (the palette source), token map, original implementation plan and screen references. See [`design/README.md`](design/README.md) |
| `public/` | Static assets served as-is: fonts, brand marks, hero media, PWA manifest and service worker |
| `CLAUDE.md` | Working rules for the coding agent and the team: protocol, security, auth and design rules |

## Documentation

Start with [`docs/README.md`](docs/README.md), which indexes every document with one line each.
The five to know:

- [`CLAUDE.md`](CLAUDE.md): conventions, security rules, auth rules, working protocol.
- [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md): where things stand.
- [`docs/PARKED.md`](docs/PARKED.md): deferred work and what brings each item back.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md): project ids, commands, deploy flow, traps.
- [`docs/FEATURE_MAP.md`](docs/FEATURE_MAP.md) and [`docs/DECISIONS.md`](docs/DECISIONS.md): how features depend on each other, and why decisions were made.

---

© Wurx Media. All rights reserved.
