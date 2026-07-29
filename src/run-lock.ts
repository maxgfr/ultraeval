// Serialize work that touches one evaluation run.
//
// The run directory is read-merge-write throughout: `verify --apply` folds
// skeptic verdicts into findings.json, `backlog` reads those findings to emit
// fix cards, `score` reduces the judge lines, and `verify-fix` stamps a task
// done. Two of those interleaved lose one side's work — silently, because the
// surviving file is still valid JSON.
//
// The CLI never hit this because one process runs one command to completion.
// The MCP server can have several tool calls in flight at once, and the natural
// client pattern here is exactly the parallel one: shard the verify worklist
// across skeptics and fold each shard as it lands.
//
// The fix is a promise chain per run directory — the smallest thing that is
// actually correct. Different runs stay fully parallel.
const chains = new Map<string, Promise<unknown>>();

export function withRunLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(dir) ?? Promise.resolve();
  // Chain off `prev` however it settled: a failed predecessor must not poison
  // every later call for the same repo.
  const next = prev.then(fn, fn);
  // The tail the NEXT caller waits on never rejects, so one thrown tool call
  // can't reject the whole queue behind it.
  const tail = next.then(noop, noop);
  chains.set(dir, tail);
  // Drop the entry once the tail is still us, so a long-lived server doesn't
  // accumulate a settled promise per repo it ever touched.
  tail.then(() => {
    if (chains.get(dir) === tail) chains.delete(dir);
  }, noop);
  return next;
}

function noop(): void {}

// Test seam: drop every pending chain. Never call this from product code — an
// in-flight lock holder would stop serializing against later arrivals.
export function resetRunLocks(): void {
  chains.clear();
}
