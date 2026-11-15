import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePersistentState } from '../hooks/usePersistentState.js';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import { guideKey } from '../hooks/useSavedSets.js';
import {
  boxesFor,
  buildLayout,
  itemsMentioning,
  linkGeometry,
  linkSentence,
  neighbours,
  shownLabels,
  revealIn,
  simulationFrom,
  snapshot,
  toLayout,
  validPins,
  zoomAt,
} from '../lib/conceptMap.js';
import { fitView, isSettled, keepInside, nearestInDirection, optionsForArea, resolveOverlaps, tick } from '../lib/forceLayout.js';
import { itemText } from '../lib/schema.js';

// jsdom has no layout, so tests get a fixed stage size.
const FALLBACK_SIZE = { w: 640, h: 400 };
const LINE_HEIGHT = 17;
const DRAG_THRESHOLD = 4; // px a pointer must move before a press becomes a drag
const ZOOM_STEP = 1.25;

/**
 * The concept map: concepts as small index cards, links as labelled arrows.
 * The layout is my own force simulation (lib/forceLayout.js). Drag a
 * concept to move it (it stays pinned where you drop it, and the others
 * make room); drag the background to pan; Ctrl + scroll, pinch or the
 * buttons to zoom. Picking a concept shows its links and the practice items
 * that mention it.
 *
 * Keyboard: the map is one tab stop. Arrow keys move to the nearest concept
 * in that direction, Enter or Space picks it, Escape clears, + and - zoom,
 * 0 fits the map to the screen. "Show as list" gives the same content as
 * plain text.
 */
