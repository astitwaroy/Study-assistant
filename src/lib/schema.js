/**
 * The contract between the model and the UI.
 *
 * The prompt (server/prompt.js) asks for an exact shape, but nothing makes
 * the model follow it. Everything the model sends goes through these
 * functions before React sees it. They are lenient about *form* (renamed
 * keys, "B" instead of 1, "true" instead of true) and strict about
 * *meaning*: if we can't tell which answer is correct, the question is
 * dropped rather than guessed. A study tool that marks the wrong answer as
 * right is worse than one with nine questions instead of ten.
 *
 * Normalised item shapes (what components can rely on):
 *   { id, type: 'flashcard', front, back }
 *   { id, type: 'mcq', question, options: string[2..6], answerIndex, explanation? }
 *   { id, type: 'true_false', statement, answer: boolean, explanation? }
 */

export const MODES = ['flashcards', 'quiz'];

export const LIMITS = {
  title: 80,
  front: 220,
  back: 700,
  question: 320,
  option: 180,
  explanation: 600,
  maxItems: 40,
  minOptions: 2,
  maxOptions: 6,
};

const TYPE_ALIASES = {
  flashcard: 'flashcard',
  flash_card: 'flashcard',
  card: 'flashcard',
  term: 'flashcard',
  mcq: 'mcq',
  multiple_choice: 'mcq',
  multiplechoice: 'mcq',
  choice: 'mcq',
  single_choice: 'mcq',
  true_false: 'true_false',
  truefalse: 'true_false',
  true_or_false: 'true_false',
  tf: 'true_false',
  boolean: 'true_false',
};

let idCounter = 0;
export function makeId(prefix = 'i') {
  idCounter += 1;
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}${idCounter.toString(36)}`;
}

/* ---------- small coercions ---------- */

/** Trimmed, length-capped text, or null if there's nothing there. */
export function cleanText(value, max) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === 't') return true;
    if (v === 'false' || v === 'f') return false;
  }
  return null;
}

function toIndex(value, length) {
  const n = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  return Number.isInteger(n) && n >= 0 && n < length ? n : null;
}

function first(raw, keys) {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') return raw[key];
  }
  return undefined;
}

const fail = (reason) => ({ ok: false, reason });
const ok = (item) => ({ ok: true, item });

/* ---------- item types ---------- */

function inferType(raw) {
  const declared = first(raw, ['type', 'kind', 'format']);
  if (typeof declared === 'string') {
    const key = declared.trim().toLowerCase().replace(/[\s/-]+/g, '_');
    if (TYPE_ALIASES[key]) return TYPE_ALIASES[key];
  }
  if (first(raw, ['options', 'choices', 'answers']) !== undefined) return 'mcq';
  if (raw.statement !== undefined || toBoolean(raw.answer ?? raw.correct) !== null) return 'true_false';
  if (first(raw, ['front', 'back', 'term', 'definition']) !== undefined) return 'flashcard';
  if (raw.question !== undefined && raw.answer !== undefined) return 'flashcard';
  return null;
}

function normalizeFlashcard(raw) {
  const front = cleanText(first(raw, ['front', 'term', 'question', 'prompt', 'q']), LIMITS.front);
  const back = cleanText(first(raw, ['back', 'definition', 'answer', 'a', 'explanation']), LIMITS.back);
  if (!front) return fail('A flashcard had nothing on the front.');
  if (!back) return fail(`"${front}" had no answer on the back.`);
  if (front.toLowerCase() === back.toLowerCase()) return fail(`"${front}" had the same text on both sides.`);
  return ok({ type: 'flashcard', front, back });
}

const LETTER_PREFIX = /^\s*\(?([a-f])[).:]\s+/i;

/** Options may arrive as an array, an {A: "..", B: ".."} map, or objects with a correct flag. */
function readOptions(raw) {
  let options = first(raw, ['options', 'choices', 'answers']);
  let flaggedIndex = null;

  if (options && !Array.isArray(options) && typeof options === 'object') {
    options = Object.values(options);
  }
  if (!Array.isArray(options)) return { options: null };

  options = options.map((option, i) => {
    if (option && typeof option === 'object') {
      if (option.correct === true || option.isCorrect === true || option.is_correct === true) {
        flaggedIndex = flaggedIndex === null ? i : -1; // -1: more than one flagged
      }
      return first(option, ['text', 'label', 'option', 'value']);
    }
    return option;
  });

  let texts = options.map((o) => cleanText(o, LIMITS.option));
  // "A) Stroma", "B) Thylakoid"... strip the letters, but only if every option has them.
  if (texts.every((t) => t && LETTER_PREFIX.test(t))) {
    texts = texts.map((t) => t.replace(LETTER_PREFIX, ''));
  }
  return { options: texts, flaggedIndex };
}

function resolveAnswer(raw, options, flaggedIndex) {
  if (flaggedIndex === -1) return { error: 'more than one option was marked correct' };
  if (flaggedIndex !== null) return { index: flaggedIndex };

  const indexField = first(raw, ['answerIndex', 'answer_index', 'correctIndex', 'correct_index', 'correctOptionIndex']);
  if (indexField !== undefined) {
    const index = toIndex(indexField, options.length);
    return index === null ? { error: `the answer index "${indexField}" doesn't match any option` } : { index };
  }

  const answer = first(raw, ['answer', 'correct', 'correctAnswer', 'correct_answer', 'correctOption']);
  if (typeof answer === 'string') {
    const trimmed = answer.trim();
    const letter = trimmed.match(/^(?:option\s+)?\(?([a-f])\)?[.)]?$/i);
    if (letter) {
      const index = letter[1].toLowerCase().charCodeAt(0) - 97;
      if (index < options.length) return { index };
    }
    const target = trimmed.replace(LETTER_PREFIX, '').toLowerCase();
    const matches = options.map((o, i) => (o.toLowerCase() === target ? i : -1)).filter((i) => i !== -1);
    if (matches.length === 1) return { index: matches[0] };
  }
  // A bare number in "answer" could be 0- or 1-based. Don't guess.
  return { error: 'the correct answer was missing or ambiguous' };
}

