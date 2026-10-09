/**
 * Trading Psychology Reset — flow CONTENT (pure, versioned).
 *
 * Wording, options and their behavioural signals live here so they can be
 * revised without touching the workflow. A stored session keeps the
 * `version` it was answered against; change wording in place only when the
 * meaning of every option id stays the same, otherwise add a new version.
 *
 * Signals are what the decision logic (assessment.ts) reads — never the
 * label text. They describe what the trader reported, not a diagnosis.
 */

export type ResetTrigger = "LOSING_TRADE" | "MISSED_OPPORTUNITY";

export type ResetSignal =
  /** Reported breaking one or more trading rules. */
  | "RULE_BREAK"
  /** Not sure whether execution followed the plan. */
  | "EXECUTION_UNSURE"
  /** A missed setup caused by hesitation / failing to execute (an execution issue, not a rule break). */
  | "EXECUTION_ISSUE"
  /** Still struggling to accept the outcome. */
  | "STRUGGLING"
  /** Wants to recover money, chase missed profit or prove themselves right. */
  | "RECOVERY_URGE"
  /** Fear of missing the next move. */
  | "FOMO"
  /** Not sure what they are feeling. */
  | "UNSURE_FEELING"
  /** Recognises they may be reacting to the previous result. */
  | "REACTIVE"
  /** No valid setup exists right now. */
  | "NO_SETUP";

/** How cautious a next action is: 0 continue (rules permitting) · 1 pause · 2 stop for the session. */
export type CautionLevel = 0 | 1 | 2;

export interface ResetOption {
  id: string;
  label: string;
  signals?: ResetSignal[];
  /** Shown once selected — factual guidance for this answer (the branch). */
  feedback?: string;
  /** Opens the optional written reflection with this prompt. */
  reflectionPrompt?: string;
  /** Final step only: how cautious this next action is. */
  caution?: CautionLevel;
}

export interface ResetStep {
  id: string;
  title: string;
  message: string[];
  question: string;
  options: ResetOption[];
}

export interface ResetFlow {
  trigger: ResetTrigger;
  version: number;
  title: string;
  intro: string;
  steps: ResetStep[];
}

