/** STUB — propriété de l'agent « IA + paramètres ». Panneau « second avis » réutilisable. */
import type { AiReviewItem } from '../../../shared/types';

export interface AiAssistantProps {
  /** Éléments à soumettre (nom, chemin, taille — jamais le contenu). */
  items: AiReviewItem[];
  /** Variante compacte pour les barres latérales étroites. */
  compact?: boolean;
}

/** Écrit ses verdicts dans verdictStore (state/stores.ts) ; les listes les lisent par id. */
export function AiAssistant(_props: AiAssistantProps) {
  return null;
}
