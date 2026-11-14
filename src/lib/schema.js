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
 *   { id, type: 'fill_blank', prompt, answers: string[1..6], explanation? }
 *
 * Study-guide blocks (shown beside the practice items):
 *   { id, type: 'checklist', title, items: [{ id, text }] }
 *   { id, type: 'chart', title, unit?, data: [{ label, value: number >= 0 }] }
 *   { id, type: 'timeline', title, events: [{ when, what }] }
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
  typedAnswer: 60,
  maxAnswers: 6,
  blockTitle: 80,
  checklistItem: 200,
  chartLabel: 60,
  maxGuideBlocks: 4,
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
  fill_blank: 'fill_blank',
  fill_in_the_blank: 'fill_blank',
  fill_in_blank: 'fill_blank',
  fill_blanks: 'fill_blank',
  blank: 'fill_blank',
  cloze: 'fill_blank',
  short_answer: 'fill_blank',
  typed: 'fill_blank',
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

const BLANK = /_{3,}|\[blank\]/i;

function inferType(raw, mode) {
  const declared = first(raw, ['type', 'kind', 'format']);
  if (typeof declared === 'string') {
    const key = declared.trim().toLowerCase().replace(/[\s/-]+/g, '_');
    if (TYPE_ALIASES[key]) return TYPE_ALIASES[key];
  }
  if (first(raw, ['options', 'choices']) !== undefined) return 'mcq';
  if (Array.isArray(raw.answers)) {
    // "answers" is either a list of options (with an answer key) or accepted typed answers.
    const hasKey = first(raw, ['answerIndex', 'answer_index', 'correctIndex', 'correct_answer', 'correctAnswer']) !== undefined;
    return hasKey ? 'mcq' : 'fill_blank';
  }
  if (raw.statement !== undefined || toBoolean(raw.answer ?? raw.correct) !== null) return 'true_false';
  if (first(raw, ['front', 'back', 'term', 'definition']) !== undefined) return 'flashcard';
  const prompt = first(raw, ['question', 'prompt', 'sentence']);
  if (prompt !== undefined && raw.answer !== undefined) {
    // {question, answer} is a flashcard, unless we're in a quiz or it has a blank to fill.
    return mode === 'quiz' || (typeof prompt === 'string' && BLANK.test(prompt)) ? 'fill_blank' : 'flashcard';
  }
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

function normalizeFillBlank(raw) {
  const prompt = cleanText(first(raw, ['prompt', 'question', 'sentence', 'text', 'statement']), LIMITS.question);
  if (!prompt) return fail('A fill-in-the-blank question had no prompt.');

  let answers = first(raw, ['answers', 'acceptedAnswers', 'accepted_answers', 'answer', 'correct_answer', 'correctAnswer']);
  if (!Array.isArray(answers)) answers = answers === undefined ? [] : [answers];
  const unique = new Map();
  for (const a of answers) {
    const text = cleanText(a && typeof a === 'object' ? first(a, ['text', 'value']) : a, 200);
    if (text && !unique.has(text.toLowerCase())) unique.set(text.toLowerCase(), text);
  }
  answers = [...unique.values()];

  if (answers.length === 0) return fail(`"${prompt}" had no accepted answer.`);
  if (answers[0].length > LIMITS.typedAnswer) return fail(`"${prompt}" expected an answer too long to type.`);
  answers = answers.filter((a) => a.length <= LIMITS.typedAnswer).slice(0, LIMITS.maxAnswers);

  const explanation = cleanText(first(raw, ['explanation', 'rationale', 'why', 'reason']), LIMITS.explanation);
  return ok({ type: 'fill_blank', prompt, answers, ...(explanation && { explanation }) });
}

/** Turns quiz items into flashcards when the model mixes up the modes. */
function asFlashcard(item) {
  if (item.type === 'fill_blank') {
    return {
      type: 'flashcard',
      front: item.prompt,
      back: item.explanation ? `${item.answers[0]}\n\n${item.explanation}` : item.answers[0],
    };
  }
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

  const type = inferType(raw, mode);
  let result;
  if (type === 'flashcard') result = normalizeFlashcard(raw);
  else if (type === 'mcq') result = normalizeMcq(raw);
  else if (type === 'true_false') result = normalizeTrueFalse(raw);
  else if (type === 'fill_blank') result = normalizeFillBlank(raw);
  else return fail(`An item had an unknown type${raw.type ? ` ("${String(raw.type).slice(0, 30)}")` : ''}.`);

  if (!result.ok) return result;

  if (mode === 'flashcards' && result.item.type !== 'flashcard') return ok(asFlashcard(result.item));
  if (mode === 'quiz' && result.item.type === 'flashcard') {
    return fail(`"${result.item.front}" came back as a flashcard instead of a quiz question.`);
  }
  return result;
}

/** The main text of an item: its front, question, statement or prompt. */
export function itemText(item) {
  return item.front ?? item.question ?? item.statement ?? item.prompt ?? '';
}

/** Text that identifies an item, used to spot duplicates. */
export function itemKey(item) {
  const text = item.front ?? item.question ?? item.statement ?? item.prompt ?? '';
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/* ---------- study-guide blocks ---------- */

const BLOCK_ALIASES = {
  checklist: 'checklist',
  key_points: 'checklist',
  keypoints: 'checklist',
  summary: 'checklist',
  list: 'checklist',
  chart: 'chart',
  bar_chart: 'chart',
  barchart: 'chart',
  bar: 'chart',
  timeline: 'timeline',
  sequence: 'timeline',
  steps: 'timeline',
  process: 'timeline',
};

/** "1,200", "45%", "3.5 kg" -> number; anything else -> null. Never invents a value. */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?/);
  if (!match || match[0].length === 0) return null;
  const n = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeChecklist(raw) {
  const list = first(raw, ['items', 'points', 'list', 'entries']);
  if (!Array.isArray(list)) return fail('A checklist had no list of points.');
  const seen = new Set();
  const items = [];
  for (const entry of list) {
    const text = cleanText(entry && typeof entry === 'object' ? first(entry, ['text', 'label', 'point']) : entry, LIMITS.checklistItem);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    items.push(text);
  }
  if (items.length < 2) return fail('A checklist had fewer than two usable points.');
  return ok({ type: 'checklist', title: cleanText(raw.title, LIMITS.blockTitle) ?? 'Key points', items: items.slice(0, 12) });
}

function normalizeChart(raw) {
  const list = first(raw, ['data', 'values', 'bars', 'points', 'series']);
  if (!Array.isArray(list)) return fail('A chart had no data.');
  const data = [];
  let skipped = 0;
  for (const point of list) {
    let label;
    let value;
    if (Array.isArray(point)) [label, value] = point;
    else if (point && typeof point === 'object') {
      label = first(point, ['label', 'name', 'category', 'x', 'key']);
      value = first(point, ['value', 'count', 'amount', 'y', 'number']);
    }
    const text = cleanText(label, LIMITS.chartLabel);
    const number = toNumber(value);
    if (!text || number === null) {
      skipped += 1;
      continue;
    }
    data.push({ label: text, value: number });
  }
  const title = cleanText(raw.title, LIMITS.blockTitle);
  if (data.length < 2) return fail(`The chart${title ? ` "${title}"` : ''} had fewer than two numeric values${skipped ? ` (${skipped} weren't numbers)` : ''}.`);
  if (data.some((d) => d.value < 0)) return fail(`The chart${title ? ` "${title}"` : ''} had negative values, which Recall can't draw yet.`);
  if (data.every((d) => d.value === 0)) return fail(`The chart${title ? ` "${title}"` : ''} only had zeros.`);
  return ok({
    type: 'chart',
    title: title ?? 'Chart',
    ...(cleanText(raw.unit, 30) && { unit: cleanText(raw.unit, 30) }),
    data: data.slice(0, 10),
    ...(skipped && { skipped }),
  });
}

function normalizeTimeline(raw) {
  const list = first(raw, ['events', 'steps', 'items', 'entries']);
  if (!Array.isArray(list)) return fail('A timeline had no events.');
  const events = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const when = cleanText(first(entry, ['when', 'date', 'year', 'time', 'step', 'label']), 40);
    const what = cleanText(first(entry, ['what', 'event', 'description', 'text', 'detail']), 240);
    if (when && what) events.push({ when, what });
  }
  if (events.length < 2) return fail('A timeline had fewer than two complete events.');
  return ok({ type: 'timeline', title: cleanText(raw.title, LIMITS.blockTitle) ?? 'Timeline', events: events.slice(0, 15) });
}

/** Validates one study-guide block. */
export function normalizeBlock(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('A study-guide block was not an object.');
  const declared = String(first(raw, ['type', 'kind']) ?? '').trim().toLowerCase().replace(/[\s/-]+/g, '_');
  const type = BLOCK_ALIASES[declared];
  if (type === 'checklist') return normalizeChecklist(raw);
  if (type === 'chart') return normalizeChart(raw);
  if (type === 'timeline') return normalizeTimeline(raw);
  return fail(`The study guide had a block type Recall can't show${declared ? ` ("${declared.slice(0, 30)}")` : ''}.`);
}

/** Validates the optional study guide. Missing is fine; broken blocks are dropped with a reason. */
export function normalizeGuide(rawGuide, { keepIds = false } = {}) {
  if (rawGuide === undefined || rawGuide === null) return { blocks: [], dropped: [] };
  const list = Array.isArray(rawGuide) ? rawGuide : Array.isArray(rawGuide?.blocks) ? rawGuide.blocks : null;
  if (!list) return { blocks: [], dropped: [{ index: 0, reason: 'The study guide was not a list of blocks.' }] };

  const blocks = [];
  const dropped = [];
  list.forEach((raw, index) => {
    const result = normalizeBlock(raw);
    if (!result.ok) return dropped.push({ index, reason: result.reason });
    if (blocks.length >= LIMITS.maxGuideBlocks) return dropped.push({ index, reason: 'The study guide had too many blocks.' });
    const id = keepIds && typeof raw.id === 'string' && raw.id ? raw.id : makeId('g');
    const block = { id, ...result.item };
    if (block.type === 'checklist') {
      // Items get stable ids so ticks can be saved.
      const rawIds = keepIds && Array.isArray(raw.items) ? raw.items.map((i) => (i && typeof i === 'object' ? i.id : null)) : [];
      block.items = block.items.map((text, i) => ({ id: typeof rawIds[i] === 'string' ? rawIds[i] : `${id}_${i}`, text }));
    }
    blocks.push(block);
  });
  return { blocks, dropped };
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
  const usedIds = new Set();

  rawItems.forEach((raw, index) => {
    const result = normalizeItem(raw, mode);
    if (!result.ok) {
      dropped.push({ index, reason: result.reason });
      return;
    }
    const key = itemKey(result.item);
    if (seen.has(key)) {
      dropped.push({ index, reason: `"${itemText(result.item)}" was a duplicate.` });
      return;
    }
    if (items.length >= LIMITS.maxItems) {
      dropped.push({ index, reason: `Recall keeps at most ${LIMITS.maxItems} items per set.` });
      return;
    }
    seen.add(key);
    // Saved or imported ids are kept so progress still lines up, unless one is reused.
    const keep = keepIds && typeof raw.id === 'string' && raw.id && !usedIds.has(raw.id);
    const id = keep ? raw.id : makeId(mode === 'quiz' ? 'q' : 'c');
    usedIds.add(id);
    items.push({ id, ...result.item });
  });

  return { items, dropped };
}

/**
 * Interprets a parsed model response for a new set.
 *
 * @returns
 *   {kind: 'ok', title, items, guide, dropped}
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
  const guide = normalizeGuide(first(value, ['guide', 'study_guide', 'studyGuide', 'blocks']));
  return { kind: 'ok', title, items, guide: guide.blocks, dropped: [...dropped, ...guide.dropped.map(asGuideDrop)] };
}

const asGuideDrop = (d) => ({ ...d, reason: `Study guide: ${d.reason}`, guide: true });
