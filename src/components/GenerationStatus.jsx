import { ErrorPanel } from './ErrorPanel.jsx';

/**
 * Everything that can happen after "Make flashcards": streaming progress,
 * the slow-request notice, the automatic retry, and every way it can end
 * other than success (success navigates to the study view).
 */
export function GenerationStatus({ generation, mode, onRetry, onCancel, onUseSalvage }) {
  const { status } = generation;
  const noun = mode === 'quiz' ? 'questions' : 'flashcards';

  return (
    <>
      {/* Screen readers get short progress updates, not every card in the stack. Errors announce themselves (role="alert"). */}
      <p className="visually-hidden" aria-live="polite">
        {liveMessage(generation, noun)}
      </p>
      <section className="status" aria-busy={status === 'running'}>
      {status === 'running' && <Running generation={generation} noun={noun} onCancel={onCancel} />}

      {status === 'error' && (
        <ErrorPanel
          error={generation.error}
          raw={generation.raw}
          dropped={generation.dropped}
          salvage={generation.salvage}
          noun={noun}
          onRetry={onRetry}
          onUseSalvage={onUseSalvage}
          onDismiss={onCancel}
        />
      )}

      {status === 'insufficient' && (
        <div className="panel">
          <h2 className="panel__title">There isn't enough here to make {noun} from</h2>
          <p className="panel__quote">{generation.outcome.reason}</p>
          <p className="panel__hint">Add more detail to your notes, or try one of the samples above.</p>
          <div className="panel__actions">
            <button type="button" className="button" onClick={onCancel}>
              Edit notes
            </button>
          </div>
        </div>
      )}

      {status === 'empty' && (
        <div className="panel">
          <h2 className="panel__title">The model sent back an empty set</h2>
          <p className="panel__hint">Its answer was valid but had no {noun} in it. Trying again usually works.</p>
          <div className="panel__actions">
            <button type="button" className="button button--primary" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="button button--quiet" onClick={onCancel}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      </section>
    </>
  );
}

function liveMessage({ status, preview, slow }, noun) {
  if (status === 'running') {
    const n = preview?.items?.length ?? 0;
    if (slow && n === 0) return `Still working on your ${noun}.`;
    return n === 0 ? `Writing your ${noun}.` : `${n} ${noun} so far.`;
  }
  if (status === 'insufficient') return `There isn't enough here to make ${noun} from.`;
  if (status === 'empty') return 'The model sent back an empty set.';
  return '';
}

function Running({ generation, noun, onCancel }) {
  const { preview, slow, attempt, retryNote } = generation;
  const items = preview?.items ?? [];
  const singular = noun === 'questions' ? 'question' : 'flashcard';

  return (
    <div className="running">
      <div className="running__header">
        <p className="running__line">
          <span className="spinner" aria-hidden="true" />
          {items.length === 0
            ? attempt > 1
              ? 'Asking the model again…'
              : `Writing your ${noun}…`
            : `${items.length} ${items.length === 1 ? singular : noun} so far…`}
        </p>
        <button type="button" className="button button--small" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {attempt > 1 && retryNote && (
        <p className="running__note">The first answer couldn't be used ({lowerFirst(retryNote)}), so Recall asked again.</p>
      )}
      {slow && (
        <p className="running__note">
          Still working. Some models think for up to a minute before they start answering.
        </p>
      )}

      {preview?.title && <p className="running__title">{preview.title}</p>}
      <ol className="stack" aria-label={`${noun} received so far`}>
        {items.map((item, index) => (
          <li key={index} className="stack__card index-card index-card--mini">
            <span className="index-card__head">{index + 1}</span>
            <span className="index-card__body">{item.front ?? item.question ?? item.statement}</span>
          </li>
        ))}
        <li className="stack__card stack__card--pending index-card index-card--mini" aria-hidden="true">
          <span className="index-card__head">{items.length + 1}</span>
          <span className="index-card__body">
            <span className="typing" />
          </span>
        </li>
      </ol>
    </div>
  );
}

function lowerFirst(text) {
  const clean = text.replace(/\.$/, '');
  return clean.charAt(0).toLowerCase() + clean.slice(1);
}
