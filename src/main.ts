import './style.css';
import { askText, confirmDialog, el, pickSongs, toast } from './dialogs';
import { Engine } from './engine';
import { subdivisionIcon } from './notation';
import type { Slot } from './sequencer';
import {
  defaultAccents,
  exportLibrary,
  grooveLabel,
  importLibrary,
  canSwing,
  load,
  rhythmDetail,
  sameGroove,
  save,
  subdivisionName,
  swingLabel,
  swingPreset,
  uid,
} from './store';
import { BPM_MAX, BPM_MIN, type Level, type Setlist, type Song, type SoundId, type Unit } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const state = load();
const engine = new Engine(() => state);

/** Functions that copy state into the DOM; all run after any change. */
const syncers: Array<() => void> = [];
function syncAll(): void {
  for (const fn of syncers) fn();
}
function commit(): void {
  save(state);
  syncAll();
}

// ───────────────────────── form helpers ─────────────────────────

function seg(id: string, get: () => string, set: (v: string) => void): void {
  const root = $(id);
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
    if (!b) return;
    set(b.dataset.v!);
    commit();
  });
  syncers.push(() => {
    for (const b of root.querySelectorAll<HTMLButtonElement>('button[data-v]')) b.classList.toggle('on', b.dataset.v === get());
  });
}

function num(id: string, get: () => number, set: (v: number) => void, min: number, max: number): void {
  const input = $<HTMLInputElement>(id);
  input.min = String(min);
  input.max = String(max);
  input.addEventListener('change', () => {
    const v = Math.round(Number(input.value));
    if (input.value !== '' && Number.isFinite(v)) set(clamp(v, min, max));
    commit();
  });
  input.addEventListener('focus', () => input.select());
  syncers.push(() => {
    if (document.activeElement !== input) input.value = String(get());
  });
}

function check(id: string, get: () => boolean, set: (v: boolean) => void): void {
  const input = $<HTMLInputElement>(id);
  input.addEventListener('change', () => {
    set(input.checked);
    commit();
  });
  syncers.push(() => (input.checked = get()));
}

function range(id: string, get: () => number, set: (v: number) => void): void {
  const input = $<HTMLInputElement>(id);
  input.addEventListener('input', () => {
    set(Number(input.value));
    commit();
  });
  syncers.push(() => {
    if (document.activeElement !== input) input.value = String(get());
  });
}

// ───────────────────────── tempo ─────────────────────────

const bpmInput = $<HTMLInputElement>('bpm');
const dialRing = $('dial-ring');

const liveBpm = () => engine.bpm ?? state.groove.bpm;

function showBpm(bpm: number): void {
  if (document.activeElement !== bpmInput) bpmInput.value = String(bpm);
  dialRing.style.transform = `rotate(${(bpm * 6) % 360}deg)`;
}

function setBpm(bpm: number): void {
  const v = clamp(Math.round(bpm), BPM_MIN, BPM_MAX);
  state.groove.bpm = v;
  engine.setBpm(v);
  commit();
}

syncers.push(() => showBpm(liveBpm()));

bpmInput.addEventListener('focus', () => bpmInput.select());
bpmInput.addEventListener('change', () => {
  const v = Number(bpmInput.value);
  bpmInput.blur();
  if (bpmInput.value !== '' && Number.isFinite(v)) setBpm(v);
  else syncAll();
});
bpmInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') bpmInput.blur();
});

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-nudge]')) {
  b.addEventListener('click', () => setBpm(liveBpm() + Number(b.dataset.nudge)));
}

// Dial: one full turn is 60 BPM.
{
  const dial = $('dial');
  let last = 0;
  let turned = 0;
  let from = 0;
  const angle = (e: PointerEvent) => {
    const r = dial.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  dial.addEventListener('pointerdown', (e) => {
    if (e.target === bpmInput) return;
    e.preventDefault();
    bpmInput.blur();
    dial.setPointerCapture(e.pointerId);
    last = angle(e);
    turned = 0;
    from = liveBpm();
    dial.classList.add('turning');
  });
  dial.addEventListener('pointermove', (e) => {
    if (!dial.hasPointerCapture(e.pointerId)) return;
    const a = angle(e);
    let d = a - last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    last = a;
    turned += d;
    const target = clamp(from + Math.round(turned / 6), BPM_MIN, BPM_MAX);
    if (target !== liveBpm()) setBpm(target);
  });
  const end = () => dial.classList.remove('turning');
  dial.addEventListener('pointerup', end);
  dial.addEventListener('pointercancel', end);
  dial.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setBpm(liveBpm() + (e.deltaY < 0 ? 1 : -1));
    },
    { passive: false },
  );
}

