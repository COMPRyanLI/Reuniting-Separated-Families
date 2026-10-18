import type { IncomingStatus, OutgoingStatus } from '@rf/contracts';

const OUT: Record<OutgoingStatus, { text: string; cls: string }> = {
  NO_RESPONSE_YET: { text: 'No response available yet', cls: 'badge-muted' },
  RESPONSE_AVAILABLE: { text: 'Response available', cls: 'badge-ok' },
  RESPONSE_UNAVAILABLE: { text: 'Response unavailable', cls: 'badge-muted' },
  EXPIRED: { text: 'Expired', cls: 'badge-muted' },
  WITHDRAWN: { text: 'Withdrawn by you', cls: 'badge-muted' },
};

const IN: Record<IncomingStatus, { text: string; cls: string }> = {
  AWAITING_DECISION: { text: 'Waiting for your decision', cls: 'badge-warn' },
  RESPONDED: { text: 'Answered', cls: 'badge-ok' },
  DECLINED: { text: 'Declined (they were not told)', cls: 'badge-muted' },
  BLOCKED: { text: 'Blocked (they were not told)', cls: 'badge-danger' },
  CLOSED: { text: 'No longer open', cls: 'badge-muted' },
};

/** Status is always text, never colour alone. */
export function OutgoingStatusBadge({ status }: { status: OutgoingStatus }) {
  return <span className={`badge ${OUT[status].cls}`}>{OUT[status].text}</span>;
}

export function IncomingStatusBadge({ status }: { status: IncomingStatus }) {
  return <span className={`badge ${IN[status].cls}`}>{IN[status].text}</span>;
}
