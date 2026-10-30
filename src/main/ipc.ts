/**
 * Couche IPC : enregistre chaque canal du contrat, rejette tout appel venant d'un cadre
 * qui n'est pas notre propre index.html, et valide chaque argument à l'exécution.
 */
import { app, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import os from 'node:os';
import type {
  AiProvider,
  AiReviewItem,
  AppInfo,
  CleanCategoryId,
  FeedbackRequest,
  IpcArgs,
  IpcChannel,
  IpcEventName,
  IpcEvents,
  IpcResult,
  MotionPreference,
  Platform,
  ScanProgress,
  SettingsPatch,
  SmartScanResult,
  SpaceRoot,
} from '../../shared/types';
import { IPC_CHANNELS } from '../../shared/types';
import { OPAQUE_ID, type ServiceContext } from './services/context';
import * as scan from './services/scan/index';
import * as system from './services/system/index';
import * as settings from './services/settings/index';
import * as ai from './services/ai/index';

/* ───────────────────────── Validation des arguments ───────────────────────── */

class InvalidArg extends Error {}

function fail(what: string): never {
  throw new InvalidArg('Argument invalide : ' + what);
}
function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(what);
  return v as Record<string, unknown>;
}
function str(v: unknown, what: string, max = 4096): string {
  if (typeof v !== 'string' || v.length > max || v.includes('\0')) fail(what);
  return v;
}
function id(v: unknown, what: string): string {
  const s = str(v, what, 256);
  if (!OPAQUE_ID.test(s)) fail(what);
  return s;
}
function ids(v: unknown, what: string, max = 100_000): string[] {
  if (!Array.isArray(v) || v.length > max) fail(what);
  return v.map((x, i) => id(x, `${what}[${i}]`));
}
function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') fail(what);
  return v;
}
function int(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(what);
  return v;
}
function optional<T>(v: unknown, f: (x: unknown) => T): T | undefined {
  return v === undefined ? undefined : f(v);
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail(what);
  return v as T;
}

const CATEGORY_IDS: readonly CleanCategoryId[] = [
  'win-user-temp', 'win-system-temp', 'browser-cache', 'app-cache', 'crash-dumps', 'win-update', 'dev-cache',
  'recycle-bin', 'old-downloads', 'mac-user-caches', 'mac-logs', 'xcode-derived-data', 'mac-trash',
];
const PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai'];
const AI_CONTEXTS = [...CATEGORY_IDS, 'large-file', 'duplicate', 'space-map'] as const;

function spaceRoot(v: unknown): SpaceRoot {
  const o = obj(v, 'root');
  if (o.kind === 'home') return { kind: 'home' };
  if (o.kind === 'drive') return { kind: 'drive', driveId: str(o.driveId, 'driveId', 260) };
  return fail('root.kind');
}

function settingsPatch(v: unknown): SettingsPatch {
  const o = obj(v, 'patch');
  const p: SettingsPatch = {};
  if ('aiProvider' in o) p.aiProvider = o.aiProvider === null ? null : oneOf(o.aiProvider, PROVIDERS, 'aiProvider');
  if ('aiModel' in o) {
    const m = obj(o.aiModel, 'aiModel');
    const model = (x: unknown) => (x === null ? null : str(x, 'aiModel', 100));
    p.aiModel = { anthropic: model(m.anthropic), openai: model(m.openai) };
  }
  if ('motion' in o) p.motion = oneOf<MotionPreference>(o.motion, ['system', 'reduced', 'full'], 'motion');
  if ('oldDownloadsDays' in o) p.oldDownloadsDays = int(o.oldDownloadsDays, 'oldDownloadsDays', 30, 3650);
  if ('largeFileMinMb' in o) p.largeFileMinMb = int(o.largeFileMinMb, 'largeFileMinMb', 10, 100_000);
  if ('confirmBeforeClean' in o) p.confirmBeforeClean = bool(o.confirmBeforeClean, 'confirmBeforeClean');
  return p;
}

function aiItems(v: unknown): AiReviewItem[] {
  if (!Array.isArray(v) || v.length > 500) fail('items');
  return v.map((x, i) => {
    const o = obj(x, `items[${i}]`);
    return {
      id: id(o.id, 'item.id'),
      path: str(o.path, 'item.path', 1024),
      name: str(o.name, 'item.name', 512),
      sizeBytes: int(o.sizeBytes, 'item.sizeBytes', 0, Number.MAX_SAFE_INTEGER),
      modifiedAt: optional(o.modifiedAt, (t) => int(t, 'item.modifiedAt', 0, Number.MAX_SAFE_INTEGER)),
      context: oneOf(o.context, AI_CONTEXTS, 'item.context'),
    };
  });
}

/* ───────────────────────────── Enregistrement ───────────────────────────── */

