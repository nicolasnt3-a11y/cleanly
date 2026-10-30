/** Utilitaires communs aux services système (hachage d'ids, concurrence, délais, lignes de commande). */
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

/** Identifiant opaque court, conforme à OPAQUE_ID (préfixe + 20 hex). */
export function opaqueId(prefix: string, ...parts: string[]): string {
  const h = createHash('sha256').update(parts.join('\u0000').toLowerCase()).digest('hex').slice(0, 20);
  return `${prefix}:${h}`;
}

/** Résout `p` ou `fallback` si la promesse dépasse `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

/** map asynchrone avec concurrence limitée (l'ordre est conservé). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Développe les variables %VAR% (Windows) ; les variables inconnues restent telles quelles. */
export function expandEnv(s: string): string {
  return s.replace(/%([^%\s]+)%/g, (m, name: string) => process.env[name] ?? m);
}

/** true si le texte contient un caractère de contrôle (dont retours à la ligne). */
export function hasControlChars(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(s);
}

/**
 * Sépare une ligne de commande Windows en exécutable + arguments.
 * Gère la forme entre guillemets et la forme sans guillemets contenant des espaces (« C:\Program Files\x.exe -a »).
 */
export function splitCommandLine(cmd: string): { exe: string; args: string } | null {
  const s = expandEnv(cmd.trim());
  if (!s) return null;
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    if (end < 0) return null;
    return { exe: s.slice(1, end), args: s.slice(end + 1).trim() };
  }
  const m = /^(.*?\.(?:exe|com|bat|cmd))(?=\s|$)/i.exec(s);
  if (m?.[1]) return { exe: m[1], args: s.slice(m[1].length).trim() };
  const sp = s.search(/\s/);
  return sp < 0 ? { exe: s, args: '' } : { exe: s.slice(0, sp), args: s.slice(sp + 1).trim() };
}

/** Chemin absolu local de type « X:\… » (pas d'UNC, pas de préfixe \\?\). */
export function isDriveAbsolute(p: string): boolean {
  return /^[A-Za-z]:\\/.test(p) && !p.startsWith('\\\\');
}

/** Résout un exécutable « nu » (rundll32.exe, msiexec.exe…) dans System32 uniquement. */
export function resolveBareSystemExe(exe: string): string {
  if (isDriveAbsolute(exe) || /[\\/]/.test(exe)) return exe;
  const root = process.env.SystemRoot || 'C:\\Windows';
  return path.win32.join(root, 'System32', exe);
}

/**
 * Taille d'un dossier (lstat, sans suivre les liens/jonctions), limitée dans le temps.
 * Renvoie undefined si le délai est dépassé (résultat partiel non fiable).
 */
export async function dirSize(root: string, deadline: number): Promise<number | undefined> {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    if (Date.now() > deadline) return undefined;
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try {
          const st = await fsp.lstat(full);
          if (st.isFile()) total += st.size;
        } catch {
          /* fichier inaccessible : ignoré */
        }
      }
    }
  }
  return total;
}

/** Heuristique d'impact au démarrage : liste d'applications connues comme lourdes, sinon taille de l'exécutable. */
const HEAVY = [
  'teams', 'onedrive', 'steam', 'discord', 'epicgameslauncher', 'battle.net', 'creative cloud', 'adobe desktop service',
  'dropbox', 'spotify', 'docker desktop', 'skype', 'googledrivefs', 'icloud', 'origin', 'eadesktop', 'ubisoft', 'upc.exe',
  'zoom', 'slack', 'lm studio', 'filmora', 'nvidia', 'razer', 'armoury', 'logioptions', 'corsair', 'googleupdate',
];
const LIGHT = ['securityhealthsystray', 'rtkaudservice', 'rtkauduservice', 'ctfmon', 'keepass'];

export function estimateImpact(command: string, exeSize: number | undefined): 'high' | 'medium' | 'low' | 'unknown' {
  const c = command.toLowerCase();
  if (HEAVY.some((k) => c.includes(k))) return 'high';
  if (LIGHT.some((k) => c.includes(k))) return 'low';
  if (exeSize === undefined) return 'unknown';
  if (exeSize >= 40 * 1024 * 1024) return 'high';
  if (exeSize >= 5 * 1024 * 1024) return 'medium';
  return 'low';
}
