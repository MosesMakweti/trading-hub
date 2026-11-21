-- CreateEnum
CREATE TYPE "MindsetEnvironment" AS ENUM ('NATURE', 'FOCUS');

-- CreateEnum
CREATE TYPE "MindsetOrder" AS ENUM ('SEQUENTIAL', 'RANDOM');

-- CreateEnum
CREATE TYPE "MindsetSessionStatus" AS ENUM ('STARTED', 'COMPLETED', 'INTERRUPTED');

-- CreateTable
CREATE TABLE "MindsetMantra" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MindsetMantra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MindsetPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "environment" "MindsetEnvironment" NOT NULL DEFAULT 'NATURE',
    "durationSeconds" INTEGER NOT NULL DEFAULT 300,
    "secondsPerMantra" INTEGER NOT NULL DEFAULT 10,
    "order" "MindsetOrder" NOT NULL DEFAULT 'SEQUENTIAL',
    "repeat" BOOLEAN NOT NULL DEFAULT true,
    "selectedCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedMantraIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audioEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sound" TEXT NOT NULL DEFAULT 'rain',
    "volume" INTEGER NOT NULL DEFAULT 60,
    "breathingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "breathingPattern" TEXT NOT NULL DEFAULT 'calm',
    "defaultsSeededAt" TIMESTAMP(3),
    "dismissedRecommendationKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MindsetPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MindsetSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "plannedSeconds" INTEGER NOT NULL,
    "activeSeconds" INTEGER,
    "status" "MindsetSessionStatus" NOT NULL DEFAULT 'STARTED',
    "environment" "MindsetEnvironment" NOT NULL,
    "sound" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mantraCount" INTEGER NOT NULL,
    "recommendationKey" TEXT,

    CONSTRAINT "MindsetSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MindsetMantra_userId_deletedAt_sortOrder_idx" ON "MindsetMantra"("userId", "deletedAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "MindsetMantra_userId_defaultKey_key" ON "MindsetMantra"("userId", "defaultKey");

-- CreateIndex
CREATE UNIQUE INDEX "MindsetPreference_userId_key" ON "MindsetPreference"("userId");

-- CreateIndex
CREATE INDEX "MindsetSession_userId_startedAt_idx" ON "MindsetSession"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "MindsetMantra" ADD CONSTRAINT "MindsetMantra_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindsetPreference" ADD CONSTRAINT "MindsetPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MindsetSession" ADD CONSTRAINT "MindsetSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

