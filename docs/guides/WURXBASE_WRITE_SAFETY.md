# WurxBase write safety

**Audited 2026-08-28.** Every write path in `src/vendor/wurxbase/` was read for
one bug class, named OVERWRITE-FROM-EMPTY: *a save writes whatever is in React
state and then deletes the older stored rows, so a screen that never finished
loading destroys saved data on the user's next ordinary click.*

Twenty-seven findings were confirmed. Each survived three independent agents
whose instructions were to REFUTE it, one attacking the mechanism, one the
claimed blast radius, one the trigger; a finding needed at least two of three to
fail to refute it. Four claims were refuted and are recorded in PARKED 34 so
nobody re-raises them.

**None of this is our code.** It is Asad's product, vendored in. The parts that
matter to him are listed in PARKED 34 under "tell Asad"; the part we can fix on
our own copy is the angle-test path, designed below.

---

# FIX DESIGN — the angle-test overwrite path (`saveAngles` sweep)

Everything below was read, not inferred: `scripts/ops/wurxbase/wurxbase-patches.mjs` (all 163 lines), `scripts/ops/wurxbase/vendor-wurxbase.mjs` (file lists at :727-728), `src/vendor/wurxbase/angleStore.js` (all 222 lines), `src/vendor/wurxbase/CreativeAngles.jsx` (:1-300), `src/vendor/wurxbase/supabaseClient.js`, `scripts/build/check-isolation.mjs`, `package.json`, plus the App.jsx call sites (`:11` import, `:3419` angleMonth, `:3915` mount, `:13017` boot fetch, `:13058` logActivity, `:12070-12117` activity feed).

---

## 0. TWO FACTS THAT CONSTRAIN EVERY OPTION

**(a) `saveAngles` has exactly one caller.** `grep` over all of `src/` for `saveAngles` returns two hits: its definition (`angleStore.js:66`) and `CreativeAngles.jsx:133`. So a fix placed inside `saveAngles` covers all seven user actions (`patch`/`addAngle`/`remove`/`undoDelete`/`detach`/`attach`/`setCell`/`onRename`) with no per-call-site work. Any design that needs component cooperation is paying for something it can get for free.

**(b) `scripts/ops/wurxbase/wurxbase-patches.mjs` can only patch ONE file today.** Line 20:

```js
const FILE = 'src/vendor/wurxbase/WurxUI.jsx';
let src = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
```

`FILE` is hardcoded and `src` is a single module-level string. `angleStore.js` is vendored (it is in `PLAIN_JS` at `vendor-wurxbase.mjs:728` and is copied byte-for-byte by the loop at :734-744) but is **not** reachable by the patch mechanism as written. So *any* fix in `angleStore.js` requires a small, mechanical generalisation of the patch script first. That generalisation is specified in §4 and is part of the recommended change, not a prerequisite someone else does.

**A third fact, which decides between the options:** their fetch's winner rule is

```js
    .order('created_at', { ascending: false })
    .order('id', { ascending: true }));
...
    if (!key || map[key]) return;              // newest row per key wins
```

`created_at` is **never written by any code in the vendored tree** — `grep -n "created_at"` finds only selects, orders and reads; the four `activity_logs` inserts (`angleStore.js:77`, `brandContract.js:100`, `App.jsx:13058`, `WurxUI.jsx:5301`) all omit it. So the ordering is only correct if the column carries a `default now()` we cannot read. The strongest evidence it does: their own Activity screen groups rows by `dateLabel(log.created_at)` (`App.jsx:12117`) and renders `timeAgo(log.created_at)` (`:11694`) for rows written by `logActivity` (`:13058`), which also omits it — a NULL there would render "Invalid Date" on every row of a screen they use daily. Strong, but circumstantial. **Note where that bet lands: only option B depends on it.**

---

## 1. OPTION A — REFUSE TO SWEEP UNLESS THE SCREEN PROVABLY LOADED

Shape: a module-level `let LOADED = false;` in `angleStore.js`, set true only on the last line of a successful `fetchAngles`; `saveAngles` throws (or skips the sweep) when `!LOADED`.

