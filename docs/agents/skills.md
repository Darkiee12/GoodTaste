# GoodTaste skill routing

This directory explains **when** agents load individual skills. Skills are task-specific operating procedures, not blanket instructions. Every agent reads `AGENTS.md` and the applicable canonical docs first; then it loads only the skills relevant to its assignment. Do not load all frontend skills at once.

## Skill triggers

| Task | Read |
| --- | --- |
| Create a new screen or change a screen's visual direction | `.agents/skills/frontend-design/SKILL.md` |
| Polish an implemented screen or review a screenshot | `.agents/skills/baseline-ui/SKILL.md` |
| Add forms, menus, dialogs, camera upload, maps or bilingual interaction | `.agents/skills/fixing-accessibility/SKILL.md` |
| Add transitions or investigate stutter/scroll jank | `.agents/skills/fixing-motion-performance/SKILL.md` |
| Compare UI approaches or simulate one state/logic question | `.agents/skills/prototype/SKILL.md`, then `UI.md` **or** `LOGIC.md` |
| Design a cross-feature contract, Effect operation, external adapter, or module seam | `.agents/skills/codebase-design/SKILL.md` |

## Suggested order for new frontend work

Read product requirements → review the architecture contract → use `frontend-design` → `prototype` if a material design decision is unsettled → implement → `baseline-ui` → `fixing-accessibility` → `fixing-motion-performance` **only if motion or jank is involved**.

A frontend feature agent owns its assigned page/components, not shared design tokens without coordinator approval. A reviewer should report findings before modifying another agent's owned files.

## Sources and adaptation policy

These six skills are GoodTaste-specific **adaptations** of skills in the private SCUtilities repository; they are not verbatim copies and should not be represented as upstream-maintained versions. Source locations:

- `SCUtilities/SCUtilities/.agents/skills/frontend-design/`
- `SCUtilities/SCUtilities/.agents/skills/baseline-ui/`
- `SCUtilities/SCUtilities/.agents/skills/fixing-accessibility/`
- `SCUtilities/SCUtilities/.agents/skills/fixing-motion-performance/`
- `SCUtilities/SCUtilities/.agents/skills/prototype/`
- `SCUtilities/SCUtilities/.agents/skills/codebase-design/`

Do not blindly merge overlapping community prompt packs or let aesthetic rules override product trust and accessibility requirements. Update skills to match GoodTaste's documented decisions rather than altering architecture to satisfy a skill.

## Phase scope
Phase 1 only introduces frontend/audit/prototype/module-design guidance. It does **not** import SCUtilities' lint plugins, CI pipeline, Better Result conventions, Discord rules, or deployment configuration.
