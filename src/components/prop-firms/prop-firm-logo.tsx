import { cn } from "@/lib/utils";

/**
 * Company mark: the real logo when one is set (`logoUrl` — a locally-hosted
 * copy of the firm's own official asset under public/prop-firm-logos/, never
 * a live third-party hotlink), otherwise a generated initials placeholder so
 * every firm still reads as a distinct brand before a real asset is added.
 *
 * Real-world brand marks assume a white/light backdrop (most are dark-on-
 * transparent, some are white-on-transparent) and this app is dark-by-
 * default, so the image sits on a fixed light chip regardless of the
 * active theme — otherwise half these logos would vanish in dark mode.
 */
export function PropFirmLogo({
  name,
  logoUrl,
  accentColor,
  className,
}: {
  name: string;
  logoUrl?: string | null;
  accentColor?: string | null;
  className?: string;
}) {
  if (logoUrl) {
    return (
      <div className={cn("flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={`${name} logo`} className="size-full object-contain" />
      </div>
    );
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground",
        className,
      )}
      style={accentColor ? { color: accentColor, backgroundColor: `${accentColor}1a` } : undefined}
    >
      {initials || "?"}
    </div>
  );
}
