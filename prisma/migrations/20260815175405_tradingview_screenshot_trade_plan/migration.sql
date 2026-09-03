-- CreateEnum
CREATE TYPE "ScreenshotPlanStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PROCESSING', 'RECOGNITION_COMPLETE', 'NEEDS_CONFIRMATION', 'CONFIRMED', 'RECOGNITION_FAILED', 'MANUALLY_CONFIGURED', 'LOCKED');

-- CreateEnum
CREATE TYPE "AssetClass" AS ENUM ('FOREX', 'METALS', 'INDEX', 'FUTURES', 'CRYPTO', 'STOCK', 'OTHER');

-- CreateEnum
CREATE TYPE "DistanceUnit" AS ENUM ('PIP', 'POINT', 'TICK', 'PRICE', 'PERCENT');

-- CreateEnum
CREATE TYPE "RecognitionFieldType" AS ENUM ('SYMBOL', 'ASSET_CLASS', 'TIMEFRAME', 'DIRECTION', 'ENTRY', 'STOP_LOSS', 'TARGET', 'RISK_REWARD', 'STOP_DISTANCE', 'TARGET_DISTANCE', 'CHART_TIMESTAMP');

-- CreateEnum
CREATE TYPE "RecognitionSource" AS ENUM ('AI_VISION', 'OCR', 'MANUAL');

-- CreateEnum
CREATE TYPE "RecognitionConfirmationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CORRECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AnnotationType" AS ENUM ('ENTRY', 'STOP_LOSS', 'TARGET', 'INVALIDATION', 'BREAK_EVEN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AnnotationSource" AS ENUM ('DETECTED', 'MANUAL');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "timeframe" TEXT;

-- CreateTable
CREATE TABLE "TradePlanScreenshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "previewMediaAssetId" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "status" "ScreenshotPlanStatus" NOT NULL DEFAULT 'UPLOADED',
    "recognitionProvider" TEXT,
    "recognitionVersion" TEXT,
    "recognitionError" TEXT,
    "detectedSymbol" TEXT,
    "canonicalInstrumentSymbol" TEXT,
    "detectedTimeframe" TEXT,
    "detectedDirection" "Direction",
    "recognitionMetadata" JSONB,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TradePlanScreenshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenshotRecognitionField" (
    "id" TEXT NOT NULL,
    "screenshotId" TEXT NOT NULL,
    "fieldType" "RecognitionFieldType" NOT NULL,
    "targetOrder" INTEGER,
    "rawExtractedText" TEXT,
    "detectedValue" TEXT,
    "confidence" DOUBLE PRECISION,
    "boundingBox" JSONB,
    "recognitionSource" "RecognitionSource" NOT NULL DEFAULT 'MANUAL',
    "warning" TEXT,
    "confirmationStatus" "RecognitionConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedValue" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenshotRecognitionField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradePlanAnnotation" (
    "id" TEXT NOT NULL,
    "screenshotId" TEXT NOT NULL,
    "type" "AnnotationType" NOT NULL,
    "label" TEXT NOT NULL,
    "confirmedPrice" DECIMAL(18,8),
    "y" DOUBLE PRECISION NOT NULL,
    "startX" DOUBLE PRECISION,
    "endX" DOUBLE PRECISION,
    "endY" DOUBLE PRECISION,
    "color" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "targetOrder" INTEGER,
    "confidence" DOUBLE PRECISION,
    "source" "AnnotationSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradePlanAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedTarget" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "targetOrder" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "targetPrice" DECIMAL(18,8) NOT NULL,
    "unitDistance" DECIMAL(18,8),
    "unitType" "DistanceUnit",
    "rMultiple" DECIMAL(8,4),
    "plannedClosePercent" DECIMAL(5,2),
    "managementInstruction" TEXT,
    "moveToBreakEven" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannedTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradePlanVersion" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "screenshotMediaAssetId" TEXT,
    "assetSymbol" TEXT,
    "direction" "Direction",
    "timeframe" TEXT,
    "entry" DECIMAL(18,8),
    "stopLoss" DECIMAL(18,8),
    "targetsSnapshot" JSONB,
    "stopDistance" DECIMAL(18,8),
    "stopDistanceUnit" "DistanceUnit",
    "weightedPlannedR" DECIMAL(8,4),
    "editReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradePlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradePlanScreenshot_tradeId_key" ON "TradePlanScreenshot"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "TradePlanScreenshot_mediaAssetId_key" ON "TradePlanScreenshot"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "TradePlanScreenshot_previewMediaAssetId_key" ON "TradePlanScreenshot"("previewMediaAssetId");

-- CreateIndex
CREATE INDEX "TradePlanScreenshot_userId_tradeId_idx" ON "TradePlanScreenshot"("userId", "tradeId");

-- CreateIndex
CREATE INDEX "TradePlanScreenshot_status_idx" ON "TradePlanScreenshot"("status");

-- CreateIndex
CREATE INDEX "ScreenshotRecognitionField_screenshotId_fieldType_idx" ON "ScreenshotRecognitionField"("screenshotId", "fieldType");

-- CreateIndex
CREATE INDEX "TradePlanAnnotation_screenshotId_type_idx" ON "TradePlanAnnotation"("screenshotId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedTarget_tradeId_targetOrder_key" ON "PlannedTarget"("tradeId", "targetOrder");

-- CreateIndex
CREATE INDEX "TradePlanVersion_tradeId_idx" ON "TradePlanVersion"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "TradePlanVersion_tradeId_versionNumber_key" ON "TradePlanVersion"("tradeId", "versionNumber");

-- AddForeignKey
ALTER TABLE "TradePlanScreenshot" ADD CONSTRAINT "TradePlanScreenshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradePlanScreenshot" ADD CONSTRAINT "TradePlanScreenshot_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradePlanScreenshot" ADD CONSTRAINT "TradePlanScreenshot_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradePlanScreenshot" ADD CONSTRAINT "TradePlanScreenshot_previewMediaAssetId_fkey" FOREIGN KEY ("previewMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenshotRecognitionField" ADD CONSTRAINT "ScreenshotRecognitionField_screenshotId_fkey" FOREIGN KEY ("screenshotId") REFERENCES "TradePlanScreenshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradePlanAnnotation" ADD CONSTRAINT "TradePlanAnnotation_screenshotId_fkey" FOREIGN KEY ("screenshotId") REFERENCES "TradePlanScreenshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedTarget" ADD CONSTRAINT "PlannedTarget_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradePlanVersion" ADD CONSTRAINT "TradePlanVersion_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

