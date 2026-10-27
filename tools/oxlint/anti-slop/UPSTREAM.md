# UPSTREAM.md — tools/oxlint/anti-slop

## Source identity
- Skill bundle `install-anti-slop` from `dmmulroy/anti-slop` (`skillPath: skills/install-anti-slop/SKILL.md`,
  skills-lock `computedHash: 1b9b5d3c0d9e0ef8dd7631f4d637e66b62a73e34dceaf4ae07c0d3de376fd7d7`).
- Incoming snapshot staged 2026-10-27 via `node .agents/skills/install-anti-slop/scripts/install.mjs <tmp>/incoming`
  (pristine copy of `assets/anti-slop/`). No upstream git commit is recorded in the bundle, so the
  skills-lock hash above is the recoverable source identity; do not treat it as an upstream repo commit.

## Base status: UNKNOWN
No prior provenance record or pristine snapshot exists. The pre-update install (commit `7d794d0f1`,
"chore(quality): configure Oxlint, Oxfmt and strict CI checks") held only `index.ts` plus
`rules/no-chained-type-assertions.ts` and `rules/no-widen-then-assert.ts`; both rule files are
byte-identical to the staged bundle. Update performed as a no-base conservative port (all adopted
files are new paths; no local rule logic was overwritten).

## Adopted 2026-10-27 (user-approved: all new rules, enabled at error, including Effect)
- 16 new generic rules in `rules/`, 7 `shared/` helpers, `vendor/eslint-stylistic/` (LICENSE + provenance kept).
- `effect/` plugin (5 rules) + registration in `.oxlintrc.json` as `anti-slop-effect`.
- Config: 18 `anti-slop/*` + 5 `anti-slop-effect/*` rules at `error`, plus native companion
  `oxc/no-accumulating-spread` paired with `anti-slop/no-reduce-accumulator-copy`.

## Intentional local deviations
- `index.ts` keeps the repo's 2-space/double-quote style and the "adapted from the SCUtilities toolchain"
  attribution; only the rule export map was extended (no longer selective).
- All other adopted files copied verbatim (upstream tab style) to keep future diffs clean.
- Dependencies unchanged: `oxlint 1.85.0` + `@oxlint/plugins 1.79.0` (mismatched pair, verified working
  with the adopted source; pin to matching versions on the next oxlint upgrade).
- Known limitation: `anti-slop-effect` covers relative project imports only, not package-alias imports.

## Verification 2026-10-27
- Probe file with reject/accept cases: new rules fired (`no-array-filter-map`, `no-reflect-apply`,
  `no-unknown-parameters`, `no-unknown-returns`, `require-safety-comment-for-type-assertion`),
  pre-existing `no-chained-type-assertions` still fires, accept case clean. Probe deleted after the run.
- `bun run format` (oxfmt --check): pass. `bun run check-types` (tsc --noEmit): pass.
- `bun run lint`: 1 application finding — `anti-slop(require-readable-spacing)` at `vite.config.ts:8`
  (missing blank line before `export default`). Left unfixed: application cleanup needs authorization
  (`bun run lint:fix` resolves it).
- Pre-update backup (live tree + `.oxlintrc.json`): `/tmp/anti-slop-pre-update-20261027-041543`.
  Restore with `cp -r <backup>/oxlint tools/ && cp <backup>/.oxlintrc.json .` after reviewing current diffs.
