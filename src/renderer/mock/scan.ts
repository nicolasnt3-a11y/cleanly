/**
 * Données fictives : nettoyage, disques, carte d'espace, gros fichiers, doublons.
 * Propriété : agent « écrans des fichiers ».
 *
 * Scénarios de démo :
 *  - premier parcours d'une racine de la carte d'espace : progression sur ~2 s, annulable
 *    (le niveau est alors renvoyé comme « partiel ») ;
 *  - « Windows Update » et « Temporaires Windows » exigent des droits administrateur ;
 *  - les tailles libérées par `files:trash` correspondent aux éléments réellement envoyés.
 */
import type {
  CleanCategory,
  CleanCategoryId,
  DiskBreakdown,
  DriveInfo,
  DuplicateGroup,
  FileKind,
  LargeFilesResult,
  ScanItem,
  SpaceNode,
  SpaceRoot,
  SmartScanResult,
} from '../../../shared/types';
import type { MockContext, MockHandlers } from './index';
import { DAY, GB, MB, delay, mockId, rng } from './util';

const now = Date.now();
const HOUR = 3_600_000;

const drives: DriveInfo[] = [
  { id: 'C:', mount: 'C:\\', label: 'Windows', kind: 'fixed', totalBytes: 1000 * GB, freeBytes: 588 * GB, isSystem: true },
  { id: 'D:', mount: 'D:\\', label: 'Données', kind: 'fixed', totalBytes: 2000 * GB, freeBytes: 1200 * GB, isSystem: false },
  { id: 'E:', mount: 'E:\\', label: 'Clé USB', kind: 'removable', totalBytes: 64 * GB, freeBytes: 41 * GB, isSystem: false },
];

/** Taille de chaque élément simulé (pour des `freedBytes` cohérents). */
const sizes = new Map<string, number>();

function items(base: string, names: Array<[string, number, number?]>, dir = false): ScanItem[] {
  return names.map(([name, size, ageDays = 3]) => {
    const id = mockId('it');
    sizes.set(id, size);
    return {
      id,
      path: `${base}\\${name}`,
      name: name.split('\\').pop() ?? name,
      sizeBytes: size,
      modifiedAt: now - ageDays * DAY,
      isDirectory: dir,
    };
  });
}

const U = 'C:\\Users\\vous';

