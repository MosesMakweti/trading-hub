"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type MarketCategory = "CFD" | "FUTURES";

/**
 * The CFD/Futures switch — persisted in the URL (`?market=`) so it survives
 * navigation and refresh, same pattern as AnalyticsFilterBar's search-param
 * filters. Instant client-side switch (the parent already has both
 * categories' data); the URL update is purely for persistence/shareability.
 */
export function MarketSwitch({
  market,
  onChange,
}: {
  market: MarketCategory;
  onChange: (market: MarketCategory) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(next: string) {
    const value = next as MarketCategory;
    onChange(value);
    const params = new URLSearchParams(searchParams.toString());
    params.set("market", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={market} onValueChange={handleChange}>
      <TabsList>
        <TabsTrigger value="CFD">CFDs</TabsTrigger>
        <TabsTrigger value="FUTURES">Futures</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
