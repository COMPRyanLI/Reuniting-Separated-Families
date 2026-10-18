-- AlterTable
ALTER TABLE "Response" ADD COLUMN     "purgedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "DeletionTombstone" (
    "id" UUID NOT NULL,
    "personRef" UUID NOT NULL,
    "accountRef" UUID,
    "deletedAt" TIMESTAMPTZ(3) NOT NULL,
    "purgeAfter" TIMESTAMPTZ(3) NOT NULL,
    "purgedAt" TIMESTAMPTZ(3),
    "reason" TEXT NOT NULL,

    CONSTRAINT "DeletionTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemFlag" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SystemFlag_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "DeletionTombstone_purgedAt_purgeAfter_idx" ON "DeletionTombstone"("purgedAt", "purgeAfter");


-- ---------------------------------------------------------------------------
-- Hand-written constraints.
-- ---------------------------------------------------------------------------

-- A purged response keeps only its existence (so counterparts see a neutral
-- "unavailable" state); its message, alias and check-in reference are removed.
ALTER TABLE "Response" DROP CONSTRAINT "Response_scope_checkin";
ALTER TABLE "Response" ADD CONSTRAINT "Response_scope_checkin"
  CHECK ("purgedAt" IS NOT NULL OR (("scope" = 'SAFETY_MESSAGE') = ("checkInId" IS NULL)));
ALTER TABLE "Response" ADD CONSTRAINT "Response_purged_is_empty"
  CHECK ("purgedAt" IS NULL OR ("encryptedMessage" IS NULL AND "checkInId" IS NULL));
ALTER TABLE "DeletionTombstone" ADD CONSTRAINT "DeletionTombstone_purge_window" CHECK ("purgeAfter" <= "deletedAt" + interval '24 hours');
