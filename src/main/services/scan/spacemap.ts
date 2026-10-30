/**
 * Carte d'espace : arbre de tailles en mémoire, construit une fois par racine (dossier personnel
 * ou lecteur FIXE) et mis en cache ~10 min. Seuls les dossiers sont des nœuds ; chaque dossier
 * conserve ses 60 plus gros fichiers, le reste est agrégé.
 */
import fs from 'node:fs';
import os from 'node:os';
import type { DiskBreakdown, DriveInfo, SpaceLevel, SpaceNode, SpaceRoot } from '../../../../shared/types';
import { cachedDrives, getDrives, realpathOrNull, syntaxReason } from '../../safety/index';
import { systemDriveLetter } from '../../safety/drives';
import { IS_MAC, IS_WIN, baseName, joinChild } from '../../safety/paths';
import type { ServiceContext } from '../context';
import { type CachedItem, Limiter, putScan, newId, throttledProgress } from './util';

const MAX_AGE_MS = 10 * 60_000;
const BUDGET_MS = 35_000;
const KEEP_FILES = 60;
const MAX_CHILDREN = 60;

interface FileEntry {
  name: string;
  size: number;
  mtime: number;
  id?: string;
}

interface DirNode {
  name: string;
  path: string;
  parent: DirNode | null;
  dirs: DirNode[];
  files: FileEntry[];
  otherFilesBytes: number;
  otherFilesCount: number;
  size: number;
  fileCount: number;
  mtime: number;
  id?: string;
}

type Ref = { kind: 'dir'; node: DirNode } | { kind: 'file'; parent: DirNode; file: FileEntry } | { kind: 'aggregate'; parent: DirNode };

interface SpaceMap {
  mapId: string;
  rootKey: string;
  root: SpaceRoot;
  tree: DirNode;
  builtAt: number;
  partial: boolean;
  aborted: boolean;
  skipped: number;
  refs: Map<string, Ref>;
  items: Map<string, CachedItem>;
}

const maps = new Map<string, SpaceMap>();

function newDir(name: string, path: string, parent: DirNode | null): DirNode {
  return { name, path, parent, dirs: [], files: [], otherFilesBytes: 0, otherFilesCount: 0, size: 0, fileCount: 0, mtime: 0 };
}

/** Résout une racine de carte : dossier personnel ou lecteur FIXE uniquement. */
export async function resolveSpaceRoot(root: SpaceRoot): Promise<{ key: string; path: string; drive: DriveInfo | null }> {
  if (root.kind === 'home') {
    const p = (await realpathOrNull(os.homedir())) ?? os.homedir();
    return { key: 'home', path: p, drive: null };
  }
  const drives = await getDrives();
  const d = drives.find((x) => x.id === root.driveId);
  if (!d) throw new Error('Lecteur introuvable.');
  if (d.kind !== 'fixed') throw new Error('Seuls les disques internes (fixes) peuvent être analysés.');
  if (IS_WIN ? !/^[A-Z]:\\$/.test(d.mount) : syntaxReason(d.mount) !== null) throw new Error('Lecteur refusé.');
  return { key: 'drive:' + d.id, path: d.mount, drive: d };
}

async function buildTree(rootPath: string, rootLabel: string, usedBytes: number, ctx: ServiceContext): Promise<{ tree: DirNode; partial: boolean; aborted: boolean; skipped: number }> {
  const limiter = new Limiter(64);
  const deadline = Date.now() + BUDGET_MS;
  const progress = throttledProgress(ctx, 150);
  const tree = newDir(rootLabel, rootPath, null);
  let skipped = 0;
  let bytes = 0;
  let visited = 0;
  let partial = false;

  async function visit(dir: DirNode): Promise<void> {
    if (ctx.signal.aborted || Date.now() > deadline) {
      partial = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = await limiter.run(() => fs.promises.readdir(dir.path, { withFileTypes: true }));
    } catch {
      skipped++;
      return;
    }
    const files: FileEntry[] = [];
    const statJobs: Promise<void>[] = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue; // jonctions et liens : jamais suivis
      const p = joinChild(dir.path, e.name);
      if (e.isDirectory()) dir.dirs.push(newDir(e.name, p, dir));
      else if (e.isFile()) {
        statJobs.push(
          limiter
            .run(() => fs.promises.lstat(p))
            .then(
              (st) => {
                if (!st.isFile()) return;
                files.push({ name: e.name, size: st.size, mtime: Math.round(st.mtimeMs) });
                bytes += st.size;
                visited++;
              },
              () => {
                skipped++;
              },
            ),
        );
      }
    }
    await Promise.all(statJobs);
    files.sort((a, b) => b.size - a.size);
    dir.files = files.slice(0, KEEP_FILES);
    for (const f of files.slice(KEEP_FILES)) {
      dir.otherFilesBytes += f.size;
      dir.otherFilesCount++;
    }
    progress({
      task: 'space-map', phase: 'walking', fraction: usedBytes > 0 ? Math.min(0.99, bytes / usedBytes) : null,
      currentPath: dir.path, bytesFound: bytes, itemsVisited: visited,
    });
    // Parcours par niveaux (BFS) : tous les dossiers de surface sont mesurés avant les sous-dossiers très profonds.
    for (const d of dir.dirs) queue.push(d);
  }

  const queue: DirNode[] = [tree];
  let idx = 0;
  const dirWorkers = Array.from({ length: 8 }, async () => {
    while (idx < queue.length && !ctx.signal.aborted && Date.now() <= deadline) {
      const next = queue[idx++]!;
      await visit(next);
    }
  });
  await Promise.all(dirWorkers);
  computeSizes(tree);
  return { tree, partial, aborted: ctx.signal.aborted, skipped };
}

