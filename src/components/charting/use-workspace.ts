"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { saveWorkspaceAction } from "@/actions/charting.actions";
import { normalizeWorkspace, type Workspace } from "@/domain/charting/workspace";

const SAVE_DELAY_MS = 800;

/**
 * Workspace state with debounced server persistence. The server validates
 * and normalises every save; local state stays the source of truth while the
 * page is open (a failed save is reported once and retried on the next change).
 */
export function useWorkspace(initial: Workspace) {
  const [ws, setWs] = useState(() => normalizeWorkspace(initial));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Workspace | null>(null);
  const warned = useRef(false);

  const flush = useCallback(async () => {
    const data = pending.current;
    pending.current = null;
    if (!data) return;
    const res = await saveWorkspaceAction(data);
    if (!res.success && !warned.current) {
      warned.current = true;
      toast.error(`Chart layout not saved: ${res.error}`);
    } else if (res.success) warned.current = false;
  }, []);

  const update = useCallback(
    (fn: (w: Workspace) => Workspace) => {
      setWs((prev) => {
        const next = fn(prev);
        if (next === prev) return prev;
        pending.current = next;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
        return next;
      });
    },
    [flush],
  );

  // Save what's pending when leaving the page.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    },
    [flush],
  );

  return [ws, update] as const;
}
