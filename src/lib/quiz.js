/**
 * Pure quiz logic, kept out of components so it's easy to test and reason
 * about. A quiz is a series of rounds: round 1 asks everything, later rounds
 * ask only what you got wrong, until nothing is left.
 */

export function choicesFor(item) {
  return item.type === 'mcq' ? item.options : ['True', 'False'];
}

/** The value stored as an answer: an option index for mcq, a boolean for true/false. */
export function answerValue(item, choiceIndex) {
  return item.type === 'mcq' ? choiceIndex : choiceIndex === 0;
}

export function isCorrect(item, answer) {
  return item.type === 'mcq' ? answer === item.answerIndex : answer === item.answer;
}

export function correctChoiceIndex(item) {
  return item.type === 'mcq' ? item.answerIndex : item.answer ? 0 : 1;
}

export function choiceLabel(item, answer) {
  if (answer === undefined || answer === null) return '';
  return item.type === 'mcq' ? item.options[answer] : answer ? 'True' : 'False';
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
    orders[id] = shuffled && item.type === 'mcq' ? shuffle(indexes, random) : indexes;
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
