# Design: consent-based family reunification

Date: 2026-10-18. Status: implementation specification. Implemented locally through phase 06 on 2026-10-18; see [progress](docs/progress.md) for evidence and [traceability](docs/test-traceability.md) for coverage.

## 1. Problem and selected outcome

A hurricane evacuation separates families across shelters, hotels, and private homes. Many people lack phones and identity documents; some do not want to be found. Shelter workers are available but busy. Build one small, coherent website that lets people reconnect without exposing anyone merely because someone searches for them.

Primary success story: a person without a phone receives shelter assistance, records a check-in, receives a private request, authorizes a safety message or one location report, and can later withdraw access. Another account cannot retrieve the protected data by changing an ID or calling the API directly.

The brief requires a frontend connected to a backend, a database, a live deployed link, and a public repository with a README explaining people, scope, omissions, design, technical choices, tradeoffs, and AI use.

## 2. User categories

| Category | Needs | Website capability |
| --- | --- | --- |
| Visitor | Understand service and get started | Help, public shelter information, signup/login; no person search results |
| Registered individual | Search and be contacted while controlling disclosure | Own profile/check-ins, outgoing requests, incoming requests, responses, grants, blocks |
| Private individual | Search without revealing their whereabouts | Same account type; no location required; incoming requests can be disabled |
| Assisted person | Use service without account/device | Assigned worker performs limited actions with recorded authority |
| Shelter worker | Process short, accurate intake | Assigned cases, check-ins, request relay, consent recording |
| Shelter coordinator | Organize work and handovers | Case assignment, targeted routing, membership administration within scope |
| System operator | Run the service | Provision staff and maintain services; no default application-level person browser |
| Child or adult unable to consent | Appropriate safeguarding | Restricted referral placeholder; no ordinary disclosure or automated guardian decisions |

An individual may be both a requester and a recipient. An alias is a display choice, not another account type or proof of anonymity. Staff privileges require separate provisioning. Account authentication, identity verification, and sharing permission are separate concepts.

## 3. Scope and non-goals

### Required for the challenge implementation

- Username/password signup and login, optional alias, recovery secret, session revocation.
- Separate person records for account owners and assisted people without accounts.
- Public, fictional shelter directory; manual area selection; no GPS permission prompt.
- Check-ins with observation time, source, author, and an explicit historical label.
- Contact-code request routing and staff-mediated requests without a code.
- No public directory, candidate count, delivery/read receipt, or hidden-person confirmation.
- One deliberate response per request: safety message, approximate area, or named shelter.
- Per-recipient grant, expiry, revocation, and no access to future check-ins.
- Assigned shelter intake, assisted responses, cross-shelter relay, and case handover.
- In-app notifications with generic text; reliable background delivery and retries.
- Blocking, limited abuse reporting, data deletion, retention jobs, audit metadata.
- Direct API authorization tests and browser demonstrations using fictional fixtures.

### Documented future work

Continuous/live GPS; map-provider integrations; SMS/email; full offline synchronization; live chat and attachments; global fuzzy matching; independent agency database integration; biometric/legal-ID verification; automatic duplicates merging; verified guardianship; emergency dispatch; route safety; full multilingual translation.

The prototype can be accessible and translation-ready without claiming complete language coverage. It supports a single fictional incident in the demo; incident boundaries remain explicit in data and authorization.

## 4. Product decisions

### Identity and privacy

Use a unique login username and non-unique display alias. Do not collect government ID, immigration status, exact birth date, medical history, photographs, or a home address. Real-name-like matching clues are optional, purpose-limited, and not publicly searchable. Requesters preview the alias and short introduction that recipients will see.

Incoming-request modes: `CLOSED`, `CODE_ONLY`, `ASSISTED`. Default `CODE_ONLY`. `CLOSED` rejects routing silently; `ASSISTED` permits both code delivery and narrowly scoped staff matching. Existing grants are controlled separately: closing incoming requests is not the same as revoking an existing disclosure. The privacy page offers an explicit revoke-all action.

