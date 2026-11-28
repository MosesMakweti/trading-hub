import { Prisma } from "@prisma/client";

/** A failure whose message is written for the trader and safe to show as-is. */
export class StrategyLabError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "CONFLICT" | "DUPLICATE" | "INVALID" = "INVALID",
  ) {
    super(message);
    this.name = "StrategyLabError";
  }
}

function isPrismaError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientInitializationError
  );
}

/**
 * Turns anything a Strategy Lab service throws into a message a trader can
 * read. Service-authored errors ("Strategy not found.") pass through; raw
 * database errors never do — known codes get a plain-language message and
 * everything else falls back to `fallback`. Unexpected errors are logged.
 */
export function toStrategyActionError(error: unknown, fallback: string): string {
  if (error instanceof StrategyLabError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        return "That name is already in use here — choose a different one.";
      case "P2025":
      case "P2003":
        return "That item no longer exists. Refresh the page and try again.";
      case "P2034":
        return "Someone else changed this at the same moment. Refresh and try again.";
    }
  }
  if (isPrismaError(error) || !(error instanceof Error) || error.name === "WorkspaceScopeViolationError") {
    console.error("[strategy-lab]", error);
    return fallback;
  }
  return error.message || fallback;
}

/** Standard action result + wrapper so every Strategy Lab action handles errors the same way. */
export type ActionResult = { success: true } | { success: false; error: string };

export async function runStrategyAction(fallback: string, fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    return { success: true };
  } catch (error) {
    return { success: false, error: toStrategyActionError(error, fallback) };
  }
}
