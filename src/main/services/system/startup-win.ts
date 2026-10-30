/**
 * Éléments de démarrage Windows : clés Run (HKCU, HKLM, HKLM WOW6432Node) et dossiers Démarrage.
 * L'activation se fait EXCLUSIVEMENT via les valeurs StartupApproved (comme le Gestionnaire des tâches) :
 * aucune entrée Run ni aucun fichier n'est jamais supprimé.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import type { StartupItem, StartupLocation, StartupToggleRequest, StartupToggleResult } from '../../../../shared/types';
import { psQuote, regExePath, run, runPowerShell } from '../../util/exec';
import { isIconSafePath } from '../../safety/index';
import { iconFor } from './icons';
import {
  APPROVED_ENABLED_HEX, approvedDisabledHex, approvedIsEnabled, isUnsetDefault, looksLikeDefaultName, regValues, valueOf,
} from './registry';
import {
  estimateImpact, hasControlChars, isDriveAbsolute, mapLimit, opaqueId, resolveBareSystemExe, splitCommandLine, withTimeout,
} from './util';

const RUN_SUBKEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN32_SUBKEY = 'Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPROVED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';

interface Source {
  location: StartupLocation;
  scope: 'user' | 'machine';
  /** Clé StartupApproved correspondante. */
  approvedKey: string;
}

const RUN_SOURCES: Array<Source & { runKey: string }> = [
  { location: 'hkcu-run', scope: 'user', runKey: `HKCU\\${RUN_SUBKEY}`, approvedKey: `HKCU\\${APPROVED}\\Run` },
  { location: 'hklm-run', scope: 'machine', runKey: `HKLM\\${RUN_SUBKEY}`, approvedKey: `HKLM\\${APPROVED}\\Run` },
  { location: 'hklm-run32', scope: 'machine', runKey: `HKLM\\${RUN32_SUBKEY}`, approvedKey: `HKLM\\${APPROVED}\\Run32` },
];

function startupFolders(): Array<Source & { dir: string }> {
  const out: Array<Source & { dir: string }> = [];
  const tail = ['Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'];
  if (process.env.APPDATA) {
    out.push({
      location: 'startup-folder-user', scope: 'user', dir: path.win32.join(process.env.APPDATA, ...tail),
      approvedKey: `HKCU\\${APPROVED}\\StartupFolder`,
    });
  }
  const pd = process.env.ProgramData || process.env.ALLUSERSPROFILE;
  if (pd) {
    out.push({
      location: 'startup-folder-common', scope: 'machine', dir: path.win32.join(pd, ...tail),
      approvedKey: `HKLM\\${APPROVED}\\StartupFolder`,
    });
  }
  return out;
}

/** Entrée brute relue depuis la source (base de toute décision). */
interface RawEntry {
  id: string;
  name: string;
  command: string;
  source: Source;
  /** Nom de la valeur StartupApproved (nom de la valeur Run ou nom du fichier). */
  approvedName: string;
  enabled: boolean;
  readOnly: boolean;
  /** Exécutable cible (pour l'éditeur, l'impact et l'icône). */
  exePath?: string;
}

/** Nom inutilisable pour une écriture fiable (perte de caractères OEM, contrôle, guillemets…). */
function unsafeValueName(name: string, machine: boolean): boolean {
  if (!name || hasControlChars(name) || name.includes('�') || name.includes('?')) return true;
  if (looksLikeDefaultName(name)) return true;
  if (machine && (name.includes('"') || name.endsWith('\\'))) return true;
  return false;
}

function exeFromCommand(command: string): string | undefined {
  const parts = splitCommandLine(command);
  if (!parts?.exe) return undefined;
  const exe = resolveBareSystemExe(parts.exe);
  return isDriveAbsolute(exe) ? exe : undefined;
}

async function readRunEntries(): Promise<RawEntry[]> {
  const perSource = await Promise.all(
    RUN_SOURCES.map(async (src) => {
      const [runVals, approvedVals] = await Promise.all([regValues(src.runKey), regValues(src.approvedKey)]);
      return runVals
        .filter((v) => !isUnsetDefault(v) && (v.type === 'REG_SZ' || v.type === 'REG_EXPAND_SZ') && v.data.trim())
        .map<RawEntry>((v) => ({
          id: opaqueId('su', src.location, v.name),
          name: v.name,
          command: v.data,
          source: src,
          approvedName: v.name,
          enabled: approvedIsEnabled(valueOf(approvedVals, v.name)),
          readOnly: unsafeValueName(v.name, src.scope === 'machine'),
          exePath: exeFromCommand(v.data),
        }));
    }),
  );
  return perSource.flat();
}

