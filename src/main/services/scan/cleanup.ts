/**
 * Smart Scan des catégories de nettoyage et exécution du nettoyage.
 * Le nettoyage REDÉRIVE toujours les emplacements à partir des identifiants de catégorie ;
 * les éléments décochés (ids opaques) ne peuvent que RETIRER des chemins.
 */
import fs from 'node:fs';
import type { CleanCategory, CleanCategoryId, CleanRequest, CleanResult, ScanItem, Settings } from '../../../../shared/types';
import {
  errCode, getProtection, isAccessDenied, realpathOrNull, resolveAllowedRoots, rmdirIfEmptyChecked, syntaxReason,
  trashValidated, unlinkFileChecked, validateForDeletion,
} from '../../safety/index';
import { IS_MAC, IS_WIN, baseName, isSameOrInside, isStrictlyInside, joinChild, key } from '../../safety/paths';
import { run, runPowerShell } from '../../util/exec';
import type { ServiceContext } from '../context';
import { type CategoryDef, type Location, deriveCategory, platformCategories } from './locations';
import { type CachedItem, Limiter, getScan, mapLimit, newId, putScan, throttledProgress } from './util';
import { walk } from './walk';

const SCAN_BUDGET_MS = 45_000;
const TOP_ITEMS = 50;

const MAC_TRASH_FDA =
  'Accès refusé à la Corbeille : autorisez « Accès complet au disque » pour Cleanly dans Réglages Système › Confidentialité et sécurité.';
const ADMIN_NEEDED = 'Droits administrateur requis pour analyser cet emplacement.';

/**
 * Une racine de catégorie est acceptable si elle est strictement dans le dossier personnel, ou
 * dans l'un des sous-arbres système explicitement autorisés (Windows\Temp, WER…).
 * La Corbeille (lecture seule) n'est pas concernée.
 */
async function rootIsSane(root: string): Promise<boolean> {
  if (syntaxReason(root)) return false;
  const prot = await getProtection();
  if (isStrictlyInside(root, prot.home)) return true;
  return prot.allowedWithin.some((a) => isSameOrInside(root, a));
}

/** Clés (realpath) des sous-arbres à exclure d'un emplacement. */
async function excludeKeys(loc: Location): Promise<Set<string>> {
  const out = new Set<string>();
  for (const e of loc.exclude ?? []) {
    out.add(key(e));
    const rp = await realpathOrNull(e);
    if (rp) out.add(key(rp));
  }
  return out;
}

/* ─────────────────────────── $I de la Corbeille ─────────────────────────── */

/** Lit un fichier $I (métadonnées de la Corbeille Windows) : chemin d'origine et taille. */
async function readRecycleInfo(p: string): Promise<{ originalPath: string; size: number; deletedAt: number } | null> {
  try {
    const buf = await fs.promises.readFile(p);
    if (buf.length < 24) return null;
    const version = Number(buf.readBigInt64LE(0));
    const size = Number(buf.readBigInt64LE(8));
    const filetime = buf.readBigInt64LE(16);
    const deletedAt = Number(filetime / 10_000n) - 11_644_473_600_000;
    let name = '';
    if (version === 2 && buf.length >= 28) {
      const len = buf.readUInt32LE(24);
      name = buf.toString('utf16le', 28, Math.min(buf.length, 28 + len * 2));
    } else if (version === 1) {
      name = buf.toString('utf16le', 24, Math.min(buf.length, 24 + 520));
    }
    name = name.replace(/\0.*$/s, '');
    return name ? { originalPath: name, size, deletedAt } : null;
  } catch {
    return null;
  }
}

/* ───────────────────────────── Analyse ───────────────────────────── */

interface Measure {
  sizeBytes: number;
  fileCount: number;
  lockedCount: number;
  recentSkippedCount: number;
  items: Map<string, ScanItem & { root: string }>;
  rootDenied: boolean;
  truncated: boolean;
}

interface MeasureHooks {
  signal: AbortSignal;
  limiter: Limiter;
  deadline?: number;
  onFile?: (path: string, size: number) => void;
}

