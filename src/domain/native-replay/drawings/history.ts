/**
 * Native Replay — drawing edit history (undo / redo) for the current client
 * session. Completely separate from the replay clock: undoing a drawing edit
 * never moves market time, and nothing here can.
 *
 * Every operation stores both states, so undo is just applying the inverse.
 */
import type { ChartDrawing } from "./model";

export type DrawingOp =
  | { kind: "create"; drawing: ChartDrawing }
  | { kind: "delete"; drawing: ChartDrawing }
  | { kind: "update"; before: ChartDrawing; after: ChartDrawing };

export function invert(op: DrawingOp): DrawingOp {
  if (op.kind === "create") return { kind: "delete", drawing: op.drawing };
  if (op.kind === "delete") return { kind: "create", drawing: op.drawing };
  return { kind: "update", before: op.after, after: op.before };
}

export class DrawingHistory {
  private undoStack: DrawingOp[] = [];
  private redoStack: DrawingOp[] = [];

  constructor(private readonly limit = 200) {}

  /** Record an edit the trader just made (clears redo). */
  record(op: DrawingOp): void {
    this.undoStack.push(op);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** The operation to APPLY to undo the last edit, or null. */
  undo(): DrawingOp | null {
    const op = this.undoStack.pop();
    if (!op) return null;
    this.redoStack.push(op);
    return invert(op);
  }

  /** The operation to APPLY to redo, or null. */
  redo(): DrawingOp | null {
    const op = this.redoStack.pop();
    if (!op) return null;
    this.undoStack.push(op);
    return op;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

/** Apply an op to a list of drawings (pure). */
export function applyOp(list: readonly ChartDrawing[], op: DrawingOp): ChartDrawing[] {
  if (op.kind === "create") return [...list.filter((d) => d.id !== op.drawing.id), op.drawing];
  if (op.kind === "delete") return list.filter((d) => d.id !== op.drawing.id);
  return list.map((d) => (d.id === op.after.id ? op.after : d));
}
