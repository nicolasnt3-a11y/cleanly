/** Navigation entre écrans (pas de routeur : application à fenêtre unique). */
import { createStore } from './state/createStore';

export type ScreenId = 'home' | 'cleanup' | 'files' | 'speed' | 'apps' | 'protection' | 'settings' | 'feedback' | 'tip';
export type FilesTab = 'map' | 'large' | 'duplicates';

export const navStore = createStore<{ screen: ScreenId; filesTab: FilesTab }>({ screen: 'home', filesTab: 'map' });

export function navigate(screen: ScreenId, opts?: { filesTab?: FilesTab }): void {
  navStore.set((s) => ({ screen, filesTab: opts?.filesTab ?? s.filesTab }));
}
