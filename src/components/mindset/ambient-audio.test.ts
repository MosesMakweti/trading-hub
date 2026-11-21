import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AmbientAudioEngine, FADE_IN_S } from "@/components/mindset/ambient-audio";

/** A minimal fake Web Audio graph that records what the engine does. */
class FakeParam {
  value = 0;
  ramps: { value: number; at: number }[] = [];
  cancelScheduledValues() {}
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number, at: number) {
    this.ramps.push({ value: v, at });
    this.value = v;
  }
}
class FakeNode {
  connections: unknown[] = [];
  disconnected = false;
  connect(n: unknown) {
    this.connections.push(n);
    return n;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class FakeSource extends FakeNode {
  started = false;
  stoppedAt: number | null = null;
  loop = false;
  buffer: unknown = null;
  frequency = new FakeParam();
  type = "sine";
  start() {
    this.started = true;
  }
  stop(at: number) {
    this.stoppedAt = at;
  }
}
class FakeContext {
  state: "running" | "suspended" | "closed" = "suspended";
  currentTime = 10;
  sampleRate = 8000;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  gains: (FakeNode & { gain: FakeParam })[] = [];
  closed = false;
  createGain() {
    const g = Object.assign(new FakeNode(), { gain: new FakeParam() });
    this.gains.push(g);
    return g;
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: "lowpass", frequency: new FakeParam(), Q: new FakeParam() });
  }
  createDelay() {
    return Object.assign(new FakeNode(), { delayTime: new FakeParam() });
  }
  createOscillator() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (c: number) => data[c] };
  }
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
  async close() {
    this.state = "closed";
    this.closed = true;
  }
}

let contexts: FakeContext[] = [];
const engine = () => new AmbientAudioEngine(() => {
  const c = new FakeContext();
  contexts.push(c);
  return c as unknown as AudioContext;
});

beforeEach(() => {
  contexts = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("ambient audio engine", () => {
  it("creates no audio until start() (autoplay-safe), then plays looping, faded-in sources", () => {
    const e = engine();
    expect(contexts).toHaveLength(0);
    expect(e.start("rain", 0.5)).toBe(true);
    const ctx = contexts[0];
    expect(ctx.state).toBe("running");
    const noise = ctx.sources.filter((s) => s.buffer);
    expect(noise.length).toBeGreaterThan(0);
    expect(noise.every((s) => s.loop && s.started)).toBe(true);
    // The voice fades in over FADE_IN_S rather than jumping to full level.
    const voiceGain = ctx.gains[1];
    expect(voiceGain.gain.ramps.at(-1)).toEqual({ value: 1, at: ctx.currentTime + FADE_IN_S });
  });

  it("keeps a single instance and a single sound: switching fades the old one out and stops it", () => {
    const e = engine();
    e.start("rain");
    const ctx = contexts[0];
    const first = [...ctx.sources];
    e.start("stream");
    expect(contexts).toHaveLength(1);
    expect(first.every((s) => s.stoppedAt != null)).toBe(true);
    expect(e.currentSound).toBe("stream");
    const before = ctx.sources.length;
    e.start("stream"); // same sound again: no duplicate layer
    expect(ctx.sources.length).toBe(before);
  });

  it("ramps volume and mute instead of jumping", () => {
    const e = engine();
    e.start("ambient", 0.8);
    const master = contexts[0].gains[0];
    e.setVolume(0.3);
    expect(master.gain.ramps.at(-1)?.value).toBeCloseTo(0.3);
    e.setMuted(true);
    expect(master.gain.ramps.at(-1)?.value).toBe(0);
    e.setVolume(0.9); // changing volume while muted stays silent
    expect(master.gain.ramps.at(-1)?.value).toBe(0);
    e.setMuted(false);
    expect(master.gain.ramps.at(-1)?.value).toBeCloseTo(0.9);
    e.setVolume(4);
    expect(master.gain.ramps.at(-1)?.value).toBe(1);
  });

  it("pauses and resumes the same sound without rebuilding it", async () => {
    const e = engine();
    e.start("night");
    const ctx = contexts[0];
    const count = ctx.sources.length;
    e.pause();
    await Promise.resolve();
    expect(ctx.state).toBe("suspended");
    e.resume();
    await Promise.resolve();
    expect(ctx.state).toBe("running");
    expect(ctx.sources.length).toBe(count);
  });

  it("cleans up: stop() stops every source, dispose() closes the context", () => {
    const e = engine();
    e.start("rain");
    const ctx = contexts[0];
    e.stop();
    expect(ctx.sources.every((s) => s.stoppedAt != null)).toBe(true);
    expect(e.currentSound).toBeNull();
    e.dispose();
    vi.runAllTimers();
    expect(ctx.closed).toBe(true);
    // A new start after dispose uses a fresh context (never two at once).
    e.start("rain");
    expect(contexts).toHaveLength(2);
  });

  it("degrades gracefully where Web Audio isn't available", () => {
    const e = new AmbientAudioEngine(() => null);
    expect(e.start("rain")).toBe(false);
    expect(() => {
      e.setVolume(0.5);
      e.pause();
      e.resume();
      e.stop();
      e.dispose();
    }).not.toThrow();
  });
});
