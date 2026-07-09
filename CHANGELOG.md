# Changelog

All notable changes to this project are documented here, generated automatically from the [Conventional Commits](https://www.conventionalcommits.org/) by [semantic-release](https://github.com/semantic-release/semantic-release).

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
