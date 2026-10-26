---
name: frontend-design
description: Define and implement a distinctive, trustworthy GoodTaste visual direction when creating a new page, user journey, or reusable product UI. Use before designing dish discovery, restaurant results, or menu scanning.
---

# Frontend design — GoodTaste

## Objective
Design a mobile-first food discovery companion, not an admin dashboard or generic AI chat. Make cuisine, ingredients, locality, and confidence understandable through hierarchy and interaction. Style serves the traveller's task.

## Before implementation
1. Read `AGENTS.md`, `docs/product/vision.md`, `docs/product/mvp.md`, and any approved design specification in `docs/design/` if present.
2. Identify the persona, real-world setting, primary action, decision, and available evidence. For each screen ask what the traveller must decide **next**.
3. Produce a short design read: audience, screen purpose, visual tone, layout rationale, and three non-negotiable interaction requirements.
4. If direction is unsettled, use the `prototype` skill to compare genuinely different layouts **before** committing shared components.

## Design priorities
- Let dishes and reliable menu photographs carry the visual weight. Never imply a stock image is a verified photo of the food sold at a specific restaurant.
- Use a consistent typography, spacing, radius, color, and image-ratio vocabulary from the GoodTaste design contract. Do not invent new tokens per page.
- Build recognizable hierarchy: dish name; approachable description; price/price confidence; ingredient facts; suitability uncertainty; next action.
- Introduce culturally unfamiliar terms with original name, translation/transliteration if appropriate, and a clear explanation; do not bury the actual food in decorative copy.
- Design for one-handed use: reachable navigation, comfortably sized targets, non-overlapping sticky actions, safe-area padding, and long translated labels.
- Give discovery and decision-making screens appropriate density. Avoid repeating the same marketing-card composition everywhere.
- Food recommendations and place matching must distinguish known facts from model suggestions. Mark missing information explicitly.

## Screen states to design
Every interactive experience needs a defined loading, empty, error, partial-data, permission-denied, and success state. Include at least: unavailable restaurant/menu details, AI interpretation uncertainty, location denial, photo upload failure, and a manual-text alternative to camera capture.

## Anti-patterns
- Purple-gradient AI dashboard, glassmorphism without purpose, arbitrary glowing borders, filler metrics, endless chat bubbles.
- Decorative flags or cultural stereotypes standing in for real context.
- Fake ratings, prices, restaurant menus, or ingredient guarantees.
- UI that depends on hover, uses the camera as the only input, or truncates allergy/suitability qualifications.

## Handoff
Provide screenshot evidence at narrow mobile and desktop widths, notes on the design choices, state coverage, and a list of unresolved content or source assumptions. Invite a `baseline-ui` and `fixing-accessibility` review before merging.

## Provenance
Adapted for GoodTaste from SCUtilities' `.agents/skills/frontend-design/` guidance. Treat GoodTaste's approved design contract as authoritative over aesthetic suggestions in this skill.
