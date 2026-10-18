// Start command for single-process hosting without shell or pre-deploy support (e.g. a free
// Render web service): apply committed migrations, optionally run the guarded fictional seed once,
// then start the API, which also runs the outbox worker when RUN_WORKER_IN_PROCESS=true.
// Never resets data: `migrate deploy` only applies pending migrations and the seed runs once per database.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

function step(label, args) {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    console.error(JSON.stringify({ level: 'error', event: 'start_step_failed', step: label, status: r.status }));
    process.exit(1);
  }
}

step('migrate', [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy']);
if (process.env.SEED_ON_START === 'yes') {
  // prisma/seed.ts refuses unless DEMO_MODE=true and, in production, SEED_CONFIRM_FICTIONAL=yes.
  // --once: only an empty, never-seeded database is seeded, so restarts never recreate deleted data.
  step('seed', [path.resolve('node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts', '--once']);
}
await import(new URL('../apps/api/dist/server.js', import.meta.url).href);
