# Phase 07: public deployment and challenge submission

Depends on: 06. Gate: DEPLOY-01 through DEPLOY-04 and full verification.

## Deliverables

A reachable fictional-data demonstration with persistent PostgreSQL, a working outbox worker, public repository, and a README satisfying the challenge. A local screenshot or frontend-only URL is insufficient.

## Implementation steps

1. Choose a host supporting the pinned Node runtime, PostgreSQL, HTTPS, runtime secrets, and the worker lifecycle. Verify current hosting capabilities and costs using official docs at deployment time; do not assume any free-tier capability or availability.
2. Build a production artifact, configure same-origin API/frontend, database connection limits, exact trusted origin, secret keys, secure cookies, and redacted logs. Do not put backend secrets in frontend build variables. Fail closed if production secrets are missing.
3. Apply checked-in migrations with the deployment migration command. Back up before destructive schema changes; do not run seed/reset scripts against a real-data database. The challenge deployment contains fictional data only.
4. Deploy API/web and worker, verify readiness, and create demonstration fixtures through the guarded demo seed. Ensure worker restart behavior and pending-job processing work on the selected host.
5. Define reviewer access: ordinary fictional signup must work; provide a guided story and separately controlled demonstration staff access where needed. Staff access must still use the actual permission/MFA path. Do not add a production role-switch or MFA-bypass endpoint. Never publish actual operator/infrastructure credentials. If staff reviewer access cannot be safely provided, include its recorded fictional-data walkthrough and explicitly document that limitation.
6. Keep demo fixtures recognizable and resettable only through authenticated operations. Test that repeated reviewer usage cannot mutate another account's private data. Record whether host sleep/cold starts occur and their measured impact.
7. Add `smoke:deployed` requiring an explicit base URL and dedicated fictional accounts. It must not reset the database or run destructive retention tests against the deployment.
8. Open the public URL in a private browser session. Run signup/login, check-in, request, approval, authorized view, denied cross-account API access, and revocation. Repeat the assisted story with appropriate staff access. Reload a nested route and verify data survives service restart.
9. Finalize README: deployed link, public repo, screenshots, local setup, exact environment names, migrations/seed/test commands, users/scenarios, implemented scope, larger-system explanation, tradeoffs, limitations, test evidence, and AI-use notes.
10. Inspect repository history/files for secrets and real personal data; verify Git status and instruction parity. Publish only within the user's authorized repository/hosting scope. Record any external account/credential dependency honestly; never substitute a fake URL or claim a smoke test that did not run.

## Verification

- Run full local/CI verification against the release revision, then safe deployed smoke against the actual URL.
- Verify HTTPS/cookies, persistence, worker delivery, same-origin behavior, and public/private route handling.
- Check README instructions from a clean checkout or isolated directory with the pinned runtime.
- Review the demo in a private browser with no developer session. Ensure zero broken essential flows, inaccessible required pages, or misleading live-location claims.

## Exit evidence

Record release revision, deployed/public-repository URLs, test timestamp and timezone, exact test results, screenshot/report paths, provider constraints, and any incomplete gate. A missing working deployed URL means the challenge submission is not complete.
