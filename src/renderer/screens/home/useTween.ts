/** Interpolation douce d'un nombre vers une cible (compteurs de l'accueil). */
import { useEffect, useRef, useState } from 'react';

export function useTween(target: number, reduced: boolean, durationMs = 520): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    if (reduced) {
      valueRef.current = target;
      setValue(target);
      return;
    }
    const from = valueRef.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / durationMs);
      const e = 1 - Math.pow(1 - k, 3);
      const v = from + (target - from) * e;
      valueRef.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, durationMs]);

  return value;
}