**Fixes:** finding #1 completely — a browser whose boot fetch failed, was never run, or was cleared can no longer destroy anything. That is the single worst instance and it is one boolean away.

**Does NOT fix:**
- Finding #2, the two-tab / two-teammate case. Both tabs booted successfully, so `LOADED` is `true` in both, and the stale tab sweeps the colleague's newer row exactly as it does today. This is the *normal* way the feature is used — their own storage note at `angleStore.js:20-21` says "A shared table, so the whole team sees the same test."
- Finding #3's second half. The fetch succeeded, so `LOADED` is `true`; the late `putMirror` (`:61`) reverts the screen and the next edit makes the reversion permanent.
- It is a session-scoped flag answering a per-key question. "The mirror was once filled from the network" is not "the row I am about to delete is the row I read."

**Cost:** ~6 lines, one file, one anchored insertion plus one insertion in `fetchAngles`. Cheapest of the three.

**Failure direction if it misfires:** `LOADED` wrongly false → saves refused → annoyance, never loss. Correct fail-safe direction.

**If the vendor moves the code:** the anchors are asserted, the script refuses and writes nothing (`wurxbase-patches.mjs:145-146, 157-158`). But note the trap this project has already hit twice in other areas — the audit's own `godSettings` and `discovery-and-realtime` findings are both *"`settingsLoadedRef` is set to true after a FAILED load."* A loaded-flag is only as good as the one line that sets it, and that line sits next to `if (error) throw error;` in code we do not own. A future vendor refactor that moves the flag-set above an early return silently disarms the guard while every anchor still matches. **A guard that can be disarmed without breaking an anchor is the weakest of the three under re-vendor.**

---

## 2. OPTION B — NEVER DELETE; ALWAYS INSERT, INCLUDING AN EMPTY TOMBSTONE

Shape: delete the sweep (`:88-91`) and delete the `if (list.length)` gate at `:76` so an empty save writes `details: { angles: [] }`. Newest-wins picks the winner.

**Both halves are mandatory.** Removing the sweep alone would make a deliberate delete undo itself: `if (list.length)` skips the insert, so the previous row stays the newest row and the deleted test comes back on the next boot. That would violate constraint 2 outright. Removing both is required, and then the empty tombstone *is* honoured on read — `if (d && Array.isArray(d.angles))` (`:57`) accepts `[]`, `map[key] = { angles: [] }`, `getAngles` returns `[]` (`:40`). So constraint 2 can be met.

**Fixes:** nothing is *destroyed*, in all three findings. Every revision stays on the server, recoverable.

**Does NOT fix — and this is the objection:** the stale tab's row is still the newest row, so it still *wins*. The colleague's typed ad spend still vanishes from every screen; it merely also still exists in a table nobody can read from the product. There is no revision UI in `CreativeAngles.jsx` and none is proposed. "Recoverable by SQL console" is not recovered, and the person who lost the figures will not know to ask.

**Costs, two of them and both real:**
1. **Unbounded growth on a table they own.** Every blur of a cell writes a full revision carrying the whole angle list, and `fetchAngles` pages the **entire** `CREATIVE_ANGLE` set at every boot with no target filter (`selectAll`, 1000 rows a page, `supabaseClient.js:30-42`). A team using this for a month turns a one-row-per-cell table into thousands of JSON blobs re-downloaded on every page load, on their project, which also carries their audit log. A keep-N sweep gets the safety back but reintroduces exactly the delete we were removing.
2. **It bets the whole fix on `created_at` having a default** (fact (c) above). If it is NULL, Postgres sorts `NULLS FIRST` on `DESC` and **the first row ever written for a key wins forever** — every subsequent save invisible, permanently, with the UI cheerfully saying "Saved just now by you". Today the sweep hides that, because there is only ever one row. Option B is the one option that removes the thing hiding it. There is a second, milder version of the same problem: the tie-break is backwards (`id ascending` on equal `created_at` means the *older* row wins a tie).

