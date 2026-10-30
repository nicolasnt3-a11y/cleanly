/**
 * STUB — propriété de l'agent « services de scan ».
 * Validation des chemins et suppression / mise à la corbeille sûres.
 */
export type SafetyVerdict = { ok: true; realPath: string } | { ok: false; reason: string };

/**
 * Résout le chemin COMPLET avec realpath puis le valide contre toutes les règles de sécurité,
 * et vérifie qu'il est strictement contenu dans l'une des racines autorisées (elles-mêmes résolues).
 */
export async function validateForDeletion(
  _path: string,
  _opts: { allowedRoots: string[]; mode: 'permanent' | 'trash' },
): Promise<SafetyVerdict> {
  return { ok: false, reason: 'Non implémenté' };
}

/** Envoie un chemin validé à la corbeille système. */
export async function trashPath(
  _path: string,
  _allowedRoots: string[],
): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> {
  return { ok: false, reason: 'Non implémenté' };
}

/** Renvoie une raison de refus si la syntaxe du chemin est dangereuse (UNC, ADS, 8.3…), sinon null. */
export function unsafePathSyntax(_path: string): string | null {
  return 'Non implémenté';
}

/** true si l'icône de ce chemin peut être demandée sans risque (pas réseau/amovible/.url/.lnk/.scf). */
export async function isIconSafePath(_path: string): Promise<boolean> {
  return false;
}
