/**
 * A small force-directed layout for the concept map, written from scratch
 * (no d3) so every force is easy to explain:
 *
 *   repulsion  every pair of concepts pushes apart (inverse square), so
 *              nothing piles up. Distance is measured in "box sizes", so
 *              wide cards keep more room beside them than above them
 *   springs    each link pulls its two concepts towards a set distance
 *   gravity    a gentle pull to the middle keeps separate clusters close;
 *              weaker along the long side of the screen, so a phone gets
 *              a tall map and a laptop a wide one
 *   clearance  a concept sitting on a link it isn't part of is nudged off
 *              it, so links don't run underneath other cards
 *   collision  concepts are drawn as boxes, so overlapping boxes are
 *              pushed apart along whichever axis overlaps least
 *   walls      optionally, concepts stay inside a box the size of the
 *              screen, so the whole map fits at 100% on a phone too
 *
 * `alpha` is the simulation's "temperature". It starts at 1 and decays
 * every tick, so forces fade out and the layout settles instead of
 * jittering forever. Dragging a concept heats it back up a little.
 *
 * Positions are in layout units centred on (0, 0). Everything here is
 * deterministic: the same concepts and links always give the same picture.
 */

export const DEFAULTS = {
  repulsion: 12_000,
  linkDistance: 150,
  linkStrength: 0.4,
  gravity: 0.04,
  clearance: 1,
  damping: 0.6,
  alphaDecay: 0.015,
  alphaMin: 0.005,
  padding: 14, // minimum gap between boxes
};

/** Size of a concept's box from its label. Long labels wrap onto two lines. */
export function nodeBox(label, { charWidth = 7.4, lineHeight = 17, padX = 12, padY = 10, wrapAt = 18 } = {}) {
  const lines = wrapLabel(label, wrapAt);
  const longest = Math.max(...lines.map((l) => l.length));
  return { lines, w: Math.round(longest * charWidth + padX * 2), h: Math.round(lines.length * lineHeight + padY * 2 + 4) };
}