**If the vendor moves the code:** worst of the three, and not for anchor reasons. The SWAPs would apply cleanly while the assumption underneath them — *their* `.order()` lines at `:48-49`, which we do not patch and therefore do not assert — changed. A fix whose correctness rests on a line the patch script does not touch is a fix that can silently become wrong across a version bump. That is the exact failure mode `wurxbase-patches.mjs` was written to prevent.

---

## 3. OPTION C — RE-READ THE STORED ROW IMMEDIATELY BEFORE SWEEPING  ← **RECOMMENDED**

Shape: compare-and-swap. The mirror starts carrying the **id of the row it was built from** (`rowId`). Before writing, `saveAngles` asks the server which row it currently holds for this key, **using `fetchAngles`' own ordering so the two agree on who wins**. If that row is not the one this screen loaded, refuse: insert nothing, delete nothing, repair the mirror from what the server actually holds, dispatch `wurx-angles` so the screen snaps to the truth, and throw.

Three cases, exhaustively:

| server holds | mirror's `rowId` | action |
|---|---|---|
| nothing | anything | **proceed** — the sweep can destroy nothing |
| a row, id matches | matches | **proceed, byte-identical to today** |
| a row, id differs or is absent | stale / never loaded | **refuse + heal + throw** |

**Fixes all three loses-saved-data findings on this path:**
- **#1** — mirror never loaded ⇒ no `rowId` ⇒ `baseId == null` while the server holds a row ⇒ refused. This is option A's guarantee, obtained as a special case rather than as a separate flag, and derived from the data rather than from a boolean somebody has to remember to set correctly.
- **#2** — the stale tab's `baseId` is the pre-colleague row; the server's winner is the colleague's row ⇒ refused. The colleague's figures survive.
- **#3** — after the late `putMirror` reverts the mirror to the pre-save snapshot, `baseId` is the old id and the server's winner is the row saved during the window ⇒ refused, and the heal step rewrites the mirror with the server's real content and fires `wurx-angles`, so the user watches their edit *come back* instead of watching it disappear. Self-healing, not merely blocked.

**Constraint 2 is untouched.** Deleting your last angle from a loaded screen: ids match, we proceed, `list.length === 0`, the insert is skipped, the sweep runs unrestricted (`keepId` null, no `.neq`), the test is gone. Verbatim today's behaviour, because we do not modify a single line of their write logic — the guard only decides whether to reach it.

**Constraint 4 is satisfied by construction.** We do not rely on the fetch's winner rule being *good*; we rely on it being *the same rule*, by issuing the identical `.order('created_at', {ascending:false}).order('id', {ascending:true})` and applying the identical `Array.isArray(d.angles)` filter. If their tie-break is backwards, or `created_at` is NULL and the oldest row wins forever, the guard agrees with the fetch about who the winner is and the comparison stays sound. **Unlike option B, this fix does not care what the answer to fact (c) is.** (It still ought to be verified — see §7 — but nothing here is blocked on it.)

**What it does NOT fix, stated plainly:**
- Finding #4, the five-second Undo that exists only in React state after the server row is gone. Out of scope, still true.
- Finding #5, `Cell`'s `useEffect` overwriting keystrokes on a late reload. Out of scope, still true; and the guard's heal path is a *new* trigger for it (a refused save now dispatches `wurx-angles`), though only for a cell the user is typing in at the moment their own save is refused.
- The swallowed boot-fetch error itself (§6).
- **It is not a merge.** Two people on the same brand+month still cannot both win; the second one is told and must redo the one edit. That is deliberate. Auto-rebasing one person's typed ad-spend map onto another's angle list is a silent merge of money, which is the category of thing this codebase's own memory calls out as how money goes quietly wrong.
- **It is not atomic and cannot be made atomic here.** Two saves inside one round trip can both read the same winner and both proceed; the later sweep wins. Closing that needs a unique constraint or an RPC, and constraint 3 says no DDL. The exposure goes from *the whole session* to *one request*. Say that in the docs rather than claiming safety we do not have.
- One-time papercut: a mirror written by the current code has no `rowId`, so on the first visit after deploy a brand+month whose boot fetch *also* failed will refuse once, heal, and succeed on retry. In the normal case the boot fetch rewrites the mirror with ids before the user reaches the tab, so nobody sees it.

