---
name: fixing-motion-performance
description: Audit GoodTaste transitions, card interactions, image galleries, scrolling, menu camera states, and loading feedback for jank and motion accessibility. Use when changing animations or diagnosing slow UI.
---

# Motion and rendering performance — GoodTaste

## Core rule
Motion should make state changes and navigation easier to understand. Do not add scroll effects or animation simply because a design skill suggests them. Judge motion on modest mobile hardware and slow network conditions.

## Critical checks
1. Prefer `transform` and `opacity` for lightweight transitions. Avoid continuous layout or paint animation on large surfaces.
2. Do not alternate layout reads and writes inside a frame; collect measurements then animate. Avoid unnecessary `requestAnimationFrame` loops and handlers that recompute layout on every scroll event.
3. Keep image dimensions/aspect ratios reserved, prevent layout shifts as food photos load, and pause loops when outside the viewport.
4. Keep compositor layers limited; `will-change` is temporary, never a blanket performance fix.
5. Respect `prefers-reduced-motion`. All content and state changes must be understandable without animation.
6. Do not make uploading/menu scanning rely on a distracting animated indicator. Show real progress when available, otherwise a clear bounded loading state and cancellation/retry path.
7. Avoid animating large blurred, filtered, masked, or backdrop-filter surfaces; these can be expensive on mobile.
8. Ensure map/list switches, card expansion and route transitions preserve keyboard focus and do not unexpectedly scroll the page.

## Review method
Identify the interaction and user's goal; reproduce at mobile width, record what triggers layout/paint/compositing, measure before rewriting when feasible, then make the smallest change. Describe any browser/device limitations of the test.

## Output
Provide issue, affected interaction, evidence, change, and before/after validation. Performance claims need measurements; otherwise describe an expected improvement as unverified.

## Provenance
GoodTaste-specific adaptation of SCUtilities `.agents/skills/fixing-motion-performance/SKILL.md`.