function categories(): CleanCategory[] {
  const cat = (
    id: CleanCategoryId,
    label: string,
    description: string,
    sizeBytes: number,
    fileCount: number,
    topItems: ScanItem[],
    extra: Partial<CleanCategory> = {},
  ): CleanCategory => ({
    id,
    label,
    description,
    mode: 'permanent',
    sizeBytes,
    fileCount,
    topItems,
    lockedCount: 0,
    recentSkippedCount: 0,
    requiresAdmin: false,
    defaultSelected: true,
    ...extra,
  });
  return [
    cat('win-user-temp', 'Fichiers temporaires utilisateur', '%TEMP% · modifiés il y a plus de 24 h', 3.2 * GB, 6214,
      items(`${U}\\AppData\\Local\\Temp`, [
        ['{4F2A9C1E-77B0}.tmp', 820 * MB, 12],
        ['msedge_url_fetcher_1832', 640 * MB, 9],
        ['NVIDIA Corporation\\NV_Cache', 410 * MB, 30],
        ['vs_setup_bootstrapper', 380 * MB, 60],
        ['WinGet\\cache', 214 * MB, 18],
        ['Zoom_installer_6.2.exe', 96 * MB, 44],
        ['chrome_installer.log', 2 * MB, 40],
        ['dd_vcredist_amd64_20240911.log', 0.4 * MB, 50],
      ]),
      { lockedCount: 23, recentSkippedCount: 148 }),
    cat('win-system-temp', 'Fichiers temporaires Windows', 'C:\\Windows\\Temp', 1.1 * GB, 812,
      items('C:\\Windows\\Temp', [['CBS_persist.cab', 420 * MB, 33], ['DismHost', 280 * MB, 20], ['MpCmdRun.log', 12 * MB, 5]]),
      { requiresAdmin: true, lockedCount: 14 }),
    cat('browser-cache', 'Caches des navigateurs', 'Chrome · Edge · Brave · Firefox · 5 profils', 2.8 * GB, 18_412,
      items(`${U}\\AppData\\Local`, [
        ['Google\\Chrome\\User Data\\Default\\Cache', 1.1 * GB, 1],
        ['Microsoft\\Edge\\User Data\\Default\\Cache', 820 * MB, 1],
        ['Google\\Chrome\\User Data\\Profile 1\\Cache', 460 * MB, 4],
        ['Mozilla\\Firefox\\Profiles\\x8k2.default\\cache2', 290 * MB, 2],
        ['BraveSoftware\\Brave-Browser\\User Data\\Default\\Cache', 130 * MB, 6],
      ], true),
      { lockedCount: 6 }),
    cat('app-cache', "Caches d'applications", 'Discord, Spotify, Teams et 14 autres', 1.6 * GB, 9_204,
      items(`${U}\\AppData`, [
        ['Roaming\\discord\\Cache', 610 * MB, 1],
        ['Local\\Spotify\\Data', 540 * MB, 2],
        ['Local\\Microsoft\\Teams\\Cache', 260 * MB, 5],
        ['Local\\Adobe\\CameraRaw\\Cache', 190 * MB, 20],
      ], true)),
    cat('crash-dumps', 'Vidages sur incident', 'CrashDumps · rapports WER', 0.64 * GB, 37,
      items(`${U}\\AppData\\Local\\CrashDumps`, [['explorer.exe.10312.dmp', 310 * MB, 45], ['Steam.exe.2210.dmp', 190 * MB, 80], ['obs64.exe.9921.dmp', 140 * MB, 120]])),
    cat('win-update', 'Téléchargements Windows Update', 'SoftwareDistribution\\Download', 1.9 * GB, 214,
      items('C:\\Windows\\SoftwareDistribution\\Download', [['a83f19c2e7…cab', 1.2 * GB, 40], ['7d1e04b9aa…psf', 700 * MB, 40]]),
      { requiresAdmin: true }),
    cat('dev-cache', 'Caches de développement', 'npm-cache · pip · NuGet', 1.16 * GB, 41_220,
      items(`${U}\\AppData`, [['Local\\npm-cache\\_cacache', 870 * MB, 7], ['Local\\pip\\cache', 290 * MB, 30]], true)),
    cat('recycle-bin', 'Corbeille', '212 éléments', 0.31 * GB, 212, [], { mode: 'empty-bin', defaultSelected: false }),
    cat('old-downloads', 'Anciens téléchargements', 'Téléchargements · plus de 90 jours · 38 fichiers', 4.2 * GB, 38,
      items(`${U}\\Downloads`, [
        ['Win11_24H2_French_x64.iso', 2.4 * GB, 210],
        ['DaVinci_Resolve_19.zip', 820 * MB, 160],
        ['photos_vacances.zip', 610 * MB, 300],
        ['Blender-4.1-windows-x64.msi', 340 * MB, 190],
        ['Facture_2024-03.pdf', 1.2 * MB, 230],
        ['Contrat_bail_signé.pdf', 0.8 * MB, 410],
      ]),
      { mode: 'trash', defaultSelected: false }),
  ];
}

function breakdown(reclaimable: number): DiskBreakdown {
  const c = drives[0]!;
  return {
    drive: c,
    segments: [
      { id: 'system', label: 'Système', bytes: 62 * GB },
      { id: 'apps', label: 'Applications', bytes: 118 * GB },
      { id: 'user', label: 'Fichiers', bytes: 220 * GB },
      { id: 'reclaimable', label: 'À libérer', bytes: reclaimable },
      { id: 'other', label: 'Autres', bytes: Math.max(0, 412 * GB - 400 * GB - reclaimable) },
      { id: 'free', label: 'Libre', bytes: c.freeBytes },
    ],
  };
}

/* ── Carte d'espace ── */
interface TreeNode {
  name: string;
  size?: number;
  /** true : fichier (pas de descente possible). */
  file?: boolean;
  children?: TreeNode[];
}
const f = (name: string, size: number): TreeNode => ({ name, size, file: true });
const d = (name: string, children: TreeNode[] | number): TreeNode =>
  typeof children === 'number' ? { name, size: children } : { name, children };