export interface IpcOptions {
  window: BrowserWindow;
  /** URL exacte de notre index.html (fichier en production, serveur Vite en développement). */
  trustedUrl: string;
}

export function registerIpc({ window, trustedUrl }: IpcOptions): void {
  const trusted = new URL(trustedUrl);

  /** N'accepte que le cadre principal de NOTRE fenêtre, chargé sur NOTRE index.html. */
  function isTrustedSender(e: IpcMainInvokeEvent): boolean {
    const frame = e.senderFrame;
    if (!frame || window.isDestroyed()) return false;
    if (e.sender !== window.webContents) return false;
    if (frame !== window.webContents.mainFrame || frame.parent !== null) return false;
    let url: URL;
    try {
      url = new URL(frame.url);
    } catch {
      return false;
    }
    if (trusted.protocol === 'file:') {
      return url.protocol === 'file:' && url.pathname === trusted.pathname && url.host === trusted.host;
    }
    return url.origin === trusted.origin;
  }

  function emit<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
    if (!window.isDestroyed()) window.webContents.send(event, payload);
  }

  // Une seule tâche longue annulable à la fois par famille.
  let current: AbortController | null = null;
  function newContext(): ServiceContext {
    current?.abort();
    current = new AbortController();
    let last = 0;
    return {
      signal: current.signal,
      progress: (p: ScanProgress) => {
        const now = Date.now();
        if (now - last < 80 && p.fraction !== 1) return;
        last = now;
        emit('event:progress', p);
      },
      settings: () => settings.getSettings(),
    };
  }

  const registered = new Set<IpcChannel>();
  function handle<C extends IpcChannel>(
    channel: C,
    handler: (...args: unknown[]) => Promise<IpcResult<C>> | IpcResult<C>,
  ): void {
    registered.add(channel);
    ipcMain.removeHandler(channel); // la fenêtre peut être recréée (macOS « activate »)
    ipcMain.handle(channel, async (e, ...args: unknown[]) => {
      if (!isTrustedSender(e)) throw new Error('Appel IPC refusé : expéditeur non autorisé.');
      try {
        return await handler(...args);
      } catch (err) {
        if (err instanceof InvalidArg) throw err;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ipc] ${channel}:`, err);
        throw new Error(message);
      }
    });
  }

  let cachedInfo: AppInfo | null = null;
  async function appInfo(): Promise<AppInfo> {
    cachedInfo ??= {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform as Platform,
      arch: process.arch,
      osLabel: await system.osLabel().catch(() => `${os.type()} ${os.release()}`),
      isDemo: false,
      isPackaged: app.isPackaged,
    };
    return cachedInfo;
  }

  handle('app:info', () => appInfo());

  handle('app:open-external', async (rawUrl) => {
    let url: URL;
    try {
      url = new URL(str(rawUrl, 'url', 2048));
    } catch {
      return { ok: false, error: 'URL invalide.' };
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      return { ok: false, error: 'Seules les adresses HTTPS sont autorisées.' };
    }
    await shell.openExternal(url.href);
    return { ok: true, value: null };
  });

  handle('app:reveal-item', (scanId, itemId) => {
    const p = scan.resolveScanItemPath(id(scanId, 'scanId'), id(itemId, 'itemId'));
    if (!p) return { ok: false, error: 'Élément introuvable.' };
    shell.showItemInFolder(p);
    return { ok: true, value: null };
  });

  handle('disk:drives', () => scan.listDrives());

  handle('scan:smart', async (): Promise<SmartScanResult> => {
    const ctx = newContext();
    const started = Date.now();
    ctx.progress({ task: 'smart-scan', phase: 'cleanup', fraction: 0, bytesFound: 0, itemsVisited: 0 });
    const [cleanup, startup, apps, protection] = await Promise.all([
      scan.scanCleanupCategories(ctx),
      system.listStartupItems().catch(() => []),
      system.listInstalledApps().catch(() => []),
      system.protectionReport().catch(() => null),
    ]);
    if (ctx.signal.aborted) throw new Error('Analyse annulée.');
    const reclaimableBytes = cleanup.categories
      .filter((c) => c.defaultSelected && !c.error)
      .reduce((a, c) => a + c.sizeBytes, 0);
    ctx.progress({ task: 'smart-scan', phase: 'disk', fraction: 0.95, bytesFound: reclaimableBytes, itemsVisited: 0 });
    const disk = await scan.diskBreakdown(reclaimableBytes);
    const halfYearAgo = Date.now() - 180 * 24 * 3600 * 1000;
    const result: SmartScanResult = {
      scanId: cleanup.scanId,
      scannedAt: Date.now(),
      durationMs: Date.now() - started,
      categories: cleanup.categories,
      reclaimableBytes,
      disk,
      startup: {
        enabledCount: startup.filter((s) => s.enabled).length,
        highImpactCount: startup.filter((s) => s.enabled && s.impact === 'high').length,
      },
      apps: {
        installedCount: apps.length,
        totalBytes: apps.reduce((a, x) => a + (x.sizeBytes ?? 0), 0),
        unusedCount: apps.filter((x) => x.lastUsedAt !== undefined && x.lastUsedAt < halfYearAgo).length,
      },
      protection: {
        score: protection?.score ?? 0,
        issues: protection?.checks.filter((c) => c.status === 'warn' || c.status === 'bad').length ?? 0,
      },
    };
    ctx.progress({ task: 'smart-scan', phase: 'done', fraction: 1, bytesFound: reclaimableBytes, itemsVisited: 0 });
    return result;
  });

  handle('scan:cancel', () => {
    current?.abort();
    current = null;
    return null;
  });

  handle('clean:run', (raw) => {
    const o = obj(raw, 'request');
    const categoryIds = (Array.isArray(o.categoryIds) ? o.categoryIds : fail('categoryIds')).map((c) =>
      oneOf(c, CATEGORY_IDS, 'categoryId'),
    );
    return scan.runClean(
      {
        scanId: id(o.scanId, 'scanId'),
        categoryIds: [...new Set(categoryIds)],
        excludedItemIds: optional(o.excludedItemIds, (x) => ids(x, 'excludedItemIds')),
      },
      newContext(),
    );
  });

  handle('space:level', (root, nodeId) =>
    scan.spaceLevel(spaceRoot(root), nodeId === null ? null : id(nodeId, 'nodeId'), newContext()),
  );

  handle('files:large', (raw) => {
    const o = obj(raw, 'request');
    return scan.findLargeFiles(
      {
        root: spaceRoot(o.root),
        minBytes: optional(o.minBytes, (x) => int(x, 'minBytes', 1024 * 1024, Number.MAX_SAFE_INTEGER)),
        limit: optional(o.limit, (x) => int(x, 'limit', 1, 5000)),
      },
      newContext(),
    );
  });

  handle('files:duplicates', (raw) => {
    const o = obj(raw, 'request');
    return scan.findDuplicates(
      {
        root: spaceRoot(o.root),
        minBytes: optional(o.minBytes, (x) => int(x, 'minBytes', 1, Number.MAX_SAFE_INTEGER)),
      },
      newContext(),
    );
  });

  handle('files:trash', (raw) => {
    const o = obj(raw, 'request');
    return scan.trashItems({ scanId: id(o.scanId, 'scanId'), itemIds: ids(o.itemIds, 'itemIds', 10_000) });
  });

  handle('startup:list', () => system.listStartupItems());
  handle('startup:toggle', (raw) => {
    const o = obj(raw, 'request');
    return system.toggleStartupItem({ id: id(o.id, 'id'), enabled: bool(o.enabled, 'enabled') });
  });

  handle('apps:list', () => system.listInstalledApps());
  handle('apps:uninstall', (appId) => system.uninstallApp(id(appId, 'appId')));

  handle('protection:report', () => system.protectionReport());

  handle('ai:review', (raw) => ai.reviewItems({ items: aiItems(obj(raw, 'request').items) }));
  handle('ai:test-key', (provider) => ai.testApiKey(oneOf(provider, PROVIDERS, 'provider')));

  handle('settings:get', () => settings.getSettings());
  handle('settings:update', (patch) => settings.updateSettings(settingsPatch(patch)));
  handle('settings:set-api-key', (raw) => {
    const o = obj(raw, 'request');
    return settings.setApiKey({
      provider: oneOf(o.provider, PROVIDERS, 'provider'),
      apiKey: o.apiKey === null ? null : str(o.apiKey, 'apiKey', 512).trim(),
    });
  });

  handle('feedback:send', async (raw) => {
    const o = obj(raw, 'request');
    const req: FeedbackRequest = {
      kind: oneOf(o.kind, ['bug', 'idea', 'praise', 'other'], 'kind'),
      message: str(o.message, 'message', 5000),
      email: optional(o.email, (x) => str(x, 'email', 254)),
      includeDiagnostics: bool(o.includeDiagnostics, 'includeDiagnostics'),
    };
    return settings.sendFeedback(req, await appInfo());
  });
  handle('tip:options', () => settings.tipOptions());

  // Garde-fou : tout canal du contrat doit avoir un gestionnaire.
  const missing = IPC_CHANNELS.filter((c) => !registered.has(c));
  if (missing.length) throw new Error('Canaux IPC sans gestionnaire : ' + missing.join(', '));
}

/** Utilitaire de typage pour les tests éventuels. */
export type HandlerArgs<C extends IpcChannel> = IpcArgs<C>;
