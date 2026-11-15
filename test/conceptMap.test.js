import { describe, expect, it } from 'vitest';
import { PHOTOSYNTHESIS } from '../server/mockData.js';
import { mockStream } from '../server/mock.js';
import { buildGenerateMessages } from '../server/prompt.js';
import { buildLayout, itemsMentioning, linkGeometry, shownLabels, validPins, zoomAt, toLayout, toScreen } from '../src/lib/conceptMap.js';
import {
  bounds,
  createSimulation,
  fitView,
  keepInside,
  nearestInDirection,
  optionsForArea,
  resolveOverlaps,
  settle,
  tangle,
  wrapLabel,
} from '../src/lib/forceLayout.js';
import { normalizeBlock, normalizeGuide } from '../src/lib/schema.js';

const map = normalizeBlock(PHOTOSYNTHESIS.guide.find((b) => b.type === 'concept_map')).item;
const overlaps = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

describe('concept map from the model', () => {
  it('accepts the documented shape', () => {
    expect(map).toMatchObject({ type: 'concept_map', title: 'How photosynthesis fits together' });
    expect(map.nodes).toHaveLength(10);
    expect(map.edges).toHaveLength(12);
    expect(map.nodes[1]).toEqual({ id: 'chloroplast', label: 'Chloroplast', detail: 'The organelle where photosynthesis happens.' });
  });

  it('takes renamed keys and ends named by label, and drops links it cannot trust', () => {
    const result = normalizeBlock({
      type: 'Mind map',
      concepts: [{ name: 'Cell' }, 'Nucleus', { name: 'DNA', description: 'The genetic code.' }, { name: 'nucleus' }],
      links: [
        { source: 'Cell', target: 'Nucleus', relation: 'contains' },
        { source: 'nucleus', target: 'dna', relation: 'holds' },
        { source: 'Cell', target: 'Nucleus' }, // duplicate
        { source: 'DNA', target: 'DNA' }, // to itself
        { source: 'Cell', target: 'Mitochondria' }, // concept that isn't there
        'not a link',
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.item.nodes.map((n) => n.label)).toEqual(['Cell', 'Nucleus', 'DNA']); // "nucleus" was a repeat
    expect(result.item.edges).toEqual([
      { from: 'cell', to: 'nucleus', label: 'contains' },
      { from: 'nucleus', to: 'dna', label: 'holds' },
    ]);
    expect(result.item.skipped).toBe(4);
  });

  it('refuses maps too thin to be worth drawing', () => {
    expect(normalizeBlock({ type: 'concept_map', nodes: ['A', 'B'], edges: [{ from: 'A', to: 'B' }] })).toMatchObject({ ok: false, reason: /fewer than three/ });
    expect(normalizeBlock({ type: 'concept_map', nodes: ['A', 'B', 'C'], edges: [{ from: 'A', to: 'B' }] })).toMatchObject({ ok: false, reason: /two usable links/ });
    expect(normalizeBlock({ type: 'concept_map', edges: [] })).toMatchObject({ ok: false });
  });

  it('caps the number of concepts and links', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => `Concept ${i}`);
    const edges = nodes.slice(1).map((label, i) => ({ from: nodes[i], to: label }));
    const result = normalizeBlock({ type: 'concept_map', nodes, edges });
    expect(result.item.nodes).toHaveLength(14);
    expect(result.item.edges.every((e) => result.item.nodes.some((n) => n.id === e.to))).toBe(true);
  });

  it('a broken map is dropped with a reason and the rest of the guide survives', () => {
    const { blocks, dropped } = normalizeGuide([{ type: 'checklist', items: ['a', 'b'] }, { type: 'graph', nodes: 'nope' }]);
    expect(blocks.map((b) => b.type)).toEqual(['checklist']);
    expect(dropped[0].reason).toMatch(/concept map/i);
  });

  it('is asked for in the prompt', () => {
    const [system] = buildGenerateMessages({ mode: 'flashcards', input: 'Photosynthesis', count: 5 });
    expect(system.content).toMatch(/"type": "concept_map"/);
  });

  it("the demo's messy answer still gives a map", async () => {
    let text = '';
    for await (const event of mockStream({ request: { mode: 'quiz', input: 'Photosynthesis', count: 5 }, scenario: 'wrong_shape' })) {
      if (event.type === 'delta') text += event.text;
    }
    const block = normalizeGuide(JSON.parse(text).study_guide).blocks.find((b) => b.type === 'concept_map');
    expect(block.nodes.map((n) => n.label)).toEqual(['Photosynthesis', 'Chloroplast', 'Glucose']);
    expect(block.skipped).toBe(2);
  });
});

