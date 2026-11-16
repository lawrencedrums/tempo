import { describe, expect, it } from 'vitest';
import { defaultAccents, sanitizeGroove, subdivisionName } from './store';

describe('sanitizeGroove', () => {
  it('keeps the sound of grooves saved when BPM could count quarters', () => {
    // 7/8 at 180 quarters per minute is 360 eighth-note clicks per minute.
    expect(sanitizeGroove({ bpm: 180, beats: 7, unit: 8, tempoNote: 'quarter' }).bpm).toBe(360);
    // 6/8 at 60 dotted quarters per minute is 180 clicks per minute.
    expect(sanitizeGroove({ bpm: 60, beats: 6, unit: 8, tempoNote: 'dotted' }).bpm).toBe(180);
    expect(sanitizeGroove({ bpm: 180, beats: 4, unit: 4, tempoNote: 'beat' }).bpm).toBe(180);
    expect(sanitizeGroove({ bpm: 180, beats: 7, unit: 8 }).bpm).toBe(180);
  });

  it('drops the old setting and clamps to the tempo range', () => {
    const g = sanitizeGroove({ bpm: 300, beats: 7, unit: 16, tempoNote: 'quarter' });
    expect(g.bpm).toBe(400);
    expect('tempoNote' in g).toBe(false);
  });

  it('fills in defaults for junk', () => {
    expect(sanitizeGroove(null)).toMatchObject({ bpm: 120, beats: 4, unit: 4, subdivision: 1, accents: [3, 1, 1, 1] });
  });
});

describe('defaults and names', () => {
  it('accents every third beat in compound meters only', () => {
    expect(defaultAccents(6, 8)).toEqual([3, 1, 1, 2, 1, 1]);
    expect(defaultAccents(7, 8)).toEqual([3, 1, 1, 1, 1, 1, 1]);
    expect(defaultAccents(6, 4)).toEqual([3, 1, 1, 1, 1, 1]);
  });

  it('names subdivisions for the meter', () => {
    expect([2, 4].map((n) => subdivisionName(n, 4))).toEqual(['8ths', '16ths']);
    expect([2, 4].map((n) => subdivisionName(n, 8))).toEqual(['16ths', '32nds']);
    expect(subdivisionName(2, 2)).toBe('Quarters');
  });
});
