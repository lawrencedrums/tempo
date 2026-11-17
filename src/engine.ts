import { Sequencer, type Slot } from './sequencer';
import { render } from './sounds';
import { SOUNDS, type Groove, type Practice, type Settings, type SoundId } from './types';

/** How far ahead of the audio clock clicks are scheduled, and how often we top up. */
const AHEAD = 0.12;
const TICK_MS = 25;
/** Gain of normal, accent and strong beats (subdivisions use the user's sub volume). */
const BEAT_GAIN = [0, 0.8, 0.9, 1];

export interface EngineInput {
  groove: Groove;
  practice: Practice;
  settings: Settings;
}

export class Engine {
  playing = false;
  onSlot: (slot: Slot) => void = () => {};
  onEnd: (reason: 'timer' | 'trainer') => void = () => {};

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bank = new Map<SoundId, AudioBuffer[]>();
  private seq: Sequencer | null = null;
  private pending: Slot | null = null;
  private queue: Slot[] = [];
  private live = new Set<AudioBufferSourceNode>();
  private endAt: number | null = null;
  private raf = 0;
  private worker: Worker | null = null;
  private interval = 0;

  constructor(private get: () => EngineInput) {}

  /** Tempo right now, which the trainer may have moved away from the saved one. */
  get bpm(): number | null {
    return this.seq ? this.seq.bpm : null;
  }

  setBpm(bpm: number): void {
    if (this.seq) this.seq.bpm = bpm;
  }

  /** Must be called from a user gesture the first time, so the browser allows audio. */
  async start(): Promise<void> {
    const ctx = this.ensureContext();
    await ctx.resume();
    this.halt();
    this.applyVolume();
    this.seq = new Sequencer(this.get, ctx.currentTime + 0.08);
    this.playing = true;
    this.startTicking();
    this.tick();
    const frame = () => {
      this.flushVisuals();
      if (this.playing) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.halt();
  }

  /** Plays one click so a sound can be auditioned while stopped. */
  async preview(): Promise<void> {
    const ctx = this.ensureContext();
    await ctx.resume();
    this.applyVolume();
    this.fire(this.get().groove.sound, 2, 1, ctx.currentTime + 0.02);
  }

  applyVolume(): void {
    if (!this.ctx) return;
    const { volume, boost } = this.get().settings;
    this.master.gain.setTargetAtTime(volume * (boost ? 2.5 : 1), this.ctx.currentTime, 0.01);
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = ctx.createGain();
    // Soft clipper, so volume boost gets louder without harsh digital clipping.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 512 - 1) * 1.5) / Math.tanh(1.5);
    shaper.curve = curve;
    this.master.connect(shaper).connect(ctx.destination);
    for (const id of SOUNDS) {
      this.bank.set(
        id,
        [0, 1, 2].map((v) => {
          const data = render(id, v, ctx.sampleRate);
          const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
          buf.copyToChannel(data, 0);
          return buf;
        }),
      );
    }
    this.ctx = ctx;
    return ctx;
  }

  private halt(): void {
    this.playing = false;
    this.stopTicking();
    cancelAnimationFrame(this.raf);
    for (const src of this.live) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.live.clear();
    this.seq = null;
    this.pending = null;
    this.queue = [];
    this.endAt = null;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.playing || !this.seq) return;
    const now = ctx.currentTime;
    while (this.endAt === null) {
      if (!this.pending) {
        this.pending = this.seq.next();
        if (!this.pending) {
          this.endAt = this.seq.endTime ?? now;
          break;
        }
      }
      if (this.pending.time >= now + AHEAD) break;
      this.sound(this.pending, now);
      this.queue.push(this.pending);
      this.pending = null;
    }
    if (this.endAt !== null && now >= this.endAt) {
      this.flushVisuals();
      const reason = this.seq.endReason ?? 'timer';
      this.halt();
      this.onEnd(reason);
    }
  }

  private sound(slot: Slot, now: number): void {
    if (slot.muted || slot.level === 0) return;
    // After a long stall (throttled tab) skip clicks that are already in the past.
    if (slot.time < now - 0.05) return;
    const { groove, settings } = this.get();
    if (slot.sub === 0) this.fire(groove.sound, slot.level - 1, BEAT_GAIN[slot.level], slot.time);
    else if (settings.subVolume > 0) this.fire(groove.sound, 0, settings.subVolume, slot.time);
  }

  private fire(sound: SoundId, variant: number, gain: number, time: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.bank.get(sound)![variant];
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.onended = () => this.live.delete(src);
    this.live.add(src);
    src.start(time);
  }

  /** Hands slots to the UI at the moment they are heard, allowing for output latency. */
  private flushVisuals(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const delay = (ctx.outputLatency || ctx.baseLatency || 0) + this.get().settings.latencyMs / 1000;
    const t = ctx.currentTime - delay;
    while (this.queue.length && this.queue[0].time <= t) this.onSlot(this.queue.shift()!);
  }

  /** Ticks from a worker where possible: page timers are throttled in background tabs. */
  private startTicking(): void {
    try {
      if (!this.worker) {
        const src = 'let t;onmessage=e=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),e.data)}';
        this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        this.worker.onmessage = () => this.tick();
      }
      this.worker.postMessage(TICK_MS);
    } catch {
      this.worker = null;
      this.interval = window.setInterval(() => this.tick(), TICK_MS);
    }
  }

  private stopTicking(): void {
    this.worker?.postMessage(0);
    clearInterval(this.interval);
  }
}
