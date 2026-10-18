# Phase 04: assisted requests, targeted matching, and case handover

Depends on: 03. Gate: FLOW-05 through FLOW-06; PRIV-08; STAFF-04 through STAFF-08; REL-01 through REL-04.

## Deliverables

Complete no-phone and cross-shelter stories without a shared resident directory. Explicitly unresolved cases remain unresolved. Reliable delivery must survive retries, worker restarts, and changes in permission.

## Implementation steps

1. Add request-route and case-transfer tables, scoped task assignments, active-route constraints, and transfer versioning. Add indexes for staff queues. Preserve the distinction between request routing and moving responsibility for a person's case.
2. Build assisted requester actions using the same request service as self-service, with actor/subject separation and consent for the introduction/clues sent. Read approved replies only with active requester-case authority and a current assistance session.
3. Build assisted recipient review: display requester introduction privately, verify the assisted person's secret for repeat visits, preview the proposed response, and record the exact expressed choice. Staff cannot approve using their own judgment or an unrelated case's authority.
4. Implement request without code: optional clues and suspected shelter selection; explicit preview of the destination and information to be relayed. A coordinator at the requester's own shelter sees only that a no-lead request exists (case reference and time, not the clues, which are shared only with a destination the requester chose), can request additional lead information from the requester, and cannot globally search residents. (Resolved toward the permission table on 2026-10-18; see progress rulings.)
5. Route to one selected shelter after relay consent. Its coordinator sees the request task and assigns an eligible worker. That task permits minimal matching fields for active local opted-in cases only: alias and optional volunteered distinguishing clue. No location history, other requests, full profiles, private contacts, or closed/code-only people.
6. Implement candidate proposal, not match confirmation. Deliver the request to the proposed recipient's own inbox or assigned assistance team. Do not automatically create a grant or tell the requester that a person was found. Expired assignments and changed privacy preferences must invalidate old candidate actions.
7. Allow a new destination lead only with a new relay choice; terminate the old route's task access. Missing leads or no match yield an internal unresolved state and the same neutral requester view.
8. Implement case transfer proposal, destination acceptance, verification of the person, and atomic switch of active assignments. Pending transfer alone must not reveal complete history to destination staff. Acceptance grants only the case information required by the new assignment and ends source staff's ordinary reads.
9. Implement case closure and coordinator review-due list. No bulk resident export. Store handover metadata without sensitive free-text notes. Document staff training and physical verification as operational assumptions.
10. Harden outbox leasing/retries: crash-safe claim, bounded retry, current-permission recheck, unique notification event key, and dead-letter/failure metadata. Do not acknowledge successful content delivery to a requester based on worker internals.
11. Complete all assisted equivalents needed for privacy changes, revoke-all, block, request withdrawal/decline, and deletion using shared policy/services. Add any necessary API wrappers to the data/API document; do not leave assisted people unable to exercise privacy rights.

## Verification

- Sam at Shelter A -> Leo at Shelter B; assisted request, target consent, return reply. W-A cannot view Shelter B residents or approve Leo's response.
- Route a no-code request to B; W-B sees only allowed local matching fields. A code-only or closed local person does not appear. No global search endpoint exists.
- Unknown destination remains unresolved and leaks no existence/match information. Wrong candidate never automatically receives full case information or grants access.
- Transfer Sam A -> B; verify source reads fail after commit, destination assignment works, old worker jobs cannot retain access, and unrelated cases are unaffected.
- Kill/restart worker after notification insert but before acknowledgment; one visible notification, no duplicate grant. Revoke/block between enqueue and delivery; no sensitive payload is delivered.

## Exit evidence

Record endpoint/policy tests and browser stories for both sides of assisted interactions, exactly which candidate fields are exposed, concurrency outcomes, and the unresolved/no-lead limitation.
