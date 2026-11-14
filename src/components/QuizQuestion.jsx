import { useEffect, useId, useRef, useState } from 'react';
import { answerValue, choicesFor, correctChoiceIndex, gradeTyped, isCorrect } from '../lib/quiz.js';

/**
 * Renders a multiple-choice or true/false question. True/false is treated as
 * a two-option choice so grading, keyboard keys and feedback work the same.
 */
export function ChoiceQuestion({ item, order, answer, onChoose, number }) {
  const choices = choicesFor(item);
  const answered = answer !== undefined;
  const correctIndex = correctChoiceIndex(item);
  const chosenIndex = answered ? (item.type === 'mcq' ? answer : answer ? 0 : 1) : null;
  const right = answered && isCorrect(item, answer);
  const prompt = item.type === 'mcq' ? item.question : item.statement;

  return (
    <div className="question">
      <div className="index-card index-card--study">
        <span className="index-card__head">{item.type === 'mcq' ? `Question ${number}` : `Question ${number}: true or false?`}</span>
        <p className="index-card__body index-card__text" id={`prompt-${item.id}`}>
          {prompt}
        </p>
      </div>

      <div
        className={`choices${item.type === 'true_false' ? ' choices--pair' : ''}`}
        role="group"
        aria-labelledby={`prompt-${item.id}`}
      >
        {order.map((choiceIndex, position) => {
          const state = !answered
            ? ''
            : choiceIndex === correctIndex
              ? ' choice--right'
              : choiceIndex === chosenIndex
                ? ' choice--wrong'
                : ' choice--muted';
          return (
            <button
              key={choiceIndex}
              type="button"
              className={`choice${state}`}
              onClick={() => !answered && onChoose(answerValue(item, choiceIndex))}
              aria-disabled={answered || undefined}
              aria-pressed={answered ? choiceIndex === chosenIndex : undefined}
            >
              <span className="choice__key" aria-hidden="true">
                {item.type === 'mcq' ? String.fromCharCode(65 + position) : choices[choiceIndex][0]}
              </span>
              <span className="choice__text">{choices[choiceIndex]}</span>
              {answered && choiceIndex === correctIndex && <span className="choice__tag">Correct answer</span>}
              {answered && choiceIndex === chosenIndex && choiceIndex !== correctIndex && (
                <span className="choice__tag">Your answer</span>
              )}
            </button>
          );
        })}
      </div>

      {answered && (
        <div className={`feedback${right ? ' feedback--right' : ' feedback--wrong'}`} role="status">
          <p className="feedback__verdict">
            {right ? 'Right.' : `Not quite. The answer is ${choices[correctIndex]}.`}
          </p>
          {item.explanation && <p className="feedback__why">{item.explanation}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Fill in the blank: the person types the answer. Exact matches (ignoring
 * case, punctuation and "the/a/an") count. Near misses are shown as "almost"
 * and the person decides whether it was a typo, because one letter can be a
 * different term (NADH vs NADPH).
 */
export function TypedQuestion({ item, answer, onChoose, onOverride, number }) {
  const inputId = useId();
  const [text, setText] = useState(answer?.text ?? '');
  const inputRef = useRef(null);
  const answered = answer !== undefined;

  useEffect(() => {
    if (!answered) inputRef.current?.focus({ preventScroll: true });
  }, [answered]);

  const submit = (event) => {
    event.preventDefault();
    if (answered) return;
    onChoose({ text: text.trim(), verdict: gradeTyped(item, text) });
  };
  const giveUp = () => !answered && onChoose({ text: '', verdict: 'wrong' });

  const expected = item.answers[0];
  const alsoAccepted = item.answers.slice(1);

  return (
    <div className="question">
      <div className="index-card index-card--study">
        <span className="index-card__head">Question {number}: fill in the blank</span>
        <p className="index-card__body index-card__text" id={`prompt-${item.id}`}>
          {item.prompt}
        </p>
      </div>

      <form className="typed" onSubmit={submit}>
        <label htmlFor={inputId} className="typed__label">
          Your answer
        </label>
        <div className="typed__row">
          <input
            id={inputId}
            ref={inputRef}
            className={`typed__input${answered ? ` typed__input--${answer.verdict}` : ''}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            readOnly={answered}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={120}
            aria-describedby={`prompt-${item.id}`}
          />
          {!answered && (
            <button type="submit" className="button button--primary" aria-disabled={!text.trim()}>
              Check
            </button>
          )}
        </div>
        {!answered && (
          <button type="button" className="link-button typed__giveup" onClick={giveUp}>
            I don't know, show me
          </button>
        )}
      </form>

      {answered && (
        <div className={`feedback${answer.verdict === 'right' ? ' feedback--right' : ' feedback--wrong'}`} role="status">
          <p className="feedback__verdict">
            {answer.verdict === 'right'
              ? answer.overridden
                ? 'Counted as right.'
                : 'Right.'
              : answer.verdict === 'close'
                ? `Almost. The expected answer is "${expected}".`
                : `Not quite. The answer is "${expected}".`}
          </p>
          {answer.verdict === 'close' && (
            <p className="feedback__why">If that's what you meant and it was just a typo, count it.</p>
          )}
          {alsoAccepted.length > 0 && (
            <p className="feedback__why">Also accepted: {alsoAccepted.join(', ')}.</p>
          )}
          {item.explanation && <p className="feedback__why">{item.explanation}</p>}
          {answer.verdict !== 'right' && answer.text && (
            <button type="button" className="link-button feedback__override" onClick={onOverride}>
              {answer.verdict === 'close' ? 'It was a typo: count it as right' : 'My answer means the same: count it'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
