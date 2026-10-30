/**
 * Petit moteur physique 2D pour les bulles de la carte d'espace (sans dépendance).
 *
 * - Cercles de masse ∝ aire (r²).
 * - Attraction douce vers le centre (ressort, accélération ∝ distance) + amortissement exponentiel.
 * - Collisions cercle–cercle : correction de position pondérée par l'inverse des masses
 *   + impulsion avec restitution (une seule fois par pas, pour éviter les rebonds parasites).
 * - Collisions avec les parois (restitution distincte).
 * - Un corps « tenu » (glissé au pointeur) a une masse infinie : il pousse les autres sans être poussé.
 * - Le rayon peut s'animer vers `targetR` (apparition / disparition / transition de descente).
 *
 * Unités : pixels et secondes. Le pas est fixe (voir `Simulation`).
 */

export interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rayon courant (animé vers targetR). */
  r: number;
  targetR: number;
  /** Tenu par le pointeur : position imposée, masse infinie. */
  held: boolean;
  /** Épinglé (ex. bulle qui s'ouvre pendant la transition) : immobile, masse infinie. */
  pinned: boolean;
}

export interface WorldOptions {
  /** Raideur de l'attraction vers le centre (s⁻²). */
  pull: number;
  /** Amortissement (s⁻¹). */
  damping: number;
  restitution: number;
  wallRestitution: number;
  /** Espace minimal entre deux bulles (px). */
  gap: number;
  /** Itérations du solveur de contacts par pas. */
  iterations: number;
  /** Vitesse d'animation des rayons (s⁻¹). */
  growRate: number;
}

export const DEFAULT_OPTIONS: WorldOptions = {
  pull: 3.2,
  damping: 2.6,
  restitution: 0.55,
  wallRestitution: 0.62,
  gap: 5,
  iterations: 4,
  growRate: 7,
};

export class World {
  bodies: Body[] = [];
  width = 1;
  height = 1;
  opts: WorldOptions;

  constructor(opts: Partial<WorldOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  get(id: string): Body | undefined {
    return this.bodies.find((b) => b.id === id);
  }

  private invMass(b: Body): number {
    if (b.held || b.pinned) return 0;
    const r = Math.max(2, b.r);
    return 1 / (r * r);
  }

  step(dt: number): void {
    const { pull, damping, restitution, wallRestitution, gap, iterations, growRate } = this.opts;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const grow = 1 - Math.exp(-growRate * dt);
    const damp = Math.exp(-damping * dt);
    const bodies = this.bodies;
    const n = bodies.length;

    // 1. Rayons, forces, intégration (Euler semi-implicite).
    for (const b of bodies) {
      const dr = b.targetR - b.r;
      b.r = Math.abs(dr) < 0.05 ? b.targetR : b.r + dr * grow;
      if (b.held) continue; // position et vitesse imposées par le pointeur
      if (b.pinned) {
        b.vx = 0;
        b.vy = 0;
        continue;
      }
      // Attraction vers le centre, un peu plus forte horizontalement sur une scène large
      // pour que l'amas épouse la forme de la scène.
      const aspect = this.width / this.height;
      const kx = pull / Math.max(1, Math.sqrt(aspect));
      const ky = pull * Math.min(1.6, Math.max(1, Math.sqrt(aspect)));
      b.vx += (cx - b.x) * kx * dt;
      b.vy += (cy - b.y) * ky * dt;
      b.vx *= damp;
      b.vy *= damp;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    // 2. Contacts cercle–cercle.
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < n; i++) {
        const a = bodies[i]!;
        const ia = this.invMass(a);
        for (let j = i + 1; j < n; j++) {
          const b = bodies[j]!;
          const ib = this.invMass(b);
          const wsum = ia + ib;
          if (wsum === 0) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const minD = a.r + b.r + gap;
          let d2 = dx * dx + dy * dy;
          if (d2 >= minD * minD) continue;
          if (d2 < 1e-6) {
            // Centres confondus : direction arbitraire mais stable.
            dx = Math.cos(i * 2.399 + j);
            dy = Math.sin(i * 2.399 + j);
            d2 = 1;
          }
          const dist = Math.sqrt(d2);
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minD - dist;
          // Correction de position (80 %, tolérance 0,25 px).
          const corr = (Math.max(0, overlap - 0.25) * 0.8) / wsum;
          a.x -= nx * corr * ia;
          a.y -= ny * corr * ia;
          b.x += nx * corr * ib;
          b.y += ny * corr * ib;
          if (it === 0) {
            // Impulsion seulement si les corps se rapprochent.
            const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (vn < 0) {
              const jImp = (-(1 + restitution) * vn) / wsum;
              a.vx -= jImp * ia * nx;
              a.vy -= jImp * ia * ny;
              b.vx += jImp * ib * nx;
              b.vy += jImp * ib * ny;
            }
          }
        }
      }
    }

    // 3. Parois.
    for (const b of bodies) {
      const r = b.r;
      if (r * 2 >= this.width) b.x = cx;
      else if (b.x - r < 0) {
        b.x = r;
        if (b.vx < 0) b.vx = -b.vx * wallRestitution;
      } else if (b.x + r > this.width) {
        b.x = this.width - r;
        if (b.vx > 0) b.vx = -b.vx * wallRestitution;
      }
      if (r * 2 >= this.height) b.y = cy;
      else if (b.y - r < 0) {
        b.y = r;
        if (b.vy < 0) b.vy = -b.vy * wallRestitution;
      } else if (b.y + r > this.height) {
        b.y = this.height - r;
        if (b.vy > 0) b.vy = -b.vy * wallRestitution;
      }
    }
  }

