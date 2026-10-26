---
name: codebase-design
description: Design small, deep GoodTaste modules and stable contracts before agents implement cross-feature work. Use when planning Effect operations, AI/Places/S3 adapters, database boundaries, or deciding where a feature belongs.
---

# Codebase design — deep modules, small interfaces

## Objective
Make module boundaries easy for multiple agents to respect and hard to misuse. A **deep module** hides complexity behind a narrow interface; a **shallow module** forwards calls or leaks implementation detail. Do not confuse many files with good architecture.

## Vocabulary
- **Module:** an implementation plus its public interface.
- **Interface:** all facts callers need (types, behavior, errors, data provenance, security conditions, performance expectations).
- **Seam:** an intentional boundary allowing an implementation to be changed or tested independently.
- **Adapter:** an implementation of an external boundary; e.g. Meta API, Google Places, S3-compatible object storage.

## Steps
1. Read `docs/architecture/overview.md`, `docs/architecture/contracts.md`, `docs/architecture/effect.md`, and any relevant ADR.
2. Name the *user-visible outcome* of this module in one sentence. Do not start by inventing generic classes or interfaces.
3. Identify who owns each fact: Postgres owns relational truth and metadata; the object store owns blobs; external providers own their own observations; AI output is interpretation, not evidence.
4. Map callers, dependencies, invariants, potential failures, and trust boundaries. Mark which values come from untrusted input or inference.
5. Propose the **smallest useful public interface** and typed failure vocabulary. Preserve cancellation/retry/resource lifetime rules when an Effect is involved.
6. Ask whether an interface is justified by a real external boundary, a test replacement, or two independent implementations. Avoid pass-through facades introduced solely for symmetry.
7. Validate the shape with one common call path and one adversarial/partial-data case.
8. For major choices, compare at least two designs before deciding (see `DESIGN-IT-TWICE.md`).
9. Assign one owning feature/agent and document what files consumers may change.

## GoodTaste-specific constraints
A dish recommendation must not mutate into a statement that a restaurant currently serves it unless supported by an owned source. An ingredient inference must carry uncertainty; neither the module nor its UI may silently promote it to confirmed dietary safety. Separate server-only providers and secrets from browser components.

## Done when
The owning module has a documented contract, clear implementation responsibility, caller-relevant errors, a verification approach, and no competing owner for the same rule. Add an ADR only if the decision changes architecture, not for every helper.

## Provenance
Adapted from SCUtilities `.agents/skills/codebase-design/`; consult its source for the broader module-design discussion if needed.
