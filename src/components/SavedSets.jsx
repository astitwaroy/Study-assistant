import { useRef, useState } from 'react';
import { describeProgress, importSet } from '../hooks/useSavedSets.js';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export function SavedSets({ sets, onOpen, onDelete, onImport, saveFailed }) {
  const fileRef = useRef(null);
  const [importMessage, setImportMessage] = useState(null); // { tone, text }

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // so choosing the same file again still fires
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setImportMessage({ tone: 'warn', text: "That file is too big to be a Recall set." });
      return;
    }
    const result = importSet(await file.text());
    if (result.error) {
      setImportMessage({ tone: 'warn', text: result.error });
      return;
    }
    onImport(result.set);
    const noun = result.set.mode === 'quiz' ? 'questions' : 'cards';
    setImportMessage({
      tone: 'done',
      text: `Imported "${result.set.title}" with ${result.set.items.length} ${noun}.${
        result.skipped > 0 ? ` ${result.skipped} unusable ${result.skipped === 1 ? 'item was' : 'items were'} skipped.` : ''
      }`,
    });
  };

  return (
    <section className="saved" aria-labelledby="saved-heading">
      <div className="saved__top">
        <h2 id="saved-heading" className="saved__heading">
          Your sets
        </h2>
        <button type="button" className="button button--small" onClick={() => fileRef.current?.click()}>
          Import a set
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleFile}
        />
      </div>
      {importMessage && (
        <p className={`saved__message saved__message--${importMessage.tone}`} role="status">
          {importMessage.text}
        </p>
      )}
      {saveFailed && (
        <p className="notice notice--warn" role="alert">
          This browser wouldn't save your latest change (storage is full or blocked). It will be lost when you close
          the tab.
        </p>
      )}
      {sets.length === 0 ? (
        <p className="saved__empty">
          Sets you make are saved here in this browser, with your progress, so you can come back to them. Use
          Download on a set to keep a copy or move it to another browser.
        </p>
      ) : (
        <ul className="saved__list">
          {sets.map((set) => {
            const progress = describeProgress(set);
            return (
            <li key={set.id} className="saved__row">
              <button type="button" className="saved__open" onClick={() => onOpen(set.id)}>
                <span className="saved__title">{set.title}</span>
                <span className="saved__meta">
                  {set.mode === 'quiz' ? 'Quiz' : 'Flashcards'}, {set.items.length}{' '}
                  {set.mode === 'quiz' ? 'questions' : 'cards'}
                  {progress && <span className="saved__progress">{progress}</span>}
                </span>
                <span className="saved__date">{dateFormat.format(set.updatedAt)}</span>
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => onDelete(set.id)}
                aria-label={`Delete "${set.title}"`}
                title="Delete"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                </svg>
              </button>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
