import type { Unit } from './types';

const NS = 'http://www.w3.org/2000/svg';

function node(tag: string, attrs: Record<string, string | number>, text = ''): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text) n.textContent = text;
  return n;
}

// Geometry, in SVG units: tuplet number on top, beams below it, note heads at the bottom.
const HEIGHT = 42;
const HEAD_Y = 36;
const STEM_TOP = 13;
const BEAM_GAP = 5;

/**
 * Draws how one click is divided, as music notation: `count` notes, beamed and
 * numbered as a tuplet where needed. `unit` is the bottom number of the time
 * signature, so 2 per click is a pair of eighths in /4 but sixteenths in /8.
 */
export function subdivisionIcon(count: number, unit: Unit): SVGElement {
  // Note value as a fraction of a whole note: 4 quarter, 8 eighth, 16 sixteenth…
  const value = count === 1 ? unit : count <= 3 ? unit * 2 : unit * 4;
  // Quarter notes and longer have no beams or flags.
  const beams = Math.max(0, Math.log2(value) - 2);
  const step = count > 4 ? 9 : 11;
  const pad = 6;
  const width = pad * 2 + (count - 1) * step + 6;
  const svg = node('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, width: width, height: HEIGHT, class: 'notes', 'aria-hidden': 'true' });

  const stems: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = pad + 1 + i * step;
    const head = node('ellipse', { cx: x, cy: HEAD_Y, rx: 4.2, ry: 3, transform: `rotate(-22 ${x} ${HEAD_Y})` });
    if (value === 2) {
      head.setAttribute('fill', 'none');
      head.setAttribute('stroke', 'currentColor');
      head.setAttribute('stroke-width', '1.6');
    }
    const sx = x + 3.6;
    stems.push(sx);
    svg.append(head, node('line', { x1: sx, y1: HEAD_Y - 1, x2: sx, y2: STEM_TOP, stroke: 'currentColor', 'stroke-width': 1.4 }));
  }

  for (let b = 0; b < beams; b++) {
    const y = STEM_TOP + b * BEAM_GAP;
    if (count > 1) {
      svg.append(node('rect', { x: stems[0] - 0.7, y, width: stems[count - 1] - stems[0] + 1.4, height: 3 }));
    } else {
      // A lone note carries flags instead of beams.
      const x = stems[0];
      svg.append(
        node('path', {
          d: `M${x} ${y} c1 4 6 5 5 11`,
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 1.8,
          'stroke-linecap': 'round',
        }),
      );
    }
  }

  if (count === 3 || count >= 5) {
    svg.append(
      node(
        'text',
        { x: (stems[0] + stems[count - 1]) / 2, y: 9, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, 'font-style': 'italic' },
        String(count),
      ),
    );
  }
  return svg;
}
