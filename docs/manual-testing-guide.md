# Manual testing and next steps

Prepared 2026-10-19 (Asia/Shanghai) from the current source, acceptance catalog and Claude's handoff. **These are instructions, not recorded test passes.** No application tests were rerun when preparing this guide. Your screenshot establishes that the home page renders, not that the backend or privacy rules work.

Use fictional data throughout. Work through sections 1–19 locally; section 20 explains automated coverage, and sections 21–22 cover release and deployment. Allow several sittings, especially for staff workflows. Acceptance IDs below identify the requirements being exercised; a manual check does not completely verify every associated ID.

## 1. Prepare your test windows

1. Leave the terminal running `npm run dev` open. It starts **api, web and worker**. Keep Docker/PostgreSQL running. You do not need another worker process for development.
2. Use `http://localhost:5173` consistently. Do not switch between `localhost` and `127.0.0.1` during a session.
3. Prepare independent browser sessions: Chrome normal for the requester, Edge normal for the recipient, and Chrome Incognito for an outsider. Additional browser profiles work too. **Two ordinary tabs share a login; two Chrome Incognito windows also share a login while open.**
4. Create these fresh fictional accounts via **Create account**. Add a suffix if a username already exists. Choose local test passwords of at least 10 characters and privately retain each recovery secret.

| Window | Example username | Name others will see | Purpose |
| --- | --- | --- | --- |
| A | `manual.maya.1019` | Manual Maya | Requester |
| B | `manual.leo.1019` | Manual Leo | Recipient |
| C | `manual.noor.1019` | Manual Noor | Second recipient; no check-in |

5. Complete **I have written down my recovery secret → Continue**. Keep passwords/recovery/assistance/MFA secrets out of screenshots and test logs.
6. For staff later, use seeded accounts `worker.a`, `worker.a2`, `worker.b`, `coord.a`, `coord.b`. Read `SEED_PASSWORD` privately in your local `.env`; use the value after `=`. Do not paste the file into chat or publish it. If seed credentials were changed since seeding, the current value may not match the database.
7. Keep a result sheet: `Test number | PASS/FAIL/NOT RUN | actor | steps | expected | actual | time | screenshot`. Use unique introductions such as `MANUAL-04 safety` to identify requests.

**Rate limits:** the documented default is 10 new requests per requester per hour, 5 failed logins per username per 15 minutes, and 50 login attempts per IP per 15 minutes. Spread the later scenarios over separate test accounts or sittings. A 429 means rate-limited, not that a person was found. Do not disable protection to make a walkthrough pass.

## 2. Public pages and registration

Acceptance: FND-02, AUTH-01, AUTH-02, UX-05.

1. Before signing in, open Home, **Shelters**, and **Help and limits**. Refresh each page.
2. Confirm the fictional-demo notice is visible. Shelters should show public facilities, not residents or resident counts. There should be no public people directory and no GPS prompt.
3. Open `/check-ins` while signed out. It should require sign-in rather than disclose a person's information.
4. On signup, try blank fields and a short password once. Errors should explain what to fix without crashing. Complete signup with username, password and alias only; no phone, email or ID should be required.
5. Sign out. Compare one wrong-password attempt for your test account with one unknown-username attempt. Both should give the same generic credential error.
6. Sign in correctly. On a fresh account, check `/check-ins`, `/requests/incoming`, `/requests/outgoing`, `/sharing`, and `/shared`. Each should show an understandable empty state.

**Pass:** public navigation works, private pages require login, and registration needs no personal identifying documents or contact details.

## 3. Historical check-ins

Acceptance: CHECK-01, CHECK-02, CHECK-03.

1. In B as Manual Leo, open `/check-ins` → **Add a check-in**.
2. Select **At a shelter**, choose **Hillcrest School Gym**, and enter an observation time roughly one hour ago. Save.
3. Confirm the card identifies a past report, includes the observation time/timezone and source, and does not assert current presence.
4. Add another report using **In an area (no shelter)**, choose an area, and set the observation time two days ago. Expect an **Older report** label. Entering this later must not make it the newest observation.
5. Attempt a report dated one hour in the future. Expect rejection and no extra saved report.
6. Refresh. Both valid reports should remain. Check that no GPS permission was requested.
7. Keep the Hillcrest report active for the sharing tests below. Test correction/departure in section 7 after sharing it.

## 4. Send a request and share a message only

