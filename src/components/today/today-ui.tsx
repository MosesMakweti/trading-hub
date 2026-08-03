import type { ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";

import type { SaveState } from "@/hooks/use-debounced-autosave";

/** Tiny saving / saved indicator shared by the Today workflow sections. */
export function SaveDot({ state }: { state: SaveState }) {
  return (
    <span className="inline-flex w-4 items-center justify-center">
      {state === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      {state === "saved" && <Check className="size-3.5 text-success" />}
    </span>
  );
}

/** A titled glass card with an optional right-aligned action (e.g. a SaveDot). */
export function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
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
