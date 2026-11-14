// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGeneration } from '../src/hooks/useGeneration.js';
import { GenerationError } from '../src/lib/errors.js';
import { interpretSet, previewSet, salvageSet } from '../src/lib/interpret.js';

const handlers = {
  interpret: (text, meta) => interpretSet(text, { mode: 'flashcards', ...meta }),
  preview: (text) => previewSet(text, 'flashcards'),
  salvage: (text) => salvageSet(text, 'flashcards'),
};
const doc = (title, n = 2) =>
  JSON.stringify({ title, items: Array.from({ length: n }, (_, i) => ({ front: `${title} q${i}`, back: 'a' })) });

/** A fake transport whose responses the test resolves by hand, in any order. */
function controllableSend() {
  const calls = [];
  const send = vi.fn((body, { signal, onDelta }) => {
    return new Promise((resolve, reject) => {
      const call = {
        body,
        signal,
        respond(text, finishReason = 'stop') {
          onDelta(text);
          resolve({ finishReason });
        },
        fail(error) {
          reject(error);
        },
        stream(text) {
          onDelta(text);
        },
      };
      // Deliberately ignore abort, like a response that was already in flight.
      calls.push(call);
    });
  });
  return { send, calls };
}

describe('useGeneration', () => {
  it('goes running → success', async () => {
    const { send, calls } = controllableSend();
    const { result } = renderHook(() => useGeneration({ send }));

    let pending;
    act(() => {
      pending = result.current.run({ mode: 'flashcards' }, handlers);
    });
    expect(result.current.status).toBe('running');

    await act(async () => {
      calls[0].respond(doc('Cells'));
      await pending;
    });
    expect(result.current.status).toBe('success');
    expect(result.current.outcome.title).toBe('Cells');
  });

  it('never lets an older response overwrite a newer one', async () => {
    const { send, calls } = controllableSend();
    const { result } = renderHook(() => useGeneration({ send }));

    let first;
    let second;
    act(() => {
      first = result.current.run({ input: 'old' }, handlers);
    });
    act(() => {
      second = result.current.run({ input: 'new' }, handlers);
    });
    expect(calls[0].signal.aborted).toBe(true); // the old request is cancelled...

    await act(async () => {
      calls[1].respond(doc('New'));
      await second;
    });
    await act(async () => {
      calls[0].respond(doc('Old')); // ...and even if it answers anyway, it's ignored
      expect(await first).toBeNull();
    });

    expect(result.current.outcome.title).toBe('New');
  });

  it('retries once, in strict mode, when the answer is unusable', async () => {
    const { send, calls } = controllableSend();
    const { result } = renderHook(() => useGeneration({ send }));

    let pending;
    act(() => {
      pending = result.current.run({}, handlers);
    });
    await act(async () => calls[0].respond('Sorry, no JSON today.'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body.strict).toBe(true);
    expect(result.current.attempt).toBe(2);
    expect(result.current.retryNote).toMatch(/plain text/);

    await act(async () => {
      calls[1].respond(doc('Second try'));
      await pending;
    });
    expect(result.current.status).toBe('success');
  });

  it('shows an error with the raw text after the retry also fails', async () => {
    const { send, calls } = controllableSend();
    const { result } = renderHook(() => useGeneration({ send }));
    act(() => {
      result.current.run({}, handlers);
    });
    await act(async () => calls[0].respond('nope'));
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1].respond('still nope'));

    expect(result.current.status).toBe('error');
    expect(result.current.error.code).toBe('malformed');
    expect(result.current.raw).toBe('still nope');
  });

  it('keeps the items that arrived before a mid-stream failure', async () => {
    const { send, calls } = controllableSend();
    const { result } = renderHook(() => useGeneration({ send }));
    act(() => {
      result.current.run({}, handlers);
    });
    const partial = doc('Partial', 4).slice(0, 80);
    await act(async () => {
      calls[0].stream(partial);
      calls[0].fail(new GenerationError('stalled', 'went quiet'));
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error.code).toBe('stalled');
    expect(result.current.salvage.items.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1); // network errors are not retried automatically
  });

  it('updates the preview as items stream in', async () => {
    const { send, calls } = controllableSend();
    const { result } = renderHook(() => useGeneration({ send }));
    act(() => {
      result.current.run({}, handlers);
    });
    act(() => calls[0].stream('{"title":"Live","items":[{"front":"a","back":"b"},'));
    expect(result.current.preview).toMatchObject({ title: 'Live', items: [{ front: 'a' }] });
  });

  it('flags slow requests and cancels cleanly', async () => {
    vi.useFakeTimers();
    const { send, calls } = controllableSend();
    const { result } = renderHook(() => useGeneration({ send, slowAfterMs: 1000 }));
    act(() => {
      result.current.run({}, handlers);
    });
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.slow).toBe(true);

    act(() => result.current.reset());
    expect(calls[0].signal.aborted).toBe(true);
    expect(result.current.status).toBe('idle');
    vi.useRealTimers();
  });

  it('times out a request that never finishes', async () => {
    vi.useFakeTimers();
    const send = vi.fn((_body, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    const { result } = renderHook(() => useGeneration({ send, timeoutMs: 5000 }));
    act(() => {
      result.current.run({}, handlers);
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error.code).toBe('timeout');
    vi.useRealTimers();
  });
});