Acceptance: FLOW-01, PRIV-03.

1. In B, open `/privacy` and leave **Contact code only (default)** selected. Click **Create contact code** (or **Replace contact code** if already created). Copy the code displayed once.
2. In A, open `/requests/new`. Select **With their contact code**, paste B's code, and enter `MANUAL-04 safety: Maya asking for a message.`
3. Check the introduction preview, then click **Send private request**. Expect **Request saved**, with no confirmation that Leo exists or received it.
4. In A, open `/requests/outgoing`. Before Leo answers, expect **No response available yet**.
5. In B, open `/requests/incoming`. Allow background delivery, then refresh if needed. Within about 20 seconds is a useful local diagnostic target; repeated absence warrants checking the worker terminal. Do not send duplicate requests to force delivery.
6. Find the exact introduction → **Answer** → **A message only**. Add `MANUAL-04 reply: I will be in touch.` Select **24 hours**.
7. Inspect **Exactly what Manual Maya will see**. It should contain the chosen statement/note and explicitly no location. Do not type a location into the free-text note for this test.
8. Click **Review and share**, then **Confirm: share with Manual Maya**.
9. In A, refresh outgoing requests → **View response**. Compare it with the preview and save the response URL for later tests.

**Pass:** Maya gets only the chosen message. Creating a request alone disclosed nothing; Leo's own check-ins were not automatically included.

## 5. Share approximate area, then named shelter

Acceptance: FLOW-02, PRIV-03.

Each request accepts one response. Send a **new request** for each scope; do not try editing an already approved answer.

1. Repeat section 4 with introduction `MANUAL-05 area`.
2. In B's answer, select **Message and the approximate area of one check-in** and choose the Hillcrest report from **Which check-in**.
3. Check the preview, approve, and open the response in A. It should show the area and observation time/source, but **no shelter name or address**.
4. Repeat with `MANUAL-05 shelter`, selecting **Message and the named shelter of one check-in**, the same report, and **7 days**.
5. Check the preview and final response: Hillcrest's name/public address may now appear, with historical wording and observation time/source. Confirm the displayed expiry agrees with your choice.
6. Preserve both response URLs.

**Pass:** the three separate responses disclose three distinct scopes. An area choice must not silently expose a shelter.

## 6. Check actual API bodies and outsider access

Acceptance: FLOW-03, FLOW-04, PRIV-02, PRIV-03, SEC-04.

1. In A, press F12 → **Network** → **Fetch/XHR**. Reload the area response.
2. Select the request whose path is `/api/v1/responses/<id>` → **Response**. Inspect this specific response, not the separate public shelter directory request.
3. Expect the approved area/time/source only. It must not contain a shelter name/address, coordinates, internal person/case/staff identifiers, or check-in history. For message-only, no location object should appear. The response identifier itself is expected.
4. Check that the private API response has `Cache-Control: no-store`.
5. Before revoking anything, paste A's shelter-response URL into C as Manual Noor. Expect **This answer is not available**. The corresponding API call should be 404 with no shared message/location in its body.
6. To test the API directly, use the same response ID in the browser address bar: `http://localhost:5173/api/v1/responses/<id>`. In authorized A it should return the approved JSON; in unauthorized C it should return neutral 404. While signed out it should return 401. These are read-only requests.
7. From C, send B a new request. Have B share an **area-only** answer with C. Noor should be able to receive it without creating any check-in.
8. Confirm C still cannot open A's shelter response; A cannot open C's response; B has gained no reciprocal permission to Noor's location or profile.

**Pass:** knowing a URL does not grant access, and permissions differ per recipient. A hidden UI field is insufficient if its value appears in the API body.

## 7. New reports do not extend old shares

Acceptance: CHECK-03, PRIV-07.

1. In B, add a new report at **Riverside Community Center**, with a later observation time.
2. In A, reload the old Hillcrest response. It must not change to Riverside or reveal a new history entry.
3. In B, locate the original shared Hillcrest report → **Correct this report**. Save a correction using a different place or time.
4. Reload A's old response. Expect the old report to be marked no longer current, without exposing the correction's destination/time as newly shared information.
5. On another active report, click **I have left this place**. Confirm it remains in history as departed. To check the recipient side of departure too, first share that report through another request, then mark it left and reload the recipient's response.

**Pass:** correcting or departing an old report does not transfer its grant to a replacement or future report.

