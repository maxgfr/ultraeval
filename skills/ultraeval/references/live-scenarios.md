# Live scenarios — normed Execute-phase library

The live half of the Execute phase runs ONE normed scenario set per category instead of improvising. The executor contract embeds the matching block (same category matching as the starter dimensions); `TEST-PLAN.md` maps its live rows to these scenarios. Every scenario is exercised on a **small, local, offline** input and every step is timeboxed.

Each block defines: **golden path** (the documented main journey), **error path** (a documented failure handled gracefully), **help contract** (docs ↔ behavior agreement), **expected artifact** (what the run must leave behind under `runs/`), **pass criteria**.

## Agent skill

- **Golden path**: follow SKILL.md's quickstart end-to-end on a small local fixture and produce the skill's primary deliverable.
- **Error path**: invoke a documented command with a missing/invalid required flag — expect an actionable message (which flag, what to do), no raw stack trace, non-zero exit.
- **Help contract**: every command SKILL.md documents exists; `--help` (or the equivalent) lists them and matches the docs.
- **Expected artifact**: the deliverable under `runs/live-*` plus a narrative `runs/live.md` (commands, exit codes, grounding quality).
- **Pass criteria**: deliverable complete and usable; the skill's own gates pass on it; no hallucinated paths/claims in the deliverable.

## CLI

- **Golden path**: run the README's first documented command sequence against a tmp fixture.
- **Error path**: an unknown subcommand AND a missing required argument — both exit non-zero with an actionable message on stderr.
- **Help contract**: `--help` exits 0 and lists every documented command; exit codes match the documented contract.
- **Expected artifact**: verbatim command lines + exit codes + trimmed outputs in `runs/live.md`.
- **Pass criteria**: outputs and exit codes match the docs; errors name the fix, not just the failure.

## Library

- **Golden path**: import the package and run the README quickstart snippet as-is.
- **Error path**: call a public API with invalid input — expect the documented (typed) error, not a crash deep in internals.
- **Help contract**: the exported API surface matches the docs/types; the quickstart compiles/runs unmodified.
- **Expected artifact**: the runnable snippet + its output log under `runs/live-*`.
- **Pass criteria**: snippet runs as documented; the error path fails the documented way.

## Web app

- **Golden path**: boot the app locally and drive the primary user journey (create + read the core entity) end-to-end.
- **Error path**: submit an invalid form and hit a non-existent route — expect validation feedback and a proper 404, never a 5xx.
- **Help contract**: the README's run instructions work verbatim (install → start → URL).
- **Expected artifact**: HTTP transcripts or screenshots + `runs/live.md` narrative.
- **Pass criteria**: journey completes; no 5xx; basic a11y smoke (landmarks, labels) on the main page.

## Security / SAST

- **Golden path**: scan a small labelled vulnerable fixture — the known true positives are reported.
- **Error path**: scan the sanitized/safe variant of the same fixture — NO findings (false-positive check), and an invalid target errors actionably.
- **Help contract**: `--help` documents the scan modes used; exit codes distinguish "clean", "findings", "error".
- **Expected artifact**: both scan reports (vulnerable + safe) under `runs/live-*`.
- **Pass criteria**: labelled TPs found, safe variant clean, exit codes per contract.

## Requirements / spec

- **Golden path**: render/validate the spec suite; the traceability check passes on the genuine document.
- **Error path**: remove a required section from a COPY — the validator fails naming the missing section.
- **Help contract**: documented validate/render commands exist and match the docs.
- **Expected artifact**: the validation report for both directions under `runs/live-*`.
- **Pass criteria**: gate proven in both directions (genuine passes, doctored fails).

## Research / RAG

- **Golden path**: ask a question answerable from a small local corpus — the answer cites the fetched sources.
- **Error path**: ask a question the corpus cannot answer — expect an explicit "not found"/abstention, zero fabricated citations.
- **Help contract**: the documented modes/flags exist; citation format matches the docs.
- **Expected artifact**: the cited report under `runs/live-*`.
- **Pass criteria**: every claim attributable to a fetched source; the unanswerable question is refused, not hallucinated.

## Business / métier

- **Golden path**: drive the core business rules end-to-end on realistic domain inputs — the documented outcomes come out.
- **Error path**: feed a boundary/rule-violating input — the business rule rejects it and state stays consistent.
- **Help contract**: the documented domain behavior (rules, invariants, edge cases) matches what the code actually does.
- **Expected artifact**: the exercised rule inputs/outputs transcript under `runs/live-*` plus the `runs/live.md` narrative.
- **Pass criteria**: rules behave per the documented domain semantics; invariants hold on every exercised path.
