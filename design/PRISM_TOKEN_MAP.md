# PRISM token map — ready to apply in Phase 1

Every ratio below was computed with the exact WCAG formula against the proposed values, and
against the pairs `scripts/build/check-contrast.mjs` actually asserts. Three real failures were
found and corrected before any code was written.

---

## The rule that keeps the build green

> **Keep every `--wx-*` token NAME. Change only its VALUE.**

`check-contrast.mjs` hardcodes token names in ~40 assertions and fails with "token not found"
if one is missing. Renaming to `--prism-*` would break every one of them. The PRISM kit lives
in `design/prism_brand_kit/tokens/prism.css` as the source of truth; our `--wx-*` names
are the *interface* to it.

## The decision that makes neomorphism possible at all

**`--wx-bg` becomes PRISM `line` `#ECECF3`, not white or mist.**

Neomorphism needs a mid-light ground so a white highlight can be seen. White on mist is
**1.18:1** — invisible. So the ground steps down and mist/white become the *raised, lit*
surfaces. This single choice is what makes the whole language work.

---

## Colour map

| Token | Light (primary) | Dark (derived) |
|---|---|---|
| `bg` | `#ECECF3` | `#1B1B26` |
| `surface-1` | `#F1F1F7` | `#212130` |
| `surface-2` | `#F7F7FB` (mist) | `#282838` |
| `surface-3` | `#E2E2EB` | `#15151E` |
| `field` | `#E2E2EB` | `#15151E` |
| `text` | `#14141C` (ink) | `#F5F5FA` |
| `text-muted` | `#4A4A5A` (body) | `#B9B9C8` (subtle) |
| `text-faint` | `#62627A` | `#A2A2B6` |
| `text-inverse` | `#F7F7FB` | `#1B1B26` |
| `border` | `#DCDCE6` | `#2E2E40` |
| `border-strong` | `#C9C9D6` | `#3E3E54` |
| `border-interactive` | `#80809A` | `#7C7C96` |
| `accent` | `#6A2FE0` (kit link) | `#A878FF` |
| `accent-hover` | `#4A16B8` | `#BC97FF` |
| `accent-active` | `#3A0F96` | `#CBB0FF` |
| `accent-soft` | `rgba(106,47,224,.10)` | `rgba(168,120,255,.16)` |
| `accent-ring` | `rgba(106,47,224,.4)` | `rgba(168,120,255,.5)` |
| `on-accent` | `#FFFFFF` | `#14141C` |
| `success` | `#0B6F69` | `#17E0D4` (cyan) |
| `danger` | `#B42318` | `#FF7A94` |
| `warning` | `#8A5A00` | `#F0B429` |
| `info` | `#0B5CC4` | `#5CA8FF` |
| `stage-live` | `#4E56D3` | `#8EA0FF` |
| `stage-due` | **`#965500`** | `#F5AE4B` |
| `stage-paid` | `#007C3A` | `#5BCC80` |
| `tier-0` | `#62627A` | **`#A2A2B6`** |
| `tier-1..7` | unchanged | unchanged |
| `scrim` | `rgba(20,20,28,.42)` | `rgba(20,20,28,.62)` |

**Retired:** `glass-fill`, `glass-panel`, `glass-line`, `glass-rim`, `glass-glow`,
`accent-gradient(-hover)`, `glow`, `grid-line`. Glass is replaced by the neo shadow layer.
Keep the names as aliases during migration only — parity applies to colour tokens.

**Logo filters** (`logo-blend`, `logo-filter`, `mark-filter`) are no longer needed: the cream
Wurx mascot is replaced by the PRISM wordmark, which is ink on light and white on dark.

---

## Three failures caught before writing code

| | Value | Ratio | Fix |
|---|---|---|---|
| Light `stage-due` | `#9F5B00` on new bg | **4.4978 — FAIL** | `#965500` → 4.97 |
| Dark `tier-0` | `#9d9387` on new chip | **4.37 — FAIL** | `#A2A2B6` → 5.16 |
| Dark `accent` | raw violet `#9B5CFF` | **4.36 / 4.05 / 3.70 — FAIL** | `#A878FF` → 5.52 / 5.13 / 4.68 |

All three are caused by the darker, bluer PRISM ground. They would have failed the build on
the first commit.

