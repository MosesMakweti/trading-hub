import { prisma, type TransactionClient } from "@/server/db";
import { resolveExecutionSpec, type ExecutionSpecLayer, type SpecResolution } from "@/domain/execution";

/**
 * Quantity ledger (Phase 2) — the trader's own instrument economics
 * (UserInstrumentSpec, the USER_OVERRIDE layer of resolveExecutionSpec).
 * Service-only in Phase 2 (no settings UI). Editing a spec never changes a
 * trade already sized with it — the resolved values are frozen into that
 * trade's PerformanceRiskSnapshot.specSnapshot.
 */

type Db = TransactionClient | typeof prisma;

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

const str = (v: { toString(): string } | null) => (v == null ? null : v.toString());

export async function getUserInstrumentSpecLayer(userId: string, symbol: string, db: Db = prisma): Promise<ExecutionSpecLayer | null> {
  const row = await db.userInstrumentSpec.findUnique({ where: { userId_symbol: { userId, symbol: normalizeSymbol(symbol) } } });
  if (!row) return null;
  return {
    pricingModel: row.pricingModel,
    quoteCurrency: row.quoteCurrency,
    contractSize: str(row.contractSize),
    tickSize: str(row.tickSize),
    tickValue: str(row.tickValue),
    quantityUnit: row.quantityUnit,
    quantityStep: str(row.quantityStep),
    minQuantity: str(row.minQuantity),
    maxQuantity: str(row.maxQuantity),
    pipSize: str(row.pipSize),
    pointSize: str(row.pointSize),
  };
}

/** account override (none for the virtual Performance Account) → user override → catalog → INSUFFICIENT. */
export async function resolveSpecForUser(userId: string, symbol: string, db: Db = prisma): Promise<SpecResolution> {
  const userOverride = await getUserInstrumentSpecLayer(userId, symbol, db);
  return resolveExecutionSpec({ symbol, accountOverride: null, userOverride });
}

export async function upsertUserInstrumentSpec(userId: string, symbol: string, layer: ExecutionSpecLayer) {
  const s = normalizeSymbol(symbol);
  if (!s) throw new Error("Symbol is required.");
  const data = {
    pricingModel: layer.pricingModel ?? null,
    quoteCurrency: layer.quoteCurrency ? layer.quoteCurrency.trim().toUpperCase() : null,
    contractSize: str(layer.contractSize ?? null),
    tickSize: str(layer.tickSize ?? null),
    tickValue: str(layer.tickValue ?? null),
    quantityUnit: layer.quantityUnit ?? null,
    quantityStep: str(layer.quantityStep ?? null),
    minQuantity: str(layer.minQuantity ?? null),
    maxQuantity: str(layer.maxQuantity ?? null),
    pipSize: str(layer.pipSize ?? null),
    pointSize: str(layer.pointSize ?? null),
  };
  // Reject a spec that would resolve as invalid (inconsistent step/min/max,
  // non-positive values) rather than store something no trade can size with.
  const check = resolveExecutionSpec({ symbol: s, userOverride: layer });
  if (check.status === "INSUFFICIENT" && check.invalid.length > 0) throw new Error(check.invalid.join(" "));
  return prisma.userInstrumentSpec.upsert({
    where: { userId_symbol: { userId, symbol: s } },
    create: { userId, symbol: s, ...data },
    update: data,
  });
}

export async function deleteUserInstrumentSpec(userId: string, symbol: string): Promise<void> {
  await prisma.userInstrumentSpec.deleteMany({ where: { userId, symbol: normalizeSymbol(symbol) } });
}
