# assets

A committed, CI-gated example eval run lives at [`tests/fixtures/sample-run/`](../tests/fixtures/sample-run/):
a self-contained target plus grounded findings that the `runtime-node-floor` CI job drives through
`check → verify → check --semantic → backlog --tdd → render` on every push — so the shipped example can
never silently drift from the gate that validates it.
