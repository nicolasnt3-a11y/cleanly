/**
 * Accès à l'API du processus principal. Dans Electron : `window.cleanly` (preload).
 * Dans la démo navigateur : API simulée avec des données fictives réalistes (chargée à la demande).
 */
import type { CleanlyApi, IpcArgs, IpcChannel, IpcEventName, IpcEvents, IpcResult, Unsubscribe } from '../../shared/types';

export const isDemo = typeof window !== 'undefined' && !window.cleanly;

let mockApi: Promise<CleanlyApi> | null = null;
function getApi(): Promise<CleanlyApi> {
  if (window.cleanly) return Promise.resolve(window.cleanly);
  mockApi ??= import('./mock/index').then((m) => m.createMockApi());
  return mockApi;
}

/** Appelle un canal IPC typé. */
export async function call<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  const api = await getApi();
  return api.invoke(channel, ...args);
}

/** S'abonne à un événement poussé par le main. */
export function onEvent<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): Unsubscribe {
  let cancelled = false;
  let unsub: Unsubscribe | null = null;
  void getApi().then((api) => {
    if (!cancelled) unsub = api.on(event, listener);
  });
  return () => {
    cancelled = true;
    unsub?.();
  };
}

/** Message d'erreur lisible depuis une exception IPC (« Error invoking remote method … : Error: msg »). */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
