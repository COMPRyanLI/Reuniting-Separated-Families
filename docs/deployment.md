# Deployment guide

Status 2026-10-19: **not deployed.** There is no hosting account, no database and no remote; one local Git commit exists on `main`. Everything below was prepared and checked locally. Render facts come from Render's documentation read on 2026-10-19; confirm them before relying on them.

## Chosen option: Render free tier (owner's choice, 2026-10-19)

[`render.yaml`](../render.yaml) defines one **free web service** and one **free PostgreSQL 17** database. Free web services have no shell, no one-off jobs and no pre-deploy command, and background workers cannot be free. So the single web process does everything, through `node scripts/start-free.mjs`:

1. applies committed migrations (`prisma migrate deploy`, never a reset);
2. seeds the guarded **fictional** demo data **once per database** (`SEED_ON_START=yes`, `SEED_CONFIRM_FICTIONAL=yes`; `prisma/seed.ts --once`). Later starts skip it, and the seed never recreates content of a fixture person who was deleted;
3. starts the API and website, and runs the outbox worker and retention job in the same process (`RUN_WORKER_IN_PROCESS=true`).

No secret has to be typed: Render generates `DIGEST_KEY`, `FIELD_ENCRYPTION_KEY` (used as key version `v1`), `SEED_PASSWORD` and `SEED_SECRET`, and the app takes its origin from Render's `RENDER_EXTERNAL_URL`.

Local rehearsal (`npm run build && npm run check:free-start`, 2026-10-19): 8/8 checks on a disposable database with a Render-style environment and no separate worker process. Migrations applied to an empty database and the seed ran. The deployed smoke test passed 14/14, including delivery by the in-process worker. Deleting seeded Leo (self) and seeded Ana (by her verified worker) purged their check-ins and assistance credential at once. After a restart, the seed was skipped and nothing was recreated, data persisted, and Leo still could not sign in. Evidence: `evidence/drills/free-tier-check.json`. The same rehearsal with the earlier seed behaviour failed 6/8 because the restart recreated the purged rows (`evidence/drills/free-tier-check-red-before-seed-fix.json`). It ran over plain HTTP with `NODE_ENV=test`; HTTPS cookies and headers were checked separately in the Docker production check.

### Free-tier limits that affect the demo

| Limit (Render docs) | Effect here |
| --- | --- |
| Free web service sleeps after 15 minutes without traffic; waking takes about a minute | The first visit after a quiet period is slow. The in-process worker sleeps too, but nothing new can be queued while nobody is using the site |
| Free PostgreSQL **expires 30 days after creation**, then 14 days' grace before deletion; no backups | The demo works for about 30 days. Upgrade the database to a paid plan (about $6/month) before then if the link must stay up longer. Restore (DATA-03) cannot be shown on the host |
| 750 free instance hours per month per workspace | Enough for one always-on service; exceeding them suspends free services until next month |
| One free PostgreSQL per workspace; 1 GB storage | Enough for the fictional dataset |
| Included bandwidth and build minutes are limited (amounts shown in the dashboard) | Free services are suspended for the rest of the month if bandwidth runs out without a payment method |
| 0.1 CPU, 512 MB RAM | Sign-in (Argon2id) and cold starts are slower than in local benchmarks; the local performance numbers do not apply |
| Nothing runs while the service sleeps | **Demo-only retention exception.** The retention job runs at start and every 10 minutes while awake, so time-based windows (request text 30 days after closure, closed cases, 24-hour session/recovery artifact clean-up, completed jobs, notifications, audit metadata) can run late by the time asleep. Not claimed on this host. Unaffected: deletion purges content in its own transaction, and expiry, revocation and deletion are checked on every read. Stated on the Help page and in [security-and-permissions.md](security-and-permissions.md) §7 |

Docker on the free plan was not confirmed in Render's docs, so the free Blueprint uses Render's native Node runtime (`npm ci --include=dev && npm run build`).

### Pre-deployment validation (2026-10-19)

