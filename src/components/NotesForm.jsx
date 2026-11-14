import { useId, useRef } from 'react';
import { SAMPLES } from '../lib/samples.js';
import { SegmentedControl } from './SegmentedControl.jsx';

export const MAX_INPUT = 12_000;

const MODE_OPTIONS = [
  { value: 'flashcards', label: 'Flashcards' },
  { value: 'quiz', label: 'Quiz' },
];

export function NotesForm({ draft, onChange, counts, running, onSubmit }) {
  const textareaId = useId();
  const hintId = useId();
  const textareaRef = useRef(null);
  const length = draft.input.trim().length;
  const tooLong = draft.input.length > MAX_INPUT;
  const canSubmit = length > 0 && !tooLong;
  const noun = draft.mode === 'quiz' ? 'questions' : 'cards';

  const update = (patch) => onChange({ ...draft, ...patch });

  const submit = (event) => {
    event.preventDefault();
    if (canSubmit) onSubmit();
    else textareaRef.current?.focus();
  };

  return (
    <form className="notes-form" onSubmit={submit} noValidate>
      <div className="index-card index-card--input">
        <label className="index-card__head" htmlFor={textareaId}>
          Your notes or a topic
        </label>
        <textarea
          id={textareaId}
          ref={textareaRef}
          className="index-card__body notes-form__textarea"
          value={draft.input}
          onChange={(event) => update({ input: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
          }}
          placeholder={'Paste lecture notes, a textbook section or an article.\nOr just name a topic, like "the Krebs cycle".'}
          aria-describedby={hintId}
          aria-invalid={tooLong || undefined}
          spellCheck
          rows={8}
        />
      </div>

      <div className="notes-form__meta" id={hintId}>
        <div className="samples">
          <span className="samples__label">Try a sample:</span>
          {SAMPLES.map((sample) => (
            <button
              key={sample.label}
              type="button"
              className="chip"
              onClick={() => {
                update({ input: sample.text });
                textareaRef.current?.focus();
              }}
            >
              {sample.label}
            </button>
          ))}
        </div>
        <span className={`counter${tooLong ? ' counter--over' : ''}`}>
          {tooLong
            ? `${(draft.input.length - MAX_INPUT).toLocaleString()} characters over the limit`
            : `${draft.input.length.toLocaleString()} / ${MAX_INPUT.toLocaleString()}`}
        </span>
      </div>

      <div className="notes-form__controls">
        <SegmentedControl label="Make" options={MODE_OPTIONS} value={draft.mode} onChange={(mode) => update({ mode })} />
        <label className="count-select">
          <span>How many</span>
          <select value={draft.count} onChange={(event) => update({ count: Number(event.target.value) })}>
            {counts.map((n) => (
              <option key={n} value={n}>
                {n} {noun}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button button--primary notes-form__submit" aria-disabled={!canSubmit}>
          {running ? 'Start again' : draft.mode === 'quiz' ? 'Make quiz' : 'Make flashcards'}
        </button>
      </div>
    </form>
  );
}