// Tap tempo: average of the recent taps, starting over after a 2 s pause.
let taps: number[] = [];
function tap(): void {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length > 6) taps.shift();
  if (taps.length >= 2) setBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
}
$('tap').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  tap();
});

// ───────────────────────── beats and meter ─────────────────────────

const beatsEl = $('beats');
const subdotsEl = $('subdots');

function renderBeats(): void {
  const g = state.groove;
  beatsEl.replaceChildren(
    ...g.accents.map((level, i) => {
      const b = el('button', `beat lvl-${level}`);
      b.dataset.i = String(i);
      b.setAttribute('aria-label', `Beat ${i + 1}: ${['muted', 'normal', 'accent', 'strong accent'][level]}`);
      b.append(el('span'));
      return b;
    }),
  );
  beatsEl.classList.toggle('many', g.beats > 10);
  subdotsEl.replaceChildren(...(g.subdivision > 1 ? Array.from({ length: g.subdivision }, () => el('i')) : []));
}
syncers.push(renderBeats);

beatsEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.beat');
  if (!b) return;
  const i = Number(b.dataset.i);
  // Tapping steps down through strong, accent, normal, muted and back round.
  state.groove.accents[i] = ((state.groove.accents[i] + 3) % 4) as Level;
  commit();
});

function setMeter(beats: number, unit: Unit): void {
  const g = state.groove;
  const accentsWereDefault = sameAccents(g.accents, defaultAccents(g.beats, g.unit));
  g.beats = clamp(beats, 1, 20);
  g.unit = unit;
  if (accentsWereDefault) g.accents = defaultAccents(g.beats, unit);
  else g.accents = Array.from({ length: g.beats }, (_, i) => g.accents[i] ?? 1);
  commit();
}
const sameAccents = (a: Level[], b: Level[]) => a.length === b.length && a.every((v, i) => v === b[i]);

const sigDlg = $<HTMLDialogElement>('sig-dlg');
$('rhythm-btn').addEventListener('click', () => sigDlg.showModal());
$('beats-dec').addEventListener('click', () => setMeter(state.groove.beats - 1, state.groove.unit));
$('beats-inc').addEventListener('click', () => setMeter(state.groove.beats + 1, state.groove.unit));
$('accents-reset').addEventListener('click', () => {
  state.groove.accents = defaultAccents(state.groove.beats, state.groove.unit);
  commit();
});
seg(
  'unit',
  () => String(state.groove.unit),
  (v) => setMeter(state.groove.beats, Number(v) as Unit),
);
syncers.push(() => {
  const g = state.groove;
  $('rhythm-sig').textContent = `${g.beats}/${g.unit}`;
  $('sig-beats').textContent = String(g.beats);
  $('sig-unit').textContent = String(g.unit);
});

seg(
  'subdivision',
  () => String(state.groove.subdivision),
  (v) => (state.groove.subdivision = Number(v)),
);
seg(
  'swing',
  () => String(swingPreset(state.groove.swing).value),
  (v) => (state.groove.swing = Number(v)),
);
syncers.push(() => {
  const g = state.groove;
  for (const b of $('subdivision').querySelectorAll<HTMLButtonElement>('button')) {
    const count = Number(b.dataset.v);
    const name = count === 1 ? 'No subdivision' : subdivisionName(count, g.unit);
    b.replaceChildren(subdivisionIcon(count, g.unit));
    b.setAttribute('aria-label', name);
    b.title = name;
  }
  const swingOk = canSwing(g);
  for (const b of $('swing').querySelectorAll<HTMLButtonElement>('button')) b.disabled = !swingOk;
  $('rhythm-notes').replaceChildren(subdivisionIcon(g.subdivision, g.unit));
  $('rhythm-detail').textContent = swingLabel(g);
  $('rhythm-btn').setAttribute('aria-label', `Rhythm: ${g.beats}/${g.unit}, ${rhythmDetail(g) || 'no subdivision'}`);
});

