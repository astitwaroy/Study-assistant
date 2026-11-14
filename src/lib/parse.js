/**
 * Getting JSON out of model text.
 *
 * Models wrap JSON in prose or code fences, leave trailing commas, and get
 * cut off mid-answer. These helpers recover what can be recovered *without
 * guessing at content*: they never invent closing quotes or brackets, because
 * a half-finished answer ("The Calvin cycle happens in the") would then look
 * like a complete one.
 */

/** Where the first JSON value starts, ignoring any prose before it. */
function firstStart(text) {
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((i) => i !== -1);
  return starts.length ? Math.min(...starts) : -1;
}

/**
 * Index of the bracket that closes the value opening at `start`, or -1 if the
 * text ends first (the answer was truncated). String-aware, so brackets
 * inside strings don't count.
 */
export function findValueEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Light, string-aware repairs for mistakes that don't change meaning:
 * trailing commas and // or /* *\/ comments. Anything else is left alone.
 */
export function repairJson(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 1;
    } else if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== '}' && text[j] !== ']') out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Parses the JSON document in `text`, skipping prose or code fences around it.
 *
 * @returns {{ok: true, value: any, repaired: boolean} | {ok: false, reason: 'empty'|'no_json'|'truncated'|'syntax', detail?: string}}
 */
export function parseModelJson(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty' };

  const cleaned = text.replace(/^\uFEFF/, '');
  const first = firstStart(cleaned);
  if (first === -1) return { ok: false, reason: 'no_json' };

  // Usually the document is the first value in the text.
  const direct = parseValueAt(cleaned, first);
  if (direct.ok && looksLikeDocument(direct.value)) return direct;
  // Everything after an unclosed value is inside it, so there is nothing else to try.
  if (!direct.ok && direct.reason === 'truncated') return direct;

  // Otherwise prose got in the way, e.g. "Here are [10] cards: {...}" or
  // "{oops} {...}". Look for a later object, then a later array.
  return scanFor(cleaned, '{') ?? scanFor(cleaned, '[') ?? direct;
}

function looksLikeDocument(value) {
  if (Array.isArray(value)) return value.some((v) => v && typeof v === 'object');
  return value !== null && typeof value === 'object';
}

function parseValueAt(text, start) {
  const end = findValueEnd(text, start);
  if (end === -1) return { ok: false, reason: 'truncated', end };
  const candidate = text.slice(start, end + 1);
  try {
    return { ok: true, value: JSON.parse(candidate), repaired: false, end };
  } catch (err) {
    try {
      return { ok: true, value: JSON.parse(repairJson(candidate)), repaired: true, end };
    } catch {
      return { ok: false, reason: 'syntax', detail: err.message, end };
    }
  }
}

function scanFor(text, open) {
  let from = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const start = text.indexOf(open, from);
    if (start === -1) return null;
    const result = parseValueAt(text, start);
    if (result.ok && looksLikeDocument(result.value)) return result;
    if (result.end === -1) return null;
    from = result.end + 1; // skip this value; its insides aren't the document
  }
  return null;
}

/** Keys a model might use for the list of items (or edit ops). */
export const ITEM_LIST_KEYS = ['items', 'ops', 'cards', 'flashcards', 'questions', 'quiz'];

/**
 * Pulls every *complete* element out of the item list in a possibly
 * incomplete JSON document. Used while streaming (to show items as they
 * arrive) and to salvage items from an answer that was cut off or broken
 * later on.
 *
 * Handles `{"items": [ {...}, {...}, {...` (item list in the root object)
 * and `[ {...}, {...` (a bare array at the root).
 *
 * @returns {unknown[]} parsed elements; elements that don't parse are skipped
 */
export function extractCompleteElements(text, listKeys = ITEM_LIST_KEYS) {
  if (typeof text !== 'string') return [];
  const begin = firstStart(text);
  if (begin === -1) return [];

  const elements = [];
  const stack = []; // open containers: '{' or '['
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let lastString = null; // most recent string directly inside the root object
  let currentKey = null; // root-level key whose value we're reading
  let listDepth = -1; // stack depth inside the item list, or -1
  let elementStart = -1;

  for (let i = begin; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') {
        inString = false;
        if (stack.length === 1 && stack[0] === '{') lastString = text.slice(stringStart + 1, i);
      }
      continue;
    }

    switch (ch) {
      case '"':
        inString = true;
        stringStart = i;
        break;
      case ':':
        if (stack.length === 1) currentKey = lastString;
        break;
      case ',':
        if (stack.length === 1) currentKey = null;
        break;
      case '[':
      case '{': {
        const opensList =
          ch === '[' &&
          listDepth === -1 &&
          (stack.length === 0 || (stack.length === 1 && stack[0] === '{' && listKeys.includes(currentKey)));
        stack.push(ch);
        if (opensList) listDepth = stack.length;
        else if (stack.length === listDepth + 1 && elementStart === -1) elementStart = i;
        break;
      }
      case ']':
      case '}':
        stack.pop();
        if (listDepth !== -1 && stack.length === listDepth && elementStart !== -1) {
          const parsed = tryParse(text.slice(elementStart, i + 1));
          if (parsed !== undefined) elements.push(parsed);
          elementStart = -1;
        } else if (listDepth !== -1 && stack.length < listDepth) {
          if (elements.length) return elements; // the list closed; we're done
          listDepth = -1; // an empty or junk list, e.g. "[1]" in prose; keep looking
        }
        break;
      default:
    }
  }
  return elements;
}

function tryParse(snippet) {
  try {
    return JSON.parse(snippet);
  } catch {
    try {
      return JSON.parse(repairJson(snippet));
    } catch {
      return undefined;
    }
  }
}

/** The root-level "title" string, as soon as it has fully arrived. */
export function extractTitle(text) {
  const match = typeof text === 'string' && text.match(/"(?:title|topic)"\s*:\s*("(?:[^"\\]|\\.)*")/);
  if (!match) return null;
  try {
    const title = JSON.parse(match[1]).trim();
    return title || null;
  } catch {
    return null;
  }
}
