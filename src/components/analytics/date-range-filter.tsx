"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DATE_RANGE_PRESET_LABELS, type DateRangePreset } from "@/lib/date-ranges";

const PRESETS: Exclude<DateRangePreset, "custom">[] = ["week", "month", "3months", "year"];

export function DateRangeFilter({
  preset,
  from,
  to,
}: {
  preset: DateRangePreset;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setPreset(next: Exclude<DateRangePreset, "custom">) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    params.delete("from");
    params.delete("to");
    router.push(`${pathname}?${params.toString()}`);
  }

  function setCustom(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", "custom");
    params.set("from", nextFrom);
    params.set("to", nextTo);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <Button
          key={p}
          size="sm"
          variant={preset === p ? "default" : "outline"}
          onClick={() => setPreset(p)}
        >
          {DATE_RANGE_PRESET_LABELS[p]}
        </Button>
      ))}
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-2 py-1",
          preset === "custom" ? "border-primary" : "border-border",
        )}
      >
        <Input
          type="date"
          value={from}
          onChange={(e) => setCustom(e.target.value, to)}
          className="h-6 w-32 border-0 bg-transparent px-1 text-xs"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => setCustom(from, e.target.value)}
          className="h-6 w-32 border-0 bg-transparent px-1 text-xs"
        />
      </div>
    </div>
  );
}
