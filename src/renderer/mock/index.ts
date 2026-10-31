/**
 * API simulée pour la démo navigateur. Assemble les gestionnaires de chaque domaine.
 * Propriété : fondations. Les fichiers de domaine (scan.ts, system.ts, ai.ts) appartiennent
 * à leurs agents respectifs.
 */
import type { AppInfo, CleanlyApi, IpcArgs, IpcChannel, IpcEventName, IpcEvents, IpcResult } from '../../../shared/types';
import { createScanMocks } from './scan';
import { createSystemMocks } from './system';
import { createAiMocks } from './ai';
import { delay } from './util';

export type MockHandlers = { [C in IpcChannel]?: (...args: IpcArgs<C>) => Promise<IpcResult<C>> };

export interface MockContext {
  emit<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void;
}

const info: AppInfo = {
  name: 'Cleanly',
  version: '0.2.0',
  platform: 'win32',
  arch: 'x64',
  osLabel: 'Windows 11 Pro 24H2',
  isDemo: true,
  isPackaged: false,
};

export function createMockApi(): CleanlyApi {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const ctx: MockContext = {
    emit(event, payload) {
      listeners.get(event)?.forEach((l) => l(payload));
    },
  };

  const app: MockHandlers = {
    'app:info': async () => info,
    'app:open-external': async (url) => {
      try {
        if (new URL(url).protocol !== 'https:') return { ok: false, error: 'Seules les adresses HTTPS sont autorisées.' };
      } catch {
        return { ok: false, error: 'URL invalide.' };
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      return { ok: true, value: null };
    },
    'app:reveal-item': async () => {
      await delay(100);
      return { ok: true, value: null };
    },
  };

  const handlers: MockHandlers = {
    ...app,
    ...createScanMocks(ctx),
    ...createSystemMocks(ctx),
    ...createAiMocks(ctx),
  };

  return {
    invoke(channel, ...args) {
      const h = handlers[channel] as ((...a: unknown[]) => Promise<unknown>) | undefined;
      if (!h) return Promise.reject(new Error(`Démo : canal ${channel} non simulé.`));
      return h(...args) as never;
    },
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      const l = listener as (p: unknown) => void;
      set.add(l);
      return () => {
        set.delete(l);
      };
    },
  };
}