function normalizeMcq(raw) {
  const question = cleanText(first(raw, ['question', 'prompt', 'q', 'stem']), LIMITS.question);
  if (!question) return fail('A multiple-choice question had no question text.');

  const { options, flaggedIndex } = readOptions(raw);
  if (!options) return fail(`"${question}" had no list of options.`);
  if (options.some((o) => !o)) return fail(`"${question}" had an empty option.`);
  if (options.length < LIMITS.minOptions) return fail(`"${question}" had fewer than two options.`);
  if (options.length > LIMITS.maxOptions) return fail(`"${question}" had more than six options.`);
  const unique = new Set(options.map((o) => o.toLowerCase()));
  if (unique.size !== options.length) return fail(`"${question}" listed the same option twice.`);

  const answer = resolveAnswer(raw, options, flaggedIndex);
  if (answer.error) return fail(`"${question}" was left out: ${answer.error}.`);

  const explanation = cleanText(first(raw, ['explanation', 'rationale', 'why', 'reason']), LIMITS.explanation);
  return ok({ type: 'mcq', question, options, answerIndex: answer.index, ...(explanation && { explanation }) });
}

function normalizeTrueFalse(raw) {
  const statement = cleanText(first(raw, ['statement', 'question', 'prompt', 'claim']), LIMITS.question);
  if (!statement) return fail('A true/false question had no statement.');
  const answer = toBoolean(first(raw, ['answer', 'correct', 'isTrue', 'is_true', 'correctAnswer', 'correct_answer']));
  if (answer === null) return fail(`"${statement}" didn't say whether it was true or false.`);
  const explanation = cleanText(first(raw, ['explanation', 'rationale', 'why', 'reason']), LIMITS.explanation);
  return ok({ type: 'true_false', statement, answer, ...(explanation && { explanation }) });
}

/** Turns quiz items into flashcards when the model mixes up the modes. */
function asFlashcard(item) {
  if (item.type === 'mcq') {
    const answer = item.options[item.answerIndex];
    return { type: 'flashcard', front: item.question, back: item.explanation ? `${answer}\n\n${item.explanation}` : answer };
  }
  if (item.type === 'true_false') {
    const verdict = item.answer ? 'True.' : 'False.';
    return {
      type: 'flashcard',
      front: `True or false: ${item.statement}`,
      back: item.explanation ? `${verdict} ${item.explanation}` : verdict,
    };
  }
  return item;
}

/**
 * Validates one item from the model for the given mode.
 * @returns {{ok: true, item: object} | {ok: false, reason: string}}
 */
