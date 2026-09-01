import { detectFileFormat } from "./detect-format";
import { readDelimited } from "./read-delimited";
import { readHtml } from "./read-html";
import { readXlsx } from "./read-xlsx";
import { readXml } from "./read-xml";
import {
  SOURCE_ERROR,
  SourceReadError,
  type SourceDocument,
  type SourceReadOptions,
  type SourceTable,
} from "./types";

/**
 * The single entry point for the source-reader layer: raw bytes of any
 * supported upload -> a `SourceDocument` of `SourceTable`s the platform
 * adapters consume. Format is decided by content signature (extension/MIME are
 * hints only); every failure surfaces one of the prompt's required error
 * strings.
 */
export async function readSource(bytes: Uint8Array, opts: SourceReadOptions): Promise<SourceDocument> {
  if (bytes.length === 0) throw new SourceReadError(SOURCE_ERROR.MALFORMED);

  const detected = detectFileFormat(bytes, opts.fileName, opts.mimeType);
  const warnings: string[] = [];
  let tables: SourceTable[];

  try {
    switch (detected.format) {
      case "XLSX":
        tables = await readXlsx(bytes, false);
        break;
      case "XLS":
        tables = await readXlsx(bytes, true);
        break;
      case "HTML":
        tables = readHtml(bytes);
        break;
      case "XML":
        tables = readXml(bytes);
        break;
      case "CSV":
      case "TSV":
      case "TXT":
        tables = [readDelimited(bytes, { format: detected.format, delimiter: detected.delimiter })];
        break;
      default:
        throw new SourceReadError(SOURCE_ERROR.UNSUPPORTED);
    }
  } catch (err) {
    if (err instanceof SourceReadError) throw err;
    throw new SourceReadError(SOURCE_ERROR.MALFORMED);
  }

  if (tables.length === 0) {
    throw new SourceReadError(detected.format === "XLSX" || detected.format === "XLS" ? SOURCE_ERROR.NO_USABLE_SHEETS : SOURCE_ERROR.NO_TRADING_TABLE);
  }

  if (tables.length > opts.maxTables) {
    warnings.push(`File has ${tables.length} tables; only the first ${opts.maxTables} are available.`);
    tables = tables.slice(0, opts.maxTables);
  }

  return { format: detected.format, mimeType: opts.mimeType, tables, warnings };
}
