import argon2 from 'argon2';

/**
 * Argon2id with the OWASP baseline (19 MiB memory, 2 iterations, parallelism 1).
 * Inputs are bounded by the request schema (max 256 characters) before hashing.
 */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;
/** Spend comparable work for unknown usernames so timing does not reveal account existence. */
export async function dummyVerify(password: string): Promise<false> {
  dummyHash ??= argon2.hash('dummy-password-for-timing-equalization', OPTIONS);
  await verifyPassword(await dummyHash, password);
  return false;
}
