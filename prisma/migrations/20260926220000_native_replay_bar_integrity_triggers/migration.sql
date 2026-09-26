-- DropForeignKey
ALTER TABLE "HistoricalBar" DROP CONSTRAINT "HistoricalBar_datasetSeq_fkey";

-- Native Replay — bar integrity without a row-level FK.
--
-- Measured on 500k bars: 24.8s with the FK (one referential check per row)
-- vs 1.8s without. The guarantees the FK gave are kept below with
-- STATEMENT-level triggers (one check per INSERT statement, i.e. per
-- 20k-row batch), and tightened: canonical bars are immutable, and a READY
-- dataset can't gain bars.

-- Bars may only be inserted for an existing dataset that is IMPORTING. The
-- referenced dataset rows are KEY SHARE-locked exactly as an FK check would,
-- so a concurrent dataset delete either waits for this insert (and its
-- cleanup trigger then removes the committed bars) or has already won (and
-- this check fails).
CREATE FUNCTION "native_replay_bar_insert_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  offending integer;
BEGIN
  PERFORM 1 FROM "HistoricalDataset" d
    WHERE d."seq" IN (SELECT DISTINCT "datasetSeq" FROM new_rows)
    FOR KEY SHARE;
  SELECT n."datasetSeq" INTO offending
    FROM (SELECT DISTINCT "datasetSeq" FROM new_rows) n
    LEFT JOIN "HistoricalDataset" d ON d."seq" = n."datasetSeq"
    WHERE d."seq" IS NULL OR d."status" <> 'IMPORTING'
    LIMIT 1;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: bars can only be added to an existing dataset that is importing (dataset seq %)', offending;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "HistoricalBar_insert_guard"
  AFTER INSERT ON "HistoricalBar"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION "native_replay_bar_insert_guard"();

-- Canonical bars never change once written.
CREATE FUNCTION "native_replay_bar_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: historical bars are immutable';
END;
$$;

CREATE TRIGGER "HistoricalBar_immutable"
  BEFORE UPDATE ON "HistoricalBar"
  FOR EACH STATEMENT EXECUTE FUNCTION "native_replay_bar_immutable"();

-- Deleting a dataset (directly, or through its user's cascade) deletes its bars.
CREATE FUNCTION "native_replay_dataset_delete_bars"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "HistoricalBar" WHERE "datasetSeq" = OLD."seq";
  RETURN OLD;
END;
$$;

CREATE TRIGGER "HistoricalDataset_delete_bars"
  BEFORE DELETE ON "HistoricalDataset"
  FOR EACH ROW EXECUTE FUNCTION "native_replay_dataset_delete_bars"();

-- The bar key of a dataset never changes.
CREATE FUNCTION "native_replay_dataset_seq_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."seq" <> OLD."seq" THEN
    RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: a dataset''s bar key is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "HistoricalDataset_seq_immutable"
  BEFORE UPDATE OF "seq" ON "HistoricalDataset"
  FOR EACH ROW EXECUTE FUNCTION "native_replay_dataset_seq_immutable"();
