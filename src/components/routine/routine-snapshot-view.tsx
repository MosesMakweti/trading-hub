import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { isItemComplete, type RoutineSnapshot } from "@/domain/today/routine-snapshot";

// Read-only display of a frozen day routine (Journal). Renders exactly what was
// completed that day — checkbox states and any text notes — never editable.
export function RoutineSnapshotView({ snapshot }: { snapshot: RoutineSnapshot }) {
  if (snapshot.sections.length === 0) {
    return <p className="text-sm text-muted-foreground">No routine was recorded for this day.</p>;
  }

  return (
    <div className="space-y-4">
      {snapshot.sections.map((section) => (
        <div key={section.id} className="space-y-2">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {section.title}
          </h4>
          <ul className="space-y-1.5">
            {section.items.map((item) => {
              const response = snapshot.responses[item.id];
              const done = isItemComplete(item, response);

              if (item.type === "CHECKBOX") {
                return (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded",
                        done ? "bg-success/20 text-success" : "border border-border text-transparent",
                      )}
                    >
                      {done ? <Check className="size-3" /> : <Minus className="size-3" />}
                    </span>
                    <span className={cn(!done && "text-muted-foreground")}>{item.label}</span>
                  </li>
                );
              }

              return (
                <li key={item.id} className="text-sm">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <p className={cn("mt-0.5 whitespace-pre-wrap", !done && "text-muted-foreground/50 italic")}>
                    {done ? response?.text : "Not answered."}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
