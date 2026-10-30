/**
 * Fichiers volumineux, doublons (taille → empreinte partielle → empreinte SHA-256 complète)
 * et envoi sécurisé à la Corbeille.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DuplicateGroup,
  DuplicatesRequest,
  DuplicatesResult,
  FileKind,
  LargeFilesRequest,
  LargeFilesResult,
  ScanItem,
  TrashItemsRequest,
  TrashItemsResult,
} from '../../../../shared/types';
import { errCode, protectedPathReason, resolveAllowedRoots, trashPath, unsafePathSyntax } from '../../safety/index';
import { baseName } from '../../safety/paths';
import type { ServiceContext } from '../context';
import { resolveSpaceRoot } from './spacemap';
import { AbortedError, type CachedItem, Limiter, getScan, mapLimit, newId, putScan, throttledProgress } from './util';
import { walk } from './walk';

const LARGE_BUDGET_MS = 25_000;
const DUP_BUDGET_MS = 45_000;
const PARTIAL_SLICE = 64 * 1024;

/* ─────────────────────────── Catégorie de fichier ─────────────────────────── */

const EXT_KIND: Record<string, FileKind> = {
  mp4: 'video', mkv: 'video', mov: 'video', avi: 'video', webm: 'video', m4v: 'video', wmv: 'video', flv: 'video', mpg: 'video', mpeg: 'video', m2ts: 'video', mts: 'video',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', heic: 'image', heif: 'image', tif: 'image', tiff: 'image', bmp: 'image', raw: 'image', cr2: 'image', nef: 'image', arw: 'image', dng: 'image', psd: 'image', svg: 'image',
  mp3: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', opus: 'audio', wma: 'audio', aiff: 'audio',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive', xz: 'archive', zst: 'archive', cab: 'archive',
  iso: 'disk-image', dmg: 'disk-image', img: 'disk-image', vhd: 'disk-image', vhdx: 'disk-image', vmdk: 'disk-image', vdi: 'disk-image', qcow2: 'disk-image', sparseimage: 'disk-image',
  exe: 'installer', msi: 'installer', msix: 'installer', appx: 'installer', pkg: 'installer', deb: 'installer', rpm: 'installer',
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document', ppt: 'document', pptx: 'document', odt: 'document', ods: 'document', odp: 'document', pages: 'document', numbers: 'document', key: 'document', txt: 'document', rtf: 'document', epub: 'document',
  js: 'code', ts: 'code', tsx: 'code', jsx: 'code', py: 'code', rs: 'code', go: 'code', java: 'code', kt: 'code', c: 'code', cpp: 'code', h: 'code', cs: 'code', swift: 'code', rb: 'code', php: 'code', json: 'code', yaml: 'code', yml: 'code', sql: 'code', db: 'code', sqlite: 'code', sqlite3: 'code',
};

export function classifyFile(p: string): FileKind {
  const ext = path.extname(p).slice(1).toLowerCase();
  return EXT_KIND[ext] ?? 'other';
}

/** Exclut les sous-arbres système protégés pendant les recherches utilisateur sur un disque entier. */
async function shouldEnterUserSearchDir(dirPath: string): Promise<boolean> {
  if (unsafePathSyntax(dirPath)) return false;
  const reason = await protectedPathReason(dirPath);
  // Les dossiers exacts (ex. Documents, Downloads, Desktop, Users) ont leur contenu autorisé :
  // seuls les sous-arbres système (Windows, Program Files, Corbeille, Keychains…) sont exclus.
  if (!reason) return true;
  return reason === 'Dossier système ou personnel protégé.' || reason === 'Dossier de profil utilisateur refusé.' || reason === 'Dossier personnel refusé.';
}

/* ─────────────────────────── Fichiers volumineux ─────────────────────────── */

