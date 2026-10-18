-- CreateEnum
CREATE TYPE "RouteState" AS ENUM ('PENDING_ASSIGNMENT', 'ASSIGNED', 'PROPOSED', 'NO_MATCH', 'ENDED');

-- CreateEnum
CREATE TYPE "TransferState" AS ENUM ('PROPOSED', 'ACCEPTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RequestRoute" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "destinationShelterId" UUID NOT NULL,
    "relayConsentId" UUID NOT NULL,
    "state" "RouteState" NOT NULL DEFAULT 'PENDING_ASSIGNMENT',
    "assignedWorkerAccountId" UUID,
    "assignedWorkerMembershipId" UUID,
    "assignedByAccountId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "assignedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RequestRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAsk" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "askedByAccountId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LeadAsk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseTransfer" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "fromShelterId" UUID NOT NULL,
    "toShelterId" UUID NOT NULL,
    "consentId" UUID NOT NULL,
    "state" "TransferState" NOT NULL DEFAULT 'PROPOSED',
    "proposedByAccountId" UUID NOT NULL,
    "decidedByAccountId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CaseTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestRoute_destinationShelterId_state_idx" ON "RequestRoute"("destinationShelterId", "state");

-- CreateIndex
CREATE INDEX "RequestRoute_assignedWorkerAccountId_state_idx" ON "RequestRoute"("assignedWorkerAccountId", "state");

-- CreateIndex
CREATE INDEX "RequestRoute_requestId_idx" ON "RequestRoute"("requestId");

-- CreateIndex
CREATE INDEX "LeadAsk_requestId_idx" ON "LeadAsk"("requestId");

-- CreateIndex
CREATE INDEX "CaseTransfer_toShelterId_state_idx" ON "CaseTransfer"("toShelterId", "state");

-- CreateIndex
CREATE INDEX "CaseTransfer_caseId_idx" ON "CaseTransfer"("caseId");


-- ---------------------------------------------------------------------------
-- Hand-written constraints that the Prisma schema cannot express.
-- ---------------------------------------------------------------------------

-- At most one active destination route per request; destination in the request incident.
CREATE UNIQUE INDEX "RequestRoute_one_active_per_request" ON "RequestRoute"("requestId") WHERE "endedAt" IS NULL;
ALTER TABLE "RequestRoute" ADD CONSTRAINT "RequestRoute_request_fkey" FOREIGN KEY ("requestId") REFERENCES "ReunionRequest"("id");
ALTER TABLE "RequestRoute" ADD CONSTRAINT "RequestRoute_shelter_incident_fkey"
  FOREIGN KEY ("destinationShelterId", "incidentId") REFERENCES "Shelter"("id", "incidentId");
ALTER TABLE "RequestRoute" ADD CONSTRAINT "RequestRoute_consent_fkey" FOREIGN KEY ("relayConsentId") REFERENCES "ConsentRecord"("id");
ALTER TABLE "RequestRoute" ADD CONSTRAINT "RequestRoute_worker_membership_fkey"
  FOREIGN KEY ("assignedWorkerMembershipId", "assignedWorkerAccountId") REFERENCES "StaffMembership"("id", "accountId");
ALTER TABLE "RequestRoute" ADD CONSTRAINT "RequestRoute_assigned_has_worker"
  CHECK ("state" NOT IN ('ASSIGNED', 'PROPOSED') OR "assignedWorkerAccountId" IS NOT NULL);
ALTER TABLE "RequestRoute" ADD CONSTRAINT "RequestRoute_ended_consistent" CHECK (("state" = 'ENDED') = ("endedAt" IS NOT NULL));

ALTER TABLE "LeadAsk" ADD CONSTRAINT "LeadAsk_request_fkey" FOREIGN KEY ("requestId") REFERENCES "ReunionRequest"("id");

-- One pending transfer per case; destination differs from source; same incident.
CREATE UNIQUE INDEX "CaseTransfer_one_pending_per_case" ON "CaseTransfer"("caseId") WHERE "state" = 'PROPOSED';
ALTER TABLE "CaseTransfer" ADD CONSTRAINT "CaseTransfer_case_incident_fkey"
  FOREIGN KEY ("caseId", "incidentId") REFERENCES "AssistanceCase"("id", "incidentId");
ALTER TABLE "CaseTransfer" ADD CONSTRAINT "CaseTransfer_from_incident_fkey"
  FOREIGN KEY ("fromShelterId", "incidentId") REFERENCES "Shelter"("id", "incidentId");
ALTER TABLE "CaseTransfer" ADD CONSTRAINT "CaseTransfer_to_incident_fkey"
  FOREIGN KEY ("toShelterId", "incidentId") REFERENCES "Shelter"("id", "incidentId");
ALTER TABLE "CaseTransfer" ADD CONSTRAINT "CaseTransfer_distinct_shelters" CHECK ("fromShelterId" <> "toShelterId");
ALTER TABLE "CaseTransfer" ADD CONSTRAINT "CaseTransfer_consent_fkey" FOREIGN KEY ("consentId") REFERENCES "ConsentRecord"("id");
