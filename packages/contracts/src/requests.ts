import { z } from 'zod';
import { secretInput } from './auth.js';

const uuid = z.string().uuid();

export const introductionSchema = z
  .string()
  .trim()
  .min(1, 'Write a short introduction so the person knows who is asking.')
  .max(500, 'Use at most 500 characters.');

export const cluesSchema = z.string().trim().max(500, 'Use at most 500 characters.');

export const codeRequestSchema = z
  .object({
    routeType: z.literal('CODE'),
    contactCode: secretInput('the contact code'),
    introduction: introductionSchema,
  })
  .strict();

/** No-code request: optional clues and at most one explicitly chosen shelter lead, with relay consent. */
export const routedRequestSchema = z
  .object({
    routeType: z.literal('ROUTED'),
    introduction: introductionSchema,
    clues: cluesSchema.optional(),
    destinationShelterId: uuid.optional(),
    relayConsent: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !v.destinationShelterId || v.relayConsent === true, {
    message: 'Confirm that your clues may be shared with that shelter’s team.',
    path: ['relayConsent'],
  });

export const requestCreateSchema = z.union([codeRequestSchema, routedRequestSchema]);
export type RequestCreateInput = z.infer<typeof codeRequestSchema> | z.infer<typeof routedRequestSchema>;

export const leadUpdateSchema = z
  .object({
    destinationShelterId: uuid,
    clues: cluesSchema.optional(),
    relayConsent: z.literal(true, { message: 'Confirm that your clues may be shared with that shelter’s team.' }),
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export const shareScopeSchema = z.enum(['SAFETY_MESSAGE', 'AREA', 'SHELTER']);
export type ShareScope = z.infer<typeof shareScopeSchema>;
export const safetyStatementSchema = z.enum(['NONE', 'REPORTED_OK', 'NEED_HELP', 'WILL_BE_IN_TOUCH']);
export type SafetyStatement = z.infer<typeof safetyStatementSchema>;

export const SAFETY_STATEMENT_TEXT: Record<SafetyStatement, string> = {
  NONE: '',
  REPORTED_OK: 'I am OK.',
  NEED_HELP: 'I need help.',
  WILL_BE_IN_TOUCH: 'I got your message and will be in touch.',
};

export const respondSchema = z
  .object({
    scope: shareScopeSchema,
    statement: safetyStatementSchema.default('NONE'),
    message: z.string().trim().max(280, 'Use at most 280 characters.').optional(),
    checkInId: uuid.optional(),
    expiresIn: z.enum(['24h', '7d']),
    expectedVersion: z.number().int().min(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.scope === 'SAFETY_MESSAGE' && v.checkInId) {
      ctx.addIssue({ code: 'custom', path: ['checkInId'], message: 'A safety message does not include a check-in.' });
    }
    if (v.scope !== 'SAFETY_MESSAGE' && !v.checkInId) {
      ctx.addIssue({ code: 'custom', path: ['checkInId'], message: 'Choose which check-in to share.' });
    }
    if (v.statement === 'NONE' && !v.message) {
      ctx.addIssue({ code: 'custom', path: ['message'], message: 'Choose a message or write a short one.' });
    }
  });
export type RespondInput = z.infer<typeof respondSchema>;

export const abuseReportSchema = z
  .object({
    requestId: uuid.optional(),
    responseId: uuid.optional(),
    category: z.enum(['HARASSMENT', 'IMPERSONATION', 'UNSAFE_CONTENT', 'OTHER']),
  })
  .strict()
  .refine((v) => !!v.requestId !== !!v.responseId, { message: 'Report exactly one request or response.', path: ['requestId'] });

/** What a requester may see about their own request. Never recipient identity or hidden outcomes. */
export type OutgoingStatus = 'NO_RESPONSE_YET' | 'RESPONSE_AVAILABLE' | 'RESPONSE_UNAVAILABLE' | 'EXPIRED' | 'WITHDRAWN';

export interface OutgoingRequestDto {
  id: string;
  routeType: 'CODE' | 'ROUTED';
  submittedAt: string;
  expiresAt: string;
  introduction: string | null;
  status: OutgoingStatus;
  responseId: string | null;
  lead: { shelterName: string } | null;
  version: number;
}

export type IncomingStatus = 'AWAITING_DECISION' | 'RESPONDED' | 'DECLINED' | 'BLOCKED' | 'CLOSED';

export interface IncomingRequestDto {
  id: string;
  requesterAlias: string;
  introduction: string | null;
  receivedAt: string;
  expiresAt: string;
  status: IncomingStatus;
  version: number;
  yourResponse: { scope: ShareScope; grantStatus: 'ACTIVE' | 'EXPIRED' | 'REVOKED' } | null;
}

export interface ResponseLocationDto {
  kind: 'AREA' | 'SHELTER';
  areaLabel: string;
  shelterName?: string;
  shelterAddress?: string;
  observedAt: string;
  source: 'self_report' | 'staff_recorded';
  reportStatus: 'AS_REPORTED' | 'NO_LONGER_CURRENT';
}

/** Exactly the fields a grant recipient may read. AREA never includes shelter fields. */
export interface ResponseDto {
  responseId: string;
  scope: ShareScope;
  sharedAlias: string;
  statement: SafetyStatement;
  message: string | null;
  respondedAt: string;
  expiresAt: string;
  location?: ResponseLocationDto;
}

export interface GrantDto {
  grantId: string;
  recipientAlias: string;
  scope: ShareScope;
  sharedPlace: string | null;
  createdAt: string;
  expiresAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

export interface NotificationDto {
  id: string;
  kind: string;
  text: string;
  link: string;
  createdAt: string;
  read: boolean;
}

export const routeAssignSchema = z.object({ membershipId: uuid }).strict();
export const proposeRecipientSchema = z.object({ candidateToken: z.string().min(10).max(100) }).strict();
export const transferProposeSchema = z
  .object({
    toShelterId: uuid,
    personConsent: z.literal(true, { message: 'Confirm the person chose this transfer.' }),
  })
  .strict();
export const transferAcceptSchema = z.object({ assistanceSecret: secretInput('the assistance secret'), membershipId: uuid }).strict();
export const caseReviewSchema = z.object({ action: z.literal('EXTEND_30_DAYS') }).strict();
export const deleteSelfSchema = z.object({ password: z.string().min(1).max(256), confirm: z.literal(true) }).strict();
export const staffDeletePersonSchema = z.object({ confirm: z.literal(true, { message: 'Confirm the person asked for deletion.' }) }).strict();
