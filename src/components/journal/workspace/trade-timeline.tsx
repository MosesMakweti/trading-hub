import { ComingSoon } from "@/components/journal/workspace/workspace-ui";
import type { TradeWorkspaceDTO } from "@/types/trades";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Phase 1 shows the two events the record actually timestamps (created / last
 * updated). Phase 3 replaces this with the full lifecycle timeline (idea saved →
 * executed → closed → reviewed), each individually timestamped.
 */
export function TradeTimeline({ trade }: { trade: TradeWorkspaceDTO }) {
  const events = [
    { label: "Trade created", at: trade.createdAt },
    { label: "Last updated", at: trade.updatedAt },
  ];

  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {events.map((e, i) => (
          <li key={e.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1 size-2 rounded-full bg-primary" />
              {i < events.length - 1 && <span className="w-px flex-1 bg-border" />}
            </div>
            <div className="pb-1">
              <div className="text-sm font-medium">{e.label}</div>
              <div className="text-xs text-muted-foreground tabular-nums">{formatDateTime(e.at)}</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        A full lifecycle timeline — idea saved, executed, closed, reviewed — each timestamped,
        arrives next.
        <ComingSoon label="Phase 3" />
      </p>
    </div>
  );
}
