# Acceptance test traceability

Maps every acceptance ID in [the catalog](acceptance-tests.md) to the automated tests or recorded evidence that cover it. Test names start with their acceptance ID, so `vitest -t "<ID>"` or `playwright --grep "<ID>"` finds them.

Status values: **Automated** (passing test in the listed suite), **Evidence** (recorded run with output file), **Partial**, **Not run** (blocked; reason given). Nothing here describes a deployed environment.

## Current evidence: final configuration (2026-10-19, progress entry 13)

Windows 11, **Node 24.22.0** (per-user install; `node --version` is printed at the top of each verify log), npm 11.19.1, PostgreSQL 17 in local Docker, disposable `rf_test_*` databases only. Local machine results; nothing here was measured on a host.

| Run | Result | Evidence |
| --- | --- | --- |
| `npm run verify`, run 5 (first run on Node 24.22.0, before entry 13's code changes) | PASSED: unit 26/26, integration 98/98, security 14/14, e2e 27/27, a11y 4/4; no skips | `evidence/verify-2026-10-19/verify-run5-node24.22.0.log` |
| `npm run verify`, run 7 (**latest**, entry 15: shelter tests, provisioning, result-screen focus) | PASSED: docs, lint, typecheck, build, unit 26/26, integration 102/102, security 14/14, e2e 28/28, a11y 7/7; no skips | `evidence/verify-2026-10-19/verify-run7-node24.22.0.log` |
| `npm run verify`, run 6 (all entry 13 changes) | PASSED: docs, lint, typecheck, build, unit 26/26, integration 99/99, security 14/14, e2e 27/27, a11y 5/5; no skips | `evidence/verify-2026-10-19/verify-run6-final-node24.22.0.log` |
| `npm run test:performance` (API and worker inside the load-generator process) | PASSED 11/11 gates: 29,939 operations, p50 36.8 ms, p95 68.0 ms, 0% errors, 0 unauthorized payloads; delivery p95 1,057 ms, 0 duplicates; login p95 52.8 ms; initial JS 95.9 KiB gzip; median LCP 1,216 ms; cold start 279 ms | `evidence/performance/perf-summary.json`, `evidence/verify-2026-10-19/performance-node24.22.0.log` |
| `npm run test:performance -- --single-process` (the free-hosting start command `scripts/start-free.mjs` as its own process, worker in the web process) | PASSED 11/11 gates: 34,473 operations, p50 32.0 ms, p95 61.6 ms, 0% errors, 0 unauthorized payloads; delivery p95 1,082 ms, 0 duplicates; login p95 48.5 ms; median LCP 1,200 ms; cold start to ready 1,332 ms (includes the migrate and seed checks) | `evidence/performance/perf-summary-single-process.json`, `evidence/verify-2026-10-19/performance-single-process-node24.22.0.log` |
| `npm run drill:restore` | 11/11 | `evidence/drills/restore-drill.json` |
| `npm run check:free-start` | 8/8 (delete seeded people, restart, nothing recreated) | `evidence/drills/free-tier-check.json` |
| `npm run audit:zoom` (real Chromium page zoom 200%) | 40 views, 0 automated findings after two fixes (see UX-02 and UX-01); zoom restored to 100% | `evidence/zoom-200/zoom-audit.json`, 12 reviewed screenshots in `evidence/zoom-200/` |
| Docker image on `node:24.22.0-bookworm-slim` | Built; Node v24.22.0 / npm 11.19.1 in the image; on a disposable database: migrate deploy, seed refused without confirmation, `--once` seed then skip, retention command, production server ready with the in-process worker, HSTS and CSP present | progress entry 13 |
| Blueprint validation | Both Blueprints VALID against Render's JSON Schema (a broken copy is rejected); `node-version-alias` resolves `24.22.0` exactly; Render CLI validation NOT RUN (needs a workspace) | [deployment.md](deployment.md) "Pre-deployment validation" |

Performance results come from one Windows laptop with a local database. They do not predict the Render free tier (0.1 CPU, 512 MB, cold starts after sleep), which has not been measured.

## Older evidence (Node 24.16.0, progress entries 10-12; superseded by the runs above)

| Run | Result | Evidence |
| --- | --- | --- |
| `npm run verify`, run 1 | FAILED at `test:e2e`: 24 passed, 3 failed (screenshot spec matched a case-card badge heading; test locator defect, fixed) | `evidence/verify-2026-10-19/verify-run1-failed.log`, `run1-screenshot-test-failure.png` |
| `npm run verify`, run 2 | PASSED: docs, lint, typecheck, build, unit 21/21, integration 95/95, security 14/14, e2e 27/27, a11y 4/4; no skips | `evidence/verify-2026-10-19/verify-run2.log` |
| `npm run verify`, run 3 (after free-tier config and in-process worker) | PASSED: docs, lint, typecheck, build, unit 26/26, integration 95/95, security 14/14, e2e 27/27, a11y 4/4; no skips | `evidence/verify-2026-10-19/verify-run3.log` |
| `npm run verify`, run 4 (after the one-time seed, tombstone-aware fixtures and purge-at-deletion) | PASSED: docs, lint, typecheck, build, unit 26/26, integration 98/98, security 14/14, e2e 27/27, a11y 4/4; no skips | `evidence/verify-2026-10-19/verify-run4.log` |
| `npm run test:performance` (entry 10) | PASSED all 11 gates: 30,815 operations, p95 67.1 ms | `evidence/verify-2026-10-19/performance.log` (its JSON summary was overwritten by the entry 13 run) |
| Keyboard journey repeated (`--repeat-each 15`) | 15/15 passed after the fix | progress log entry 10 |
| `npm run drill:restore` (entry 10) | 11/11 checks passed | the JSON file now holds the entry 13 rerun |
| `npm run check:free-start` with the earlier seed behaviour (RED reproduction of Codex's seed finding) | 6/8: after a restart through `start-free.mjs` the seed recreated deleted Leo's 2 check-ins and Ana's check-in and assistance credential | `evidence/drills/free-tier-check-red-before-seed-fix.json` |
| `npm run check:free-start` after the fix (Render free-tier rehearsal, local, not a deployment) | 8/8: migrate on empty DB, one-time seed, smoke 14/14 with the in-process worker, deletion of seeded Leo and Ana purges at once, restart skips the seed and recreates nothing, persistence, sign-in rules after restart (entry 12) | the JSON file now holds the entry 13 rerun |
| Blueprint validation (entry 12) | VALID; `node-version-alias` resolved `24.16.0` exactly | progress entry 12 |

Earlier browser-only run by Codex: [browser test results](browser-test-results-2026-10-19.md) (21/21 e2e; accessibility 3/4 with the intermittent keyboard failure investigated and fixed below).

Suites: `unit` = `npm run test:unit`, `int` = `npm run test:integration`, `sec` = `npm run test:security`, `e2e` = `npm run test:e2e`, `a11y` = `npm run test:a11y`, `perf` = `npm run test:performance`.

| ID | Status | Tests or evidence |
| --- | --- | --- |
| FND-01 | Automated + Evidence | `npm run verify` (lint, strict typecheck, build); clean-copy install and Docker build recorded in progress entry 8 |
| FND-02 | Automated | e2e `tests/e2e/foundation.spec.ts` (390px and 1280px home and nested reload, readiness); int `tests/integration/foundation.test.ts` |
| FND-03 | Automated | unit `tests/unit/config.test.ts`; int `foundation.test.ts`; e2e `foundation.spec.ts` (sentinel scan of served HTML and assets) |
| FND-04 | Automated | `npm run docs:check`; unit `tests/unit/docs-check.test.ts` |
| DB-01 | Automated | int `tests/integration/database.test.ts` DB-01 (seed twice; startup `--once` skips a seeded database); int `seed-lifecycle.test.ts` (re-seeding after deletion recreates nothing; startup seeding runs once); `npm run check:free-start` |
| DB-02 | Automated | int `database.test.ts` DB-02 (5 cases) |
| DB-03 | Automated | int `database.test.ts` DB-03 (restart, old-schema upgrade, reset guard) |
| AUTH-01 | Automated | int `tests/integration/auth.test.ts` AUTH-01 (3); e2e `tests/e2e/auth.spec.ts` |
| AUTH-02 | Automated | int `auth.test.ts` AUTH-02 (3) and CSRF case; e2e `auth.spec.ts` |
| AUTH-03 | Automated | int `auth.test.ts` AUTH-03 (5, including "wrong re-entered password is refused without ending the session"); e2e `auth.spec.ts`, `tests/e2e/lifecycle.spec.ts` (recovery revokes the other browser's session) |
| AUTH-04 | Automated | int `auth.test.ts` AUTH-04 (2); sec `authorization.test.ts` PRIV-06; e2e `lifecycle.spec.ts` AUTH-04 (rotated secret, contact code and replay refused in the browser) |
| AUTH-05 | Automated | int `auth.test.ts` AUTH-05 (3; rejected codes are 403 `MFA_REJECTED`, session kept) |
| AUTH-06 | Automated | int `tests/integration/auth-limits.test.ts` (2) |
| CHECK-01 | Automated | int `tests/integration/checkins.test.ts` CHECK-01 (3); e2e `tests/e2e/checkins.spec.ts` |
| CHECK-02 | Automated | int `checkins.test.ts` CHECK-02 (2); unit `tests/unit/time.test.ts` (4); e2e `checkins.spec.ts` |
| CHECK-03 | Automated | int `checkins.test.ts` CHECK-03; PRIV-07 |
| CHECK-04 | Automated | int `checkins.test.ts` CHECK-04 (4) |
| FLOW-01 | Automated | int `tests/integration/requests-flow.test.ts` FLOW-01; e2e `tests/e2e/flows.spec.ts` FLOW-01/PRIV-04 |
| FLOW-02 | Automated | int `requests-flow.test.ts` FLOW-02 |
| FLOW-03 | Automated | int `requests-flow.test.ts` FLOW-03 |
| FLOW-04 | Automated | int `requests-flow.test.ts` FLOW-04 |
| FLOW-05 | Automated | int `tests/integration/shelter.test.ts` FLOW-05; e2e `flows.spec.ts` FLOW-05; e2e `shelter-walkthrough.spec.ts` (two people without devices at two shelters, paper contact code from intake); int `intake-contact-code.test.ts` |
| FLOW-06 | Automated | int `shelter.test.ts` FLOW-06; e2e `flows.spec.ts` FLOW-06; e2e `shelter-walkthrough.spec.ts` (no-code request from one assisted person to another: coordinator assigns, worker proposes, recipient decides at a verified visit, requester learns nothing before the answer). Human run: [shelter walkthrough](shelter-walkthrough.md) done by the owner, overall report only (2026-10-19) |
| PRIV-01 | Automated | sec `tests/security/enumeration.test.ts` (3) |
| PRIV-02 | Automated | sec `authorization.test.ts` PRIV-02 |
| PRIV-03 | Automated | sec `authorization.test.ts` PRIV-03; e2e storage checks |
| PRIV-04 | Automated | int `requests-flow.test.ts` PRIV-04 (2); e2e `flows.spec.ts` FLOW-01/PRIV-04 |
| PRIV-05 | Automated | int `requests-flow.test.ts` PRIV-05; e2e `flows.spec.ts` UX-05 |
| PRIV-06 | Automated | sec `authorization.test.ts` PRIV-06 (2) |
| PRIV-07 | Automated | int `requests-flow.test.ts` PRIV-07 |
| PRIV-08 | Automated | int `shelter.test.ts` PRIV-08 and STAFF-05; int `review-findings.test.ts` (ask-for-lead gives one answer for every hidden state); e2e `lifecycle.spec.ts` (assigning coordinator gets no case access) |
| STAFF-01 | Automated | int `tests/integration/staff-intake.test.ts` STAFF-01 (4); int `review-findings.test.ts` (multi-shelter staff must choose an own shelter); int `intake-contact-code.test.ts` (contact code issued at intake reaches the case; restricted referral refuses it); int `staff-provision.test.ts` (the real `staff:admin provision` command: needs `--confirm` and an existing account, refuses a duplicate role clearly, ends old sessions, staff tools need two-step setup); e2e `tests/e2e/staff.spec.ts` |
| STAFF-02 | Automated | int `staff-intake.test.ts` STAFF-02 (3); e2e `staff.spec.ts` |
| STAFF-03 | Automated | int `staff-intake.test.ts` STAFF-03 (2); int `shelter.test.ts` FLOW-06; e2e `lifecycle.spec.ts` STAFF-03 (restricted intake, no sharing tools) |
| STAFF-04 | Automated | int `shelter.test.ts` STAFF-04 |
| STAFF-05 | Automated | int `shelter.test.ts` PRIV-08 and STAFF-05; int `review-findings.test.ts` (proposal bound to the current task holder; candidate opt-out mid-proposal wins) |
| STAFF-06 | Automated | int `shelter.test.ts` STAFF-06 (2) |
| STAFF-07 | Automated | int `shelter.test.ts` STAFF-07; int `review-findings.test.ts` (decided transfers refuse before any secret check); e2e `lifecycle.spec.ts` STAFF-07 |
| STAFF-08 | Automated | int `shelter.test.ts` STAFF-08; int `lifecycle.test.ts` DATA-01; e2e `lifecycle.spec.ts` (assisted deletion, coordinator close) |
| REL-01 | Automated | int `tests/integration/reliability.test.ts` REL-01; int `tests/integration/idempotent-limits.test.ts` (retries do not consume rate limits) |
| REL-02 | Automated | int `reliability.test.ts` REL-02 (4); int `review-findings.test.ts` (concurrent duplicate assignments: one 201, rest 409) |
| REL-03 | Automated | int `reliability.test.ts` REL-03 (2) |
| REL-04 | Automated | int `reliability.test.ts` REL-04 |
| UX-01 | Automated; **screen reader: walkthrough done with open details** | a11y `tests/e2e/a11y.spec.ts` (axe on 20 page states, keyboard-only journey, error focus): 5/5 in final verify run 6; keyboard journey 15/15 repeated (entry 10). e2e `checkins.spec.ts` (place lists announce loading and stay disabled until ready). int `field-errors.test.ts` (each secret-like field names itself in its error, found in the zoom review). a11y "result screens that replace a form move focus to their heading" (2, found from walkthrough step 8). **Screen reader**: owner reported steps 1 and 3–12 OK ([walkthrough](screen-reader-walkthrough.md)); open: step 2 speech, step 8/5 re-listen after the focus fix, screen reader name/version; not an unconditional pass |
| UX-02 | Automated + Evidence | e2e `tests/e2e/screenshots.spec.ts`; `evidence/screenshots/`. **200% browser zoom done (2026-10-19)**: `npm run audit:zoom` with real Chromium page zoom (Chromium 156, window 1280x800, CSS viewport 632 px), 40 views incl. forms with errors, dialogs, navigation, staff flows; measurements plus human screenshot review; found the staff two-step setup link scrolling sideways (fixed; regression a11y.spec "UX-02 ... setup reflows at 390 px"). Firefox/Safari zoom not checked |
| UX-03 | Automated | e2e `flows.spec.ts` UX-03; e2e `checkins.spec.ts` (failed place list announced with retry) |
| UX-04 | Automated | e2e `auth.spec.ts`, `flows.spec.ts` UX-04 (2) |
| UX-05 | Automated | e2e `flows.spec.ts` UX-05; `staff.spec.ts` (3 primary intake interactions) |
| SEC-01 | Automated | sec `tests/security/hardening.test.ts` SEC-01 |
| SEC-02 | Automated | sec `hardening.test.ts` SEC-02 (2); e2e `flows.spec.ts` SEC-02 |
| SEC-03 | Automated | sec `hardening.test.ts` SEC-03; e2e `foundation.spec.ts` FND-03 |
| SEC-04 | Automated | sec `hardening.test.ts` SEC-04 (3) |
| DATA-01 | Automated | int `lifecycle.test.ts` DATA-01 (3: purge happens in the deletion transaction without a retention run; retention still purges a tombstone recorded without a purge); e2e `lifecycle.spec.ts` DATA-01 (self and assisted deletion through the UI); `npm run check:free-start` (deletion purges at once on the single-process start). Holds on every host because it does not depend on the background job |
| DATA-02 | Automated (local, fixed clock); **demo-only exception on the Render free host** | int `lifecycle.test.ts` DATA-02; int `review-findings.test.ts` (closed-case purge closes open requests and routes). On the free single-process host the retention job does not run while the service sleeps, so these windows can run late and are **not claimed there** (security spec §7 hosting exception, Help page). Access decisions are checked on every read and do not depend on the job |
| DATA-03 | Automated + Evidence | int `tests/integration/restore.test.ts` DATA-03; `npm run drill:restore` through the operator CLI on disposable databases (`evidence/drills/restore-drill.json`, 11/11) |
| DATA-04 | Automated | int `lifecycle.test.ts` DATA-04 (3); unit `tests/unit/crypto.test.ts` |
| PERF-01 | Evidence (local) | Node 24.22.0, both modes: `evidence/performance/perf-summary.json` 29,939 operations, p95 68.0 ms; `perf-summary-single-process.json` 34,473 operations, p95 61.6 ms; 0% errors and 0 unauthorized payloads in both. Not measured on a host |
| PERF-02 | Evidence (local) | delivery p95 1,057 ms / 1,082 ms (single process), 0 duplicates; login p95 52.8 / 48.5 ms. Browser update time is derived (delivery p95 + 15 s poll), not measured in a browser. On the free host the worker sleeps with the service |
| PERF-03 | Evidence (local) | initial JS 95.9 KiB gzip, median LCP 1,216 / 1,200 ms (5 throttled runs), no external hosts; cold start 279 ms (server bundle) and 1,332 ms (whole free-hosting start). Render's wake-up after sleep (about a minute per Render) is not measured |
| DEPLOY-01 | Not run | No Render account or public repository yet. Locally: `npm run smoke:deployed` 14/14 against a production build (2026-10-18) and the free single-process start rehearsal 8/8 (`evidence/drills/free-tier-check.json`); neither is a deployment |
| DEPLOY-02 | Not run | Same dependency |
| DEPLOY-03 | Partial | README, clean-copy install and Docker build exist; no public repository URL |
| DEPLOY-04 | Partial | Local verify, performance and traceability exist; no deployed smoke on a release revision |

## Manual testing guide coverage (2026-10-19)

How each section of [the manual guide](manual-testing-guide.md) is covered now. "Browser" means a Playwright test drives the same screens in isolated browser contexts.

| Guide section | Covered by | Not run |
| --- | --- | --- |
| 2–3 Public pages, signup, check-ins | e2e foundation, auth, checkins | — |
| 4–9 Requests, scopes, API bodies, revocation, decline/block | e2e flows; int requests-flow; sec authorization | — |
| 10–13 Staff MFA, intake, assisted requests, no-code routing | e2e staff, flows FLOW-05/06; int staff-intake, shelter | — |
| 14 Transfers | e2e lifecycle STAFF-07; int shelter STAFF-07; review-findings | — |
| 15 Restricted referrals, coordinator boundaries, closure | e2e lifecycle STAFF-03/PRIV-08; int staff-intake STAFF-03 | — |
| 16 Logout, recovery, session expiry | e2e auth, lifecycle AUTH-04; int auth AUTH-03/04 with a fixed clock | Natural 30-minute / 15-minute idle expiry and 10-minute assistance expiry in real time: **NOT RUN** (fixed-clock integration evidence only) |
| 17 Failed submissions, restart persistence | e2e flows UX-03 (offline and 500), checkins (slow/failed list); int DB-03 restart | Stopping the real dev server mid-form: **NOT RUN** (route-level simulation only) |
| 18 Keyboard, mobile, zoom, screen reader, text safety | a11y suite; e2e screenshots; e2e SEC-02; `npm run audit:zoom` (real 200% page zoom, 40 views, screenshots reviewed) | Screen reader (Narrator/NVDA): **PENDING** the owner's session ([walkthrough](screen-reader-walkthrough.md)) |
| 19 Deletion and expiry | e2e lifecycle DATA-01 (self and assisted); int lifecycle DATA-01/02 | Real 24-hour grant expiry: **NOT RUN** (fixed-clock evidence only) |
| 20 Automated gates | `npm run verify` run 2, performance | — |
| 22 Deployment | — | **NOT RUN**: no hosting account, database or repository |

## Lifecycle verification status (2026-10-19)

"Current" means it passed in the final verify run 6 or a rerun on Node 24.22.0 (entry 13). "Controlled clock" means time was advanced in a test, not waited for. Nothing below was run on a host.

| Area | Current automated evidence | Browser evidence | Real elapsed time | Hosted |
| --- | --- | --- | --- | --- |
| Recovery | int `auth.test.ts` AUTH-03/04 (current) | e2e `lifecycle.spec.ts` recovery revokes the other browser's session (current) | Not applicable | Not run |
| Transfers | int `shelter.test.ts` STAFF-07, `review-findings.test.ts` (current) | e2e `lifecycle.spec.ts` STAFF-07 (current) | Not applicable | Not run |
| Deletion | int `lifecycle.test.ts` DATA-01, `seed-lifecycle.test.ts` (current); `check:free-start` 8/8 (current) | e2e `lifecycle.spec.ts` self and assisted deletion (current) | Not applicable | Not run |
| Purge | Deletion purges in its own transaction: int DATA-01 (current). Time-based retention: int DATA-02 and `review-findings.test.ts` under a **controlled clock** (current) | Not visible in a browser by design | **Not run** (30-day and 24-hour windows not waited for) | **Not claimed on the free host**: the retention job does not run while the service sleeps (security spec §7 exception) |
| Expiry | Grants (24 h / 7 days), requests (14 days), sessions and assistance sessions: int `requests-flow.test.ts`, `lifecycle.test.ts`, `auth.test.ts` under a **controlled clock** (current) | e2e checks revoked and unavailable states, not natural expiry | **Not run** (manual guide items NOT RUN) | Not run |
| Restoration | int `restore.test.ts` DATA-03 on a database copy (current); `npm run drill:restore` 11/11 through the operator CLI on disposable databases (current, rerun on 24.22.0) | Not applicable | Not applicable | **Not possible on the free host** (no backups); not run on any host |
