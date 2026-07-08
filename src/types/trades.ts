export interface TradeListItemDTO {
  id: string;
  assetSymbol: string;
  executionMinutes: number;
  direction: "LONG" | "SHORT";
  higherTimeframeBias: "BULLISH" | "BEARISH";
  biasConfidencePercent: number;
  expectedRR: number;
  actualRR: number | null;
  hitTP1: boolean;
  hitTP2: boolean;
  hitTP3: boolean;
  hitFullTP: boolean;
  accounts: {
    name: string;
    riskInputType: "PERCENT" | "AMOUNT";
    riskValue: number;
    closingPnlGross: number;
    closingPnlNet: number;
  }[];
  entryModelNames: string[];
  confluenceLabels: string[];
  executionLabels: string[];
  psychology: {
    rawScore: number;
    percent: number;
    grade: "A" | "B" | "C" | "D" | "F";
  } | null;
}
