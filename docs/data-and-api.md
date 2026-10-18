# Database and API contracts

Status: proposed schema and endpoints to implement. Exact ORM naming may differ; preserve constraints and externally observable behavior. Read [design](../design.md) and [permissions](security-and-permissions.md) first.

## 1. Modeling conventions

PostgreSQL is the source of truth. Use UUID primary keys, UTC timestamps, explicit foreign keys, indexed ownership/scope columns, and `version` fields on mutable workflow rows. UUIDs are not authorization. Use database constraints and transactional service validation together; neither alone proves permission.

Account and person are separate: an account owns at most one ordinary person profile in the MVP; an assisted person can have no account. A staff account may have its own ordinary profile but its staff context must never change that profile's permissions implicitly. Each case/request/check-in belongs to an incident. A single seeded incident is enough for the demo.

## 2. Entities and minimum fields

| Entity | Minimum fields | Constraints / indexes |
| --- | --- | --- |
| Account | id, normalizedUsername, passwordHash, state, createdAt, credentialVersion | Unique normalized username; no role supplied by public signup |
| Session | id, accountId, tokenDigest, createdAt, lastUserActivityAt, expiresAt, revokedAt | Unique digest; index accountId and expiry |
| RecoveryCredential | id, accountId, purpose, digest, usedAt, expiresAt | Single-use atomic consumption; purpose-separated |
| StaffMfa | accountId, encryptedTotpSecret, enrolledAt, lastAcceptedStep | One enrollment/account; recovery credentials separate |
| Person | id, accountId nullable, alias, encryptedMatchingClue nullable, requestMode, restrictedReferral, deletedAt, version | Unique nullable accountId; no implicit alias uniqueness; optional clue only for opted-in assisted matching |
| ContactCode | id, personId, digest, createdAt, revokedAt | One active code/person; digest unique; raw code never persisted |
| AssistanceCredential | id, personId, digest, issuedAt, revokedAt | Separate from account recovery/contact routing |
| Incident | id, label, state | All domain operations constrained to intended incident |
| Area | id, incidentId, label | Canonical approximate area; no arbitrary hidden precise data |
| Shelter | id, incidentId, areaId, name, publicAddress, isPublic, state | Public listing filters isPublic; no resident count |
| StaffMembership | id, accountId, incidentId, shelterId nullable, role, state | Unique active membership tuple; operator scoped separately |
| AssistanceCase | id, personId, incidentId, shelterId, reference, state, lastReviewedAt, version | One active case/person/incident; reference is nonsecret |
| CaseAssignment | id, caseId, staffAccountId, purposes, startsAt, endsAt, assignedBy | Query active scope; end on transfer; no self-assignment loophole |
| AssistanceSession | id, caseId, staffAccountId, verifiedAt, expiresAt, revokedAt | Short lived; verification required for repeat assisted decisions |
| CheckIn | id, personId, incidentId, shelterId nullable, areaId, observedAt, receivedAt, authorAccountId, source, state, supersedesId nullable | shelter/area must agree; same-person supersedes; index person+observedAt |
| ReunionRequest | id, incidentId, requesterPersonId, recipientPersonId nullable, routeType, encryptedIntroduction, encryptedClues nullable, internalState, expiresAt, version | Recipient resolved only by server; index requester/status and recipient/status |
| RequestRoute | id, requestId, destinationShelterId, relayConsentId, state, assignedWorkerId nullable, version | At most one active route/request; recipient shelter opt-in selection |
| ConsentRecord | id, personId, actorAccountId, caseId nullable, assistanceSessionId nullable, action, scope, recipientPersonId nullable, resourceId nullable, statedAt, recordedAt, policyVersion | Exact decision; no overwrite; revoke through subsequent action/event |
| Response | id, requestId, subjectPersonId, encryptedMessage, checkInId nullable, approvedAt | Unique requestId; check-in owned by subject; immutable |
| SharingGrant | id, responseId, subjectPersonId, recipientPersonId, scope, consentId, expiresAt, revokedAt | Scope/check-in consistency; index recipient+expiry; not blanket profile access |
| Block | id, subjectPersonId, blockedPersonId, createdAt | Unique directional pair; atomically revoke outbound grants to blocked person |
| AbuseReport | id, reporterPersonId, requestId/responseId, category, state | Report only a record reporter can access; no unsolicited data dump |
| CaseTransfer | id, caseId, fromShelterId, toShelterId, consentId, state, version | One pending transfer/case; no cross-incident destination |
| Notification | id, recipientAccountId nullable, assistedCaseId nullable, eventKey, resourceType, resourceId, createdAt, readAt | Exactly one routing destination; generic text; unique event+destination |
| OutboxJob | id, eventKey, kind, referencePayload, state, attempts, availableAt, leaseUntil, completedAt | Unique event key; index state+availableAt; no message/location payload |
| IdempotencyRecord | actorAccountId, operation, subjectKey, keyDigest, payloadDigest, outcomeType/id, expiresAt | Unique actor+operation+subject+key; sensitive output rebuilt under current policy |
| AuditEvent | id, actorAccountId nullable, action, objectType/id, authorityType/id, result, occurredAt | Append-only app access; no raw clues/messages/locations |
| DeletionTombstone | id, person/account pseudonymous reference, deletedAt, affectedResources | Minimal restore-safe deletion ledger; no original content |
| RateLimitBucket | scopeDigest, windowStart, count, expiresAt | Atomic counters; no raw contact code or password |

