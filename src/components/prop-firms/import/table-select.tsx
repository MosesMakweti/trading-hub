"use client";

import { Check, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { InspectedTable } from "@/server/services/prop-firm-import.service";

/**
 * Sheet / HTML-table / statement-section picker. Shown only when the upload
 * yielded more than one table (a multi-sheet workbook, an MT4/MT5 HTML report
 * with several sections, a page with multiple tables). The best-scoring table
 * is pre-selected; the user can override.
 */
export function TableSelect({
  tables,
  selectedId,
  autoSelected,
  onSelect,
}: {
  tables: InspectedTable[];
  selectedId: string | null;
  autoSelected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        This file has several tables. Pick the one that holds the trade history.
      </p>
      {autoSelected && selectedId && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" />
          Auto-selected the table that looks most like trade history — change it below if that&apos;s wrong.
        </p>
      )}
      {tables.map((t) => {
        const isActive = selectedId === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors",
              isActive ? "border-primary bg-accent/40" : "border-border hover:bg-muted/50",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium">
                <span className="truncate">{t.name}</span>
                {isActive && <Check className="size-3.5 shrink-0 text-primary" />}
              </div>
              <div className="text-xs text-muted-foreground">
                {t.rowCount} {t.rowCount === 1 ? "row" : "rows"} · {t.headers.length} columns
              </div>
            </div>
            {t.looksLikeTrades && (
              <Badge variant="outline" className="shrink-0">
                Looks like trades
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
