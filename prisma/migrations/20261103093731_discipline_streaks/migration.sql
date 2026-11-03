-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "finalReviewCreditedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DisciplineAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "achievedOn" DATE NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "DisciplineAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisciplineAchievement_userId_key_key" ON "DisciplineAchievement"("userId", "key");

-- AddForeignKey
ALTER TABLE "DisciplineAchievement" ADD CONSTRAINT "DisciplineAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Discipline Streaks ────────────────────────────────────────────────────
-- Backfill: LIVE trades whose final review is already complete get their
-- credit dated by the review that completed it. Only rows that already meet
-- the structured final-review minimum (motive, the four process answers,
-- would-take-again) and are REVIEWED; everything else is dated by its next
-- completion. Read-time credit is still re-derived from the review state.
UPDATE "Trade"
SET "finalReviewCreditedAt" = "reviewedAt"
WHERE "finalReviewCreditedAt" IS NULL
  AND "reviewedAt" IS NOT NULL
  AND "backtestRunId" IS NULL
  AND "deletedAt" IS NULL
  AND "status" = 'REVIEWED'
  AND "tradeIntent" IS NOT NULL
  AND "wouldTakeAgain" IS NOT NULL
  AND jsonb_typeof("adherenceAnswers") = 'object'
  AND "adherenceAnswers" ?& ARRAY['followedStrategy', 'followedEntryModel', 'followedTradeManagement', 'remainedPatient'];

-- Trade.finalReviewCreditedAt is write-once: once set it never changes, so
-- re-completing a review can never move or duplicate its credit.
CREATE OR REPLACE FUNCTION trade_final_review_credit_write_once() RETURNS trigger AS $$
BEGIN
  IF OLD."finalReviewCreditedAt" IS NOT NULL AND NEW."finalReviewCreditedAt" IS DISTINCT FROM OLD."finalReviewCreditedAt" THEN
    RAISE EXCEPTION 'DISCIPLINE_IMMUTABLE: Trade.finalReviewCreditedAt is write-once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Trade_final_review_credit_write_once" BEFORE UPDATE OF "finalReviewCreditedAt" ON "Trade"
  FOR EACH ROW EXECUTE FUNCTION trade_final_review_credit_write_once();

-- An achievement is permanent: no rewrite except a single seenAt write
-- (NULL → set), and DELETE only together with its user (cascade).
CREATE OR REPLACE FUNCTION discipline_achievement_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "User" u WHERE u."id" = OLD."userId") THEN
      RAISE EXCEPTION 'DISCIPLINE_IMMUTABLE: an achievement cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - 'seenAt') IS DISTINCT FROM (to_jsonb(OLD) - 'seenAt') THEN
    RAISE EXCEPTION 'DISCIPLINE_IMMUTABLE: an achievement never changes';
  END IF;
  IF OLD."seenAt" IS NOT NULL AND NEW."seenAt" IS DISTINCT FROM OLD."seenAt" THEN
    RAISE EXCEPTION 'DISCIPLINE_IMMUTABLE: seenAt is written once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DisciplineAchievement_guard" BEFORE UPDATE OR DELETE ON "DisciplineAchievement"
  FOR EACH ROW EXECUTE FUNCTION discipline_achievement_guard();
