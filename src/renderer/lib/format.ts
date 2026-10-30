/** Formatage en français (octets, dates relatives). */

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** Décimal (1 Go = 10⁹ o), comme l'Explorateur moderne et le Finder. */
export function bytesParts(bytes: number): { value: string; unit: string } {
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let v = Math.max(0, bytes);
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  const value = i === 0 || v >= 100 ? nf0.format(v) : nf1.format(v);
  return { value, unit: units[i]! };
}

export function formatBytes(bytes: number): string {
  const { value, unit } = bytesParts(bytes);
  return `${value} ${unit}`;
}

export function formatCount(n: number): string {
  return nf0.format(n);
}

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

export function formatRelative(ms: number | undefined, now = Date.now()): string {
  if (!ms) return '—';
  const diff = ms - now;
  const day = 86_400_000;
  const abs = Math.abs(diff);
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < day) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), 'day');
  if (abs < 365 * day) return rtf.format(Math.round(diff / (30 * day)), 'month');
  return rtf.format(Math.round(diff / (365 * day)), 'year');
}

const df = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
export function formatDate(ms: number | undefined): string {
  return ms ? df.format(ms) : '—';
}

/** Accorde un nom au pluriel : plural(3, 'fichier') → « 3 fichiers ». */
export function plural(n: number, singular: string, pluralForm = singular + 's'): string {
  return `${formatCount(n)} ${n > 1 ? pluralForm : singular}`;
}
