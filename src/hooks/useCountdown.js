import { useEffect, useState } from 'react';

/** Seconds left until `seconds` from mount have passed; 0 when done. */
export function useCountdown(seconds) {
  const [deadline] = useState(() => (seconds ? Date.now() + seconds * 1000 : 0));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadline) return undefined;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [deadline]);

  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}
