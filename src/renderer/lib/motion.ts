/** Préférence de mouvement : paramètre de l'app, sinon prefers-reduced-motion du système. */
import { useEffect, useState } from 'react';
import { settingsStore } from '../state/stores';
import { useStore } from '../state/createStore';

const query = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  const { settings } = useStore(settingsStore);
  const [system, setSystem] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setSystem(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const pref = settings?.motion ?? 'system';
  return pref === 'reduced' || (pref === 'system' && system);
}
