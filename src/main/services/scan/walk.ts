/**
 * Parcours récursif SANS suivre les liens symboliques ni les jonctions (libuv les signale
 * comme liens) : readdir + lstat, concurrence bornée, annulation et budget de temps.
 */
import fs from 'node:fs';
import { joinChild } from '../../safety/paths';
import type { Limiter } from './util';

export interface WalkOptions {
  signal: AbortSignal;
  limiter: Limiter;
  /** Horodatage limite (ms) : au-delà, le parcours s'arrête (résultat partiel). */
  deadline?: number;
  /** Appelé avant de descendre dans un dossier ; false = ignorer ce sous-arbre. */
  enterDir?: (path: string, name: string, depth: number) => boolean;
  /** Appelé pour chaque fichier ordinaire. `top` = chemin de l'ancêtre de profondeur 0. */
  onFile: (path: string, st: fs.Stats, top: string, depth: number) => void | Promise<void>;
  /** Appelé après le parcours complet d'un dossier (hors racine). */
  afterDir?: (path: string, top: string, depth: number) => void | Promise<void>;
  /** Erreur de lecture (accès refusé, verrouillé…). */
  onError?: (path: string, err: unknown) => void;
}

export interface WalkOutcome {
  /** true si interrompu (annulation ou budget de temps). */
  truncated: boolean;
  /** Erreur sur la racine elle-même (ex. EPERM), sinon null. */
  rootError: unknown;
}

export async function walk(root: string, o: WalkOptions): Promise<WalkOutcome> {
  const out: WalkOutcome = { truncated: false, rootError: null };
  const stop = (): boolean => {
    if (o.signal.aborted || (o.deadline !== undefined && Date.now() > o.deadline)) {
      out.truncated = true;
      return true;
    }
    return false;
  };

  async function visit(dir: string, depth: number, top: string): Promise<void> {
    if (stop()) return;
    let entries: fs.Dirent[];
    try {
      entries = await o.limiter.run(() => fs.promises.readdir(dir, { withFileTypes: true }));
    } catch (err) {
      if (depth === 0) out.rootError = err;
      o.onError?.(dir, err);
      return;
    }
    const subs: Promise<void>[] = [];
    const files: Promise<void>[] = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue; // liens et jonctions : jamais suivis
      const p = joinChild(dir, e.name);
      const t = depth === 0 ? p : top;
      if (e.isDirectory()) {
        if (o.enterDir && !o.enterDir(p, e.name, depth)) continue;
        subs.push(
          visit(p, depth + 1, t).then(async () => {
            if (o.afterDir && !stop()) await o.afterDir(p, t, depth);
          }),
        );
      } else if (e.isFile()) {
        files.push(
          o.limiter
            .run(() => fs.promises.lstat(p))
            .then(
              async (st) => {
                if (st.isSymbolicLink() || !st.isFile() || stop()) return;
                await o.onFile(p, st, t, depth);
              },
              (err: unknown) => o.onError?.(p, err),
            ),
        );
      }
    }
    await Promise.all(files);
    await Promise.all(subs);
  }

  await visit(root, 0, root);
  return out;
}
