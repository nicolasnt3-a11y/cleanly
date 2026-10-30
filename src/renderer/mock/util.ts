/** Utilitaires des données fictives. */

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const GB = 1e9;
export const MB = 1e6;
export const DAY = 86_400_000;

let seq = 0;
/** Identifiant opaque conforme au motif du main (/^[A-Za-z0-9_\-.:]{1,256}$/). */
export function mockId(prefix = 'm'): string {
  return `${prefix}-${(++seq).toString(36)}`;
}

/** Générateur pseudo-aléatoire déterministe (données stables d'une démo à l'autre). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
