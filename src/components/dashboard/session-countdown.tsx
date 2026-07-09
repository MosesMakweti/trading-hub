"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

import { minutesToTimeString } from "@/lib/date";
import { nextSessionEvent, type SessionWindow } from "@/domain/schedule/session-countdown";

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function SessionCountdown({ sessions }: { sessions: SessionWindow[] }) {
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);

  useEffect(() => {
    function update() {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (nowMinutes === null) {
    return null;
  }

  const event = nextSessionEvent(sessions, nowMinutes);

  if (!event) {
    return (
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4" />
          No trading sessions configured yet.
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="size-3.5" />
        {event.status === "active" ? "Session in progress" : "Next session"}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-semibold">{event.session.name}</span>
        <span className="text-xs text-muted-foreground">
          {minutesToTimeString(event.session.startMinutes)}–
          {minutesToTimeString(event.session.endMinutes)}
        </span>
      </div>
      <p className="mt-1 text-sm">
        {event.status === "active" ? (
          <>
            Closes in <span className="font-medium text-success">{formatDuration(event.minutesUntil)}</span>
          </>
        ) : (
          <>
            Starts in <span className="font-medium text-primary">{formatDuration(event.minutesUntil)}</span>
          </>
        )}
      </p>
    </div>
  );
}