async function readFolderEntries(): Promise<RawEntry[]> {
  const perFolder = await Promise.all(
    startupFolders().map(async (src) => {
      let names: string[] = [];
      try {
        const dirents = await fsp.readdir(src.dir, { withFileTypes: true });
        names = dirents.filter((d) => d.isFile() && d.name.toLowerCase() !== 'desktop.ini').map((d) => d.name);
      } catch {
        return [];
      }
      const approvedVals = await regValues(src.approvedKey);
      return names.map<RawEntry>((file) => {
        const full = path.win32.join(src.dir, file);
        const ext = path.win32.extname(file).toLowerCase();
        let command = full;
        let exePath: string | undefined;
        if (ext === '.lnk') {
          try {
            // Lecture locale du raccourci : ne résout pas la cible (pas d'accès réseau).
            const link = shell.readShortcutLink(full);
            if (link.target) {
              command = link.args ? `"${link.target}" ${link.args}` : `"${link.target}"`;
              if (isDriveAbsolute(link.target)) exePath = link.target;
            }
          } catch {
            /* raccourci illisible : on affiche le chemin du fichier */
          }
        } else if (ext === '.exe') {
          exePath = full;
        }
        return {
          id: opaqueId('su', src.location, file),
          name: ext === '.lnk' ? file.slice(0, -4) : file,
          command,
          source: src,
          approvedName: file,
          enabled: approvedIsEnabled(valueOf(approvedVals, file)),
          // Le nom du fichier vient du système de fichiers (Unicode exact) : fiable.
          readOnly: hasControlChars(file) || (src.scope === 'machine' && (file.includes('"') || file.endsWith('\\'))),
          exePath,
        };
      });
    }),
  );
  return perFolder.flat();
}

async function readAll(): Promise<RawEntry[]> {
  const [runs, folders] = await Promise.all([readRunEntries(), readFolderEntries()]);
  return [...runs, ...folders];
}

interface ExeInfo {
  company?: string;
  /** FileDescription : nom affiché par le Gestionnaire des tâches. */
  description?: string;
  size?: number;
}

/** Éditeur (CompanyName) et taille de plusieurs exécutables en UN seul appel PowerShell. */
async function exeInfos(paths: string[]): Promise<Map<string, ExeInfo>> {
  const out = new Map<string, ExeInfo>();
  const safe: string[] = [];
  for (const p of new Set(paths)) {
    if (hasControlChars(p)) continue;
    if (await isIconSafePath(p)) safe.push(p);
  }
  if (!safe.length) return out;
  const script =
    `$paths=@(${safe.map(psQuote).join(',')});` +
    '$o=foreach($p in $paths){try{$i=Get-Item -LiteralPath $p -ErrorAction Stop;' +
    '[pscustomobject]@{p=$p;c=[string]$i.VersionInfo.CompanyName;d=[string]$i.VersionInfo.FileDescription;s=[int64]$i.Length}}' +
    'catch{[pscustomobject]@{p=$p;c=$null;d=$null;s=$null}}};' +
    'ConvertTo-Json -InputObject @($o) -Compress';
  const r = await runPowerShell(script, { timeoutMs: 20_000 });
  try {
    const arr = JSON.parse(r.stdout.trim() || '[]') as Array<{ p: string; c: string | null; d: string | null; s: number | null }>;
    for (const e of arr) {
      out.set(e.p.toLowerCase(), {
        company: e.c?.trim() || undefined,
        description: e.d?.trim() || undefined,
        size: typeof e.s === 'number' ? e.s : undefined,
      });
    }
  } catch {
    /* sortie inattendue : pas d'éditeur */
  }
  return out;
}

/** Description de fichier si elle est parlante, sinon le nom de la valeur / du fichier. */
const GENERIC_DESC = /^(update|updater|launcher|setup|helper|service|application|app|tray|agent)$/i;
function displayName(fallback: string, description: string | undefined): string {
  if (!description || description.length < 3 || GENERIC_DESC.test(description) || hasControlChars(description)) return fallback;
  return description;
}

