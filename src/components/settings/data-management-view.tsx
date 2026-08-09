"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3,
  BookOpenCheck,
  Brain,
  CalendarClock,
  Landmark,
  Layers,
  ListChecks,
  StickyNote,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TypeToConfirmDialog } from "@/components/settings/type-to-confirm-dialog";
import {
  deleteDataSectionAction,
  resetAllDataAction,
} from "@/actions/data-management.actions";
import type { DataCounts, DataSection } from "@/server/services/data-management.service";

interface SectionMeta {
  key: DataSection;
  icon: LucideIcon;
  title: string;
  description: string;
  detail: ReactNode; // shown in the confirm dialog
  count: (c: DataCounts) => number;
  noun: string;
}

const SECTIONS: SectionMeta[] = [
  {
    key: "journal-trades",
    icon: BookOpenCheck,
    title: "Journal & Trades",
    description:
      "Every logged trade — entries, execution, psychology, and before/after screenshots.",
    detail: (
      <>
        <p>This permanently deletes every logged trade, including its execution details, psychology questionnaire, and before/after images — plus any spotted trade opportunities (executed &amp; missed).</p>
        <p>Your equity curve, P&amp;L, win rate, discrepancy gap, edge capture, and strategy adherence will reset automatically — they are calculated from these trades.</p>
      </>
    ),
    count: (c) => c.trades,
    noun: "trades",
  },
  {
    key: "today-plans",
    icon: CalendarClock,
    title: "Today & Trade Plans",
    description:
      "Daily Today sessions — pre-market plans, bias, key levels, prep/plan/analyze progress — and weekly reviews.",
    detail: (
      <p>This permanently deletes all of your Today sessions (plans, bias, key levels, workflow progress) and weekly reviews. Your logged trades are kept.</p>
    ),
    count: (c) => c.tradingDays,
    noun: "days",
  },
  {
    key: "strategies",
    icon: Layers,
    title: "Strategies",
    description:
      "Everything in Strategy Lab — frameworks, entry models, confluences, sessions, arsenal, rules, and images.",
    detail: (
      <>
        <p>This permanently deletes every strategy and all of its Strategy Lab data — framework steps, timeframes, entry models, confluences, execution confirmations, sessions, arsenal concepts, trade-management rules, versions, and images.</p>
        <p>Past trades keep their frozen strategy snapshot for historical accuracy.</p>
      </>
    ),
    count: (c) => c.strategies,
    noun: "strategies",
  },
  {
    key: "psychology",
    icon: Brain,
    title: "Psychology",
    description: "All post-trade psychology questionnaires and grades. The trades themselves are kept.",
    detail: (
      <p>This permanently deletes every post-trade psychology questionnaire and grade. The trades themselves are kept — only their psychology data is removed.</p>
    ),
    count: (c) => c.psychology,
    noun: "responses",
  },
  {
    key: "accounts",
    icon: Landmark,
    title: "Accounts & Prop Firms",
    description:
      "Every prop-firm and brokerage account you added. The internal Performance Account is preserved.",
    detail: (
      <p>This permanently deletes all of your prop-firm and brokerage accounts and their per-account risk history. The internal Performance Account — your analytics ledger — is preserved.</p>
    ),
    count: (c) => c.accounts,
    noun: "accounts",
  },
  {
    key: "routine",
    icon: ListChecks,
    title: "Pre-Session Routine",
    description: "Your custom pre-session routine — all sections and checklist items.",
    detail: <p>This permanently deletes your entire pre-session routine — every section and checklist item you built.</p>,
    count: (c) => c.routineSections,
    noun: "sections",
  },
  {
    key: "notes",
    icon: StickyNote,
    title: "Notes & Intraday Notes",
    description: "Your daily / intraday notes and any images attached to them.",
    detail: <p>This permanently deletes all of your daily and intraday notes, along with any images attached to them.</p>,
    count: (c) => c.notes,
    noun: "notes",
  },
];

