import { describe, expect, it } from 'vitest';
import { Sequencer, type SeqInput, type Slot } from './sequencer';
import type { Groove, Practice } from './types';

const groove = (over: Partial<Groove> = {}): Groove => ({
  bpm: 120,
  beats: 4,
  unit: 4,
  subdivision: 1,
  swing: 50,
  accents: [3, 1, 1, 1],
  sound: 'click',
  ...over,
});

const practice = (over: Partial<Practice> = {}): Practice => ({
  trainer: { on: false, step: 5, every: 4, mode: 'bars', target: 200, stop: false },
  gap: { on: false, play: 2, mute: 2, random: false, chance: 30 },
  countIn: 0,
  timer: { on: false, amount: 5, mode: 'minutes' },
  ...over,
});

function take(input: SeqInput, n: number, rng?: () => number): { slots: Slot[]; seq: Sequencer } {
  const seq = new Sequencer(() => input, 0, rng);
  const slots: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const s = seq.next();
    if (!s) break;
    slots.push(s);
  }
  return { slots, seq };
}

const times = (slots: Slot[]) => slots.map((s) => +s.time.toFixed(4));

describe('Sequencer', () => {
  it('plays 4/4 at 120 BPM', () => {
    const { slots } = take({ groove: groove(), practice: practice() }, 5);
    expect(times(slots)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(slots.map((s) => s.bar)).toEqual([0, 0, 0, 0, 1]);
    expect(slots.map((s) => s.level)).toEqual([3, 1, 1, 1, 3]);
  });

  it('subdivides and swings eighths', () => {
    const { slots } = take({ groove: groove({ subdivision: 2, swing: 66 }), practice: practice() }, 4);
    expect(times(slots)).toEqual([0, 0.33, 0.5, 0.83]);
    expect(slots.map((s) => s.sub)).toEqual([0, 1, 0, 1]);
  });

  it('plays sextuplets evenly at 240 BPM', () => {
    const { slots } = take({ groove: groove({ bpm: 240, subdivision: 6 }), practice: practice() }, 7);
    expect(slots[6].time).toBeCloseTo(0.25, 9);
    expect(slots[1].time).toBeCloseTo(0.25 / 6, 9);
  });

  it('clicks every eighth in 6/8', () => {
    const g = groove({ bpm: 180, beats: 6, unit: 8, accents: [3, 1, 1, 2, 1, 1] });
    const { slots } = take({ groove: g, practice: practice() }, 7);
    expect(slots[3].time).toBeCloseTo(1, 9);
    expect(slots[6].time).toBeCloseTo(2, 9);
    expect(slots[6].bar).toBe(1);
  });

  it('clicks every eighth in 7/8', () => {
    const g = groove({ bpm: 240, beats: 7, unit: 8, accents: [3, 1, 2, 1, 2, 1, 1] });
    const { slots } = take({ groove: g, practice: practice() }, 8);
    expect(slots[1].time).toBeCloseTo(0.25, 9);
    expect(slots[7].bar).toBe(1);
  });

  it('counts in without subdivisions', () => {
    const { slots } = take({ groove: groove({ subdivision: 4 }), practice: practice({ countIn: 1 }) }, 6);
    expect(slots.slice(0, 4).every((s) => s.countIn && s.bar === -1 && s.sub === 0)).toBe(true);
    expect(slots[4]).toMatchObject({ bar: 0, beat: 0, sub: 0, countIn: false, time: 2, elapsed: 0 });
    expect(slots[5].time).toBeCloseTo(2.125, 9);
  });

  it('steps the tempo up to the target and stops there', () => {
    const p = practice({ trainer: { on: true, step: 5, every: 2, mode: 'bars', target: 128, stop: false } });
    const { slots } = take({ groove: groove(), practice: p }, 28);
    const bpmAtBar = (b: number) => slots.find((s) => s.bar === b)!.bpm;
    expect([0, 1, 2, 3, 4, 6].map(bpmAtBar)).toEqual([120, 120, 125, 125, 128, 128]);
  });

  it('stops instead of stepping past the target', () => {
    const p = practice({ trainer: { on: true, step: 5, every: 2, mode: 'bars', target: 128, stop: true } });
    const { slots, seq } = take({ groove: groove(), practice: p }, 50);
    // 120 for two bars, 125 for two bars, then 130 would overshoot.
    expect(slots).toHaveLength(16);
    expect(slots.at(-1)!.bpm).toBe(125);
    expect(seq.endReason).toBe('trainer');
    expect(seq.endTime).toBeCloseTo(4 + 8 * (60 / 125), 9);
  });

  it('plays the target tempo before stopping when a step lands on it', () => {
    const p = practice({ trainer: { on: true, step: 5, every: 1, mode: 'bars', target: 110, stop: true } });
    const { slots } = take({ groove: groove(), practice: p }, 50);
    expect(slots.filter((s) => s.beat === 0).map((s) => s.bpm)).toEqual([120, 115, 110]);
  });

  it('steps the tempo down by seconds', () => {
    const p = practice({ trainer: { on: true, step: 10, every: 4, mode: 'seconds', target: 100, stop: false } });
    const { slots } = take({ groove: groove(), practice: p }, 20);
    const bpmAtBar = (b: number) => slots.find((s) => s.bar === b)!.bpm;
    // Bars are 2 s at 120, so the first step lands on bar 2.
    expect([0, 1, 2, 3].map(bpmAtBar)).toEqual([120, 120, 110, 110]);
  });

  it('mutes bars in a play/mute cycle', () => {
    const p = practice({ gap: { on: true, play: 2, mute: 1, random: false, chance: 0 } });
    const { slots } = take({ groove: groove(), practice: p }, 24);
    const mutedBars = [...new Set(slots.filter((s) => s.muted).map((s) => s.bar))];
    expect(mutedBars).toEqual([2, 5]);
  });

  it('never randomly mutes the first bar', () => {
    const p = practice({ gap: { on: true, play: 1, mute: 1, random: true, chance: 100 } });
    const { slots } = take({ groove: groove(), practice: p }, 8, () => 0);
    expect(slots.slice(0, 4).some((s) => s.muted)).toBe(false);
    expect(slots.slice(4).every((s) => s.muted)).toBe(true);
  });

  it('stops after a bar count', () => {
    const p = practice({ timer: { on: true, amount: 2, mode: 'bars' } });
    const { slots, seq } = take({ groove: groove(), practice: p }, 50);
    expect(slots).toHaveLength(8);
    expect(seq.endTime).toBeCloseTo(4, 9);
  });

  it('stops after a duration, not counting the count-in', () => {
    const p = practice({ countIn: 1, timer: { on: true, amount: 0.05, mode: 'minutes' } });
    const { slots, seq } = take({ groove: groove(), practice: p }, 50);
    expect(slots.filter((s) => !s.countIn)).toHaveLength(6);
    expect(seq.endTime).toBeCloseTo(5, 9);
  });

  it('survives the meter shrinking mid-bar', () => {
    const input = { groove: groove({ beats: 7, accents: [3, 1, 1, 1, 1, 1, 1] }), practice: practice() };
    const seq = new Sequencer(() => input, 0);
    for (let i = 0; i < 6; i++) seq.next();
    input.groove.beats = 4;
    const s = seq.next()!;
    expect(s).toMatchObject({ bar: 1, beat: 0 });
  });
  it('applies a tempo change from the very next click', () => {
    const { slots, seq } = take({ groove: groove({ bpm: 60 }), practice: practice() }, 2);
    expect(times(slots)).toEqual([0, 1]);
    seq.setBpm(120);
    expect(+seq.next()!.time.toFixed(4)).toBe(1.5);
    expect(+seq.next()!.time.toFixed(4)).toBe(2);
  });

  it('retimes the rest of a subdivided beat without going backwards', () => {
    const input = { groove: groove({ bpm: 60, subdivision: 4 }), practice: practice() };
    const { slots, seq } = take(input, 2);
    expect(times(slots)).toEqual([0, 0.25]);
    seq.setBpm(240);
    const rest = [seq.next()!, seq.next()!, seq.next()!];
    expect(times(rest)).toEqual([0.3125, 0.375, 0.4375]);
  });

  it('carries on from the same point when cloned', () => {
    const { seq } = take({ groove: groove(), practice: practice() }, 3);
    const copy = seq.clone();
    expect(copy.next()).toEqual(seq.next());
  });
});
