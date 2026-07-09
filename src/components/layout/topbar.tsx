"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { Database, LogOut, Search, Settings } from "lucide-react";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initialsFrom(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "?";
  return source.slice(0, 1).toUpperCase();
}

export function Topbar({
  user,
}: {
  user: { name?: string | null; email?: string | null };
}) {
  return (
    <header className="glass sticky top-0 z-10 flex h-14 items-center gap-2 rounded-none border-x-0 border-t-0 px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5" />

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("open-command-search"))}
        className="group flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-border bg-background/50 px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:border-ring/40 hover:text-foreground"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="pointer-events-none hidden items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
          ⌘K
        </kbd>
      </button>

      <div className="flex-1" />

      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className="gap-2 px-2" />}>
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">
              {initialsFrom(user.name, user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm sm:inline">{user.name ?? user.email}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/settings/plan" />}>
            <Settings />
            Trading Plan settings
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/settings/data" />}>
            <Database />
            Export / Import data
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
