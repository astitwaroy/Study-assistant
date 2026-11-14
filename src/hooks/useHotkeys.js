import { useEffect, useRef } from 'react';

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const ACTIVATES_ON_SPACE_ENTER = new Set(['BUTTON', 'A', 'SUMMARY']);

/**
 * Window-level keyboard shortcuts.
 *
 * `bindings` maps a key (e.g. ' ', 'ArrowLeft', '1') to a handler. Shortcuts
 * are ignored while typing in a field, and Space/Enter are left alone when a
 * button has focus, so the button's own click doesn't fire twice.
 */
export function useHotkeys(bindings, enabled = true) {
  const latest = useRef(bindings);
  useEffect(() => {
    latest.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    function onKeyDown(event) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (TYPING.has(target?.tagName) || target?.isContentEditable) return;
      if ((event.key === ' ' || event.key === 'Enter') && ACTIVATES_ON_SPACE_ENTER.has(target?.tagName)) return;

      const handler = latest.current[event.key] ?? latest.current[event.key.toLowerCase()];
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
