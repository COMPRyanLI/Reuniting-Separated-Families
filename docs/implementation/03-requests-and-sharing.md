# Phase 03: private requests, explicit responses, and revocation

Depends on: 02. Gate: FLOW-01 through FLOW-04; PRIV-01 through PRIV-07.

## Deliverables

A complete self-service reunion story through contact codes, with no target enumeration and no automatic future-location access. Negative direct-API tests are mandatory in this phase.

## Implementation steps

1. Add requests, responses, sharing grants, blocks, abuse reports, notifications, and outbox migrations; reuse the idempotency records introduced in phase 02. Enforce one response per request and correct subject/requester/check-in relationships.
2. Implement request form with contact code, previewed requester alias/introduction, and disclosure explanation. Submit the code in a JSON body, never a URL. Do not persist raw codes in queued payloads; use a lookup digest.
3. Save requester-owned request and routing event atomically; return the same neutral 202 envelope for all well-formed code outcomes. Resolve code, preferences, and blocks in a worker; invalid or closed destinations produce no revealing requester state.
4. Implement participant-specific incoming/outgoing serializers. No delivery/read receipts, matching results, destination identifiers, internal state, or hidden profile fields in outgoing responses.
5. Build recipient response form: safety message, area, or shelter; selected owned check-in; 24-hour/seven-day expiry; exact preview. Default to minimal disclosure. The server validates the scope/check-in relationship and ignores no injected fields silently: reject invalid extras.
6. In one transaction verify active request and current authority/preferences, then write consent, immutable response, grant, audit, and outbox. Use version/locking controls for simultaneous withdrawal/block/approval. A guessed check-in or requester ID must fail.
7. Build `Shared with me` view using fresh authorized response retrieval. Serialize only scope-allowed fields. No fetching full person objects and hiding fields on the frontend.
8. Implement private decline, requester withdrawal, directional block, grant revoke/revoke-all, expiry, and minimal abuse reporting. Blocking revokes existing subject-to-requester grants and suppresses pending delivery. New check-ins do not inherit old grants.
9. Add in-app generic notification generation and viewing. Notification records point to content; they do not embed messages/locations. Start/stop active-page polling correctly.
10. Introduce `test:security` covering direct endpoint attacks and field leakage. Require tests for existing versus nonexistent inaccessible IDs, secret-code misuse, history/future leakage, and third-party access.

## Verification

- Run Maya -> Leo request/response with each scope in separate browser contexts.
- Fetch API responses as Maya, Leo, Noor, Evan, an unauthenticated client, and unassigned staff; inspect entire JSON objects.
- Rotate codes and compare valid/unknown/closed/blocked outcomes structurally; no sensitive fields or distinct external statuses.
- Revoke/expire a grant and replay its URL, old notification, and idempotency outcome reference. No private data after revocation.
- Race duplicate approvals and withdrawal using concurrent requests; assert at most one valid response/grant, no ghost notification, and correct committed state.

## Exit evidence

Record the scope-by-viewer test matrix, request-state projections, race-test results, and browser proof of specific-report sharing. Do not defer denied-access coverage to hardening.
