/** Mini-carte « Espace disque » : bulles flottantes + barre segmentée + légende. */
import { useMemo } from 'react';
import type { DiskBreakdown, DriveInfo } from '../../../../shared/types';
import { formatBytes } from '../../lib/format';

type SegmentId = DiskBreakdown['segments'][number]['id'] | 'used';

export interface MapSegment {
  id: SegmentId;
  label: string;
  bytes: number;
}

const SEG_COLOR: Record<SegmentId, string> = {
  system: '#0e0f12',
  apps: '#52565f',
  user: '#9aa0aa',
  reclaimable: '#2447d6',
  other: '#c9ccd3',
  used: '#0e0f12',
  free: 'transparent',
};

const W = 360;
const H = 230;
const GAP = 7;

interface Bubble {
  seg: MapSegment;
  x: number;
  y: number;
  r: number;
}

/** Disposition déterministe : chaque bulle touche une bulle déjà posée, au plus près du centre. */
function pack(segs: MapSegment[]): Bubble[] {
  const list = segs
    .filter((s) => s.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5);
  if (list.length === 0) return [];
  const max = list[0]!.bytes;
  const rMax = H * 0.36;
  const placed: Bubble[] = [];
  const cx = W / 2;
  const cy = H / 2;
  list.forEach((seg, i) => {
    const r = Math.max(9, rMax * Math.sqrt(seg.bytes / max));
    if (i === 0) {
      placed.push({ seg, x: cx - (list.length > 1 ? W * 0.14 : 0), y: cy, r });
      return;
    }
    let best: { x: number; y: number; d: number; r: number } | null = null;
    /* Si aucune place ne convient, réduire légèrement la bulle et réessayer. */
    for (let attempt = 0; attempt < 5 && !best; attempt++) {
      const rr = r * Math.pow(0.85, attempt);
      for (const p of placed) {
        for (let a = 0; a < 360; a += 6) {
          const rad = (a * Math.PI) / 180;
          const x = p.x + Math.cos(rad) * (p.r + rr + GAP);
          const y = p.y + Math.sin(rad) * (p.r + rr + GAP);
          if (x - rr < 4 || x + rr > W - 4 || y - rr < 4 || y + rr > H - 4) continue;
          if (placed.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + rr + GAP - 0.5)) continue;
          const d = Math.hypot((x - cx) * 0.7, y - cy);
          if (!best || d < best.d) best = { x, y, d, r: rr };
        }
      }
    }
    if (best) placed.push({ seg, x: best.x, y: best.y, r: best.r });
  });
  return placed;
}

export function segmentsFromDrive(drive: DriveInfo): MapSegment[] {
  return [
    { id: 'used', label: 'Utilisé', bytes: Math.max(0, drive.totalBytes - drive.freeBytes) },
    { id: 'free', label: 'Libre', bytes: drive.freeBytes },
  ];
}

export function MiniMap({ drive, segments, pending }: { drive: DriveInfo | null; segments: MapSegment[]; pending?: boolean }) {
  const bubbles = useMemo(() => pack(segments), [segments]);
  const total = drive?.totalBytes || segments.reduce((a, s) => a + s.bytes, 0) || 1;
  const biggest = bubbles[0]?.seg.id;
  const free = segments.find((s) => s.id === 'free')?.bytes ?? drive?.freeBytes ?? 0;

  return (
    <section className="panel hm-map" aria-label="Espace disque">
      <div className="hm-map-head">
        <div>
          <p className="eyebrow">Espace disque</p>
          <div className="hm-map-title">
            {drive ? `${drive.label || 'Disque système'} · ${drive.mount.replace(/\\$/, '')}` : 'Disque système'}
          </div>
        </div>
        {drive && (
          <span className="mono num">
            {formatBytes(free)} libres / {formatBytes(drive.totalBytes)}
          </span>
        )}
      </div>

      <div className={pending ? 'hm-bubbles pending' : 'hm-bubbles'} aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          {bubbles.map((b, i) => {
            const hero = b.seg.id === biggest;
            return (
              <g key={b.seg.id} className="hm-bubble" style={{ animationDelay: `${-i * 1.7}s`, animationDuration: `${7 + i * 1.3}s` }}>
                <circle
                  cx={b.x}
                  cy={b.y}
                  r={b.r}
                  className={hero ? 'hero' : b.seg.id === 'reclaimable' ? 'accent' : undefined}
                />
                {b.r >= 30 && (
                  <>
                    <text x={b.x} y={b.y - 3} className="hm-bubble-l">
                      {b.seg.label}
                    </text>
                    <text x={b.x} y={b.y + 12} className="hm-bubble-v">
                      {formatBytes(b.seg.bytes)}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="bar hm-map-bar" role="img" aria-label={segments.map((s) => `${s.label} ${formatBytes(s.bytes)}`).join(', ')}>
        {segments
          .filter((s) => s.id !== 'free' && s.bytes > 0)
          .map((s) => (
            <i key={s.id} style={{ width: `${(s.bytes / total) * 100}%`, background: SEG_COLOR[s.id] }} />
          ))}
      </div>

      <ul className="hm-legend">
        {segments.filter((s) => s.bytes > 0 || s.id === 'free').map((s) => (
          <li key={s.id}>
            <i className={s.id === 'free' ? 'free' : undefined} style={{ background: s.id === 'free' ? undefined : SEG_COLOR[s.id] }} />
            <span className="hm-legend-l">{s.label}</span>
            <span className="hm-legend-v num">{formatBytes(s.bytes)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
