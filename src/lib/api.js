import { GenerationError } from './errors.js';

/**
 * Calls POST /api/generate and streams the model's raw text back through
 * `onDelta`. Resolves with { finishReason } when the server says it's done;
 * rejects with a GenerationError for anything else. See server/generate.js
 * for the NDJSON event format.
 */
export async function streamGeneration(body, { signal, onStart, onDelta, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw abortReasonOr(signal, new GenerationError('network', "Couldn't connect to the Recall server.", { cause: err }));
  }

  if (!res.ok) throw await errorFromResponse(res);

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('ndjson') || !res.body) {
    throw new GenerationError('network', 'The server sent an unexpected response. Is the API server running?');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = null;

  const handleLine = (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return; // one garbled line shouldn't end the stream
    }
    if (event.t === 'start') onStart?.(event);
    else if (event.t === 'delta' && typeof event.v === 'string') onDelta?.(event.v);
    else if (event.t === 'done') finished = { finishReason: event.finishReason ?? null };
    else if (event.t === 'error') {
      throw new GenerationError(event.code || 'provider_error', event.message, { retryAfter: event.retryAfter });
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    handleLine(buffer + decoder.decode());
  } catch (err) {
    if (err instanceof GenerationError) throw err;
    throw abortReasonOr(signal, new GenerationError('stalled', 'The connection dropped before the answer finished.', { cause: err }));
  } finally {
    reader.cancel().catch(() => {});
  }

  if (!finished) throw new GenerationError('stalled', 'The answer ended before the server said it was finished.');
  return finished;
}

async function errorFromResponse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    // e.g. the Vite proxy's HTML error page when the API server is down
  }
  const retryAfter = Number(res.headers.get('retry-after')) || body?.error?.retryAfter;
  if (body?.error?.code) {
    return new GenerationError(body.error.code, body.error.message, { retryAfter });
  }
  if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 500) {
    return new GenerationError('network', `The Recall server didn't answer (HTTP ${res.status}). Is it running?`);
  }
  return new GenerationError('unknown', `Unexpected HTTP ${res.status} from the server.`);
}

function abortReasonOr(signal, fallback) {
  if (signal?.aborted) {
    return signal.reason instanceof GenerationError ? signal.reason : new GenerationError('aborted', 'Cancelled.');
  }
  return fallback;
}

export async function fetchHealth({ signal } = {}) {
  const res = await fetch('/api/health', { signal });
  if (!res.ok) throw new GenerationError('network', `Health check failed (HTTP ${res.status}).`);
  return res.json();
}
