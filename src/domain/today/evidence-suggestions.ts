// Today V3 (Phase 1) — "Suggest from strategy" for Directional Evidence. Pure.
//
// The active strategy's CONFLUENCE checklist items that are direction-specific
// become CANDIDATE evidence: "your strategy says this is something you may
// look for", never "this is present on the chart". Callers must insert them
// UNCHECKED; the trader ticks what is actually there. BOTH-direction
// confluences carry no directional information and are never seeded.

export type ConfluenceDirectionApplicability = "BULLISH" | "BEARISH" | "BOTH";

export interface ConfluenceCandidateSource {
  name: string;
  directionApplicability: ConfluenceDirectionApplicability;
}

export interface ExistingEvidence {
  label: string;
  direction: "BULLISH" | "BEARISH";
}

export interface EvidenceCandidate {
  label: string;
  direction: "BULLISH" | "BEARISH";
}

/** Candidates not already on the card (same label + direction, case- and
 *  whitespace-insensitive), deduplicated among themselves, in source order. */
export function buildEvidenceCandidates(
  confluences: ConfluenceCandidateSource[],
  existing: ExistingEvidence[],
): EvidenceCandidate[] {
  const key = (label: string, direction: string) => `${direction}:${label.trim().replace(/\s+/g, " ").toLowerCase()}`;
  const have = new Set(existing.map((e) => key(e.label, e.direction)));
  const out: EvidenceCandidate[] = [];
  for (const c of confluences) {
    if (c.directionApplicability === "BOTH") continue;
    const label = c.name.trim().replace(/\s+/g, " ");
    if (!label) continue;
    const k = key(label, c.directionApplicability);
    if (have.has(k)) continue;
    have.add(k);
    out.push({ label, direction: c.directionApplicability });
  }
  return out;
}
