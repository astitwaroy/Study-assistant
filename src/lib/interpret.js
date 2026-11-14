import { extractCompleteElements, extractTitle, parseModelJson } from './parse.js';
import { applyOps } from './refine.js';
import { normalizeItem, normalizeItems, normalizeSet } from './schema.js';

/**
 * The full pipeline from raw model text to something the UI can render:
 *
 *   raw text ──parseModelJson──▶ value ──normalizeSet──▶ {kind: ok | insufficient | empty | invalid}
 *       │                                                     ▲
 *       └──(parse failed or shape unusable)──salvage──────────┘
 *
 * "Salvage" pulls the complete items out of a broken or cut-off answer, so a
 * response that dies at item 8 of 10 still gives you 7 good cards and a note
 * saying what happened.
 */
export function interpretSet(text, { mode, finishReason } = {}) {
  const parsed = parseModelJson(text);
  let invalid = null;

  if (parsed.ok) {
    const result = normalizeSet(parsed.value, mode);
    if (result.kind === 'ok') {
      return { ...result, warnings: finishReason === 'length' ? ['truncated'] : [] };
    }
    if (result.kind !== 'invalid') return result;
    invalid = result;
  }

  const salvaged = salvageSet(text, mode);
  if (salvaged) {
    const cutOff = (!parsed.ok && parsed.reason === 'truncated') || finishReason === 'length';
    return { ...salvaged, warnings: [cutOff ? 'truncated' : 'salvaged'] };
  }

  if (invalid) return invalid;
  return {
    kind: 'invalid',
    code: parsed.reason === 'truncated' ? 'truncated' : 'malformed',
    reason: PARSE_FAILURES[parsed.reason] ?? PARSE_FAILURES.syntax,
  };
}

const PARSE_FAILURES = {
  empty: 'The model sent back an empty response.',
  no_json: 'The model replied in plain text instead of JSON.',
  truncated: 'The response stopped before the JSON was complete.',
  syntax: 'The response contained broken JSON.',
};

/** The complete, valid items in `text`, or null if there are none. */
export function salvageSet(text, mode) {
  const elements = extractCompleteElements(text);
  if (elements.length === 0) return null;
  const { items, dropped } = normalizeItems(elements, mode);
  if (items.length === 0) return null;
  return { kind: 'ok', title: extractTitle(text) ?? 'Untitled set', items, dropped };
}

/** What to show while the answer is still streaming in. */
export function previewSet(text, mode) {
  const items = [];
  for (const element of extractCompleteElements(text)) {
    const result = normalizeItem(element, mode);
    if (result.ok) items.push(result.item);
  }
  return { title: extractTitle(text), items };
}

/** Same pipeline for follow-up edits. */
export function interpretRefine(text, { mode, items, refToId, finishReason } = {}) {
  const parsed = parseModelJson(text);
  let invalid = null;

  if (parsed.ok) {
    const result = applyOps(parsed.value, { mode, items, refToId });
    if (result.kind === 'ok') return { ...result, warnings: finishReason === 'length' ? ['truncated'] : [] };
    if (result.kind !== 'invalid') return result;
    invalid = result;
  }

  const ops = extractCompleteElements(text, ['ops', 'changes', 'edits']);
  if (ops.length > 0) {
    const result = applyOps({ ops }, { mode, items, refToId });
    if (result.kind === 'ok') return { ...result, warnings: ['salvaged'] };
  }

  if (invalid) return invalid;
  return {
    kind: 'invalid',
    code: parsed.reason === 'truncated' ? 'truncated' : 'malformed',
    reason: PARSE_FAILURES[parsed.reason] ?? PARSE_FAILURES.syntax,
  };
}

export function previewRefine(text) {
  return { changes: extractCompleteElements(text, ['ops', 'changes', 'edits']).length };
}
