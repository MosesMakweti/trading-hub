import type { StrategyStatusValue } from "@/lib/validation/strategies";

/** Serializable strategy shape passed from server components to client components. */
export interface StrategyDTO {
  id: string;
  name: string;
  description: string | null;
  applicableAssets: string[];
  status: StrategyStatusValue;
  version: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** Section 1 — Arsenal. Rich-text fields are Tiptap JSON documents (or null). */
export interface ArsenalConceptDTO {
  id: string;
  name: string;
  definition: unknown;
  purpose: unknown;
  howIIdentify: unknown;
  whyItMatters: unknown;
  whenIUse: unknown;
  whenIIgnore: unknown;
  examples: unknown;
  personalNotes: unknown;
}

/** Section 2 — Framework. An ordered decision step; description/notes are Tiptap JSON. */
export interface FrameworkStepDTO {
  id: string;
  title: string;
  description: unknown;
  notes: unknown;
}
