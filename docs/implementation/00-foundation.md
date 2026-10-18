# Phase 00: repository foundation

Depends on: planning package. Gate: FND-01 through FND-04.

## Deliverables

A runnable but explicitly incomplete website, API, reproducible toolchain, and test/deployment structure. Preserve the challenge PDF and planning files. No sensitive person workflows are public in this phase.

## Implementation steps

1. Inspect the repository, installed runtimes, and `docs/progress.md`. Choose supported compatible Node LTS, npm, TypeScript, React/Vite, Express, Prisma, Zod, Vitest, and Playwright versions; record them and create a lockfile. Do not install dependencies globally.
2. Create npm workspaces for `apps/web`, `apps/api`, and `packages/contracts`. Enable strict TypeScript. Add lint/format configuration and cross-platform root scripts from the command contract that belong to this phase.
3. Create `.gitignore` for dependencies, build output, `.env`/secrets, coverage, screenshots/reports containing transient data, and `tmp/`. Preserve `.env.example`. Do not delete existing temporary files or the source PDF merely to clean Git status.
4. Add environment validation with examples for database URL, origin, session settings, field-encryption key, code-digest key, incident/demo mode, and worker settings. Fail startup with safe error names if required production settings are absent; never print secret values.
5. Build public help/home pages with `Demo - fictional data only`, the service's limits, and navigation placeholders clearly labeled unavailable. Add semantic layout, accessible controls, and a mobile viewport baseline.
6. Add `/api/health/live` (process health) and `/api/health/ready` (dependency readiness). Liveness must not claim database readiness. No connection strings, stack traces, or secret config in these responses.
7. Establish route -> policy -> service -> repository -> serializer structure, error envelope, request correlation IDs without payload logging, and same-origin production serving. Vite proxies API routes in development.
8. Add CI for install, docs checks, lint, typecheck, and build. Lay out future real-DB and browser jobs without reporting unimplemented suites as passing.
9. Implement `docs:check`; detect instruction drift and broken local documentation links. Establish an early preview deployment configuration using synthetic/empty data. Deploy an empty shell if an appropriate host is available; otherwise record the external dependency, with the actual public deployment still required in phase 07.

## Verification

- Run install, docs checks, lint, types, build, and production start from a clean dependency state.
- Check the home page at 390px and 1280px viewport widths and reload a nested route.
- Verify public health endpoints do not expose environment values and missing configuration fails safely.
- Inspect built frontend assets for secret values using unique fake sentinel values in the test environment.
- Record any hosting assumptions, but do not claim the full application is deployed.

## Exit evidence

Record exact version pins, available scripts, actual development/preview URLs, FND test results, and the next phase in `docs/progress.md`. Phase 01 should not need to redo scaffolding.
