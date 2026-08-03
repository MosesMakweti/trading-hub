"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Boxes,
  ChevronLeft,
  Clock,
  Crosshair,
  GitCommitVertical,
  LineChart,
  ListOrdered,
  Settings2,
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
import { TradeManagementSection } from "@/components/strategy-lab/trade-management-section";
import { StrategyPerformanceSection } from "@/components/strategy-lab/strategy-performance-section";
import { StrategyVersionsSection } from "@/components/strategy-lab/strategy-versions-section";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import { updateStrategySettings } from "@/actions/strategies.actions";
import type { StrategyPerformanceSummary } from "@/domain/performance/strategy-performance";
import type {
  ArsenalConceptDTO,
  EntryModelDTO,
  FrameworkStepDTO,
  StrategyDTO,
  StrategyVersionDTO,
  TimeframeDTO,
  TradeManagementDTO,
} from "@/types/strategies";

// Section tabs. Settings is live in Phase 1; the rest are documented placeholders
// whose phase components slot straight into these panels (see STRATEGY_LAB.md).
const SECTIONS = [
  {
    value: "arsenal",
    label: "Arsenal",
    icon: Boxes,
    phase: "Phase 2",
    description:
      "Your toolbox of concepts — Fair Value Gaps, Liquidity, Order Blocks, and anything else this strategy relies on.",
    plannedFeatures: [
      "Unlimited expandable concept cards",
      "Definition, purpose, how I identify it, why it matters, when I use / ignore it",
      "Rich-text fields, example charts, and images per concept",
    ],
  },
  {
    value: "framework",
    label: "Framework",
    icon: ListOrdered,
    phase: "Phase 3",
    description: "Your decision process as an ordered, drag-and-drop sequence of steps.",
    plannedFeatures: [
      "Unlimited sequential steps (Determine HTF bias → … → Manage position)",
      "Title, description, and optional notes per step",
      "Drag-and-drop reordering",
    ],
  },
  {
    value: "timeframes",
    label: "Timeframes",
    icon: Clock,
    phase: "Phase 4",
    description: "What you look for on each timeframe, from Monthly down to M1.",
    plannedFeatures: [
      "Unlimited timeframe workspaces",
      "Unlimited checkpoints per timeframe",
      "Title, description, notes, and optional images per checkpoint",
    ],
  },
  {
    value: "entry-models",
    label: "Entry Models",
    icon: Crosshair,
    phase: "Phase 5",
    description: "The specific ways you enter — each with its own conditions and rules.",
    plannedFeatures: [
      "Unlimited entry models",
      "Conditions, confirmation checklist, invalidation, stop placement, target logic",
      "Example images and notes",
    ],
  },
  {
    value: "trade-management",
    label: "Trade Management",
    icon: SlidersHorizontal,
    phase: "Phase 6",
    description: "How you manage a position after entry.",
    plannedFeatures: [
      "TP philosophy, stop / break-even / trailing / scaling rules, max hold & risk",
      "Unlimited partial take-profit levels (trigger, % to close, reason)",
      "Unlimited custom rules",
    ],
  },
] as const;

export function StrategyWorkspace({
  strategy,
  arsenalConcepts,
  frameworkSteps,
  timeframes,
  entryModels,
  tradeManagement,
  performance,
  versions,
}: {
  strategy: StrategyDTO;
  arsenalConcepts: ArsenalConceptDTO[];
  frameworkSteps: FrameworkStepDTO[];
  timeframes: TimeframeDTO[];
  entryModels: EntryModelDTO[];
  tradeManagement: TradeManagementDTO;
  performance: StrategyPerformanceSummary;
  versions: StrategyVersionDTO[];
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

        <TabsContent value="settings" className="mt-4">
          <StrategySettingsForm value={settings} onChange={setSettings} saveState={saveState} />
        </TabsContent>

        {/* Per-strategy performance (Future integration: analytics by strategy). */}
        <TabsContent value="performance" className="mt-4">
          <StrategyPerformanceSection performance={performance} />
        </TabsContent>

        {/* Version history (Future integration: strategy version snapshots). */}
        <TabsContent value="versions" className="mt-4">
          <StrategyVersionsSection
            strategyId={strategy.id}
            currentVersion={strategy.version}
            initialVersions={versions}
          />
        </TabsContent>

        {/* Section 1 — Arsenal is live (Phase 2). */}
        <TabsContent value="arsenal" className="mt-4">
          <ArsenalSection strategyId={strategy.id} initialConcepts={arsenalConcepts} />
        </TabsContent>

        {/* Section 2 — Framework is live (Phase 3). */}
        <TabsContent value="framework" className="mt-4">
          <FrameworkSection strategyId={strategy.id} initialSteps={frameworkSteps} />
        </TabsContent>

        {/* Section 3 — Timeframe workspace is live (Phase 4). */}
        <TabsContent value="timeframes" className="mt-4">
          <TimeframesSection strategyId={strategy.id} initialTimeframes={timeframes} />
        </TabsContent>

        {/* Section 4 — Entry Models is live (Phase 5). */}
        <TabsContent value="entry-models" className="mt-4">
          <EntryModelsSection strategyId={strategy.id} initialModels={entryModels} />
        </TabsContent>

        {/* Section 5 — Trade Management is live (Phase 6). All sections now live. */}
        <TabsContent value="trade-management" className="mt-4">
          <TradeManagementSection strategyId={strategy.id} tradeManagement={tradeManagement} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
