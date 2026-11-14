import { AppError } from './errors.js';
import { PHOTOSYNTHESIS } from './mockData.js';

/**
 * A stand-in for a real model. It streams JSON exactly like a provider would,
 * and can misbehave on purpose (`scenario`) so every failure path in the UI
 * can be exercised without waiting for a real model to fail.
 *
 * It is not an AI: without the sample notes it builds fill-in-the-blank
 * questions from the sentences you paste.
 */
export async function* mockStream({ request, signal, scenario = 'none' }) {
  if (scenario === 'http_500') {
    await sleep(400, signal);
    throw new AppError('provider_error', 'Simulated failure: the provider returned HTTP 500.', { status: 502 });
  }
  if (scenario === 'rate_limit') {
    await sleep(300, signal);
    throw new AppError('rate_limited', 'Simulated failure: too many requests.', { status: 429, retryAfter: 20 });
  }

  yield { type: 'open' };

  const payload = request.refine ? buildRefinePayload(request) : buildPayload(request);
  const text = render(payload, scenario, request);

  if (scenario === 'slow') await sleep(13_000, signal);

  const cutAt = {
    stall: 0.55,
    truncated: 0.6,
    midstream_error: 0.4,
  }[scenario];
  const visible = cutAt ? text.slice(0, Math.floor(text.length * cutAt)) : text;

  for (const piece of chunk(visible)) {
    await sleep(18, signal);
    yield { type: 'delta', text: piece };
  }

  if (scenario === 'stall') {
    // Go silent. The route's idle timeout should notice and end the request.
    await sleep(10 * 60_000, signal);
  }
  if (scenario === 'midstream_error') {
    throw new AppError('provider_error', 'Simulated failure: the connection to the provider dropped.', { status: 502 });
  }

  yield { type: 'finish', reason: scenario === 'truncated' ? 'length' : 'stop' };
}

/* ---------- payloads ---------- */

function buildPayload({ mode, input, count }) {
  if (/photosynth/i.test(input)) {
    const items = mode === 'quiz' ? PHOTOSYNTHESIS.quiz : PHOTOSYNTHESIS.flashcards.map((c) => ({ type: 'flashcard', ...c }));
    return { status: 'ok', title: PHOTOSYNTHESIS.title, items: items.slice(0, count) };
  }

  const facts = extractFacts(input);
  if (facts.length < 2) {
    return {
      status: 'insufficient',
      reason:
        'Demo mode builds questions from pasted notes, so paste a few full sentences. Add an API key to study any topic.',
    };
  }

  const items = facts.slice(0, count).map((fact, i) => (mode === 'quiz' ? quizItem(fact, i, facts) : flashcard(fact)));
  return { status: 'ok', title: guessTitle(input), items };
}

function buildRefinePayload({ mode, input, refine }) {
  const instruction = refine.instruction.toLowerCase();
  const refs = refine.items.map((item) => item.ref).filter(Boolean);

  if (/\b(remove|delete|drop|fewer)\b/.test(instruction)) {
    return { status: 'ok', ops: [{ op: 'remove', ref: refs[refs.length - 1] }] };
  }

  let extras;
  if (/photosynth/i.test(input)) {
    extras = mode === 'quiz' ? PHOTOSYNTHESIS.extraQuiz : PHOTOSYNTHESIS.extraFlashcards.map((c) => ({ type: 'flashcard', ...c }));
  } else {
    const facts = extractFacts(input);
    const unused = facts.slice(refine.items.length, refine.items.length + 2);
    extras = unused.map((fact, i) => (mode === 'quiz' ? quizItem(fact, i, facts) : flashcard(fact)));
  }

  const existing = new Set(refine.items.map((item) => (item.front || item.question || item.statement || '').toLowerCase()));
  const fresh = extras.filter((item) => !existing.has((item.front || item.question || item.statement).toLowerCase()));

  if (fresh.length === 0) {
    return {
      status: 'insufficient',
      reason: 'Demo mode has no more material to add from these notes. Add an API key for real edits.',
    };
  }
  return { status: 'ok', ops: fresh.map((item) => ({ op: 'add', item })) };
}

const STOPWORDS = new Set(
  'about above after again against because been before being below between both could does doing down during each from further have having here into itself just more most other over same should some such than that their theirs them then there these they this those through under until very what when where which while whom will with would your also only used uses using called known'.split(
    ' ',
  ),
);

function extractFacts(input) {
  return input
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 260 && s.split(/\s+/).length >= 6)
    .map((sentence) => ({ sentence, keyword: pickKeyword(sentence) }))
    .filter((fact) => fact.keyword);
}

function pickKeyword(sentence) {
  const words = sentence.match(/[A-Za-z][A-Za-z-]{3,}/g) ?? [];
  const candidates = words.slice(1).filter((w) => !STOPWORDS.has(w.toLowerCase()));
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}

function blank(sentence, keyword) {
  return sentence.replace(new RegExp(`\\b${keyword}\\b`), '_____');
}

function flashcard({ sentence, keyword }) {
  return { type: 'flashcard', front: `Fill in the blank: ${blank(sentence, keyword)}`, back: keyword };
}

