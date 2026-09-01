-- Phase 2 of the Prop Firm balance-curve rework.
--
-- Historically the CSV importer posted ledger entries ONLY for reconstructed
-- trades (TRADE_PNL) and payout withdrawals (PAYOUT). Imported deposits,
-- standalone fees/commissions, credits, refunds and balance corrections were
-- recorded as PropFirmTransaction rows but never affected the account balance.
-- This backfills a ledger entry for each of those, fixes the opening entry's
-- timestamp, and recomputes every running balance with the opening entry
-- ordered first (so a back-dated import can no longer corrupt the curve).
--
-- Idempotent: only inserts a ledger entry where one does not already exist for
-- that (sourceType = IMPORTED_TRANSACTION, sourceId = transaction id).

-- 1. One signed ledger entry per balance-affecting imported transaction.
--    A leading "initial balance"-type deposit that just restates the account's
--    opening capital is skipped — it is already represented by ACCOUNT_INITIALIZED.
INSERT INTO "AccountLedgerEntry" ("id", "accountId", "eventType", "amount", "balanceAfter", "occurredAt", "sourceType", "sourceId", "createdAt")
SELECT
  'bf_' || t."id",
  t."accountId",
  (CASE t."classification"
    WHEN 'DEPOSIT' THEN 'DEPOSIT'
    WHEN 'CREDIT' THEN 'CREDIT'
    WHEN 'REFUND' THEN 'REFUND'
    WHEN 'COMMISSION' THEN 'COMMISSION_FEE'
    WHEN 'FEE' THEN 'OTHER_FEE'
    ELSE 'BALANCE_CORRECTION'
  END)::"LedgerEventType",
  (CASE t."classification"
    WHEN 'DEPOSIT' THEN abs(t."amount")
    WHEN 'CREDIT' THEN abs(t."amount")
    WHEN 'REFUND' THEN abs(t."amount")
    WHEN 'COMMISSION' THEN -abs(t."amount")
    WHEN 'FEE' THEN -abs(t."amount")
    ELSE t."amount"
  END),
  0,
  t."occurredAt",
  'IMPORTED_TRANSACTION',
  t."id",
  now()
FROM "PropFirmTransaction" t
JOIN "PropFirmAccount" a ON a."id" = t."accountId"
WHERE t."classification" IN ('DEPOSIT', 'CREDIT', 'REFUND', 'COMMISSION', 'FEE', 'ACCOUNT_RESET', 'BALANCE_CORRECTION')
  AND NOT EXISTS (
    SELECT 1 FROM "AccountLedgerEntry" e
    WHERE e."sourceType" = 'IMPORTED_TRANSACTION' AND e."sourceId" = t."id"
  )
  AND NOT (
    t."classification" IN ('DEPOSIT', 'CREDIT')
    AND (
      lower(t."rawType") LIKE '%initial%'
      OR (
        abs(abs(t."amount") - a."startingBalance") <= GREATEST(1, a."startingBalance" * 0.005)
        AND t."occurredAt" <= (
          SELECT MIN(x."occurredAt") FROM "PropFirmTransaction" x WHERE x."accountId" = t."accountId"
        )
      )
    )
  );

-- 2. Date the opening entry at the account's purchase date when that is
--    earlier than the row's current timestamp (created-at time).
UPDATE "AccountLedgerEntry" e
SET "occurredAt" = a."purchaseDate"::timestamp(3)
FROM "PropFirmAccount" a
WHERE e."accountId" = a."id"
  AND e."sourceType" = 'ACCOUNT_INIT'
  AND a."purchaseDate" IS NOT NULL
  AND a."purchaseDate"::timestamp(3) < e."occurredAt";

-- 3. Recompute every entry's running balance, opening entry first regardless
--    of its timestamp, then chronological with deterministic tie-breaks.
WITH ordered AS (
  SELECT
    "id",
    SUM("amount") OVER (
      PARTITION BY "accountId"
      ORDER BY
        (CASE WHEN "sourceType" = 'ACCOUNT_INIT' OR "eventType" = 'ACCOUNT_INITIALIZED' THEN 0 ELSE 1 END),
        "occurredAt",
        "createdAt",
        "id"
    ) AS running
  FROM "AccountLedgerEntry"
)
UPDATE "AccountLedgerEntry" e
SET "balanceAfter" = o.running
FROM ordered o
WHERE e."id" = o."id"
  AND e."balanceAfter" <> o.running;
