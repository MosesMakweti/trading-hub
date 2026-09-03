import { Award, Flag, PiggyBank, RotateCcw, ShieldAlert, Star, TrendingDown, TrendingUp } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { formatDate } from "@/components/prop-firms/format";
import type { PropFirmAccountDTO } from "@/types/prop-firms";

const MILESTONE_ICON: Record<string, typeof Flag> = {
  ACCOUNT_PURCHASED: Flag,
  PHASE_PASSED: TrendingUp,
  PHASE_FAILED: TrendingDown,
  STAGE_RESET: RotateCcw,
  FUNDED_ACHIEVED: Award,
  PAYOUT_RECEIVED: PiggyBank,
  SCALING_MILESTONE: Star,
  ACCOUNT_BREACHED: ShieldAlert,
  CUSTOM: Flag,
};

export function MilestonesTab({ account }: { account: PropFirmAccountDTO }) {
  if (account.milestones.length === 0) {
    return (
      <EmptyState
        icon={Flag}
        title="No milestones yet"
        description="Stage completions, funding, and payouts for this account will appear here."
      />
    );
  }

  return (
    <ol className="space-y-3">
      {account.milestones.map((m) => {
        const Icon = MILESTONE_ICON[m.type] ?? Flag;
        return (
          <li key={m.id} className="glass flex items-start gap-3 rounded-xl p-3.5">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{m.title ?? m.type.replace(/_/g, " ")}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(m.achievedAt)}</span>
              </div>
              {m.description && <p className="mt-1 text-xs text-muted-foreground">{m.description}</p>}
              {m.documents.length > 0 && (
                <div className="mt-1 text-[11px] text-primary">
                  {m.documents.length} document{m.documents.length === 1 ? "" : "s"}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
