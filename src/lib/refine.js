import { LIMITS, findItemList, itemKey, makeId, normalizeItem, normalizeItems, readStatus } from './schema.js';

/**
 * Follow-up edits ("add three harder questions on the Calvin cycle").
 *
 * Instead of regenerating the whole set, the model returns a list of ops
 * against the existing items. Unchanged items keep their ids, so progress
 * (which cards you know) survives the edit.
 *
 * Items are sent to the model with short refs ("r1", "r2") instead of our
 * internal ids: short, predictable strings are much less likely to be
 * mangled when the model copies them back.
 */
export function toRefItems(items) {
  const refToId = new Map();
  const refItems = items.map((item, index) => {
    const ref = `r${index + 1}`;
    refToId.set(ref, item.id);
    // eslint-disable-next-line no-unused-vars
    const { id, ...content } = item;
    return { ref, ...content };
  });
  return { refItems, refToId };
}

const VERBS = {
  add: 'add',
  insert: 'add',
  create: 'add',
  append: 'add',
  update: 'update',
  edit: 'update',
  replace: 'update',
  modify: 'update',
  change: 'update',
  remove: 'remove',
  delete: 'remove',
  drop: 'remove',
};

/**
 * Applies the model's ops to the current items.
 *
 * @returns
 *   {kind: 'ok', items, summary: {added, updated, removed}, dropped, replaced?}
 *   {kind: 'insufficient', reason}
 *   {kind: 'empty'}                         the model proposed no changes
 *   {kind: 'invalid', code, reason, dropped?}
 */
export function applyOps(value, { mode, items: current, refToId }) {
  if (Array.isArray(value)) value = { ops: value };
  if (!value || typeof value !== 'object') {
    return { kind: 'invalid', code: 'wrong_shape', reason: 'The response was not a JSON object.' };
  }

  const insufficient = readStatus(value);
  if (insufficient) return insufficient;

  const ops = value.ops ?? value.changes ?? value.edits;
  if (!Array.isArray(ops)) {
    // Some models ignore the ops format and send back a whole new set.
    const list = findItemList(value);
    if (list) return replaceAll(list, { mode, current });
    return { kind: 'invalid', code: 'wrong_shape', reason: 'The response had no list of changes.' };
  }
  if (ops.length === 0) return { kind: 'empty' };

  let next = [...current];
  const dropped = [];
  const summary = { added: 0, updated: 0, removed: 0 };
  const idFor = (op) => refToId.get(String(op.ref ?? op.id ?? '').trim());

  ops.forEach((op, index) => {
    if (!op || typeof op !== 'object') {
      dropped.push({ index, reason: 'A change was not an object.' });
      return;
    }
    const verb = VERBS[String(op.op ?? op.action ?? op.operation ?? '').trim().toLowerCase()];

    if (verb === 'remove') {
      const id = idFor(op);
      if (!id || !next.some((item) => item.id === id)) {
        dropped.push({ index, reason: `A removal pointed at an item that doesn't exist ("${op.ref ?? op.id}").` });
        return;
      }
      next = next.filter((item) => item.id !== id);
      summary.removed += 1;
      return;
    }

    if (verb === 'update') {
      const id = idFor(op);
      if (!id || !next.some((item) => item.id === id)) {
        dropped.push({ index, reason: `An edit pointed at an item that doesn't exist ("${op.ref ?? op.id}").` });
        return;
      }
      const result = normalizeItem(op.item ?? op.value ?? op.new, mode);
      if (!result.ok) {
        dropped.push({ index, reason: result.reason });
        return;
      }
      next = next.map((item) => (item.id === id ? { id, ...result.item } : item));
      summary.updated += 1;
      return;
    }

    if (verb === 'add') {
      const result = normalizeItem(op.item ?? op.value ?? op.new, mode);
      if (!result.ok) {
        dropped.push({ index, reason: result.reason });
        return;
      }
      if (next.some((item) => itemKey(item) === itemKey(result.item))) {
        dropped.push({ index, reason: 'A new item duplicated one already in the set.' });
        return;
      }
      if (next.length >= LIMITS.maxItems) {
        dropped.push({ index, reason: `Recall keeps at most ${LIMITS.maxItems} items per set.` });
        return;
      }
      next.push({ id: makeId(mode === 'quiz' ? 'q' : 'c'), ...result.item });
      summary.added += 1;
      return;
    }

    dropped.push({ index, reason: `Unknown change type "${String(op.op ?? op.action ?? '').slice(0, 20)}".` });
  });

  if (summary.added + summary.updated + summary.removed === 0) {
    return { kind: 'invalid', code: 'wrong_shape', reason: `None of the ${ops.length} suggested changes could be applied.`, dropped };
  }
  if (next.length === 0) {
    return { kind: 'invalid', code: 'wrong_shape', reason: 'That change would remove every item, so it was not applied.' };
  }
  return { kind: 'ok', items: next, summary, dropped };
}

/** Accepts a full replacement set, reusing ids for items that didn't change. */
function replaceAll(list, { mode, current }) {
  const { items, dropped } = normalizeItems(list, mode);
  if (items.length === 0) {
    return { kind: 'invalid', code: 'wrong_shape', reason: `None of the ${list.length} items could be used.`, dropped };
  }
  const oldByKey = new Map(current.map((item) => [itemKey(item), item]));
  const newKeys = new Set(items.map(itemKey));
  const merged = items.map((item) => {
    const old = oldByKey.get(itemKey(item));
    return old ? { ...item, id: old.id } : item;
  });
  return {
    kind: 'ok',
    items: merged,
    summary: {
      added: items.filter((item) => !oldByKey.has(itemKey(item))).length,
      updated: 0,
      removed: current.filter((item) => !newKeys.has(itemKey(item))).length,
    },
    dropped,
    replaced: true,
  };
}
