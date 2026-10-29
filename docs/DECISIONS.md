# Decisions

Dated one-liners. Why, not just what. Newest at the bottom.

---

- 2026-07-28: Stack locked by Rashid, React + Vite + TS strict, Tailwind +
  shadcn/ui, TanStack Query, React Router, Supabase only, Vercel, pnpm. No
  Next.js (his previous Next builds felt slow).
- 2026-07-28: Claude drives all CLIs with scoped tokens from
  `C:\Users\RA_shid\.wurx\cli-secrets.env`, never `*/login` commands, Rashid
  has another project signed in on GitHub/Supabase/Vercel and it must not be
  disturbed. GitHub uses a fine-grained token locked to this one repo; Vercel
  and Supabase tokens are account-wide because neither offers per-project
  tokens (Rashid accepted this, both set to expire in 90 days).
- 2026-07-28: Two Supabase projects in a dedicated "Wurx Media" org rather than
  one project with two schemas, "prod is sacred" is only real if prod is a
  separate database.
- 2026-07-28: Supabase project settings, `Enable automatic RLS` ON (forces RLS
  on every new table, matching our deny-by-default rule) and `Automatically
expose new tables` OFF (grants are explicit per table, in the migration).
  Both projects configured identically.
- 2026-07-28: Brand palette taken from wurxmedia.com's own stylesheet rather
  than invented, near-black `#0a0a0a`, gold `#c8924b`, cream `#f5efe1`,
  Archivo Black / Inter / JetBrains Mono.
- 2026-07-28: Light mode uses a darkened gold `#8a5f1f` instead of the brand
  `#c8924b`. The brand gold is only 2.58:1 on a light background, it would
  have been unreadable. Dark mode keeps the true brand gold at 7.23:1.
- 2026-07-28: `scripts/build/check-contrast.mjs` runs inside `pnpm build` and fails
  the build on (a) a token defined in one theme but not the other, or (b) any
  text/background pair below WCAG AA. Rashid's standing instruction: dark and
  light must never mismatch, so it is enforced mechanically rather than by
  memory.
- 2026-07-28: `noPropertyAccessFromIndexSignature` deliberately NOT enabled
  despite otherwise-strict TypeScript. It forces `import.meta.env['VITE_X']`,
  and Vite only statically replaces the dot form, the bracket form would
  silently be `undefined` in production.
- 2026-07-28: Use Supabase's new **publishable** key (`sb_publishable_...`) via
  `VITE_SUPABASE_PUBLISHABLE_KEY`, not the legacy `eyJ...` anon JWT. Both were
  tested live against `/auth/v1/settings` and both return 200, but the legacy
  keys are on Supabase's deprecation path and this product is meant to run for
  years. Swapping back is a one-line env change if anything ever needs it.
- 2026-07-28: Git in this repo uses a local credential helper that reads
  `GH_TOKEN` from the environment, with an empty helper entry ahead of it to
  reset the inherited Windows Credential Manager. Verified by negative test: an
  invalid token now fails the push instead of silently falling back to Rashid's
  stored GitHub login.
- 2026-07-28: Playwright added as a dev dependency. Rashid cannot debug in a
  console, so "zero console errors" has to be machine-verified; section 11's
  auth-stability tests (idle refresh, two tabs, refresh mid-form) will need it
  too.
- 2026-07-29: Git commit identity is
  `286085480+RashidNazeer@users.noreply.github.com`, not Rashid's personal
  email. GitHub maps that personal email to a _different_ account (`TSRashid`),
  and Vercel's Hobby plan BLOCKS any deployment whose commit author it cannot
  match to the connected account, every deploy failed with state `BLOCKED`
  until this was corrected. Do not change `user.email` in this repo.
- 2026-07-29: Both Vercel projects build from the one repo, so each has an
  Ignored Build Step so it only builds its own branch (`wurxmediahub` -> `main`,
  `wurxmediahubdev` -> `dev`). Without it every push built twice.
- 2026-07-29: `wurxmediahubdev.vercel.app` is pinned to the `dev` git branch via
  the domains API. Vercel's public API does not expose the "Production Branch"
  setting, so this is the CLI-drivable equivalent and avoids sending Rashid back
  to the dashboard.
- 2026-07-29: Vercel Authentication (`ssoProtection`) turned OFF on both
  projects. It defaulted to `all_except_custom_domains`, which would have put
  both `.vercel.app` URLs behind a Vercel login, Rashid could not have tested
  them, and the public landing page must be reachable. The shell ships with
  `<meta name="robots" content="noindex">`. Say the word and dev goes back
  behind protection.
- 2026-07-29: Roadmap reordered by Rashid, the public landing page (Step 2) is
  built before auth (Step 1). Auth follows.
- 2026-07-29: Prod frozen. Everything pushes to `dev` only until Rashid says
  "make it live". `main` is not to be touched.
- 2026-07-29: Display font changed from **Archivo Black** to **Fustat**. Rashid
  rejected Archivo Black as looking AI-generated. He pointed at medialabs-co.com
  as the reference; their stylesheet was read directly and uses
  `h1..h4 { font-family: Fustat; font-weight: 700; letter-spacing: -0.02em;
line-height: 1.08 }` with Inter for body. We adopted the same recipe, applied
  once in global.css rather than per component. Archivo Black is a poster face, at 5rem it reads as a template, which is exactly what Rashid objected to.
- 2026-07-29: The hero carries an example "My Numbers" dashboard card. A hero
  that is text-only with a large empty right side is the clearest tell of a
  generated page, and the product's whole pitch is "you get a dashboard, not a
  screenshot", so showing it beats describing it. The card is labelled
  **Example** and uses invented figures; it must never be presented as a real
  creator's data.
- 2026-07-29: Landing page marketing numbers (100M+ revenue, 5K+ creators,
  2B+ views) supplied and confirmed by Rashid. The "Official TikTok Partner"
  claim from the MediaLabs reference was deliberately NOT copied, Rashid
  confirmed Wurx is not one.
- 2026-07-29: Brand logos in `src/content/site.ts` are placeholders and flagged
  as such in the file. Real partner names were not invented.
- 2026-07-29: Large display numbers use `.wx-lining`, not `.wx-numeric`. Fustat
  renders the tabular comma at full digit width, so tabular figures turned
  `$48,920` into `$48 , 920`. Tabular is still correct for leaderboards and data
  tables where digits must align between rows.
- 2026-07-29: `MotionConfig reducedMotion="user"` wraps the app. The
  prefers-reduced-motion media query in global.css only governs CSS
  transitions; Motion animates in JavaScript and would otherwise ignore it.
- 2026-07-29: The hero right column is the application form, not the example
  dashboard card. Rashid's call, the form is the conversion point, so it goes
  above the fold. `NumbersPreview.tsx` was deleted; it is in git history and can
  come back into the Platform section if wanted.
- 2026-07-29: Hero now has ONE secondary button ("See how it works", size xl).
  "Apply to join" was removed because the form is right there; every other Apply
  CTA on the page scrolls to `#apply` instead of routing away.
- 2026-07-29: `/apply` still exists as a standalone route rendering the SAME
  `<ApplyForm />`, so a direct link from a DM or email lands somewhere focused.
  One form component, two placements, never two copies.
- 2026-07-29: Container widened to `max-w-7xl` with `px-5 sm:px-8`. At Rashid's
  ~1280px viewport the old `max-w-6xl` left a thin strip of dead margin.
- 2026-07-29: The application Zod schema lives in
  `src/lib/schemas/application.ts`, deliberately separate from the component,
  because Step 3's Edge Function will import the same file and re-validate
  server-side. Client validation is convenience; the server is the boundary.
- 2026-07-29: **Form is not wired to a database.** Submitting validates and
  shows a success panel that says so explicitly. It must keep saying so until
  Step 3 lands, a success message for an application nobody received would be
  a lie to a real creator.
- 2026-07-29: Landing page weight noted at ~182 KB gzip JS/CSS + ~102 KB fonts.
  The single biggest item is Zod at roughly 60 KB gzip inside the ApplyForm
  chunk. Not acted on yet. Fix at Step 3, when the schema is final: either
  switch to `zod/mini` or dynamic-import the schema so it is off the landing
  page's critical path.
- 2026-07-29: **No web fonts.** Rashid asked for lower page weight and said he
  never meant to copy a specific typeface, only to have something professional.
  Fustat + Inter + JetBrains Mono cost 102 KB and a render-blocking round trip
  to Google. Replaced with system stacks that resolve to Segoe UI Variable
  Display / SF Pro Display / Roboto. Zero bytes, and they are the faces Windows
  and macOS use for their own interfaces.
- 2026-07-29: Zod moved off the landing page's critical path. The schema file
  is now split: `application-fields.ts` (option lists and types, Zod-free) is
  imported normally, `application.ts` (the Zod schema) is dynamically imported
  on first submit. Saves ~16 KB gzipped on initial load and costs nothing,
  because nobody needs a validator before they press the button.
- 2026-07-29: Motion switched to `LazyMotion` + `domAnimation` with `strict`,
  and every `motion.x` became `m.x`. Cut the form chunk from 44 KB to 8 KB
  gzipped. `strict` makes the heavy `motion.x` throw, so it cannot creep back
  in. Verified `whileInView` still works via the existing browser test.
- 2026-07-29: Landing page initial download went from roughly 284 KB (182 KB
  JS/CSS + 102 KB fonts) to roughly 159 KB, a 44% cut.
- 2026-07-29: Real partner logos, taken from the marquee on wurxmedia.com.
  The originals were PNGs wrapped in SVG, 315 KB in total including a 2048x2048
  bitmap for a 38px slot. They were unwrapped, cropped to their artwork and
  downscaled to roughly 50 KB, all with Node and Windows' built-in imaging, so
  no image-processing dependency was added.
- 2026-07-29: Partner logos are white artwork on OPAQUE BLACK, so they cannot
  simply be drawn on a light page. `.wx-logo` blends instead: `screen` in dark
  (the black drops out), `invert(1)` then `multiply` in light (the white drops
  out). `.wx-marquee` paints its own background because `mask-image` creates a
  stacking context that would otherwise isolate the blend.
- 2026-07-29: The marquee is pure CSS: the logo list is rendered twice and the
  track slides exactly -50%. No animation library, no scroll listener. It pauses
  on hover and is disabled entirely under prefers-reduced-motion.
- 2026-07-29: Now using the real Wurx Media logo (mascot + wordmark) from
  wurxmedia.com, downscaled from 1641x460 / 125 KB to 228x64 / 11 KB. It is
  cream artwork drawn for dark backgrounds, so light mode darkens it via
  `--wx-mark-filter: brightness(0.32)`; brightness multiplies each channel, so
  the mascot keeps its internal contrast instead of flattening to a silhouette.
  `public/favicon.svg` still shows the older geometric "W" and does not match.
- 2026-07-29: **No em dashes or en dashes in the app.** Rashid's standing
  instruction. Watch for this when writing new copy.
  **Scope corrected 2026-08-24**, after I offered to sweep 87 lines out of four
  docs and he stopped me: the rule is about what a person using the product
  reads, not about `docs/`. Those are written for the agent, so they are exempt
  and must not be swept. The original wording said "anywhere", which read as
  covering the docs too and would have cost an afternoon of pointless rewriting.
- 2026-07-29: Auth is email and password only for now. Rashid chose it to keep
  moving; email-code sign-in is PARKED, not rejected.
- 2026-07-29: Applying will create an account. An anonymous application form
  cannot show status, cannot update live when a decision is made (which Step 4
  requires), and has to be matched back to an account by email later, which
  breaks the moment someone signs up with a different address.
- 2026-07-29: Role and tier live in `profiles` and are copied into the JWT by
  `custom_access_token_hook`. Policies read a claim instead of querying the
  table on every request. The trade-off, written down so it is not forgotten: a
  token is only reissued about once an hour, so a role change does not reach the
  claim immediately. Anything that must apply instantly, like suspending an
  account, has to read the table.
- 2026-07-29: Self-promotion to admin is blocked three separate ways: no INSERT
  grant, a column-level UPDATE grant covering `display_name` only, and a
  BEFORE UPDATE trigger. Belt, braces and a second pair of braces, because this
  is the one bug that would be catastrophic and silent.
- 2026-07-29: Found while writing `check-rls.mjs`: turning off "automatically
  expose new tables" also disables Supabase's default grants to `service_role`,
  not just to `anon` and `authenticated`. Every Edge Function in Steps 3 and 4
  would have silently read nothing. Fixed by an explicit grant plus a default
  privilege for future tables.
- 2026-07-29: `password_min_length` raised from Supabase's default 6 to 10, and
  the client schema matches it. Length beats forced symbols.
- 2026-07-29: `AuthProvider` imports the Supabase client dynamically. A static
  import put the whole client (~55 KB gzipped) into the entry chunk, so someone
  reading the marketing page downloaded a database client they never used. Vite
  `manualChunks` also splits Supabase away from TanStack Query, because Query is
  on the critical path and bundling them together silently undid the fix.
- 2026-07-29: Password reset deliberately shows the same confirmation whether or
  not the email exists. Saying "no account found" would let anyone test which of
  our creators are registered.
- 2026-07-29: **The hero form on the landing page IS the sign up.** Rashid asked
  what the point of the form was if people still had to go to a separate signup
  page. He offered two options: add a password to the hero form, or replace the
  form with the steps and move it to its own page. Took the first: the design was
  already approved, it is one extra field, and it keeps the pitch and the
  conversion point together. `/signup` and `/apply` now render that same form.
  The old account-only SignUp page was deleted; it collected less information
  and would have created accounts with no application.
- 2026-07-29: One password field with a show/hide toggle, no "confirm password".
  Letting someone check what they typed solves the same problem with one field
  instead of two, which matters in an already long form.
- 2026-07-29: "Apply" in the header now scrolls to the form AND focuses its
  first input. Rashid reported it doing nothing: on a desktop the form is
  already on screen, so scrolling to it was invisible.
- 2026-07-29: Sign up and application insert are two separate writes rather than
  one atomic transaction. If the second fails the account still exists, and the
  dashboard offers to finish the application, so nobody is stranded. Doing it
  atomically would mean stuffing the whole application into auth user metadata,
  which is worse: it lives in the auth schema forever and is harder to query.
- 2026-07-29: `applications.worked_with_wurx` is its own indexed boolean column
  rather than being buried in a notes field, because Rashid flagged it as
  important for fast-tracking existing Wurx creators during review.
- 2026-07-29: Realtime enabled on `applications` with `replica identity full`,
  scoped per user. Row level security still applies to realtime, so an applicant
  only ever receives events for their own row. This is what makes Step 4's live
  status change work.
- 2026-07-28: Content-Security-Policy deferred. The anti-flash theme script is
  inline and Motion injects inline styles, so a correct CSP needs script hashes
  and careful testing. Other security headers (HSTS, nosniff, frame-deny,
  referrer, permissions policy) ship now in `vercel.json`. **Revisit before the
  first prod launch.**
- 2026-07-29: Approvals go through an Edge Function that re-reads the caller's
  role from `profiles` rather than trusting the `user_role` JWT claim. A claim
  is only refreshed with the token, so an admin suspended five minutes ago is
  still carrying an admin claim. The table is the truth for anything
  privileged; the claim is only for deciding which screen to draw.
- 2026-07-29: The whole decision lives in one `security definer` Postgres
  function, `review_application()`, granted to `service_role` only. Status,
  role, tier and the audit row commit together or not at all. Three REST calls
  from the Edge Function could leave someone approved on one screen and an
  applicant on another, and the `profiles_tier_only_for_creators` constraint
  would reject the half-way state anyway.
- 2026-07-29: `audit_log` gets a staff SELECT policy and **no** insert, update
  or delete grant to `authenticated`. Only security definer functions running as
  `service_role` write it. An audit trail an admin can edit is not an audit
  trail. A blocked review attempt is logged too, with the caller's name on it.
- 2026-07-29: A rejection leaves the account exactly as it is (still an
  applicant, nothing deleted) rather than disabling it, so a decision can be
  revisited by hand and the history survives.
- 2026-07-29: Edge Function CORS echoes `Access-Control-Request-Headers` instead
  of naming a fixed list. Found the hard way: our Supabase client sends a custom
  `x-application-name` header, the static list did not mention it, the preflight
  failed, and approving an application silently did nothing. Preflight decides
  which headers a browser may send, not who is allowed in, so echoing costs no
  security.
- 2026-07-29: Admin queue filters live in the URL, not component state, so a
  reviewer can send a colleague a link to the same view and the back button
  behaves after opening an application.
- 2026-07-29: `AppShell` and `Dashboard` now prefer `profile.role` over
  `claims.role` for display. Otherwise a creator approved a minute ago keeps
  being shown as an applicant until their token refreshes, up to an hour later,
  while their status card already says approved.
- 2026-07-30: Signed-in screens moved from a top bar to a **vertical sidebar**,
  Rashid's call. The product has a lot of sections still to come (brand hubs,
  numbers, leaderboards, offers, uploads) and a top bar has nowhere to put them.
  Sections that do not exist yet are listed, tagged with the step that brings
  them, and deliberately are not links.
- 2026-07-30: `/` redirects a signed-in visitor to their own home, but only if
  they were ALREADY signed in when the page opened. Redirecting on "signed in
  right now" fires during sign up, before the application row is written.
- 2026-07-30: `/signup` moved OUT of the `RedirectIfSignedIn` guard and is now a
  plain alias of `/apply`. That guard fired the moment sign up returned, which
  is before the application insert lands. The dashboard mounted, asked whether
  an application existed, was correctly told no, and cached it for 30 seconds,
  so someone who had just applied was told to "Finish your application".
  Reproduced 3 times in 8 runs and caught on the wire: the GET went out 19ms
  before the POST.
- 2026-07-30: `useApplication` never treats `null` as settled. It re-checks
  every 3 seconds until a row appears. "You have no application" is the one
  answer that can be a lie, and a stale one strands a new creator on a screen
  telling them to start again.
- 2026-07-30: Staff sign in at `/admin/login`, their own screen, Rashid's call.
  The team should not be greeted by a page selling them on applying, and no sign
  up link belongs anywhere near it. Signed-out visits to any `/admin` route land
  there instead of `/login`, so signing out of the panel returns you to the
  right door. It is a different DOOR, not a different LOCK: both screens call
  the same sign in, and permission is still decided by row level security and
  the Edge Function's server-side role check. A creator who signs in there is
  simply sent to their own dashboard rather than told off. Nothing about which
  URL was used is ever treated as a security boundary.
- 2026-07-30: Counts moved off the queue onto a Dashboard screen at `/admin`,
  Rashid's call. The queue is for working through applications, so it should
  open on the list rather than push it below a row of tiles. The queue is now
  `/admin/applications` and the tabs carry their own small counts.
- 2026-07-30: Pending rows show an action menu (view TikTok, approve, reject)
  instead of a "pending" badge. On the Pending tab that badge told you something
  you had already filtered by, so the space was better spent on the decision.
- 2026-07-30: Bulk approve and reject added, as a server-side loop over
  `review_application` rather than a bulk SQL statement. Each application keeps
  its own transaction and its own audit row, so one failure cannot roll back
  nine successes and nothing can slip through unlogged. Capped at 100.
- 2026-07-30: The email came out of the queue row. The handle identifies a
  creator; the email is on the detail screen where it is actually needed, and
  dropping it made every row shorter, which is the point of a queue.
- 2026-07-30: The desktop sidebar collapses to icons, remembered in
  localStorage, and the theme toggle moved to the top bar on the right. The
  collapse control lives in the top bar rather than the rail, because at 72px
  the rail has no room for it and it would disappear exactly when you needed it
  to bring the labels back.
- 2026-07-30: `scripts/verify/design/check-responsive.mjs` checks every screen at 375, 768,
  1024 and 1440px. Rashid's creators are mostly on phones and tablets, so this
  is enforced mechanically rather than by remembering to look.
- 2026-07-30: Modals scroll inside themselves rather than inside a
  `fixed inset-0 flex items-center` wrapper. Found by review and reproduced in
  Chromium: with the scroll on the wrapper, a dialog taller than the viewport
  overflowed past the container's top edge, which is not part of the scrollable
  region, so on a 375x554 phone the heading sat 114px above the screen with a
  maximum scroll offset of zero. The confirm button stayed visible, so nothing
  hinted that anything was missing.
- 2026-07-30: Tap targets on the queue are padded to roughly 40px with a
  wrapping `<label>` while the drawn checkbox stays 16px. A 16px target sitting
  on top of a full-row navigation link is a coin flip on a phone, and losing it
  opens the application instead of ticking it.
- 2026-07-30: `useFocusTrap` is shared by the review dialog and the mobile
  drawer. Both cover the page, and both previously let Tab walk into content
  behind the scrim. Initial focus goes to the first real control, not the close
  button, so a keyboard user does not open a form parked on the exit.
- 2026-07-30: `text-faint` is banned on `bg-surface-2` (4.31:1 in light mode,
  under AA). It is not added to the contrast guard's PAIRS list, because adding
  a knowingly failing pair would just break the build; it is recorded as a
  comment there instead, and the guard already checks the `text-muted`
  replacement.
- 2026-07-30: The one-time creator moments (welcome on joining, congratulations
  on approval) are recorded as timestamps on `profiles`, not in localStorage.
  Rashid asked specifically that these fire once and never again, and browser
  storage cannot promise that: a creator applies on a phone and signs in on a
  laptop, and a cache clear would replay the celebration. Timestamps rather than
  booleans, because "how long between applying and being told" is worth being
  able to answer later.
