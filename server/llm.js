import { AppError, errorFromProviderResponse } from './errors.js';
import { createSSEParser } from './sse.js';

/**
 * Streams a chat completion from any OpenAI-compatible endpoint.
 *
 * Yields, in order:
 *   { type: 'open', model }              once a model accepted the request
 *   { type: 'delta', text }              for each piece of generated text
 *   { type: 'finish', reason }           when the provider reports why it stopped
 *
 * Throws AppError for HTTP errors, unreachable providers and in-stream errors.
 * Splitting "open" from the first delta lets the route send a real HTTP error
 * status when the provider refuses the request, before any streaming starts.
 */
export async function* streamChat({ config, messages, signal, temperature = 0.4, maxTokens = 8192 }) {
  const models = orderByHealth([...new Set([config.model, ...(config.fallbackModels ?? [])])], config);
  let response;
  let model;

  // Overloaded, rate-limited or retired models are common on free tiers.
  // Before anything has streamed, it's safe to try the next model instead.
  for (let i = 0; i < models.length; i++) {
    model = models[i];
    const isLast = i === models.length - 1;
    response = await requestModel({
      config,
      model,
      messages,
      signal,
      temperature,
      maxTokens,
      // Only cut a slow model short when there's another one to try.
      acceptTimeoutMs: isLast ? null : config.timeouts?.switchModelMs,
    });
    if (!response.error) break;
    if (!worthAnotherModel(response.error)) throw response.error;
    markUnhealthy(config, model);
    if (isLast) throw response.error;
    console.warn(`[llm] ${model} failed (${response.error.upstreamStatus ?? response.error.code}); trying ${models[i + 1]}.`);
  }

  yield { type: 'open', model };

  const parser = createSSEParser();
  const decoder = new TextDecoder();

  for await (const chunk of response.res.body) {
    for (const data of parser.feed(decoder.decode(chunk, { stream: true }))) {
      const event = handleEvent(data, config.label);
      if (event === 'done') return;
      if (event) yield* event;
    }
  }
  for (const data of parser.end()) {
    const event = handleEvent(data, config.label);
    if (event && event !== 'done') yield* event;
  }
}

const TRY_ANOTHER_MODEL = new Set([429, 500, 502, 503, 504, 529]);

/*
 * Models that just failed are skipped for a while, so every visitor doesn't
 * wait for the same overloaded model to time out. A skipped model is moved
 * to the end of the list rather than dropped, so it's still tried if
 * everything else fails too.
 */
const unhealthyUntil = new Map(); // "baseUrl model" -> timestamp

function markUnhealthy(config, model) {
  unhealthyUntil.set(`${config.baseUrl} ${model}`, Date.now() + (config.timeouts?.modelCooldownMs ?? 120_000));
}

function orderByHealth(models, config) {
  const now = Date.now();
  const healthy = (m) => (unhealthyUntil.get(`${config.baseUrl} ${m}`) ?? 0) <= now;
  return [...models.filter(healthy), ...models.filter((m) => !healthy(m))];
}

/** For tests: forget which models failed. */
export function resetModelHealth() {
  unhealthyUntil.clear();
}

function worthAnotherModel(error) {
  return error.code === 'model_not_found' || TRY_ANOTHER_MODEL.has(error.upstreamStatus);
}

async function requestModel({ config, model, ...rest }) {
  let response = await request({ config, model, ...rest, jsonMode: config.jsonMode });
  // Some models reject response_format. Retry once without it; the client's
  // parser copes with JSON that wasn't produced under JSON mode.
  if (response.error?.code === 'json_mode_unsupported') {
    console.warn(`[llm] ${model} rejected JSON mode; retrying without response_format.`);
    response = await request({ config, model, ...rest, jsonMode: false });
  }
  return response;
}

async function request({ config, model, messages, signal, temperature, maxTokens, jsonMode, acceptTimeoutMs }) {
  const body = {
    model,
    messages,
    stream: true,
    temperature,
    max_tokens: maxTokens,
    ...config.extraBody,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  // One controller per attempt, linked to the request's own signal, so a slow
  // model can be abandoned without cancelling the whole request. The timer
  // only covers waiting for the model to accept; streaming isn't cut short.
  const attempt = new AbortController();
  const forward = () => attempt.abort(signal.reason);
  if (signal?.aborted) forward();
  else signal?.addEventListener('abort', forward, { once: true });
  const acceptTimer =
    acceptTimeoutMs &&
    setTimeout(
      () =>
        attempt.abort(
          new AppError('timeout', `${config.label} (${model}) didn't respond within ${Math.round(acceptTimeoutMs / 1000)} seconds.`, {
            status: 504,
            upstreamStatus: 504,
          }),
        ),
      acceptTimeoutMs,
    );

  let res;
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: attempt.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err;
    if (attempt.signal.aborted && attempt.signal.reason instanceof AppError) return { error: attempt.signal.reason };
    const reason = err.cause?.code || err.message;
    throw new AppError('provider_unreachable', `Couldn't reach ${config.label} at ${config.baseUrl} (${reason}).`, {
      status: 502,
      cause: err,
    });
  } finally {
    clearTimeout(acceptTimer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: errorFromProviderResponse(res.status, text, res.headers, config.label) };
  }
  return { res };
}

/** Returns an array of events to yield, 'done', or null for ignorable data. */
function handleEvent(data, label) {
  if (data.trim() === '[DONE]') return 'done';

  let json;
  try {
    json = JSON.parse(data);
  } catch {
    return null; // a garbled SSE line shouldn't kill an otherwise good stream
  }

  if (json.error) {
    const message = json.error.message || JSON.stringify(json.error);
    const code = /json_validate_failed/i.test(JSON.stringify(json.error)) ? 'malformed' : 'provider_error';
    throw new AppError(code, `${label} reported an error mid-response: ${message}`, { status: 502 });
  }

  const choice = json.choices?.[0];
  if (!choice) return null;

  const events = [];
  const text = choice.delta?.content ?? choice.message?.content;
  if (typeof text === 'string' && text) events.push({ type: 'delta', text });
  if (choice.finish_reason) events.push({ type: 'finish', reason: choice.finish_reason });
  return events;
}
