# Phase 01: database, authentication, and authorization foundation

Depends on: 00. Gate: DB-01 through DB-03; AUTH-01 through AUTH-06.

## Deliverables

Versioned PostgreSQL schema, deterministic fictional fixtures, account/person separation, usable signup/login/logout/recovery, staff MFA, and authorization helpers backed by real integration tests.

## Implementation steps

1. Add PostgreSQL local setup: Docker Compose when available plus a documented external `DATABASE_URL` alternative. Use a separately named disposable test database; require explicit test mode for reset utilities. Never default tests to a deployment database.
2. Implement core tables from the data contract: accounts/sessions/recovery/MFA, persons/contact codes/assistance credentials, incidents/areas/shelters, memberships/cases/assignments, and audit events. Later workflow tables can arrive with their phases. Add ownership foreign keys, uniqueness and cross-field constraints through migrations.
3. Seed fictional Maya, Leo, Noor, outsider Evan, workers W-A/W-B/W-A2, coordinators C-A/C-B, operator O, assisted person Sam, and restricted referral R. Seed two shelters and a second incident boundary. Generate environment-local secrets; never commit usable deployment credentials.
4. Implement central authentication and action-policy interfaces. Read ownership from session/account relations, not submitted account IDs. Include revoked membership checks from the start. Add explicit safe serializers and standardized non-enumerating errors.
5. Implement registration with unique normalized username, password, and alias. No phone, email, legal ID, or browser location required. Atomic account/person creation; no user-selected staff role.
6. Implement Argon2id verification, generic login errors, session rotation/expiry/revocation, cookie flags, CSRF/origin validation, and rate limits. Use an injectable clock for tests. Polling must not keep sessions alive forever.
7. Implement one-time personal recovery secret issuance/rotation and recovery flow. A successful recovery consumes the secret, changes the password, and invalidates prior sessions atomically. Never accept contact codes or case references for recovery.
8. Implement staff provisioning/suspension via a guarded operator CLI and TOTP enrollment/verification using established libraries. Require completed MFA before any staff endpoint. Include single-use recovery codes and replay protection.
9. Build functional signup/login/recovery pages, own basic profile view, logout button, and session-expiry routing. Clear private client state on account changes.
10. Establish unit, real-PostgreSQL API integration, and Playwright tests with isolated fixtures and browser contexts. Introduce only real tests; missing test suites fail clearly instead of returning success.

## Verification

- Migrate a blank test DB; seed twice; confirm stable counts and foreign-key enforcement.
- Register without personal identifiers, restart app, and log in to the persisted account. Verify seeded case/person relations persist too; check-in persistence is added when phase 02 introduces that table.
- Attempt public role injection, duplicate normalization variants, cross-person reads, expired sessions, and recovery replay.
- Verify old sessions fail after logout/recovery/suspension and old MFA time-step replay fails.
- Run unit/integration/E2E suites plus foundation checks. Capture DB assertions without printing credentials.

## Exit evidence

Record migration names, fixture strategy, auth test IDs, actual cookie/expiry behavior, and unresolved hosting dependencies. Do not describe authentication as verified real-world identity.
