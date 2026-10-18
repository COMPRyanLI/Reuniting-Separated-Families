# Shelter walkthrough: people without devices (human check)

Status: **Done by the owner (2026-10-19), overall report only** – the owner reported "these all looks perfect" after the walkthrough; per-step notes were not recorded. Help needed during the run: the staff two-step page needs a code from an authenticator app (a random code is refused, as designed). Parts B–D are also run automatically by `tests/e2e/shelter-walkthrough.spec.ts` (passing, 2026-10-19). Part A's operator command is covered by `tests/integration/staff-provision.test.ts`. The automated runs confirm the steps and labels below exist and work; they do not replace you trying them as a shelter worker would.

What this shows: how a shelter gets a staff account, and how two people **without phones or accounts**, at two different shelters, reach each other: first with a contact code written on paper, then with no code at all. Fictional names only.

## Before you start

- Start the app with `npm run dev` and open `http://localhost:5173`. This adds fictional records to your development database; it does not reset it.
- Staff password: the `SEED_PASSWORD` value in your local `.env` file (do not share it). Staff accounts used: `worker.a` (Riverside Community Center), `worker.b` and `coord.b` (Hillcrest School Gym).
- Every staff sign-in asks for a 6-digit code from an authenticator app. Use the entries you already have for these accounts. If an account has never been set up, its first sign-in sets it up (this adds a new entry; it does not change existing ones).
- Use **three separate browser sessions**, one per staff member, for example Edge (worker.a), Chrome (worker.b) and a Firefox or a second browser profile (coord.b). InPrivate/Incognito windows of the same browser share one session, so they do not count as separate.
- Have paper (or a notepad) ready. People without devices receive their secrets on paper; write them down instead of taking screenshots.
- A worker's verification of a person lasts 10 minutes per visit. If a case says "Verify the person for this visit", enter that person's assistance secret and choose **Verify**.
- If you repeat the walkthrough, add a number to the names (for example "Rosa Demo 2").

## Part A – How a shelter gets a staff account (operator command)

Staff accounts cannot be created or promoted from the website. A person signs up normally; someone with access to the server's database configuration grants the role.

| # | Action | Expected |
| --- | --- | --- |
| A1 | In the third browser, choose **Create account**: username `rivera.staff`, a fictional password you note on paper, name "Rivera (staff, fictional)". Save the recovery secret on paper and continue. | A normal personal dashboard. No "Staff work" link. |
| A2 | In a terminal in the project folder run: `npm run staff:admin -- provision --username rivera.staff --role WORKER --shelter "Riverside Community Center" --confirm` | `provision: done (sessions for the account were revoked where applicable).` Running it again says `This account already has this active staff role.` Without `--confirm` it refuses. |
| A3 | Back in the browser, click any link. Then sign in again as `rivera.staff`. | You were signed out by the role change. After sign-in: **Staff two-step verification**. |
| A4 | Enter your password under "Confirm your password", **Start setup**, add the setup key to your authenticator app, enter the 6-digit code, **Verify**. | **Save your staff recovery codes** (write them down), then **I saved them, continue** opens **Staff work** for Riverside. No cases are listed: a role alone gives no access to anyone's data until a case is assigned or created. |
| A5 | Optional clean-up: `npm run staff:admin -- suspend-membership --username rivera.staff --confirm`, then sign out. | The account stays a normal account without staff tools. |

On the free Render host there is no shell and the database refuses outside connections, so this command cannot be run there without a deliberate change (see [deployment.md](deployment.md)).

## Part B – Intake for two people without devices

| # | Who | Action | Expected |
| --- | --- | --- | --- |
| B1 | worker.a | Sign in. **Staff work** → **New intake (person without account or phone)**. Name the person wants to use: `Rosa Demo`. Keep "Contact code only (default)" and "Record a check-in at this shelter". Tick **Create a contact code the person can give to family**. Tick the consent box. **Save intake**. | **Intake saved** (heading has focus). Shows a reference card (REF-…), a **private assistance secret** and a **contact code (shown once)**. Write Rosa's assistance secret and contact code on paper. |
| B2 | worker.b | Sign in. **New intake**: `Tomas Demo`. Choose **Contact code and shelter-assisted matching**; clue `Sister Rosa, grey cap`. Tick consent. **Save intake**. | **Intake saved**. Write Tomas's assistance secret on paper. No contact code, because none was asked for. |

