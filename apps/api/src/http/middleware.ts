import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { DecryptionError } from '../lib/crypto.js';
import type { Logger } from '../lib/logger.js';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/** Access log with metadata only: no query string, body, cookies or headers. */
export function accessLog(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : 'unmatched';
      logger.info('http', {
        requestId: req.requestId,
        method: req.method,
        route,
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      });
    });
    next();
  };
}

export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

export function apiNotFound(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', 'Not found.'));
}

export function errorHandler(logger: Logger) {
  // Express identifies error handlers by arity; keep four parameters.
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    let appError: AppError;
    if (err instanceof AppError) {
      appError = err;
    } else if (err instanceof ZodError) {
      appError = new AppError(
        422,
        'VALIDATION_FAILED',
        'Some fields need attention.',
        // Paths and messages only; never the submitted values.
        err.issues.map((i) => ({ path: i.path.join('.') || '(body)', message: safeIssueMessage(i.code, i.message) })),
      );
    } else if (isBodyParserError(err)) {
      appError =
        err.type === 'entity.too.large'
          ? new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request is too large.')
          : new AppError(422, 'VALIDATION_FAILED', 'Request body must be valid JSON.');
    } else if (err instanceof DecryptionError) {
      logger.error('decryption_failed', { requestId: req.requestId });
      appError = new AppError(500, 'INTERNAL', 'Something went wrong. Please try again later.');
    } else {
      logger.error('unhandled_error', {
        requestId: req.requestId,
        name: err instanceof Error ? err.name : typeof err,
        // Prisma error codes are safe metadata; messages may contain values, so they are omitted.
        code: typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : undefined,
      });
      appError = new AppError(500, 'INTERNAL', 'Something went wrong. Please try again later.');
    }
    if (appError.retryAfterSeconds !== undefined) res.setHeader('Retry-After', String(appError.retryAfterSeconds));
    res.status(appError.status).json({
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
        requestId: req.requestId,
      },
    });
  };
}

/** Zod messages for some issue codes can quote input; replace those with generic text. */
function safeIssueMessage(code: string, message: string): string {
  if (code === 'unrecognized_keys') return 'Unexpected field.';
  // invalid_value messages name the schema's allowed values (or a custom message), never the input.
  if (code === 'invalid_union') return 'Invalid value.';
  return message.length > 200 ? 'Invalid value.' : message;
}

function isBodyParserError(err: unknown): err is { type: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { type?: unknown }).type === 'string' &&
    ['entity.too.large', 'entity.parse.failed', 'encoding.unsupported', 'charset.unsupported'].includes(
      (err as { type: string }).type,
    )
  );
}
