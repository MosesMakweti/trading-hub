"use client";

import { useEffect, useState } from "react";

import { AutosaveQueue, type SaveResult, type SaveState } from "@/lib/autosave-queue";

export type { SaveState } from "@/lib/autosave-queue";

// ── Page-wide flush registry ─────────────────────────────────────────────────
// Every mounted autosave registers its queue. Actions that must see the
// latest edits (e.g. publishing a strategy version, which snapshots the DB)
// call flushPendingAutosaves() first, so a debounce that hasn't fired yet can
// never be left out of the snapshot.
const queues = new Set<AutosaveQueue<unknown>>();

/**
 * Immediately saves every pending (debounced or in-flight) autosave on the
 * page and waits for them. Resolves `true` when everything is persisted,
 * `false` if any save failed (the caller should not proceed as if saved).
 */
export async function flushPendingAutosaves(): Promise<boolean> {
  const results = await Promise.all(Array.from(queues, (q) => q.flush()));
  return results.every(Boolean);
}

/**
 * Debounced autosave for a controlled value. The caller owns the value; this
 * hook serializes it, and whenever it diverges from the last saved snapshot
 * it waits `delay` ms of quiet, then persists via `save`. Saves are strictly
 * sequential (see AutosaveQueue), and a pending edit is flushed on unmount.
 */
export function useDebouncedAutosave<T>({
  value,
  serialize,
  save,
  delay = 800,
  onError,
}: {
  value: T;
  serialize: (value: T) => string;
  save: (value: T) => Promise<SaveResult>;
  delay?: number;
  onError?: (message: string) => void;
}): SaveState {
  const snapshot = serialize(value);
  const [queue] = useState(() => new AutosaveQueue<T>(snapshot));
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Keep the queue's view of the latest value + callbacks current.
  useEffect(() => {
    queue.update(value, snapshot, { save, onError, onState: setSaveState });
  }, [queue, value, snapshot, save, onError]);

  useEffect(() => {
    queue.schedule(value, snapshot, delay);
    return () => queue.cancelTimer();
    // Intentionally keyed only on the serialized snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  useEffect(() => {
    const q = queue as AutosaveQueue<unknown>;
    queues.add(q);
    return () => {
      queues.delete(q);
      // Flush a still-pending edit on unmount — e.g. switching the focused
      // record before the debounce fires. The save is scoped to this field's
      // own record via its closure, so it can't leak elsewhere.
      void queue.flush(false);
    };
  }, [queue]);

  return saveState;
}
