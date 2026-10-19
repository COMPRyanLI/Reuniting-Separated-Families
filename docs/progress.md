# Progress and agent handoff

Last updated: 2026-10-19, Asia/Shanghai.

## Actual project state

- Challenge PDF read; people, use cases, scope, and privacy interactions discussed with the user.
- Planning package written: matching coding-agent instructions, design, permissions, data/API contracts, eight implementation phases, and acceptance catalog.
- Implementation started 2026-10-18 (Claude Code). See the implementation log below for evidence per phase.
- Deployed 2026-10-19 at https://reconnect-web.onrender.com (Render free tier); see entry 16.

## Phase status

| Phase | Status | Evidence |
| --- | --- | --- |
| 00 Foundation | COMPLETE (local) | FND-01..04 evidence in log entry 1; hosting not yet selected |
| 01 Data/auth | COMPLETE | DB-01..03, AUTH-01..06 evidence in log entry 2 |
| 02 People/check-ins | COMPLETE | CHECK-01..04, STAFF-01..03 evidence in log entry 3 |
| 03 Requests/sharing | COMPLETE | FLOW-01..04, PRIV-01..07 evidence in log entry 4 |
| 04 Shelter interactions | COMPLETE | FLOW-05..06, PRIV-08, STAFF-04..08, REL-01..04 evidence in log entry 5 |
| 05 Website experience | COMPLETE (screen reader PENDING) | UX-01..05 evidence in log entries 6, 10 and 13. Real 200% browser zoom done (entry 13, two defects fixed). Screen-reader check PENDING the owner ([walkthrough](screen-reader-walkthrough.md)) |
| 06 Hardening/benchmarks | COMPLETE | Log entries 7, 10 and 13: final verify run 6 passed on Node 24.22.0; performance 11/11 gates in both the default and single-process mode (local); restore drill 11/11 |
| 07 Deployment/submission | DEPLOYED (free tier) | https://reconnect-web.onrender.com from https://github.com/COMPRyanLI/Reuniting-Separated-Families (`7036fb2`). Live smoke 15/15, live browser suite 8/8, sleep/wake persistence passed, clean clone reproducible (entry 16). Staff-assisted path not run on the live site |

## Next concrete task

1. Done (2026-10-19): the owner authorized committing and pushing the documentation commit; the push triggers one Render redeploy (no app code changes).
2. **Owner, optional:** run the staff-assisted path on the live site with the demo staff password from the Render dashboard (parts B-D of [shelter-walkthrough.md](shelter-walkthrough.md)), or give the agent the password through a git-ignored local file (never in chat).
3. Done: the owner stated the AI-use notes now in the README (owner wrote the plans, user classifications, scope, tradeoffs and harness metrics; Claude Code (Claude Opus 5.5) developed; OpenAI Codex (GPT Astra) debugged and ran frontend Playwright tests; owner reviewed the key code).
4. **Owner, optional:** re-listen to screen-reader steps 5 and 8 and record the screen reader and version.
5. **Before day 30 after the database was created (owner):** upgrade the free database (about US$6/month) or accept that Render deletes it after the 14-day grace period.

## Decisions made to remove implementation ambiguity

- Use one TypeScript React/Express/PostgreSQL application and same-origin hosting; exact compatible versions selected at phase 00.
- No continuous or one-shot GPS in the first version; shelter/area selection provides location reports.
- Contact-code requests route privately. No-code requests use one explicitly selected shelter at a time, scoped staff matching, and recipient consent. No global people search.
- Individual account and assisted person records are distinct; automatic claiming/merging is deferred.
- A grant concerns one response/report and one recipient, not future reports or an entire family.
- Staff MFA, short assistance verification, explicit version/idempotency rules, and minimal metadata audits are required implementation safeguards.
- Expiry, rate limits, retention, and performance thresholds are prototype design choices documented in specifications, not external authority requirements.
- Restricted referrals demonstrate the boundary for children/people unable to consent; guardian verification is not implemented.

## Known limitations to preserve

No phone/device or report means no new location can be inferred. A historical check-in is not current presence. Lost credentials without reliable verification require manual escalation. Targeted routing can remain unresolved without leads. The app cannot prove a worker recorded freely given consent, undo screenshots, or eliminate operator/compromised-device risks. Prototype performance does not demonstrate capacity for all 400,000 affected residents.

## Handoff entry template

Copy for each implementation task; do not replace previous useful evidence.

```text
Date/time and timezone:
Agent/tool:
Phase/task:
Revision or working-tree context:
Files and behavior changed:
Acceptance IDs implemented:
Commands actually run and results:
Automated/manual evidence paths:
Failures/skips/unavailable dependencies:
Material decisions or specification changes:
Remaining risks/limitations:
Next concrete task:
```

## Planning validation

2026-10-18, Asia/Shanghai: ran a local Python document validator through PowerShell using the bundled Python runtime. It checked instruction bytes/SHA-256, every Markdown relative link, code-fence pairing, trailing whitespace, unique acceptance definitions, and phase-to-test references. The initial run checked 19 Markdown files and 63 acceptance definitions with zero errors; all 63 were covered by phase gates.

Manual consistency review added explicit assisted decline/block/withdraw/revoke-all endpoints, no-code lead-update contracts, optional protected matching clues, consistent non-enumerating expiry behavior, and the operational paper fallback. Final validation results are recorded after these edits below.

Final validation: exit code 0; 19 Markdown documents checked; 63 unique acceptance cases; all 63 assigned to phase gates; zero broken local links, mismatched code fences, trailing-whitespace findings, or undefined phase test IDs. The three instruction copies have the identical SHA-256 `f98c64a2c76dcd3a52d78911ef816729a08dae8956206e658310c8d6edc2f02f`.

Dependency review also moved assisted-matching privacy coverage to phase 04 and removed premature phase-01/02 requirements for sharing/check-in functionality not yet introduced. The next implementation task remains phase 00.

These are documentation checks only. No application unit, integration, browser, security, performance, or deployed smoke tests have run. All implementation phases remain NOT STARTED.

## Implementation log

### Entry 1: phase 00 foundation

```text
Date/time and timezone: 2026-10-18, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Phase/task: 00 Foundation
Revision or working-tree context: repository has no commits; all work is uncommitted in the working tree
Files and behavior changed: npm workspaces (apps/api, apps/web, packages/contracts); strict TS (tsconfig.base.json);
  ESLint 10 flat config; .gitignore; .env.example; docker-compose.yml (local PostgreSQL 17 on 127.0.0.1:55432);
  apps/api: config validation (names-only errors), metadata-only logger, error envelope, helmet CSP/headers,
  /api/health/live and /api/health/ready, same-origin static serving with SPA fallback, esbuild bundle;
  apps/web: Vite/React shell with demo banner, home/help/404; scripts/docs-check.mjs; scripts/setup-env.mjs;
  .github/workflows/ci.yml (written, not executed: no remote repository or CI runner available here)
Version pins: Node 24.16.0 (.nvmrc; engines >=24.11 <25), npm 11.13.0, TypeScript 5.9.3, React 19.3.1,
  react-router 7.18.4, @tanstack/react-query 5.104.4, Vite 7.3.7, Express 5.3.0, Prisma 6.19.3, Zod 4.6.7,
  Vitest 3.2.7, Playwright 1.64.1, ESLint 10.13.0, argon2 0.45.1, otpauth 9.5.2, helmet 8.3.0, esbuild 0.28.2,
  PostgreSQL 17 (postgres:17-alpine)
Acceptance IDs: FND-01, FND-02, FND-03, FND-04
Commands actually run and results:
  npm run docs:check -> exit 0 (19 Markdown files, 63 IDs, instruction SHA-256 f98c64a2...f02f)
  npm run lint -> exit 0; npm run typecheck -> exit 0; npm run build -> exit 0
  NODE_ENV=production with keys missing: node apps/api/dist/server.js -> exit 1; the log lists only
    APP_ORIGIN,DIGEST_KEY,FIELD_ENCRYPTION_ACTIVE_KEY,FIELD_ENCRYPTION_KEYS (DB password sentinel absent)
  npm run start + curl: /api/health/live 200, /api/health/ready 200, /help 200 (SPA reload), unknown /api route 404
  npm run test:unit -> tests/unit/config.test.ts (FND-03) and docs-check.test.ts (FND-04 drift detection) pass
  npm run test:e2e -> tests/e2e/foundation.spec.ts: FND-02 at 390px and 1280px, readiness, FND-03 asset scan pass
Failures/skips/unavailable dependencies: clean `npm ci` re-run deferred to phase 06 verification;
  CI workflow not executed; no hosting selected yet (phase 07)
Next concrete task: phase 01
```

### Entry 2: phase 01 data and authentication

