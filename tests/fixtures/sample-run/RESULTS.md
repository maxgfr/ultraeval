# Results — sample target

The SQL injection in the `/u` route is confirmed and directly exploitable [F1].
The command injection in `/run` via `execSync` is a critical remote-code-execution flow [F2].
Overall the target exposes two untrusted-input-to-sink paths and one sanitized route [M].
