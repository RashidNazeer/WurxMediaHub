---
name: Obsidian Lumina
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
  on-surface-variant: '#c7c4d7'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#908fa0'
  outline-variant: '#464554'
  surface-tint: '#c0c1ff'
  primary: '#c0c1ff'
  on-primary: '#1000a9'
  primary-container: '#8083ff'
  on-primary-container: '#0d0096'
  inverse-primary: '#494bd6'
  secondary: '#ddb7ff'
  on-secondary: '#490080'
  secondary-container: '#6f00be'
  on-secondary-container: '#d6a9ff'
  tertiary: '#3cddc7'
  on-tertiary: '#003731'
  tertiary-container: '#008678'
  on-tertiary-container: '#000705'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#f0dbff'
  secondary-fixed-dim: '#ddb7ff'
  on-secondary-fixed: '#2c0051'
  on-secondary-fixed-variant: '#6900b3'
  tertiary-fixed: '#62fae3'
  tertiary-fixed-dim: '#3cddc7'
  on-tertiary-fixed: '#00201c'
  on-tertiary-fixed-variant: '#005047'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  headline-xl:
    fontFamily: Sora
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Sora
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Sora
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  container-padding: 32px
  gutter: 24px
  card-gap: 16px
---

## Brand & Style

The design system is centered on a **Premium Creator Platform** aesthetic. It moves away from the flat, utilitarian nature of the reference image toward a high-fidelity, immersive experience. The brand personality is sophisticated, innovative, and high-performance.

**Design Style: Glassmorphic Futurism**
This system utilizes a mix of **Glassmorphism** and **High-Contrast Dark Mode**. 
- **Depth:** Multiple layers of translucency create a sense of physical space.
- **Atmosphere:** Deep obsidian backgrounds provide a canvas for "glowing" interactive elements.
- **Emotion:** It should evoke a feeling of "the future of work"—a place where high-value creators feel their tools are as polished as their content.

## Colors

The palette is anchored in **Deep Obsidian** (#020617) to provide maximum contrast for neon-adjacent accents. 

- **Primary (Electric Indigo):** Used for primary actions and active states.
- **Secondary (Vivid Violet):** Used for highlights and gradients.
- **Accent (Cyan):** Reserved for "success" states and status indicators.
- **Glass surfaces:** Created using semi-transparent Slate (#1E293B) with a high backdrop blur (20px-40px). 
- **Glows:** Primary and secondary colors should be applied as soft, low-opacity radial gradients behind cards to simulate "under-lighting."

## Typography

This design system uses **Sora** for headings to project a bold, geometric, and high-tech personality. **Inter** is used for body text and UI labels to ensure clinical legibility against dark, translucent backgrounds.

- **Headlines:** Use high weight (600+) and tight letter spacing.
- **Text Contrast:** Primary body text should be Off-White (#F8FAFC). Secondary text and metadata should use a muted Slate (#94A3B8).
- **Interactive Labels:** Use uppercase tracking (letter-spacing) for a more professional, "dashboard" feel.

## Layout & Spacing

The layout follows a **Fluid Grid** model with high density in the sidebar and generous, expansive margins in the main content area.

- **Sidebar:** Fixed at 280px. Uses vertical stacks with 8px internal spacing.
- **Main Content:** Centered container with a max-width of 1440px. 
- **Grids:** Use a 12-column grid for dashboard widgets.
- **Rhythm:** Spacing is strictly based on an 8px scale.
- **Mobile:** Transitions to a single-column view; the sidebar becomes a bottom navigation bar or a hidden drawer.

## Elevation & Depth

Hierarchy is achieved through **Backdrop Blurs** and **Rim Lighting** rather than traditional black shadows.

- **Level 1 (Background):** Deep Obsidian (#020617).
- **Level 2 (Cards/Containers):** Glassmorphic surfaces with `backdrop-filter: blur(24px)`.
- **Level 3 (Modals/Popovers):** Higher transparency with a 1px solid white border at 20% opacity to define the edge.
- **Lighting:** Elements on higher planes receive a subtle "inner glow" (top-left white stroke) to simulate a light source from above.
- **Glow Accents:** Use primary-colored shadows with high blur (40px+) and low opacity (15%) for active cards.

## Shapes

The design system employs a "Hyper-Rounded" language.

- **Standard Containers:** Use `rounded-2xl` (1rem).
- **Interactive Buttons/Inputs:** Use `rounded-xl` (0.75rem).
- **Status Pills:** Always fully rounded (pill-shaped).
- **Softness:** The high roundedness offsets the "coldness" of the dark mode, making the platform feel more approachable and creator-friendly.

## Components

### Buttons
- **Primary:** Gradient fill (Indigo to Violet), white text, subtle outer glow on hover.
- **Secondary:** Ghost style with a 1px translucent border and backdrop blur.

### Cards
- Cards must have a 1px border using `rgba(255, 255, 255, 0.1)` to separate them from the dark background.
- Background should be a subtle gradient: `linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 100%)`.

### Input Fields
- Dark, recessed backgrounds (#0F172A).
- Active state: Border changes to Primary Indigo with a 4px soft glow.
- Icons: Use thin-stroke (2pt) icons in Indigo or Slate.

### Navigation Sidebar
- Active items should use a "pill" background with a 10% opacity primary color and a 4px solid "indicator" line on the left or right edge.

### Chips & Badges
- Use high-saturation backgrounds with 20% opacity. For example, a "Live" status chip uses a Cyan background at 20% with 100% opacity Cyan text.