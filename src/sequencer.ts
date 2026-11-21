import type { Groove, Level, Practice } from './types';

export interface Slot {
  /** Audio-clock time in seconds. */
  time: number;
  /** Bar number from 0; negative during the count-in. */
  bar: number;
  beat: number;
  sub: number;
  /** Beat level on the beat itself; for subdivisions 1 (audible) or 0 (beat is muted). */
  level: Level;
  /** True when the whole bar is silenced by gap click. */
  muted: boolean;
  countIn: boolean;
  bpm: number;
  /** Seconds since bar 0 started; negative during the count-in. */
  elapsed: number;
}

export interface SeqInput {
  groove: Groove;
  practice: Practice;
}

export const beatSeconds = (bpm: number): number => 60 / bpm;

/** Position of a subdivision inside its beat, 0–1. Swing applies to 2 and 4 only. */
export function subOffset(sub: number, count: number, swing: number): number {
  const s = swing / 100;
  if (count === 2) return sub ? s : 0;
  if (count === 4) return [0, s / 2, 0.5, 0.5 + s / 2][sub];
  return sub / count;
}

/**
 * Produces the click sequence one slot at a time. It reads the groove and
 * practice settings live, so edits made while playing apply from the next slot
 * (tempo from the next beat).
 */
export class Sequencer {
  bpm: number;
  endTime: number | null = null;
  /** What ended the sequence, once it has ended. */
  endReason: 'timer' | 'trainer' | null = null;

  private bar: number;
  private beat = 0;
  private sub = 0;
  private beatStart: number;
  private beatDur: number;
  private mainStart: number;
  private lastStep: number;
  private barMuted = false;
  private ended = false;
  /** Time of the last slot handed out, and its position in beats relative to beatStart. */
  private lastTime: number | null = null;
  private lastPos = 0;

  constructor(
    private get: () => SeqInput,
    startTime: number,
    private rng: () => number = Math.random,
  ) {
    const { groove, practice } = get();
    this.bpm = groove.bpm;
    this.bar = practice.countIn > 0 ? -practice.countIn : 0;
    this.beatStart = startTime;
    this.mainStart = startTime;
    this.lastStep = startTime;
    this.beatDur = beatSeconds(this.bpm);
    if (this.bar === 0) this.enterBar();
  }

  /**
   * Changes tempo straight away: the gap after the last slot handed out is
   * already at the new tempo, rather than waiting for the next beat.
   */
  setBpm(bpm: number): void {
    if (bpm === this.bpm) return;
    this.bpm = bpm;
    const old = this.beatStart;
    this.beatDur = beatSeconds(bpm);
    if (this.lastTime === null || this.ended) return;
    this.beatStart = this.lastTime - this.lastPos * this.beatDur;
    if (this.mainStart === old) this.mainStart = this.beatStart;
    if (this.lastStep === old) this.lastStep = this.beatStart;
  }

  /** A copy that carries on independently from the same point. */
  clone(): Sequencer {
    return Object.assign(Object.create(Sequencer.prototype) as Sequencer, this);
  }

  next(): Slot | null {
    if (this.ended) return null;
    const { groove, practice } = this.get();

    // The meter or subdivision may have shrunk since the last slot.
    if (this.sub >= this.subCount(groove)) this.nextBeat();
    else if (this.beat >= groove.beats) this.nextBar();
    if (this.ended) return null;

    const countIn = this.bar < 0;
    const count = this.subCount(groove);
    const pos = subOffset(this.sub, count, groove.swing);
    const time = this.beatStart + pos * this.beatDur;

    const t = practice.timer;
    if (!countIn && t.on && t.mode === 'minutes' && time - this.mainStart >= t.amount * 60 - 1e-9) {
      this.ended = true;
      this.endTime = time;
      this.endReason = 'timer';
      return null;
    }

    const beatLevel = groove.accents[this.beat] ?? 1;
    const slot: Slot = {
      time,
      bar: this.bar,
      beat: this.beat,
      sub: this.sub,
      level: this.sub === 0 ? beatLevel : beatLevel === 0 ? 0 : 1,
      muted: this.barMuted,
      countIn,
      bpm: this.bpm,
      elapsed: countIn ? -1 : time - this.mainStart,
    };

    this.lastTime = time;
    this.lastPos = pos;
    this.sub++;
    if (this.sub >= count) this.nextBeat();
    return slot;
  }

  private subCount(g: Groove): number {
    return this.bar < 0 ? 1 : g.subdivision;
  }

  private nextBeat(): void {
    this.sub = 0;
    this.beat++;
    this.beatStart += this.beatDur;
    this.lastPos -= 1;
    const { groove } = this.get();
    if (this.beat >= groove.beats) this.nextBar();
    this.beatDur = beatSeconds(this.bpm);
  }

  private nextBar(): void {
    this.beat = 0;
    this.sub = 0;
    this.bar++;
    this.enterBar();
  }

  private enterBar(): void {
    if (this.bar < 0) return;
    const { practice } = this.get();
    if (this.bar === 0) {
      this.mainStart = this.beatStart;
      this.lastStep = this.beatStart;
    }

    const timer = practice.timer;
    if (timer.on && timer.mode === 'bars' && this.bar >= timer.amount) {
      this.ended = true;
      this.endTime = this.beatStart;
      this.endReason = 'timer';
      return;
    }

    const tr = practice.trainer;
    if (tr.on && this.bar > 0) {
      const due =
        tr.mode === 'bars'
          ? this.bar % Math.max(1, tr.every) === 0
          : this.beatStart - this.lastStep >= tr.every - 1e-6;
      if (due) {
        this.lastStep = this.beatStart;
        const step = Math.abs(tr.step);
        // With stop on, a step that would overshoot the target ends the run
        // instead of being clamped to it.
        if (tr.stop && Math.abs(tr.target - this.bpm) < step) {
          this.ended = true;
          this.endTime = this.beatStart;
          this.endReason = 'trainer';
          return;
        }
        if (tr.target > this.bpm) this.bpm = Math.min(tr.target, this.bpm + step);
        else if (tr.target < this.bpm) this.bpm = Math.max(tr.target, this.bpm - step);
      }
    }

    const gap = practice.gap;
    if (!gap.on) this.barMuted = false;
    else if (gap.random) this.barMuted = this.bar > 0 && this.rng() < gap.chance / 100;
    else {
      const play = Math.max(1, gap.play);
      this.barMuted = this.bar % (play + Math.max(1, gap.mute)) >= play;
    }
  }
}
