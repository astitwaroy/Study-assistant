import { clipToBox, createSimulation, fitView, nodeBox, optionsForArea, settle, tangle } from './forceLayout.js';
import { itemText } from './schema.js';

/** The zoom range the map allows. */
export const ZOOM = { min: 0.4, max: 2.5 };

/** Box size and wrapped lines for each concept. Narrow screens wrap sooner. */
export function boxesFor(nodes, area) {
  const wrapAt = area.w < 480 ? 14 : 18;
  return Object.fromEntries(nodes.map((n) => [n.id, nodeBox(n.label, { wrapAt })]));
}

/** Copies the parts of the simulation the picture needs. */
export function snapshot(sim) {
  return sim.nodes.map(({ id, x, y, w, h, fixed }) => ({ id, x, y, w, h, fixed }));
}

/**
 * The settled starting layout for a map shown in an `area`-sized space.
 * Force layouts can settle into a tangle depending on where they start, so
 * this tries several starts (a radial tree turned to 8 angles, a ring, and
 * seeded random scatters, each also mirrored) and keeps the least tangled.
 * Still deterministic: same input, same picture.
 */
export const STARTS = [
  ...Array.from({ length: 8 }, (_, i) => ({ radial: true, turn: i, mirror: i % 2 === 1 })),
  ...Array.from({ length: 8 }, (_, i) => ({ turn: i >> 1, mirror: i % 2 === 1 })),
  ...Array.from({ length: 8 }, (_, i) => ({ seed: i + 8 })),
];

export function buildLayout(block, area, pinned = {}, starts = STARTS) {
  const boxes = boxesFor(block.nodes, area);
  const options = optionsForArea(area.w, area.h, block.nodes.length);
  // Also counts link labels with no room, and maps that would have to be
  // shrunk (small text) or would leave the screen mostly empty.
  const score = (sim) => {
    const nodes = snapshot(sim);
    const hidden = block.edges.length - shownLabels(block.edges, nodes, null).size;
    const k = fitView(nodes, area.w, area.h, { maxScale: 5 }).k;
    const fill = k > 1.1 ? (k - 1.1) * 10 : k < 0.85 ? (0.85 - k) * 40 : 0;
    return tangle(sim, options.walls) + hidden * 0.25 + fill;
  };
  let best = null;
  for (const start of starts) {
    const sim = createSimulation(block.nodes, block.edges, { sizes: boxes, pinned, aspect: area.w / area.h, ...start });
    settle(sim, options);
    const s = score(sim);
    if (!best || s < best.score) best = { sim, score: s };
    if (s === 0) break;
  }
  return snapshot(best.sim);
}

/** A live simulation that starts from what's on screen now. */
export function simulationFrom(block, layout, boxes) {
  const sim = createSimulation(block.nodes, block.edges, { sizes: boxes });
  const byId = new Map(layout.map((n) => [n.id, n]));
  for (const node of sim.nodes) {
    const current = byId.get(node.id);
    if (current) Object.assign(node, { x: current.x, y: current.y, fixed: current.fixed });
  }
  sim.alpha = 0;
  return sim;
}

/**
 * Zooms by `factor` around a point on screen (sx, sy), keeping whatever is
 * under that point in place. The view maps a layout point p to the screen
 * as  centre + (x, y) + p * k.
 */
export function zoomAt(view, size, factor, sx = size.w / 2, sy = size.h / 2) {
  const k = Math.min(ZOOM.max, Math.max(ZOOM.min, view.k * factor));
  const px = (sx - size.w / 2 - view.x) / view.k;
  const py = (sy - size.h / 2 - view.y) / view.k;
  return { k, x: sx - size.w / 2 - px * k, y: sy - size.h / 2 - py * k };
}

export function toScreen(view, size, p) {
  return { x: size.w / 2 + view.x + p.x * view.k, y: size.h / 2 + view.y + p.y * view.k };
}

export function toLayout(view, size, sx, sy) {
  return { x: (sx - size.w / 2 - view.x) / view.k, y: (sy - size.h / 2 - view.y) / view.k };
}

/**
 * Moves the view just enough that a concept is fully on screen (used when
 * keyboard focus lands on one that's been panned out of sight).
 */
export function revealIn(view, size, node, margin = 16) {
  const c = toScreen(view, size, node);
  const halfW = (node.w * view.k) / 2 + margin;
  const halfH = (node.h * view.k) / 2 + margin;
  let { x, y } = view;
  if (c.x - halfW < 0) x += halfW - c.x;
  else if (c.x + halfW > size.w) x -= c.x + halfW - size.w;
  if (c.y - halfH < 0) y += halfH - c.y;
  else if (c.y + halfH > size.h) y -= c.y + halfH - size.h;
  return x === view.x && y === view.y ? view : { ...view, x, y };
}

/**
 * The line for a link: from box edge to box edge, so the arrowhead lands on
 * the outline. When two concepts link both ways, each link bows out to its
 * own side so they don't sit on top of each other.
 */
