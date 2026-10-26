# Agent skill routing

This guide routes GoodTaste work to the appropriate task-specific skill. Read `AGENTS.md`, the relevant product/architecture docs, and **only** the skills needed for the change. Keep an agent's active instructions focused.

| Task | Skill |
| --- | --- |
| Establish or change visual direction for a screen | `.agents/skills/frontend-design/SKILL.md` (existing upstream skill; do not replace) |
| Implement product UI components and screen behavior | `.agents/skills/frontend-ui-engineering/SKILL.md` |
| Polish an existing screen's spacing, hierarchy, mobile fit or loading states | `.agents/skills/baseline-ui/SKILL.md` |
| Forms, dialogs, map alternatives, camera upload, bilingual UI or keyboard interactions | `.agents/skills/fixing-accessibility/SKILL.md` |
| Add animation, investigate jank or review transitions | `.agents/skills/fixing-motion-performance/SKILL.md` |
| Compare alternative screens or test a single state-model question | `.agents/skills/prototype/SKILL.md` (then `UI.md` or `LOGIC.md`) |
| Define or refactor a domain module, Effect operation, provider interface, or adapter seam | `.agents/skills/codebase-design/SKILL.md` |
| Audit web design quality | `.agents/skills/web-design-guidelines/SKILL.md` |
| Choose/design shadcn UI primitives | `.agents/skills/shadcn/SKILL.md` |
| Research UI patterns or validate a design direction | `.agents/skills/ui-ux-pro-max/SKILL.md` |
| Browser evidence and interaction verification | `.agents/skills/playwright-cli/SKILL.md` |

## Recommended UI workflow

1. Read the product brief, `docs/design/` contracts, and the route's existing implementation.
2. Use `frontend-design` for a new design direction; `prototype` when two or more structural solutions are credible.
3. Implement with `frontend-ui-engineering`, the existing component system and ownership boundaries.
4. Review with `baseline-ui` and `fixing-accessibility`. Use `fixing-motion-performance` only when motion is relevant.
5. Verify behavior and responsive screenshots with the browser tools and report concrete results.

## Scope and provenance

The skills `baseline-ui`, `fixing-accessibility`, `fixing-motion-performance`, `prototype`, and `codebase-design` are GoodTaste-specific adaptations of `SCUtilities/SCUtilities/.agents/skills/`, not exact upstream copies. The existing `frontend-design` skill already in this branch is preserved unchanged.

Other installed skills are not replaced. No formatter, linter, application source, dependency, infra, or CI behavior is changed by this skills phase.

## Parallel agents

The coordinator assigns owners of shared design tokens, component primitives, and cross-feature contracts. Feature agents may only change their assigned paths unless ownership is explicitly transferred. A screenshot or prototype is not proof that security, data provenance or backend behavior is correct.
