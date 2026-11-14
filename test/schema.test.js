import { describe, expect, it } from 'vitest';
import { normalizeItem, normalizeSet } from '../src/lib/schema.js';

const mcq = (extra) => ({ type: 'mcq', question: 'Where?', options: ['Stroma', 'Thylakoid', 'Nucleus', 'Wall'], ...extra });

describe('normalizeItem: flashcards', () => {
  it('accepts the documented shape', () => {
    expect(normalizeItem({ type: 'flashcard', front: ' Q ', back: 'A' }, 'flashcards')).toEqual({
      ok: true,
      item: { type: 'flashcard', front: 'Q', back: 'A' },
    });
  });

  it('accepts common renamed keys', () => {
    expect(normalizeItem({ term: 'ATP', definition: 'Energy carrier' }, 'flashcards').item).toMatchObject({
      front: 'ATP',
      back: 'Energy carrier',
    });
    expect(normalizeItem({ question: 'Q?', answer: 'A' }, 'flashcards').item).toMatchObject({ front: 'Q?', back: 'A' });
  });

  it('rejects empty or identical sides', () => {
    expect(normalizeItem({ front: 'Q', back: '   ' }, 'flashcards').ok).toBe(false);
    expect(normalizeItem({ front: 'Same', back: 'same' }, 'flashcards').ok).toBe(false);
  });

  it('caps very long text', () => {
    const { item } = normalizeItem({ front: 'Q', back: 'x'.repeat(5000) }, 'flashcards');
    expect(item.back.length).toBeLessThanOrEqual(700);
    expect(item.back.endsWith('…')).toBe(true);
  });

  it('turns quiz questions into flashcards in flashcard mode', () => {
    expect(normalizeItem(mcq({ answerIndex: 1, explanation: 'Because.' }), 'flashcards').item).toEqual({
      type: 'flashcard',
      front: 'Where?',
      back: 'Thylakoid\n\nBecause.',
    });
  });
});

describe('normalizeItem: multiple choice', () => {
  it('accepts the documented shape', () => {
    expect(normalizeItem(mcq({ answerIndex: 2 }), 'quiz').item).toMatchObject({ type: 'mcq', answerIndex: 2 });
  });

  it.each([
    ['letter', { answer: 'B' }, 1],
    ['letter in brackets', { correct_answer: '(c)' }, 2],
    ['"Option D"', { correctAnswer: 'Option D' }, 3],
    ['answer text', { answer: 'thylakoid' }, 1],
    ['index as a string', { answerIndex: '0' }, 0],
  ])('resolves the answer from a %s', (_label, extra, expected) => {
    expect(normalizeItem(mcq(extra), 'quiz').item.answerIndex).toBe(expected);
  });

  it('reads options from an {A: .., B: ..} object and from objects with a correct flag', () => {
    const fromMap = normalizeItem({ type: 'multiple_choice', question: 'Q', choices: { A: 'x', B: 'y' }, answer: 'B' }, 'quiz');
    expect(fromMap.item).toMatchObject({ options: ['x', 'y'], answerIndex: 1 });

    const flagged = normalizeItem({ question: 'Q', options: [{ text: 'x' }, { text: 'y', correct: true }] }, 'quiz');
    expect(flagged.item).toMatchObject({ options: ['x', 'y'], answerIndex: 1 });
  });

  it('strips letter prefixes only when every option has one', () => {
    const all = normalizeItem(mcq({ options: ['A) One', 'B) Two'], answerIndex: 0 }), 'quiz');
    expect(all.item.options).toEqual(['One', 'Two']);
    const some = normalizeItem(mcq({ options: ['A. One', 'Two'], answerIndex: 0 }), 'quiz');
    expect(some.item.options).toEqual(['A. One', 'Two']);
  });

  it.each([
    ['an out-of-range index', { answerIndex: 4 }],
    ['a bare number in "answer" (0- or 1-based?)', { answer: 2 }],
    ['an answer matching no option', { answer: 'Mitochondria' }],
    ['no answer at all', {}],
    ['duplicate options', { options: ['A', 'a', 'B'], answerIndex: 0 }],
    ['a single option', { options: ['Only'], answerIndex: 0 }],
    ['an empty option', { options: ['A', ' ', 'C'], answerIndex: 0 }],
    ['two options flagged correct', { options: [{ text: 'x', correct: true }, { text: 'y', correct: true }] }],
  ])('drops a question with %s instead of guessing', (_label, extra) => {
    const result = normalizeItem(mcq(extra), 'quiz');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/\w/);
  });
});

