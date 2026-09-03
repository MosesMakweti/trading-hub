// Pure, framework-free. The default Pre-Session Routine seeded for a user who has
// none yet, and the item-type value union (mirrors the Prisma RoutineItemType enum
// without importing it, keeping the domain layer dependency-free).

export type RoutineItemTypeValue = "CHECKBOX" | "SHORT_TEXT" | "LONG_TEXT";

export const ROUTINE_ITEM_TYPES: readonly RoutineItemTypeValue[] = [
  "CHECKBOX",
  "SHORT_TEXT",
  "LONG_TEXT",
];

export interface DefaultRoutineItem {
  label: string;
  type: RoutineItemTypeValue;
  isMandatory?: boolean;
}

export interface DefaultRoutineSection {
  title: string;
  items: DefaultRoutineItem[];
}

const check = (label: string): DefaultRoutineItem => ({ label, type: "CHECKBOX" });
/** A mandatory checkbox — gates "ready to trade" until ticked. */
const req = (label: string): DefaultRoutineItem => ({ label, type: "CHECKBOX", isMandatory: true });

// A sensible, discipline-reinforcing ritual — the trader edits it freely in
// Settings, including which items are required. The defaults make the genuine
// pre-trade gates mandatory: you shouldn't trade without an HTF read, marked
// levels, and confirmed risk.
export const DEFAULT_ROUTINE: DefaultRoutineSection[] = [
  {
    title: "Personal Readiness",
    items: [
      check("Slept well"),
      check("Feeling focused"),
      check("No emotional distractions"),
      check("Healthy energy levels"),
    ],
  },
  {
    title: "Market Preparation",
    items: [
      check("Economic calendar reviewed"),
      req("HTF analysis completed"),
      req("Key levels marked"),
      check("Watchlist finalized"),
      check("Session volatility understood"),
    ],
  },
  {
    title: "Risk Confirmation",
    items: [
      req("Daily risk confirmed"),
      req("Maximum trades confirmed"),
      check("Account balances checked"),
      check("No rule violations"),
    ],
  },
  {
    title: "Psychological Readiness",
    items: [
      check("Accept today's outcome"),
      check("No revenge mindset"),
      check("Process over profits"),
      check("Will only take A+ setups"),
    ],
  },
];
