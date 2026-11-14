/**
 * One error type for everything the server reports to the browser. `code` is
 * a stable machine-readable string the client maps to copy and retry rules
 * (see src/lib/errors.js); `message` is extra detail for the person.
 */
export class AppError extends Error {
  constructor(code, message, { status = 500, retryAfter, cause } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }

  toJSON() {
    const body = { code: this.code, message: this.message };
    if (this.retryAfter) body.retryAfter = this.retryAfter;
    return body;
  }
}

function truncate(text, max = 300) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** Pulls the human-readable message out of the usual provider error bodies. */
export function providerMessage(bodyText) {
  try {
    const body = JSON.parse(bodyText);
    const err = Array.isArray(body) ? body[0]?.error : body.error;
    if (typeof err === 'string') return truncate(err);
    if (err?.message) return truncate(err.message);
    if (body.message) return truncate(body.message);
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return truncate(bodyText);
}

function parseRetryAfter(header) {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(1, Math.round(seconds));
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(1, Math.round((date - Date.now()) / 1000));
  return undefined;
}

/** Turns a non-2xx provider response into an AppError with a useful code. */
export function errorFromProviderResponse(status, bodyText, headers, label) {
  const detail = providerMessage(bodyText);
  const lower = `${bodyText}`.toLowerCase();

  if (status === 400 && lower.includes('json_validate_failed')) {
    // Groq rejects its own output when JSON mode produced invalid JSON.
    return new AppError('malformed', `${label} could not produce valid JSON. ${detail}`, { status: 502 });
  }
  if (status === 400 && lower.includes('response_format')) {
    return new AppError('json_mode_unsupported', detail, { status: 400 });
  }
  if (status === 400 && /(context|too long|token limit|maximum.*tokens)/.test(lower)) {
    return new AppError('input_too_long', detail, { status: 413 });
  }
  if (status === 401 || status === 403) {
    return new AppError('auth', `${label} rejected the API key. ${detail}`, { status: 502 });
  }
  if (status === 404) {
    return new AppError('model_not_found', `${label} doesn't know this model. ${detail}`, { status: 502 });
  }
  if (status === 408 || status === 504) {
    return new AppError('timeout', `${label} timed out. ${detail}`, { status: 504 });
  }
  if (status === 413) {
    return new AppError('input_too_long', detail, { status: 413 });
  }
  if (status === 429) {
    return new AppError('rate_limited', `${label} is rate limiting requests. ${detail}`, {
      status: 429,
      retryAfter: parseRetryAfter(headers?.get?.('retry-after')),
    });
  }
  if (status >= 400 && status < 500) {
    return new AppError('bad_request', `${label} refused the request. ${detail}`, { status: 502 });
  }
  return new AppError('provider_error', `${label} returned an error (${status}). ${detail}`, { status: 502 });
}
