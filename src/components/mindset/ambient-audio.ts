/**
 * Mindset ambient audio — generated in the browser with the Web Audio API.
 *
 * Why generated: the app ships no audio files, and depending on external
 * URLs would make the core experience fragile. Each sound is built from
 * looped noise and soft oscillators through gentle filters, so there are no
 * lyrics, no percussion, and every level change is a slow ramp (no sudden
 * volume jumps or abrupt cuts). Loops are seamless: looping *white* noise
 * has no audible seam, and all colour comes from filters after the loop.
 *
 * Exactly one engine exists (`ambientAudio`), and it plays at most one sound:
 * starting a new sound fades the previous one out first. The AudioContext is
 * created lazily on `start()`, which callers invoke from a click — browsers
 * only allow audio after a user gesture.
 */
import type { SoundId } from "@/domain/mindset/options";

export const FADE_IN_S = 3;
export const FADE_OUT_S = 1.6;
const VOLUME_RAMP_S = 0.4;

type Ctx = AudioContext;
type CtxFactory = () => Ctx | null;

interface Voice {
  sound: SoundId;
  gain: GainNode;
  stoppables: AudioScheduledSourceNode[];
}

function defaultFactory(): Ctx | null {
  if (typeof window === "undefined") return null;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return C ? new C() : null;
}

