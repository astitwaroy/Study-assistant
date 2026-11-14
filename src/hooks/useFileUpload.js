import { useCallback, useEffect, useRef, useState } from 'react';
import { FileReadError, joinParts, partsThatFit, readStudyFile } from '../lib/fileText.js';

/**
 * Reads a dropped or chosen file into the notes box.
 *
 * The extracted text replaces the notes (the previous notes come back if
 * the file is removed). For PDFs and slides the person can choose which
 * pages to use; by default we take as many from the start as fit `limit`.
 * Picking a new file while one is still being read cancels the old read,
 * and its result is ignored, the same stale-result rule as model requests.
 */
export function useFileUpload({ limit, currentText, onText }) {
  const [state, setState] = useState({ status: 'idle' });
  const active = useRef(null); // { id, controller }
  const nextId = useRef(0);
  const latestText = useRef(currentText);
  useEffect(() => {
    latestText.current = currentText;
  });
  useEffect(() => () => active.current?.controller.abort(), []);

  const pick = useCallback(
    async (file) => {
      if (!file) return;
      active.current?.controller.abort();
      const id = ++nextId.current;
      const controller = new AbortController();
      active.current = { id, controller };
      const isCurrent = () => active.current?.id === id;
      // Remember what was in the box before the first file, so Remove can restore it.
      const previousText = state.status === 'ready' ? state.previousText : latestText.current;

      setState({ status: 'reading', name: file.name, progress: null });
      try {
        const result = await readStudyFile(file, {
          signal: controller.signal,
          onProgress: (progress) => isCurrent() && setState((s) => ({ ...s, progress })),
        });
        if (!isCurrent()) return;
        const to = result.unit === 'part' ? result.parts.length : partsThatFit(result.parts, limit);
        setState({ status: 'ready', ...result, from: 1, to, previousText });
        onText(joinParts(result.parts, 1, to));
      } catch (err) {
        if (!isCurrent() || controller.signal.aborted) return;
        if (!(err instanceof FileReadError)) console.error(err); // expected problems are shown, not logged
        setState({
          status: 'error',
          name: file.name,
          message: err instanceof FileReadError ? err.message : "Something went wrong while reading that file. Try another copy of it, or paste the notes instead.",
        });
      } finally {
        if (isCurrent()) active.current = null;
      }
    },
    [limit, onText, state],
  );

  const chooseRange = useCallback(
    (from, to) => {
      if (state.status !== 'ready') return;
      const start = Math.max(1, Math.min(from, state.parts.length));
      const end = Math.max(start, Math.min(to, state.parts.length));
      setState((s) => ({ ...s, from: start, to: end }));
      onText(joinParts(state.parts, start, end));
    },
    [state, onText],
  );

  const remove = useCallback(() => {
    if (state.status === 'ready') onText(state.previousText ?? '');
    active.current?.controller.abort();
    active.current = null;
    setState({ status: 'idle' });
  }, [state, onText]);

  return { ...state, pick, chooseRange, remove };
}
