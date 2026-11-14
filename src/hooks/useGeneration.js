import { useCallback, useEffect, useReducer, useRef } from 'react';
import { streamGeneration } from '../lib/api.js';
import { GenerationError } from '../lib/errors.js';

/**
 * Runs one model request at a time and tracks its lifecycle.
 *
 *   idle ──run()──▶ running ──▶ success | insufficient | empty | error
 *                     │  ▲
 *                     └──┘ one automatic retry if the answer is unusable
 *
 * Stale responses: every run gets an id. Starting a new run aborts the old
 * request *and* every callback checks `isCurrent()` before touching state,
 * so a slow old response can never overwrite a newer one, even if the abort
 * loses a race with the network.
 */

const IDLE = {
  status: 'idle',
  attempt: 0,
  retryNote: null,
  model: null,
  preview: null,
  slow: false,
  outcome: null,
  error: null,
  raw: '',
  dropped: null,
  salvage: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'start':
      return { ...IDLE, status: 'running', attempt: action.attempt, retryNote: action.retryNote };
    case 'model':
      return { ...state, model: action.model };
    case 'preview':
      return { ...state, preview: action.preview };
    case 'slow':
      return state.status === 'running' ? { ...state, slow: true } : state;
    case 'finish':
      return { ...state, status: STATUS_FOR[action.outcome.kind], outcome: action.outcome, slow: false };
    case 'fail':
      return {
        ...state,
        status: 'error',
        slow: false,
        error: action.error,
        raw: action.raw ?? '',
        dropped: action.dropped ?? null,
        salvage: action.salvage ?? null,
      };
    case 'reset':
      return IDLE;
    default:
      return state;
  }
}

const STATUS_FOR = { ok: 'success', insufficient: 'insufficient', empty: 'empty' };

export function useGeneration({
  send = streamGeneration,
  maxAttempts = 2,
  slowAfterMs = 10_000,
  timeoutMs = 130_000,
} = {}) {
  const [state, dispatch] = useReducer(reducer, IDLE);
  const active = useRef(null); // { id, controller } for the request whose results we want
  const nextId = useRef(0);

  // Abort whatever is in flight if the component using this hook unmounts.
  useEffect(() => () => active.current?.controller.abort(new GenerationError('aborted', 'Unmounted.')), []);

  const reset = useCallback(() => {
    active.current?.controller.abort(new GenerationError('aborted', 'Cancelled.'));
    active.current = null;
    dispatch({ type: 'reset' });
  }, []);

  /**
   * @param body      request body for /api/generate
   * @param handlers  { interpret(text, {finishReason}), preview?(text), salvage?(text) }
   * @returns the outcome if this run finished and is still current, otherwise null
   */
  const run = useCallback(
    async (body, { interpret, preview, salvage }) => {
      active.current?.controller.abort(new GenerationError('aborted', 'Replaced by a newer request.'));
      const id = ++nextId.current;
      const isCurrent = () => active.current?.id === id;

      let retryNote = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        active.current = { id, controller };
        dispatch({ type: 'start', attempt, retryNote });

        let text = '';
        let previewKey = '';
        const slowTimer = setTimeout(() => isCurrent() && dispatch({ type: 'slow' }), slowAfterMs);
        const hardTimer = setTimeout(
          () => controller.abort(new GenerationError('timeout', `No complete answer after ${Math.round(timeoutMs / 1000)} seconds.`)),
          timeoutMs,
        );

        try {
          const { finishReason } = await send(
            { ...body, strict: attempt > 1 },
            {
              signal: controller.signal,
              onStart: (event) => isCurrent() && dispatch({ type: 'model', model: event.model }),
              onDelta: (chunk) => {
                if (!isCurrent()) return;
                text += chunk;
                if (!preview) return;
                const next = preview(text);
                // Only re-render when something visible changed, not on every token.
                const key = `${next.title ?? ''}|${next.items?.length ?? next.changes ?? 0}`;
                if (key !== previewKey) {
                  previewKey = key;
                  dispatch({ type: 'preview', preview: next });
                }
              },
            },
          );
          if (!isCurrent()) return null;

          const outcome = interpret(text, { finishReason });
          if (outcome.kind === 'invalid') {
            if (attempt < maxAttempts) {
              retryNote = outcome.reason;
              continue; // models are non-deterministic; a second try often works
            }
            active.current = null;
            dispatch({ type: 'fail', error: new GenerationError(outcome.code, outcome.reason), raw: text, dropped: outcome.dropped });
            return null;
          }

          active.current = null;
          dispatch({ type: 'finish', outcome });
          return outcome;
        } catch (err) {
          if (!isCurrent()) return null; // superseded or cancelled: say nothing
          const error = err instanceof GenerationError ? err : new GenerationError('unknown', err?.message);
          if (error.code === 'aborted') return null;
          active.current = null;
          // If the stream died partway, keep whatever complete items arrived.
          const partial = text && salvage ? salvage(text) : null;
          dispatch({ type: 'fail', error, raw: text, salvage: partial });
          return null;
        } finally {
          clearTimeout(slowTimer);
          clearTimeout(hardTimer);
        }
      }
      return null;
    },
    [send, maxAttempts, slowAfterMs, timeoutMs],
  );

  return { ...state, run, reset };
}
