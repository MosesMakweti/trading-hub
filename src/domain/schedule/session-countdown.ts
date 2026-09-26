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

/**
 * Today V2 (T3) — resolves a day-level default session for a new Trade
 * Idea, from `TradingDay.activeSessions` (plain names the trader picked as
 * "in play today," no time windows of their own) plus the trader's globally
 * configured session windows (for telling which of several is happening
 * right now). Never guesses:
 *   - exactly one active session name -> that one, unconditionally (there's
 *     nothing to disambiguate, so no time-window match is even needed).
 *   - several active session names -> only default when EXACTLY ONE of
 *     them is the currently-active window (by nextSessionEvent); otherwise
 *     null, so the trader picks explicitly rather than the app assuming.
 *   - zero active session names -> null.
 */
export function resolveDefaultSession(
  activeSessionNames: string[],
  windows: SessionWindow[],
  /** Null when there is no meaningful wall clock (a Backtest Session replays
   *  a historical date) — then only an unambiguous single session defaults. */
  nowMinutesSinceMidnight: number | null,
): string | null {
  if (activeSessionNames.length === 0) return null;
  if (activeSessionNames.length === 1) return activeSessionNames[0];
  if (nowMinutesSinceMidnight == null) return null;

  const activeNameSet = new Set(activeSessionNames.map((n) => n.trim().toLowerCase()));
  const candidateWindows = windows.filter((w) => activeNameSet.has(w.name.trim().toLowerCase()));
  const current = nextSessionEvent(candidateWindows, nowMinutesSinceMidnight);
  return current?.status === "active" ? current.session.name : null;
}
