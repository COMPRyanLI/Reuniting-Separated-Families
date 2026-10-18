# Browser testing results — 2026-10-19

Environment: Windows, local PostgreSQL, development site at `http://localhost:5173`; observations around 02:24–02:31 Asia/Shanghai. Codex tested the live development site through the in-app browser and ran the existing Playwright Chromium suite against the production build and disposable PostgreSQL databases. No deployed environment was tested.

## Direct checks on the running development site

Created only three new fictional accounts: `qa.leo.mve5mfic`, `qa.maya.mve5mfic`, and `qa.outsider.mve5mfic`. Existing seeded accounts and staff MFA settings were not changed. Used explicit sign-out/sign-in between actors in one browser session; this is a shared-device check, not independent simultaneous browser-context coverage. The automated suite separately uses isolated contexts.

| Observed scenario | Result | Acceptance coverage exercised |
| --- | --- | --- |
| Home and public shelter directory | PASS: demo notice, public facility details, no resident listing | FND-02, CHECK-01 (public surface only) |
| Three fictional signups | PASS: username/password/alias only, recovery-secret screen and dashboard | AUTH-01 |
| Shelter check-in | PASS: saved Hillcrest report, observation time/timezone, source and uncertainty warning | CHECK-01/02 (display portion) |
| Logout then Back | PASS: redirected to sign-in rather than showing former account's private page | AUTH-03, UX-04 |
| Three contact-code requests | PASS: neutral saved/pending status before approval; recipient received introductions | FLOW-01, PRIV-01 (valid-code path only) |
| Message-only response | PASS: exact preview and requester view contained message/note, no location; selected 24-hour expiry displayed correctly | FLOW-01, PRIV-03 (UI only) |
| Approximate-area response | PASS: Hillcrest area and observation time/source without shelter name/address in preview or requester view | FLOW-02, PRIV-03 (UI only) |
| Named-shelter response | PASS: named Hillcrest report/public address with historical wording and seven-day expiry | FLOW-02 |
| Unrelated account opens known active shelter-response URL | PASS: unavailable page with no disclosed report | FLOW-04, PRIV-02 (UI only) |
| Cancel revoke-all | PASS: all three grants remained active | PRIV-04 |
| Confirm revoke-all | PASS: three grants became revoked | PRIV-04 |
| Original authorized requester reopens each of the three URLs | PASS: every scope unavailable; outgoing list showed neutral Response unavailable | PRIV-04 |
| Finish | Signed out of the test browser | UX-04 |

These are scenario results, not claims that every associated acceptance ID is fully satisfied. Direct browser checks did not inspect private network response bodies. API-denial assertions in the automated browser suite provide separate, narrower evidence.

Input limitation: two attempts to fill the datetime-local control through the in-app automation showed a future value in the DOM, but submission reverted to the current time and saved two current-time fictional reports. The direct future-date check is therefore **inconclusive**, not a passing validation check or a confirmed product bug. The existing Playwright future-date rejection test passed in the clean run. A subsequent login attempt also encountered browser input/focus issues; normal sequential keyboard entry succeeded. These observations do not establish a reproducible application defect.

## Automated browser execution

- `npm run test:e2e`: initial restricted attempt could not build because esbuild encountered filesystem access denial. Retried with approved execution access; production build and migrations succeeded.
- During the first runnable suite, Codex incorrectly started accessibility concurrently. Both runners use port 3100 and the same Playwright report/artifact directories. That overlap produced missing trace-artifact errors and later connection failures. The E2E attempt ended 20 passed / 1 failed; the overlapping accessibility attempt ended 4 failed. **Neither overlapping run is release evidence.**
- `npm run test:e2e -- --no-build`: clean sequential rerun, **exit 0, 21 passed in 2.1 minutes**, no retries/skips. Database `rf_test_e2e_f3d30dab`; uses the successfully built artifact from the earlier build. Test runner performs its own disposable database cleanup.
- `npm run test:a11y -- --no-build`: clean standalone run, **exit 1, 3 passed / 1 failed in 34.1 seconds**. Public/individual and staff critical/serious automated scans passed, as did failed-login error focus. The keyboard-only journey failed at `tests/e2e/a11y.spec.ts:123`: after ArrowDown on the Shelter select, its value stayed empty. Database `rf_test_e2e_e8ed2e06`.
- `npm run test:a11y -- --no-build --grep "keyboard-only"`: unchanged targeted reproduction, **exit 0, 1 passed in 2.7 seconds**, database `rf_test_e2e_daa055fe`. Treat this as an intermittent keyboard-test failure, not a clean full accessibility gate. A possible cause is that the test waits for the form but does not wait for asynchronously loaded shelter options before pressing ArrowDown; this is a source-based hypothesis, not a proven diagnosis. No code or assertion was changed to obtain the passing retry.

The 21-test run covered signup/HttpOnly cookie/web storage, generic credential errors, logout/back/account-switch/session-loss behavior, historical shelter/area check-ins and future-date rejection, request/message/revocation/outsider behavior, assisted request and answer retrieval, no-code coordinator/worker/recipient workflow, offline and simulated 500 submission failures with retry, neutral decline/empty states, inert script-like text, public/nested routes at mobile/desktop sizes, DB readiness, frontend secret-sentinel scan, screenshot journeys at 390×844/768×1024/1280×800, and assisted intake/repeat-secret verification/unassigned-worker denial.

## Screenshots

- [Authorized fictional shelter response](../evidence/browser-qa-2026-10-19/authorized-shelter.jpg)
- [Unrelated account denied](../evidence/browser-qa-2026-10-19/outsider-denied.jpg)
- [Previously authorized requester denied after revocation](../evidence/browser-qa-2026-10-19/revoked-response.jpg)
- [Keyboard-journey failure screenshot](../evidence/browser-qa-2026-10-19/keyboard-failure.png), with [saved failure context](../evidence/browser-qa-2026-10-19/keyboard-failure-context.txt)

The existing browser suite also refreshed its configured images under `evidence/screenshots/`. The screenshots are evidence of visible results, not proof of every backend permission rule.

## Remaining work

No application source was changed. The three fictional accounts, two current-time reports, three requests and revoked grants remain in the development database. No user data was deleted, existing staff authenticator enrollment changed, or service restarted.

This task did not run the complete `npm run verify`, integration/security suites, performance benchmarks, natural long-duration expiry, password recovery, manual screen-reader testing, transfer/deletion/restore scenarios, or deployment checks. Historical evidence for those is distinct from this run. Previously deferred privacy/concurrency findings in `progress.md` remain unresolved. Next: diagnose the intermittent keyboard journey and triage the deferred findings, run full release verification, then select hosting and complete phase 07.
