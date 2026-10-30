/**
 * Applications installées sous Windows (clés Uninstall des trois emplacements) et
 * désinstallation via le désinstallateur de l'éditeur (jamais QuietUninstallString).
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { InstalledApp, UninstallResult } from '../../../../shared/types';
import { psQuote, runPowerShell } from '../../util/exec';
import { isIconSafePath, unsafePathSyntax } from '../../safety/index';
import { iconFor } from './icons';
import { dword, regQuery, valueOf, type RegKey } from './registry';
import { dirSize, hasControlChars, isDriveAbsolute, mapLimit, opaqueId, resolveBareSystemExe, splitCommandLine } from './util';

const UNINSTALL_SUBKEY = 'Microsoft\\Windows\\CurrentVersion\\Uninstall';
const SOURCES = [
  `HKLM\\SOFTWARE\\${UNINSTALL_SUBKEY}`,
  `HKLM\\SOFTWARE\\WOW6432Node\\${UNINSTALL_SUBKEY}`,
  `HKCU\\Software\\${UNINSTALL_SUBKEY}`,
];
const GUID_RE = /\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/;

interface RawApp {
  id: string;
  keyPath: string;
  name: string;
  publisher?: string;
  version?: string;
  estimatedKb?: number;
  installDate?: string;
  displayIcon?: string;
  installLocation?: string;
  uninstallString?: string;
  noRemove: boolean;
}

function str(k: RegKey, name: string): string | undefined {
  const v = valueOf(k.values, name);
  const s = v?.data.trim();
  return s ? s : undefined;
}

/** Lit toutes les entrées utiles (composants système, mises à jour et entrées sans nom exclus). */
async function readRaw(): Promise<RawApp[]> {
  const perSource = await Promise.all(SOURCES.map((key) => regQuery(key, { recursive: true, view64: true, timeoutMs: 45_000 })));
  const out: RawApp[] = [];
  for (const keys of perSource) {
    for (const k of keys) {
      // Uniquement les sous-clés directes de …\Uninstall.
      const rel = k.path.split(/\\Uninstall\\/i)[1];
      if (!rel || rel.includes('\\')) continue;
      const name = str(k, 'DisplayName');
      if (!name) continue;
      if (dword(valueOf(k.values, 'SystemComponent')) === 1) continue;
      if (str(k, 'ParentKeyName')) continue;
      const release = str(k, 'ReleaseType')?.toLowerCase() ?? '';
      if (/update|hotfix/.test(release)) continue;
      out.push({
        id: opaqueId('app', k.path),
        keyPath: k.path,
        name,
        publisher: str(k, 'Publisher'),
        version: str(k, 'DisplayVersion'),
        estimatedKb: dword(valueOf(k.values, 'EstimatedSize')),
        installDate: str(k, 'InstallDate'),
        displayIcon: str(k, 'DisplayIcon'),
        installLocation: str(k, 'InstallLocation'),
        uninstallString: str(k, 'UninstallString'),
        noRemove: dword(valueOf(k.values, 'NoRemove')) === 1,
      });
    }
  }
  return out;
}

function normDir(p: string): string {
  return p.replace(/^"+|"+$/g, '').replace(/[\\/]+$/, '').toLowerCase();
}

function isSelf(a: RawApp): boolean {
  const n = a.name.trim().toLowerCase();
  if (n === 'cleanly' || n === app.getName().toLowerCase()) return true;
  if (app.isPackaged && a.installLocation) {
    return normDir(a.installLocation) === normDir(path.dirname(process.execPath));
  }
  return false;
}

function parseInstallDate(s: string | undefined): number | undefined {
  const m = s ? /^(\d{4})(\d{2})(\d{2})$/.exec(s) : null;
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const t = new Date(y, mo - 1, d).getTime();
  return t <= Date.now() ? t : undefined;
}

/** « "C:\x\app.exe",0 » → C:\x\app.exe */
function iconPathOf(displayIcon: string | undefined): string | undefined {
  if (!displayIcon) return undefined;
  const p = displayIcon.trim().replace(/,\s*-?\d+\s*$/, '').replace(/^"+|"+$/g, '').trim();
  if (!isDriveAbsolute(p) || !/\.(exe|ico)$/i.test(p)) return undefined;
  return p;
}

/** Dossier d'installation mesurable (local, assez profond, hors racines système). */
async function measurableDir(loc: string | undefined): Promise<string | undefined> {
  if (!loc) return undefined;
  const p = loc.replace(/^"+|"+$/g, '').replace(/[\\/]+$/, '');
  if (!isDriveAbsolute(p) || hasControlChars(p)) return undefined;
  if (p.split(/[\\/]+/).filter(Boolean).length < 3) return undefined; // ex. « C:\Program Files » refusé
  const lower = p.toLowerCase();
  const sysRoot = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
  if (lower === sysRoot || lower.startsWith(sysRoot + '\\')) return undefined;
  if (!(await isIconSafePath(p))) return undefined;
  return p;
}

function dedupe(apps: InstalledApp[]): InstalledApp[] {
  const byKey = new Map<string, InstalledApp>();
  for (const a of apps) {
    const key = `${a.name.toLowerCase()}|${(a.version ?? '').toLowerCase()}`;
    const prev = byKey.get(key);
    const score = (x: InstalledApp): number => (x.canUninstall ? 4 : 0) + (x.sizeBytes ? 2 : 0) + (x.iconDataUrl ? 1 : 0);
    if (!prev || score(a) > score(prev)) byKey.set(key, a);
  }
  return [...byKey.values()];
}