  /** true si plus rien ne bouge visiblement (ni vitesse, ni rayon en cours d'animation). */
  isSettled(): boolean {
    for (const b of this.bodies) {
      if (b.held) return false;
      if (Math.abs(b.targetR - b.r) > 0.05) return false;
      if (b.vx * b.vx + b.vy * b.vy > 9) return false; // < 3 px/s
    }
    return true;
  }
}

/** Boucle à pas fixe pilotée par requestAnimationFrame, mise en pause quand la page est masquée. */
export class Simulation {
  /** Pas fixe : 120 Hz. */
  static readonly STEP = 1 / 120;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private quiet = 0;
  private running = false;
  private disposed = false;

  constructor(
    readonly world: World,
    private readonly render: () => void,
  ) {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** (Re)démarre la boucle si elle dort. */
  wake(): void {
    this.quiet = 0;
    if (this.running || this.disposed || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Avance la simulation hors écran (mise en place statique, mouvement réduit). */
  settle(maxSteps = 1500): void {
    for (let i = 0; i < maxSteps; i++) {
      this.world.step(Simulation.STEP);
      if (i > 60 && this.world.isSettled()) break;
    }
  }

  private onVisibility = () => {
    if (document.hidden) this.stop();
    else this.wake();
  };

  private frame = (now: number) => {
    if (!this.running) return;
    // Temps réel écoulé, borné (onglet ralenti, point d'arrêt…) pour éviter la « spirale de la mort ».
    const elapsed = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.acc += elapsed;
    let steps = 0;
    while (this.acc >= Simulation.STEP && steps < 16) {
      this.world.step(Simulation.STEP);
      this.acc -= Simulation.STEP;
      steps++;
    }
    if (steps === 16) this.acc = 0;
    this.render();
    // Mise en sommeil après ~0,5 s d'immobilité : aucun coût CPU quand la carte est stable.
    if (this.world.isSettled()) this.quiet += elapsed;
    else this.quiet = 0;
    if (this.quiet > 0.5) {
      this.running = false;
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };
}

/**
 * Rayons cibles : aire ∝ taille, normalisée pour que les bulles couvrent `fill` de la scène.
 * Un rayon minimal garde les petits éléments cliquables (au prix d'une légère sur-représentation).
 */
export function radiiFor(sizes: number[], width: number, height: number, fill = 0.5): number[] {
  const total = sizes.reduce((a, s) => a + Math.max(0, s), 0);
  if (total <= 0 || width <= 0 || height <= 0) return sizes.map(() => 16);
  const minR = Math.max(10, Math.min(width, height) * 0.025);
  const maxR = Math.min(width, height) * 0.4;
  const area = width * height * fill;
  // Le rayon minimal « vole » de l'aire : on réduit légèrement l'échelle pour compenser.
  let scale = 1;
  for (let pass = 0; pass < 3; pass++) {
    let used = 0;
    for (const s of sizes) {
      const r = Math.min(maxR, Math.max(minR, Math.sqrt((area * scale * Math.max(0, s)) / (Math.PI * total))));
      used += Math.PI * r * r;
    }
    if (used <= area * 1.02) break;
    scale *= area / used;
  }
  return sizes.map((s) => Math.min(maxR, Math.max(minR, Math.sqrt((area * scale * Math.max(0, s)) / (Math.PI * total)))));
}
