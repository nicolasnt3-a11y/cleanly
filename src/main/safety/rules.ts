/**
 * Règles de sécurité : syntaxe dangereuse et emplacements protégés du système.
 * Toutes les comparaisons passent par key() (insensible à la casse sous Windows / macOS).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IS_MAC, IS_WIN, env, isDriveRootSyntax, isSameOrInside, isStrictlyInside, joinChild, key, normalizeSep, realpathNative, segments } from './paths';

/* ───────────────────────────── Syntaxe ───────────────────────────── */

/** Raison de refus si la syntaxe du chemin est dangereuse, sinon null. */
export function syntaxReason(p: string): string | null {
  if (typeof p !== 'string' || p.length === 0) return 'Chemin vide.';
  if (p.length > 32_000) return 'Chemin trop long.';
  if (/[\0\r\n]/.test(p)) return 'Chemin contenant un caractère de contrôle.';
  if (IS_WIN) {
    if (/^[\\/]{2}/.test(p)) return 'Chemin réseau ou de périphérique (UNC, \\\\?\\, \\\\.\\) refusé.';
    if (!/^[A-Za-z]:[\\/]/.test(p)) return 'Chemin non absolu refusé.';
    if (p.indexOf(':', 2) !== -1) return 'Flux de données alternatif (ADS) refusé.';
    if (/[*?"<>|]/.test(p)) return 'Caractère interdit dans le chemin.';
  } else {
    if (!p.startsWith('/')) return 'Chemin non absolu refusé.';
    if (p.startsWith('//')) return 'Chemin réseau refusé.';
    if (p.includes(':')) return 'Caractère « : » refusé dans le chemin.';
  }
  const segs = segments(p);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (IS_WIN && i === 0) continue; // « C: »
    if (s === '.' || s === '..') return 'Chemin relatif (« . » ou « .. ») refusé.';
    if (/[. ]$/.test(s)) return 'Segment de chemin se terminant par un point ou une espace refusé.';
    if (/~\d/.test(s)) return 'Nom court 8.3 (ex. DOCUME~1) refusé.';
  }
  return null;
}

/* ─────────────────────── Emplacements protégés ─────────────────────── */

interface Protection {
  /** Interdits eux-mêmes ET tout leur contenu. */
  subtrees: string[];
  /** Interdits uniquement en tant que tels (leur contenu peut être autorisé). */
  exact: string[];
  /** Sous-arbres autorisés à l'intérieur d'un sous-arbre interdit (égalité incluse). */
  allowedWithin: string[];
  home: string;
}

let protection: Protection | null = null;

async function real(p: string): Promise<string> {
  try {
    return normalizeSep(await realpathNative(p));
  } catch {
    return normalizeSep(p);
  }
}

/** Ajoute à la fois le chemin brut et sa forme résolue (realpath). */
async function both(list: string[], p: string | undefined): Promise<void> {
  if (!p) return;
  const n = normalizeSep(p);
  list.push(n);
  const r = await real(n);
  if (key(r) !== key(n)) list.push(r);
}

async function buildProtection(): Promise<Protection> {
  const subtrees: string[] = [];
  const exact: string[] = [];
  const allowedWithin: string[] = [];
  const home = await real(os.homedir());
  exact.push(normalizeSep(os.homedir()), home);

  if (IS_WIN) {
    const sysDrive = /^[A-Za-z]:$/.test(env('SystemDrive') ?? '') ? env('SystemDrive')! : 'C:';
    const sysRootRaw = env('SystemRoot') ?? env('windir') ?? sysDrive + '\\Windows';
    const sysRoot = /^[A-Za-z]:\\/.test(sysRootRaw) ? sysRootRaw : sysDrive + '\\Windows';
    await both(subtrees, sysRoot);
    for (const sub of ['Temp', 'SoftwareDistribution\\Download', 'Minidump']) await both(allowedWithin, joinChild(sysRoot, sub));

    await both(subtrees, env('ProgramFiles') ?? sysDrive + '\\Program Files');
    await both(subtrees, env('ProgramFiles(x86)') ?? sysDrive + '\\Program Files (x86)');
    await both(subtrees, env('ProgramW6432'));
    const programData = env('ProgramData') ?? sysDrive + '\\ProgramData';
    await both(subtrees, programData);
    for (const sub of ['ReportArchive', 'ReportQueue']) {
      await both(allowedWithin, joinChild(programData, 'Microsoft\\Windows\\WER\\' + sub));
    }
    for (const sub of ['Recovery', 'Boot', 'Config.Msi', 'PerfLogs', 'Documents and Settings', 'System Volume Information', 'MSOCache']) {
      subtrees.push(joinChild(sysDrive + '\\', sub));
    }

    const usersRoot = path.win32.dirname(home);
    exact.push(usersRoot);
    await both(subtrees, joinChild(usersRoot, 'Default'));
    await both(subtrees, joinChild(usersRoot, 'All Users'));
    await both(exact, env('PUBLIC') ?? joinChild(usersRoot, 'Public'));
    await both(exact, env('APPDATA'));
    await both(exact, env('LOCALAPPDATA'));
    await both(exact, joinChild(home, 'AppData'));
    await both(exact, joinChild(home, 'AppData\\Roaming'));
    await both(exact, joinChild(home, 'AppData\\Local'));
    await both(exact, joinChild(home, 'AppData\\LocalLow'));
    await both(exact, env('OneDrive'));
    await both(exact, env('USERPROFILE'));
    for (const k of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'OneDrive', 'Favorites', 'Contacts', 'Links', 'Saved Games', 'Searches']) {
      exact.push(joinChild(home, k));
    }
    // Données sensibles à ne jamais toucher, même via la corbeille.
    for (const k of ['AppData\\Roaming\\Microsoft\\Credentials', 'AppData\\Local\\Microsoft\\Credentials', 'AppData\\Roaming\\Microsoft\\Protect', 'AppData\\Roaming\\Microsoft\\SystemCertificates', 'NTUSER.DAT']) {
      subtrees.push(joinChild(home, k));
    }
  } else {
    for (const p of ['/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/private', '/var', '/tmp', '/dev', '/cores', '/opt', '/Network', '/nix']) {
      await both(subtrees, p);
    }
    for (const p of ['/', '/Applications', '/Users', '/Users/Shared', '/Volumes']) await both(exact, p);
    for (const k of ['Library', 'Library/Caches', 'Library/Logs', 'Library/Application Support', 'Library/Containers', 'Library/Group Containers', 'Library/Developer', 'Library/Developer/Xcode', '.Trash', 'Desktop', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures', 'Public', 'Applications']) {
      exact.push(joinChild(home, k));
    }
    for (const k of ['Library/Keychains', 'Library/Mail', 'Library/Messages', 'Library/Preferences', 'Library/Mobile Documents', 'Library/CloudStorage', 'Library/Accounts', 'Library/Cookies', '.ssh', '.gnupg']) {
      subtrees.push(joinChild(home, k));
    }
  }
  return { subtrees, exact, allowedWithin, home };
}

export async function getProtection(): Promise<Protection> {
  protection ??= await buildProtection();
  return protection;
}

const WIN_ROOT_FILES = /^(pagefile\.sys|hiberfil\.sys|swapfile\.sys|dumpstack\.log(\.tmp)?|bootmgr|bootnxt|bootsect\.bak)$/i;
const DANGEROUS_SEGMENTS = new Set(['$recycle.bin', 'system volume information', '$windows.~bt', '$windows.~ws', '$winreagent', '$sysreset']);

/**
 * Raison de refus si le chemin (DÉJÀ résolu) est un emplacement système protégé, sinon null.
 * N'évalue PAS l'appartenance à une racine autorisée.
 */
export function protectedReason(p: string, prot: Protection): string | null {
  const n = normalizeSep(p);
  if (isDriveRootSyntax(n)) return 'Racine de lecteur refusée.';
  if (IS_WIN) {
    const segs = segments(n);
    for (const s of segs.slice(1)) {
      if (DANGEROUS_SEGMENTS.has(s.toLowerCase())) return 'Dossier système protégé (Corbeille / System Volume Information).';
    }
    if (segs.length === 2) {
      const s = segs[1]!;
      if (s.startsWith('$')) return 'Dossier système à la racine du lecteur refusé.';
      if (WIN_ROOT_FILES.test(s)) return 'Fichier système à la racine du lecteur refusé.';
    }
    if (segs.length === 3 && segs[1]!.toLowerCase() === 'users') {
      // Profil d'un utilisateur (le nôtre ou un autre) : jamais en tant que tel.
      return 'Dossier de profil utilisateur refusé.';
    }
  } else if (/^\/Volumes\/[^/]+$/i.test(n)) {
    return 'Racine de volume refusée.';
  }
  if (key(n) === key(prot.home)) return 'Dossier personnel refusé.';
  for (const e of prot.exact) if (key(e) === key(n)) return 'Dossier système ou personnel protégé.';
  for (const s of prot.subtrees) {
    if (isSameOrInside(n, s)) {
      if (prot.allowedWithin.some((a) => isSameOrInside(n, a) && isStrictlyInside(a, s))) continue;
      return 'Emplacement système protégé.';
    }
  }
  if (IS_MAC && /\.app$/i.test(n) && n.startsWith('/System/')) return 'Application système protégée.';
  return null;
}
