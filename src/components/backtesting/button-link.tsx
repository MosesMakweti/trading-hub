import Link from "next/link";
import type { ComponentProps } from "react";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * Navigation styled as a button, with real link semantics (an `<a>`, so it is
 * announced as a link and supports open-in-new-tab). Backtesting code uses
 * this instead of `<Button render={<Link/>}>`, which renders role="button".
 */
export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/** The disabled counterpart for navigation that has nowhere to go. */
export function DisabledButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof buttonVariants>) {
  return <span aria-disabled="true" className={cn(buttonVariants({ variant, size }), "pointer-events-none opacity-50", className)} {...props} />;
}
