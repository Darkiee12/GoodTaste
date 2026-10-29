---
name: Creative
colors:
  primary: "#2563EB"
  primaryHover: "#1D4ED8"
  secondary: "#F97316"
  secondaryStrong: "#C2410C"
  accent: "#FBBF24"
  cosmicAccent: "#8B5CF6"

  background: "#FFF8EF"
  surface: "#FFFFFF"
  heroBackground: "#102A52"

  text: "#172033"
  textMuted: "#64748B"

  success: "#15803D"
  warning: "#B45309"
  danger: "#DC2626"

typography:
  h1:
    fontFamily: "Bangers"
    fontSize: 2rem
  body-md:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: 1rem
  label-caps:
    fontFamily: "IBM Plex Mono"
    fontSize: 0.75rem
  sourceScale: "12/14/16/20/24/32"
  weights: "100, 200, 300, 400, 500, 600, 700, 800, 900"
rounded:
  sm: 4px
  md: 8px
spacing:
  sm: 4px
  md: 8px
  sourceScale: "4/8/12/16/24/32"
---

## Overview

Playful, character-driven design with expressive typography and bold graphics for landing pages and creative projects.

## Style Foundations

- **Visual style:** playful
- **Typography scale:** 12/14/16/20/24/32
- **Typography fonts:** primary=Bangers, display=Bangers, mono=IBM Plex Mono
- **Typography weights:** 100, 200, 300, 400, 500, 600, 700, 800, 900
- **Color palette:** primary, secondary, neutral, success, warning, danger
- **Spacing scale:** 4/8/12/16/24/32

## Typography roles

- **Display (Bangers):** headings, legends, and hero numerals only. Never body copy, forms, tables, or buttons.
- **Body (system stack):** all body text, form labels/inputs, tables, checkboxes, and buttons. Loaded via `--font-body`; no webfont needed.
- **Mono (IBM Plex Mono):** small caps labels and code only.
- Vietnamese diacritics plus CJK/Devanagari text always fall back to system fonts; no font binaries are distributed.

## Colors

- **Primary (#3B82F6):** Token from style foundations.
- **Secondary (#8B5CF6):** Token from style foundations.
- **Success (#16A34A):** Token from style foundations.
- **Warning (#D97706):** Token from style foundations.
- **Danger (#DC2626):** Token from style foundations.
- **Surface (#FFFFFF):** Token from style foundations.
- **Text (#111827):** Token from style foundations.
- **Neutral (#FFFFFF):** Derived from the surface token for official format compatibility.
