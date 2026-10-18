# Phase 02: personal privacy, historical check-ins, and assisted intake

Depends on: 01. Gate: CHECK-01 through CHECK-04; STAFF-01 through STAFF-03.

## Deliverables

An individual can manage their own request privacy and historical location reports. An assigned worker can perform minimal intake without creating an account for the assisted person.

## Implementation steps

1. Add check-in, consent, assistance-session, and reusable idempotency-record migrations. Enforce same-incident shelter/area relationships, same-person supersedes links, and explicit author/source fields. Keep observation time separate from server-received time.
2. Implement own-profile privacy settings: `CLOSED`, `CODE_ONLY` default, `ASSISTED`; preferences version check. Do not enable matching because someone merely entered a name. No device-location collection.
3. Implement contact-code generation/rotation and assistance-secret issuance using cryptographically random values with at least 128 bits of entropy and purpose-separated digests. Show raw values only at issuance; do not persist them in browser storage. Keep neutral case reference separate.
4. Implement public shelter list and canonical area selection. Check-ins accept shelter or area, an observation time, and a short structured status. Reject impossible combinations and future times beyond the five-minute tolerance.
5. Implement historical own-check-in cards, correction through a new superseding report, and departure marking. Display observation time/timezone, source, and current-presence uncertainty. A backdated entry must not become the latest observation simply because it was received last.
6. Implement local assisted intake for approved staff: create person without account, case, initial assignment, witnessed intake authority, assistance secret, and check-in transactionally. No collecting unnecessary legal/medical identifiers.
7. Implement staff task list and assignment-based case view. A coworker at the same shelter without an assignment cannot open the case. Coordinator can assign eligible staff without obtaining unrestricted data access.
8. Implement repeat-visit assistance verification using the separate secret, a short person/staff-specific assistance session, expiry, attempt limiting, and logout. Missing secret leads to an escalation state with no disclosure/account linking.
9. Implement restricted-referral flag and minimal referral UI. Prevent normal matching/sharing for these cases. No guardian-verification feature or sensitive narrative field.
10. Use idempotency for intake/check-ins and optimistic versions for privacy changes. Record metadata-only audits.

## Verification

- Create self and assisted reports; assert correct subject versus actor attribution and persistence.
- Attempt writing another person's report, mixing shelter/area/incident IDs, sending precise location fields, and changing preferences with a stale version.
- Confirm closed/private profiles can still use their own account; the UI does not require location to proceed.
- Prove a reference card alone cannot authorize assisted access; private assistance sessions expire and are staff-specific.
- Test older observation entry, superseding, departure, 24-hour label, and timezone display using a fixed clock.

## Exit evidence

Record check-in and staff-assignment test results, screenshots with fictional data, and current limitations of in-person identity/consent verification.
