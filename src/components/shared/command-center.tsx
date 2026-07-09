"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { globalSearch, type SearchResult } from "@/actions/search.actions";

const SHORTCUTS = [
  { keys: "Ctrl/⌘ + K", description: "Open global search" },
  { keys: "?", description: "Show this shortcuts reference" },
  { keys: "Esc", description: "Close any open dialog" },
];

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

export function CommandCenter() {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [, startTransition] = useTransition();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
        return;
      }
      if (e.key === "?" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setHelpOpen((o) => !o);
      }
    }
    function onOpenSearch() {
      setSearchOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("open-command-search", onOpenSearch);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-command-search", onOpenSearch);
    };
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const timeout = setTimeout(() => {
      startTransition(async () => {
        setResults(await globalSearch(query));
      });
    }, 200);
    return () => clearTimeout(timeout);
  }, [query, searchOpen]);

  function select(href: string) {
    setSearchOpen(false);
    setQuery("");
    router.push(href);
  }

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      <CommandDialog open={searchOpen} onOpenChange={setSearchOpen}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search trades, accounts, assets, entry models..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {query && results.length === 0 && <CommandEmpty>No results found.</CommandEmpty>}
            {Object.entries(grouped).map(([category, items]) => (
              <CommandGroup key={category} heading={category}>
                {items.map((item, i) => (
                  <CommandItem key={`${category}-${i}`} onSelect={() => select(item.href)}>
                    <span>{item.label}</span>
                    {item.sublabel && (
                      <span className="ml-auto text-xs text-muted-foreground">{item.sublabel}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Quick reference for navigating Trading Hub.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{s.description}</span>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
