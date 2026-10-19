# Design and tradeoffs

This is the explanation behind Reconnect: how the problem was broken down, who it serves, what was built and why, how the rest of a real system would work, the edge cases considered, and the tradeoffs made. The detailed specifications are in [design.md](../design.md), [security-and-permissions.md](security-and-permissions.md) and [data-and-api.md](data-and-api.md).

## 1. Breaking the problem down

A hurricane scatters 400,000 people across shelters, hotels and relatives' homes. Many have lost phones and ID. Some do not want to be found. Shelters keep their own records, some on paper, and their staff are stretched and mostly not technical.

"Help families find each other" splits into four smaller problems:

1. **Leaving a trace:** a person records where they are (or were) in a way that does not expose them.
2. **Reaching someone:** a person asks to be put in touch with someone specific.
3. **Deciding what to reveal:** the person being looked for chooses whether to answer and what to share.
4. **Taking part without a phone:** all of the above through shelter staff.

The dangerous part is not search; it is **disclosure**. A tool that lets anyone type a name and see where a person is would also help an abusive partner, a trafficker or an immigration informant find someone who fled. So the core problem chosen is: **route a request to the right person and let that person, alone, decide what to disclose.** Everything else in the system can be imperfect; this part cannot.

## 2. The people

| Person | Situation | What they need |
| --- | --- | --- |
| Separated adult with a phone | Worried, wants answers fast | Be findable by the people they choose; ask after others; see what came back |
| Person without phone, account or ID | Lost everything, at a shelter | Take part at all, with staff, using only things they can keep on paper |
| Person who does not want to be found | Fled an abusive partner, or fears giving a real name | Look for family without being exposed; never be revealed by the system |
| Shelter worker or volunteer | 2 a.m., clipboard, queue of families | A few clear steps; no judgement calls about who is "really family" |
| Shelter coordinator | Responsible for the shelter's cases | Hand out work and move cases without reading everyone's details |
| Child or person who cannot consent | Separated from carers | Protection, not self-service matching |

## 3. What was built, and why this part

