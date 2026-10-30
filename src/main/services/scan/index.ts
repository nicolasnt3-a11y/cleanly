/** STUB — propriété de l'agent « services de scan ». */
import type {
  CleanCategory, CleanRequest, CleanResult, DiskBreakdown, DriveInfo, DuplicatesRequest, DuplicatesResult,
  LargeFilesRequest, LargeFilesResult, SpaceLevel, SpaceRoot, TrashItemsRequest, TrashItemsResult,
} from '../../../../shared/types';
import type { ServiceContext } from '../context';

const ni = (): never => {
  throw new Error('Non implémenté');
};

/** Analyse les catégories de nettoyage de l'OS courant. */
export async function scanCleanupCategories(_ctx: ServiceContext): Promise<{ scanId: string; categories: CleanCategory[] }> {
  return ni();
}
/** Nettoie les catégories demandées en REDÉRIVANT leurs emplacements. */
export async function runClean(_req: CleanRequest, _ctx: ServiceContext): Promise<CleanResult> {
  return ni();
}
export async function listDrives(): Promise<DriveInfo[]> {
  return ni();
}
/** Répartition du disque système pour la mini-carte. */
export async function diskBreakdown(_reclaimableBytes: number): Promise<DiskBreakdown> {
  return ni();
}
export async function spaceLevel(_root: SpaceRoot, _nodeId: string | null, _ctx: ServiceContext): Promise<SpaceLevel> {
  return ni();
}
export async function findLargeFiles(_req: LargeFilesRequest, _ctx: ServiceContext): Promise<LargeFilesResult> {
  return ni();
}
export async function findDuplicates(_req: DuplicatesRequest, _ctx: ServiceContext): Promise<DuplicatesResult> {
  return ni();
}
export async function trashItems(_req: TrashItemsRequest): Promise<TrashItemsResult> {
  return ni();
}
/** Chemin d'un élément issu d'un scan précédent (pour « Afficher dans le dossier »), ou null. */
export function resolveScanItemPath(_scanId: string, _itemId: string): string | null {
  return null;
}
