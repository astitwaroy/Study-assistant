import { useState } from 'react';
import { FlashcardDeck } from './FlashcardDeck.jsx';
import { Quiz } from './Quiz.jsx';
import { RefinePanel } from './RefinePanel.jsx';
import { ResultNotice } from './ResultNotice.jsx';

/**
 * One study set. Mounted with key={set.id}, so switching sets resets all
 * local state (and aborts any edit still in flight).
 */
export function StudyView({ set, notice, simulate, onBack, onUpdate }) {
  const [showNotice, setShowNotice] = useState(Boolean(notice));
  const isQuiz = set.mode === 'quiz';
  const count = set.items.length;

  return (
    <article className="study">
      <nav className="study__nav">
        <button type="button" className="button button--quiet button--back" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          New set
        </button>
      </nav>

      <header className="study__header">
        <h1 className="study__title">{set.title}</h1>
        <p className="study__meta">
          {isQuiz ? 'Quiz' : 'Flashcards'}, {count} {isQuiz ? (count === 1 ? 'question' : 'questions') : count === 1 ? 'card' : 'cards'}
        </p>
      </header>

      {showNotice && notice && <ResultNotice notice={notice} count={count} mode={set.mode} onDismiss={() => setShowNotice(false)} />}

      {/* Keyed by version: after an edit the deck or quiz starts fresh with the new items. */}
      {isQuiz ? <Quiz key={set.version} set={set} /> : <FlashcardDeck key={set.version} set={set} />}

      <RefinePanel set={set} simulate={simulate} onUpdate={onUpdate} />
    </article>
  );
}