export function normalizeItem(raw, mode) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('An item was not an object.');

  const type = inferType(raw);
  let result;
  if (type === 'flashcard') result = normalizeFlashcard(raw);
  else if (type === 'mcq') result = normalizeMcq(raw);
  else if (type === 'true_false') result = normalizeTrueFalse(raw);
  else return fail(`An item had an unknown type${raw.type ? ` ("${String(raw.type).slice(0, 30)}")` : ''}.`);

  if (!result.ok) return result;

  if (mode === 'flashcards' && result.item.type !== 'flashcard') return ok(asFlashcard(result.item));
  if (mode === 'quiz' && result.item.type === 'flashcard') {
    return fail(`"${result.item.front}" came back as a flashcard instead of a quiz question.`);
  }
  return result;
}

/** Text that identifies an item, used to spot duplicates. */
export function itemKey(item) {
  const text = item.front ?? item.question ?? item.statement ?? '';
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/* ---------- whole responses ---------- */

export function findItemList(value) {
  for (const key of ['items', 'cards', 'flashcards', 'questions', 'quiz']) {
    if (Array.isArray(value[key])) return value[key];
  }
  // One level of nesting: { data: { items: [...] } } or { quiz: { questions: [...] } }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      for (const key of ['items', 'cards', 'flashcards', 'questions']) {
        if (Array.isArray(nested[key])) return nested[key];
      }
    }
  }
  return null;
}

export function readStatus(value) {
  const status = typeof value.status === 'string' ? value.status.trim().toLowerCase() : 'ok';
  if (status === 'insufficient' || status === 'insufficient_input' || status === 'refused') {
    return {
      kind: 'insufficient',
      reason:
        cleanText(first(value, ['reason', 'message', 'error']), 300) ??
        "The model couldn't make anything from that. Try adding more detail.",
    };
  }
  return null;
}

/** Normalises a list of raw items, dropping bad ones and duplicates. */
export function normalizeItems(rawItems, mode, { keepIds = false } = {}) {
  const items = [];
  const dropped = [];
  const seen = new Set();

  rawItems.forEach((raw, index) => {
    const result = normalizeItem(raw, mode);
    if (!result.ok) {
      dropped.push({ index, reason: result.reason });
      return;
    }
    const key = itemKey(result.item);
    if (seen.has(key)) {
      dropped.push({ index, reason: `"${result.item.front ?? result.item.question ?? result.item.statement}" was a duplicate.` });
      return;
    }
    if (items.length >= LIMITS.maxItems) {
      dropped.push({ index, reason: `Recall keeps at most ${LIMITS.maxItems} items per set.` });
      return;
    }
    seen.add(key);
    const id = keepIds && typeof raw.id === 'string' && raw.id ? raw.id : makeId(mode === 'quiz' ? 'q' : 'c');
    items.push({ id, ...result.item });
  });

  return { items, dropped };
}

/**
 * Interprets a parsed model response for a new set.
 *
 * @returns
 *   {kind: 'ok', title, items, dropped}
 *   {kind: 'insufficient', reason}   the model said the input wasn't usable
 *   {kind: 'empty'}                  valid response with zero items
 *   {kind: 'invalid', code, reason, dropped?}
 */
export function normalizeSet(value, mode) {
  if (value === null || value === undefined) return { kind: 'invalid', code: 'wrong_shape', reason: 'The response was empty.' };
  if (Array.isArray(value)) value = { items: value };
  if (typeof value !== 'object') {
    return { kind: 'invalid', code: 'wrong_shape', reason: 'The response was not a JSON object.' };
  }

  const insufficient = readStatus(value);
  if (insufficient) return insufficient;

  const rawItems = findItemList(value);
  if (!rawItems) return { kind: 'invalid', code: 'wrong_shape', reason: 'The response had no list of items.' };
  if (rawItems.length === 0) return { kind: 'empty' };

  const { items, dropped } = normalizeItems(rawItems, mode);
  if (items.length === 0) {
    return {
      kind: 'invalid',
      code: 'wrong_shape',
      reason: `None of the ${rawItems.length} items could be used.`,
      dropped,
    };
  }

  const title = cleanText(first(value, ['title', 'topic', 'name', 'subject']), LIMITS.title) ?? 'Untitled set';
  return { kind: 'ok', title, items, dropped };
}
