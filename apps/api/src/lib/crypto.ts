import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class DecryptionError extends Error {
  constructor() {
    super('Protected field could not be decrypted');
    this.name = 'DecryptionError';
  }
}

export interface CryptoKeys {
  digestKey: Buffer;
  encryptionKeys: Map<string, Buffer>;
  activeEncryptionKey: string;
}

export type DigestPurpose =
  | 'session'
  | 'csrf'
  | 'contact-code'
  | 'assistance'
  | 'recovery'
  | 'mfa-recovery'
  | 'idempotency'
  | 'payload'
  | 'rate-limit'
  | 'candidate';

/**
 * Thin wrapper around Node's built-in AES-256-GCM and HMAC-SHA256.
 * Ciphertext format: <keyVersion>.<nonce>.<ciphertext>.<tag> (base64url parts).
 * Additional authenticated data binds each ciphertext to its purpose and record id,
 * so copying ciphertext to another record or field fails closed.
 */
export function createCrypto(keys: CryptoKeys) {
  const active = keys.encryptionKeys.get(keys.activeEncryptionKey);
  if (!active) throw new Error('Active encryption key is not configured');

  function aad(purpose: string, recordId: string): Buffer {
    return Buffer.from(`rf:${purpose}:${recordId}`, 'utf8');
  }

  function encrypt(plaintext: string, purpose: string, recordId: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', active!, nonce);
    cipher.setAAD(aad(purpose, recordId));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [keys.activeEncryptionKey, nonce.toString('base64url'), body.toString('base64url'), tag.toString('base64url')].join('.');
  }

  function decrypt(ciphertext: string, purpose: string, recordId: string): string {
    const parts = ciphertext.split('.');
    if (parts.length !== 4) throw new DecryptionError();
    const [version, nonceB64, bodyB64, tagB64] = parts as [string, string, string, string];
    const key = keys.encryptionKeys.get(version);
    if (!key) throw new DecryptionError();
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceB64, 'base64url'));
      decipher.setAAD(aad(purpose, recordId));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(bodyB64, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new DecryptionError();
    }
  }

  function needsReencryption(ciphertext: string): boolean {
    return ciphertext.split('.')[0] !== keys.activeEncryptionKey;
  }

  function reencrypt(ciphertext: string, purpose: string, recordId: string): string {
    return encrypt(decrypt(ciphertext, purpose, recordId), purpose, recordId);
  }

  function digest(purpose: DigestPurpose, value: string): string {
    return createHmac('sha256', keys.digestKey).update(`${purpose}\u0000${value}`).digest('base64url');
  }

  function digestEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }

  return { encrypt, decrypt, reencrypt, needsReencryption, digest, digestEquals };
}

export type AppCrypto = ReturnType<typeof createCrypto>;
