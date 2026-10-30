/** Contexte passé par la couche IPC à chaque service long. */
import type { ScanProgress, Settings } from '../../../shared/types';

export interface ServiceContext {
  /** Signal d'annulation (scan:cancel ou nouvelle analyse). */
  signal: AbortSignal;
  /** Pousse une progression vers l'interface (limiter à ~10 appels/s). */
  progress: (p: ScanProgress) => void;
  /** Paramètres courants. */
  settings: () => Promise<Settings>;
}

/** Motif auquel tout identifiant opaque produit par un service DOIT se conformer. */
export const OPAQUE_ID = /^[A-Za-z0-9_\-.:]{1,256}$/;
