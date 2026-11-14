import { useRef, useState } from 'react';
import { useHotkeys } from '../hooks/useHotkeys.js';
import { usePersistentState, useSavedReducer } from '../hooks/usePersistentState.js';
import { deckKey, progressKey } from '../hooks/useSavedSets.js';
import { useSwipe } from '../hooks/useSwipe.js';
import { countStatuses, deckReducer, newPass, restorePass, validateStatuses } from '../lib/deck.js';
import { shuffle } from '../lib/quiz.js';
import { KeyHints } from './KeyHints.jsx';

/**
 * Which cards you know and where you are in the deck are both saved, so
 * coming back to a set picks up on the same card. `active` is false while
 * another tab is showing, which turns the shortcuts off.
 */
export function FlashcardDeck({ set, active = true }) {
  const allIds = set.items.map((item) => item.id);
  const [statuses, setStatuses] = usePersistentState(progressKey(set.id), {}, validateStatuses);
  const [deck, dispatch, restored] = useSavedReducer(deckKey(set.id), set.version, deckReducer, {
    restore: (saved) => restorePass(saved, allIds, set.version),
    init: () => newPass(allIds),
  });
  const [showResumed, setShowResumed] = useState(restored && deck.index > 0 && deck.index < deck.order.length);
  const flipRef = useRef(null);

  const card = set.items.find((item) => item.id === deck.order[deck.index]);
  const done = deck.index >= deck.order.length;
  const counts = countStatuses(allIds, statuses);
  const learningIds = allIds.filter((id) => statuses[id] === 'learning');

  const mark = (status) => {
    if (!card) return;
    setShowResumed(false);
    setStatuses((current) => ({ ...current, [card.id]: status }));
    dispatch({ type: 'next' });
  };
  const start = (ids, kind) => {
    setShowResumed(false);
    dispatch({ type: 'start', ids, kind });
    requestAnimationFrame(() => flipRef.current?.focus());
  };
  const swipe = useSwipe({ onSwipeRight: () => mark('known'), onSwipeLeft: () => mark('learning') });
  const lean = Math.max(-1, Math.min(1, swipe.dx / swipe.threshold)); // -1 … 1

  useHotkeys(
    {
      ' ': () => dispatch({ type: 'flip' }),
      Enter: () => dispatch({ type: 'flip' }),
      ArrowRight: () => dispatch({ type: 'next' }),
      ArrowLeft: () => dispatch({ type: 'prev' }),
      1: () => mark('learning'),
      2: () => mark('known'),
    },
    active && !done,
  );

  if (done) {
    return (
      <section className="deck deck--done" aria-labelledby="deck-done">
        <div className="round-summary">
          <h2 id="deck-done" className="round-summary__title">
            {counts.learning === 0 && counts.known === allIds.length
              ? `You know all ${allIds.length} cards`
              : `You know ${counts.known} of ${allIds.length} cards`}
          </h2>
          <p className="round-summary__text">
            {counts.learning > 0
              ? `${counts.learning} ${counts.learning === 1 ? 'card is' : 'cards are'} marked "Still learning".`
              : counts.unseen > 0
                ? `You skipped ${counts.unseen} without marking them.`
                : 'Nothing left to review in this set.'}
          </p>
          <div className="round-summary__actions">
            {learningIds.length > 0 && (
              <button type="button" className="button button--primary" onClick={() => start(learningIds, 'review')}>
                Review the {learningIds.length} still learning
              </button>
            )}
            <button
              type="button"
              className={`button${learningIds.length ? '' : ' button--primary'}`}
              onClick={() => {
                setStatuses({});
                start(allIds, 'all');
              }}
            >
              Start over with all {allIds.length}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const position = deck.index + 1;
  return (
    <section className="deck" aria-label="Flashcards">
      <div className="deck__bar">
        <p className="deck__position">
          {deck.kind === 'review' ? 'Reviewing ' : 'Card '}
          {position} of {deck.order.length}
        </p>
        <div className="deck__tally" aria-label={`${counts.known} known, ${counts.learning} still learning`}>
          <span className="tally tally--known">{counts.known} known</span>
          <span className="tally tally--learning">{counts.learning} learning</span>
        </div>
        <button
          type="button"
          className="button button--small"
          onClick={() => start(shuffle(deck.order), deck.kind)}
          disabled={deck.order.length < 2}
        >
          Shuffle
        </button>
      </div>
      <Progress value={deck.index} max={deck.order.length} />

      {showResumed && (
        <p className="resumed" role="status">
          Picked up at card {deck.index + 1}.{' '}
          <button type="button" className="link-button" onClick={() => start(allIds, 'all')}>
            Start from the first card
          </button>
        </p>
      )}

      <div className="swipe-zone">
        <span className="swipe-stamp swipe-stamp--learning" style={{ opacity: Math.max(0, -lean) }} aria-hidden="true">
          Still learning
        </span>
        <span className="swipe-stamp swipe-stamp--known" style={{ opacity: Math.max(0, lean) }} aria-hidden="true">
          Got it
        </span>
      <button
        ref={flipRef}
        type="button"
        className={`flip${swipe.dx ? ' flip--dragging' : ''}`}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px) rotate(${swipe.dx / 28}deg)` } : undefined}
        {...swipe.handlers}
        data-flipped={deck.flipped}
        onClick={() => dispatch({ type: 'flip' })}
        aria-label={deck.flipped ? `Answer: ${card.back}. Select to see the question.` : `Question: ${card.front}. Select to see the answer.`}
      >
        <span className="flip__inner">
          <span className="flip__face index-card index-card--study" aria-hidden={deck.flipped}>
            <span className="index-card__head">{set.title}</span>
            <span className="index-card__body index-card__text">{card.front}</span>
          </span>
          <span className="flip__face flip__face--back index-card index-card--study" aria-hidden={!deck.flipped}>
            <span className="index-card__head">Answer</span>
            <span className="index-card__body index-card__text">{card.back}</span>
          </span>
        </span>
      </button>
      </div>
      <p className="swipe-hint">Tap the card to flip it. Swipe right if you know it, left if you're still learning.</p>
      {statuses[card.id] && (
        <p className="deck__status">
          Last time: {statuses[card.id] === 'known' ? 'got it' : 'still learning'}
        </p>
      )}

      <div className="deck__nav">
        <button type="button" className="button" onClick={() => dispatch({ type: 'prev' })} disabled={deck.index === 0}>
          Previous
        </button>
        <button type="button" className="button" onClick={() => dispatch({ type: 'flip' })}>
          {deck.flipped ? 'Show question' : 'Show answer'}
        </button>
        <button type="button" className="button" onClick={() => dispatch({ type: 'next' })}>
          Skip
        </button>
      </div>
      <div className="deck__grade">
        <button type="button" className="button button--grade button--learning" onClick={() => mark('learning')}>
          Still learning
        </button>
        <button type="button" className="button button--grade button--known" onClick={() => mark('known')}>
          Got it
        </button>
      </div>

      <KeyHints
        hints={[
          ['Space', 'flip'],
          ['←', 'previous'],
          ['→', 'skip'],
          ['1', 'still learning'],
          ['2', 'got it'],
        ]}
      />
    </section>
  );
}

export function Progress({ value, max }) {
  return (
    <div className="progress" aria-hidden="true">
      <span className="progress__fill" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </div>
  );
}
