/** Utilitaires de chemins purs (aucun accès disque) partagés par la sécurité et les scans. */
import fs from 'node:fs';
import path from 'node:path';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';

/** Séparateur natif. */
export const SEP = IS_WIN ? '\\' : '/';

/** Normalise les séparateurs et retire le séparateur final (sauf pour une racine). */
export function normalizeSep(p: string): string {
  let s = IS_WIN ? p.replace(/\//g, '\\') : p;
  while (s.length > 1 && s.endsWith(SEP) && !isDriveRootSyntax(s)) s = s.slice(0, -1);
  return s;
}

/** « C:\ », « C: » ou « / ». */
export function isDriveRootSyntax(p: string): boolean {
  if (IS_WIN) return /^[A-Za-z]:[\\/]?$/.test(p);
  return p === '/';
}

/**
 * Clé de comparaison : séparateurs normalisés, insensible à la casse sous Windows
 * et macOS (APFS/HFS+ sont insensibles à la casse par défaut — plus strict pour les refus).
 */
export function key(p: string): string {
  const s = normalizeSep(p);
  return IS_WIN || IS_MAC ? s.toLowerCase() : s;
}

/** true si `child` est STRICTEMENT à l'intérieur de `parent`. */
export function isStrictlyInside(child: string, parent: string): boolean {
  const c = key(child);
  let pk = key(parent);
  if (!pk.endsWith(SEP)) pk += SEP;
  return c.length > pk.length && c.startsWith(pk);
}

/** true si `child` est égal à `parent` ou à l'intérieur. */
export function isSameOrInside(child: string, parent: string): boolean {
  return key(child) === key(parent) || isStrictlyInside(child, parent);
}

export function samePath(a: string, b: string): boolean {
  return key(a) === key(b);
}

/** Joint un dossier et un nom d'entrée (sans normalisation susceptible de remonter). */
export function joinChild(dir: string, name: string): string {
  return dir.endsWith(SEP) ? dir + name : dir + SEP + name;
}

/** Segments non vides d'un chemin. */
export function segments(p: string): string[] {
  return normalizeSep(p).split(/[\\/]/).filter((s) => s.length > 0);
}

export function baseName(p: string): string {
  return path.basename(normalizeSep(p)) || p;
}

/** Lettre de lecteur en majuscules avec deux-points (« C: »), ou null. */
export function driveOf(p: string): string | null {
  const m = /^([A-Za-z]):/.exec(p);
  return m?.[1] ? m[1].toUpperCase() + ':' : null;
}

/** Développe %VAR% à partir de l'environnement (insensible à la casse). */
export function expandWinEnv(s: string): string {
  return s.replace(/%([^%]+)%/g, (whole, name: string) => {
    const k = Object.keys(process.env).find((e) => e.toLowerCase() === name.toLowerCase());
    const v = k ? process.env[k] : undefined;
    return v ?? whole;
  });
}

/** Variable d'environnement (insensible à la casse sous Windows). */
export function env(name: string): string | undefined {
  const v = process.env[name];
  if (v !== undefined || !IS_WIN) return v || undefined;
  const k = Object.keys(process.env).find((e) => e.toLowerCase() === name.toLowerCase());
  return (k && process.env[k]) || undefined;
}

/**
 * realpath natif (GetFinalPathNameByHandle / realpath(3)) : développe les noms courts 8.3 et
 * résout jonctions et liens. `fs.promises.realpath` a déjà la sémantique de `fs.realpath.native`.
 */
export function realpathNative(p: string): Promise<string> {
  return fs.promises.realpath(p);
}
