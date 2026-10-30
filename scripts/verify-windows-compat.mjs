/**
 * Vérification automatisée de compatibilité Windows & de sécurité Cleanly.
 * Exécuté en local (`npm run verify`) et sur GitHub Actions (`windows-latest`)
 * lors de chaque mise à jour d'Electron ou de Windows.
 *
 * Strictement en LECTURE SEULE sur le système hôte (les tests d'écriture/suppression
 * s'exécutent uniquement dans un dossier temporaire isolé puis nettoyé).
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const bundleOut = path.join(distDir, `verify-bundle-${process.pid}.mjs`);

const entryCode = `
export * from ${JSON.stringify(path.join(rootDir, 'src/main/safety/index.ts'))};
export { formatWindowsLabel } from ${JSON.stringify(path.join(rootDir, 'src/main/services/system/os-label.ts'))};
export { osLabel, protectionReport, listStartupItems, listInstalledApps } from ${JSON.stringify(path.join(rootDir, 'src/main/services/system/index.ts'))};
export { listDrives, scanCleanupCategories } from ${JSON.stringify(path.join(rootDir, 'src/main/services/scan/index.ts'))};
`;

const electronStubPlugin = {
  name: 'electron-stub',
  setup(build) {
    build.onResolve({ filter: /^electron$/ }, () => ({
      path: 'electron',
      namespace: 'electron-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'electron-stub' }, () => ({
      contents: `
        export const shell = {
          trashItem: async () => { throw new Error('trashItem désactivé en mode vérification'); },
          openPath: async () => ''
        };
        export const app = {
          getName: () => 'Cleanly',
          getPath: () => '',
          getFileIcon: async () => ({ isEmpty: () => true, toDataURL: () => '' })
        };
      `,
      loader: 'js',
    }));
  },
};

function assert(cond, msg) {
  if (!cond) {
    console.error('  ✗ ÉCHEC :', msg);
    process.exitCode = 1;
  } else {
    console.log('  ✓', msg);
  }
}

try {
  await esbuild.build({
    stdin: {
      contents: entryCode,
      resolveDir: rootDir,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile: bundleOut,
    plugins: [electronStubPlugin],
    external: ['iconv-lite'],
  });

  const mod = await import(pathToFileURL(bundleOut).href);

  console.log('\n=== 1. Vérification des garde-fous de sécurité (Safety Layer) ===');
  const badSyntaxes = [
    '',
    'relative/path',
    '\\\\server\\share\\file.txt',
    '\\\\?\\C:\\Temp\\file.txt',
    'C:\\Temp\\file.txt:ads',
    'C:\\Temp\\trailingdot.\\file.txt',
    'C:\\Temp\\PROGRA~1\\file.txt',
    'C:\\Temp\\..\\Windows\\System32\\cmd.exe',
  ];
  for (const bad of badSyntaxes) {
    assert(mod.unsafePathSyntax(bad) !== null, `Syntaxe dangereuse rejetée : ${JSON.stringify(bad)}`);
  }

  if (process.platform === 'win32') {
    const home = os.homedir();
    const protectedPaths = [
      'C:\\',
      home,
      'C:\\Windows',
      'C:\\Windows\\System32\\kernel32.dll',
      'C:\\Program Files',
      'C:\\$Recycle.Bin',
      path.join(home, 'Desktop'),
      path.join(home, 'Documents'),
      path.join(home, 'Downloads'),
      path.join(home, 'AppData'),
    ];
    for (const p of protectedPaths) {
      const reason = await mod.protectedPathReason(p);
      assert(reason !== null, `Chemin protégé bloqué : ${p}`);
    }

    const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanly-verify-sandbox-'));
    try {
      const resolvedRoots = await mod.resolveAllowedRoots([sandboxRoot]);
      assert(resolvedRoots.length === 1, 'Racine temporaire autorisée résolue');

      const recentFile = path.join(resolvedRoots[0], 'recent.tmp');
      fs.writeFileSync(recentFile, 'recent');
      const rRecent = await mod.unlinkFileChecked(recentFile, resolvedRoots, 86_400_000);
      assert(rRecent.kind === 'recent' && fs.existsSync(recentFile), 'Règle des 24h : fichier récent conservé');

      const oldFile = path.join(resolvedRoots[0], 'old.tmp');
      fs.writeFileSync(oldFile, 'old-data');
      const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
      fs.utimesSync(oldFile, twoDaysAgo, twoDaysAgo);
      const rOld = await mod.unlinkFileChecked(oldFile, resolvedRoots, 86_400_000);
      assert(rOld.kind === 'deleted' && !fs.existsSync(oldFile), 'Fichier > 24h dans la racine autorisée supprimé');

      const rRoot = await mod.rmdirIfEmptyChecked(resolvedRoots[0], resolvedRoots);
      assert(rRoot === false && fs.existsSync(resolvedRoots[0]), 'La racine autorisée ne se supprime jamais elle-même');
    } finally {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
  }

  console.log('\n=== 2. Vérification de la compatibilité Windows (Sondes OS & WMI/Registre) ===');
  assert(
    mod.formatWindowsLabel('Windows 10 Pro', 26200, '25H2') === 'Windows 11 Pro 25H2',
    'Formatage de version Windows 11 (25H2/26H2+) valide',
  );

  const label = await mod.osLabel();
  assert(typeof label === 'string' && label.length > 0, `Sonde OS active : "${label}"`);

  const drives = await mod.listDrives();
  assert(Array.isArray(drives) && drives.length > 0 && drives[0].totalBytes > 0, `Sonde Disques active : ${drives.length} volume(s) détecté(s)`);

  if (process.platform === 'win32') {
    const prot = await mod.protectionReport();
    assert(
      typeof prot.score === 'number' && Array.isArray(prot.checks) && prot.checks.length >= 4,
      `Sonde Centre de sécurité Windows active : score ${prot.score}/100 (${prot.checks.length} contrôles)`,
    );

    const startup = await mod.listStartupItems();
    assert(Array.isArray(startup), `Sonde Registre Démarrage active : ${startup.length} entrée(s) lue(s)`);

    const apps = await mod.listInstalledApps();
    assert(Array.isArray(apps) && apps.length > 0, `Sonde Applications installées active : ${apps.length} application(s) détectée(s)`);

    const scanRes = await mod.scanCleanupCategories({
      signal: new AbortController().signal,
      progress: () => {},
      settings: async () => ({ oldDownloadsDays: 30, largeFileMinMB: 100 }),
    });
    assert(
      Array.isArray(scanRes.categories) && scanRes.categories.length >= 8,
      `Analyse des catégories (lecture seule) active : ${scanRes.categories?.length} catégories analysées`,
    );
  }

  if (process.exitCode === 1) {
    console.error('\nCertaines vérifications ont échoué.');
    process.exit(1);
  } else {
    console.log('\nToutes les vérifications de sécurité et de compatibilité Windows ont réussi.');
  }
} finally {
  fs.rmSync(bundleOut, { force: true });
}
