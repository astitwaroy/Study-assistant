import { AppError } from './errors.js';

/**
 * Fixed-window, in-memory rate limit per client IP. Enough to stop one tab
 * (or one bored visitor of a deployed demo) from burning through the API
 * quota. A multi-instance deployment would need a shared store instead.
 */
export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map();

  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    let entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
    }

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      return next(
        new AppError('rate_limited', 'This browser has sent a lot of requests in the last minute.', {
          status: 429,
          retryAfter,
        }),
      );
    }
    next();
  };
}
