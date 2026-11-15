// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PHOTOSYNTHESIS } from '../server/mockData.js';
import { StudyGuide } from '../src/components/StudyGuide.jsx';
import { normalizeGuide, normalizeItems } from '../src/lib/schema.js';

// jsdom has no PointerEvent or matchMedia. Reduced motion keeps the map
// still between events, so positions can be checked straight away.
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  if (!window.PointerEvent) {
    window.PointerEvent = class PointerEvent extends MouseEvent {
      constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
      }
    };
  }
  window.matchMedia = (query) => ({
    matches: query.includes('reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
});
afterAll(() => {
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => localStorage.clear());

const guide = normalizeGuide(PHOTOSYNTHESIS.guide.filter((b) => b.type === 'concept_map')).blocks;
const items = normalizeItems(PHOTOSYNTHESIS.flashcards, 'flashcards').items;
const set = { id: 's_map', guide, items };
const node = (name) => screen.getByRole('button', { name: new RegExp(`^${name},`) });
const position = (el) => el.getAttribute('transform');
const tap = (el, id = 9) => {
  act(() => {
    fireEvent.pointerDown(el.querySelector('rect') ?? el, { pointerId: id, clientX: 5, clientY: 5, button: 0 });
    fireEvent.pointerUp(document.querySelector('.cmap__svg'), { pointerId: id, clientX: 5, clientY: 5 });
  });
};

describe('concept map', () => {
  it('draws every concept as a button, with one tab stop for the whole map', () => {
    render(<StudyGuide set={set} />);
    expect(screen.getByRole('heading', { name: 'How photosynthesis fits together' })).toBeInTheDocument();
    expect(screen.getByText('10 concepts, 12 links')).toBeInTheDocument();
    expect(node('Calvin cycle')).toHaveAccessibleName('Calvin cycle, 5 links');
    const stops = document.querySelectorAll('.cmap__node[tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0].dataset.node).toBe('calvin'); // the best-connected concept
  });

  it('picking a concept shows its links and the cards that mention it', async () => {
    const user = userEvent.setup();
    render(<StudyGuide set={set} />);
    await user.click(node('Calvin cycle'));
    expect(node('Calvin cycle')).toHaveAttribute('aria-pressed', 'true');
    const detail = document.querySelector('.cmap__picked');
    expect(within(detail).getByRole('heading', { name: 'Calvin cycle' })).toBeInTheDocument();
    expect(detail).toHaveTextContent('ATP and NADPH power → Calvin cycle');
    expect(detail).toHaveTextContent('Where does the Calvin cycle take place?');
    expect(screen.getByText(/Calvin cycle\. 5 links, mentioned in \d+ of \d+ practice items\./)).toBeInTheDocument();

    // A link in the panel picks the concept at its other end.
    await user.click(within(detail).getByRole('button', { name: 'Stroma' }));
    expect(node('Stroma')).toHaveAttribute('aria-pressed', 'true');
    expect(node('Stroma')).toHaveFocus();
  });

  it('works from the keyboard', async () => {
    const user = userEvent.setup();
    render(<StudyGuide set={set} />);
    await user.tab(); // "Show as list" comes first
    await user.tab();
    expect(node('Calvin cycle')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).not.toBe(node('Calvin cycle'));
    expect(document.activeElement.dataset.node).toBeTruthy();
    const landed = document.activeElement;
    expect(landed).toHaveAttribute('tabindex', '0'); // the tab stop follows focus
    await user.keyboard('{Enter}');
    expect(landed).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    expect(landed).toHaveAttribute('aria-pressed', 'false');

    const scene = document.querySelector('.cmap__svg > g');
    const before = scene.getAttribute('transform');
    await user.keyboard('+');
    expect(scene.getAttribute('transform')).not.toBe(before);
    await user.keyboard('0');
    expect(scene.getAttribute('transform')).toBe(before);
  });

  it('zoom buttons zoom, and Fit puts it back', async () => {
    const user = userEvent.setup();
    render(<StudyGuide set={set} />);
    const scene = document.querySelector('.cmap__svg > g');
    const fitted = scene.getAttribute('transform');
    const fit = screen.getByRole('button', { name: 'Fit the map to the screen' });
    expect(fit).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    const scale = (t) => Number(t.match(/scale\(([\d.]+)\)/)[1]);
    expect(scale(scene.getAttribute('transform'))).toBeGreaterThan(scale(fitted));
    await user.click(fit);
    expect(scene.getAttribute('transform')).toBe(fitted);
  });

  it('dragging a concept pins it there, across reloads, until "Tidy up"', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StudyGuide set={set} />);
    const svg = document.querySelector('.cmap__svg');
    const glucose = node('Glucose');
    const start = position(glucose);

    fireEvent.pointerDown(glucose.querySelector('rect'), { pointerId: 7, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: 130, clientY: 110 });
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: 160, clientY: 140 });
    fireEvent.pointerUp(svg, { pointerId: 7, clientX: 160, clientY: 140 });

    expect(position(node('Glucose'))).not.toBe(start);
    expect(node('Glucose')).toHaveAccessibleName('Glucose, 1 link, pinned');
    expect(node('Glucose')).toHaveAttribute('aria-pressed', 'false'); // a drag isn't a pick
    const moved = position(node('Glucose'));

    unmount();
    render(<StudyGuide set={set} />);
    expect(node('Glucose')).toHaveAccessibleName('Glucose, 1 link, pinned');
    const [x, y] = moved.match(/-?[\d.]+/g).map(Number);
    const [x2, y2] = position(node('Glucose')).match(/-?[\d.]+/g).map(Number);
    expect(Math.abs(x2 - x)).toBeLessThan(1); // stored rounded to whole units
    expect(Math.abs(y2 - y)).toBeLessThan(1);

    await user.click(screen.getByRole('button', { name: 'Tidy up' }));
    expect(node('Glucose')).toHaveAccessibleName('Glucose, 1 link');
    expect(position(node('Glucose'))).toBe(start);
    expect(screen.queryByRole('button', { name: 'Tidy up' })).not.toBeInTheDocument();
  });

  it('a press that barely moves is a pick, not a drag', () => {
    render(<StudyGuide set={set} />);
    const svg = document.querySelector('.cmap__svg');
    const oxygen = node('Oxygen');
    const start = position(oxygen);
    act(() => {
      fireEvent.pointerDown(oxygen.querySelector('rect'), { pointerId: 3, clientX: 50, clientY: 50, button: 0 });
      fireEvent.pointerMove(svg, { pointerId: 3, clientX: 52, clientY: 51 });
      fireEvent.pointerUp(svg, { pointerId: 3, clientX: 52, clientY: 51 });
    });
    expect(position(node('Oxygen'))).toBe(start);
    expect(node('Oxygen')).toHaveAttribute('aria-pressed', 'true');
  });

  it('dragging the paper pans, and tapping it clears the pick', () => {
    render(<StudyGuide set={set} />);
    const svg = document.querySelector('.cmap__svg');
    const scene = svg.querySelector(':scope > g');
    tap(node('Oxygen'));
    expect(node('Oxygen')).toHaveAttribute('aria-pressed', 'true');
    const fitted = scene.getAttribute('transform');
    act(() => {
      fireEvent.pointerDown(svg, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
      fireEvent.pointerMove(svg, { pointerId: 1, clientX: 60, clientY: 40 });
      fireEvent.pointerUp(svg, { pointerId: 1, clientX: 60, clientY: 40 });
    });
    const panned = scene.getAttribute('transform');
    expect(panned).not.toBe(fitted);
    expect(node('Oxygen')).toHaveAttribute('aria-pressed', 'true'); // a pan doesn't clear it
    act(() => {
      fireEvent.pointerDown(svg, { pointerId: 2, clientX: 10, clientY: 10, button: 0 });
      fireEvent.pointerUp(svg, { pointerId: 2, clientX: 10, clientY: 10 });
    });
    expect(scene.getAttribute('transform')).toBe(panned);
    expect(node('Oxygen')).toHaveAttribute('aria-pressed', 'false');
  });

  it('can be read as a list instead', async () => {
    const user = userEvent.setup();
    render(<StudyGuide set={set} />);
    await user.click(screen.getByRole('button', { name: 'Show as list' }));
    expect(screen.getByText('Photosynthesis happens in Chloroplast')).toBeInTheDocument();
    expect(screen.getByText('The enzyme that fixes CO₂ onto RuBP.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show as map' }));
    expect(node('RuBisCO')).toBeInTheDocument();
  });
});