- 2026-07-30: Those two columns are granted to `authenticated` at column level.
  The worst a tampered value does is skip or repeat an animation on the
  attacker's own screen, nothing reads them for a permission decision, and
  `pnpm verify:rls` now proves the grant did not open a side door to role.
- 2026-07-30: The onboarding overlays have no Escape, no backdrop dismiss and no
  close cross. The button is the acknowledgement, and the moment happens once in
  a creator's life, so an accidental tap outside must not spend it.
- 2026-07-30: Account details moved off the creator dashboard to `/app/profile`.
  The home screen should be about where they stand with us, not about an email
  address they already know. The scratch note used by the session test is gone;
  that test now types into the real display-name field instead, which proves the
  same thing about a form creators actually use.
- 2026-07-30: The sidebar user block is an avatar, a name, an email and a sign
  out icon on one row. It previously stacked a role chip and a tier chip, which
  on a new creator read "CREATOR CREATOR" because the role and the starting tier
  share a word. Role and tier belong on the profile screen.
- 2026-07-30: Brand Hub, phase one. `brands` and `offers`, admin side only.
  Creators get NO read access to either yet, on purpose: `brands` holds the
  allocated budget and the client's name, and column level SELECT grants cannot
  separate staff from creators because both are `authenticated`. The creator
  read path will be a column-limited view written against the real
  requirements. Shipping a guess at it today would be shipping an untested way
  to leak a budget.
- 2026-07-30: All brand and offer writes go through the `manage-brand` Edge
  Function into `save_brand` / `save_offer` / `delete_offer`. Neither table has
  any write policy at all, so there is exactly one door. CLAUDE.md names brand
  edits as a privileged action; this is that.
- 2026-07-30: Money is `numeric(14,2)`, never a float, and PostgREST hands it
  back as a string. `money()` parses only for display. A float cannot hold 0.10
  exactly, and these columns decide what people are paid.
- 2026-07-30: A brand's slug is generated from its name once, at creation, and
  never regenerated on rename. Creators will hold brand hub links and a rename
  must not break every one of them.
- 2026-07-30: `store_id` is unique. Two brands sharing one TikTok Shop store is
  always a mistake, and the Edge Function turns the constraint violation into
  "Another brand already uses that store id" rather than a Postgres error.
- 2026-07-30: `offers.needs_application` defaults to true, so an offer that pays
  out with nobody signing it off has to be chosen deliberately.
- 2026-07-30: Brands are retired with `is_active`, not deleted. Offers can be
  deleted, and `delete_offer` writes the audit row before the delete so the
  record outlives the row.
- 2026-07-30: No adversarial multi-agent review on this feature. Rashid asked
  that expensive review runs be reserved for where they add something, and the
  project rules it would re-check are already established and followed. The new
  security surface is covered instead by `scripts/verify/brands/check-brands.mjs`, which
  attacks both tables, both database functions and the Edge Function as a real
  signed-in creator, and keeps doing so on every run.
- 2026-07-30: Admin content is left aligned against the sidebar, not centred.
  Rashid saw it zoomed out: centred content leaves a wide gap next to the rail
  and the two halves stop looking like one page. Capped width hugging the left
  behaves at every size, which is also how every dashboard people already use
  behaves.
- 2026-07-30: The Brand Hub opens on **Offers**, and the brand's facts moved to
  their own **Overview** tab. Somebody opening a brand is there to manage its
  offers; landing them on a summary they already know, then making them scroll
  past it, was the wrong order. Overview is listed first because that is the
  conventional place for it, but it is not where you land.
- 2026-07-30: The brand slug is no longer shown in the hub header. An admin has
  no use for a route, and it was taking a line to say nothing. It is still
  generated and stored for the creator-facing URLs.
- 2026-07-30: **The client name and the allocated budget moved off `brands`
  into their own staff-only table, `brand_commercials`.** Opening brands to
  creators needed one of two things: a column-limited view over `brands`, or
  splitting the commercial columns out. The split won because it removes the
  failure mode rather than guarding it. With a view, the budget is still one
  careless policy away from a creator, and every future creator-facing read has
  to remember to use the view. With the split there is no budget column on
  anything a creator can reach, RLS on `brands` stays real row security instead
  of a definer view bypassing it, and a mistake has to be deliberate: somebody
  would have to grant access to a table called "commercials". Cost was one data
  migration and a flatten in `useBrands.ts`.
- 2026-07-30: Creator read access is gated by `is_approved_creator()`, which
  reads the `profiles` table, not by `is_staff()`, which reads the JWT claim.
  Approval happens live and often; a token is up to an hour stale. Gating on
  the claim would mean a creator watches the approval confetti, clicks into
  brand hubs, and finds them empty. Staff roles effectively never change, so
  `is_staff()` staying claim-based is fine.
- 2026-07-30: Brand logos and product images upload to a public Supabase
  Storage bucket rather than being pasted in as URLs. An admin has a file, not
  a link, so a URL field would have been a dead end. Public read because these
  pictures are already on a public TikTok Shop listing and signed URLs would
  make every card wait on a token. **SVG is excluded from the allowed types:**
  it can carry script, and a logo does not need it.
- 2026-07-30: The brand's About tab writes through its own `brand.about`
  action, not through `brand.save` with three extra fields. The About form owns
  three fields and should not be able to overwrite the name, the store id or
  the budget by posting a stale copy of them back alongside its own edit.
- 2026-07-30: The creator Brand Hub opens on **Overview**, the opposite of the
  admin hub's default. Deliberate, not an inconsistency: an admin opens a brand
  to work on it, a creator opens it to decide whether they want it, and that
  decision is made on the brand and its products.
- 2026-07-30: Applying for an offer was left out of this step and its buttons
  ship visibly disabled, saying "Opens next". Applying needs its own table, a
  creator form and an admin approve/reject queue, which is a step in itself.
  Shipping a live-looking button that silently does nothing would be worse than
  admitting it is not ready.
- 2026-07-31: A creator can counter an offer, not just accept it, and both are
  one row in `offer_applications`. An offer is an opening position rather than a
  contract, and a creator worth more than the sticker price should be able to
  say so inside the product instead of leaving to send a DM. It also collapses
  what would otherwise be two features: the "custom offer" Rashid described is
  just a counter against an offer with no fixed terms.
- 2026-07-31, later the same day: **REVERSED by Rashid. A creator takes an offer
  as it is written and cannot name their own price.** Commercially his call, not
  a technical one. `apply_for_offer` no longer accepts the two numbers, so
  nothing can write them; the columns and the admin rendering were kept, because
  requests made during the window carry real figures and the queue must not
  later claim they were taken as written. A create request that still carries
  its own numbers is refused with a sentence rather than quietly stripped: it
  can only be a stale browser tab, and the alternative is agreeing somebody to a
  price they did not type.
- 2026-07-31: The two counter offer columns were dropped rather than kept, once
  Rashid confirmed everything is on dev and a count found zero rows carrying a
  creator-set price. The reason for keeping them was to avoid restating what
  somebody had really asked for; with no such rows, all that was left was dead
  columns and dead screen code on a table payments will hang off. The drop then
  broke `review_offer_application`, silently, because plpgsql resolves field
  names at run time: worth remembering before the next one.
- 2026-07-31: Every Playwright suite launches through `scripts/lib/browser.mjs`
  rather than `chromium.launch()`. Not a test-quality decision, a machine one:
  7.4 GB of RAM with VS Code already on most of it meant a default launch was
  getting the editor's extension host killed mid-run, which looked like Claude
  hanging. Suites are also run detached with their output to a file, so a dead
  editor cannot lose a run or strand test accounts.
- 2026-07-31: An offer that needs an application but has no written terms can
  still be applied for. Requiring terms on such an offer is a rule enforced on
  the admin's side, and refusing a creator because an admin left a field empty
  punishes the wrong person.
- 2026-07-31: `proposed_video_count` and `proposed_amount` stay NULL when a
  creator takes an offer as written, rather than being filled with the offer's
  own numbers. The two look identical on the day and diverge the moment an admin
  edits the offer, and only one of them is true afterwards.
- 2026-07-31: The unique index on (offer, creator) is partial, covering pending
  and approved only. A plain unique constraint would have banned a rejected
  creator from that offer permanently, which defeats the point of letting them
  name a price.
- 2026-07-31: `manage-offer-application` checks the caller's role PER ACTION
  rather than once at the top. It is the first door both creators and staff use,
  and a single gate would have had to be the loosest of the two.
- 2026-07-31: The creator's identity is snapshotted onto each request
  (handle, name, email), the same way `audit_log` snapshots its actor. Search
  becomes one trigram index on one table instead of a join across three, and the
  queue still reads correctly after a rename or a closed account.
- 2026-07-31: An offer with pending or approved requests cannot be deleted.
  Settled ones cascade and the audit log keeps them. Deleting an offer somebody
  is waiting on is how you lose a creator.
- 2026-07-31: The creator hub header was cut from a tall card to one compact
  row, and the offer cards lost their status chip and their "no fixed
  deliverable or fee" line. Rashid's note, and he is right: the header repeated
  what Overview says better while pushing the real content off the first screen,
  the chip said the same thing as the button under it, and a line explaining the
  absence of something nobody asked about is worse than silence.
- 2026-08-11: The creator home was rebuilt from a design Rashid approved and
  asked for pixel for pixel. Four things came with it, each changing a rule
  written earlier in this file.
- 2026-08-11: The surfaces moved. Near-black `#0a0a0a` became `#100e0c` and the
  paper `#faf8f3` became `#f6f4f1`, with the greys warmed to match, because the
  old ones drifted blue next to the gold. The brand gold itself is UNCHANGED and
  so is the landing page's identity. Adopted globally rather than only on the
  dashboard: the sidebar sits against these cards, and a card a different colour
  from the rail beside it reads as a bug, not a redesign.
- 2026-08-11: Money state has its own three colours, `--wx-stage-live` (indigo),
  `--wx-stage-due` (amber) and `--wx-stage-paid` (green), instead of borrowing
  accent/warning/success. The borrowed set collides in light mode, which is the
  bug this file already records once. The design's amber was 3.48:1 on a nested
  card, so all three were darkened until they clear AA on the tightest surface
  they sit on, and the guard now enforces it.
- 2026-08-11: Two self-hosted variable fonts, Instrument Sans and Sora, scoped
  to `.wx-app` so only signed-in screens pull them. 23 KB for both latin
  subsets, from our own origin, no third party. The "system fonts only" rule
  stays true where it was actually measured, the public landing page.
- 2026-08-11: The first-day empty state is a lazily loaded chunk. Imported
  directly it dragged the apply dialog and the whole Zod schema chunk onto the
  home screen of every creator who already has work, and `verify:responsive`
  caught it as a 375px timeout before it shipped.
- 2026-07-28: Flagged to Rashid but not acted on, (a) a Vite SPA has no
  server-rendering, so the public landing page will be weak for SEO and link
  previews until we add a build-time prerender; (b) the Supabase free tier
  pauses inactive projects and has no daily backups, so prod needs a paid plan
  before real creators use it.
- 2026-08-11: **The deal freezes at approval, both halves of it.** The reward
  already snapshotted onto the request; the number of videos now does too
  (`committed_video_count`). Rashid's words: once we have approved, an admin
  should never be able to edit the number of deliverables. Re-scoping or
  re-pricing an offer therefore applies to whoever is approved next, and
  everybody already filming keeps the deal they agreed. He clarified the word
  himself when it looked too broad: the BRAND'S BUDGET is not frozen and nothing
  here touches it, approvals carry on adding to it exactly as before.
- 2026-08-11: **An offer nobody has to apply for is never counted towards an
  offer.** Rashid's rule. It has no job behind it, so it can take no video and
  shows no progress, and the brand hub's "No application needed. Start posting
  whenever you are ready" was deleted because it was simply false. Rejected the
  alternative, making open offers create a job row automatically: it would start
  spending a brand's budget with no staff decision in front of it, which is a
  commercial change and not one for the software to make.
- 2026-08-11: **Progress is decided by whether a JOB exists, never by the
  `needs_application` flag.** Same rule `stateFor` already followed from the
  other side after an admin flipping that flag once hid the stage, tracker and
  money of somebody already working. The draft plan had it the other way round
  and an adversarial reviewer caught it before it was built.
- 2026-08-11: **`job_progress` is the project's first database view, and it is
  `security_invoker`.** Every cross-table number until now was assembled in a
  browser, which is why two screens could disagree. A view runs as its owner by
  default and would have bypassed row security on both tables underneath. It is
  safe to share between both sides only because a job belongs to exactly one
  creator, so the count is complete rather than silently narrowed; an offer
  level count over the same tables returns a creator their own row and calls it
  the total, with no error at all. Job level only, forever.
- 2026-08-11: **A job can no longer be stranded at "all filmed".**
  `review_content` advanced only from `sample_shipped` and `content_pending`, so
  approving the last video of a job still sitting at "sample requested" left it
  finished-but-not-finished with nothing left that could ever fix it. It now
  advances from any stage before content completed, `set_offer_stage` re-checks
  on arrival, and taking an approval back walks the job out of content completed
  again. It stops there and never drags a job back from payment or paid, because
  those are decisions a person made.
- 2026-08-11: **The creator/admin import boundary is a build failure, not a
  convention.** `no-restricted-imports` in `.oxlintrc.json` bans creator code
  from importing admin code and vice versa. The admin hooks carry
  `brand_commercials` on their rows, and staff and creators are both the
  `authenticated` database role, so the import graph was the last thing standing
  between a commercial column and a creator's screen. It caught three real
  violations the hour it was added.
- 2026-08-11: **The requests queue shows what was AGREED on an approved row,
  and the offer's live terms only on a pending one.** It fetched
  `committed_amount` and then rendered `offer.reward_amount`, so re-pricing an
  offer made the queue, the brand's budget and the creator's own dashboard give
  two answers about one promise. A pending request genuinely is somebody asking
  for the offer as written today, so that case keeps the live terms.
- 2026-08-11: **The offers catalogue decides who is on an offer from the ROWS,
  not from the `needs_application` flag.** Skipping open offers meant switching
  that flag on an offer six creators were mid-pipeline on erased all six from
  the screen. Same rule the creator side already followed, and the same one
  Rashid gave for progress: follow the job, never the flag.
- 2026-08-11: **"Approving this finishes the job" is a label, never a
  confirmation step.** Reviewing at speed was a deliberate decision and a dialog
  per video would be worked around within a week. The label copies the database
  rule exactly, or it promises something that does not happen.
- 2026-08-11: **Two checks in `verify:offer-requests` had been failing since the
  creator UI was rebuilt, and nobody knew**, because that step re-ran the
  content and responsive suites but not this one. They asserted copy the
  redesign had deleted ("paid to you so far", "7 of 7"). Fixed against the
  current design rather than deleted. The lesson is in OPERATIONS: a redesign
  re-runs every suite that asserts copy, not just the ones for the screens that
  were obviously touched.
- 2026-08-11: **A view that groups by BRAND or lists every PERSON needs an
  `is_staff()` gate in its body, not just `security_invoker`.** `job_progress`
  is deliberately shared with creators and is safe because a job belongs to
  exactly one creator, so the count it returns is complete. `brand_stage_totals`,
  `brand_content_totals`, `brand_creator_roster` and `creator_directory` do not
  have that property: a creator reading them would get a well formed brand
  shaped object built from their own rows, with no error at all, and a number
  that has been silently narrowed is worse than one that refuses.
- 2026-08-11: **`is_service_role()` belongs in that gate too.** service_role
  carries no `user_role` claim, so `jwt_role()` coalesces to 'applicant' and
  `is_staff()` is FALSE for the service key. Without it every Edge Function and
  every line of `verify:rls` would read zero rows from a gated view despite the
  grants, and it would look like a policy working rather than a bug.
- 2026-08-11: **The brand Offers tab is paged, and Overview's counts moved into
  the database in the same step.** Overview counted by filtering the offers
  array, so paging that array alone would have turned "12 live of 40" into a
  description of the first twelve rows without anything looking wrong.
- 2026-08-11: **`/admin/creators` is a new screen rather than a promotion of the
  application detail screen.** Everything downstream keys on the account, a
  creator can exist with no application at all, and that screen's own copy says
  its decision is final, which is the right posture for a review artefact and
  the wrong one for a living record. It gains a link across instead.
- 2026-08-11: **`creator_directory` is a view because a person's identity is
  split across two tables.** The account is `profiles`; the handle everybody
  actually types is `applications.tiktok_handle`. `user_id` is NOT NULL UNIQUE
  so the join cannot fan out, which is what keeps `count: 'exact'` honest.
- 2026-08-11: **A brand roster row shows money only when the creator has ONE
  currency on that brand.** `offer_applications.currency` is per row, so two is
  possible; the view names the currency only when there is one and the card says
  "more than one currency" rather than printing a total that crossed them.
- 2026-08-11: **Three more stale assertions found, all the same shape**, on top
  of the two in `verify:offer-requests` earlier the same day: a suite that
  checks CREATOR copy from inside an ADMIN flow, left behind when the creator
  home was rebuilt. `verify:review` was asserting the literal text "welcome to
  wurx", which nothing renders; that string is the overlay's `aria-label` and
  `getByText` matches text nodes. Its visible heading is "Welcome, <name>". Also
  fixed: an unscoped search for `@wurxmediahub.test` on the applications queue,
  which found the RUNNER'S OWN email in the sidebar and reported the queue was
  leaking applicants' addresses. Scoping to `<main>` was already the written
  rule and that line did not follow it.
- 2026-08-11: Removed a duplicate trigram index I had added hours earlier.
  `applications.tiktok_handle` has been indexed since July; a second index on
  the same column is accepted silently by Postgres and then maintained on every
  write forever.
- 2026-08-14: **A contest reward is owed at the CONFIRMATION, not at the end of
  the contest, and the product tracks owed then paid.** Rashid, given the four
  options. It follows from a decision already made: placings were dropped on
  2026-08-13, so nothing is contingent on anybody else, and the instant somebody
  confirms 640 against a 500 target there is nothing left to discover by waiting
  eleven weeks. The cost is that `settle_contest` had to be rewritten rather than
  wired up, and the old five argument version DROPPED, because a function still
  accepting `p_outcomes` is a function somebody will pass outcomes to and be
  quietly ignored.
- 2026-08-14: **`contest_awards` stops being a settlement outcome table and
  becomes a bill**: every row is money against one frozen term, `term_id` NOT
  NULL, amount > 0. The outcome row (`term_id` null, amount 0) existed only to
  carry a placing for entrants who won nothing, and with placings gone it is a
  row that says nothing while still turning up in a sum of money and a count of
  entrants. Done while the table was empty, which was the only free moment it
  would ever have.
- 2026-08-14: **Rule S8 moves from settlement to payment.** Refusing to pay a
  suspended creator without `p_allow_suspended` used to sit on `settle_contest`
  because that was where money moved. Money moves at `pay_contest_awards` now.
  Awarding one is automatic, because they keep everything they earned; SENDING it
  is the decision somebody makes on purpose.
- 2026-08-14: **Awarding never refuses on budget.** M7's settle-time refusal is
  gone, because it existed for one big irreversible payout. A confirmation is a
  statement about what a creator actually did, and a budget must not make us
  pretend they did less. This follows the rule the brand budget bar has had since
  2026-08-01: going over is allowed and shown, never blocked. M7's OTHER half,
  refusing to define reward rows that add up to more than the budget, is
  untouched: that is an offer, not a bill.
- 2026-08-14: **`settle_contest` refuses to close a contest with a progress claim
  still pending**, which is new and is the most expensive thing it could
  otherwise do. Confirming is the only thing that can owe somebody money, and a
  claim on a closed contest can never be confirmed, so closing over one silently
  cancels a reward already earned.
- 2026-08-14: **`private.award_reached_terms` half-checks nothing, on purpose.**
  It does no permission checking of its own and inherits `review_contest_progress`'s.
  A helper that half checks is worse than one that plainly cannot be reached,
  because the half check reads like the whole one to the next person. Being in
  `private` is what makes "cannot be reached" true: PostgREST exposes every
  executable function in an exposed schema.
- 2026-08-14: **`useCatalogueLive` lost its `key` argument.** Three screens
  passed 'hub', 'brands' and 'offers' because a comment in that file told callers
  to work around a Supabase footgun. That was a caller being asked to fix a bug in
  the library file; `joinChannel` fixes it in the library file, and three
  subscriptions to identical rows became one. The general form: when a hook's
  documentation tells its callers how to avoid a hazard, the hazard belongs to
  the hook.
- 2026-08-14: **Contest money is its own CARD on the creator home, not a fourth
  cell in the money block.** Rule M10 said "beside, never added into", and the
  card above it has a stronger property than a label can carry: its three cells
  add up to its own headline by construction, which is what lets a creator check
  our arithmetic. A contest reward in there would quietly make the headline a
  lie. Two cards cannot be added by accident; two cells can.
- 2026-08-14: **A creator with contest money and no offer work is not shown the
  money card at all.** It would read "$0 across 0 jobs" over an empty flow bar
  and three zero cells, directly above the only money they have. Every figure in
  it would be true and the screen would read as broken, which is the failure the
  owner's layout rules are written against. Their money leads and the first-day
  panel does its real job underneath.
- 2026-08-14: **The first-day panel says "Earned from offers", not "Earned so
  far".** That figure was hardcoded to "Nothing yet" and was correct for as long
  as offers were the only way to earn anything. It deliberately does not quote
  the contest figure: that is already on the screen, and printing a number twice
  is an invitation to add the two together.