// ───────────────────────── practice ─────────────────────────

const p = state.practice;
check('tr-on', () => p.trainer.on, (v) => (p.trainer.on = v));
num('tr-step', () => p.trainer.step, (v) => (p.trainer.step = v), 1, 50);
num('tr-every', () => p.trainer.every, (v) => (p.trainer.every = v), 1, 600);
seg('tr-mode', () => p.trainer.mode, (v) => (p.trainer.mode = v as 'bars' | 'seconds'));
num('tr-target', () => p.trainer.target, (v) => (p.trainer.target = v), BPM_MIN, BPM_MAX);
check('tr-stop', () => p.trainer.stop, (v) => (p.trainer.stop = v));
check('gap-on', () => p.gap.on, (v) => (p.gap.on = v));
num('gap-play', () => p.gap.play, (v) => (p.gap.play = v), 1, 64);
num('gap-mute', () => p.gap.mute, (v) => (p.gap.mute = v), 1, 64);
check('gap-random', () => p.gap.random, (v) => (p.gap.random = v));
num('gap-chance', () => p.gap.chance, (v) => (p.gap.chance = v), 5, 95);
seg('count-in', () => String(p.countIn), (v) => (p.countIn = Number(v)));
check('timer-on', () => p.timer.on, (v) => (p.timer.on = v));
num('timer-amount', () => p.timer.amount, (v) => (p.timer.amount = v), 1, 999);
seg('timer-mode', () => p.timer.mode, (v) => (p.timer.mode = v as 'bars' | 'minutes'));
syncers.push(() => {
  $<HTMLInputElement>('gap-play').disabled = $<HTMLInputElement>('gap-mute').disabled = p.gap.random;
  $<HTMLInputElement>('gap-chance').disabled = !p.gap.random;
});

// ───────────────────────── settings ─────────────────────────

const s = state.settings;
seg(
  'sound',
  () => state.groove.sound,
  (v) => {
    state.groove.sound = v as SoundId;
    if (!engine.playing) void engine.preview();
  },
);
range('volume', () => s.volume, (v) => (s.volume = v));
range('sub-volume', () => s.subVolume, (v) => (s.subVolume = v));
check('boost', () => s.boost, (v) => (s.boost = v));
check('flash-on', () => s.flash, (v) => (s.flash = v));
range('latency', () => s.latencyMs, (v) => (s.latencyMs = v));
syncers.push(() => {
  $('latency-out').textContent = `${s.latencyMs} ms`;
  engine.applyVolume();
});

// ───────────────────────── transport ─────────────────────────

const playBtn = $('play');
const statusEl = $('status');
const flashEl = $('flash');
let current: Slot | null = null;

let wakeLock: WakeLockSentinel | null = null;
async function holdScreen(on: boolean): Promise<void> {
  try {
    if (on && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on) {
      await wakeLock?.release();
      wakeLock = null;
    }
  } catch {
    /* not supported, or refused (for example on low battery) */
  }
}
document.addEventListener('visibilitychange', () => {
  if (engine.playing && document.visibilityState === 'visible') void holdScreen(true);
});

function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function renderStatus(): void {
  const chips: Array<[string, boolean]> = [];
  if (current) {
    if (current.countIn) chips.push(['Count-in', true]);
    else chips.push([`Bar ${current.bar + 1} · ${clock(current.elapsed)}`, false]);
    if (current.muted) chips.push(['Muted', true]);
  }
  if (p.trainer.on) chips.push([`Trainer → ${p.trainer.target}`, false]);
  if (p.gap.on) chips.push([p.gap.random ? `Gap ${p.gap.chance}%` : `Gap ${p.gap.play}/${p.gap.mute}`, false]);
  if (!current && p.countIn) chips.push([`Count-in ${p.countIn}`, false]);
  if (p.timer.on) chips.push([`Stops at ${p.timer.amount} ${p.timer.mode === 'bars' ? 'bars' : 'min'}`, false]);
  statusEl.replaceChildren(...chips.map(([text, hot]) => el('span', hot ? 'chip hot' : 'chip', text)));
}
syncers.push(renderStatus);

