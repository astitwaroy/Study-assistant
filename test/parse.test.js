import { describe, expect, it } from 'vitest';
import { extractCompleteElements, extractTitle, findValueEnd, parseModelJson, repairJson } from '../src/lib/parse.js';

describe('parseModelJson', () => {
  it('parses clean JSON', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 }, repaired: false, end: 6 });
  });

  it('ignores prose and code fences around the JSON', () => {
    const text = 'Sure! Here you go:\n```json\n{"title":"T","items":[]}\n```\nGood luck!';
    const result = parseModelJson(text);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ title: 'T', items: [] });
  });

  it('is not fooled by brackets inside strings', () => {
    const result = parseModelJson('{"front":"What does } mean?","back":"a brace {"}');
    expect(result.ok).toBe(true);
    expect(result.value.front).toBe('What does } mean?');
  });

  it('skips a junk value in prose before the real document', () => {
    const result = parseModelJson('Here are [10] cards {oops} {"items":[{"front":"a","back":"b"}]}');
    expect(result.ok).toBe(true);
    expect(result.value.items).toHaveLength(1);
  });

  it('accepts a bare array of items', () => {
    const result = parseModelJson('[{"front":"a","back":"b"},{"front":"c","back":"d"}]');
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(2);
  });

  it('repairs trailing commas and comments', () => {
    const result = parseModelJson('{"items": [1, 2,], // two\n "t": "x", }');
    expect(result).toMatchObject({ ok: true, repaired: true, value: { items: [1, 2], t: 'x' } });
  });

  it('reports truncation instead of guessing the rest', () => {
    expect(parseModelJson('{"items":[{"front":"The Calvin cycle happens in the')).toMatchObject({
      ok: false,
      reason: 'truncated',
    });
  });

  it('reports unfixable syntax errors', () => {
    expect(parseModelJson("{'front': 'single quotes'}")).toMatchObject({ ok: false, reason: 'syntax' });
  });

  it('reports plain text and empty input', () => {
    expect(parseModelJson('I cannot do that.')).toEqual({ ok: false, reason: 'no_json' });
    expect(parseModelJson('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parseModelJson(undefined)).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('repairJson', () => {
  it('leaves commas and slashes inside strings alone', () => {
    const json = '{"a": "x, ]", "url": "http://example.com"}';
    expect(repairJson(json)).toBe(json);
  });
});

describe('findValueEnd', () => {
  it('handles escaped quotes', () => {
    const text = '{"a":"say \\"hi\\" }"} trailing';
    expect(text[findValueEnd(text, 0)]).toBe('}');
    expect(findValueEnd(text, 0)).toBe(text.indexOf('} trailing'));
  });
});

describe('extractCompleteElements', () => {
  const full = '{"status":"ok","title":"Cells","items":[{"front":"a","back":"b"},{"front":"c [x]","back":"d"},{"front":"e","ba';

  it('returns only the items that have fully arrived', () => {
    expect(extractCompleteElements(full)).toEqual([
      { front: 'a', back: 'b' },
      { front: 'c [x]', back: 'd' },
    ]);
  });

  it('grows as more text streams in', () => {
    const counts = [];
    for (let i = 0; i <= full.length; i += 7) counts.push(extractCompleteElements(full.slice(0, i)).length);
    expect(counts[0]).toBe(0);
    expect(counts.at(-1)).toBe(2);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts); // never goes backwards
  });

  it('ignores arrays that are not the item list', () => {
    const text = '{"tags":[{"x":1}],"items":[{"front":"a","back":"b","options":[{"y":2}]}]}';
    expect(extractCompleteElements(text)).toEqual([{ front: 'a', back: 'b', options: [{ y: 2 }] }]);
  });

  it('works with alias keys and bare arrays', () => {
    expect(extractCompleteElements('{"cards":[{"q":1},{"q":2}')).toHaveLength(2);
    expect(extractCompleteElements('[{"q":1},{"q":')).toEqual([{ q: 1 }]);
  });

  it('skips elements that do not parse', () => {
    const text = '{"items":[{"front":"a","back":"b"},{\'bad\': 1},{"front":"c","back":"d"}]}';
    expect(extractCompleteElements(text)).toHaveLength(2);
  });

  it('ignores prose before the JSON, including quotes', () => {
    expect(extractCompleteElements('Here\'s your "quiz": {"items":[{"a":1}]}')).toEqual([{ a: 1 }]);
  });
});

describe('extractTitle', () => {
  it('reads the title once it is complete', () => {
    expect(extractTitle('{"title":"Cell bio')).toBeNull();
    expect(extractTitle('{"title":"Cell \\"bio\\"","items":[')).toBe('Cell "bio"');
  });
});
