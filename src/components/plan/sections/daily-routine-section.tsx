"use client";

import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { Label } from "@/components/ui/label";
import { updateDailyRoutine } from "@/actions/trading-plan.actions";

interface Plan {
  dailyRoutineMorning: unknown;
  dailyRoutinePreMarket: unknown;
  dailyRoutinePostSession: unknown;
}

export function DailyRoutineSection({ plan }: { plan: Plan }) {
  return (
    <div className="space-y-5">
      <div>
        <Label className="mb-1.5 block text-xs">Morning routine</Label>
        <RichTextEditor
          initialContent={plan.dailyRoutineMorning}
          placeholder="What do you do first thing before the markets open?"
          onSave={(content) =>
            updateDailyRoutine({
              dailyRoutineMorning: content,
              dailyRoutinePreMarket: plan.dailyRoutinePreMarket,
              dailyRoutinePostSession: plan.dailyRoutinePostSession,
            })
          }
        />
      </div>
      <div>
        <Label className="mb-1.5 block text-xs">Pre-market checklist</Label>
        <RichTextEditor
          initialContent={plan.dailyRoutinePreMarket}
          placeholder="What must be checked before the first trade?"
          onSave={(content) =>
            updateDailyRoutine({
              dailyRoutineMorning: plan.dailyRoutineMorning,
              dailyRoutinePreMarket: content,
              dailyRoutinePostSession: plan.dailyRoutinePostSession,
            })
          }
        />
      </div>
      <div>
        <Label className="mb-1.5 block text-xs">Post-session routine</Label>
        <RichTextEditor
          initialContent={plan.dailyRoutinePostSession}
          placeholder="How do you close out and review your session?"
          onSave={(content) =>
            updateDailyRoutine({
              dailyRoutineMorning: plan.dailyRoutineMorning,
              dailyRoutinePreMarket: plan.dailyRoutinePreMarket,
              dailyRoutinePostSession: content,
            })
          }
        />
      </div>
    </div>
  );
}
