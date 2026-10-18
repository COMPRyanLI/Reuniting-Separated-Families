# Permission and security specification

Status: required design behavior. Acceptance IDs refer to [the test catalog](acceptance-tests.md).

## 1. Authorization model

An access decision combines account/session validity, incident membership where relevant, ownership, active case/task assignment, the person's request preferences, resource state, and an unexpired/unrevoked grant. Role labels alone do not authorize person-data access.

Use a central policy service with actions such as `person.readOwn`, `case.readAssigned`, `matching.readMinimal`, `checkin.create`, `request.respond`, `response.read`, `grant.revoke`, and `case.transfer`. Repositories accept the authorized scope; serializers allowlist output fields. No global `isStaff => allow` or `isAdmin => allow` shortcut.

| Resource/action | Individual | Assigned worker | Coordinator | Operator |
| --- | --- | --- | --- | --- |
| Read/edit own alias/preferences | Own record | Only case-required fields with assisted authority | Only with separate case assignment | No default access |
| Create check-in | Own person | Assigned person with recorded intake authority | Same rules as worker | No |
| Read full check-in | Own person | Assigned case if needed for assistance | Separate case assignment required | No |
| Read another person's disclosed report | Active grant naming viewer's person | Active requester case + grant naming assisted requester + verified assistance session | Same rules | No |
| Submit request | Own person | Assigned person with authority to relay their introduction/clues | Same rules | No |
| Approve disclosure | Target person | Active target case + person verification + recorded exact decision | Same rules | No |
| See local minimal matching fields | No | Active routed matching task; opted-in active local cases only | Only if assigned that task | No |
| Read incoming route clues | No, unless request participant | Assigned route task only | Destination coordination task only | No |
| Assign/transfer case | No; can express consent | Propose transfer only | Within own shelter scope and required consent | No person-data shortcut |
| Provision staff | No | No | Assign existing approved staff within own shelter; cannot self-elevate | Explicit operator command |
| Read security audit metadata | Own sharing history only | Own case actions where needed | Scoped operational events | Redacted operational metadata |

Coordinators can access minimal case index metadata for work allocation, not complete person records. A coordinator may separately hold a worker assignment; evaluate each authority explicitly. Missing or expired scope always denies access.

## 2. Disclosure schemas

`SAFETY_MESSAGE`: response ID, deliberately shared display alias, approved message, response time, expiry.

`AREA`: the above plus approved area label, observation time/timezone representation, source category (`self_report` or `staff_recorded`), and historical/currentness warning.

`SHELTER`: the above plus approved shelter display name and public address. No staff identity, internal shelter/person/case IDs, previous locations, or transfer destination.

These are independent response schemas. Test the complete JSON body, not just a list of fields hidden in the UI. An area serializer must not spread a check-in object and then delete a few fields. A grant to an assisted person is readable only through currently authorized assistance, not by everyone working at that shelter.

## 3. Response/error contract

- Unauthenticated protected request: `401` with a generic authentication error.
- Authenticated but nonexistent or unauthorized protected object: identical `404 { error: { code: 'NOT_FOUND' } }` envelope.
- Authenticated action denied on a resource the actor already legitimately sees: `403` without another person's details.
- Invalid input: `422` with field errors that do not contain submitted secrets.
- Version/idempotency conflict: `409` with instructions to refresh/retry, no hidden record values.
- Rate limit: `429` with `Retry-After`; no target-existence information.
- Contact-code submission: `202 { status: 'submitted' }` for all well-formed target outcomes. Return only requester-owned request ID if required, consistently in every outcome.

Search-style submission is not a profile lookup. Internal status, destination staff/shelter, candidate IDs/counts, receipt timestamps, and read/decline/block outcomes never appear in requester DTOs. Owner-controlled withdrawal may be shown. Do not vary target-sensitive error strings or expose global totals.

## 4. Authentication and shared devices

Use a mature Argon2id implementation. Baseline parameters: memory at least 19 MiB, iterations at least 2, parallelism 1; benchmark on the deployment environment and strengthen if practical. Allow long passphrases; do not truncate; set documented input limits and reject oversized bodies before expensive hashing. Use the same generic login error for unknown username and wrong password; perform a dummy verification for unknown users.

Create random opaque server-side session tokens; persist a digest, not the raw token. Cookie: `HttpOnly`, `Secure` in HTTPS deployment, `SameSite=Lax`, host-only, path `/`; use a `__Host-` name in production. Rotate after login and privilege change; invalidate on logout/password recovery/suspension. No remember-me on shared devices. Check session/account revocation in the backend on every request.

Prototype defaults: individual session 30-minute idle / 12-hour absolute lifetime; staff 15-minute idle / 8-hour absolute lifetime; person-verification assistance session 10 minutes. Background polling must not extend user inactivity indefinitely. These are configurable product choices. Clear client query caches on logout, role/account switch, and session expiry. Private API responses use `Cache-Control: no-store`; do not cache them in a service worker.

Require TOTP second-factor enrollment for staff/coordinator/operator accounts before privileged access. Use a vetted library; protect its secret with the application encryption key; hash single-use recovery codes; reject reuse and replay in the same time window. Personal accounts do not require a phone. Staff enrollment/recovery is an organizational dependency, not a workaround that grants person access.

