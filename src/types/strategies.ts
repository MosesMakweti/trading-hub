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
