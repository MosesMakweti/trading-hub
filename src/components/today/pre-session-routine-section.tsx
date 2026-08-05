"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, Lock, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  isItemComplete,
  routineProgress,
  type RoutineResponse,
  type RoutineSnapshot,
} from "@/domain/today/routine-snapshot";
import { saveRoutineResponse, setRoutineReady } from "@/actions/today-routine.actions";

export interface DayRoutineDTO {
  snapshot: RoutineSnapshot;
  readyAt: string | null;
}

export function PreSessionRoutineSection({
  dateKey,
  routine,
}: {
  dateKey: string;
  routine: DayRoutineDTO;
}) {
  const router = useRouter();
  const [responses, setResponses] = useState<Record<string, RoutineResponse>>(
    routine.snapshot.responses ?? {},
  );
  const [readyAt, setReadyAt] = useState<string | null>(routine.readyAt);
  const [isPending, startTransition] = useTransition();

  const snapshot: RoutineSnapshot = { sections: routine.snapshot.sections, responses };
  const progress = routineProgress(snapshot);
  const isReady = readyAt != null;

  function persist(itemId: string, patch: RoutineResponse) {
    startTransition(async () => {
      const result = await saveRoutineResponse(dateKey, itemId, patch);
      if (!result.success) toast.error(result.error);
    });
  }

  function toggleCheck(itemId: string, checked: boolean) {
    setResponses((prev) => ({ ...prev, [itemId]: { ...prev[itemId], checked } }));
    persist(itemId, { checked });
  }

  function onText(itemId: string, text: string) {
    setResponses((prev) => ({ ...prev, [itemId]: { ...prev[itemId], text } }));
  }

  function toggleReady() {
    const next = !isReady;
    startTransition(async () => {
      const result = await setRoutineReady(dateKey, next);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setReadyAt(next ? new Date().toISOString() : null);
      // Re-read the day so the workspace unlocks / re-locks the other tabs.
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="glass space-y-2 rounded-2xl p-4">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">Preparation progress</span>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground tabular-nums">
              {progress.completed} / {progress.total} · {progress.percent}%
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              nativeButton={false}
              render={<Link href="/settings/routine" />}
            >
              <SlidersHorizontal className="size-3.5" />
              Edit routine
            </Button>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="bg-brand-gradient h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>

      {/* Sections */}
      {snapshot.sections.map((section) => (
        <div key={section.id} className="glass space-y-3 rounded-2xl p-4">
          <h3 className="text-sm font-medium text-muted-foreground">{section.title}</h3>
          <ul className="space-y-2.5">
            {section.items.map((item) => {
              const response = responses[item.id];
              const done = isItemComplete(item, response);

              if (item.type === "CHECKBOX") {
                return (
                  <li key={item.id} className="flex items-center gap-2.5">
                    <Checkbox
                      id={`r-${item.id}`}
                      checked={response?.checked === true}
                      onCheckedChange={(c) => toggleCheck(item.id, c === true)}
                    />
                    <label
                      htmlFor={`r-${item.id}`}
                      className={cn(
                        "cursor-pointer text-sm select-none",
                        done && "text-muted-foreground line-through",
                      )}
                    >
                      {item.label}
                    </label>
                  </li>
                );
              }

              return (
                <li key={item.id} className="space-y-1">
                  <label htmlFor={`r-${item.id}`} className="text-xs text-muted-foreground">
                    {item.label}
                  </label>
                  {item.type === "LONG_TEXT" ? (
                    <Textarea
                      id={`r-${item.id}`}
                      value={response?.text ?? ""}
                      onChange={(e) => onText(item.id, e.target.value)}
                      onBlur={(e) => persist(item.id, { text: e.target.value })}
                      rows={3}
                      className="resize-y"
                      placeholder="Write here…"
                    />
                  ) : (
                    <Input
                      id={`r-${item.id}`}
                      value={response?.text ?? ""}
                      onChange={(e) => onText(item.id, e.target.value)}
                      onBlur={(e) => persist(item.id, { text: e.target.value })}
                      placeholder="Write here…"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {snapshot.sections.length === 0 && (
        <div className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">
          Your routine is empty. Build it in Settings → Pre-Session Routine.
        </div>
      )}

      {/* Readiness gate */}
      {isReady ? (
        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl border-success/30 bg-success/5 p-4">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
              <CircleCheck className="size-5" />
            </span>
            <div>
              <p className="text-sm font-medium">You&apos;re ready to trade</p>
              <p className="text-xs text-muted-foreground">
                Confirmed — the rest of today&apos;s workflow is unlocked.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={toggleReady} disabled={isPending}>
            <RotateCcw className="size-3.5" />
            Reopen routine
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            type="button"
            size="lg"
            onClick={toggleReady}
            disabled={isPending}
            className="bg-brand-gradient shadow-glow h-12 w-full gap-2 text-base text-white hover:opacity-95"
          >
            <Sparkles className="size-5" />
            I am ready to trade
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" />
            Completing your routine unlocks the rest of today&apos;s workflow.
          </p>
        </div>
      )}
    </div>
  );
}
