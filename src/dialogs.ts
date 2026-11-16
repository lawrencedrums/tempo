import type { Song } from './types';
import { grooveLabel } from './store';

const dlg = document.getElementById('dlg') as HTMLDialogElement;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function show(title: string, body: Node[], okLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const form = el('form');
    form.method = 'dialog';
    const actions = el('div', 'dlg-actions');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.onclick = () => dlg.close('cancel');
    const ok = el('button', danger ? 'btn danger' : 'btn primary', okLabel);
    ok.value = 'ok';
    actions.append(cancel, ok);
    form.append(el('h3', '', title), ...body, actions);
    dlg.replaceChildren(form);
    dlg.returnValue = '';
    dlg.onclose = () => resolve(dlg.returnValue === 'ok');
    dlg.showModal();
  });
}

export async function askText(title: string, value = '', okLabel = 'Save'): Promise<string | null> {
  const input = el('input');
  input.value = value;
  input.maxLength = 60;
  input.autocomplete = 'off';
  input.required = true;
  const done = show(title, [input], okLabel);
  input.select();
  return (await done) ? input.value.trim() || null : null;
}

export function confirmDialog(title: string, message: string, okLabel: string): Promise<boolean> {
  return show(title, [el('p', 'dim', message)], okLabel, true);
}

export async function pickSongs(title: string, songs: Song[]): Promise<string[] | null> {
  const list = el('div', 'picklist');
  const boxes = songs.map((s) => {
    const row = el('label', 'pick');
    const box = el('input');
    box.type = 'checkbox';
    box.value = s.id;
    const text = el('span');
    text.append(el('b', '', s.name), el('small', 'dim', grooveLabel(s.groove)));
    row.append(box, text);
    list.append(row);
    return box;
  });
  const ok = await show(title, [list], 'Add');
  return ok ? boxes.filter((b) => b.checked).map((b) => b.value) : null;
}

let toastTimer = 0;
export function toast(message: string): void {
  const node = document.getElementById('toast')!;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove('show'), 2600);
}
