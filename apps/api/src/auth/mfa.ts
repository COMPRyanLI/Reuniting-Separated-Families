import * as OTPAuth from 'otpauth';

const PERIOD = 30;

function totp(base32Secret: string) {
  return new OTPAuth.TOTP({
    issuer: 'Reconnect demo',
    label: 'staff',
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
}

export function newTotpSecret(): { base32: string; uri: (label: string) => string } {
  const secret = new OTPAuth.Secret({ size: 20 });
  return {
    base32: secret.base32,
    uri: (label: string) =>
      new OTPAuth.TOTP({ issuer: 'Reconnect demo', label, algorithm: 'SHA1', digits: 6, period: PERIOD, secret }).toString(),
  };
}

/**
 * Returns the accepted time step, or null. Accepts the previous/current/next step to
 * tolerate small clock drift; callers must reject steps at or below the last accepted one.
 */
export function verifyTotp(base32Secret: string, code: string, at: Date): number | null {
  const delta = totp(base32Secret).validate({ token: code, timestamp: at.getTime(), window: 1 });
  if (delta === null) return null;
  return Math.floor(at.getTime() / 1000 / PERIOD) + delta;
}
