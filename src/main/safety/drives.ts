/**
 * Détection des lecteurs (fixes / amovibles / réseau). Le résultat est mis en cache : il sert
 * à la fois à l'interface (disk:drives) et aux règles de sécurité (seuls les lecteurs FIXES
 * sont autorisés pour la suppression, la corbeille, les scans et les icônes).
 */
import fs from 'node:fs';
import type { DriveInfo, DriveKind } from '../../../shared/types';
import { run, runPowerShell } from '../util/exec';
import { IS_MAC, IS_WIN, env, isSameOrInside } from './paths';

const TTL_MS = 60_000;
let cache: { at: number; drives: DriveInfo[] } | null = null;
let pending: Promise<DriveInfo[]> | null = null;

export function systemDriveLetter(): string {
  const d = (env('SystemDrive') ?? 'C:').toUpperCase();
  return /^[A-Z]:$/.test(d) ? d : 'C:';
}

async function statfsSafe(p: string): Promise<{ total: number; free: number } | null> {
  try {
    const s = await fs.promises.statfs(p);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

interface CimDisk {
  DeviceID?: unknown;
  DriveType?: unknown;
  Size?: unknown;
  FreeSpace?: unknown;
  VolumeName?: unknown;
}

async function detectWindows(): Promise<DriveInfo[]> {
  const sys = systemDriveLetter();
  const r = await runPowerShell(
    'ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_LogicalDisk | ' +
      'Select-Object DeviceID,DriveType,Size,FreeSpace,VolumeName)',
    { timeoutMs: 20_000 },
  );
  const out: DriveInfo[] = [];
  if (r.code === 0 && r.stdout.trim()) {
    try {
      const parsed = JSON.parse(r.stdout.trim()) as unknown;
      const list = (Array.isArray(parsed) ? parsed : [parsed]) as CimDisk[];
      for (const d of list) {
        const id = typeof d.DeviceID === 'string' ? d.DeviceID.toUpperCase() : '';
        if (!/^[A-Z]:$/.test(id)) continue;
        const t = typeof d.DriveType === 'number' ? d.DriveType : 0;
        const kind: DriveKind = t === 3 ? 'fixed' : t === 2 ? 'removable' : t === 4 ? 'network' : 'unknown';
        const label = typeof d.VolumeName === 'string' && d.VolumeName.trim() ? d.VolumeName.trim() : '';
        out.push({
          id,
          mount: id + '\\',
          label: label || (id === sys ? 'Disque local' : kind === 'removable' ? 'Disque amovible' : kind === 'network' ? 'Lecteur réseau' : 'Disque local'),
          kind,
          totalBytes: typeof d.Size === 'number' ? d.Size : 0,
          freeBytes: typeof d.FreeSpace === 'number' ? d.FreeSpace : 0,
          isSystem: id === sys,
        });
      }
    } catch {
      /* repli ci-dessous */
    }
  }
  if (!out.some((d) => d.id === sys)) {
    // Repli : au minimum le disque système, considéré comme fixe.
    const s = await statfsSafe(sys + '\\');
    out.unshift({
      id: sys, mount: sys + '\\', label: 'Disque local', kind: 'fixed',
      totalBytes: s?.total ?? 0, freeBytes: s?.free ?? 0, isSystem: true,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** macOS : interprète `diskutil info -plist` (clés Internal / RemovableMedia / Ejectable). */
async function macVolumeKind(mount: string): Promise<DriveKind> {
  const r = await run('/usr/sbin/diskutil', ['info', '-plist', mount], { timeoutMs: 10_000 });
  if (r.code !== 0) return 'unknown';
  const bool = (k: string): boolean | null => {
    const m = new RegExp(`<key>${k}</key>\\s*<(true|false)/>`).exec(r.stdout);
    return m ? m[1] === 'true' : null;
  };
  if (/<key>Protocol<\/key>\s*<string>(SMB|AFP|NFS|WebDAV)/i.test(r.stdout)) return 'network';
  const internal = bool('Internal');
  const removable = bool('RemovableMedia') || bool('Ejectable') || bool('RemovableMediaOrExternalDevice');
  if (internal === true && !removable) return 'fixed';
  if (removable || internal === false) return 'removable';
  return 'unknown';
}

async function detectMac(): Promise<DriveInfo[]> {
  const out: DriveInfo[] = [];
  const root = await statfsSafe('/');
  out.push({ id: '/', mount: '/', label: 'Macintosh HD', kind: 'fixed', totalBytes: root?.total ?? 0, freeBytes: root?.free ?? 0, isSystem: true });
  let names: string[] = [];
  try {
    names = await fs.promises.readdir('/Volumes');
  } catch {
    /* ignore */
  }
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const mount = '/Volumes/' + name;
    try {
      const st = await fs.promises.lstat(mount);
      if (st.isSymbolicLink()) continue; // « Macintosh HD » → / : déjà listé
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const s = await statfsSafe(mount);
    if (!s) continue;
    out.push({ id: mount, mount, label: name, kind: await macVolumeKind(mount), totalBytes: s.total, freeBytes: s.free, isSystem: false });
  }
  return out;
}

async function detectOther(): Promise<DriveInfo[]> {
  const s = await statfsSafe('/');
  return [{ id: '/', mount: '/', label: 'Système', kind: 'fixed', totalBytes: s?.total ?? 0, freeBytes: s?.free ?? 0, isSystem: true }];
}

/** Liste des lecteurs (cache 60 s ; `force` relit). */
export async function getDrives(force = false): Promise<DriveInfo[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.drives;
  pending ??= (IS_WIN ? detectWindows() : IS_MAC ? detectMac() : detectOther())
    .then((drives) => {
      cache = { at: Date.now(), drives };
      return drives;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Dernière liste connue sans attendre (peut être vide si jamais chargée). */
export function cachedDrives(): DriveInfo[] {
  return cache?.drives ?? [];
}

/**
 * Lecteur contenant un chemin ABSOLU déjà résolu. Sous macOS : le volume /Volumes/X le plus
 * spécifique, sinon le volume de démarrage « / ».
 */
export function driveForPath(p: string, drives: DriveInfo[]): DriveInfo | null {
  if (IS_WIN) {
    const m = /^([A-Za-z]):[\\/]/.exec(p);
    if (!m?.[1]) return null;
    const id = m[1].toUpperCase() + ':';
    return drives.find((d) => d.id === id) ?? null;
  }
  let best: DriveInfo | null = null;
  for (const d of drives) {
    if (d.mount === '/') continue;
    if (isSameOrInside(p, d.mount) && (!best || d.mount.length > best.mount.length)) best = d;
  }
  if (best) return best;
  if (p.startsWith('/Volumes/')) return null; // volume inconnu
  return drives.find((d) => d.mount === '/') ?? null;
}

/** true si le chemin est sur un lecteur fixe connu. */
export async function isOnFixedDrive(p: string): Promise<boolean> {
  const d = driveForPath(p, await getDrives());
  return d?.kind === 'fixed';
}