describe('force layout', () => {
  const desk = { w: 696, h: 430 };
  const phone = { w: 350, h: 496 };

  it('is deterministic', () => {
    expect(buildLayout(map, desk)).toEqual(buildLayout(map, desk));
  });

  it.each([
    ['laptop', desk],
    ['phone', phone],
  ])('settles the sample map with no overlaps, no crossed links, inside the screen (%s)', (_, area) => {
    const nodes = buildLayout(map, area);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(overlaps(nodes[i], nodes[j])).toBe(false);
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const links = map.edges.map((e) => ({ source: index.get(e.from), target: index.get(e.to) }));
    const walls = optionsForArea(area.w, area.h, nodes.length).walls;
    expect(tangle({ nodes, links }, walls)).toBe(0);
    const box = bounds(nodes);
    expect(box.width).toBeLessThanOrEqual(walls.w + 0.5);
    expect(box.height).toBeLessThanOrEqual(walls.h + 0.5);
  });

  it('starts pinned concepts where they were left and keeps them there', () => {
    const nodes = buildLayout(map, desk, { glucose: [200, -100] });
    expect(nodes.find((n) => n.id === 'glucose')).toMatchObject({ x: 200, y: -100, fixed: true });
  });

  it('pushes overlapping boxes apart, but never a pinned one', () => {
    const a = { x: 0, y: 0, w: 100, h: 40, fixed: true };
    const b = { x: 10, y: 5, w: 100, h: 40, fixed: false };
    resolveOverlaps([a, b], 10);
    expect(a).toMatchObject({ x: 0, y: 0 });
    expect(overlaps(a, b)).toBe(false);
  });

  it('keeps boxes inside the walls', () => {
    const nodes = [{ x: 900, y: -900, w: 100, h: 40 }];
    keepInside(nodes, { w: 400, h: 300 });
    expect(nodes[0]).toMatchObject({ x: 150, y: -130 });
  });

  it('a lone pair of concepts on top of each other still separates', () => {
    const sim = createSimulation(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      [{ from: 'a', to: 'b' }],
      { pinned: { a: [0, 0] } },
    );
    sim.nodes[1].x = 0;
    sim.nodes[1].y = 0;
    settle(sim);
    expect(sim.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(overlaps(sim.nodes[0], sim.nodes[1])).toBe(false);
  });

  it('wraps long labels at the most even space', () => {
    expect(wrapLabel('Glucose')).toEqual(['Glucose']);
    expect(wrapLabel('Light-dependent reactions')).toEqual(['Light-dependent', 'reactions']);
    expect(wrapLabel('Supercalifragilisticexpialidocious')).toEqual(['Supercalifragilisticexpialidocious']);
  });

  it('finds the nearest concept in an arrow direction', () => {
    const nodes = [
      { id: 'mid', x: 0, y: 0 },
      { id: 'right', x: 100, y: 10 },
      { id: 'far-right', x: 300, y: 0 },
      { id: 'up', x: 5, y: -80 },
    ];
    expect(nearestInDirection(nodes, 'mid', 'ArrowRight')).toBe('right');
    expect(nearestInDirection(nodes, 'mid', 'ArrowUp')).toBe('up');
    expect(nearestInDirection(nodes, 'mid', 'ArrowLeft')).toBeNull();
  });
});

describe('view maths', () => {
  const size = { w: 600, h: 400 };

  it('zooming keeps the point under the pointer still', () => {
    const view = { x: 30, y: -20, k: 1.2 };
    const under = toLayout(view, size, 450, 120);
    const zoomed = zoomAt(view, size, 1.5, 450, 120);
    const back = toScreen(zoomed, size, under);
    expect(back.x).toBeCloseTo(450);
    expect(back.y).toBeCloseTo(120);
    expect(zoomAt(view, size, 100).k).toBe(2.5); // clamped
  });

  it('fitting shows every concept', () => {
    const nodes = buildLayout(map, size);
    const view = fitView(nodes, size.w, size.h);
    for (const n of nodes) {
      const p = toScreen(view, size, n);
      expect(p.x - (n.w * view.k) / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + (n.w * view.k) / 2).toBeLessThanOrEqual(size.w);
      expect(p.y - (n.h * view.k) / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + (n.h * view.k) / 2).toBeLessThanOrEqual(size.h);
    }
  });

  it('links start and end on the box outlines', () => {
    const a = { x: 0, y: 0, w: 100, h: 40 };
    const b = { x: 300, y: 0, w: 100, h: 40 };
    expect(linkGeometry(a, b).d).toBe('M53,0 L247,0');
    expect(linkGeometry(a, b, true).d).toMatch(/^M[\d.,-]+ Q/);
  });
});

describe('labels and related items', () => {
  const nodes = buildLayout(map, { w: 696, h: 430 });

  it('never puts a label over a card or another label', () => {
    for (const focus of [null, 'calvin', 'photosynthesis']) {
      const spots = [...shownLabels(map.edges, nodes, focus).entries()];
      const boxes = spots.map(([key, p]) => ({ ...p, w: map.edges.find((e) => `${e.from}>${e.to}` === key).label.length * 6.6 + 8, h: 14 }));
      const cards = focus ? [] : nodes;
      for (const box of boxes) {
        for (const card of cards) expect(overlaps(box, { ...card, w: card.w + 4, h: card.h + 4 })).toBe(false);
        for (const other of boxes) if (other !== box) expect(overlaps(box, other)).toBe(false);
      }
      if (focus) expect(spots.every(([key]) => key.split('>').includes(focus))).toBe(true);
    }
  });

  it('finds the practice items that mention a concept', () => {
    const items = [
      { id: 'a', type: 'flashcard', front: 'Where are chloroplasts found?', back: 'Leaves' },
      { id: 'b', type: 'mcq', question: 'What do the light reactions make?', choices: ['NADPH and ATP', 'Glucose'], answer: 0, explanation: 'NADPH and ATP.' },
      { id: 'c', type: 'true_false', statement: 'Plants photosynthesise at night', answer: false },
      { id: 'd', type: 'fill_blank', prompt: 'The Calvin ___ fixes carbon', answer: 'cycle' },
    ];
    expect(itemsMentioning(items, 'Chloroplast').map((i) => i.id)).toEqual(['a']);
    expect(itemsMentioning(items, 'ATP and NADPH').map((i) => i.id)).toEqual(['b']);
    expect(itemsMentioning(items, 'Calvin cycle').map((i) => i.id)).toEqual(['d']);
    expect(itemsMentioning(items, 'Oxygen')).toEqual([]);
    expect(itemsMentioning(items, 'of')).toEqual([]);
  });

  it('only trusts stored positions that make sense', () => {
    expect(validPins({ glucose: [1, 2], gone: [1, 2], calvin: ['x', 2], stroma: [1] }, map.nodes)).toEqual({ glucose: [1, 2] });
    expect(validPins([1, 2], map.nodes)).toBeUndefined();
    expect(validPins(null, map.nodes)).toBeUndefined();
  });
});
