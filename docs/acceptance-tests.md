# Acceptance tests and benchmarks

Status: implemented; see [test traceability](test-traceability.md) for which tests cover each ID and which deployment cases have not run. Each ID below defines an observable requirement. Implementations must reference these IDs in test names and map them to files/evidence in `docs/test-traceability.md` before release.

## Test environment and fixture contract

- Unit tests cover pure validation, time rules, state projection, and field serializers.
- Integration tests run the real API against an isolated disposable PostgreSQL database with committed migrations. Do not mock authorization or the ORM for these cases.
- Browser tests use Playwright with separate contexts for each account, actual API calls, and the same test database. No browser-wide shared authentication fixture that erases actor boundaries.
- Use a fixed/injectable clock for expiry and controlled concurrency barriers for races. Use Playwright web assertions for asynchronous UI changes, not arbitrary sleeps.
- Tests inspect full response bodies and affected database rows, not just status codes or hidden UI elements.
- No required case may pass because it is skipped, has no assertions, or runs zero tests. Manual gates require dated evidence and steps.

### Fictional fixtures

| Actor/resource | Intended role |
| --- | --- |
| Maya | Individual requester at Shelter A |
| Leo | Individual recipient with a check-in at Shelter B |
| Noor | Individual who keeps own whereabouts private; separately authorized recipient |
| Evan | Unrelated authenticated outsider |
| Sam | Assisted person at A, no account/device |
| R | Restricted safeguarding referral, no ordinary sharing |
| W-A / W-A2 / W-B | Workers at A / A / B; W-A2 intentionally unassigned to Sam |
| C-A / C-B | Local coordinators; no automatic full-profile privileges |
| O | Operator with no assigned person case |
| Shelter A / B | Fictional public shelters in Incident 1, with distinct canonical areas |
| Incident 2 | Boundary fixture with a separate shelter/case |

Insert unique sentinel strings into private fields and unique secret values into test configuration. Assert that the wrong audience never receives those sentinels in bodies, HTML, URLs, client storage, logs, or assets. Test secrets are local-only and must not be reusable deployment credentials.

## Foundation and database

| ID | Exercise | Pass benchmark |
| --- | --- | --- |
| FND-01 | Clean lockfile install, lint, strict typecheck, production build and start | All commands exit 0; no dependency on untracked local files; actual web/API respond |
| FND-02 | Home and nested-route reload at mobile/desktop sizes | Both work; demo label visible; no fake implemented workflows; readiness distinguishes unavailable DB |
| FND-03 | Missing required production config; sentinel frontend build scan | Startup fails with safe variable names only; no secret sentinel in served assets or health/error bodies |
| FND-04 | Documentation consistency | Three instruction files byte-identical; all local Markdown links resolve; acceptance IDs unique; phase references resolve |
| DB-01 | Migrate empty disposable PostgreSQL and seed twice | Both succeed; second seed creates no duplicate fixture accounts, memberships or cases |
| DB-02 | Insert invalid core FK, duplicate unique account and a case assignment using membership in another incident | DB constraints or transactional domain validation reject each; no partial committed records; extend constraint tests as later tables arrive |
| DB-03 | Restart services after account/person/case creation; apply a later migration to synthetic prior schema when applicable | Data persists; upgrade retains valid data; no reset required; reset utility rejects non-test DB |

## Authentication

| ID | Exercise | Pass benchmark |
| --- | --- | --- |
| AUTH-01 | Register/login using username, password and alias only; inject staff role/owner fields | Normal flow succeeds with no phone/email/legal ID/location; injected fields rejected; no staff membership created |
| AUTH-02 | Wrong password and unknown username; session/cookie inspection | Same public error; token digests stored server-side; HTTP-only secure production cookie; no token in localStorage |
| AUTH-03 | Logout, idle/absolute expiry, password recovery and account suspension | Each invalidates protected API access; polling does not prevent idle timeout; old cookie cannot reopen private content |
| AUTH-04 | Recover with valid secret, then replay; try contact code, case reference or alias instead | Valid secret works once and revokes old sessions; all alternatives/replay fail; no account details leaked |
| AUTH-05 | Staff privilege before MFA; valid TOTP; same-step replay; suspended membership | Privilege denied before completed MFA; valid flow works; replay/suspension denies staff operations |
| AUTH-06 | Exceed configured login limits with fixed clock, then advance window | Documented threshold produces 429/Retry-After; window reset works; unrelated users at shared IP retain access within IP budget |

