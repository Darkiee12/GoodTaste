---
name: baseline-ui
description: Audit and polish existing GoodTaste UI for spacing, typography, layout hierarchy, mobile usability, loading/empty states, and consistency. Use after feature implementation or when a screenshot looks unfinished.
---

# Baseline UI — GoodTaste review

## Scope
A targeted design-quality pass. Preserve correct behavior and existing design tokens; do not redesign the product without a brief. Read the relevant route, shared components, and `docs/design/` contract if it exists.

## Audit order
1. **Mobile fit:** inspect approximately 320–390px wide, then tablet and desktop. No clipped food names, prices, translations, camera controls, or primary actions; fixed elements respect safe-area insets.
2. **Hierarchy:** identify one dominant task per view. A glance should answer what this dish is, why it is recommended, how certain its details are, and how to proceed.
3. **Typography:** readable body sizes, consistent line-height, short heading wraps, correct multilingual typography; preserve full restrictions and warning copy rather than truncating it.
4. **Spacing/alignment:** use shared design tokens and consistent card padding, grids, gaps, image crops, border treatment and vertical rhythm. Avoid ad hoc pixel fixes when a shared primitive owns the issue.
5. **Images:** meaningful food imagery, appropriate alt text, reserved aspect ratios to prevent jumps, and honest placeholders when no verified photo exists.
6. **Interaction feedback:** visible pressed/focus/disabled states; errors adjacent to the action; retry paths; skeletons mirroring eventual content rather than decorative spinners.
7. **Empty states:** clear explanation and one useful recovery action; e.g. broaden distance, change dish, upload another menu photo, type a dish name.
8. **Consistency:** common `DishCard`, `RestaurantCard`, warning banners and bilingual order cards must present facts in the same order and with the same confidence labels.

## Constraints
Use the existing design system and accessible component primitives. Do not introduce a second primitive library on the same interaction surface. Prefer `dvh` to `vh` for full-height mobile surfaces where relevant. Avoid arbitrary z-index escalation. Never block paste or rely on color alone for meaning.

## Output
Return concise findings with file path or screenshot location, severity, user impact, and smallest meaningful improvement. Apply only changes inside the assigned scope; verify visually before claiming fixed.

## Provenance
GoodTaste-specific adaptation of SCUtilities `.agents/skills/baseline-ui/SKILL.md`.
