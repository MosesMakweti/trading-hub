"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  strategyCreateSchema,
  type StrategyCreateFormValues,
  type StrategyCreateInput,
} from "@/lib/validation/strategies";
import { createStrategy } from "@/actions/strategies.actions";

export function CreateStrategyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<StrategyCreateFormValues, unknown, StrategyCreateInput>({
    resolver: zodResolver(strategyCreateSchema),
    defaultValues: { name: "", description: undefined },
  });

  async function onSubmit(values: StrategyCreateInput) {
    const result = await createStrategy(values);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setOpen(false);
    reset({ name: "", description: undefined });
    toast.success("Strategy created.");
    // Drop straight into the new strategy's workspace.
    router.push(`/strategy-lab/${result.id}`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-1.5" />}>
        <Plus className="size-4" />
        New Strategy
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New strategy</DialogTitle>
          <DialogDescription>
            Give it a name to get started — you can flesh out the rest in the workspace.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="strategy-name" className="text-xs">
              Strategy name
            </Label>
            <Input
              id="strategy-name"
              autoFocus
              placeholder="e.g. ICT London Model"
              {...register("name")}
            />
            {errors.name && <p className="text-xs text-danger">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="strategy-description" className="text-xs">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="strategy-description"
              rows={3}
              placeholder="A short summary of the edge this strategy captures."
              {...register("description")}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create strategy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
