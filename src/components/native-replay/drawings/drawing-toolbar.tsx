"use client";

import {
  ArrowRightToLine,
  ArrowUpRight,
  ChartNoAxesGantt,
  Layers,
  Magnet,
  Minus,
  MousePointer2,
  MoveDiagonal2,
  MoveUpRight,
  Redo2,
  Rows3,
  Ruler,
  SeparatorVertical,
  Slash,
  Square,
  Tag,
  TrendingDown,
  TrendingUp,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { TOOLS, type DrawingType } from "@/domain/native-replay/drawings/model";

export const TOOL_ICONS: Record<DrawingType, LucideIcon> = {
  TREND: Slash,
  HLINE: Minus,
  HRAY: ArrowRightToLine,
  VLINE: SeparatorVertical,
  RAY: MoveUpRight,
  EXTENDED: MoveDiagonal2,
  RECT: Square,
  CHANNEL: Rows3,
  TEXT: Type,
  ARROW: ArrowUpRight,
  PRICE_LABEL: Tag,
  RULER: Ruler,
  FIB: ChartNoAxesGantt,
  LONG: TrendingUp,
  SHORT: TrendingDown,
};

const GROUPS: { label: string; tools: DrawingType[] }[] = [
  { label: "Lines", tools: ["TREND", "HLINE", "HRAY", "VLINE", "RAY", "EXTENDED"] },
  { label: "Shapes", tools: ["RECT", "CHANNEL"] },
  { label: "Fibonacci", tools: ["FIB"] },
  { label: "Annotations", tools: ["TEXT", "ARROW", "PRICE_LABEL"] },
  { label: "Measure", tools: ["RULER"] },
];

const tip = (t: DrawingType) => `${TOOLS[t].label}${TOOLS[t].shortcut ? ` (${TOOLS[t].shortcut})` : ""}`;

function RailButton({ active, label, onClick, disabled, children }: { active?: boolean; label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-35",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The replay chart's left tool rail: cursor, drawing tools (grouped in
 * flyouts), the position tools, magnet, the drawing list, undo/redo.
 */
export function DrawingToolbar({
  tool,
  onTool,
  magnet,
  onMagnet,
  readOnly,
  canUndo,
  onUndo,
  onRedo,
  managerOpen,
  onManager,
  drawingCount,
}: {
  tool: DrawingType | null;
  onTool: (tool: DrawingType | null) => void;
  magnet: boolean;
  onMagnet: (on: boolean) => void;
  readOnly: boolean;
  canUndo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  managerOpen: boolean;
  onManager: () => void;
  drawingCount: number;
}) {
  return (
    <nav aria-label="Chart tools" className="flex w-10 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-border py-2 [scrollbar-width:none]">
      <RailButton active={tool == null} label="Cursor (Esc)" onClick={() => onTool(null)}>
        <MousePointer2 className="size-4" />
      </RailButton>
      <span className="my-1 h-px w-5 bg-border" aria-hidden />
      {GROUPS.map((g) => {
        const current = g.tools.includes(tool as DrawingType) ? (tool as DrawingType) : g.tools[0];
        const Icon = TOOL_ICONS[current];
        if (g.tools.length === 1) {
          return (
            <RailButton key={g.label} active={tool === current} label={tip(current)} disabled={readOnly} onClick={() => onTool(tool === current ? null : current)}>
              <Icon className="size-4" />
            </RailButton>
          );
        }
        return (
          <DropdownMenu key={g.label}>
            <DropdownMenuTrigger
              disabled={readOnly}
              render={
                <button
                  type="button"
                  title={g.label}
                  aria-label={`${g.label} tools`}
                  className={cn(
                    "relative inline-flex size-8 items-center justify-center rounded-md disabled:pointer-events-none disabled:opacity-35",
                    g.tools.includes(tool as DrawingType) ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                />
              }
            >
              <Icon className="size-4" />
              <span className="absolute bottom-1 right-1 size-0 border-l-[3px] border-t-[3px] border-l-transparent border-t-current opacity-60" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-52">
              {g.tools.map((t) => {
                const TIcon = TOOL_ICONS[t];
                return (
                  <DropdownMenuItem key={t} onClick={() => onTool(t)}>
                    <TIcon />
                    <span className="flex-1">{TOOLS[t].label}</span>
                    {TOOLS[t].shortcut && <span className="text-[10px] text-muted-foreground">{TOOLS[t].shortcut}</span>}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
      <span className="my-1 h-px w-5 bg-border" aria-hidden />
      {(["LONG", "SHORT"] as const).map((t) => {
        const Icon = TOOL_ICONS[t];
        return (
          <RailButton key={t} active={tool === t} label={tip(t)} disabled={readOnly} onClick={() => onTool(tool === t ? null : t)}>
            <Icon className={cn("size-4", t === "LONG" ? "text-emerald-500/80" : "text-red-400/80")} />
          </RailButton>
        );
      })}
      <span className="my-1 h-px w-5 bg-border" aria-hidden />
      <RailButton active={magnet} label="Magnet: snap anchors to candle open/high/low/close" onClick={() => onMagnet(!magnet)}>
        <Magnet className="size-4" />
      </RailButton>
      <RailButton active={managerOpen} label={`Drawings (${drawingCount})`} onClick={onManager}>
        <Layers className="size-4" />
      </RailButton>
      <span className="my-1 h-px w-5 bg-border" aria-hidden />
      <RailButton label="Undo drawing edit (Ctrl/⌘+Z)" disabled={readOnly || !canUndo} onClick={onUndo}>
        <Undo2 className="size-4" />
      </RailButton>
      <RailButton label="Redo drawing edit (Ctrl/⌘+Shift+Z)" disabled={readOnly} onClick={onRedo}>
        <Redo2 className="size-4" />
      </RailButton>
    </nav>
  );
}
