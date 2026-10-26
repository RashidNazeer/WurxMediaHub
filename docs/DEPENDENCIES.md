# Dependencies

What this project needs, what each thing is for, and what is deliberately not
here. Written 2026-10-13. Companion to `docs/NEW_MACHINE.md`, which covers
setting a machine up; this file covers what gets installed and why.

**The stack is locked.** Adding, removing or swapping anything in sections 2 or
3 needs Rashid's approval. That rule exists because the alternative is a
dependency list nobody can account for, on a product that handles people's
money.

---

## 1. System tools, installed outside the project

| Tool                  | Version in use       | Notes                                              |
| --------------------- | -------------------- | -------------------------------------------------- |
| Node.js               | `v24.20.0`           | any v24 LTS is fine                                |
| pnpm                  | `11.17.0`            | pinned by `packageManager` in package.json         |
| Git                   | `2.55.0`             |                                                    |
| Supabase CLI          | `2.120.0`            | migrations, Edge Function deploys, type generation. Not in winget; install from the GitHub release zip |
| Chromium (Playwright) | installed separately | see below                                          |

```powershell
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install
pnpm exec playwright install chromium
```

**That last line is not optional.** `pnpm install` fetches the Playwright
library but not the browser binary. Skip it and every verification script fails
with a launch error that does not say "you forgot to install a browser".

The lockfile is `pnpm-lock.yaml`, lockfileVersion 9.0. The 32 packages declared
below resolve to **138** in total, counted from `node_modules/.pnpm` rather than
by reading the lockfile, which is easy to miscount. Expect that figure to move by
a few either way between machines, because some packages resolve per-platform.
Install with `--frozen-lockfile` in CI and on Vercel, which `vercel.json`
already does.

**Two of the commands above did not behave as written on the 2026-10-14 laptop**
(recorded here rather than left to be rediscovered):

- `corepack enable` fails with `EPERM` writing its shims into
  `C:\Program Files\nodejs` without an elevated shell. `corepack prepare
  pnpm@11.17.0 --activate` still works, and `npm install -g pnpm@11.17.0` also
  gives the pinned version.
- a copied `node_modules` is worse than none. pnpm's layout is symlinks, and
  copying a project folder between machines flattens them into empty
  directories, so `react/` exists and contains nothing. Delete the folder and
  install from the lockfile.

---

## 2. Runtime dependencies (17)

These ship to the browser.

### The framework

| Package        | Version   | What it is for                       |
| -------------- | --------- | ------------------------------------ |
| `react`        | `^19.2.7` |                                      |
| `react-dom`    | `^19.2.7` |                                      |
| `react-router` | `^8.3.0`  | routing, with every route code-split |

### Data and validation

