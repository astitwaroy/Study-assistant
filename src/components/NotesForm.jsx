import { useCallback, useId, useRef, useState } from 'react';
import { useFileUpload } from '../hooks/useFileUpload.js';
import { ACCEPT } from '../lib/fileText.js';
import { SAMPLES } from '../lib/samples.js';
import { FileBar } from './FileBar.jsx';
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
  const fileInputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  // Functional update: a file can finish reading after other edits to the draft.
  const setNotes = useCallback((text) => onChange((d) => ({ ...d, input: text })), [onChange]);
  const upload = useFileUpload({ limit: MAX_INPUT, currentText: draft.input, onText: setNotes });
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
      <div
        className={`index-card index-card--input${dragging ? ' index-card--dragging' : ''}`}
        onDragEnter={(event) => {
          if ([...event.dataTransfer.types].includes('Files')) setDragging(true);
        }}
        onDragOver={(event) => {
          if ([...event.dataTransfer.types].includes('Files')) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          upload.pick(event.dataTransfer.files?.[0]);
        }}
      >
        <div className="index-card__head notes-form__head">
          <label htmlFor={textareaId}>Your notes or a topic</label>
          <button
            type="button"
            className="notes-form__upload"
            onClick={() => fileInputRef.current?.click()}
            aria-describedby={`${hintId}-types`}
          >
            <UploadIcon />
            Upload a file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              upload.pick(event.target.files?.[0]);
              event.target.value = ''; // so picking the same file again still works
            }}
          />
        </div>
        {dragging && (
          <div className="notes-form__drop" aria-hidden="true">
            Drop a PDF, PowerPoint or Word file to read its text
          </div>
        )}
        <textarea
          id={textareaId}
          ref={textareaRef}
          className="index-card__body notes-form__textarea"
          value={draft.input}
          onChange={(event) => update({ input: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
          }}
          placeholder={'Paste lecture notes or a textbook section, or upload a PDF, slides or a Word file.\nOr just name a topic, like "the Krebs cycle".'}
          aria-describedby={hintId}
          aria-invalid={tooLong || undefined}
          spellCheck
          rows={8}
        />
      </div>

      <p className="visually-hidden" id={`${hintId}-types`}>
        PDF, PowerPoint (.pptx), Word (.docx) or text files up to 25 MB. The file is read in your browser.
      </p>
      <FileBar upload={upload} limit={MAX_INPUT} textLength={draft.input.length} />

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

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
    </svg>
  );
}