export function ConceptMapBlock({ block, setId, items = [] }) {
  const titleId = useId();
  const hintId = useId();
  const uid = useId().replace(/[^\w-]/g, '');
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState('map');

  const [pins, setPins] = usePersistentState(guideKey(setId, block.id), {}, (v) => validPins(v, block.nodes));
  const [startPins] = useState(pins);

  // The stage is measured once it's visible. The layout is built for the
  // first size seen (or the size when you press "Tidy up"); later resizes
  // just re-fit the view.
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState(() => (typeof ResizeObserver === 'undefined' ? FALLBACK_SIZE : null));
  const [area, setArea] = useState(size);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      if (!w || !h) return; // hidden behind the other tab
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
      setArea((a) => a ?? { w, h });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  const boxes = useMemo(() => (area ? boxesFor(block.nodes, area) : null), [block.nodes, area]);
  const initialLayout = useMemo(() => (area ? buildLayout(block, area, startPins) : null), [block, area, startPins]);
  const [moved, setMoved] = useState(null); // the layout once anything has moved
  const layout = moved ?? initialLayout;
  const options = useMemo(() => (area ? optionsForArea(area.w, area.h, block.nodes.length) : null), [area, block.nodes.length]);
  // While you drag, links are softer than when laying out, so neighbours
  // trail along elastically instead of the whole map lurching.
  const liveOptions = useMemo(() => options && { ...options, linkStrength: 0.15 }, [options]);

  const [viewState, setView] = useState(null); // null: fit the whole map
  const view = viewState ?? (layout && size ? fitView(layout, size.w, size.h, { maxScale: 1.15 }) : { x: 0, y: 0, k: 1 });

  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [running, setRunning] = useState(false);
  const [tween, setTween] = useState(null); // { from, to } while "Tidy up" glides everything home

  const labelOf = useMemo(() => {
    const labels = new Map(block.nodes.map((n) => [n.id, n.label]));
    return (id) => labels.get(id) ?? id;
  }, [block.nodes]);
  const linked = useMemo(() => neighbours(block.edges), [block.edges]);
  const linkedBothWays = useMemo(() => new Set(block.edges.map((e) => `${e.from}>${e.to}`)), [block.edges]);
  const hub = useMemo(() => {
    let best = block.nodes[0].id;
    for (const n of block.nodes) if ((linked.get(n.id)?.size ?? 0) > (linked.get(best)?.size ?? 0)) best = n.id;
    return best;
  }, [block.nodes, linked]);
  const [focusId, setFocusId] = useState(hub);

  /* ---------- the live simulation (only while something moves) ---------- */

  const simRef = useRef(null);
  const dragRef = useRef(null);
  const pointersRef = useRef(new Map());
  const panRef = useRef(null);
  const nodeRefs = useRef(new Map());

  const liveSim = () => {
    if (!simRef.current) simRef.current = simulationFrom(block, layout, boxes);
    return simRef.current;
  };

  useEffect(() => {
    if (!running) return undefined;
    let frame;
    const step = () => {
      const sim = simRef.current;
      if (!sim) {
        setRunning(false);
        return;
      }
      for (let i = 0; i < 3; i++) tick(sim, liveOptions);
      setMoved(snapshot(sim));
      if (isSettled(sim) && !dragRef.current) {
        setRunning(false);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [running, liveOptions]);

  // "Tidy up" glides every card to a freshly built layout (not physics: the
  // fresh layout is the untangled one, wherever things are now).
  useEffect(() => {
    if (!tween) return undefined;
    let frame;
    const start = performance.now();
    const from = new Map(tween.from.map((n) => [n.id, n]));
    const step = (now) => {
      const t = Math.min(1, (now - start) / 650);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in-out
      setMoved(
        tween.to.map((n) => {
          const f = from.get(n.id) ?? n;
          return { ...n, x: f.x + (n.x - f.x) * e, y: f.y + (n.y - f.y) * e };
        }),
      );
      if (t < 1) frame = requestAnimationFrame(step);
      else setTween(null);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [tween]);

  // Ctrl/⌘ + wheel (and trackpad pinch, which arrives as ctrl + wheel)
  // zooms. A plain wheel scrolls the page as usual.
  const latest = useRef(null);
  useEffect(() => {
    latest.current = { view, size };
  });
  const ready = Boolean(layout && size);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const { view: v, size: s } = latest.current;
      const rect = svg.getBoundingClientRect();
      const delta = Math.max(-50, Math.min(50, event.deltaY));
      setView(zoomAt(v, s, Math.exp(-delta * 0.01), event.clientX - rect.left, event.clientY - rect.top));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [mode, ready]);

  if (mode === 'list') {
    return (
      <MapFrame block={block} titleId={titleId} mode={mode} onToggle={() => setMode('map')}>
        <ConceptList block={block} labelOf={labelOf} />
      </MapFrame>
    );
  }

  /* ---------- pointer handling ---------- */

  const stagePoint = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const capture = (event) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // synthetic pointers (tests) can't be captured
    }
  };
  const freezeView = () => setView(view);

  const onPointerDown = (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const nodeEl = event.target.closest?.('[data-node]');
    if (nodeEl && !dragRef.current && pointersRef.current.size === 0) {
      if (tween) setTween(null); // grabbing a card stops the glide where it is
      const id = nodeEl.dataset.node;
      const node = layout.find((n) => n.id === id);
      const sp = stagePoint(event);
      const p = toLayout(view, size, sp.x, sp.y);
      dragRef.current = { id, pointerId: event.pointerId, sx: event.clientX, sy: event.clientY, dx: p.x - node.x, dy: p.y - node.y, moved: false };
      capture(event);
      return;
    }
    if (dragRef.current) return;
    pointersRef.current.set(event.pointerId, stagePoint(event));
    if (pointersRef.current.size === 1) panRef.current = { sx: event.clientX, sy: event.clientY, moved: false };
    else if (panRef.current) panRef.current.moved = true; // a second finger: this is a pinch
    capture(event);
    freezeView();
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      if (!drag.moved) {
        if (Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        setDragging(drag.id);
        freezeView();
      }
      const sp = stagePoint(event);
      const p = toLayout(view, size, sp.x, sp.y);
      const sim = liveSim();
      const node = sim.nodes.find((n) => n.id === drag.id);
      Object.assign(node, { x: p.x - drag.dx, y: p.y - drag.dy, vx: 0, vy: 0, fixed: true });
      if (reducedMotion) {
        // No drifting: the others step aside at once.
        resolveOverlaps(sim.nodes);
        keepInside(sim.nodes, options.walls);
      } else {
        sim.alpha = Math.max(sim.alpha, 0.2);
        if (!running) setRunning(true);
      }
      setMoved(snapshot(sim));
      return;
    }

    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    const before = [...pointers.values()];
    pointers.set(event.pointerId, stagePoint(event));
    const after = [...pointers.values()];
    const pan = panRef.current;
    if (pan && !pan.moved && Math.hypot(event.clientX - pan.sx, event.clientY - pan.sy) >= DRAG_THRESHOLD) pan.moved = true;
    if (!pan?.moved) return;

    if (after.length === 1) {
      const dx = after[0].x - before[0].x;
      const dy = after[0].y - before[0].y;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (after.length >= 2) {
      const [a0, b0] = before;
      const [a1, b1] = after;
      const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
      const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y) || 1;
      const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
      setView((v) => {
        const zoomed = zoomAt(v, size, d1 / d0, mid1.x, mid1.y);
        return { ...zoomed, x: zoomed.x + mid1.x - mid0.x, y: zoomed.y + mid1.y - mid0.y };
      });
    }
  };

  const endPointer = (event, cancelled) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(null);
      if (drag.moved) {
        const node = simRef.current?.nodes.find((n) => n.id === drag.id);
        if (node) setPins((p) => ({ ...p, [drag.id]: [Math.round(node.x), Math.round(node.y)] }));
      } else if (!cancelled) {
        pick(drag.id);
        nodeRefs.current.get(drag.id)?.focus({ preventScroll: true });
      }
      return;
    }
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      if (!cancelled && panRef.current && !panRef.current.moved) setSelected(null); // a tap on empty paper
      panRef.current = null;
    }
  };

  /* ---------- picking, keyboard and buttons ---------- */

  const pick = (id) => {
    setSelected((s) => (s === id ? null : id));
    setFocusId(id);
  };

  const zoomBy = (factor) => setView(zoomAt(view, size, factor));
  const fit = () => setView(null);

  const tidy = () => {
    const target = buildLayout(block, size);
    simRef.current = null;
    setRunning(false);
    setPins({});
    setArea(size);
    setView(null);
    if (reducedMotion) setMoved(target);
    else setTween({ from: layout, to: target });
  };

  const onNodeKeyDown = (event, id) => {
    const { key } = event;
    if (key.startsWith('Arrow')) {
      event.preventDefault();
      const next = nearestInDirection(layout, id, key);
      if (next) {
        setFocusId(next);
        nodeRefs.current.get(next)?.focus({ preventScroll: true });
        const node = layout.find((n) => n.id === next);
        const shown = revealIn(view, size, node);
        if (shown !== view) setView(shown);
      }
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      pick(id);
    } else if (key === 'Escape') {
      if (selected) {
        event.preventDefault();
        setSelected(null);
      }
    } else if (key === '+' || key === '=') {
      event.preventDefault();
      zoomBy(ZOOM_STEP);
    } else if (key === '-' || key === '_') {
      event.preventDefault();
      zoomBy(1 / ZOOM_STEP);
    } else if (key === '0') {
      event.preventDefault();
      fit();
    }
  };

  /* ---------- drawing ---------- */

  const focus = dragging ?? selected ?? hovered;
  const near = focus ? linked.get(focus) ?? new Set() : null;
  const byId = new Map((layout ?? []).map((n) => [n.id, n]));
  const pinnedCount = layout ? layout.filter((n) => n.fixed).length : 0;
  const tabStop = byId.has(focusId) ? focusId : hub;
  const labelled = layout ? shownLabels(block.edges, layout, focus) : new Map();

  return (
    <MapFrame block={block} titleId={titleId} mode={mode} onToggle={() => setMode('list')}>
      <div ref={stageRef} className={`cmap__stage${dragging ? ' cmap__stage--dragging' : ''}`}>
        {layout && size && (
          <svg
            ref={svgRef}
            className="cmap__svg"
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${size.w} ${size.h}`}
            role="group"
            aria-roledescription="concept map"
            aria-labelledby={titleId}
            aria-describedby={hintId}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endPointer(e, false)}
            onPointerCancel={(e) => endPointer(e, true)}
          >
            <defs>
              <pattern id={`${uid}-dots`} width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="12" cy="12" r="1.1" className="cmap__dot" />
              </pattern>
              <marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9 z" className="cmap__arrow" />
              </marker>
              <marker id={`${uid}-arrow-on`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9 z" className="cmap__arrow cmap__arrow--on" />
              </marker>
            </defs>
            <g transform={`translate(${size.w / 2 + view.x} ${size.h / 2 + view.y}) scale(${view.k})`}>
              <rect x="-4000" y="-4000" width="8000" height="8000" fill={`url(#${uid}-dots)`} />

              {block.edges.map((edge) => {
                const a = byId.get(edge.from);
                const b = byId.get(edge.to);
                if (!a || !b) return null;
                const on = focus && (edge.from === focus || edge.to === focus);
                const geometry = linkGeometry(a, b, linkedBothWays.has(`${edge.to}>${edge.from}`));
                return (
                  <path
                    key={`${edge.from}>${edge.to}`}
                    d={geometry.d}
                    className={`cmap__link${on ? ' cmap__link--on' : focus ? ' cmap__link--off' : ''}`}
                    markerEnd={`url(#${uid}-arrow${on ? '-on' : ''})`}
                  />
                );
              })}

              {layout.map((node) => {
                const concept = block.nodes.find((n) => n.id === node.id);
                const lines = boxes[node.id].lines;
                const state =
                  node.id === selected ? ' cmap__node--picked' : focus && node.id !== focus && !near.has(node.id) ? ' cmap__node--dim' : focus && near.has(node.id) ? ' cmap__node--near' : '';
                const links = linked.get(node.id)?.size ?? 0;
                return (
                  <g
                    key={node.id}
                    ref={(el) => {
                      if (el) nodeRefs.current.set(node.id, el);
                      else nodeRefs.current.delete(node.id);
                    }}
                    data-node={node.id}
                    className={`cmap__node${state}${node.id === dragging ? ' cmap__node--dragging' : ''}`}
                    transform={`translate(${Math.round(node.x * 10) / 10} ${Math.round(node.y * 10) / 10})`}
                    tabIndex={node.id === tabStop ? 0 : -1}
                    role="button"
                    aria-pressed={node.id === selected}
                    aria-label={`${concept.label}, ${links} ${links === 1 ? 'link' : 'links'}${node.fixed ? ', pinned' : ''}`}
                    onFocus={() => setFocusId(node.id)}
                    onKeyDown={(e) => onNodeKeyDown(e, node.id)}
                    onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(node.id)}
                    onPointerLeave={() => setHovered((h) => (h === node.id ? null : h))}
                  >
                    <rect className="cmap__card" x={-node.w / 2} y={-node.h / 2} width={node.w} height={node.h} rx="3" />
                    <line className="cmap__rule" x1={-node.w / 2} x2={node.w / 2} y1={-node.h / 2 + 6} y2={-node.h / 2 + 6} />
                    <text className="cmap__label" textAnchor="middle">
                      {lines.map((line, i) => (
                        <tspan key={i} x="0" y={(i - (lines.length - 1) / 2) * LINE_HEIGHT + 3} dy="0.35em">
                          {line}
                        </tspan>
                      ))}
                    </text>
                    {node.fixed && <circle className="cmap__pin" cx={node.w / 2 - 7} cy={-node.h / 2 + 6} r="3" />}
                  </g>
                );
              })}
              {block.edges.map((edge) => {
                const spot = labelled.get(`${edge.from}>${edge.to}`);
                if (!spot) return null;
                const on = focus && (edge.from === focus || edge.to === focus);
                return (
                  <text
                    key={`${edge.from}>${edge.to}-label`}
                    x={spot.x}
                    y={spot.y}
                    dy="0.35em"
                    textAnchor="middle"
                    className={`cmap__link-label${on ? ' cmap__link-label--on' : ''}`}
                    aria-hidden="true"
                  >
                    {edge.label}
                  </text>
                );
              })}
            </g>
          </svg>
        )}

      </div>

      <div className="cmap__bar">
        <p id={hintId} className="cmap__hint">
          Drag a concept to move it, or the paper to look around. Pinch, Ctrl + scroll or the buttons zoom. With a keyboard, arrow keys move between concepts
          and Enter picks one.
        </p>
        <div className="cmap__controls">
          {pinnedCount > 0 && (
            <button type="button" className="button button--small cmap__tidy" onClick={tidy}>
              Tidy up
            </button>
          )}
          <div className="cmap__zoom" role="group" aria-label="Zoom">
            <button type="button" className="cmap__zoom-button" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={!ready || view.k <= 0.4} aria-label="Zoom out">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 12h12" />
              </svg>
            </button>
            <button type="button" className="cmap__zoom-button" onClick={() => zoomBy(ZOOM_STEP)} disabled={!ready || view.k >= 2.5} aria-label="Zoom in">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 6v12M6 12h12" />
              </svg>
            </button>
            <button type="button" className="cmap__zoom-button" onClick={fit} disabled={!ready || viewState === null} aria-label="Fit the map to the screen">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <ConceptDetail
        concept={selected ? block.nodes.find((n) => n.id === selected) : null}
        edges={block.edges}
        items={items}
        labelOf={labelOf}
        onPick={(id) => {
          pick(id);
          nodeRefs.current.get(id)?.focus({ preventScroll: true });
        }}
      />
      {block.skipped > 0 && (
        <p className="block__note">
          {block.skipped} {block.skipped === 1 ? "link pointed at a concept that wasn't on the map, so it's" : "links pointed at concepts that weren't on the map, so they're"} left
          out.
        </p>
      )}
    </MapFrame>
  );
}

