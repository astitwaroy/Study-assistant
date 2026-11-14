import { useEffect, useReducer, useState } from 'react';

/**
 * Reads and writes localStorage without ever throwing: storage can be full,
 * disabled (some private modes), or hold data from an older version.
 */
export const storage = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing useful to do
    }
  },
  removePrefix(prefix) {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch {
      // nothing useful to do
    }
  },
};

/**
 * useState that survives reloads. `validate` receives whatever was stored and
 * returns the value to use (or undefined for the fallback), because stored
 * data is as untrusted as model output.
 *
 * The key is read once on mount. Components that need a different key are
 * remounted (see `key={set.id}` in StudyView).
 */
export function usePersistentState(key, fallback, validate = (v) => v) {
  const [state, setState] = useState(() => {
    const stored = storage.read(key, undefined);
    if (stored === undefined) return fallback;
    try {
      return validate(stored) ?? fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    storage.write(key, state);
  }, [key, state]);

  return [state, setState];
}

/**
 * useReducer whose state is saved as { version, state } and restored on
 * mount. `restore(saved)` must validate what it gets and return a state or
 * null; anything that doesn't fit the current data starts fresh via `init()`.
 *
 * @returns [state, dispatch, restored] where `restored` says whether saved
 *          state was picked up (so the UI can say "picked up where you left off").
 */
export function useSavedReducer(key, version, reducer, { restore, init }) {
  const [initial] = useState(() => {
    const restored = safeRestore(storage.read(key, null), restore);
    return { state: restored ?? init(), restored: Boolean(restored) };
  });
  const [state, dispatch] = useReducer(reducer, initial.state);

  useEffect(() => {
    storage.write(key, { version, state });
  }, [key, version, state]);

  return [state, dispatch, initial.restored];
}

function safeRestore(saved, restore) {
  if (!saved) return null;
  try {
    return restore(saved);
  } catch {
    return null;
  }
}
