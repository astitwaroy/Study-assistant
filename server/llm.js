import { AppError, errorFromProviderResponse } from './errors.js';
import { createSSEParser } from './sse.js';

/**
 * Streams a chat completion from any OpenAI-compatible endpoint.
 *
 * Yields, in order:
 *   { type: 'open' }                     once the provider accepted the request
 *   { type: 'delta', text }              for each piece of generated text
 *   { type: 'finish', reason }           when the provider reports why it stopped
 *
 * Throws AppError for HTTP errors, unreachable providers and in-stream errors.
 * Splitting "open" from the first delta lets the route send a real HTTP error
 * status when the provider refuses the request, before any streaming starts.
 */
export async function* streamChat({ config, messages, signal, temperature = 0.4, maxTokens = 8192 }) {
  let response = await request({ config, messages, signal, temperature, maxTokens, jsonMode: config.jsonMode });

  // Some models reject response_format. Retry once without it; the client's
  // parser copes with JSON that wasn't produced under JSON mode.
  if (response.error?.code === 'json_mode_unsupported') {
    console.warn(`[llm] ${config.model} rejected JSON mode; retrying without response_format.`);
    response = await request({ config, messages, signal, temperature, maxTokens, jsonMode: false });
  }
  if (response.error) throw response.error;

  yield { type: 'open' };

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

async function request({ config, messages, signal, temperature, maxTokens, jsonMode }) {
  const body = {
    model: config.model,
    messages,
    stream: true,
    temperature,
    max_tokens: maxTokens,
    ...config.extraBody,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  let res;
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err;
    const reason = err.cause?.code || err.message;
    throw new AppError('provider_unreachable', `Couldn't reach ${config.label} at ${config.baseUrl} (${reason}).`, {
      status: 502,
      cause: err,
    });
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
