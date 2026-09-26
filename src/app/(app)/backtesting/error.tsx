"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/backtesting/button-link";

/**
 * Backtesting error boundary. Internal details (scope checks, database
 * errors) are never shown — the fail-closed isolation checks stay strict while
 * the trader sees a normal application error. Nothing is written when a
 * request fails this way.
 */
export default function BacktestingError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="glass mx-auto flex max-w-lg flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
      <AlertTriangle className="size-9 text-muted-foreground" aria-hidden />
      <h2 className="text-lg font-semibold">This backtest couldn&apos;t be loaded</h2>
      <p className="text-sm text-muted-foreground">Something went wrong on our side. Nothing was changed. Try again, or go back to your runs.</p>
      <div className="flex gap-2">
        <Button onClick={() => unstable_retry()}>Try again</Button>
        <ButtonLink href="/backtesting" variant="outline">
          All backtest runs
        </ButtonLink>
      </div>
    </div>
  );
}
