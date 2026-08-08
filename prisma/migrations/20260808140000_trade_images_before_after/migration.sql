-- Trade attachments collapsed from three buckets (Analysis / Before / After) to
-- two — Before-Trade (in the Trade Idea section) and After-Trade (in the Trade
-- Execution section). Pre-entry "analysis" screenshots are before-trade evidence,
-- so reclassify them to BEFORE. Images are preserved; only the category changes.
UPDATE "MediaAttachment"
SET "category" = 'BEFORE'
WHERE "ownerType" = 'TRADE' AND "category" = 'ANALYSIS';
