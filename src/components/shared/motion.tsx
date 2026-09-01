"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";

/**
 * Shared entrance animations. All respect `prefers-reduced-motion`: when the
 * viewer opts out, content renders at its final state with no transform/stagger.
 */
export function FadeIn({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  // `initial` must stay identical between server and client renders — SSR
  // can't know the viewer's motion preference, so it always renders the
  // "hidden" values. Toggling `initial={false}` once the client learns
  // `reduce=true` makes framer-motion trust the (still-hidden) SSR markup as
  // already-settled and never animate it in, leaving the page permanently
  // blank for reduced-motion viewers. Keep `initial`/`animate` constant and
  // collapse the *duration* instead, so the element still always reaches its
  // visible end state — just instantly when motion is reduced.
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const listVariants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.05 } },
  };
  // See FadeIn's comment — `initial` must not depend on `reduce` (SSR always
  // renders "hidden"); collapse timing via `staggerChildren`/child duration
  // instead so the list still animates in, just instantly.
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={listVariants}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: reduce ? 0 : 0.2, ease: "easeOut" } },
  };
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}
