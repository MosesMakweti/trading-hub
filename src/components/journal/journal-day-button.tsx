"use client";

import type { ComponentProps } from "react";
import type { DayButton } from "react-day-picker";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { localDateToKey } from "@/lib/date";

export function JournalDayButton({
  day,
  modifiers,
  className,
  noteDates,
  ...props
}: ComponentProps<typeof DayButton> & { noteDates: Set<string> }) {
  const router = useRouter();
  const dateKey = localDateToKey(day.date);
  const hasNote = noteDates.has(dateKey);

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "relative flex aspect-square size-auto w-full flex-col items-center justify-center gap-0.5 border-0 font-normal",
        modifiers.today && "bg-muted font-semibold",
        modifiers.outside && "text-muted-foreground opacity-40",
        className,
      )}
      onClick={() => router.push(`/journal/${dateKey}`)}
      {...props}
    >
      <span>{day.date.getDate()}</span>
      {hasNote && <span className="absolute bottom-1.5 size-1 rounded-full bg-primary" />}
    </Button>
  );
}
