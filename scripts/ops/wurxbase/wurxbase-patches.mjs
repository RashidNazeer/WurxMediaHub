#!/usr/bin/env node
/**
 * Re-apply OUR additions to the vendored WurxBase code.
 *
 * Run after `scripts/ops/wurxbase/vendor-wurxbase.mjs` has pulled a new release in. Every
 * block below is fenced `WURX-ADDED ... WURX-END` in the file, and this script
 * is the only thing that puts them there, so the vendored copy is always
 * "theirs, plus exactly these blocks" and never a merge nobody can retrace.
 *
 * IT REFUSES RATHER THAN GUESSES. If an anchor has moved or appears twice, it
 * stops and says which block and why. A patch script that silently no-ops is
 * how you end up shipping a build with half a feature in it — and here the
 * feature is Ad spend and ROI, which somebody reads as money.
 *
 * IDEMPOTENT. A block already present is left alone, so running twice is safe.
 */

import { readFileSync, writeFileSync } from 'node:fs';

/*
 * MORE THAN ONE VENDORED FILE. Each patch (and each swap) names the file it
 * targets with `file`, and leaves it out to mean WurxUI.jsx, which is where
 * every entry started life. Each distinct file is read once, patched in memory
 * and written once, and only if every patch for ALL files succeeded: a refusal
 * anywhere means nothing is written anywhere, so the tree is never left with
 * half of one feature in one file and the other half missing from another.
 */
const DEFAULT_FILE = 'src/vendor/wurxbase/WurxUI.jsx';
const sources = new Map();
const originals = new Map();
const srcOf = (file) => {
  if (!sources.has(file)) {
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    sources.set(file, text);
    originals.set(file, text);
  }
  return sources.get(file);
};
const setSrc = (file, text) => sources.set(file, text);

let applied = 0, already = 0;
const fail = (msg) => { console.error('  FAIL  ' + msg); process.exitCode = 1; };

