import { useId, useRef, useState } from 'react';
import { exportSet } from '../hooks/useSavedSets.js';
import { FlashcardDeck } from './FlashcardDeck.jsx';
import { Quiz } from './Quiz.jsx';
import { RefinePanel } from './RefinePanel.jsx';
import { ResultNotice } from './ResultNotice.jsx';
import { StudyGuide } from './StudyGuide.jsx';

const TABS = ['practice', 'guide'];

/**
 * One study set. Mounted with key={set.id}, so switching sets resets all
 * local state (and aborts any edit still in flight).
 */
export function StudyView({ set, notice, simulate, onBack, onUpdate }) {
  const [showNotice, setShowNotice] = useState(Boolean(notice));
  const [tab, setTab] = useState('practice');
  const tabIds = useId();
  const tabRefs = useRef({});
  const isQuiz = set.mode === 'quiz';
  const count = set.items.length;
  const guide = set.guide ?? [];
  const hasGuide = guide.length > 0;

  const download = () => {
    const blob = new Blob([JSON.stringify(exportSet(set), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${set.title.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'recall-set'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Arrow keys move between tabs (the standard tablist pattern).
  const onTabKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); // also keeps the deck's arrow shortcuts from firing
    const next = TABS[(TABS.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const practice = isQuiz ? (
    <Quiz key={set.version} set={set} active={tab === 'practice'} />
  ) : (
    <FlashcardDeck key={set.version} set={set} active={tab === 'practice'} />
  );

  return (
    <article className="study">
      <nav className="study__nav">
        <button type="button" className="button button--quiet button--back" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          New set
        </button>
        <button type="button" className="button button--quiet" onClick={download}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
          Download
        </button>
      </nav>

      <header className="study__header">
        <h1 className="study__title">{set.title}</h1>
        <p className="study__meta">
          {isQuiz ? 'Quiz' : 'Flashcards'}, {count} {isQuiz ? (count === 1 ? 'question' : 'questions') : count === 1 ? 'card' : 'cards'}
        </p>
      </header>

      {showNotice && notice && <ResultNotice notice={notice} count={count} mode={set.mode} onDismiss={() => setShowNotice(false)} />}

      {hasGuide ? (
        <>
          <div className="tabs" role="tablist" aria-label="Study set views" onKeyDown={onTabKeyDown}>
            {TABS.map((name) => (
              <button
                key={name}
                ref={(el) => {
                  tabRefs.current[name] = el;
                }}
                type="button"
                role="tab"
                id={`${tabIds}-${name}-tab`}
                aria-controls={`${tabIds}-${name}-panel`}
                aria-selected={tab === name}
                tabIndex={tab === name ? 0 : -1}
                className="tabs__tab"
                onClick={() => setTab(name)}
              >
                {name === 'practice' ? (isQuiz ? 'Quiz' : 'Flashcards') : 'Study guide'}
              </button>
            ))}
          </div>
          {/* Both panels stay mounted so switching tabs never loses your place. */}
          <div role="tabpanel" id={`${tabIds}-practice-panel`} aria-labelledby={`${tabIds}-practice-tab`} hidden={tab !== 'practice'}>
            {practice}
          </div>
          <div role="tabpanel" id={`${tabIds}-guide-panel`} aria-labelledby={`${tabIds}-guide-tab`} hidden={tab !== 'guide'}>
            <StudyGuide set={set} />
          </div>
        </>
      ) : (
        practice
      )}

      <RefinePanel set={set} simulate={simulate} onUpdate={onUpdate} />
    </article>
  );
}
