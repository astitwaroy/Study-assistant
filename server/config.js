import dotenv from 'dotenv';

dotenv.config({ quiet: true });

/**
 * Every real provider here speaks the OpenAI-compatible
 * `POST {baseUrl}/chat/completions` API with SSE streaming, so one client
 * (server/llm.js) covers all of them. Presets only differ in URL, default
 * model and a couple of request details.
 */
export const PRESETS = {
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-flash-latest',
    needsKey: true,
    // Gemini 3 models always "think" before answering; keep it short so the
    // first token arrives sooner.
    extraBody: { reasoning_effort: 'low' },
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-20b',
    needsKey: true,
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: null, // free model names change often, so this one must be set
    needsKey: true,
  },
  ollama: {
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    needsKey: false,
  },
  custom: {
    label: 'OpenAI-compatible API',
    baseUrl: null,
    model: null,
    needsKey: false,
  },
  mock: {
    label: 'Demo mode (built-in mock)',
    baseUrl: null,
    model: 'mock',
    needsKey: false,
  },
};

function parseBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

/**
 * Reads the environment once at startup and returns a plain config object.
 * `problem` is set (instead of throwing) so the server can still start and
 * tell the UI exactly what is misconfigured.
 */
export function loadConfig(env = process.env) {
  const apiKey = (env.LLM_API_KEY || '').trim();
  let provider = (env.LLM_PROVIDER || '').trim().toLowerCase();

  // No provider and no key: run the mock so `npm install && npm start` works
  // out of the box. A key without a provider defaults to Gemini.
  if (!provider) provider = apiKey ? 'gemini' : 'mock';

  const preset = PRESETS[provider];
  // `npm run serve` (the --static flag) is how the built app is deployed.
  const isProduction = env.NODE_ENV === 'production' || process.argv.includes('--static');

  const config = {
    provider,
    label: preset?.label ?? provider,
    baseUrl: (env.LLM_BASE_URL || preset?.baseUrl || '').replace(/\/+$/, ''),
    model: (env.LLM_MODEL || preset?.model || '').trim(),
    apiKey,
    jsonMode: parseBool(env.LLM_JSON_MODE, true),
    extraBody: preset?.extraBody ?? {},
    port: Number(env.PORT) || 8787,
    allowSimulate: parseBool(env.ALLOW_SIMULATE, !isProduction),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE) || 20,
    timeouts: {
      // Thinking models can sit silently for a while before the first token.
      firstTokenMs: Number(env.LLM_FIRST_TOKEN_TIMEOUT_MS) || 45_000,
      // Once tokens are flowing, a long silence means the stream is stuck.
      idleMs: Number(env.LLM_IDLE_TIMEOUT_MS) || 20_000,
      totalMs: Number(env.LLM_TOTAL_TIMEOUT_MS) || 120_000,
    },
    problem: null,
  };

  if (!preset) {
    config.problem = `Unknown LLM_PROVIDER "${provider}". Use one of: ${Object.keys(PRESETS).join(', ')}.`;
  } else if (preset.needsKey && !apiKey) {
    config.problem = `LLM_PROVIDER is "${provider}" but LLM_API_KEY is empty. Add your key to .env and restart.`;
  } else if (provider !== 'mock' && !config.baseUrl) {
    config.problem = `Set LLM_BASE_URL for the "${provider}" provider.`;
  } else if (provider !== 'mock' && !config.model) {
    config.problem = `Set LLM_MODEL for the "${provider}" provider.`;
  }

  return config;
}

/** What the browser is allowed to know about the setup. Never includes the key. */
export function publicConfig(config) {
  return {
    provider: config.provider,
    label: config.label,
    model: config.model,
    mock: config.provider === 'mock',
    simulate: config.allowSimulate,
    problem: config.problem,
  };
}
