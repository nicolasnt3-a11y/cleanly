/** État local aux écrans « Fichiers » : racine choisie et résultats gardés entre les onglets. */
import type { DriveInfo, DuplicatesResult, FileKind, LargeFilesResult, SpaceRoot } from '../../../../shared/types';
import type { IconName } from '../../components/icons';
import { createStore } from '../../state/createStore';

/** Clé sérialisée d'une racine : « home » ou « drive:<id> ». */
export type RootKey = string;

export const rootKeyOf = (root: SpaceRoot): RootKey => (root.kind === 'home' ? 'home' : `drive:${root.driveId}`);
export const rootOfKey = (key: RootKey): SpaceRoot =>
  key.startsWith('drive:') ? { kind: 'drive', driveId: key.slice(6) } : { kind: 'home' };

export interface FilesState {
  rootKey: RootKey;
  large: { key: RootKey; minBytes: number; result: LargeFilesResult } | null;
  duplicates: { key: RootKey; result: DuplicatesResult } | null;
}

export const filesStore = createStore<FilesState>({ rootKey: 'home', large: null, duplicates: null });

export function setRootKey(rootKey: RootKey): void {
  filesStore.set({ rootKey });
}

/** Libellé court d'un lecteur : « C: » sous Windows, nom du volume ailleurs. */
export function driveLabel(d: DriveInfo): string {
  return /^[A-Za-z]:$/.test(d.id) ? d.id : d.label || d.mount;
}

export function rootOptions(drives: DriveInfo[]): Array<{ value: RootKey; label: string }> {
  return [
    { value: 'home', label: 'Dossier personnel' },
    ...drives.filter((d) => d.kind === 'fixed').map((d) => ({ value: `drive:${d.id}`, label: driveLabel(d) })),
  ];
}

export function rootName(key: RootKey, drives: DriveInfo[]): string {
  if (key === 'home') return 'Dossier personnel';
  const d = drives.find((x) => `drive:${x.id}` === key);
  return d ? driveLabel(d) : key.slice(6);
}

export const KIND_ICON: Record<FileKind, IconName> = {
  video: 'file',
  image: 'file',
  audio: 'file',
  archive: 'files',
  'disk-image': 'drive',
  installer: 'apps',
  document: 'file',
  code: 'code',
  other: 'file',
};

export const KIND_LABEL: Record<FileKind, string> = {
  video: 'Vidéo',
  image: 'Image',
  audio: 'Audio',
  archive: 'Archive',
  'disk-image': 'Image disque',
  installer: 'Installateur',
  document: 'Document',
  code: 'Code',
  other: 'Fichier',
};