export function DataManagementView({ counts }: { counts: DataCounts }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeSection, setActiveSection] = useState<SectionMeta | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  function runDeleteSection(section: SectionMeta) {
    startTransition(async () => {
      const result = await deleteDataSectionAction(section.key);
      if (result.success) {
        setActiveSection(null);
        toast.success(`${section.title} deleted.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function runReset() {
    startTransition(async () => {
      const result = await resetAllDataAction();
      if (result.success) {
        setResetOpen(false);
        toast.success("TradeOS has been reset. Welcome to a fresh workspace.");
        router.push("/dashboard");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Data Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Control and permanently remove your TradeOS data. Every action here affects only your own
          account and cannot be undone.
        </p>
      </div>

      {/* Section-by-section deletion */}
      <div className="glass divide-y divide-border overflow-hidden rounded-2xl">
        {SECTIONS.map((section) => {
          const count = section.count(counts);
          return (
            <div key={section.key} className="flex items-center gap-4 px-5 py-4">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/40 text-muted-foreground">
                <section.icon className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{section.title}</span>
                  <span className="text-xs text-muted-foreground/70 tabular-nums">
                    {count} {section.noun}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{section.description}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-danger/30 text-danger hover:bg-danger/10 hover:text-danger"
                disabled={pending || count === 0}
                onClick={() => setActiveSection(section)}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </div>
          );
        })}
      </div>

      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground/70">
        <BarChart3 className="size-3.5 shrink-0" />
        Analytics (equity curve, P&amp;L, win rate, discrepancy gap, adherence) are calculated live
        from your trades — they reset on their own when you clear Journal &amp; Trades.
      </p>

      {/* Danger zone */}
      <div className="rounded-2xl border border-danger/30 bg-danger/[0.04] p-5">
        <div className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-danger" />
          <h2 className="text-sm font-semibold text-danger">Danger Zone</h2>
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium">Reset TradeOS</div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Delete all trader-created data and start with a completely fresh workspace. Your
              account, login, and profile are kept.
            </p>
          </div>
          <Button
            variant="destructive"
            className="shrink-0"
            disabled={pending}
            onClick={() => setResetOpen(true)}
          >
            <Trash2 className="size-3.5" />
            Reset TradeOS
          </Button>
        </div>
      </div>

      {/* Section confirm (type DELETE) — keyed so the typed phrase resets per section */}
      <TypeToConfirmDialog
        key={activeSection?.key ?? "section-closed"}
        open={activeSection != null}
        onOpenChange={(open) => !open && setActiveSection(null)}
        title={`Delete ${activeSection?.title ?? ""}?`}
        description={activeSection?.detail}
        phrase="DELETE"
        confirmLabel={`Delete ${activeSection?.title ?? ""}`}
        isPending={pending}
        onConfirm={() => activeSection && runDeleteSection(activeSection)}
      />

      {/* Full reset (type RESET TRADEOS) — keyed so the typed phrase resets on reopen */}
      <TypeToConfirmDialog
        key={resetOpen ? "reset-open" : "reset-closed"}
        open={resetOpen}
        onOpenChange={(open) => !open && setResetOpen(false)}
        title="Reset all TradeOS data?"
        description={
          <>
            <p>This permanently deletes <span className="font-medium text-foreground">everything you have created</span>:</p>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>All trades, journal entries, and psychology</li>
              <li>Today sessions, trade plans, and weekly reviews</li>
              <li>All strategies and Strategy Lab data</li>
              <li>Prop-firm &amp; brokerage accounts</li>
              <li>Pre-session routine and notes</li>
              <li>All uploaded images</li>
            </ul>
            <p>
              Your <span className="font-medium text-foreground">account, login, and profile</span>{" "}
              are preserved, and a fresh Performance Account is created. All analytics reset to zero.
            </p>
          </>
        }
        phrase="RESET TRADEOS"
        confirmLabel="Reset TradeOS"
        isPending={pending}
        onConfirm={runReset}
      />
    </div>
  );
}
