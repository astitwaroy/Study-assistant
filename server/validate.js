import { AppError } from './errors.js';

export const LIMITS = {
  inputChars: 12_000,
  instructionChars: 300,
  refineItems: 40,
  minCount: 3,
  maxCount: 20,
};

export const SCENARIOS = [
  'none',
  'slow',
  'stall',
  'truncated',
  'malformed',
  'not_json',
  'prose',
  'wrong_shape',
  'empty',
  'insufficient',
  'http_500',
  'rate_limit',
  'midstream_error',
];

function bad(message) {
  return new AppError('bad_request', message, { status: 400 });
}

/**
 * Validates the browser's request body. The browser is not trusted any more
 * than the model is: everything is checked and normalised here.
 */
export function parseGenerateRequest(body, { allowSimulate }) {
  if (!body || typeof body !== 'object') throw bad('Expected a JSON body.');

  const mode = body.mode;
  if (mode !== 'flashcards' && mode !== 'quiz') throw bad('mode must be "flashcards" or "quiz".');

  const input = typeof body.input === 'string' ? body.input.trim() : '';
  if (!input) throw bad('Add some notes or a topic first.');
  if (input.length > LIMITS.inputChars) {
    throw new AppError('input_too_long', `Notes can be up to ${LIMITS.inputChars.toLocaleString('en-US')} characters.`, {
      status: 413,
    });
  }

  const rawCount = Number(body.count ?? 10);
  if (!Number.isInteger(rawCount)) throw bad('count must be a whole number.');
  const count = Math.min(LIMITS.maxCount, Math.max(LIMITS.minCount, rawCount));

  let refine = null;
  if (body.refine != null) {
    const instruction = typeof body.refine.instruction === 'string' ? body.refine.instruction.trim() : '';
    if (!instruction) throw bad('Describe the change you want.');
    if (instruction.length > LIMITS.instructionChars) {
      throw bad(`Keep the change request under ${LIMITS.instructionChars} characters.`);
    }
    const items = Array.isArray(body.refine.items) ? body.refine.items : null;
    if (!items || items.length === 0) throw bad('There are no items to change.');
    if (items.length > LIMITS.refineItems) throw bad(`A set can have at most ${LIMITS.refineItems} items.`);
    refine = { instruction, items };
  }

  let simulate = 'none';
  if (allowSimulate && typeof body.simulate === 'string' && SCENARIOS.includes(body.simulate)) {
    simulate = body.simulate;
  }

  return { mode, input, count, refine, strict: body.strict === true, simulate };
}
