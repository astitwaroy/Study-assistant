import { GenerationStatus } from './GenerationStatus.jsx';
import { NotesForm } from './NotesForm.jsx';
import { SavedSets } from './SavedSets.jsx';
import { SimulatePanel } from './SimulatePanel.jsx';

export function CreateView({
  draft,
  onDraftChange,
  counts,
  generation,
  health,
  simulate,
  onSimulateChange,
  onSubmit,
  onRetry,
  onCancel,
  onUseSalvage,
  sets,
  missingSetId,
  onOpenSet,
  onDeleteSet,
  onImportSet,
  saveFailed,
}) {
  const info = health.info;
  return (
    <div className="create">
      <div className="create__intro">
        <h1 className="create__title">Make flashcards or a quiz from your notes</h1>
        <p className="create__lede">Paste what you're studying or name a topic. Then practise, and drill the ones you miss.</p>
      </div>

      {missingSetId && (
        <p className="notice" role="status">
          That set isn't saved in this browser any more, so here's the start page instead.
        </p>
      )}
      <ServerNotice health={health} />

      <NotesForm
        draft={draft}
        onChange={onDraftChange}
        counts={counts}
        running={generation.status === 'running'}
        onSubmit={onSubmit}
      />

      <GenerationStatus
        generation={generation}
        mode={draft.mode}
        onRetry={onRetry}
        onCancel={onCancel}
        onUseSalvage={onUseSalvage}
      />

      {info?.simulate && <SimulatePanel value={simulate} onChange={onSimulateChange} />}

      <SavedSets sets={sets} onOpen={onOpenSet} onDelete={onDeleteSet} onImport={onImportSet} saveFailed={saveFailed} />

      <footer className="create__footer">
        {info && !info.mock && (
          <p>
            Questions are written by {info.label} ({info.model}). Check anything important against your notes.
          </p>
        )}
      </footer>
    </div>
  );
}

function ServerNotice({ health }) {
  if (health.status === 'down') {
    return (
      <div className="notice notice--warn" role="alert">
        <p>
          <strong>The Recall server isn't responding.</strong> Start it with <code>npm start</code>, then check again.
        </p>
        <button type="button" className="button button--small" onClick={health.recheck}>
          Check again
        </button>
      </div>
    );
  }
  const info = health.info;
  if (info?.problem) {
    return (
      <div className="notice notice--warn" role="alert">
        <p>
          <strong>The server needs one more setting.</strong> {info.problem}
        </p>
      </div>
    );
  }
  if (info?.mock) {
    return (
      <div className="notice" role="status">
        <p>
          <strong>Demo mode.</strong> No API key is set, so answers come from a built-in stand-in, not a real model.
          It works best with the sample notes. Add a key to <code>.env</code> to use Gemini, Groq or Ollama.
        </p>
      </div>
    );
  }
  return null;
}