- 2026-08-14: **The demo APPLICATIONS are back on dev, at Rashid's word, and the
  demo pipeline is not.** `verify:responsive` had been silently unrunnable since
  the 12 August wipe: it signs in as `skinbyamara@wurxmediahub.demo`, and all six
  creator screens failed on "content rendered" every run while the admin half
  passed. The account comes from `seed-applications.mjs`, NOT from
  `seed-pipeline.mjs` as the note in PARKED assumed; the pipeline seed only puts
  videos against jobs that are already approved, and with one approved job on dev
  it correctly wrote nothing. So the fix was the applications seed alone, which
  is also the state that suite is written for: its `/app` expectation matches an
  applicant in review, not an approved creator with a full board.
- 2026-08-14: **A suite that cannot run is worse than a suite that fails.** This
  one reported 24 failures every time and they were all one missing account, so
  they read as noise and were skipped for two days, across the entire contest
  build. Anything that needs seeded data should say so when the data is absent
  rather than failing per screen. Not fixed today; noted here so the next person
  to touch `check-responsive.mjs` fixes the reporting rather than the symptom.
- 2026-08-14: **`pnpm verify:all` exists, and a SKIP exits non-zero.** Eleven
  suites and no way to run them meant they were run from memory, and two were
  quietly red for days: `verify:responsive` since the 12 August wipe, and
  `verify:browser` since the surface retune on 10 August. Both were found within
  a minute of the runner existing, which is the whole argument for it. Something
  that could not be checked must never read as safety, so a skipped suite fails
  the run rather than being omitted from the total.
- 2026-08-14: **`verify:browser` reads its expected colours from `tokens.css`
  rather than hardcoding them.** It carried three literals, the palette moved
  underneath them deliberately, and the suite failed on every run for four days.
  The check was never about those numbers; its own comment said the point was
  "is the page actually dark". Comparing the rendered colour to whatever the
  token says TODAY still catches the stylesheet not loading, the theme attribute
  not applying, and anything overriding the token, while a deliberate palette
  change stops being a test failure. The palette itself is guarded by
  `check:contrast` inside the build, which is a different job.
- 2026-08-14: **`check-live.mjs` printed "N FAILED" and exited zero.** It had no
  `process.exit` at all, so a broken realtime chain, which is the product's
  central promise, would have been reported as green by anything reading the
  exit code. Found while building `verify:all`, because the runner reads exit
  codes and nothing had ever read that one.
- 2026-08-15: **The URL changes before the code arrives, not after.** Route-level
  `lazy` blocked navigation for 291ms on a cold section while showing the old
  screen; `React.lazy` behind a Suspense boundary in a layout route makes it 5ms.
  The download did not get faster and cannot: what changed is that the app now
  answers the click. Chunks are 7 to 20 KB, so this was never a bundle-size
  problem and shrinking them would have bought nothing.
- 2026-08-15: **The shell is a layout route, and no screen may render `<AppShell>`
  again.** Not a tidy-up: while each screen drew its own sidebar, the sidebar was
  part of the thing being swapped, so a Suspense fallback would have blanked the
  entire page. Hoisting it is what allows "frame stays, content loads".
- 2026-08-15: **Prefetch-on-hover is the lesser half and was built second.** It
  is an hour of work and removes the skeleton for mouse users, which is
  tempting enough to have shipped alone and called done. It does nothing on a
  phone, and phones are most creators, so the structural fix had to come first.
- 2026-08-15: **`/precompact` is the project's first skill, and the next action
  is written into `PROJECT_STATE.md` rather than said in the conversation.**
  Instructions cannot live in the thing being thrown away. CLAUDE.md already
  makes that file the first read of every session, so the block is guaranteed to
  be seen.
- 2026-08-16: **A failing full run is re-run before it is believed.** One
  `verify:all` reported contests and responsive broken, every admin screen
  failing. The screens were loaded by hand at two widths and through the suite's
  own storage-state path, all fine; responsive then passed alone. The failing run
  took 1313s against 721s green, because each failing check burns twelve seconds.
  It was the machine. Re-running was the only honest way to know, and guessing
  either way would have been wrong.
- 2026-08-16: **The top bar names the section, and it is the page's only `<h1>`.**
  Every screen used to draw its own title and a sentence describing itself,
  roughly 120px above the work, to repeat a word the lit menu row was already
  saying. Rashid asked for both rows to go and for the name to move into the bar
  with an underline. The name is read from the sidebar's own labels
  (`sectionTitleFor`), so the bar and the lit row cannot disagree, and it is a
  real `<h1>` so nothing was traded away for the space.
- 2026-08-16: **Row one of an admin screen is the filter row, and it is a shared
  component.** `FilterBar`/`FilterTabs`/`FilterTab` is the contests row lifted
  out rather than a new interpretation of it, because that is the one he
  approved. Every screen had grown its own segmented control with a different
  height, radius and way of showing a count.
- 2026-08-16: **The content area has no max width.** It was `max-w-7xl`. Zooming
  out stopped the content at 1280px and left the rest of the monitor empty. The
  old rule said "left aligned, never centred" for exactly this reason, so
  removing the cap serves the rule rather than breaking it: a cap opens the same
  dead gap, just on the other edge.
- 2026-08-16: **Every type size is a `rem`, and one root `font-size` scales the
  app.** 846 hardcoded pixel sizes were converted in one codemod first, because
  a `text-[13px]` opts out of the setting entirely. Tailwind's spacing scale is
  `rem` too, so padding, gaps and radii move with the type and the result is a
  genuinely denser page rather than small text in boxes that did not shrink.
  Breakpoints are unaffected at every setting: `rem` in a media query is always
  measured against the browser's initial 16px.
- 2026-08-16: **Text size is a control in the top bar, not a settings screen.**
  Staff have no settings screen for it to live on, and a size control you cannot
  see while you change it is a bad one. From the bar every step is visible on the
  page behind the menu, so it is chosen by looking rather than by guessing.
- 2026-08-16: **The menu's scroll position is kept outside React.** Clicking an
  item near the bottom snapped the list to the top: a scroll container's
  `scrollTop` is clamped by the browser the moment its contents are briefly
  shorter, and nothing put it back. It is restored in a layout effect, before
  paint, from a module-scope value rather than state, because state would
  re-render the rail on every wheel event.
- 2026-08-16: **The Wurx mark collapses the rail; the arrow in the bar is gone.**
  Rashid asked for the control to be the icon itself so the bar could give that
  space to the section name. It is a real `<button>` on the rail and a real
  `<Link>` in the drawer, never one dressed as the other.
- 2026-08-16: **A tap-target floor is physical pixels and does not follow the
  text-size setting.** Making every size a `rem` shrank the targets with
  everything else: `min-h-11` is `2.75rem`, chosen because it equalled 44px at
  the browser's 16px root, and the new 15px root turned 64 of them into 41px.
  `verify:contests` caught it on the brand hub at 375px. A 44px target is sized
  for a finger, and a finger does not get smaller because somebody prefers
  smaller text. The floor lives on the filter row's CONTAINER (`wx-tap-row`)
  rather than on each control, because a row that gains a control next month
  should not depend on anybody remembering.
- 2026-08-16: **When the machine is the suspect, run against the deployed dev
  URL rather than localhost.** `live` failed 1 check, then 7, on identical code
  with a clean tree, and the 7-check run failed its FIRST check, which runs
  before any realtime does anything. The same suite passed 12/12 in 32s against
  `wurxmediahubdev.vercel.app`, versus 222s locally. `pnpm preview` is another
  Node process holding the whole `dist`, and dropping it is often the
  difference. Check the live `assets/index-*.js` hash matches `dist/` first, or
  a green run is measuring old code.
- 2026-08-17: **The TikTok access token is unreadable by admins, not just by
  creators.** It reads a client's live ad spend, so `tiktok_connections` has RLS
  enabled with zero policies and the grants revoked from `anon` and
  `authenticated`. An admin manages the connection through an edge function and
  never holds the credential. The settings screen gets what it needs from
  `tiktok_connection_health`, a security definer view carrying every column
  except the token, whose WHERE clause is the access control rather than a
  filter. `pnpm verify:tiktok` signs in as a real admin and proves the token
  table comes back empty.
- 2026-08-17: **The OAuth callback route is public, and the nonce is what makes
  that safe.** Whoever returns from tiktok.com may have no session in that tab,
  so requiring one would fail the flow at the last step for reasons that look
  random. Instead the `state` is 32 random bytes, minted by an admin-only
  function, expires in ten minutes, and is burned in a conditional UPDATE so a
  replay loses the race rather than being checked-then-used. The refusal message
  is identical for unknown, used and expired, so nonces cannot be probed.
- 2026-08-17: **Store-to-brand mapping is a settings screen, not a connect
  wizard.** Rashid's own correction: "some brands are not yet added so admin can
  add later and then map". So an unmapped store is a normal state rather than an
  error, the sync upserts without touching `brand_id`, and Re-check can never
  discard a mapping somebody made by hand.
- 2026-08-18: **Creators read a cache, never TikTok.** Rashid's worry was
  unlimited API calls from the date filter. The better answer than rationing the
  filter was removing the call: because one request covers every video for one
  day, a nightly job can fill a per-video-per-day cache for the whole platform
  in two calls a night, after which any date range is free. It also means a
  creator has no path to TikTok at all, so there is no quota to get wrong.
  Supersedes the "fetch on demand, not a scheduled sync" line in the original
  brief, which he approved changing once the batching was proven.
- 2026-08-18: **The browser never names a video.** `creator_video_performance`
  and `creator_daily_performance` take a date range only and resolve ownership
  from `auth.uid()`. Accepting item ids from the client would have made every
  creator's numbers one edited request away from anyone. RLS on
  `tiktok_video_daily` says the same thing again, and `verify:performance` signs
  in as a second creator and tries the exact id to prove it.
- 2026-08-18: **Only stores mapped to a brand are synced.** One TikTok Shop can
  appear under several ad accounts, so syncing every visible pair would store
  the same video twice and double its spend. The mapping is the statement of
  which ad account a brand's money actually comes from.
- 2026-08-18: **A sync day is only "done" for the videos it was done FOR.** The
  first real seed exposed this: `tiktok_sync_runs` recorded a finished day, and
  the sync skipped any day already finished, so three days ticked off by a
  two-video test run were never re-asked when 46 real videos arrived. Four of
  aarontopfinds's six videos had no history and his screen read zero. In
  production it would have been worse and silent: every creator added after the
  first sync would have stayed permanently empty for every earlier day. Fixed by
  recording a SHA-256 fingerprint of the sorted item ids on each run and
  skipping only on an exact match, so a changed roster refills itself once.
- 2026-08-18: **A test must restore what it borrows.** `check-performance`
  points the real Penetrex store at a throwaway brand and used to clear the
  mapping afterwards. Since the sync only pulls mapped stores, running the tests
  quietly switched off every creator's numbers. It now puts the previous
  `brand_id` back.
- 2026-08-18: **The posting date is decoded from the video id, not asked for.**
  Rashid wanted a date picker on the submission form so a creator adding a
  month-old video would still get its history. The need was real; the question
  was not. A TikTok id carries its creation time in its top 32 bits, so
  `tiktok_posted_at()` reads it exactly, needs no form field, cannot be
  misremembered, and works retroactively on every video already stored.
  `tiktok_days_to_backfill()` uses it to tell the nightly job how far to reach
  for videos that have no figures yet, so a late-added video fills itself in and
  then stops costing anything.
- 2026-08-18: **The nightly run moved from 03:20 to 07:00 UTC.** The ad account
  reports in UTC-5, so 03:20 UTC was 22:20 the previous evening in the account's
  own day: asking for "yesterday" returned the day before the one we wanted and
  left the product two days behind. 07:00 UTC is 02:00 in the account's day, so
  yesterday means yesterday.
- 2026-08-18: **No re-checking of settled days.** Rashid confirmed with a TikTok
  Shop expert that a sale is counted on the day it was PURCHASED, not the day
  the ad was seen, so a complete day is final and never changes. The three-day
  window stays only as cover for a failed night, without `force`.
- 2026-08-18: **Our numbers are only ever as complete as the links we hold, and
  that is now the biggest operational risk in the feature.** Rashid saw $3.47 in
  the ad centre against our $2.99 for babblingbrookej in August. Nothing was
  wrong with the pipeline: TikTok's API agreed with us to the cent for the
  videos we knew about. The gap was 36 videos of hers we had never been given.
  With all 51 loaded we report exactly $3.47.
  Probing the store unfiltered showed **9,487 videos and $17,128 of spend in one
  fortnight**, so "we hold no link for it" is the normal case, not the
  exception. A creator who forgets to submit a link simply does not get paid
  attention for it, and nothing anywhere will say so.
- 2026-08-18: **A short page is treated as a failed day, not as its answer.**
  The report is paginated and the store returns thousands of rows. We filter to
  our own videos so one page holds them today, but the roster only grows and the
  failure mode is money quietly missing rather than an error. The sync now
  compares `page_info.total_number` against the rows it received and fails the
  day if they disagree, so it is retried rather than looking finished forever.
- 2026-08-19: **Our theme toggle owns the theme inside Paid Collabs; theirs does
  not.** WurxBase has its own appearance settings and writes `data-theme` onto
  `<html>`, which is the attribute our whole palette switches on, so opening the
  screen turned the entire admin light and left it that way. The alternatives
  were to edit their file (forbidden), rename our attribute (an app-wide change
  to satisfy a guest), or take the attribute back at the seam. We take it back,
  and mirror their other four preference attributes onto the fence so their
  density, radius, accent and motion settings still work in here. If Rashid ever
  wants their theme picker to drive this screen, it is one line in the seam, but
  two theme controls that disagree is worse than one that wins.
- 2026-08-19: **WurxBase's three statuses use our stage ramp, not
  success/warning/accent.** In progress is live-indigo, payment pending is
  due-amber, payment sent is paid-green. The obvious mapping is the one
  `tokens.css` warns about in writing: in light mode the brand gold `#8a5f1f`
  and the warning amber `#8a6410` are within a hair of each other, so two of the
  three states would have read as one. In light mode the three are mixed a fifth
  toward the ink, because at full strength they are 4.3-4.5:1 inside their own
  wash, a hair under AA for a 12px pill.
- 2026-08-19: **Our overrides on vendored CSS win by specificity, never by
  order.** Their stylesheet is inside the lazily loaded vendor chunk, so it is
  injected after anything the route imports. A correction written
  `.wurxbase-root .x` silently loses. Everything of ours is written
  `.wurxbase-root.wurxbase-root .x`, which cannot be undone by a bundler
  decision.
- 2026-08-19: **A swap keeps the identity the TAB started as, across both auth
  events.** Rashid reported twice that the app "says signed out" while both
  accounts are logged in. Swapping accounts is a sign-out followed by a sign-in,
  and the old test (`previousUserId !== null`) is true for the first event and
  false for the second, so the banner froze on "you were signed out in another
  tab" while a different person was in fact signed in and the role guard had
  already moved the tab to that person's home. The provider now carries
  `origin` across both events in a ref, rewrites the banner on each, and clears
  it entirely if the original person signs back in. Nothing said "signed out"
  that was not a sign-out.
- 2026-08-19: **The banner no longer guesses HOW the session ended.** "You were
  signed out in another tab" fires for a session that simply expired too. It
  says "You are no longer signed in on this browser", which is true in both
  cases, and offers "Sign in again" rather than "Reload this tab", because
  reloading a tab with no session lands on the sign-in page anyway.
- 2026-08-19: **A fixed banner may never take a `*-soft` token as its only
  background.** Every `*-soft` in `tokens.css` is a translucent wash meant to
  tint a card. The identity banner used one, and on a phone, where its message
  wraps to five lines instead of one, the dashboard showed through the words and
  it was unreadable. It is now an opaque mix of the same token against
  `--wx-surface-1`. This applies to anything fixed or floating, not just this
  banner.
- 2026-08-19: **Dev was emptied of every creator, offer and contest, and
  reseeded with Wurx's 41 real TikTok handles.** Rashid wanted to see the
  product against real people rather than demo rows. `wipe-clean-slate.mjs`
  then `reconcile-budgets.mjs` then `seed-creators.mjs`.
- 2026-08-19: **The seeded accounts walk the real approval path, they do not
  fake it.** Each one is `auth.admin.createUser` (handle in the metadata, which
  is the only key the trigger reads) then an `applications` row with the same
  six columns the browser writes, then `review_application()`, the same
  Postgres function the admin Review screen reaches through its Edge Function.
  Setting status, role and tier by hand instead would have produced 41 creators
  nobody ever let in and an Activity log where they appear from nowhere.
- 2026-08-19: **Both onboarding stamps are filled in, so they are OLD
  creators.** Leaving `approval_celebrated_at` null gives every one of them the
  you-are-approved celebration on first sign-in, which is the exact half state
  Rashid reported the last time creators were seeded.
- 2026-08-19: **video_links could not be skipped as asked.** He said to skip it;
  the column is NOT NULL with a length check and must contain a link. Each
  creator gets their own TikTok profile URL, which is true, derived only from
  the handle he gave, and clickable by an admin. Nothing was invented.
- 2026-08-19: **"50 percent have worked with Wurx" is exactly 21 of 41, not a
  coin flip per person.** A per-person random lands near half and never on it,
  and would differ between runs. Which 21 is chosen by a hash of the handle, so
  the seed is reproducible: two runs produce identical people, and a screenshot
  taken today still describes the database tomorrow.
- 2026-08-19: **The niche list excludes "Other".** The database does not
  validate `niche` at all, only its length, so a value the real form could
  never produce would land silently and look genuine forever. Picking "Other"
  would also need a `niche_other` string invented for a real person.
- 2026-08-19: **The TikTok ad history was kept through the wipe, deliberately.**
  `tiktok_video_daily` has no foreign key to a person: its key is
  (item_id, stat_date) and its only reference is to the ad account. So 5,294
  video-days of real cost and GMV survived deleting every creator, and
  re-submitting the same links brings the real figures back with no API call.
  The link that DID die is `content_submissions.embed_id`, so the wipe writes
  every handle-to-video mapping to a file first.
- 2026-08-19: **Contests are deleted before accounts, and that order is load
  bearing.** `contest_exclusions.user_id` is ON DELETE SET NULL under a CHECK
  that at least one of handle, email or user_id survives. Postgres nulls the
  column, re-evaluates the CHECK, and aborts the whole delete part way through
  the loop. Four more `_at`/`_by` pairs behave identically. No foreign-key
  audit finds any of them, because they are CHECK constraints.
- 2026-08-19: **Penetrex's August retainer is on dev, from Rashid's own
  spreadsheet.** 41 creators, $22,250 committed across 393 videos, reconciling
  against the sheet's own totals to the dollar. `seed-penetrex-offers.mjs`.
- 2026-08-19: **Creators on identical terms share an offer; a different rate is
  a different offer.** Rashid's call, and it is also the grain the product was
  built on: terms live on the OFFER, not on the request, because the two columns
  that let a creator name their own price were dropped on 2026-07-31. 41 deals
  become 31 offers, 26 with a single creator and 5 shared, the largest by six.
- 2026-08-19: **The committed money comes from "Monthly Cost", not from
  rate x videos.** The sheet carries both and they disagree on five rows because
  the per-video rate is rounded: Simply Sarah is $73 x 15 = $1,095 against a
  stated $1,100, Erin Cooper $133 x 15 = $1,995 against $2,000. The monthly
  figure is what has actually been committed, so it is the one stored; the rate
  is shown as the sheet prints it.
- 2026-08-19: **The offer title carries the total AND the rate.** $420 and $415
  over ten videos both round to "$42 a video", and two offers with identical
  titles is how somebody gets approved onto the wrong one.
- 2026-08-19: **The pipeline mirrors the sheet's Status column** rather than
  starting everyone at the beginning: 37 at content pending, 3 at payment
  pending, and Sarah Hilliard paid at $500, which is exactly the sheet's TOTAL
  PAID. Each creator is walked through the stages one call at a time, so
  `offer_stage_events` holds a real history instead of a single jump.
- 2026-08-19: **The 41 now display their real names, from the sheet.** A real
  sign-up records the TikTok handle as the display name because that is all the
  form collects; the name is what an admin fills in afterwards. The handle is
  untouched and still shows beside it.
- 2026-08-19: **Any script that deletes offers must recompute the brand's
  committed budget.** `brand_commercials.budget_used` is a running total that
  `review_offer_application` adds to, with no foreign key and no cascade. The
  first `--clean` of the offers seed left the whole $22,250 committed to offers
  that no longer existed, and re-seeding on top read $44,500 against a $23,000
  budget. Nothing errored. Both paths through that script now end in a
  recomputation, and the seed asserts the result against the sheet.
- 2026-08-19: **August's videos go in by the SHEET'S month label, not by the
  date inside the video id.** Rashid's call: "july 30 and aug 1 these dates can
  be a bit off because of timezone issues, so trust the sheet data". Gunnar's
  August batch opens with a video posted 30 July and it is August's work. Both
  readings were compared before asking him and they disagree a lot, because the
  label marks the batch a video was commissioned in rather than the day it went
  up. 79 videos across 11 creators.
- 2026-08-19: **The month sits on the block's HEADER row, not always beside the
  first video.** Parsing the header before skipping it turned 38 apparently
  unlabelled videos into 6. Anything reading these sheets must check the header.
- 2026-08-19: **Jen Honest's last block is held back.** Six videos posted 11-18
  August, straight after her July block, but the sheet gives the block no month
  at all. Under a "trust the label" rule there is no label to trust, and
  inferring one would be reading Rashid's mind rather than his sheet. Waiting on
  him.
