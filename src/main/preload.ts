/**
 * Preload sandboxé (empaqueté en CJS). N'expose QUE l'API typée `window.cleanly`,
 * limitée aux canaux déclarés dans shared/types.ts.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS, type CleanlyApi, type IpcChannel, type IpcEventName } from '../../shared/types';

const channels = new Set<string>(IPC_CHANNELS);
const events = new Set<string>(IPC_EVENTS);

const api: CleanlyApi = {
  invoke(channel: IpcChannel, ...args: unknown[]) {
    if (!channels.has(channel)) return Promise.reject(new Error('Canal IPC inconnu.'));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(event: IpcEventName, listener: (payload: never) => void) {
    if (!events.has(event)) throw new Error('Événement IPC inconnu.');
    const handler = (_e: IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(event, handler);
    return () => {
      ipcRenderer.removeListener(event, handler);
    };
  },
} as CleanlyApi;

contextBridge.exposeInMainWorld('cleanly', Object.freeze(api));
