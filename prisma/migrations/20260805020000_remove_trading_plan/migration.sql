-- DropForeignKey
ALTER TABLE "PsychologicalAnchor" DROP CONSTRAINT "PsychologicalAnchor_userId_fkey";

-- DropForeignKey
ALTER TABLE "TradingPlan" DROP CONSTRAINT "TradingPlan_userId_fkey";

-- DropTable
DROP TABLE "PsychologicalAnchor";

-- DropTable
DROP TABLE "TradingPlan";