- 2026-08-19: **The loaded videos are APPROVED, not left in the review queue.**
  They are live on TikTok with ad codes against them, so they have plainly been
  accepted; and the creators at payment pending and paid could not be at those
  stages with unreviewed content. `--submitted-only` puts them in the queue
  instead if that is ever wanted.
- 2026-08-19: **`p_embed_id` is the whole point of the load.** It carries
  TikTok's item id, which is the ONLY join between a person and the money:
  `tiktok_video_daily` is keyed (item_id, stat_date) with no reference to a
  creator. Passing it made real spend and GMV appear on Aaron Finds' screen with
  no TikTok call at all.
- 2026-08-19: **Approving content is allowed to move the pipeline by itself.**
  `review_content` advances a job to content completed once its video count is
  met, and it did exactly that for Selena, who delivered all ten of a ten-video
  deal. That is the product working, not something to suppress.
- 2026-08-19: **The sheets are trusted for VIDEO LINKS ONLY, never for
  figures.** Rashid: "trust the sheet only for video links not for gmv stats we
  need api calls for that". Their GMV, Ad Spend, Views and CTR columns are
  ignored entirely; every number a creator sees comes from TikTok through the
  sync.
- 2026-08-19: **Jen Honest's six unlabelled videos are August.** He confirmed
  them by hand and pasted the links: "for jen honest the last 6 are his videos
  for aug the month was not label". Checked id by id against her sheet before
  adding. 85 videos in total now.
- 2026-08-19: **ADD EVERY VIDEO BEFORE SYNCING, never the other way round.** A
  sync call costs one API request per store per day, and a day counts as done
  only for the SAME set of videos (`videos_hash`). Adding a video afterwards
  invalidates every day already paid for and they all have to be fetched again.
  Loading all 85 first and syncing once cost 22 calls; syncing at 79 and then
  adding Jen's six would have cost 44 for the same result.
- 2026-08-19: **22 API calls covered 85 videos, and that is the floor.** The
  cost is driven by DAYS, not by videos: one report call per store per day
  returns every video at once. One store is mapped to Penetrex, and
  `tiktok_days_to_backfill()` worked out 20 days from the videos that had no
  figures, dating each from its own TikTok id; the function adds two days of
  slack. 738 video-days came back and all 85 videos now carry real figures:
  $447.41 spent, $716.49 GMV, 37 orders, 1.60x.
- 2026-08-19: **Creator faces are fetched once and kept, never requested from
  a third party at view time.** Rashid asked whether we could do what WurxBase
  does, on our end. WurxBase asks unavatar.io from the BROWSER, per row, on
  every page view: their own code carries a `noRemote` flag because the
  Discovery tab hit 429s and sat on blank circles. `sync-creator-avatars`
  fetches each picture once, server side, into the private `creator-avatars`
  bucket. All 41 resolved, 4.9MB, three calls. Nothing leaves our domain when a
  screen opens.
- 2026-08-19: **That bucket is PRIVATE, where `brand-assets` is public.** The
  public one says why in its own migration: logos already on a public listing,
  on cards that must not wait for a token. A person's face plus a path that says
  whose it is is a different thing, and Rashid asked for admin-only. The cost is
  one batched `createSignedUrls` per screen, which signs a whole page at once.
  Objects are named by profile id, not by handle, so the name never says whose
  face it is.
- 2026-08-19: **The initial is the BASE state, not a fallback.** The first
  version drew the photograph with a surface behind it, and a page of forty
  faces opened as forty blank pale discs while four megabytes arrived. The
  letter is always rendered and the photograph fades in on top. A letter that
  becomes a face reads as loading; an empty circle reads as broken.
- 2026-08-19: **`img.complete` on a ref, as well as `onLoad`.** An image
  already in the browser cache finishes before React attaches the handler, so
  `onLoad` never fires and the picture stays at zero opacity for ever. It
  looked exactly like the faces had stopped working on the second visit to a
  screen. Checking `complete && naturalWidth > 0` on mount is the only reliable
  way to ask "is it already here".
- 2026-08-19: **Applicants are in the avatar queue, not just creators.** The
  first migration said `role = 'creator'`, which silently excluded the one
  screen a face is worth the most on: the applications queue, where staff judge
  a stranger off a handle. 'applicant' is its own role, so those three surfaces
  would have drawn initials for ever while looking finished.
- 2026-08-19: **Faces are an admin affordance and never reach a creator.**
  `useCreatorAvatars` lives in `src/lib/admin/`, which `.oxlintrc.json`
  forbids creator code from importing; the table has one policy and it is
  `is_staff()`; the bucket matches. In particular a face must NEVER appear on
  the anonymised contest standing, which promises in words that nobody can see
  who anybody else is, nor on any admin entrant roster, which would be the same
  ranked-people shape contests were built to refuse. Nor on contest exclusions,
  where the row may name somebody who never signed up.
- 2026-08-19: **Approval gates the ad money, not just the deliverable count.**
  Rashid, walking the whole flow: "make sure creators are only be shown these
  gmv stats for the videos that are approved by admin." It was not true. The
  content feature had said since the day it was built that a submission counts
  for nothing until an admin approves it, and `job_is_filmed` obeyed that; the
  ad-money path, built a week later, never picked the rule up and matched on
  ownership alone. The de-facto gate was `ad_authorized`, a checkbox the
  creator ticks themselves. Beyond the two obvious costs (money shown before
  anybody watched, money that never goes away after a retake) it was a real
  hole: there is no uniqueness on `embed_id` or `video_url` across creators
  and `update_content` lets a creator rewrite the link while a row is
  unapproved, so pasting another creator's TikTok URL for the same brand made
  the sync fetch that video's figures and the read functions hand them over.
  Approval is the lock: a human looks at the video before its money is
  anybody's.
- 2026-08-19: **The gate went on all five places in one migration**, rather than
  the read functions alone. A function filtered while the policy was not still
  leaks through any query written later, and a policy filtered while the sync
  was not keeps spending TikTok calls on videos nobody has agreed to. The five
  are the row policy on `tiktok_video_daily`, `creator_performance_window`,
  `creator_video_performance`, `creator_daily_performance`,
  `tiktok_days_to_backfill`, plus the sync's own query in the Edge Function.
- 2026-08-19: **A finished job lands on `payment_pending`, not
  `content_completed`.** Rashid: "when creators have uploaded all the videos
  they committed they and all are approved, automatically their stauts should be
  go to payment pending". The old target sits in the `working` money bucket, so
  a creator who had finished everything still read "being checked" and still saw
  their fee counted as In progress, and no admin tile counted jobs sitting
  there. The new target says WE owe THEM; it does not automate paying anybody,
  because `paid` is still a person's decision with money in their hand.
- 2026-08-19: **The reopen branch now accepts `payment_pending` as well.** It
  used to insist on exactly `content_completed`, on the grounds that past that
  point a payment decision had been made by a person and was not ours to
  reverse. That reasoning stops applying the moment the approval itself is what
  put the job into `payment_pending`. It still stops short of `paid`:
  somebody has sent money.
- 2026-08-19: **`creator_video_performance` deduplicates on `embed_id`.** One
  row per video, not per submission. The same video filed against two jobs was
  double counting into the four tiles on My Numbers while the chart below them
  did not, because that reads `tiktok_video_daily` directly. Invisible today
  and certain to surface the moment anything sums across creators.
- 2026-08-19: **D7 is amended for a global GMV leaderboard, and only for that.**
  D7 (2026-08-13) said no creator ever sees anything about another entrant, and
  `20260813151702_contests_schema.sql` carries it as a standing prohibition in
  the schema itself. Rashid, asked directly, chose names and figures visible to
  everyone, plus faces. The two promises coexist because they are about
  different things: the contest STANDING stays anonymous, because that screen
  says in words that nobody can see who anybody else is, and breaking that would
  be a lie rather than a change. A global leaderboard ranked on ad GMV makes no
  such promise. The contest prohibition stays exactly as written.
- 2026-08-19: **Dev holds the Penetrex sheet and nothing else.** Rashid:
  "please make sure that all the data before adding penetrex from the sheet was
  dummy and useless ... now i wanna see only the data we fetched from the sheet
  is there any extra data??" There was, from three different causes, and he
  chose to remove all of it. Dev is now 41 creators, 41 applications, 41
  avatars, ONE brand, 31 offers, 41 jobs, 85 videos, 738 money rows, 0 contests.
  `scripts/ops/tidy-dev.mjs` is the re-runnable answer and it dry-runs by default.
- 2026-08-19: **The four empty brands went** — Vitauthority, BruMate, Physicians
  Choice, Bentgo, seeded 2026-08-12, each with a budget row and some products
  and zero offers, jobs, videos or contests. They were part of the same dummy
  set as the creators the wipe removed. Everything that references `brands` is
  ON DELETE CASCADE, so `tidy-dev` counts all six referencing tables first and
  refuses any brand that is not empty. Naming a brand is never enough on its
  own: the delete would take real work with it and say nothing.
- 2026-08-19: **The orphaned ad money went, and that GIVES UP a property the
  wipe script deliberately protected.** `tiktok_video_daily` has no foreign key
  to a person, which `wipe-clean-slate.mjs` documents as the valuable
  behaviour: resubmit the same link and the figures reappear with no API call.
  The cost is that a wipe leaves the money of everybody it deleted lying around
  for ever — 5,230 rows across 76 videos, $332.51 of GMV, back to 18 April.
  Nobody could read them, but a creator who ever submitted one of those URLs
  would have inherited earnings from before they were involved. Removed because
  they were known dummy data. If any of those videos is ever loaded again its
  history has to be bought back from TikTok in calls.
- 2026-08-19: **The revoked TikTok connection STAYS, and so does the second
  Penetrex store row.** I proposed removing both as litter and was wrong on
  both, which is worth writing down because the surface reading is convincing.
  `tiktok_connections` soft-revokes on purpose — "the row stays so the audit
  trail still resolves" — and the token was overwritten with an empty string at
  the same moment. And `tiktok_stores` has primary key (advertiser_id,
  store_id) since `20260817193000`, because Penetrex is authorised to BOTH ad
  accounts and the GMV figures belong to the PAIR; exactly one pair is mapped to
  the brand, which is the correct state. Deleting the unmapped row would also
  simply bring it back on the next store refresh.
- 2026-08-19: **`audit_log` and `tiktok_sync_runs` were kept**, asked directly.
  A history that can be erased by whoever is tidying up is not a history, and
  the sync log is how anybody would ever find out the nightly job had stopped.
  Neither is visible to a creator.
- 2026-08-19: **A suite's cleanup belongs in `finally`, and every delete in it
  is checked.** `check-content` deleted its brand on the last line of the
  `try`, so the run that could not reach the preview server threw first and
  left a brand and its offer on dev permanently. All the deletes were also
  fire-and-forget, so a foreign key that refused reported nothing. Both fixed;
  the suite now runs 33/33 and `tidy-dev` finds nothing after it.
- 2026-08-20: **A contest video reward is owed when the last video is
  approved.** Rashid, asked which of three options decided a contest reward,
  answered with a fourth and better one: "money is only owed when all videos are
  up for both contest and offer ... admin see one by one and all are approved
  only then money is owed." It removes the problem all three options had. Money
  is never owed early, so in the ordinary case there is nothing to claw back,
  and it makes contests say the same sentence offers started saying on
  2026-08-19.
- 2026-08-20: **GMV targets keep the old rule, and that asymmetry is deliberate.**
  There are no videos to approve behind a GMV figure, so the staff confirmation
  IS the control there, exactly as Rashid described that path separately. The
  video review passes `p_gmv => null` precisely so approving a video can never
  reach a GMV target sideways on a stale figure.
- 2026-08-20: **`p_video_count` was dropped from `award_reached_terms`, not
  ignored.** An argument that is still accepted and no longer changes anything
  is worse than a signature change: the next caller passes the creator's typed
  number in good faith and cannot work out why it does nothing.
- 2026-08-20: **Withdrawing an unearned award DELETES the row and writes a
  `reward_withdrawn` event.** PARKED argues, correctly, that UNPAYING should
  write a reversal so history stays true; that is about money that has already
  left. This is money that was never sent, and
  `contest_awards_money_idx` is unique per (contest, entry, term), so a
  negative row could not sit beside it without dismantling the guard that stops
  a double award. The history lives in the creator's timeline and the audit log
  instead. **A paid award is never withdrawn**, and the count of skipped ones is
  returned so a screen can say why rather than implying money moved.
- 2026-08-20: **Never recreate a database function by retyping it from its own
  comments.** The first version of `review_contest_progress` in
  `20260820090000` was rebuilt that way and lost two things: it wrote
  `message` where the column is `staff_message`, so every confirmation failed
  with 42703, and it dropped the rule that a rejection must carry a sentence the
  creator can read. `20260820100000` restores the extracted body with only the
  award call changed. The offer migration the day before patched its functions
  from extracted source for exactly this reason; this is what happens when that
  is not done.
- 2026-08-20: **One pipeline, both channels, through `creator_videos`.** The
  ad money path named `content_submissions` everywhere, which is the OFFER
  table, so a contest video's id was never sent to TikTok and could not have
  been read if it had. Four places had to change together — the row policy, the
  three read functions, the backfill depth and the sync query — because
  widening three of four leaves a video fetched and unreadable, or readable and
  never fetched.
- 2026-08-20: **A video that is both an offer video and a contest video reports
  `source = 'both'`, and answers to either tab.** There is no uniqueness on
  `embed_id`, and filing one video against a job and a contest entry is
  legitimate rather than an error. Each tab's total is correct on its own;
  adding two tabs together is the one sum this data cannot support and no screen
  does it. The alternative, picking one channel arbitrarily, would have hidden
  a real video from a real tab.
- 2026-08-20: **A contest video's TikTok id is derived server side from the
  link, never taken from the client first.** A creator who could name the id
  separately from the link could point their row at somebody else's video while
  the link on screen still looked like their own.
- 2026-08-20: **The leaderboard is a SECURITY DEFINER function, not a view.** A
  view creators could select from would have needed a policy on `profiles`
  wide enough for one creator to read another's row: a far bigger hole than the
  screen needs, and open to every query written afterwards. The function returns
  eleven columns and cannot be asked for a twelfth.
- 2026-08-20: **D7 is amended for the global GMV board only.** The anonymous
  contest standing keeps its promise, the schema-level prohibition on a contest
  leaderboard stands, and nothing in the new function reads a contest table. The
  two coexist because they are about different things.
- 2026-08-20: **Creators with no figures are hidden from the board**, Rashid's
  call. A board that is three quarters zeros reads as broken to the people at
  the bottom, and it is not even true: a zero there means "not measured yet".
  They are told so at the top of the screen instead.
- 2026-08-20: **`creator-avatars` opened to signed-in creators.** A narrow,
  deliberate reversal of the previous day's admin-only decision, taken because
  Rashid asked for faces on the board in those words. Objects are named by
  profile id and `profiles` still refuses one creator another's row, so a name
  cannot be turned into a path from the client. Writing stays impossible for
  everybody, which the suite proves.
- 2026-08-20: **`create or replace` on a function with a NEW ARGUMENT creates
  a second overload rather than replacing anything**, and PostgREST resolves by
  the argument names a request sends. That is how `creator_daily_performance`
  ended up serving the old body to a two-argument caller and returning an empty
  chart under a full set of cards. Adding a return column forces a `drop` and
  is safe by accident; adding an argument is not.
- 2026-08-20: **One brand maps to exactly ONE ad account, and each brand gets
  its own TikTok Business Center connection.** Rashid's rule, given in those
  words. It is what keeps `tiktok_video_daily`'s `(item_id, stat_date)`
  primary key safe: two advertisers reporting one item on one day would
  overwrite rather than sum, and the one-to-one rule is what stops that being
  reachable. Treat the rule as load-bearing, not as a convention.
- 2026-08-20: **USD only.** Confirmed by Rashid with his boss. No FX table, no
  conversion, no admin rate screen — the earlier proposal for admin-set rates is
  WITHDRAWN, not deferred. What replaces it: the read functions must refuse to
  BLEND currencies rather than assume there is only one. A non-USD row appearing
  must show on the screen, not disappear into a USD total. Assuming is what
  turns a business decision into a silent money bug the day it stops being true.
- 2026-08-20: **One video id belongs to one creator, permanently, enforced in
  the database.** Across both `content_submissions` and
  `contest_submissions`, because a leaderboard sums across people and nothing
  currently stops two creators pasting the same TikTok link and both counting
  its GMV. The same creator filing one video against an offer AND a contest
  stays legal: that is one person's video doing two jobs.
- 2026-08-20: **A money row belongs to an AD ACCOUNT, not just to a video and a
  day.** `tiktok_video_daily` was keyed `(item_id, stat_date)` and the sync
  upserted a full row on that key, so a second ad account reporting the same
  video on the same day REPLACED the first instead of adding to it, usually
  replacing real money with zeros, because a report filtered by item id returns
  zero rows for videos that account never ran. The key is
  `(advertiser_id, item_id, stat_date)` now and every read sums across
  advertisers. The reads needed almost no change to do that, which is the sign
  the key was wrong rather than the queries.
- 2026-08-20: **`brand_id` and `store_id` go ON the money row.** It is the only
  honest answer to which brand paid a creator, which Rashid asked for by name.
  The brand on a SUBMISSION says which brand a video was filed against; the
  money row says whose ad account actually spent. They agree for an ordinary
  video and diverge for one that two brands both promoted, and the previous
  answer, first filing wins, was a guess wearing a fact’s clothes.
- 2026-08-20: **One brand, one ad account, enforced both ways.** Two partial
  unique indexes on `tiktok_stores`. Rashid’s rule, and load-bearing rather
  than tidy: it is what keeps the money key safe now that two accounts can both
  write. Penetrex’s shop is authorised to BOTH of his ad accounts, so the
  settings screen showed it twice with a dropdown on each and picking Penetrex
  on both was the obvious, catastrophic thing to do.
- 2026-08-20: **One video belongs to one creator, by trigger rather than
  constraint.** The rule spans two tables and Postgres has no unique index
  across two. It checks APPROVAL rather than submission on purpose: two
  creators may both paste a link innocently, and blocking at submission would
  let anyone reserve a video they do not own by pasting it first.
- 2026-08-20: **Connecting a Business Center no longer revokes the others.**
  The old blanket revoke meant connecting brand B silently froze brand A. The
  sync resolves a token PER STORE through its advertiser to the connection that
  granted it, so two live connections are two Business Centers rather than an
  ambiguity. Only a connection the new grant supersedes is retired.
- 2026-08-20: **A sum spanning two currencies reports NULL and renders with no
  symbol.** USD only is the decision, so there is no FX. But the reads used
  `max(currency)`, which picks a label off a set and prints it over a sum of
  everything, so the day one GBP account is connected a creator’s GMV becomes
  dollars plus pounds with a dollar sign on it. Costing nothing while the
  answer is USD is exactly why it is worth having.
- 2026-08-20: **`tiktok_days_to_backfill` is capped at 95 days.** It had no end:
  a video that never runs ads has no figures for ever and set the depth for
  ever. With brands sharing a call ceiling, one stuck video spent the night and
  the other brands synced nothing.
- 2026-08-20: **The realtime publication no longer broadcasts whole rows on
  DELETE.** Four published tables still had `replica identity full` and row
  security is not applied to DELETE events. `20260813230000` had already found
  and fixed this for two contest tables; these four predate that understanding.
  Nothing in `src/` reads the old row, so it cost no feature.
- 2026-08-21: **The admin offers list is a grid of cards, and an open card
  spans its whole row.** Rashid asked for cards instead of rows, minimal content
  and a very low radius. Expanding a card in place was tried first and left a
  hole in the grid, because a grid row is as tall as its tallest item; spanning
  every column removes it and gives the details room to sit beside the card
  above `lg`. Rejected: a dialog, which hides the list you are comparing
  against; and a detail ROUTE, which the admin does not have for offers and
  which would have meant inventing one to satisfy a click. The card's radius is
  `rounded-md` against `rounded-xl` everywhere else — his instruction, on this
  screen, and deliberately not applied to Brands and Contests without asking.
- 2026-08-21: **On a card that carries a control, the action bar lives OUTSIDE
  the button that expands it.** The requests queue has a stage dropdown and a
  pair of decide buttons on every card, and nesting either inside the expanding
  button is invalid HTML the browser resolves by guessing. Rejected: putting the
  controls in the panel, which would have made every stage move two clicks on
  the screen whose whole job is stage moves. Also settled the same day:
  `FilterTabs` **wraps** rather than scrolls, because `FilterBar`'s own rule
  is that a row which scrolls sideways hides a filter behind an edge — it had
  been overflowing the page at 375px on every five-state queue.
- 2026-08-22: **An offer's audience is enforced in RLS and in the write path,
  never in the form**, and `offers_select_own_requests` was narrowed to pending
  and approved requests. Keeping it open for rejected and withdrawn ones meant
  anybody who applied once kept reading a private rate for ever, which is the
  person most likely to test it. Work already agreed still keeps its offer's
  name, which was that policy's original and still-valid reason to exist.
  Rejected: putting the check only in the Edge Function (`apply_for_offer` is
  SECURITY DEFINER and is the boundary); an array column on `offers` instead of
  a table (`replica identity full` would have broadcast the whole audience to
  every creator who could see the offer); and inferring allow/deny from the kind
  (a type change would silently invert who is on the list).