**Cost:** one extra single-row `SELECT` per save (filtered `action` + `target`, `limit(5)`). Row count stays at one per key — no growth, no boot-time regression. Code: **two one-line SWAPs and one anchored insertion, all inside `angleStore.js`**, plus one optional cosmetic SWAP in `CreativeAngles.jsx`. Their insert and their sweep are not edited at all.

**If the vendor moves the code:** all four entries are exact-string SWAPs or asserted anchors; the script prints `FAIL` and writes nothing (`:145-146`, `:157-158`). The residual risk is the one shared by every patch here — a refusal leaves *their unpatched file on disk*, which is the dangerous version. §5 adds a build-time assertion so that cannot ship.

**Recommendation: C.** It is the only option that fixes all three findings; it is the only one that does not bet on a schema default we cannot read; it keeps the vendor's own write logic byte-identical, which keeps constraint 2 true by construction rather than by argument; and it subsumes A at no extra cost. Option A remains a reasonable *emergency* patch if the extra round trip ever proves unacceptable — it is a strict subset of C.

---

## 4. THE PATCH SCRIPT MUST BECOME MULTI-FILE FIRST

Minimal, mechanical, preserves every existing semantic (idempotency, ambiguity refusal, marker balance, all-or-nothing).

**4a. Replace lines 20-24 of `scripts/ops/wurxbase/wurxbase-patches.mjs`:**

```js
const FILE = 'src/vendor/wurxbase/WurxUI.jsx';
let src = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

let applied = 0, already = 0;
const fail = (msg) => { console.error('  FAIL  ' + msg); process.exitCode = 1; };
```

with:

```js
const UI      = 'src/vendor/wurxbase/WurxUI.jsx';
const ANGLES  = 'src/vendor/wurxbase/angleStore.js';
const CARDS   = 'src/vendor/wurxbase/CreativeAngles.jsx';

/* MORE THAN ONE FILE NOW, AND STILL ALL OR NOTHING. Each file is read once,
   held as text, and written only if every block in every file applied. A
   half-patched tree is worse than an unpatched one: the angle guard reads a
   rowId that two swaps put into the mirror, so shipping the guard without the
   swaps would treat every save as stale, and shipping the swaps without the
   guard would fix nothing while looking fixed. */
const texts = new Map();
const textOf = (path) => {
  if (!texts.has(path)) texts.set(path, readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
  return texts.get(path);
};

let applied = 0, already = 0;
const fail = (msg) => { console.error('  FAIL  ' + msg); process.exitCode = 1; };
```

**4b. Give every existing entry a file.** Add `file: UI,` to the one entry in `SWAPS` and to all eight entries in `PATCHES`. (Or default it — the loops below fall back to `UI` when `file` is absent, so adding it is documentation rather than necessity. Add it anyway: an entry that does not say which file it patches is the kind of thing the next release breaks quietly.)

**4c. Replace the SWAPS loop (current lines 111-119):**

```js
for (const sw of SWAPS) {
  const path = sw.file || UI;
  const src = textOf(path);
  if (src.includes(sw.to)) { console.log(`  skip  ${sw.name} (already swapped)`); already++; continue; }
  const n = src.split(sw.from).length - 1;
  if (n === 0) { fail(`${sw.name}: nothing to swap in ${path}; their code changed`); continue; }
  if (n > 1) { fail(`${sw.name}: ${n} occurrences in ${path}, refusing to guess`); continue; }
  texts.set(path, src.replace(sw.from, sw.to));
  console.log(`  ok    ${sw.name} (swapped)`);
  applied++;
}
```

**4d. Replace the PATCHES loop (current lines 121-151)** — identical body to today, with `src` fetched per iteration and written back through `texts`:

