/**
 * Données fictives : nettoyage, disques, carte d'espace, gros fichiers, doublons.
 * Propriété : agent « écrans des fichiers » (peut enrichir librement).
 */
import type {
  CleanCategory,
  CleanCategoryId,
  DiskBreakdown,
  DriveInfo,
  ScanItem,
  SmartScanResult,
} from '../../../shared/types';
import type { MockContext, MockHandlers } from './index';
import { DAY, GB, MB, delay, mockId, rng } from './util';

const now = Date.now();

const drives: DriveInfo[] = [
  { id: 'C:', mount: 'C:\\', label: 'Windows', kind: 'fixed', totalBytes: 1000 * GB, freeBytes: 588 * GB, isSystem: true },
  { id: 'D:', mount: 'D:\\', label: 'Données', kind: 'fixed', totalBytes: 2000 * GB, freeBytes: 1200 * GB, isSystem: false },
];

function items(base: string, names: Array<[string, number, number?]>, dir = false): ScanItem[] {
  return names.map(([name, size, ageDays = 3]) => ({
    id: mockId('it'),
    path: `${base}\\${name}`,
    name,
    sizeBytes: size,
    modifiedAt: now - ageDays * DAY,
    isDirectory: dir,
  }));
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
      items(`${U}\\AppData\\Local\\Temp`, [['chrome_installer.log', 2 * MB, 40], ['{4F2A}.tmp', 820 * MB, 12], ['msedge_url_fetcher_1832', 640 * MB, 9], ['NVIDIA Corporation', 410 * MB, 30], ['vs_setup_bootstrapper', 380 * MB, 60]]),
      { lockedCount: 23, recentSkippedCount: 148 }),
    cat('win-system-temp', 'Fichiers temporaires Windows', 'C:\\Windows\\Temp', 1.1 * GB, 812,
      items('C:\\Windows\\Temp', [['MpCmdRun.log', 12 * MB, 5], ['CBS_persist.cab', 420 * MB, 33], ['DismHost', 280 * MB, 20]]),
      { requiresAdmin: true, lockedCount: 14 }),
    cat('browser-cache', 'Caches des navigateurs', 'Chrome · Edge · Brave · Firefox · 5 profils', 2.8 * GB, 18_412,
      items(`${U}\\AppData\\Local`, [['Google\\Chrome\\User Data\\Default\\Cache', 1.1 * GB], ['Microsoft\\Edge\\User Data\\Default\\Cache', 820 * MB], ['Google\\Chrome\\User Data\\Profile 1\\Cache', 460 * MB], ['Mozilla\\Firefox\\Profiles\\x8k2.default\\cache2', 290 * MB], ['BraveSoftware\\Brave-Browser\\User Data\\Default\\Cache', 130 * MB]], true)),
    cat('app-cache', "Caches d'applications", 'Discord, Spotify, Teams et 14 autres', 1.6 * GB, 9_204,
      items(`${U}\\AppData`, [['Roaming\\discord\\Cache', 610 * MB], ['Local\\Spotify\\Data', 540 * MB], ['Local\\Microsoft\\Teams\\Cache', 260 * MB], ['Local\\Adobe\\CameraRaw\\Cache', 190 * MB]], true)),
    cat('crash-dumps', 'Vidages sur incident', 'CrashDumps · rapports WER', 0.64 * GB, 37,
      items(`${U}\\AppData\\Local\\CrashDumps`, [['explorer.exe.10312.dmp', 310 * MB, 45], ['Steam.exe.2210.dmp', 190 * MB, 80], ['obs64.exe.9921.dmp', 140 * MB, 120]])),
    cat('win-update', 'Téléchargements Windows Update', 'SoftwareDistribution\\Download', 1.9 * GB, 214,
      items('C:\\Windows\\SoftwareDistribution\\Download', [['a83f…cab', 1.2 * GB, 40], ['7d1e…psf', 700 * MB, 40]]),
      { requiresAdmin: true }),
    cat('dev-cache', 'Caches de développement', 'npm-cache · pip', 1.16 * GB, 41_220,
      items(`${U}\\AppData`, [['Local\\npm-cache\\_cacache', 870 * MB], ['Local\\pip\\cache', 290 * MB]], true)),
    cat('recycle-bin', 'Corbeille', '212 éléments', 0.31 * GB, 212, [], { mode: 'empty-bin', defaultSelected: false }),
    cat('old-downloads', 'Anciens téléchargements', 'Téléchargements · plus de 90 jours · 38 fichiers', 4.2 * GB, 38,
      items(`${U}\\Downloads`, [['Win11_24H2_French_x64.iso', 2.4 * GB, 210], ['Blender-4.1-windows-x64.msi', 340 * MB, 190], ['DaVinci_Resolve_19.zip', 820 * MB, 160], ['Facture_2024-03.pdf', 1.2 * MB, 230], ['photos_vacances.zip', 610 * MB, 300]]),
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
  children?: TreeNode[];
}
const trees: Record<string, TreeNode> = {
  home: {
    name: 'vous',
    children: [
      { name: 'Vidéos', children: [{ name: 'Montages 2025', size: 38 * GB }, { name: 'Rushes', size: 19 * GB }, { name: 'Captures', size: 5 * GB }] },
      { name: 'Téléchargements', size: 48 * GB },
      { name: 'AppData', children: [{ name: 'Local', size: 33 * GB }, { name: 'Roaming', size: 7 * GB }, { name: 'LocalLow', size: 1 * GB }] },
      { name: 'Projets', children: [{ name: 'site-web', size: 12 * GB }, { name: 'app-mobile', size: 11 * GB }, { name: 'archives', size: 8 * GB }] },
      { name: 'Documents', size: 24 * GB },
      { name: 'Images', size: 18 * GB },
      { name: 'Musique', size: 6 * GB },
      { name: 'Bureau', size: 3.2 * GB },
    ],
  },
  'C:': {
    name: 'C:',
    children: [
      { name: 'Utilisateurs', size: 182 * GB },
      { name: 'Program Files', size: 64 * GB },
      { name: 'Windows', size: 38 * GB },
      { name: 'Fichiers système', size: 24 * GB },
      { name: 'ProgramData', size: 22 * GB },
      { name: 'Program Files (x86)', size: 18 * GB },
      { name: 'Autres', size: 9 * GB },
    ],
  },
  'D:': {
    name: 'D:',
    children: [
      { name: 'Jeux', size: 420 * GB },
      { name: 'Sauvegardes', size: 180 * GB },
      { name: 'Médias', size: 96 * GB },
      { name: 'Machines virtuelles', size: 64 * GB },
      { name: 'Archives', size: 40 * GB },
    ],
  },
};
const sizeOf = (n: TreeNode): number => n.size ?? (n.children ?? []).reduce((a, c) => a + sizeOf(c), 0);