## 8. Revocation and closing requests

Acceptance: PRIV-04, PRIV-05.

1. In B, open `/privacy` → **Closed** → **Save setting**.
2. In A, reload an existing active share. It should remain readable: closing incoming requests and revoking existing shares are distinct actions.
3. Send one new request using B's code. A should receive neutral saved/pending wording; B should not receive a new incoming request.
4. In B, reopen **Contact code only (default)** and save.
5. Open `/sharing`. Find a particular share → **Revoke**. Wait for the operation to complete.
6. In A, reload its saved response URL and direct API URL. Expect unavailable/404, with no approved note/location in the new response. Try any old notification link too.
7. Confirm B's other active shares still work for their intended recipients.
8. In B, click **Revoke everything shared**. Test **Cancel** first; shares should remain active. Reopen and confirm **Revoke all**. Both A and C should lose access on their next reads.

**Pass:** revocation stops subsequent retrieval. Already viewed text or screenshots cannot be erased; do not mistake an old Network-panel entry for a new authorized read.

## 9. Ignoring, declining, unknown codes, rotation, withdrawal and blocking

Acceptance: PRIV-01, PRIV-05, FLOW-01. Use a fresh requester for this group if near the hourly limit. Do blocking last for that requester.

1. Send a request to B and leave it unanswered. Record the requester's **No response available yet** wording.
2. Send another → in B choose **Decline privately**. B may see its own decision; the requester must still see the same neutral wording, not declined/read/found.
3. Submit a well-formed unknown code such as `0000-0000-0000-0000-0000-0000-00`. Expect the same saved/pending result. A too-short code may correctly get a format error; that is a different test.
4. In B, replace the contact code. Test a new request using the old code and then a new request using the new code. Both submissions look neutral to the requester; only the new code should deliver to B. Rotation should not erase already-delivered requests or existing grants.
5. Send a request, then in the requester's outgoing list click **Withdraw** before B approves. Refresh B's inbox. A subsequent approval must not create a usable response.
6. Establish a fresh active share from B to this requester. Then send another request from that same requester to B.
7. In B, on the new pending request choose **Block this sender** → **Block**. Confirm the previous share is now unavailable to that requester.
8. A further request from the blocked account should still look neutrally submitted to its sender but should not arrive in B's inbox.
9. On a suitable request/response, exercise the **Report** control and its category selection. Expect confirmation, not a claim of emergency intervention. Avoid including extra personal narratives.

**Pass:** none of these hidden outcomes confirms the target's existence, reading, decision or whereabouts to the requester.

## 10. Staff login and MFA

Acceptance: AUTH-05.

1. Use a separate browser profile for staff, or sign out of a finished personal test session.
2. Sign in as `worker.a` with the local seed password. Attempt `/staff` before completing MFA. Staff tools should remain unavailable until verification.
3. On first use: confirm the password → **Start setup**. Add the displayed setup key to your authenticator as a time-based account (6 digits, 30 seconds). Enter its current code → **Verify**.
4. Privately save the staff recovery codes → **I saved them, continue**. On subsequent logins, use the previously enrolled authenticator; do not expect setup to repeat.
5. Repeat enrollment when needed for `worker.b`, `worker.a2`, `coord.a`, and `coord.b`. Keep authenticator entries labeled by username. If a just-used code is rejected on another login, wait for the next code: same-step replay is deliberately rejected.
6. Once, try an incorrect MFA code. It should fail without showing staff data. Optionally test a saved MFA recovery code on a later login, then confirm that same recovery code cannot be used again.

**Pass:** an ordinary signup cannot become staff, and a staff password alone does not unlock staff work. The authenticator is for the worker; the assisted person still needs no device.

## 11. New intake and repeat assistance without an account

Acceptance: FLOW-05, STAFF-01, STAFF-02, UX-05.

