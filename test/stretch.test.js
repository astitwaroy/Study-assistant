import { describe, expect, it } from 'vitest';
import { importSet, exportSet } from '../src/hooks/useSavedSets.js';
import { restorePass } from '../src/lib/deck.js';
import { interpretSet } from '../src/lib/interpret.js';
import { gradeTyped, isCorrect, newRound, normalizeAnswer, quizReducer, restoreQuiz } from '../src/lib/quiz.js';
import { normalizeGuide, normalizeItem, normalizeSet, toNumber } from '../src/lib/schema.js';

describe('fill-in-the-blank items', () => {
  it('accepts the documented shape and common variants', () => {
    expect(normalizeItem({ type: 'fill_blank', prompt: 'The ____ is green.', answers: ['leaf', 'Leaf', 'leaves'] }, 'quiz').item).toEqual({
      type: 'fill_blank',
      prompt: 'The ____ is green.',
      answers: ['leaf', 'leaves'],
    });
    expect(normalizeItem({ type: 'Fill in the blank', sentence: 'A ____.', answer: 'b' }, 'quiz').item).toMatchObject({
      type: 'fill_blank',
      answers: ['b'],
    });
    // A bare {question, answer} is a typed question in a quiz and a card in flashcards.
    expect(normalizeItem({ question: 'Q?', answer: 'A' }, 'quiz').item.type).toBe('fill_blank');
    expect(normalizeItem({ question: 'Q?', answer: 'A' }, 'flashcards').item.type).toBe('flashcard');
  });

  it('drops items with no answer or an answer too long to type', () => {
    expect(normalizeItem({ type: 'fill_blank', prompt: 'A ____.' }, 'quiz').ok).toBe(false);
    expect(normalizeItem({ type: 'fill_blank', prompt: 'A ____.', answers: ['x'.repeat(80)] }, 'quiz').ok).toBe(false);
  });

  it('becomes a flashcard in flashcard mode', () => {
    expect(normalizeItem({ type: 'fill_blank', prompt: 'A ____.', answers: ['b'], explanation: 'Why.' }, 'flashcards').item).toEqual({
      type: 'flashcard',
      front: 'A ____.',
      back: 'b\n\nWhy.',
    });
  });
});

describe('typed answer grading', () => {
  const item = { type: 'fill_blank', answers: ['NADPH', 'the stroma'] };

  it('ignores case, punctuation, accents and articles', () => {
    expect(normalizeAnswer('  The Stróma!  ')).toBe('stroma');
    expect(gradeTyped(item, 'stroma.')).toBe('right');
    expect(gradeTyped(item, 'nadph')).toBe('right');
  });

  it('flags near misses as close, which is not counted as right', () => {
    expect(gradeTyped(item, 'NADH')).toBe('close');
    expect(isCorrect(item, { text: 'NADH', verdict: 'close' })).toBe(false);
  });

  it('marks blanks and unrelated answers wrong', () => {
    expect(gradeTyped(item, '')).toBe('wrong');
    expect(gradeTyped(item, 'chloroplast')).toBe('wrong');
  });

  it('lets the person override a typed answer, once, and only typed ones', () => {
    const items = [
      { id: 't', ...item },
      { id: 'm', type: 'mcq', question: 'Q', options: ['a', 'b'], answerIndex: 0 },
    ];
    let state = newRound(items, ['t', 'm'], {});
    state = quizReducer(state, { type: 'answer', id: 't', answer: { text: 'NADH', verdict: 'close' } });
    state = quizReducer(state, { type: 'override', id: 't' });
    expect(state.answers.t).toEqual({ text: 'NADH', verdict: 'right', overridden: true });
    state = quizReducer(state, { type: 'answer', id: 'm', answer: 1 });
    expect(quizReducer(state, { type: 'override', id: 'm' })).toBe(state);
  });
});