```text
Date/time and timezone: 2026-10-18, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Phase/task: 01 Data, authentication, authorization foundation
Files and behavior changed:
  prisma/schema.prisma + prisma/migrations/20261018000100_core: accounts, sessions, recovery credentials, staff MFA,
    persons, contact codes, assistance credentials, incidents/areas/shelters, memberships, cases, assignments, audit,
    rate-limit buckets. Hand-written SQL adds incident-consistent composite FKs, one-active partial unique indexes,
    an operator/shelter CHECK and an assignment membership-account FK.
  prisma/fixtures.ts + prisma/seed.ts: deterministic fictional fixtures (Maya, Leo, Noor, Evan, W-A, W-A2, W-B, C-A,
    C-B, O, W-X; assisted Sam, R (restricted), Ana (ASSISTED), Bo (CODE_ONLY), Cy (CLOSED) at A/B, Kit in incident 2;
    shelters A, B, D (no staff) and X (incident 2)). Seed refuses DEMO_MODE!=true, and production without
    SEED_CONFIRM_FICTIONAL=yes.
  apps/api: Argon2id (19 MiB, t=2, p=1) with dummy verification for unknown users; DB-backed fixed-window rate limits;
    opaque session tokens stored as HMAC digests; cookie HttpOnly, SameSite=Lax, Path=/ (+Secure and __Host- prefix
    on https); individual 30 min idle / 12 h absolute, staff 15 min / 8 h; X-Background-Refresh polling does not extend
    idle time; Origin check on every mutation plus a per-session HMAC CSRF token for cookie-authenticated mutations;
    registration, login, logout, recovery (single-use secret, rotates credentials, revokes sessions), recovery-secret
    rotation, TOTP enrollment/verification with replay rejection and single-use MFA recovery codes, session rotation
    on login and MFA; requireStaff re-reads memberships on every request; scripts/staff-admin.ts operator CLI
  apps/web: sign-up (recovery secret shown once), sign-in, recovery, signed-out page, staff MFA page, account page,
    route guards, in-memory CSRF token, query-cache clearing on logout/expiry/account switch
  tests: tests/support (template DB per run, cloned DB per file, fixed clock, isolated supertest agents),
    tests/integration/{foundation,database,auth,auth-limits}.test.ts, tests/e2e/{foundation,auth}.spec.ts
Acceptance IDs: DB-01, DB-02, DB-03 (restart and reset guard; old-schema upgrade test added once a second migration
  exists), AUTH-01..AUTH-06
Commands actually run and results:
  npm run test:integration -> 4 files, 30 tests passed (PostgreSQL 17 in Docker, disposable rf_test_* databases)
  npm run test:unit -> 3 files, 17 tests passed
  npm run test:e2e -> 7 Playwright tests passed (built app + worker + disposable DB)
Failures/skips: two AUTH-03 tests first failed because the test arithmetic was wrong (4 x 9 min exceeds the 30 min idle
  limit; 36 x 20 min reaches the 12 h limit exactly). Tests corrected; implementation unchanged.
Remaining limits: login proves account control only; staff MFA enrollment/recovery depends on organizational process.
Next concrete task: phase 02
```

### Entry 3: phase 02 people, check-ins and assisted intake

```text
Date/time and timezone: 2026-10-18, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Phase/task: 02 Personal privacy, historical check-ins, assisted intake
Files and behavior changed:
  prisma/migrations/20261018000200_checkins_consent: CheckIn, ConsentRecord, AssistanceSession, IdempotencyRecord with
    SQL constraints (person/area/shelter incident-consistent composite FKs, shelter-in-area FK, same-person supersede
    FK, observedAt <= receivedAt + 5 min, departed/state and staff-source/case consistency, assistance sessions <= 30 min)
  fixtures: Leo (older Downtown area report + Shelter B report), Sam (A) and Ana (B) staff-recorded reports
  apps/api: public GET /shelters and /areas (facility metadata only); /me GET/PATCH alias, PATCH /me/privacy
    (expectedVersion, consent record, no grant change), /me/check-ins list/create (Idempotency-Key)/depart; generic
    idempotency service (unique key per actor+operation+subject, payload digest, 409 on changed payload, outcome
    reference only); check-in service shared by self and assisted paths (subject from authority, never the body);
    staff: /staff/tasks (own assignments; coordinator minimal case index without alias), /staff/cases intake (person
    without account, case at worker's own shelter, own assignment, witnessed INTAKE_WITNESS session, consent record,
    separate assistance secret, optional check-in/contact code, all in one transaction), case view filtered by active
    assignment + membership at the case shelter (404 otherwise), sensitive sections only with this worker's own
    10-minute assistance session, /verify with failure limit (5/15 min), /escalate, /end-assistance, assisted
    check-ins/depart/privacy/contact-code/assistance-secret rotation, coordinator assignment (no self-assignment, no
    data access for the coordinator) and assignment end, restricted referral boundaries
  apps/web: public shelters page, check-ins page (shelter/area form, correction, departure, historical cards with
    timezone, source, Older report and no-longer-current labels), privacy/contact-code page, staff task list,
    coordinator allocation table, intake page (reference card + one-time secret), case workspace
  tests: tests/unit/time.test.ts; tests/integration/{checkins,staff-intake}.test.ts; DB-03 upgrade test in
    database.test.ts; tests/e2e/{checkins,staff}.spec.ts
Acceptance IDs: CHECK-01..04, STAFF-01..03 (approval/matching parts of STAFF-03 are re-tested in phases 03/04),
  DB-03 old-schema upgrade
Commands actually run and results:
  npm run test:unit -> 4 files, 21 tests passed
  npm run test:integration -> 6 files, 52 tests passed
  npm run test:e2e -> 10 Playwright tests passed
  npm run typecheck / npm run lint -> exit 0
Evidence notes: UX-05 intake interaction count measured in tests/e2e/staff.spec.ts: 3 primary interactions
  (name, consent, save) with defaults for request mode and check-in time.
Remaining limits: intake consent is witnessed by the worker and cannot be proven; a lost assistance secret leads to a
  recorded manual escalation only.
Next concrete task: phase 03
```

### Entry 4: phase 03 private requests, responses and revocation

```text
Date/time and timezone: 2026-10-18, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Phase/task: 03 Private requests, explicit responses, revocation
Files and behavior changed:
  prisma/migrations/20261018000300_requests_sharing: ReunionRequest, Response, SharingGrant, Block, AbuseReport,
    Notification, OutboxJob. SQL FKs enforce: response subject = request recipient; grant recipient = request
    requester; grant mirrors exactly one response (id, request, subject, scope); disclosed check-in owned by the subject;
    scope/check-in consistency; grant expiry <= 7 days; exactly one notification destination; no self-requests/blocks.
  apps/api: POST /requests (code requests stored with a lookup digest only, identical 202 {status, requestId} for every
    well-formed outcome, per-requester limit before any lookup), outgoing/incoming participant-specific projections,
    GET /requests/:id, withdraw, respond (request and subject rows locked; consent + immutable response + grant + audit
    + outbox in one transaction; idempotency key), private decline, directional block (revokes grants, closes pending,
    suppresses later delivery), GET /responses (shared with me) and /responses/:id (grant rechecked every read;
    field-by-field serializers per scope), /me/grants, /grants/:id/revoke, /me/grants/revoke-all, /abuse-reports,
    /notifications (generic text only), outbox worker (lease + SKIP LOCKED, bounded retries, current-authority recheck)
  apps/web: find someone (code or shelter lead, preview of what the recipient sees), your requests (neutral statuses,
    withdraw, add lead), requests for you (answer with exact recipient-view preview and 24h/7d expiry, private decline,
    confirmed block, abuse report), shared-with-you list/detail (fresh fetch, unavailable state), manage sharing
    (revoke, revoke all), updates page with 15 s background polling that pauses in hidden tabs and backs off
  tests: tests/integration/requests-flow.test.ts, tests/security/{authorization,enumeration}.test.ts,
    tests/e2e/flows.spec.ts (FLOW-01/PRIV-04 in two browser contexts plus outsider)
Acceptance IDs: FLOW-01..04, PRIV-01..07
Commands actually run and results:
  npm run test:integration -> 9 files, 76 tests passed (includes phase 04 files)
  npm run test:security -> 2 files, 7 tests passed
  npm run test:e2e -> 15 passed
Failures fixed during the phase: three test-side mistakes (an assertion matching an earlier request's own wording,
  a 24 h wait outliving the 30 min session, an earlier block correctly suppressing a later test's delivery).
Next concrete task: phase 04 (done in the same session, entry 5)
```

### Entry 5: phase 04 shelter interactions