/** Gentle exponential-ish ramp to a target without clicks. */
function rampTo(param: AudioParam, value: number, now: number, seconds: number) {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

export class AmbientAudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private voice: Voice | null = null;
  private volume = 0.6;
  private muted = false;
  private noiseBuffer: AudioBuffer | null = null;

  constructor(private readonly createContext: CtxFactory = defaultFactory) {}

  /** True when this browser supports Web Audio at all. */
  static get supported(): boolean {
    return typeof window !== "undefined" && ("AudioContext" in window || "webkitAudioContext" in window);
  }

  get currentSound(): SoundId | null {
    return this.voice?.sound ?? null;
  }

  get isPlaying(): boolean {
    return this.voice != null && this.ctx?.state === "running";
  }

  private ensureContext(): Ctx | null {
    if (this.ctx && this.ctx.state !== "closed") return this.ctx;
    const ctx = this.createContext();
    if (!ctx) return null;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    this.noiseBuffer = null;
    return ctx;
  }

  private noise(ctx: Ctx): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const seconds = 4;
    const buffer = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** Looped noise → filter chain → gain into `out`. */
  private noiseLayer(ctx: Ctx, out: AudioNode, stoppables: AudioScheduledSourceNode[], filters: { type: BiquadFilterType; frequency: number; Q?: number }[], level: number, lfo?: { rate: number; depth: number; target: "gain" | "frequency" }) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    src.loop = true;
    let node: AudioNode = src;
    const created: BiquadFilterNode[] = [];
    for (const f of filters) {
      const filter = ctx.createBiquadFilter();
      filter.type = f.type;
      filter.frequency.value = f.frequency;
      if (f.Q != null) filter.Q.value = f.Q;
      node.connect(filter);
      node = filter;
      created.push(filter);
    }
    const g = ctx.createGain();
    g.gain.value = level;
    node.connect(g);
    g.connect(out);
    if (lfo) {
      const osc = ctx.createOscillator();
      osc.frequency.value = lfo.rate;
      const depth = ctx.createGain();
      depth.gain.value = lfo.depth;
      osc.connect(depth);
      depth.connect(lfo.target === "gain" ? g.gain : created[created.length - 1].frequency);
      osc.start();
      stoppables.push(osc);
    }
    src.start();
    stoppables.push(src);
  }

  /** A soft pad of slowly drifting sine/triangle tones. */
  private padLayer(ctx: Ctx, out: AudioNode, stoppables: AudioScheduledSourceNode[], freqs: number[], level: number) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    const bus = ctx.createGain();
    bus.gain.value = level;
    // A short feedback delay gives the pad space without a reverb file.
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    lp.connect(bus);
    bus.connect(out);
    bus.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(out);
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = f;
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 0.5 / freqs.length;
      // Slow, independent swells so the chord breathes.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + i * 0.017;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.35 / freqs.length;
      lfo.connect(lfoDepth);
      lfoDepth.connect(voiceGain.gain);
      osc.connect(voiceGain);
      voiceGain.connect(lp);
      osc.start();
      lfo.start();
      stoppables.push(osc, lfo);
    });
  }

  private build(ctx: Ctx, sound: SoundId, out: AudioNode): AudioScheduledSourceNode[] {
    const s: AudioScheduledSourceNode[] = [];
    switch (sound) {
      case "rain":
        this.noiseLayer(ctx, out, s, [{ type: "highpass", frequency: 450 }, { type: "lowpass", frequency: 5200 }], 0.32);
        this.noiseLayer(ctx, out, s, [{ type: "bandpass", frequency: 2600, Q: 0.6 }], 0.09, { rate: 0.07, depth: 0.04, target: "gain" });
        break;
      case "stream":
        this.noiseLayer(ctx, out, s, [{ type: "lowpass", frequency: 900, Q: 0.8 }], 0.55, { rate: 0.09, depth: 320, target: "frequency" });
        this.noiseLayer(ctx, out, s, [{ type: "bandpass", frequency: 1800, Q: 1.2 }], 0.07, { rate: 0.21, depth: 0.04, target: "gain" });
        break;
      case "ambient":
        this.padLayer(ctx, out, s, [110, 164.81, 220, 277.18], 0.55);
        break;
      case "night":
        this.padLayer(ctx, out, s, [55, 82.41, 110, 164.81], 0.5);
        this.noiseLayer(ctx, out, s, [{ type: "lowpass", frequency: 320 }], 0.14, { rate: 0.05, depth: 0.05, target: "gain" });
        break;
    }
    return s;
  }

  private fadeOutAndStop(voice: Voice) {
    const ctx = this.ctx;
    if (!ctx) return;
    rampTo(voice.gain.gain, 0, ctx.currentTime, FADE_OUT_S);
    for (const node of voice.stoppables) {
      try {
        node.stop(ctx.currentTime + FADE_OUT_S + 0.05);
      } catch {
        // already stopped
      }
    }
    setTimeout(() => voice.gain.disconnect(), (FADE_OUT_S + 0.2) * 1000);
  }

  /**
   * Start (or switch to) a sound. Call from a user gesture. Returns false when
   * audio isn't available in this browser — callers continue silently.
   */
  start(sound: SoundId, volume?: number): boolean {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return false;
    if (volume != null) this.setVolume(volume);
    void ctx.resume?.();
    if (this.voice?.sound === sound) return true;
    if (this.voice) this.fadeOutAndStop(this.voice);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const stoppables = this.build(ctx, sound, gain);
    rampTo(gain.gain, 1, ctx.currentTime, FADE_IN_S);
    this.voice = { sound, gain, stoppables };
    return true;
  }

  /** 0–1. Ramped, never a jump. */
  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.ctx && this.master && !this.muted) rampTo(this.master.gain, this.volume, this.ctx.currentTime, VOLUME_RAMP_S);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.master) rampTo(this.master.gain, muted ? 0 : this.volume, this.ctx.currentTime, VOLUME_RAMP_S);
  }

  get isMuted() {
    return this.muted;
  }

  /** Pause/resume keep the same sound (seamless), they don't rebuild it. */
  pause() {
    void this.ctx?.suspend?.();
  }

  resume() {
    void this.ctx?.resume?.();
  }

  /** Fade out and release the sound (the context stays for a quick restart). */
  stop() {
    if (this.voice) this.fadeOutAndStop(this.voice);
    this.voice = null;
  }

  /** Release everything (e.g. leaving the Mindset page). */
  dispose() {
    this.stop();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    if (ctx) setTimeout(() => void ctx.close?.(), (FADE_OUT_S + 0.3) * 1000);
  }
}

/** The one shared engine — guarantees a single audio instance app-wide. */
export const ambientAudio = new AmbientAudioEngine();
