/** Outils communs aux services de scan : limiteur de concurrence, identifiants, caches. */
import { randomBytes } from 'node:crypto';
import type { CleanCategoryId, ScanProgress } from '../../../../shared/types';
import type { ServiceContext } from '../context';

/** Sémaphore simple : au plus `max` opérations disque simultanées. */
export class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/** Exécute `fn` sur chaque élément avec une concurrence bornée. */
export async function mapLimit<T, R>(items: readonly T[], max: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

let counter = 0;
const salt = randomBytes(3).toString('hex');
/** Identifiant opaque conforme à OPAQUE_ID (ex. « it-k3f9a1-2b »). */
export function newId(prefix: string): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${salt}${counter.toString(36)}`;
}

/** Progression limitée à ~8 événements / s (le dernier événement est toujours envoyé). */
export function throttledProgress(ctx: ServiceContext, intervalMs = 120): (p: ScanProgress, force?: boolean) => void {
  let last = 0;
  return (p, force = false) => {
    const now = Date.now();
    if (!force && now - last < intervalMs) return;
    last = now;
    ctx.progress(p);
  };
}

export class AbortedError extends Error {
  constructor() {
    super('Analyse annulée.');
  }
}

/* ─────────────────────────── Caches de scans ─────────────────────────── */

export interface CachedItem {
  path: string;
  sizeBytes: number;
  isDirectory: boolean;
  /** Catégorie de nettoyage (smart scan). */
  categoryId?: CleanCategoryId;
  /** Groupe de doublons. */
  groupId?: string;
  /** Racine du scan (racine autorisée pour la corbeille). */
  root: string;
  trashed?: boolean;
  /** Nœud aggrégé (« Autres ») : non résolvable. */
  aggregate?: boolean;
}

export interface ScanCache {
  kind: 'clean' | 'large' | 'duplicates' | 'map';
  createdAt: number;
  items: Map<string, CachedItem>;
  /** Doublons : groupId → itemIds. */
  groups?: Map<string, string[]>;
  /** Hook optionnel après mise à la corbeille (mise à jour de la carte d'espace). */
  onTrashed?: (itemId: string) => void;
}

const MAX_SCANS = 12;
const scans = new Map<string, ScanCache>();

export function putScan(scanId: string, cache: ScanCache): void {
  scans.delete(scanId);
  scans.set(scanId, cache);
  while (scans.size > MAX_SCANS) {
    const oldest = scans.keys().next().value;
    if (oldest === undefined) break;
    scans.delete(oldest);
  }
}

export function getScan(scanId: string): ScanCache | undefined {
  return scans.get(scanId);
}

export function dropScan(scanId: string): void {
  scans.delete(scanId);
}
