import type { LucideIcon } from "lucide-react";

import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export function PlanSectionCard({
  value,
  icon: Icon,
  title,
  description,
  children,
}: {
  value: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <AccordionItem value={value} className="glass mb-3 rounded-2xl border-0 px-4">
      <AccordionTrigger className="py-4 hover:no-underline">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4.5" />
          </div>
          <div>
            <div className="font-semibold">{title}</div>
            {description && (
              <div className="text-xs font-normal text-muted-foreground">{description}</div>
            )}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-5">{children}</AccordionContent>
    </AccordionItem>
  );
}
