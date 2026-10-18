/**
 * Operator CLI for staff provisioning. Authority comes from infrastructure access to the
 * database configuration; there is deliberately no web endpoint for role changes.
 *
 *   npm run staff:admin -- provision --username u --role WORKER --shelter "Name" --confirm
 *   npm run staff:admin -- suspend-membership --username u --confirm
 *   npm run staff:admin -- suspend-account --username u --confirm
 *   npm run staff:admin -- reinstate-account --username u --confirm
 *   npm run staff:admin -- reset-mfa --username u --confirm
 *
 * The target account must already exist (registered normally). Output never includes secrets.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../apps/api/src/config.js';
import { createPrisma } from '../apps/api/src/db.js';
import { systemClock } from '../apps/api/src/lib/clock.js';
import { provisionStaff, reinstateAccount, resetStaffMfa, suspendAccount, suspendMembership } from '../apps/api/src/services/staffAdmin.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    username: { type: 'string' },
    role: { type: 'string' },
    shelter: { type: 'string' },
    incident: { type: 'string' },
    confirm: { type: 'boolean', default: false },
  },
});

async function main() {
  const command = positionals[0];
  if (!command || !values.username) {
    console.error('Usage: staff-admin <provision|suspend-membership|suspend-account|reinstate-account|reset-mfa> --username <u> [--role R --shelter S] --confirm');
    process.exit(2);
  }
  if (!values.confirm) {
    console.error('Refusing to change staff access without --confirm.');
    process.exit(2);
  }
  const config = loadConfig();
  const prisma = createPrisma(config.databaseUrl);
  const deps = { prisma, clock: systemClock };
  try {
    switch (command) {
      case 'provision': {
        const role = values.role as 'WORKER' | 'COORDINATOR' | 'OPERATOR' | undefined;
        if (!role || !['WORKER', 'COORDINATOR', 'OPERATOR'].includes(role)) throw new Error('--role must be WORKER, COORDINATOR or OPERATOR');
        await provisionStaff(deps, { username: values.username, role, shelterName: values.shelter ?? null, incidentSlug: values.incident ?? config.incidentSlug });
        break;
      }
      case 'suspend-membership':
        await suspendMembership(deps, values.username);
        break;
      case 'suspend-account':
        await suspendAccount(deps, values.username);
        break;
      case 'reinstate-account':
        await reinstateAccount(deps, values.username);
        break;
      case 'reset-mfa':
        await resetStaffMfa(deps, values.username);
        break;
      default:
        throw new Error(`Unknown command ${command}`);
    }
    console.log(`${command}: done (sessions for the account were revoked where applicable).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e: unknown) => {
  console.error(`staff-admin failed: ${e instanceof Error ? e.message : 'error'}`);
  process.exit(1);
});
