# Contributing to ultraeval

## Architecture in one minute

A **thin deterministic engine** (`src/*.ts`, bundled to a single zero-dep `scripts/ultraeval.mjs`) plus a **thick markdown playbook** (`skills/ultraeval/SKILL.md` + `references/`). The engine scaffolds runs, generates the workflow, and enforces the grounding gate; the AI (driven by the playbook) does research, judgment, and writing. The engine ships committed so `npx skills add` installs a working skill with no dependencies.

- `src/check.ts` / `src/verify.ts` — the grounding gates (structural + semantic).
- `src/templates.ts` — the generator (emits `eval.workflow.mjs` + `agents/*.md`).
- `src/backlog.ts` — confirmed findings → `BACKLOG.json` + TDD cards.
- `src/init.ts` / `src/plan.ts` / `src/render.ts` / `src/clean.ts` — the rest of the CLI surface.

## Prerequisites

- Dev toolchain: Node ≥ 20.19 (vitest 4 / vite 8 floor), pnpm.
- Shipped bundle: Node ≥ 18 (guaranteed by the `runtime-node-floor` CI job).

## Engine changes — TDD first

1. Write or update a vitest test in `tests/` that fails.
2. Make it pass in `src/`.
3. `pnpm run build` (rebuilds `scripts/ultraeval.mjs` and mirrors it into `skills/ultraeval/scripts/`).
4. `pnpm run check:build` — asserts the committed bundle is reproducible and the install-bundle shape is valid.
5. `pnpm run eval` — the RED/GREEN gate probe must stay green.

Commit `src/`, the rebuilt `scripts/ultraeval.mjs`, and the mirrored `skills/ultraeval/scripts/ultraeval.mjs` together — `check:build` fails if they drift.

## Playbook changes

Editing `SKILL.md` or `references/*.md` needs no rebuild, but keep the description ≤ 1000 chars (`verify:bundle` enforces it) and make sure every reference you link actually ships.

## Commits & releases

Conventional Commits drive [semantic-release](https://github.com/semantic-release/semantic-release): `fix:` → patch, `feat:` → minor, `feat!:`/`BREAKING CHANGE:` → major. A push to `main` runs the gate (typecheck / lint / test / `check:build` / `verify:bundle`) and, if green, cuts a GitHub Release and bumps the version across `package.json`, `src/types.ts`, and `SKILL.md` in lockstep.

MIT © maxgfr
