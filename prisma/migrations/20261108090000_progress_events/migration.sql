-- CreateEnum
CREATE TYPE "ProgressEventKind" AS ENUM ('ACHIEVEMENT', 'MILESTONE', 'GOAL_COMPLETED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "celebrationAnimations" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "celebrationSound" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProgressEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ProgressEventKind" NOT NULL,
    "achievementKey" TEXT,
    "goalId" TEXT,
    "days" INTEGER,
    "occurredOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "ProgressEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgressEvent_userId_seenAt_idx" ON "ProgressEvent"("userId", "seenAt");

-- CreateIndex
CREATE INDEX "ProgressEvent_userId_occurredOn_idx" ON "ProgressEvent"("userId", "occurredOn");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressEvent_achievement_key" ON "ProgressEvent"("userId", "achievementKey") WHERE ("kind" = 'ACHIEVEMENT');

-- CreateIndex
CREATE UNIQUE INDEX "ProgressEvent_milestone_key" ON "ProgressEvent"("goalId", "days") WHERE ("kind" = 'MILESTONE');

-- CreateIndex
CREATE UNIQUE INDEX "ProgressEvent_goal_completed_key" ON "ProgressEvent"("goalId") WHERE ("kind" = 'GOAL_COMPLETED');

-- AddForeignKey
ALTER TABLE "ProgressEvent" ADD CONSTRAINT "ProgressEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEvent" ADD CONSTRAINT "ProgressEvent_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Progress events: integrity rules ─────────────────────────────────────────
ALTER TABLE "ProgressEvent" ADD CONSTRAINT "ProgressEvent_shape" CHECK (
  ("kind" = 'ACHIEVEMENT' AND "achievementKey" IS NOT NULL AND "goalId" IS NULL AND "days" IS NULL)
  OR ("kind" = 'MILESTONE' AND "achievementKey" IS NULL AND "goalId" IS NOT NULL AND "days" > 0)
  OR ("kind" = 'GOAL_COMPLETED' AND "achievementKey" IS NULL AND "goalId" IS NOT NULL AND "days" IS NULL)
);

-- An event never changes, except a single seenAt write (NULL → set). It is
-- deleted only together with its user or goal (cascade: the parent row is
-- already gone when this fires).
CREATE OR REPLACE FUNCTION progress_event_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "User" u WHERE u."id" = OLD."userId")
       AND (OLD."goalId" IS NULL OR EXISTS (SELECT 1 FROM "Goal" g WHERE g."id" = OLD."goalId")) THEN
      RAISE EXCEPTION 'PROGRESS_IMMUTABLE: a progress event cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - 'seenAt') IS DISTINCT FROM (to_jsonb(OLD) - 'seenAt') THEN
    RAISE EXCEPTION 'PROGRESS_IMMUTABLE: a progress event never changes';
  END IF;
  IF OLD."seenAt" IS NOT NULL AND NEW."seenAt" IS DISTINCT FROM OLD."seenAt" THEN
    RAISE EXCEPTION 'PROGRESS_IMMUTABLE: seenAt is written once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProgressEvent_guard" BEFORE UPDATE OR DELETE ON "ProgressEvent"
  FOR EACH ROW EXECUTE FUNCTION progress_event_guard();

-- Backfill: every achievement already unlocked gets its event, carrying its
-- seen state, so an unseen one is still celebrated (once) and a seen one
-- never is.
INSERT INTO "ProgressEvent" ("id", "userId", "kind", "achievementKey", "occurredOn", "createdAt", "seenAt")
SELECT 'pe_' || a."id", a."userId", 'ACHIEVEMENT', a."key", a."achievedOn", a."unlockedAt", a."seenAt"
FROM "DisciplineAchievement" a
ON CONFLICT DO NOTHING;
