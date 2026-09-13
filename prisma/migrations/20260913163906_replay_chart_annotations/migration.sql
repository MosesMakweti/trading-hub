-- CreateEnum
CREATE TYPE "ReplayAnnotationType" AS ENUM ('HORIZONTAL_LINE', 'TREND_LINE', 'RECTANGLE', 'TEXT');

-- CreateTable
CREATE TABLE "ReplayChartAnnotation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "timeframe" TEXT,
    "type" "ReplayAnnotationType" NOT NULL,
    "geometry" JSONB NOT NULL,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReplayChartAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplayChartAnnotation_sessionId_assetSymbol_idx" ON "ReplayChartAnnotation"("sessionId", "assetSymbol");

-- AddForeignKey
ALTER TABLE "ReplayChartAnnotation" ADD CONSTRAINT "ReplayChartAnnotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayChartAnnotation" ADD CONSTRAINT "ReplayChartAnnotation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReplayReviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

