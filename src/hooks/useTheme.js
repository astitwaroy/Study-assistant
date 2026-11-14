import { useEffect } from 'react';
import { usePersistentState } from './usePersistentState.js';

function systemTheme() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Light/dark theme, remembered per browser. index.html applies it before first paint. */
export function useTheme() {
  const [theme, setTheme] = usePersistentState('recall:theme', systemTheme(), (v) =>
    v === 'dark' || v === 'light' ? v : undefined,
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return [theme, toggle];
}
