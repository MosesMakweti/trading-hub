import type { RoutineItemTypeValue } from "@/domain/today/default-routine";

// The immutable per-day routine snapshot stored on TradingDay.routineSnapshot.
// `sections` is frozen when the day starts (a copy of the template); only
// `responses` change as the trader completes items — so a historical day always
// shows the exact routine that was run that day.

export interface RoutineSnapshotItem {
  id: string;
  label: string;
  type: RoutineItemTypeValue;
  // Mandatory items gate the day. Optional on the type so snapshots frozen before
  // this field existed (older archived days) read as non-mandatory, never blocking.
  isMandatory?: boolean;
}

export interface RoutineSnapshotSection {
  id: string;
  title: string;
  items: RoutineSnapshotItem[];
}

export interface RoutineResponse {
  checked?: boolean;
  text?: string;
  /** Preparation Score: SERVER instant (ISO) the item first became complete.
   *  Written once by the server, never by the client, never rewritten. */
  firstCompletedAt?: string;
}

export interface RoutineSnapshot {
  sections: RoutineSnapshotSection[];
  responses: Record<string, RoutineResponse>;
}

/**
 * Whether an item counts as "done": a checkbox must be ticked; a text item must
 * have non-blank content. Unanswered items are incomplete.
 */
export function isItemComplete(item: RoutineSnapshotItem, response: RoutineResponse | undefined): boolean {
  if (!response) return false;
  if (item.type === "CHECKBOX") return response.checked === true;
  return typeof response.text === "string" && response.text.trim().length > 0;
}

export interface RoutineProgress {
  completed: number;
  total: number;
  percent: number; // 0–100, integer
}

/** Completion across every item in the snapshot. */
export function routineProgress(snapshot: RoutineSnapshot): RoutineProgress {
  return progressOf(snapshot, () => true);
}

/** Completion across only the MANDATORY items — the gate's denominator. */
export function mandatoryProgress(snapshot: RoutineSnapshot): RoutineProgress {
  return progressOf(snapshot, (item) => item.isMandatory === true);
}

/** Completion across only the OPTIONAL items (never blocks progression). */
export function optionalProgress(snapshot: RoutineSnapshot): RoutineProgress {
  return progressOf(snapshot, (item) => item.isMandatory !== true);
}

function progressOf(
  snapshot: RoutineSnapshot,
  include: (item: RoutineSnapshotItem) => boolean,
): RoutineProgress {
  let total = 0;
  let completed = 0;
  for (const section of snapshot.sections) {
    for (const item of section.items) {
      if (!include(item)) continue;
      total += 1;
      if (isItemComplete(item, snapshot.responses[item.id])) completed += 1;
    }
  }
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { completed, total, percent };
}

/**
 * The gate: whether EVERY mandatory item is complete. True when there are no
 * mandatory items (optional-only routines never block). This is the single
 * predicate the workflow checks before unlocking Today's Plan — enforced on the
 * server so it can't be bypassed by the client.
 */
export function allMandatoryComplete(snapshot: RoutineSnapshot): boolean {
  const { completed, total } = mandatoryProgress(snapshot);
  return completed === total;
}
