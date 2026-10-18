import type { Request } from 'express';
import type { z } from 'zod';
import { validation } from '../lib/errors.js';

/** Parses a JSON body with a strict schema; unknown fields are rejected, values never echoed. */
export function parseBody<S extends z.ZodType>(schema: S, req: Request): z.infer<S> {
  return schema.parse(req.body ?? {});
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Malformed IDs get the same neutral 404 as inaccessible ones (checked by callers). */
export function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function param(req: Request, name: string): string {
  const v = req.params[name];
  return typeof v === 'string' ? v : '';
}

export function idempotencyKey(req: Request): string {
  const key = req.get('Idempotency-Key');
  if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw validation([{ path: 'Idempotency-Key', message: 'A retry key is required for this action.' }]);
  }
  return key;
}