```text
Date/time and timezone: 2026-10-18, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Phase/task: 04 Assisted requests, targeted matching, case handover, reliable delivery
Files and behavior changed:
  prisma/migrations/20261018000400_routing_transfers: RequestRoute (one active per request), LeadAsk, CaseTransfer
    (one pending per case, same incident, distinct shelters); 20261018000500_lifecycle: DeletionTombstone, SystemFlag,
    purge-safe Response columns
  apps/api: no-code requests with explicit relay consent to one shelter; lead updates that end the previous route;
    destination coordinator queue and worker assignment; matching task view and candidates limited to active local
    cases of people who opted into ASSISTED (alias + volunteered clue + route-scoped token, no IDs/locations/history);
    proposal delivers for the recipient's own decision (no grant); no-match keeps the request internally unresolved;
    generic ask-for-lead; assisted wrappers for request/respond/decline/block/withdraw/lead/response read/grant
    revoke/revoke-all/privacy/deletion behind assignment + current verification; transfer proposal with recorded choice,
    destination acceptance with secret verification and atomic reassignment; case close and review extension;
    self and assisted deletion (immediate revocation, tombstone); worker loop
  apps/web: staff queues (routed requests, matching tasks, lead review, incoming transfers), matching task page, case
    workspace request/answer/sharing/transfer/deletion sections, assisted answer page, coordinator close/extend actions,
    account deletion
  tests: tests/integration/{shelter,reliability}.test.ts; tests/e2e/flows.spec.ts FLOW-05, FLOW-06
Acceptance IDs: FLOW-05, FLOW-06, PRIV-08, STAFF-04..08, REL-01..04
Commands actually run and results:
  npx vitest run --project integration tests/integration/shelter.test.ts tests/integration/reliability.test.ts
    -> 15 passed
  Mutation check (temporary edits, then restored): removing the matching-task worker binding, the ASSISTED opt-in
    filter, or the case shelter binding each made shelter.test.ts fail (1, 2 and 1 failures); restored -> 8/8 pass
  npm run test:e2e -> 15 passed (FLOW-05 and FLOW-06 through the UI with the real worker process)
Deviation: phase 04 services were written before their tests because they share interfaces with phase 03; the
  mutation check above was used to confirm the tests detect broken authorization.
Remaining limits: shelters without staff (fixture Shelter D) leave routed requests unresolved; self-service requesters
  without a case get no coordinator lead review (only their own lead updates).
Next concrete task: phase 05
```

### Entry 6: phase 05 website experience and accessibility

```text
Date/time and timezone: 2026-10-18, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Phase/task: 05 Complete website experience
Files and behavior changed: dashboard actions (Let someone know, Find someone, Review requests, Manage sharing),
  neutral status badges with text (never colour alone), exact recipient-view preview + two-step confirm before any
  disclosure, error summaries that take focus, route-change focus management, skip link, visible focus ring,
  inactivity warning 2 minutes before the server idle timeout (background polling does not count), private cache
  clearing on sign-out/expiry/account switch, "Not submitted" handling with in-memory drafts and the same
  idempotency key on retry, responsive layout without external fonts/maps/trackers
  tests: tests/e2e/a11y.spec.ts (axe on 20 page states + keyboard-only journey + error focus),
    tests/e2e/screenshots.spec.ts (3 viewports, overflow and clipped-control checks), flows.spec.ts UX-03/04/05
Acceptance IDs: UX-01..UX-05; browser coverage of FLOW-01, FLOW-05, FLOW-06
Commands actually run and results:
  npm run test:a11y -> 4 passed; zero critical/serious axe findings (WCAG 2.0/2.1 A+AA rule tags)
  npm run test:e2e -> 19 passed (+1 mid-form session test run separately: 1 passed)
Evidence: evidence/screenshots/*.png (home, dashboard, check-ins, incoming, find-someone, staff-home, staff-case at
  390/768/1280; respond-preview-1280.png and response-view-390.png from FLOW-01)
Manual/limits: automated axe checks do not prove full accessibility; no screen-reader session was recorded. UX-05
  intake count is measured by the staff e2e test (3 primary interactions). The "expired" requester state is verified
  at API level with a fixed clock (PRIV-05) because the browser run cannot move the server clock.
Next concrete task: phase 06
```

### Entry 7: phase 06 hardening, data lifecycle and benchmarks

```text
Date/time and timezone: 2026-10-18, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Phase/task: 06 Hardening, data lifecycle, measurable quality
Files and behavior changed:
  apps/api/src/jobs/retention.ts: request expiry at the original deadline (closedAt = deadline), request text purge
    30 days after closure, deletion purge from tombstones, closed assisted cases purged after 30 days, inactive-case
    review notices for coordinators (extended cases skipped), credential/session/job/notification/audit cleanup;
    run by the worker every RETENTION_INTERVAL_MS
  apps/api/src/services/deletion.ts (purgePerson), keyRotation.ts (re-encrypt all protected fields to the active key),
    restore.ts (ledger export of identifiers only, restore gate returning 503, replay that re-applies deletions and
    revocations and revokes restored sessions); scripts/ops.ts operator CLI
  Worker processes claimed jobs with a pool of 8; static assets gzip-compressed (API responses deliberately not);
    web routes lazy-loaded
  scripts/verify.mjs; scripts/perf/{dataset,run}.ts; docs/test-traceability.md (all 63 IDs)
  tests: tests/integration/{lifecycle,restore}.test.ts, tests/security/hardening.test.ts, e2e SEC-02 inert rendering,
    extra STAFF-03 disclosure-refusal test
Acceptance IDs: SEC-01..04, DATA-01..04, PERF-01..03; all previous gates re-run
Commands actually run and results:
  npm run verify -> PASS docs:check, lint, typecheck, build, test:unit (21), test:integration (84), test:security (14),
    test:e2e (21), test:a11y (4); exit 0; no skipped tests (final counts after the review are in entry 9)
  npm run test:performance (first run) -> exit 1: 4 gates failed. Causes: harness counted the normal 404 envelope as a
    leak (harness bug); worker delivery p95 33.2 s (jobs processed one at a time); median LCP 3.1 s (uncompressed,
    unsplit bundle). Fixes: exact-envelope check; job pool of 8; gzip for static assets; route code splitting.
  npm run test:performance (second run) -> exit 0, all 11 gates pass; evidence/performance/perf-summary.json
Benchmark (second run): Windows 11 x64, Intel i7-13650HX (20 logical CPUs), 15.6 GiB RAM, Node 24.16.0, PostgreSQL 17.11
  in local Docker (same machine), API + worker in one process, NODE_ENV=test over http://localhost, rate limits raised.
  Dataset 10,010 people, 50 shelters, 30,004 check-ins, 20,000 requests, 5,000 grants. 20 clients, 30 s warm-up,
  60 s measured: 29,228 operations, p50 38.3 ms, p95 69.7 ms, 0% errors, 0 unauthorized payloads; delivery p50 415 ms /
  p95 1,109 ms, 0 duplicate notifications; login p95 55.3 ms (100 logins); initial JS 95.9 KiB gzip; median LCP 1,192 ms
  (5 runs, 390x844, 4x CPU, 1.6/0.75 Mbps, 150 ms); no external hosts; cold start to ready 337 ms.
Mutation check: removing the restricted-referral guard in respondToRequest made the new STAFF-03 test fail; restored.
Limits: the reference environment is a laptop with a local database, not 2 vCPU/4 GiB; the browser update time
  (16.1 s) is derived from delivery p95 + 15 s polling, not measured in a browser; restore replay is tested with a
  database copy, not a provider backup.
Next concrete task: phase 07
```

### Entry 8: phase 07 deployment preparation (deployment blocked)

```text
Date/time and timezone: 2026-10-18, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Phase/task: 07 Deployment and submission
Checked: no flyctl/railway/render/vercel/heroku/az/gcloud CLI, no hosting credentials in the environment, no gh CLI,
  no Git remote; the repository has no commits. Deployment and a public repository therefore require the owner.
Prepared and verified locally:
  Dockerfile + .dockerignore: `docker build` succeeded from a clean context (npm ci from the lockfile + build). In the
    container: migrate deploy OK; seed refused production without SEED_CONFIRM_FICTIONAL=yes and succeeded with it;
    `scripts/ops.ts retention` ran; server started with NODE_ENV=production, readiness 200, HSTS and CSP present;
    starting without configuration exits with variable names only.
  scripts/smoke-deployed.ts: 14/14 checks passed against the local production build (separate server and worker
    processes, http://localhost:3300) - this is not deployed evidence.
  Clean copy (no node_modules/dist/.env): npm ci, docs:check, lint, typecheck, build, test:unit all passed.
  README rewritten (story, people, scope, larger system, tradeoffs, architecture, setup, tests, evidence, limits, AI use);
  docs/deployment.md written; spec status lines updated; data-and-api.md section 7 lists implementation differences.
Not run: DEPLOY-01, DEPLOY-02 (no URL); DEPLOY-03/04 only partially (no public repository, no deployed smoke).
Next concrete task: see "Next concrete task" at the top of this file.
```

