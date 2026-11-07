import { cn } from "@/lib/utils";
import { AchievementIcon } from "@/components/achievements/achievement-icon";

/**
 * An achievement emblem. The tier is carried by FORM, not colour (the
 * interface is monochrome): level 1 a single ring, level 2 a double ring,
 * level 3 a faceted seal with the amber accent the app already uses for
 * milestones. Locked badges keep their icon, faded, inside a dashed
 * outline — so each one still says what it is for.
 */
export function AchievementBadge({
  icon,
  level,
  unlocked = true,
  size = "md",
  className,
}: {
  icon: string;
  level: 1 | 2 | 3;
  unlocked?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const box = { sm: "size-9", md: "size-12", lg: "size-16", xl: "size-24" }[size];
  const glyph = { sm: "size-4", md: "size-5", lg: "size-7", xl: "size-10" }[size];
  const major = level === 3 && unlocked;

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", box, className)}
      role="img"
      aria-hidden
    >
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-full overflow-visible">
        {level === 3 ? (
          // Twelve-point seal.
          <polygon
            points={sealPoints(24, 24, 23, 20.5, 12)}
            className={cn(
              "stroke-[1.5]",
              major ? "fill-warning/12 stroke-warning/70" : unlocked ? "fill-muted stroke-foreground/40" : "fill-transparent stroke-border",
            )}
          />
        ) : (
          <circle
            cx="24"
            cy="24"
            r="22.5"
            className={cn("stroke-[1.5]", unlocked ? "fill-muted stroke-foreground/35" : "fill-transparent stroke-border")}
            strokeDasharray={unlocked ? undefined : "3 3"}
          />
        )}
        {level >= 2 && (
          <circle
            cx="24"
            cy="24"
            r="17"
            className={cn("fill-none stroke-1", major ? "stroke-warning/55" : unlocked ? "stroke-foreground/25" : "stroke-border")}
            strokeDasharray={unlocked ? undefined : "2 3"}
          />
        )}
      </svg>
      <AchievementIcon name={icon} className={cn("relative", glyph, major ? "text-warning" : unlocked ? "text-foreground" : "text-muted-foreground/45")} />
    </span>
  );
}

function sealPoints(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    out.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return out.join(" ");
}