const homeTree: TreeNode = d('vous', [
  d('Vidéos', [
    d('Montages 2025', [f('Montage_final_4K.mov', 14.2 * GB), f('Teaser_v2.mp4', 3.1 * GB), d('Exports', 12 * GB), d('Proxys', 8.7 * GB)]),
    d('Rushes', [d('Mariage A', 9.6 * GB), d('Mariage B', 6.1 * GB), d('Drone', 3.3 * GB)]),
    d('Captures', 5 * GB),
    f('Cours_enregistré_S2.mkv', 2.4 * GB),
  ]),
  d('Téléchargements', [
    f('VM_Windows10.vhdx', 32.4 * GB),
    f('Win11_24H2_French_x64.iso', 5.8 * GB),
    f('Ubuntu-24.04-desktop.iso', 5.7 * GB),
    f('DaVinci_Resolve_19.zip', 3.1 * GB),
    d('Pilotes', 1.2 * GB),
    d('Divers', 0.6 * GB),
  ]),
  d('AppData', [
    d('Local', [d('Google', 9.2 * GB), d('Microsoft', 7.4 * GB), d('Docker', 11 * GB), d('npm-cache', 0.9 * GB), d('Temp', 3.2 * GB), d('Spotify', 0.5 * GB)]),
    d('Roaming', [d('discord', 0.7 * GB), d('Code', 1.4 * GB), d('Adobe', 4.1 * GB), d('Mozilla', 0.8 * GB)]),
    d('LocalLow', 1 * GB),
  ]),
  d('Projets', [
    d('site-web', [d('node_modules', 7.8 * GB), d('public', 3.1 * GB), d('src', 0.4 * GB), d('.git', 0.7 * GB)]),
    d('app-mobile', [d('android', 6.2 * GB), d('ios', 3.8 * GB), d('node_modules', 1.2 * GB)]),
    d('archives', 8 * GB),
  ]),
  d('Documents', [d('Factures', 1.1 * GB), d('Administratif', 0.8 * GB), d('Thèse', 6.4 * GB), d('Sauvegardes WhatsApp', 9.3 * GB), d('Jeux enregistrés', 2.2 * GB), f('presentation_finale.pptx', 0.048 * GB)]),
  d('Images', [d('Islande 2024', 7.4 * GB), d('Famille', 5.1 * GB), d('Captures d’écran', 1.2 * GB), d('Lightroom', 4.3 * GB)]),
  d('Musique', [d('Bibliothèque', 4.8 * GB), d('Projets Ableton', 1.2 * GB)]),
  d('OneDrive', [d('Partagé', 2.3 * GB), d('Photos', 3.1 * GB)]),
  d('Bureau', [d('à trier', 2.1 * GB), f('Montage_v3.mp4', 1.4 * GB), f('notes.txt', 0.00002 * GB)]),
  d('.vscode', 0.9 * GB),
  d('.cache', 0.6 * GB),
  d('Favoris', 0.002 * GB),
]);

const trees: Record<string, TreeNode> = {
  home: homeTree,
  'C:': d('C:', [
    d('Utilisateurs', [d('vous', [homeTree]), d('Public', 2.1 * GB), d('Default', 0.4 * GB)]),
    d('Program Files', [d('Adobe', 18 * GB), d('Microsoft Office', 4.2 * GB), d('NVIDIA Corporation', 3.4 * GB), d('Steam', 22 * GB), d('Blackmagic Design', 6.1 * GB), d('Autres programmes', 10.3 * GB)]),
    d('Windows', [d('WinSxS', 14 * GB), d('System32', 9.8 * GB), d('Installer', 6.4 * GB), d('SoftwareDistribution', 2.6 * GB), d('Temp', 1.1 * GB), d('Fonts', 0.9 * GB)]),
    f('pagefile.sys', 16 * GB),
    f('hiberfil.sys', 6.4 * GB),
    d('ProgramData', [d('Package Cache', 9 * GB), d('Microsoft', 7 * GB), d('NVIDIA', 3 * GB), d('Docker', 3 * GB)]),
    d('Program Files (x86)', [d('Steam', 11 * GB), d('Microsoft', 4 * GB), d('Autres', 3 * GB)]),
    f('swapfile.sys', 0.26 * GB),
    d('Recovery', 0.9 * GB),
    d('$Recycle.Bin', 0.31 * GB),
  ]),
  'D:': d('D:', [
    d('Jeux', [d('Cyberpunk 2077', 92 * GB), d('Baldur’s Gate 3', 140 * GB), d('Forza Horizon 5', 118 * GB), d('Hades II', 12 * GB), d('Autres jeux', 58 * GB)]),
    d('Sauvegardes', [d('Image système 2025-09', 120 * GB), d('Téléphone', 38 * GB), d('Ancien PC', 22 * GB)]),
    d('Médias', [d('Films', 61 * GB), d('Séries', 27 * GB), d('Musique HD', 8 * GB)]),
    d('Machines virtuelles', [f('Ubuntu-dev.vhdx', 38 * GB), f('Win10-test.vhdx', 26 * GB)]),
    d('Archives', 40 * GB),
    d('Photos RAW', 21 * GB),
  ]),
};
const sizeOf = (n: TreeNode): number => n.size ?? (n.children ?? []).reduce((a, c) => a + sizeOf(c), 0);