## Part C – Reaching someone with a paper contact code

Imagine a relative passed Rosa's paper code to Tomas.

| # | Who | Action | Expected |
| --- | --- | --- | --- |
| C1 | worker.b | **Staff work** → **Tomas Demo** (verify with Tomas's secret if asked). **Send a request for Tomas Demo** → "With their contact code" → enter Rosa's code → Introduction `Tomas here, at Hillcrest.` → check the preview → **Send private request**. | The request appears under **Requests Tomas Demo sent** with "No response available yet". Nothing says whether the code matched anyone. |
| C2 | worker.a | **Staff work** → **Rosa Demo** (verify with Rosa's secret if asked). Under **Requests for Rosa Demo**, find "From Tomas Demo" (reload after a few seconds if needed). Rosa decides: **Answer** → **Message and the named shelter of one check-in** → pick the Riverside check-in → read **Exactly what Tomas Demo will see** → **Review and share** → **Confirm: share with Tomas Demo**. | Preview shows Riverside Community Center, the time, and "Current presence is unconfirmed". The card then shows it was answered. |
| C3 | worker.b | **Tomas Demo** case (verify again if asked) → **Requests Tomas Demo sent** → **View answer with the person**. | "Answer from Rosa Demo" with the shelter and time; read it together with Tomas. |

## Part D – Reaching someone with no code at all

| # | Who | Action | Expected |
| --- | --- | --- | --- |
| D1 | worker.a | **Rosa Demo** case → **Send a request for Rosa Demo** → **Without a code: ask one shelter’s team to help** → Clues `Brother Tomas, grey cap` → Shelter: **Hillcrest School Gym** → tick "The person agrees that the clues may be shared with Hillcrest School Gym’s team…" → Introduction `Rosa looking for her brother.` → **Send private request**. | Listed under **Requests Rosa Demo sent**, "No response available yet". |
| D2 | coord.b | Sign in. **Staff work** → **Requests routed to your shelter** → the item with Rosa's clues → Worker: **worker.b** → **Assign matching task**. | "Assigned to worker.b". The coordinator sees the clues but no one's case data. |
| D3 | worker.b | **Staff work** (reload) → **Your matching tasks** → **Open matching task**. | **Matching task** with "Clues they shared with your team". Only people at Hillcrest who opted into assisted matching are listed (Tomas Demo, and possibly the fictional Ana). |
| D4 | worker.b | **Propose Tomas Demo** → **Confirm: deliver request to Tomas Demo**. | Back on **Staff work**. |
| D5 | worker.a | **Rosa Demo** case → **Requests Rosa Demo sent**. | Still "No response available yet". Tomas's name does not appear: Rosa learns nothing until he answers. |
| D6 | worker.b | **Tomas Demo** case (verify if asked) → **Requests for Tomas Demo** → "From Rosa Demo". Tomas decides: **Answer** → **A message only** → **Review and share** → **Confirm: share with Rosa Demo**. (Optionally try **Decline privately** on a second request instead.) | Answered. A decline would look exactly like "no response" on Rosa's side. |
| D7 | worker.a | **Rosa Demo** case → **Requests Rosa Demo sent**. | "Response available" → **View answer with the person**. |

## Part E – Finish

| # | Action | Expected |
| --- | --- | --- |
| E1 | In each open case choose **End assistance now**. | The case asks to verify again; requests are hidden until the person returns with their secret. |
| E2 | **Sign out** in every window. | Signed out. |

## Observations (fill in)

| Step | Result (OK / Problem) | What you saw, or what was confusing |
| --- | --- | --- |
| A1–A5 | | |
| B1–B2 | | |
| C1–C3 | | |
| D1–D7 | | |
| E1–E2 | | |

Date: ________ Browsers used: ________ Tester: ________

Not covered here (see the [manual testing guide](manual-testing-guide.md)): a lost assistance secret (manual escalation), case transfers between shelters, restricted referrals for children, and deletion at the person's request.
