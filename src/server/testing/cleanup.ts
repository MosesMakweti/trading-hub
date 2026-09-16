import { prisma } from "@/server/db";

/**
 * Stage 20.3 §14 — the one canonical shape for "create a throwaway test
 * user" / "delete the users this test file created," extracted from the
 * pattern already repeated (with minor variations) across ~36 test files.
 * Not a mandatory migration for existing files — they already work
 * correctly now that `TradeAccountAllocation.tradingAccount` cascades
 * (Stage 20.3 §10-12) — this exists so NEW tests have one obvious,
 * consistent helper to reach for instead of re-deriving the same three
 * lines again.
 *
 * Emails are uniquified with both a timestamp and a random suffix so
 * concurrently-running test FILES (Vitest parallelizes across files by
 * default) can never collide on the same row, without needing any
 * cross-file coordination or serialization.
 */
export async function createTestUser(label: string) {
  return prisma.user.create({
    data: { email: `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
}

/**
 * Deletes exactly the given user ids and everything that cascades from
 * them — never a broader `deleteMany({})`. Safe to call with zero ids.
 */
export async function deleteTestUsers(...ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
