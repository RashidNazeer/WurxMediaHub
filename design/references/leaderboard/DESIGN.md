---
name: Lumina
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#cbc3d7'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#958ea0'
  outline-variant: '#494454'
  surface-tint: '#d0bcff'
  primary: '#d0bcff'
  on-primary: '#3c0091'
  primary-container: '#a078ff'
  on-primary-container: '#340080'
  inverse-primary: '#6d3bd7'
  secondary: '#adc6ff'
  on-secondary: '#002e6a'
  secondary-container: '#0566d9'
  on-secondary-container: '#e6ecff'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#00a572'
  on-tertiary-container: '#00311f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e9ddff'
  primary-fixed-dim: '#d0bcff'
  on-primary-fixed: '#23005c'
  on-primary-fixed-variant: '#5516be'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display-lg:
    fontFamily: Sora
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Sora
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Sora
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  data-mono:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: -0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-max: 1280px
  gutter: 24px
  margin-page: 40px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style
The design system is engineered for a high-performance creator ecosystem, focusing on professional growth, social proof, and data transparency. The brand personality is ambitious, technical yet approachable, and premium. 

The aesthetic leverages **Glassmorphism** layered over a deep **Dark Mode** foundation. It prioritizes clarity in data visualization while maintaining a sophisticated atmosphere. Key visual characteristics include:
- **Translucency:** UI surfaces utilize varying degrees of background blur to maintain a sense of depth and spatial awareness.
- **Precision:** Clean lines and subtle gradients suggest a high-fidelity, professional-grade tool.
- **Vibrancy:** High-energy accent colors are used sparingly against a dark backdrop to draw attention to success metrics and rankings.

## Colors
The palette is built on a "Midnight" foundation (`#0F172A`) to ensure high contrast for data points. 

- **Primary (Creator Purple):** Used for primary actions, active states, and high-level branding elements.
- **Secondary (Growth Blue):** Applied to growth indicators, links, and secondary data visualizations.
- **Status & Rankings:** 
    - **Success:** A vibrant Emerald for positive trends and achievement unlocked states.
    - **Revenue:** A warm Gold for financial metrics.
    - **Tiers:** Specific tokens for Gold, Silver, and Bronze to distinguish top-three leaderboard positions.

Backgrounds should use a tiered dark scale to create hierarchy without relying on heavy borders.

## Typography
This design system uses **Sora** for headlines to provide a modern, geometric character that feels tech-forward. **Inter** is used for body copy and data-heavy tables to ensure maximum legibility at smaller sizes.

- **Display Styles:** Reserved for hero leaderboard rankings and "Big Number" metrics.
- **Label Styles:** Used for table headers and metadata categories, utilizing slight tracking and uppercase styling for structural clarity.
- **Data Mono:** While Inter is sans-serif, its tabular numeric features should be enabled for leaderboard columns to ensure numbers align perfectly for easy comparison.

## Layout & Spacing
The layout follows a **Fluid Grid** model with a maximum container width for desktop viewing to prevent data fatigue. 

- **Desktop (1200px+):** 12-column grid, 24px gutters, 40px page margins.
- **Tablet (768px - 1199px):** 8-column grid, 20px gutters, 32px page margins.
- **Mobile (Under 768px):** 4-column grid, 16px gutters, 16px page margins.

Spacing logic follows a 8px geometric scale. Use "Generous Whitespace" around high-value creator profiles and leaderboard rows to prevent the "data-cramming" effect common in legacy systems.

## Elevation & Depth
Depth is communicated through **translucent layering** and **tinted shadows** rather than pure black shadows.

1.  **Base Layer:** The darkest neutral surface (`#0F172A`).
2.  **Surface-Low:** Used for cards and leaderboard rows. Background: `rgba(30, 41, 59, 0.5)` with a 12px backdrop blur and a 1px border of `rgba(255, 255, 255, 0.05)`.
3.  **Surface-High:** Used for hovered states or featured creator spotlights. Background: `rgba(30, 41, 59, 0.8)` with a 20px backdrop blur.
4.  **Shadows:** Shadows should be soft and diffused, using a slight tint of the primary color (e.g., `rgba(139, 92, 246, 0.15)`) to create a glowing effect rather than a heavy drop.

## Shapes
The design system employs a **Rounded** shape language to soften the technical nature of the data. 

- **Cards & Rows:** Use `rounded-lg` (1rem) for a modern, containerized feel.
- **Buttons & Chips:** Use `rounded-xl` (1.5rem) or full pills for a friendly, interactive touch.
- **Avatars:** Use 100% circular masks for creator profiles to contrast against the rectangular layout of the leaderboard.

## Components
### Leaderboard Rows
Rows should be treated as individual "Surface-Low" cards. On hover, the row should scale slightly (1.01x) and increase its backdrop blur. Columns must be perfectly aligned with `label-sm` headers.

### Buttons
- **Primary:** Solid `primary_color_hex` with white text. High-glow shadow on hover.
- **Ghost:** 1px border of `primary_color_hex` with a subtle transparent fill on hover.

### Achievement Chips
Small, pill-shaped indicators using `status` colors. For example, a "Top 1%" chip uses a light tint of Growth Blue with high-contrast text.

### Progress Bars
Thin, 4px height bars. The background track should be `rgba(255, 255, 255, 0.1)` while the fill uses a gradient of `primary` to `secondary` colors.

### Input Fields
Darker than the surface layer, with a subtle internal glow when focused. The border should transition to `primary_color_hex` on interaction.