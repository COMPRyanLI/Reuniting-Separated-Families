-- CreateEnum
CREATE TYPE "RouteType" AS ENUM ('CODE', 'ROUTED');

-- CreateEnum
CREATE TYPE "RequestState" AS ENUM ('SUBMITTED', 'ROUTING', 'UNRESOLVED', 'AWAITING_DECISION', 'RESPONDED', 'DECLINED', 'BLOCKED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ShareScope" AS ENUM ('SAFETY_MESSAGE', 'AREA', 'SHELTER');

-- CreateEnum
CREATE TYPE "SafetyStatement" AS ENUM ('NONE', 'REPORTED_OK', 'NEED_HELP', 'WILL_BE_IN_TOUCH');

-- CreateEnum
CREATE TYPE "AbuseCategory" AS ENUM ('HARASSMENT', 'IMPERSONATION', 'UNSAFE_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('REQUEST_RECEIVED', 'RESPONSE_AVAILABLE', 'LEAD_REQUESTED', 'CASE_REVIEW_DUE', 'TRANSFER_PENDING');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "ReunionRequest" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "requesterPersonId" UUID NOT NULL,
    "recipientPersonId" UUID,
    "routeType" "RouteType" NOT NULL,
    "codeDigest" TEXT,
    "requesterAliasSnapshot" TEXT NOT NULL,
    "encryptedIntroduction" TEXT,
    "encryptedClues" TEXT,
    "internalState" "RequestState" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "deliveredAt" TIMESTAMPTZ(3),
    "withdrawnAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "textPurgedAt" TIMESTAMPTZ(3),
    "createdByAccountId" UUID NOT NULL,
    "createdViaCaseId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ReunionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Response" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "subjectPersonId" UUID NOT NULL,
    "scope" "ShareScope" NOT NULL,
    "statement" "SafetyStatement" NOT NULL DEFAULT 'NONE',
    "encryptedMessage" TEXT,
    "checkInId" UUID,
    "sharedAlias" TEXT NOT NULL,
    "consentId" UUID NOT NULL,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL,
    "approvedByAccountId" UUID NOT NULL,
    "viaCaseId" UUID,

    CONSTRAINT "Response_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharingGrant" (
    "id" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "subjectPersonId" UUID NOT NULL,
    "recipientPersonId" UUID NOT NULL,
    "scope" "ShareScope" NOT NULL,
    "checkInId" UUID,
    "consentId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedReason" TEXT,

    CONSTRAINT "SharingGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" UUID NOT NULL,
    "subjectPersonId" UUID NOT NULL,
    "blockedPersonId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbuseReport" (
    "id" UUID NOT NULL,
    "reporterPersonId" UUID NOT NULL,
    "reporterAccountId" UUID NOT NULL,
    "requestId" UUID,
    "responseId" UUID,
    "category" "AbuseCategory" NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AbuseReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "recipientAccountId" UUID,
    "assistedCaseId" UUID,
    "eventKey" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxJob" (
    "id" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "referencePayload" JSONB NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL,
    "leaseUntil" TIMESTAMPTZ(3),
    "lastErrorCode" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutboxJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReunionRequest_requesterPersonId_submittedAt_idx" ON "ReunionRequest"("requesterPersonId", "submittedAt");

-- CreateIndex
CREATE INDEX "ReunionRequest_recipientPersonId_internalState_idx" ON "ReunionRequest"("recipientPersonId", "internalState");

-- CreateIndex
CREATE INDEX "ReunionRequest_internalState_expiresAt_idx" ON "ReunionRequest"("internalState", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReunionRequest_id_recipientPersonId_key" ON "ReunionRequest"("id", "recipientPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "ReunionRequest_id_requesterPersonId_key" ON "ReunionRequest"("id", "requesterPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "Response_requestId_key" ON "Response"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Response_id_requestId_subjectPersonId_scope_key" ON "Response"("id", "requestId", "subjectPersonId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "SharingGrant_responseId_key" ON "SharingGrant"("responseId");

-- CreateIndex
CREATE INDEX "SharingGrant_recipientPersonId_expiresAt_idx" ON "SharingGrant"("recipientPersonId", "expiresAt");

-- CreateIndex
CREATE INDEX "SharingGrant_subjectPersonId_idx" ON "SharingGrant"("subjectPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_subjectPersonId_blockedPersonId_key" ON "Block"("subjectPersonId", "blockedPersonId");

-- CreateIndex
CREATE INDEX "Notification_recipientAccountId_createdAt_idx" ON "Notification"("recipientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_assistedCaseId_createdAt_idx" ON "Notification"("assistedCaseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_eventKey_recipientAccountId_key" ON "Notification"("eventKey", "recipientAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_eventKey_assistedCaseId_key" ON "Notification"("eventKey", "assistedCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxJob_eventKey_key" ON "OutboxJob"("eventKey");

-- CreateIndex
CREATE INDEX "OutboxJob_state_availableAt_idx" ON "OutboxJob"("state", "availableAt");


-- ---------------------------------------------------------------------------
-- Hand-written constraints that the Prisma schema cannot express.
-- ---------------------------------------------------------------------------

-- Requests: participants are people in the request incident; nobody requests themself.
ALTER TABLE "ReunionRequest" ADD CONSTRAINT "ReunionRequest_requester_fkey"
  FOREIGN KEY ("requesterPersonId", "incidentId") REFERENCES "Person"("id", "incidentId");
ALTER TABLE "ReunionRequest" ADD CONSTRAINT "ReunionRequest_recipient_fkey"
  FOREIGN KEY ("recipientPersonId", "incidentId") REFERENCES "Person"("id", "incidentId");
ALTER TABLE "ReunionRequest" ADD CONSTRAINT "ReunionRequest_not_self" CHECK ("recipientPersonId" IS NULL OR "recipientPersonId" <> "requesterPersonId");
ALTER TABLE "ReunionRequest" ADD CONSTRAINT "ReunionRequest_creator_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id");
ALTER TABLE "ReunionRequest" ADD CONSTRAINT "ReunionRequest_case_fkey" FOREIGN KEY ("createdViaCaseId") REFERENCES "AssistanceCase"("id");
ALTER TABLE "ReunionRequest" ADD CONSTRAINT "ReunionRequest_code_only_for_code_route" CHECK ("codeDigest" IS NULL OR "routeType" = 'CODE');
ALTER TABLE "ReunionRequest" ADD CONSTRAINT "ReunionRequest_awaiting_has_recipient"
  CHECK ("internalState" NOT IN ('AWAITING_DECISION', 'RESPONDED', 'DECLINED', 'BLOCKED') OR "recipientPersonId" IS NOT NULL);

-- Invariant 1: the response subject is the request's resolved recipient.
ALTER TABLE "Response" ADD CONSTRAINT "Response_subject_is_recipient_fkey"
  FOREIGN KEY ("requestId", "subjectPersonId") REFERENCES "ReunionRequest"("id", "recipientPersonId");
-- Invariant 2: a disclosed check-in belongs to the subject; scope and check-in agree.
ALTER TABLE "Response" ADD CONSTRAINT "Response_checkin_owned_fkey"
  FOREIGN KEY ("checkInId", "subjectPersonId") REFERENCES "CheckIn"("id", "personId");
ALTER TABLE "Response" ADD CONSTRAINT "Response_scope_checkin" CHECK (("scope" = 'SAFETY_MESSAGE') = ("checkInId" IS NULL));
ALTER TABLE "Response" ADD CONSTRAINT "Response_consent_fkey" FOREIGN KEY ("consentId") REFERENCES "ConsentRecord"("id");
ALTER TABLE "Response" ADD CONSTRAINT "Response_approver_fkey" FOREIGN KEY ("approvedByAccountId") REFERENCES "Account"("id");

-- Grants mirror exactly one response; the grant recipient is the request's requester.
ALTER TABLE "SharingGrant" ADD CONSTRAINT "SharingGrant_response_match_fkey"
  FOREIGN KEY ("responseId", "requestId", "subjectPersonId", "scope") REFERENCES "Response"("id", "requestId", "subjectPersonId", "scope");
ALTER TABLE "SharingGrant" ADD CONSTRAINT "SharingGrant_recipient_is_requester_fkey"
  FOREIGN KEY ("requestId", "recipientPersonId") REFERENCES "ReunionRequest"("id", "requesterPersonId");
ALTER TABLE "SharingGrant" ADD CONSTRAINT "SharingGrant_checkin_owned_fkey"
  FOREIGN KEY ("checkInId", "subjectPersonId") REFERENCES "CheckIn"("id", "personId");
ALTER TABLE "SharingGrant" ADD CONSTRAINT "SharingGrant_scope_checkin" CHECK (("scope" = 'SAFETY_MESSAGE') = ("checkInId" IS NULL));
ALTER TABLE "SharingGrant" ADD CONSTRAINT "SharingGrant_not_self" CHECK ("recipientPersonId" <> "subjectPersonId");
ALTER TABLE "SharingGrant" ADD CONSTRAINT "SharingGrant_expiry_bounded" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '7 days');
ALTER TABLE "SharingGrant" ADD CONSTRAINT "SharingGrant_consent_fkey" FOREIGN KEY ("consentId") REFERENCES "ConsentRecord"("id");

ALTER TABLE "Block" ADD CONSTRAINT "Block_subject_fkey" FOREIGN KEY ("subjectPersonId") REFERENCES "Person"("id");
ALTER TABLE "Block" ADD CONSTRAINT "Block_blocked_fkey" FOREIGN KEY ("blockedPersonId") REFERENCES "Person"("id");
ALTER TABLE "Block" ADD CONSTRAINT "Block_not_self" CHECK ("subjectPersonId" <> "blockedPersonId");

ALTER TABLE "AbuseReport" ADD CONSTRAINT "AbuseReport_reporter_fkey" FOREIGN KEY ("reporterPersonId") REFERENCES "Person"("id");
ALTER TABLE "AbuseReport" ADD CONSTRAINT "AbuseReport_request_fkey" FOREIGN KEY ("requestId") REFERENCES "ReunionRequest"("id");
ALTER TABLE "AbuseReport" ADD CONSTRAINT "AbuseReport_response_fkey" FOREIGN KEY ("responseId") REFERENCES "Response"("id");
ALTER TABLE "AbuseReport" ADD CONSTRAINT "AbuseReport_one_reference" CHECK (num_nonnulls("requestId", "responseId") = 1);

-- Exactly one notification destination: an account, or an assisted case's assigned team.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_one_destination" CHECK (num_nonnulls("recipientAccountId", "assistedCaseId") = 1);
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_account_fkey" FOREIGN KEY ("recipientAccountId") REFERENCES "Account"("id");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_case_fkey" FOREIGN KEY ("assistedCaseId") REFERENCES "AssistanceCase"("id");

ALTER TABLE "OutboxJob" ADD CONSTRAINT "OutboxJob_attempts_nonnegative" CHECK ("attempts" >= 0);
