export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CSRF_REJECTED'
  | 'MFA_REQUIRED'
  | 'VERIFICATION_REQUIRED'
  | 'REAUTH_FAILED'
  | 'MFA_REJECTED'
  | 'PAYLOAD_TOO_LARGE'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

export interface FieldError {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fieldErrors?: FieldError[],
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
/** Identical envelope for nonexistent and inaccessible objects. */
export const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found.');
export const forbidden = (message = 'This action is not allowed.') => new AppError(403, 'FORBIDDEN', message);
export const conflict = (message = 'This record changed. Refresh and try again.') => new AppError(409, 'CONFLICT', message);
export const validation = (fieldErrors: FieldError[], message = 'Some fields need attention.') =>
  new AppError(422, 'VALIDATION_FAILED', message, fieldErrors);
export const rateLimited = (retryAfterSeconds: number) =>
  new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.', undefined, retryAfterSeconds);
export const mfaRequired = () => new AppError(403, 'MFA_REQUIRED', 'Complete two-step verification to use staff tools.');
