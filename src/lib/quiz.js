/**
 * Pure quiz logic, kept out of components so it's easy to test and reason
 * about. A quiz is a series of rounds: round 1 asks everything, later rounds
 * ask only what you got wrong, until nothing is left.
 */

export function choicesFor(item) {
  if (item.type === 'mcq') return item.options;
  if (item.type === 'true_false') return ['True', 'False'];
  return []; // fill_blank: typed, no options
}

/**
 * The value stored as an answer:
 *   mcq         an option index
 *   true_false  a boolean
 *   fill_blank  { text, verdict: 'right' | 'close' | 'wrong', overridden? }
 */
export function answerValue(item, choiceIndex) {
  return item.type === 'mcq' ? choiceIndex : choiceIndex === 0;
}

export function isCorrect(item, answer) {
  if (answer === undefined || answer === null) return false;
  if (item.type === 'mcq') return answer === item.answerIndex;
  if (item.type === 'true_false') return answer === item.answer;
  return answer.verdict === 'right';
}

export function correctChoiceIndex(item) {
  return item.type === 'mcq' ? item.answerIndex : item.answer ? 0 : 1;
}

export function choiceLabel(item, answer) {
  if (answer === undefined || answer === null) return '';
  if (item.type === 'mcq') return item.options[answer];
  if (item.type === 'true_false') return answer ? 'True' : 'False';
  return answer.text || '(left blank)';
}

export function correctLabel(item) {
  if (item.type === 'mcq') return item.options[item.answerIndex];
  if (item.type === 'true_false') return item.answer ? 'True' : 'False';
  return item.answers[0];
}

/* ---------- typed answers ---------- */

/** Lowercase, strip accents, punctuation and leading articles, collapse spaces. */
export function normalizeAnswer(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

/**
 * Grades a typed answer against the accepted answers.
 * 'close' means one or two letters off. That is NOT counted as right
 * automatically: "NADH" is one letter from "NADPH" and is a different
 * molecule. The person decides (see the "Count it as right" button).
 */
export function gradeTyped(item, text) {
  const given = normalizeAnswer(text);
  if (!given) return 'wrong';
  const targets = item.answers.map(normalizeAnswer).filter(Boolean);
  if (targets.includes(given)) return 'right';
  const near = targets.some((target) => {
    const allowed = target.length >= 8 ? 2 : target.length >= 4 ? 1 : 0;
    return allowed > 0 && editDistance(given, target) <= allowed;
  });
  return near ? 'close' : 'wrong';
}

/** Fisher–Yates; `random` is injectable so tests are deterministic. */
export function shuffle(list, random = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Display order of options per question. Retakes shuffle the options so you
 * remember the answer, not its position.
 */
export function optionOrders(items, ids, { shuffled, random = Math.random } = {}) {
  const orders = {};
  for (const id of ids) {
    const item = items.find((i) => i.id === id);
    if (!item) continue;
    const indexes = choicesFor(item).map((_, i) => i);
    orders[id] = shuffled && item.type === 'mcq' ? shuffle(indexes, random) : indexes; // [] for typed questions
  }
  return orders;
}

export function newRound(items, ids, { round = 1, history = [], orders }) {
  return {
    round,
    ids: ids.filter((id) => items.some((i) => i.id === id)),
    orders: orders ?? optionOrders(items, ids, { shuffled: false }),
    index: 0,
    answers: {},
    phase: 'question',
    history,
  };
}

export function score(items, round) {
  const asked = round.ids.map((id) => items.find((i) => i.id === id)).filter(Boolean);
  const missed = asked.filter((item) => !isCorrect(item, round.answers[item.id]));
  return { total: asked.length, correct: asked.length - missed.length, missed };
}

export function quizReducer(state, action) {
  switch (action.type) {
    case 'answer':
      if (state.phase !== 'question' || state.answers[action.id] !== undefined) return state; // one answer per question
      return { ...state, answers: { ...state.answers, [action.id]: action.answer } };
    case 'override': {
      // The person says their typed answer meant the same thing (a typo or a synonym).
      const current = state.answers[action.id];
      if (state.phase !== 'question' || !current || typeof current !== 'object' || current.verdict === 'right') return state;
      return { ...state, answers: { ...state.answers, [action.id]: { ...current, verdict: 'right', overridden: true } } };
    }
    case 'next': {
      const currentId = state.ids[state.index];
      if (state.answers[currentId] === undefined) return state;
      if (state.index + 1 < state.ids.length) return { ...state, index: state.index + 1 };
      const result = score(action.items, state);
      return {
        ...state,
        phase: 'summary',
        history: [...state.history, { round: state.round, correct: result.correct, total: result.total }],
      };
    }
    case 'retake':
      return newRound(action.items, action.ids, {
        round: state.round + 1,
        history: action.keepHistory ? state.history : [],
        orders: action.orders,
      });
    default:
      return state;
  }
}

/* ---------- saved sessions ---------- */

function validAnswer(item, answer) {
  if (item.type === 'mcq') return Number.isInteger(answer) && answer >= 0 && answer < item.options.length;
  if (item.type === 'true_false') return typeof answer === 'boolean';
  return (
    answer !== null &&
    typeof answer === 'object' &&
    typeof answer.text === 'string' &&
    ['right', 'close', 'wrong'].includes(answer.verdict)
  );
}

function validOrder(item, order) {
  const n = choicesFor(item).length;
  return Array.isArray(order) && order.length === n && [...order].sort((a, b) => a - b).every((v, i) => v === i);
}

/**
 * Rebuilds a saved quiz round, or returns null if anything about it doesn't
 * match the current items. A quiz saved before an edit (different version)
 * is discarded rather than patched.
 */
export function restoreQuiz(saved, items, version) {
  if (!saved || typeof saved !== 'object' || saved.version !== version) return null;
  const state = saved.state;
  if (!state || typeof state !== 'object') return null;
  const byId = new Map(items.map((i) => [i.id, i]));

  const { ids, orders, answers, index, phase, round, history } = state;
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length) return null;
  if (!ids.every((id) => byId.has(id))) return null;
  if (!orders || typeof orders !== 'object' || !ids.every((id) => validOrder(byId.get(id), orders[id]))) return null;
  if (!answers || typeof answers !== 'object') return null;
  for (const [id, answer] of Object.entries(answers)) {
    if (!byId.has(id) || !ids.includes(id) || !validAnswer(byId.get(id), answer)) return null;
  }
  if (phase !== 'question' && phase !== 'summary') return null;
  if (!Number.isInteger(index) || index < 0 || index >= ids.length) return null;
  if (!Number.isInteger(round) || round < 1) return null;
  if (!Array.isArray(history) || !history.every((h) => h && Number.isInteger(h.correct) && Number.isInteger(h.total))) return null;

  return { ids, orders, answers, index, phase, round, history };
}
