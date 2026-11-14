import { useCallback, useEffect, useState } from 'react';
import { fetchHealth } from '../lib/api.js';

/** Which provider the server is using, so the UI can say so (and flag demo mode). */
export function useServerHealth() {
  const [health, setHealth] = useState({ status: 'loading', info: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth({ signal: controller.signal })
      .then((info) => setHealth({ status: 'ok', info }))
      .catch((err) => {
        if (!controller.signal.aborted) setHealth({ status: 'down', info: null, error: err });
      });
    return () => controller.abort();
  }, [attempt]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...health, recheck };
}
