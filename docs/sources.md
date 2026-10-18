# Sources and design assumptions

Research reviewed for planning on 2026-10-18. These sources support principles; the specific architecture, authorization scopes, expiry windows, retention schedules, and benchmark targets are our project decisions.

## Challenge brief

Local source: `../Full stack challenge.pdf`, three scanned pages. Requires people-centered realistic design, frontend/backend integration, database persistence, live deployed link, public repository, and README explaining scope, larger system, edge cases, technical choices, and tradeoffs. Explicit circumstances include missing phones/ID, people avoiding discovery, and available but overstretched shelter staff.

The PDF was rendered and visually read. Temporary renderings are not application assets or submission deliverables.

## Humanitarian and survivor-safety background

- [American Red Cross: Contact and Locate Loved Ones](https://www.redcross.org/get-help/disaster-relief-and-recovery-services/contact-and-locate-loved-ones.html): supports including human-assisted reunification and alternatives to personal smartphone communication.
- [ICRC: Restoring family links](https://www.icrc.org/en/document/restoring-family-links-agony-separation-and-joy-reunification): describes contact restoration through multiple channels, including handwritten communication.
- [ICRC Family Links privacy policy](https://familylinks.icrc.org/privacy-policy): informs minimal disclosure, consent, and recognition that copied published information cannot be recalled.
- [NCMEC: Disaster Preparedness and Response](https://us.missingkids.org/ourwork/disasters): supports treating separated children as a specialized safeguarding workflow.
- [Safety Net Project: Cell Phone Safety Plan](https://www.techsafety.org/resources-survivors/cell-phone-safety-plan): informs the compromised/shared-device limitation and the risk of location/account access by abusive people.

We do not claim partnership with these organizations, compliance certification, or that our workflow is their approved operational procedure.

## Technical references

- [W3C Geolocation](https://www.w3.org/TR/geolocation/): device position, accuracy, timestamp, and permission context. GPS collection is deliberately outside the MVP.
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): least privilege, deny by default, and per-request authorization.
- [OWASP IDOR Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html): an opaque identifier is not a substitute for object-level permission checks.
- [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): established password hashing and Argon2id baseline parameters.
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): secure session lifecycle and cookie handling.
- [Prisma: Applying a migration](https://www.prisma.io/docs/orm/migrations/applying-a-migration): use versioned migration workflows appropriate to environment; verify commands for the pinned version at implementation time.
- [Playwright assertions](https://playwright.dev/docs/test-assertions): use observable, auto-retrying browser assertions instead of arbitrary waits.

## Coding-agent instructions

- [OpenAI: Iterating Development Workflows with Codex](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex): recognizes repository `AGENTS.md` and explains separating persistent guidance from task evidence.
- [Claude Code: Project memory](https://code.claude.com/docs/en/memory): documents project `CLAUDE.md` and its instruction-loading behavior.

We keep conventional `AGENTS.md` and `CLAUDE.md`, plus the requested `agent.md`, identical. They are instructions, not an enforced security boundary. Runtime authorization and tests must implement the guarantees.

## Explicit prototype assumptions

Participating shelters share a central service, have at least intermittent access to a connected computer, and can provision trusted workers. A person can use an alias and can decline discovery. Private request routing may remain unresolved. Assisted verification depends on a separate secret or an external manual escalation process. The public demo contains fictional data only. Human safeguarding and real emergency deployment are outside the challenge implementation.
