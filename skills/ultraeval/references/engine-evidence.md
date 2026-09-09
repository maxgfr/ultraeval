# Engine evidence

Use bundled CodeIndex results to locate evidence. Inspect sources and report coverage limits before concluding that something is absent.

The skill owns its domain decisions and output. Engine results provide evidence: check the cited file or fetched passage before making a claim. Record file caps, skipped paths, unavailable grammars or extractors, and blocked web sources alongside the result. Narrow or retry a partial search when the missing coverage matters.

Separate implemented contracts, approved work still to build, and unrelated
product briefs. An unsupported user claim can be rejected without inventing a
defect in absent code. A missing proposed feature belongs in planned work unless
the shipped product promises it; establish that promise before assigning defect
severity. Do not label every missing feature P0.

For behavior claims, trace injected callbacks and their defaults. Values passed
to a no-op sleeper, mocked writer or disabled logger do not establish elapsed
waits, persisted bytes or emitted logs. Cite the actual effect boundary.