const PATCHES = [
  {
    "name": "the import",
    "mode": "prepend",
    "re": null,
    "anchor": null,
    "body": "/* WURX-ADDED · Ad Spend and ROI ─────────────────────────────────────────────\n   This file is otherwise a VERBATIM copy of the WurxBase app. Every change of\n   ours sits inside a WURX-ADDED ... WURX-END block, so pulling a newer version\n   from upstream is a find-and-reapply job rather than diff archaeology. Nothing\n   of theirs is edited or removed; these blocks only add.\n\n   The import reads OUR ad figures out of a React context that our own route\n   provides. It is NOT our Supabase client and names no project of ours, so this\n   file still cannot reach our database — which is what pnpm verify:isolation\n   asserts on every build. See src/routes/admin/collab-ad-figures.tsx.\n\n   The join needs no brand matching: their video links carry TikTok's numeric\n   video id, and that is the same id our ad figures are keyed on. */\nimport {\n  useCollabAdFigures as wxAdsHook,\n  videoIdsOf as wxVideoIds,\n  totalsOf as wxTotals,\n  tiktokVideoId as wxVideoId,\n  money as wxMoney,\n  roiText as wxRoi,\n} from '@/routes/admin/collab-ad-figures';\n/* WURX-END */\n"
  },
  {
    "name": "BrandDrilldown month effect",
    "mode": "afterRegex",
    "re": "function BrandDrilldown\\(\\{[^}]*\\}\\) \\{\\n",
    "anchor": null,
    "body": "  /* WURX-ADDED · tell our ad figures which month is on screen.\n\n     THIS IS THE WHOLE REASON THE COLUMNS MATCH THE ROW THEY SIT IN. Everything\n     else on this screen — the budget, the allocation, the GMV — is filtered by\n     the month selector above, so an ad spend summed over all time would be a\n     different period sitting in the same line of numbers, inviting a\n     comparison that is not valid. 'All Time' sends '' and means no bounds.\n\n     ONE COMPONENT OWNS THIS because only one brand drilldown is ever open, so\n     a single period is enough and every row and video panel below inherits it\n     without a prop being threaded through them. */\n  const wxSetMonth = wxAdsHook().setMonth;\n  useEffect(() => {\n    wxSetMonth(allTime ? '' : (month || ''));\n  }, [wxSetMonth, allTime, month]);\n  /* WURX-END */\n"
  },
  {
    "name": "creators list headers",
    "mode": "afterLast",
    "re": null,
    "anchor": "\n            <div className=\"pc-num\">Items sold</div>\n",
    "body": "            {/* WURX-ADDED · from OUR TikTok ads data, summed over this\n                creator's DISTINCT delivered videos. */}\n            <div className=\"pc-num\">Ad spend</div>\n            <div className=\"pc-num\">ROI</div>\n            {/* WURX-END */}\n"
  },
  {
    "name": "creator row figures",
    "mode": "afterLast",
    "re": null,
    "anchor": "\n  const profile = eukaProfileFor(euka, [c.tiktok_account, c.tiktok_account_2]);\n  const tier = creatorTier(c, euka);\n",
    "body": "  /* WURX-ADDED · our ad figures for this creator's videos.\n\n     DEDUPED BY TIKTOK VIDEO ID, which is about money rather than tidiness:\n     the same link can sit in video_codes twice after a bulk paste, and adding\n     its cost twice would inflate a brand's real ad spend.\n\n     ROI is revenue over cost computed from the SUMS, never an average of the\n     per-video ratios. A ratio cannot be summed; only this version agrees with\n     what TikTok itself reports. */\n  const wxAds = wxAdsHook();\n  const wxIds = wxVideoIds(c.video_codes);\n  wxAds.ensure(wxIds);\n  const wxT = wxTotals(wxAds.get, wxIds);\n  const wxNote = wxT.withData && wxT.withData < wxIds.length\n    ? ` · from ${wxT.withData} of ${wxIds.length} videos`\n    : '';\n  /* WURX-END */\n"
  },
  {
    "name": "creator row cells",
    "mode": "afterLast",
    "re": null,
    "anchor": "\n      <div className=\"pc-cell pc-num\" data-label=\"Items sold\">\n        {itemsSold > 0 ? <span className=\"pc-metric\">{kNum(itemsSold)}</span> : <span className=\"pc-handle\">-</span>}\n      </div>\n",
    "body": "      {/* WURX-ADDED · ad spend and ROI for this creator's videos.\n\n          A DASH IS NOT A ZERO. No ad data means we cannot answer, which is a\n          different statement from \"nothing was spent\" — and a wrong zero about\n          money is the kind somebody acts on. */}\n      <div className=\"pc-cell pc-num wx-collab-figure\" data-label=\"Ad spend\"\n        title={wxT.withData\n          ? 'Ad spend across this creator\\'s videos' + wxNote\n          : (wxIds.length ? 'No ad data for these videos' : 'No TikTok video links yet')}>\n        {wxT.withData && !wxT.mixedCurrency\n          ? <span className=\"pc-metric\">{wxMoney(wxT.cost, wxT.currency)}</span>\n          : <span className=\"pc-handle\">-</span>}\n      </div>\n      <div className=\"pc-cell pc-num wx-collab-figure\" data-label=\"ROI\"\n        title={wxT.roi === null\n          ? 'No ad spend, so there is no return to divide by it'\n          : wxMoney(wxT.revenue, wxT.currency) + ' back on ' + wxMoney(wxT.cost, wxT.currency) + wxNote}>\n        {wxT.roi === null\n          ? <span className=\"pc-handle\">-</span>\n          : <span className=\"pc-metric\">{wxRoi(wxT.roi)}</span>}\n      </div>\n      {/* WURX-END */}\n"
  },
  {
    "name": "videos panel hook",
    "mode": "afterLast",
    "re": null,
    "anchor": "\nfunction DrilldownVideosPanel({ c, euka, onUpdateCreator, onManage }) {\n",
    "body": "  /* WURX-ADDED · ad figures for the videos this panel lists. */\n  const wxAdsP = wxAdsHook();\n  wxAdsP.ensure(wxVideoIds(c.video_codes));\n  /* WURX-END */\n"
  },
  {
    "name": "card layout figures",
    "mode": "afterLast",
    "re": null,
    "anchor": "\n                  : <div className=\"pc-vxm-nocode\">No ad code yet</div>}\n",
    "body": "                {/* WURX-ADDED · the same two figures on the CARD layout.\n\n                    THERE ARE TWO LAYOUTS AND BOTH NEED THIS. Brands on EUKA get\n                    the table below; every other brand gets these cards. Adding\n                    the figures only to the table would have shipped a feature\n                    that worked on some brands and silently did nothing on the\n                    rest — and the brand somebody opened first would decide\n                    which impression they formed of it. */}\n                {(() => {\n                  const vid = wxVideoId(r.video);\n                  const f = vid ? wxAdsP.get(vid) : null;\n                  const roi = f && f.cost > 0 ? f.revenue / f.cost : null;\n                  return (\n                    <div className=\"wx-collab-vm-figures\">\n                      <span>\n                        <em>Ad spend</em>\n                        <b>{f && !f.mixedCurrency ? wxMoney(f.cost, f.currency) : '-'}</b>\n                      </span>\n                      <span>\n                        <em>ROI</em>\n                        <b>{roi === null ? '-' : wxRoi(roi)}</b>\n                      </span>\n                    </div>\n                  );\n                })()}\n                {/* WURX-END */}\n"
  },
  {
    "name": "per-video headers",
    "mode": "afterLast",
    "re": null,
    "anchor": "\n              <div className=\"pc-num\">Items sold</div>\n",
    "body": "              {/* WURX-ADDED · the same two figures, per video. */}\n              <div className=\"pc-num\">Ad spend</div>\n              <div className=\"pc-num\">ROI</div>\n              {/* WURX-END */}\n"
  },
  {
    "name": "per-video cells",
    "mode": "afterLast",
    "re": null,
    "anchor": "\n                <div className=\"pc-num\">{Number(r.items) > 0 ? kNum(r.items) : <span className=\"pc-vxp-dash\">-</span>}</div>\n",
    "body": "                {/* WURX-ADDED · what THIS video cost to advertise, and what came\n                    back. Keyed on TikTok's own video id, so it is exact. */}\n                {(() => {\n                  const vid = wxVideoId(r.video);\n                  const f = vid ? wxAdsP.get(vid) : null;\n                  const roi = f && f.cost > 0 ? f.revenue / f.cost : null;\n                  return (\n                    <>\n                      <div className=\"pc-num wx-collab-figure\">\n                        {f && !f.mixedCurrency\n                          ? <span className=\"pc-metric\">{wxMoney(f.cost, f.currency)}</span>\n                          : <span className=\"pc-vxp-dash\">-</span>}\n                      </div>\n                      <div className=\"pc-num wx-collab-figure\">\n                        {roi === null\n                          ? <span className=\"pc-vxp-dash\">-</span>\n                          : <span className=\"pc-metric\">{wxRoi(roi)}</span>}\n                      </div>\n                    </>\n                  );\n                })()}\n                {/* WURX-END */}\n"
  },
  {
    "file": "src/vendor/wurxbase/CreativeAngles.jsx",
    "name": "categorise import",
    "mode": "prepend",
    "re": null,
    "anchor": null,
    "body": "/* WURX-ADDED · Categorise button for Creative angle testing ──────────────────\n   Every change of ours to this file sits inside a WURX-ADDED ... WURX-END block,\n   so pulling a newer version from upstream is a find-and-reapply job. Nothing\n   of theirs is edited or removed; these blocks only add.\n\n   This imports OUR route component, which asks our `collab-angles` function to\n   sort a brand-month's videos into angles. It is NOT a Supabase client and\n   names no project of ours, so this file still cannot reach our database,\n   which is what pnpm verify:isolation asserts on every build. Same arrangement\n   as the ad figures in WurxUI.jsx. See\n   src/routes/admin/collab-angle-categorise.tsx. */\nimport { CollabAngleCategorise } from '@/routes/admin/collab-angle-categorise';\n/* WURX-END */\n"
  },
  {
    "file": "src/vendor/wurxbase/CreativeAngles.jsx",
    "name": "categorise button",
    "mode": "afterLast",
    "re": null,
    "anchor": "\n            New angle\n          </button>\n        )}\n",
    "body": "        {/* WURX-ADDED · the Categorise button, straight after New angle.\n\n            It renders nothing unless there is a brand, a month and edit rights,\n            so it needs no gate here. onFiled re-reads the angle store when the\n            filer has put videos into angles, so the cards update without a\n            reload. fetchAngles() is already imported above and its rejection is\n            swallowed the same way App.jsx does at boot: a failed refresh is not\n            worth an error on a screen that is otherwise working. */}\n        <CollabAngleCategorise\n          brand={brand}\n          month={month}\n          canEdit={canEdit}\n          onFiled={() => { fetchAngles().catch(() => {}); }}\n        />\n        {/* WURX-END */}\n"
  },
  {
    "file": "src/vendor/wurxbase/CreativeAngles.jsx",
    "name": "product bands import",
    "mode": "prepend",
    "re": null,
    "anchor": null,
    "body": "/* WURX-ADDED · ANGLE → PRODUCT → VIDEOS ─────────────────────────────────────\n   Umar asked for the Brands screen's shape inside an angle: the angle is the\n   category, the products sit under it, and the videos sit under those -- with\n   the product's picture on the band, as that screen has it.\n\n   `wxAngleRows` is a pure arrangement of rows already on screen and has no\n   React in it, so Node can test it directly. `useProductPics` reads the SAME\n   `collab-products` catalogue the Brands screen reads, so one product cannot\n   show two different pictures on two screens. Neither names a project, so the\n   isolation check still holds. See src/routes/admin/collab-angle-products.ts,\n   collab-angle-product-band.tsx and collab-angle-product-pics.ts. */\nimport { wxAngleRows } from '@/routes/admin/collab-angle-products';\nimport { WxAngleProductHead } from '@/routes/admin/collab-angle-product-band';\nimport { useProductPics as wxUseProductPics } from '@/routes/admin/collab-angle-product-pics';\n/* WURX-END */\n"
  },
  {
    "file": "src/vendor/wurxbase/CreativeAngles.jsx",
    "name": "product band collapse state",
    "mode": "afterLast",
    "re": null,
    "anchor": "\n  const [needOnly, setNeedOnly] = useState(false);\n",
    "body": "  /* WURX-ADDED · which product bands are folded shut in THIS angle, and the\n     brand's product pictures.\n\n     Per card, not global: two angles sell different products, so one shared\n     set would fold a band in an angle the user never touched. Open by default,\n     because everything in this drawer was visible before and a drawer that\n     opens empty reads as broken rather than tidy.\n\n     The pictures are fetched once per BRAND and shared by every band in every\n     angle, so this hook costs one Edge Function call for the screen rather than\n     one per card. */\n  const [wxShut, wxSetShut] = useState(() => new Set());\n  const wxToggle = (key) => wxSetShut((s) => {\n    const next = new Set(s);\n    if (next.has(key)) next.delete(key); else next.add(key);\n    return next;\n  });\n  const wxPics = wxUseProductPics(wxBrand);\n  /* WURX-END */\n"
  }
];

