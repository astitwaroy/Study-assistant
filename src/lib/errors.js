/**
 * Every failure the UI can show, with the copy for it and whether a retry
 * could plausibly help. Server error codes (server/errors.js) and the
 * client's own parsing failures share this one vocabulary.
 */
export const ERROR_COPY = {
  network: {
    title: "Can't reach the Recall server",
    hint: 'Check that `npm start` is still running, then try again.',
    retryable: true,
  },
  timeout: {
    title: 'The model took too long to answer',
    hint: 'Try again, or ask for fewer items.',
    retryable: true,
  },
  stalled: {
    title: 'The model stopped partway through its answer',
    hint: 'This is usually a temporary hiccup. Try again.',
    retryable: true,
  },
  rate_limited: {
    title: 'Too many requests right now',
    hint: 'Wait a moment, then try again.',
    retryable: true,
  },
  provider_error: {
    title: 'The AI provider returned an error',
    hint: 'This is usually temporary. Try again in a moment.',
    retryable: true,
  },
  provider_unreachable: {
    title: "The server can't reach the AI provider",
    hint: 'Check the server has internet access, or that Ollama is running if you use it.',
    retryable: true,
  },
  malformed: {
    title: "The model's answer wasn't valid JSON",
    hint: 'Models get this wrong now and then. Trying again usually works.',
    retryable: true,
  },
  wrong_shape: {
    title: "The model's answer didn't contain anything usable",
    hint: 'It sent JSON, but not in the shape Recall asked for. Try again.',
    retryable: true,
  },
  truncated: {
    title: 'The answer was cut off before a single item was complete',
    hint: 'Try again with fewer items.',
    retryable: true,
  },
  auth: {
    title: 'The API key was rejected',
    hint: 'Check LLM_API_KEY in your .env file, then restart the server.',
    retryable: false,
  },
  config: {
    title: "The server isn't configured yet",
    hint: 'Fix the setting named below in .env, then restart the server.',
    retryable: false,
  },
  model_not_found: {
    title: "The provider doesn't recognise that model",
    hint: 'Check LLM_MODEL in your .env file.',
    retryable: false,
  },
  input_too_long: {
    title: 'Those notes are too long',
    hint: 'Trim them, or split them into two sets.',
    retryable: false,
  },
  bad_request: {
    title: "The request couldn't be processed",
    hint: 'Check your notes and settings, then try again.',
    retryable: false,
  },
  server_error: {
    title: 'The Recall server hit an error',
    hint: 'Check the terminal running the server for details.',
    retryable: true,
  },
  unknown: {
    title: 'Something went wrong',
    hint: 'Try again.',
    retryable: true,
  },
};

export class GenerationError extends Error {
  constructor(code, message, { retryAfter, cause } = {}) {
    super(message || ERROR_COPY[code]?.title || 'Something went wrong', { cause });
    this.name = 'GenerationError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function describeError(error) {
  const code = error?.code && ERROR_COPY[error.code] ? error.code : 'unknown';
  const copy = ERROR_COPY[code];
  const detail = error?.message && error.message !== copy.title ? error.message : null;
  return { code, ...copy, detail, retryAfter: error?.retryAfter };
}

export const isAbort = (error) => error?.code === 'aborted' || error?.name === 'AbortError';