- 2026-08-22: **A contest record is five tabs, not one scroll**, and the tab
  lives in the URL. Rashid: *"admin has to sroll on one page to see who accepted
  what's going on each and everything this is very bad"*. Summary carries the
  per-contest queues, which is the question he could not answer. Rejected:
  keeping the queues on every tab (they are the thing that made it a scroll),
  and putting `ContestVideoQueue` on Summary — it is not contest-scoped, so on
  a per-contest tab it answers a different question than the one being asked.
- 2026-08-22: **A hero image's legibility is the TEXT's job, not the scrim's.**
  The first creator contest card put 90% black over the left of the photograph.
  It read fine in light mode and buried the picture completely in dark mode. The
  words carry a `text-shadow` instead, which is readable over anything and
  costs the image nothing; the scrim is insurance for a blown-out white upload.
  The corollary is the rule that made it work: **`cover` crops a different
  edge on every screen** — wide boxes trim top and bottom, narrow ones trim the
  sides — so a phone showed the middle of a product shot, which is the product,
  and white text landed on white. Both the crop origin and the scrim direction
  are therefore responsive. Do not re-tune one without the other.
- 2026-08-24: **A video belongs to a brand through the offer or contest it
  was filed against, and its MONEY belongs to the brand whose ad account paid.**
  Rashid settled the first half: *"offers and contest belong to the brand right.
  SO when user is adding a video he chooses offer or contest right? so at that
  time can't we hae a connection that which video is for which brand??"* Yes,
  and `creator_videos.brand_id` is that connection. But the filing alone is not
  enough for money: two brands can both run ads on one video, and summing all of
  a video's money into the brand it was filed under would credit one brand with
  another's spend. So a Brand Hub LISTS the videos filed there and SUMS only
  that brand's money rows on them. A video filed here that only another brand
  paid to promote therefore reads zero, which is true. Rejected: filtering the
  returned rows in the browser, which looks identical and is wrong, because a
  card's `brand_id` is the brand that spent MOST on it over its lifetime while
  its cost and GMV are sums across every advertiser.
- 2026-08-24: **A Brand Hub tab opens only if there is something behind it.**
  My numbers, Contests and Leaderboards are real screens and now open inside a
  hub. Campaigns & briefs and Creative studio have no table, no rows and no
  screen, so they stay marked and unclickable. Rashid chose that over hiding
  them: a creator should see the shape of what is coming without being able to
  walk into an empty room.
- 2026-08-24: **A per-brand leaderboard is ranked inside the brand**, with the
  argument passed down to `private.leaderboard_totals` underneath the `rank()`.
  Ranking everybody and then hiding other brands' rows would open the board on
  "#7 of 3", which is not a smaller leaderboard, it is a broken one.
- 2026-08-24: **A finished day is re-read for a week, because ad spend is not
  final when the day ends.** The sync had skipped any day it already held, on
  the stated belief that "a complete day cannot change". True of revenue, false
  of cost: TikTok credits back invalid traffic afterwards. Rejected: `force` on
  the nightly run, which would have switched off the late-video backfill in the
  same move, so the window is a separate `refreshDays` argument. Seven days
  chosen from measurement, not habit: days four and five out had drifted, days
  eight and beyond matched exactly. Cost is one report call per store per night
  per day in the window.
- 2026-08-24: **A creator opening a brand leaves Wurx and enters that brand.**
  Rashid: *"take him to a new world ... user will land in new world in full
  screen all menu items will be hidden ... these tabs will be the new menu on
  left side"*. `/app/brands/:slug` is therefore a top-level route that does NOT
  nest under `ShellLayout`, and its rail carries two lists: the brands, and the
  open brand's sections. `/app/brands` opens the first brand rather than an
  index. The way out is a slim Wurx strip at the top of the rail, chosen over
  hiding it in an avatar menu. **REVERSED 2026-10-09: a hub is a screen of the
  app again, nested under `ShellLayout`. See the entry at the end of this file.**
- 2026-08-24: **An admin picks ONE colour, and the product derives the rest.**
  Every other colour lives in `tokens.css` where `check:contrast` fails the
  build; a colour in a database row bypasses that guard entirely, so a palette
  of pickers would be several ways to ship an unreadable hub with nothing
  failing. `src/lib/brand-theme.ts` derives the rail, hero, page, cards and
  every TEXT colour, choosing text by MEASURING contrast against the background
  it lands on. `check-brand-theme.mjs` runs 88 colours through 13 pairs in both
  modes inside `pnpm build`. Rejected: three pickers with a warning, and a full
  palette, both of which move the risk onto whoever is filling the form.
  **NARROWED 2026-10-09:** the principle stands, but only the accent and the hero
  are rendered now, so the page, cards, rail and their text colours are still
  derived and audited but never shown. See the entry at the end of this file.
- 2026-08-24: **A brand world honours the theme toggle**, rather than being one
  fixed look the admin designs. Dark and light stay equal citizens, so a brand
  has a dark face and a light face and a creator working at night stays in the
  dark. Rejected: the mockup's single fixed look, which breaks that rule.
- 2026-08-24: **The world rebinds the ordinary `--wx-*` tokens for its
  subtree.** The first version themed only the shell, so a deep green rail
  framed Wurx-gold cards: the chrome had changed and the content had not.
  Pointing `--wx-bg`, `--wx-surface-1`, `--wx-text` and friends at the brand
  palette themes every existing component with no component changes. Success,
  danger, warning and the stage colours are deliberately NOT rebound: they are
  semantic, and a red brand must not turn every approved badge into a warning.
  **REVERSED 2026-10-09 for everything except the accent family.** Success,
  danger and warning staying unbound still holds. See the entry at the end.
- 2026-08-24: **The creator screens lost their title rows too, and the one
  line each was saying moved into the top bar.** Rashid, on Contests: *"write
  this everything. line in header and remove Contests ... as we did in admin
  side to reduce the space"*. The admin side did this on 2026-08-16; the
  creator side had been carrying the debt as PARKED 0b ever since. The line
  lives on the NAV ITEM, next to the label it appears beside, and
  `sectionDescriptionFor` resolves it by the same longest-prefix rule as the
  title, so a screen can never be captioned with a neighbour's sentence. It is
  hidden below `md`, where the bar has no room and the section name alone is
  the answer. The Home greeting STAYS, because it greets the person rather than
  naming the section; it steps down to an `<h2>`, as do the rejected and
  unfinished full-page states, since the bar owns the page's only `<h1>`.
- 2026-08-25: **A creator offer card shows the money and hides the prose.**
  Rashid: *"we need to make this card with minimum information and then
  accordion open up with more info"*. Every retainer carries the same three
  paragraphs about samples and posting, so printing them on each card put three
  cards of identical text between a creator and the figures they came for. The
  description is now a `<details>`: open and closed for free, keyboard operable
  for free, and still found by the browser find-on-page while shut, which a
  hand-rolled accordion is not.
- 2026-08-25: **A contest card is tabs, not a stack.** Rashid: *"how boring ...
  user needs to scroll a lot and all is messy please organize"*. Rewards, the
  facts and Why join were printed one under the other, so one contest ran to
  about three screens and a creator scrolled past two blocks to reach the one
  they wanted, on every contest in the list. They are three panels in one box
  now, with the transparent underlined tabs he asked for rather than filled
  pills. Two rules that came out of building it: a tab is only rendered when
  something is behind it, because an empty tab costs a click to discover it was
  nothing; and the panel carries a min-height, or the card jumps between a
  three-row reward list and a one-line perk and drags every neighbour in the
  grid with it. The hero also came down from 26rem to 20rem: at 26 it was 540px,
  about 40% of the card, with a dead band in the middle of it.
- 2026-08-25: **A Brand Hub overview is the products and nothing else.**
  Rashid: *"the boring meet the brand ... and button below it see offer is
  wasting space no need remove it"*. Both were repeating their neighbours: the
  paragraph was the brand description the hero directly above already prints in
  full, and "See 1 offer" was a third route to a tab already lit in the rail and
  already linked from the hero. Products became elevated cards with the picture
  leading and the commission ON the image, because a creator scanning a grid is
  looking for the cut and on the picture it is found in one pass.
- 2026-08-25: **The hero call to action is glass, not a filled button.** A solid
  accent button on a photograph is a second poster competing with the picture.
  It keeps the block's text-shadow and fills solid on hover, because glass over
  an unknown upload is exactly where a control disappears.
- 2026-08-25: **A brand's look is FOUR AREAS, not one colour.** Rashid: *"some
  brands have multo color themes so our app should be designed accoridnlgy"*.
  The one-colour rule from 2026-08-24 was defended on safety grounds and the
  safety argument was right, but the conclusion drawn from it was wrong: what
  one colour bought was READABILITY, and readability is not a function of how
  many colours somebody picks. It is a function of which colours end up as TEXT,
  and an admin was never picking those. The rule is now **the admin picks fills,
  the product picks inks**, and it is strictly stronger than the old one because
  it says what is actually being protected.
- 2026-08-25: **A picked colour keeps its hue and its saturation; only its
  brightness is clamped, and only when it falls outside its area's band.** The
  alternative considered was remapping every stop's lightness proportionally
  into the band, which preserves the SHAPE of a gradient better but moves
  colours that were already fine. Rejected: an admin who pastes the hex a client
  sent them and gets a different hex back stops trusting the tool, and the
  swatch that says "this is what we will use" is the whole reason they can be
  handed sixteen pickers.
- 2026-08-25: **A band must never straddle the middle of the lightness axis.**
  Learned the expensive way: the first accent band was 0.38 to 0.62 in light
  mode and 869 of 1200 random themes failed on it. A button's label is one
  colour and cannot clear both ends. Every band now sits entirely on one side of
  the divide, which is what the derived theme always did at 0.45 and 0.72.
- 2026-08-25: **The theme is jsonb in one column, not sixteen colour columns.**
  A list per area is ordered and will grow; sixteen nullable text columns would
  be a migration every time somebody wants a fourth stop and still could not
  express order. The cost is that jsonb holds anything, which is paid for by
  `brand_theme_ok()` refusing unknown keys in the database, `.strict()` Zod in
  the browser and again in the Edge Function, and `readBrandThemeConfig`
  dropping anything unrecognised on the way back out. An unknown key is
  precisely how a TEXT colour would arrive.
- 2026-08-25: **Dark and light are still one set of picks, not two.** Rejected
  giving an admin a separate palette per mode: it doubles the work for every
  brand and doubles the ways to get one of them wrong. Because the band is per
  MODE and the hue is kept exactly, one pick genuinely serves both, which is the
  payoff for having done the colour maths in OKLCH rather than HSL. The escape
  hatch for a brand that really does want a pale hero or menu is a `tone`
  toggle, which changes the BAND rather than the colour.
- 2026-08-25: **Semantic colours stay out of it.** Success, danger, warning and
  the seven stage colours are still not themed, so the stage tracker inside a
  brand world is blue and the content bar is green whatever the brand is. That
  is deliberate — an approval has to look like an approval in every brand — but
  it is the most visible thing a multi-colour theme does NOT reach, and it is
  the first question to expect.
- 2026-08-25: **Stitch (the MCP design tool) was asked for an offers page
  layout and produced nothing.** `generate_screen_from_text` timed out and
  `list_screens` came back empty afterwards, so no design was returned and none
  was used. Recorded so the next attempt starts from "it has failed once on a
  long prompt" rather than from scratch.
- 2026-08-26: **The TikTok Display API app is registered against the PRODUCTION
  domain**, `wurxmediahub.vercel.app`, on Rashid's choice between that, dev and a
  real domain on wurxmedia.com. The consequence he accepted: the demo video must
  be recorded on prod, so the creator-connect flow has to be live there before
  the app can be submitted, and he will record it with his own real TikTok
  account rather than seeded data.
- 2026-08-26: **`/terms` and `/privacy` exist because TikTok requires them**, not
  because anybody asked for legal pages. Both are public, unauthenticated and
  linked from the site footer, because a reviewer looks for the link and not only
  the URL.
