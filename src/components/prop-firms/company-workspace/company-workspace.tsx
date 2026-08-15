"use client";

import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PropFirmLogo } from "@/components/prop-firms/prop-firm-logo";
import { toAccountRollupInput } from "@/components/prop-firms/rollup";
import { aggregateAccounts } from "@/domain/prop-firms/metrics";
import type { UserPropFirmDTO } from "@/types/prop-firms";
import { OverviewTab } from "./tabs/overview-tab";
import { AccountsTab } from "./tabs/accounts-tab";
import { PayoutsTab } from "./tabs/payouts-tab";
import { CostsTab } from "./tabs/costs-tab";
import { PerformanceTab } from "./tabs/performance-tab";
import { MilestonesTab } from "./tabs/milestones-tab";

export function CompanyWorkspace({ firm }: { firm: UserPropFirmDTO }) {
  const metrics = aggregateAccounts(firm.accounts.map(toAccountRollupInput));

  return (
    <div className="space-y-5">
      <Link href="/prop-firms" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Prop Firms
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <PropFirmLogo name={firm.companyName} logoUrl={firm.logoUrl} accentColor={firm.accentColor} className="size-12" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{firm.companyName}</h1>
              {firm.status === "ARCHIVED" && <Badge variant="secondary">Archived</Badge>}
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {firm.marketCategory} · {firm.accounts.length} account{firm.accounts.length === 1 ? "" : "s"}
              {firm.isPriority ? " · Priority" : ""}
            </div>
          </div>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          nativeButton={false}
          render={<Link href={`/prop-firms/add-account?firmId=${firm.id}`} />}
        >
          <Plus className="size-3.5" />
          Add account
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-max">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab firm={firm} metrics={metrics} />
        </TabsContent>
        <TabsContent value="accounts" className="mt-4">
          <AccountsTab firm={firm} />
        </TabsContent>
        <TabsContent value="payouts" className="mt-4">
          <PayoutsTab firm={firm} />
        </TabsContent>
        <TabsContent value="costs" className="mt-4">
          <CostsTab firm={firm} />
        </TabsContent>
        <TabsContent value="performance" className="mt-4">
          <PerformanceTab firm={firm} metrics={metrics} />
        </TabsContent>
        <TabsContent value="milestones" className="mt-4">
          <MilestonesTab firm={firm} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