export async function findLargeFiles(req: LargeFilesRequest, ctx: ServiceContext): Promise<LargeFilesResult> {
  const settings = await ctx.settings();
  const minBytes = req.minBytes ?? Math.max(10, settings.largeFileMinMb || 100) * 1_000_000;
  const limit = Math.min(5000, Math.max(1, req.limit ?? 200));
  const { path: rootPath } = await resolveSpaceRoot(req.root);
  const [allowedRoot] = await resolveAllowedRoots([rootPath]);
  if (!allowedRoot) throw new Error('Emplacement introuvable ou non autorisé.');

  const prot = await import('../../safety/rules').then((m) => m.getProtection());
  const blockedSubtrees = prot.subtrees;
  const { isSameOrInside } = await import('../../safety/paths');

  const limiter = new Limiter(48);
  const deadline = Date.now() + LARGE_BUDGET_MS;
  const progress = throttledProgress(ctx, 120);
  const found: Array<{ path: string; name: string; sizeBytes: number; modifiedAt: number; kind: FileKind }> = [];
  let skippedCount = 0;
  let visited = 0;
  let bytesFound = 0;

  await walk(allowedRoot, {
    signal: ctx.signal,
    limiter,
    deadline,
    enterDir: (p, name) => {
      const low = name.toLowerCase();
      if (low === '$recycle.bin' || low === 'system volume information' || low === '.trash' || low === 'node_modules' || low === '.git') return false;
      if (blockedSubtrees.some((s) => isSameOrInside(p, s))) return false;
      return true;
    },
    onError: (_p, err) => {
      if (errCode(err) !== 'ENOENT') skippedCount++;
    },
    onFile: (p, st) => {
      visited++;
      if (st.size < minBytes) {
        if (visited % 200 === 0) progress({ task: 'large-files', phase: 'walking', fraction: null, currentPath: p, bytesFound, itemsVisited: visited });
        return;
      }
      bytesFound += st.size;
      found.push({ path: p, name: baseName(p), sizeBytes: st.size, modifiedAt: Math.round(st.mtimeMs), kind: classifyFile(p) });
      // Élagage périodique pour borner la mémoire.
      if (found.length > limit * 4) {
        found.sort((a, b) => b.sizeBytes - a.sizeBytes);
        found.length = limit;
      }
      progress({ task: 'large-files', phase: 'walking', fraction: null, currentPath: p, bytesFound, itemsVisited: visited });
    },
  });

  if (ctx.signal.aborted) throw new AbortedError();
  found.sort((a, b) => b.sizeBytes - a.sizeBytes);
  const top = found.slice(0, limit);
  const scanId = newId('lg');
  const cacheItems = new Map<string, CachedItem>();
  const items: Array<ScanItem & { kind: FileKind }> = top.map((f) => {
    const id = newId('lf');
    cacheItems.set(id, { path: f.path, sizeBytes: f.sizeBytes, isDirectory: false, root: allowedRoot });
    return { id, path: f.path, name: f.name, sizeBytes: f.sizeBytes, modifiedAt: f.modifiedAt, isDirectory: false, kind: f.kind };
  });

  putScan(scanId, { kind: 'large', createdAt: Date.now(), items: cacheItems });
  ctx.progress({ task: 'large-files', phase: 'done', fraction: 1, bytesFound, itemsVisited: visited });
  return { scanId, items, skippedCount };
}

/* ─────────────────────────────── Doublons ─────────────────────────────── */

interface Candidate {
  path: string;
  size: number;
  mtime: number;
}

/** Empreinte partielle : premiers + derniers 64 Kio + taille (lecture directe sans charger tout le fichier). */
async function partialHash(p: string, size: number): Promise<string> {
  const fh = await fs.promises.open(p, 'r');
  try {
    const h = createHash('sha256');
    h.update(String(size) + ':');
    const len = Math.min(PARTIAL_SLICE, size);
    const buf = Buffer.allocUnsafe(len);
    const r1 = await fh.read(buf, 0, len, 0);
    h.update(buf.subarray(0, r1.bytesRead));
    if (size > PARTIAL_SLICE) {
      const tailOffset = Math.max(PARTIAL_SLICE, size - PARTIAL_SLICE);
      const tailLen = Math.min(PARTIAL_SLICE, size - tailOffset);
      const r2 = await fh.read(buf, 0, tailLen, tailOffset);
      h.update(buf.subarray(0, r2.bytesRead));
    }
    return h.digest('hex');
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** Empreinte SHA-256 complète en flux, annulable via `signal`. */
async function fullHash(p: string, expectedSize: number, signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortedError());
      return;
    }
    const h = createHash('sha256');
    let read = 0;
    const stream = fs.createReadStream(p, { highWaterMark: 256 * 1024 });
    const onAbort = () => {
      stream.destroy(new AbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    stream.on('data', (chunk: Buffer | string) => {
      const b = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      read += b.length;
      h.update(b);
    });
    stream.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
    stream.on('end', () => {
      signal.removeEventListener('abort', onAbort);
      if (read !== expectedSize) {
        reject(new Error('Fichier modifié pendant la lecture.'));
        return;
      }
      resolve(h.digest('hex'));
    });
  });
}