```js
for (const p of PATCHES) {
  const path = p.file || UI;
  const src = textOf(path);
  const marker = p.body.split('\n')[0].trim();
  if (src.includes(marker)) { console.log(`  skip  ${p.name} (already present)`); already++; continue; }

  if (p.mode === 'prepend') {
    texts.set(path, p.body + src);
    console.log(`  ok    ${p.name} (prepended)`);
    applied++;
    continue;
  }

  if (p.mode === 'afterRegex') {
    const re = new RegExp(p.re);
    const m = re.exec(src);
    if (!m) { fail(`${p.name}: anchor /${p.re}/ not found in ${path}`); continue; }
    const all = src.match(new RegExp(p.re, 'g')) || [];
    if (all.length !== 1) { fail(`${p.name}: anchor matched ${all.length} times in ${path}`); continue; }
    texts.set(path, src.slice(0, m.index + m[0].length) + p.body + src.slice(m.index + m[0].length));
    console.log(`  ok    ${p.name}`);
    applied++;
    continue;
  }

  const n = src.split(p.anchor).length - 1;
  if (n === 0) { fail(`${p.name}: anchor not found in ${path}\n        ${p.anchor.trim().slice(0, 100)}`); continue; }
  if (n > 1) { fail(`${p.name}: anchor appears ${n} times in ${path}, refusing to guess`); continue; }
  const at = src.indexOf(p.anchor) + p.anchor.length;
  texts.set(path, src.slice(0, at) + p.body + src.slice(at));
  console.log(`  ok    ${p.name}`);
  applied++;
}
```

**4e. Replace the tail (current lines 153-162):**

```js
for (const [path, src] of texts) {
  const a = (src.match(/WURX-ADDED/g) || []).length;
  const b = (src.match(/WURX-END/g) || []).length;
  if (a !== b) fail(`${path}: unbalanced markers: ${a} WURX-ADDED, ${b} WURX-END`);
}

if (process.exitCode) {
  console.error('\nNOTHING WRITTEN, IN ANY FILE. Fix the anchors above and run again.');
} else {
  let blocks = 0;
  for (const [path, src] of texts) {
    writeFileSync(path, src);
    blocks += (src.match(/WURX-ADDED/g) || []).length;
  }
  console.log(`\n${applied} applied, ${already} already there. ${blocks} blocks across ${texts.size} files.`);
}
```

Files with no entries are never read and never written, so `.jsx`/`.css` outputs of the vendoring step are untouched.

---

## 5. THE PATCH ENTRIES — VERBATIM

All `from` and `anchor` strings below were dumped from the current working tree with `cat -A` and confirmed to appear **exactly once** in their file (`grep -c`: 1, 1, 1, 1). Both files are LF-only, so the script's CRLF normalisation is a no-op here.

### SWAP 1 — the mirror remembers which row it was built from

```js
  {
    name: 'angle mirror carries the row id (fetch)',
    file: ANGLES,
    /* The guard below compares the row we loaded against the row the server
       holds now. Without an id on the mirror entry there is nothing to
       compare, and every save would look stale. */
    from: "      map[key] = { angles: d.angles, savedBy: row.user_display || '', savedAt: row.created_at };",
    to:   "      map[key] = { angles: d.angles, savedBy: row.user_display || '', savedAt: row.created_at, rowId: row.id };",
  },
```

### SWAP 2 — and remembers it after our own write

```js
  {
    name: 'angle mirror carries the row id (save)',
    file: ANGLES,
    /* Without this, the save that just succeeded leaves a mirror with no id,
       and the very next keystroke is refused as stale. */
    from: "  if (list.length) map[key] = { angles: list, savedBy: (user && user.display) || '', savedAt };",
    to:   "  if (list.length) map[key] = { angles: list, savedBy: (user && user.display) || '', savedAt, rowId: keepId };",
  },
```

### PATCH — the guard, inserted immediately before their write

