"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SessionCountdown } from "@/components/dashboard/session-countdown";
import { PrivacyModeToggle } from "@/components/dashboard/privacy-mode";
import { DATE_RANGE_PRESET_LABELS, type DateRangePreset } from "@/lib/date-ranges";
import type { SessionWindow } from "@/domain/schedule/session-countdown";

const ALL = "__all__";
const PRESETS: Exclude<DateRangePreset, "custom">[] = ["week", "month", "3months", "year"];

export interface UnreviewedTradeSummary {
  id: string;
  dateKey: string;
  assetSymbol: string;
}

export function CommandBar({
  sessions,
  accounts,
  preset,
  unreviewedTrades,
}: {
  sessions: SessionWindow[];
  accounts: { id: string; name: string }[];
  preset: DateRangePreset;
  unreviewedTrades: UnreviewedTradeSummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setPreset(next: Exclude<DateRangePreset, "custom">) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", next);
    params.delete("from");
    params.delete("to");
    router.push(`${pathname}?${params.toString()}`);
  }

  function setAccount(next: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (next == null) params.delete("account");
    else params.set("account", next);
    router.push(`${pathname}?${params.toString()}`);
  }

  const currentAccount = searchParams.get("account") ?? ALL;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-[220px] flex-1">
        <SessionCountdown sessions={sessions} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          items={[{ value: ALL, label: "All accounts" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          value={currentAccount}
          onValueChange={(v) => setAccount(v === ALL ? null : v)}
        >
          <SelectTrigger
            className={currentAccount !== ALL ? "h-8 border-primary/50 text-xs" : "h-8 text-xs text-muted-foreground"}
            aria-label="Account"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All accounts</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {PRESETS.map((p) => (
          <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} onClick={() => setPreset(p)}>
            {DATE_RANGE_PRESET_LABELS[p]}
          </Button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button type="button" variant="outline" size="icon-sm" aria-label="Notifications" className="relative" />}
          >
            <Bell />
            {unreviewedTrades.length > 0 && (
              <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-danger text-[10px] font-medium text-danger-foreground">
                {unreviewedTrades.length > 9 ? "9+" : unreviewedTrades.length}
              </span>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {unreviewedTrades.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">All caught up — no unreviewed trades.</div>
            ) : (
              unreviewedTrades.map((t) => (
                <DropdownMenuItem key={t.id} render={<Link href={`/journal/${t.dateKey}/trades/${t.id}`} />}>
                  <span className="font-medium">{t.assetSymbol}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{t.dateKey}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <PrivacyModeToggle />

        {/* Today V2 Final Phase §15 — routes to the Today workspace's own
            in-flow Add Trade dialog (day-context inheritance: bias, active
            strategy, session — see add-trade-dialog.tsx), rather than the
            standalone historical-entry form. That form still exists at
            /journal/[date]/trades/new for adding a trade to a PAST day and
            for opportunity-linked creation from the Journal — this button
            is specifically "add a trade right now," so it should never
            compete with Today's own canonical live path. */}
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          nativeButton={false}
          render={<Link href="/today" />}
        >
          <Plus className="size-3.5" />
          Add Trade
        </Button>
      </div>
    </div>
  );
}
