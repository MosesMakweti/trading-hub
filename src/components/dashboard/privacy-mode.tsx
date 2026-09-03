"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";

const STORAGE_KEY = "traditorium-privacy-mode";

const PrivacyModeContext = createContext<{ enabled: boolean; toggle: () => void } | null>(null);

/** Wraps the command-center content; toggling adds a `.privacy-mode` class
 *  that blurs every `.money` figure inside it (see globals.css). Scoped to
 *  this subtree only — not a site-wide setting. Persisted per-browser via
 *  localStorage so a refresh doesn't un-blur a shared screen mid-share. */
export function PrivacyModeProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // One-time read from localStorage (an external system unreachable during
    // SSR/the first client render) — no reactive subscription to set up.
    try {
      const stored = localStorage.getItem(STORAGE_KEY) === "1";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEnabled(stored);
    } catch {
      // ignore — private browsing / storage blocked, default off
    }
  }, []);

  function toggle() {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <PrivacyModeContext.Provider value={{ enabled, toggle }}>
      <div className={enabled ? "privacy-mode" : undefined}>{children}</div>
    </PrivacyModeContext.Provider>
  );
}

export function PrivacyModeToggle() {
  const ctx = useContext(PrivacyModeContext);
  if (!ctx) return null;
  const Icon = ctx.enabled ? EyeOff : Eye;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={ctx.enabled ? "Disable privacy mode" : "Enable privacy mode"}
      aria-pressed={ctx.enabled}
      onClick={ctx.toggle}
      className={ctx.enabled ? "border-primary/50 text-primary" : undefined}
    >
      <Icon />
    </Button>
  );
}
