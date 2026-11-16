/** 0 muted, 1 normal, 2 accent, 3 strong accent */
export type Level = 0 | 1 | 2 | 3;

/** Which note value the BPM number counts. */
export type TempoNote = 'beat' | 'quarter' | 'dotted';

export const SOUNDS = ['click', 'beep', 'wood', 'cowbell', 'rim', 'hat'] as const;
export type SoundId = (typeof SOUNDS)[number];

export type Unit = 2 | 4 | 8 | 16;

/** Everything a song stores. */
export interface Groove {
  bpm: number;
  beats: number;
  unit: Unit;
  tempoNote: TempoNote;
  /** Clicks per beat, 1–6. */
  subdivision: number;
  /** Percent of the beat (or half beat) given to the first note, 50–75. */
  swing: number;
  accents: Level[];
  sound: SoundId;
}

export interface Practice {
  trainer: { on: boolean; step: number; every: number; mode: 'bars' | 'seconds'; target: number };
  gap: { on: boolean; play: number; mute: number; random: boolean; chance: number };
  /** Bars of count-in, 0 for none. */
  countIn: number;
  timer: { on: boolean; amount: number; mode: 'bars' | 'minutes' };
}

export interface Settings {
  volume: number;
  subVolume: number;
  boost: boolean;
  flash: boolean;
  latencyMs: number;
}

export interface Song {
  id: string;
  name: string;
  groove: Groove;
}

export interface Setlist {
  id: string;
  name: string;
  songIds: string[];
}

export interface AppState {
  groove: Groove;
  practice: Practice;
  settings: Settings;
  songs: Song[];
  setlists: Setlist[];
  activeSongId: string | null;
  activeSetlistId: string | null;
}

export const BPM_MIN = 20;
export const BPM_MAX = 400;