export function wrapLabel(label, wrapAt = 18) {
  if (label.length <= wrapAt) return [label];
  const words = label.split(' ');
  if (words.length === 1) return [label];
  // Break at the space that makes the two lines most even.
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

/**
 * Starting positions: the most connected concept in the middle, the rest
 * evenly round an oval (wide on a wide screen, tall on a phone) in their
 * original order. Concepts in `pinned` start where the person left them
 * and stay there.
 */
/** A tiny seeded random number generator (mulberry32), so "random" starts repeat exactly. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSimulation(nodes, edges, { sizes = {}, pinned = {}, aspect = 1.6, turn = 0, mirror = false, seed = null, radial = false } = {}) {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const links = edges
    .map((e) => ({ source: index.get(e.from), target: index.get(e.to) }))
    .filter((l) => l.source !== undefined && l.target !== undefined);

  const degree = nodes.map(() => 0);
  for (const l of links) {
    degree[l.source] += 1;
    degree[l.target] += 1;
  }
  const hub = degree.indexOf(Math.max(...degree));
  // Walk outwards from the hub so linked concepts start next to each other
  // on the ring: fewer crossed links for the forces to untangle.
  const adjacent = nodes.map(() => []);
  for (const l of links) {
    adjacent[l.source].push(l.target);
    adjacent[l.target].push(l.source);
  }
  const order = [hub];
  for (let i = 0; i < order.length; i++) for (const next of adjacent[order[i]]) if (!order.includes(next)) order.push(next);
  for (let i = 0; i < nodes.length; i++) if (!order.includes(i)) order.push(i);
  const ring = order.slice(1);

  // Radial start: the hub in the middle, each step away from it on a wider
  // ring, and every branch given a slice of the circle sized by how many
  // ends it has, so branches start apart and their links don't cross.
  const radialSpot = new Map();
  if (radial) {
    const parent = new Map([[hub, null]]);
    const depth = new Map([[hub, 0]]);
    for (const i of order) {
      for (const next of adjacent[i]) {
        if (!parent.has(next)) {
          parent.set(next, i);
          depth.set(next, depth.get(i) + 1);
        }
      }
    }
    const children = new Map(order.map((i) => [i, order.filter((j) => parent.get(j) === i)]));
    const leaves = new Map();
    const countLeaves = (i) => {
      const kids = children.get(i);
      const total = kids.length ? kids.reduce((sum, k) => sum + countLeaves(k), 0) : 1;
      leaves.set(i, total);
      return total;
    };
    countLeaves(hub);
    const place = (i, from, to) => {
      radialSpot.set(i, { angle: (from + to) / 2, depth: depth.get(i) ?? 1 });
      let start = from;
      for (const k of children.get(i)) {
        const span = ((to - from) * leaves.get(k)) / leaves.get(i);
        place(k, start, start + span);
        start += span;
      }
    };
    const offset = (turn / 8) * Math.PI * 2;
    place(hub, offset, offset + Math.PI * 2);
  }
  const radius = 70 + ring.length * 14;
  const stretch = Math.sqrt(Math.min(Math.max(aspect, 0.5), 2.5));
  const random = seed === null ? null : seeded(seed);

  const simNodes = nodes.map((n, i) => {
    const size = sizes[n.id] ?? { w: 120, h: 40 };
    const base = { id: n.id, vx: 0, vy: 0, w: size.w, h: size.h, fixed: false };
    const pin = pinned[n.id];
    if (pin) return { ...base, x: pin[0], y: pin[1], fixed: true };
    const spot = radialSpot.get(i);
    if (spot) {
      if (spot.depth === 0) return { ...base, x: 0, y: 0 };
      const r = spot.depth * 110;
      const x = Math.cos(spot.angle) * r * stretch;
      return { ...base, x: mirror ? -x : x, y: Math.sin(spot.angle) * (r / stretch) };
    }
    if (random) return { ...base, x: (random() - 0.5) * radius * 2 * stretch, y: (random() - 0.5) * radius * 2 / stretch };
    if (i === hub) return { ...base, x: 0, y: 0 };
    const angle = ((ring.indexOf(i) + turn) / ring.length) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius * stretch;
    return { ...base, x: mirror ? -x : x, y: Math.sin(angle) * (radius / stretch) };
  });

  return { nodes: simNodes, links, alpha: 1 };
}

/** Advances the simulation one step. Mutates `sim` for speed; returns it. */
export function tick(sim, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const { nodes, links } = sim;
  const n = nodes.length;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);

  // Repulsion between every pair. The potential is repulsion / d, where d
  // stretches x and y by how wide and tall the two boxes are (keeping the
  // same area), and the force is its gradient.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = nodes[j].x - nodes[i].x;
      let dy = nodes[j].y - nodes[i].y;
      if (dx * dx + dy * dy < 1) {
        // Exactly on top of each other: nudge apart deterministically.
        dx = (j - i) * 0.5;
        dy = 0.5;
      }
      const sx = (nodes[i].w + nodes[j].w) / 2;
      const sy = (nodes[i].h + nodes[j].h) / 2;
      const ax = sy / sx; // (c / sx)^2 with c = sqrt(sx * sy)
      const ay = sx / sy;
      const d = Math.sqrt(dx * dx * ax + dy * dy * ay);
      const scale = o.repulsion / (d * d * d);
      fx[i] -= dx * ax * scale;
      fy[i] -= dy * ay * scale;
      fx[j] += dx * ax * scale;
      fy[j] += dy * ay * scale;
    }
  }

  // Springs along links.
  for (const { source, target } of links) {
    const a = nodes[source];
    const b = nodes[target];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (d - o.linkDistance) * o.linkStrength;
    fx[source] += (dx / d) * force;
    fy[source] += (dy / d) * force;
    fx[target] -= (dx / d) * force;
    fy[target] -= (dy / d) * force;
  }

  // Clearance: push concepts off links that run through (or very near) them.
  for (const { source, target } of links) {
    const a = nodes[source];
    const b = nodes[target];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) continue;
    for (let i = 0; i < n; i++) {
      if (i === source || i === target) continue;
      const c = nodes[i];
      const t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2;
      if (t <= 0.05 || t >= 0.95) continue;
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      let ox = c.x - px;
      let oy = c.y - py;
      // How far the box reaches towards the line, plus a little air.
      const reach = (Math.abs(ox) > Math.abs(oy) ? c.w / 2 : c.h / 2) + 10;
      const d = Math.hypot(ox, oy);
      if (d >= reach) continue;
      if (d < 0.5) {
        ox = -dy;
        oy = dx;
      }
      const norm = Math.hypot(ox, oy) || 1;
      const push = (reach - d) * o.clearance;
      fx[i] += (ox / norm) * push;
      fy[i] += (oy / norm) * push;
      fx[source] -= (ox / norm) * push * 0.5;
      fy[source] -= (oy / norm) * push * 0.5;
      fx[target] -= (ox / norm) * push * 0.5;
      fy[target] -= (oy / norm) * push * 0.5;
    }
  }

  // Gravity (softer along the long side of the walls), then integrate with damping.
  const aspect = o.walls ? o.walls.w / o.walls.h : 1;
  const gx = o.gravity * Math.min(1, 1 / aspect);
  const gy = o.gravity * Math.min(1, aspect);
  for (let i = 0; i < n; i++) {
    const node = nodes[i];
    if (node.fixed) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    fx[i] -= node.x * gx;
    fy[i] -= node.y * gy;
    node.vx = (node.vx + fx[i] * sim.alpha) * o.damping;
    node.vy = (node.vy + fy[i] * sim.alpha) * o.damping;
    node.x += node.vx;
    node.y += node.vy;
  }

  resolveOverlaps(nodes, o.padding);
  if (o.walls) keepInside(nodes, o.walls);
  sim.alpha = Math.max(0, sim.alpha * (1 - o.alphaDecay));
  return sim;
}