Assisted matching requires an active participating-shelter case. Selecting `ASSISTED` without such a case does not add a self-service account to any searchable directory. Explain this limitation in the setting; contact-code delivery remains available.

### Location

Store either a selected shelter with its canonical area, or an area alone. Do not store device coordinates in the MVP. A named shelter disclosure identifies a facility, not a person's position within it. Area-only disclosure must omit shelter IDs, addresses, coordinates, staff identity, case IDs, and route metadata.

Every display says `Last reported ...`, includes observation time and timezone, and says current presence is unconfirmed. Never label a recent timestamp as proof someone is safe. A safety statement is the person's reported statement. More than 24 hours old receives an additional `Older report` label; this is a UI threshold, not a safety standard. Future timestamps more than five minutes ahead are rejected. Late data entry keeps observation time distinct from received time.

An append-only check-in can be superseded or marked departed. An existing grant to an old check-in does not reveal the replacement or destination. If its report is no longer reliable, an authorized reader sees `This report is no longer current` with no new location.

### Sharing

One response belongs to one request and one recipient. A grant references that response and, if applicable, exactly one check-in. Scope is `SAFETY_MESSAGE`, `AREA`, or `SHELTER`. The form previews exactly the fields the recipient will receive. Default expiry is seven days; allow 24 hours or seven days in the MVP. The user can revoke sooner. These are prototype defaults, not humanitarian policy.

A safety message may itself contain sensitive details. Default to short structured choices and optional plain text up to 280 characters. Show a preview and a warning to check for unintended location disclosure. Do not infer consent from a name, family claim, or earlier grant to another person.

### Request routing with a contact code

Each consenting person may obtain a random high-entropy contact code. It permits request submission only. Store its keyed digest, show a newly generated code once, and support rotation. A valid, invalid, rotated, closed, blocked, or unknown code returns the same `202 { status: 'submitted' }` response and no recipient data. Resolve asynchronously to avoid a direct lookup result in the request response. This reduces enumeration; it does not promise perfect timing anonymity.

### Requests without a contact code

Use an assisted queue, not global automatic identity matching. Requester submits optional identifying clues and a suspected participating shelter, if known, and explicitly consents to those clues being relayed to that shelter's designated team. At most one active destination route exists at a time in the MVP.

If no destination is known, an assigned coordinator reviews only the supplied request information, seeks a lead through the requester, or leaves the case unresolved. They do not browse the entire person database. A destination coordinator assigns a matching task; its worker can compare only minimal matching fields for active local cases whose people opted into `ASSISTED`. This temporary task authorizes those fields, not locations, messages, or full case histories. No results or match counts leave the staff workflow.

A potential match is a proposal. Recipient consent is still required. Staff-recorded selection does not verify identity. Requester can later supply another lead; routing to a new shelter requires a new explicit relay choice and ends access at the previous destination. Broadcast matching across all shelters is deferred.

### Assisted use

Workers authenticate individually. A case assignment permits intake/help, while a consent record documents the person's expressed decision. Both are needed for assisted disclosure. Give the person a neutral reference card plus a separate private assistance secret for later visits. Do not put location or the login/recovery secret on the reference card.

For a repeat visit or transfer, verify the private secret before new assisted consent. A missing secret requires a documented manual escalation and no automated disclosure or account linking; this is a limitation, not an excuse for weak knowledge questions. The worker can record a restricted new inquiry while access remains unresolved. Intake consent is witnessed by the worker; the system cannot cryptographically prove the person was present or freely consenting. Audit and organizational training are necessary dependencies.

Assisted-to-account claiming is deferred. Users can create an independent account but it must not automatically attach to an assisted profile with a matching alias. No automatic account/person merge.

### Children and people unable to consent

Worker can flag a case as `RESTRICTED_REFERRAL`, record minimal routing metadata, and show referral guidance. Normal matching, sharing, and account claiming are disabled. The app makes no determination of guardian rights. Do not collect detailed safeguarding narratives for the demo.

## 5. Architecture