/** Agrège les tailles (post-ordre, itératif pour éviter une pile trop profonde). */
function computeSizes(root: DirNode): void {
  const order: DirNode[] = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    order.push(n);
    stack.push(...n.dirs);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i]!;
    let size = n.otherFilesBytes;
    let count = n.otherFilesCount;
    let mtime = 0;
    for (const f of n.files) {
      size += f.size;
      count++;
      mtime = Math.max(mtime, f.mtime);
    }
    for (const d of n.dirs) {
      size += d.size;
      count += d.fileCount;
      mtime = Math.max(mtime, d.mtime);
    }
    n.size = size;
    n.fileCount = count;
    n.mtime = mtime;
  }
}

function register(map: SpaceMap, ref: Ref, item: CachedItem): string {
  const id = newId('n');
  map.refs.set(id, ref);
  map.items.set(id, item);
  return id;
}

function dirToNode(map: SpaceMap, d: DirNode): SpaceNode {
  d.id ??= register(map, { kind: 'dir', node: d }, { path: d.path, sizeBytes: d.size, isDirectory: true, root: map.tree.path });
  return {
    id: d.id, name: d.name, path: d.path, sizeBytes: d.size, isDirectory: true,
    hasChildren: d.dirs.length > 0 || d.files.length > 0 || d.otherFilesCount > 0, fileCount: d.fileCount,
  };
}

function fileToNode(map: SpaceMap, parent: DirNode, f: FileEntry): SpaceNode {
  const path = joinChild(parent.path, f.name);
  f.id ??= register(map, { kind: 'file', parent, file: f }, { path, sizeBytes: f.size, isDirectory: false, root: map.tree.path });
  return { id: f.id, name: f.name, path, sizeBytes: f.size, isDirectory: false, hasChildren: false, fileCount: 1 };
}

/** Retire un élément mis à la corbeille de l'arbre et met à jour les tailles des ancêtres. */
function removeRef(map: SpaceMap, itemId: string): void {
  const ref = map.refs.get(itemId);
  if (!ref) return;
  let size = 0;
  let count = 0;
  let parent: DirNode | null = null;
  if (ref.kind === 'dir') {
    parent = ref.node.parent;
    if (!parent) return;
    parent.dirs = parent.dirs.filter((d) => d !== ref.node);
    size = ref.node.size;
    count = ref.node.fileCount;
  } else if (ref.kind === 'file') {
    parent = ref.parent;
    parent.files = parent.files.filter((f) => f !== ref.file);
    size = ref.file.size;
    count = 1;
  }
  for (let n = parent; n; n = n.parent) {
    n.size = Math.max(0, n.size - size);
    n.fileCount = Math.max(0, n.fileCount - count);
  }
  map.refs.delete(itemId);
}

async function getMap(root: SpaceRoot, nodeId: string | null, ctx: ServiceContext): Promise<SpaceMap> {
  if (nodeId !== null) {
    for (const m of maps.values()) if (m.refs.has(nodeId)) return m;
    throw new Error('Élément introuvable : la carte a expiré, relancez l’analyse.');
  }
  const r = await resolveSpaceRoot(root);
  const cached = maps.get(r.key);
  if (cached && !cached.aborted && Date.now() - cached.builtAt < MAX_AGE_MS) return cached;

  let used = 0;
  try {
    const s = await fs.promises.statfs(r.path);
    used = (s.blocks - s.bfree) * s.bsize;
  } catch {
    /* fraction indéterminée */
  }
  const rootLabel = root.kind === 'home' ? 'Dossier personnel' : r.drive ? `${r.drive.label} (${r.drive.id})` : baseName(r.path);
  const built = await buildTree(r.path, rootLabel, used, ctx);
  if (built.aborted && cached) return cached;
  const map: SpaceMap = {
    mapId: newId('map'), rootKey: r.key, root, tree: built.tree, builtAt: Date.now(),
    partial: built.partial, aborted: built.aborted, skipped: built.skipped, refs: new Map(), items: new Map(),
  };
  if (cached) maps.delete(r.key);
  maps.set(r.key, map);
  ctx.progress({ task: 'space-map', phase: 'done', fraction: 1, bytesFound: map.tree.size, itemsVisited: map.tree.fileCount });
  return map;
}

