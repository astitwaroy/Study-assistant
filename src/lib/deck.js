/**
 * Pure flashcard-deck logic. Which cards you know is stored separately
 * (persisted per set); this state is just where you are in the current pass.
 */

export function newPass(ids, kind = 'all') {
  return { order: ids, index: 0, flipped: false, kind };
}

export function deckReducer(state, action) {
  switch (action.type) {
    case 'flip':
      return state.index < state.order.length ? { ...state, flipped: !state.flipped } : state;
    case 'next':
      return state.index < state.order.length ? { ...state, index: state.index + 1, flipped: false } : state;
    case 'prev':
      return state.index > 0 ? { ...state, index: state.index - 1, flipped: false } : state;
    case 'start':
      return newPass(action.ids, action.kind);
    default:
      return state;
  }
}

export function countStatuses(ids, statuses) {
  let known = 0;
  let learning = 0;
  for (const id of ids) {
    if (statuses[id] === 'known') known += 1;
    else if (statuses[id] === 'learning') learning += 1;
  }
  return { known, learning, unseen: ids.length - known - learning };
}

export function validateStatuses(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const clean = {};
  for (const [id, status] of Object.entries(value)) {
    if (status === 'known' || status === 'learning') clean[id] = status;
  }
  return clean;
}
