import { FileDown, FileJson, FileSpreadsheet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ImportTradesForm } from "@/components/settings/import-trades-form";

export default function DataSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data</h1>
        <p className="text-sm text-muted-foreground">Export your trade history, or restore it from a backup.</p>
      </div>

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Export</h2>
        <p className="text-xs text-muted-foreground">
          JSON is a full backup that can be re-imported below. CSV and Excel are flattened
          summaries meant for external analysis, not re-import.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-1.5" nativeButton={false} render={<a href="/api/export/trades?format=json" />}>
            <FileJson className="size-3.5" />
            Export JSON
          </Button>
          <Button variant="outline" className="gap-1.5" nativeButton={false} render={<a href="/api/export/trades?format=csv" />}>
            <FileDown className="size-3.5" />
            Export CSV
          </Button>
          <Button variant="outline" className="gap-1.5" nativeButton={false} render={<a href="/api/export/trades?format=xlsx" />}>
            <FileSpreadsheet className="size-3.5" />
            Export Excel
          </Button>
        </div>
      </section>

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Import</h2>
        <p className="text-xs text-muted-foreground">
          Upload a JSON export from tradeOS. Trades matching an existing date/asset/time are
          skipped automatically, so re-importing the same file never creates duplicates.
        </p>
        <ImportTradesForm />
      </section>
    </div>
  );
}
