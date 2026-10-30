/** Icônes de fichiers (data URL PNG), mises en cache et limitées dans le temps. */
import { app } from 'electron';
import { isIconSafePath } from '../../safety/index';
import { withTimeout } from './util';

const cache = new Map<string, Promise<string | undefined>>();
const ICON_TIMEOUT_MS = 2_500;

async function load(p: string): Promise<string | undefined> {
  // Jamais de chemin réseau / amovible, ni de .url / .lnk / .scf (authentification distante possible).
  if (!(await isIconSafePath(p))) return undefined;
  const img = await app.getFileIcon(p, { size: 'large' });
  if (img.isEmpty()) return undefined;
  return img.toDataURL();
}

/** Icône du fichier `p`, ou undefined si indisponible / non sûre. */
export function iconFor(p: string | undefined): Promise<string | undefined> {
  if (!p) return Promise.resolve(undefined);
  const key = process.platform === 'win32' ? p.toLowerCase() : p;
  let hit = cache.get(key);
  if (!hit) {
    hit = withTimeout(load(p), ICON_TIMEOUT_MS, undefined);
    cache.set(key, hit);
  }
  return hit;
}