engine.onSlot = (slot) => {
  const beats = beatsEl.children;
  if (slot.sub === 0) {
    current = slot;
    for (let i = 0; i < beats.length; i++) beats[i].classList.toggle('active', i === slot.beat);
    beats[slot.beat]?.firstElementChild?.animate(
      [{ transform: 'scaleY(1.12)', filter: 'brightness(1.6)' }, { transform: 'scaleY(1)', filter: 'brightness(1)' }],
      { duration: 140, easing: 'ease-out' },
    );
    beatsEl.classList.toggle('ghost', slot.muted);
    if (state.settings.flash && slot.beat === 0 && !slot.muted) {
      flashEl.animate([{ opacity: 0.4 }, { opacity: 0 }], { duration: 130, easing: 'ease-out' });
    }
    showBpm(slot.bpm);
    renderStatus();
  }
  const dots = subdotsEl.children;
  for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('active', i === slot.sub);
};

function showStopped(): void {
  current = null;
  playBtn.textContent = 'Start';
  playBtn.classList.remove('on');
  beatsEl.classList.remove('ghost');
  void holdScreen(false);
  syncAll();
}

engine.onEnd = (reason) => {
  showStopped();
  toast(reason === 'trainer' ? 'Tempo trainer finished' : 'Practice timer finished');
};

async function start(): Promise<void> {
  try {
    await engine.start();
  } catch {
    toast('Could not start audio on this device');
    return;
  }
  playBtn.textContent = 'Stop';
  playBtn.classList.add('on');
  void holdScreen(true);
}

function toggle(): void {
  if (engine.playing) {
    engine.stop();
    showStopped();
  } else void start();
}
playBtn.addEventListener('click', toggle);

// ───────────────────────── songs and setlists ─────────────────────────

const songsEl = $('view-songs');
const findSong = (id: string | null) => state.songs.find((x) => x.id === id) ?? null;
const activeSetlist = (): Setlist | null => state.setlists.find((l) => l.id === state.activeSetlistId) ?? null;

/** The songs that previous/next step through: the open setlist, or the whole library. */
function playlist(): Song[] {
  const list = activeSetlist();
  if (!list) return state.songs;
  return list.songIds.map(findSong).filter((x): x is Song => x !== null);
}

function loadSong(song: Song): void {
  state.groove = structuredClone(song.groove);
  state.activeSongId = song.id;
  commit();
  if (engine.playing) void start();
}

function stepSong(dir: number): void {
  const list = playlist();
  if (!list.length) return;
  const i = list.findIndex((x) => x.id === state.activeSongId);
  const next = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
  if (next >= 0 && next < list.length) loadSong(list[next]);
}
$('song-prev').addEventListener('click', () => stepSong(-1));
$('song-next').addEventListener('click', () => stepSong(1));

syncers.push(() => {
  const song = findSong(state.activeSongId);
  const list = playlist();
  const i = list.findIndex((x) => x.id === state.activeSongId);
  const edited = song !== null && !sameGroove(song.groove, state.groove);
  $('song-name').textContent = song ? song.name + (edited ? ' (edited)' : '') : 'No song loaded';
  const where = activeSetlist()?.name ?? 'All songs';
  $('song-meta').textContent = list.length ? `${where}${i >= 0 ? ` · ${i + 1} of ${list.length}` : ''}` : 'Save one from the Songs tab';
  $<HTMLButtonElement>('song-prev').disabled = !list.length || i === 0;
  $<HTMLButtonElement>('song-next').disabled = !list.length || i === list.length - 1;
});

