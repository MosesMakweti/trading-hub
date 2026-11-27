export type SaveState = "idle" | "saving" | "saved" | "error";
export type SaveResult = { success: true } | { success: false; error: string };

export interface AutosaveHandlers<T> {
  save: (value: T) => Promise<SaveResult>;
  onError?: (message: string) => void;
  onState?: (state: SaveState) => void;
}

/**
 * Framework-free core of useDebouncedAutosave (unit-tested on its own).
 *
 * - `schedule` debounces: only the newest content within `delay` is saved.
 * - Saves run strictly one after another, so an older save can never finish
 *   after — and overwrite — a newer one.
 * - `flush` saves whatever is pending right now and resolves once the DB is
 *   up to date (true) or a save failed (false).
 */
export class AutosaveQueue<T> {
  private lastSaved: string;
  private lastQueued: string;
  private chain: Promise<unknown> = Promise.resolve();
  private inFlight = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handlers: AutosaveHandlers<T> | null = null;
  private latest: { value: T; snapshot: string } | null = null;

  constructor(initialSnapshot: string) {
    this.lastSaved = initialSnapshot;
    this.lastQueued = initialSnapshot;
  }

  /** Called every render with the current value and callbacks. */
  update(value: T, snapshot: string, handlers: AutosaveHandlers<T>) {
    this.latest = { value, snapshot };
    this.handlers = handlers;
  }

  schedule(value: T, snapshot: string, delay: number) {
    this.cancelTimer();
    if (snapshot === this.lastQueued) return; // already saved or queued exactly this
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueue(value, snapshot, true);
    }, delay);
  }

  cancelTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async flush(report = true): Promise<boolean> {
    this.cancelTimer();
    const latest = this.latest;
    if (latest && latest.snapshot !== this.lastQueued) void this.enqueue(latest.value, latest.snapshot, report);
    await this.chain.catch(() => undefined);
    return !latest || latest.snapshot === this.lastSaved;
  }

  get isDirty() {
    return this.latest != null && this.latest.snapshot !== this.lastSaved;
  }

  private enqueue(value: T, snapshot: string, report: boolean) {
    const handlers = this.handlers;
    if (!handlers) return Promise.resolve();
    this.lastQueued = snapshot;
    this.inFlight += 1;
    if (report) handlers.onState?.("saving");

    const run = this.chain
      .catch(() => undefined)
      .then(() => handlers.save(value))
      .then(
        (result) => {
          this.inFlight -= 1;
          if (result.success) {
            this.lastSaved = snapshot;
            if (report && this.inFlight === 0) handlers.onState?.("saved");
          } else {
            this.lastQueued = this.lastSaved; // let the same content be retried
            if (report) handlers.onState?.("error");
            handlers.onError?.(result.error);
          }
        },
        () => {
          this.inFlight -= 1;
          this.lastQueued = this.lastSaved;
          if (report) handlers.onState?.("error");
        },
      );
    this.chain = run;
    return run;
  }
}
