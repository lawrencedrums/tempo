import type { SoundId } from './types';

/**
 * Click sounds are synthesised at startup, so there are no audio files to
 * download or cache. Each sound has three variants, rising in pitch: normal,
 * accent and strong accent. Subdivisions use the normal variant, only quieter.
 * The click is tuned so the accent is a fifth and the strong accent an octave
 * above the normal beat.
 */

const TAU = Math.PI * 2;

function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x80000000 - 1;
  };
}

type Synth = (t: number, i: number, v: number, rnd: () => number, prev: { x: number }) => number;

const square = (ph: number) => (Math.sin(ph) >= 0 ? 1 : -1);

const defs: Record<SoundId, { dur: number; fn: Synth }> = {
  click: {
    dur: 0.04,
    fn: (t, _i, v) => Math.sin(TAU * [1200, 1800, 2400][v] * t) * Math.exp(-t / 0.006),
  },
  beep: {
    dur: 0.07,
    fn: (t, _i, v) => {
      const f = [880, 1320, 1760][v];
      const env = Math.min(1, t / 0.002) * Math.min(1, (0.06 - t) / 0.01);
      return (Math.sin(TAU * f * t) + 0.3 * square(TAU * f * t)) * Math.max(0, env);
    },
  },
  wood: {
    dur: 0.09,
    fn: (t, _i, v, rnd) => {
      const f = [1050, 1400, 1850][v];
      const body = Math.sin(TAU * f * t * (1 + 0.4 * Math.exp(-t / 0.004))) * Math.exp(-t / 0.014);
      return body + 0.5 * rnd() * Math.exp(-t / 0.002);
    },
  },
  cowbell: {
    dur: 0.18,
    fn: (t, _i, v) => {
      const f = 540 * [1, 1.26, 1.5][v];
      const env = 0.7 * Math.exp(-t / 0.012) + 0.3 * Math.exp(-t / 0.06);
      return (square(TAU * f * t) + square(TAU * f * 1.48 * t)) * env;
    },
  },
  rim: {
    dur: 0.06,
    fn: (t, _i, v, rnd) => {
      const k = [1, 1.25, 1.5][v];
      return (
        rnd() * Math.exp(-t / 0.003) +
        0.8 * Math.sin(TAU * 1750 * k * t) * Math.exp(-t / 0.008) +
        0.5 * Math.sin(TAU * 480 * k * t) * Math.exp(-t / 0.012)
      );
    },
  },
  hat: {
    dur: 0.16,
    fn: (t, _i, v, rnd, prev) => {
      const x = rnd();
      const hp = x - prev.x;
      prev.x = x;
      return hp * Math.exp(-t / [0.014, 0.028, 0.055][v]);
    },
  },
};

/** Mono samples for one sound variant (0 normal, 1 accent, 2 strong), peak-normalised. */
export function render(id: SoundId, variant: number, sampleRate: number): Float32Array<ArrayBuffer> {
  const { dur, fn } = defs[id];
  const n = Math.ceil(dur * sampleRate);
  const out = new Float32Array(n);
  const rnd = noise(12345 + variant);
  const prev = { x: 0 };
  let peak = 0;
  for (let i = 0; i < n; i++) {
    out[i] = fn(i / sampleRate, i, variant, rnd, prev);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  // Short fade so the buffer never ends on a step.
  const fade = Math.min(n, Math.floor(sampleRate * 0.003));
  const gain = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < n; i++) {
    const tail = n - 1 - i;
    out[i] *= gain * (tail < fade ? tail / fade : 1);
  }
  return out;
}