function MapFrame({ block, titleId, mode, onToggle, children }) {
  return (
    <section className="block block--plain cmap" aria-labelledby={titleId}>
      <div className="block__head block__head--plain">
        <div>
          <h2 id={titleId} className="block__title">
            {block.title}
          </h2>
          <p className="block__meta">
            {block.nodes.length} concepts, {block.edges.length} links
          </p>
        </div>
        <button type="button" className="button button--small" aria-pressed={mode === 'list'} onClick={onToggle}>
          {mode === 'map' ? 'Show as list' : 'Show as map'}
        </button>
      </div>
      {children}
    </section>
  );
}

/** What's known about the picked concept: its links and the items that mention it. */
function ConceptDetail({ concept, edges, items, labelOf, onPick }) {
  const mentions = useMemo(() => (concept ? itemsMentioning(items, concept.label) : []), [items, concept]);
  const own = concept ? edges.filter((e) => e.from === concept.id || e.to === concept.id) : [];

  return (
    <div className="cmap__detail">
      <p className="visually-hidden" aria-live="polite">
        {concept
          ? `${concept.label}. ${own.length} ${own.length === 1 ? 'link' : 'links'}, mentioned in ${mentions.length} of ${items.length} practice items.`
          : ''}
      </p>
      {concept ? (
        <div className="cmap__picked">
          <h3 className="cmap__picked-title">{concept.label}</h3>
          {concept.detail && <p className="cmap__picked-detail">{concept.detail}</p>}

          <h4 className="cmap__subhead">Links</h4>
          <ul className="cmap__links">
            {own.map((edge) => {
              // The picked concept in plain text, the other end as a button that picks it.
              const end = (id) =>
                id === concept.id ? (
                  <span className="cmap__self">{labelOf(id)}</span>
                ) : (
                  <button type="button" className="link-button" onClick={() => onPick(id)}>
                    {labelOf(id)}
                  </button>
                );
              return (
                <li key={`${edge.from}>${edge.to}`}>
                  {end(edge.from)} <span className="cmap__verb">{edge.label ?? 'links to'} →</span> {end(edge.to)}
                </li>
              );
            })}
          </ul>

          <h4 className="cmap__subhead">
            In your practice items{' '}
            <span className="cmap__count">
              {mentions.length} of {items.length}
            </span>
          </h4>
          {mentions.length ? (
            <ul className="cmap__mentions">
              {mentions.slice(0, 3).map((item) => (
                <li key={item.id}>{itemText(item)}</li>
              ))}
              {mentions.length > 3 && <li className="cmap__more">and {mentions.length - 3} more</li>}
            </ul>
          ) : (
            <p className="cmap__none">None of them name it. You can ask for some under “Change this set”.</p>
          )}
        </div>
      ) : (
        <p className="cmap__empty">Pick a concept to see what it links to and which practice items mention it.</p>
      )}
    </div>
  );
}

/** The same map as text: every concept with its note, then every link as a sentence. */
function ConceptList({ block, labelOf }) {
  return (
    <div className="cmap-list">
      <h3 className="cmap__subhead">Concepts</h3>
      <dl className="cmap-list__concepts">
        {block.nodes.map((n) => (
          <div key={n.id}>
            <dt>{n.label}</dt>
            {n.detail && <dd>{n.detail}</dd>}
          </div>
        ))}
      </dl>
      <h3 className="cmap__subhead">Links</h3>
      <ul className="cmap-list__links">
        {block.edges.map((e) => (
          <li key={`${e.from}>${e.to}`}>{linkSentence(e, labelOf)}</li>
        ))}
      </ul>
    </div>
  );
}
