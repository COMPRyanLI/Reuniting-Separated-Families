import type { Deps } from '../deps.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { generateSecret, normalizeSecret } from '../lib/secrets.js';
import { audit } from './audit.js';

/** Authority under which a person-level action runs: the person themself, or verified staff assistance. */
export interface SubjectAuthority {
  personId: string;
  actorAccountId: string;
  authorityType: 'SELF' | 'ASSISTED_CASE';
  caseId?: string;
  assistanceSessionId?: string;
}

export async function getProfile(deps: Deps, personId: string) {
  const person = await deps.prisma.person.findUnique({
    where: { id: personId },
    include: { contactCodes: { where: { revokedAt: null }, select: { createdAt: true } } },
  });
  if (!person || person.deletedAt) throw notFound();
  return {
    alias: person.alias,
    requestMode: person.requestMode,
    restrictedReferral: person.restrictedReferral,
    version: person.version,
    contactCode: person.contactCodes[0] ? { active: true, createdAt: person.contactCodes[0].createdAt.toISOString() } : { active: false, createdAt: null },
  };
}

/** Issues a fresh routing code (shown once) and invalidates the previous one. Never a login credential. */
export async function rotateContactCode(deps: Deps, auth: SubjectAuthority): Promise<string> {
  const now = deps.clock.now();
  const person = await deps.prisma.person.findUnique({ where: { id: auth.personId } });
  if (!person || person.deletedAt) throw notFound();
  if (person.restrictedReferral) throw forbidden('Contact codes are not available for restricted referrals.');
  const code = generateSecret();
  await deps.prisma.$transaction(async (tx) => {
    await tx.contactCode.updateMany({ where: { personId: auth.personId, revokedAt: null }, data: { revokedAt: now } });
    await tx.contactCode.create({
      data: { personId: auth.personId, digest: deps.crypto.digest('contact-code', normalizeSecret(code)), createdAt: now },
    });
    await audit(tx, {
      actorAccountId: auth.actorAccountId,
      action: 'contactCode.rotate',
      objectType: 'Person',
      objectId: auth.personId,
      authorityType: auth.authorityType,
      authorityId: auth.caseId ?? null,
      result: 'SUCCEEDED',
      at: now,
    });
  });
  return code;
}

export const POLICY_VERSION = 'demo-2026-10';

/**
 * Changes who may route requests to the subject. Versioned: a stale expectedVersion is a
 * 409 and nothing is overwritten. Existing grants are unaffected (revoke-all is separate).
 */
export async function updatePrivacy(
  deps: Deps,
  auth: SubjectAuthority,
  input: { requestMode: 'CLOSED' | 'CODE_ONLY' | 'ASSISTED'; expectedVersion: number; matchingClue?: string | null },
) {
  const now = deps.clock.now();
  return deps.prisma.$transaction(async (tx) => {
    const person = await tx.person.findUnique({ where: { id: auth.personId } });
    if (!person || person.deletedAt) throw notFound();
    if (person.restrictedReferral) throw forbidden('Restricted referrals cannot change sharing settings.');
    // Clues exist only for opted-in assisted matching; leaving ASSISTED discards them.
    let clue: string | null | undefined;
    if (input.requestMode !== 'ASSISTED') clue = null;
    else if (input.matchingClue !== undefined) clue = input.matchingClue ? deps.crypto.encrypt(input.matchingClue, 'person.matchingClue', person.id) : null;
    const updated = await tx.person.updateMany({
      where: { id: auth.personId, version: input.expectedVersion, deletedAt: null },
      data: { requestMode: input.requestMode, version: { increment: 1 }, ...(clue !== undefined ? { encryptedMatchingClue: clue } : {}) },
    });
    if (updated.count !== 1) throw conflict('Your settings changed elsewhere. Refresh to see the current settings, then try again.');
    await tx.consentRecord.create({
      data: {
        personId: auth.personId,
        actorAccountId: auth.actorAccountId,
        caseId: auth.caseId ?? null,
        assistanceSessionId: auth.assistanceSessionId ?? null,
        action: 'PRIVACY_CHANGE',
        detail: input.requestMode,
        statedAt: now,
        recordedAt: now,
        policyVersion: POLICY_VERSION,
      },
    });
    await audit(tx, {
      actorAccountId: auth.actorAccountId,
      action: 'person.privacy.update',
      objectType: 'Person',
      objectId: auth.personId,
      authorityType: auth.authorityType,
      authorityId: auth.caseId ?? null,
      result: 'SUCCEEDED',
      at: now,
    });
    if (auth.caseId) await tx.assistanceCase.update({ where: { id: auth.caseId }, data: { lastActivityAt: now } });
    return { requestMode: input.requestMode, version: input.expectedVersion + 1 };
  });
}

export async function updateAlias(deps: Deps, auth: SubjectAuthority, input: { alias: string; expectedVersion: number }) {
  const now = deps.clock.now();
  const updated = await deps.prisma.person.updateMany({
    where: { id: auth.personId, version: input.expectedVersion, deletedAt: null },
    data: { alias: input.alias, version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    const exists = await deps.prisma.person.findFirst({ where: { id: auth.personId, deletedAt: null } });
    if (!exists) throw notFound();
    throw conflict('Your profile changed elsewhere. Refresh and try again.');
  }
  await audit(deps.prisma, { actorAccountId: auth.actorAccountId, action: 'person.alias.update', objectType: 'Person', objectId: auth.personId, authorityType: auth.authorityType, result: 'SUCCEEDED', at: now });
  return { alias: input.alias, version: input.expectedVersion + 1 };
}
