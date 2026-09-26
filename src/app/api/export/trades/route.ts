import { NextResponse } from "next/server";
import Papa from "papaparse";
import ExcelJS from "exceljs";

import { requireUser } from "@/server/guards";
import { listTradeExportRecords } from "@/server/services/export.service";
import { toExportRow } from "@/domain/export/trade-export";
import { getBacktestRun, runInBacktestRun } from "@/server/services/backtest-run.service";
import { runLive } from "@/server/workspace/scope";
import { utcDateToKey } from "@/lib/date";
import type { BacktestRun } from "@prisma/client";

/**
 * Trade export. Default: LIVE trades only (no scope = LIVE). `?runId=` exports
 * exactly one Backtest Run the user owns (404 otherwise) — its simulated trades
 * on their historical dates, with run metadata in the JSON form so the data's
 * provenance is never ambiguous.
 */
export async function GET(request: Request) {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "json";
  const runId = searchParams.get("runId");

  let records: Awaited<ReturnType<typeof listTradeExportRecords>>;
  let run: BacktestRun | null = null;
  if (runId) {
    run = await getBacktestRun(user.id, runId);
    if (!run) return NextResponse.json({ error: "Not found." }, { status: 404 });
    records = await runInBacktestRun(user.id, run.id, () => listTradeExportRecords(user.id));
  } else {
    records = await runLive(() => listTradeExportRecords(user.id));
  }
  const base = run ? `backtest-${run.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "run"}-trades` : "trades-export";

  if (format === "json") {
    const trades = records.map((r) => r.record);
    const body = JSON.stringify(
      run
        ? {
            environment: "BACKTEST",
            run: {
              id: run.id,
              name: run.name,
              strategy: run.strategyNameSnapshot,
              strategyVersion: run.strategyVersionSnapshot,
              assets: run.assets,
              startDate: utcDateToKey(run.startDate),
              endDate: utcDateToKey(run.endDate),
              status: run.status,
            },
            trades,
          }
        : trades,
      null,
      2,
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${base}.json"`,
      },
    });
  }

  const rows = records.map((r) => toExportRow(r.record, r.psychologyGrade));

  if (format === "csv") {
    const csv = Papa.unparse(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
      },
    });
  }

  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Trades");
    if (rows.length > 0) {
      sheet.columns = Object.keys(rows[0]).map((key) => ({ header: key, key, width: 16 }));
      sheet.addRows(rows);
      sheet.getRow(1).font = { bold: true };
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "Invalid format. Use json, csv, or xlsx." }, { status: 400 });
}