**Thin margins to watch** (pass, but fragile): light `faint`/surface-3 **4.60** · light
`stage-paid`/bg **4.53** · dark `accent`/surface-2 **4.68** · tier L5 chip **4.50** · light
success on a hovered row **4.60**.

---

## The spectrum is a fill, never an ink

| Colour | on white | on mist | 4.5:1? |
|---|---|---|---|
| magenta `#FF2E8C` | 3.49 | 3.26 | **FAIL** |
| violet `#9B5CFF` | 3.91 | 3.66 | **FAIL** |
| blue `#2E8BFF` | 3.36 | 3.14 | **FAIL** |
| cyan `#17E0D4` | 1.66 | 1.55 | **FAIL (worst)** |

All four fail as text — which matches the kit's own rule. The inks to use instead:

| Ink | on white | on mist | on its own tint |
|---|---|---|---|
| violet `#5A1FD0` | 8.26 | 7.73 | 7.27 on `#F3EEFF` |
| cyan `#0B6F69` | 6.01 | 5.63 | 5.57 on `#E3FBF9` |
| magenta `#B0145C` | 6.77 | 6.34 | 5.75 on `#FFE6F1` |
| **blue `#0B5CC4`** (new) | 6.28 | 5.88 | 5.50 on `#E6F1FF` (new tint) |

The kit has no blue tint or blue ink; both are proposed here.

---

## Neomorphic tokens (new)

Light source **top-left**: highlight offsets `(-x,-y)`, shadow `(+x,+y)`. This is the one rule
that must never vary, in any component, in either theme.

| Token | Light | Dark |
|---|---|---|
| `--wx-neo-light` | `rgba(255,255,255,0.90)` | `rgba(255,255,255,0.045)` |
| `--wx-neo-dark` | `rgba(130,130,160,0.32)` | `rgba(0,0,0,0.55)` |
| `--wx-shadow-raised` | `-6px -6px 14px light, 6px 6px 14px dark` | same recipe, 5px |
| `--wx-shadow-raised-sm` | `-3px -3px 7px light, 3px 3px 7px dark` | same recipe |
| `--wx-shadow-inset` | `inset 4px 4px 9px dark, inset -4px -4px 9px light` | same recipe |
| `--wx-shadow-pressed` | `inset 3px 3px 6px dark, inset -2px -2px 5px light` | same recipe |
| `--wx-hairline` | `1px solid rgba(255,255,255,0.7)` | `1px solid rgba(255,255,255,0.06)` |
| `--wx-pressed-surface` | `#E7E7EF` | `#181822` |

**Dark is redrawn, not inverted.** A pale highlight on black reads as glow, so dark keeps the
highlight at 4–5% white, uses true black for the shadow, and makes the page the darkest
surface in the stack.

---

## Stage colours and tiers: KEEP

**Stage live / due / paid stay.** They encode three money states that must be distinguishable
at a glance, and the spectrum cannot replace them — it is accents-only, capped at four per
view, and none of the four reads as amber. Only light `due` changes.

Consider moving `stage-live` to the blue ink `#0B5CC4` (5.34 / 5.58 — passes), because
`#4E56D3` sits close to the violet interactive accent and risks a clash with the "violet means
interactive" rule.

**Tiers 0–7 stay.** They are Euka's own hues and the team reads them there daily; four
spectrum colours cannot cover eight levels. Only tier-0 changes, to a neutral grey.

---

## What `check-contrast.mjs` must change

| Issue | Fix |
|---|---|
| Line ~162 silently skips any non-`#` value | Composite `rgba()` over its backdrop instead of `continue` — otherwise translucent tokens pass unchecked |
| `isColour` skips shadows and gradients | Add a second parity pass over **all** `--wx-*` keys regardless of type |
| `hex()` handles only `#rgb`/`#rrggbb` | Add `rgba()` and 8-digit hex parsing |
| Block regex uses `[^}]*` | Never put `}` or `;` inside a token value |
| No coverage of the neo layer | Add: text and faint on `--wx-pressed-surface`; `on-accent` on `accent-active`; the four tag pairs; blue ink on its tint; a minimum highlight-to-ground luminance ratio so the extrusion is guaranteed visible |

**Smallest viable change:** keep every name, apply the values above exactly, and the script
runs as-is apart from the new assertions.
