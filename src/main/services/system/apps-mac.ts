/** Applications installées sous macOS (/Applications et ~/Applications) et mise à la corbeille. */
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { InstalledApp, UninstallResult } from '../../../../shared/types';
import { run } from '../../util/exec';
import { trashPath } from '../../safety/index';
import { iconFor } from './icons';
import { dirSize, mapLimit, opaqueId } from './util';

function roots(): string[] {
  return ['/Applications', path.join(os.homedir(), 'Applications')];
}

interface RawBundle {
  id: string;
  path: string;
}

/** Bundles .app de premier niveau (pas de liens symboliques). */
async function readBundles(): Promise<RawBundle[]> {
  const out: RawBundle[] = [];
  for (const root of roots()) {
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink() || !e.name.endsWith('.app')) continue;
      const p = path.join(root, e.name);
      out.push({ id: opaqueId('app', p), path: p });
    }
  }
  return out;
}

/** Bundle .app contenant l'exécutable courant (Cleanly lui-même). */
function selfBundle(): string | undefined {
  const i = process.execPath.indexOf('.app/');
  return i > 0 ? process.execPath.slice(0, i + 4) : undefined;
}

async function plist(bundle: string): Promise<Record<string, unknown>> {
  const r = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')], { timeoutMs: 5_000 });
  try {
    const v = JSON.parse(r.stdout) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Dates de dernière utilisation via un seul appel mdls (valeurs séparées par NUL avec -raw). */
async function lastUsed(paths: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!paths.length) return out;
  const r = await run('/usr/bin/mdls', ['-name', 'kMDItemLastUsedDate', '-raw', ...paths], { timeoutMs: 15_000 });
  const vals = r.stdout.split('\0');
  paths.forEach((p, i) => {
    const v = vals[i]?.trim();
    if (!v || v === '(null)') return;
    const t = Date.parse(v.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})$/, '$1T$2$3'));
    if (Number.isFinite(t)) out.set(p, t);
  });
  return out;
}

export async function listInstalledAppsMac(): Promise<InstalledApp[]> {
  const bundles = await readBundles();
  const self = selfBundle();
  const used = await lastUsed(bundles.map((b) => b.path));
  const sizeDeadline = Date.now() + 10_000;
  const apps = await mapLimit(bundles, 4, async (b): Promise<InstalledApp> => {
    const info = await plist(b.path);
    const name =
      (typeof info.CFBundleDisplayName === 'string' && info.CFBundleDisplayName) ||
      (typeof info.CFBundleName === 'string' && info.CFBundleName) ||
      path.basename(b.path, '.app');
    const isSelf = b.path === self || name.toLowerCase() === app.getName().toLowerCase();
    const a: InstalledApp = { id: b.id, name, location: b.path, canUninstall: !isSelf, isSelf };
    if (typeof info.CFBundleShortVersionString === 'string') a.version = info.CFBundleShortVersionString;
    const lu = used.get(b.path);
    if (lu) a.lastUsedAt = lu;
    try {
      a.installedAt = (await fsp.lstat(b.path)).birthtimeMs || undefined;
    } catch {
      /* ignoré */
    }
    if (Date.now() < sizeDeadline) {
      const size = await dirSize(b.path, Math.min(sizeDeadline, Date.now() + 2_000));
      if (size) a.sizeBytes = size;
    }
    const icon = await iconFor(b.path);
    if (icon) a.iconDataUrl = icon;
    return a;
  });
  return apps.sort((x, y) => x.name.localeCompare(y.name, 'fr'));
}

export async function uninstallAppMac(appId: string): Promise<UninstallResult> {
  const b = (await readBundles()).find((x) => x.id === appId);
  if (!b) return { started: false, removed: true, message: "Cette application n'apparaît plus dans la liste." };
  const parent = path.dirname(b.path);
  if (!roots().includes(parent) || b.path.startsWith('/System/')) {
    return { started: false, removed: false, message: 'Emplacement non pris en charge.' };
  }
  const self = selfBundle();
  if (b.path === self) return { started: false, removed: false, message: 'Cleanly ne peut pas se supprimer lui-même.' };
  try {
    const st = await fsp.lstat(b.path);
    if (st.isSymbolicLink() || !st.isDirectory()) return { started: false, removed: false, message: 'Bundle invalide.' };
  } catch {
    return { started: false, removed: true, message: "L'application n'existe plus." };
  }
  const r = await trashPath(b.path, roots());
  let exists = true;
  try {
    await fsp.lstat(b.path);
  } catch {
    exists = false;
  }
  if (!exists) return { started: true, removed: true, message: `${path.basename(b.path, '.app')} a été placé dans la Corbeille.` };
  return { started: r.ok, removed: false, message: r.ok ? "L'application est toujours présente." : `Échec : ${r.reason}` };
}
