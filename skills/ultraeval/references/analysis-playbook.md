# Analysis playbook — analyze, brainstorm, opportunities

How ultraeval turns a codebase into *grounded improvement leads* (not vague suggestions).

## `analyze` — deterministic signal

`analyze --run <RUN>` (or `--target <dir> --out <dir>`) writes `analysis.json` + `ANALYSIS.md`, offline, zero-dep:

- **Hotspots** — files ranked by size (LOC) + git churn; a big, high-churn file is where risk concentrates.
- **Complexity** — long files, deep nesting.
- **Dependency graph** — local import edges, fan-in/out, and **cycles**.
- **Test gaps** — test-to-source ratio + source files with no obvious test.
- **Churn** — commits touching each file (`git log`, skipped if the target is not a git repo).
- **Docs / TODOs** — README/DOCUMENTATION presence, TODO/FIXME density.

This is objective substrate: every opportunity can cite a metric's subject file via `analysis:<file>` or a plain `file:line`. Generated bundles (a large JS file with zero local imports) are excluded so hotspots surface real source. `--since <ref>` scopes analysis to git-changed files; `--json` prints the raw `analysis.json`.

## `compare` — track trend across runs

`compare --run <new> --base <old>` → `COMPARE.md`: the score delta, which findings/opportunities were **resolved** since the base, and which were **introduced**. Findings are matched by kind+title (ids differ between runs). Use it to prove a fix pass actually moved the needle.

## `brainstorm` — divergent → convergent

1. `brainstorm --run <RUN>` emits `BRAINSTORM.todo.md` — prompts across **lenses**, anchored on the hotspots:
   - *internal health*: simplify, performance, security, testability, DX, architecture.
   - *product / capability*: feature-gaps, new modes/flags, adjacent use-cases.
   Be divergent — generate many candidates.
2. Fill `opportunities.json`: `{ opportunities: [ { dimension?, impact: high|med|low, effort: S|M|L, title, statement, recommendation, evidence: [{ ref }] } ] }`. Every one anchors to a real `file:line` or `analysis:<file>`.
3. `brainstorm --run <RUN> --rank` dedups, ranks by **value = impact / effort**, and folds them into `findings.json` as `kind:"opportunity"` with a backlog priority derived from impact: **high → P1, med/low → P2** (opportunities are never P0). Malformed or duplicate entries are skipped and reported, not silently folded. `check` then gates them; drop any that do not resolve.

## Opportunities vs defects

Both are Findings, both are grounded and gated. Differences:

| | defect | opportunity |
|--|--------|-------------|
| means | something is wrong | a grounded improvement lead |
| rated by | `severity` (P0/P1/P2) | `impact` × `effort` (value) |
| caps meets-expectations? | a live P0 does | no (opportunities inform) |
| backlog card RED | a test that reproduces the bug | a spec/characterization test for the desired behavior |

`render` shows an **impact × effort** table and flags **quick wins** (value ≥ 2 — high impact, low effort). Drive those first.

## Grounding is non-negotiable

An opportunity that cannot point at real code or a real metric is not an opportunity — it is noise. The gate drops it. This is what separates ultraeval from a generic "AI suggests improvements" tool: every lead is traceable and, via a TDD card, executable.
