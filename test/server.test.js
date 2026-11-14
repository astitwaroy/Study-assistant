import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/index.js';
import { streamChat } from '../server/llm.js';
import { createSSEParser } from '../server/sse.js';

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve({ server, url: `http://localhost:${server.address().port}` }));
  });
}

async function readNdjson(res) {
  const text = await res.text();
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

describe('createSSEParser', () => {
  it('reassembles events split across chunks', () => {
    const parser = createSSEParser();
    expect(parser.feed('data: {"a"')).toEqual([]);
    expect(parser.feed(':1}\n')).toEqual([]);
    expect(parser.feed('\n: keep-alive\n\ndata: [DONE]\r\n\r\n')).toEqual(['{"a":1}', '[DONE]']);
  });

  it('flushes a final event with no trailing blank line', () => {
    const parser = createSSEParser();
    parser.feed('data: last');
    expect(parser.end()).toEqual(['last']);
  });
});

describe('loadConfig', () => {
  it('falls back to demo mode with no key', () => {
    expect(loadConfig({}).provider).toBe('mock');
  });
  it('defaults to Gemini when only a key is set', () => {
    expect(loadConfig({ LLM_API_KEY: 'k' })).toMatchObject({ provider: 'gemini', problem: null });
  });
  it('explains a missing key instead of crashing', () => {
    expect(loadConfig({ LLM_PROVIDER: 'groq' }).problem).toMatch(/LLM_API_KEY/);
    expect(loadConfig({ LLM_PROVIDER: 'nope' }).problem).toMatch(/Unknown/);
  });
});

describe('streamChat against a fake OpenAI-compatible provider', () => {
  let upstream;
  const requests = [];

  beforeAll(async () => {
    upstream = await listen((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body);
        requests.push({ json, auth: req.headers.authorization });
        const model = json.model;
        if (model === 'no-json-mode' && json.response_format) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: 'response_format is not supported' } }));
        }
        if (model === 'bad-key') {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
        }
        if (model === 'busy') {
          res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '7' });
          return res.end('{"error":{"message":"slow down"}}');
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (content, finish = null) =>
          `data: ${JSON.stringify({ choices: [{ delta: content ? { content } : {}, finish_reason: finish }] })}\n\n`;
        res.write(chunk('{"items":'));
        res.write(': keep-alive\n\n');
        res.write('data: not json at all\n\n');
        if (model === 'dies') {
          res.write(`data: ${JSON.stringify({ error: { message: 'overloaded' } })}\n\n`);
          return res.end();
        }
        res.write(chunk('[]}'));
        res.write(chunk('', 'stop'));
        res.end('data: [DONE]\n\n');
      });
    });
  });
  afterAll(() => upstream.server.close());

  const config = (model, extra) => ({ baseUrl: upstream.url, model, apiKey: 'secret', label: 'Fake', jsonMode: true, extraBody: {}, ...extra });
  const collect = async (gen) => {
    const events = [];
    for await (const e of gen) events.push(e);
    return events;
  };

  it('streams deltas, skips junk lines and reports the finish reason', async () => {
    const events = await collect(streamChat({ config: config('ok'), messages: [] }));
    expect(events).toEqual([
      { type: 'open' },
      { type: 'delta', text: '{"items":' },
      { type: 'delta', text: '[]}' },
      { type: 'finish', reason: 'stop' },
    ]);
    const last = requests.at(-1);
    expect(last.auth).toBe('Bearer secret');
    expect(last.json).toMatchObject({ stream: true, response_format: { type: 'json_object' } });
  });

  it('retries without JSON mode when the model rejects it', async () => {
    const events = await collect(streamChat({ config: config('no-json-mode'), messages: [] }));
    expect(events[0]).toEqual({ type: 'open' });
    expect(requests.at(-1).json.response_format).toBeUndefined();
  });

  it('maps HTTP errors to error codes', async () => {
    await expect(collect(streamChat({ config: config('bad-key'), messages: [] }))).rejects.toMatchObject({ code: 'auth' });
    await expect(collect(streamChat({ config: config('busy'), messages: [] }))).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfter: 7,
    });
  });

  it('turns an error event mid-stream into an AppError', async () => {
    await expect(collect(streamChat({ config: config('dies'), messages: [] }))).rejects.toMatchObject({
      code: 'provider_error',
    });
  });

  it('reports an unreachable provider', async () => {
    await expect(
      collect(streamChat({ config: config('ok', { baseUrl: 'http://localhost:9' }), messages: [] })),
    ).rejects.toMatchObject({ code: 'provider_unreachable' });
  });
});

describe('POST /api/generate (demo mode)', () => {
  let api;
  beforeAll(async () => {
    const config = loadConfig({ ALLOW_SIMULATE: 'true', LLM_IDLE_TIMEOUT_MS: '300' });
    api = await listen(createApp(config));
  });
  afterAll(() => api.server.close());

  const post = (body) =>
    fetch(`${api.url}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('streams NDJSON events ending in done', async () => {
    const res = await post({ mode: 'flashcards', input: 'Photosynthesis', count: 3 });
    expect(res.headers.get('content-type')).toMatch(/ndjson/);
    const events = await readNdjson(res);
    expect(events[0]).toMatchObject({ t: 'start' });
    expect(events.at(-1)).toEqual({ t: 'done', finishReason: 'stop' });
    const text = events.filter((e) => e.t === 'delta').map((e) => e.v).join('');
    expect(JSON.parse(text).items).toHaveLength(3);
  });

  it('rejects bad input with a JSON error before streaming', async () => {
    const res = await post({ mode: 'essay', input: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'bad_request' } });
    const long = await post({ mode: 'quiz', input: 'x'.repeat(12_001) });
    expect(long.status).toBe(413);
  });

  it('returns provider failures as HTTP errors', async () => {
    const res = await post({ mode: 'quiz', input: 'Photosynthesis', simulate: 'rate_limit' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('20');
  });

  it('reports a stalled stream as an error event', async () => {
    const events = await readNdjson(await post({ mode: 'quiz', input: 'Photosynthesis', simulate: 'stall' }));
    expect(events.at(-1)).toMatchObject({ t: 'error', code: 'stalled' });
  });

  it('reports a cut-off answer with finishReason "length"', async () => {
    const events = await readNdjson(await post({ mode: 'quiz', input: 'Photosynthesis', simulate: 'truncated' }));
    expect(events.at(-1)).toEqual({ t: 'done', finishReason: 'length' });
  });

  it('never exposes the API key', async () => {
    const app = createApp(loadConfig({ LLM_PROVIDER: 'groq', LLM_API_KEY: 'sk-very-secret' }));
    const server = await listen(app);
    const text = await (await fetch(`${server.url}/api/health`)).text();
    server.server.close();
    expect(text).not.toContain('sk-very-secret');
  });
});
