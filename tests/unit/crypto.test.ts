import { describe, expect, it } from 'vitest';
import { createCrypto, DecryptionError } from '../../apps/api/src/lib/crypto.js';
import { generateSecret, normalizeSecret, isWellFormedSecret, generateCaseReference } from '../../apps/api/src/lib/secrets.js';

const k1 = Buffer.alloc(32, 1);
const k2 = Buffer.alloc(32, 2);
const digestKey = Buffer.alloc(32, 9);

describe('DATA-04 field encryption', () => {
  const crypto1 = createCrypto({ digestKey, encryptionKeys: new Map([['v1', k1]]), activeEncryptionKey: 'v1' });

  it('round-trips text and never stores plaintext', () => {
    const ct = crypto1.encrypt('SENTINEL_PRIVATE_TEXT', 'request.introduction', 'id-1');
    expect(ct).not.toContain('SENTINEL_PRIVATE_TEXT');
    expect(ct.startsWith('v1.')).toBe(true);
    expect(crypto1.decrypt(ct, 'request.introduction', 'id-1')).toBe('SENTINEL_PRIVATE_TEXT');
  });

  it('fails closed on tampered ciphertext', () => {
    const ct = crypto1.encrypt('hello', 'request.introduction', 'id-1');
    const parts = ct.split('.');
    const body = Buffer.from(parts[2]!, 'base64url');
    body[0] = body[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], body.toString('base64url'), parts[3]].join('.');
    expect(() => crypto1.decrypt(tampered, 'request.introduction', 'id-1')).toThrow(DecryptionError);
  });

  it('fails closed when ciphertext is moved to another record or purpose', () => {
    const ct = crypto1.encrypt('hello', 'request.introduction', 'id-1');
    expect(() => crypto1.decrypt(ct, 'request.introduction', 'id-2')).toThrow(DecryptionError);
    expect(() => crypto1.decrypt(ct, 'response.message', 'id-1')).toThrow(DecryptionError);
  });

  it('fails closed when the key version is unavailable', () => {
    const only2 = createCrypto({ digestKey, encryptionKeys: new Map([['v2', k2]]), activeEncryptionKey: 'v2' });
    const ct = crypto1.encrypt('hello', 'p', 'id');
    expect(() => only2.decrypt(ct, 'p', 'id')).toThrow(DecryptionError);
  });

  it('decrypts old-version data after rotation and re-encrypts with the active key', () => {
    const rotated = createCrypto({ digestKey, encryptionKeys: new Map([['v1', k1], ['v2', k2]]), activeEncryptionKey: 'v2' });
    const old = crypto1.encrypt('keep me', 'p', 'id');
    expect(rotated.decrypt(old, 'p', 'id')).toBe('keep me');
    const re = rotated.reencrypt(old, 'p', 'id');
    expect(re.startsWith('v2.')).toBe(true);
    expect(rotated.needsReencryption(old)).toBe(true);
    expect(rotated.needsReencryption(re)).toBe(false);
  });
});

describe('purpose-separated digests', () => {
  const c = createCrypto({ digestKey, encryptionKeys: new Map([['v1', k1]]), activeEncryptionKey: 'v1' });
  it('produces different digests for the same value under different purposes', () => {
    expect(c.digest('contact-code', 'ABC')).not.toBe(c.digest('assistance', 'ABC'));
    expect(c.digest('contact-code', 'ABC')).toBe(c.digest('contact-code', 'ABC'));
    expect(c.digest('contact-code', 'ABC')).not.toContain('ABC');
  });
});

describe('secret formats', () => {
  it('generates at least 128 bits of entropy in a grouped readable format', () => {
    const s = generateSecret();
    expect(isWellFormedSecret(s)).toBe(true);
    const normalized = normalizeSecret(s);
    expect(normalized).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    // 26 Crockford base32 characters = 130 bits
    expect(generateSecret()).not.toBe(s);
  });

  it('normalizes case, spaces and dashes and rejects malformed values', () => {
    const s = generateSecret();
    expect(normalizeSecret(s.toLowerCase().replaceAll('-', ' '))).toBe(normalizeSecret(s));
    expect(isWellFormedSecret('short')).toBe(false);
    expect(isWellFormedSecret('U'.repeat(26))).toBe(false);
  });

  it('case references are short, non-secret and distinct from secret format', () => {
    const ref = generateCaseReference();
    expect(ref).toMatch(/^REF-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(isWellFormedSecret(ref)).toBe(false);
  });
});
