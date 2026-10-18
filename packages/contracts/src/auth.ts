import { z } from 'zod';

/** Usernames are login handles only; they are not identity and need not be a real name. */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters.')
  .max(32, 'Use at most 32 characters.')
  .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores.');

/** Long passphrases are welcome; 256 characters is the documented upper bound (never truncated). */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters. A few random words work well.')
  .max(256, 'Use at most 256 characters.');

export const aliasSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name others will see. It can be a nickname.')
  .max(60, 'Use at most 60 characters.')
  .refine((v) => !hasControlCharacters(v), 'Remove control characters.');

export function hasControlCharacters(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

/** A secret-like input. The empty-field message names the field, e.g. secretInput('the contact code'). */
export const secretInput = (what: string) => z.string().trim().min(1, `Enter ${what}.`).max(64, 'That is too long.');

export const registerSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    alias: aliasSchema,
  })
  .strict();
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    username: z.string().max(64),
    password: z.string().max(256),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const recoverSchema = z
  .object({
    username: z.string().max(64),
    recoverySecret: secretInput('your recovery secret'),
    newPassword: passwordSchema,
  })
  .strict();
export type RecoverInput = z.infer<typeof recoverSchema>;

export const reauthSchema = z.object({ password: z.string().min(1).max(256) }).strict();

export const rotateRecoverySchema = z
  .object({
    password: z.string().min(1).max(256),
    kind: z.enum(['ACCOUNT_RECOVERY', 'STAFF_MFA_RECOVERY']),
  })
  .strict();

export const mfaVerifySchema = z.union([
  z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }).strict(),
  z.object({ recoveryCode: secretInput('a recovery code') }).strict(),
]);

export interface SessionDto {
  account: { username: string };
  person: { id: string; alias: string } | null;
  staff: {
    memberships: { shelterName: string | null; role: 'WORKER' | 'COORDINATOR' | 'OPERATOR' }[];
    mfaEnrolled: boolean;
    mfaVerified: boolean;
  } | null;
  csrfToken: string;
  idleTimeoutSeconds: number;
  expiresAt: string;
}