/** Mesure (lecture seule) une catégorie : tailles, fichiers comptés, éléments principaux. */
async function measureCategory(def: CategoryDef, h: MeasureHooks): Promise<Measure> {
  const m: Measure = { sizeBytes: 0, fileCount: 0, lockedCount: 0, recentSkippedCount: 0, items: new Map(), rootDenied: false, truncated: false };
  const now = Date.now();
  const recycleInfo = new Map<string, { originalPath: string; size: number; deletedAt: number }>();

  for (const loc of def.locations) {
    const [root] = await resolveAllowedRoots([loc.root]);
    if (!root) continue;
    if (def.mode !== 'empty-bin' && !(await rootIsSane(root))) continue;
    const excluded = await excludeKeys(loc);
    const isRecycle = IS_WIN && def.id === 'recycle-bin';

    const outcome = await walk(root, {
      signal: h.signal,
      limiter: h.limiter,
      deadline: h.deadline,
      enterDir: (p) => !excluded.has(key(p)),
      onError: (_p, err) => {
        if (errCode(err) !== 'ENOENT') m.lockedCount++;
      },
      onFile: async (p, st, top, depth) => {
        if (excluded.has(key(p))) return;
        if (isRecycle && depth === 0 && baseName(p).startsWith('$I')) {
          const info = await readRecycleInfo(p);
          if (info) recycleInfo.set(key(joinChild(root, '$R' + baseName(p).slice(2))), info);
        }
        if (def.minAgeMs > 0 && now - st.mtimeMs < def.minAgeMs) {
          if (def.mode === 'permanent') m.recentSkippedCount++;
          return;
        }
        m.sizeBytes += st.size;
        m.fileCount++;
        h.onFile?.(p, st.size);
        const itemPath = loc.itemize === 'self' ? root : top;
        const k = key(itemPath);
        let it = m.items.get(k);
        if (!it) {
          it = { id: '', path: itemPath, name: baseName(itemPath), sizeBytes: 0, modifiedAt: 0, isDirectory: loc.itemize === 'self' || itemPath !== p, root };
          m.items.set(k, it);
        }
        it.sizeBytes += st.size;
        it.modifiedAt = Math.max(it.modifiedAt, Math.round(st.mtimeMs));
      },
    });
    if (outcome.truncated) m.truncated = true;
    if (outcome.rootError && isAccessDenied(outcome.rootError)) m.rootDenied = true;
  }

  // Corbeille Windows : afficher le nom d'origine plutôt que « $R… » ; masquer les « $I… ».
  if (recycleInfo.size || (IS_WIN && def.id === 'recycle-bin')) {
    for (const [k, it] of m.items) {
      if (it.name.startsWith('$I')) {
        m.items.delete(k);
        continue;
      }
      const info = recycleInfo.get(k);
      if (info) {
        it.name = baseName(info.originalPath);
        it.modifiedAt = info.deletedAt > 0 ? info.deletedAt : it.modifiedAt;
      }
    }
  }
  return m;
}

/** Analyse les catégories de nettoyage de l'OS courant. */
export async function scanCleanupCategories(ctx: ServiceContext): Promise<{ scanId: string; categories: CleanCategory[] }> {
  const scanId = newId('scan');
  const settings = await ctx.settings();
  const ids = platformCategories();
  const limiter = new Limiter(48);
  const deadline = Date.now() + SCAN_BUDGET_MS;
  const progress = throttledProgress(ctx);
  const cacheItems = new Map<string, CachedItem>();
  let bytesFound = 0;
  let visited = 0;
  let done = 0;
  let currentPath: string | undefined;

  const emit = (force = false) =>
    progress(
      { task: 'smart-scan', phase: 'cleanup', fraction: Math.min(0.9, (done / Math.max(1, ids.length)) * 0.9), currentPath, bytesFound, itemsVisited: visited },
      force,
    );

  const categories = await mapLimit(ids, 4, async (id): Promise<CleanCategory> => {
    let def: CategoryDef | null = null;
    try {
      def = await deriveCategory(id, settings);
    } catch {
      def = null;
    }
    const empty = (extra: Partial<CleanCategory>): CleanCategory => ({
      id, label: def?.label ?? id, description: def?.description ?? '', mode: def?.mode ?? 'permanent',
      sizeBytes: 0, fileCount: 0, topItems: [], lockedCount: 0, recentSkippedCount: 0,
      requiresAdmin: def?.requiresAdmin ?? false, defaultSelected: def?.defaultSelected ?? false, ...extra,
    });
    if (!def) return empty({ error: 'Catégorie indisponible.' });
    if (ctx.signal.aborted) return empty({});
    try {
      const m = await measureCategory(def, {
        signal: ctx.signal, limiter, deadline,
        onFile: (p, size) => {
          bytesFound += size;
          visited++;
          currentPath = p;
          emit();
        },
      });
      const top = [...m.items.values()].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, TOP_ITEMS);
      const topItems: ScanItem[] = top.map((it) => {
        const itemId = newId('it');
        cacheItems.set(itemId, { path: it.path, sizeBytes: it.sizeBytes, isDirectory: it.isDirectory, categoryId: id, root: it.root });
        return { id: itemId, path: it.path, name: it.name, sizeBytes: it.sizeBytes, modifiedAt: it.modifiedAt, isDirectory: it.isDirectory };
      });
      let error = def.error;
      if (m.rootDenied && m.fileCount === 0) {
        if (def.id === 'mac-trash') error = MAC_TRASH_FDA;
        else if (def.requiresAdmin || def.locations.every((l) => l.admin)) error = ADMIN_NEEDED;
      }
      return empty({
        sizeBytes: m.sizeBytes, fileCount: m.fileCount, topItems, lockedCount: m.lockedCount,
        recentSkippedCount: m.recentSkippedCount, error,
      });
    } catch (err) {
      return empty({ error: 'Analyse impossible : ' + (err instanceof Error ? err.message : String(err)) });
    } finally {
      done++;
      emit(true);
    }
  });

  putScan(scanId, { kind: 'clean', createdAt: Date.now(), items: cacheItems });
  return { scanId, categories };
}

