/**
 * Validation des chemins et suppression / mise à la corbeille sûres.
 *
 * Principe : avant TOUTE suppression, le chemin complet est résolu (realpath natif), doit être
 * identique au chemin attendu (aucun lien symbolique / jonction dans la chaîne), passer toutes
 * les règles de syntaxe et d'emplacement, être sur un lecteur fixe et se trouver STRICTEMENT
 * à l'intérieur d'une racine autorisée (elle-même résolue). Les racines ne sont jamais supprimées.
 */
import fs from 'node:fs';
import os from 'node:os';
import { shell } from 'electron';
import { driveForPath, getDrives, isOnFixedDrive } from './drives';
import { IS_WIN, isSameOrInside, isStrictlyInside, joinChild, key, normalizeSep, realpathNative } from './paths';
import { getProtection, protectedReason, syntaxReason } from './rules';

export type SafetyVerdict = { ok: true; realPath: string } | { ok: false; reason: string };

/** Codes d'erreur signifiant « verrouillé / en cours d'utilisation / accès refusé ». */
const LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'ETXTBSY', 'EROFS', 'UNKNOWN']);

export function errCode(err: unknown): string {
  return (err as NodeJS.ErrnoException | null)?.code ?? 'UNKNOWN';
}
export function isLockError(err: unknown): boolean {
  return LOCK_CODES.has(errCode(err));
}
export function isAccessDenied(err: unknown): boolean {
  const c = errCode(err);
  return c === 'EPERM' || c === 'EACCES';
}

/** realpath natif, normalisé ; null si introuvable / inaccessible. */
export async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return normalizeSep(await realpathNative(p));
  } catch {
    return null;
  }
}

/** Renvoie une raison de refus si la syntaxe du chemin est dangereuse (UNC, ADS, 8.3…), sinon null. */
export function unsafePathSyntax(path: string): string | null {
  return syntaxReason(path);
}

/** Raison de refus pour un chemin déjà résolu (emplacements système), ou null. */
export async function protectedPathReason(realPath: string): Promise<string | null> {
  return syntaxReason(realPath) ?? protectedReason(realPath, await getProtection());
}

/**
 * Prépare des racines autorisées : realpath + syntaxe + lecteur fixe.
 * Les racines inexistantes ou invalides sont simplement ignorées.
 */
export async function resolveAllowedRoots(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const r of roots) {
    if (syntaxReason(r)) continue;
    const rp = await realpathOrNull(r);
    if (!rp || syntaxReason(rp)) continue;
    if (!(await isOnFixedDrive(rp))) continue;
    if (!out.some((o) => key(o) === key(rp))) out.push(rp);
  }
  return out;
}

/**
 * Cœur de la validation, sur racines DÉJÀ résolues. `expected` doit être le chemin exact
 * (sa résolution doit lui être identique).
 */
async function validateResolved(expected: string, resolvedRoots: string[], mode: 'permanent' | 'trash'): Promise<SafetyVerdict> {
  const before = syntaxReason(expected);
  if (before) return { ok: false, reason: before };
  const rp = await realpathOrNull(expected);
  if (!rp) return { ok: false, reason: 'Élément introuvable ou inaccessible.' };
  const after = syntaxReason(rp);
  if (after) return { ok: false, reason: after };
  if (key(rp) !== key(normalizeSep(expected))) {
    return { ok: false, reason: 'Le chemin passe par un lien symbolique ou une jonction : refusé.' };
  }
  const prot = await getProtection();
  const protectedWhy = protectedReason(rp, prot);
  if (protectedWhy) return { ok: false, reason: protectedWhy };
  if (!resolvedRoots.some((root) => isStrictlyInside(rp, root))) {
    return { ok: false, reason: "En dehors des emplacements autorisés." };
  }
  const drive = driveForPath(rp, await getDrives());
  const fixed = drive?.kind === 'fixed';
  if (mode === 'permanent' && !fixed) return { ok: false, reason: 'Lecteur réseau ou amovible : refusé.' };
  if (mode === 'trash' && !fixed && !isStrictlyInside(rp, prot.home)) {
    return { ok: false, reason: 'Lecteur réseau ou amovible : refusé.' };
  }
  return { ok: true, realPath: rp };
}

/**
 * Résout le chemin COMPLET avec realpath puis le valide contre toutes les règles de sécurité,
 * et vérifie qu'il est strictement contenu dans l'une des racines autorisées (elles-mêmes résolues).
 */
export async function validateForDeletion(
  path: string,
  opts: { allowedRoots: string[]; mode: 'permanent' | 'trash' },
): Promise<SafetyVerdict> {
  try {
    const roots = await resolveAllowedRoots(opts.allowedRoots);
    if (roots.length === 0) return { ok: false, reason: 'Aucun emplacement autorisé valide.' };
    return await validateResolved(path, roots, opts.mode);
  } catch (err) {
    return { ok: false, reason: 'Validation impossible : ' + errCode(err) };
  }
}

/** Taille d'un dossier sans suivre les liens (borne de temps). */
export async function dirSizeNoFollow(root: string, budgetMs = 15_000): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let total = 0;
  const stack = [root];
  while (stack.length && Date.now() < deadline) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = joinChild(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          const st = await fs.promises.lstat(p);
          if (st.isFile()) total += st.size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}