Built (live at <https://reconnect-web.onrender.com>):

- Accounts with a username, password and **alias only**: no email, phone or ID. A one-time **recovery secret** replaces email recovery.
- **Check-ins** as history ("where I was, when"), never live location.
- **Contact codes** a person gives to people they want to hear from.
- **Private requests**, by code or by asking one shelter's team; the requester learns nothing unless the person answers.
- **Per-recipient sharing**: a message only, the approximate area of one check-in, or the named shelter of one check-in, for 24 hours or 7 days, with an exact preview, revocable.
- **Shelter staff tools**: intake for people without devices, a private **assistance secret** for later visits, acting on the person's behalf, coordinator assignment of no-code requests, worker matching limited to people who opted in, case transfers, restricted referrals for children, and deletion on request.
- Lifecycle: deletion with immediate purge, retention jobs, a restore ledger so a restored backup cannot bring back deleted data.

Why this part: it is where real harm happens, and it is the part no existing paper process or shelter spreadsheet can do safely across shelters. Search, maps, notifications and integrations are valuable but can be added around a safe core. A safe core cannot be added around an unsafe search.

## 4. How the rest of the system would work

| Piece not built | How it would work and connect |
| --- | --- |
| Paper-only shelters | Staff fill a one-page intake form; a central data-entry team keys it in later as staff-recorded check-ins with the original observation time (the model already separates observed and received times). Reference cards and assistance secrets are printed on site. |
| Existing tracing services (for example national Red Cross family-links services) | Reconnect would sit beside them as the consented routing and disclosure layer. Requests they hold could enter as staff-routed requests; nothing is pushed out without the person's answer. |
| SMS and phone hotlines | A hotline operator acts like a shelter worker (staff account, verification by assistance secret). SMS would only carry generic "you have an update, visit a shelter or sign in" messages, never content. |
| Identity verification and child reunification | Out of scope by design: handed to trained safeguarding staff through restricted referrals. The app records the referral and nothing else. |
| Duplicate records | Flag likely duplicates for staff review; never merge automatically (a wrong merge could expose someone). |
| Scale to 400,000 people | One region per deployment, PostgreSQL with read replicas, more web and worker instances; the outbox and database constraints already avoid duplicate deliveries. Measured locally only so far (see [test-traceability.md](test-traceability.md)). |
| Languages and low literacy | Translated interface and audio help; staff-assisted use already avoids typing for the person. |

## 5. Edge cases and how they are handled

| Situation | What happens |
| --- | --- |
| No phone, no ID | Staff intake with any name; reference card plus a separate assistance secret on paper; everything else through staff. |
| Abusive partner searching | No search or list exists. A code request, a wrong code and a blocked sender all look identical ("No response available yet"); decline and block are never revealed. |
| Someone afraid to give a real name | Alias only, never checked against ID. The same alias can be used by anyone; it is not identity. |
| Someone claims to be family to get information | Staff cannot grant access because someone "is family". Only the person's own answer discloses anything, to one recipient. |
| Code given to the wrong person | Replace it; the old code stops working. Block stops future requests from that sender. |
| Location is out of date or wrong | Check-ins are history with time and source, "current presence unconfirmed"; "I have left this place" and corrections; older than 24 hours is labelled. |
| Shared later, moved on | Shares contain one specific check-in; later check-ins never follow. Revoking stops access immediately. |
| Copies and screenshots | Not preventable; the interface says so before sharing and when revoking. |
| Lost password | Recovery secret only. Staff and family cannot reset it (that would be an account-takeover route). |
| Lost assistance secret | Manual escalation, not automatic re-identification. |
| Child or person who cannot consent | Restricted referral: no location, requests, matching or sharing. |
| Shared shelter computer | Short sessions (30 min, staff 15 min), sign-out clears cached data, Back shows nothing private, nothing private in browser storage. |
| Worker overreach | Staff see only assigned cases at their shelter, need two-step sign-in and a 10-minute verification with the person's secret, and act as themselves (audited). Coordinators assign work without seeing case content. |
| No-code request to the wrong shelter | Nobody there opted in or matches: the request stays unanswered, and the requester's own coordinator can ask them for a better lead without revealing anything. |
| Person deletes their data | Access ends at once and content is purged in the same transaction; a restored backup re-applies the deletion. |
| Network trouble while submitting | Forms say "not submitted" and keep entries on the page; retries are idempotent (no duplicate requests). |

## 6. Technical choices

| Choice | Why | Alternative considered |
| --- | --- | --- |
| TypeScript, React + Vite, Node.js + Express, one repo | Common, well documented, one language end to end; shared validation schemas (`packages/contracts`) for client and server | Separate front and back ends: more moving parts for no benefit here |
| PostgreSQL with Prisma migrations plus hand-written constraints | Relational integrity is a privacy feature: composite foreign keys make it impossible to store a share whose check-in is not the answerer's | Document store: easier to start, but authorization bugs become data bugs |
| One backend, one database, a database outbox for background work | Fewer services to secure and deploy; the outbox gives reliable, non-duplicated delivery without Redis or a queue | Message broker or microservices: unnecessary at this scale |
| Server-side sessions in HttpOnly cookies, CSRF tokens, strict CSP | Shared devices and hostile networks; nothing secret in browser storage | JWTs in local storage: harder to revoke, exposed to script injection |
| Argon2id, HMAC digests for codes and secrets, AES-GCM for message text | Stolen database rows do not reveal passwords, codes or private text | Plain hashing or no field encryption |
| Same response for every routing outcome | Prevents learning whether someone exists by probing codes or requests | Helpful "not found" messages, which leak |
| Render free tier, one process | Free, a public HTTPS link, PostgreSQL included | Paid two-process setup (kept as [deploy/render.paid.yaml](../deploy/render.paid.yaml)) |

## 7. The biggest tradeoff: privacy over findability

**What was given up.** Reconnect never tells a worried family "we found them" or "they are at Hillcrest" unless that person chose to answer. There is no name search. If the person is not registered, did not opt into shelter matching, or the requester guesses the wrong shelter, the request simply waits and then expires. Some families who could have been reunited faster by an open directory will wait longer, and some may never connect through this tool.

**Why.** In a disaster, the people most endangered by a searchable list are exactly those the brief names: someone fleeing an abusive partner, undocumented people afraid to be found, children. A wrong disclosure cannot be undone; a slow reunion can still happen through shelters, phone calls and tracing services. The design makes the safe action the only action: the person being looked for is always the one who decides, and nothing reveals whether they exist.

**How the cost is reduced.** Staff-assisted use for people without phones; the no-code route through one shelter's team; contact codes printed at intake; clear, honest status wording; and coordinators who can ask the requester for a better lead.

## 8. Other tradeoffs

| Decision | Benefit | Cost |
| --- | --- | --- |
| Alias only, no identity checks | Anyone can take part, including people without ID | Names prove nothing; staff must not treat them as identity |
| Recovery secret instead of email or staff resets | No account takeover by someone claiming to be you | Losing both password and secret means a new account |
| Assistance secret per visit | A stolen reference card unlocks nothing | One more piece of paper to keep; lost secrets need manual escalation |
| One answer, one person, one check-in | Sharing cannot spread to others or to future locations | Answering several relatives takes several answers |
| No automatic merging or guardian matching | No wrong person gets someone else's record or child | More manual work for staff |
| Free single-process hosting | Free public demo | Sleeps after 15 idle minutes (about a minute to wake); database expires after 30 days; no backups; scheduled clean-up runs only while awake |
| No maps, SMS, chat or attachments | Smaller attack surface, quicker to build well | Less convenient; covered by the "rest of the system" above |

## 9. What I would do next

1. Field-test the intake with real shelter volunteers (paper form plus 3-step screen) and translate the interface.
2. Add the paper-intake data-entry flow and duplicate flagging for staff review.
3. Move to the paid two-process setup with backups, confirm how the host passes client IP addresses (the per-IP rate limits depend on it), and run the load test on the hosted environment.
4. A formal privacy and security review with a safeguarding organisation before any real use.
