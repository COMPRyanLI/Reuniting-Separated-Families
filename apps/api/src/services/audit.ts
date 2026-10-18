import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Append-only action metadata. Never pass message text, clues, locations or secrets here. */
export interface AuditInput {
  actorAccountId: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  authorityType?: string | null;
  authorityId?: string | null;
  result: 'ALLOWED' | 'DENIED' | 'SUCCEEDED' | 'FAILED' | 'SUPPRESSED';
  at: Date;
}

export async function audit(db: Db, input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      actorAccountId: input.actorAccountId,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId ?? null,
      authorityType: input.authorityType ?? null,
      authorityId: input.authorityId ?? null,
      result: input.result,
      occurredAt: input.at,
    },
  });
}
