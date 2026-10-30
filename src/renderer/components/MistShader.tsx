/**
 * Fond global « brume » : FBM + déformation de domaine, en WebGL.
 *
 * Règles de performance :
 *  - rendu à basse résolution (RENDER_SCALE × taille CSS × devicePixelRatio), agrandi par le CSS ;
 *  - temps avancé avec le temps RÉEL écoulé (delta rAF, gros écarts bornés) ;
 *  - boucle limitée à ~30 i/s (la brume est lente : invisible à l'œil, moitié moins de travail GPU) ;
 *  - pause quand la fenêtre est masquée ; redimensionnement via ResizeObserver ;
 *  - perte / restauration du contexte WebGL gérées ;
 *  - mouvement réduit : une seule image fixe, aucune boucle ;
 *  - repli sur un dégradé CSS statique si WebGL est indisponible.
 * Aucun backdrop-filter ne doit être posé au-dessus de ce canvas.
 */
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../lib/motion';
import './MistShader.css';

const RENDER_SCALE = 0.4;
const MAX_DPR = 2;
const FRAME_INTERVAL_MS = 1000 / 30;
const MAX_DELTA_S = 0.1;
/** Instant figé utilisé pour l'image statique (mouvement réduit). */
const STATIC_TIME_S = 42;

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/* 4 octaves par fbm, 5 appels de fbm par pixel, à 0,4× la résolution. */
const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res.y;
  vec2 p = uv * 1.35;
  float t = u_time * 0.035;

  vec2 q = vec2(fbm(p + vec2(0.0, 0.0) + t * 0.6),
                fbm(p + vec2(5.2, 1.3) - t * 0.4));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + t),
                fbm(p + 4.0 * q + vec2(8.3, 2.8) - t * 0.7));
  float f = fbm(p + 4.0 * r);

  vec3 base = vec3(0.961, 0.965, 0.973);  /* #f5f6f8 */
  vec3 grey = vec3(0.914, 0.925, 0.953);  /* #e9ecf3 */
  vec3 blue = vec3(0.875, 0.902, 1.0);    /* #dfe6ff */

  vec3 col = base;
  col = mix(col, grey, smoothstep(0.35, 0.85, f) * 0.75);
  col = mix(col, blue, smoothstep(0.55, 1.05, length(q) * f * 1.6) * 0.65);
  col = mix(col, base, smoothstep(0.55, 0.95, r.x) * 0.5);

  /* Haut de la fenêtre un peu plus clair, sous la barre. */
  float top = gl_FragCoord.y / u_res.y;
  col = mix(col, base, smoothstep(0.75, 1.0, top) * 0.5);

  /* Léger tramage contre les bandes. */
  col += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

interface GlState {
  gl: WebGLRenderingContext;
  uRes: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    console.warn('[MistShader]', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function setup(gl: WebGLRenderingContext): GlState | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  return { gl, uRes: gl.getUniformLocation(prog, 'u_res'), uTime: gl.getUniformLocation(prog, 'u_time') };
}

export function MistShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const [fallback, setFallback] = useState(false);
  /** Temps de la brume conservé entre deux montages de l'effet (ex. bascule du mouvement réduit). */
  const timeRef = useRef(Math.random() * 60);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || fallback) return;

    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
    if (!gl) {
      setFallback(true);
      return;
    }

    let state: GlState | null = setup(gl);
    if (!state && !gl.isContextLost()) {
      setFallback(true);
      return;
    }

    let raf = 0;
    let last = -1;
    let sinceDraw = FRAME_INTERVAL_MS;
    let lost = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr * RENDER_SCALE));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr * RENDER_SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const draw = () => {
      if (!state || lost) return;
      const { gl: g, uRes, uTime } = state;
      g.viewport(0, 0, canvas.width, canvas.height);
      g.uniform2f(uRes, canvas.width, canvas.height);
      g.uniform1f(uTime, reduced ? STATIC_TIME_S : timeRef.current);
      g.drawArrays(g.TRIANGLES, 0, 3);
    };

    const frame = (now: number) => {
      raf = 0;
      if (lost || document.hidden) return;
      const deltaMs = last < 0 ? 0 : now - last;
      last = now;
      /* Temps réel, borné pour éviter un saut après une longue image. */
      timeRef.current += Math.min(deltaMs / 1000, MAX_DELTA_S);
      sinceDraw += deltaMs;
      if (sinceDraw >= FRAME_INTERVAL_MS - 1) {
        sinceDraw = 0;
        draw();
      }
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (reduced || raf || lost || document.hidden) return;
      last = -1;
      sinceDraw = FRAME_INTERVAL_MS;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const ro = new ResizeObserver(() => {
      resize();
      /* Redimensionner efface le tampon : redessiner tout de suite (indispensable en image fixe). */
      draw();
    });
    ro.observe(canvas);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      stop();
    };
    const onRestored = () => {
      lost = false;
      state = setup(gl);
      if (!state) {
        setFallback(true);
        return;
      }
      resize();
      draw();
      start();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    resize();
    draw();
    start();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }, [reduced, fallback]);

  if (fallback) return <div className="mist mist-fallback" aria-hidden="true" />;
  return <canvas ref={canvasRef} className="mist" aria-hidden="true" />;
}
