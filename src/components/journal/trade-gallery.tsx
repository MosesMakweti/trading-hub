import Link from "next/link";
import { ChevronLeft, Images } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { StaggerList, StaggerItem } from "@/components/shared/motion";
import { TradeGalleryCard } from "@/components/journal/trade-gallery-card";
import type { TradeWorkspaceDTO } from "@/types/trades";

/** The Trade Gallery: every trade as a card, newest first (P8). */
export function TradeGallery({ trades }: { trades: TradeWorkspaceDTO[] }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to calendar"
            nativeButton={false}
            render={<Link href="/journal" />}
          >
            <ChevronLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Trade Gallery</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every trade at a glance — {trades.length} trade{trades.length === 1 ? "" : "s"}.
            </p>
          </div>
        </div>
      </div>

      {trades.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No trades yet"
          description="Log trades from the journal or the Today workspace and they'll be catalogued here."
        />
      ) : (
        <StaggerList className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {trades.map((trade) => (
            <StaggerItem key={trade.id}>
              <TradeGalleryCard trade={trade} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  );
}
