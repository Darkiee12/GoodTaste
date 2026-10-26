---
name: fixing-accessibility
description: Review GoodTaste interactions, forms, image upload, menus, maps, localization, and bilingual order cards for keyboard, screen-reader, contrast, and mobile accessibility. Use on any UI change with interactive controls.
---

# Accessibility audit — GoodTaste

## Baseline
Aim for WCAG 2.2 AA as a product target. Prefer native semantic elements and established accessible primitives; ARIA cannot fix non-semantic controls by itself. Never assume an automated checker proves compliance.

## Required review
- **Names and roles:** every button/link/form input has an understandable accessible name; icon-only buttons need labels; decorative icons are hidden from assistive tech; labels and errors are associated with their fields.
- **Keyboard and focus:** all actions work with Tab/Enter/Space; focus remains visible; dialogs trap and restore focus; Escape closes where appropriate; avoid positive `tabindex` values and hover-only affordances.
- **Navigation:** heading hierarchy, landmarks, meaningful links, consistent reading order, and clear selected-state announcements. A visual card's entire action surface must not create nested interactive elements.
- **Forms:** explain required input, disabled submit states, local validation, and error recovery. Errors should be announced without relying only on a toast.
- **Feedback:** loading, recommendation updates, upload progress, and asynchronous failures have sensible status announcements. Avoid continuous chatty live-region updates.
- **Mobile:** controls are easy to reach and activate; text can scale and wrap; on-screen keyboard and device safe areas do not hide actions.
- **Images and camera:** images that convey dish/menu information have appropriate alternatives. Camera permission denied, unsupported capture, and poor-quality photo flows must offer accessible file selection or manual entry.
- **Maps:** provide a non-map list with place names and addresses. Do not make spatial pins the only way to select a restaurant.
- **Multilingual:** mark passages with appropriate language tags when languages differ. Keep source dish names and translated names available together, preserving pronunciation or script distinctions as needed.
- **Dietary risk:** warnings such as 'ingredients unverified' must appear in readable text and never only as a red/green icon. Bilingual order copy must remain selectable and copyable.
- **Motion and contrast:** respect reduced-motion preferences and ensure text/control states meet contrast targets.

## Verification
Test with keyboard only, a narrow mobile viewport, zoom/large text, and at least one screen-reader workflow when tools permit. Report verified failures separately from suspected issues, with reproduction steps and affected users.

## Provenance
GoodTaste-specific adaptation of SCUtilities `.agents/skills/fixing-accessibility/SKILL.md`.
