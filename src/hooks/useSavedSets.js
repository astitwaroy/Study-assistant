import { useCallback, useRef, useState } from 'react';
import { MODES, cleanText, LIMITS, normalizeItems } from '../lib/schema.js';
import { storage } from './usePersistentState.js';

const KEY = 'recall:sets:v1';
const MAX_SETS = 20;
export const progressKey = (setId) => `recall:progress:${setId}`;

/**
 * Saved study sets. Stored sets are re-validated with the same normaliser
 * the model's output goes through, so a corrupted or hand-edited
 * localStorage entry can't crash the app; it just gets skipped.
 */
export function restoreSet(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !MODES.includes(raw.mode)) return null;
  if (!Array.isArray(raw.items)) return null;
  const { items } = normalizeItems(raw.items, raw.mode, { keepIds: true });
  if (items.length === 0) return null;
  return {
    id: raw.id,
    mode: raw.mode,
    title: cleanText(raw.title, LIMITS.title) ?? 'Untitled set',
    sourceText: typeof raw.sourceText === 'string' ? raw.sourceText : '',
    items,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    version: Number(raw.version) || 1,
  };
}

function loadSets() {
  const raw = storage.read(KEY, []);
  return Array.isArray(raw) ? raw.map(restoreSet).filter(Boolean) : [];
}

export function useSavedSets() {
  const [sets, setSets] = useState(loadSets);
  const [saveFailed, setSaveFailed] = useState(false);
  // Every change goes through commit(), so this always holds the latest list,
  // even for callers holding a saveSet from an older render (e.g. an async
  // handler that awaited a model response).
  const latest = useRef(sets);

  const commit = useCallback((next) => {
    latest.current = next;
    setSets(next);
    setSaveFailed(!storage.write(KEY, next));
  }, []);

  const saveSet = useCallback(
    (set) => commit([set, ...latest.current.filter((s) => s.id !== set.id)].slice(0, MAX_SETS)),
    [commit],
  );

  const deleteSet = useCallback(
    (id) => {
      storage.remove(progressKey(id));
      commit(latest.current.filter((s) => s.id !== id));
    },
    [commit],
  );

  return { sets, saveSet, deleteSet, saveFailed };
}
