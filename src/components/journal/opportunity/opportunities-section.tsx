"use client";

import { useState } from "react";
import { Plus, Target } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { StaggerList, StaggerItem } from "@/components/shared/motion";
import { OpportunitySpotForm } from "@/components/journal/opportunity/opportunity-spot-form";
import {
  OpportunityCard,
  type LinkableTrade,
} from "@/components/journal/opportunity/opportunity-card";
import type { OpportunityListItemDTO } from "@/types/opportunity";

interface StrategyOption {
  id: string;
  name: string;
  version: number;
}

// The Journal day "Opportunities" section: the funnel of valid setups spotted this
// day and how each resolved (executed / missed / invalidated / expired). Distinct
// from Trades — a trade is a taken opportunity; this captures the ones you didn't.
export function OpportunitiesSection({
  dateKey,
  opportunities,
  strategies,
  linkableTrades,
  editable,
}: {
  dateKey: string;
  opportunities: OpportunityListItemDTO[];
  strategies: StrategyOption[];
  linkableTrades: LinkableTrade[];
  editable: boolean;
}) {
  const [spotting, setSpotting] = useState(false);

  const executed = opportunities.filter((o) => o.status === "EXECUTED").length;
  const missed = opportunities.filter((o) => o.status === "MISSED").length;
  const pending = opportunities.filter((o) => o.status === "PENDING").length;

  const canSpot = editable && strategies.length > 0;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Opportunities</h2>
          {opportunities.length > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {executed} executed · {missed} missed{pending > 0 ? ` · ${pending} pending` : ""}
            </span>
          )}
        </div>
        {canSpot && !spotting && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSpotting(true)}>
            <Plus className="size-3.5" />
            Spot opportunity
          </Button>
        )}
      </div>

      {spotting && (
        <OpportunitySpotForm
          dateKey={dateKey}
          strategies={strategies}
          onDone={() => setSpotting(false)}
          onCancel={() => setSpotting(false)}
        />
      )}

      {opportunities.length === 0 && !spotting ? (
        <EmptyState
          icon={Target}
          title="No opportunities logged"
          description={
            canSpot
              ? "Spot a valid setup to track it — whether you take it or miss it. Only taken and missed valid setups affect your Discrepancy Gap."
              : "Create a strategy in Strategy Lab first — opportunities are validated against a strategy's confluences."
          }
        />
      ) : (
        <StaggerList className="space-y-3">
          {opportunities.map((o) => (
            <StaggerItem key={o.id}>
              <OpportunityCard
                dateKey={dateKey}
                opportunity={o}
                linkableTrades={linkableTrades}
                editable={editable}
              />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </section>
  );
}
