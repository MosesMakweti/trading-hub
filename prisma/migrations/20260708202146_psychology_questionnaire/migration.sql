-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('A', 'B', 'C', 'D', 'F');

-- CreateTable
CREATE TABLE "PsychologyQuestionnaireResponse" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "rawScore" INTEGER NOT NULL,
    "psychologyPercent" DOUBLE PRECISION NOT NULL,
    "grade" "Grade" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PsychologyQuestionnaireResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PsychologyQuestionnaireResponse_tradeId_key" ON "PsychologyQuestionnaireResponse"("tradeId");

-- AddForeignKey
ALTER TABLE "PsychologyQuestionnaireResponse" ADD CONSTRAINT "PsychologyQuestionnaireResponse_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
