import {
  Award,
  CalendarCheck,
  ClipboardCheck,
  Flag,
  Flame,
  Footprints,
  Mountain,
  NotebookPen,
  RefreshCcw,
  ShieldCheck,
  Sunrise,
  Target,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from "lucide-react";

/** Icon names used by the achievement catalogue (domain/achievements) and celebrations. */
const ICONS: Record<string, LucideIcon> = {
  Award,
  CalendarCheck,
  ClipboardCheck,
  Flag,
  Flame,
  Footprints,
  Mountain,
  NotebookPen,
  RefreshCcw,
  ShieldCheck,
  Sunrise,
  Target,
  TrendingUp,
  Trophy,
};

/** Renders a catalogue icon by name (unknown names fall back to a generic award). */
export function AchievementIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Award;
  return <Icon className={className} aria-hidden />;
}
