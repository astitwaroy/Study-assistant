import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange) {
  if (typeof matchMedia !== 'function') return () => {};
  const list = matchMedia(QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

const read = () => typeof matchMedia === 'function' && matchMedia(QUERY).matches;

/** True when the person has asked their system for less motion. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, read, () => false);
}