/*
 * REPLACEMENTS, as opposed to insertions.
 *
 * A colour written inline in their JSX cannot be corrected from a stylesheet:
 * an inline style beats any rule we could write, and the element carries no
 * class to aim at. So the value is swapped here, where it survives the next
 * re-vendor instead of being silently lost.
 */
const SWAPS = [
  {
    name: 'group count badge ink',
    /* A saturated fill with muted ink on it: 1.03:1 on the Performance tab, in
       both themes. The count beside a group title does not need its own hue,
       and a soft accent chip is legible on either ground. */
    from: "background: countBg, color: 'var(--wx-text-muted)',",
    to: "background: 'var(--wx-accent-soft)', color: 'var(--wx-text)',",
  },
  {
    name: 'product off the date line',
    file: 'src/vendor/wurxbase/CreativeAngles.jsx',
    /* The other half of the "product per video" patch below. The product moves
       to its own line, so it has to come OFF this one -- otherwise it shows
       twice, once clipped and once not.

       `to` CARRIES A COMMENT ON PURPOSE. The idempotency check is
       `src.includes(sw.to)`, so a `to` that is a prefix of its own `from`
       matches the UNSWAPPED text and the swap skips itself as "already
       swapped" while changing nothing. The first version of this entry did
       exactly that, and the product rendered twice. */
    from: "String(f.v.date || '').slice(0, 10) + (f.v.product ? ' · ' + f.v.product : '')",
    to: "String(f.v.date || '').slice(0, 10) /* the product names the band above */",
  },
  {
    name: 'keep a product the first row lacked',
    file: 'src/vendor/wurxbase/angleStore.js',
    /* FIRST ROW WINS LOSES THE PRODUCT. The same link sits on two rows of
       `video_codes` whenever a creator has two deals for it -- 32 videos in a
       single brand-month on dev -- and only one of those rows may name the
       product. Skipping the duplicate outright threw that name away whenever
       the row that carried it happened to come second, so the chip would be
       blank on exactly the videos with the most history behind them.

       This is the rule `wxProductTotals` in WurxUI.jsx already applies to the
       Brands screen ("where two rows disagree the richer row wins"), so the two
       screens now name a video's product the same way instead of disagreeing.
       Backfill only: an existing name is never overwritten. */
    from: 'if (seen.has(url)) return;',
    to: 'if (seen.has(url)) { const p0 = out.find(o => o.url === url); if (p0 && !p0.product && v && v.product) p0.product = String(v.product).trim(); return; }',
  },
  {
    name: 'group the drawer by product',
    file: 'src/vendor/wurxbase/CreativeAngles.jsx',
    /* Only the OPENING of their map is replaced. The arrow body -- their whole
       video row -- is untouched and still destructures `url` and `f`, because a
       band row carries `wxHead` and a video row does not. Their closing `))}`
       still closes correctly: the `(` opened by `: (` takes the first bracket
       and the `.map(` takes the second.

       Rewriting the row itself was the alternative and it would have meant
       owning their Cell wiring for ad spend, which is money somebody types. */
    from: '{shown.map(({ url, f }) => (',
    to: "{wxAngleRows(shown, wxShut).map(({ url, f, wxHead }) => wxHead ? (\n                  <WxAngleProductHead key={'wx:' + wxHead.key} head={wxHead}\n                    shut={wxShut.has(wxHead.key)} onToggle={() => wxToggle(wxHead.key)} fmt={fmt}\n                    pic={wxPics ? wxPics.get(wxHead.key) : null} />\n                ) : (",
  },
  {
    name: 'angle card knows its brand',
    file: 'src/vendor/wurxbase/CreativeAngles.jsx',
    /* The card needs the brand for one reason only: the product pictures are
       fetched per brand. It is `wxBrand` rather than `brand` so it cannot be
       mistaken for one of theirs if they ever add a prop of that name. */
    from: 'function AngleCard({ r, n, open, leading, index, fmt, poolLeft, canEdit, canType,',
    to: 'function AngleCard({ r, n, open, leading, index, fmt, poolLeft, canEdit, canType, wxBrand,',
  },
  {
    name: 'pass the brand to the angle card',
    file: 'src/vendor/wurxbase/CreativeAngles.jsx',
    from: '              index={index} fmt={fmt} poolLeft={pool.length} canEdit={canEdit} canType={canType}',
    to: '              index={index} fmt={fmt} poolLeft={pool.length} canEdit={canEdit} canType={canType}\n              wxBrand={brand}',
  },
  {
    name: 'find by product too',
    file: 'src/vendor/wurxbase/CreativeAngles.jsx',
    /* The filter already matched on product (`v.product` is in its predicate);
       only the placeholder failed to say so, so nobody would think to try it. */
    from: 'placeholder="Find a creator in this angle"',
    to: 'placeholder="Find a creator or product"',
  },
];

