export interface SessionWindow {
  id: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
}

export interface NextSessionEvent {
  session: SessionWindow;
  status: "active" | "upcoming";
  minutesUntil: number;
}

function isWithinWindow(start: number, end: number, now: number): boolean {
  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  // Overnight window (e.g. 22:00-06:00) wraps past midnight.
  return now >= start || now < end;
}

function minutesUntilTarget(target: number, now: number): number {
  return target >= now ? target - now : 1440 - now + target;
}

/**
 * Finds the session the trader is currently in, or failing that, the
 * soonest upcoming one (today or wrapping to tomorrow). Returns null only
 * when there are no sessions configured at all.
 */
export function nextSessionEvent(
  sessions: SessionWindow[],
  nowMinutesSinceMidnight: number,
): NextSessionEvent | null {
  if (sessions.length === 0) return null;

  for (const session of sessions) {
    if (isWithinWindow(session.startMinutes, session.endMinutes, nowMinutesSinceMidnight)) {
      return {
        session,
        status: "active",
        minutesUntil: minutesUntilTarget(session.endMinutes, nowMinutesSinceMidnight),
      };
    }
  }

  let best: { session: SessionWindow; minutesUntil: number } | null = null;
  for (const session of sessions) {
    const minutesUntil = minutesUntilTarget(session.startMinutes, nowMinutesSinceMidnight);
    if (!best || minutesUntil < best.minutesUntil) best = { session, minutesUntil };
  }
  return best ? { session: best.session, status: "upcoming", minutesUntil: best.minutesUntil } : null;
}
