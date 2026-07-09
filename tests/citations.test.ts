import { describe, expect, it } from "vitest";
import { claimWordCount, extractUnits, findingRefs, isCited, tokensIn } from "../src/citations.js";
import { CAPS } from "../src/types.js";

// Characterization tests for the coverage-gate core (citations.ts). These pin
// the CURRENT observable behavior of extractUnits/isCited/claimWordCount/tokensIn
// — the strictness of the RESULTS.md coverage gate — including a known
// mixed-fence edge case, so any future refactor is behavior-preserving.

describe("citations — tokensIn", () => {
  it("matches bracket tokens but not markdown links (negative lookahead on `(`)", () => {
    expect(tokensIn("a [text](http://x) link").length).toBe(0);
    expect(tokensIn("finding [F1] here").map((t) => t.raw)).toEqual(["F1"]);
  });

  it("splits a comma-joined bracket into separate tokens", () => {
    const t = tokensIn("see [F1, F2] there");
    expect(t.map((x) => x.raw)).toEqual(["F1", "F2"]);
    expect(t.every((x) => x.isFinding)).toBe(true);
  });

  it("classifies finding / model-hint / evidence tokens", () => {
    expect(tokensIn("[F12]")[0]?.isFinding).toBe(true);
    expect(tokensIn("[M]")[0]?.isModelHint).toBe(true);
    expect(tokensIn("[model-hint]")[0]?.isModelHint).toBe(true);
    expect(tokensIn("[src/app.ts:10]")[0]?.isEvidence).toBe(true);
    expect(tokensIn("[run:runs/core.md#L4]")[0]?.isEvidence).toBe(true);
    expect(tokensIn("[url:https://x.example]")[0]?.isEvidence).toBe(true);
    // a bare word with no path:line shape is none of the three
    const bare = tokensIn("[something]")[0];
    expect(bare?.isFinding || bare?.isModelHint || bare?.isEvidence).toBe(false);
  });
});

describe("citations — isCited", () => {
  it("treats a finding/evidence/model-hint token as a citation", () => {
    expect(isCited("grounded in [F1]")).toBe(true);
    expect(isCited("grounded in [src/app.ts:10]")).toBe(true);
    expect(isCited("grounded in [run:runs/core.md#L2]")).toBe(true);
    expect(isCited("narrative flagged [M]")).toBe(true);
  });

  it("an uncited claim (or a plain markdown link) is not cited", () => {
    expect(isCited("this line makes a claim with no citation")).toBe(false);
    expect(isCited("a [text](http://x) link with words")).toBe(false);
  });
});

describe("citations — claimWordCount", () => {
  it("counts substantive words and ignores citation tokens, URLs and punctuation", () => {
    expect(claimWordCount("one two three four five six")).toBe(6);
    expect(claimWordCount("one two three")).toBe(3);
    // the [F1] token contributes no words
    expect(claimWordCount("real claim words here now [F1]")).toBe(5);
    // URLs are dropped
    expect(claimWordCount("see https://example.com/foo bar baz")).toBe(3);
  });
});

describe("citations — extractUnits", () => {
  it("skips headings, empty lines, horizontal rules and sub-minClaimWords lines", () => {
    const md = ["# Heading", "", "---", "too short line"].join("\n");
    expect(extractUnits(md)).toEqual([]);
    expect(CAPS.minClaimWords).toBe(6); // guards the threshold this test depends on
  });

  it("keeps a substantive claim line as its own unit with a 1-based line number", () => {
    const md = ["# Title", "This claim has at least six substantive words here"].join("\n");
    const units = extractUnits(md);
    expect(units.length).toBe(1);
    expect(units[0]?.line).toBe(2);
  });

  it("skips a `> [model-hint]` blockquote but keeps an ordinary blockquote as a de-quoted unit", () => {
    const hint = extractUnits("> [model-hint] narrative that is not a gated factual claim here");
    expect(hint).toEqual([]);
    const quoted = extractUnits("> This quoted line is a real claim with many words");
    expect(quoted.length).toBe(1);
    expect(quoted[0]?.text.startsWith(">")).toBe(false); // de-quoted
  });

  it("skips a table separator row but keeps a data row with enough words", () => {
    expect(extractUnits("|---|---|")).toEqual([]);
    const row = extractUnits("| SQL injection reaches the database through this concatenated string |");
    expect(row.length).toBe(1);
  });

  it("de-listifies a list item and gates it on word count", () => {
    const units = extractUnits("- this bullet is a real claim with plenty of words");
    expect(units.length).toBe(1);
    expect(units[0]?.text.startsWith("-")).toBe(false);
  });

  it("excludes claims inside a code fence", () => {
    const md = ["```", "this code line has more than six words in it", "```"].join("\n");
    expect(extractUnits(md)).toEqual([]);
  });

  // KNOWN EDGE (F14): ``` and ~~~ toggle the same inFence flag, so a ``` line
  // literally inside a ~~~ fence flips parsing for the rest of the document.
  it("a ``` line inside a ~~~ fence flips parsing and exempts a later claim (current behavior)", () => {
    const claim = "This is a real claim that has at least six words here";
    const control = ["~~~", "some code", "more code", "~~~", claim].join("\n");
    // Without an inner ```, the trailing claim is a gated unit.
    expect(extractUnits(control).map((u) => u.text)).toContain(claim);
    // With a ``` inside the ~~~ block, the flag desyncs and the trailing claim
    // is silently exempted from the coverage gate.
    const bug = ["~~~", "some code", "```", "more code", "~~~", claim].join("\n");
    expect(extractUnits(bug).map((u) => u.text)).not.toContain(claim);
  });
});

describe("citations — findingRefs", () => {
  it("collects the unique [F#] ids referenced across a document", () => {
    const md = "See [F1] and [F2, F3]. Again [F1].";
    expect(findingRefs(md).sort()).toEqual(["F1", "F2", "F3"]);
  });

  it("ignores evidence and model-hint tokens", () => {
    expect(findingRefs("only [src/a.ts:1] and [M] here")).toEqual([]);
  });
});
