import type { NotificationKind, Prisma } from '@prisma/client';
import type { NotificationDto } from '@rf/contracts';
import type { Deps } from '../deps.js';
import { notFound } from '../lib/errors.js';

/** Generic wording only. Notifications never contain names, messages or places. */
export const NOTIFICATION_TEXT: Record<NotificationKind, { text: string; link: string }> = {
  REQUEST_RECEIVED: { text: 'You have a new private request to review.', link: '/requests/incoming' },
  RESPONSE_AVAILABLE: { text: 'There is an update on one of your requests.', link: '/requests/outgoing' },
  LEAD_REQUESTED: { text: 'A shelter team asked whether you can add another lead to one of your requests.', link: '/requests/outgoing' },
  CASE_REVIEW_DUE: { text: 'A case at your shelter is due for review.', link: '/staff' },
  TRANSFER_PENDING: { text: 'A case transfer to your shelter is waiting for you.', link: '/staff' },
};

/**
 * Routes a notice to the person's own account, or (for assisted people without an
 * account) to their active case's assigned team. Deduplicated by event key.
 */
export async function notifyPerson(
  deps: Pick<Deps, 'clock'>,
  tx: Prisma.TransactionClient,
  personId: string,
  kind: NotificationKind,
  resource: { type: string; id: string },
  eventKey: string,
): Promise<boolean> {
  const person = await tx.person.findUnique({ where: { id: personId }, include: { account: { select: { state: true } } } });
  if (!person || person.deletedAt) return false;
  const now = deps.clock.now();
  if (person.accountId && person.account?.state === 'ACTIVE') {
    await tx.notification.createMany({
      data: [{ recipientAccountId: person.accountId, eventKey, kind, resourceType: resource.type, resourceId: resource.id, createdAt: now }],
      skipDuplicates: true,
    });
    return true;
  }
  const kase = await tx.assistanceCase.findFirst({ where: { personId, state: 'ACTIVE' } });
  if (!kase) return false;
  await tx.notification.createMany({
    data: [{ assistedCaseId: kase.id, eventKey, kind, resourceType: resource.type, resourceId: resource.id, createdAt: now }],
    skipDuplicates: true,
  });
  return true;
}

export async function notifyAccount(
  deps: Pick<Deps, 'clock'>,
  tx: Prisma.TransactionClient,
  accountId: string,
  kind: NotificationKind,
  resource: { type: string; id: string },
  eventKey: string,
) {
  await tx.notification.createMany({
    data: [{ recipientAccountId: accountId, eventKey, kind, resourceType: resource.type, resourceId: resource.id, createdAt: deps.clock.now() }],
    skipDuplicates: true,
  });
}

export function toNotificationDto(n: { id: string; kind: NotificationKind; createdAt: Date; readAt: Date | null }): NotificationDto {
  return { id: n.id, kind: n.kind, text: NOTIFICATION_TEXT[n.kind].text, link: NOTIFICATION_TEXT[n.kind].link, createdAt: n.createdAt.toISOString(), read: !!n.readAt };
}

export async function listAccountNotifications(deps: Deps, accountId: string) {
  const rows = await deps.prisma.notification.findMany({ where: { recipientAccountId: accountId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return { notifications: rows.map(toNotificationDto), unread: rows.filter((r) => !r.readAt).length };
}

export async function markAccountNotificationRead(deps: Deps, accountId: string, id: string) {
  const updated = await deps.prisma.notification.updateMany({ where: { id, recipientAccountId: accountId }, data: { readAt: deps.clock.now() } });
  if (updated.count === 0) throw notFound();
}