export async function findDuplicates(req: DuplicatesRequest, ctx: ServiceContext): Promise<DuplicatesResult> {
  const minBytes = Math.max(1, req.minBytes ?? 1_000_000);
  const { path: rootPath } = await resolveSpaceRoot(req.root);
  const [allowedRoot] = await resolveAllowedRoots([rootPath]);
  if (!allowedRoot) throw new Error('Emplacement introuvable ou non autorisé.');

  const prot = await import('../../safety/rules').then((m) => m.getProtection());
  const blockedSubtrees = prot.subtrees;
  const { isSameOrInside } = await import('../../safety/paths');

  const limiter = new Limiter(48);
  const deadline = Date.now() + DUP_BUDGET_MS;
  const progress = throttledProgress(ctx, 120);
  const bySize = new Map<number, Candidate[]>();
  let skippedCount = 0;
  let visited = 0;

  // Étape 1 : regroupement par taille exacte.
  await walk(allowedRoot, {
    signal: ctx.signal,
    limiter,
    deadline,
    enterDir: (p, name) => {
      const low = name.toLowerCase();
      if (low === '$recycle.bin' || low === 'system volume information' || low === '.trash' || low === 'node_modules' || low === '.git') return false;
      if (blockedSubtrees.some((s) => isSameOrInside(p, s))) return false;
      return true;
    },
    onError: (_p, err) => {
      if (errCode(err) !== 'ENOENT') skippedCount++;
    },
    onFile: (p, st) => {
      visited++;
      if (st.size >= minBytes) {
        let bucket = bySize.get(st.size);
        if (!bucket) bySize.set(st.size, (bucket = []));
        bucket.push({ path: p, size: st.size, mtime: Math.round(st.mtimeMs) });
      }
      if (visited % 120 === 0) {
        progress({ task: 'duplicates', phase: 'walking', fraction: null, currentPath: p, bytesFound: 0, itemsVisited: visited });
      }
    },
  });
  if (ctx.signal.aborted) throw new AbortedError();

  const sizeGroups = [...bySize.values()].filter((g) => g.length >= 2);
  const sizeCandidates = sizeGroups.flat();
  const candidatesBySize = sizeCandidates.length;

  // Étape 2 : empreinte partielle (début + fin 64 Kio).
  const byPartial = new Map<string, Candidate[]>();
  let partialDone = 0;
  await mapLimit(sizeCandidates, 16, async (c) => {
    if (ctx.signal.aborted || Date.now() > deadline) return;
    try {
      const h = await partialHash(c.path, c.size);
      const key = `${c.size}:${h}`;
      let bucket = byPartial.get(key);
      if (!bucket) byPartial.set(key, (bucket = []));
      bucket.push(c);
    } catch {
      skippedCount++;
    } finally {
      partialDone++;
      progress({
        task: 'duplicates', phase: 'hashing-partial',
        fraction: candidatesBySize > 0 ? partialDone / candidatesBySize : 1,
        currentPath: c.path, bytesFound: 0, itemsVisited: partialDone,
      });
    }
  });
  if (ctx.signal.aborted) throw new AbortedError();

  const partialGroups = [...byPartial.values()].filter((g) => g.length >= 2);
  const partialCandidates = partialGroups.flat();
  const candidatesByPartialHash = partialCandidates.length;

  // Étape 3 : empreinte SHA-256 complète.
  const byFull = new Map<string, { hash: string; size: number; files: Candidate[] }>();
  let fullDone = 0;
  await mapLimit(partialCandidates, 6, async (c) => {
    if (ctx.signal.aborted || Date.now() > deadline) return;
    try {
      const h = await fullHash(c.path, c.size, ctx.signal);
      const key = `${c.size}:${h}`;
      let g = byFull.get(key);
      if (!g) byFull.set(key, (g = { hash: h, size: c.size, files: [] }));
      g.files.push(c);
    } catch (err) {
      if (err instanceof AbortedError || ctx.signal.aborted) return;
      skippedCount++;
    } finally {
      fullDone++;
      progress({
        task: 'duplicates', phase: 'hashing-full',
        fraction: candidatesByPartialHash > 0 ? fullDone / candidatesByPartialHash : 1,
        currentPath: c.path, bytesFound: 0, itemsVisited: fullDone,
      });
    }
  });
  if (ctx.signal.aborted) throw new AbortedError();

  const confirmedGroups = [...byFull.values()].filter((g) => g.files.length >= 2);
  const scanId = newId('dup');
  const cacheItems = new Map<string, CachedItem>();
  const cacheGroups = new Map<string, string[]>();
  let confirmed = 0;
  let totalWastedBytes = 0;

  const groups: DuplicateGroup[] = confirmedGroups
    .map((g) => {
      // Le plus ancien en premier (original suggéré).
      g.files.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path));
      const groupId = newId('dg');
      const ids: string[] = [];
      const files: ScanItem[] = g.files.map((f) => {
        const id = newId('df');
        ids.push(id);
        cacheItems.set(id, { path: f.path, sizeBytes: f.size, isDirectory: false, groupId, root: allowedRoot });
        return { id, path: f.path, name: baseName(f.path), sizeBytes: f.size, modifiedAt: f.mtime, isDirectory: false };
      });
      cacheGroups.set(groupId, ids);
      confirmed += files.length;
      const wastedBytes = g.size * (files.length - 1);
      totalWastedBytes += wastedBytes;
      return { id: groupId, hash: g.hash, sizeBytes: g.size, files, wastedBytes };
    })
    .sort((a, b) => b.wastedBytes - a.wastedBytes);

  putScan(scanId, { kind: 'duplicates', createdAt: Date.now(), items: cacheItems, groups: cacheGroups });
  ctx.progress({ task: 'duplicates', phase: 'done', fraction: 1, bytesFound: totalWastedBytes, itemsVisited: confirmed });
  return {
    scanId,
    groups,
    totalWastedBytes,
    stats: { candidatesBySize, candidatesByPartialHash, confirmed },
    skippedCount,
  };
}

