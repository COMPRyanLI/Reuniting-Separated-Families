-- CreateEnum
CREATE TYPE "CheckInSource" AS ENUM ('SELF_REPORT', 'STAFF_RECORDED');

-- CreateEnum
CREATE TYPE "CheckInState" AS ENUM ('ACTIVE', 'SUPERSEDED', 'DEPARTED');

-- CreateEnum
CREATE TYPE "ReportedStatus" AS ENUM ('UNSPECIFIED', 'REPORTED_OK', 'NEEDS_ASSISTANCE');

-- CreateEnum
CREATE TYPE "EntryOrigin" AS ENUM ('DIRECT', 'PAPER');

-- CreateEnum
CREATE TYPE "ConsentAction" AS ENUM ('INTAKE_PARTICIPATION', 'PRIVACY_CHANGE', 'RELAY_CLUES', 'APPROVE_DISCLOSURE', 'DECLINE', 'BLOCK', 'WITHDRAW', 'REVOKE_GRANT', 'REVOKE_ALL', 'TRANSFER', 'DELETE');

-- CreateEnum
CREATE TYPE "AssistanceMethod" AS ENUM ('SECRET', 'INTAKE_WITNESS');

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "shelterId" UUID,
    "areaId" UUID NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "authorAccountId" UUID NOT NULL,
    "source" "CheckInSource" NOT NULL,
    "state" "CheckInState" NOT NULL DEFAULT 'ACTIVE',
    "reportedStatus" "ReportedStatus" NOT NULL DEFAULT 'UNSPECIFIED',
    "entryOrigin" "EntryOrigin" NOT NULL DEFAULT 'DIRECT',
    "supersedesId" UUID,
    "departedAt" TIMESTAMPTZ(3),
    "createdViaCaseId" UUID,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "actorAccountId" UUID NOT NULL,
    "caseId" UUID,
    "assistanceSessionId" UUID,
    "action" "ConsentAction" NOT NULL,
    "scope" TEXT,
    "detail" TEXT,
    "recipientPersonId" UUID,
    "resourceId" TEXT,
    "statedAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "policyVersion" TEXT NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistanceSession" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "staffAccountId" UUID NOT NULL,
    "method" "AssistanceMethod" NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssistanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "actorAccountId" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "keyDigest" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "outcomeType" TEXT,
    "outcomeId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_supersedesId_key" ON "CheckIn"("supersedesId");

-- CreateIndex
CREATE INDEX "CheckIn_personId_observedAt_idx" ON "CheckIn"("personId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_id_personId_key" ON "CheckIn"("id", "personId");

-- CreateIndex
CREATE INDEX "ConsentRecord_personId_recordedAt_idx" ON "ConsentRecord"("personId", "recordedAt");

-- CreateIndex
CREATE INDEX "AssistanceSession_caseId_staffAccountId_idx" ON "AssistanceSession"("caseId", "staffAccountId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_actorAccountId_operation_subjectKey_keyDi_key" ON "IdempotencyRecord"("actorAccountId", "operation", "subjectKey", "keyDigest");


-- ---------------------------------------------------------------------------
-- Hand-written constraints that the Prisma schema cannot express.
-- ---------------------------------------------------------------------------

-- Check-ins: person, area and (optional) shelter all in the check-in incident, and the
-- shelter must sit in the stated area (composite FK is skipped when shelterId is NULL).
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_person_incident_fkey"
  FOREIGN KEY ("personId", "incidentId") REFERENCES "Person"("id", "incidentId");
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_area_incident_fkey"
  FOREIGN KEY ("areaId", "incidentId") REFERENCES "Area"("id", "incidentId");
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_shelter_area_incident_fkey"
  FOREIGN KEY ("shelterId", "areaId", "incidentId") REFERENCES "Shelter"("id", "areaId", "incidentId");
-- A correction can only supersede a report of the same person.
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_supersedes_same_person_fkey"
  FOREIGN KEY ("supersedesId", "personId") REFERENCES "CheckIn"("id", "personId");
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_author_fkey" FOREIGN KEY ("authorAccountId") REFERENCES "Account"("id");
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_case_fkey" FOREIGN KEY ("createdViaCaseId") REFERENCES "AssistanceCase"("id");
-- Observation may be at most five minutes after receipt (no future reports).
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_not_future" CHECK ("observedAt" <= "receivedAt" + interval '5 minutes');
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_departed_consistent" CHECK (("state" = 'DEPARTED') = ("departedAt" IS NOT NULL));
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_source_case_consistent" CHECK (("source" = 'STAFF_RECORDED') = ("createdViaCaseId" IS NOT NULL));

ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_person_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id");
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_actor_fkey" FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id");
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_case_fkey" FOREIGN KEY ("caseId") REFERENCES "AssistanceCase"("id");
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_assistance_fkey" FOREIGN KEY ("assistanceSessionId") REFERENCES "AssistanceSession"("id");
-- Assisted decisions record the case they were made under.
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_session_needs_case" CHECK ("assistanceSessionId" IS NULL OR "caseId" IS NOT NULL);

ALTER TABLE "AssistanceSession" ADD CONSTRAINT "AssistanceSession_case_fkey" FOREIGN KEY ("caseId") REFERENCES "AssistanceCase"("id");
ALTER TABLE "AssistanceSession" ADD CONSTRAINT "AssistanceSession_staff_fkey" FOREIGN KEY ("staffAccountId") REFERENCES "Account"("id");
ALTER TABLE "AssistanceSession" ADD CONSTRAINT "AssistanceSession_short_lived" CHECK ("expiresAt" > "verifiedAt" AND "expiresAt" <= "verifiedAt" + interval '30 minutes');
