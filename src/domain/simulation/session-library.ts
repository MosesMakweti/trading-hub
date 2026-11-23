/** Backtesting session library — shared types and the pure filter/sort (client and server). */

export type SessionKind = "LAB" | "PROP" | "LEGACY";

export interface SessionCounts {
  trades: number;
  orders: number;
  drawings: number;
  observations: number;
}

export interface LibrarySession {
  kind: SessionKind;
  id: string;
  name: string;
  /** The session's own status (archive is separate). */
  status: string;
  archived: boolean;
  assets: string[];
  periodStart: string;
  periodEnd: string;
  /** Replay position, broker time ("YYYY-MM-DDTHH:mm"), when started. */
  clock: string | null;
  createdAt: string;
  updatedAt: string;
  counts: SessionCounts;
  href: string;
  /** What the trader may do with it. */
  can: { rename: boolean; duplicate: boolean; archive: boolean; delete: boolean };
  /** Shown when delete is refused. */
  deleteNote: string | null;
}

export interface LibraryQuery {
  q?: string;
  kind?: SessionKind | "ALL";
  /** "active" (not archived), "archived", or "all". */
  scope?: "active" | "archived" | "all";
  sort?: "updated" | "created" | "name" | "trades";
}

/** Pure filter + sort. */
export function applyLibraryQuery(list: LibrarySession[], query: LibraryQuery): LibrarySession[] {
  const q = query.q?.trim().toLowerCase() ?? "";
  const scope = query.scope ?? "active";
  const out = list.filter(
    (s) =>
      (query.kind == null || query.kind === "ALL" || s.kind === query.kind) &&
      (scope === "all" || (scope === "archived") === s.archived) &&
      (!q || s.name.toLowerCase().includes(q) || s.assets.some((a) => a.toLowerCase().includes(q)) || s.status.toLowerCase() === q),
  );
  const sort = query.sort ?? "updated";
  const by: Record<NonNullable<LibraryQuery["sort"]>, (a: LibrarySession, b: LibrarySession) => number> = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    trades: (a, b) => b.counts.trades - a.counts.trades || b.updatedAt.localeCompare(a.updatedAt),
  };
  return out.sort(by[sort]);
}