Use a TypeScript monorepo: React/Vite frontend; Express API; PostgreSQL; Prisma schema and versioned migrations; shared Zod request/response contracts. API serves the built frontend at the same origin in production; Vite proxies `/api` locally.

```text
Browser -> same-origin API -> authentication + authorization
                            -> domain services -> PostgreSQL
                            -> explicit response serializers
Database outbox -> worker -> recheck current authority -> generic notification
```

Use one backend codebase and an outbox worker runnable as a second process. A database job lease supports retries and recovery. No Redis, separate search engine, machine-learning identity matching, or external map is needed. Poll in-app notifications every 15 seconds while the page is active; stop on logout/hidden tabs and use backoff on failure.

Proposed layout:

```text
apps/web/src/{features,components,lib}
apps/api/src/{routes,auth,policy,services,repositories,serializers,jobs}
packages/contracts/src
prisma/{schema.prisma,migrations,seed.ts}
tests/{integration,e2e,performance,fixtures}
scripts/
docs/
```

The backend controls subject IDs, staff scope, grant scope, and transition rules. Avoid returning ORM models directly. All times persist as UTC and render with a visible local timezone. No sensitive offline caching; failed submissions remain unsent and can be retried with the same idempotency key.

## 6. Interaction state rules

Request internal states: `SUBMITTED -> ROUTING -> AWAITING_DECISION -> RESPONDED`. Alternate states include `UNRESOLVED`, `DECLINED`, `BLOCKED`, `WITHDRAWN`, and `EXPIRED`. Only requester-owned `SUBMITTED/WITHDRAWN/EXPIRED` concepts and an authorized response are exposed externally; all other no-response conditions display `No response available yet`. Never display `Person found` or a rejection reason to the requester.

Public request expiry is calculated from the original submission deadline, independent of a hidden decline, failed match, or block. Do not let a different closure time or retention side effect reveal those hidden outcomes. After a previously disclosed response is revoked, a generic `Response unavailable` state is acceptable; no new reason or location is revealed.

Responses are immutable after approval; correcting a response requires revoking it and creating a new request/response in the MVP. Requests expire after 14 days if unanswered. A response transaction must verify request active state, current person privacy rules, actor authority, and check-in ownership before saving consent, response, grant, audit event, and outbox event.

Case transfer: `PROPOSED -> ACCEPTED` or `CANCELLED`. Acceptance verifies destination membership, person assistance secret and new authority; switches active case responsibility and closes previous staff assignments atomically. Historical author IDs remain, but previous staff lose ordinary reads. Request routing to another shelter and transferring a person's assistance case are different operations.

### Connectivity and paper fallback

The website does not operate across a complete network outage. Show `Not submitted` on failed writes and preserve the idempotency key only for the current in-memory retry. A lost browser tab can lose the unsent draft; do not promise durable offline storage.

Document a shelter-run fallback: record a neutral reference, alias, observation time, and the person's limited instruction on a privately held intake sheet; do not display it publicly or record recovery secrets on it. When connectivity returns, an authorized worker transcribes with the original observation time, records paper origin/entry time, checks for duplicates, and reconfirms a specific recipient disclosure before sending it. Safe physical storage, destruction, and staffing are operational dependencies outside the website. The demo should explain this process, not simulate that an offline request reached another shelter.

## 7. Trust and limits

We protect against unauthorized account reads, dishonest relationship claims, broad volunteer access, accidental disclosure, and common session/API failures. We do not guarantee protection from compromised devices, coerced consent, colluding trusted staff, a database/key administrator, copied screenshots, unreported movement, or network-wide outages.

Do not claim regional-scale readiness because the brief mentions 400,000 people. Benchmark the synthetic dataset and environment specified in the test catalog; report the measured scope. Production use would require security review, safeguarding governance, partner agreements, operational support, and load testing beyond this challenge.

## 8. Related specifications

- [Permissions](docs/security-and-permissions.md)
- [Data and API contracts](docs/data-and-api.md)
- [Acceptance catalog](docs/acceptance-tests.md)
- [Implementation phases](docs/implementation-plan.md)
- [Sources and assumptions](docs/sources.md)
