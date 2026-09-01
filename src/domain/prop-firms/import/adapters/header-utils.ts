function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Builds a lookup from a fixed field -> row-value getter, resolving each
 *  field's first matching header out of an ordered alias list. Used by
 *  adapters with a known, fixed export shape (MT4/MT5) rather than a
 *  caller-supplied mapping. */
export function buildHeaderResolver(headers: string[], aliasesByField: Record<string, string[]>) {
  const normalizedToOriginal = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const resolved: Record<string, string | undefined> = {};
  for (const [field, aliases] of Object.entries(aliasesByField)) {
    for (const alias of aliases) {
      const match = normalizedToOriginal.get(normalizeHeader(alias));
      if (match) {
        resolved[field] = match;
        break;
      }
    }
  }
  return {
    get(row: Record<string, string>, field: string): string | undefined {
      const header = resolved[field];
      if (!header) return undefined;
      const value = row[header];
      return value == null ? undefined : value.trim();
    },
    hasField(field: string): boolean {
      return resolved[field] != null;
    },
    matchedFieldCount(): number {
      return Object.keys(resolved).length;
    },
  };
}

export function headerMatchConfidence(headers: string[], aliasesByField: Record<string, string[]>, requiredFields: string[]): number {
  const resolver = buildHeaderResolver(headers, aliasesByField);
  const missingRequired = requiredFields.some((f) => !resolver.hasField(f));
  if (missingRequired) return 0;
  const totalFields = Object.keys(aliasesByField).length;
  return Math.min(1, resolver.matchedFieldCount() / totalFields);
}