Anchor is `angleStore.js:70`. Insertion mode `afterLast` places the body directly after it, i.e. after `key` and their brand/month early-return are both settled and before the comment block at `:72-74`. The block is wrapped in braces so its `const map` cannot collide with the `const map = getAllAngles();` at `:94`. The body contains no backticks and no `${`, so a template literal is safe and far more readable than the escaped strings the older entries use.

```js
  {
    name: 'angle save · compare-and-swap guard',
    file: ANGLES,
    mode: 'afterLast',
    re: null,
    anchor: "\n  const list = Array.isArray(angles) ? angles : [];\n",
    body: `
  /* WURX-ADDED · never sweep on top of a row this screen never read ────────
     THE BUG THIS CLOSES. Below, a save inserts the current list and then
     DELETES every other row for this brand+month. The list comes from a
     localStorage mirror filled once at boot by fetchAngles, whose only caller
     swallows the error: App.jsx has fetchAngles().catch(() => {}). On a
     browser where that fetch failed or has not landed, the screen shows
     "Nothing saved yet" and the first click on New angle writes one blank
     angle and deletes the team's whole test for that month. The same thing
     happens, less visibly, from a second tab open since before a colleague's
     save, and from a boot fetch that lands after a save and reverts it.

     THE GUARD. The mirror now carries the id of the row it was built from.
     Before writing, ask the server which row it holds for this key, USING
     fetchAngles' OWN ORDERING so the two of us agree on who wins. If that is
     not the row we loaded, we are about to overwrite something we never saw:
     repair the mirror from the server, tell the screen, and refuse. Nothing
     is inserted and nothing is deleted.

     WHAT IT STILL ALLOWS, DELIBERATELY. Server holds nothing: proceed, the
     sweep can destroy nothing. Ids match: proceed exactly as before, so
     deleting your last angle still leaves you with no test.

     NOT A MERGE, ON PURPOSE. Two people on one brand+month cannot both win.
     Rebasing one person's typed ad spend onto another's angle list is a
     silent merge of money, and a wrong figure somebody acts on is worse than
     a refused click.

     NOT ATOMIC, AND CANNOT BE HERE. Two saves inside one round trip can both
     pass. That needs a unique constraint or an RPC and there is no DDL on
     this project. The window goes from a whole session to one request. */
  {
    const held = await supabase
      .from('activity_logs')
      .select('id,details,user_display,created_at')
      .eq('action', ACTION)
      .eq('target', key)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(5);
    if (held.error) {
      const e = new Error('Could not read the saved angles before writing');
      e.wxAngleGuard = 'read-failed';
      throw e;
    }
    const anglesOf = (row) => {
      let d = row && row.details;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { d = null; } }
      return (d && Array.isArray(d.angles)) ? d.angles : null;
    };
    let winner = null, winnerAngles = null;
    (held.data || []).forEach(row => {
      if (winner) return;
      const a = anglesOf(row);
      if (a) { winner = row; winnerAngles = a; }
    });
    const mine = getAllAngles()[key];
    const baseId = (mine && mine.rowId != null) ? mine.rowId : null;
    if (winner && (baseId == null || String(winner.id) !== String(baseId))) {
      const map = getAllAngles();
      map[key] = {
        angles: winnerAngles,
        savedBy: winner.user_display || '',
        savedAt: winner.created_at,
        rowId: winner.id,
      };
      putMirror(map);
      window.dispatchEvent(new Event('wurx-angles'));
      const e = new Error('This test changed since it was loaded');
      e.wxAngleGuard = 'stale';
      throw e;
    }
  }
  /* WURX-END */
`,
  },
```

Notes on the body, so nobody has to re-derive them:
- `getAllAngles` (exported, `:30`) and `putMirror` (module-scope, `:34`) are both in scope; `ACTION`, `supabase` and `key` likewise.
- `limit(5)` rather than `limit(1)`: today the sweep guarantees at most one row per key, so 1 would do; 5 is headroom for a row whose `details` does not parse — which `fetchAngles` skips at `:57` and so must we, or the two would disagree about the winner.
- `String(a) !== String(b)`: `id` comes back from PostgREST as the same JSON type on both paths, but a false conflict is the safe direction anyway — it refuses, heals with an id from the same source, and the retry matches.
- On `read-failed` we refuse **before** writing anything. Nothing is inserted, nothing deleted, `commit`'s catch reloads from the untouched mirror. A read failure at this moment almost certainly means writes fail too; blocking the save is the honest outcome.