/* ── Gros fichiers ── */
const LARGE: Record<string, Array<[string, string, FileKind, number, number]>> = {
  home: [
    ['VM_Windows10.vhdx', 'Téléchargements', 'disk-image', 32.4, 140],
    ['Montage_final_4K.mov', 'Vidéos\\Montages 2025', 'video', 14.2, 21],
    ['Rushes_mariage_A.mp4', 'Vidéos\\Rushes\\Mariage A', 'video', 9.6, 95],
    ['Sauvegarde_téléphone_2024.zip', 'Documents\\Sauvegardes WhatsApp', 'archive', 7.1, 260],
    ['Win11_24H2_French_x64.iso', 'Téléchargements', 'disk-image', 5.8, 210],
    ['Ubuntu-24.04-desktop.iso', 'Téléchargements', 'disk-image', 5.7, 180],
    ['Rushes_mariage_B.mp4', 'Vidéos\\Rushes\\Mariage B', 'video', 6.1, 95],
    ['Photos_RAW_Islande.zip', 'Images\\Islande 2024', 'archive', 4.3, 330],
    ['docker_data.vhdx', 'AppData\\Local\\Docker\\wsl', 'disk-image', 11, 2],
    ['Teaser_v2.mp4', 'Vidéos\\Montages 2025', 'video', 3.1, 30],
    ['DaVinci_Resolve_19.zip', 'Téléchargements', 'installer', 3.1, 160],
    ['Cours_enregistré_S2.mkv', 'Vidéos', 'video', 2.4, 400],
    ['Thèse_figures_brutes.tar', 'Documents\\Thèse', 'archive', 2.2, 720],
    ['podcast_ep42_brut.wav', 'Musique\\Projets Ableton', 'audio', 1.8, 64],
    ['Montage_v3.mp4', 'Bureau', 'video', 1.4, 300],
    ['Adobe_Premiere_cache.cfa', 'AppData\\Roaming\\Adobe\\Common', 'other', 1.3, 12],
    ['Blender-4.1-windows-x64.msi', 'Téléchargements', 'installer', 0.34, 190],
    ['Thèse_version_finale.pdf', 'Documents\\Thèse', 'document', 0.21, 800],
    ['Panorama_Jökulsárlón.tif', 'Images\\Islande 2024', 'image', 0.62, 330],
    ['site-web-backup.7z', 'Projets\\archives', 'archive', 1.6, 500],
    ['android-emulator.img', 'Projets\\app-mobile\\android', 'disk-image', 2.8, 40],
    ['Bibliothèque.lrcat', 'Images\\Lightroom', 'document', 0.48, 3],
    ['setup_imprimante.exe', 'Téléchargements\\Pilotes', 'installer', 0.212, 620],
    ['libtorch_cuda.dll', 'Projets\\site-web\\node_modules\\.bin', 'code', 0.86, 50],
  ],
  'D:': [
    ['Image système 2025-09.vhdx', 'Sauvegardes\\Image système 2025-09', 'disk-image', 120, 50],
    ['Ubuntu-dev.vhdx', 'Machines virtuelles', 'disk-image', 38, 8],
    ['Win10-test.vhdx', 'Machines virtuelles', 'disk-image', 26, 400],
    ['Téléphone_2025.tar', 'Sauvegardes\\Téléphone', 'archive', 38, 120],
    ['Interstellar.2014.2160p.mkv', 'Médias\\Films', 'video', 58, 700],
    ['Archives_2019-2022.zip', 'Archives', 'archive', 22, 900],
    ['pakchunk0-Windows.pak', 'Jeux\\Baldur’s Gate 3\\Data', 'other', 31, 60],
  ],
};

