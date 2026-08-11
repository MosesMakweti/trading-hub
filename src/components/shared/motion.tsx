import { cn } from "@/lib/utils";

/**
 * Shared entrance animations — pure CSS, no client JS.
 *
 * These were previously Framer Motion (`motion/react`) components, which pulled
 * the whole animation runtime into every authenticated route bundle. They are
 * now plain server components backed by CSS keyframes in `globals.css`
 * (`.animate-fade-in`, `.stagger-children` / `.stagger-item`). Behaviour is
 * unchanged: a short fade-up on mount, staggered for lists, and both respect
 * `prefers-reduced-motion` (the keyframes are disabled under that query).
 */
export function FadeIn({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("animate-fade-in", className)}>{children}</div>;
}

export function StaggerList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("stagger-children", className)}>{children}</div>;
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("stagger-item", className)}>{children}</div>;
}
