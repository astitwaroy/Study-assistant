/**
 * Tells the person when the set isn't exactly what they asked for, and why.
 * Partial results are fine; silently partial results are not.
 */
export function ResultNotice({ notice, count, mode, onDismiss }) {
  const noun = mode === 'quiz' ? 'questions' : 'cards';
  const { warnings = [], dropped = [], requested } = notice;
  const messages = [];

  if (warnings.includes('interrupted')) {
    messages.push(`The model's answer was interrupted, so this set has the ${count} ${noun} that arrived before it stopped.`);
  } else if (warnings.includes('truncated')) {
    messages.push(
      requested && count < requested
        ? `The model's answer was cut off, so you have ${count} of the ${requested} ${noun} you asked for.`
        : `The model's answer was cut off at the end. Everything shown here arrived complete.`,
    );
  } else if (warnings.includes('salvaged')) {
    messages.push(`Part of the model's answer was broken JSON. Recall kept the ${count} ${noun} it could read.`);
  }
  if (dropped.length > 0) {
    messages.push(
      `${dropped.length} ${dropped.length === 1 ? 'item was' : 'items were'} left out because ${
        dropped.length === 1 ? 'it was' : 'they were'
      } incomplete, duplicated, or had an unclear answer.`,
    );
  }
  if (messages.length === 0) return null;

  return (
    <div className="notice notice--info" role="status">
      <div>
        {messages.map((m) => (
          <p key={m}>{m}</p>
        ))}
        {dropped.length > 0 && (
          <details className="disclosure">
            <summary>See what was left out</summary>
            <ul className="disclosure__list">
              {dropped.map((d, i) => (
                <li key={i}>{d.reason}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss this note">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
