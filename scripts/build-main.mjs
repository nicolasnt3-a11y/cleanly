// Empaquette le processus principal (ESM) et le preload (CJS) avec esbuild.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  logLevel: 'info',
  define: { 'process.env.CLEANLY_DEV': JSON.stringify(dev ? '1' : '') },
};

const mainOpts = {
  ...common,
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist/main/main.js',
  format: 'esm',
  // Les dépendances npm restent dans node_modules (embarquées par electron-builder).
  packages: 'external',
  external: ['electron'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
};

const preloadOpts = {
  ...common,
  entryPoints: ['src/main/preload.ts'],
  outfile: 'dist/preload/preload.cjs',
  format: 'cjs',
  // Preload sandboxé : seul « electron » peut être requis, tout le reste est empaqueté.
  external: ['electron'],
};

if (watch) {
  const ctxs = await Promise.all([esbuild.context(mainOpts), esbuild.context(preloadOpts)]);
  await Promise.all(ctxs.map((c) => c.watch()));
} else {
  await Promise.all([esbuild.build(mainOpts), esbuild.build(preloadOpts)]);
}