for (const sw of SWAPS) {
  const file = sw.file || DEFAULT_FILE;
  const src = srcOf(file);
  /* A SWAP WHOSE `to` IS A SUBSTRING OF ITS `from` SILENTLY DOES NOTHING, and
     that is the worst outcome this script has: the idempotency check below
     matches the UNSWAPPED text, so the swap reports "already swapped", exits 0,
     and the tree ships without the change. It happened on 2026-10-07 -- a `to`
     that just dropped a trailing clause -- and the product rendered twice.
     Refuse instead; the fix is to give `to` a trailing comment. */
  if (sw.from.includes(sw.to)) {
    fail(`${sw.name}: 'to' is a substring of 'from', so this swap would skip itself as "already swapped" and change nothing`);
    continue;
  }
  if (src.includes(sw.to)) { console.log(`  skip  ${sw.name} (already swapped)`); already++; continue; }
  const n = src.split(sw.from).length - 1;
  if (n === 0) { fail(`${sw.name}: nothing to swap; their code changed`); continue; }
  if (n > 1) { fail(`${sw.name}: ${n} occurrences, refusing to guess`); continue; }
  setSrc(file, src.replace(sw.from, sw.to));
  console.log(`  ok    ${sw.name} (swapped)`);
  applied++;
}

for (const p of PATCHES) {
  const file = p.file || DEFAULT_FILE;
  const src = srcOf(file);
  const marker = p.body.split('\n')[0].trim();
  if (src.includes(marker)) { console.log(`  skip  ${p.name} (already present)`); already++; continue; }

  if (p.mode === 'prepend') {
    setSrc(file, p.body + src);
    console.log(`  ok    ${p.name} (prepended)`);
    applied++;
    continue;
  }

  if (p.mode === 'afterRegex') {
    const re = new RegExp(p.re);
    const m = re.exec(src);
    if (!m) { fail(`${p.name}: anchor /${p.re}/ not found`); continue; }
    const all = src.match(new RegExp(p.re, 'g')) || [];
    if (all.length !== 1) { fail(`${p.name}: anchor matched ${all.length} times`); continue; }
    setSrc(file, src.slice(0, m.index + m[0].length) + p.body + src.slice(m.index + m[0].length));
    console.log(`  ok    ${p.name}`);
    applied++;
    continue;
  }

  const n = src.split(p.anchor).length - 1;
  if (n === 0) { fail(`${p.name}: anchor not found\n        ${p.anchor.trim().slice(0, 100)}`); continue; }
  if (n > 1) { fail(`${p.name}: anchor appears ${n} times, refusing to guess`); continue; }
  const at = src.indexOf(p.anchor) + p.anchor.length;
  setSrc(file, src.slice(0, at) + p.body + src.slice(at));
  console.log(`  ok    ${p.name}`);
  applied++;
}

