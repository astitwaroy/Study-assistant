import { describe, expect, it } from 'vitest';
import { streamGeneration } from '../src/lib/api.js';

function ndjsonResponse(chunks, { status = 200, type = 'application/x-ndjson' } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': type } });
}

const run = (response, handlers = {}) => streamGeneration({}, { fetchImpl: async () => response, ...handlers });

describe('streamGeneration', () => {
  it('reassembles events split across network chunks', async () => {
    const deltas = [];
    const result = await run(
      ndjsonResponse(['{"t":"start","model":"m"}\n{"t":"del', 'ta","v":"ab"}\n{"t":"delta","v":"c"}', '\n{"t":"done","finishReason":"stop"}']),
      { onDelta: (d) => deltas.push(d) },
    );
    expect(deltas.join('')).toBe('abc');
    expect(result).toEqual({ finishReason: 'stop' });
  });

  it('throws the server error code from an error event', async () => {
    await expect(run(ndjsonResponse(['{"t":"delta","v":"x"}\n{"t":"error","code":"stalled","message":"quiet"}\n']))).rejects.toMatchObject({
      code: 'stalled',
      message: 'quiet',
    });
  });

  it('treats a stream that ends without "done" as stalled', async () => {
    await expect(run(ndjsonResponse(['{"t":"delta","v":"x"}\n']))).rejects.toMatchObject({ code: 'stalled' });
  });

  it('reads JSON error bodies from non-2xx responses', async () => {
    const response = new Response(JSON.stringify({ error: { code: 'auth', message: 'bad key' } }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
    await expect(run(response)).rejects.toMatchObject({ code: 'auth', message: 'bad key' });
  });

  it('explains a missing backend (proxy error page)', async () => {
    const response = new Response('<html>proxy error</html>', { status: 502, headers: { 'content-type': 'text/html' } });
    await expect(run(response)).rejects.toMatchObject({ code: 'network' });
  });

  it('reports network failures', async () => {
    await expect(
      streamGeneration({}, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('reports an abort as aborted, not as a network error', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      streamGeneration({}, { signal: controller.signal, fetchImpl: async () => { throw new DOMException('x', 'AbortError'); } }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});