/* ───────────────────────────── Nettoyage ───────────────────────────── */

interface Tally {
  freed: number;
  deleted: number;
  trashed: number;
  locked: number;
  recent: number;
  unsafe: number;
  denied: number;
}

const DAY = 24 * 3600 * 1000;

async function cleanPermanent(def: CategoryDef, userExcluded: Set<string>, ctx: ServiceContext, t: Tally, onProgress: (p: string) => void): Promise<boolean> {
  const limiter = new Limiter(16);
  let needsAdmin = false;
  const minAge = Math.max(def.minAgeMs, DAY); // règle des 24 h pour TOUTE catégorie permanente
  for (const loc of def.locations) {
    if (ctx.signal.aborted) break;
    if (userExcluded.has(key(loc.root))) continue;
    const roots = await resolveAllowedRoots([loc.root]);
    const root = roots[0];
    if (!root || !(await rootIsSane(root))) continue;
    if (userExcluded.has(key(root))) continue;
    const excluded = await excludeKeys(loc);
    for (const k of userExcluded) excluded.add(k);
    let deletedHere = 0;
    let deniedHere = 0;

    const outcome = await walk(root, {
      signal: ctx.signal,
      limiter,
      enterDir: (p) => !excluded.has(key(p)),
      onError: (_p, err) => {
        if (errCode(err) === 'ENOENT') return;
        t.locked++;
        if (isAccessDenied(err)) deniedHere++;
      },
      onFile: (p) =>
        limiter.run(async () => {
          if (excluded.has(key(p)) || ctx.signal.aborted) return;
          const r = await unlinkFileChecked(p, roots, minAge);
          switch (r.kind) {
            case 'deleted':
              t.freed += r.bytes;
              t.deleted++;
              deletedHere++;
              onProgress(p);
              break;
            case 'locked':
              t.locked++;
              if (r.accessDenied) deniedHere++;
              break;
            case 'recent':
              t.recent++;
              break;
            case 'unsafe':
              t.unsafe++;
              break;
            case 'gone':
              break;
          }
        }),
      // Dossiers vidés : suppression de bas en haut, jamais la racine, seulement s'ils ont plus de 24 h.
      afterDir: async (p) => {
        if (excluded.has(key(p))) return;
        try {
          const st = await fs.promises.lstat(p);
          if (Date.now() - (st.birthtimeMs || st.mtimeMs) < minAge) return;
        } catch {
          return;
        }
        await rmdirIfEmptyChecked(p, roots);
      },
    });
    if (outcome.rootError && isAccessDenied(outcome.rootError)) deniedHere++;
    if (loc.admin && deletedHere === 0 && deniedHere > 0) needsAdmin = true;
    t.denied += deniedHere;
  }
  return needsAdmin;
}