/*
 * THE MARKER CHECK GUARDS WHAT THIS RUN JUST WROTE, so it looks only at files
 * this run changed. WurxUI.jsx also carries older hand-added blocks that open
 * with WURX-ADDED and close with a plain `*\/` rather than WURX-END, so its two
 * counts have never matched (80 and 45 at HEAD) and checking it on a run that
 * changed nothing in it only produced a failure about somebody else's comments.
 * A file this run did change is checked, and a fresh one starts balanced.
 */
const counts = new Map();
const changed = [];
for (const [file, text] of sources) {
  if (text === originals.get(file)) continue;
  changed.push(file);
  const a = (text.match(/WURX-ADDED/g) || []).length;
  const b = (text.match(/WURX-END/g) || []).length;
  if (a !== b) fail(`${file}: unbalanced markers: ${a} WURX-ADDED, ${b} WURX-END`);
  counts.set(file, a);
}

if (process.exitCode) {
  console.error('\nNOTHING WRITTEN. Fix the anchors above and run again.');
} else {
  for (const file of changed) writeFileSync(file, sources.get(file));
  const per = changed.length
    ? [...counts].map(([f, n]) => `${n} in ${f.split('/').pop()}`).join(', ')
    : 'no file changed';
  console.log(`\n${applied} applied, ${already} already there. Blocks: ${per}.`);
}