1. In `worker.a`, open **New intake (person without account or phone)**.
2. Enter `Manual Sam`. Leave the default request mode/check-in setting, and check **Create a contact code the person can give to family** so you can test assisted replies later.
3. Try saving without intake consent; it should fail. Check **The person agreed to this intake…**, then **Save intake**.
4. Privately retain the reference, assistance secret and contact code as **three different items**. The reference identifies the record; the assistance secret authorizes repeat assistance; the contact code routes incoming requests.
5. Click **Open the case**. Confirm **Acting for: Manual Sam**, the worker's own login, and a staff-recorded historical check-in. Sam has no username/password or personal device.
6. Record the case URL and reference for later tests. Count the interactions for a separate minimal intake: type alias, check consent, save should take 3 primary form interactions with defaults, below the catalog's 12-interaction ceiling. Record your observed count.
7. Click **End assistance now**. Check-ins/messages and sensitive action controls should disappear until verification.
8. Try the case reference in **Assistance secret**, then one wrong secret. Neither should unlock assistance. Use the actual secret → **Verify**; the workspace should return.
9. End assistance, then choose **Person lost their secret: open manual escalation**. Expect escalation without access to private details. A correct later verification may restore ordinary assistance; escalation itself must not do so.
10. From separately logged-in `worker.a2`, then `worker.b`, paste Sam's case URL. Both should get **Case not available** and no private case content. Confirm the `/api/v1/staff/cases/<id>` request is 404.

**Pass:** same-shelter staff are not automatically authorized, and a reference card alone does not unlock a repeat visit.

## 12. Assisted requests, replies and privacy decisions

Acceptance: FLOW-05, STAFF-04, STAFF-08.

1. In B as Manual Leo, ensure incoming requests are open and obtain the current contact code.
2. In verified Sam's workspace as `worker.a`, click **Send a request for Manual Sam**, enter Leo's code and a unique introduction, and submit.
3. In Leo's inbox, answer that request with a message or one approximate-area report.
4. In Sam's verified workspace, refresh → **View answer with the person**. Confirm the answer is addressed to Sam, not generally available to everyone at Riverside.
5. End Sam's assistance and reload that answer URL. Its contents should no longer be available until Sam is verified again.
6. Reverse the direction: from an unblocked personal requester, send a request to Sam's contact code. In Sam's verified workspace, **Answer**, inspect the exact preview and confirm Sam's simulated decision. Verify the requester receives only that scope.
7. Revoke that share from **What Manual Sam has shared** and verify the requester loses access. Repeat a pending request with **Decline privately**, and another with **Block this sender** if needed, using a disposable requester for blocking.
8. Test an assisted outgoing **Withdraw** and a privacy change via **Save the person's choice**. They should have the same effects as the personal-account versions.
9. In a verified staff check-in form, test **Copied from a paper intake sheet** with an older observation time. The report must retain that observation time and identify staff recording; it must not imply it was delivered during an outage.

## 13. No-code request through one shelter

Acceptance: FLOW-06, PRIV-08, STAFF-05, STAFF-06.

Use a fresh intake rather than seeded Ana so you have its actual assistance secret.

1. As `worker.b`, create `Manual Ana` at Hillcrest. Choose **Contact code and shelter-assisted matching**, enter a fictional distinguishing clue such as `manual blue scarf`, and record the simulated intake consent. Save the reference and assistance secret privately.
2. From a personal requester, open `/requests/new` → **Without a code: ask one shelter's team to help**.
3. Enter `MANUAL-13 Ana, manual blue scarf` in clues; choose **Hillcrest School Gym**. First try without relay consent: it should not route successfully. Then check the agreement to share clues with Hillcrest's team and submit with a unique introduction.
4. As `coord.b`, open `/staff` and find that exact clue in **Requests routed to your shelter**. Select `worker.b` → **Assign matching task**.
5. As `worker.b`, refresh staff work → **Open matching task**. Confirm the task is the right one. Candidates should contain minimal local opted-in information, not full histories or messages. Seeded code-only Bo and closed Cy should be absent.
6. Choose **Propose Manual Ana** → **Confirm: deliver request to Manual Ana**. This is a proposal, not consent to disclose.
7. Check the requester now: still **No response available yet**, with no candidate names/counts or match confirmation.
8. As `worker.b`, open Manual Ana's case and verify her secret if required. Find the incoming request and record the simulated decision with **Answer**, the scope, preview and confirmation.
9. The requester should now receive only Ana's approved response.
10. Separately send a no-code request with **I don't know yet** as the shelter. It should remain neutral/unresolved. Use **Add or change shelter lead** to choose a shelter and give fresh relay consent. Test changing an unresolved lead before any recipient proposal; the former team should lose its matching-task access after rerouting.

**Pass:** no broadcast or global people search; a staff proposal does not itself reveal a person to the requester. An unresolved request without a lead, or sent to a shelter with no staff, is a documented prototype limitation.

