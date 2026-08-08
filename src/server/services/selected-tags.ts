import type { TagColor } from "@prisma/client";

import type { SelectedTagDTO } from "@/types/trades";

// Shared resolution of a trade's SOT selections into colored tag DTOs. Selections
// are stored on the trade as plain name arrays; each name's color is looked up in
// the trade's frozen `strategyExecutionSnapshot` (the strategy's expected set at
// trade time). Trades created before the strategy-scoped model have no snapshot —
// they fall back to the legacy global-checklist labels, rendered neutral (GRAY).

interface SnapshotTag {
  name: string;
  color: TagColor | string;
  mandatory?: boolean;
}

interface ExecutionSnapshot {
  sessions?: SnapshotTag[];
  confluences?: SnapshotTag[];
  execution?: SnapshotTag[];
}

/** Reads the frozen expected-set snapshot off a trade (null-safe). */
export function executionSnapshot(strategyExecutionSnapshot: unknown): ExecutionSnapshot {
  return (strategyExecutionSnapshot as ExecutionSnapshot | null) ?? {};
}

/**
 * @param selected  the trade's `selectedConfluences` / `selectedExecution` (Json name[] | null)
 * @param pool      the matching snapshot group (`confluences` / `execution`) for color lookup
 * @param legacyLabels  labels from the legacy checklist join, used only when `selected` is null
 */
export function resolveSelectedTags(
  selected: unknown,
  pool: SnapshotTag[] | undefined,
  legacyLabels: string[],
): SelectedTagDTO[] {
  const names = selected as string[] | null;
  if (names == null) {
    return legacyLabels.map((name) => ({ name, color: "GRAY" as TagColor }));
  }
  const byName = new Map((pool ?? []).map((p) => [p.name.toLowerCase(), p.color as TagColor]));
  return names.map((name) => ({ name, color: byName.get(name.toLowerCase()) ?? ("GRAY" as TagColor) }));
}