function iconBtn(label: string, glyph: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el('button', 'icon-btn', glyph);
  b.setAttribute('aria-label', label);
  b.title = label;
  b.disabled = disabled;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function songRow(song: Song, actions: HTMLButtonElement[]): HTMLElement {
  const row = el('div', song.id === state.activeSongId ? 'row current' : 'row');
  const main = el('button', 'row-main');
  main.append(el('b', '', song.name), el('small', 'dim', grooveLabel(song.groove)));
  main.addEventListener('click', () => loadSong(song));
  row.append(main, ...actions);
  return row;
}

async function saveNewSong(): Promise<void> {
  const name = await askText('Name this song');
  if (!name) return;
  const song: Song = { id: uid(), name, groove: structuredClone(state.groove) };
  state.songs.push(song);
  activeSetlist()?.songIds.push(song.id);
  state.activeSongId = song.id;
  commit();
}

async function renameSong(song: Song): Promise<void> {
  const name = await askText('Rename song', song.name);
  if (!name) return;
  song.name = name;
  commit();
}

async function deleteSong(song: Song): Promise<void> {
  if (!(await confirmDialog(`Delete "${song.name}"?`, 'It will also be removed from every setlist.', 'Delete'))) return;
  state.songs = state.songs.filter((x) => x.id !== song.id);
  for (const l of state.setlists) l.songIds = l.songIds.filter((id) => id !== song.id);
  if (state.activeSongId === song.id) state.activeSongId = null;
  commit();
}

async function newSetlist(): Promise<void> {
  const name = await askText('Name this setlist');
  if (!name) return;
  const list: Setlist = { id: uid(), name, songIds: [] };
  state.setlists.push(list);
  state.activeSetlistId = list.id;
  commit();
}

async function addToSetlist(list: Setlist): Promise<void> {
  const candidates = state.songs.filter((x) => !list.songIds.includes(x.id));
  if (!candidates.length) {
    toast(state.songs.length ? 'Every song is already in this setlist' : 'Save a song first');
    return;
  }
  const ids = await pickSongs(`Add to ${list.name}`, candidates);
  if (!ids?.length) return;
  list.songIds.push(...ids);
  commit();
}

function moveInSetlist(list: Setlist, i: number, dir: number): void {
  const j = i + dir;
  if (j < 0 || j >= list.songIds.length) return;
  [list.songIds[i], list.songIds[j]] = [list.songIds[j], list.songIds[i]];
  commit();
}

function exportFile(): void {
  const url = URL.createObjectURL(new Blob([exportLibrary(state)], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = `tempo-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const importInput = $<HTMLInputElement>('import-file');
importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  importInput.value = '';
  if (!file) return;
  try {
    const n = importLibrary(state, await file.text());
    commit();
    toast(`Imported ${n.songs} songs and ${n.setlists} setlists`);
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file is not valid JSON' : (err as Error).message);
  }
});

function renderSongs(): void {
  const list = activeSetlist();
  const active = findSong(state.activeSongId);
  const nodes: HTMLElement[] = [];

  const barCard = el('div', 'card');
  const barField = el('label', 'field');
  const barSwitch = el('input', 'switch');
  barSwitch.type = 'checkbox';
  barSwitch.checked = s.songBar;
  barSwitch.addEventListener('change', () => {
    s.songBar = barSwitch.checked;
    commit();
  });
  barField.append(el('span', '', 'Show song bar above the click'), barSwitch);
  barCard.append(barField);
  nodes.push(barCard);

  const saveRow = el('div', 'button-row');
  const saveNew = el('button', 'btn primary', 'Save current as song');
  saveNew.addEventListener('click', () => void saveNewSong());
  saveRow.append(saveNew);
  if (active && !sameGroove(active.groove, state.groove)) {
    const update = el('button', 'btn', `Update "${active.name}"`);
    update.addEventListener('click', () => {
      active.groove = structuredClone(state.groove);
      commit();
      toast('Song updated');
    });
    saveRow.append(update);
  }
  nodes.push(saveRow);

  const tabs = el('div', 'seg wrap setlist-tabs');
  const tab = (label: string, id: string | null) => {
    const b = el('button', state.activeSetlistId === id ? 'on' : '', label);
    b.addEventListener('click', () => {
      state.activeSetlistId = id;
      commit();
    });
    return b;
  };
  const add = el('button', '', '+ Setlist');
  add.addEventListener('click', () => void newSetlist());
  tabs.append(tab('All songs', null), ...state.setlists.map((l) => tab(l.name, l.id)), add);
  nodes.push(tabs);

  const card = el('div', 'card list');
  if (list) {
    const head = el('div', 'card-head');
    const tools = el('div', 'tools');
    tools.append(
      iconBtn('Rename setlist', '✎', async () => {
        const name = await askText('Rename setlist', list.name);
        if (name) {
          list.name = name;
          commit();
        }
      }),
      iconBtn('Delete setlist', '🗑', async () => {
        if (!(await confirmDialog(`Delete "${list.name}"?`, 'The songs themselves are kept.', 'Delete'))) return;
        state.setlists = state.setlists.filter((l) => l !== list);
        state.activeSetlistId = null;
        commit();
      }),
    );
    head.append(el('span', '', list.name), tools);
    card.append(head);
    const songs = playlist();
    songs.forEach((song, i) =>
      card.append(
        songRow(song, [
          iconBtn('Move up', '↑', () => moveInSetlist(list, i, -1), i === 0),
          iconBtn('Move down', '↓', () => moveInSetlist(list, i, 1), i === songs.length - 1),
          iconBtn('Remove from setlist', '✕', () => {
            list.songIds.splice(i, 1);
            commit();
          }),
        ]),
      ),
    );
    if (!songs.length) card.append(el('p', 'dim empty', 'This setlist is empty.'));
    const addSongs = el('button', 'btn', 'Add songs');
    addSongs.addEventListener('click', () => void addToSetlist(list));
    card.append(addSongs);
  } else {
    for (const song of state.songs) {
      card.append(
        songRow(song, [
          iconBtn('Rename song', '✎', () => void renameSong(song)),
          iconBtn('Delete song', '🗑', () => void deleteSong(song)),
        ]),
      );
    }
    if (!state.songs.length) {
      card.append(el('p', 'dim empty', 'No songs yet. Set the click up how you want it, then save it as a song.'));
    }
  }
  nodes.push(card);

  const backup = el('div', 'card');
  const row = el('div', 'button-row');
  const exp = el('button', 'btn', 'Export');
  exp.addEventListener('click', exportFile);
  const imp = el('button', 'btn', 'Import');
  imp.addEventListener('click', () => importInput.click());
  row.append(exp, imp);
  backup.append(
    el('div', 'card-head', 'Backup'),
    el('p', 'dim', 'Songs live on this device only. Export a file here and import it on your other device to copy them across.'),
    row,
  );
  nodes.push(backup);

  songsEl.replaceChildren(...nodes);
}
syncers.push(renderSongs);

// ───────────────────────── navigation and keyboard ─────────────────────────

const sideToggle = $('side-toggle');
function toggleSide(): void {
  s.sideOpen = !s.sideOpen;
  commit();
}
sideToggle.addEventListener('click', toggleSide);
syncers.push(() => {
  document.body.classList.toggle('side-open', s.sideOpen);
  sideToggle.setAttribute('aria-expanded', String(s.sideOpen));
  sideToggle.textContent = s.sideOpen ? 'Close menu' : 'Menu';
  $('songbar').hidden = !s.songBar;
});

for (const b of document.querySelectorAll<HTMLButtonElement>('.nav button')) {
  b.addEventListener('click', () => (document.body.dataset.tab = b.dataset.tab));
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  const target = e.target as HTMLElement;
  if (target.matches('input:not([type=checkbox]):not([type=range]), textarea, select')) return;
  const step = e.shiftKey ? 5 : 1;
  switch (e.key) {
    case ' ':
      (document.activeElement as HTMLElement | null)?.blur();
      toggle();
      break;
    case 'ArrowUp':
      setBpm(liveBpm() + step);
      break;
    case 'ArrowDown':
      setBpm(liveBpm() - step);
      break;
    case 't':
    case 'T':
      tap();
      break;
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
      state.groove.subdivision = Number(e.key);
      commit();
      break;
    case 'm':
    case 'M':
      toggleSide();
      break;
    case '[':
      stepSong(-1);
      break;
    case ']':
      stepSong(1);
      break;
    default:
      return;
  }
  e.preventDefault();
});

syncAll();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js'));
}
