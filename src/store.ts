import {
  BPM_MAX,
  BPM_MIN,
  SOUNDS,
  type AppState,
  type Groove,
  type Level,
  type Practice,
  type Setlist,
  type Settings,
  type Song,
  type SoundId,
  type TempoNote,
  type Unit,
} from './types';

const KEY = 'downbeat:v1';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

function int(x: unknown, min: number, max: number, def: number): number {
  const n = Math.round(Number(x));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

function real(x: unknown, min: number, max: number, def: number): number {
  const n = Number(x);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

const oneOf = <T>(x: unknown, options: readonly T[], def: T): T => (options.includes(x as T) ? (x as T) : def);

const str = (x: unknown, def: string): string => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 60) : def);

export const uid = (): string =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Compound meters (6/8, 9/8, 12/8) count dotted quarters; other /8 and /16 count quarters. */
export function defaultTempoNote(beats: number, unit: Unit): TempoNote {
  if (unit === 8 && beats >= 6 && beats % 3 === 0) return 'dotted';
  return unit >= 8 ? 'quarter' : 'beat';
}

export function defaultAccents(beats: number, tempoNote: TempoNote): Level[] {
  return Array.from({ length: beats }, (_, i): Level => (i === 0 ? 3 : tempoNote === 'dotted' && i % 3 === 0 ? 2 : 1));
}

export function sanitizeGroove(x: unknown): Groove {
  const o = isObj(x) ? x : {};
  const beats = int(o.beats, 1, 20, 4);
  const unit = oneOf<Unit>(o.unit, [2, 4, 8, 16], 4);
  const tempoNote = oneOf<TempoNote>(o.tempoNote, ['beat', 'quarter', 'dotted'], defaultTempoNote(beats, unit));
  const given = Array.isArray(o.accents) ? o.accents : null;
  const fallback = defaultAccents(beats, tempoNote);
  return {
    bpm: int(o.bpm, BPM_MIN, BPM_MAX, 120),
    beats,
    unit,
    tempoNote,
    subdivision: int(o.subdivision, 1, 6, 1),
    swing: int(o.swing, 50, 75, 50),
    accents: fallback.map((def, i) => (given ? (int(given[i], 0, 3, def) as Level) : def)),
    sound: oneOf<SoundId>(o.sound, SOUNDS, 'click'),
  };
}

function sanitizePractice(x: unknown): Practice {
  const o = isObj(x) ? x : {};
  const tr = isObj(o.trainer) ? o.trainer : {};
  const gap = isObj(o.gap) ? o.gap : {};
  const timer = isObj(o.timer) ? o.timer : {};
  return {
    trainer: {
      on: tr.on === true,
      step: int(tr.step, 1, 50, 5),
      every: int(tr.every, 1, 600, 4),
      mode: oneOf(tr.mode, ['bars', 'seconds'] as const, 'bars'),
      target: int(tr.target, BPM_MIN, BPM_MAX, 200),
    },
    gap: {
      on: gap.on === true,
      play: int(gap.play, 1, 64, 2),
      mute: int(gap.mute, 1, 64, 2),
      random: gap.random === true,
      chance: int(gap.chance, 5, 95, 30),
    },
    countIn: oneOf(o.countIn, [0, 1, 2, 4], 0),
    timer: {
      on: timer.on === true,
      amount: int(timer.amount, 1, 999, 5),
      mode: oneOf(timer.mode, ['bars', 'minutes'] as const, 'minutes'),
    },
  };
}

function sanitizeSettings(x: unknown): Settings {
  const o = isObj(x) ? x : {};
  return {
    volume: real(o.volume, 0, 1, 0.8),
    subVolume: real(o.subVolume, 0, 1, 0.5),
    boost: o.boost === true,
    flash: o.flash === true,
    latencyMs: int(o.latencyMs, 0, 500, 0),
  };
}

function sanitizeSongs(x: unknown): Song[] {
  if (!Array.isArray(x)) return [];
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const s of x) {
    if (!isObj(s) || typeof s.id !== 'string' || !s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, name: str(s.name, 'Untitled'), groove: sanitizeGroove(s.groove) });
  }
  return out;
}

function sanitizeSetlists(x: unknown, songs: Song[]): Setlist[] {
  if (!Array.isArray(x)) return [];
  const known = new Set(songs.map((s) => s.id));
  const seen = new Set<string>();
  const out: Setlist[] = [];
  for (const l of x) {
    if (!isObj(l) || typeof l.id !== 'string' || !l.id || seen.has(l.id)) continue;
    seen.add(l.id);
    const ids = Array.isArray(l.songIds) ? l.songIds.filter((id): id is string => typeof id === 'string') : [];
    out.push({ id: l.id, name: str(l.name, 'Setlist'), songIds: ids.filter((id) => known.has(id)) });
  }
  return out;
}

function sanitizeState(x: unknown): AppState {
  const o = isObj(x) ? x : {};
  const songs = sanitizeSongs(o.songs);
  const setlists = sanitizeSetlists(o.setlists, songs);
  return {
    groove: sanitizeGroove(o.groove),
    practice: sanitizePractice(o.practice),
    settings: sanitizeSettings(o.settings),
    songs,
    setlists,
    activeSongId: songs.some((s) => s.id === o.activeSongId) ? (o.activeSongId as string) : null,
    activeSetlistId: setlists.some((l) => l.id === o.activeSetlistId) ? (o.activeSetlistId as string) : null,
  };
}

export function load(): AppState {
  try {
    return sanitizeState(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return sanitizeState(null);
  }
}

let timer = 0;
let latest: AppState | null = null;

function flush(): void {
  clearTimeout(timer);
  if (!latest) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(latest));
  } catch {
    /* storage full or blocked: the app still works for this visit */
  }
  latest = null;
}

/** Debounced, so dragging the tempo dial does not write on every step. */
export function save(state: AppState): void {
  latest = state;
  clearTimeout(timer);
  timer = window.setTimeout(flush, 250);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.hidden && flush());
}

export function exportLibrary(state: AppState): string {
  return JSON.stringify({ app: 'downbeat', version: 1, songs: state.songs, setlists: state.setlists }, null, 2);
}

/** Merges a backup into the library: items with a known id are replaced, the rest are added. */
export function importLibrary(state: AppState, text: string): { songs: number; setlists: number } {
  const data: unknown = JSON.parse(text);
  if (!isObj(data) || data.app !== 'downbeat') throw new Error('Not a Downbeat backup file');
  const songs = sanitizeSongs(data.songs);
  for (const s of songs) {
    const i = state.songs.findIndex((x) => x.id === s.id);
    if (i >= 0) state.songs[i] = s;
    else state.songs.push(s);
  }
  const setlists = sanitizeSetlists(data.setlists, state.songs);
  for (const l of setlists) {
    const i = state.setlists.findIndex((x) => x.id === l.id);
    if (i >= 0) state.setlists[i] = l;
    else state.setlists.push(l);
  }
  return { songs: songs.length, setlists: setlists.length };
}

export const sameGroove = (a: Groove, b: Groove): boolean => JSON.stringify(a) === JSON.stringify(b);

export function grooveLabel(g: Groove): string {
  const sub = g.subdivision > 1 ? ` · ÷${g.subdivision}` : '';
  return `${g.bpm} BPM · ${g.beats}/${g.unit}${sub}`;
}