- 2026-08-26: **The privacy policy may only claim what the code enforces.** It was
  written from a four-way inventory of the repo and reconciled against it, which
  caught a flat falsehood in the first draft ("other creators cannot see your
  figures" — they can, on the leaderboard, by Rashid's own 2026-08-20 decision)
  and stopped it quoting a retention period that nothing in the codebase
  implements. An overclaiming privacy policy is a false statement, not a tidy one.
- 2026-08-26: **Only `video.list` is requested from the Display API**, not
  `user.info.stats` or `user.info.profile`. TikTok's own review guidance is that
  every product and scope must be demonstrated on camera, so each extra scope is
  another thing a first review can be rejected on. Follower counts, if they are
  ever wanted, are a revision to a live app rather than a new application.
- 2026-08-26: **Production launched**, on Rashid unpausing the database himself.
  Order that worked and should be reused: migrations, then auth config, then
  Edge Functions, then the frontend LAST. The frontend going last is the part
  that matters — shipping it first puts an app in front of a database with none
  of its tables.
- 2026-08-26: **Prod's auth allow-list deliberately excludes localhost**, unlike
  dev's. A production project that accepts a localhost redirect is a phishing
  affordance, and nobody develops against prod.
- 2026-08-26: **Prod launched EMPTY and stays empty until Rashid answers what
  "shift all our data" means.** Moving 41 seeded creators who share one password
  into production would be the opposite of his own standing rule, so nothing was
  moved rather than guessing.
- 2026-08-26: **The creator TikTok connection is creator-facing, deliberately.**
  The standing rule that creators never see the TikTok connection is about the
  BRAND's ad account and its spend. A creator linking their OWN account to see
  their OWN view count is the opposite: they opt in, it is theirs, and they can
  revoke it from the same screen.
- 2026-08-26: **Tokens live in `public` with RLS on and no policies, not in a
  `private` schema.** The private schema is unreachable from an Edge Function —
  PostgREST refuses any schema not on its exposed list, for service_role too —
  so the "stronger" option silently broke the whole feature. RLS with an empty
  policy set denies every user role while service_role bypasses RLS, which is
  the same protection and actually works.
- 2026-08-26: **Only `user.info.basic` and `video.list` are requested.** TikTok
  requires every product and scope to be demonstrated in the demo video, so each
  extra scope is another thing a first review can reject. Follower counts, if
  ever wanted, are a revision to a live app rather than a new application.
- 2026-08-26: **Production runs the SANDBOX TikTok key until the app is
  approved**, because only sandbox authorisation completes for an unapproved
  app and the demo video must be recorded on the domain the Website URL names.
  Swapping to the production key after approval is a required step, recorded in
  PARKED 27.
- 2026-08-26: **Four Display API scopes, not two. This REVERSES the decision
  taken earlier the same day**, and the reason is worth keeping because the
  original reasoning was sound and still lost.

  The earlier entry said only `user.info.basic` and `video.list` are requested,
  since TikTok requires every scope to be demonstrated and each extra one is
  another thing a first review can reject. That is true. What it did not account
  for is that the APPLICATION had already been submitted asking for four:
  `video.list` alone was refused at the portal — Login Kit needs an identity
  scope beside it — and rather than adding `user.info.basic` alone, all three
  `user.info` scopes went on.

  That left the application asking for four while the code requested two, which
  TikTok rejects just as surely as the opposite: "requests permissions it does
  not use" is one of their listed reasons, and the consent screen in the demo
  video would visibly have shown two permissions against an application asking
  for four.

  Closing it by REMOVING the two extra scopes was the smaller change and was
  offered. Rashid chose to build them, and it is the better answer on the
  merits: a @handle, a verified badge and a follower count are things this
  product wants anyway — a brand manager judging which offers suit a creator is
  asking exactly that question — so the scopes are now used rather than merely
  justified.

  **The rule this leaves behind:** the scope list is a contract between four
  places — `DISPLAY_SCOPES`, the application, the consent list on the card, and
  `/privacy`. Changing one without the others is a rejection or a lie.
  `verify:creator-tiktok` [8] fails the build side of that.
- 2026-08-26: **Only fields we display are requested.** `bio_description` and
  `following_count` arrive free with these same scopes and are deliberately not
  asked for. Data nothing displays is data we cannot justify holding, and
  `/privacy` enumerates what we keep — that page is only true if the field list
  stays this short.
- 2026-08-26: **The profile block is re-read on every refresh, not frozen at
  connect time.** A follower count that never moves is worse than none: it looks
  live and is actually the number they had the day they linked. It is non-fatal
  in that pass, deliberately — the videos are what somebody pressed the button
  for, and losing them because TikTok declined one profile field would trade the
  thing they wanted for the thing they did not ask about.
- 2026-08-26 (late): **The app is approved for TWO scopes, not four. This
  REVERSES the reversal three entries above**, and the whole sequence is kept
  because the lesson is in the shape of it rather than in the conclusion.

  What happened: a submission dialog showed `user.info.basic`,
  `user.info.profile`, `user.info.stats` and `video.list`. The code requested
  two. I read that as an application/code mismatch, which is a real TikTok
  rejection reason, and Rashid chose to close it by building the extra two. That
  shipped to dev and to production.

  It was the wrong reading. The app's own **Scopes** page lists exactly
  `user.info.basic` and `video.list`, and that is what it was approved for.
  Requesting a scope the app does not have makes TikTok refuse the authorise URL
  outright, so **the Connect button on production was broken for about twenty
  minutes** — silently, because nothing on our side errors.

  **The rule: read the app's Scopes page, never a submission dialog.** And the
  asymmetry is worth holding onto — asking for too FEW scopes fails at review,
  weeks later; asking for too MANY breaks the product now, for everybody.

  **What was kept, and why it is not waste.** The columns, the scope-gated field
  list and the card's totals strip stay in place, dormant. Every one of them is
  driven by the scope TikTok GRANTED rather than by `DISPLAY_SCOPES`, so they
  are inert until the app has those scopes and correct the moment it does. What
  was reverted is the part that made claims: the request itself, the consent
  list on the card, and `/privacy`, all of which had started describing data we
  cannot read.

  **What this cost, and what it did not.** No re-recording: the demo video shows
  two permissions and the video figures, which is exactly what the app asks for.
  The scope-gated field list, the hidden-not-dashed totals strip, the privacy
  page correction and two new guards all came out of this and all stand.
- 2026-08-26: **The vendored WurxBase code is no longer strictly verbatim, and
  Rashid decided that knowingly.** Adding columns to their creators list cannot
  be done from outside their file. The alternative offered was a separate panel
  of ours on the brand page, leaving their code pristine; he chose the columns
  where he wants to read them. **Every addition is fenced in a
  `WURX-ADDED ... WURX-END` block**, so pulling a newer upstream version is a
  find-and-reapply job rather than diff archaeology. Nothing of theirs is edited
  or deleted; the blocks only add.
- 2026-08-26: **Paid Collab videos are joined to our ad data by TikTok's video
  id, not by brand name.** Their links already carry the id and our table is
  keyed on it, so there is no mapping table to maintain, nothing to fall out of
  step, and no spelling to get wrong. It also means a brand needs no
  configuration: connecting its ad account is what makes the figures appear.
- 2026-08-26: **The totals are per creator, not per brand.** Offered both; he
  chose per creator, so a brand's list can be read for which creators returned
  on the spend. A brand-level total is a small addition if it is ever wanted,
  and would be the one most likely to be misread, since it blends creators on
  very different deals.
- 2026-08-27: **Ad spend and ROI follow the Paid Collabs month selector**, and
  never show lifetime figures. Rashid asked for this after testing the first
  version, and he is right: every other number in that row is one month's, so a
  lifetime total beside them is a different period presented as comparable.
  "All Time" sends null bounds. The range applies to `stat_date`, which is the
  ADVERTISER's day, because that is the only boundary TikTok files against.
- 2026-08-27: **The figures provider does not cancel in-flight requests.** Its
  cache is keyed `month|id`, so a result arriving late is still correct for its
  own key and cannot overwrite a newer one. The reflexive
  `return () => { cancelled = true }` cleanup actively destroyed data here:
  changing the month grew the effect's dependency, both fetches completed, both
  returned real rows, and both results were discarded — a screen of dashes with
  200s in the network tab and no error anywhere. Unmount is guarded with a ref
  instead. **Cancel a request when a stale result would be WRONG; never when it
  would merely be old.**
- 2026-08-27: **Nothing is fetched until the period is known.** The rows render
  before the drilldown reports its month, so an ungated first pass fired a
  full-sized all-time query that nothing would display — 357 ids on every brand
  open. One render of patience halves the traffic.

- 2026-08-27: **The app's email goes out on its own subdomain, not on
  wurxmedia.com.** Rashid asked explicitly that the website's existing Resend
  sending not be disturbed, and a subdomain is the only answer that guarantees
  that structurally rather than by care. The risk that decided it runs in the
  direction people do not expect: the website mails a real opt-in list, and a
  campaign that collects spam complaints degrades the whole domain, so the
  casualty would be a password reset a creator needs at eleven at night. Cost:
  three additive DNS records, and a new subdomain has no sending reputation
  until it warms up. Quota stays shared, because Resend counts per account.
- 2026-08-27: **Vendoring WurxBase is a committed, repeatable pipeline**, not a
  codemod somebody runs once and throws away. Reconstructing the first one from
  its own output cost most of a day and was only possible because our copy still
  held the answers; it would not have been possible a second time.
- 2026-08-27: **An existing themed declaration is preserved verbatim on a
  re-vendor.** Where a rule existed before, a person chose that token, and no
  colour-distance reasoning beats it — inference re-derived `.pc-bt-sort.on` as
  `--wx-on-accent` where the human had chosen `--wx-warning`, which is white
  text on a white header. It also means a colour THEY changed is overridden by
  ours, which is the point of a reskin rather than a loss.
- 2026-08-27: **The reskin is guarded by measuring the rendered page, not the
  stylesheet.** A mis-mapped colour is not an error: the page renders, every
  functional check passes, and the text is simply invisible. Only compositing
  what is actually painted behind each label can catch it, and it caught 862
  failures on one tab that nothing else noticed.
- 2026-08-28: **WurxBase moves into OUR database, in its own schema.** Rashid
  consolidated to one app managed from one side. A SCHEMA rather than renamed
  tables in `public`, because their code says `.from('creators')` in
  forty-two places and `.from('app_users')` in twenty-four: scoping the client
  once means not one of those call sites changes. Rejected: prefixing every
  table `wb_` (touches ninety-two call sites and a re-vendor would undo it)
  and merging into `public` (a name collision waiting to happen).
- 2026-08-28: **Their `creators` is NOT merged with our creator tables, and
  the two must never be joined on a hunch.** Theirs is a paid-deal tracker — a
  brand, a deal string like "$200 for 6", who hired them, an array of delivered
  videos. Ours is a person with a login, an application and a brand hub. Same
  word, different grain. Anything wanting both joins deliberately, on TikTok
  handle or video id, in a view written for the purpose.
- 2026-08-28: **The data was copied, not moved, and ids were preserved.** Their
  project stays intact and untouched, so the cutover is one line to reverse.
  Ids are kept because `activity_logs.id` is load-bearing in their save path:
  `saveAngles` writes a row, keeps its id, and deletes everything else with
  that target. Renumbered ids would be invisible until the first save deleted
  the wrong row.
- 2026-08-28: **`json` became `jsonb` in the copy, and that is the only
  deliberate difference.** Every value in those columns is machine-written
  objects and arrays, so nothing observable changes, and jsonb is what allows
  the indexes and constraints that make their data-loss bugs impossible rather
  than merely unlikely — which is the whole reason the move is worth doing.
- 2026-08-28: **No unique constraint on (action, target) yet, deliberately.**
  It is the thing that would make the angle-test and contract overwrite bugs
  impossible, but their save inserts a new row and then deletes the old ones, so
  adding it now breaks every save on the day it lands. The constraint arrives
  with the code change, not before it. PARKED 34.
- 2026-08-28: **The isolation guard was rewritten rather than deleted.** Its
  premise was reversed by the consolidation, but the reason it existed did not
  go away. It now asserts the narrower and more easily broken rule: one client,
  one schema, and no reference anywhere to a retired project — because a
  leftover URL does not error, it quietly reports on a database nobody
  maintains.
- 2026-08-29: **The write-safety fix is a database constraint, not JavaScript.**
  The design in `docs/guides/WURXBASE_WRITE_SAFETY.md` recommended a compare-and-swap
  performed by re-reading before writing, and said plainly that it "is not
  atomic and cannot be made atomic here... closing that needs a unique
  constraint or an RPC, and constraint 3 says no DDL". Owning the schema removed
  constraint 3. A partial unique index plus a revision column closes it
  properly, in one migration, for angle tests, brand contracts and Discovery
  marks at once — with no JavaScript to maintain across releases.
- 2026-08-29: **A person's WurxBase permissions come from their own row, not
  from ours.** Deriving their role from our own would hand every `ops` account
  their `admin` — full edit on deals and money — and two of their eight people
  are viewers. `wurxbase.app_users.hub_email` is the join, and
  `useWurxbaseIdentity` reads the role and `custom_perms` Asad already
  maintains. Our role still decides whether somebody reaches /admin/collabs at
  all; that gate is ours. The derived mapping remains only as a fallback for a
  person whose address has not been filled in, and it is the more generous of
  the two, which is safe only because the route guard sits above it.
- 2026-08-29: **Deleting the last angle still deletes.** The conditional write
  makes an accidental wipe impossible, and it would have been easy to make a
  deliberate one impossible too. That is a different bug: the button exists, and
  a user who means it should be obeyed. It is conditioned on the revision, so it
  cannot be performed by a screen that never loaded — which is the actual
  distinction.
- 2026-08-29: **Discovery marks keep last-write-wins on the colour.** Angle
  tests and contracts refuse a stale write because they are documents somebody
  typed. A mark is one value chosen by clicking a swatch, and refusing the click
  because a colleague clicked first would be worse than accepting it. What was
  fixed there is the value VANISHING, which is what delete-before-insert did.
- 2026-08-29: **Ink is never faded.** Preserving alpha is right for a fill and
  wrong for ink: their faded labels were near-white on a dark strip, ours faded
  a mid-tone token, which has no contrast at any opacity. Our palette answers
  "quieter ink" with three tokens that `pnpm check:contrast` verifies in both
  themes; alpha cannot be verified the same way. 67 declarations made solid.
- 2026-08-29: **The plaintext passwords are gone, and so is everything that
  wrote one.** Rashid: yes, delete them. The column drop was the small half; the
  larger half was that five passwords, superadmin included, were hardcoded in
  `App.jsx` and shipped in the browser bundle where any signed-in person could
  read them. Dropping the column without removing the code would also have
  broken the Team screen on Monday, since add-member and edit-member both wrote
  to it. So the dead login screen, the dead join-request screen and the dead
  duplicate user modal went with them — 1,198 lines — and
  `verify:isolation` now fails the build on `password:` or `.password`
  anywhere in the vendored tree. **The five passwords remain in git history and
  should be treated as burned wherever the team reused them.**
- 2026-08-29: **The Team screen edits hub emails, not passwords.** Something had
  to replace the password field, and the honest replacement is the field that
  now decides anything: a person's `hub_email` is how they are matched to
  their role when they arrive from our sign-in. It is required when adding
  somebody, shown on every row, and flagged in red when missing — an unlinked
  person falls back to a role derived from ours, which is the more generous
  answer. It also means Rashid and Asad can fill in the eight addresses
  themselves rather than waiting on a migration.
- 2026-08-29: **A gear opens Paid Collabs settings.** Their Settings panel was
  opened by the user chip, and our chrome hides that chip because our own top
  bar already says who you are. That quietly closed the door on everything
  behind it — User Management, Access Control, God Mode — which nobody noticed
  because the panel had never been the subject of a check. A gear beside the
  bell reopens it. Not a second profile chip: our top bar owns identity, this
  owns "settings for this section". Shown only to somebody who has something in
  there; a viewer's click did nothing before, and a control that does nothing is
  worse than no control.
- 2026-08-29: **Contrast is judged per element, not against one floor.**
  `check-collab-contrast.mjs` failed below 3.0 and warned between 3.0 and 4.5.
  3.0 is the AA floor for LARGE text only — 24px, or 18.66px bold — and these
  screens are mostly 9.5px to 13px, so thirty real failures were printed inside
  pass lines as "12 below AA". The floor is now chosen per element from its own
  size and weight. This is the fifth member of the "checks that lie" family and
  the first where the check measured correctly and then judged wrongly.
- 2026-08-29: **On a tinted surface the ink is `--wx-text`.** Every faint or
  status-coloured label that failed was failing the same way: a token calibrated
  against `--wx-bg` used on a chip that moves the ground. Rejected: retuning
  `--wx-text-faint` itself, which would have changed every screen in the
  product to fix six chips in one vendored app, and would still be wrong on the
  next tint. The chip keeps the hue; the text stops competing with it.
- 2026-08-29: **All eight of their team are `ops` in our hub, Asad included.**
  The earlier plan gave Asad our `admin` so he would map to their superadmin.
  That stopped being necessary the moment `hub_email` existed: his own row
  carries superadmin, and the lookup beats the mapping. So nobody needs a
  wider role in OUR product than the job requires. **What `ops` does still
  carry is our whole admin sidebar** — applications, offers, contests, brand
  hubs — because ops and admin share a nav and differ only in what RLS lets
  them write. Narrowing that means a new role threaded through every policy;
  it is not a Monday job, and it is flagged rather than done.
- 2026-08-29: **Their app must not mount before the permission lookup
  returns.** Their App reads its session ONCE, in a `useState` initialiser.
  `identityReady` waited for our profile but not for the WurxBase row, so
  during the ~200ms lookup it mounted holding the FALLBACK role — the derived
  one, which makes every `ops` account their `admin`. The correction landed in
  sessionStorage and their App never looked again. Fahad, a viewer, arrived
  able to add, edit and delete. Found by signing in as the real accounts;
  nothing else would have caught it, because the sidebar reads the hook live
  and was right, and `verify:wurxbase-perms` read sessionStorage, which was
  eventually right. **Both were looking at the corrected value. Only their App
  held the wrong one.** The suite now asserts something their App renders.
- 2026-08-29: **A cleanup restores what was there, never a default.**
  `check-wurxbase-permissions.mjs` borrowed a real row and put `hub_email`
  back to `null` — true when it was written, because the column was empty for
  everybody. The day the eight real addresses went in, running it deleted one.
  That is the same bug I spent the morning removing from their app, rewritten
  into the guard that checks it. Capture before you overwrite, in test code
  as much as in product code.
- 2026-08-29: **Their team sees our whole admin panel, deliberately.** Put to
  Rashid with the trade-off spelled out — `ops` carries applications, offers,
  contests and brand hubs, not only Paid Collabs — and his answer was *"it's
  fien let them see all no issue"*. So the narrower role that would have
  needed threading through every RLS policy is NOT being built, and this is
  not to be re-raised as an open question.
- 2026-08-29: **The Euka proxy is a Supabase Edge Function, not a Vercel
  serverless function.** The original was a Netlify function, and the
  like-for-like port would have been `/api/euka` on Vercel. Rejected: this
  repository has fourteen Edge Functions and no `api/` directory, the secret
  store is already there, and CLAUDE.md names Edge Functions as where
  privileged server-side work goes. One kind of backend, not two.
- 2026-08-29: **It is staff-only, which the original was not.** Theirs sent
  `Access-Control-Allow-Origin: *` and required no Authorization, so anybody
  who knew the URL could pull the roster — and `type=discovery` returns
  creator emails and phone numbers. Ours verifies the token with the auth
  server and reads the role from `profiles`, not from the JWT claim, because a
  claim can be an hour stale. Faithfully porting the hole was not on.
- 2026-08-29: **The response shapes are copied exactly, bugs and all.**
  Twelve call sites in code we do not own read these objects by key. Where
  the original rounds revenue to cents, picks the newest posted date for a
  tier, or takes the first non-empty value per profile field, ours does the
  same — a "better" answer here is a number that silently disagrees with the
  one their team has been reading for months.
- 2026-08-29: **`networkidle` is banned on a Paid Collabs route.** It never
  settles on a screen holding a realtime socket, which OPERATIONS already
  recorded, and restoring Euka made these routes fire ten proxy calls that
  take seconds each — so a healthy page blew the 30 second navigation limit
  and `check-collab-ads-ui` failed on a page that was working. Every one of
  those navigations already had an explicit wait after it, so the flag was
  contributing nothing but the risk. Ten of them swapped for
  `domcontentloaded`.
- 2026-08-29: **The contrast guard waits for the screen, not for a clock.**
  Its flat 2200ms was enough until Euka calls went behind these screens;
  then Creators measured 7 elements where it has 2085 and still said PASS.
  It now settles on two conditions together — no Euka call in flight AND the
  DOM stopped growing — because a screen waiting on a seven second call is
  perfectly still, so stability alone settles in the middle of the wait. It
  also refuses to measure a tab that never filled, rather than reporting a
  pass on whatever rendered.
- 2026-08-29: **The dashboard call sends `brandId`, which the original never
  did.** Euka tightened that validator after their code was written: the
  original body answers `400 BAD_REQUEST "Input validation failed"` today,
  verified live. The original swallows a non-2xx there, so `richById` is empty
  and every video comes back with no thumbnail, no Spark code, no avatar and
  `items: 0` — silently, ON THEIR DEPLOYMENT AS MUCH AS OURS. Adding brandId
  is the whole fix. It does mean two brand faces (Aurelia, Cutler) now come
  from the dashboard rather than from the sample-request fallback and will
  look different from the old app; that is the correct photo, and after the
  cutover there is no old app to compare against.
- 2026-08-29: **`items` is `itemsSoldCount`, not `gmvOrders`.** The original
  reads a count of ORDERS into the column the table labels "Items sold". Live
  on Swisse the same video reports gmvOrders 59 and itemsSoldCount 55, and 55
  is what the per-creator export says — so the two modes disagreed about the
  same video depending on which swept last.
- 2026-08-29: **The video merge stopped writing `items: 0` over real counts.**
  `items` was the only one of six fields written unconditionally, and the only
  one the store-wide sweep does not know: the dashboard enriches FIVE videos
  however many you ask for (it reports `pageSize: 5` and ignores `limit`),
  while the per-creator sweep that fills it properly reaches ten creators a
  pass. So the column oscillated rather than filling. Now guarded exactly like
  `product`, `thumb`, `likes`, `comments` and `secs` beside it.
- 2026-08-29: **L30 GMV and tier read LIVE first, stored second.** It was the
  other way round, and that is a second, independent reason our numbers
  differed from theirs. `monthly.euka` is a cache refreshed nightly by
  `euka-checkin-background`, a scheduled Netlify function that was never
  vendored in and which writes to the project retired on 2026-08-28. On their
  deployment that cache is a day old and reading it first is harmless; on ours
  it is FROZEN — 800 of 1000 creators carry a stored L30 stamped between 29
  July and 28 August — and every one was being shown in preference to today's
  figure. Rejected: porting the nightly job, which is more moving parts for a
  staler answer. The cache stays as the fallback, because `creator_level`
  only covers the last thirty days, so a creator who has not posted recently
  drops out of the live sweep and their last known figure beats a dash.
- 2026-08-29: **One shared promise per store for brand photos, not a
  "has it started" flag.** A `Set` meant the first `BrandFace` to mount claimed
  the store id and every later one returned without ever reading the result.
  Opening a brand mounts a second face for the same store while the list's
  fetch is still in the air, so the drilldown's logo was the one that lost,
  and it stayed a gradient initial until a full reload.
- 2026-08-29: **The live-cursor name tag gets a theme-INDEPENDENT ink,
  `--wx-on-identity`.** It sits on one of seven fixed identity hues, and it
  was wearing `--wx-on-accent`, which flips — white in light, near-black in
  dark — against a background that never moves. So one theme always failed:
  white measured 2.49:1 on the teal, and once the palette was deepened enough
  for white, near-black then failed at 3.52:1 in dark. A surface that does not
  change theme cannot take an ink that does. The token is deliberately the
  same value in both blocks, like `--wx-scrim` before it.
- 2026-08-29: **The seven cursor colours were deepened, keeping their hues.**
  White measured 2.15:1 to 4.23:1 on the originals — every one under AA. They
  are identity colours, so only the depth changed; white now clears 5:1 on all
  seven. Rejected: near-black ink on the original shades, which fails on the
  violet, so it would have needed two inks and a rule for choosing.
- 2026-08-29: **The contrast guard is bounded, and coverage is the assertion.**
  Waiting for every Euka call to fall silent was correct and unusable — one
  tab took two and a half minutes, because opening Brands sweeps ten stores in
  the background and none of it changes the text on screen. A check nobody
  runs is a check that does not exist. It now waits for the first Euka answer
  plus a stable DOM, caps at 45 seconds, and carries a PER-TAB FLOOR of
  expected elements. The floor is the real protection: a wait gets outrun by
  the next thing that makes a page slower, but "did we measure as much as last
  time" keeps answering the right question.
- 2026-08-31: **`.wurxbase-root` and `.wurxbase-fence` are two elements, and
  a portal host sits between them.** One div used to be the CSS fence, the
  containing block for `position: fixed`, AND the scroller. Their app portals
  ten overlays to `document.body`, which is outside `.wurxbase-root`, so every
  fenced rule missed them — the status menu mounted as an unstyled 1500x23
  block at y=1008 in a 1000px viewport, which on screen is indistinguishable
  from a button that does nothing. Portalling into the fence would have fixed
  the styling and broken the position. So: a shell carries the class name, a
  fence inside it scrolls, and `#wurxbase-portal-host` sits beside the fence —
  inside the shell so their CSS matches, outside the fence so fixed means the
  screen. Eleven portals repointed through one helper.
- 2026-08-31: **The fence is no longer a containing block at all.** Portalling
  only reaches overlays that use `createPortal`; their contract editor and
  creator editor render inline, and inside a transformed, contained, scrolled
  box a fixed dialog is measured against that box. Measured: the creator
  editor at 56..1004 in a 1000px viewport, dragging the fence from 600 back to
  0 as the browser scrolled its autofocused input into view — "it scrolls us
  to the top". `transform` and `contain` are gone. What they protected against
  is handled where it belongs: at rest the ONLY visible fixed elements inside
  the fence were `.app-footer` and `.footer-hover-zone`, and wurxbase-chrome.css
  hides both, as it already hid their header, tab rail and sign-out.
- 2026-08-31: **Grid tracks that carry controls get `minmax` floors.** A
  fraction can be squeezed below its content and a `.pc-cell` centres without
  clipping, so a starved track SPILLS symmetrically into both gutters. Adding
  Ad spend and ROI took their table from twelve tracks to fourteen without
  widening it: Status had 115px for a 151px pill, Contract 50px for 62px of
  buttons, and the pencil — `position: relative`, so it hit-tests above a
  static sibling — swallowed the click. Dead band across the pill: 11% at
  1500px, 53% at 1024. That is why Asad could not mark anyone paid.
- 2026-08-31: **Marking a creator paid is `canEditPay`, not a name.** Their
  code compared the username to the literal string "asad" in seven places,
  and the comparison was broken besides — `id` is our auth uuid and the
  session writes lower-case `asad` against a capital `Asad`, so both halves
  were always true and EVERY attempt was refused, Asad included, with no
  write on the wire. The two payment gates now use the capability their own
  access model already defines for it; the other five keep their Asad-only
  policy and get a case-insensitive check. Put to Rashid with the trade-off,
  he chose to open payment to anyone with edit rights — and Asad has since
  denied `canEditPay` to all five of his team in Access Control, which the
  code now respects rather than overrides. The point of the change is that it
  became a setting he can flip, not a name in a source file.
- 2026-08-31: **A notification is painted directly, not through their
  aliases.** `.notif-panel` uses `background: var(--bg)`, and the retokenising
  sweep had mapped that alias — their page canvas — onto `--wx-accent-soft`, a
  14% gold wash. The panel was a translucent tint carrying near-black text at
  3.43:1 with the page showing through, so the error explaining why marking
  paid failed was unreadable. Aliases corrected AND the panel painted
  directly, because theme.css re-declares the same alias on a descendant and a
  dialog carrying an error is not the place to leave that to chance. 18.43:1.
- 2026-08-31: **The Euka sync fills blanks and never overwrites.** Rashid,
  after checking with Asad, who had also been entering things on our side:
  the two databases are deliberately NOT made identical. A field empty here
  and set there is filled; a field set here is left alone whatever theirs
  holds. That collapsed the change set from 33 to 10 and disposed of a real
  hazard rather than handling it — an earlier draft took their value on
  conflict and would have overwritten 182 true `items` counts with 0, because
  their deployment still runs the bug fixed here that morning.
- 2026-09-01: **The performance sheet is ruled, not filled, and a month
  column is sized against a number the data has not reached yet.** Rashid,
  with Asad's app open beside ours: *"numbers are not even properly visible
  ... this is the paid app so ui should be premium"*. Two faults. A month
  column was 170px holding two figures, so each half had 53px of room for a
  value measuring 61px and every five-figure GMV printed short — "10,160.00"
  as "10,160.0", which is not a cosmetic problem on a screen whose job is
  money. And nine rounds of their own restyling had accumulated in
  paidcollabs.css without any being removed, ending with every cell a
  bordered, rounded, filled box: roughly 1,100 of them on Penetrex, the
  header a gold wash, the identity column the same gold, and a full-strength
  #8a5f1f border around the lot. The column is 184px now, sized against
  123,456.78 rather than the largest figure currently in the database,
  because one creator in one good month IS six figures on TikTok Shop and
  that is the day nobody would notice it had started truncating. The
  presentation is stated once, at the end of wurxbase-overrides.css, and it
  removes rather than adds: white ground, hairline column rules, one 4.3%
  band on alternating months, ink doing the rest.
- 2026-09-01: **Sticky total columns were built and reverted the same hour.**
  Pinning Videos / Total GMV / Total Ad to the right edge sounds obviously
  right on a sheet ten months wide. The block is 444px: between it and the
  344px identity column only 422px of a 1210px viewport was ever scrollable,
  two and a half months against five without it, and at 1024px it left no
  months visible at all. It also painted itself over live figures at every
  scroll position. Kept from the attempt: the `mx-sum-*` class names, so no
  rule has to count backwards from the end of a row — which is what made the
  delete column, visible only to Asad, break the counting.
- 2026-09-01: **The identity column holds 344px until 900px wide.** A 288px
  tier for laptops was written and removed: it bought two thirds of one
  extra month at 1024px and cost every name its ending. A name you cannot
  read is worse than a month you have to scroll to. Below 900px the handle
  goes entirely and the column halves, because there a name plus two months
  beats a handle plus one. The width is a custom property read by the grid
  template in WurxUI.jsx, so the breakpoints stay in CSS.
- 2026-09-01: **Rules in the sheet block are written three `.wurxbase-root`
  deep on purpose.** Their late layers reach these elements with up to
  `(0,6,1)` and `!important` — `.pc-mx > .pc-mx-row:not(.pc-mx-head):not(
  .pc-mx-foot) > div:nth-last-child(2)` — so anything shorter wins on odd
  rows and loses on even ones, which is how the band first shipped striped in
  two different golds. There is no shorter way to say it over a vendored
  stylesheet we do not control and re-pull from upstream.
- 2026-09-01: **The header is not banded and the focused month is not
  filled.** Both were, and both cost contrast where it is least affordable:
  a month's whole GMV at 12px on band plus accent measured 4.39:1, its ad
  spend 4.38:1. The band exists to help the eye run across a hundred body
  rows; the header has a label in every cell. Marking one thing twice is what
  pushed the numbers under the floor.
- 2026-09-01: **The pinned header follows the fence, not the window.** Their
  mirror-header effect listened for `window` scroll and pinned at y=0. Our
  page never scrolls — `.wurxbase-fence` does, and an element's scroll event
  never reaches a window listener — so on a sheet of a hundred creators the
  month labels left the top after twelve rows and never came back. It now
  finds its scrolling ancestor and pins to that box's top edge. Its
  horizontal position is also synced when the clone MOUNTS: the sync lived
  inside the measure loop, which runs before the clone exists, so the pinned
  header opened at column zero over a body scrolled to July — five months of
  figures under five wrong month labels, worse than having none.
- 2026-09-01: **The Paid Collabs container paints the page canvas, and the
  rule has to name `.app-root` as well.** Rashid photographed Discovery: the
  top 375px the page colour, the 473px below it a tan block. THREE rules in
  their stylesheet paint the container, all `!important`, all at one class of
  specificity, so the last wins — App.css:3047 "App surface" via `--f7-surface`,
  :3165 "Canvas: warm cream everywhere" via `--mc-cream`, :3730 "Lift body bg
  so cards stand out" via `--wx-accent-soft`. Read the comments: every one is
  a PAGE, and every one was handed a tint. Upstream, before the retokenising
  sweep, 3730 was `#F4F5F7` — a near-white page grey chosen precisely so white
  cards would lift off it. A codemod cannot tell a pale canvas from a tint.
  Our existing rule never won for a simpler reason than load order: it carries
  no `!important` at all, so it could not have won from any position.
- 2026-09-01: **Assume a tint bug in the vendored CSS is LIGHT-ONLY until
  measured otherwise.** This one survived a full contrast pass, a screenshot
  review and eleven days of use because App.css:3368 already repaints
  `.app-root` for dark at a higher specificity. Their file carries 214
  dark-only rules and not one light-only rule, so light never got the same
  treatment. Every colour check here now runs both themes for that reason.
- 2026-09-01: **The seam was not a geometry bug, and that was worth proving
  rather than assuming.** Two plausible culprits presented themselves — their
  `.app-root { min-height: 100vh }` and our own `wurxbase-shell` fixed height —
  and a counterfactual run in a real browser against the shipped bundles
  settled it: remove the 100vh and the band is byte-identical, because the
  shell is `calc(100dvh - 3.5rem)` by design and is itself painted. One cause,
  and it is the colour. The 100vh stays.
- 2026-09-01: **The `@media print` rule was left alone.** A doubled-class
  `!important` correction does out-specify App.css:4966, so the computed print
  background changes from `--wx-surface-1` to `--wx-bg`. It is not laid down as
  ink: their `print-color-adjust: exact` at :4963 matches `.wurxbase-root *` —
  descendants only — so the container itself inherits `economy` and Chrome
  omits its background unless the user ticks "Background graphics", and then
  the delta is #ffffff to #f6f4f1 on the admin content column. Adding a print
  override would have been complexity bought for nothing.
- 2026-09-02: **Deleting a creator answers to `canDelete`, and it was broken for
  everyone before that.** Rashid: the edit dialog shows no delete button. It
  showed none for ANYBODY, Asad included — `const isAsad = (currentUser?.id ===
  'asad') || (currentUser?.username === 'Asad')` at WurxUI.jsx:3715, where `id`
  is our auth uuid and `username` is the profile display name, which is lower
  case for all eight team accounts. Measured, not assumed: every one of the
  eight evaluates the gate to false. This is the same fault as the payment gates
  fixed on 2026-08-31, missed then because that sweep searched the NEGATIVE form
  (`!==`) and this one is written positively. The other two deletes — the
  creators-table row and the performance matrix — use the repaired
  `isAsadActor()` and did work, which is why the app disagreed with itself.
  Asked on 2026-09-02, Rashid chose their own capability over a name, as he did
  for `canEditPay`. `canDelete` is superadmin-only by default, so today that is
  Asad and Rashid (our `admin` maps to their `superadmin`), and Asad can grant
  it to anyone from Access Control instead of us changing code. The row-level
  and matrix deletes were LEFT on the Asad-only rule: widening a second
  destructive path was not what was asked, and their tooltips are still true.
- 2026-09-02: **The creator picker works while editing, not only while adding.**
  Their dropdown was gated `isAdd` in three places, yet everything behind it was
  already written for edit mode — `personHistory` carries an explicit "editing →
  exclude self" line, which only makes sense if editing was meant to show it. So
  the data layer supported it and a render gate blocked it. Now open in both
  modes, with the record being edited filtered out of its own suggestions so
  "Hailry" cannot offer to auto-fill "Hailry" over itself.
- 2026-09-02: **Three read-only Paid Collabs roles, and NOT by widening
  `is_staff()`.** Rashid asked for Affiliate Team Lead, Operations Lead and Ads
  Manager: their own logins, Paid Collabs only, viewer only, "this is money
  sensitive". The obvious implementation — give them `ops` so they reach the
  collabs screen — would have handed them the entire product: `is_staff()` is
  `jwt_role() in ('ops','admin')` and it guards SEVENTY policies across
  creators, applications, offers, contests, brands and TikTok money. It is not
  touched. Instead `public.is_collabs_viewer()` is a second, narrower predicate
  used by exactly one schema, and only for SELECT; INSERT, UPDATE and DELETE on
  wurxbase still answer to `is_staff()`. Checked before writing it: every role
  test in the database is an allow-list (`=` or `in`, never `<>`), so a new enum
  value starts with zero access and gains only what is named.
- 2026-09-02: **Two migrations, not one, and that is a Postgres rule not a
  preference.** A value added by `alter type ... add value` cannot be USED in
  the transaction that added it, and each migration file is its own
  transaction. The enum labels land in one file and everything referencing them
  in the next. Combined, it fails at deploy rather than at review.
- 2026-09-02: **Export and print are a FLOOR, not a default.** Their `viewer`
  grants `canExportCsv` and `canPrintReport` as standard — Fahad and Lead have
  both. Rashid withheld them from these three: a CSV of every creator's GMV and
  commission is the one artefact that leaves the building and cannot be
  recalled. `forcedPermsFor()` is applied AFTER the role's grants and after any
  `app_users.custom_perms` override, so it cannot be lifted by editing a row —
  only by editing that list. On a money screen an override set by mistake in
  Access Control should not be able to open an export.
- 2026-09-02: **These three do not inherit from `app_users`.** For Asad's eight
  people their own row wins, which is the whole point of that lookup. For these
  three it must not: a row carrying `role: 'admin'` — created by hand, or
  carried in by the sync from Asad's database — would silently promote a
  read-only account to full edit on money with nothing on screen to say so.
  Our own role is the authority for them.
- 2026-09-02: **The Euka function admits them; the LOGIN audit row does not.**
  Euka is read-only in both directions and returns the tier and L30 GMV already
  on the screens these roles are meant to read, so refusing them left holes and
  a 403 per page load. The `LOGIN` row written by our own route was the
  opposite call: they cannot write, the insert was correctly refused, and an
  expected failure logged as an error is how a real one gets missed. Losing
  their LOGIN line costs no audit value, because they can change nothing for it
  to be evidence about.
- 2026-09-15: **Ads Manager is STAFF now, and `is_staff()` was widened on
  purpose.** Rashid: *"ads manager will have the same edit access as asad and
  rashid has which means they can edit anything"*. Offered the choice between
  making Subhan `ops` (the role stays read-only) and making the role itself
  full-edit, he chose the role. The 2026-09-02 rule "never widen `is_staff()`"
  was written to stop somebody who only READS from getting the product. It
  was never meant to stop the owner deciding who is staff, so it now reads
  "never widen it to let somebody SEE a screen". Affiliate Team Lead and
  Operations Lead are unchanged.
- 2026-09-15: **"Same as Asad" means `ops` reach plus Paid Collabs
  `superadmin`, and nothing admin-only.** Everything that admits `ops` now
  admits `ads_manager`. Nothing gated `jwt_role() = 'admin'` does: editing
  other people's profiles, TikTok health, connect and sync. Asad does not have
  those. Paid Collabs maps the role to `superadmin` because Asad carries it
  there (through his `app_users` row) and so does Rashid. The two
  `isAsadActor()` deletes were NOT widened. They check a username, Rashid does
  not get them either, and reopening a destructive path was not what was asked.
- 2026-09-15: **The two old Ads Manager test accounts were deleted**
  (`adsmanager@`, and a leftover `probe-ads_manager-…` from the 2026-09-02
  probe), so Subhan is the only Ads Manager, as Rashid said. The probe left
  that account behind because its cleanup swallowed the delete error. The new
  probe reports a leftover account as a FAILURE.
- 2026-09-15: **`review_application` refuses every team account, not just
  ops/admin/strategist.** Widening the reviewer list was the moment to notice
  that the protected-target list had never named the Paid Collabs roles.
  Approving a stray application from one of those logins would have silently
  made that colleague a creator.
- 2026-09-15: **The Top videos total is the New video GMV COLUMN, not the ten
  thumbnails.** Rashid named the column. A total of the best ten would be a
  smaller, different number sitting beside a column that disagrees with it. It
  sums the rounded per-row figures, because those are the numbers printed.
- 2026-09-15: **Two layouts for the strip, never a third.** Ten full-size
  thumbnails plus a total do not fit a laptop. Letting the row scroll put the
  tenth video UNDER the total, a shape nobody would choose. So the thumbnails
  shrink to fit (down to 76px), and below that the total moves above them.
  Sized by the strip's own width (a CSS container query), not the window's,
  because the sidebar and the text-size control change the room available.
- 2026-09-15: **The day filter uses EUKA's posted date and says what it cannot
  see.** 11% of saved videos are pasted links EUKA has not dated yet. The bar
  prints how many, rather than letting a day look emptier than it is.
  Filtering never re-indexes the rows, so an edit made while filtered lands
  on the right video. Adding or pasting rows clears the filter, because a new
  row has no date and would vanish the moment it was added.
- 2026-09-15: **Paid Collabs ad spend and ROI come from EUKA, not from our
  TikTok connection.** Rashid: "let's move with euka for now". Measured the
  same day on 23 Penetrex videos matched to Paid Collabs: Euka had figures for
  all of them and our own TikTok data for only 2. Where both existed they
  agreed within 3%. `ads_totals_for_videos` is NOT removed, because creators'
  My numbers still read it.
- 2026-09-15: **A scheduled sync into our database, not a live call.** Euka's
  per-campaign report 504s at about 45s on the first ask for a window. A month
  across all stores took 74 calls and 65 seconds, and the spark export is
  capped at 150 rows a call. Every run is limited to 100 seconds and claims
  units from a queue, so no single run has to finish the job.
- 2026-09-15: **Month grain, and only rows where money moved.** The screen
  only asks for whole months or all time, and one campaign-month is one Euka
  call. Splitting a window and summing was proven exact: 7 single days came to
  the same $427.71 as the one 7-day call, so a finer grain later would not
  change any number. Zero rows are not stored, because the screen shows no
  row as a dash, and a stored zero would falsely claim nothing was spent.
- 2026-09-15: **A campaign list Euka cuts short is recorded, never assumed
  complete.** Euka rejects paging even though its spec documents it. Aurelia's
  ad account reports 81 campaigns and lets us read 43, and
  `euka_ad_sync_stores.last_error` says so.
- 2026-09-15: **For spark codes, the row's own code wins.** Euka only fills a
  blank. Nothing is written back to Asad's `video_codes`: the fallback is
  display-only, so their data stays theirs.
- 2026-09-15: **The Euka sync queue is oldest-due first.** Ranking by newest
  month first let September's constant 4-minute timeout retries starve August
  completely: every Penetrex and Dr Tobias August campaign waited 40+ minutes
  after coming due, and Rashid saw August "showing nothing". Taking jobs in
  the order they became due gives every month a turn, and keeps a retry close
  enough to its timeout to catch Euka's warm answer.
- 2026-09-15: **...but never-fetched units go before any retry.** Pure
  oldest-due had the opposite failure within the hour: nine campaigns that
  time out on every attempt came back every 4 minutes and took all four
  workers in every run (17:45 to 18:25, "ok 0, failed 4" each time), while
  units never tried once waited. The order is now never-tried first, then
  retries by oldest due. That means neither new work nor any one month's
  retries can hold the queue.
- 2026-09-16: **The deals count sits on the corner of the creator's face, not
  beside the tier tag.** Rashid asked for "another tag" next to L1/L2 showing
  how many deals we have had with that creator. Beside the tag was built
  first and measured: it took 31px from every name, and at 1600px the brand
  page's names fell from 48px to 17px, one letter and dots. On the face's
  corner it costs the name nothing. If he wants it beside the tag anyway, the
  Creator column has to get wider first.
- 2026-09-16: **The deals count follows the month picker, across every brand.**
  Built first as a lifetime count, on the reasoning that a relationship is not
  a month. Rashid reversed it the moment he saw it: *"month wise brand deals
  not overal"*. So a month counts that month's deals across every brand, and
  All Time counts the person's whole history. Brand and month together was
  offered and rejected: a brand page row IS that brand's deal for that month,
  so the circle would read 1 on nearly every row. The hover text names which
  it is, because the same circle now means two different things.
- 2026-09-16: **Tier colours follow Euka's hues** (L1 blue, L2 violet, L3
  teal, L4 green, L5 lime, L6 amber, L7 orange), because the team reads tiers
  in Euka all day. They are not the status colours, so a high tier never reads
  as a warning. Rejected: a gold scale for higher tiers, which collides with
  the accent and with warning in light mode.