export async function spaceLevel(root: SpaceRoot, nodeId: string | null, ctx: ServiceContext): Promise<SpaceLevel> {
  const map = await getMap(root, nodeId, ctx);
  let dir: DirNode = map.tree;
  if (nodeId !== null) {
    const ref = map.refs.get(nodeId);
    if (!ref || ref.kind !== 'dir') throw new Error('Ce nœud ne peut pas être ouvert.');
    dir = ref.node;
  }
  const node = dirToNode(map, dir);
  const all: Array<{ size: number; make: () => SpaceNode }> = [
    ...dir.dirs.map((d) => ({ size: d.size, make: () => dirToNode(map, d) })),
    ...dir.files.map((f) => ({ size: f.size, make: () => fileToNode(map, dir, f) })),
  ].sort((a, b) => b.size - a.size);

  const children = all.slice(0, all.length > MAX_CHILDREN ? MAX_CHILDREN - 1 : MAX_CHILDREN).map((c) => c.make());
  const rest = all.slice(children.length);
  const otherBytes = rest.reduce((a, c) => a + c.size, 0) + dir.otherFilesBytes;
  const otherCount = rest.length + dir.otherFilesCount;
  if (otherCount > 0) {
    const id = register(map, { kind: 'aggregate', parent: dir }, { path: dir.path, sizeBytes: otherBytes, isDirectory: false, root: map.tree.path, aggregate: true });
    children.push({ id, name: 'Autres', path: dir.path, sizeBytes: otherBytes, isDirectory: false, hasChildren: false, fileCount: otherCount });
  }

  const crumbs: Array<{ id: string; name: string }> = [];
  for (let n: DirNode | null = dir; n; n = n.parent) crumbs.unshift({ id: dirToNode(map, n).id, name: n.name });

  putScan(map.mapId, { kind: 'map', createdAt: map.builtAt, items: map.items, onTrashed: (id) => removeRef(map, id) });
  return { mapId: map.mapId, root: map.root, node, children, crumbs, skippedCount: map.skipped, partial: map.partial };
}

/* ─────────────────────────── Répartition du disque ─────────────────────────── */

function sizeOfChild(tree: DirNode, names: string[]): number {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return tree.dirs.filter((d) => wanted.has(d.name.toLowerCase())).reduce((a, d) => a + d.size, 0);
}

/** Répartition du disque système pour la mini-carte (rapide : statfs + carte en cache si disponible). */
export async function diskBreakdown(reclaimableBytes: number): Promise<DiskBreakdown> {
  const mount = IS_WIN ? systemDriveLetter() + '\\' : '/';
  let total = 0;
  let free = 0;
  try {
    const s = await fs.promises.statfs(mount);
    total = s.blocks * s.bsize;
    free = s.bavail * s.bsize;
  } catch {
    /* valeurs nulles */
  }
  const known = cachedDrives().find((d) => d.isSystem);
  const drive: DriveInfo = known
    ? { ...known, totalBytes: total || known.totalBytes, freeBytes: free || known.freeBytes }
    : { id: IS_WIN ? systemDriveLetter() : '/', mount, label: IS_WIN ? 'Disque local' : IS_MAC ? 'Macintosh HD' : 'Système', kind: 'fixed', totalBytes: total, freeBytes: free, isSystem: true };

  const used = Math.max(0, drive.totalBytes - drive.freeBytes);
  const reclaimable = Math.min(Math.max(0, reclaimableBytes), used);
  let system = 0;
  let apps = 0;
  let user = 0;

  const driveMap = maps.get('drive:' + drive.id);
  const homeMap = maps.get('home');
  const fresh = (m: SpaceMap | undefined) => m && !m.aborted && Date.now() - m.builtAt < 60 * 60_000;
  if (fresh(driveMap)) {
    const tree = driveMap!.tree;
    if (IS_WIN) {
      system = sizeOfChild(tree, ['Windows']);
      apps = sizeOfChild(tree, ['Program Files', 'Program Files (x86)', 'ProgramData']);
      user = sizeOfChild(tree, ['Users']);
    } else {
      system = sizeOfChild(tree, ['System', 'Library', 'usr', 'bin', 'sbin', 'private', 'opt']);
      apps = sizeOfChild(tree, ['Applications']);
      user = sizeOfChild(tree, ['Users']);
    }
  } else if (fresh(homeMap)) {
    user = homeMap!.tree.size;
  }
  user = Math.max(0, user - reclaimable); // le récupérable est surtout dans le profil
  const known3 = Math.min(used - reclaimable, system + apps + user);
  const other = Math.max(0, used - reclaimable - known3);

  const segments: DiskBreakdown['segments'] = [];
  if (system > 0) segments.push({ id: 'system', label: 'Système', bytes: system });
  if (apps > 0) segments.push({ id: 'apps', label: 'Applications', bytes: apps });
  if (user > 0) segments.push({ id: 'user', label: 'Fichiers', bytes: user });
  segments.push({ id: 'reclaimable', label: 'À libérer', bytes: reclaimable });
  segments.push({ id: 'other', label: 'Autres', bytes: other });
  segments.push({ id: 'free', label: 'Libre', bytes: drive.freeBytes });
  return { drive, segments };
}
