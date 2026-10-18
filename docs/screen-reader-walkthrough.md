# Screen-reader walkthrough (human check)

Status: **PENDING** – not yet performed. Automated accessibility tests (axe, keyboard journey) do not replace this check, and nothing here may be marked passed without a person listening.

Purpose: confirm that a screen-reader user can find their way around, sign in, understand form labels and errors, add a check-in, send and answer a request, choose what to disclose, revoke a share and sign out. Use fictional names only.

## Setup

- Windows 11, Microsoft Edge (best with Narrator) or Firefox/Chrome (NVDA).
- Start the app with `npm run dev` and open `http://localhost:5173`. Use new accounts you create in step 4 and 8; this adds fictional rows to the development database but does not reset it.
- Narrator: Ctrl+Win+Enter turns it on and off; Caps Lock+Space toggles scan mode. In scan mode: H next heading, D next landmark, K next link, F next form field, B next button. Caps Lock+T reads the page title. Ctrl stops speech.
- NVDA equivalents: Insert+Space toggles browse/focus mode; H, D, K, F, B as above; Insert+T reads the title.
- Wording differs between screen readers and browsers. Judge whether the meaning is conveyed, not the exact words.

## Steps

| # | Action | Expected (approximately) |
| --- | --- | --- |
| 1 | Load the home page. Read the title. | Title "Home - Reconnect (demo)". Reading starts with the demo notice "Demo - fictional data only…". |
| 2 | Press Tab once, then Enter. | "Skip to main content, link". Enter moves you to the main content. |
| 3 | Scan mode: press D repeatedly, then H repeatedly. | Landmarks: banner, "Main" navigation, main, content information. Headings: level 1 "Reconnect with family after the hurricane, privately", then level 2 card headings. |
| 4 | Tab to "Create account" and activate it. On the form, press "Create account" without filling anything. Then Tab back to Username. | New page announced ("Create an account"). Each field reads its label and hint, e.g. "Username, edit, Used only to sign in…". After the empty submit, focus jumps to an alert "There is a problem… Some fields need attention" with the list of problems. Username then reads as invalid with "Error: …". |
| 5 | Fill in Username, Password and "Name others will see" (fictional), submit. Find the recovery secret, tick "I have written down my recovery secret", Continue. | Recovery secret readable as text. Checkbox announced with its label and state. Dashboard heading announced after Continue. |
| 6 | Go to "Your check-ins", activate "Add a check-in". Save without choosing a shelter. Then choose a shelter and save. | Radio group "Where were you?" with "At a shelter, 1 of 2". "Shelter, combo box". While the list loads: "Loading the shelter list…". Empty save gives an error you can find. After saving, you can tell the check-in was saved. |
| 7 | Go to "Privacy and contact code", activate "Create contact code". Note the code, then "I noted it, hide it". Sign out. | Code read as text under "Your contact code (shown once)". "Sign out" leads to a "Signed out" page; the title changes. |
| 8 | Create a second fictional account (repeat step 4–5 quickly). Go to "Find someone". Send once empty, then enter the contact code and an introduction and send. | Radio group "How do you want to reach them?". "Contact code, edit, 26 letters and numbers…". Empty send: alert with "Enter the contact code." and the introduction error. Region "What they will see if it reaches them" readable. After sending: heading "Request saved". Sign out. |
| 9 | Sign in as the first account. Go to "Requests for you", find the request, activate "Answer". | Card heading "From <second alias>" and status "Waiting for your decision". Answer form: group "What to share" with three choices and their descriptions read with each radio button. |
| 10 | Choose "Message and the approximate area of one check-in", pick the check-in, choose 24 hours, read the preview, then "Review and share" and confirm. | "Which check-in, combo box". Region "Exactly what <alias> will see" lists From, Message, Area and time, with "Current presence is unconfirmed…". After "Review and share": "Check the preview above, then confirm." The confirm button names the recipient. |
| 11 | Go to "Sharing" ("Manage sharing"). Activate "Revoke everything shared", listen, choose Cancel. Then activate "Revoke" on the share. | The confirmation is announced as an alert dialog "Confirm revoke all" with its warning text and Revoke all / Cancel buttons. After Revoke, the share shows as revoked. |
| 12 | Activate "Sign out". Then press the browser Back button. | "Signed out" page announced. Going back does not read any private content (you are asked to sign in instead). |

## Observations (fill in)

| # | Result (OK / Problem) | What you heard or what was missing |
| --- | --- | --- |
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |
| 11 | | |
| 12 | | |

Screen reader and version: ________ Browser and version: ________ Date: ________ Tester: ________

Reported problems are fixed in code, covered by a regression test where possible, and the affected steps are repeated.
