import { answerValue, choicesFor, correctChoiceIndex, isCorrect } from '../lib/quiz.js';

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
