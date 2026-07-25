# Finding quality — what makes a finding defensible

`references/gate-contract.md` specifies the **form** of a finding: which fields, which evidence grammar, what `check` rejects. This file specifies the **judgment**: how to decide something is genuinely wrong, how to pick its severity, and how to recognise the false positives an AI evaluator produces by default.

The gate cannot do this for you. A hallucinated citation gets caught; a *resolvable* citation attached to a wrong claim does not — that is what `verify` and this file are for.

## The bar

A finding is defensible when all four hold. Missing any one, it is not ready.

1. **It is falsifiable.** You can state the input and the wrong output: "given X, the code produces Y; the docs/behaviour require Z." If you cannot name X, you have a suspicion, not a finding.
2. **It is reachable.** The code path runs on a real invocation. Trace from an entry point — a CLI command, an exported function, an HTTP route — to the line you are citing.
3. **It is grounded.** Every hop of the reasoning cites a real `path:line`, not just the final line. A one-line citation for a five-hop argument is where reviewers stop believing you.
4. **It matters to someone.** Name who is hurt and how. "This is unconventional" names nobody.

Write the `failureScenario` field **first**, before the title. If you cannot write a concrete scenario, the finding does not exist yet. This ordering is the cheapest false-positive filter there is.

## Anatomy

| field | what it must contain | test |
|---|---|---|
| `title` | the defect, not the area | "`--shard` alone overwrites the full worklist", not "issues in verify" |
| `statement` | mechanism: what the code does, in causal terms | a reader who never opens the file understands why it breaks |
| `evidence[]` | one ref **per hop** of the argument, each `path:line` | remove any ref and the argument weakens |
| `failureScenario` | concrete input → concrete wrong outcome | someone could reproduce it from this sentence alone |
| `recommendation` | the change, specific enough to become a TDD card | names the file and the behaviour, not "refactor this" |
| `severity` | per the decision procedure below | you can say which rule fired |

## Severity — a decision procedure, not a feeling

Walk it in order and stop at the first yes. `P0|P1|P2` are defined normatively in `references/protocol.md`; this is how to apply them.

1. Does it **break trust, correctness, safety, or data integrity of the primary deliverable**, or does the documented main path fail? → **P0**.
2. Does it **materially degrade a scored dimension**, with a workaround or a secondary path still available? → **P1**.
3. Otherwise → **P2**.

Three calibration rules that resolve most arguments:

- **P0 caps the verdict at "does not meet expectations."** That is not a rhetorical flourish, it is the gate. So the question "is this P0?" is really "should this alone block the release?" If the honest answer is no, it is P1.
- **A silently wrong result outranks a loud crash.** A crash is discovered; a wrong number is trusted. When choosing between them, the silent one is more severe.
- **A gate that can be disabled without saying so is P0**, whatever its blast radius looks like. The whole value of a gate is the belief that it ran.

Opportunities are **not** severities. An improvement lead is rated `impact × effort` and never caps the verdict — if you find yourself writing "P1: could be faster", it is an opportunity (`kind: "opportunity"`), not a defect.

## The false-positive catalogue

These are the specific ways an AI evaluator invents defects. Each has a cheap check — run it before filing.

| pattern | what it looks like | the check |
|---|---|---|
| **Partial read** | a missing guard, filed from reading one function | read the callers; the guard is usually at the boundary |
| **Dead path** | injection in a build script, fixture, or example | ask who invokes it with untrusted input; if nobody, it is not reachable |
| **Test as production** | citing `foo.test.ts` as proof of runtime behaviour | evidence for production behaviour must come from production code |
| **Wrong version** | code compared against docs from another release | check the version the docs describe against the checkout |
| **Style as defect** | "should use dependency injection / a different pattern" | name the concrete change it makes expensive; if you cannot, it is not a finding |
| **Framework ignorance** | reporting a convention as a bug because you don't know the library | find where the framework handles it before filing |
| **Duplicate under two names** | the same root cause filed per call site | one root cause, one finding, several evidence refs |
| **Memory over source** | "this function usually…" | the gate catches ungrounded refs, not ungrounded *reasoning* — re-read the actual lines |
| **Compiler-caught** | a type error in a typechecked repo | run the typecheck first; if it passes, your reading is wrong |
| **Hypothetical input** | "if someone passed null here" | show the caller that can pass null |

The pattern behind all of them: **an argument that was never traced end-to-end**. Tracing costs a minute and removes most of them.

## When you are not sure

Three exits, all legitimate — inventing certainty is not.

- **Keep it `open`.** Status `open` means "real enough to check, not yet confirmed". `check` warns, it does not fail. This is the right home for a finding whose reachability you could not establish.
- **Downgrade it to an opportunity.** If the code is not *wrong* but is genuinely worse than it could be, `kind: "opportunity"` with an honest `impact`/`effort` is the truthful record.
- **Delete it.** A finding you cannot ground is noise, and noise is expensive: it costs a skeptic's verification pass and it discredits the ones that are real.

Never repair a finding by weakening the claim to fit the evidence you happen to have. That produces a technically-true statement nobody can act on — the worst of both outcomes.

## Deleting versus repairing when `check` fails

`check` rejecting a citation means one of two things, and they have opposite fixes:

- **The claim is right, the citation is stale.** The line moved, or you cited the wrong file. Find the real location, fix the ref. This is a repair.
- **The claim was built from memory.** There is no line that says what you claimed. Delete the finding. Do not go looking for a line that could plausibly host the claim — that is how a hallucination gets laundered into evidence.

Telling them apart is easy: if you can point at the code *before* searching for a line number, it is a repair. If you are searching for a line to justify a sentence you already wrote, delete.

## Writing for the downstream fix agent

Every confirmed finding becomes a TDD card someone implements without your context. Two habits make that work:

- **The recommendation is the GREEN step.** Write it as a change, not a direction: "reject a non-numeric `--coverage-min` with a usage error" beats "improve flag validation".
- **The failure scenario is the RED test.** Write it as an assertion waiting to happen: "`check --coverage-min abc` exits 0 with the coverage gate disabled; it must exit 2."

When both read that way, `backlog --tdd` produces a card a model can execute end-to-end. When they don't, it produces a card that says "investigate."