| Check | Result |
| --- | --- |
| Both Blueprints against Render's published JSON Schema (`https://render.com/schema/render.yaml.json`, also listed on SchemaStore), validated with Ajv 8 (draft 2020-12) | `render.yaml` VALID, `deploy/render.paid.yaml` VALID. A deliberately broken copy (`plan: freee`, `region: mars`, `runtime: nodejs`) was rejected, so the check is not vacuous |
| Render CLI v2.29.0 `render blueprints validate render.yaml` (official release, SHA-256 checked) | **Not run**: the command needs a Render workspace ("no workspace specified and no default workspace set"). Run it after signing in |
| Node version | **Upgraded to 24.22.0** (owner decision, 2026-10-19): latest 24.x LTS "Krypton" release (2026-10-14, bundles npm 11.19.1), which includes the security releases 24.17.0 and 24.18.1 that 24.16.0 lacked. Render resolves versions with the `node-version-alias` module; that module (v4.0.0, run locally) resolves `24.22.0` to exactly `24.22.0`. Render's own download of it is untested until the first build |
| Local runtime | Official `node-v24.22.0-win-x64.zip` from nodejs.org: SHA-256 matched `SHASUMS256.txt`, whose signature verified ("Good signature") with release key C82F A3AE 1CBE DC6B E46B 9360 C43C EC45 C17A B93C (Richard Lau, listed in the Node.js README). Installed per user (no administrator rights); the system-wide Node in Program Files is still 24.16.0. All checks in [progress entry 13](progress.md) ran on 24.22.0 |
| Docker base image | `node:24.22.0-bookworm-slim` exists on Docker Hub (amd64 and arm64) |

Node version is pinned in three places that must stay equal: `render.yaml` (`NODE_VERSION`), `.nvmrc`, and `Dockerfile` (both stages), all `24.22.0`; `package.json` `packageManager` is `npm@11.19.1` (bundled with that Node) and `engines` allows `>=24.11 <25`. CI reads `.nvmrc`.

### Steps for the owner

1. Create a **public** GitHub repository (name and account are your choice) and push `main`, or give the agent the remote URL and an explicit instruction to push. `.env`, test reports, `tmp/` and `evidence/tmp/` are ignored by Git; `Full stack challenge.pdf` is excluded locally until you approve publishing it.
2. Sign in to Render with GitHub. Optionally run `render blueprints validate render.yaml` with the Render CLI. Choose **New > Blueprint**, select the repository, and apply `render.yaml`. No values need to be entered.
3. Wait for the first deploy (build, then migrations and the one-time seed at start). Open the service URL.
4. In the Render dashboard, open the web service's **Environment** and read `SEED_PASSWORD` to sign in as the fictional demo accounts. Do not paste it publicly. For a public demo, prefer creating new accounts on the site and a fresh staff intake.
5. Tell the agent the URL. It will run `npm run smoke:deployed -- --base-url <url>`, check the site in a private browser window, restart the service to confirm persistence, and record DEPLOY-01..04.
6. Staff demo access needs two-step verification: each reviewer enrolls their own authenticator for a fictional staff account. There is no MFA bypass.

## Paid option (upgrade path)

[`deploy/render.paid.yaml`](../deploy/render.paid.yaml) runs the Docker image as a separate web service and background worker, with migrations as a pre-deploy command and a paid database with point-in-time recovery. On a Hobby workspace that is about $7 (web) + $7 (worker) + $6 (PostgreSQL) per month plus storage. The Starter and PostgreSQL prices come from search snippets of Render's pricing page, which could not be read directly; confirm them there. Recovery covers the past 3 days on Hobby and 7 days on Pro. It needs `FIELD_ENCRYPTION_KEYS` and `APP_ORIGIN` entered once in the dashboard.

Alternatives considered: Railway (Hobby $5/month including $5 of usage; backup and pre-deploy terms not confirmed from its official pages in this check) and Fly.io (no free allowance for new organizations; Managed Postgres from $38/month).

