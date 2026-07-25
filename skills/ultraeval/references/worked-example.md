# Worked example — one run, end to end

A complete miniature run against a 14-line target, including **a finding that gets rejected**, because that is the part everything else depends on. Every command and every output below is real and reproducible from a checkout of this repo — the target is `tests/fixtures/target-lib`, which also drives the demo probe.

Read this once before your first run. It takes five minutes and it is the fastest way to see what "grounded" actually means in practice.

## The target

```js
// tests/fixtures/target-lib/src/retry.js
 1  // A tiny target codebase used by the `demo` smoke run (init + plan).
 2  function retry(fn, times) {
 3    let last;
 4    for (let i = 0; i < times; i++) {
 5      try {
 6        return fn();
 7      } catch (e) {
 8        last = e;
 9      }
10    }
11    throw last;
12  }
13
14  module.exports = { retry };
```

## 1. Scaffold

```console
$ node scripts/ultraeval.mjs init --target tests/fixtures/target-lib --out /tmp/demo --kind codebase --category library
ultraeval init: codebase · library · mode audit · 5 dimensions -> /tmp/demo
gitignore: skipped — run dir is not inside a git repo
```

Five dimensions because `library` is not a replacement category, so the codebase base applies (`references/rubric-library.md`). In a real run, `plan --run /tmp/demo` would now generate the workflow and the nine agent contracts; this example jumps straight to the part the gate governs.

## 2. Two findings — one real, one from memory

`retry.js` has a genuine defect: `last` is only ever assigned inside the `catch`, so `retry(fn, 0)` skips the loop entirely and throws `undefined`. That is a silently-wrong failure — the caller's `catch (e)` gets `undefined` and blows up on `e.message` far from the cause.

The second finding is the kind an evaluator produces when it reasons from memory of what a retry helper *usually* looks like, rather than from these 14 lines. It sounds completely plausible.

```jsonc
{
  "findings": [
    {
      "id": "F1",
      "dimension": "correctness",
      "severity": "P1",
      "title": "retry(fn, 0) throws undefined instead of a real error",
      "statement": "`last` is only assigned inside the catch block, so when `times` is 0 the loop body never runs and the function throws the still-undefined `last`.",
      "evidence": [
        { "ref": "src/retry.js:3",  "note": "last declared, never initialised" },
        { "ref": "src/retry.js:4",  "note": "loop body skipped entirely when times === 0" },
        { "ref": "src/retry.js:11", "note": "throws last, which is undefined on that path" }
      ],
      "failureScenario": "retry(() => 1, 0) throws undefined; the caller's `catch (e)` receives undefined and any `e.message` access throws a TypeError far from the real cause.",
      "recommendation": "Reject times < 1 with a TypeError naming the argument, or return before the loop.",
      "status": "confirmed"
    },
    {
      "id": "F2",
      "severity": "P0",
      "title": "retry swallows the abort signal",
      "statement": "The retry loop ignores an AbortSignal and keeps retrying after cancellation.",
      "evidence": [{ "ref": "src/retry.js:42", "note": "signal checked here" }],
      "failureScenario": "A cancelled request keeps retrying.",
      "recommendation": "Check signal.aborted at the top of each iteration.",
      "status": "confirmed"
    }
  ]
}
```

Note what makes F1 defensible and F2 not — the four criteria in `references/finding-quality.md`:

| | F1 | F2 |
|---|---|---|
| falsifiable | `retry(() => 1, 0)` → throws `undefined` | no input named — "a cancelled request" is not one |
| reachable | the `times === 0` path is reachable from any caller | there is no signal parameter to reach |
| grounded | **one ref per hop** — declaration, skipped loop, throw | one ref, for an argument with no hops |
| matters | silently wrong error surfaces far from the cause | describes a feature the code does not have |

## 3. The gate rejects the invented one

```console
$ node scripts/ultraeval.mjs check --run /tmp/demo
FAIL  /tmp/demo
  ✗ F2 cites src/retry.js:42: line 42-42 out of range (1-14) — hallucinated or stale
  ✗ F2 has no resolvable evidence — a finding must point at a real file:line (or run: artifact)
; echo $? -> 1
```

The file is 14 lines long. There is no line 42, and there never was — so this is the *delete* case, not the repair case. The test from `finding-quality.md`: could you point at the code before searching for a line number? No — the claim came first and the citation was manufactured to carry it. **Delete F2.** Do not go looking for a line that could plausibly host the claim; that is how a hallucination gets laundered into evidence.