- 2026-09-16: **The Top videos totals count each video once.** Rashid's boss
  asked for sums of views, GMV and ad spend. The day before, the GMV total
  had been defined as "the column, added up", so that a calculator agrees
  with it. That stopped being right once it was measured: 84 Penetrex videos
  sit under two deals of the same creator, and the columns would count
  2.07M of Penetrex's views twice, along with those videos' ad money. The
  true figure wins over the calculator. The hover text says how many videos
  were counted once, so a difference from the column is explained where it
  shows.
- 2026-09-16: **Blue, green and red for views, GMV and ad spend are the info,
  success and danger tokens.** Those are status colours, which are normally
  kept for states. They are used here because he named the colours, and his
  words beat the house rule. Nothing else on that strip is a status, so
  nobody can read "red" as "something is wrong" by mistake.
- 2026-09-17: **A client share link is a password, and is stored like one.**
  Only its SHA-256 lives in the database, so a leak of our tables hands nobody
  a working link; the link itself is shown once, at creation, and cannot be
  retrieved afterwards. It also carries a required expiry and a revoke switch,
  and every view is recorded. Rejected: a readable token column, which would
  have made "show me that client's link again" possible and a database leak
  catastrophic.
- 2026-09-17: **The client's data comes through an Edge Function, not through
  RLS.** `anon` has no grant on the `wurxbase` schema and is not getting one:
  the schema's own migration says "anon gets nothing. Paid Collabs is behind a
  login and always will be". The function runs as the service role, proves the
  link, and returns a PROJECTION built field by field. Rejected: an
  anon-callable security-definer RPC, which would have put a door on the
  database itself for the sake of saving one function.
- 2026-09-17: **Hidden means absent, not invisible.** Ad spend, ROI, allocated,
  paid, cost per video, payment status, phone numbers, emails, payment details
  and internal comments are never read into the payload, and a switched-off
  section has no key in it at all. A field merely hidden by CSS is one "view
  source" away from being read, and this is somebody else's client data.
  `verify:collab-share` proves it against the real values in the database.
- 2026-09-17: **Only ops and admin can mint or revoke a link.** Not
  ads_manager, though `is_staff()` has admitted it since 2026-09-15, and not
  the read-only collabs roles. Handing a brand's numbers to an outsider is an
  owner's decision, so the check is written out rather than inherited.
- 2026-09-17, later: **The client sees the staff Brands view, minus ad spend
  and ROI.** Rashid relayed his boss: "we need to show them exact same view as
  we have they will just not be able to see ad spend and roi at any cost". That
  SUPERSEDES the field-by-field answers earlier the same day (budget and
  remaining only, no payment status): the client page now carries the same five
  KPI cards, the same top-videos strip and the same table, wearing the vendored
  stylesheet, with Status as a read-only pill.
  Still absent, and these were confirmed with him: **ad spend and ROI** (never
  sent to the browser), the **contract PDF** (our agreement with the creator),
  and every write control — no dropdown, no actions, no export, no fields.
- 2026-09-17: **Tier and L30 GMV come live from Euka, cached per store for 30
  minutes, and the page never waits for them.** `creators.monthly.euka` holds
  both and could not be used: that cache is frozen at migration day, so a
  client would be shown July's figures. The first version awaited Euka's export
  and the request 504'd, which is a client page failing because somebody else's
  API is slow. Now a stale map is served at once and the refresh runs after the
  response; only a store with nothing cached waits, and only for 8 seconds.
- 2026-09-18: **The client page reads tier and L30 GMV from BOTH Euka exports,
  as the staff screen does.** Rashid, twice: "still can't see where is their
  gmv". `creator_level` is the 30-day creator list and caps at 1000 rows per
  shop, so anybody quieter than the top thousand is missing from it; the staff
  app also harvests the same two fields from `creator_videos` rows (its
  `getVidProfileMap`), which reaches everybody who posted. Reading only the
  first is why a client saw dashes where he saw figures. Both are read now,
  per store, cached together, with the 30-day list winning where both answer.
- 2026-09-18: **A dash under New video GMV is the truth, and was proven rather
  than argued.** Every NutraHarmony September video was compared with Euka's
  own export: our total and theirs are both $378.29, and of the 67 videos we
  record as zero Euka reports zero for all 67. Those creators have made no
  sales on those videos yet. The staff screen shows the same dashes on the same
  rows, because both read the same stored figures.
- 2026-09-18: **A client link is stored, not just fingerprinted, and can be
  copied again.** This reverses the previous day's decision, and the reasoning
  it reverses was thin. Hashing protected exactly one case — this table leaking
  WITHOUT the rest of the database — while everything a link opens sits in that
  same database. The cost was daily: Rashid, looking at the list, "no option to
  copy again and we should be able to open it and see details". What protects a
  link is unchanged and none of it was the hash: RLS on with no policy, grants
  to service_role only, the functions admitting ops and admin alone, plus
  expiry, revocation and a recorded view count. Links minted before the change
  keep no address and can only be replaced; the screen says so.
- 2026-09-18: **A link can be given a NEW address in place.** The old one dies
  the instant it is issued, and the label, brands, months, sections and view
  history stay on the same row. It is the answer both to a link that was never
  stored and to one that has spread further than intended, and it is gentler
  than revoke-and-recreate, which loses the history.
