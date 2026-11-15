import { useId, useState } from 'react';
import { usePersistentState } from '../hooks/usePersistentState.js';
import { guideKey } from '../hooks/useSavedSets.js';
import { ConceptMapBlock } from './ConceptMap.jsx';

/**
 * The study guide the model returns next to the practice items. Each block
 * type has its own renderer; schema.js guarantees every block has one of
 * these types and the fields its renderer needs.
 */
const BLOCK_RENDERERS = {
  checklist: ChecklistBlock,
  chart: ChartBlock,
  timeline: TimelineBlock,
  concept_map: ConceptMapBlock,
};

export function StudyGuide({ set }) {
  return (
    <div className="guide">
      {set.guide.map((block) => {
        const Block = BLOCK_RENDERERS[block.type];
        return Block ? <Block key={block.id} block={block} setId={set.id} items={set.items} /> : null;
      })}
      <p className="guide__note">Written by the model from your notes. Check anything important against the source.</p>
    </div>
  );
}

/* ---------- checklist ---------- */

function ChecklistBlock({ block, setId }) {
  const [ticks, setTicks] = usePersistentState(guideKey(setId, block.id), {}, (v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? v : undefined,
  );
  const done = block.items.filter((item) => ticks[item.id]).length;

  return (
    <section className="block index-card" aria-labelledby={`${block.id}-title`}>
      <div className="index-card__head block__head">
        <h2 id={`${block.id}-title`} className="block__title">
          {block.title}
        </h2>
        <span className="block__meta">
          {done} of {block.items.length} ticked
        </span>
      </div>
      <ul className="checklist index-card__body">
        {block.items.map((item) => (
          <li key={item.id}>
            <label className="checklist__item">
              <input
                type="checkbox"
                checked={Boolean(ticks[item.id])}
                onChange={(event) => setTicks((t) => ({ ...t, [item.id]: event.target.checked }))}
              />
              <span>{item.text}</span>
            </label>
          </li>
        ))}
      </ul>
      {done > 0 && (
        <div className="block__foot">
          <button type="button" className="link-button" onClick={() => setTicks({})}>
            Untick all
          </button>
        </div>
      )}
    </section>
  );
}

/* ---------- chart ----------
   One series, so no legend: the title says what's plotted. Bars grow from a
   single baseline, capped at 18px thick with a 4px rounded end. Every value
   is printed at its bar's tip (these numbers are the facts being studied),
   long labels are truncated, and hover or focus shows the full label. A
   table view carries everything without the chart. */

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function ChartBlock({ block }) {
  const [view, setView] = useState('chart');
  const [active, setActive] = useState(null);
  const titleId = useId();
  const max = Math.max(...block.data.map((d) => d.value));
  // The unit is in the header ("In molecules"), so the readout is just label and value.
  const describe = (d) => `${d.label}: ${numberFormat.format(d.value)}`;

  return (
    <section className="block block--plain" aria-labelledby={titleId}>
      <div className="block__head block__head--plain">
        <div>
          <h2 id={titleId} className="block__title">
            {block.title}
          </h2>
          {block.unit && <p className="block__meta">In {block.unit}</p>}
        </div>
        <button
          type="button"
          className="button button--small"
          aria-pressed={view === 'table'}
          onClick={() => setView((v) => (v === 'chart' ? 'table' : 'chart'))}
        >
          {view === 'chart' ? 'Show as table' : 'Show as chart'}
        </button>
      </div>

      {view === 'chart' ? (
        <div
          className="bars"
          role="list"
          aria-label={block.unit ? `${block.title}, in ${block.unit}` : block.title}
          onPointerLeave={() => setActive(null)}
        >
          {block.data.map((d, i) => (
            <div
              key={`${d.label}-${i}`}
              className={`bars__row${active === i ? ' bars__row--active' : ''}`}
              role="listitem"
              tabIndex={0}
              aria-label={describe(d)}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <span className="bars__label" aria-hidden="true">
                {d.label}
              </span>
              <span className="bars__track" aria-hidden="true">
                <span className="bars__bar" style={{ width: `${max ? (d.value / max) * 100 : 0}%` }} />
                <span className="bars__value">{numberFormat.format(d.value)}</span>
              </span>
              {active === i && (
                <span className="bars__tooltip" aria-hidden="true">
                  {describe(d)}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <table className="data-table">
          <caption className="visually-hidden">{block.title}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">{block.unit ? `Value (${block.unit})` : 'Value'}</th>
            </tr>
          </thead>
          <tbody>
            {block.data.map((d, i) => (
              <tr key={`${d.label}-${i}`}>
                <th scope="row">{d.label}</th>
                <td>{numberFormat.format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {block.skipped > 0 && (
        <p className="block__note">
          {block.skipped} {block.skipped === 1 ? "value wasn't a number" : "values weren't numbers"}, so{' '}
          {block.skipped === 1 ? "it's" : "they're"} left out.
        </p>
      )}
    </section>
  );
}

/* ---------- timeline ---------- */

function TimelineBlock({ block }) {
  return (
    <section className="block block--plain" aria-labelledby={`${block.id}-title`}>
      <div className="block__head block__head--plain">
        <h2 id={`${block.id}-title`} className="block__title">
          {block.title}
        </h2>
      </div>
      <ol className="timeline">
        {block.events.map((event, i) => (
          <li key={i} className="timeline__event">
            <span className="timeline__when">{event.when}</span>
            <span className="timeline__what">{event.what}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
