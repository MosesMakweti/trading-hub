-- Custom trading sessions per user. Additive only.
-- CreateTable
CREATE TABLE "UserTradingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "days" INTEGER[],
    "color" TEXT NOT NULL DEFAULT '#8ab4f8',
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTradingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTradingSession_userId_idx" ON "UserTradingSession"("userId");


-- AddForeignKey
ALTER TABLE "UserTradingSession" ADD CONSTRAINT "UserTradingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