export function createScanMocks(ctx: MockContext): MockHandlers {
  let cancelled = false;
  const nodeIndex = new Map<string, { node: TreeNode; path: string[]; rootKey: string }>();

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
      const cats = categories().filter((c) => req.categoryIds.includes(c.id));
      for (let i = 0; i <= 10; i++) {
        await delay(120);
        ctx.emit('event:progress', { task: 'clean', phase: 'deleting', fraction: i / 10, bytesFound: 0, itemsVisited: i * 400 });
      }
      const needsAdmin = cats.filter((c) => c.requiresAdmin);
      return {
        freedBytes: cats.filter((c) => !c.requiresAdmin).reduce((a, c) => a + c.sizeBytes, 0) - 0.18 * GB,
        deletedCount: cats.filter((c) => c.mode === 'permanent').reduce((a, c) => a + c.fileCount, 0),
        trashedCount: cats.filter((c) => c.mode === 'trash').reduce((a, c) => a + c.fileCount, 0),
        lockedCount: 37,
        recentSkippedCount: 148,
        unsafeRejectedCount: 0,
        needsAdminCategoryIds: needsAdmin.map((c) => c.id),
        errors: [],
      };
    },

    'space:level': async (root, nodeId) => {
      await delay(250);
      const rootKey = root.kind === 'home' ? 'home' : root.driveId;
      const tree = trees[rootKey] ?? trees['C:']!;
      const entry = nodeId ? nodeIndex.get(nodeId) : undefined;
      const node = entry?.node ?? tree;
      const pathParts = entry?.path ?? [];
      const basePath = rootKey === 'home' ? U : `${rootKey}\\`;
      const mk = (n: TreeNode, parts: string[]) => {
        const id = mockId('sn');
        nodeIndex.set(id, { node: n, path: parts, rootKey });
        return {
          id,
          name: n.name,
          path: [basePath.replace(/\\$/, ''), ...parts].join('\\'),
          sizeBytes: sizeOf(n),
          isDirectory: true,
          hasChildren: !!n.children?.length,
          fileCount: Math.round(sizeOf(n) / (4 * MB)),
        };
      };
      const self = mk(node, pathParts);
      const children = (node.children ?? []).map((c) => mk(c, [...pathParts, c.name])).sort((a, b) => b.sizeBytes - a.sizeBytes);
      const crumbs = [{ id: mk(tree, []).id, name: rootKey === 'home' ? 'Dossier personnel' : rootKey }];
      let cur = tree;
      const acc: string[] = [];
      for (const p of pathParts) {
        cur = cur.children!.find((c) => c.name === p)!;
        acc.push(p);
        crumbs.push({ id: mk(cur, [...acc]).id, name: p });
      }
      return { mapId: mockId('map'), root, node: self, children, crumbs, skippedCount: 12, partial: false };
    },

    'files:large': async () => {
      await delay(600);
      const r = rng(7);
      const names: Array<[string, string, number]> = [
        ['Win11_24H2_French_x64.iso', 'disk-image', 5.8],
        ['Montage_final_4K.mov', 'video', 14.2],
        ['Rushes_mariage_A.mp4', 'video', 9.6],
        ['Ubuntu-24.04-desktop.iso', 'disk-image', 5.7],
        ['Sauvegarde_téléphone_2024.zip', 'archive', 7.1],
        ['VM_Windows10.vhdx', 'disk-image', 32.4],
        ['Photos_RAW_Islande.zip', 'archive', 4.3],
        ['DaVinci_Resolve_19.zip', 'installer', 3.1],
        ['Cours_enregistré_S2.mkv', 'video', 2.4],
        ['podcast_ep42_brut.wav', 'audio', 1.8],
      ];
      return {
        scanId: mockId('large'),
        items: names
          .map(([name, kind, gb]) => ({
            id: mockId('lf'),
            path: `${U}\\${kind === 'video' ? 'Vidéos' : 'Téléchargements'}\\${name}`,
            name,
            sizeBytes: gb * GB,
            modifiedAt: now - Math.round(r() * 400) * DAY,
            isDirectory: false,
            kind: kind as never,
          }))
          .sort((a, b) => b.sizeBytes - a.sizeBytes),
        skippedCount: 4,
      };
    },

    'files:duplicates': async () => {
      for (const phase of ['walking', 'hashing-partial', 'hashing-full'] as const) {
        await delay(350);
        ctx.emit('event:progress', { task: 'duplicates', phase, fraction: null, bytesFound: 0, itemsVisited: 0 });
      }
      const group = (name: string, size: number, places: string[]) => {
        const files = places.map((p, i) => ({
          id: mockId('df'),
          path: `${U}\\${p}\\${name}`,
          name,
          sizeBytes: size,
          modifiedAt: now - (300 - i * 40) * DAY,
          isDirectory: false,
        }));
        return { id: mockId('dg'), hash: Math.random().toString(16).slice(2).padEnd(64, '0'), sizeBytes: size, files, wastedBytes: size * (files.length - 1) };
      };
      const groups = [
        group('IMG_2041.JPG', 6.2 * MB, ['Images\\Islande', 'Bureau\\à trier', 'Téléchargements']),
        group('presentation_finale.pptx', 48 * MB, ['Documents', 'Téléchargements']),
        group('Montage_v3.mp4', 1.4 * GB, ['Vidéos', 'Bureau']),
        group('setup_imprimante.exe', 212 * MB, ['Téléchargements', 'Documents\\Pilotes']),
      ];
      return {
        scanId: mockId('dup'),
        groups,
        totalWastedBytes: groups.reduce((a, g) => a + g.wastedBytes, 0),
        stats: { candidatesBySize: 412, candidatesByPartialHash: 37, confirmed: 9 },
        skippedCount: 6,
      };
    },

    'files:trash': async (req) => {
      await delay(400);
      return { trashedCount: req.itemIds.length, freedBytes: req.itemIds.length * 1.2 * GB, failed: [] };
    },
  };
}
