"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PropFirmLogo } from "@/components/prop-firms/prop-firm-logo";
import { toAccountRollupInput } from "@/components/prop-firms/rollup";
import { aggregateAccounts } from "@/domain/prop-firms/metrics";
import type { OverviewAccountInput } from "@/domain/prop-firms/overview-series";
import { deleteUserPropFirmAction } from "@/actions/prop-firms.actions";
import type { MappingTemplateDTO, UserPropFirmDTO } from "@/types/prop-firms";
import { OverviewTab } from "./tabs/overview-tab";
import { AccountsTab } from "./tabs/accounts-tab";
import { PayoutsTab } from "./tabs/payouts-tab";
import { CostsTab } from "./tabs/costs-tab";
import { PerformanceTab } from "./tabs/performance-tab";
import { MilestonesTab } from "./tabs/milestones-tab";

export function CompanyWorkspace({
  firm,
  mappingTemplates,
  overviewAccounts,
}: {
  firm: UserPropFirmDTO;
  mappingTemplates: MappingTemplateDTO[];
  overviewAccounts: OverviewAccountInput[];
}) {
  const router = useRouter();
  const metrics = aggregateAccounts(firm.accounts.map(toAccountRollupInput));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  function handleDelete() {
    startDelete(async () => {
      const result = await deleteUserPropFirmAction(firm.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Prop firm deleted.");
      router.push("/prop-firms");
      router.refresh();
    });
  }

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
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="gap-1.5"
            nativeButton={false}
            render={<Link href={`/prop-firms/add-account?firmId=${firm.id}`} />}
          >
            <Plus className="size-3.5" />
            Add account
          </Button>
          <Button
            variant="destructive"
            size="icon-sm"
            title="Delete firm"
            aria-label={`Delete ${firm.companyName}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 />
          </Button>
        </div>
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
          <AccountsTab firm={firm} mappingTemplates={mappingTemplates} />
        </TabsContent>
        <TabsContent value="payouts" className="mt-4">
          <PayoutsTab firm={firm} />
        </TabsContent>
        <TabsContent value="costs" className="mt-4">
          <CostsTab firm={firm} />
        </TabsContent>
        <TabsContent value="performance" className="mt-4">
          <PerformanceTab firm={firm} metrics={metrics} overviewAccounts={overviewAccounts} />
        </TabsContent>
        <TabsContent value="milestones" className="mt-4">
          <MilestonesTab firm={firm} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this prop firm?"
        description={`"${firm.companyName}" and all ${firm.accounts.length} of its purchased account${firm.accounts.length === 1 ? "" : "s"} will be removed. This can't be undone from here.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