### SWAP 3 (optional but recommended) — say which failure it was

`CreativeAngles.jsx:137`, inside `commit`'s `catch (e)`. Without this the user sees "Could not save", which is true but tells them nothing about why their screen just changed under them.

```js
  {
    name: 'angle save · name the stale-save refusal',
    file: CARDS,
    from: "      setNote('Could not save'); setTimeout(() => setNote(null), 2600);",
    to:   "      setNote(e && e.wxAngleGuard === 'stale' ? 'Someone else changed this test \\u00b7 reloaded' : 'Could not save'); setTimeout(() => setNote(null), 2600);",
  },
```

(Use a literal `·` if you prefer; the escape avoids any doubt about encoding through the script. Like the existing `group count badge ink` swap, this one is unfenced — a one-line SWAP cannot carry a `WURX-ADDED … WURX-END` pair without sitting inside an expression, and the marker-balance check is unaffected either way. The script's header comment is the record of what is ours.)

**Ordering:** SWAPs run before PATCHES in the existing script, which is what we want — but nothing here is order-dependent, and if any one of the four fails the script writes no file at all.

---

## 6. AFTER THE PATCH, `saveAngles` READS AS

```js
export async function saveAngles(brand, month, angles, user) {
  const key = caKey(brand, month);
  if (!String(brand || '').trim() || !String(month || '').trim()) return null;

  const list = Array.isArray(angles) ? angles : [];

  /* WURX-ADDED · never sweep on top of a row this screen never read … */
  { …guard: refuse + heal, or fall through… }
  /* WURX-END */

  /* Write the new row BEFORE clearing the old one. …their comment, unchanged… */
  let keepId = null;
  if (list.length) { …their insert, unchanged… }

  /* one row per brand+month · everything older than the one just written */
  let sweep = supabase.from('activity_logs').delete().eq('action', ACTION).eq('target', key);
  if (keepId != null) sweep = sweep.neq('id', keepId);
  await sweep;
  …
}
```

Their insert and their sweep are untouched. That is the point: constraint 2 holds because the delete path is literally the same code, not because we reasoned about a rewrite of it.

---

## 7. A BUILD-TIME ASSERTION, BECAUSE A REFUSED PATCH LEAVES THE DANGEROUS FILE ON DISK

`pnpm build` runs `check-contrast`, `check-brand-theme` and `check-isolation`, but **not** `wurxbase-patches.mjs` — correctly, since patches belong to the vendoring step. The consequence is that a re-vendor where an anchor moved leaves *their* unguarded `angleStore.js` in the tree and `pnpm build` is perfectly happy with it. Add to `scripts/build/check-isolation.mjs`, before the `if (problems.length > 0)` block:

```js
/* ---- 3. the angle-save guard must still be in their file --------------- */
const GUARDED = 'src/vendor/wurxbase/angleStore.js';
const MARK = 'WURX-ADDED \u00b7 never sweep on top of a row this screen never read';
let angleSrc = null;
try { angleSrc = readFileSync(GUARDED, 'utf8'); } catch { angleSrc = null; }
if (angleSrc === null) {
  problems.push(posix(GUARDED) + ' is missing entirely; the vendored tree is not intact.');
} else {
  if (!angleSrc.includes(MARK)) {
    problems.push(
      posix(GUARDED) + ' has lost the angle-save guard.' +
        '\n        saveAngles deletes every stored row for a brand+month after writing.' +
        '\n        Without the guard, one click on New angle from a browser whose boot' +
        "\n        fetch failed destroys the team's whole test for that month." +
        '\n        Re-run: node scripts/ops/wurxbase/wurxbase-patches.mjs'
    );
  }
  if (!angleSrc.includes('rowId: row.id') || !angleSrc.includes('rowId: keepId')) {
    problems.push(
      posix(GUARDED) + ' has the guard but not both mirror swaps it reads.' +
        '\n        With no rowId on the mirror the guard treats every save as stale.'
    );
  }
}
```

This asserts **presence**, and handles the file being absent as a failure rather than as silence — the "checks that lie" pattern is a check that passes when its subject is gone, and a plain `includes` over a file that no longer exists is exactly that.

---

## 8. THE SWALLOWED FETCH ERROR — SEPARATELY, AND SOON

`App.jsx:13017` is `useEffect(() => { fetchAngles().catch(() => {}); }, []);` — an empty catch on the only network read the feature has.

**Fix it separately.** Three reasons:

1. **The data loss is closed without it.** Under option C, a failed boot fetch produces `baseId == null`; if the server holds a row the save is refused, the mirror is healed from the server, and the retry succeeds. The failure degrades from *silent destruction of a month of typed ad spend* to *one refused click and a visible refresh*. That is a papercut, not a loss, and it is self-limiting: the heal repairs the very thing the failed fetch left broken.
2. **It is a different file, a different anchor and a different blast radius.** `App.jsx` is 900KB and is the file most likely to move between releases; binding the angle fix's survival to an anchor in it makes the fix more fragile for no safety gained. Keeping this change to `angleStore.js` plus one line of `CreativeAngles.jsx` is what makes it cheap to re-apply.
3. **It is not an angle problem, it is a boot problem.** The same swallowed-load pattern is behind three other confirmed findings in the audit — `godSettings`' `settingsLoadedRef` set true after a failed load, `discovery-and-realtime`'s identical bug, and `brandContract`'s stale mirror. Fixing it once, properly, at the boot layer, with a visible state and a retry, is a step of its own and should be scoped as one. Fixing it here as a side effect would fix a quarter of it and make the other three look handled.

**What that separate step should do:** replace the empty catch with something that records the failure in state, shows it (a single line in the Angles header is enough: the screen already renders `'Nothing saved yet'` at `CreativeAngles.jsx:217` and that string is currently a false assertion when the fetch failed), and offers a retry — `CreativeAngles` cannot recover on its own today because it never imports `fetchAngles` (its import list is `:2-4`), so the retry belongs either at the App level or behind a new export from `angleStore.js`. Raise it as the next step after this one lands; it is what turns "refused once, then works" into "told what happened".

---

## 9. HOW TO PROVE IT, CLICK BY CLICK

1. `node scripts/ops/wurxbase/wurxbase-patches.mjs` → expect `ok` on all four new entries plus `skip` on the eight existing ones; `pnpm build` passes including the new isolation assertion.
2. **The reference bug.** Open `/admin/collabs` in a private window (no mirror), Reports → Angles, pick a brand+month that already has a saved test on the server, wait for "Nothing saved yet", click **New angle**. Expected: the note reads "Someone else changed this test · reloaded", the screen fills with the real saved angles, and the server row count for that `target` is unchanged. Click New angle again: it works, and now adds to the real test.
3. **Two tabs.** Tab A and tab B both on the same brand+month. Type an ad-spend figure in A. In B (not refreshed), rename an angle. Expected: B refuses once and snaps to A's state; B's second attempt succeeds and A's figure is still there.
4. **The deliberate delete still deletes.** One angle, delete it, confirm. Expected: gone, "Nothing saved yet", and gone again after a reload. This is the constraint-2 regression test and it must be run every time.
5. **First save ever.** A brand+month with no server row: New angle works first time, no refusal.
6. Zero console errors in both themes; check the note at 375px — `.cx-note` is the only new text and it is one short line.

Per the definition of done, `docs/FEATURE_MAP.md` (the Paid Collabs / Creative Angles entry) and `docs/DECISIONS.md` want the same-commit update, recording specifically: that the guard is compare-and-swap and not a merge, that it is not atomic and why (no DDL), and that option B was rejected because it bets on an `activity_logs.created_at` default nobody here can read.
