-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountState" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('INDIVIDUAL', 'STAFF');

-- CreateEnum
CREATE TYPE "RecoveryPurpose" AS ENUM ('ACCOUNT_RECOVERY', 'STAFF_MFA_RECOVERY');

-- CreateEnum
CREATE TYPE "IncidentState" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ShelterState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "RequestMode" AS ENUM ('CLOSED', 'CODE_ONLY', 'ASSISTED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('WORKER', 'COORDINATOR', 'OPERATOR');

-- CreateEnum
CREATE TYPE "MembershipState" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CaseState" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "AssignmentPurpose" AS ENUM ('INTAKE', 'ASSIST');

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "normalizedUsername" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "state" "AccountState" NOT NULL DEFAULT 'ACTIVE',
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUserActivityAt" TIMESTAMPTZ(3) NOT NULL,
    "idleTimeoutSeconds" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "mfaVerifiedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryCredential" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "purpose" "RecoveryPurpose" NOT NULL,
    "digest" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RecoveryCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMfa" (
    "accountId" UUID NOT NULL,
    "encryptedTotpSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "enrolledAt" TIMESTAMPTZ(3),
    "lastAcceptedStep" INTEGER,

    CONSTRAINT "StaffMfa_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "state" "IncidentState" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shelter" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "areaId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "publicAddress" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "state" "ShelterState" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "Shelter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" UUID NOT NULL,
    "accountId" UUID,
    "incidentId" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "encryptedMatchingClue" TEXT,
    "requestMode" "RequestMode" NOT NULL DEFAULT 'CODE_ONLY',
    "restrictedReferral" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "purgedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactCode" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "digest" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ContactCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistanceCredential" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "digest" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssistanceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMembership" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "shelterId" UUID,
    "role" "StaffRole" NOT NULL,
    "state" "MembershipState" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "suspendedAt" TIMESTAMPTZ(3),

    CONSTRAINT "StaffMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistanceCase" (
    "id" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "shelterId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "state" "CaseState" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "lastActivityAt" TIMESTAMPTZ(3) NOT NULL,
    "lastReviewedAt" TIMESTAMPTZ(3),
    "reviewExtendedUntil" TIMESTAMPTZ(3),
    "escalationOpenedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AssistanceCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAssignment" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "staffAccountId" UUID NOT NULL,
    "purposes" "AssignmentPurpose"[],
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3),
    "assignedByAccountId" UUID NOT NULL,
    "endedReason" TEXT,

    CONSTRAINT "CaseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorAccountId" UUID,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "authorityType" TEXT,
    "authorityId" TEXT,
    "result" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "scopeDigest" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("scopeDigest","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_normalizedUsername_key" ON "Account"("normalizedUsername");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenDigest_key" ON "Session"("tokenDigest");

-- CreateIndex
CREATE INDEX "Session_accountId_idx" ON "Session"("accountId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCredential_digest_key" ON "RecoveryCredential"("digest");

-- CreateIndex
CREATE INDEX "RecoveryCredential_accountId_purpose_idx" ON "RecoveryCredential"("accountId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_slug_key" ON "Incident"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Area_id_incidentId_key" ON "Area"("id", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "Area_incidentId_label_key" ON "Area"("incidentId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Shelter_id_incidentId_key" ON "Shelter"("id", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "Shelter_id_areaId_incidentId_key" ON "Shelter"("id", "areaId", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "Shelter_incidentId_name_key" ON "Shelter"("incidentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Person_accountId_key" ON "Person"("accountId");

-- CreateIndex
CREATE INDEX "Person_incidentId_idx" ON "Person"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_id_incidentId_key" ON "Person"("id", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactCode_digest_key" ON "ContactCode"("digest");

-- CreateIndex
CREATE INDEX "ContactCode_personId_idx" ON "ContactCode"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistanceCredential_digest_key" ON "AssistanceCredential"("digest");

-- CreateIndex
CREATE INDEX "AssistanceCredential_personId_idx" ON "AssistanceCredential"("personId");

-- CreateIndex
CREATE INDEX "StaffMembership_accountId_idx" ON "StaffMembership"("accountId");

-- CreateIndex
CREATE INDEX "StaffMembership_shelterId_state_idx" ON "StaffMembership"("shelterId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMembership_id_incidentId_key" ON "StaffMembership"("id", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMembership_id_accountId_key" ON "StaffMembership"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistanceCase_reference_key" ON "AssistanceCase"("reference");

-- CreateIndex
CREATE INDEX "AssistanceCase_shelterId_state_idx" ON "AssistanceCase"("shelterId", "state");

-- CreateIndex
CREATE INDEX "AssistanceCase_personId_idx" ON "AssistanceCase"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistanceCase_id_incidentId_key" ON "AssistanceCase"("id", "incidentId");

-- CreateIndex
CREATE INDEX "CaseAssignment_staffAccountId_endsAt_idx" ON "CaseAssignment"("staffAccountId", "endsAt");

-- CreateIndex
CREATE INDEX "CaseAssignment_caseId_idx" ON "CaseAssignment"("caseId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_objectType_objectId_idx" ON "AuditEvent"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCredential" ADD CONSTRAINT "RecoveryCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMfa" ADD CONSTRAINT "StaffMfa_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shelter" ADD CONSTRAINT "Shelter_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shelter" ADD CONSTRAINT "Shelter_areaId_incidentId_fkey" FOREIGN KEY ("areaId", "incidentId") REFERENCES "Area"("id", "incidentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactCode" ADD CONSTRAINT "ContactCode_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistanceCredential" ADD CONSTRAINT "AssistanceCredential_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMembership" ADD CONSTRAINT "StaffMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistanceCase" ADD CONSTRAINT "AssistanceCase_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AssistanceCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "StaffMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written constraints that the Prisma schema cannot express.
-- ---------------------------------------------------------------------------

-- At most one active secret of each kind per owner.
CREATE UNIQUE INDEX "ContactCode_one_active_per_person" ON "ContactCode"("personId") WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "AssistanceCredential_one_active_per_person" ON "AssistanceCredential"("personId") WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "RecoveryCredential_one_active_account_recovery" ON "RecoveryCredential"("accountId")
  WHERE "purpose" = 'ACCOUNT_RECOVERY' AND "usedAt" IS NULL AND "revokedAt" IS NULL;

-- People belong to an incident.
ALTER TABLE "Person" ADD CONSTRAINT "Person_incident_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id");

-- Memberships: shelter must be in the membership incident; only operators lack a shelter.
ALTER TABLE "StaffMembership" ADD CONSTRAINT "StaffMembership_incident_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id");
ALTER TABLE "StaffMembership" ADD CONSTRAINT "StaffMembership_shelter_incident_fkey"
  FOREIGN KEY ("shelterId", "incidentId") REFERENCES "Shelter"("id", "incidentId");
ALTER TABLE "StaffMembership" ADD CONSTRAINT "StaffMembership_role_scope_check" CHECK (("role" = 'OPERATOR') = ("shelterId" IS NULL));
CREATE UNIQUE INDEX "StaffMembership_one_active_role" ON "StaffMembership"
  ("accountId", "incidentId", COALESCE("shelterId", '00000000-0000-0000-0000-000000000000'::uuid), "role")
  WHERE "state" = 'ACTIVE';

-- Cases: person and shelter in the case incident; one active case per person per incident.
ALTER TABLE "AssistanceCase" ADD CONSTRAINT "AssistanceCase_person_incident_fkey"
  FOREIGN KEY ("personId", "incidentId") REFERENCES "Person"("id", "incidentId");
ALTER TABLE "AssistanceCase" ADD CONSTRAINT "AssistanceCase_shelter_incident_fkey"
  FOREIGN KEY ("shelterId", "incidentId") REFERENCES "Shelter"("id", "incidentId");
CREATE UNIQUE INDEX "AssistanceCase_one_active_per_person" ON "AssistanceCase"("personId", "incidentId") WHERE "state" = 'ACTIVE';

-- Assignments: case and membership share the assignment incident, and the membership
-- belongs to the assigned staff account (DB-02: no cross-incident assignment).
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_case_incident_fkey"
  FOREIGN KEY ("caseId", "incidentId") REFERENCES "AssistanceCase"("id", "incidentId");
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_membership_incident_fkey"
  FOREIGN KEY ("membershipId", "incidentId") REFERENCES "StaffMembership"("id", "incidentId");
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_membership_account_fkey"
  FOREIGN KEY ("membershipId", "staffAccountId") REFERENCES "StaffMembership"("id", "accountId");
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_purposes_nonempty" CHECK (cardinality("purposes") > 0);
CREATE UNIQUE INDEX "CaseAssignment_one_active_per_staff_case" ON "CaseAssignment"("caseId", "staffAccountId") WHERE "endsAt" IS NULL;

-- Value checks.
ALTER TABLE "Account" ADD CONSTRAINT "Account_username_format" CHECK ("normalizedUsername" ~ '^[a-z0-9._-]{3,32}$');
ALTER TABLE "Person" ADD CONSTRAINT "Person_alias_length" CHECK (char_length("alias") BETWEEN 1 AND 60 OR "purgedAt" IS NOT NULL);
ALTER TABLE "Session" ADD CONSTRAINT "Session_expiry_after_creation" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "RateLimitBucket_count_positive" CHECK ("count" > 0);