export function linkGeometry(a, b, curved = false) {
  const pad = 3;
  let ctrl = null;
  if (curved) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    ctrl = { x: (a.x + b.x) / 2 - (dy / len) * 26, y: (a.y + b.y) / 2 + (dx / len) * 26 };
  }
  const start = clipToBox(ctrl ?? b, a, { w: a.w + pad * 2, h: a.h + pad * 2 });
  const end = clipToBox(ctrl ?? a, b, { w: b.w + pad * 2, h: b.h + pad * 2 });
  const r = (v) => Math.round(v * 10) / 10;
  const d = ctrl
    ? `M${r(start.x)},${r(start.y)} Q${r(ctrl.x)},${r(ctrl.y)} ${r(end.x)},${r(end.y)}`
    : `M${r(start.x)},${r(start.y)} L${r(end.x)},${r(end.y)}`;
  const at = (t) =>
    ctrl
      ? {
          x: (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * ctrl.x + t * t * end.x,
          y: (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * ctrl.y + t * t * end.y,
        }
      : { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
  return { d, mid: at(0.5), at, length: Math.hypot(end.x - start.x, end.y - start.y) };
}

/** Rough width of a link label (11px Courier Prime: every letter is 0.6em). */
export const labelWidth = (text) => text.length * 6.6 + 8;

/**
 * Where to draw link labels, as a map of "from>to" -> { x, y }. Labels go
 * down one at a time (the focused concept's links first) at the middle of
 * their link, or a little either side of it, wherever they cover no card
 * and no label already placed. While a concept is in focus only its own
 * links are labelled, and the faded cards around them don't count as in
 * the way. A label with no clear spot is left off: every link is still in
 * the panel and the list view, and a label never hides a card.
 */
const LABEL_SPOTS = [0.5, 0.38, 0.62, 0.28, 0.72];

export function shownLabels(edges, layout, focus) {
  const byId = new Map(layout.map((n) => [n.id, n]));
  const both = new Set(edges.map((e) => `${e.from}>${e.to}`));
  const inFocus = focus ? new Set([focus, ...edges.filter((e) => e.from === focus || e.to === focus).flatMap((e) => [e.from, e.to])]) : null;
  const taken = layout.filter((n) => !inFocus || inFocus.has(n.id)).map((n) => ({ x: n.x, y: n.y, w: n.w + 4, h: n.h + 4 }));
  const shown = new Map();
  const ordered = focus ? [...edges].sort((a, b) => Number(b.from === focus || b.to === focus) - Number(a.from === focus || a.to === focus)) : edges;
  for (const edge of ordered) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b || !edge.label) continue;
    const isFocus = focus && (edge.from === focus || edge.to === focus);
    if (focus && !isFocus) continue;
    const g = linkGeometry(a, b, both.has(`${edge.to}>${edge.from}`));
    const w = labelWidth(edge.label);
    // A label may run a little past its line's ends, as long as it covers nothing.
    if (!isFocus && g.length < w * 0.7) continue;
    const clear = (box) => !taken.some((t) => Math.abs(t.x - box.x) < (t.w + box.w) / 2 && Math.abs(t.y - box.y) < (t.h + box.h) / 2);
    let spot = null;
    for (const t of LABEL_SPOTS) {
      const p = g.at(t);
      if (clear({ x: p.x, y: p.y, w, h: 14 })) {
        spot = p;
        break;
      }
    }
    if (!spot) continue;
    taken.push({ x: spot.x, y: spot.y, w, h: 14 });
    shown.set(`${edge.from}>${edge.to}`, spot);
  }
  return shown;
}

/** Concept id -> ids of the concepts it links to, in either direction. */
export function neighbours(edges) {
  const map = new Map();
  const add = (a, b) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a).add(b);
  };
  for (const e of edges) {
    add(e.from, e.to);
    add(e.to, e.from);
  }
  return map;
}

/** "Photosynthesis happens in Chloroplast" */
export function linkSentence(edge, labelOf) {
  return `${labelOf(edge.from)} ${edge.label ?? 'links to'} ${labelOf(edge.to)}`;
}

const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'its']);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Practice items that mention a concept: every meaningful word of its label
 * appears in the item (plurals and small endings allowed), so "ATP and
 * NADPH" finds a card about "NADPH and ATP".
 */
export function itemsMentioning(items, label) {
  const words = label
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  if (!words.length) return [];
  const patterns = words.map((w) => {
    const stem = w.length > 4 ? w.replace(/(es|s)$/, '') : w;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(stem)}[\\p{L}]{0,3}($|[^\\p{L}\\p{N}])`, 'iu');
  });
  return items.filter((item) => {
    const text = [itemText(item), item.back, item.explanation, typeof item.answer === 'string' ? item.answer : '']
      .filter(Boolean)
      .join(' ');
    return patterns.every((p) => p.test(text));
  });
}

/** Pinned positions read back from storage, keeping only concepts that still exist. */
export function validPins(stored, nodes) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return undefined;
  const ids = new Set(nodes.map((n) => n.id));
  const pins = {};
  for (const [id, value] of Object.entries(stored)) {
    if (ids.has(id) && Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)) pins[id] = value;
  }
  return pins;
}