## 14. Transfer a case between shelters

Acceptance: STAFF-07.

1. Finish Sam's earlier tests, then as verified `worker.a` open his case → **Move this case to another shelter**.
2. Choose Hillcrest. Try **Propose transfer** without the person's choice checked: expect rejection. Then check **The person chose to move their case there** and propose.
3. As `coord.b`, refresh `/staff`. The pending transfer should expose only the permitted transfer summary, not Sam's full check-ins/messages.
4. Select `worker.b` under **Assign to**. Try a wrong assistance secret: acceptance should fail and source responsibility should remain.
5. Enter Sam's correct assistance secret → **Verify and accept transfer**.
6. As `worker.b`, refresh assigned cases and open Sam, verifying the person again where required. Destination assistance should now work.
7. As `worker.a`, reload the old case URL and any Sam answer URLs. Old source access should fail. `worker.a2` should remain unauthorized. Unrelated cases should be unaffected.

**Pass:** a case transfer changes responsibility and does not automatically approve any new disclosure to family.

## 15. Restricted referrals and coordinator boundaries

Acceptance: STAFF-03, PRIV-08, STAFF-08.

1. As a worker, create a new fictional intake `Manual Restricted`, checking **Child or person who cannot consent: restricted referral**. Follow the form's applicable consent requirements without fabricating a consent-capable guardian decision.
2. Expect a minimal reference/referral record. It should issue no normal assistance/contact secret and offer no ordinary check-in, sharing or matching workflow.
3. Do not try to make a family claim unlock it; the prototype has no automatic guardian verification/reunification.
4. As `coord.a`, inspect **Case allocation**. Expect references/activity/assignment metadata, not a global personal-history view.
5. Create a separate disposable ordinary case as `worker.a`. Confirm `worker.a2` is denied before assignment. In `coord.a`, assign that case by its reference to `worker.a2`. The worker should then still need the person's assistance secret for sensitive content; the coordinator should not gain that access merely by assigning it.
6. On a separate finished disposable case, test coordinator **Close case**, then confirm ordinary worker assistance is denied. Do not close Sam or Ana while their other scenarios remain unfinished.

## 16. Logout, account recovery and session expiry

Acceptance: AUTH-03, AUTH-04, UX-04.

1. On a private page, **Sign out**, press Back, then refresh. No previous person's check-ins/messages should reappear. Direct private API reads should return 401.
2. In the same browser, sign in as a different test person. Check `/check-ins`, outgoing/incoming requests and `/shared`; there must be no previous-person content.
3. Use a disposable account for recovery. In `/account`, test **Replace recovery secret**: a wrong password fails, and the correct password displays a new secret once. Save it privately.
4. Keep that account signed in in one independent browser and use `/recover` in another. Test the replaced old secret and contact code as recovery credentials: both should fail. Recover with the current secret and a new password.
5. Save the newly issued recovery secret. Confirm the old password fails, the new password works, replaying the consumed secret fails, and the previously signed-in browser loses access on its next request.
6. For a natural expiry test, leave an ordinary session untouched for over 30 minutes or a staff login for over 15 minutes. Background polling must not keep it alive indefinitely. Attempt a private read/write; expect reauthentication without exposed previous-person data.
7. For assisted verification, keep the staff login active while letting the person's 10-minute assistance verification expire. Reopen/refresh the case and attempt a sensitive action: the person's secret should be required again.
8. For a faster failure-path check, delete only the local site's session cookie in DevTools while a form is open, then submit. Expect a clear session-ended/sign-in path and no saved success. This simulates missing authentication; it does not prove server-side natural timeout.

## 17. Failed submissions, repeat clicks and restart persistence

Acceptance: UX-03, CHECK-04, DB-03; partial REL-01.

1. On a fresh request form, enter a valid code and a unique introduction. In F12 → Network, select **Offline** before submitting.
2. Submit. Expect an error/unsent state, no **Request saved**, and the draft still present in the open form.
3. Restore **No throttling/Online** and retry the unchanged form. Expect exactly one request in outgoing history. Try rapid double-clicking Save on a separate check-in; it should create one result.
4. While the app is running, look in DevTools **Application → Local Storage, Session Storage, IndexedDB**. There should be no passwords, recovery/assistance secrets, private messages, locations or durable private drafts there. An HttpOnly session cookie is expected under Cookies.
5. To simulate backend unavailability, load a form, stop `npm run dev` with Ctrl+C, and attempt submission in the already-open page. Expect failure without a success claim. Restart `npm run dev`, let it become ready, and retry if the draft remains. If the tab reloaded and lost the draft, that is not durable offline support.
6. Refresh valid reports and requests created earlier. They must still exist after application restart. Do not reset the database or rerun seed as a restart step.

