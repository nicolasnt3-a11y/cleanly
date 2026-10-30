// Génère les icônes de l'application à partir de build/icon.svg :
//   build/icon.png  (1024×1024, grille macOS avec marge et ombre)
//   build/icon.ico  (16 → 256, PNG embarqués, cadrage serré pour Windows)
//   build/icon.icns (16 → 1024, PNG embarqués)
// Usage : npm run icons
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
const svgMac = readFileSync(join(buildDir, 'icon.svg'), 'utf8');

// Windows : pas de marge « grille macOS » ni d'ombre portée, l'icône remplit le carré.
const svgWin = svgMac
  .replace('viewBox="0 0 1024 1024"', 'viewBox="96 96 832 832"')
  .replace(/\s*<use href="#squircle" fill="#000" filter="url\(#shadow\)"\/>/, '');

function render(svg, size) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
    shapeRendering: 2,
    font: { loadSystemFonts: false },
  });
  return Buffer.from(r.render().asPng());
}

// --- PNG 1024 ---------------------------------------------------------------
const png1024 = render(svgMac, 1024);
writeFileSync(join(buildDir, 'icon.png'), png1024);

// --- ICO (entrées PNG, supportées depuis Windows Vista) -----------------------
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const icoImages = icoSizes.map((s) => render(svgWin, s));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // réservé
header.writeUInt16LE(1, 2); // type : icône
header.writeUInt16LE(icoSizes.length, 4);
const dir = Buffer.alloc(16 * icoSizes.length);
let offset = 6 + dir.length;
icoSizes.forEach((s, i) => {
  const o = i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, o);
  dir.writeUInt8(s >= 256 ? 0 : s, o + 1);
  dir.writeUInt8(0, o + 2); // palette
  dir.writeUInt8(0, o + 3);
  dir.writeUInt16LE(1, o + 4); // plans
  dir.writeUInt16LE(32, o + 6); // bits par pixel
  dir.writeUInt32LE(icoImages[i].length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += icoImages[i].length;
});
writeFileSync(join(buildDir, 'icon.ico'), Buffer.concat([header, dir, ...icoImages]));

// --- ICNS (entrées PNG) --------------------------------------------------------
const icnsTypes = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32], // 16@2x
  ['ic12', 64], // 32@2x
  ['ic13', 256], // 128@2x
  ['ic14', 512], // 256@2x
];
const cache = new Map([[1024, png1024]]);
const chunks = icnsTypes.map(([type, size]) => {
  if (!cache.has(size)) cache.set(size, render(svgMac, size));
  const data = cache.get(size);
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([head, data]);
});
const body = Buffer.concat(chunks);
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii');
icnsHead.writeUInt32BE(body.length + 8, 4);
writeFileSync(join(buildDir, 'icon.icns'), Buffer.concat([icnsHead, body]));

console.log(
  `Icônes générées dans build/ : icon.png (1024), icon.ico (${icoSizes.join(', ')}), icon.icns (${[
    ...new Set(icnsTypes.map(([, s]) => s)),
  ]
    .sort((a, b) => a - b)
    .join(', ')})`,
);
