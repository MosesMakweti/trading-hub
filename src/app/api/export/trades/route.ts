import { NextResponse } from "next/server";
import Papa from "papaparse";
import ExcelJS from "exceljs";

import { requireUser } from "@/server/guards";
import { listTradeExportRecords } from "@/server/services/export.service";
import { toExportRow } from "@/domain/export/trade-export";

export async function GET(request: Request) {
  const user = await requireUser();
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "json";

  const records = await listTradeExportRecords(user.id);

  if (format === "json") {
    const body = JSON.stringify(
      records.map((r) => r.record),
      null,
      2,
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="trades-export.json"',
      },
    });
  }

  const rows = records.map((r) => toExportRow(r.record, r.psychologyGrade));

  if (format === "csv") {
    const csv = Papa.unparse(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="trades-export.csv"',
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
        "Content-Disposition": 'attachment; filename="trades-export.xlsx"',
      },
    });
  }

  return NextResponse.json({ error: "Invalid format. Use json, csv, or xlsx." }, { status: 400 });
}