Sources: [Render free instances](https://render.com/docs/free), [Render default environment variables](https://render.com/docs/environment-variables), [Render Blueprint spec](https://render.com/docs/blueprint-spec), [Render Node version](https://render.com/docs/node-version), [Render pre-deploy command](https://render.com/docs/deploys), [Render compute plans](https://render.com/docs/compute-plans), [Render Postgres recovery](https://render.com/docs/postgresql-backups), [Render workspace plans](https://render.com/changelog/updated-plans-for-render-workspaces), [Render pricing](https://render.com/pricing), [Railway pricing](https://railway.com/pricing), [Fly.io pricing](https://docs.fly.io/about/pricing).

## What any host must provide

- A Node 24 runtime or container runtime; a separate worker process is optional (`RUN_WORKER_IN_PROCESS=true` runs it inside the web process).
- PostgreSQL 17 (or 16+) reachable only from the app. For anything beyond a short demo: encrypted storage and backups, with the backup window recorded (the security spec assumes at most 30 days).
- HTTPS termination with a stable public origin.
- Runtime secrets (not build-time variables).
- Migrations before (or at the start of) each new version.

## Image and commands

`Dockerfile` builds one image (verified locally on 2026-10-19: image builds; `migrate deploy`, the guarded seed and the retention command run in the container; the server starts with `NODE_ENV=production`, sends HSTS and CSP, and refuses to start without configuration).

| Process | Command |
| --- | --- |
| Release (each deploy, before start) | `node node_modules/prisma/build/index.js migrate deploy` |
| Web | `node apps/api/dist/server.js` (listens on `PORT`, default 3000) |
| Worker | `node apps/api/dist/worker.js` |
| Single process (migrate, optional seed, web + worker) | `node scripts/start-free.mjs` with `RUN_WORKER_IN_PROCESS=true` |
| Fictional demo seed (demo only) | `SEED_CONFIRM_FICTIONAL=yes node node_modules/tsx/dist/cli.mjs prisma/seed.ts` |

Never run `prisma migrate dev`, `db push` or any reset against a deployed database. Never ship a `.env` file: Prisma Client fills unset variables from a `.env` it finds, which would silently mix development settings into production. Git and `.dockerignore` both exclude it.

## Runtime configuration

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `DATABASE_URL` | yes | Private connection string |
| `APP_ORIGIN` | yes, unless `RENDER_EXTERNAL_URL` is set | Exact public `https://` origin; mutations from any other origin are rejected |
| `DIGEST_KEY` | yes | 32+ random bytes, base64 |
| `FIELD_ENCRYPTION_KEYS` or `FIELD_ENCRYPTION_KEY` | yes | `v1:<base64 32 bytes>[,v2:...]`, or one base64 key treated as `v1` |
| `FIELD_ENCRYPTION_ACTIVE_KEY` | no | Defaults to `v1` |
| `RUN_WORKER_IN_PROCESS` | no | `true` runs the outbox worker inside the web process |
| `TRUST_PROXY` | usually | Number of proxies in front of the app (often `1`) |
| `DEMO_MODE` | no | Defaults to `true` (demo banner, guarded seed) |
| `WORKER_POLL_MS`, `RETENTION_INTERVAL_MS` | no | Worker timing |
| `SEED_ON_START`, `SEED_CONFIRM_FICTIONAL`, `SEED_PASSWORD`, `SEED_SECRET` | seed only | Fictional demo accounts; fresh values per deployment. `SEED_ON_START=yes` seeds only a never-seeded database |

Blank variables count as unset. Generate keys with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Do not reuse local `.env` values.

## Verification after deploying

1. `npm run smoke:deployed -- --base-url https://<host>` from a checkout (only creates new fictional accounts).
2. Private browser window: sign up, check in, send and answer a request, revoke, reload a nested page.
3. Restart or redeploy the service and confirm data persists (DEPLOY-01).
4. Record the URL, revision, smoke output and cold-start behaviour in `docs/progress.md`, and DEPLOY-01..04 in `docs/test-traceability.md`.

## Restore procedure (summary)

Before restoring a backup, export the ledger from the newest source: `npm run ops -- ledger-export --out ledger.json`. Restore into an isolated database, run `npm run ops -- restore-start` (API answers 503), then `npm run ops -- ledger-replay --in ledger.json`. That re-applies deletions and revocations, revokes every restored session and reopens the API. Tested with a database copy (`tests/integration/restore.test.ts`) and through the operator CLI (`npm run drill:restore`); not exercised with a provider's backup system, and not possible on the free database, which has no backups.