## Check-ins

| ID | Exercise | Pass benchmark |
| --- | --- | --- |
| CHECK-01 | Create own shelter and area reports; attempt another person's subject ID | Own reports persist; spoofed subject denied; no browser GPS permission request; unknown precise-location fields rejected |
| CHECK-02 | Backdated entry, >5-minute future time, >24-hour-old report, timezone change | Future entry rejected; latest observation sorted by observed time; time/source shown; old label and uncertainty text correct |
| CHECK-03 | Supersede/depart own report; create new shelter report | Old report remains explicitly historical; new report separately stored; no false current-location label. Grant-specific extension is tested in PRIV-07 after sharing exists |
| CHECK-04 | Two privacy edits with same expectedVersion; retry a check-in | One conflicting privacy edit returns 409; consent not overwritten; identical retry yields one check-in |

## Core user flows

| ID | Exercise | Pass benchmark |
| --- | --- | --- |
| FLOW-01 | Maya submits Leo's code; Leo approves a safety message | Request persists; Leo sees intended introduction; Maya receives only approved response after worker delivery |
| FLOW-02 | Leo explicitly shares area, then separately a shelter report via another request | Each view matches its preview and scope exactly; observation time/source visible; no automatic broader grant |
| FLOW-03 | Noor records no location but receives Leo's grant | Noor can read Leo's approved report; Leo receives no Noor location or reciprocal permission |
| FLOW-04 | Leo grants different scopes to Maya and Noor; Evan attempts both | Each recipient sees only their own scope; Evan receives neutral 404; grant not transferable via shared URL |
| FLOW-05 | Sam without account/device uses W-A for intake/request/reply retrieval | End-to-end completion with Sam as subject, W-A as actor, recorded consent and verified repeat assistance; no personal signup required |
| FLOW-06 | No-code request routed to opted-in case at B, then recipient decision | Targeted staff flow works; no grant until explicit consent; requester cannot see candidate list/match confirmation |

## Privacy and access denial

| ID | Exercise | Pass benchmark |
| --- | --- | --- |
| PRIV-01 | Submit well-formed valid, unknown, rotated, closed-person and blocked-person contact codes; separately exceed requester rate limit | Same 202 response shape and no-response state below limit; no target hints; configured per-requester limit returns target-independent 429 and resets with clock |
| PRIV-02 | Compare own, other and nonexistent IDs across every protected object route | Authorized read works; inaccessible existing and nonexistent IDs have same 404 envelope; unauthenticated calls return 401 |
| PRIV-03 | Inspect complete area/safety response JSON, HTML, client cache and notification | Zero shelter/address/coordinate/internal-person/case/staff/history sentinels outside approved scope; safety-only contains no location |
| PRIV-04 | Revoke or expire a grant, then request its URL/notification/idempotent outcome again | Every new read after revocation commit or expiry denies; no cached sensitive response bypass; client clears on refresh |
| PRIV-05 | Ignore, decline or block Maya; compare Maya's requests/notifications before and after | No recipient-specific outcome or identity confirmation; block also revokes existing Leo-to-Maya grants and suppresses later delivery |
| PRIV-06 | Guess case reference/contact code; alter response recipient/checkInId/scope/role | No account recovery or record access; invalid subject/recipient/scope mutations rejected; no partial grant |
| PRIV-07 | Approved viewer enumerates person's other reports/history/new check-ins/other grants; subject supersedes or departs shared report | Only explicit report accessible; old view marks obsolete without new destination; zero inherited/future-report access |
| PRIV-08 | Closed/code-only person in assisted candidate task; operator/unassigned coordinator browsing profiles | Excluded from candidate list; no global browse; operator/coordinator alone gains no full-person access |