Equally: do not "fix" it by lowering a threshold. Every flag that could soften this refuses to help — `--coverage-min abc` is a usage error, not a disabled gate.

```console
$ node scripts/ultraeval.mjs check --run /tmp/demo    # after deleting F2
PASS  /tmp/demo
  every finding is grounded in the target.
; echo $? -> 0
```

## 4. The semantic layer

Structural resolution is not support. `verify` builds one claim↔evidence pair per gradeable ref and hands a skeptic the actual source context:

```console
$ node scripts/ultraeval.mjs verify --run /tmp/demo
ultraeval verify: 3 pair(s) -> /tmp/demo/VERIFY.todo.json (fill verdicts, then --apply <file>)
```

Three pairs, one per evidence ref on F1 — this is what pair-level coverage means. Each carries the extracted `digest` so the skeptic grades against the source, not against the claim's own phrasing:

```jsonc
{
  "claimId": "F1",
  "evidenceRef": "src/retry.js:3",
  "claim": "`last` is only assigned inside the catch block, so when `times` is 0 …",
  "digest": "1: // A tiny target codebase used by the `demo` smoke run (init + plan).\n2: function retry(fn, times) {\n3:   let last;\n4:   for (let i = 0; i < times; i++) {\n5:     try {",
  "verdict": null,
  "note": ""
}
```

Fill each `verdict` with `supported | partial | unsupported | refuted`, then reduce and run the exit gate:

```console
$ node scripts/ultraeval.mjs verify --run /tmp/demo --apply /tmp/demo/VERIFY.todo.json
PASS  3 adjudicated · 3 supported · 0 partial · 0 refuted · 0 unsupported

$ node scripts/ultraeval.mjs check --run /tmp/demo --semantic --require-verify
PASS  /tmp/demo
  every finding is grounded in the target.
; echo $? -> 0
```

On a real run, add `--honeypots 3` to the `verify` call: it plants traps that catch a skeptic who rubber-stamps. Never present results before this exit gate is green.

## 5. The deliverable

```console
$ node scripts/ultraeval.mjs backlog --run /tmp/demo --tdd
ultraeval backlog: 1 fix task(s) + TDD cards -> /tmp/demo
```

`BACKLOG.json` — what a downstream agent consumes:

```jsonc
{
  "id": "FIX-001",
  "findingId": "F1",
  "kind": "defect",
  "priority": "P1",
  "title": "retry(fn, 0) throws undefined instead of a real error",
  "targets": ["src/retry.js"],
  "red":   { "testFile": "tests/retry.test.js", "expectedNew": true, "description": "Write a failing test that reproduces: …" },
  "green": { "change": "Reject times < 1 with a TypeError naming the argument, or return before the loop." },
  "verify":{ "command": "run the new test (must pass) + the full suite (nothing regresses)" },
  "dependsOn": []
}
```

`expectedNew: true` records that `tests/retry.test.js` did **not** exist when the card was generated — that is how `verify-fix` later proves the fix was genuinely test-first (`references/tdd-remediation.md`).

And the human-and-agent-readable card, written to `fixes/FIX-001-retry-fn-0-throws-undefined-instead-of-a-real-er.md` (the id plus a slug of the title):

```md
# FIX-001 — retry(fn, 0) throws undefined instead of a real error  (P1 · DEFECT)

**Finding F1:** `last` is only assigned inside the catch block, so when `times` is 0 …
**Evidence:** `src/retry.js:3`, `src/retry.js:4`, `src/retry.js:11`
**Why it matters:** retry(() => 1, 0) throws undefined; the caller's `catch (e)` receives undefined …

## RED — write this test first
Write a failing test that reproduces: …
Suggested test file: `tests/retry.test.js`
Run it and watch it FAIL before you touch the implementation.

## GREEN — make it pass
Reject times < 1 with a TypeError naming the argument, or return before the loop.
Touch only: `src/retry.js`

## VERIFY
`run the new test (must pass) + the full suite (nothing regresses)`
The RED test now passes and no existing test regresses.
```

Notice that the card is a direct function of how F1 was written: `failureScenario` became the RED assertion, `recommendation` became the GREEN change, `evidence[].ref` became `targets`. A vague finding produces a card that says "investigate" — which is why `finding-quality.md` asks you to write the failure scenario first.

## What this example is missing

A real run also does the parts that need judgment rather than the engine: research per dimension (`references/methodology-library.md`), the live scenario for the category (`references/live-scenarios.md`), the independent judge panel with calibration, `score`, and `render`. Those produce the *verdict*. The gate above produces the thing the verdict is allowed to stand on.
