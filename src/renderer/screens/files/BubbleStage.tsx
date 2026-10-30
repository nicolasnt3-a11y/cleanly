/**
 * Scène de bulles de la carte d'espace.
 *
 * React ne rend que la structure (une bulle = un <button>) ; les positions sont écrites
 * directement dans le style (transform: translate3d) par la boucle physique — aucun rendu
 * React par image. Glisser, lancer (vitesse issue des derniers déplacements du pointeur),
 * clic sans glisser = activer (descendre dans un dossier / sélectionner un fichier).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { SpaceNode } from '../../../../shared/types';
import { bytesParts } from '../../lib/format';
import { Simulation, World, radiiFor, type Body } from './physics';

export interface BubbleStageProps {
  nodes: SpaceNode[];
  /** Change à chaque nouveau niveau (mapId + nœud). */
  levelKey: string;
  selectedId: string | null;
  reduced: boolean;
  /** Point d'apparition des nouvelles bulles (sinon le centre). */
  spawn: { x: number; y: number } | null;
  /** Bulle en cours d'ouverture : elle grandit pendant que les autres s'effacent. */
  openingId: string | null;
  onActivate: (node: SpaceNode, at: { x: number; y: number }) => void;
  onSelect: (node: SpaceNode) => void;
}

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  offX: number;
  offY: number;
  moved: boolean;
  samples: Array<{ t: number; x: number; y: number }>;
  left: number;
  top: number;
}

const DRAG_THRESHOLD = 5;
const MAX_THROW = 2800;
const SAMPLE_WINDOW = 90;

