import { randomBytes, randomInt } from 'node:crypto';

// Crockford base32 alphabet (no I, L, O, U) to avoid transcription mistakes at shelters.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET_LENGTH = 26; // 26 * 5 = 130 bits

function randomChars(n: number): string {
  let out = '';
  const bytes = randomBytes(n);
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i]! & 31];
  return out;
}

/** High-entropy secret (contact code, assistance secret, recovery secret), grouped for reading aloud. */
export function generateSecret(): string {
  const raw = randomChars(SECRET_LENGTH);
  return raw.match(/.{1,4}/g)!.join('-');
}

export function normalizeSecret(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function isWellFormedSecret(input: string): boolean {
  if (input.length > 64) return false;
  return new RegExp(`^[${ALPHABET}]{${SECRET_LENGTH}}$`).test(normalizeSecret(input));
}

/** Neutral, non-secret case reference printed on a reference card. Not a credential. */
export function generateCaseReference(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(32)];
  return `REF-${s.slice(0, 4)}-${s.slice(4)}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