const LOSING_TRADE_V1: ResetFlow = {
  trigger: "LOSING_TRADE",
  version: 1,
  title: "Mental Reset",
  intro: "A short, private reflection after a losing trade. One question at a time; your answers are saved as you go.",
  steps: [
    {
      id: "uncertainty",
      title: "Do you understand why this trade could lose?",
      message: [
        "You entered the market because your setup met your criteria. But the market owes you nothing. Even when your analysis is sound, the outcome of an individual trade is uncertain.",
        "A stop-loss is not automatically proof that your analysis was worthless. It is the predefined cost of participating in a market where outcomes cannot be guaranteed.",
        "Every trade is a probability, not a promise.",
      ],
      question: "Looking back at this trade, which statement best describes what happened?",
      options: [
        {
          id: "valid_followed",
          label: "My setup was valid, I followed my plan, and the trade lost.",
          feedback: "Then this loss is the cost of executing your plan. An edge is expressed across many trades, and losing trades are part of it.",
        },
        {
          id: "violated_rules",
          label: "I violated one or more of my trading rules.",
          signals: ["RULE_BREAK"],
          feedback:
            "Then the lesson here is about execution, not about the market. A trade that broke your rules isn't validated or invalidated by its outcome — it is worth reviewing, not recovering.",
          reflectionPrompt: "Which rule, and what led to it? (optional)",
        },
        {
          id: "unsure_execution",
          label: "I'm not yet sure whether my execution followed my plan.",
          signals: ["EXECUTION_UNSURE"],
          feedback: "That is worth checking calmly against your plan in Trade Review before you judge the trade either way.",
          reflectionPrompt: "What are you unsure about? (optional)",
        },
      ],
    },
    {
      id: "probability",
      title: "Was this trade ever guaranteed to win?",
      message: [
        "Your edge is expressed across a series of trades, not guaranteed by any single trade. Even a high-quality setup can lose. A single outcome cannot, by itself, establish whether your strategy has a positive expectancy.",
        "You do not need to make this loss back for the trade to have been worthwhile.",
      ],
      question: "Can you accept this loss as one possible outcome of your strategy without needing to recover the money immediately?",
      options: [
        { id: "accept", label: "Yes. I accept the outcome." },
        {
          id: "struggling",
          label: "I'm still struggling to accept this loss.",
          signals: ["STRUGGLING"],
          feedback: "That is a normal reaction. Giving it time before your next decision is a sensible way to let it settle.",
        },
        {
          id: "compelled_recover",
          label: "I feel compelled to recover the money.",
          signals: ["RECOVERY_URGE"],
          feedback:
            "A strong urge to recover is a signal to step away. Recommended: take a cooldown, or stop for the session, before evaluating anything new.",
        },
      ],
    },
    {
      id: "separate",
      title: "The trade is over. You do not need to repair it.",
      message: [
        "The market has already delivered this trade's outcome. You cannot change it by entering again.",
        "Your next trade is not a refund, a rematch, or an opportunity to prove that you were right.",
        "Your only responsibility is to evaluate the next opportunity on its own merits.",
      ],
      question: "What is driving your desire to take another trade?",
      options: [
        {
          id: "new_setup",
          label: "A new setup that independently meets my trading rules.",
          feedback: "Then evaluate it exactly as you would any other setup — the same rules and the same risk.",
        },
        {
          id: "recover_prove",
          label: "I want to recover money or prove myself right.",
          signals: ["RECOVERY_URGE"],
          feedback: "That is a motive, not a setup. It is a reason to pause before your next decision.",
        },
        {
          id: "fomo",
          label: "I'm afraid of missing the next market move.",
          signals: ["FOMO"],
          feedback: "That pressure is common after a loss. The market will offer other opportunities; a pause costs very little.",
        },
        {
          id: "unsure_feeling",
          label: "I'm not entirely sure what I'm feeling.",
          signals: ["UNSURE_FEELING"],
          feedback: "That is fine. A few minutes away from the screen often makes it clearer.",
          reflectionPrompt: "Anything you notice? (optional)",
        },
      ],
    },
    {
      id: "objectivity",
      title: "Every moment is unique.",
      message: [
        "The last trade does not determine the next trade. A loss does not automatically make the next setup worse, and a win does not automatically make it better.",
        "Assess the current market using your strategy, current evidence, and predefined rules—not the emotional residue of your previous outcome.",
      ],
      question: "If you had not taken the previous trade, would you still consider your next potential setup valid?",
      options: [
        {
          id: "independent",
          label: "Yes. It independently meets my criteria.",
          feedback: "Then it can stand on its own — if it still meets every rule when you check it again.",
        },
        {
          id: "reacting",
          label: "No. I may be reacting to my previous result.",
          signals: ["REACTIVE"],
          feedback: "Noticing that is the point of this step. Let a setup prove itself without the last result attached to it.",
        },
        {
          id: "no_setup",
          label: "There is no valid setup right now.",
          signals: ["NO_SETUP"],
          feedback: "Then waiting is the correct decision right now.",
        },
      ],
    },
    {
      id: "next_action",
      title: "Your next decision is still within your control.",
      message: [
        "You cannot control whether your next trade wins. You can control your risk, your entry criteria, your execution, and whether you follow your plan.",
        "You do not have to trade again today. Protecting your capital and decision-making is more important than recovering a loss in one session.",
      ],
      question: "What is the most appropriate action right now?",
      options: [
        { id: "resume_if_valid", label: "Resume only if a valid setup appears and I am sufficiently calm.", caution: 0 },
        { id: "cooldown", label: "Take a mandatory cooldown before reassessing.", caution: 1 },
        { id: "stop_session", label: "Stop trading for the rest of the session.", caution: 2, feedback: "Stopping for the session is a sound, protective decision." },
      ],
    },
  ],
};

