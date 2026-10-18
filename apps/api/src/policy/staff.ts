import type { StaffMembership } from '@prisma/client';
import type { Deps } from '../deps.js';
import type { Actor } from '../auth/session.js';
import { forbidden, mfaRequired } from '../lib/errors.js';

export interface StaffContext {
  accountId: string;
  memberships: StaffMembership[];
}

/**
 * Staff authority is re-read from the database on every request: suspended
 * memberships take effect immediately, and MFA must be verified on this session.
 * Holding a membership never grants person data by itself; case/route policies do.
 */
export async function requireStaff(deps: Deps, actor: Actor): Promise<StaffContext> {
  const memberships = await deps.prisma.staffMembership.findMany({ where: { accountId: actor.accountId, state: 'ACTIVE' } });
  if (memberships.length === 0) throw forbidden('Staff access is not available for this account.');
  const mfa = await deps.prisma.staffMfa.findUnique({ where: { accountId: actor.accountId } });
  if (!actor.mfaVerified || !mfa?.enrolledAt) throw mfaRequired();
  return { accountId: actor.accountId, memberships };
}

export function shelterMemberships(ctx: StaffContext, shelterId: string, roles?: ('WORKER' | 'COORDINATOR')[]) {
  return ctx.memberships.filter((m) => m.shelterId === shelterId && (!roles || roles.includes(m.role as 'WORKER' | 'COORDINATOR')));
}
