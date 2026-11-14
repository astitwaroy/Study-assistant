import { useEffect, useId, useRef, useState } from 'react';
import { useGeneration } from '../hooks/useGeneration.js';
import { interpretRefine, previewRefine } from '../lib/interpret.js';
import { toRefItems } from '../lib/refine.js';
import { ErrorPanel } from './ErrorPanel.jsx';

const SUGGESTIONS = {
  flashcards: ['Add 3 harder cards', 'Make the answers shorter', 'Remove the easiest card'],
  quiz: ['Add 3 harder questions', 'Make the wrong options more convincing', 'Remove the easiest question'],
};

/**
 * Follow-up edits to the current set. A failed or cancelled edit leaves the
 * set exactly as it was; a successful one can be undone.
 */
export function RefinePanel({ set, simulate, onUpdate }) {
  const inputId = useId();
  const [instruction, setInstruction] = useState('');
  const [undo, setUndo] = useState(null); // { items, summary }
  const [conflict, setConflict] = useState(false);
  const edit = useGeneration();
  const noun = set.mode === 'quiz' ? 'question' : 'card';

  // The set as of the latest render, so a finished edit can tell whether the
  // set changed underneath it (e.g. an undo) while the model was working.
  const latestSet = useRef(set);
  useEffect(() => {
    latestSet.current = set;
  });

  const submit = async (event) => {
    event.preventDefault();
    const text = instruction.trim();
    if (!text || edit.status === 'running') return;

    const before = set;
    setConflict(false);
    const { refItems, refToId } = toRefItems(before.items);
    const outcome = await edit.run(
      {
        mode: before.mode,
        input: before.sourceText || before.title,
        count: Math.min(20, Math.max(3, before.items.length)),
        refine: { instruction: text, items: refItems },
        simulate,
      },
      {
        interpret: (raw, meta) => interpretRefine(raw, { mode: before.mode, items: before.items, refToId, ...meta }),
        preview: previewRefine,
      },
    );
    if (outcome?.kind !== 'ok') return;
    if (latestSet.current.version !== before.version) {
      setConflict(true); // don't apply an edit made against an older version
      return;
    }

    onUpdate({ ...before, items: outcome.items, version: before.version + 1, updatedAt: Date.now() });
    setUndo({ items: before.items, summary: outcome.summary, dropped: outcome.dropped?.length ?? 0 });
    setInstruction('');
  };

  const undoChange = () => {
    onUpdate({ ...set, items: undo.items, version: set.version + 1, updatedAt: Date.now() });
    setUndo(null);
  };

  return (
    <section className="refine" aria-labelledby={`${inputId}-label`}>
      <h2 className="refine__heading" id={`${inputId}-label`}>
        Change this set
      </h2>
      <form className="refine__form" onSubmit={submit}>
        <label htmlFor={inputId} className="visually-hidden">
          Describe the change
        </label>
        <input
          id={inputId}
          className="refine__input"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={`For example: ${SUGGESTIONS[set.mode][0].toLowerCase()} on one topic`}
          maxLength={300}
          autoComplete="off"
        />
        {edit.status === 'running' ? (
          <button type="button" className="button" onClick={edit.reset}>
            Cancel
          </button>
        ) : (
          <button type="submit" className="button button--primary" aria-disabled={!instruction.trim()}>
            Apply change
          </button>
        )}
      </form>
      <div className="refine__suggestions">
        {SUGGESTIONS[set.mode].map((s) => (
          <button key={s} type="button" className="chip" onClick={() => setInstruction(s)}>
            {s}
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {edit.status === 'running' && (
          <p className="refine__status">
            <span className="spinner" aria-hidden="true" />
            {edit.preview?.changes
              ? `${edit.preview.changes} ${edit.preview.changes === 1 ? 'change' : 'changes'} so far…`
              : edit.attempt > 1
                ? 'The first answer couldn’t be used. Asking again…'
                : 'Working on it…'}
            {edit.slow && ' This is taking a while.'}
          </p>
        )}
        {edit.status === 'error' && (
          <ErrorPanel compact error={edit.error} raw={edit.raw} dropped={edit.dropped} onRetry={submit} onDismiss={edit.reset} />
        )}
        {edit.status === 'insufficient' && (
          <p className="refine__status refine__status--warn">
            Nothing changed. {edit.outcome.reason}
          </p>
        )}
        {edit.status === 'empty' && (
          <p className="refine__status refine__status--warn">The model didn't suggest any changes, so the set is the same.</p>
        )}
        {edit.status === 'success' && conflict && (
          <p className="refine__status refine__status--warn">
            The set changed while this edit was being written, so it wasn't applied. Try it again.
          </p>
        )}
        {edit.status === 'success' && !conflict && undo && (
          <p className="refine__status refine__status--done">
            {describeChange(undo.summary, noun)}
            {undo.dropped > 0 && ` ${undo.dropped} suggested ${undo.dropped === 1 ? 'change was' : 'changes were'} unusable and skipped.`}{' '}
            <button type="button" className="link-button" onClick={undoChange}>
              Undo
            </button>
          </p>
        )}
      </div>
    </section>
  );
}

function describeChange({ added, updated, removed }, noun) {
  const parts = [];
  const plural = (n) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  if (added) parts.push(`added ${plural(added)}`);
  if (updated) parts.push(`rewrote ${plural(updated)}`);
  if (removed) parts.push(`removed ${plural(removed)}`);
  const sentence = parts.join(', ').replace(/, ([^,]*)$/, ' and $1');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