Use a vetted encryption helper with key version, nonce, ciphertext, and authentication tag for encrypted text. Migrations add SQL CHECK/partial unique constraints where the ORM cannot express them. Never reset a non-test database to apply a migration.

## 3. Relationship invariants

1. A response's subject equals the request's resolved recipient; its grant recipient equals the request's requester.
2. A response's check-in belongs to that subject in the same incident. `SHELTER` requires a shelter check-in; `AREA` can disclose only canonical area data; `SAFETY_MESSAGE` has no location projection.
3. Staff approval requires an active target case assignment, active verified assistance session (or witnessed first intake), and a specific consent record. A source/requester worker cannot approve on behalf of the recipient.
4. A staff member assisting the requester reads a disclosure only through an active requester case assignment and current assistance session. A grant is to the person, not permanently to that staff member or shelter.
5. Matching tasks can reveal only opted-in minimal local fields. Completing a task does not create a sharing grant.
6. A suspended membership or ended assignment removes access immediately, even when a session or job was created earlier.
7. Retried writes do not duplicate events. One response can create one grant and one notification per intended destination.
8. Delete/close/transfer operations maintain valid tombstones and references; cascading deletion must not erase security evidence indiscriminately.

## 4. API conventions

Prefix `/api/v1`. All endpoints require session authentication unless marked public. Use JSON schemas shared with the frontend; reject extra mutation fields. All protected object lookups use the neutral not-found contract. Lists use cursor pagination, default 20/max 50, and scope filtering before pagination/counting. Never put credentials/contact codes/request clues in query strings.

State-changing requests include CSRF protection; critical creates include `Idempotency-Key`; mutable state updates include `expectedVersion`. Auth account and person IDs come from the session or a verified staff case, never arbitrary browser claims.

### Account and own-person endpoints

| Method/path | Contract |
| --- | --- |
| POST /auth/register (public) | username, password, alias; create account/person transaction; no staff role |
| POST /auth/login (public) | Establish/rotate session; generic invalid-credential response |
| POST /auth/logout | Revoke current session and expire cookie |
| POST /auth/recover (public) | username, recovery secret, new password; atomic consume and revoke sessions |
| GET /auth/session | Minimal current account, person ID, available role contexts; no sensitive profile |
| POST /auth/mfa/enroll; POST /auth/mfa/verify | Staff enrollment/verification with reauthentication; no privileged access before completion |
| POST /auth/recovery-codes | Reauthenticated rotation; show secrets once |
| GET/PATCH /me | Own allowed profile fields; expectedVersion for changes |
| PATCH /me/privacy | requestMode; does not silently revoke grants; explicit revoke-all endpoint |
| POST /me/contact-code/rotate | Generate once; invalidate previous routing code |
| GET/POST /me/check-ins | Own historical records/create with area/shelter and observedAt |
| POST /me/check-ins/:id/depart | Own check-in historical status change; no new destination implied |
| DELETE /me | Reauthenticate; disable access immediately; purge content in the same transaction |

