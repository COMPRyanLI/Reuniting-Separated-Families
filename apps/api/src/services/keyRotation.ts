import type { Deps } from '../deps.js';

/**
 * Re-encrypts every protected field with the active key version. Run after adding a new
 * key (old versions stay configured until this completes). Decryption failures abort:
 * nothing is ever rewritten as plaintext.
 */
export async function reencryptAll(deps: Deps): Promise<{ reencrypted: number }> {
  const c = deps.crypto;
  let reencrypted = 0;
  const people = await deps.prisma.person.findMany({ where: { encryptedMatchingClue: { not: null } }, select: { id: true, encryptedMatchingClue: true } });
  for (const p of people) {
    if (!c.needsReencryption(p.encryptedMatchingClue!)) continue;
    await deps.prisma.person.update({ where: { id: p.id }, data: { encryptedMatchingClue: c.reencrypt(p.encryptedMatchingClue!, 'person.matchingClue', p.id) } });
    reencrypted++;
  }
  const requests = await deps.prisma.reunionRequest.findMany({
    where: { OR: [{ encryptedIntroduction: { not: null } }, { encryptedClues: { not: null } }] },
    select: { id: true, encryptedIntroduction: true, encryptedClues: true },
  });
  for (const r of requests) {
    const data: { encryptedIntroduction?: string; encryptedClues?: string } = {};
    if (r.encryptedIntroduction && c.needsReencryption(r.encryptedIntroduction)) data.encryptedIntroduction = c.reencrypt(r.encryptedIntroduction, 'request.introduction', r.id);
    if (r.encryptedClues && c.needsReencryption(r.encryptedClues)) data.encryptedClues = c.reencrypt(r.encryptedClues, 'request.clues', r.id);
    if (Object.keys(data).length) {
      await deps.prisma.reunionRequest.update({ where: { id: r.id }, data });
      reencrypted++;
    }
  }
  const responses = await deps.prisma.response.findMany({ where: { encryptedMessage: { not: null } }, select: { id: true, encryptedMessage: true } });
  for (const r of responses) {
    if (!c.needsReencryption(r.encryptedMessage!)) continue;
    await deps.prisma.response.update({ where: { id: r.id }, data: { encryptedMessage: c.reencrypt(r.encryptedMessage!, 'response.message', r.id) } });
    reencrypted++;
  }
  const mfa = await deps.prisma.staffMfa.findMany();
  for (const m of mfa) {
    if (!c.needsReencryption(m.encryptedTotpSecret)) continue;
    await deps.prisma.staffMfa.update({ where: { accountId: m.accountId }, data: { encryptedTotpSecret: c.reencrypt(m.encryptedTotpSecret, 'staff.totp', m.accountId) } });
    reencrypted++;
  }
  deps.logger.info('reencrypt_complete', { reencrypted, activeKey: deps.config.activeEncryptionKey });
  return { reencrypted };
}
