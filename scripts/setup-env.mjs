// Creates a local .env with freshly generated random keys for development.
// Never overwrites an existing .env. Values are local-only and must not be reused in deployment.
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('.env already exists; leaving it unchanged.');
  process.exit(0);
}
const key = () => randomBytes(32).toString('base64');
const lines = [
  'NODE_ENV=development',
  'PORT=3000',
  'APP_ORIGIN=http://localhost:5173',
  'DATABASE_URL=postgresql://rf_local:rf_local_dev_only@127.0.0.1:55432/rf_dev',
  `DIGEST_KEY=${key()}`,
  `FIELD_ENCRYPTION_KEYS=v1:${key()}`,
  'FIELD_ENCRYPTION_ACTIVE_KEY=v1',
  'DEMO_MODE=true',
  'INCIDENT_SLUG=demo-hurricane-1',
  'TRUST_PROXY=0',
  'WORKER_POLL_MS=2000',
  'RETENTION_INTERVAL_MS=600000',
  `SEED_PASSWORD=demo-${randomBytes(6).toString('hex')}`,
  `SEED_SECRET=${randomBytes(24).toString('base64url')}`,
  'TEST_DATABASE_ADMIN_URL=postgresql://rf_local:rf_local_dev_only@127.0.0.1:55432/postgres',
];
writeFileSync('.env', lines.join('\n') + '\n', { mode: 0o600 });
console.log('Created .env with random local keys (values not printed).');
