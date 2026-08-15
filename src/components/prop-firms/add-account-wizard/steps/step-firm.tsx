"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PropFirmLogo } from "@/components/prop-firms/prop-firm-logo";
import type { UserPropFirmDTO } from "@/types/prop-firms";
import type { AccountDraft } from "../types";

export function StepFirm({
  firms,
  draft,
  onSelect,
}: {
  firms: UserPropFirmDTO[];
  draft: AccountDraft;
  onSelect: (firm: UserPropFirmDTO) => void;
}) {
  const [search, setSearch] = useState("");

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return firms.filter((f) => !q || f.companyName.toLowerCase().includes(q));
  }, [firms, search]);

  if (firms.length === 0) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          You don&apos;t have any prop firms yet — add one first, then come back to create an account for it.
        </p>
        <Link href="/prop-firms" className="text-sm font-medium text-primary hover:underline">
          Go to Prop Firms
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your prop firms…"
          className="pl-8"
          autoFocus
        />
      </div>
      <div className="max-h-80 space-y-1.5 overflow-y-auto">
        {results.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No matches.</p>
        ) : (
          results.map((firm) => (
            <button
              key={firm.id}
              type="button"
              onClick={() => onSelect(firm)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-muted",
                draft.userPropFirmId === firm.id && "border-primary bg-muted",
              )}
            >
              <PropFirmLogo name={firm.companyName} logoUrl={firm.logoUrl} accentColor={firm.accentColor} className="size-8" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{firm.companyName}</div>
                <div className="text-xs text-muted-foreground">
                  {firm.accounts.length} account{firm.accounts.length === 1 ? "" : "s"}
                </div>
              </div>
              <Badge variant="outline">{firm.marketCategory}</Badge>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
