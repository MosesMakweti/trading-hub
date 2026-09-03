import { describe, expect, it } from "vitest";

import { detectFileFormat } from "./detect-format";
import { SourceReadError } from "./types";

const bytes = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));

describe("detectFileFormat — content signature wins over extension / MIME", () => {
  it("detects CSV from a comma-delimited first line", () => {
    expect(detectFileFormat(bytes("a,b,c\n1,2,3\n"), "x.csv", "text/csv").format).toBe("CSV");
  });

  it("detects TSV from tabs even when the extension says .csv", () => {
    const d = detectFileFormat(bytes("a\tb\tc\n1\t2\t3\n"), "trades.csv", "text/csv");
    expect(d.format).toBe("TSV");
    expect(d.delimiter).toBe("\t");
  });

  it("treats a semicolon export as CSV with a ; delimiter", () => {
    const d = detectFileFormat(bytes("a;b;c\n1;2;3\n"), "x.csv", "");
    expect(d.format).toBe("CSV");
    expect(d.delimiter).toBe(";");
  });

  it("detects HTML when an MT4 statement is saved as .xls", () => {
    const html = "<html><head></head><body><table><tr><td>Ticket</td></tr></table></body></html>";
    expect(detectFileFormat(bytes(html), "Statement.xls", "application/vnd.ms-excel").format).toBe("HTML");
  });

  it("detects HTML from a leading <table> with no doctype", () => {
    expect(detectFileFormat(bytes("<table><tr><td>x</td></tr></table>"), "t.htm", "").format).toBe("HTML");
  });

  it("detects XML from the prolog", () => {
    expect(detectFileFormat(bytes('<?xml version="1.0"?><Statement><Deal/></Statement>'), "s.xml", "").format).toBe(
      "XML",
    );
  });

  it("keeps an XHTML document with an xml prolog as HTML", () => {
    const xhtml = '<?xml version="1.0"?><html><body><table><tr><td>a</td></tr></table></body></html>';
    expect(detectFileFormat(bytes(xhtml), "r.html", "").format).toBe("HTML");
  });

  it("detects XLSX from the ZIP signature regardless of a generic MIME", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    expect(detectFileFormat(zip, "book.xlsx", "application/octet-stream").format).toBe("XLSX");
  });

  it("detects legacy XLS from the OLE2 signature", () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
    expect(detectFileFormat(ole, "old.xls", "").format).toBe("XLS");
  });

  it("honours a .txt extension for plain delimited text", () => {
    expect(detectFileFormat(bytes("a,b\n1,2\n"), "broker.txt", "text/plain").format).toBe("TXT");
  });

  it("falls back to CSV when there is no extension, no MIME, and the content is delimited", () => {
    expect(detectFileFormat(bytes("a,b\n1,2\n"), "download", "").format).toBe("CSV");
  });

  it("rejects a PDF with 'Unsupported file format.'", () => {
    expect(() => detectFileFormat(bytes("%PDF-1.7\n..."), "statement.pdf", "application/pdf")).toThrow(SourceReadError);
    expect(() => detectFileFormat(bytes("%PDF-1.7\n..."), "s.pdf", "")).toThrow("Unsupported file format.");
  });

  it("rejects a PNG even if it is named .csv", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => detectFileFormat(png, "chart.csv", "text/csv")).toThrow("Unsupported file format.");
  });
});
