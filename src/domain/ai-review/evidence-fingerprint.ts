import { createHash } from "node:crypto";

import type { TraderReviewEvidencePackage } from "@/domain/ai-review/types";

/**
 * Deterministic staleness detection (§36) — NEVER asks the AI whether
 * evidence changed. Two packages with identical content (independent of key
 * insertion order, since `stableStringify` sorts object keys recursively)
 * produce the same fingerprint; any change to the underlying evidence
 * (a new trade, a commitment adherence update, a new reflection, etc.)
 * changes it. Pure and synchronous — no network/database access.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

export function computeEvidenceFingerprint(evidence: TraderReviewEvidencePackage): string {
  return createHash("sha256").update(stableStringify(evidence)).digest("hex");
}