### Entry 9: independent final review and fix pass

```text
Date/time and timezone: 2026-10-18, Asia/Shanghai
Agent/tool: Claude Code; review by a separate read-only reviewer agent given the code and specs (not the author's conclusions)
Findings re-graded by effect:
  Important, fixed: origin-shelter coordinators saw decrypted relay clues in "lead review" without the requester's consent
    for that shelter, and could see which routed requests ended in "no match". Fix: lead review returns only
    request ID, case reference and time, and excludes any request with an active route.
    Test: shelter.test.ts "requester's own shelter coordinator..." RED (clues present) -> GREEN.
  Raised to Important, not reproduced: block racing an approval on another request from the same requester.
    New deterministic test (reliability.test.ts "block committed while an approval ... mid-transaction") passes
    without code changes: the Block insert's foreign-key check takes a key-share lock on the subject's Person row,
    which the approval holds FOR UPDATE, so the block waits and then revokes the committed grant. Test kept.
  Minor, deferred (listed below).
Commands: npx vitest run --project integration tests/integration/shelter.test.ts -> 8/8 after fix.
  npm run verify (second) -> stopped at test:a11y: the keyboard journey pressed Tab before a lazily loaded page rendered
  (test timing introduced by route code splitting). The test now waits for each page heading.
  npm run verify (third, final) -> exit 0: docs:check, lint, typecheck, build, unit 21/21, integration 85/85,
  security 14/14, e2e 21/21, a11y 4/4; no skipped tests.
```

### Deferred minor findings (from the final review) — all resolved 2026-10-19 (entry 10)

Each was reproduced by a failing test first (`tests/integration/review-findings.test.ts`, `tests/integration/idempotent-limits.test.ts`), then fixed. No review finding remains open.

- RESOLVED: `askForLead` now answers 200 for every request state; the worker suppresses prompts on answered/closed requests.
- RESOLVED: transfer acceptance refuses decided transfers (409) before looking at the secret and without spending verification attempts.
- RESOLVED: staff with several shelter memberships must choose one of their own shelters for an intake (422 otherwise); the intake page shows the choice.
- RESOLVED: the closed-case retention purge applies the full deletion (open requests withdrawn, routes ended, codes and credentials revoked) before purging.
- RESOLVED: a proposal must be completed by the worker who currently holds the task, and the candidate's opt-in is re-checked under a row lock.
- RESOLVED: a retry of an already-saved request or intake (same idempotency key) no longer consumes a rate-limit slot.
- RESOLVED: concurrent duplicate coordinator assignments return one 201 and 409s, never 500.

## Rulings made during implementation