**Limits:** clicking twice is not proof of database race safety, and disconnecting before a save does not test a response lost after a committed save. Controlled retry/race tests remain automated gates.

## 18. Keyboard, mobile, readable content and text safety

Acceptance: UX-01, UX-02, UX-05, SEC-02.

1. Repeat signup, check-in, request, answer/preview/revoke and staff intake using Tab, Shift+Tab, Enter, Space and arrow keys. Focus must be visible; skip navigation, labels, errors, dialogs and confirmation actions must be usable without a mouse.
2. Test widths/heights **390×844**, **768×1024**, **1280×800** using browser responsive mode. Check public pages, long navigation, forms, preview, shared response, staff workspace and coordinator table. No clipped essential actions or horizontal page scrolling.
3. Test browser zoom at 200%. Long fictional aliases/messages should wrap without hiding controls. If the large black outline from your screenshot persists, record whether it appears only with focus or also blocks/clips content; it cannot be diagnosed from that screenshot alone.
4. With a screen reader such as Windows Narrator, test headings, field names, errors, route changes and confirmation dialogs. Record this separately from automated accessibility results.
5. Send an introduction containing literal `<b>fictional test</b>`. It must display as text, not bold HTML. Full script-injection coverage belongs to the security suite.
6. Read help/empty/pending/declined states: no live-location, verified-family, emergency-monitoring or delivery/read claims. Notifications should remain generic and their links must recheck access.
7. Capture fictional-only screenshots with secrets hidden. Do not include raw cookie values or authenticated Network exports.

## 19. Deletion and expiry — finish with these

Acceptance: DATA-01, PRIV-04; manual portion only.

1. Create a disposable personal account, a check-in, and a share to another test person. Retain the share URL.
2. In the disposable account's `/account`, choose **Delete my account**. Test cancellation and a wrong confirmation password first; these should preserve the account.
3. Confirm deletion with the correct password. It should sign out, reject future login/private reads, and make the retained share unavailable to its recipient immediately.
4. Create a disposable assisted case and share, then use its verified workspace → **Delete at the person's request** → **Confirm deletion**. Confirm case content and related shares are no longer accessible.
5. Verify unrelated test people still work. These browser checks establish immediate access denial, not the database purge itself (the purge runs in the deletion transaction and is checked by the integration tests).
6. If convenient, leave a dedicated 24-hour share and check its URL after its actual expiry. Expect unavailable/404. Otherwise mark manual expiry **NOT RUN** and retain the fixed-clock automated expiry evidence. Do not change your system clock to force it; that can break staff MFA.

## 20. Run the automated gates

Manual testing complements these checks; it cannot establish transaction safety, stored-secret protection, full authorization coverage, purge/restore behavior or benchmark performance.

In a second PowerShell terminal in the project directory, with Docker/PostgreSQL available:

```powershell
npm run verify
```

This script actually exists and runs docs validation, lint, typecheck, build, unit, real PostgreSQL integration, security, browser and automated accessibility checks. It stops at the first failing stage. The browser runner creates its own disposable database and uses port 3100 by default; do not point test administration settings at a production database.

Claude recorded a previous passing run: 21 unit, 85 integration, 14 security, 21 browser, 4 accessibility tests. Treat these as historical evidence, not this run's expected proof; capture your actual command, exit status and summary. If browser binaries are missing, install the project's Chromium with `npx playwright install chromium`, then rerun the failed stage/full gate as appropriate.

Run performance separately after fixing blockers, with other heavy work stopped:

```powershell
npm run build
npm run test:performance
```

Record the actual environment and metrics. A laptop benchmark does not establish deployed capacity.

