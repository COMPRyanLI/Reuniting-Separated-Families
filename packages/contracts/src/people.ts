import { z } from 'zod';
import { aliasSchema, secretInput } from './auth.js';

export const requestModeSchema = z.enum(['CLOSED', 'CODE_ONLY', 'ASSISTED']);
export type RequestMode = z.infer<typeof requestModeSchema>;

export const reportedStatusSchema = z.enum(['UNSPECIFIED', 'REPORTED_OK', 'NEEDS_ASSISTANCE']);
export type ReportedStatus = z.infer<typeof reportedStatusSchema>;

const uuid = z.string().uuid();
const expectedVersion = z.number().int().min(1);

export const profileUpdateSchema = z.object({ alias: aliasSchema, expectedVersion }).strict();

export const privacyUpdateSchema = z.object({ requestMode: requestModeSchema, expectedVersion }).strict();

/** Optional distinguishing clue used only for opted-in assisted matching. No legal, medical or ID details. */
export const matchingClueSchema = z.string().trim().max(120, 'Use at most 120 characters.');

export const staffPrivacyUpdateSchema = z
  .object({
    requestMode: requestModeSchema,
    matchingClue: matchingClueSchema.nullable().optional(),
    expectedVersion,
  })
  .strict();

/**
 * A check-in names a shelter (its area is implied) or an area alone. There are no
 * coordinate fields: unknown precise-location fields are rejected by `.strict()`.
 */
export const checkInCreateSchema = z
  .object({
    shelterId: uuid.optional(),
    areaId: uuid.optional(),
    observedAt: z.string().datetime({ offset: true }),
    reportedStatus: reportedStatusSchema.default('UNSPECIFIED'),
    supersedesId: uuid.optional(),
    entryOrigin: z.enum(['DIRECT', 'PAPER']).default('DIRECT'),
  })
  .strict()
  .refine((v) => !!v.shelterId || !!v.areaId, { message: 'Choose a shelter or an area.', path: ['shelterId'] });
export type CheckInCreateInput = z.infer<typeof checkInCreateSchema>;

export const intakeSchema = z
  .object({
    alias: aliasSchema,
    /** Required only for staff who work at more than one shelter; must be one of their own. */
    shelterId: uuid.optional(),
    /** Defaults to CODE_ONLY; restricted referrals are always CLOSED. */
    requestMode: requestModeSchema.optional(),
    matchingClue: matchingClueSchema.optional(),
    restrictedReferral: z.boolean().default(false),
    /** The worker confirms the person agreed to this intake (witnessed, not cryptographically proven). */
    intakeConsent: z.literal(true, { message: 'Confirm the person agreed to this intake.' }),
    checkIn: z
      .object({
        observedAt: z.string().datetime({ offset: true }),
        reportedStatus: reportedStatusSchema.default('UNSPECIFIED'),
        entryOrigin: z.enum(['DIRECT', 'PAPER']).default('DIRECT'),
      })
      .strict()
      .optional(),
    issueContactCode: z.boolean().default(false),
  })
  .strict();
export type IntakeInput = z.infer<typeof intakeSchema>;

export const assistanceVerifySchema = z.object({ assistanceSecret: secretInput('the assistance secret') }).strict();

export const assignmentCreateSchema = z
  .object({
    membershipId: uuid,
    purposes: z.array(z.enum(['INTAKE', 'ASSIST'])).min(1).max(2).default(['ASSIST']),
  })
  .strict();

export interface PlaceDto {
  kind: 'SHELTER' | 'AREA';
  areaLabel: string;
  shelterName?: string;
  shelterAddress?: string;
}

export interface OwnCheckInDto {
  id: string;
  place: PlaceDto & { shelterId?: string; areaId: string };
  observedAt: string;
  receivedAt: string;
  source: 'self_report' | 'staff_recorded';
  state: 'ACTIVE' | 'SUPERSEDED' | 'DEPARTED';
  reportedStatus: ReportedStatus;
  entryOrigin: 'DIRECT' | 'PAPER';
  supersedesId: string | null;
}

export interface ShelterDto {
  id: string;
  name: string;
  publicAddress: string;
  area: { id: string; label: string };
}
