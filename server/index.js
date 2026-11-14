import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, publicConfig } from './config.js';
import { AppError } from './errors.js';
import { createGenerateHandler } from './generate.js';
import { rateLimit } from './rateLimit.js';

export function createApp(config = loadConfig()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use('/api', express.json({ limit: '200kb' }));

  app.get('/api/health', (_req, res) => {
    res.json(publicConfig(config));
  });

  app.post(
    '/api/generate',
    rateLimit({ windowMs: 60_000, max: config.rateLimitPerMinute }),
    rateLimit({
      windowMs: 60_000,
      max: config.globalRateLimitPerMinute,
      key: () => 'everyone',
      message: 'Recall is handling a lot of requests right now.',
    }),
    createGenerateHandler(config),
  );

  app.use('/api', (_req, _res, next) => next(new AppError('not_found', 'No such API route.', { status: 404 })));

  if (process.argv.includes('--static')) {
    const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      console.error('No build found. Run `npm run build` first.');
      process.exit(1);
    }
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
  }

  // Every error leaves as { error: { code, message } } with a sensible status.
  app.use((err, _req, res, _next) => {
    let error = err;
    if (err?.type === 'entity.too.large') {
      error = new AppError('input_too_long', 'That request is too large.', { status: 413 });
    } else if (err?.type === 'entity.parse.failed') {
      error = new AppError('bad_request', 'The request body is not valid JSON.', { status: 400 });
    } else if (!(err instanceof AppError)) {
      console.error(err);
      error = new AppError('server_error', 'Something went wrong on the server.', { status: 500 });
    }
    if (res.headersSent) return res.end();
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    res.status(error.status).json({ error: error.toJSON() });
  });

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    const where = config.provider === 'mock' ? 'demo mode (no API key set)' : `${config.label}, model ${config.model}`;
    console.log(`Recall API on http://localhost:${config.port} using ${where}`);
    if (config.problem) console.warn(`Configuration problem: ${config.problem}`);
  });
}
