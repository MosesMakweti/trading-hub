import { cn } from "@/lib/utils";

/**
 * Company mark: the real logo when one is set (`logoUrl` — never hotlinked,
 * only a locally-hosted/licensed asset ever lands there), otherwise a
 * generated initials placeholder so every firm still reads as a distinct
 * brand in the directory/firm list before real assets are added.
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
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={`${name} logo`}
        className={cn("size-9 shrink-0 rounded-lg object-contain", className)}
      />
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