- No git worktree or commits: the repository has no commits and the user asked for implementation in this directory without requesting commits. Cost if wrong: the user commits manually.
- Prisma 6.19.3 rather than 7.x or the 8.0 release candidate: mature, documented API; generated client and `migrate deploy` behave as the plan assumes. Cost if wrong: a later upgrade.
- TypeScript 5.9.3, Vite 7, Vitest 3, ESLint 10 (ESLint 9 is marked unsupported upstream). The TypeScript 7 native compiler was skipped for tooling compatibility.
- Migrations are generated with `prisma migrate diff` between schema versions and extended with raw SQL. `migrate dev` and `db push` are never used, so hand-written constraints are not dropped by later diffs.
- Contact-code rotation (`POST /me/contact-code/rotate`) was implemented in phase 01 because AUTH-04 needs a real contact code to prove it cannot recover an account.
- Rate limits are configurable (`RATE_LIMIT_*`). Integration tests raise only the shared-IP login and registration budgets, because every simulated person signs in from 127.0.0.1 under a frozen clock. AUTH-06 runs with the documented defaults (5 failures per username, 50 attempts per IP per 15 minutes). MFA and re-authentication limits count failures only.
- Login, register and recover are exempt from the CSRF token (no session exists yet) but still require the exact Origin.
- Assisted case reads: an active assignment shows only a header (alias, reference, shelter, restriction, verification state). Check-ins, clues, codes and later request/grant data need the worker's own current assistance session. This is stricter than the permission table's "assigned case if needed for assistance". Cost if wrong: one extra verification step per visit.
- Intake counts as a witnessed first verification (10-minute INTAKE_WITNESS session for the intake worker only).
- Coordinators see a minimal case index (reference, timestamps, assignment count, review flag) without alias. Assigning work never grants the coordinator case data, and self-assignment is refused.
- Restricted-referral intake returns no assistance secret or contact code and refuses check-ins, matching clues and non-CLOSED request modes.
- Browser tests run with one Playwright worker because staff TOTP enrollment and replay-protected time steps are per account.
- Requester projection: a response whose grant is revoked, expired or whose subject was deleted shows "Response unavailable" (allowed by the design). Hidden decline, block, unresolved and no-match outcomes all show "No response available yet" until the original 14-day deadline, then "Expired".
- A lead update on a request that already has a hidden pending decision is recorded (consent row) but does not open a new route, so the requester's experience is identical. A code request cannot take a shelter lead (422).
- Staff-initiated rerouting does not exist: only the requester (or their verified assisting worker) can choose a destination, with a fresh relay consent. `POST /staff/requests/:id/route` from the API table was not implemented for that reason; the 404 is tested in STAFF-06.
- The person's matching candidate token is an HMAC of route and person IDs, so candidate lists expose no internal identifiers.
- Transfers may be proposed by any assigned staff member holding a current verification (the person's recorded choice); acceptance needs the destination coordinator, the person's secret, and a named destination worker (no self-assignment).
- Notifications for people without accounts go to their active case and are shown only inside the verified case workspace.
- Deletion is implemented in phase 04 (STAFF-08 includes it); content purge runs in the phase 06 retention job.
- Retention: an assisted person (no account) whose case has been closed for 30 days is treated as deleted and purged; people with accounts are purged only when they delete. Assistance sessions referenced by a consent record are kept as evidence; others are removed after 24 hours. Cost if wrong: earlier or later purge than an operator expects.
- Static assets are gzip-compressed; API responses are not, to avoid BREACH-style leaks of the CSRF token mixed with user text. The worker processes up to 8 claimed jobs concurrently (each handler locks its own rows).
- Performance ran on the development laptop with a local database, not the 2 vCPU/4 GiB reference; the environment is recorded with the results instead of claiming comparability.
- Final review: lead review for the requester's shelter coordinator shows no clues and hides routed requests (the permission table limits clue reads to the destination task; the phase 04 step that says "sees supplied clues" was resolved toward the more restrictive rule). Cost if wrong: coordinators must ask the person or their worker for details.
- Final review: the block-versus-approval race is closed by the Block foreign-key lock on the subject's Person row rather than an explicit lock; a deterministic regression test guards it. Cost if wrong: a schema change that removes that FK would need an explicit `FOR UPDATE` in `blockRequester`.
- 2026-10-19: a wrong re-entered password (recovery-secret rotation, MFA enrollment, account deletion) returns 403 `REAUTH_FAILED`, and a rejected second factor returns 403 `MFA_REJECTED`, instead of 401. 401 now only means "no valid session", which the web client treats as signed out. Cost if wrong: API clients expecting 401 for these cases.
- 2026-10-19: zod `invalid_value` messages are passed through (they contain the schema's allowed values or a custom message, never user input); `unrecognized_keys` and `invalid_union` stay generic.
- 2026-10-19: place lists (shelters, areas) keep their select disabled with a "Loading the … list" status until options arrive, and show an alert with a retry button on failure. Cost if wrong: a keyboard user tabbing during the first ~100 ms skips the select once.
- 2026-10-19: hosting recommendation is Render (Docker web + worker, managed Postgres, pre-deploy migrations, Blueprint). Region Singapore was chosen as closest to the owner's timezone; change it if reviewers are elsewhere.
- 2026-10-19: the owner chose Render's free tier. Free web services have no shell, pre-deploy command or background worker, so `RUN_WORKER_IN_PROCESS=true` runs the outbox/retention loop inside the web process, and `scripts/start-free.mjs` applies migrations and the guarded fictional seed at each start. The paid two-process Blueprint moved to `deploy/render.paid.yaml`. Cost if wrong: a slow request and the worker share one 0.1-CPU process; delivery waits while the service sleeps.
- 2026-10-19: config accepts `RENDER_EXTERNAL_URL` when `APP_ORIGIN` is unset and a single `FIELD_ENCRYPTION_KEY` as key `v1`, so no secret has to be typed into the dashboard. An explicit `APP_ORIGIN` or `FIELD_ENCRYPTION_KEYS` still wins, and production still requires https.
- 2026-10-19: blank environment variables count as unset. Found by the free-start rehearsal: Prisma Client fills unset variables from a local `.env`, which overrode the Render origin fallback. A deployed `.env` would do the same, so `.env` stays out of Git and the Docker context.
- 2026-10-19 (Codex deployment review): startup seeding runs once per database (`prisma/seed.ts --once`, marked by SystemFlag `demo_fixtures_seeded`), and the fixture seed skips any fixture person who has a deletion or tombstone, so a restart or a manual reseed never recreates purged content. Cost if wrong: changing fixtures on an existing demo database needs a fresh database.
- 2026-10-19: deletion (self and assisted) purges content in the deletion transaction instead of waiting for the retention job. This meets the 24-hour purge rule on any host, including one that sleeps. The retention job still purges any tombstone recorded without a purge. Cost if wrong: a deletion request does slightly more work.
- 2026-10-19: demo-only retention exception on the Render free host: time-based retention windows run late while the service sleeps and are not claimed there (security spec §7, deployment.md, Help page, traceability DATA-02). Access denial never depends on the job.
- 2026-10-19: Node 24.22.0 (owner decision, latest 24.x LTS). Installed per user (no administrator rights); the system-wide Node stays 24.16.0 until the owner upgrades it. `engines` keeps `>=24.11 <25`. Cost if wrong: a contributor on the system Node runs a slightly older runtime locally.
- 2026-10-19: `body { overflow-wrap: break-word }` so long unbroken strings (setup links, codes, user text) wrap instead of forcing sideways scrolling. It does not change min-content sizing, so flex rows keep wrapping as before.
- 2026-10-19: secret-like fields have their own empty-field message (`secretInput('the contact code')` and so on) so an error names its field.
- 2026-10-19: real 200% zoom is set with `chrome.tabs.setZoom` from a throwaway local extension in a throwaway Chromium profile: the same page zoom as Ctrl+Plus, no viewport emulation or CSS zoom. Only Chromium was checked.
- 2026-10-19: first commit scope: `Full stack challenge.pdf` excluded locally pending publication permission; evidence curated (12 of 40 zoom screenshots, the rest under the git-ignored `evidence/tmp/`); home-directory paths replaced with `~` in committed logs.

## Manual-testing guidance handoff — 2026-10-19

- Agent/tool: Codex; user requested step-by-step manual tests and next steps after running the app locally, not implementation or publication.
- Added [manual testing guide](manual-testing-guide.md) with independent browser sessions, fresh fictional accounts/cases, exact UI flows and expected outcomes, API body/authorization checks, staff MFA/intake/assistance/matching/transfer, failure handling, accessibility, deletion, automated gates and deployment sequence.
- Read Claude's attached handoff, project specifications, current UI source, browser test source, script definitions and recorded review findings. The provided screenshot shows the home page rendering; it is not backend/security evidence.
- Acceptance IDs: guidance references existing catalog IDs; **no new application acceptance pass is claimed**. Manual results remain for the user to record.
- Commands actually run: `npm run docs:check` passed (22 Markdown files, 63 acceptance IDs); `Get-FileHash AGENTS.md,CLAUDE.md,agent.md -Algorithm SHA256` returned the same `f98c64a2c76dcd3a52d78911ef816729a08dae8956206e658310c8d6edc2f02f` for all three; `git diff --check` and `git diff --stat` produced no tracked changes. `git status --short` shows the project files are untracked, so Git diff does not cover their contents; the new guide was inspected directly and validated by docs:check. Git status emitted a permission warning for the global Git ignore file.
- No application test suite, manual browser scenario, benchmark, deployment, database mutation or publication was executed for this guidance task. Application source and instruction files were unchanged.
- Remaining concerns: the previously deferred privacy/concurrency findings still require release triage; the guide does not waive them. Hosting and public deployment remain outstanding.
- Next task: user executes and records the manual checklist; reproduce/fix reported defects and resolve release-blocking findings, run actual verification/performance, then proceed with phase 07 against a selected provider and repository.

## Browser testing handoff — 2026-10-19

- Agent/tool: Codex, in-app browser and existing Playwright test runner. User asked Codex to perform the browser tests instead of having to execute the long manual checklist.
- Scope: direct browser checks against the running `http://localhost:5173` app using three fresh fictional accounts, plus existing browser/accessibility suites against disposable PostgreSQL and the production build. Full detail and evidence: [browser test results](browser-test-results-2026-10-19.md).
- Direct results: signup, shelter directory/check-in, neutral requests, distinct message/area/shelter previews and authorized views, outsider denial, logout/Back, revoke-all cancellation and confirmation, and all three revoked URLs denied to their former recipient. Signed out at the end. Live future-date entry through in-app automation was inconclusive (input reverted), while the automated rejection test passed.
- Commands/results: first restricted `npm run test:e2e` failed during build on filesystem access. Approved retry built successfully. An accidentally overlapping accessibility run collided on port/report resources (20 E2E passed/1 artifact failure; 4 accessibility failures); excluded from acceptance evidence. Clean sequential `npm run test:e2e -- --no-build` exited 0, 21/21 passed, 2.1m. Clean `npm run test:a11y -- --no-build` exited 1, 3 passed/1 failed, 34.1s. `npm run test:a11y -- --no-build --grep "keyboard-only"` then exited 0, 1 passed, 2.7s, with no code changes.
- Open finding: keyboard journey at `tests/e2e/a11y.spec.ts:123` sometimes retains empty Shelter selection after ArrowDown. Public/individual/staff automated accessibility scans and error-focus check passed. A possible asynchronous-options readiness race is a hypothesis only. Do not call the full accessibility gate passed from the isolated retry.
- Source changes: none. Added result report and three direct browser screenshots; preserved the keyboard failure screenshot/context; updated traceability with the newer non-green UX-01 run. Browser suite refreshed its standard screenshots. Three `qa.*.mve5mfic` fictional accounts, two current-time reports, three requests and revoked grants remain in the local dev DB; no pre-existing accounts or staff MFA configuration changed.
- Acceptance IDs exercised are mapped in the report; not all requirements within each ID were manually checked. No new deployment, full verification, benchmark, data-lifecycle, transfer, password-recovery or manual screen-reader pass is claimed.
- Next task: diagnose/stabilize the keyboard journey without weakening behavior assertions, review previously deferred privacy/concurrency findings, run full release verification, then complete deployment. User need not repeat the already-covered browser walkthrough.

### Entry 10: keyboard flake, deferred findings, browser coverage, verification and deployment preparation

```text
Date/time and timezone: 2026-10-19, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Read first: progress.md, browser-test-results-2026-10-19.md, test-traceability.md, manual-testing-guide.md, specs.
1. Keyboard journey flake (tests/e2e/a11y.spec.ts:123): diagnosed from Codex's saved failure snapshot. At failure time
   the Shelter select held its options but "Choose a shelter" stayed selected: ArrowDown was pressed while the
   asynchronously loaded options were not yet present. Root cause: test timing, exposing an application gap (the
   select looked ready while empty; a failed load looked like an empty list). Deterministic reproduction:
   e2e checkins.spec.ts "place lists show a loading state ..." holds the /shelters response -> RED (select enabled
   with no options). Fix: components/PlaceSelect.tsx (disabled + role=status while loading, role=alert + retry on
   failure) used by check-in, request, lead and transfer forms; the keyboard test now waits for the select to be
   enabled (a real condition, no sleeps; the ArrowDown assertion is unchanged). Result: GREEN; keyboard journey
   15/15 with --repeat-each 15.
2. Deferred review findings: 9 failing tests written first (review-findings.test.ts 7, idempotent-limits.test.ts 2),
   all RED for the stated reasons (409 vs 200 oracle; 403 vs 409 secret oracle; silent first-membership intake;
   reassigned worker could propose; opted-out candidate could be proposed; duplicate assignment 500; closed-case purge
   left a request open; retries hit 429). Fixes in routing.ts, transfers.ts, cases.ts, retention.ts,
   idempotency.ts, requests.ts, contracts/people.ts, IntakePage.tsx. All 9 GREEN.
3. Manual-guide coverage: new tests/e2e/lifecycle.spec.ts (browser recovery, transfer, restricted referral +
   coordinator assignment + closure, self deletion, assisted deletion). First run found two application defects:
   (a) a wrong re-entered password returned 401, so the web client cleared the session and signed the person out;
   same for a rejected staff two-step code; (b) consent errors showed "Invalid value." instead of their message.
   Integration tests updated to the corrected contract first (RED), then fixed (403 REAUTH_FAILED / MFA_REJECTED;
   pass-through of schema value messages). Lifecycle spec 5/5 GREEN. Restore drill through the real operator CLI on
   disposable databases: npm run drill:restore -> 11/11 (scripts/restore-drill.mjs, evidence/drills/).
   NOT RUN (need a human or real time): screen-reader evaluation, 200% zoom, natural idle/assistance/grant expiry,
   stopping the real dev server mid-form, deployment checks.
4. npm run verify run 1 -> FAILED at test:e2e (24 passed, 3 failed): screenshot spec's heading pattern matched case-card
   badges "Verified for this visit" left by the new lifecycle tests (strict-mode violation). Evidence kept:
   evidence/verify-2026-10-19/verify-run1-failed.log and run1-screenshot-test-failure.png. Locators anchored/exact.
   npm run verify run 2 -> exit 0: docs:check, lint, typecheck, build, unit 21/21, integration 95/95, security 14/14,
   e2e 27/27, a11y 4/4; no skips (evidence/verify-2026-10-19/verify-run2.log). Browser and accessibility suites ran
   sequentially inside verify (they share port 3100 and report folders).
   npm run test:performance -> exit 0, 11/11 gates: 30,815 operations, p50 35.9 ms, p95 67.1 ms, 0% errors,
   0 unauthorized payloads; delivery p95 1,093 ms, 0 duplicates; login p95 50.7 ms; initial JS 95.9 KiB gzip; median
   LCP 1,180 ms; cold start 279 ms (evidence/performance/perf-summary.json, evidence/verify-2026-10-19/performance.log).
   Same laptop/local-database caveat as entry 7.
5. Docs: traceability rewritten with current evidence and a manual-guide coverage table; data-and-api.md section 7 and
   deployment.md updated; instruction files unchanged (parity checked by docs:check).
6. Deployment preparation: no Git commits, remote, gh CLI, hosting CLI or credentials exist. Provider research
   (official docs, 2026-10-19) recommends Render; render.yaml Blueprint written (not applied or CLI-validated).
   docker build from today's source -> exit 0; starting the image without configuration exits listing only variable
   names (APP_ORIGIN, DATABASE_URL, DIGEST_KEY, FIELD_ENCRYPTION_ACTIVE_KEY, FIELD_ENCRYPTION_KEYS).
Dev database: not reset or modified this session; staff MFA unchanged. All test databases were disposable and dropped.
Next concrete task: see "Next concrete task" above.
```

### Entry 11: Render free-tier preparation (owner's choice)

```text
Date/time and timezone: 2026-10-19, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Request: owner asked whether implementation is finished and chose Render's free deployment option if possible.
Render free-tier facts (official docs, 2026-10-19): no shell, one-off jobs, pre-deploy command or free background
  worker; web service sleeps after 15 min idle (~1 min wake); free Postgres expires 30 days after creation, 14-day
  grace, no backups; RENDER_EXTERNAL_URL set automatically; generateValue gives a base64 256-bit value.
Changes:
- config.ts: APP_ORIGIN falls back to RENDER_EXTERNAL_URL; FIELD_ENCRYPTION_KEY (one key) becomes v1;
  FIELD_ENCRYPTION_ACTIVE_KEY defaults to v1; RUN_WORKER_IN_PROCESS (default false); blank variables count as unset.
  Tests first: tests/unit/config.test.ts "Render free-tier configuration" (5 tests, RED then GREEN).
- server.ts: with RUN_WORKER_IN_PROCESS=true runs the outbox/retention loop in the web process; shutdown stops it
  before disconnecting Prisma.
- scripts/start-free.mjs (npm run start:free): migrate deploy, guarded fictional seed when SEED_ON_START=yes, start.
- scripts/free-tier-check.mjs (npm run check:free-start): local rehearsal on a disposable rf_test_free_* database.
- render.yaml is now the free Blueprint (one web service + free Postgres 17, all secrets generated); the paid
  two-process Blueprint moved to deploy/render.paid.yaml. Neither applied nor validated with the Render CLI.
- deployment.md rewritten for the free option; .env.example, README, traceability updated.
Commands/results:
- npm run check:free-start, run 1 -> 2/5 (403 CSRF_REJECTED): Prisma Client loaded the local .env APP_ORIGIN into
  the unset variable and overrode the RENDER_EXTERNAL_URL fallback. Fixed by the blank-is-unset rule (test first)
  and blank overrides in the check script. Run 2 -> 5/5: empty DB migrated, seed at start, smoke 14/14 including
  in-process worker delivery, restart persistence (14 accounts, no duplicates), sign-in after restart
  (evidence/drills/free-tier-check.json). Over http with NODE_ENV=test; not a deployment.
- npm run verify run 3 -> exit 0: docs:check, lint, typecheck, build, unit 26/26, integration 95/95, security 14/14,
  e2e 27/27, a11y 4/4; no skips (evidence/verify-2026-10-19/verify-run3.log).
- npm run test:performance not rerun: the in-process worker is off by default and the benchmark uses the separate
  worker; entry 10's results stand for that mode. Free-tier hardware (0.1 CPU) is far below the benchmark machine.
Limitations: free database expires after 30 days and has no backups (DATA-03 cannot be shown on the host); cold
  starts; Node 24.16.0 availability on Render unverified (fallback: NODE_VERSION=24); DEPLOY-01..04 not run.
Dev database: not reset or modified; staff MFA unchanged. Test databases were disposable and dropped.
Next concrete task: see "Next concrete task" above (owner: authorize first commit + public repo, apply Blueprint).
```

### Deployment configuration review — Codex, 2026-10-19

- Read entry 11, deployment Blueprints, start-free script, fixture seed, retention/deletion code, saved verification log and rehearsal evidence. `evidence/verify-2026-10-19/verify-run3.log` ends with every verification stage PASS and exit=0. This review did not rerun those tests or authorize a commit, public repository, deployment or spending.
- New code-level concern introduced by seed-on-every-start: `purgePerson` deletes check-ins and assistance credentials but retains the Person tombstone; `seedFixtures` unconditionally upserts fixture check-ins and assistance credentials with create branches and no deleted/purged-person guard. A restart can therefore recreate those purged fixture rows. This is a source finding, not a reproduced runtime test; it does not establish that ordinary API access to the deleted person is restored. Add delete/purge -> startup/reseed regression coverage, and make initialization one-time or explicitly tombstone-aware. Existing free-start rehearsal checks account count/sign-in, not this lifecycle case.
- Free in-process hosting stops retention work while sleeping. Thus the current unconditional within-24-hours content-purge promise cannot be guaranteed on that hosting mode. Immediate read denial and background content purge must remain distinct. Either provide a reliable scheduled/always-running mechanism or explicitly document the demo limitation consistently in UI/specs and acceptance status; do not call the original timing gate satisfied on this host.
- Confirmed Render's official free-instance documentation: sleep after 15 idle minutes, approximately one-minute wake, free Postgres inaccessible after 30 days and deleted after a further 14-day upgrade grace period, no free database backups. Blueprint remains unapplied. Render's validation and exact Node version compatibility still need verification.
- Next: resolve the startup-seed lifecycle issue and free-mode retention claims before release; then owner hosting/Git decisions and actual deployed acceptance checks. A 200% zoom inspection can be assisted by browser automation; human screen-reader usability review remains separate.

### Entry 12: Codex deployment review findings resolved; Blueprint and Node validation

```text
Date/time and timezone: 2026-10-19, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Read first: "Deployment configuration review — Codex, 2026-10-19" above.
1. Startup-seed lifecycle (Codex finding confirmed):
   RED, integration: tests/integration/seed-lifecycle.test.ts deletes seeded Leo (self) and Ana (verified worker),
   runs retention, re-runs seedFixtures -> recreated {leoCheckIns: 2, anaCheckIns: 1, anaCredentials: 1}.
   RED, end to end: free-tier-check extended (delete Leo and Ana through the real API incl. staff MFA, restart via
   start-free.mjs). With the earlier seed behaviour temporarily restored (files backed up, restored, SHA-256 checked):
   6/8, restart recreated the same rows (evidence/drills/free-tier-check-red-before-seed-fix.json). Ordinary API
   access was not restored (Leo still 401; Ana's case assignment had ended), only content rows.
   Fix: prisma/fixtures.ts skips any fixture person with deletedAt or a DeletionTombstone; every completed seed sets
   SystemFlag demo_fixtures_seeded; seedFixturesOnce + prisma/seed.ts --once skip a seeded database;
   scripts/start-free.mjs passes --once. No data reset. GREEN: seed-lifecycle 2/2, database.test.ts DB-01 extended;
   npm run check:free-start 8/8 (evidence/drills/free-tier-check.json).
2. Free-hosting retention: deletePerson now purges content inside the deletion transaction (tombstone purgedAt =
   deletedAt), so the 24-hour purge rule holds without the background job. Tests first: lifecycle.test.ts DATA-01
   asserts the purge with no retention run (RED: purgedAt null), plus a backstop test that retention purges a
   tombstone recorded without a purge. GREEN. Remaining time-based windows (request text, closed cases, 24 h
   credential artifacts, jobs, notifications, audit) can run late while the free service sleeps: documented as a
   demo-only exception in security-and-permissions.md §7, deployment.md, README, Help page and traceability
   (DATA-02 not claimed on that host). Access denial stays enforced on every read (sessions, grants, requests,
   assistance sessions, deletion), independent of the job. UI deletion text no longer says "within 24 hours"; it
   says content is deleted at the same time and that host backups keep older copies until they expire.
3. Blueprint and Node validation:
   Render JSON Schema (https://render.com/schema/render.yaml.json) with Ajv 8: render.yaml VALID,
   deploy/render.paid.yaml VALID; deliberately broken copy rejected. Render CLI v2.29.0 (official release,
   SHA-256 matched) `render blueprints validate render.yaml` -> not runnable: "no workspace specified and no default
   workspace set" (needs a Render account). node-version-alias 4.0.0 (Render's resolver) resolves 24.16.0 -> 24.16.0.
   nodejs.org index: security releases after 24.16.0 are 24.17.0 and 24.18.1; latest 24.x is 24.22.0. Pin NOT
   changed (owner decision). Pins equal in render.yaml, .nvmrc and Dockerfile. Tools ran from the scratchpad, not
   added to the project.
4. Commands/results: npm run lint -> exit 0; npm run typecheck -> exit 0; seed.ts type-checked with the tests config
   -> exit 0; npm run build -> exit 0; npm run check:free-start -> 8/8; npm run verify run 4 -> exit 0: docs:check,
   lint, typecheck, build, unit 26/26, integration 98/98, security 14/14, e2e 27/27, a11y 4/4, no skips
   (evidence/verify-2026-10-19/verify-run4.log). Browser and accessibility suites ran sequentially inside verify.
   npm run test:performance not rerun: its workload has no deletions, and the seed change only adds two reads and one
   flag write to its one-time setup.
Not done: no commit, repository, Render resources or deployment; DEPLOY-01..04 not run; screen reader and 200% zoom
  not run. Concurrent first starts of two instances could race the one-time seed (free tier runs one instance).
Dev database: not reset or modified; staff MFA unchanged. All rehearsal/test databases were disposable and dropped.
Next concrete task: see "Next concrete task" above (Node decision, commit/repository authorization, Blueprint).
```

### Entry 13: Node 24.22.0, performance in both modes, 200% browser zoom, screen-reader guide, first local commit

```text
Date/time and timezone: 2026-10-19, Asia/Shanghai
Agent/tool: Claude Code (claude-opus-5-5)
Read first: AGENTS.md, this file (entries 11-12, Codex deployment review); Git: no commits, unborn branch master.
1. Node upgrade (owner decision). nodejs.org index: 24.22.0 = LTS "Krypton", 2026-10-14, npm 11.19.1, not itself a
   security release but includes the 24.17.0 and 24.18.1 security releases. Release notes checked for behaviour
   changes (fs.cpSync errorOnExist, node:sqlite, http2, errors): this code uses none (cpSync only in test helpers,
   without errorOnExist). Official node-v24.22.0-win-x64.zip: SHA-256 matched SHASUMS256.txt; its signature verified
   ("Good signature", Richard Lau, C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C, listed in the nodejs/node README).
   Installed per user under %LOCALAPPDATA%\Programs\node-v24.22.0-win-x64 (no administrator rights); the system Node
   in Program Files is still 24.16.0. Pins: .nvmrc, Dockerfile (both stages, node:24.22.0-bookworm-slim, tag exists
   for amd64/arm64), render.yaml NODE_VERSION, package.json packageManager npm@11.19.1. Lockfile and dependencies
   unchanged. node-version-alias resolves 24.22.0 exactly; both Blueprints still valid against Render's schema.
2. Results on 24.22.0 (node --version v24.22.0 recorded at the top of each log):
   final verify run 6 -> exit 0: docs:check, lint, typecheck, build, unit 26/26, integration 99/99,
   security 14/14, e2e 27/27, a11y 5/5, no skips (evidence/verify-2026-10-19/verify-run6-final-node24.22.0.log).
   Verify run 5 (24.22.0, before this entry's code changes) also exit 0 (98 integration, 4 a11y).
   npm run test:performance -> 11/11 gates: 29,939 ops, p50 36.8 ms, p95 68.0 ms, 0% errors, 0 unauthorized
   payloads; delivery p95 1,057 ms, 0 duplicates; login p95 52.8 ms; JS 95.9 KiB; median LCP 1,216 ms; cold 279 ms.
   npm run test:performance -- --single-process (new option: scripts/start-free.mjs as a separate production
   process with the in-process worker) -> 11/11 gates: 34,473 ops, p50 32.0 ms, p95 61.6 ms, 0% errors, 0
   unauthorized; delivery p95 1,082 ms, 0 duplicates; login p95 48.5 ms; LCP 1,200 ms; cold start to ready 1,332 ms.
   Both are local laptop results (local Docker PostgreSQL); the Render free tier (0.1 CPU) was not measured.
   npm run drill:restore -> 11/11. npm run check:free-start -> 8/8. Docker image on node:24.22.0-bookworm-slim:
   build OK, node v24.22.0 / npm 11.19.1 inside; on a disposable rf_test_docker_* database: migrate deploy, seed
   refused without SEED_CONFIRM_FICTIONAL, --once seeded then skipped, retention ran, production container ready with
   RUN_WORKER_IN_PROCESS=true, HSTS and CSP present; database dropped.
3. 200% browser zoom (WCAG 1.4.4/1.4.10), scripts/zoom-audit.mjs (npm run audit:zoom): Chromium page zoom set with
   chrome.tabs.setZoom(tab, 2) from a throwaway local extension in a throwaway profile (the same zoom as Ctrl+Plus;
   no viewport emulation, no CSS zoom). Playwright-managed Chromium 156.0.8078.4 (new headless), Windows 11, window
   1280x800: CSS viewport 1264 -> 632 px, devicePixelRatio 1 -> 2. 40 views: public pages, sign-in/sign-up/recover
   errors, 404, dashboard, privacy/contact code, check-ins with errors, find someone with errors, incoming request,
   block dialog, disclosure choice and preview, confirmation, sharing, revoke-all dialog, response view,
   notifications, revoked share, account deletion form, staff two-step (error, setup, recovery codes), staff home,
   intake with errors, case verification with error, case workspace, deletion confirmation. Checks per view:
   horizontal scrolling, controls outside the viewport, clipped content, overlapping or covered controls, skip link
   visible on focus, then a person reviewed the screenshots. Zoom restored to 100% afterwards.
   Defects found and fixed (tests first):
   (a) staff two-step setup: the one-line otpauth link scrolled the page sideways (228 px at 200%, 474 px at 390 px).
       a11y.spec "UX-02 ... setup reflows at 390 px" RED (474) -> body overflow-wrap: break-word -> GREEN.
   (b) field errors: an empty contact code said "Enter the secret." next to "Contact code" (same for recovery and
       assistance secrets). field-errors.test.ts RED -> contracts secretInput('the contact code') etc. -> GREEN.
   Audit-tool problems fixed along the way (not product defects): Playwright full-page capture ignores page zoom
   (now Chromium capture sized from the zoomed layout); the app's CSP blocked the injected masking style, so one
   screenshot showed a throwaway two-step key of a fictional account in an already dropped database - deleted before
   any commit; masking now uses CSSOM and refuses to capture if a secret is unmasked; capture waits for errors and a
   stable layout.
4. Screen reader: docs/screen-reader-walkthrough.md (12 steps with expected announcements and an observation table).
   PENDING the owner's listening session; not marked passed from automated tests.
5. Disclosure: entry 8's container check (2026-10-18, tmp/docker-check.sh, git-ignored) pointed at the development
   database rf_dev: migrate deploy (no pending migrations), the idempotent seed and one retention run ran there. That
   was not a reset, but the retention run applied the time-based policy to whatever development data was due at that
   moment. Today's container check used a disposable rf_test_docker_* database and dropped it.
6. Git: branch renamed (unborn master -> main); Full stack challenge.pdf excluded through .git/info/exclude (local
   only); staged files reviewed for secrets, credentials, dumps, personal data and home paths; first local commit
   created on main (its ID is in `git log`; no remote, nothing pushed).
Dev database: not reset or modified this session; staff MFA unchanged. All test databases disposable and dropped.
```

### Entry 14: Partial human screen-reader observations (2026-10-19)

Recorded the tester's step 1 OK and step 2 skip-link usability concern in docs/screen-reader-walkthrough.md. Reproduced Enter on the focused skip link in the visible localhost in-app browser: accessibility state reported focus on main and URL #main. Saved evidence/screen-reader/step-02-main-focus.jpg. Step 2 spoken feedback is unconfirmed; steps 3–12 remain pending and UX-01 is not newly claimed complete. No application code or database changes; no suites rerun for this documentation-only update.

Follow-up, same date: progressed through step 12 with the owner's listening confirmations, recorded individually in the walkthrough. Created fictional Alex Demo and Jamie Demo accounts in the development database, used one Hillcrest check-in, sent a request, shared its approximate area for 24 hours, cancelled revoke-all, revoked the individual share, and signed out. No database reset or staff MFA change. Saved screenshots under evidence/screen-reader; no credentials included in report screenshots. Step 12 Back behavior is human-reported. Still unconfirmed: step 2 spoken focus transition, brief shelter-loading speech, automatic request-success announcement, and screen-reader name/version. UX-01 is not claimed unconditionally complete. No application code changes or automated-suite reruns; documentation diff checked and instruction-file hashes compared.

### Entry 15: shelter flows without devices, staff provisioning, result-screen focus (2026-10-19)

```text
Agent/tool: Claude Code (claude-opus-5-5), Node 24.22.0
Request: owner asked how people without devices send and receive requests, how shelters get staff accounts, and
  noted these were not tested; approved (1) step-8 focus fix, (2) missing tests, (3) a guided shelter walkthrough
  (most important).
1. Staff provisioning: tests/integration/staff-provision.test.ts runs the real `scripts/staff-admin.ts provision`
   against a disposable database: refuses without --confirm, unknown account and missing shelter; grants WORKER;
   old session ends (401); staff tools answer 403 MFA_REQUIRED until two-step setup; /staff/me then lists Riverside.
   RED on duplicate grant (raw Prisma error text) -> staffAdmin.ts maps P2002 to "This account already has this
   active staff role." -> GREEN.
2. Contact code issued at intake (no previous test): tests/integration/intake-contact-code.test.ts - family use the
   paper code, the request waits until a verified visit, the worker records the person's answer, the requester sees
   "Response available"; a restricted referral asking for a code is refused (422, field error) and creates nothing.
   Both passed first time (no defect).
3. Two people without devices at two shelters, browser: tests/e2e/shelter-walkthrough.spec.ts (worker.a, worker.b,
   coord.b in separate contexts): intake of both people, paper contact code request and answer, then a no-code request
   assigned by coord.b, proposed by worker.b, answered at Tomas's verified visit; before the answer Rosa's side shows
   only "No response available yet" and not Tomas's name. Passed first time.
4. Result-screen focus (walkthrough step 8): a11y.spec "result screens that replace a form move focus to their
   heading" (individual: sign-up, request saved, password changed; staff: recovery codes, intake saved) RED
   (heading inactive) -> forms.tsx ResultHeading (focus on mount, tabIndex -1) on the five screens -> GREEN.
5. docs/shelter-walkthrough.md written from the passing browser test (parts B-D) and the provisioning test (part A).
   Screen-reader record: Codex's entry 14 and the owner's observations kept; follow-up section added (re-listen
   steps 5 and 8).
6. npm run verify run 7 -> exit 0: docs, lint, typecheck, build, unit 26/26, integration 102/102, security 14/14,
   e2e 28/28, a11y 7/7, no skips (evidence/verify-2026-10-19/verify-run7-node24.22.0.log, home path redacted).
Committed in the second local commit on the owner's instruction (2026-10-19): these changes, entry 14's record and the nine
  screenshots in evidence/screen-reader/ (two reviewed at first; all nine reviewed before the
  second commit: fictional accounts only, no secrets).
Dev database: not reset or modified by the agent this entry; staff MFA unchanged. Test databases disposable.
```

### Entry 16: live-site testing, README and deliverables, user manual (2026-10-19)

```text
Agent/tool: Claude Code (claude-opus-5-5), Node 24.22.0
Live site: https://reconnect-web.onrender.com (Render free, Singapore), repository COMPRyanLI/Reuniting-Separated-Families,
  deployed revision 7036fb2.
1. Transport and headers (curl): health live/ready 200; HSTS, CSP, X-Frame-Options, Referrer-Policy no-referrer,
   Permissions-Policy, COOP/CORP, no X-Powered-By; HTTP 301 to HTTPS; deep link served by the app; API 404 envelope.
2. npm run smoke:deployed against the live URL -> 15/15 (evidence/hosted-2026-10-19/smoke-deployed.log).
3. New live browser suite tests/hosted/hosted.spec.ts + playwright.hosted.config.ts (npm run test:hosted, HOSTED_URL):
   first run 2/8 + 1 failed: the script used the shelter label "Hillcrest School Gym" but options read "Hillcrest
   School Gym (Hillcrest)" (script defect). Its two fictional accounts were deleted through the API (204, then 401).
   Added a real foreign-origin refusal check. Final run 8/8 (hosted-browser.log): public pages + axe (no serious
   findings), private API closed, no source maps, same sign-in error for unknown user and wrong password, two people
   and an outsider (check-in, contact code, "Enter the contact code.", focused "Request saved" = latest build,
   area-only preview without address, answer, outsider 404, revoke), CSRF token and foreign Origin refused, staff API
   403 for a person, sign-out + Back shows nothing and the old session is 401, recovery with the recovery secret,
   eight signed-in pages at 390 px without horizontal scroll and without serious axe findings, every test account
   deleted (sign-in then 401).
4. Restart persistence: marker account + check-in created, no live traffic for 18 minutes; first request 32,570 ms
   (woke from sleep), next 304 ms; marker signed in and its check-in was present (restart-persistence.json). Marker
   deleted afterwards (204, sign-in 401) and its local credentials file removed.
5. Clean clone of the public repository into a temporary folder (7036fb2, no .env): npm ci, docs:check, lint,
   typecheck, build, unit 26/26, integration 102/102, security 14/14, all exit 0.
6. Not run on the live site: staff-assisted flows (need SEED_PASSWORD; not to be shared in chat), load testing (not
   appropriate on a shared free instance). Open: whether TRUST_PROXY=1 yields each visitor's own IP behind Cloudflare
   (per-IP limits); Render's guidance reads X-Forwarded-For but does not state the hop count.
7. Deliverables: README rewritten around the brief (overview with live link and screenshots, full picture, design,
   technical choices and biggest tradeoff, testing evidence, local setup, limitations, AI use); new
   docs/design-and-tradeoffs.md; deployment.md and traceability updated (DEPLOY-01 evidence, DEPLOY-02 partial,
   DEPLOY-03 and -04 evidence). User manual: docs/manual/user-manual.html with 22 screenshots from a local disposable
   database (scripts/manual-screenshots.mjs, secrets masked, capture refused if a mask fails), printed to
   docs/Reconnect-user-manual.pdf (19 pages) by scripts/build-manual.mjs; pages reviewed as images.
Dev database: not used. Live data: only fictional accounts, all deleted after the checks.
```

### Entry 17: GitHub CI run #3 failure fixed (2026-10-19)

```text
Agent/tool: Claude Code (claude-opus-5-5)
Symptom: GitHub Actions run #3 (commit e408458, README-only) failed in test:e2e: FLOW-01/PRIV-04 at
  flows.spec.ts:48, "strict mode violation: getByText('Response available') resolved to 2 elements": the Outgoing
  page's explanation ("No response available yet" is all we can say...) and the status badge. Runs #1, #2 and two
  local full runs passed.
Cause (test defect): getByText with a plain string matches a case-insensitive substring. Before the request list
  loaded, the locator matched only the explanation paragraph, so the check passed without the badge (a latent false
  positive); when the list loaded first, both matched and strict mode failed every retry until the 20 s timeout.
Fix: status-badge locators are exact ('Response available', 'Answered', 'Revoked') in tests/e2e/flows.spec.ts,
  tests/hosted/hosted.spec.ts, scripts/zoom-audit.mjs and scripts/manual-screenshots.mjs. FLOW-01 gained a check
  before the answer: the requester sees exactly "No response available yet" and no "Response available" badge.
  No assertion was relaxed.
Diagnostics: playwright.config.ts adds the 'github' reporter on GitHub Actions, so failures appear as annotations
  (readable through the public API without signing in).
Live suite: a rerun first failed because the free service was asleep and Render served its "Service waking up"
  interstitial to the browser for longer than 20 s. tests/hosted/hosted.spec.ts now wakes the site (polls
  /api/health/ready up to 230 s) before browser checks. README and manual now describe that waking page.
Results: npm run test:e2e -> 28/28 (4.3m); test:hosted -> 8/8 (hosted-browser-rerun.log); lint and typecheck exit 0;
  manual PDF rebuilt.
```

