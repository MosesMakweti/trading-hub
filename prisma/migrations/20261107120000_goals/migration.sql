-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "GoalCategory" AS ENUM ('ROUTINE', 'EXECUTION', 'RISK', 'JOURNAL', 'MINDSET', 'OTHER');

-- CreateEnum
CREATE TYPE "GoalRequirementType" AS ENUM ('PRE_SESSION_ROUTINE', 'CLOSE_AND_REFLECT', 'REVIEW_CLOSED_TRADES', 'FOLLOW_PLAN', 'RESPECT_RISK', 'JOURNAL_ENTRY', 'CUSTOM_CHECKIN');

-- CreateEnum
CREATE TYPE "GoalDayStatus" AS ENUM ('QUALIFIED', 'MISSED', 'REST', 'PAUSED');

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "GoalCategory" NOT NULL,
    "targetDays" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "completedOn" DATE,
    "completedAt" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalRequirement" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "type" "GoalRequirementType" NOT NULL,
    "label" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "retiredFrom" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalPause" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalDay" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "GoalDayStatus" NOT NULL,
    "attempt" INTEGER NOT NULL,
    "streakAfter" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalCheckIn" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_userId_status_idx" ON "Goal"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Goal_open_userId_key" ON "Goal"("userId") WHERE ("status" IN ('ACTIVE', 'PAUSED'));

-- CreateIndex
CREATE INDEX "GoalRequirement_goalId_idx" ON "GoalRequirement"("goalId");

-- CreateIndex
CREATE INDEX "GoalPause_goalId_idx" ON "GoalPause"("goalId");

-- CreateIndex
CREATE INDEX "GoalDay_userId_date_idx" ON "GoalDay"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GoalDay_goalId_date_key" ON "GoalDay"("goalId", "date");

-- CreateIndex
CREATE INDEX "GoalCheckIn_goalId_date_idx" ON "GoalCheckIn"("goalId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GoalCheckIn_requirementId_date_key" ON "GoalCheckIn"("requirementId", "date");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalRequirement" ADD CONSTRAINT "GoalRequirement_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalPause" ADD CONSTRAINT "GoalPause_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalDay" ADD CONSTRAINT "GoalDay_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalDay" ADD CONSTRAINT "GoalDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalCheckIn" ADD CONSTRAINT "GoalCheckIn_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalCheckIn" ADD CONSTRAINT "GoalCheckIn_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "GoalRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Goals: integrity rules ───────────────────────────────────────────────────
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_targetDays_range" CHECK ("targetDays" BETWEEN 1 AND 365);
ALTER TABLE "GoalPause" ADD CONSTRAINT "GoalPause_range" CHECK ("toDate" IS NULL OR "toDate" >= "fromDate");
ALTER TABLE "GoalDay" ADD CONSTRAINT "GoalDay_counts" CHECK ("attempt" >= 0 AND "streakAfter" >= 0);

-- A finalized goal day is history: never updated, and deleted only together
-- with its goal (cascade — the goal row is already gone when it fires).
CREATE OR REPLACE FUNCTION goal_day_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "Goal" g WHERE g."id" = OLD."goalId") THEN
      RAISE EXCEPTION 'GOAL_IMMUTABLE: a finalized goal day cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'GOAL_IMMUTABLE: a finalized goal day never changes';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GoalDay_guard" BEFORE UPDATE OR DELETE ON "GoalDay"
  FOR EACH ROW EXECUTE FUNCTION goal_day_guard();

-- A completed or abandoned goal is closed for good: it can never reopen.
CREATE OR REPLACE FUNCTION goal_status_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('COMPLETED', 'ABANDONED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'GOAL_IMMUTABLE: a closed goal cannot be reopened';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Goal_status_guard" BEFORE UPDATE OF "status" ON "Goal"
  FOR EACH ROW EXECUTE FUNCTION goal_status_guard();
