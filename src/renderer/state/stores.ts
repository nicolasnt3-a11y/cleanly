/**
 * États partagés entre écrans. Propriété : fondations (ne pas modifier sans coordination).
 *  - appStore      : infos de l'app, lecteurs
 *  - scanStore     : Smart Scan + nettoyage (partagé entre Accueil et Nettoyage)
 *  - settingsStore : paramètres
 *  - verdictStore  : verdicts de l'assistant IA par id d'élément (écrits par AiAssistant, lus par les listes)
 *  - progressStore : dernière progression reçue du main
 */
import type {
  AiVerdict,
  AppInfo,
  CleanCategoryId,
  CleanResult,
  DriveInfo,
  ScanProgress,
  Settings,
  SettingsPatch,
  SmartScanResult,
} from '../../../shared/types';
import { call, errorMessage, onEvent } from '../api';
import { createStore } from './createStore';

/* ── App ── */
export const appStore = createStore<{ info: AppInfo | null; drives: DriveInfo[] }>({ info: null, drives: [] });

export async function loadAppInfo(): Promise<void> {
  const [info, drives] = await Promise.all([call('app:info'), call('disk:drives').catch(() => [] as DriveInfo[])]);
  appStore.set({ info, drives });
}

/* ── Progression ── */
export const progressStore = createStore<{ last: ScanProgress | null }>({ last: null });
onEvent('event:progress', (p) => progressStore.set({ last: p }));

/* ── Smart Scan & nettoyage ── */
export type ScanStatus = 'idle' | 'scanning' | 'done' | 'cleaning' | 'cleaned' | 'error';

export interface ScanState {
  status: ScanStatus;
  result: SmartScanResult | null;
  /** Catégories cochées. */
  selected: Partial<Record<CleanCategoryId, boolean>>;
  /** Ids d'éléments décochés individuellement (ne peuvent que retirer). */
  excluded: Record<string, true>;
  cleanResult: CleanResult | null;
  error: string | null;
}

export const scanStore = createStore<ScanState>({
  status: 'idle',
  result: null,
  selected: {},
  excluded: {},
  cleanResult: null,
  error: null,
});

export async function runSmartScan(): Promise<void> {
  if (scanStore.get().status === 'scanning') return;
  scanStore.set({ status: 'scanning', error: null, cleanResult: null });
  verdictStore.set({ verdicts: {}, summary: null });
  try {
    const result = await call('scan:smart');
    const selected: ScanState['selected'] = {};
    for (const c of result.categories) selected[c.id] = c.defaultSelected && !c.error && c.sizeBytes > 0;
    scanStore.set({ status: 'done', result, selected, excluded: {} });
  } catch (err) {
    // Une annulation volontaire n'est pas une erreur : cancelSmartScan a déjà fixé l'état.
    if (cancelRequested) return;
    scanStore.set((s) => ({ status: s.result ? 'done' : 'error', error: errorMessage(err) }));
  } finally {
    cancelRequested = false;
  }
}

let cancelRequested = false;

export async function cancelSmartScan(): Promise<void> {
  cancelRequested = true;
  await call('scan:cancel');
  scanStore.set((s) => ({ status: s.result ? 'done' : 'idle' }));
}

export function toggleCategory(id: CleanCategoryId, value?: boolean): void {
  scanStore.set((s) => ({ selected: { ...s.selected, [id]: value ?? !s.selected[id] } }));
}

export function toggleExcluded(itemId: string): void {
  scanStore.set((s) => {
    const excluded = { ...s.excluded };
    if (excluded[itemId]) delete excluded[itemId];
    else excluded[itemId] = true;
    return { excluded };
  });
}

/** Total des catégories sélectionnées (moins les éléments exclus individuellement). */
export function selectedBytes(s: ScanState): number {
  if (!s.result) return 0;
  let total = 0;
  for (const c of s.result.categories) {
    if (!s.selected[c.id]) continue;
    total += c.sizeBytes;
    for (const it of c.topItems) if (s.excluded[it.id]) total -= it.sizeBytes;
  }
  return Math.max(0, total);
}

export async function cleanSelected(): Promise<CleanResult | null> {
  const s = scanStore.get();
  if (!s.result || s.status === 'cleaning') return null;
  const categoryIds = s.result.categories.filter((c) => s.selected[c.id]).map((c) => c.id);
  if (categoryIds.length === 0) return null;
  scanStore.set({ status: 'cleaning', error: null });
  try {
    const cleanResult = await call('clean:run', {
      scanId: s.result.scanId,
      categoryIds,
      excludedItemIds: Object.keys(s.excluded),
    });
    scanStore.set({ status: 'cleaned', cleanResult });
    return cleanResult;
  } catch (err) {
    scanStore.set({ status: 'done', error: errorMessage(err) });
    return null;
  }
}

/* ── Paramètres ── */
export const settingsStore = createStore<{ settings: Settings | null }>({ settings: null });

export async function loadSettings(): Promise<void> {
  settingsStore.set({ settings: await call('settings:get') });
}

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  settingsStore.set({ settings: await call('settings:update', patch) });
}

/* ── Verdicts IA ── */
export const verdictStore = createStore<{ verdicts: Record<string, AiVerdict>; summary: string | null }>({
  verdicts: {},
  summary: null,
});

export function setVerdicts(list: AiVerdict[], summary: string | null): void {
  verdictStore.set((s) => {
    const verdicts = { ...s.verdicts };
    for (const v of list) verdicts[v.id] = v;
    return { verdicts, summary };
  });
}