### Requests, responses, and grants

| Method/path | Contract |
| --- | --- |
| POST /requests | Code or assisted route; previewed introduction, optional clues/destination relay consent; neutral 202 |
| GET /requests/outgoing | Requester-owned sanitized states; no recipient/link/destination-result metadata |
| GET /requests/incoming | Only currently authorized recipient view; requester deliberately shared introduction |
| GET /requests/:id | Participant-specific DTO, never the same raw model for both sides |
| POST /requests/:id/withdraw | Requester only; prevent later approval |
| POST /requests/:id/respond | Recipient approval: scope, message, owned checkInId if needed, expiry choice, expectedVersion |
| POST /requests/:id/decline | Recipient private decision; requester status unchanged |
| POST /requests/:id/block | Recipient block + revoke existing grants + suppress queued delivery |
| GET /responses/:id | Recheck grant, recipient, scope, expiry, deletion and report state; field-limited DTO |
| GET /me/grants | Subject's recipient-specific sharing list |
| POST /grants/:id/revoke; POST /me/grants/revoke-all | Subject only; idempotent and audited |
| POST /abuse-reports | Authorized record reference plus selected category |
| GET /notifications; POST /notifications/:id/read | Own generic notifications; never resolve protected content without new authorization |

### Shelter workflow endpoints

| Method/path | Contract |
| --- | --- |
| GET /shelters (public) | Public facility metadata only; no residents or sensitive-location directory |
| GET /staff/tasks | Active assignments/routes for this staff identity and current membership |
| POST /staff/cases | Authorized local intake; person alias/preferences/consent; create own initial assignment |
| GET /staff/cases/:id | Assignment-filtered data; never a global person browse |
| POST /staff/cases/:id/verify | Assistance secret -> short-lived staff/person assistance session; rate-limited |
| POST /staff/cases/:id/check-ins | Same validation as self-check-in plus authority and actor attribution |
| POST /staff/cases/:id/requests | Assisted requester with recorded relay consent |
| POST /staff/cases/:id/requests/:requestId/respond | Recipient-case authority, exact consent and current person verification |
| POST /staff/cases/:id/requests/:requestId/decline; POST /staff/cases/:id/requests/:requestId/block | Verified assisted recipient, same private outcomes and grant revocation as self-service |
| POST /staff/cases/:id/requests/:requestId/withdraw | Verified assisted requester; no approval after withdrawal |
| GET /staff/cases/:id/responses/:responseId | Assisted requester only; current grant and assistance session |
| POST /staff/cases/:id/grants/:grantId/revoke | Verified subject assistance; same grant revocation logic |
| POST /staff/cases/:id/grants/revoke-all | Verified subject assistance; revoke every active outbound grant atomically |
| PATCH /staff/cases/:id/privacy; DELETE /staff/cases/:id/person | Verified subject assistance; same privacy/deletion domain services |
| POST /staff/requests/:id/route | Assigned coordinator and explicit requester relay consent; one destination |
| GET /staff/routes/:id/candidates | Assigned route worker; minimal opted-in active local cases; no exact location fields |
| POST /staff/routes/:id/propose-recipient | Scoped candidate only; route to recipient decision; never approve grant |
| POST /staff/cases/:id/assignments | Local coordinator; eligible approved staff; constrained purpose |
| POST /staff/cases/:id/transfers | Source coordinator + person choice; destination incident match |
| POST /staff/transfers/:id/accept | Destination coordinator + person verification; atomic reassignment |
| POST /staff/cases/:id/close | Authorized coordinator; state change, retention schedule, no disclosure |

Reuse domain services for self and assisted operations; wrappers establish different authority. Add only necessary endpoints when implementing a phase and document any renaming. Staff provision/suspension uses an authenticated operator CLI initially, not an expansive administration UI.

