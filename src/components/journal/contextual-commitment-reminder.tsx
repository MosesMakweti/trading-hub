"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { getContextualReminder } from "@/actions/edge-improvements.actions";
import type { AutomaticEvidenceRuleKey } from "@/domain/improvements/commitment-adherence";
import type { ContextualReminderDTO } from "@/types/edge-improvements";
import { useWorkspace } from "@/components/workspace/workspace-context";

/**
 * Trade Idea contextual commitment reminder (Stage 19.1 §3-7) — surfaces a
 * relevant ACTIVE improvement at the moment the trader is about to repeat
 * the targeted behavior. A guardrail, not a motivational notification:
 * compact, non-blocking, and purely informational — rendering this creates
 * no daily state and is never itself FOLLOWED/BREACHED evidence (§7). It
 * never prevents Override, alters validation/execution, or changes risk
 * (§5) — the trader retains full control. Deduplicated across weekly/
 * monthly for the same rule identity by `getContextualReminder` itself
 * (§6), so at most one reminder ever shows for a given rule set.
 */
export function ContextualCommitmentReminder({ ruleKeys }: { ruleKeys: AutomaticEvidenceRuleKey[] }) {
  // Edge Review commitments describe LIVE trading — never surfaced in a backtest.
  const { isBacktest } = useWorkspace();
  return isBacktest ? null : <LiveContextualCommitmentReminder ruleKeys={ruleKeys} />;
}

function LiveContextualCommitmentReminder({ ruleKeys }: { ruleKeys: AutomaticEvidenceRuleKey[] }) {
  const [reminder, setReminder] = useState<ContextualReminderDTO | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getContextualReminder(ruleKeys).then((result) => {
      if (!cancelled) setReminder(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ruleKeys is a stable literal array from the caller
  }, [ruleKeys.join(",")]);

  if (!reminder) return null;

  return (
    <div className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <div>
        <p className="font-medium text-primary">Active improvement: {reminder.title}</p>
        {reminder.description && <p className="mt-0.5 text-muted-foreground">{reminder.description}</p>}
      </div>
    </div>
  );
}