/** Envoie un chemin validé à la corbeille système. */
export async function trashPath(
  path: string,
  allowedRoots: string[],
): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> {
  const v = await validateForDeletion(path, { allowedRoots, mode: 'trash' });
  if (!v.ok) return v;
  return trashValidated(v.realPath);
}

/** Corbeille d'un chemin DÉJÀ validé (realPath issu de validateForDeletion). */
export async function trashValidated(realPath: string, knownBytes?: number): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> {
  let bytes = knownBytes ?? 0;
  try {
    const st = await fs.promises.lstat(realPath);
    if (st.isSymbolicLink()) return { ok: false, reason: 'Lien symbolique refusé.' };
    if (knownBytes === undefined) bytes = st.isDirectory() ? await dirSizeNoFollow(realPath) : st.size;
  } catch (err) {
    return { ok: false, reason: errCode(err) === 'ENOENT' ? 'Élément introuvable.' : 'Élément inaccessible.' };
  }
  try {
    await shell.trashItem(realPath);
    return { ok: true, bytes };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'Mise à la corbeille impossible (élément peut-être utilisé) : ' + msg.slice(0, 160) };
  }
}

export type UnlinkOutcome =
  | { kind: 'deleted'; bytes: number }
  | { kind: 'locked'; accessDenied: boolean }
  | { kind: 'unsafe'; reason: string }
  | { kind: 'gone' }
  | { kind: 'recent' };

/**
 * Supprime DÉFINITIVEMENT un fichier, après lstat + realpath juste avant unlink (TOCTOU) :
 * le chemin résolu doit être identique au chemin attendu et valide pour les racines données
 * (déjà résolues avec resolveAllowedRoots). Jamais de suppression récursive.
 * `minAgeMs` : refuse les fichiers modifiés / créés trop récemment.
 */
export async function unlinkFileChecked(expected: string, resolvedRoots: string[], minAgeMs = 0): Promise<UnlinkOutcome> {
  let st: fs.Stats;
  try {
    st = await fs.promises.lstat(expected);
  } catch (err) {
    if (errCode(err) === 'ENOENT') return { kind: 'gone' };
    return { kind: 'locked', accessDenied: isAccessDenied(err) };
  }
  if (st.isSymbolicLink() || !st.isFile()) return { kind: 'unsafe', reason: "Ce n'est pas un fichier ordinaire." };
  if (minAgeMs > 0 && Date.now() - st.mtimeMs < minAgeMs) return { kind: 'recent' };
  const v = await validateResolved(expected, resolvedRoots, 'permanent');
  if (!v.ok) return { kind: 'unsafe', reason: v.reason };
  try {
    await fs.promises.unlink(v.realPath);
    return { kind: 'deleted', bytes: st.size };
  } catch (err) {
    if (errCode(err) === 'ENOENT') return { kind: 'gone' };
    return { kind: 'locked', accessDenied: isAccessDenied(err) };
  }
}

/** Supprime un dossier VIDE (jamais une racine), après les mêmes vérifications. */
export async function rmdirIfEmptyChecked(expected: string, resolvedRoots: string[]): Promise<boolean> {
  try {
    const st = await fs.promises.lstat(expected);
    if (st.isSymbolicLink() || !st.isDirectory()) return false;
    const v = await validateResolved(expected, resolvedRoots, 'permanent');
    if (!v.ok) return false;
    await fs.promises.rmdir(v.realPath); // échoue (ENOTEMPTY) si le dossier n'est pas vide
    return true;
  } catch {
    return false;
  }
}

const ICON_UNSAFE_EXT = /\.(url|lnk|scf|website|library-ms|searchconnector-ms)$/i;

function iconQuickReason(p: string): boolean {
  if (typeof p !== 'string' || !p || /[\0\r\n]/.test(p)) return false;
  if (IS_WIN) {
    if (/^[\\/]{2}/.test(p)) return false;
    if (!/^[A-Za-z]:[\\/]/.test(p)) return false;
    if (p.indexOf(':', 2) !== -1) return false;
  } else if (!p.startsWith('/') || p.startsWith('//')) return false;
  if (ICON_UNSAFE_EXT.test(p.replace(/[\\/]+$/, ''))) return false;
  return true;
}

/** true si l'icône de ce chemin peut être demandée sans risque (pas réseau/amovible/.url/.lnk/.scf). */
export async function isIconSafePath(path: string): Promise<boolean> {
  try {
    // Vérifications sans accès disque d'abord : aucun accès à un chemin réseau.
    if (!iconQuickReason(path)) return false;
    const norm = normalizeSep(path);
    if (syntaxReason(norm)) return false;
    if (!(await isOnFixedDrive(norm))) return false;
    const rp = await realpathOrNull(norm);
    if (rp) {
      if (!iconQuickReason(rp) || syntaxReason(rp)) return false;
      return await isOnFixedDrive(rp);
    }
    // Certains exécutables protégés (ex. ESET en auto-protection) refusent GetFinalPathNameByHandle
    // tout en étant lisibles par lstat : on vérifie lstat (non-lien) + parent résolu sur disque fixe.
    const st = await fs.promises.lstat(norm);
    if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) return false;
    return true;
  } catch {
    return false;
  }
}

/** true si le chemin est dans le dossier personnel (ou égal). */
export function isInHome(p: string): boolean {
  return isSameOrInside(p, os.homedir());
}

export { getDrives, cachedDrives, driveForPath, isOnFixedDrive, systemDriveLetter } from './drives';
export { getProtection, protectedReason, syntaxReason } from './rules';
export * as paths from './paths';
