# Project instructions

## Purpose and current state

Build a small, deployed family-reunification website for the hurricane scenario in `Full stack challenge.pdf`. Prioritize people without phones or identity documents, private participation, and shelter-assisted use. This is a challenge prototype, not an operational emergency service.

The repository currently contains planning documents, not an implemented application. Proposed commands and paths become real only when the corresponding implementation phase creates them. Do not claim a feature, test, security property, deployment, or performance target is complete without evidence.

`AGENTS.md`, `CLAUDE.md`, and `agent.md` must remain byte-for-byte identical. `AGENTS.md` is the Codex entry point; `CLAUDE.md` is the Claude Code entry point; `agent.md` is the requested compatibility copy. Edit all three together.

## Read before working

1. Read `docs/progress.md` for actual implementation status and handoff evidence.
2. Read `design.md` and `docs/implementation-plan.md`.
3. For the current task, read its phase file under `docs/implementation/`.
4. Before data, API, or permission work, read `docs/data-and-api.md` and `docs/security-and-permissions.md`.
5. Use the stable test IDs in `docs/acceptance-tests.md` to establish completion.

The user's current instructions take precedence over these project preferences. If documents conflict, preserve the more restrictive privacy behavior while resolving and documenting the conflict; never silently broaden access. Implementation details may evolve, but record material scope or trust-boundary changes in `docs/progress.md` and update affected specifications.

## Non-negotiable product rules

- No continuous GPS tracking, public people directory, public missing-person feed, or automatic family-group access.
- No mandatory legal name, phone, email, government ID, or personal device. Use an alias; distinguish an account from a person receiving assistance.
- Login proves account control, not identity, relationship, guardianship, or permission to view someone else.
- Location is a historical check-in with an observation time and source, never an implied current position or proof of safety.
- Sharing is directional, per recipient, and limited to a specific response/check-in. It does not include future check-ins.
- Safety-message-only, approximate-area, and named-shelter disclosures are distinct. Do not return precise fields for a less precise grant.
- Request delivery and matching do not reveal whether the recipient exists, was found, read the request, declined it, or blocked the requester.
- Contact codes route requests; case references identify records; neither is a login or recovery credential.
- Staff act as themselves on an assigned case and record the person's expressed decision. They do not impersonate the person or approve disclosure merely because someone claims to be family.
- No automatic child/guardian reunification, automatic identity verification, automatic record merges, or real-world safeguarding claims. Restricted referrals are the prototype boundary.
- Use fictional fixtures and a conspicuous demo label. Do not put real survivor data into development, screenshots, prompts, telemetry, or the public demonstration.

## Implementation approach

Default stack: TypeScript; React with Vite; Node.js with Express; PostgreSQL with Prisma migrations; Zod validation; Vitest/API integration tests; Playwright browser tests. Use one backend and one database, a database-backed outbox, and same-origin deployment. Do not introduce microservices, Redis, an LLM API, external identity matching, or map vendors for the initial scope.

Select compatible supported versions at phase 00 and pin them in the lockfile and runtime configuration. Follow official documentation for those versions. A different stack requires a documented reason, not an unannounced rewrite.

Keep route handlers thin: authenticate, validate, authorize, call a transactional domain service, serialize an explicit allowlist of response fields. Scope database queries to authorized records. The client never decides its own staff role, subject, recipient, consent, or permission scope.

## Security and data handling

- Deny by default; authorize every object read/write, list, count, export, notification, and background task.
- Never rely on hidden buttons, random IDs, a contact code, or a client-supplied role as authorization.
- Use established password hashing and cryptography libraries. Use server-side sessions in secure HTTP-only cookies; do not store tokens or sensitive person data in localStorage.
- Check CSRF/origin for state-changing cookie-authenticated requests. Use strict input validation and parameterized queries.
- Do not log request bodies, cookies, credentials, matching clues, locations, or message text. Audit identifiers and action metadata only.
- Recheck sharing grants on retrieval. Revocation prevents later reads; do not promise to erase information already copied by a recipient.
- Keep secrets out of source control, browser bundles, test reports, and command output. Use `.env.example` with placeholders only.
- Use short staff-assisted sessions and clear shared-device logout behavior. Cached private data must be cleared on logout or account switching.
- Use transactions, uniqueness constraints, idempotency keys, and version checks for critical transitions; do not resolve conflicts by silently overwriting consent.
- Database encryption, backups, privileged operators, retention, and restore behavior must be documented honestly. No claim of end-to-end encryption or absolute security.

## Verification and handoffs

- Work within the user's requested scope. A request to write plans is not a request to implement or publish the app.
- Complete dependent phases in order; do not mark a phase complete with placeholders, skipped required tests, mocked persistence, or a frontend-only permission check.
- Add meaningful behavior and negative-authorization tests for sensitive features. Do not add tests that merely restate configuration or markup.
- Test with real disposable PostgreSQL for integration tests, not an SQLite substitute or mocked ORM.
- Use isolated browser contexts for different people and staff. Test actual API response bodies, not only visible UI.
- Proposed root scripts are listed in `docs/implementation-plan.md`; phase 00 must create them. Do not report nonexistent scripts as passing.
- For each completed task, update `docs/progress.md`: changes, acceptance IDs, exact commands and results, limitations, and next task. Record failures and unavailable services explicitly.
- Before handoff, inspect `git diff`, verify instruction-file parity, and report what changed, what was actually tested, and what remains.
- Preserve user work. Never reset a shared database, delete user files, rewrite Git history, or publish secrets to make a test pass.
- The user may alternate Claude Code and Codex. Read the handoff log first and avoid duplicate implementation. Do not assume another agent's unverified completion claim is evidence.

## Definition of done

A phase is complete only when its deliverables exist, its named acceptance tests pass, earlier relevant tests still pass, and the handoff log contains reproducible evidence. A deployed submission is complete only after its public URL works in a private browser session, its required security tests pass, and its README includes the full-picture explanation, tradeoffs, screenshots, setup, and AI-use notes.