describe('normalizeItem: true/false', () => {
  it('accepts booleans and boolean strings', () => {
    expect(normalizeItem({ type: 'true_false', statement: 'S', answer: false }, 'quiz').item.answer).toBe(false);
    expect(normalizeItem({ kind: 'True/False', question: 'S', correct: 'TRUE' }, 'quiz').item).toMatchObject({
      type: 'true_false',
      statement: 'S',
      answer: true,
    });
  });

  it('rejects a missing verdict', () => {
    expect(normalizeItem({ type: 'tf', statement: 'S', answer: 'maybe' }, 'quiz').ok).toBe(false);
  });

  it('rejects flashcards in quiz mode and unknown types', () => {
    expect(normalizeItem({ type: 'flashcard', front: 'a', back: 'b' }, 'quiz').ok).toBe(false);
    expect(normalizeItem({ type: 'chart', data: [] }, 'quiz').ok).toBe(false);
    expect(normalizeItem('a string', 'quiz').ok).toBe(false);
    expect(normalizeItem(null, 'quiz').ok).toBe(false);
  });
});

describe('normalizeSet', () => {
  it('keeps good items, drops bad ones and duplicates, and says why', () => {
    const result = normalizeSet(
      {
        title: 'Cells',
        items: [
          { front: 'a', back: 'b' },
          { front: 'A', back: 'again' },
          { front: 'c' },
          { front: 'd', back: 'e' },
        ],
      },
      'flashcards',
    );
    expect(result.kind).toBe('ok');
    expect(result.items.map((i) => i.front)).toEqual(['a', 'd']);
    expect(result.dropped).toHaveLength(2);
    expect(new Set(result.items.map((i) => i.id)).size).toBe(2);
  });

  it('finds the list under other keys and one level down', () => {
    expect(normalizeSet({ cards: [{ front: 'a', back: 'b' }] }, 'flashcards').kind).toBe('ok');
    expect(normalizeSet({ quiz: { questions: [mcq({ answerIndex: 0 })] } }, 'quiz').kind).toBe('ok');
    expect(normalizeSet([{ front: 'a', back: 'b' }], 'flashcards').kind).toBe('ok');
  });

  it('distinguishes empty, insufficient and unusable responses', () => {
    expect(normalizeSet({ items: [] }, 'quiz')).toEqual({ kind: 'empty' });
    expect(normalizeSet({ status: 'insufficient', reason: 'Too short.' }, 'quiz')).toEqual({
      kind: 'insufficient',
      reason: 'Too short.',
    });
    expect(normalizeSet({ answer: 42 }, 'quiz')).toMatchObject({ kind: 'invalid', code: 'wrong_shape' });
    expect(normalizeSet({ items: [{ nope: true }] }, 'quiz')).toMatchObject({ kind: 'invalid', code: 'wrong_shape' });
    expect(normalizeSet('hello', 'quiz')).toMatchObject({ kind: 'invalid' });
    expect(normalizeSet(null, 'quiz')).toMatchObject({ kind: 'invalid' });
  });

  it('caps the number of items', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ front: `q${i}`, back: `a${i}` }));
    const result = normalizeSet({ items }, 'flashcards');
    expect(result.items).toHaveLength(40);
    expect(result.dropped).toHaveLength(20);
  });

  it('falls back to a title when there is none', () => {
    expect(normalizeSet({ items: [{ front: 'a', back: 'b' }] }, 'flashcards').title).toBe('Untitled set');
  });
});
