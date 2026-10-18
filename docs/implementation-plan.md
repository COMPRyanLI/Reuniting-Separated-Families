# Implementation plan and phase gates

Status: phases 00–06 implemented locally (2026-10-18); phase 07 deployment blocked on hosting access. See [progress](progress.md) for evidence, not this document's checklists.

## Execution order

| Phase | Deliverable | Depends on | Completion gate |
| --- | --- | --- | --- |
| [00 Foundation](implementation/00-foundation.md) | Runnable frontend/API, tooling, CI skeleton, early deployment shape | Planning files | FND-01 through FND-04 |
| [01 Data and authentication](implementation/01-data-and-auth.md) | PostgreSQL migrations, fixtures, signup/login/recovery/staff MFA | 00 | DB-01 through DB-03; AUTH-01 through AUTH-06 |
| [02 People and check-ins](implementation/02-people-and-checkins.md) | Own privacy/check-ins and assigned assisted intake | 01 | CHECK-01 through CHECK-04; STAFF-01 through STAFF-03 |
| [03 Private requests and disclosure](implementation/03-requests-and-sharing.md) | Code routing, responses, grants, expiry, revocation, blocking | 02 | FLOW-01 through FLOW-04; PRIV-01 through PRIV-07 |
| [04 Shelter interactions](implementation/04-shelter-interactions.md) | No-code routing, assisted responses, transfer, outbox retries | 03 | FLOW-05 through FLOW-06; PRIV-08; STAFF-04 through STAFF-08; REL-01 through REL-04 |
| [05 Complete website experience](implementation/05-website-experience.md) | Accessible responsive pages, shared-device behavior, clear failures | 04 | UX-01 through UX-05; repeat browser user stories |
| [06 Hardening and benchmarks](implementation/06-hardening-and-benchmarks.md) | Retention/deletion, security regression, measured performance | 05 | SEC-01 through SEC-04; DATA-01 through DATA-04; PERF-01 through PERF-03; all previous gates |
| [07 Deployment and submission](implementation/07-deployment-and-submission.md) | Working public demo, private-browser validation, README evidence | 06 | DEPLOY-01 through DEPLOY-04 and full verification |

Implement small vertical slices inside each phase: database constraint, domain service, API authorization, page, behavior test. Do not postpone all authorization until phase 06; phase 06 verifies and hardens already protected features.

The phase order is an execution dependency, not a claim that each phase takes one day. Do not estimate completion by counting checkboxes. Privacy/security gates are required; maps, animations, live chat, and additional integrations are optional and excluded from this plan.

## Root command contract to create

These commands are **planned interfaces**, not currently available scripts. Use cross-platform Node scripts rather than shell-specific command chains. Pin a compatible Node LTS and npm version at phase 00 and record exact versions.

| Command | Introduced | Required behavior |
| --- | --- | --- |
| `npm ci` | 00 | Reproducible lockfile installation |
| `npm run dev` | 00 | Start web/API; report actual URLs; graceful shutdown |
| `npm run lint` | 00 | ESLint or equivalent, zero errors |
| `npm run typecheck` | 00 | TypeScript strict checks across workspace |
| `npm run build` | 00 | Production web/API build; fail on errors |
| `npm run start` | 00 | Serve production API and built web at one origin |
| `npm run docs:check` | 00 | Instruction parity, local Markdown links, unique acceptance definitions, phase-to-test references |
| `npm run db:migrate` | 01 | Apply committed migrations to selected DB; no reset |
| `npm run db:seed` | 01 | Idempotent fictional fixture seed; refuse real-data environment |
| `npm run test:unit` | 01 | Pure behavior/validation/serialization tests; no false success with zero tests |
| `npm run test:integration` | 01 | Real disposable PostgreSQL/API tests with isolation |
| `npm run test:e2e` | 01 | Playwright against a real app/API/DB with separate browser contexts |
| `npm run test:security` | 03 | Explicit authorization/field-leak cases; catalog coverage expands with phases |
| `npm run worker` | 03 | Database outbox processor with graceful shutdown |
| `npm run test:a11y` | 05 | Automated accessibility checks on required pages; manual checks recorded separately |
| `npm run test:performance` | 06 | Reproducible dataset and load run; produce metrics and exit nonzero on gate failure |
| `npm run verify` | 06 | Docs, lint, types, build, unit, integration, security, E2E, accessibility; no silent skips |
| `npm run smoke:deployed` | 07 | Safe checks against explicit deployed URL and fictional test accounts |

By phase 07, add `docs/test-traceability.md` mapping every acceptance ID to test paths/cases or manual evidence. A test suite passing is insufficient if a required acceptance ID has no implemented test. Performance and deployed smoke run separately from `verify` because they require explicit environment targeting; their evidence is mandatory for release.

## Shared definition of done

1. Required functionality works through the frontend, backend, and real database.
2. Positive and denied-access cases pass, including direct API calls.
3. Data persists across application restart where expected.
4. Pending/error/expired/empty states are visible and accurate; no optimistic false success.
5. Fixtures contain no real personal data; secrets and private payloads do not enter logs.
6. Relevant tests from previous phases still pass.
7. `docs/progress.md` records exact commands, results, test IDs, implementation decisions, and remaining limits.

If dependencies such as PostgreSQL, browser binaries, deployment credentials, or a host are unavailable, record what could not run. Do not substitute mocked results or call the unavailable gate passed. Continue independent authorized work. Do not repeatedly request approval for routine local implementation already authorized by the user.

## Working across Claude Code and Codex

Start from `docs/progress.md`, inspect current files and Git status, and read the current phase specification. Record actual completed steps rather than creating a second architecture. Keep the instruction copies identical. Use targeted changes, preserve user edits, and leave the next concrete task in the handoff.

No agent should broaden staff access, relax a security assertion, add a fake success path, or skip a migration solely to make a demonstration pass. If a specification is infeasible or ambiguous, explain the concrete issue and update the plan with the smallest justified change before relying on it.
