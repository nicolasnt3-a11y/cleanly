/**
 * Point d'entrée des services de scan (processus principal).
 * Réexporte l'analyse des catégories, le nettoyage, la carte d'espace,
 * les fichiers volumineux, les doublons et l'envoi sécurisé à la Corbeille.
 */
import type { DriveInfo } from '../../../../shared/types';
import { getDrives } from '../../safety/drives';

export { scanCleanupCategories, runClean } from './cleanup';
export { diskBreakdown, spaceLevel } from './spacemap';
export { findLargeFiles, findDuplicates, trashItems, resolveScanItemPath } from './files';

export async function listDrives(): Promise<DriveInfo[]> {
  return getDrives(true);
}
