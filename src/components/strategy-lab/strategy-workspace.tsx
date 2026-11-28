"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Boxes,
  CalendarClock,
  ChevronLeft,
  ClipboardCheck,
  Clock,
  Crosshair,
  GitCommitVertical,
  Layers,
  LineChart,
  ListOrdered,
  Settings2,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StrategyStatusBadge } from "@/components/strategy-lab/strategy-status-badge";
import {
  StrategySettingsForm,
  type StrategySettingsState,
} from "@/components/strategy-lab/strategy-settings-form";
import { ArsenalSection } from "@/components/strategy-lab/arsenal-section";
import { FrameworkSection } from "@/components/strategy-lab/framework-section";
import { TimeframesSection } from "@/components/strategy-lab/timeframes-section";
import { EntryModelsSection } from "@/components/strategy-lab/entry-models-section";
import { ImageAttachments } from "@/components/media/image-attachments";
import { TradeManagementSection } from "@/components/strategy-lab/trade-management-section";
import { StrategyPerformanceSection } from "@/components/strategy-lab/strategy-performance-section";
import { StrategyVersionsSection } from "@/components/strategy-lab/strategy-versions-section";
import {
  StrategyChecklistSection,
  type StrategyChecklistItemDTO,
} from "@/components/strategy-lab/sot/strategy-checklist-section";
import {
  StrategySessionsSection,
  type StrategySessionDTO,
} from "@/components/strategy-lab/sot/strategy-sessions-section";
import { SetupTypesSection } from "@/components/strategy-lab/setup-types-section";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import { updateStrategySettings } from "@/actions/strategies.actions";
import type { StrategyPerformanceSummary } from "@/domain/performance/strategy-performance";
import type { ExpectancyStats } from "@/domain/performance/expectancy";
import type {
  ArsenalConceptDTO,
  EntryModelDTO,
  FrameworkStepDTO,
  StrategyDTO,
  StrategySetupTypeDTO,
  StrategyVersionDTO,
  TimeframeDTO,
  TradeManagementDTO,
} from "@/types/strategies";

// Workspace section tabs (after the fixed Settings / Performance / Versions tabs).
const SECTIONS = [
  { value: "arsenal", label: "Arsenal", icon: Boxes },
  { value: "framework", label: "Framework", icon: ListOrdered },
  { value: "timeframes", label: "Timeframes", icon: Clock },
  { value: "entry-models", label: "Entry Models", icon: Crosshair },
  { value: "sessions", label: "Sessions", icon: CalendarClock },
  { value: "confluences", label: "Confluences", icon: Sparkles },
  { value: "execution", label: "Execution", icon: ClipboardCheck },
  { value: "setup-types", label: "Setup Types", icon: Layers },
  { value: "trade-management", label: "Trade Management", icon: SlidersHorizontal },
] as const;