| Package                 | Version    | What it is for                                                                                                                                                                                  |
| ----------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@supabase/supabase-js` | `^2.110.9` | the database, auth, realtime and storage client. **Exactly one instance exists**, created in `src/lib/supabase.ts`. Never construct another; two clients means two sessions and random logouts. |
| `@tanstack/react-query` | `^5.101.4` | all server state. There is no other state library and none is wanted.                                                                                                                           |
| `zod`                   | `^4.4.3`   | validates every input, on the client **and** again inside the Edge Function. Client-side validation is a courtesy, not a boundary.                                                              |

### Interface

| Package                    | Version    | What it is for                                                                                                                                           |
| -------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `motion`                   | `^12.42.2` | animation. Runs under `LazyMotion` in **strict** mode: use `m.div`, never `motion.div`, which throws at runtime. Hooks like `useScroll` import normally. |
| `lucide-react`             | `^1.27.0`  | icons                                                                                                                                                    |
| `class-variance-authority` | `^0.7.1`   | typed component variants, used by `Button` and friends                                                                                                   |
| `clsx`                     | `^2.1.1`   | conditional class names                                                                                                                                  |
| `tailwind-merge`           | `^3.6.0`   | resolves conflicting Tailwind classes. Both are wrapped by `cn()` in `src/lib/utils.ts`; call that rather than either directly.                          |
| `gsap`                     | `^3.15.0`  | added 2026-10-14 on Rashid's ask. **Not used by anything yet**, and it overlaps `motion`. See the DECISIONS entry before reaching for it.                |
| `lenis`                    | `^1.3.26`  | smooth scroll, added 2026-10-14 on Rashid's ask. **Not used by anything yet.** It is a second scroll authority on top of `useScroll`; read the warning below. |

**On `gsap` and `lenis`, because installing them was the easy part.** Both
arrived on 2026-10-14 at Rashid's request, which is the approval this file's
header requires. Neither is wired into a single component, and that is the state
to keep until there is a reason to change it:

- `motion` is still the animation library. Two of them on one page is double the
  bundle, on a product whose `App-*.js` is already over 1 MB for other reasons
  listed below.
- Lenis drives scrolling, and this app has already paid for scroll behaviour
  twice: the judder that turned out to be twelve beams animating on the main
  thread, and the scroll-driven depth on the landing page. Adding a second thing
  that owns the scroll position is how both come back.

`docs/DECISIONS.md`, "GSAP, Lenis and React Bits join the stack", has the
reasoning and the conversions any copied-in component needs.

### Document generation — and these four are a problem

| Package           | Version   | Used by                                                                    |
| ----------------- | --------- | -------------------------------------------------------------------------- |
| `jspdf`           | `^4.2.1`  | `src/routes/admin/contract-paper.js`, `src/vendor/wurxbase/contractPdf.js` |
| `jspdf-autotable` | `^5.0.8`  | `src/vendor/wurxbase/App.jsx`                                              |
| `xlsx`            | `^0.18.5` | `src/vendor/wurxbase/App.jsx`, `src/routes/admin/PaidCollabs.tsx`          |
| `pptxgenjs`       | `^4.0.1`  | `src/vendor/wurxbase/App.jsx`, `src/routes/admin/PaidCollabs.tsx`          |

**Every one of these is admin-only**, and they are heavy. They are a large part
of why `App-*.js` builds to **1,055 kB raw / 303 kB gzipped** — a bundle every
creator downloads on a phone to reach a screen none of them can open. Splitting
the admin side out of the creator path is the biggest outstanding performance
job on this project. It is listed as open in `docs/NEW_MACHINE.md` section 6.

Nothing here is wrong with the libraries themselves; the fault is where they are
loaded.

---

## 3. Development dependencies (15)

| Package                          | Version    | What it is for                                                                                      |
| -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `vite`                           | `^8.1.1`   | build and dev server                                                                                |
| `@vitejs/plugin-react`           | `^6.0.3`   |                                                                                                     |
| `typescript`                     | `~6.0.2`   | strict, with `noUncheckedIndexedAccess`. `arr[i]` is `T \| undefined` and the compiler will say so. |
| `tailwindcss`                    | `^4.3.3`   | v4, configured in CSS rather than a JS config file                                                  |
| `@tailwindcss/vite`              | `^4.3.3`   |                                                                                                     |
| `postcss`                        | `^8.5.26`  |                                                                                                     |
| `oxlint`                         | `^1.71.0`  | linting. Fast; the warnings it reports in `src/vendor/` are pre-existing and expected.              |
| `prettier`                       | `^3.9.6`   | formatting                                                                                          |
| `prettier-plugin-tailwindcss`    | `^0.8.1`   | sorts class names so diffs stay readable                                                            |
| `playwright`                     | `^1.62.0`  | drives real Chromium for every verification script                                                  |
| `@tanstack/react-query-devtools` | `^5.101.4` |                                                                                                     |
| `@types/node`                    | `^24.13.2` |                                                                                                     |
| `@types/react`                   | `^19.2.17` |                                                                                                     |
| `@types/react-dom`               | `^19.2.3`  |                                                                                                     |
| `jsrepo`                         | `^3.8.1`   | fetches one React Bits component's source into the repo. A fetcher, not a library; nothing ships from it. |

---

## 4. Edge Functions run on Deno, not Node

The 21 functions under `supabase/functions/` do **not** use `package.json` at
all. Deno resolves their imports directly, and across all of them there are only
two:

```
npm:@supabase/supabase-js
npm:zod
```

So a function's dependencies cannot be installed or audited by `pnpm`. Deploy
with the Supabase CLI:

```powershell
supabase functions deploy <name> --project-ref qinxwfdwvpkzfhcijuqw
```

Service-role keys live in Edge Function secrets and nowhere else. They never
appear in `.env`, never in the browser bundle, and never on disk.

---

## 5. Things that are in the repository but are not packages

**`src/vendor/wurxbase/` — 13 vendored files.** The Paid Collabs admin app,
copied in rather than installed. `scripts/check-isolation.mjs` counts these and
fails the build if the number changes unexpectedly. Our additions to those files
are fenced `WURX-ADDED ... WURX-END` and re-applied by
`scripts/wurxbase-patches.mjs` after a new copy is pulled in, so the vendored
code is always "theirs, plus exactly these blocks".

**Fonts.** Caprasimo and Figtree are self-hosted in `public/fonts/` as `.woff2`,
preloaded in `index.html`. No Google Fonts request at runtime: no third party,
no render-blocking round trip.

**Icons and the manifest.** `public/icons/`, `public/manifest.webmanifest` and
`public/sw.js` are hand-written and hand-rendered. No PWA plugin.

---

## 6. What is deliberately NOT here

Worth knowing before you reach for one of these, because the absence is a
decision rather than an oversight.

| Not used                                      | Why                                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Next.js**                                   | Explicitly excluded by `CLAUDE.md`. This is a Vite SPA.                                                                                                                                                       |
| **Any ORM**                                   | Queries go through `supabase-js` against a schema that RLS protects. An ORM would add a second opinion about access.                                                                                          |
| **Redux / Zustand / Jotai**                   | TanStack Query holds server state; React holds the rest. Adding a state library is how the session ends up duplicated.                                                                                        |
| **A charting library**                        | Every chart is inline SVG. A dependency for two charts is a poor trade, and this way the marks obey the same `--wx-*` tokens and the same user text-size setting as everything else. See `VelocityChart.tsx`. |
| **An image library** (`sharp`, `jimp`)        | The app icons are rendered by Chromium through Playwright, which is already installed. The source is an SVG, so a real renderer was the right tool anyway.                                                    |
| **A PWA plugin** (`vite-plugin-pwa`, Workbox) | The manifest is 40 lines and the service worker is deliberately almost inert. A plugin would have precached the 1 MB admin bundle by default, which is the exact opposite of what this app needs.             |
| **A component library beyond shadcn/ui**      | shadcn is copied in and themed, not installed. React Bits is the same shape: `jsrepo` copies one component's source in and there is no React Bits package in the bundle. Running `shadcn init` here is a separate matter and is ruled out — see `Redesign UI/IMPLEMENTATION_PLAN.md` 1.2. |
| **A test runner**                             | There is no unit test suite. Verification is done by the 125 scripts in `scripts/`, which drive a real browser and a real database. That is a real gap, not a claim that tests are unnecessary.               |

---

## 7. Keeping it honest

- `pnpm build` runs the token guards, `tsc` and the Vite build. It must pass
  before any commit.
- `scripts/check-isolation.mjs` proves there is one Supabase client, one schema
  and the expected count of vendored files. It runs inside the build.
- Adding a dependency means updating this file in the same commit, with what it
  is for and whether it reaches the creator bundle. A list that drifts is worse
  than no list, because people trust it.
