"use server";

import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { utcDateToKey } from "@/lib/date";

export interface SearchResult {
  category: "Trade" | "Account" | "Entry Model";
  label: string;
  sublabel?: string;
  href: string;
}

export async function globalSearch(query: string): Promise<SearchResult[]> {
  const user = await requireUser();
  const q = query.trim();
  if (q.length === 0) return [];

  const [trades, accounts, entryModels] = await Promise.all([
    prisma.trade.findMany({
      where: { userId: user.id, assetSymbol: { contains: q, mode: "insensitive" } },
      orderBy: { tradeDate: "desc" },
      take: 8,
    }),
    prisma.tradingAccount.findMany({
      where: {
        userId: user.id,
        kind: { in: ["PROP_FIRM", "PERSONAL_BROKERAGE"] },
        name: { contains: q, mode: "insensitive" },
      },
      take: 5,
    }),
    prisma.entryModel.findMany({
      where: { userId: user.id, name: { contains: q, mode: "insensitive" } },
      take: 5,
    }),
  ]);

  const results: SearchResult[] = [];
  for (const t of trades) {
    const dateKey = utcDateToKey(t.tradeDate);
    results.push({
      category: "Trade",
      label: `${t.assetSymbol} — ${t.direction === "LONG" ? "Long" : "Short"}`,
      sublabel: dateKey,
      href: `/journal/${dateKey}`,
    });
  }
  for (const a of accounts) {
    results.push({ category: "Account", label: a.name, href: "/accounts" });
  }
  for (const m of entryModels) {
    results.push({ category: "Entry Model", label: m.name, href: "/strategy-lab/entry-models" });
  }

  return results;
}
