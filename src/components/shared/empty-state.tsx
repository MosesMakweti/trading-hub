import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="glass flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-16 text-center">
      <Icon className="size-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