/* ───────────────────────── Envoi à la Corbeille ───────────────────────── */

export async function trashItems(req: TrashItemsRequest): Promise<TrashItemsResult> {
  const scan = getScan(req.scanId);
  if (!scan) {
    return {
      trashedCount: 0,
      freedBytes: 0,
      failed: req.itemIds.map((itemId) => ({ itemId, reason: 'Analyse expirée ou introuvable : relancez la recherche.' })),
    };
  }

  const uniqueIds = [...new Set(req.itemIds)];
  const failed: Array<{ itemId: string; reason: string }> = [];
  const blocked = new Set<string>();

  // Règle absolue sur les doublons : ne JAMAIS mettre à la corbeille tous les exemplaires d'un même groupe.
  if (scan.kind === 'duplicates' && scan.groups) {
    const requestedByGroup = new Map<string, string[]>();
    for (const itemId of uniqueIds) {
      const it = scan.items.get(itemId);
      if (it?.groupId) {
        let list = requestedByGroup.get(it.groupId);
        if (!list) requestedByGroup.set(it.groupId, (list = []));
        list.push(itemId);
      }
    }
    for (const [groupId, reqList] of requestedByGroup) {
      const allIds = scan.groups.get(groupId) ?? [];
      const remainingAlive = allIds.filter((id) => {
        const it = scan.items.get(id);
        return it && !it.trashed && !reqList.includes(id);
      });
      if (remainingAlive.length === 0) {
        for (const itemId of reqList) {
          blocked.add(itemId);
          failed.push({ itemId, reason: 'Refusé : au moins un exemplaire de chaque groupe de doublons doit être conservé.' });
        }
      }
    }
  }

  let trashedCount = 0;
  let freedBytes = 0;

  for (const itemId of uniqueIds) {
    if (blocked.has(itemId)) continue;
    const it = scan.items.get(itemId);
    if (!it) {
      failed.push({ itemId, reason: 'Élément inconnu de cette analyse.' });
      continue;
    }
    if (it.aggregate) {
      failed.push({ itemId, reason: 'Ce groupe (« Autres ») agrège plusieurs fichiers et ne peut pas être mis à la corbeille d’un bloc.' });
      continue;
    }
    if (it.trashed) continue;

    const res = await trashPath(it.path, [it.root]);
    if (!res.ok) {
      failed.push({ itemId, reason: res.reason });
      continue;
    }
    it.trashed = true;
    trashedCount++;
    freedBytes += res.bytes || it.sizeBytes;
    scan.onTrashed?.(itemId);
  }

  return { trashedCount, freedBytes, failed };
}

/** Résout le chemin d'un élément issu d'un scan précédent (pour « Afficher dans le dossier »), ou null. */
export function resolveScanItemPath(scanId: string, itemId: string): string | null {
  const scan = getScan(scanId);
  const it = scan?.items.get(itemId);
  if (!it || it.trashed || it.aggregate) return null;
  if (unsafePathSyntax(it.path)) return null;
  return it.path;
}
