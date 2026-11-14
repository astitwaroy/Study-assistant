import { useEffect, useRef } from 'react';
import { useCountdown } from '../hooks/useCountdown.js';
import { describeError } from '../lib/errors.js';

/**
 * Shows what failed, what to do about it, and (when it helps) the model's
 * raw answer and which items were rejected and why.
 */
export function ErrorPanel({ error, raw, dropped, salvage, noun = 'items', onRetry, onUseSalvage, onDismiss, compact = false }) {
  const info = describeError(error);
  const wait = useCountdown(info.retryAfter);
  const headingRef = useRef(null);

  useEffect(() => {
    if (!compact) headingRef.current?.focus();
  }, [compact]);

  const Heading = compact ? 'p' : 'h2';
  return (
    <div className={`panel panel--error${compact ? ' panel--compact' : ''}`} role="alert">
      <Heading className="panel__title" tabIndex={-1} ref={headingRef}>
        {info.title}
      </Heading>
      {info.detail && <p className="panel__detail">{info.detail}</p>}
      <p className="panel__hint">{info.hint}</p>

      <div className="panel__actions">
        {info.retryable && onRetry && (
          <button type="button" className="button button--primary" onClick={onRetry} disabled={wait > 0}>
            {wait > 0 ? `Try again in ${wait}s` : 'Try again'}
          </button>
        )}
        {salvage?.items?.length > 0 && onUseSalvage && (
          <button type="button" className="button" onClick={onUseSalvage}>
            Study the {salvage.items.length} {salvage.items.length === 1 ? noun.replace(/s$/, '') : noun} that arrived
          </button>
        )}
        {onDismiss && (
          <button type="button" className="button button--quiet" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>

      {dropped?.length > 0 && (
        <details className="disclosure">
          <summary>Why each item was rejected ({dropped.length})</summary>
          <ul className="disclosure__list">
            {dropped.map((d, i) => (
              <li key={i}>{d.reason}</li>
            ))}
          </ul>
        </details>
      )}
      {raw && (
        <details className="disclosure">
          <summary>Show the model's raw answer</summary>
          <pre className="disclosure__raw">{raw.length > 4000 ? `${raw.slice(0, 4000)}\n…` : raw}</pre>
        </details>
      )}
    </div>
  );
}
