# GoodTaste agent instructions

This repository is an agent-first project for a mobile-first AI food discovery companion.

Read [the skill routing guide](docs/agents/skills.md) before editing UI, prototyping user flows, reviewing accessibility or motion, or designing cross-feature contracts. Load only the relevant `.agents/skills/<skill-name>/SKILL.md` instructions and follow any linked supporting files.

## Engineering boundaries

- Preserve GoodTaste's core user journey: discover a dish, find a restaurant with evidence that it serves that dish, understand the menu, and prepare a bilingual order.
- Treat AI output as interpretation, not verified evidence of ingredients, dietary safety, prices, or restaurant menus. Expose missing and conflicting evidence.
- Respect the approved design system and avoid changing shared tokens when working on an independently owned feature.
- Keep sensitive provider credentials and object-storage access server-side.
- When the architecture and product documentation are added, read the relevant canonical docs before making cross-feature changes. Do not assume documents absent from the repository already exist.

## Multi-agent coordination

Define file ownership and expected behavior before parallel work. Agents should not edit another agent's owned files without coordination. Report verified checks, omissions, and any untested assumptions in their handoffs.

## Phase 1

This initial change introduces six frontend and module-design skills, their reference files, and routing guidance. It does not install runtime dependencies, configure lint rules, or implement infrastructure.
