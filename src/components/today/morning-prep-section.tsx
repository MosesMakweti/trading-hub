"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CircleCheck, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { updateMorningPrep } from "@/actions/today.actions";
import type { SaveState } from "@/hooks/use-debounced-autosave";
import type { MorningPrepDTO } from "@/types/today";

function SaveDot({ state }: { state: SaveState }) {
  return (
    <span className="inline-flex w-4 items-center justify-center">
      {state === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      {state === "saved" && <Check className="size-3.5 text-success" />}
    </span>
  );
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function MorningPrepSection({
  dateKey,
  prep,
}: {
  dateKey: string;
  prep: MorningPrepDTO;
}) {
  const router = useRouter();

  const [completed, setCompleted] = useState<Set<string>>(new Set(prep.completedIds));
  const [routineSave, setRoutineSave] = useState<SaveState>("idle");
  const [readiness, setReadiness] = useState<number | null>(prep.readiness);
  const [readySave, setReadySave] = useState<SaveState>("idle");
  const [isComplete, setIsComplete] = useState(prep.prepComplete);
  const [completing, startComplete] = useTransition();

  async function toggleRoutine(id: string) {
    const next = new Set(completed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCompleted(next);
    setRoutineSave("saving");
    const result = await updateMorningPrep(dateKey, { routineCompletion: [...next] });
    if (result.success) setRoutineSave("saved");
    else {
      setRoutineSave("error");
      toast.error(result.error);
    }
  }

  async function chooseReadiness(n: number) {
    const next = readiness === n ? null : n;
    setReadiness(next);
    setReadySave("saving");
    const result = await updateMorningPrep(dateKey, { readiness: next });
    if (result.success) setReadySave("saved");
    else {
      setReadySave("error");
      toast.error(result.error);
    }
  }

  function toggleComplete() {
    const next = !isComplete;
    startComplete(async () => {
      const result = await updateMorningPrep(dateKey, { prepComplete: next });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setIsComplete(next);
      toast.success(next ? "Preparation complete." : "Preparation reopened.");
      router.refresh(); // advance the workflow stepper
    });
  }

  const routineCount = prep.routineItems.length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Get set before the session — run your routine, note the market context, and check you&apos;re
        ready to trade.
      </p>

      {/* Pre-session routine */}
      <Card
        title="Pre-session routine"
        action={
          routineCount > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              <SaveDot state={routineSave} />
              {completed.size}/{routineCount} done
            </span>
          ) : null
        }
      >
        {routineCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            No routine steps yet.{" "}
            <Link href="/settings/plan" className="text-primary hover:underline">
              Add them in your trading plan
            </Link>{" "}
            and they&apos;ll appear here each morning.
          </p>
        ) : (
          <ul className="space-y-1">
            {prep.routineItems.map((item) => {
              const checked = completed.has(item.id);
              return (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/40">
                    <Checkbox checked={checked} onCheckedChange={() => toggleRoutine(item.id)} />
                    <span className={cn(checked && "text-muted-foreground line-through")}>
                      {item.label}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Market context */}
      <Card title="Market context">
        <RichTextEditor
          initialContent={prep.marketContext}
          placeholder="Key news, higher-timeframe bias, levels to watch, overall tone…"
          onSave={(content) => updateMorningPrep(dateKey, { marketContext: content })}
        />
      </Card>

      {/* Readiness */}
      <Card title="Readiness" action={<SaveDot state={readySave} />}>
        <p className="text-xs text-muted-foreground">
          How prepared and clear-headed do you feel right now? (1 = not ready, 5 = dialed in)
        </p>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Button
              key={n}
              type="button"
              size="sm"
              variant={readiness === n ? "default" : "outline"}
              aria-pressed={readiness === n}
              onClick={() => chooseReadiness(n)}
              className="w-10 tabular-nums"
            >
              {n}
            </Button>
          ))}
        </div>
      </Card>

      {/* Finalize */}
      <div className="flex items-center justify-end gap-3">
        {isComplete && (
          <span className="flex items-center gap-1.5 text-sm text-success">
            <CircleCheck className="size-4" />
            Preparation complete
          </span>
        )}
        <Button
          type="button"
          variant={isComplete ? "outline" : "default"}
          onClick={toggleComplete}
          disabled={completing}
          className="gap-1.5"
        >
          {completing && <Loader2 className="size-3.5 animate-spin" />}
          {isComplete ? "Reopen preparation" : "Mark preparation complete"}
        </Button>
      </div>
    </div>
  );
}