## Shelter authority and handovers

| ID | Exercise | Pass benchmark |
| --- | --- | --- |
| STAFF-01 | W-A creates Sam intake with consent; W-A2 and W-B read it | Actor/subject recorded correctly; W-A assigned access works; unassigned same-shelter and cross-shelter reads deny |
| STAFF-02 | Repeat Sam visit: reference only, wrong secret, expired verification, correct secret with assigned worker | First three cannot authorize sensitive assisted actions; correct secret creates time-limited worker-specific assistance session |
| STAFF-03 | Intake R as restricted referral and attempt matching/disclosure | Minimal referral record allowed; ordinary matching, approval and location sharing denied; no guardian claim bypass |
| STAFF-04 | W-A tries approving Leo's response; W-B with recipient assignment and exact consent approves | Source worker denied; recipient worker succeeds only with proper subject verification/consent; audit captures authority |
| STAFF-05 | Active matching task at B lists candidates; remove task or change person's opt-in | Only minimal local opted-in fields while authorized; access disappears after changes; no other-incident or closed/code-only candidate |
| STAFF-06 | Request has no destination lead, or route is changed without new relay consent | Remains internally unresolved; requester receives no existence clue; unauthorized reroute rejected; no broadcast |
| STAFF-07 | Transfer Sam A -> B; inspect both workers before/after acceptance | Destination lacks full data before authorized acceptance; source access ends after commit; destination scoped access works; unrelated cases unchanged |
| STAFF-08 | Assisted privacy update/revoke/block/withdraw/decline/delete; expired assignment retry | Same rights as self-service through current authority; expired assignment denies; no staff impersonation/account-link shortcut |

## Reliability and concurrency

| ID | Exercise | Pass benchmark |
| --- | --- | --- |
| REL-01 | Send 20 concurrent identical check-in/request/approval writes with one idempotency key | Exactly one domain result and one logical event; every retry points to same outcome; changed payload with same key returns 409 |
| REL-02 | Race approve versus withdraw/block and two transfer acceptances | Only a valid serialized transition commits; at most one response/grant/active assignment; no permission bypass or partial handover |
| REL-03 | Crash worker after notification insert before job completion, restart and retry | Exactly one visible notification; job completes or has explicit bounded failure state; no lost committed request |
| REL-04 | Revoke consent/grant/task or block after enqueue before job processing | Worker reloads authority, suppresses unauthorized content/delivery; generic notification links never bypass a fresh read check |

## Website usability and accessibility

| ID | Exercise | Pass benchmark |
| --- | --- | --- |
| UX-01 | Automated accessibility on all phase-05 pages plus keyboard-only core journeys | Zero critical/serious automated findings; every core action keyboard-accessible; visible focus and labeled errors manually verified |
| UX-02 | Screenshots at 390x844, 768x1024 and 1280x800 | No clipped essential controls, overlap, or horizontal page scrolling; location/source/time and disclosure preview remain readable |
| UX-03 | Disconnect before submit and reconnect; simulate 500/timeout | No success claim before confirmed save; clear unsent/error state; retry creates one record; no private localStorage/IndexedDB draft |
| UX-04 | Shared device logout/account switch/back button/session expiry | Previous person's data absent from rendered view and active client caches; old session fails direct API request |
| UX-05 | Review empty/pending/declined/expired states and staff intake usability | Correct neutral wording; no hidden-person hints; trained walkthrough completes minimal intake in <=12 primary form interactions, excluding login and consent conversation; record actual count |

## Security and data lifecycle

