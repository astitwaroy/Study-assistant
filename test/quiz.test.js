import { describe, expect, it } from 'vitest';
import { countStatuses, deckReducer, newPass, validateStatuses } from '../src/lib/deck.js';
import { newRound, optionOrders, quizReducer, score } from '../src/lib/quiz.js';

const items = [
  { id: 'a', type: 'mcq', question: 'A?', options: ['w', 'x', 'y', 'z'], answerIndex: 1 },
  { id: 'b', type: 'true_false', statement: 'B', answer: false },
  { id: 'c', type: 'mcq', question: 'C?', options: ['p', 'q'], answerIndex: 0 },
];

function play(state, answers) {
  for (const id of state.ids) {
    state = quizReducer(state, { type: 'answer', id, answer: answers[id] });
    state = quizReducer(state, { type: 'next', items });
  }
  return state;
}

describe('quiz rounds', () => {
  it('scores a round and retakes only the missed questions', () => {
    let state = newRound(items, items.map((i) => i.id), {});
    state = play(state, { a: 1, b: true, c: 1 });
    expect(state.phase).toBe('summary');
    expect(score(items, state)).toMatchObject({ correct: 1, total: 3 });

    const missed = score(items, state).missed.map((i) => i.id);
    expect(missed).toEqual(['b', 'c']);
    state = quizReducer(state, { type: 'retake', items, ids: missed, keepHistory: true });
    expect(state).toMatchObject({ round: 2, ids: ['b', 'c'], index: 0, phase: 'question' });

    state = play(state, { b: false, c: 0 });
    expect(score(items, state).missed).toHaveLength(0);
    expect(state.history).toEqual([
      { round: 1, correct: 1, total: 3 },
      { round: 2, correct: 2, total: 2 },
    ]);
  });

  it('locks the first answer and will not advance without one', () => {
    let state = newRound(items, ['a'], {});
    state = quizReducer(state, { type: 'next', items });
    expect(state.index).toBe(0);
    state = quizReducer(state, { type: 'answer', id: 'a', answer: 0 });
    state = quizReducer(state, { type: 'answer', id: 'a', answer: 1 });
    expect(state.answers.a).toBe(0);
  });

  it('shuffles option order on retakes but never for true/false', () => {
    const orders = optionOrders(items, ['a', 'b'], { shuffled: true, random: () => 0 });
    expect(orders.a).toEqual([1, 2, 3, 0]);
    expect(orders.b).toEqual([0, 1]);
  });
});

describe('flashcard deck', () => {
  it('moves through a pass and stops at the end', () => {
    let state = newPass(['a', 'b']);
    state = deckReducer(state, { type: 'flip' });
    expect(state.flipped).toBe(true);
    state = deckReducer(state, { type: 'next' });
    expect(state).toMatchObject({ index: 1, flipped: false });
    state = deckReducer(deckReducer(state, { type: 'next' }), { type: 'next' });
    expect(state.index).toBe(2);
    expect(deckReducer(state, { type: 'flip' })).toBe(state);
  });

  it('counts statuses and cleans stored ones', () => {
    expect(countStatuses(['a', 'b', 'c'], { a: 'known', b: 'learning', z: 'known' })).toEqual({ known: 1, learning: 1, unseen: 1 });
    expect(validateStatuses({ a: 'known', b: 'bogus' })).toEqual({ a: 'known' });
    expect(validateStatuses([1, 2])).toBeUndefined();
  });
});