async function cleanTrash(def: CategoryDef, userExcluded: Set<string>, ctx: ServiceContext, t: Tally, onProgress: (p: string) => void): Promise<void> {
  const limiter = new Limiter(4);
  const now = Date.now();
  for (const loc of def.locations) {
    if (userExcluded.has(key(loc.root))) continue;
    const roots = await resolveAllowedRoots([loc.root]);
    const root = roots[0];
    if (!root || !(await rootIsSane(root)) || userExcluded.has(key(root))) continue;
    const excluded = await excludeKeys(loc);
    for (const k of userExcluded) excluded.add(k);

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch (err) {
      if (errCode(err) !== 'ENOENT') t.locked++;
      continue;
    }

    await mapLimit(entries, 4, async (e) => {
      if (ctx.signal.aborted) return;
      if (e.isSymbolicLink()) return; // jamais suivre un lien / une jonction
      const childPath = joinChild(root, e.name);
      if (excluded.has(key(childPath))) return;

      if (e.isFile()) {
        let st: fs.Stats;
        try {
          st = await fs.promises.lstat(childPath);
        } catch (err) {
          if (errCode(err) !== 'ENOENT') t.locked++;
          return;
        }
        if (!st.isFile() || st.isSymbolicLink()) return;
        if (now - st.mtimeMs < def.minAgeMs) return;
        const v = await validateForDeletion(childPath, { allowedRoots: [root], mode: 'trash' });
        if (!v.ok) {
          t.unsafe++;
          return;
        }
        const r = await trashValidated(v.realPath, st.size);
        if (r.ok) {
          t.trashed++;
          t.freed += r.bytes;
          onProgress(childPath);
        } else t.locked++;
        return;
      }

      if (e.isDirectory()) {
        // Pour un sous-dossier, s'il ne contient QUE des fichiers anciens (aucun fichier récent ni lien),
        // on met le sous-dossier entier à la Corbeille en une seule opération atomique ;
        // sinon on parcourt uniquement les fichiers éligibles.
        let dirTotalBytes = 0;
        let dirFileCount = 0;
        let hasRecentOrExcluded = false;
        let hasSymlink = false;
        const oldFiles: Array<{ path: string; size: number }> = [];

        try {
          const entriesCheck = await fs.promises.readdir(childPath, { withFileTypes: true });
          if (entriesCheck.some((x) => x.isSymbolicLink())) hasSymlink = true;
        } catch {
          /* géré par walk */
        }

        await walk(childPath, {
          signal: ctx.signal,
          limiter: new Limiter(16),
          enterDir: (p) => {
            if (excluded.has(key(p))) {
              hasRecentOrExcluded = true;
              return false;
            }
            return true;
          },
          onError: (_p, err) => {
            if (errCode(err) !== 'ENOENT') {
              t.locked++;
              hasRecentOrExcluded = true;
            }
          },
          onFile: (p, st) => {
            if (excluded.has(key(p))) {
              hasRecentOrExcluded = true;
              return;
            }
            if (now - st.mtimeMs < def.minAgeMs) {
              hasRecentOrExcluded = true;
              return;
            }
            dirTotalBytes += st.size;
            dirFileCount++;
            oldFiles.push({ path: p, size: st.size });
          },
        });

        if (ctx.signal.aborted || dirFileCount === 0) return;

        if (!hasRecentOrExcluded && !hasSymlink) {
          const v = await validateForDeletion(childPath, { allowedRoots: [root], mode: 'trash' });
          if (!v.ok) {
            t.unsafe++;
            return;
          }
          const r = await trashValidated(v.realPath, dirTotalBytes);
          if (r.ok) {
            t.trashed += dirFileCount;
            t.freed += r.bytes;
            onProgress(childPath);
          } else t.locked++;
        } else {
          for (const f of oldFiles) {
            if (ctx.signal.aborted) break;
            const v = await validateForDeletion(f.path, { allowedRoots: [root], mode: 'trash' });
            if (!v.ok) {
              t.unsafe++;
              continue;
            }
            const r = await trashValidated(v.realPath, f.size);
            if (r.ok) {
              t.trashed++;
              t.freed += r.bytes;
              onProgress(f.path);
            } else t.locked++;
          }
        }
      }
    });
  }
}

