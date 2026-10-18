/**
 * Operator maintenance commands (infrastructure access required; no web endpoint).
 *   npm run ops -- retention                 run the retention/purge job once
 *   npm run ops -- reencrypt                 re-encrypt protected fields with FIELD_ENCRYPTION_ACTIVE_KEY
 *   npm run ops -- ledger-export --out f.json   export the deletion/revocation ledger (identifiers only)
 *   npm run ops -- restore-start             gate a freshly restored database (API returns 503)
 *   npm run ops -- ledger-replay --in f.json    re-apply the ledger, revoke sessions, open the gate
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadConfig } from '../apps/api/src/config.js';
import { createPrisma } from '../apps/api/src/db.js';
import { systemClock } from '../apps/api/src/lib/clock.js';
import { createCrypto } from '../apps/api/src/lib/crypto.js';
import { createLogger } from '../apps/api/src/lib/logger.js';
import { runRetention } from '../apps/api/src/jobs/retention.js';
import { reencryptAll } from '../apps/api/src/services/keyRotation.js';
import { exportLedger, markRestoreStarted, replayLedger, type Ledger } from '../apps/api/src/services/restore.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, in: { type: 'string' } } });

async function main() {
  const config = loadConfig();
  const prisma = createPrisma(config.databaseUrl);
  const deps = { config, prisma, clock: systemClock, crypto: createCrypto(config), logger: createLogger() };
  try {
    switch (positionals[0]) {
      case 'retention':
        console.log(JSON.stringify(await runRetention(deps)));
        break;
      case 'reencrypt':
        console.log(JSON.stringify(await reencryptAll(deps)));
        break;
      case 'ledger-export': {
        if (!values.out) throw new Error('--out is required');
        writeFileSync(values.out, JSON.stringify(await exportLedger(deps), null, 2), { mode: 0o600 });
        console.log(`ledger written to ${values.out}`);
        break;
      }
      case 'restore-start':
        await markRestoreStarted(deps);
        console.log('restore gate set: API returns 503 until ledger-replay completes');
        break;
      case 'ledger-replay': {
        if (!values.in) throw new Error('--in is required');
        const ledger = JSON.parse(readFileSync(values.in, 'utf8')) as Ledger;
        await markRestoreStarted(deps);
        console.log(JSON.stringify(await replayLedger(deps, ledger)));
        break;
      }
      default:
        throw new Error('unknown command (retention | reencrypt | ledger-export | restore-start | ledger-replay)');
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: unknown) => {
  console.error(`ops failed: ${e instanceof Error ? e.message : 'error'}`);
  process.exit(1);
});
