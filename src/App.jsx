import { useCallback, useEffect, useRef, useState } from 'react';
import { CreateView } from './components/CreateView.jsx';
import { Header } from './components/Header.jsx';
import { StudyView } from './components/StudyView.jsx';
import { useGeneration } from './hooks/useGeneration.js';
import { usePersistentState } from './hooks/usePersistentState.js';
import { useSavedSets } from './hooks/useSavedSets.js';
import { useServerHealth } from './hooks/useServerHealth.js';
import { useTheme } from './hooks/useTheme.js';
import { interpretSet, previewSet, salvageSet } from './lib/interpret.js';
import { MODES, makeId } from './lib/schema.js';

const DEFAULT_DRAFT = { input: '', mode: 'flashcards', count: 10 };
const COUNTS = [5, 10, 15, 20];

function validateDraft(value) {
  if (!value || typeof value !== 'object') return undefined;
  return {
    input: typeof value.input === 'string' ? value.input : '',
    mode: MODES.includes(value.mode) ? value.mode : 'flashcards',
    count: COUNTS.includes(value.count) ? value.count : 10,
  };
}

/** Handlers that turn streamed text into a study set for the given mode. */
function setHandlers(mode) {
  return {
    interpret: (text, meta) => interpretSet(text, { mode, ...meta }),
    preview: (text) => previewSet(text, mode),
    salvage: (text) => salvageSet(text, mode),
  };
}

/** "#/set/<id>" opens a set, so the browser back button works on mobile. */
function viewFromHash() {
  const match = location.hash.match(/^#\/set\/([\w-]+)$/);
  return match ? { name: 'study', setId: match[1], notice: null } : { name: 'create' };
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const health = useServerHealth();
  const { sets, saveSet, deleteSet, saveFailed } = useSavedSets();
  const [draft, setDraft] = usePersistentState('recall:draft', DEFAULT_DRAFT, validateDraft);
  const [simulate, setSimulate] = useState('none');
  const [view, setView] = useState(viewFromHash);
  const generation = useGeneration();
  const { run: runGeneration, reset: resetGeneration } = generation;
  const lastRequest = useRef(null);

  useEffect(() => {
    const onPopState = () => setView(viewFromHash());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openSet = useCallback((setId, notice = null) => {
    history.pushState(null, '', `#/set/${setId}`);
    setView({ name: 'study', setId, notice });
    window.scrollTo({ top: 0 });
  }, []);

  const goHome = useCallback(() => {
    history.pushState(null, '', '#/');
    setView({ name: 'create' });
  }, []);

  const createSet = useCallback(
    (outcome, request, extraWarnings = []) => {
      const now = Date.now();
      const set = {
        id: makeId('s'),
        mode: request.mode,
        title: outcome.title,
        sourceText: request.input,
        items: outcome.items,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      saveSet(set);
      resetGeneration();
      openSet(set.id, {
        warnings: [...(outcome.warnings ?? []), ...extraWarnings],
        dropped: outcome.dropped ?? [],
        requested: request.count,
      });
    },
    [saveSet, resetGeneration, openSet],
  );

  const generate = useCallback(
    async (request) => {
      lastRequest.current = request;
      const outcome = await runGeneration(request, setHandlers(request.mode));
      // `run` returns null if this request was cancelled or superseded.
      if (outcome?.kind === 'ok') createSet(outcome, request);
    },
    [runGeneration, createSet],
  );

  const handleSubmit = () => generate({ mode: draft.mode, input: draft.input.trim(), count: draft.count, simulate });
  const handleRetry = () => lastRequest.current && generate(lastRequest.current);
  const handleUseSalvage = () => {
    if (generation.salvage && lastRequest.current) createSet(generation.salvage, lastRequest.current, ['interrupted']);
  };
  const handleOpenSaved = (id) => {
    resetGeneration(); // leaving the form cancels anything still generating
    openSet(id);
  };

  const activeSet = view.name === 'study' ? sets.find((s) => s.id === view.setId) : null;

  return (
    <>
      <Header theme={theme} onToggleTheme={toggleTheme} onHome={goHome} />
      <main className="page" id="main">
        {activeSet ? (
          <StudyView
            key={activeSet.id}
            set={activeSet}
            notice={view.notice}
            simulate={simulate}
            onBack={goHome}
            onUpdate={saveSet}
          />
        ) : (
          <CreateView
            draft={draft}
            onDraftChange={setDraft}
            counts={COUNTS}
            generation={generation}
            health={health}
            simulate={simulate}
            onSimulateChange={setSimulate}
            onSubmit={handleSubmit}
            onRetry={handleRetry}
            onCancel={resetGeneration}
            onUseSalvage={handleUseSalvage}
            sets={sets}
            missingSetId={view.name === 'study' ? view.setId : null}
            onOpenSet={handleOpenSaved}
            onDeleteSet={deleteSet}
            saveFailed={saveFailed}
          />
        )}
      </main>
    </>
  );
}
