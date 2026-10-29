# design/

Design source material. Nothing in here is built into the app or shipped by Vite; the running
app reads its colours from `src/styles/tokens.css`, which was derived from this folder.

| Path | What it is |
| --- | --- |
| `prism_brand_kit/` | The PRISM brand kit: guidelines page, logos, Discord and merch art, and the design tokens (`tokens/prism.css`, `prism.tokens.json`, `tailwind.prism.js`). **The palette source** named in `CLAUDE.md`. Its own `README.md` explains the kit. |
| `PRISM_TOKEN_MAP.md` | How the kit's tokens map onto our `--wx-*` names, with the WCAG contrast arithmetic. |
| `IMPLEMENTATION_PLAN.md` | The original PRISM frontend rebuild plan (neomorphic direction). Historical: the material and colour decisions were superseded by `docs/guides/GLASS_PLAN.md`; the symmetry rules (one concept, one component, one token) still stand. |
| `references/all-contest/` | A supplied screen reference for the contests list (`screen.png`, `code.html`, `DESIGN.md`). Used as the starting shape for the contest screens. |
| `references/leaderboard/` | A supplied screen reference for the leaderboard, same three files. |

Rules that still apply when you use anything here: every colour in the app is a `var(--wx-*)`
token, never a hex from a reference; the kit's four spectrum colours are accents only. See the
design rules in `CLAUDE.md`.

The references were moved here from two root folders on 2026-10-30 (`Redesign UI/` and
`MY UI/`, whose subfolders `All Contest` and `LeaderBoard` are now lower-case). Older prose in
`docs/archive/` may still use the old names.
