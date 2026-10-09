"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Brain } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  completeResetAction,
  getPsychologyResetStateAction,
  saveResetAnswerAction,
  setResetDeferredAction,
  setResetStepAction,
} from "@/actions/psychology-reset.actions";
import { RESET_TITLE_ID, ResetFlowView } from "@/components/psychology-reset/reset-flow-view";
import type { PsychologyResetSessionDTO, PsychologyResetStateDTO } from "@/types/psychology-reset";

/**
 * App-shell host for the Trading Psychology Reset. The server decides
 * whether a session exists (created only after a settled losing trade or a
 * recorded miss, only while the trader's preference is ON); this component
 * only presents it:
 *  • an unfinished session opens automatically, unless the trader chose
 *    "Finish later" — then a small Resume control stays available;
 *  • closing the dialog (Escape / outside click) counts as "Finish later";
 *  • every answer is persisted before moving on, so a refresh resumes;
 *  • preference OFF → the server returns no session and nothing renders. A
 *    session already open when the feature is switched off is left open
 *    until the trader closes it; its answers are kept either way.
 */
export function PsychologyResetHost({ initial }: { initial: PsychologyResetStateDTO }) {
  const [session, setSession] = useState<PsychologyResetSessionDTO | null>(initial.session);
  const [open, setOpen] = useState(Boolean(initial.session && !initial.session.deferred));
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Adopt server state (layout re-render after a save, or a navigation),
  // never replacing the session the trader is currently working through.
  function adopt(next: PsychologyResetStateDTO) {
    if (openRef.current) return;
    setSession(next.session);
    if (next.session && !next.session.deferred) setOpen(true);
  }
  const initialKey = `${initial.enabled}:${initial.session?.id ?? ""}:${initial.session?.deferred ?? ""}`;
  const lastKey = useRef(initialKey);
  useEffect(() => {
    if (lastKey.current === initialKey) return;
    lastKey.current = initialKey;
    adopt(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the server state, not object identity
  }, [initialKey]);

  // A save on a page that didn't re-render the shell is picked up on the next navigation.
  const pathname = usePathname();
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    let cancelled = false;
    getPsychologyResetStateAction()
      .then((s) => {
        if (!cancelled) adopt(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  function call(fn: () => Promise<{ success: true; data: PsychologyResetSessionDTO } | { success: false; error: string }>, after?: (s: PsychologyResetSessionDTO) => void) {
    setError(null);
    startBusy(async () => {
      try {
        const r = await fn();
        if (!r.success) {
          setError(r.error);
          return;
        }
        setSession(r.data);
        after?.(r.data);
      } catch {
        setError("Couldn't save — check your connection and try again. Your previous answers are kept.");
      }
    });
  }

  if (!session) return null;

  const finishLater = () =>
    call(
      () => setResetDeferredAction({ sessionId: session.id, deferred: true }),
      () => setOpen(false),
    );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) return setOpen(true);
          if (session.status === "COMPLETED") {
            setOpen(false);
            setSession(null);
          } else {
            finishLater();
          }
        }}
      >
        <DialogContent showCloseButton={false} aria-labelledby={RESET_TITLE_ID} className="p-5 sm:max-w-xl">
          <ResetFlowView
            session={session}
            busy={busy}
            error={error}
            handlers={{
              onAnswer: (stepId, optionId, note) => call(() => saveResetAnswerAction({ sessionId: session.id, stepId, optionId, note })),
              onBack: () => call(() => setResetStepAction({ sessionId: session.id, step: Math.max(session.currentStep - 1, 0) })),
              onFinishLater: finishLater,
              onComplete: () => call(() => completeResetAction({ sessionId: session.id })),
              onClose: () => {
                setOpen(false);
                setSession(null);
              },
            }}
          />
        </DialogContent>
      </Dialog>

      {!open && session.status === "IN_PROGRESS" && (
        <button
          type="button"
          onClick={() => call(() => setResetDeferredAction({ sessionId: session.id, deferred: false }), () => setOpen(true))}
          className="fixed right-4 bottom-4 z-40 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium shadow-md transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          data-testid="psychology-reset-resume"
        >
          <Brain className="size-3.5 text-muted-foreground" aria-hidden />
          Mental reset in progress · Resume
        </button>
      )}
    </>
  );
}