function quizItem(fact, index, facts) {
  const others = [...new Set(facts.map((f) => f.keyword).filter((k) => k.toLowerCase() !== fact.keyword.toLowerCase()))];
  if (index % 4 === 3 || others.length < 3) {
    const makeFalse = index % 2 === 1 && others.length > 0;
    const swapped = others[index % others.length];
    return {
      type: 'true_false',
      statement: makeFalse ? fact.sentence.replace(new RegExp(`\\b${fact.keyword}\\b`), swapped) : fact.sentence,
      answer: !makeFalse,
      explanation: `The notes say: "${fact.sentence}"`,
    };
  }
  const distractors = rotate(others, index).slice(0, 3);
  const answerIndex = index % 4;
  const options = [...distractors];
  options.splice(answerIndex, 0, fact.keyword);
  return {
    type: 'mcq',
    question: `Fill in the blank: ${blank(fact.sentence, fact.keyword)}`,
    options,
    answerIndex,
    explanation: `The notes say: "${fact.sentence}"`,
  };
}

function rotate(list, by) {
  const n = by % list.length;
  return [...list.slice(n), ...list.slice(0, n)];
}

function guessTitle(input) {
  const firstLine = input.split('\n').find((l) => l.trim())?.trim() ?? 'Your notes';
  const words = firstLine.replace(/[^\w\s'-]/g, '').split(/\s+/).slice(0, 5).join(' ');
  return words.length > 3 ? words : 'Your notes';
}

/* ---------- deliberate misbehaviour ---------- */

function render(payload, scenario, request) {
  const json = JSON.stringify(payload, null, 1);

  switch (scenario) {
    case 'prose':
      return `Sure! Here's your study set:\n\n\`\`\`json\n${json}\n\`\`\`\n\nGood luck with your revision!`;
    case 'malformed':
      // Fails the first time and succeeds when the client retries in strict mode.
      return request.strict ? json : breakJson(json);
    case 'not_json':
      return "I'm sorry, but I can't format that as JSON right now. The notes cover several interesting ideas worth reviewing, so try re-reading the key definitions and testing yourself on each one.";
    case 'wrong_shape':
      return JSON.stringify(wrongShape(payload, request.mode), null, 1);
    case 'empty':
      return JSON.stringify({ status: 'ok', title: payload.title ?? 'Your notes', items: [] });
    case 'insufficient':
      return JSON.stringify({
        status: 'insufficient',
        reason: 'These notes are too short to make questions from. Paste a paragraph or two, or name a topic.',
      });
    default:
      return json;
  }
}

/** Single quotes and missing commas: not something a parser should "fix". */
function breakJson(json) {
  return json.replace(/"(front|back|question|statement|title)":/g, "'$1':").replace(/\},\n/g, '}\n');
}

/**
 * The kind of output small models really produce: renamed keys, letter
 * answers, numbered options, strings where numbers belong, plus a few items
 * that are simply unusable.
 */
function wrongShape(payload, mode) {
  if (payload.status !== 'ok' || !payload.items) return payload;
  const items = payload.items;

  if (mode === 'quiz') {
    const mangled = items.map((item, i) => {
      if (item.type === 'true_false') {
        return { kind: 'True/False', question: item.statement, correct: String(item.answer), why: item.explanation };
      }
      const letters = ['A', 'B', 'C', 'D'];
      if (i % 3 === 0) {
        return {
          type: 'multiple_choice',
          question: item.question,
          choices: Object.fromEntries(item.options.map((o, j) => [letters[j], o])),
          correct_answer: letters[item.answerIndex],
          explanation: item.explanation,
        };
      }
      if (i % 3 === 1) {
        return {
          type: 'MCQ',
          question: item.question,
          options: item.options.map((o, j) => `${letters[j]}) ${o}`),
          answerIndex: String(item.answerIndex),
          explanation: item.explanation,
        };
      }
      return { ...item, answer: item.options[item.answerIndex], answerIndex: undefined };
    });
    mangled.push({ type: 'mcq', question: 'Which option is correct?', options: ['Only one option'], answerIndex: 0 });
    mangled.push({ type: 'mcq', question: items[0]?.question ?? 'Broken', options: ['A', 'B', 'C', 'D'], answerIndex: 7 });
    return { topic: payload.title, questions: mangled };
  }

  const mangled = items.map((item, i) =>
    i % 2 === 0 ? { question: item.front, answer: item.back } : { term: item.front, definition: item.back },
  );
  mangled.push({ question: 'A card with no answer', answer: '' });
  mangled.push({ question: items[0]?.front ?? 'Duplicate', answer: items[0]?.back ?? 'Duplicate' });
  mangled.push('just a string, not a card');
  return { topic: payload.title, cards: mangled };
}

/* ---------- helpers ---------- */

function* chunk(text) {
  let i = 0;
  while (i < text.length) {
    const size = 14 + ((i * 7) % 23); // uneven chunk sizes, like a real stream
    yield text.slice(i, i + size);
    i += size;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
