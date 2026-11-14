import { useEffect, useReducer, useRef } from 'react';
import { useHotkeys } from '../hooks/useHotkeys.js';
import { choiceLabel, isCorrect, newRound, optionOrders, quizReducer, score } from '../lib/quiz.js';
import { Progress } from './FlashcardDeck.jsx';
import { KeyHints } from './KeyHints.jsx';
import { ChoiceQuestion } from './QuizQuestion.jsx';

/**
 * One renderer per question type. The model can mix types in one quiz, and
 * schema.js guarantees every item has a type listed here. A new block type
 * means a normaliser in schema.js plus an entry in this map.
 */
const QUESTION_RENDERERS = {
  mcq: ChoiceQuestion,
  true_false: ChoiceQuestion,
};

export function Quiz({ set }) {
  const items = set.items;
  const [quiz, dispatch] = useReducer(quizReducer, null, () => newRound(items, items.map((i) => i.id), {}));
  const nextRef = useRef(null);

  const item = items.find((i) => i.id === quiz.ids[quiz.index]);
  const answer = item ? quiz.answers[item.id] : undefined;
  const answered = answer !== undefined;

  // After answering, move focus to "Next" so Enter continues.
  useEffect(() => {
    if (answered) nextRef.current?.focus();
  }, [answered]);

  const choose = (value) => item && dispatch({ type: 'answer', id: item.id, answer: value });
  const next = () => dispatch({ type: 'next', items });
  const retake = (ids, keepHistory) =>
    dispatch({ type: 'retake', items, ids, keepHistory, orders: optionOrders(items, ids, { shuffled: true }) });

  if (quiz.phase === 'summary') {
    return <Summary items={items} quiz={quiz} onRetake={retake} />;
  }

  const Question = QUESTION_RENDERERS[item.type];
  const runningScore = Object.entries(quiz.answers).filter(([id, a]) => {
    const it = items.find((i) => i.id === id);
    return it && isCorrect(it, a);
  }).length;

  return (
    <section className="quiz" aria-label="Quiz">
      <div className="deck__bar">
        <p className="deck__position">
          {quiz.round > 1 ? `Retake ${quiz.round - 1}: question ` : 'Question '}
          {quiz.index + 1} of {quiz.ids.length}
        </p>
        <p className="deck__tally">
          <span className="tally tally--known">{runningScore} right</span>
        </p>
      </div>
      <Progress value={quiz.index + (answered ? 1 : 0)} max={quiz.ids.length} />

      <Question
        key={`${quiz.round}-${item.id}`}
        item={item}
        order={quiz.orders[item.id]}
        answer={answer}
        onChoose={choose}
        number={quiz.index + 1}
      />

      {answered && (
        <div className="quiz__next">
          <button ref={nextRef} type="button" className="button button--primary" onClick={next}>
            {quiz.index + 1 < quiz.ids.length ? 'Next question' : 'See results'}
          </button>
        </div>
      )}

      <QuizHotkeys item={item} order={quiz.orders[item.id]} answered={answered} onChoose={choose} onNext={next} />
    </section>
  );
}

function QuizHotkeys({ item, order, answered, onChoose, onNext }) {
  const bindings = {};
  order.forEach((choiceIndex, position) => {
    const pick = () => !answered && onChoose(item.type === 'mcq' ? choiceIndex : choiceIndex === 0);
    bindings[String(position + 1)] = pick;
    bindings[String.fromCharCode(97 + position)] = pick; // a, b, c…
  });
  if (item.type === 'true_false') {
    bindings.t = () => !answered && onChoose(true);
    bindings.f = () => !answered && onChoose(false);
  }
  bindings.Enter = () => answered && onNext();
  bindings.ArrowRight = () => answered && onNext();
  useHotkeys(bindings);

  return (
    <KeyHints
      hints={
        item.type === 'mcq'
          ? [
              ['1–' + order.length, 'choose'],
              ['Enter', 'next'],
            ]
          : [
              ['T', 'true'],
              ['F', 'false'],
              ['Enter', 'next'],
            ]
      }
    />
  );
}

function Summary({ items, quiz, onRetake }) {
  const { correct, total, missed } = score(items, quiz);
  const allIds = items.map((i) => i.id);
  const headingRef = useRef(null);
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <section className="quiz quiz--summary" aria-labelledby="quiz-summary">
      <div className="round-summary">
        <h2 id="quiz-summary" className="round-summary__title" tabIndex={-1} ref={headingRef}>
          {missed.length === 0
            ? quiz.round > 1
              ? `All ${total} right this time`
              : `All ${total} right`
            : `You got ${correct} of ${total} right`}
        </h2>
        {quiz.history.length > 1 && (
          <ol className="round-history" aria-label="Rounds so far">
            {quiz.history.map((h) => (
              <li key={h.round}>
                {h.round === 1 ? 'First try' : `Retake ${h.round - 1}`}: {h.correct} of {h.total}
              </li>
            ))}
          </ol>
        )}
        <div className="round-summary__actions">
          {missed.length > 0 && (
            <button type="button" className="button button--primary" onClick={() => onRetake(missed.map((m) => m.id), true)}>
              Retake the {missed.length} you missed
            </button>
          )}
          <button
            type="button"
            className={`button${missed.length ? '' : ' button--primary'}`}
            onClick={() => onRetake(allIds, false)}
          >
            Retake all {allIds.length}
          </button>
        </div>
      </div>

      {missed.length > 0 && (
        <div className="missed">
          <h3 className="missed__heading">What you missed</h3>
          <ol className="missed__list">
            {missed.map((item) => (
              <li key={item.id} className="missed__item">
                <p className="missed__question">{item.question ?? item.statement}</p>
                <p className="missed__answers">
                  <span className="missed__yours">You said: {choiceLabel(item, quiz.answers[item.id])}</span>
                  <span className="missed__right">
                    Answer: {choiceLabel(item, item.type === 'mcq' ? item.answerIndex : item.answer)}
                  </span>
                </p>
                {item.explanation && <p className="missed__why">{item.explanation}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