/** Pushes overlapping boxes apart along the axis that overlaps least. */
export function resolveOverlaps(nodes, padding = DEFAULTS.padding) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const overlapX = (a.w + b.w) / 2 + padding - Math.abs(dx);
      const overlapY = (a.h + b.h) / 2 + padding - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      // Share the push, unless one of them is pinned by the person.
      const shareA = a.fixed ? 0 : b.fixed ? 1 : 0.5;
      const shareB = 1 - shareA;
      if (overlapX < overlapY) {
        const s = dx >= 0 ? 1 : -1;
        a.x -= s * overlapX * shareA;
        b.x += s * overlapX * shareB;
      } else {
        const s = dy >= 0 ? 1 : -1;
        a.y -= s * overlapY * shareA;
        b.y += s * overlapY * shareB;
      }
    }
  }
}

/** Keeps every box inside a `w` x `h` area centred on (0, 0). */
export function keepInside(nodes, { w, h }) {
  for (const n of nodes) {
    const maxX = Math.max(0, (w - n.w) / 2);
    const maxY = Math.max(0, (h - n.h) / 2);
    n.x = Math.min(maxX, Math.max(-maxX, n.x));
    n.y = Math.min(maxY, Math.max(-maxY, n.y));
  }
}

/**
 * Forces tuned to the space available: links get shorter and the push
 * between concepts weaker on a small screen, so the map stays readable at
 * 100% instead of being shrunk to fit.
 */
export function optionsForArea(width, height, count) {
  // Settings picked by sweeping them over sample maps on laptop and phone
  // sized screens and keeping the least tangled results.
  const room = Math.sqrt((width * height) / Math.max(count, 1));
  const linkDistance = Math.round(Math.min(240, Math.max(70, room * 0.8)));
  return {
    linkDistance,
    repulsion: Math.round(linkDistance * linkDistance * 0.7),
    walls: { w: width - 24, h: height - 24 },
  };
}