| ID | Exercise | Pass benchmark |
| --- | --- | --- |
| SEC-01 | Cross-origin mutation, absent CSRF token, wildcard-origin attempt, state-changing GET | Unauthorized mutations rejected; legitimate same-origin flow works; no state change via GET |
| SEC-02 | HTML/script-like messages, SQL-like input, oversized body, role/owner injection | Text remains inert; queries/data intact; oversized request rejected; no unauthorized role/ownership mutation |
| SEC-03 | Scan API bodies, ordinary logs, exception logs, browser storage and frontend bundles with sentinels | Zero unapproved secret/location/message matches; audit contains metadata only; production errors lack stack traces |
| SEC-04 | Staff suspension, ended task, invalid encrypted text/key, production cookie/header review | Each failure denies sensitive access; no plaintext fallback; configured cookies/CSP/cache policy verified in actual response headers |
| DATA-01 | Reauthenticated individual deletion and verified assisted deletion | Sessions/grants invalidated immediately; person payload hidden; purge completes within 24 hours under fixed clock; unrelated people unaffected |
| DATA-02 | Advance time across each documented request/job/token/case/audit retention boundary | Exactly policy-targeted data expires/purges; inactive case review task created; active explicitly extended case retained; no orphaned active grants |
| DATA-03 | Restore synthetic pre-deletion/pre-revocation backup into isolated DB and replay ledger | Deleted/revoked content cannot be served after restore readiness; backup window and key access documented |
| DATA-04 | Inspect stored credentials/private text; tamper ciphertext; rotate encryption key in synthetic environment | No raw secrets/plaintext protected text; tampering fails closed; versioned-key transition retains authorized decryptability; no sensitive output in reports |

## Performance benchmarks

These are challenge-prototype targets, not regional disaster-response capacity claims. Record OS, CPU, RAM, database/runtime versions, local versus remote DB, commit, and configuration. Use at least 2 vCPU/4 GiB for a comparable reference run; if different, document it. No real people in the load dataset.

Dataset: 10,000 person records, 50 shelters, 30,000 check-ins, 20,000 requests, and 5,000 grants. Mix incidents, permissions, expired grants, unassigned cases, and opted-in/closed profiles. Warm up for 30 seconds; measure for 60 seconds with 20 concurrent clients and at least 1,000 completed API operations. Run authentication separately so password hashing does not get hidden inside a simple-read metric.

| ID | Exercise | Pass benchmark |
| --- | --- | --- |
| PERF-01 | Mix authorized dashboard/task/report reads, denied reads, and check-in/request writes on stated dataset | p95 API latency <500ms excluding login/hash and cold starts; unexpected 5xx/network errors <1%; zero unauthorized payloads; record actual request count and per-route metrics |
| PERF-02 | Worker delivery under normal benchmark load; separate 100-login sample | p95 committed request-to-generic-notification <=5s; active browser sees update <=20s with 15s poll; login p95 <=1500ms on stated reference environment; no duplicate delivery |
| PERF-03 | Production initial-route assets and mobile throttled browser run | Initial JS <=250 KiB gzip; median LCP <=2.5s across 5 runs using fixed 390x844 viewport, 4x CPU slowdown, 1.6Mbps down/750Kbps up/150ms latency; no external map/font/tracker dependency; record cold start separately |

If a target fails, optimize and rerun or document a justified scope/target revision. Never call an unexecuted load test passed. CI may run a smaller regression load, but release evidence must include this profile.

## Deployment and submission

| ID | Exercise | Pass benchmark |
| --- | --- | --- |
| DEPLOY-01 | Open actual HTTPS URL in private browser; reload nested page; restart service | App/API reachable; secure sessions work; persistent data survives; readiness and background worker healthy |
| DEPLOY-02 | Self-service and assisted golden paths against fictional deployed data, plus outsider/revocation attack | Both stories work; unauthorized reads deny; revoked data no longer returned; no developer-session dependency |
| DEPLOY-03 | Follow README from clean checkout; inspect public repository and submission content | Setup/migrations/tests reproducible; working URL/repo/screenshots/scope/tradeoffs/full picture/AI notes present; no actual deployment secrets or real personal data |
| DEPLOY-04 | Run verify, performance evidence, deployed smoke, and acceptance traceability audit on release revision | Every required ID mapped to passing automated test or recorded manual evidence; zero required skips; report revision/time/environment and known limits honestly |

## Test evidence format

For each implemented ID, record test path/name, command, result, relevant report path, timestamp, and revision. For manual checks also record exact steps and observed outcome. A screenshot alone cannot prove backend authorization. Save performance raw summary and aggregate metrics without request payloads or credentials.
