"use client";

import type { TagColor } from "@prisma/client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TAG_COLORS, TAG_STYLES, TagDot } from "@/components/ui/tag";

const OPTIONS = TAG_COLORS.map((c) => ({ value: c, label: TAG_STYLES[c].label }));

export function ColorPicker({
  value,
  onChange,
}: {
  value: TagColor;
  onChange: (color: TagColor) => void;
}) {
  return (
    <Select items={OPTIONS} value={value} onValueChange={(v) => v && onChange(v as TagColor)}>
      <SelectTrigger className="h-8 w-32 gap-2" aria-label="Tag color">
        <TagDot color={value} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TAG_COLORS.map((c) => (
          <SelectItem key={c} value={c}>
            <span className="flex items-center gap-2">
              <TagDot color={c} />
              {TAG_STYLES[c].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
