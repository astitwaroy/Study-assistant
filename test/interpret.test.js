import { describe, expect, it } from 'vitest';
import { interpretRefine, interpretSet, previewSet, salvageSet } from '../src/lib/interpret.js';
import { toRefItems } from '../src/lib/refine.js';

const cards = (n) => Array.from({ length: n }, (_, i) => ({ type: 'flashcard', front: `Q${i}`, back: `A${i}` }));
const doc = (n) => JSON.stringify({ status: 'ok', title: 'Set', items: cards(n) });

describe('interpretSet', () => {
  it('returns a clean result for a good answer', () => {
    const result = interpretSet(doc(3), { mode: 'flashcards', finishReason: 'stop' });
    expect(result).toMatchObject({ kind: 'ok', title: 'Set', warnings: [] });
    expect(result.items).toHaveLength(3);
  });

  it('salvages complete items from a cut-off answer and flags it', () => {
    const text = doc(5).slice(0, -40);
    const result = interpretSet(text, { mode: 'flashcards', finishReason: 'length' });
    expect(result.kind).toBe('ok');
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.length).toBeLessThan(5);
    expect(result.warnings).toEqual(['truncated']);
  });

  it('salvages items when one broken item ruins the JSON', () => {
    const text = '{"title":"T","items":[{"front":"a","back":"b"},{"front":"c" "back":"d"},{"front":"e","back":"f"}]}';
    const result = interpretSet(text, { mode: 'flashcards' });
    expect(result.kind).toBe('ok');
    expect(result.items.map((i) => i.front)).toEqual(['a', 'e']);
    expect(result.warnings).toEqual(['salvaged']);
  });

  it('classifies unusable answers', () => {
    expect(interpretSet('No JSON here, sorry.', { mode: 'quiz' })).toMatchObject({ kind: 'invalid', code: 'malformed' });
    expect(interpretSet('{"items":[{"fro', { mode: 'quiz' })).toMatchObject({ kind: 'invalid', code: 'truncated' });
    expect(interpretSet('', { mode: 'quiz' })).toMatchObject({ kind: 'invalid', code: 'malformed' });
    expect(interpretSet('{"items":[{"x":1}]}', { mode: 'quiz' })).toMatchObject({ kind: 'invalid', code: 'wrong_shape' });
  });

  it('passes through insufficient and empty answers', () => {
    expect(interpretSet('{"status":"insufficient","reason":"Say more."}', { mode: 'quiz' }).kind).toBe('insufficient');
    expect(interpretSet('{"status":"ok","items":[]}', { mode: 'quiz' }).kind).toBe('empty');
  });
});

describe('previewSet / salvageSet', () => {
  it('shows valid items while streaming', () => {
    const preview = previewSet(doc(4).slice(0, 120), 'flashcards');
    expect(preview.title).toBe('Set');
    expect(preview.items.length).toBeGreaterThan(0);
  });

  it('returns null when nothing complete arrived', () => {
    expect(salvageSet('{"items":[{"front":"a"', 'flashcards')).toBeNull();
  });
});

describe('interpretRefine', () => {
  const items = [
    { id: 'c_1', type: 'flashcard', front: 'One', back: '1' },
    { id: 'c_2', type: 'flashcard', front: 'Two', back: '2' },
  ];
  const { refItems, refToId } = toRefItems(items);
  const ctx = { mode: 'flashcards', items, refToId };

  it('sends short refs instead of internal ids', () => {
    expect(refItems).toEqual([
      { ref: 'r1', type: 'flashcard', front: 'One', back: '1' },
      { ref: 'r2', type: 'flashcard', front: 'Two', back: '2' },
    ]);
  });

  it('applies add, update and remove and keeps ids of untouched items', () => {
    const text = JSON.stringify({
      ops: [
        { op: 'update', ref: 'r1', item: { type: 'flashcard', front: 'One!', back: 'uno' } },
        { op: 'remove', ref: 'r2' },
        { op: 'add', item: { type: 'flashcard', front: 'Three', back: '3' } },
      ],
    });
    const result = interpretRefine(text, ctx);
    expect(result.kind).toBe('ok');
    expect(result.summary).toEqual({ added: 1, updated: 1, removed: 1 });
    expect(result.items[0]).toEqual({ id: 'c_1', type: 'flashcard', front: 'One!', back: 'uno' });
    expect(result.items.map((i) => i.front)).toEqual(['One!', 'Three']);
  });

  it('drops ops that point at items that do not exist', () => {
    const text = JSON.stringify({
      ops: [
        { op: 'remove', ref: 'r9' },
        { op: 'add', item: { front: 'New', back: 'n' } },
      ],
    });
    const result = interpretRefine(text, ctx);
    expect(result.summary).toEqual({ added: 1, updated: 0, removed: 0 });
    expect(result.dropped).toHaveLength(1);
  });

  it('refuses to delete everything', () => {
    const text = JSON.stringify({ ops: [{ op: 'remove', ref: 'r1' }, { op: 'remove', ref: 'r2' }] });
    expect(interpretRefine(text, ctx)).toMatchObject({ kind: 'invalid' });
  });

  it('accepts a whole replacement set and keeps ids for unchanged items', () => {
    const text = JSON.stringify({ items: [{ front: 'One', back: '1' }, { front: 'Four', back: '4' }] });
    const result = interpretRefine(text, ctx);
    expect(result).toMatchObject({ kind: 'ok', replaced: true, summary: { added: 1, removed: 1 } });
    expect(result.items[0].id).toBe('c_1');
  });

  it('treats an empty list of ops as "no changes"', () => {
    expect(interpretRefine('{"ops":[]}', ctx)).toEqual({ kind: 'empty' });
  });
});