export async function listInstalledAppsWin(): Promise<InstalledApp[]> {
  const raws = await readRaw();
  const sizeDeadline = Date.now() + 6_000;
  const apps = await mapLimit(raws, 6, async (r): Promise<InstalledApp> => {
    const self = isSelf(r);
    const a: InstalledApp = {
      id: r.id,
      name: r.name,
      canUninstall: !!r.uninstallString && !r.noRemove && !self,
      isSelf: self,
    };
    if (r.publisher) a.publisher = r.publisher;
    if (r.version) a.version = r.version;
    if (r.installLocation) a.location = r.installLocation.replace(/^"+|"+$/g, '');
    const installedAt = parseInstallDate(r.installDate);
    if (installedAt) a.installedAt = installedAt;
    if (r.estimatedKb && r.estimatedKb > 0) a.sizeBytes = r.estimatedKb * 1024;
    else if (Date.now() < sizeDeadline) {
      const dir = await measurableDir(r.installLocation);
      if (dir) {
        const size = await dirSize(dir, Math.min(sizeDeadline, Date.now() + 1_500));
        if (size && size > 0) a.sizeBytes = size;
      }
    }
    const icon = await iconFor(iconPathOf(r.displayIcon));
    if (icon) a.iconDataUrl = icon;
    return a;
  });
  return dedupe(apps).sort((x, y) => x.name.localeCompare(y.name, 'fr'));
}

type Launch = { exe: string; args: string } | { error: string };

/** Transforme UninstallString en exécutable local validé + arguments. */
async function resolveUninstaller(r: RawApp): Promise<Launch> {
  const cmd = r.uninstallString ?? '';
  if (!cmd || hasControlChars(cmd)) return { error: 'Aucun désinstallateur valide pour cette application.' };
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';

  // Entrées Windows Installer : msiexec /x {GUID} (GUID validé).
  if (/^\s*"?(?:[A-Za-z]:\\[^"]*\\)?msiexec(?:\.exe)?"?\s/i.test(cmd)) {
    const guid = GUID_RE.exec(cmd)?.[0] ?? GUID_RE.exec(r.keyPath.split('\\').pop() ?? '')?.[0];
    if (!guid) return { error: 'Identifiant Windows Installer invalide.' };
    return { exe: path.win32.join(sysRoot, 'System32', 'msiexec.exe'), args: `/x ${guid}` };
  }

  const parts = splitCommandLine(cmd);
  if (!parts) return { error: 'Commande de désinstallation illisible.' };
  const exe = resolveBareSystemExe(parts.exe);
  if (!isDriveAbsolute(exe) || exe.startsWith('\\\\')) return { error: 'Le désinstallateur doit être un fichier local.' };
  if (!/\.exe$/i.test(exe)) return { error: "Le désinstallateur n'est pas un exécutable (.exe)." };
  if (!(await isIconSafePath(exe))) return { error: "Le désinstallateur n'est pas sur un disque local fixe." };
  let real: string;
  try {
    // realpath développe aussi les noms courts 8.3 (PROGRA~1).
    real = await fsp.realpath(exe);
    const st = await fsp.stat(real);
    if (!st.isFile()) return { error: 'Désinstallateur introuvable.' };
  } catch {
    return { error: 'Désinstallateur introuvable.' };
  }
  if (!isDriveAbsolute(real) || unsafePathSyntax(real) !== null) return { error: 'Chemin du désinstallateur refusé.' };
  return { exe: real, args: parts.args };
}

export async function uninstallAppWin(appId: string): Promise<UninstallResult> {
  // Relecture du registre : l'application est redérivée de l'id opaque.
  const r = (await readRaw()).find((a) => a.id === appId);
  if (!r) return { started: false, removed: true, message: "Cette application n'apparaît plus dans la liste." };
  if (isSelf(r)) return { started: false, removed: false, message: 'Cleanly ne peut pas se désinstaller lui-même ici.' };
  if (!r.uninstallString || r.noRemove) {
    return { started: false, removed: false, message: "Cette application ne fournit pas de désinstallateur." };
  }
  const launch = await resolveUninstaller(r);
  if ('error' in launch) return { started: false, removed: false, message: launch.error };

  // Start-Process = sémantique ShellExecute : le manifeste UAC du désinstallateur est respecté.
  const argPart = launch.args ? ` -ArgumentList ${psQuote(launch.args)}` : '';
  const script = `try{Start-Process -FilePath ${psQuote(launch.exe)}${argPart} -Wait;'started'}catch{'failed:'+$_.Exception.Message}`;
  const res = await runPowerShell(script, { timeoutMs: 60 * 60_000 });
  const started = res.stdout.includes('started');

  const removed = !(await readRaw()).some((a) => a.id === appId);
  let message: string;
  if (removed) message = `${r.name} a été désinstallé.`;
  else if (!started) message = "Le désinstallateur n'a pas pu être lancé (autorisation refusée ou erreur).";
  else message = `Le désinstallateur de ${r.name} s'est terminé, mais l'application est toujours présente. Elle a peut-être été conservée, ou la désinstallation se poursuit en arrière-plan.`;
  return { started, removed, message };
}
