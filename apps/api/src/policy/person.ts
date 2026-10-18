import type { Actor } from '../auth/session.js';
import { notFound } from '../lib/errors.js';

/** Self-service person endpoints act only on the session's own person record. */
export function requireOwnPerson(actor: Actor): string {
  if (!actor.personId) throw notFound();
  return actor.personId;
}