export function StrategyWorkspace({
  strategy,
  arsenalConcepts,
  frameworkSteps,
  timeframes,
  entryModels,
  tradeManagement,
  performance,
  liveExpectancy,
  versions,
  sessions,
  confluences,
  execution,
  setupTypes,
}: {
  strategy: StrategyDTO;
  arsenalConcepts: ArsenalConceptDTO[];
  frameworkSteps: FrameworkStepDTO[];
  timeframes: TimeframeDTO[];
  entryModels: EntryModelDTO[];
  tradeManagement: TradeManagementDTO;
  performance: StrategyPerformanceSummary;
  liveExpectancy: ExpectancyStats;
  versions: StrategyVersionDTO[];
  sessions: StrategySessionDTO[];
  confluences: StrategyChecklistItemDTO[];
  execution: StrategyChecklistItemDTO[];
  setupTypes: StrategySetupTypeDTO[];
}) {
  const [settings, setSettings] = useState<StrategySettingsState>({
    name: strategy.name,
    description: strategy.description ?? "",
    applicableAssets: strategy.applicableAssets,
    status: strategy.status,
  });

  const saveState = useDebouncedAutosave<StrategySettingsState>({
    value: settings,
    serialize: (v) =>
      JSON.stringify([v.name.trim(), v.description.trim(), v.applicableAssets, v.status]),
    save: async (v) => {
      // Never persist an empty name; the form shows the inline reason.
      if (v.name.trim().length === 0) return { success: false, error: "" };
      return updateStrategySettings(strategy.id, {
        name: v.name,
        description: v.description,
        applicableAssets: v.applicableAssets,
        status: v.status,
      });
    },
    onError: (message) => {
      if (message) toast.error(message);
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to Strategy Lab"
            nativeButton={false}
            render={<Link href="/strategy-lab" />}
          >
            <ChevronLeft />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {settings.name || "Untitled strategy"}
            </h1>
            <p className="text-xs text-muted-foreground">Strategy workspace</p>
          </div>
        </div>
        <StrategyStatusBadge status={settings.status} />
      </div>

      <Tabs defaultValue="settings">
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            <TabsTrigger value="settings" className="gap-1.5">
              <Settings2 className="size-3.5" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="performance" className="gap-1.5">
              <LineChart className="size-3.5" />
              Performance
            </TabsTrigger>
            <TabsTrigger value="versions" className="gap-1.5">
              <GitCommitVertical className="size-3.5" />
              Versions
            </TabsTrigger>
            {SECTIONS.map((s) => (
              <TabsTrigger key={s.value} value={s.value} className="gap-1.5">
                <s.icon className="size-3.5" />
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="settings" className="mt-4 space-y-4">
          <StrategySettingsForm value={settings} onChange={setSettings} saveState={saveState} />
          <div className="glass space-y-2 rounded-2xl p-4">
            <h3 className="text-sm font-medium text-muted-foreground">Documentation images</h3>
            <p className="text-xs text-muted-foreground/60">
              Screenshots and diagrams that document this strategy — models, examples, references.
            </p>
            <ImageAttachments ownerType="STRATEGY" ownerId={strategy.id} max={12} />
          </div>
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          <StrategyPerformanceSection performance={performance} />
        </TabsContent>

        <TabsContent value="versions" className="mt-4">
          <StrategyVersionsSection
            strategyId={strategy.id}
            currentVersion={strategy.version}
            initialVersions={versions}
          />
        </TabsContent>

        <TabsContent value="arsenal" className="mt-4">
          <ArsenalSection strategyId={strategy.id} initialConcepts={arsenalConcepts} />
        </TabsContent>

        <TabsContent value="framework" className="mt-4">
          <FrameworkSection strategyId={strategy.id} initialSteps={frameworkSteps} />
        </TabsContent>

        <TabsContent value="timeframes" className="mt-4">
          <TimeframesSection strategyId={strategy.id} initialTimeframes={timeframes} />
        </TabsContent>

        <TabsContent value="entry-models" className="mt-4">
          <EntryModelsSection strategyId={strategy.id} initialModels={entryModels} />
        </TabsContent>

        <TabsContent value="trade-management" className="mt-4">
          <TradeManagementSection
            strategyId={strategy.id}
            tradeManagement={tradeManagement}
            liveExpectancy={liveExpectancy}
          />
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <StrategySessionsSection strategyId={strategy.id} initialSessions={sessions} />
        </TabsContent>
        <TabsContent value="confluences" className="mt-4">
          <StrategyChecklistSection strategyId={strategy.id} kind="CONFLUENCE" initialItems={confluences} />
        </TabsContent>
        <TabsContent value="execution" className="mt-4">
          <StrategyChecklistSection strategyId={strategy.id} kind="EXECUTION" initialItems={execution} />
        </TabsContent>
        <TabsContent value="setup-types" className="mt-4">
          <SetupTypesSection
            strategyId={strategy.id}
            initialSetupTypes={setupTypes}
            availableConditions={[...confluences, ...execution]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
