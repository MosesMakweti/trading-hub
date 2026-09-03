-- AlterEnum
-- Account Trade Participation status vocabulary (spec §3): OPEN becomes
-- EXECUTED (a position in the market), and ALLOCATED / PARTIALLY_CLOSED /
-- MISSED / NOT_TAKEN are added so a participation can be tracked through its
-- full lifecycle without conflating "didn't take it" with "cancelled".
ALTER TYPE "ExecutionStatus" RENAME VALUE 'OPEN' TO 'EXECUTED';
ALTER TYPE "ExecutionStatus" ADD VALUE 'ALLOCATED' BEFORE 'EXECUTED';
ALTER TYPE "ExecutionStatus" ADD VALUE 'PARTIALLY_CLOSED' AFTER 'EXECUTED';
ALTER TYPE "ExecutionStatus" ADD VALUE 'MISSED';
ALTER TYPE "ExecutionStatus" ADD VALUE 'NOT_TAKEN';

-- AlterTable
-- riskBaseSnapshot freezes the resolved risk base (balance/equity/stage-
-- starting balance) at the moment an allocation is first confirmed, so later
-- edits (e.g. execution notes) never silently recompute the risk amount off
-- a since-changed account balance. Table has no existing rows in any
-- environment this migration has shipped to, so NOT NULL needs no backfill.
ALTER TABLE "TradeAccountExecution" ADD COLUMN "riskBaseSnapshot" DECIMAL(14,2) NOT NULL;