describe('study guide blocks', () => {
  it('keeps valid blocks and explains the rest', () => {
    const { blocks, dropped } = normalizeGuide([
      { type: 'checklist', items: ['One', { text: 'Two' }, 'one'] },
      { type: 'Bar chart', title: 'Sizes', data: [{ name: 'a', count: '1,200' }, { label: 'b', value: 'lots' }, ['c', 3]] },
      { type: 'steps', events: [{ step: 'Step 1', what: 'Start' }, { date: '1789', event: 'Revolution' }] },
      { type: 'video', url: 'x' },
      { type: 'chart', data: [{ label: 'only', value: 1 }] },
      { type: 'chart', data: [{ label: 'a', value: -1 }, { label: 'b', value: 2 }] },
      { type: 'checklist', items: ['lonely'] },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['checklist', 'chart', 'timeline']);
    expect(blocks[0].items.map((i) => i.text)).toEqual(['One', 'Two']);
    expect(blocks[1]).toMatchObject({ data: [{ label: 'a', value: 1200 }, { label: 'c', value: 3 }], skipped: 1 });
    expect(dropped.map((d) => d.reason).join(' ')).toMatch(/video.*fewer than two numeric.*negative.*fewer than two usable/s);
  });

  it('never invents a number', () => {
    expect(toNumber('45%')).toBe(45);
    expect(toNumber('about 6')).toBeNull();
    expect(toNumber('six')).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
  });

  it('is optional, and a broken guide never blocks the items', () => {
    const items = [{ front: 'a', back: 'b' }];
    expect(normalizeSet({ items }, 'flashcards').guide).toEqual([]);
    const result = normalizeSet({ items, guide: 'not a list' }, 'flashcards');
    expect(result.kind).toBe('ok');
    expect(result.dropped[0].reason).toMatch(/^Study guide:/);
  });

  it('salvages complete guide blocks from a cut-off answer', () => {
    const full = JSON.stringify({
      title: 'T',
      items: [{ front: 'a', back: 'b' }],
      guide: [{ type: 'checklist', items: ['x', 'y'] }, { type: 'timeline', events: [{ when: '1', what: 'a' }, { when: '2', what: 'b' }] }],
    });
    const cut = full.slice(0, full.indexOf('"timeline"') + 20);
    const result = interpretSet(cut, { mode: 'flashcards', finishReason: 'length' });
    expect(result.items).toHaveLength(1);
    expect(result.guide.map((b) => b.type)).toEqual(['checklist']);
  });
});

describe('saved sessions', () => {
  const items = [
    { id: 'a', type: 'mcq', question: 'A?', options: ['w', 'x'], answerIndex: 1 },
    { id: 'b', type: 'fill_blank', prompt: 'B ____', answers: ['b'] },
  ];
  const good = {
    version: 2,
    state: { ...newRound(items, ['a', 'b'], {}), index: 1, answers: { a: 1, b: { text: 'b', verdict: 'right' } } },
  };

  it('restores a quiz round that still fits the set', () => {
    expect(restoreQuiz(good, items, 2)).toMatchObject({ index: 1, answers: { a: 1 } });
  });

  it.each([
    ['an older version', { ...good, version: 1 }],
    ['an unknown question', { ...good, state: { ...good.state, ids: ['a', 'zzz'] } }],
    ['an out-of-range answer', { ...good, state: { ...good.state, answers: { a: 9 } } }],
    ['a typed answer with no verdict', { ...good, state: { ...good.state, answers: { b: { text: 'b' } } } }],
    ['a bad option order', { ...good, state: { ...good.state, orders: { a: [0, 0], b: [] } } }],
    ['an index past the end', { ...good, state: { ...good.state, index: 5 } }],
    ['garbage', 'hello'],
  ])('starts fresh instead of restoring %s', (_label, saved) => {
    expect(restoreQuiz(saved, items, 2)).toBeNull();
  });

  it('restores a deck pass only for the same version and cards', () => {
    const saved = { version: 1, state: { order: ['a', 'b'], index: 1, kind: 'all' } };
    expect(restorePass(saved, ['a', 'b'], 1)).toEqual({ order: ['a', 'b'], index: 1, flipped: false, kind: 'all' });
    expect(restorePass(saved, ['a', 'b'], 2)).toBeNull();
    expect(restorePass(saved, ['a'], 1)).toBeNull();
    expect(restorePass({ version: 1, state: { order: ['a', 'a'], index: 0, kind: 'all' } }, ['a'], 1)).toBeNull();
  });
});

describe('export and import', () => {
  const set = {
    id: 's1',
    mode: 'flashcards',
    title: 'Cells',
    sourceText: 'notes',
    items: [{ id: 'c1', type: 'flashcard', front: 'a', back: 'b' }],
    guide: [{ id: 'g1', type: 'checklist', title: 'Key points', items: [{ id: 'g1_0', text: 'x' }, { id: 'g1_1', text: 'y' }] }],
    version: 3,
  };

  it('round-trips a set under a new id', () => {
    const { set: imported, skipped } = importSet(JSON.stringify(exportSet(set)));
    expect(imported.id).not.toBe('s1');
    expect(imported).toMatchObject({ title: 'Cells', mode: 'flashcards', version: 1 });
    expect(imported.items).toEqual(set.items);
    expect(imported.guide[0].items).toEqual(set.guide[0].items);
    expect(skipped).toBe(0);
  });

  it('validates imported files like model output', () => {
    expect(importSet('{nope').error).toMatch(/valid JSON/);
    expect(importSet('42').error).toBeTruthy();
    expect(importSet(JSON.stringify({ mode: 'quiz', items: [{ x: 1 }] })).error).toMatch(/usable/);
    const mixed = importSet(JSON.stringify({ mode: 'flashcards', title: 'T', items: [{ front: 'a', back: 'b' }, { front: '' }] }));
    expect(mixed.set.items).toHaveLength(1);
    expect(mixed.skipped).toBe(1);
  });

  it('gives reused ids fresh ones so progress never gets crossed', () => {
    const { set: imported } = importSet(
      JSON.stringify({ mode: 'flashcards', items: [{ id: 'dup', front: 'a', back: 'b' }, { id: 'dup', front: 'c', back: 'd' }] }),
    );
    expect(new Set(imported.items.map((i) => i.id)).size).toBe(2);
  });
});
