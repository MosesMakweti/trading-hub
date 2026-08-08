-- Universal media system: one user-owned MediaAsset per uploaded file + a
-- polymorphic MediaAttachment linking it to any record. Replaces the trade-only
-- TradeImage table (existing trade screenshots are migrated below, then dropped).

-- 1. Owner-type enum.
CREATE TYPE "MediaOwnerType" AS ENUM (
  'TRADE',
  'DAILY_NOTE',
  'STRATEGY',
  'STRATEGY_ENTRY_MODEL',
  'STRATEGY_CHECKLIST_ITEM',
  'STRATEGY_FRAMEWORK_STEP',
  'ARSENAL_CONCEPT'
);

-- 2. MediaAsset — the file's metadata + storage key (file itself lives in UploadThing).
CREATE TABLE "MediaAsset" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName"   TEXT NOT NULL,
  "mimeType"   TEXT NOT NULL,
  "fileSize"   INTEGER NOT NULL,
  "url"        TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- temporary: maps each new asset back to the TradeImage it came from (dropped below)
  "_legacyTradeImageId" TEXT,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- 3. MediaAttachment — polymorphic link (ownerType + ownerId), optional category.
CREATE TABLE "MediaAttachment" (
  "id"        TEXT NOT NULL,
  "mediaId"   TEXT NOT NULL,
  "ownerType" "MediaOwnerType" NOT NULL,
  "ownerId"   TEXT NOT NULL,
  "category"  TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MediaAsset_userId_createdAt_idx" ON "MediaAsset" ("userId", "createdAt");
CREATE INDEX "MediaAttachment_ownerType_ownerId_sortOrder_idx" ON "MediaAttachment" ("ownerType", "ownerId", "sortOrder");
CREATE INDEX "MediaAttachment_mediaId_idx" ON "MediaAttachment" ("mediaId");

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAttachment"
  ADD CONSTRAINT "MediaAttachment_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Migrate existing trade screenshots. One MediaAsset per TradeImage (owned by
--    the trade's user; legacy rows have no captured mime/size, so use placeholders),
--    then one MediaAttachment (ownerType TRADE, ownerId = tradeId, category = the
--    old ImageCategory). gen_random_uuid() is built into PostgreSQL 13+.
INSERT INTO "MediaAsset" ("id", "userId", "storageKey", "fileName", "mimeType", "fileSize", "url", "createdAt", "_legacyTradeImageId")
SELECT gen_random_uuid()::text, t."userId", ti."uploadthingKey", 'screenshot', 'application/octet-stream', 0, ti."url", ti."createdAt", ti."id"
FROM "TradeImage" ti
JOIN "Trade" t ON t."id" = ti."tradeId";

INSERT INTO "MediaAttachment" ("id", "mediaId", "ownerType", "ownerId", "category", "sortOrder", "createdAt")
SELECT gen_random_uuid()::text, ma."id", 'TRADE'::"MediaOwnerType", ti."tradeId", ti."category"::text, ti."sortOrder", ti."createdAt"
FROM "TradeImage" ti
JOIN "MediaAsset" ma ON ma."_legacyTradeImageId" = ti."id";

ALTER TABLE "MediaAsset" DROP COLUMN "_legacyTradeImageId";

-- 5. Drop the trade-only image system.
DROP TABLE "TradeImage";
DROP TYPE "ImageCategory";
