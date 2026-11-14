import { AppError } from './errors.js';
import { streamChat } from './llm.js';
import { mockStream } from './mock.js';
import { buildGenerateMessages, buildRefineMessages } from './prompt.js';
import { parseGenerateRequest } from './validate.js';

/**
 * POST /api/generate
 *
 * Errors that happen before the model starts answering (bad input, wrong
 * key, rate limit, provider down) come back as a normal HTTP error with a
 * JSON body. Once the model is answering, the response is NDJSON, one event
 * per line:
 *
 *   {"t":"start","model":"..."}
 *   {"t":"delta","v":"<raw model text>"}       many times
 *   {"t":"done","finishReason":"stop"}         or
 *   {"t":"error","code":"stalled","message":"..."}
 *
 * The server forwards raw model text and does not parse it. The client owns
 * parsing and validation so it can render partial results while streaming.
 */
export function createGenerateHandler(config) {
  return async function generate(req, res) {
    if (config.problem) {
      throw new AppError('config', config.problem, { status: 503 });
    }

    const request = parseGenerateRequest(req.body, { allowSimulate: config.allowSimulate });
    const useMock = config.provider === 'mock' || request.simulate !== 'none';

    const controller = new AbortController();
    const { signal } = controller;
    let clientGone = false;

    // Closing the tab or starting a newer request aborts the fetch in the
    // browser; pass that on so we stop paying for tokens nobody will read.
    res.on('close', () => {
      if (!res.writableFinished) {
        clientGone = true;
        controller.abort(new AppError('aborted', 'The browser cancelled the request.'));
      }
    });

    const timers = createTimers(config.timeouts, controller);

    const messages = request.refine ? buildRefineMessages(request) : buildGenerateMessages(request);
    const source = useMock
      ? mockStream({ request, signal, scenario: request.simulate })
      : streamChat({ config, messages, signal, temperature: request.strict ? 0.1 : 0.4 });
    const events = source[Symbol.asyncIterator]();

    let step;
    try {
      step = await events.next(); // resolves at { type: 'open' } or throws
    } catch (err) {
      timers.clear();
      throw abortReason(signal) ?? err;
    }

    res.status(200);
    res.set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const send = (event) => {
      if (!clientGone && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };

    send({ t: 'start', model: useMock ? `mock${request.simulate !== 'none' ? ` (${request.simulate})` : ''}` : config.model });

    let finishReason = null;
    try {
      for (; !step.done; step = await events.next()) {
        const event = step.value;
        if (event.type === 'delta') {
          timers.gotToken();
          send({ t: 'delta', v: event.text });
        } else if (event.type === 'finish') {
          finishReason = event.reason;
        }
      }
      send({ t: 'done', finishReason });
    } catch (err) {
      const error = abortReason(signal) ?? toAppError(err);
      if (error.code !== 'aborted') {
        console.warn(`[generate] stream ended with ${error.code}: ${error.message}`);
        send({ t: 'error', ...error.toJSON() });
      }
    } finally {
      timers.clear();
      res.end();
    }
  };
}

function createTimers({ firstTokenMs, idleMs, totalMs }, controller) {
  const total = setTimeout(
    () => controller.abort(new AppError('timeout', `No complete answer after ${Math.round(totalMs / 1000)} seconds.`)),
    totalMs,
  );
  let idle = setTimeout(
    () => controller.abort(new AppError('timeout', `The model didn't start answering within ${Math.round(firstTokenMs / 1000)} seconds.`)),
    firstTokenMs,
  );
  return {
    gotToken() {
      clearTimeout(idle);
      idle = setTimeout(
        () => controller.abort(new AppError('stalled', `The model went quiet for ${Math.round(idleMs / 1000)} seconds mid-answer.`)),
        idleMs,
      );
    },
    clear() {
      clearTimeout(total);
      clearTimeout(idle);
    },
  };
}

function abortReason(signal) {
  return signal.aborted && signal.reason instanceof AppError ? signal.reason : null;
}

function toAppError(err) {
  if (err instanceof AppError) return err;
  return new AppError('provider_error', err?.message || 'Unknown error while streaming.', { cause: err });
}