export function BubbleStage({ nodes, levelKey, selectedId, reduced, spawn, openingId, onActivate, onSelect }: BubbleStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLButtonElement>());
  const baseR = useRef(new Map<string, number>());
  const worldRef = useRef<World>(null as unknown as World);
  worldRef.current ??= new World();
  const simRef = useRef<Simulation | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const render = useCallback(() => {
    for (const b of worldRef.current.bodies) {
      const el = els.current.get(b.id);
      if (!el) continue;
      const base = baseR.current.get(b.id) ?? b.targetR;
      const s = base > 0 ? b.r / base : 0;
      el.style.transform = `translate3d(${(b.x - base).toFixed(2)}px, ${(b.y - base).toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
    }
  }, []);

  // Boucle de simulation (créée une fois).
  useEffect(() => {
    const sim = new Simulation(worldRef.current, render);
    simRef.current = sim;
    return () => {
      sim.dispose();
      simRef.current = null;
    };
  }, [render]);

  // Taille de la scène.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const radii = useMemo(() => radiiFor(nodes.map((n) => n.sizeBytes), size.w, size.h), [nodes, size.w, size.h]);
  const largestId = nodes.length > 0 ? nodes.reduce((a, n) => (n.sizeBytes > a.sizeBytes ? n : a)).id : null;

  // Synchronise les corps avec les nœuds (nouveau niveau ou redimensionnement).
  useLayoutEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    const world = worldRef.current;
    world.setSize(size.w, size.h);
    const prev = new Map(world.bodies.map((b) => [b.id, b]));
    const sx = spawn?.x ?? size.w / 2;
    const sy = spawn?.y ?? size.h / 2;
    const next: Body[] = nodes.map((n, i) => {
      const targetR = radii[i]!;
      baseR.current.set(n.id, targetR);
      const existing = prev.get(n.id);
      if (existing) {
        existing.targetR = targetR;
        existing.pinned = false;
        if (reduced) existing.r = targetR;
        return existing;
      }
      // Spirale dorée autour du point d'apparition : les plus grosses au centre.
      const a = i * 2.39996;
      const dist = Math.sqrt(i) * (reduced ? Math.max(18, targetR * 0.9) : 14);
      return {
        id: n.id,
        x: sx + Math.cos(a) * dist,
        y: sy + Math.sin(a) * dist,
        vx: reduced ? 0 : Math.cos(a) * 60,
        vy: reduced ? 0 : Math.sin(a) * 60,
        r: reduced ? targetR : 0,
        targetR,
        held: false,
        pinned: false,
      };
    });
    world.bodies = next;
    for (const id of [...baseR.current.keys()]) if (!nodes.some((n) => n.id === id)) baseR.current.delete(id);
    const sim = simRef.current;
    if (reduced) {
      sim?.stop();
      sim?.settle();
      for (const b of world.bodies) {
        b.vx = 0;
        b.vy = 0;
      }
      render();
    } else {
      render();
      sim?.wake();
    }
    // spawn ne doit pas re-déclencher la synchro à lui seul.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, radii, size.w, size.h, reduced, render]);

  // Transition d'ouverture : la bulle choisie s'épingle et grandit, les autres s'effacent.
  useEffect(() => {
    if (!openingId || reduced) return;
    const world = worldRef.current;
    const diag = Math.hypot(world.width, world.height);
    for (const b of world.bodies) {
      if (b.id === openingId) {
        b.pinned = true;
        b.targetR = diag * 0.6;
      } else {
        b.targetR = 0;
      }
    }
    simRef.current?.wake();
  }, [openingId, reduced]);

  /* ── Pointeur ── */
  const pointerPos = (e: RPointerEvent, d: Pick<Drag, 'left' | 'top'>) => ({ x: e.clientX - d.left, y: e.clientY - d.top });

  const onPointerDown = (e: RPointerEvent<HTMLButtonElement>, id: string) => {
    if (reduced || openingId || e.button !== 0 || !stageRef.current) return;
    const body = worldRef.current.get(id);
    if (!body) return;
    const rect = stageRef.current.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      id,
      pointerId: e.pointerId,
      startX: p.x,
      startY: p.y,
      offX: body.x - p.x,
      offY: body.y - p.y,
      moved: false,
      samples: [{ t: e.timeStamp, x: p.x, y: p.y }],
      left: rect.left,
      top: rect.top,
    };
  };

  const onPointerMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = pointerPos(e, d);
    const body = worldRef.current.get(d.id);
    if (!body) return;
    if (!d.moved) {
      if (Math.hypot(p.x - d.startX, p.y - d.startY) < DRAG_THRESHOLD) return;
      d.moved = true;
      body.held = true;
      e.currentTarget.classList.add('is-dragging');
    }
    const prev = d.samples[d.samples.length - 1]!;
    d.samples.push({ t: e.timeStamp, x: p.x, y: p.y });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0]!.t > SAMPLE_WINDOW) d.samples.shift();
    const dt = Math.max(1, e.timeStamp - prev.t) / 1000;
    body.x = p.x + d.offX;
    body.y = p.y + d.offY;
    // Vitesse instantanée : utilisée par les collisions pour « pousser » les voisines.
    body.vx = (p.x - prev.x) / dt;
    body.vy = (p.y - prev.y) / dt;
    simRef.current?.wake();
  };

  const endDrag = (e: RPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    e.currentTarget.classList.remove('is-dragging');
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const body = worldRef.current.get(d.id);
    if (!body || !d.moved) return;
    suppressClick.current = d.id;
    body.held = false;
    // Lancer : vitesse moyenne sur les ~90 dernières ms (nulle si le pointeur s'était arrêté).
    const first = d.samples[0]!;
    const last = d.samples[d.samples.length - 1]!;
    const span = (last.t - first.t) / 1000;
    const idle = e.timeStamp - last.t;
    if (span > 0.005 && idle < 60) {
      let vx = (last.x - first.x) / span;
      let vy = (last.y - first.y) / span;
      const sp = Math.hypot(vx, vy);
      if (sp > MAX_THROW) {
        vx *= MAX_THROW / sp;
        vy *= MAX_THROW / sp;
      }
      body.vx = vx;
      body.vy = vy;
    } else {
      body.vx = 0;
      body.vy = 0;
    }
    simRef.current?.wake();
  };

  const onClick = (node: SpaceNode) => {
    if (suppressClick.current === node.id) {
      suppressClick.current = null;
      return;
    }
    suppressClick.current = null;
    if (openingId) return;
    const body = worldRef.current.get(node.id);
    const at = body ? { x: body.x, y: body.y } : { x: size.w / 2, y: size.h / 2 };
    if (node.hasChildren) onActivate(node, at);
    else onSelect(node);
  };

  return (
    <div ref={stageRef} className={`fs-stage${openingId && !reduced ? ' is-opening' : ''}${reduced ? ' is-static' : ''}`} data-level={levelKey}>
      {nodes.map((n, i) => {
        const r = radii[i] ?? 0;
        const { value, unit } = bytesParts(n.sizeBytes);
        const showName = r >= 40;
        const showSize = r >= 24;
        const fs = Math.max(11, Math.min(17, r * 0.15));
        const cls = [
          'fs-bubble',
          n.id === largestId && 'is-largest',
          n.id === selectedId && 'is-selected',
          n.id === openingId && 'is-opening',
          !n.isDirectory && 'is-file',
        ]
          .filter(Boolean)
          .join(' ');
        const label = `${n.name}, ${value} ${unit}${n.hasChildren ? ' — ouvrir le dossier' : n.isDirectory ? ', dossier' : ', fichier'}`;
        return (
          <button
            key={n.id}
            type="button"
            ref={(el) => {
              if (el) els.current.set(n.id, el);
              else els.current.delete(n.id);
            }}
            className={cls}
            style={{ width: r * 2, height: r * 2, ['--fs' as string]: `${fs}px` }}
            aria-label={label}
            title={`${n.name} — ${value} ${unit}`}
            onPointerDown={(e) => onPointerDown(e, n.id)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onClick={() => onClick(n)}
          >
            {showName && <span className="fs-bubble-name">{n.name}</span>}
            {showSize && (
              <span className="fs-bubble-size">
                {value}
                <small> {unit}</small>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
