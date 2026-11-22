"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createStudyAction } from "@/actions/simulation-study.actions";

const splitList = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

/** Creates a study of one trading concept, with its first setup variations. */
export function CreateStudyDialog({ trigger = "New study" }: { trigger?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", hypothesis: "", category: "", instruments: "", timeframes: "", setups: "", setupCriteria: "", confirmationCriteria: "", tags: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await createStudyAction({
        name: f.name,
        hypothesis: f.hypothesis,
        category: f.category,
        instruments: splitList(f.instruments),
        timeframes: splitList(f.timeframes).map((t) => t.toUpperCase()),
        setups: splitList(f.setups),
        setupCriteria: f.setupCriteria,
        confirmationCriteria: f.confirmationCriteria,
        tags: splitList(f.tags),
        status: "ACTIVE",
      });
      if (!res.success) return void toast.error(res.error);
      setOpen(false);
      router.push(`/backtesting/lab/studies/${res.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-1.5" />}>
        <Plus className="size-4" /> {trigger}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New study</DialogTitle>
          <DialogDescription>Study one concept — a liquidity sweep, an FVG entry, a session breakout — and record each occurrence while you replay.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="st-name">Name</Label>
            <Input id="st-name" value={f.name} onChange={set("name")} placeholder="London liquidity sweep" required maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-hyp">Hypothesis</Label>
            <Textarea id="st-hyp" value={f.hypothesis} onChange={set("hypothesis")} rows={2} placeholder="A sweep of the Asia low before 10:00 reverses to the session high." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="st-inst">Instruments</Label>
              <Input id="st-inst" value={f.instruments} onChange={set("instruments")} placeholder="EURUSD, GBPUSD" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-tf">Timeframes</Label>
              <Input id="st-tf" value={f.timeframes} onChange={set("timeframes")} placeholder="M5, M15" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-cat">Category</Label>
              <Input id="st-cat" value={f.category} onChange={set("category")} placeholder="Liquidity" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-tags">Tags</Label>
              <Input id="st-tags" value={f.tags} onChange={set("tags")} placeholder="reversal, london" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-setups">Setup variations to compare</Label>
            <Input id="st-setups" value={f.setups} onChange={set("setups")} placeholder="With displacement, Without displacement, FVG retrace entry" />
            <p className="text-xs text-muted-foreground">Comma-separated. You can add more later.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-crit">Setup criteria</Label>
            <Textarea id="st-crit" value={f.setupCriteria} onChange={set("setupCriteria")} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-conf">Confirmation criteria</Label>
            <Textarea id="st-conf" value={f.confirmationCriteria} onChange={set("confirmationCriteria")} rows={2} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !f.name}>Create study</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