const MISSED_OPPORTUNITY_V1: ResetFlow = {
  trigger: "MISSED_OPPORTUNITY",
  version: 1,
  title: "Mental Reset",
  intro: "A short, private reflection after a missed opportunity. One question at a time; your answers are saved as you go.",
  steps: [
    {
      id: "accept_missed",
      title: "You missed an opportunity. You do not owe the market a trade.",
      message: [
        "A market move that happened without your entry is not money you lost on a trade. You are not entitled to every move simply because you anticipated its direction.",
        "Chasing the move can turn regret about the past into unnecessary risk in the present.",
      ],
      question: "Why did you miss this opportunity?",
      options: [
        {
          id: "criteria_not_met",
          label: "My setup never met the entry criteria.",
          feedback: "Then not trading was the disciplined outcome. There is nothing to recover.",
        },
        {
          id: "hesitated",
          label: "I hesitated or failed to execute a valid setup.",
          signals: ["EXECUTION_ISSUE"],
          feedback: "That is an execution point worth reviewing later, when you are calm — not something to correct with the next trade.",
          reflectionPrompt: "What made you hesitate? (optional)",
        },
        {
          id: "followed_rules",
          label: "I followed my rules, but the move happened without me.",
          feedback: "Then you did your job. Not every move is meant to be yours.",
        },
        {
          id: "unsure",
          label: "I'm not sure.",
          signals: ["EXECUTION_UNSURE"],
          feedback: "You can review it later against your entry criteria. It does not need an answer right now.",
        },
      ],
    },
    {
      id: "release_regret",
      title: "You do not need to catch every move.",
      message: [
        "Profit does not belong to you simply because you correctly anticipated a direction. A trade still requires a valid setup, an executable entry, defined risk, and adherence to your plan.",
        "The market will continue to create opportunities. You are allowed to let this one go.",
      ],
      question: "Why are you considering your next trade?",
      options: [
        {
          id: "fresh_setup",
          label: "A fresh, independently valid setup exists.",
          feedback: "Then judge it on its own merits, with your usual rules and risk.",
        },
        {
          id: "make_up_profit",
          label: "I want to make up for the profit I missed.",
          signals: ["RECOVERY_URGE"],
          feedback: "Chasing missed profit is a reason to pause. Recommended: let the urgency pass before any new decision.",
        },
        {
          id: "afraid_disappear",
          label: "I'm afraid another opportunity will disappear.",
          signals: ["FOMO"],
          feedback: "That urgency is common after a missed move. Waiting for your edge is still a decision.",
        },
      ],
    },
    {
      id: "new_event",
      title: "The next opportunity is a new event.",
      message: [
        "The missed move does not improve the odds of your next setup, and it does not justify lowering your standards.",
        "You do not need to know what happens next. You need to execute your strategy when its conditions are met.",
      ],
      question: "Would you take the next potential trade if you had not just missed that move?",
      options: [
        {
          id: "independent",
          label: "Yes. It independently meets my rules.",
          feedback: "Then it can stand on its own — if it still meets every rule when you check it again.",
        },
        {
          id: "reacting",
          label: "No. I'm reacting to regret or urgency.",
          signals: ["REACTIVE"],
          feedback: "Recognising that is useful. Let the urgency pass before you look again.",
        },
        { id: "no_setup", label: "There is no valid setup right now.", signals: ["NO_SETUP"], feedback: "Then waiting is the correct decision right now." },
      ],
    },
    {
      id: "next_action",
      title: "Patience is part of trading.",
      message: ["You do not have to participate in every market fluctuation. Waiting for your edge is an active trading decision."],
      question: "What should you do now?",
      options: [
        { id: "wait_valid", label: "Wait for my next valid setup.", caution: 0 },
        { id: "take_break", label: "Take a break and let the urgency pass.", caution: 1 },
        { id: "stop_session", label: "Stop trading for the session.", caution: 2, feedback: "Stopping for the session is a sound, protective decision." },
      ],
    },
  ],
};

const FLOWS: readonly ResetFlow[] = [LOSING_TRADE_V1, MISSED_OPPORTUNITY_V1];

/** The version new sessions are created with. */
export function currentFlow(trigger: ResetTrigger): ResetFlow {
  return FLOWS.filter((f) => f.trigger === trigger).reduce((a, b) => (b.version > a.version ? b : a));
}

/** The flow a stored session was answered against (null if unknown). */
export function flowFor(trigger: ResetTrigger, version: number): ResetFlow | null {
  return FLOWS.find((f) => f.trigger === trigger && f.version === version) ?? null;
}

/** The final step is always the next-action choice. */
export function nextActionStep(flow: ResetFlow): ResetStep {
  return flow.steps[flow.steps.length - 1];
}
