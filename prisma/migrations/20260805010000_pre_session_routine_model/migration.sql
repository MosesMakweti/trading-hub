-- CreateEnum
CREATE TYPE "RoutineItemType" AS ENUM ('CHECKBOX', 'SHORT_TEXT', 'LONG_TEXT');

-- AlterTable
ALTER TABLE "TradingDay" ADD COLUMN     "routineReadyAt" TIMESTAMP(3),
ADD COLUMN     "routineSnapshot" JSONB;

-- CreateTable
CREATE TABLE "RoutineSection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "collapsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RoutineSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "type" "RoutineItemType" NOT NULL DEFAULT 'CHECKBOX',
    "label" TEXT NOT NULL,
    "config" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RoutineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutineSection_userId_sortOrder_idx" ON "RoutineSection"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "RoutineItem_userId_sectionId_sortOrder_idx" ON "RoutineItem"("userId", "sectionId", "sortOrder");

-- AddForeignKey
ALTER TABLE "RoutineSection" ADD CONSTRAINT "RoutineSection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineItem" ADD CONSTRAINT "RoutineItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineItem" ADD CONSTRAINT "RoutineItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "RoutineSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

