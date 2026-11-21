/** Mindset — which mantras a session uses (pure). */

export interface SelectableMantra {
  id: string;
  category: string;
  enabled: boolean;
  sortOrder: number;
}

/**
 * Individual picks win; otherwise whole categories; otherwise every enabled
 * mantra. Disabled mantras are never shown. Library order is kept.
 */
export function selectSessionMantras<T extends SelectableMantra>(library: T[], selection: { mantraIds: string[]; categories: string[] }): T[] {
  const enabled = library.filter((m) => m.enabled).sort((a, b) => a.sortOrder - b.sortOrder);
  if (selection.mantraIds.length > 0) {
    const ids = new Set(selection.mantraIds);
    return enabled.filter((m) => ids.has(m.id));
  }
  if (selection.categories.length > 0) {
    const cats = new Set(selection.categories);
    return enabled.filter((m) => cats.has(m.category));
  }
  return enabled;
}