export function isSettled(sim, options = {}) {
  return sim.alpha < (options.alphaMin ?? DEFAULTS.alphaMin);
}

/** Runs until settled (or `maxTicks`). Used when motion is reduced, and in tests. */
export function settle(sim, options = {}, maxTicks = 500) {
  for (let i = 0; i < maxTicks && !isSettled(sim, options); i++) tick(sim, options);
  return sim;
}

/**
 * How tangled a settled layout looks: crossed links, links running under
 * a card they don't belong to, and cards pushed off the edge. Lower is
 * better. Used to pick the best of a few starting arrangements.
 */
export function tangle(sim, walls) {
  const { nodes, links } = sim;
  const side = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  let crossings = 0;
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      const e = links[i];
      const f = links[j];
      if (e.source === f.source || e.source === f.target || e.target === f.source || e.target === f.target) continue;
      const [p, q, r, s] = [nodes[e.source], nodes[e.target], nodes[f.source], nodes[f.target]];
      if (side(p, q, r) !== side(p, q, s) && side(r, s, p) !== side(r, s, q)) crossings += 1;
    }
  }
  let underCards = 0;
  for (const { source, target } of links) {
    const a = nodes[source];
    const b = nodes[target];
    for (let i = 0; i < nodes.length; i++) {
      if (i === source || i === target) continue;
      const c = nodes[i];
      for (let t = 0.1; t < 0.9; t += 0.05) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (Math.abs(x - c.x) < c.w / 2 + 4 && Math.abs(y - c.y) < c.h / 2 + 4) {
          underCards += 1;
          break;
        }
      }
    }
  }
  const box = bounds(nodes);
  const overflow = walls ? Math.max(0, box.width - walls.w) + Math.max(0, box.height - walls.h) : 0;
  return crossings * 2 + underCards * 3 + overflow / 20;
}

/** Bounding box of all the concept boxes. */
export function bounds(nodes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.w / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** The view transform that fits every concept into a `width` x `height` area. */
export function fitView(nodes, width, height, { margin = 28, maxScale = 1.3 } = {}) {
  if (!nodes.length || !width || !height) return { x: 0, y: 0, k: 1 };
  const b = bounds(nodes);
  const k = Math.min(maxScale, (width - margin * 2) / b.width, (height - margin * 2) / b.height);
  return { k, x: -(b.minX + b.width / 2) * k, y: -(b.minY + b.height / 2) * k };
}

/**
 * Where a link should start and end: on the edges of the two boxes, not
 * their centres, so arrowheads land on the box outline.
 */
export function clipToBox(from, to, box) {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  if (dx === 0 && dy === 0) return { x: to.x, y: to.y };
  const scale = Math.min(Math.abs(box.w / 2 / (dx || 1e-9)), Math.abs(box.h / 2 / (dy || 1e-9)));
  return { x: to.x + dx * Math.min(scale, 1), y: to.y + dy * Math.min(scale, 1) };
}

/**
 * The concept to move keyboard focus to when an arrow key is pressed:
 * the nearest one lying roughly in that direction.
 */
export function nearestInDirection(nodes, fromId, direction) {
  const from = nodes.find((n) => n.id === fromId);
  if (!from) return null;
  const [ux, uy] = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[direction] ?? [0, 0];
  let best = null;
  let bestScore = Infinity;
  for (const n of nodes) {
    if (n.id === fromId) continue;
    const dx = n.x - from.x;
    const dy = n.y - from.y;
    const along = dx * ux + dy * uy;
    if (along <= 0) continue;
    const across = Math.abs(dx * uy - dy * ux);
    const score = along + across * 2; // prefer things straight ahead
    if (score < bestScore) {
      bestScore = score;
      best = n.id;
    }
  }
  return best;
}
