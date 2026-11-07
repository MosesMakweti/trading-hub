"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GoalFormDialog } from "@/components/goals/goal-form-dialog";

export function NewGoalButton({ todayKey, label = "Set a goal", size = "default" }: { todayKey: string; label?: string; size?: "default" | "sm" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}>
        <Plus /> {label}
      </Button>
      {open && <GoalFormDialog open={open} onOpenChange={setOpen} todayKey={todayKey} />}
    </>
  );
}
