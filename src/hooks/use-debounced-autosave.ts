"use client";

import { useEffect, useRef, useState, useTransition } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

type SaveResult = { success: true } | { success: false; error: string };

/**
 * Debounced autosave for a controlled value.
 *
 * Reusable across Strategy Lab editors (Settings now; Arsenal / Framework /
 * Timeframes / Entry Models / Trade Management in later phases). The caller owns
 * the value; this hook serializes it, and whenever it diverges from the last
 * saved snapshot it waits `delay` ms of quiet, then persists via `save`.
 *
 * All state updates happen inside async callbacks (timeout / transition), never
 * synchronously in the effect body — keeps it clear of cascading-render lint.
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
  const lastSaved = useRef(snapshot);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [, startTransition] = useTransition();

  useEffect(() => {
    // The effect re-runs whenever `snapshot` changes, so its closure always
    // holds the `value` that produced the current snapshot — no ref needed.
    if (snapshot === lastSaved.current) return;

    const timeout = setTimeout(() => {
      setSaveState("saving");
      startTransition(async () => {
        const result = await save(value);
        if (result.success) {
          lastSaved.current = snapshot;
          setSaveState("saved");
        } else {
          setSaveState("error");
          onError?.(result.error);
        }
      });
    }, delay);

    return () => clearTimeout(timeout);
    // Intentionally keyed only on the serialized snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  return saveState;
}