- 2026-09-18: **Follower counts for creators Euka's shop data does not cover
  come from Euka's market intelligence, looked up by handle and stored.**
  Rashid: "is there any other way of fetching their follower count ... maybe
  through handle". Euka's per-shop exports describe only creators active in one
  of our shops in the last thirty days (380 of 464 had no count). Its
  `/market-intelligence/tiktok/creator/rank` searches TikTok's whole creator
  population by keyword. Rejected: TikTok's Display API (needs each creator to
  connect; zero have), scraping tiktok.com (fragile, against their terms), and
  `creator/detail` (needs Euka's own creator id, which we do not have).
  **Only an exact handle match is stored** — the endpoint is a search, and a
  near match is somebody else. Where both sources know a creator the counts must
  agree within 50%; on the first eleven they did.
- 2026-09-18: **Euka rations fresh market-intelligence lookups**, so they are
  done four at a time in the five-minute sync and fill over a day or two. A
  handle Euka has answered before comes back instantly; a new one, after a few
  dozen in an afternoon, gets `503 "Market Intelligence service is
  unavailable"`. A failed lookup is RECORDED and put back in line for a day:
  leaving failures unrecorded kept one failing handle at the front of every run
  and nobody behind it was ever looked up.
- 2026-09-21: **The Brands screen's New Video GMV is rounded ONCE, from the
  exact sum, not built from the rounded brand cards.** Each brand card rounds
  to the dollar, so the two can differ by under 50 cents a brand (August 2026:
  cards add to $27,451, exact $27,449.47). The exact figure is the true one, a
  spreadsheet of the videos agrees with it, and the hover says it is rounded
  once. Both are computed by one function, `wxVideoTotals`, so they cannot
  disagree in any other way.
- 2026-09-21: **The Brands card row is sized by its own width (a container
  query), not the window's.** It sits beside the floated month controls from
  64rem, so a window-width breakpoint cannot know how much room it has: their
  five-card version was cutting "$94,090" off at 1024px. Six in a row needs
  about 135px a card, so below 54rem it becomes three by two rather than six
  squeezed cards with wrapped labels.
- 2026-09-01: **"Private" is gone from every public page, because TikTok's rule
  bans the word and we volunteered it.** The Display API app was rejected for
  "personal or company internal use". TikTok's App Review Guidelines say, under
  Description, "Apps must not be for private or personal use" — and our scope
  explanation opened "Wurx Media Hub is a private platform", while `/terms`, the
  page the submission form tells a reviewer to check, opened "What this platform
  is" with "a private workspace, not a public marketplace". The product never
  matched the rejection: creators own their own accounts and only they and our
  staff see their figures. The words did. `Terms.tsx` now opens on independent
  creators and open applications, both true of the landing page already, and
  carries one plain sentence a reviewer cannot miss: creators own their own
  accounts and Wurx operates none of them. `Privacy.tsx`'s "our own internal
  rules" became "our staff data handling rules". The "private target" sentence
  in Privacy was deliberately LEFT — it describes a creator's own contest
  target, which is the honest meaning of the word, and changing it would have
  been cargo-culting the fix.
- 2026-09-01: **`/tiktok` exists because TikTok require a developed site, not a
  landing page.** Their words: "Your website URL cannot be a landing page or
  login page. You must have an externally facing fully developed website." We
  submitted the bare marketing page, and no signed-out page anywhere described
  the connection being applied for — so a reviewer could read that we sell a
  creator platform but could not see the feature under review. The new page
  states whose account it is, the two permissions, who can see the figures, and
  how to disconnect. It says the figures are visible to the creator AND to our
  staff, because `creator_tiktok_videos` carries a staff SELECT policy: "only
  you can see them" reads better and is false, and describing less access than
  you take is what a reviewer is looking for. Linked from the footer, not merely
  reachable, for the same reason the other two are.
- 2026-09-01: **This shipped to production on its own, off `main`, not by
  deploying `dev`.** `dev` is 39 commits and 7 migrations ahead of production —
  the whole Paid Collabs consolidation. Rashid's TikTok resubmission needed a
  copy change on the live site and nothing else, so it went out as copy alone:
  no migration, no behaviour change, no schema. The bigger "make it live"
  decision stays open and untouched.
- 2026-09-22: **The TikTok submission keeps our own address; we built the
  website instead of moving it.** Rashid chose this over a
  `creators.wurxmedia.com` subdomain, which would have been the stronger
  "official" signal but moves every OAuth redirect URI, the Supabase auth URLs
  and TikTok's URL verification — each one a place sign-in breaks. Nothing
  about authentication moves this way. If TikTok rejects the vercel.app address
  itself, the pages are built and only the address changes.
- 2026-09-22: **The website's words live in one content file**
  (`src/content/site-pages.ts`), and every company fact in it is copied from
  wurxmedia.com. A reviewer reads both sites; two versions of the address, the
  founders or the figures is exactly the inconsistency the icon rejection was
  about. Editing the copy must never mean editing a component.
- 2026-09-22: **The tab icon is the official artwork, not a redraw.**
  wurxmedia.com's `/favicon.svg`, byte-identical apart from the `viewBox` it
  was missing — TikTok's note was that the icons must match, so a similar mark
  drawn by us would have invited the same reply. `verify:site` fetches the live
  official file and compares, so the day theirs changes, ours fails.
- 2026-09-22: **The public pages are indexable, the rest of the product is not,
  and dev never is.** Rashid asked for the website to be findable. The rule is
  deny by default — `index.html` ships `noindex` and only the public pages lift
  it — because a wrong default here publishes a creator's screen, while a wrong
  `noindex` merely hides a marketing page. It is lifted ONLY on the live host
  (`src/lib/seo.ts`): dev is a complete second copy of the site on its own
  address, carrying test brands and seeded creators, and offering Google both
  is how the wrong one gets ranked. `verify:site` proves the rule by serving
  the build under test AT the live address and reading the tag, rather than by
  reading the source.
- 2026-09-22: **The official site is the source of truth for business facts,
  and where we disagreed with it, we changed.** Rashid: "i don't want to read if
  everything is correct for my business ... you can find about our business here
  wurxmedia.com and wurxmedia.com/content". Both were read in full. Our landing
  page had claimed 5K+ creators since July; theirs says 1,000, and a TikTok
  reviewer reads both sites, so ours came down. The site described a third of
  the business (a creator programme) where Wurx sells six services, two of which
  ARE this hub. **A number nobody can source to wurxmedia.com does not belong on
  our public pages.**
- 2026-09-22: **The privacy policy now describes the Paid Collabs records.** It
  said we hold no phone number; `wurxbase.creators` has held a WhatsApp number,
  an email, a PayPal or Zelle handle and staff notes for every creator we have
  paid, since the migration. The code has protected those fields since the
  client links shipped, which made the omission easy to miss: the fields were
  guarded, just never disclosed to the person they describe. A policy that
  under-describes what you hold is a false statement, exactly like one that
  overclaims.

## TikTok-first signup: we mint no sessions (2026-09-29)

**Decision:** the browser creates the account with the same `supabase.auth.signUp`
the apply form already used. Our server never issues a session. It only ever
answers "whoever holds this ticket proved, a moment ago, that they control
TikTok account X", and binds that to an account Supabase has already created.

**Why.** There is a Supabase setting that stamps a creator's role onto their
login token, and it defaults to OFF. With it off nothing errors: the password
works, the login succeeds, the dashboard loads, and every query returns empty.
A creator sees a working product with no numbers in it. Any login path we invent
can skip that stamp; the path the product already uses cannot. And a defect in
session-minting code does not look like a bug — it looks like a successful
login, which is the one failure Rashid said he cannot absorb.

**Rejected:** creating the account with the Supabase admin API. With email
confirmation off it marks an address confirmed that nobody proved; with it on it
tells the new creator to check an inbox for a mail that is never sent. It also
bypasses the dashboard's own signup switch and the platform rate limit.

**Rejected:** making TikTok able to create accounts from scratch. TikTok never
returns an email — no scope provides one, confirmed against their docs — so such
an account could never be recovered or contacted. TikTok may only ever open a
door that already exists.

## One TikTok account, one application — and a rejection is not permanent (2026-09-29)

**Decision:** `tiktok_identities` is a ledger separate from
`creator_tiktok_connections`, because that table frees a TikTok account on
disconnect by design. A claim outlives the connection, the rejection and the
profile. Staff can release one, with a reason, and it is audited.

Rashid, asked whether a rejection should be for ever: *"it should not be
permanent, we should let admin review the rejected again"*. So the release
shipped in the same step as the rule — a rule with no visible way out is the
same as a permanent bar.

**Rejected:** enforcing "the same PERSON cannot apply twice" via TikTok's
cross-account id. A second TikTok account is free, the id is blank on some rows,
and an automatic refusal would occasionally lock out a real creator for a reason
nobody can see. Recorded, never enforced.

**Rejected:** blocking a repeat application by EMAIL alone, and telling the
visitor. A stranger could then type any address and learn whether that person
applied and was rejected. After TikTok has vouched for them it is safe to say,
because we are telling them about themselves.

## PKCE is not available to us (2026-09-29)

TikTok's own documentation: `code_verifier` is "required for mobile and desktop
app only". So an authorisation code cannot be cryptographically bound to the
browser that began the flow, and that hole cannot be closed — only narrowed.

What we do instead: the browser generates a secret, keeps it in sessionStorage
and sends only its SHA-256; the code never reaches the address bar, history or
referrer; nonces last fifteen minutes; one nonce per creator is live at a time.
**Narrowed, not closed** — and written into the checks so a green suite is never
read as more than it is.

## Product groups partition the creators; the band overlaps them (2026-09-29)

**Decision:** on a brand's creator table, each creator appears exactly once,
under the product most of their videos are for. The Product performance band
above keeps counting every creator who touched a product, so the two will show
different numbers for the same product.

**Why.** The row carries per-creator money — deal, total views, new-video GMV,
L30 GMV, ad spend, ROI. A creator listed under two products shows that money
twice on one screen, and any total a human adds up off the page comes out wrong.
Ten of Penetrex's thirty-four September creators posted for more than one
product; a row-per-product table is 53 rows for 34 people.

**Rejected:** listing a creator under every product they posted for, so the
group counts would match the band's. That buys agreement between two numbers at
the price of a screen that double-counts money — the wrong trade in a product
whose whole promise is that the numbers are real.

**Rejected:** scoping each row's figures to the product it sits under. GMV and
views could be scoped; the deal, items sold, ad spend, ROI, contract and status
cannot — they belong to the creator, not the pairing. Half a row scoped and half
not is worse than either.

**The two counts are allowed to disagree because each reconciles with the total
beside it:** the band's products add up to the GMV card above them, the groups
add up to the "N creators" pill next to the search box. Neither is wrong; they
answer different questions.

## The status dividers stay outside the product groups (2026-09-29)

**Decision:** Payment Pending / Videos in Progress / Payment Sent remain the
outer split, with the product bands inside them, which is what Rashid's mockup
drew.

**Why.** Payment state is how this team WORKS the list — "who do we owe" is the
question that gets asked every week, and the count on that divider is the answer.
Product is how they READ it. Putting product outside would fragment "17 pending"
into per-product pieces and lose the number they actually use.

**The consequence, accepted:** a product appears once under each status it has
creators in, so the same product name can show three times on one page. Each
band folds independently, keyed on status-and-product together.

## The contract is redrawn in OUR file, not in the vendored one (2026-10-02)

**Decision:** the whole design lives in `src/routes/admin/contract-paper.js`.
`src/vendor/wurxbase/contractPdf.js` keeps its original renderer and hands off
to ours on one fenced line.

**Why.** That file is a verbatim copy of WurxBase's code, and the verbatim rule
exists so the next upstream pull is find-and-reapply rather than diff
archaeology. Replacing a whole renderer inside it would have made the diff
unreadable. One fenced line is one thing to re-add.

**Rejected:** editing their renderer in place. **Rejected:** forking the file
out of `vendor/` entirely — `WurxUI.jsx` imports `defaultContractFields` and
`CONTRACT_SECTIONS` from it, and moving those is a bigger change than this one.

## How a signature should get onto the contract (2026-10-02, OPEN)

**Not decided.** Rashid: *"for usman signature i am not sure how asad's is being
generated but i can get the signature as image or what is the best fit u need to
tell me that later first build ui"*.

**What happens today, unchanged:** the Brand Representative line is auto-signed
by drawing `fields.signerName` (default "Aris") in a script typeface on an
offscreen canvas. It is not an image of anybody's handwriting — it is a name set
in a cursive font, and it will render differently on a machine that does not
have that font installed.

**The options to put to him, in order of what they cost:**

1. **An uploaded image per signer.** He sends a PNG with a transparent
   background; it goes in a private bucket keyed by staff member, and the
   renderer stamps whichever signer the contract names. Faithful, and the only
   option that is actually that person's signature. Needs a bucket, an upload
   screen and a rule about who may change whose.
2. **Keep the drawn name, but embed the font.** Removes the "renders
   differently elsewhere" problem for nothing but bundle weight. Still not a
   signature, just a consistent one.
3. **Leave the line blank and sign on paper.** What the mockup shows, and what
   the Creator and Agency blocks already do.

**The question that decides it** is whether these contracts are ever sent
already-signed, or always printed and signed by hand. If they are sent signed,
it is option 1 and the image needs to be treated as sensitive — a signature
image in a public bucket is a forgery kit.

## A Brand Hub is a PRISM screen wearing the brand's accent, not a world (2026-10-09)

**Decision:** `/app/brands` and `/app/brands/:slug` are children of the same
`ShellLayout` as every other `/app/*` screen. The brand supplies an accent, a logo
and a hero, applied inside the content by `AccentScope` in `BrandHub.tsx`, and
nothing else. Sections are a `HubNav` row built from the shell's `FilterBar` and
`FilterTabs`. The admin look editor offers only "Hero banner" and "Buttons and
highlights".

**Why.** Rashid: *"this page has a completely different design language why? and
it loads like a completely separate app which is very annoying it is a part of
the app Prism please design it accordingly."* Both halves were true. The look
was different because the hub repointed `--wx-bg`, the surfaces, the text and the
borders from a palette derived from the brand. And it loaded like another app
because it sat outside `ShellLayout` with its own `WorldLayout`, so every entry
and exit unmounted the whole shell and mounted a different one.

**What this reverses.** Three 2026-08-24 entries: that a creator opening a brand
"leaves Wurx and enters that brand" (full-screen, own rail), that the world
rebinds the ordinary `--wx-*` tokens for its subtree, and that
`brand-theme.ts` derives the rail, page and cards. `BrandWorldShell.tsx` and
`WorldLayout.tsx` are deleted; `paletteToVars` became `paletteToAccentVars`,
which sets only the accent family and the hero and `OfferCard` variables.

**What it keeps.** The brand still honours the theme toggle, success, danger and
warning are still never rebound, an admin still picks fills and the product still
picks inks, and `brand-theme.ts` is still one file.

**Consequences.** `rail` and `page` are retired as editable areas: still accepted
by the Zod schema so brands saved earlier keep validating, never offered and never
read (`EDITABLE_AREA_KEYS`). `check-brand-theme.mjs` still passes, but its rail,
body-text-on-brand-surface and accent-as-text-on-brand-surface assertions no
longer protect anything on screen; they were left in place deliberately rather
than weakened.

**Rejected:** keeping the world and only adding a "back to app" link, which fixes
neither the look nor the remount.
## GSAP, Lenis and React Bits join the stack, on Rashid's instruction (2026-10-14)

**Decision:** `gsap` 3.15.0 and `lenis` 1.3.26 are dependencies, and `jsrepo`
3.8.1 is a devDependency. Rashid asked for all three plus React Bits while
setting up the new laptop, which is the approval CLAUDE.md requires for a
locked-stack change. **Motion stays**, and is still what the app animates with
today; nothing was migrated.

React Bits is **not** a package. It ships as copy-in source through the `jsrepo`
and shadcn CLIs, so what is installed is the tool that fetches a component, not
the library. Nothing has been pulled in yet.

**Why `jsrepo` rather than `shadcn`.** `design/IMPLEMENTATION_PLAN.md` 1.2
says do not run `shadcn init` in this repo: it rewrites `global.css` and
`tokens.css` with its own `--background` / `--primary` variables, which clash
with the `--wx-*` bridge and the parity guard. `jsrepo` fetches a file and
nothing else.

**What any React Bits component must be converted to before it ships**, the same
three conversions the plan already lists for the 21st.dev components:

- `motion.div` to `m.div`. `LazyMotion` runs with `strict`, so `motion.div`
  throws at runtime.
- every hardcoded hex to a `--wx-*` token, with a light twin, or
  `check-contrast.mjs` fails the build on parity.
- `react-icons` to `lucide-react`, which is decision 6 in PRISM_PROGRESS.

**The unresolved tension, flagged rather than settled.** Lenis is smooth scroll,
and this app has already paid for scroll behaviour twice: the judder that was
"twelve beams animating on the main thread", and the scroll-driven depth on the
landing page. A second scroll authority on top of `useScroll` is how those come
back. GSAP likewise overlaps Motion, and two animation libraries on one page is
double the bundle on a product whose `App-*.js` is already 1,058 kB. **Neither
is wired into anything yet**, so this is a cost to weigh when the first one is
used, not a regression today.

**Proved:** `pnpm build` exits 0 with all three installed, 63 tokens at parity,
all WCAG pairs passing, 1200 random brand themes passing, isolation ok.

## The motion layer: Lenis reads nothing, Motion reads Lenis (2026-10-14)

**Decision:** `src/lib/motion/` is the only legal way into Lenis and GSAP, and
smooth scroll ships **off**, behind `VITE_SMOOTH_SCROLL`. Full rules in
`docs/guides/MOTION.md`.

**The tension the entry above flagged, resolved rather than deferred.** There is
**one scroll authority and one animation frame loop**. Lenis is the authority: it
swallows the gesture and writes `document.documentElement.scrollTop` itself.
Motion's `useScroll` is a reader — it measures that same real document scroll on
the browser's own scroll event, so the twelve existing `useScroll` call sites
were not touched and there is no second scroll position in the app. And Lenis
owns no `requestAnimationFrame`: `autoRaf: false`, ticked from Motion's loop via
`frame.update(tick, true)`. The judder this app paid for was twelve beams each
animating on the main thread; three libraries each scheduling a frame is the same
fault, so there is one loop.

**Native-scrollbar mode, no transform wrapper.** That is what keeps
`position: sticky` (the rail and the top bar), browser back/forward scroll
restoration, and focus-scroll-into-view working. All three were verified in real
Chromium rather than reasoned about.

**Reduced motion: Lenis is never constructed.** Not slowed, not
`respectReducedMotion`-ed to a 1:1 lerp — absent, so those people scroll on the
compositor with no JavaScript in the path. GSAP timelines are built and then
jumped to `progress(1)` and paused, callbacks suppressed.

**Never on `/admin/collabs`,** twice over: the path is in
`SMOOTH_SCROLL_DENY_PREFIXES` and `PaidCollabs` also calls
`useSuspendSmoothScroll`, so renaming the route cannot quietly re-enable it.

**GSAP is fenced by its type signature.** `useGsapTimeline` accepts transform
components and opacity and nothing else, so `filter`, `backdrop-filter`,
`box-shadow`, `width` and `height` are type errors where they are written — and
in dev it refuses any target that CONTAINS a `.wurxbase-root`, because a
`transform` on an ancestor is the same containing-block fault as a `filter` on
one. `ScrollTrigger`, `ScrollSmoother`, `ScrollToPlugin` and `Observer` are
banned by name: each would make GSAP a second scroll authority.

**Rejected:** driving GSAP's ticker from Motion's loop as well. Creating a tween
wakes GSAP's ticker, so `ticker.sleep()` is not a stable state. GSAP keeps its
own self-idling ticker and is restricted instead to short, user-triggered
sequences — never scroll-driven, never ambient.

**Also rejected:** fixing the four dialogs that lock scroll with
`body.style.overflow`. The provider watches `body`'s inline style and stops Lenis
on the transition, so nothing was edited and the next dialog written that way is
already handled.

**Proved:** `pnpm build` exits 0. In real Chromium, flag off: landing page has
zero console errors and `lenis` is never fetched. Flag on: Lenis mounts, the page
scrolls, `PageProgress` still tracks it, `html` `scroll-behavior` is forced to
`auto`, document height is unchanged, the sticky rail holds at 0px after
scrolling 477px on the signed-in shell, `body { overflow: hidden }` stops and
resumes Lenis, an anchor link reaches `#apply-form`, and zero console errors
throughout. Flag on under `prefers-reduced-motion`: Lenis does not mount at all.

**Not proved:** cost on a real phone (every browser suite runs `--disable-gpu`),
and the Paid Collabs suspension on screen, which needs staff credentials this
machine does not have.

## The shared settings row looped through every open session, and ate the organisation's Supabase quota (2026-10-27)

**Found by Rashid's usage warnings on the Free plan (organisation "WurxMedia", shared by every project in it):** Realtime messages 6.0M of 2M, egress 21.8 GB of 5 GB, log ingestion 12.2 GB of 1 GB. Not Prism (a 16 MB database, about 55,000 requests): this project, `wurxmediahub-dev` (prod is paused), found with `supabase inspect db calls --linked`: 9.9M API requests in 90 days, and the top two statements were ONE row, `wurxbase.app_settings` (id 1): **6.56M reads and 2.68M writes**, at 26 writes and 81 reads a second at the moment of looking (two snapshots 99 seconds apart).

**The loop (`src/vendor/wurxbase/App.jsx`, the settings block):** a fetch put the row's values into React state as NEW arrays; the persist effect for that state (`hired_by_team`, `custom_brands`, `brand_order`) saw a change and upserted the same values; the update was broadcast to every session (the table is in `supabase_realtime`, replica identity FULL, so each message carries the old and the new row); every session fetched (twice, there were two subscriptions to the row) and saved again. Each fetch returned the whole row (egress), each request was logged (log ingestion), each write was a Realtime message, and Realtime's WAL polling of a table written 26 times a second cost about 12 hours of database CPU.

**Two independent layers, both live:**
1. **Database** (`20261028090000_app_settings_ignore_unchanged_saves.sql`): `suppress_redundant_updates_trigger()` on `wurxbase.app_settings`. A save that changes nothing makes no row version, no WAL and no broadcast. Applied to dev 2026-10-27; the rate fell from 26 writes a second to about 5 a minute within two minutes. To undo: `drop trigger a_ignore_unchanged_saves on wurxbase.app_settings;`. No data was created, changed or removed.
2. **App** (`src/vendor/wurxbase/settingsSync.js`, used by `App.jsx`): a mirror of what the server last held for each key. A value that came FROM the server (or that it accepted from us) is never written back; a fetched value is applied only if it differs from the last one seen; one realtime subscription instead of two (it also reads the row once whenever it (re)connects); NO 30 second timer at all any more (it re-read the row in every open tab for ever, "in case realtime missed a message"; now the row is read on connect and when a backgrounded tab is looked at again); fetches go through a gate (a burst of events is one more fetch, not a pile). A real edit still saves once. `hideBrand`/`showBrand` still save explicitly (even before the first load, as before) and tell the mirror.

**Proof without a browser** (a browser robot must never be pointed at the WurxBase screens, rule 33 in PARKED.md): `pnpm verify:settings-sync` models the row, three sessions and the database broadcast. The OLD behaviour never settles (5,000 writes in 5,000 steps and still going), the NEW one writes nothing back after loading, a real edit is exactly one write, key order from the database does not matter, an old-format list is converted once, and the database rule alone also ends the loop for the old code.

**How to look for this again:** `supabase inspect db calls --linked` (and `outliers`, `db-stats`) from the project folder, read-only, names the statements that dominate; take two snapshots a minute apart to see a rate. See OPERATIONS.md "Where is the Supabase quota going".

