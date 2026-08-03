/**
 * Pure search for the Pattern Library. Matches a free-text query against a
 * pattern's name, its strategy's name, and its text previews — case-insensitive,
 * every whitespace-separated term must match somewhere (AND semantics). Kept
 * framework-free and unit-tested; the page filters client-side with this.
 */
export interface PatternSearchable {
  name: string;
  strategyName: string;
  descriptionPreview: string;
  conditionsPreview: string;
}

export function filterPatterns<T extends PatternSearchable>(patterns: T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return patterns;

  return patterns.filter((p) => {
    const haystack = `${p.name} ${p.strategyName} ${p.descriptionPreview} ${p.conditionsPreview}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