No-code lead updates use `POST /requests/:id/lead` for the verified requester and `POST /staff/cases/:id/requests/:requestId/lead` for verified requester assistance. They record the new clue/destination relay choice and expected request version; they never return matching outcomes. A coordinator can issue a generic `POST /staff/requests/:id/ask-for-lead` task without disclosing a possible recipient. Equivalent request lists and detail reads for assisted cases must use the same participant-specific projections through assigned, verified assistance. Implement these alongside phase 04 rather than inventing a broad staff search endpoint.

## 5. Delivery and indexes

Write domain result + audit event + outbox event in one transaction. A worker claims up to 50 due jobs with a lease and row locking, rechecks current scope, inserts a deduplicated generic notification, and marks completion. Retry with bounded backoff; after five failed attempts retain a failure state for operator attention. Do not disclose failed delivery to a requester if it would reveal recipient existence.

Index active assignment by staff/case, active route by destination/worker, request by requester and recipient, grant by recipient/response, check-in by person/time, and jobs by state/due time. Apply authorization filters before limiting results. Use measured query plans for the benchmark rather than speculative caches.

## 6. Migration/seed contract

Fresh disposable PostgreSQL must migrate from empty to current schema and seed deterministic fictional actors. Re-running seed updates fixtures without duplicate memberships/grants. Test old-schema upgrade using a preserved synthetic database when later migrations exist. Production deploy runs checked-in migrations, never development reset/push shortcuts. Database reset utilities require an explicit test environment and an allowlisted disposable database name.

## 7. Implementation notes (2026-10-18)

The implemented API follows sections 1–6 with these documented differences. Contracts live in `packages/contracts/src`.

- Added: `GET /areas` (public canonical areas), `GET /responses` (active answers shared with me), `GET /staff/me`, `GET /staff/shelters/:id/staff` (coordinator: eligible local staff), `POST /staff/cases/:id/end-assistance`, `POST /staff/cases/:id/escalate` (lost secret), `POST /staff/cases/:id/assignments/:assignmentId/end`, `POST /staff/cases/:id/review` (extend review 30 days), `POST /staff/cases/:id/contact-code/rotate`, `POST /staff/cases/:id/assistance-secret/rotate`, `GET /staff/cases/:id/requests`, `POST /staff/routes/:id/assign`, `GET /staff/routes/:id`, `POST /staff/routes/:id/no-match`, `POST /staff/transfers/:id/cancel`.
- Not implemented on purpose: `POST /staff/requests/:id/route`. Destinations are chosen only by the requester (or their verified assisting worker) with a fresh relay consent through the lead endpoints, so staff cannot reroute a request on their own. STAFF-06 tests the 404.
- `GET /staff/cases/:id` returns only a header (alias, reference, shelter, restriction, verification state) until the worker verifies the person's assistance secret; check-ins, clues, requests, grants and notifications need that current verification.
- Matching candidates carry an HMAC token scoped to the route instead of a person or case ID.
- Code requests store a keyed digest of the code in the request row until the worker resolves it, then clear it.
- Extra tables: `LeadAsk` (generic ask-for-lead prompts), `DeletionTombstone` (restore-safe deletion ledger), `SystemFlag` (restore gate). Responses gained `statement` (structured message) and `purgedAt`.
- Operator tools are CLIs (`npm run staff:admin`, `npm run ops`), not web endpoints.
- 2026-10-19: a wrong re-entered password returns `403 REAUTH_FAILED` and a rejected second factor `403 MFA_REJECTED` (the session stays valid); `401` is reserved for a missing or expired session.
- 2026-10-19: `POST /staff/cases` accepts an optional `shelterId`, required when the staff member works at more than one shelter and limited to their own shelters.
- 2026-10-19: `POST /staff/requests/:id/ask-for-lead` returns the same `200` for every request state; `POST /staff/transfers/:id/accept` returns `409` for a decided transfer before checking the secret.
- 2026-10-19: retrying `POST /requests` or `POST /staff/cases` with an already-saved idempotency key returns the stored outcome without consuming a rate-limit slot.