Recover personal accounts using a high-entropy, single-use recovery secret displayed once and stored as a digest. Recovery rotates credentials and revokes existing sessions. No reset using alias, birth date, case reference, contact code, or a relative's claim. Losing all recovery evidence leads to manual escalation, not automatic disclosure. Staff-assisted person records use a different assistance secret; it does not log in or grant another person's records.

## 5. Abuse and application security

- Use Origin validation and CSRF tokens for state-changing browser requests; no wildcard credentialed CORS. Reject state changes via GET.
- Parameterize queries; reject unknown mutation fields such as role, owner, subject account, status, and scope outside the relevant schema.
- Render messages as text. No HTML/Markdown rendering, attachments, remote image fetches, or arbitrary links in the MVP.
- Set CSP and normal security headers; never enable production stack traces or an unauthenticated database/admin console.
- Prototype limits: 5 failed logins per normalized username per 15 minutes, 50 login attempts per IP per 15 minutes, 10 new reunion requests per account per hour, and a separate configurable staff assisted-intake limit. Avoid permanent account lockout. Limits use a server-side shared store and an injectable clock in tests.
- Differentiate traffic shaping from identity proof. Shared shelter NATs need higher IP capacity; do not ban an entire shelter for one person's activity. New-account abuse and multiple-account block evasion remain documented limitations.
- Blocking a requester also revokes existing grants to that requester, suppresses pending delivery, and does not send a block notice. Reporting does not silently share the entire case; it records the selected request/response reference for scoped review.

## 6. Race, retry, and revocation semantics

For check-ins, requests, response approval, transfers, and recovery, use transaction boundaries and explicit constraints. An idempotency key is scoped by authenticated actor, operation, and intended subject. Persist a request fingerprint and outcome reference. Same key/same payload returns the existing outcome; same key/different payload returns `409`. Store outcome references, not a cached sensitive DTO that could bypass later revocation.

Use expected versions for preferences, assignments, and transitions. Approval must lock or conditionally update the active request and privacy version so withdrawal/block/privacy changes cannot race into an unauthorized grant. One approved response per request; test concurrent submissions.

A new read starting after revocation commits must deny. An already authorized response in flight or copied to a device cannot be recalled; document this boundary. Clients clear the relevant view on the next refresh/poll and on local revoke. No shared caching of authorized responses. Worker jobs reload current scope rather than trusting event payloads created earlier.

## 7. Data protection and retention

Use TLS, encrypted database volumes/backups, isolated credentials, and a non-public database. Encrypt private request introductions/clues and response free text at application level using an established authenticated-encryption API with versioned keys; do not invent cryptography. Structured shelter/area fields remain access-controlled in the database, protected at rest by infrastructure encryption. This is not end-to-end encryption. Key-holding services and privileged operators remain trusted.

Minimize captured personal data. Store contact/recovery/assistance/session secrets as digests, with distinct purpose separation. Apply log redaction before emitting logs; exceptions and tracing must not serialize request bodies or secrets. Audit append-only action metadata, not message text or location.

Prototype retention policy, clearly configurable and not a legal conclusion:

| Data | Retention behavior |
| --- | --- |
| Unanswered request | Expires after 14 days; personal text purged 30 days after closure |
| Response/check-in | Purged 30 days after case/account closure; no grant survives deletion |
| Active assisted case | Coordinator review due after 30 days inactivity; close or explicitly extend with reason |
| Session/recovery artifacts | Expired/revoked tokens purged within 24 hours; used recovery secrets cannot be replayed |
| Outbox/notification details | Reference-only payloads; purge completed jobs after 7 days |
| Audit metadata | Retain 90 days, pseudonymize where possible; no copied personal content |
| Backups | Maximum 30-day backup window; restore must reapply deletion/revocation ledger before serving traffic |

Account deletion requires reauthentication and immediately revokes sessions/grants and hides person content. Purge profile, check-in, and message payloads within 24 hours (implemented: in the deletion transaction itself, so the purge never depends on a background job); retain minimal tombstones so counterparts receive neutral unavailable states and restores can reapply deletion. Counterpart-authored messages need their own retention rules; never claim deletion removes other people's screenshots or independent records. Assisted deletion requires verified assistance authority. Retention actions must not delete production data through a development reset command.

Hosting exception (demo only, 2026-10-19): on single-process hosting that sleeps when idle (the Render free tier in [deployment.md](deployment.md)), the scheduled retention job runs when the service starts and every `RETENTION_INTERVAL_MS` while it is awake. The time-based windows in the table above (request text, closed cases, session/recovery artifacts, completed jobs, notifications, audit metadata) can therefore be exceeded by however long the service slept, and are not claimed on that host. Access decisions never depend on the job: session, grant, request and assistance expiry, revocation and deletion are checked on every read, and deletion purges content in its own transaction. The Help page states this limitation.

## 8. Evidence required

Implement all `AUTH`, `PRIV`, `STAFF`, `DATA`, and `REL` acceptance cases before declaring security gates passed. Every protected route gets at least one allowed case and one cross-person or cross-shelter denied case. Observe both response bodies and database effects.

Reference principles: [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), and [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). The particular roles, thresholds, workflow rules, and retention choices above are this project's specification.
