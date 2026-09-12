"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "section-overview", label: "Overview" },
  { id: "section-performance-curve", label: "Performance" },
  { id: "section-account-equity", label: "Account Equity" },
  { id: "section-discrepancy", label: "Discrepancy" },
  { id: "section-strategy", label: "Strategy" },
  { id: "section-adherence", label: "Adherence" },
  { id: "section-breakdowns", label: "Breakdowns" },
  { id: "section-behavioral", label: "Behavioral" },
  { id: "section-daily", label: "Daily" },
  { id: "section-opportunity", label: "Opportunity" },
] as const;

/**
 * A sticky jump-nav for the (long) Analytics page — click scrolls to the
 * section, and the active chip tracks scroll position via IntersectionObserver
 * (no new dependency, native browser API). Only rendered once the trade
 * sections actually exist (see analytics-module.tsx's empty-state branch).
 */
export function SectionNav() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const observing = useRef(false);

  useEffect(() => {
    if (observing.current) return;
    observing.current = true;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );

    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el != null);
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      aria-label="Analytics sections"
      className="glass sticky top-2 z-10 -mx-1 flex gap-1 overflow-x-auto rounded-full p-1 text-xs"
    >
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 font-medium whitespace-nowrap transition-colors",
            active === s.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
