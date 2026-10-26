---
name: prototype
description: Create a disposable, decision-focused GoodTaste UI or logic prototype to compare alternatives before implementation. Use when user flows, visual direction, or state behavior are uncertain; do not mistake a prototype for production code.
---

# Prototype — answer one question quickly

## Select one branch
- **UI prototype:** What should dish discovery, restaurant comparison, menu capture, or an order card look like? Read `UI.md`.
- **Logic prototype:** Does a specific state machine, selection policy, or confidence/verification state model behave correctly? Read `LOGIC.md`.

## Scope rules
State the question before generating code. Use non-sensitive, clearly synthetic fixtures. Do not connect to live AI, storage, payments, location services, or the production database unless explicitly approved. Never make up verified restaurant facts in the demo.

Keep prototypes isolated from normal application navigation and production builds. Do not add general architecture, extra dependencies, or infrastructure just to demonstrate a design choice.

## Decision record
Each prototype ends with: question, variants/cases tested, what changed after feedback, winning approach (if decided), the discarded alternatives, and an explicit cleanup task. A selected prototype is a specification input, not an automatically production-ready implementation.

## Provenance
Adapted from SCUtilities `.agents/skills/prototype/` with a GoodTaste-specific UI/logic split.
