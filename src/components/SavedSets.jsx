const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

export function SavedSets({ sets, onOpen, onDelete, saveFailed }) {
  return (
    <section className="saved" aria-labelledby="saved-heading">
      <h2 id="saved-heading" className="saved__heading">
        Your sets
      </h2>
      {saveFailed && (
        <p className="notice notice--warn" role="alert">
          This browser wouldn't save your latest change (storage is full or blocked). It will be lost when you close
          the tab.
        </p>
      )}
      {sets.length === 0 ? (
        <p className="saved__empty">Sets you make are saved here in this browser, so you can come back to them.</p>
      ) : (
        <ul className="saved__list">
          {sets.map((set) => (
            <li key={set.id} className="saved__row">
              <button type="button" className="saved__open" onClick={() => onOpen(set.id)}>
                <span className="saved__title">{set.title}</span>
                <span className="saved__meta">
                  {set.mode === 'quiz' ? 'Quiz' : 'Flashcards'}, {set.items.length}{' '}
                  {set.mode === 'quiz' ? 'questions' : 'cards'}
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
          ))}
        </ul>
      )}
    </section>
  );
}