/* ── Doublons ── */
const DUPES: Array<[string, number, string[]]> = [
  ['Montage_v3.mp4', 1.4 * GB, ['Vidéos\\Montages 2025', 'Bureau']],
  ['Win11_24H2_French_x64.iso', 5.8 * GB, ['Téléchargements', 'Documents\\Installateurs']],
  ['setup_imprimante.exe', 212 * MB, ['Téléchargements', 'Documents\\Pilotes', 'Bureau\\à trier']],
  ['Photos_RAW_Islande.zip', 4.3 * GB, ['Images\\Islande 2024', 'OneDrive\\Photos']],
  ['presentation_finale.pptx', 48 * MB, ['Documents', 'Téléchargements', 'OneDrive\\Partagé', 'Bureau']],
  ['IMG_2041.JPG', 6.2 * MB, ['Images\\Islande 2024', 'Bureau\\à trier', 'Téléchargements']],
  ['Facture_2024-03.pdf', 1.2 * MB, ['Documents\\Factures', 'Téléchargements']],
  ['podcast_ep42_brut.wav', 612 * MB, ['Musique\\Projets Ableton', 'Bureau\\à trier']],
  ['Thèse_v12.docx', 18 * MB, ['Documents\\Thèse', 'OneDrive\\Partagé', 'Documents\\Thèse\\anciennes versions']],
  ['DSC_0192.NEF', 32 * MB, ['Images\\Famille', 'Images\\Lightroom\\Import']],
];

