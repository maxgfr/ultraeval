# Changelog

All notable changes to this project are documented here, generated automatically from the [Conventional Commits](https://www.conventionalcommits.org/) by [semantic-release](https://github.com/semantic-release/semantic-release).

# [1.9.0](https://github.com/maxgfr/ultraeval/compare/v1.8.1...v1.9.0) (2026-07-12)


### Bug Fixes

* **verify:** fail fast on a wrong-shaped --apply verdicts file ([d725a2e](https://github.com/maxgfr/ultraeval/commit/d725a2ea2c4107dd2d24cda74c608ec1101f419a))


### Features

* **plan:** cross-run judge calibration anchor in the emitted judge contract ([e8ef5c9](https://github.com/maxgfr/ultraeval/commit/e8ef5c928c3390c4ca0f94899c29720dfacef528))

## [1.8.1](https://github.com/maxgfr/ultraeval/compare/v1.8.0...v1.8.1) (2026-07-10)


### Bug Fixes

* **check:** --semantic warns when the verdict layer was never applied ([aae9faf](https://github.com/maxgfr/ultraeval/commit/aae9fafcb5555b575fd1671cd261f7038e0fce16))
* **check:** enforce pair-level adjudication coverage in the require-verify gate ([62c0118](https://github.com/maxgfr/ultraeval/commit/62c011812f51ae94a04a9c855eba654ca3a6d58f))
* **check:** re-reduce verdicts[] against live findings so the semantic gate fails closed ([99261d4](https://github.com/maxgfr/ultraeval/commit/99261d455622348f42d4e7de6b089f4abaf4de14))

# [1.8.0](https://github.com/maxgfr/ultraeval/compare/v1.7.1...v1.8.0) (2026-07-09)


### Bug Fixes

* **analyze:** credit test coverage via the import graph, not just base name (FIX-007) ([56e93aa](https://github.com/maxgfr/ultraeval/commit/56e93aa4f83364a0a4a2f1d61fd1f0f311e85cba))
* **backlog:** detect runner from resolved targetAbs on moved runs (FIX-003) ([dd9d614](https://github.com/maxgfr/ultraeval/commit/dd9d6144064a70d6b350603c21e021b3cee61a7b))
* **backlog:** guessTestFile follows the target repo's real test layout (FIX-020) ([fb92e0f](https://github.com/maxgfr/ultraeval/commit/fb92e0fb922fcfaee10190ef94e80a96bdf4a187))
* **backlog:** skill verify.command uses the detected runner, not a hardcoded pnpm string (FIX-016) ([e4c265a](https://github.com/maxgfr/ultraeval/commit/e4c265a710a7c5b15484642e00c17e8d86460df6))
* **check:** classify a malformed core artifact as a usage error (exit 2) (FIX-013) ([36ba321](https://github.com/maxgfr/ultraeval/commit/36ba321b3d1c2cf5f00feef0c98e3ed7e3a1a2f6))
* **clean:** preserve remediation deliverables unless --all (FIX-001) ([0f9e52a](https://github.com/maxgfr/ultraeval/commit/0f9e52a036c4fa0ec7dffc788d277adf98f78930))
* **cli:** bare no-command invocation exits 2 with help on stderr (FIX-012) ([112b239](https://github.com/maxgfr/ultraeval/commit/112b239c92f7acd39aa5f172179de1630bef899f))
* **compare:** fail --gate on a P0 severity escalation across a retitle (FIX-011) ([124e9e2](https://github.com/maxgfr/ultraeval/commit/124e9e223dd2d04bc13a91f3ecd246d1bc7e83bd))
* **fix,rejudge:** parse-safe guard on generated workflows (FIX-002) ([6e28ce3](https://github.com/maxgfr/ultraeval/commit/6e28ce3c3021e4e9af653922a3e7c51e07e9ede4))
* **fix:** echo the exact verify command + cwd before verify-fix replays it (FIX-010) ([479ef94](https://github.com/maxgfr/ultraeval/commit/479ef947de5b1679c5d6c50e55054c81e40eaa48))
* **score:** anchor the --history default ledger to the target repo, not the cwd (FIX-015) ([fbc4b01](https://github.com/maxgfr/ultraeval/commit/fbc4b01bb370354898c66e95d2e062431e1efae8))
* **score:** report agreement as NA for a single-judge panel (FIX-005) ([6cd9692](https://github.com/maxgfr/ultraeval/commit/6cd96920384011e8666dfd908f5ec984fff0f177))
* **templates:** generated workflow exits 2 with guidance under plain node (FIX-025) ([1753c05](https://github.com/maxgfr/ultraeval/commit/1753c05848448a3db2aca3deb272f704dd1ab11c))
* **util:** make writeText atomic (temp file + rename) so a crash cannot truncate output ([cd87188](https://github.com/maxgfr/ultraeval/commit/cd87188f199fa00dc7d79e939984cee7d2c74f87))
* **util:** readJson names the offending file on a parse error (FIX-014) ([3f57465](https://github.com/maxgfr/ultraeval/commit/3f5746542dd48b312971c9ed49a99552d2b1ad74))
* **verify,cli:** report the actually-planted honeypot count, not the requested one (FIX-008) ([2500807](https://github.com/maxgfr/ultraeval/commit/25008077eff115f947d3a1465f6d6e9fd7be2292))


### Features

* **check:** --strict-scope hard-fails out-of-scope findings on a diff run (FIX-009) ([d2939f4](https://github.com/maxgfr/ultraeval/commit/d2939f485b99b45d9ed4313e19baeae0978d445b))
* **check:** re-validate provenance dimensionsHash and warn on post-init rubric drift (FIX-009) ([bbdd1e1](https://github.com/maxgfr/ultraeval/commit/bbdd1e116ee269e71b8ba3919737fd6410632328))
* **cli:** check --json emits the machine-readable CheckResult for CI (FIX-017) ([3cb2fe7](https://github.com/maxgfr/ultraeval/commit/3cb2fe75f0c5d10cebaf74e58d0fc209a1f6762e))
* **cli:** read-only `history` subcommand renders the score-trend ledger (FIX-022) ([73f2417](https://github.com/maxgfr/ultraeval/commit/73f24175575062547ea1b4111fb5490f057e406f))


### Performance Improvements

* **backlog:** detect test convention + runner once, not per finding (FIX-004) ([cfa0d32](https://github.com/maxgfr/ultraeval/commit/cfa0d32ecdf0434f9cdccfd4713a204720e31682))
* **sarif:** thread a run-scoped lineCache through buildSarif (FIX-008) ([022eec0](https://github.com/maxgfr/ultraeval/commit/022eec06b89043336773eabae987098bc9be2eeb))
* **util:** memoize per-invocation file reads in resolveEvidence/extractContext (FIX-024) ([1a4a87b](https://github.com/maxgfr/ultraeval/commit/1a4a87b7ec3bccad66e6e4783046992cf6626e42))

## [1.7.1](https://github.com/maxgfr/ultraeval/compare/v1.7.0...v1.7.1) (2026-07-09)


### Bug Fixes

* **plan:** remove the counterpart artifact when switching workflow<->eco + improve-mode runbook test ([#7](https://github.com/maxgfr/ultraeval/issues/7)) ([3704b79](https://github.com/maxgfr/ultraeval/commit/3704b79810ba18beef31789e3949f0a591ee2bda))

# [1.7.0](https://github.com/maxgfr/ultraeval/compare/v1.6.0...v1.7.0) (2026-07-09)


### Features

* **plan:** orchestrate alias + --eco sequential runbook (family alignment) ([#6](https://github.com/maxgfr/ultraeval/issues/6)) ([55780ff](https://github.com/maxgfr/ultraeval/commit/55780ffd3e857d2e539d8db2c8c0c3e5b702e295))

# [1.6.0](https://github.com/maxgfr/ultraeval/compare/v1.5.0...v1.6.0) (2026-07-09)


### Features

* **cli,eval:** status command, unknown-flag rejection, judge independence, diff-scoped runs, SKILL.md v2 procedure ([04107a1](https://github.com/maxgfr/ultraeval/commit/04107a1356dab4ecdcc6e4fadcbfa5921319a531))

# [1.5.0](https://github.com/maxgfr/ultraeval/compare/v1.4.0...v1.5.0) (2026-07-09)


### Bug Fixes

* **gate,backlog,score:** close the RUN-3 P1/P2 findings the self-eval surfaced ([5f251e4](https://github.com/maxgfr/ultraeval/commit/5f251e449938fe05ea121d8670afdf8a3afba6de))
* **polish:** sharded verify message, clean eval.sarif, rank folds as open, actionable backlog error ([57bea3d](https://github.com/maxgfr/ultraeval/commit/57bea3d70624152ac8cf7aeb2224c41644f69e47))


### Features

* **execute:** normed live-scenario library and budget-aware generated workflow ([2a6ce2a](https://github.com/maxgfr/ultraeval/commit/2a6ce2ae6d468cfb8448943135d0c8f6e6e487d0))
* **fix:** close the red-green loop — dispatchable fix-agent contracts and verify-fix ([f4040cd](https://github.com/maxgfr/ultraeval/commit/f4040cdd91755ce6814f2ab55fcec9d944ec0892))
* **gate:** honeypot skeptic-checks and judge calibration (protocol v2) ([5dcd204](https://github.com/maxgfr/ultraeval/commit/5dcd20475cff06b6b9aad2a1503ec2833eb2b7eb))
* **rejudge:** test-retest verdict stability from reused artifacts ([397f7f9](https://github.com/maxgfr/ultraeval/commit/397f7f9aa9312d74852e1af3d3001f9768d68663))
* **score,backlog:** history ledger, weight-sensitivity, derived dependsOn ([d875306](https://github.com/maxgfr/ultraeval/commit/d8753060bd0864955adc2366796430ff276f158c))

# [1.4.0](https://github.com/maxgfr/ultraeval/compare/v1.3.0...v1.4.0) (2026-07-09)


### Bug Fixes

* **contracts:** executor safety notes, verdicts-file shape doc, impact mapping doc, CLI pinning, Node 18 full-surface CI ([6a15e88](https://github.com/maxgfr/ultraeval/commit/6a15e8887d85de49630f9ef04c8b0e5bc5669800))
* **gate:** close the evidence-laundering and partial-adjudication bypasses; guard clean --all ([b7f77a9](https://github.com/maxgfr/ultraeval/commit/b7f77a943adf808ba19875b3e4b5912d3a531d17))


### Features

* **engine:** precise test matching, validated rank, calibrated bar, judge agreement, shared helpers ([bfb460e](https://github.com/maxgfr/ultraeval/commit/bfb460ea8a93bb3c26b7159d429a4ec7761a6c8a))
* **interop:** evidence-fingerprint compare with --gate/--json, real JSON Schema, SARIF export ([a1ca3e1](https://github.com/maxgfr/ultraeval/commit/a1ca3e1d1c0e35d14e126855687378af5c782fa1))
* **protocol:** record run provenance, stamp scorecards, and gate run comparability ([4e05dff](https://github.com/maxgfr/ultraeval/commit/4e05dff8cb24bc28754956994cb82d31fd27cb8b))
* **rubrics:** codify SEVERITY_DEFS and anchor every starter dimension to an external referential ([9d50229](https://github.com/maxgfr/ultraeval/commit/9d502295380d1c36729863209ace14ac2903fb99))

# [1.3.0](https://github.com/maxgfr/ultraeval/compare/v1.2.0...v1.3.0) (2026-07-08)


### Features

* implement the 6 self-found opportunities (analyze --since/--json, compare, exclude generated bundles, --rank --check) ([60e5f35](https://github.com/maxgfr/ultraeval/commit/60e5f35e124adeece42335817c8620a0d16ae50f))

# [1.2.0](https://github.com/maxgfr/ultraeval/compare/v1.1.1...v1.2.0) (2026-07-08)


### Features

* analysis engine (analyze/brainstorm) + grounded opportunities + eval modes ([8ea1e7d](https://github.com/maxgfr/ultraeval/commit/8ea1e7d2050d1156d5e897d7a9aae754de24c281))

## [1.1.1](https://github.com/maxgfr/ultraeval/compare/v1.1.0...v1.1.1) (2026-07-08)


### Bug Fixes

* `--version`/`-v` print the version, not help ([ab15da5](https://github.com/maxgfr/ultraeval/commit/ab15da576925db6811e94b565275d2832ba5f2e3))

# [1.1.0](https://github.com/maxgfr/ultraeval/compare/v1.0.0...v1.1.0) (2026-07-08)


### Features

* scored verdict, category-aware rubrics, findings-schema gate, and check warnings ([abec8b0](https://github.com/maxgfr/ultraeval/commit/abec8b083746a02fa837c1f54ec69d9c719e2f77))

# 1.0.0 (2026-07-07)


### Features

* ultraeval — evaluate a skill or codebase into a grounded TDD fix backlog ([902505a](https://github.com/maxgfr/ultraeval/commit/902505a3b54a5eb750e72376d4be27c40f116d7a))