| Requirement group | Why the automated tests are still needed |
| --- | --- |
| FND-01/03/04, DB-01/02/03 | Clean install, secret scans, document parity, DB constraints, migrations |
| AUTH-03/04/05/06 | Absolute expiry, credential replay, suspension and deterministic limits |
| CHECK-04, REL-01..04 | Version conflicts, concurrent retries/approvals/transfers, worker crash/retry/recheck |
| PRIV-01..08, STAFF-01..08, SEC-01..04 | Full API bodies, spoofed subjects/roles, CSRF/origin, task/shelter/incident boundaries |
| DATA-01..04 | Actual purge timing, retention, encrypted data/key behavior, isolated restore and ledger replay |
| PERF-01..03 | Reproducible measured load and browser performance |
| DEPLOY-01..04 | Requires the real deployment, clean checkout and final release evidence |

The authoritative mapping is [test traceability](test-traceability.md), with full requirements in [acceptance tests](acceptance-tests.md). Review both; a green suite alone cannot prove coverage of an omitted case. Do not run destructive restore/retention experiments manually against your development data or deployed database.

## 21. Triage results before publishing

1. Record each failure with actor/role, page, precise steps, expected/actual behavior and safe screenshot. Note relevant API status and only the necessary redacted response fields. Never attach `.env`, cookies, MFA/recovery secrets or an unredacted HAR.
2. Fix unauthorized reads, overly precise responses, revocation failures, sensitive shared-device leftovers and misleading request outcomes before publication. Reproduce each fix with a meaningful regression test and repeat the affected manual scenario.
3. Review the seven deferred findings in [progress](progress.md). The log labels them minor, but it includes a coordinator response-state distinction, a transfer-secret check ordering issue and an assignment-change race. Their privacy/authorization effects deserve explicit resolution or convincing evidence before release; do not treat the label as a waiver.
4. Record usability defects separately, including confusing labels or the home-page outline. A good-looking home page is not a substitute for the privacy checks.
5. Update `docs/progress.md` and `docs/test-traceability.md` with actual manual/automated evidence. Do not mark an entire acceptance ID passed from a superficial UI check.

## 22. Proceed to deployment and submission

1. Finish the local checks, resolve release-blocking findings, and rerun affected checks plus the full release gate.
2. Review the intended public files for secrets and fictional-data-only screenshots. Create a Git commit and public repository when ready; do not blindly stage `.env`, runtime logs or raw test/network exports. Record the release revision.
3. Select a host using current official provider documentation. This project needs a running **web service, background worker, PostgreSQL, HTTPS, runtime secrets and migration commands**. A static frontend host alone is insufficient. Hosting options/costs have not been evaluated in this guide.
4. Follow [deployment guide](deployment.md): fresh deployment keys, exact public `APP_ORIGIN`, migrations before startup, guarded fictional seed, and separate web/worker process commands. Do not use database reset, `db push`, or development migrations on the deployment.
5. Run the existing smoke script against the real URL (replace the example first):

```powershell
npm run smoke:deployed -- --base-url https://YOUR-ACTUAL-HOST
```

It creates fictional smoke accounts; it is not a full staff/UI walkthrough.

6. Open the actual HTTPS URL in a fresh private session. Repeat signup, historical check-in, request, all three response scopes, outsider denial and revocation. Repeat the assisted and no-code stories with real staff MFA. Reload a nested route.
7. Inspect the deployed session cookie: HttpOnly, Secure and SameSite=Lax; verify private responses are no-store. Plain local HTTP is not evidence for production Secure-cookie behavior.
8. Restart the deployed services and verify data persists and queued delivery resumes. Check the provider's worker/readiness status and record cold starts. Exercise provider backup/restore only with an isolated restoration and the ledger procedure before claiming that operational step verified.
9. Test README setup from a clean checkout. Add the working website and public repository links, screenshots, guided reviewer story, tradeoffs, limits, actual test evidence and AI-use notes. Use dedicated staff reviewer accounts with genuine MFA or a recorded fictional walkthrough; never publish infrastructure/operator credentials.
10. Record DEPLOY-01..04 with release revision, time/timezone, environment and results. The challenge remains undeployed until the actual public URL and its required workflows pass.

Suggested next instruction to your coding agent after you finish the manual checks:

> Read docs/progress.md and docs/manual-testing-guide.md. Here are my actual manual results: [paste sanitized results]. Reproduce and fix failures without weakening the privacy rules. Review the deferred privacy and concurrency findings before release. Add regression coverage, run the applicable checks and full verification, and record evidence. Then prepare deployment for my selected provider and repository; do not claim it deployed until the live URL, staff walkthrough and deployed smoke checks pass.
