/**
 * Fixed by the product, not user-customizable — deliberately kept in code
 * rather than the database so the scoring algorithm has one canonical,
 * versioned definition.
 */

export type PsychologyPoints = -1 | 0 | 1;

export interface ChoiceQuestion {
  type: "choice";
  key: string;
  prompt: string;
  options: { value: string; label: string; points: PsychologyPoints }[];
}

export interface ScaleQuestion {
  type: "scale";
  key: string;
  prompt: string;
  min: number;
  max: number;
  pointsForValue: (value: number) => PsychologyPoints;
}

export type PsychologyQuestion = ChoiceQuestion | ScaleQuestion;

export const PSYCHOLOGY_QUESTIONS: PsychologyQuestion[] = [
  {
    type: "choice",
    key: "fomo",
    prompt: "Was this trade entered due to FOMO (Fear of Missing Out)?",
    options: [
      { value: "no", label: "No", points: 1 },
      { value: "yes", label: "Yes", points: -1 },
    ],
  },
  {
    type: "choice",
    key: "riskManaged",
    prompt: "Did you manage risk according to your trading plan?",
    options: [
      { value: "yes", label: "Yes", points: 1 },
      { value: "no", label: "No", points: -1 },
    ],
  },
  {
    type: "choice",
    key: "followedExitPlan",
    prompt: "Did you follow your planned exit strategy?",
    options: [
      { value: "yes", label: "Yes", points: 1 },
      { value: "no", label: "No", points: -1 },
    ],
  },
  {
    type: "choice",
    key: "alignedWithBias",
    prompt: "Was this trade aligned with the higher-timeframe trend or bias?",
    options: [
      { value: "yes", label: "Yes", points: 1 },
      { value: "no", label: "No", points: -1 },
    ],
  },
  {
    type: "choice",
    key: "influencedBySomeoneElseProfit",
    prompt: "Was this trade influenced by seeing someone else profit in the same market?",
    options: [
      { value: "no", label: "No", points: 1 },
      { value: "yes", label: "Yes", points: -1 },
    ],
  },
  {
    type: "choice",
    key: "influencedByOnlineOpinion",
    prompt: "Was this trade influenced by another trader's opinion or bias online?",
    options: [
      { value: "no", label: "No", points: 1 },
      { value: "yes", label: "Yes", points: -1 },
    ],
  },
  {
    type: "choice",
    key: "outcomeWillInfluenceNext",
    prompt: "Will the outcome of this trade influence your next trade?",
    options: [
      { value: "no", label: "No", points: 1 },
      { value: "yes", label: "Yes", points: -1 },
      { value: "maybe", label: "Maybe", points: -1 },
    ],
  },
  {
    type: "scale",
    key: "monitoringObsession",
    prompt: "On a scale of 1-100, how obsessed were you with monitoring this trade's progress?",
    min: 1,
    max: 100,
    pointsForValue: (v) => (v <= 25 ? 1 : v <= 50 ? 0 : -1),
  },
];
