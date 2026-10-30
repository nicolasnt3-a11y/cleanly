/**
 * Lecture du registre Windows via reg.exe (sortie en page de codes OEM) et
 * encodage des valeurs StartupApproved (format identique au Gestionnaire des tâches).
 */
import { regExePath, run } from '../../util/exec';

export interface RegValue {
  name: string;
  type: string;
  data: string;
}

export interface RegKey {
  /** Chemin complet tel qu'affiché par reg.exe (HKEY_LOCAL_MACHINE\…). */
  path: string;
  values: RegValue[];
}

const VALUE_LINE = /^ {4}(.*?) {4}(REG_[A-Z0-9_]+)(?: {4}(.*))?$/;

/** Analyse la sortie de `reg query` (avec ou sans /s) en clés et valeurs. */
export function parseRegQuery(output: string): RegKey[] {
  const keys: RegKey[] = [];
  let cur: RegKey | null = null;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (/^HKEY_[A-Z_]+(\\|$)/.test(line)) {
      cur = { path: line.trim(), values: [] };
      keys.push(cur);
      continue;
    }
    const m = VALUE_LINE.exec(line);
    if (m && cur) cur.values.push({ name: m[1] ?? '', type: m[2] ?? '', data: m[3] ?? '' });
  }
  return keys;
}

/** Valeur par défaut non définie (« (Default) » / « (par défaut) » → « (value not set) »). */
export function isUnsetDefault(v: RegValue): boolean {
  return /^\(.*\)$/.test(v.name) && /^\(.*\)$/.test(v.data);
}

/** Nom localisé de la valeur par défaut (impossible à distinguer avec certitude : on le traite comme tel). */
export function looksLikeDefaultName(name: string): boolean {
  return /^\(.*\)$/.test(name);
}

/** Interroge une clé. `wow64` force la vue 64 bits pour HKLM. Renvoie [] si la clé n'existe pas. */
export async function regQuery(key: string, opts: { recursive?: boolean; view64?: boolean; timeoutMs?: number } = {}): Promise<RegKey[]> {
  const args = ['query', key];
  if (opts.recursive) args.push('/s');
  if (opts.view64) args.push('/reg:64');
  const r = await run(regExePath(), args, { encoding: 'oem', timeoutMs: opts.timeoutMs ?? 20_000 });
  if (r.code !== 0 || r.timedOut) return [];
  return parseRegQuery(r.stdout);
}

/** Valeurs d'une seule clé (sans sous-clés). */
export async function regValues(key: string, view64 = true): Promise<RegValue[]> {
  const keys = await regQuery(key, { view64 });
  const norm = (s: string): string => s.toLowerCase().replace(/\\+$/, '');
  const target = norm(expandHive(key));
  return keys.find((k) => norm(k.path) === target)?.values ?? keys[0]?.values ?? [];
}

/** HKLM\… → HKEY_LOCAL_MACHINE\… (forme affichée par reg.exe). */
export function expandHive(key: string): string {
  return key.replace(/^HKLM(?=\\|$)/i, 'HKEY_LOCAL_MACHINE').replace(/^HKCU(?=\\|$)/i, 'HKEY_CURRENT_USER');
}

export function dword(v: RegValue | undefined): number | undefined {
  if (!v) return undefined;
  const n = v.type === 'REG_DWORD' || v.type === 'REG_QWORD' ? Number.parseInt(v.data, 16) : Number(v.data);
  return Number.isFinite(n) ? n : undefined;
}

export function valueOf(values: RegValue[], name: string): RegValue | undefined {
  const n = name.toLowerCase();
  return values.find((v) => v.name.toLowerCase() === n);
}

/* ───────────── StartupApproved ───────────── */

/** Valeur « activé » écrite par le Gestionnaire des tâches. */
export const APPROVED_ENABLED_HEX = '020000000000000000000000';

/** Valeur « désactivé » : 03 00 00 00 + FILETIME (little-endian) de l'instant. */
export function approvedDisabledHex(now: number = Date.now()): string {
  const ft = (BigInt(Math.floor(now)) + 11_644_473_600_000n) * 10_000n;
  const buf = Buffer.alloc(12);
  buf.writeUInt32LE(3, 0);
  buf.writeBigUInt64LE(ft, 4);
  return buf.toString('hex').toUpperCase();
}

/** Valeur absente ou premier octet pair → activé ; impair → désactivé. */
export function approvedIsEnabled(v: RegValue | undefined): boolean {
  if (!v || v.type !== 'REG_BINARY') return true;
  const first = Number.parseInt(v.data.slice(0, 2), 16);
  if (!Number.isFinite(first)) return true;
  return first % 2 === 0;
}
