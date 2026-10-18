# Phase 05: complete website experience and accessibility

Depends on: 04. Gate: UX-01 through UX-05 plus browser coverage of FLOW-01, FLOW-05, and FLOW-06.

## Deliverables

A coherent, usable website for individuals and busy shelter workers. Every essential workflow has empty, loading, success, denied, expired, and failure states. Backend security remains authoritative.

## Required pages

| Surface | Pages/functions |
| --- | --- |
| Public | Home/help, public shelters, signup, login, recovery |
| Individual | Dashboard, own privacy, check-ins, new request, outgoing requests, incoming review, shared responses, active grants, account/session controls |
| Staff | MFA, task queue, assisted intake, verified case workspace, request/response assistance, no-code route task, restricted referral |
| Coordinator | Scoped work allocation, unresolved lead review, transfer proposal/acceptance, case review/closure |

## Implementation steps

1. Make dashboard actions explicit: `Let someone know`, `Find someone`, `Review requests`, and `Manage sharing`. Staff see a separate work context with the current person's alias/reference clearly shown.
2. Use plain language: `last reported`, `share this check-in`, `no response available yet`, and `not submitted`. Avoid `live`, `verified family`, `person found`, and `safe now` unless the wording explicitly quotes a person's past report.
3. Provide an exact recipient-view preview before every disclosure and a clear choice of 24-hour/seven-day expiry. Keep unknown/declined/blocked outcomes indistinguishable to requesters.
4. Add accessible labels, error summaries, focus restoration, keyboard navigation, visible focus, adequate contrast, and non-color status text. Prepare strings for later translation without claiming translations exist.
5. Adapt layout to mobile phones, tablets, and desktops. Use text-based location cards; no map vendor, external fonts, tracking scripts, or heavy visual assets are required.
6. Provide empty states that explain the next allowed action without implying someone exists. On failures, keep unsent form content only in current memory, clearly mark it unsent, and retry with the same idempotency key. Do not persist private drafts locally.
7. Add shared-device completion/logout screen, inactivity warning, clearing of private query caches, and account-switch isolation. A back-button visit after logout must not display a previous person's details.
8. Implement background refresh/backoff without endless polling, hidden-tab polling, or silent session extension. Clear content when a refreshed grant has expired or been revoked.
9. Add public demo notices and concise help about private participation, lost credentials, no-phone assistance, and service limits. Make no claims about real-time rescue or emergency response.
10. Use Playwright auto-waiting assertions and isolated contexts. Capture fictional-only screenshots at specified viewport sizes. Add accessibility automation and record manual keyboard tests.

## Verification

- Complete the core flows with keyboard only; check focus after errors, dialogs, route changes, and expiry.
- Test 390x844, 768x1024, and 1280x800 viewports; no essential horizontal scrolling, overlap, clipped buttons, or unreadable messages.
- Disable the network before submission; no success toast/notification; retry once connected creates one record.
- Expire a staff session during a form; preserve no sensitive data after logout and show a clear reauthentication path.
- Run accessibility automation across the required pages and manual checks in UX-01 through UX-05. Repeat privacy JSON checks after UI changes to catch accidental fetch broadening.

## Exit evidence

Store screenshots and actual accessibility/browser results with paths in the handoff log. Distinguish automated accessibility findings from manual usability observations.