async function emptyBin(def: CategoryDef, ctx: ServiceContext, t: Tally, errors: string[]): Promise<void> {
  const limiter = new Limiter(32);
  const before = await measureCategory(def, { signal: ctx.signal, limiter });
  if (ctx.signal.aborted) return;
  if (IS_MAC && before.rootDenied) {
    errors.push(MAC_TRASH_FDA);
    return;
  }
  if (IS_WIN) {
    const r = await runPowerShell('try { Clear-RecycleBin -Force -ErrorAction SilentlyContinue } catch { }', { timeoutMs: 180_000 });
    if (r.timedOut || r.spawnError) errors.push('Le vidage de la Corbeille n’a pas abouti.');
  } else if (IS_MAC) {
    const r = await run('/usr/bin/osascript', ['-e', 'tell application "Finder" to empty trash'], { timeoutMs: 180_000 });
    if (r.code !== 0) errors.push('Le Finder n’a pas pu vider la Corbeille (autorisation d’automatisation refusée ?).');
  }
  const after = await measureCategory(def, { signal: new AbortController().signal, limiter });
  t.freed += Math.max(0, before.sizeBytes - after.sizeBytes);
  t.deleted += Math.max(0, before.fileCount - after.fileCount);
  if (after.fileCount > 0) t.locked += after.fileCount; // éléments restés dans la Corbeille
}

/** Nettoie les catégories demandées en REDÉRIVANT leurs emplacements. */
export async function runClean(req: CleanRequest, ctx: ServiceContext): Promise<CleanResult> {
  const t: Tally = { freed: 0, deleted: 0, trashed: 0, locked: 0, recent: 0, unsafe: 0, denied: 0 };
  const errors: string[] = [];
  const needsAdmin: CleanCategoryId[] = [];
  const result = (): CleanResult => ({
    freedBytes: t.freed, deletedCount: t.deleted, trashedCount: t.trashed, lockedCount: t.locked,
    recentSkippedCount: t.recent, unsafeRejectedCount: t.unsafe, needsAdminCategoryIds: needsAdmin, errors,
  });

  const scan = getScan(req.scanId);
  if (!scan || scan.kind !== 'clean') {
    errors.push('Analyse introuvable ou expirée : relancez une analyse avant de nettoyer.');
    return result();
  }
  // Exclusions : ids → chemins issus de NOTRE cache. Un id inconnu bloque tout (on ne peut pas l'honorer).
  const excludedByCategory = new Map<CleanCategoryId, Set<string>>();
  const allExcluded = new Set<string>();
  for (const itemId of req.excludedItemIds ?? []) {
    const it = scan.items.get(itemId);
    if (!it || !it.categoryId) {
      errors.push('Un élément décoché est inconnu : nettoyage annulé par précaution. Relancez une analyse.');
      return result();
    }
    const k = key(it.path);
    allExcluded.add(k);
    let s = excludedByCategory.get(it.categoryId);
    if (!s) excludedByCategory.set(it.categoryId, (s = new Set()));
    s.add(k);
    const rp = await realpathOrNull(it.path);
    if (rp) {
      allExcluded.add(key(rp));
      s.add(key(rp));
    }
  }

  let settings: Settings;
  try {
    settings = await ctx.settings();
  } catch {
    errors.push('Paramètres illisibles.');
    return result();
  }

  const progress = throttledProgress(ctx);
  const total = req.categoryIds.length;
  let index = 0;
  let current: string | undefined;
  const onProgress = (p: string) => {
    current = p;
    progress({ task: 'clean', phase: 'deleting', fraction: Math.min(0.99, index / Math.max(1, total)), currentPath: current, bytesFound: t.freed, itemsVisited: t.deleted + t.trashed });
  };

  for (const id of req.categoryIds) {
    if (ctx.signal.aborted) {
      errors.push('Nettoyage interrompu.');
      break;
    }
    onProgress(current ?? '');
    const def = await deriveCategory(id, settings).catch(() => null);
    if (!def) {
      errors.push(`Catégorie « ${id} » indisponible sur ce système.`);
      index++;
      continue;
    }
    try {
      const catExcluded = excludedByCategory.get(id) ?? new Set<string>();
      if (def.mode === 'permanent') {
        if (await cleanPermanent(def, catExcluded, ctx, t, onProgress)) needsAdmin.push(id);
      } else if (def.mode === 'trash') {
        await cleanTrash(def, catExcluded, ctx, t, onProgress);
      } else if (catExcluded.size) {
        // Impossible de vider partiellement la Corbeille : on ne touche à rien.
        errors.push(`${def.label} : des éléments ont été décochés, la Corbeille n’a pas été vidée.`);
      } else {
        await emptyBin(def, ctx, t, errors);
      }
    } catch (err) {
      errors.push(`${def.label} : ${err instanceof Error ? err.message : String(err)}`);
    }
    index++;
  }
  ctx.progress({ task: 'clean', phase: 'deleting', fraction: 1, bytesFound: t.freed, itemsVisited: t.deleted + t.trashed });
  return result();
}
