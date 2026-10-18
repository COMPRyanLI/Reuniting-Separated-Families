# Phase 06: hardening, data lifecycle, and measurable quality

Depends on: 05. Gate: SEC-01 through SEC-04; DATA-01 through DATA-04; PERF-01 through PERF-03; all prior gates.

## Deliverables

A tested authorization boundary, reliable lifecycle jobs, honest benchmark evidence, and a release verification command. This phase must not be the first implementation of access control.

## Implementation steps

1. Inventory every route, list/count query, notification, job, and serializer. Map each to policy action and allowed/denied test cases. Add `docs/test-traceability.md` with every acceptance ID and the actual test name/path or manual evidence.
2. Exercise every actor/resource combination, including unassigned same-shelter worker, wrong shelter, revoked membership, operator without case authority, wrong incident, guessed ID, altered body, expired grant, and deleted person.
3. Add application-level encryption for the private text fields if not already present; migrations must not leak old plaintext copies. Test tampered ciphertext and unavailable keys fail closed. Keep lookup tokens digested and infrastructure encryption assumptions explicit.
4. Implement account/person deletion, grace-period content purge, case closure/inactivity review, expired-request cleanup, token cleanup, job cleanup, and audit expiry using the policy in the security document. Use a fixed test clock; prove affected data is deleted without deleting unrelated records.
5. Implement a restore-safe deletion/revocation replay procedure. Restore only a synthetic backup into an isolated database, reapply ledger changes, and verify deleted/revoked data cannot be served. Record backup policy and infrastructure support rather than assuming encryption/retention are enabled.
6. Review HTTP/cookie/CSP/CSRF/origin settings, credential/membership revocation, MFA recovery, brute-force limits, request-body limits, log redaction, private cache controls, and frontend build secrets.
7. Run concurrency and worker interruption tests. Check response approval versus withdrawal, duplicate submissions, competing transfers, and notification retry deduplication. Do not use sleeps to hide races; use controlled barriers/fixed clocks.
8. Build deterministic performance seed and load harness. Scope queries before pagination, inspect slow query plans, add justified indexes, and measure before/after. Do not introduce permission-insensitive caching to pass latency gates.
9. Add `npm run verify` and CI jobs for the full suite with PostgreSQL and browser setup. Missing dependencies or skipped required tests must fail clearly. Performance/deployed smoke remain explicit separate commands.
10. Write a limitations section that distinguishes passed code tests from deployment configuration, human consent, compromised devices, operator trust, and regional-scale readiness.

## Verification

- Execute all catalog cases; no mandatory skipped/pending tests and no untriaged critical/high security findings.
- Run leak sentinel scan of response JSON, logs, browser storage, and built assets.
- Run deletion/retention/restore scenarios against synthetic fixtures with fixed timestamps.
- Execute the stated benchmark profile and record hardware, versions, dataset, sample counts, p50/p95, error rates, query plans, and cold-start behavior separately.
- Re-run full verification after any security/performance fix; do not claim a previous result covers later changes.

## Exit evidence

Create `docs/test-traceability.md` and benchmark/report artifacts during implementation. In the progress log link actual evidence, not planned filenames. If a quantitative gate fails, record it and fix or explicitly revise the target with justification; do not silently lower it.