export function createScanMocks(ctx: MockContext): MockHandlers {
  let cancelled = false;
  let lastCats: CleanCategory[] = [];
  const nodeIndex = new Map<string, { node: TreeNode; path: string[]; rootKey: string }>();
  const walked = new Set<string>();
  /** Fichiers déjà envoyés à la corbeille dans la démo (par chemin). */
  const trashedPaths = new Set<string>();
  const pathById = new Map<string, string>();

  const rootKeyOf = (root: SpaceRoot) => (root.kind === 'home' ? 'home' : root.driveId);
  const basePathOf = (rootKey: string) => (rootKey === 'home' ? U : `${rootKey}`);

  return {
    'disk:drives': async () => drives,

    'scan:smart': async () => {
      cancelled = false;
      const started = Date.now();
      const steps = ['cleanup', 'apps', 'startup', 'protection', 'disk'] as const;
      for (let i = 0; i < 24; i++) {
        if (cancelled) throw new Error('Analyse annulée.');
        await delay(110);
        ctx.emit('event:progress', {
          task: 'smart-scan',
          phase: steps[Math.min(steps.length - 1, Math.floor(i / 5))]!,
          fraction: i / 24,
          currentPath: `${U}\\AppData\\Local\\${['Temp', 'Google\\Chrome', 'Microsoft\\Edge', 'Spotify', 'npm-cache'][i % 5]}`,
          bytesFound: (12.4 * GB * i) / 24,
          itemsVisited: i * 3120,
        });
      }
      const cats = categories();
      lastCats = cats;
      const reclaimableBytes = cats.filter((c) => c.defaultSelected).reduce((a, c) => a + c.sizeBytes, 0);
      ctx.emit('event:progress', { task: 'smart-scan', phase: 'done', fraction: 1, bytesFound: reclaimableBytes, itemsVisited: 74_200 });
      const result: SmartScanResult = {
        scanId: mockId('scan'),
        scannedAt: Date.now(),
        durationMs: Date.now() - started,
        categories: cats,
        reclaimableBytes,
        disk: breakdown(reclaimableBytes),
        startup: { enabledCount: 6, highImpactCount: 3 },
        apps: { installedCount: 84, totalBytes: 112 * GB, unusedCount: 3 },
        protection: { score: 86, issues: 2 },
      };
      return result;
    },

    'scan:cancel': async () => {
      cancelled = true;
      return null;
    },

    'clean:run': async (req) => {
      const cats = (lastCats.length ? lastCats : categories()).filter((c) => req.categoryIds.includes(c.id));
      const excluded = new Set(req.excludedItemIds ?? []);
      for (let i = 0; i <= 10; i++) {
        await delay(120);
        ctx.emit('event:progress', {
          task: 'clean',
          phase: 'deleting',
          fraction: i / 10,
          currentPath: cats[Math.min(cats.length - 1, Math.floor((i / 11) * cats.length))]?.topItems[0]?.path,
          bytesFound: 0,
          itemsVisited: i * 400,
        });
      }
      const ok = cats.filter((c) => !c.requiresAdmin);
      const excludedBytes = ok.reduce((a, c) => a + c.topItems.filter((it) => excluded.has(it.id)).reduce((s, it) => s + it.sizeBytes, 0), 0);
      const excludedCount = ok.reduce((a, c) => a + c.topItems.filter((it) => excluded.has(it.id)).length, 0);
      const freedBytes = Math.max(0, ok.reduce((a, c) => a + c.sizeBytes, 0) - excludedBytes - 0.18 * GB);
      if (drives[0]) drives[0].freeBytes = Math.min(drives[0].totalBytes, drives[0].freeBytes + freedBytes);
      return {
        freedBytes,
        deletedCount: ok.filter((c) => c.mode === 'permanent').reduce((a, c) => a + c.fileCount, 0) - excludedCount,
        trashedCount: ok.filter((c) => c.mode !== 'permanent').reduce((a, c) => a + c.fileCount, 0),
        lockedCount: ok.reduce((a, c) => a + c.lockedCount, 0) + 4,
        recentSkippedCount: ok.reduce((a, c) => a + c.recentSkippedCount, 0),
        unsafeRejectedCount: 0,
        needsAdminCategoryIds: cats.filter((c) => c.requiresAdmin).map((c) => c.id),
        errors: [],
      };
    },

    'space:level': async (root, nodeId) => {
      const rootKey = rootKeyOf(root);
      let partial = false;
      if (!walked.has(rootKey)) {
        // Premier parcours : progression réaliste, annulable.
        cancelled = false;
        const total = rootKey === 'home' ? 18 : 26;
        for (let i = 0; i < total; i++) {
          if (cancelled) {
            partial = true;
            break;
          }
          await delay(90);
          ctx.emit('event:progress', {
            task: 'space-map',
            phase: 'walking',
            fraction: null,
            currentPath: `${basePathOf(rootKey)}\\${['AppData\\Local\\Google', 'Vidéos\\Rushes', 'Projets\\site-web\\node_modules', 'Documents\\Thèse', 'Images\\Lightroom', 'Téléchargements'][i % 6]}`,
            bytesFound: i * 9.3 * GB,
            itemsVisited: i * 8_412,
          });
        }
        if (!partial) walked.add(rootKey);
        ctx.emit('event:progress', { task: 'space-map', phase: 'done', fraction: 1, bytesFound: 0, itemsVisited: 0 });
      } else {
        await delay(160);
      }
      const tree = trees[rootKey] ?? trees['C:']!;
      const entry = nodeId ? nodeIndex.get(nodeId) : undefined;
      const node = entry?.node ?? tree;
      const pathParts = entry?.path ?? [];
      const basePath = basePathOf(rootKey);
      const mk = (n: TreeNode, parts: string[]): SpaceNode => {
        const id = mockId('sn');
        nodeIndex.set(id, { node: n, path: parts, rootKey });
        const p = [basePath, ...parts].join('\\');
        pathById.set(id, p);
        const size = sizeOf(n);
        return {
          id,
          name: n.name,
          path: p,
          sizeBytes: size,
          isDirectory: !n.file,
          hasChildren: !!n.children?.length,
          fileCount: n.file ? 1 : Math.max(1, Math.round(size / (3.7 * MB))),
        };
      };
      const self = mk(node, pathParts);
      const visible = (node.children ?? []).filter((c) => !trashedPaths.has([basePath, ...pathParts, c.name].join('\\')));
      const children = visible.map((c) => mk(c, [...pathParts, c.name])).sort((a, b) => b.sizeBytes - a.sizeBytes);
      const crumbs = [{ id: mk(tree, []).id, name: rootKey === 'home' ? 'Dossier personnel' : rootKey }];
      let cur = tree;
      const acc: string[] = [];
      for (const p of pathParts) {
        cur = cur.children!.find((c) => c.name === p)!;
        acc.push(p);
        crumbs.push({ id: mk(cur, [...acc]).id, name: p });
      }
      if (partial) {
        // Parcours interrompu : seuls les premiers dossiers sont connus.
        children.splice(Math.ceil(children.length / 2));
      }
      return { mapId: mockId('map'), root, node: self, children, crumbs, skippedCount: rootKey === 'home' ? 12 : 318, partial };
    },

    'files:large': async (req) => {
      const rootKey = rootKeyOf(req.root);
      for (let i = 0; i < 10; i++) {
        await delay(70);
        ctx.emit('event:progress', {
          task: 'large-files',
          phase: 'walking',
          fraction: null,
          currentPath: `${basePathOf(rootKey)}\\${['Vidéos', 'Téléchargements', 'Documents', 'AppData\\Local', 'Images'][i % 5]}`,
          bytesFound: 0,
          itemsVisited: i * 6_120,
        });
      }
      const r = rng(rootKey.length * 7 + 3);
      const src = rootKey === 'D:' ? LARGE['D:']! : LARGE.home!;
      const base = rootKey === 'C:' ? U : basePathOf(rootKey);
      const min = req.minBytes ?? 100 * MB;
      const out: LargeFilesResult['items'] = [];
      for (const [name, dir, kind, gb, age] of src) {
        const path = `${base}\\${dir}\\${name}`;
        if (gb * GB < min || trashedPaths.has(path)) continue;
        const id = mockId('lf');
        sizes.set(id, gb * GB);
        pathById.set(id, path);
        out.push({ id, path, name, sizeBytes: Math.round(gb * GB * (0.97 + r() * 0.06)), modifiedAt: now - age * DAY - Math.round(r() * 20) * HOUR, isDirectory: false, kind });
      }
      if (rootKey === 'C:') {
        out.push({ id: mockId('lf'), path: 'C:\\pagefile.sys', name: 'pagefile.sys', sizeBytes: 16 * GB, modifiedAt: now - 2 * HOUR, isDirectory: false, kind: 'other' });
      }
      return { scanId: mockId('large'), items: out.sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, req.limit ?? 200), skippedCount: rootKey === 'home' ? 4 : 211 };
    },

    'files:duplicates': async (req) => {
      const rootKey = rootKeyOf(req.root);
      const phases = [
        ['walking', 8, 412],
        ['hashing-partial', 7, 37],
        ['hashing-full', 6, 23],
      ] as const;
      for (const [phase, n, found] of phases) {
        for (let i = 1; i <= n; i++) {
          await delay(phase === 'walking' ? 110 : 150);
          ctx.emit('event:progress', {
            task: 'duplicates',
            phase,
            fraction: phase === 'walking' ? null : i / n,
            currentPath: `${basePathOf(rootKey)}\\${['Images\\Islande 2024', 'Téléchargements', 'Bureau\\à trier', 'Documents\\Thèse'][i % 4]}`,
            bytesFound: 0,
            itemsVisited: Math.round((found * i) / n),
          });
        }
      }
      const base = rootKey === 'C:' ? U : basePathOf(rootKey);
      const r = rng(11);
      const groups: DuplicateGroup[] = [];
      for (const [name, size, places] of DUPES) {
        const files = places
          .map((p, i) => {
            const id = mockId('df');
            const path = `${base}\\${p}\\${name}`;
            sizes.set(id, size);
            pathById.set(id, path);
            return { id, path, name, sizeBytes: size, modifiedAt: now - (420 - i * 37 - Math.round(r() * 20)) * DAY, isDirectory: false };
          })
          .filter((x) => !trashedPaths.has(x.path));
        if (files.length < 2) continue;
        groups.push({
          id: mockId('dg'),
          hash: Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join(''),
          sizeBytes: size,
          files,
          wastedBytes: size * (files.length - 1),
        });
      }
      groups.sort((a, b) => b.wastedBytes - a.wastedBytes);
      ctx.emit('event:progress', { task: 'duplicates', phase: 'done', fraction: 1, bytesFound: 0, itemsVisited: 0 });
      return {
        scanId: mockId('dup'),
        groups,
        totalWastedBytes: groups.reduce((a, g) => a + g.wastedBytes, 0),
        stats: { candidatesBySize: 412, candidatesByPartialHash: 37, confirmed: groups.reduce((a, g) => a + g.files.length, 0) },
        skippedCount: 6,
      };
    },

    'files:trash': async (req) => {
      await delay(450);
      let freed = 0;
      const failed: Array<{ itemId: string; reason: string }> = [];
      let trashed = 0;
      for (const id of req.itemIds) {
        const path = pathById.get(id);
        if (path && /\\(pagefile|hiberfil|swapfile)\.sys$/i.test(path)) {
          failed.push({ itemId: id, reason: 'Fichier système protégé.' });
          continue;
        }
        const entry = nodeIndex.get(id);
        freed += sizes.get(id) ?? (entry ? sizeOf(entry.node) : 0);
        if (path) trashedPaths.add(path);
        trashed++;
      }
      return { trashedCount: trashed, freedBytes: freed, failed };
    },
  };
}
