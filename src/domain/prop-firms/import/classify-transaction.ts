import { Decimal } from "decimal.js";

export type TransactionClassification =
  | "DEPOSIT"
  | "WITHDRAWAL_PAYOUT"
  | "WITHDRAWAL_UNCLASSIFIED"
  | "INTERNAL_TRANSFER"
  | "ACCOUNT_RESET"
  | "FEE"
  | "COMMISSION"
  | "REFUND"
  | "BALANCE_CORRECTION"
  | "CREDIT"
  | "UNKNOWN";

export interface ClassificationResult {
  classification: TransactionClassification;
  confidence: number;
  requiresReview: boolean;
}

/** Below this confidence, the preview must show the row as uncertain and
 *  require the user to pick a classification rather than silently trust it. */
const REVIEW_THRESHOLD = 0.75;

/** Ordered by specificity — first keyword match wins. A transaction never
 *  reaches WITHDRAWAL_PAYOUT purely by keyword when its amount isn't
 *  negative (a genuine payout removes money); that mismatch is demoted to
 *  uncertain rather than trusted. */
const KEYWORD_RULES: { classification: TransactionClassification; keywords: string[]; confidence: number }[] = [
  { classification: "WITHDRAWAL_PAYOUT", keywords: ["withdraw", "payout", "cash out", "cashout"], confidence: 0.9 },
  { classification: "DEPOSIT", keywords: ["deposit", "funding", "top up", "topup", "initial balance"], confidence: 0.9 },
  { classification: "INTERNAL_TRANSFER", keywords: ["transfer"], confidence: 0.85 },
  { classification: "ACCOUNT_RESET", keywords: ["reset"], confidence: 0.85 },
  { classification: "COMMISSION", keywords: ["commission"], confidence: 0.9 },
  {
    classification: "FEE",
    keywords: ["fee", "charge", "subscription", "challenge cost", "data fee", "platform fee"],
    confidence: 0.85,
  },
  { classification: "REFUND", keywords: ["refund", "reversal", "chargeback"], confidence: 0.85 },
  { classification: "BALANCE_CORRECTION", keywords: ["correction", "adjustment", "reconciliation"], confidence: 0.7 },
  { classification: "CREDIT", keywords: ["credit", "bonus"], confidence: 0.85 },
];

/**
 * Heuristic classifier for a non-trade financial event. Never fabricates
 * certainty: anything not matched by an explicit, sign-consistent keyword —
 * including the "negative Balance operation with no label" case some
 * platforms use for withdrawals — comes back with `requiresReview: true` so
 * the import preview forces the user to confirm it before anything is
 * written.
 */
export function classifyTransaction(input: { rawType: string; amount: string }): ClassificationResult {
  const type = input.rawType.trim().toLowerCase();
  const amount = new Decimal(input.amount);

  for (const rule of KEYWORD_RULES) {
    if (!rule.keywords.some((kw) => type.includes(kw))) continue;

    if (rule.classification === "WITHDRAWAL_PAYOUT" && !amount.isNegative()) {
      return { classification: "WITHDRAWAL_UNCLASSIFIED", confidence: 0.4, requiresReview: true };
    }
    return {
      classification: rule.classification,
      confidence: rule.confidence,
      requiresReview: rule.confidence < REVIEW_THRESHOLD,
    };
  }

  // No label at all beyond a generic "Balance" line — the explicit case the
  // spec calls out: some platforms represent a withdrawal as a plain
  // negative Balance operation.
  if (type === "balance" && amount.isNegative()) {
    return { classification: "WITHDRAWAL_UNCLASSIFIED", confidence: 0.55, requiresReview: true };
  }
  if (type === "balance" && !amount.isNegative()) {
    return { classification: "DEPOSIT", confidence: 0.5, requiresReview: true };
  }

  return { classification: "UNKNOWN", confidence: 0, requiresReview: true };
}
