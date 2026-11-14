import { useCallback, useRef, useState } from 'react';
import { countStatuses, validateStatuses } from '../lib/deck.js';
import { restoreQuiz } from '../lib/quiz.js';
import { MODES, cleanText, LIMITS, makeId, normalizeGuide, normalizeItems } from '../lib/schema.js';
import { storage } from './usePersistentState.js';

const KEY = 'recall:sets:v1';
const MAX_SETS = 20;

// Per-set session state, each saved separately so one corrupt entry can't take the others with it.
export const progressKey = (setId) => `recall:progress:${setId}`; // which cards you know
export const deckKey = (setId) => `recall:deck:${setId}`; // where you are in the deck
export const quizKey = (setId) => `recall:quiz:${setId}`; // the quiz round in progress
export const guideKey = (setId, blockId) => `recall:guide:${setId}:${blockId}`; // checklist ticks

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
    guide: normalizeGuide(raw.guide, { keepIds: true }).blocks,
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
      storage.remove(deckKey(id));
      storage.remove(quizKey(id));
      storage.removePrefix(`recall:guide:${id}:`);
      commit(latest.current.filter((s) => s.id !== id));
    },
    [commit],
  );

  return { sets, saveSet, deleteSet, saveFailed };
}

/** One line about where you are in a set, for the "Your sets" list. */
export function describeProgress(set) {
  const total = set.items.length;
  if (set.mode === 'flashcards') {
    const statuses = validateStatuses(storage.read(progressKey(set.id), {})) ?? {};
    const { known } = countStatuses(set.items.map((i) => i.id), statuses);
    return known > 0 ? `${known} of ${total} known` : null;
  }
  const quiz = restoreQuiz(storage.read(quizKey(set.id), null), set.items, set.version);
  if (!quiz) return null;
  const first = quiz.history[0];
  if (quiz.phase === 'summary' && first) return `Scored ${first.correct} of ${first.total}`;
  const answered = Object.keys(quiz.answers).length;
  if (answered === 0) return first ? `Scored ${first.correct} of ${first.total}` : null;
  return quiz.round > 1 ? `Retaking missed questions` : `On question ${quiz.index + 1} of ${quiz.ids.length}`;
}

/* ---------- export / import ---------- */

export const EXPORT_FORMAT = 'recall-set';

export function exportSet(set) {
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    set: { title: set.title, mode: set.mode, sourceText: set.sourceText, items: set.items, guide: set.guide ?? [] },
  };
}

/**
 * Reads an exported file. The file is untrusted, so it goes through the same
 * validation as model output. Returns { set } or { error }.
 */
export function importSet(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "That file isn't valid JSON." };
  }
  const raw = data?.format === EXPORT_FORMAT ? data.set : data;
  if (!raw || typeof raw !== 'object') return { error: "That file doesn't contain a Recall set." };
  const total = Array.isArray(raw.items) ? raw.items.length : 0;
  const now = Date.now();
  const set = restoreSet({ ...raw, id: makeId('s'), createdAt: now, updatedAt: now, version: 1 });
  if (!set) return { error: "That file doesn't contain any usable flashcards or questions." };
  return { set, skipped: total - set.items.length };
}