async function toItems(entries: RawEntry[]): Promise<StartupItem[]> {
  const infos = await withTimeout(
    exeInfos(entries.map((e) => e.exePath).filter((p): p is string => !!p)),
    25_000,
    new Map<string, ExeInfo>(),
  );
  return mapLimit(entries, 6, async (e) => {
    const info = e.exePath ? infos.get(e.exePath.toLowerCase()) : undefined;
    const item: StartupItem = {
      id: e.id,
      name: displayName(e.name, info?.description),
      command: e.command,
      location: e.source.location,
      scope: e.source.scope,
      enabled: e.enabled,
      requiresAdmin: e.source.scope === 'machine',
      readOnly: e.readOnly,
      impact: estimateImpact(e.command, info?.size),
    };
    if (info?.company) item.publisher = info.company;
    const icon = await iconFor(e.exePath);
    if (icon) item.iconDataUrl = icon;
    return item;
  });
}

export async function listStartupItemsWin(): Promise<StartupItem[]> {
  return toItems(await readAll());
}

/** Écrit la valeur StartupApproved (HKCU directement, HKLM via UNE invite UAC). */
async function writeApproved(e: RawEntry, enabled: boolean): Promise<{ declined: boolean; error?: string }> {
  const hex = enabled ? APPROVED_ENABLED_HEX : approvedDisabledHex();
  const args = ['add', e.source.approvedKey, '/v', e.approvedName, '/t', 'REG_BINARY', '/d', hex, '/f'];
  if (e.source.scope === 'user') {
    const r = await run(regExePath(), args, { encoding: 'oem', timeoutMs: 15_000 });
    return { declined: false, error: r.code === 0 ? undefined : r.stderr.trim() || 'reg.exe a échoué' };
  }
  args.push('/reg:64');
  // PowerShell 5.1 joint -ArgumentList sans guillemets : on construit UNE chaîne, chaque argument entre guillemets.
  for (const a of args) {
    if (a.includes('"') || hasControlChars(a) || a.endsWith('\\')) return { declined: false, error: 'Nom de valeur non pris en charge.' };
  }
  const argString = args.map((a) => `"${a}"`).join(' ');
  const script =
    `try{Start-Process -FilePath ${psQuote(regExePath())} -ArgumentList ${psQuote(argString)} ` +
    "-Verb RunAs -Wait -WindowStyle Hidden;'started'}catch{'declined'}";
  const r = await runPowerShell(script, { timeoutMs: 5 * 60_000 });
  return { declined: r.stdout.includes('declined') };
}

export async function toggleStartupItemWin(req: StartupToggleRequest): Promise<StartupToggleResult> {
  // Relecture de la source : l'id opaque est la seule donnée acceptée de l'interface.
  const before = (await readAll()).find((e) => e.id === req.id);
  if (!before) throw new Error('Élément de démarrage introuvable (la liste a peut-être changé).');
  const [beforeItem] = await toItems([before]);
  if (!beforeItem) throw new Error('Élément de démarrage introuvable.');
  if (before.readOnly) {
    return { item: beforeItem, applied: false, message: 'Cet élément ne peut pas être modifié par Cleanly.' };
  }
  if (before.enabled === req.enabled) return { item: beforeItem, applied: true };

  const w = await writeApproved(before, req.enabled);

  // Le résultat est TOUJOURS déterminé par relecture du registre, jamais par un code de sortie.
  const after = (await readAll()).find((e) => e.id === req.id) ?? before;
  const [item] = await toItems([after]);
  const applied = after.enabled === req.enabled;
  const result: StartupToggleResult = { item: item ?? beforeItem, applied };
  if (!applied) {
    if (before.source.scope === 'machine') {
      result.elevationDeclined = true;
      result.message = w.declined
        ? "L'autorisation administrateur a été refusée : aucun changement n'a été appliqué."
        : w.error ?? "La modification n'a pas pu être appliquée (autorisation administrateur requise).";
    } else {
      result.message = w.error ? `La modification a échoué : ${w.error}` : "La modification n'a pas pu être appliquée.";
    }
  }
  return result;
}
