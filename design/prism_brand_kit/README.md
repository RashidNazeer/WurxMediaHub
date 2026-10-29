# PRISM Brand Kit (v1)

PRISM is a social-commerce creator community by Wurx Media for TikTok Shop affiliates.
Tagline: **See your true TikTok Shop results.**

This kit is the source of truth for anything branded: the platform UI, Discord, merch, social and future surfaces. When building, use the tokens, SVGs and the `PrismLogo` component here instead of re-creating values by eye.

## About these files
- `PRISM Brand Guidelines.dc.html` is a **visual reference** (open it in a browser; it needs `support.js` beside it). Don't ship its HTML. Recreate patterns in the platform's own stack using the tokens below.
- Fidelity: **high**. Colours, type, radii and copy are final.

## Folder
```
logos/      prism-wordmark.svg, prism-wordmark-white.svg, prism-icon.svg, prism-icon-white.svg,
            prism-app-icon-dark.svg, prism-app-icon-light.svg   (512×512 tiles)
discord/    prism-discord-avatar.svg (512×512 circle), prism-discord-banner.svg (960×540)
merch/      prism-tee-print-on-dark.svg (1200×1400, for dark garments)
tokens/     prism.css (CSS variables), prism.tokens.json, tailwind.prism.js
components/ PrismLogo.jsx  (PrismWordmark, PrismIcon, PrismI)
```

## Logo
- **Icon** = the letter i on its own: a vertical pill split into four equal stripes, top→bottom **cyan #17E0D4, blue #2E8BFF, violet #9B5CFF, magenta #FF2E8C**, under a small outlined triangle (the prism).
- **Wordmark** = lowercase `prism` in Caprasimo with the icon replacing the i. Always lowercase.
- Geometry of the i, in em of the surrounding font size: triangle 0.28 × 0.25em, stroke 3.6/24 of triangle width, round joins, no fill; gap 0.05em; stem 0.15em wide × 0.52em tall, fully rounded, bottom on the text baseline; 0.03em side margins.
- Triangle/letters are Ink #14141C on light grounds, White on dark. The stripe colours never change.
- Clear space: 0.25 × font size on all sides. Minimum: wordmark 80px wide (25mm print); icon 16px tall.
- In web UI prefer `<PrismWordmark />` (live font, crisp at any size). Use SVGs for images, emails, Discord, and print.
- All SVGs are pure geometry (Caprasimo letters converted to outlines), so they render identically in browsers, Discord, Figma and print — no font needed.

## Colour
| Token | Hex | Use |
|---|---|---|
| ink | #14141C | Text, dark grounds, primary button |
| ink-raised | #2A2540 | Cards on Ink |
| white | #FFFFFF | Page ground |
| mist | #F7F7FB | Panels, sections |
| line | #ECECF3 | Borders, dividers |
| body | #4A4A5A | Paragraph text |
| muted | #6B6B7B | Captions, labels |
| subtle | #B9B9C8 | Secondary text on Ink |
| magenta | #FF2E8C | Spectrum 1 |
| violet | #9B5CFF | Spectrum 2, primary interactive accent |
| blue | #2E8BFF | Spectrum 3 |
| cyan | #17E0D4 | Spectrum 4, growth / positive |
| link / hover | #6A2FE0 / #4A16B8 | Links, primary button hover |

Tag pairs (fill / text): violet #F3EEFF / #5A1FD0 · cyan #E3FBF9 / #0B6F69 · magenta #FFE6F1 / #B0145C.

Rules: spectrum colours are accents only, used in the order magenta → violet → blue → cyan (or the stripe order inside the i). Max four per view. Never as body text or full-bleed backgrounds. Positive deltas use the cyan pair.

## Type
- Display: **Caprasimo 400**, letter-spacing −0.015em. Wordmark, headlines, big numbers. 24px+.
- Interface: **Figtree 400/500/600**. Body 15px/1.55, lead 18px, captions 13px, buttons 15px/600.
- Scale: display 96 · h1 48 · h2 30 · h3 24 · lead 18 · body 15 · caption 13.
- Google Fonts: `https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;500;600&display=swap`

## Shape, spacing, elevation
- Radius: sm 12 · md 18 · lg 24 (cards) · xl 32 (panels) · icon tile 48/180 of tile size · pill 999 (buttons, tags, chart bars).
- Spacing scale (px): 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Shadows: card `0 1px 3px rgba(20,20,28,.06)` · raised `0 12px 32px rgba(20,20,28,.10)` · float `0 12px 32px rgba(20,20,28,.18)`.

## Components (reference)
- **Primary button**: Ink fill, white Figtree 600 15px, padding 11×20, pill. Hover #6A2FE0.
- **Ghost nav button**: #4A4A5A Figtree 500 15px, padding 10×14, pill. Hover fill #F3EEFF, text Ink.
- **Stat card**: white, radius 24, padding 24, card shadow. Label 13/600 muted; value Caprasimo 44; delta tag in cyan pair.
- **Bar chart**: vertical pill bars 20–22px wide, spectrum order left→right, heights rising.
- **Nav bar**: white, 1px #ECECF3 bottom border, padding 18×28, wordmark at 24px.

## Applications
- **Discord**: avatar = Ink circle + white-triangle icon (`discord/prism-discord-avatar.svg`). Banner 960×540 Ink with white wordmark + tagline. Suggested role colours: magenta, violet, blue, cyan (by tier, low→high).
- **Merch**: dark garments use `merch/prism-tee-print-on-dark.svg`. Light garments: Ink triangle + text, same stripe.
- **Story template (1080×1920)**: white ground, violet-tint circle top-right, wordmark top-left, bottom block: tag, Caprasimo headline, rising bars, tagline. See the guidelines page.

## Using the tokens
```css
@import "./tokens/prism.css";
.button { background: var(--prism-color-ink); border-radius: var(--prism-radius-pill); }
```
```js
// tailwind.config.js
theme: { extend: require('./tokens/tailwind.prism.js') }
```
