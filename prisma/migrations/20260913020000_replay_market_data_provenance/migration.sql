-- Stage 17B §13: freeze-once market-data provenance per Replay review session.
ALTER TABLE "ReplayReviewSession" ADD COLUMN "marketDataProvenance" JSONB;
