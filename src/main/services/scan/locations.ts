/**
 * Définition des catégories de nettoyage : les emplacements sont TOUJOURS redérivés ici, dans le
 * main, à partir de l'identifiant de catégorie (variables d'environnement, dossier personnel,
 * registre pour le dossier Téléchargements). Rien ne provient de l'interface.
 */
import fs from 'node:fs';
import os from 'node:os';
import type { CleanCategoryId, DeleteMode, MacCleanCategoryId, Settings, WinCleanCategoryId } from '../../../../shared/types';
import { getDrives } from '../../safety/drives';
import { IS_MAC, IS_WIN, env, expandWinEnv, joinChild, normalizeSep } from '../../safety/paths';
import { syntaxReason } from '../../safety/rules';
import { regExePath, run } from '../../util/exec';

export interface Location {
  root: string;
  /** `children` : les éléments principaux sont les enfants directs ; `self` : la racine entière. */
  itemize: 'children' | 'self';
  /** Emplacement nécessitant des droits administrateur. */
  admin?: boolean;
  /** Sous-arbres à ignorer (déjà comptés dans une autre catégorie). */
  exclude?: string[];
}

export interface CategoryDef {
  id: CleanCategoryId;
  label: string;
  description: string;
  mode: DeleteMode;
  requiresAdmin: boolean;
  defaultSelected: boolean;
  locations: Location[];
  /** Âge minimal (ms, mtime) des fichiers comptés ; 24 h pour les catégories `permanent`. */
  minAgeMs: number;
  /** Message d'erreur de dérivation (emplacement introuvable, etc.). */
  error?: string;
}

export const WIN_CATEGORIES: readonly WinCleanCategoryId[] = [
  'win-user-temp', 'win-system-temp', 'browser-cache', 'app-cache', 'crash-dumps', 'win-update', 'dev-cache', 'recycle-bin', 'old-downloads',
];
export const MAC_CATEGORIES: readonly MacCleanCategoryId[] = [
  'mac-user-caches', 'mac-logs', 'browser-cache', 'xcode-derived-data', 'dev-cache', 'mac-trash', 'old-downloads',
];

export function platformCategories(): readonly CleanCategoryId[] {
  return IS_WIN ? WIN_CATEGORIES : IS_MAC ? MAC_CATEGORIES : [];
}

const DAY = 24 * 3600 * 1000;

/* ───────────────────────────── Outils ───────────────────────────── */

async function isRealDir(p: string): Promise<boolean> {
  try {
    const st = await fs.promises.lstat(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Sous-dossiers réels (pas de liens / jonctions). */
async function subDirs(p: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(p, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.isSymbolicLink()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Garde les emplacements existants (dossiers réels). */
async function existing(locs: Location[]): Promise<Location[]> {
  const out: Location[] = [];
  for (const l of locs) if (await isRealDir(l.root)) out.push(l);
  return out;
}

const self = (root: string, admin = false): Location => ({ root, itemize: 'self', admin });
const children = (root: string, admin = false): Location => ({ root, itemize: 'children', admin });

/* ───────────────────────────── Windows ───────────────────────────── */

function winDirs() {
  const home = os.homedir();
  const sysDrive = /^[A-Za-z]:$/.test(env('SystemDrive') ?? '') ? env('SystemDrive')! : 'C:';
  const sysRootRaw = env('SystemRoot') ?? sysDrive + '\\Windows';
  return {
    home,
    sysRoot: /^[A-Za-z]:\\/.test(sysRootRaw) ? normalizeSep(sysRootRaw) : sysDrive + '\\Windows',
    local: normalizeSep(env('LOCALAPPDATA') ?? joinChild(home, 'AppData\\Local')),
    roaming: normalizeSep(env('APPDATA') ?? joinChild(home, 'AppData\\Roaming')),
    programData: normalizeSep(env('ProgramData') ?? sysDrive + '\\ProgramData'),
    temp: normalizeSep(env('TEMP') ?? env('TMP') ?? joinChild(env('LOCALAPPDATA') ?? joinChild(home, 'AppData\\Local'), 'Temp')),
  };
}

const CHROMIUM_PROFILE = /^(Default|Profile \d+|Guest Profile|System Profile)$/i;
const CHROMIUM_PROFILE_CACHES = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache'];
const CHROMIUM_USERDATA_CACHES = ['GrShaderCache', 'ShaderCache', 'GraphiteDawnCache'];

async function chromiumCaches(userData: string): Promise<Location[]> {
  if (!(await isRealDir(userData))) return [];
  const locs: Location[] = CHROMIUM_USERDATA_CACHES.map((c) => self(joinChild(userData, c)));
  for (const prof of await subDirs(userData)) {
    if (!CHROMIUM_PROFILE.test(prof)) continue;
    for (const c of CHROMIUM_PROFILE_CACHES) locs.push(self(joinChild(joinChild(userData, prof), c)));
  }
  return existing(locs);
}

async function firefoxCaches(profilesDir: string, sub: string): Promise<Location[]> {
  const locs: Location[] = [];
  for (const prof of await subDirs(profilesDir)) locs.push(self(joinChild(joinChild(profilesDir, prof), sub)));
  return existing(locs);
}

function electronCaches(base: string): Location[] {
  return ['Cache', 'Code Cache', 'GPUCache', 'CachedData', 'DawnCache', 'DawnGraphiteCache'].map((c) => self(joinChild(base, c)));
}

/** Dossier Téléchargements (dossier connu éventuellement déplacé). */
export async function windowsDownloadsDir(): Promise<string> {
  const fallback = joinChild(os.homedir(), 'Downloads');
  try {
    const r = await run(
      regExePath(),
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', '{374DE290-123F-4565-9164-39C4925E467B}'],
      { encoding: 'oem', timeoutMs: 10_000 },
    );
    if (r.code !== 0) return fallback;
    const m = /\{374DE290-123F-4565-9164-39C4925E467B\}\s+REG_(?:EXPAND_)?SZ\s+(.+)/i.exec(r.stdout);
    const raw = m?.[1]?.trim();
    if (!raw) return fallback;
    const expanded = normalizeSep(expandWinEnv(raw));
    return syntaxReason(expanded) ? fallback : expanded;
  } catch {
    return fallback;
  }
}

let cachedSid: string | null = null;
async function currentUserSid(): Promise<string | null> {
  if (cachedSid) return cachedSid;
  const { sysRoot } = winDirs();
  const r = await run(joinChild(sysRoot, 'System32\\whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'oem', timeoutMs: 10_000 });
  const m = /"(S-1-[0-9-]+)"/.exec(r.stdout);
  cachedSid = m?.[1] ?? null;
  return cachedSid;
}

async function deriveWin(id: WinCleanCategoryId, settings: Settings): Promise<CategoryDef | null> {
  const d = winDirs();
  const base = { mode: 'permanent' as DeleteMode, requiresAdmin: false, defaultSelected: true, minAgeMs: DAY };
  switch (id) {
    case 'win-user-temp':
      return { ...base, id, label: 'Fichiers temporaires utilisateur', description: '%TEMP% · modifiés il y a plus de 24 h', locations: await existing([children(d.temp)]) };
    case 'win-system-temp':
      return { ...base, id, label: 'Fichiers temporaires Windows', description: joinChild(d.sysRoot, 'Temp'), requiresAdmin: true, locations: await existing([children(joinChild(d.sysRoot, 'Temp'), true)]) };
    case 'browser-cache': {
      const sets: Array<[string, Location[]]> = [
        ['Chrome', await chromiumCaches(joinChild(d.local, 'Google\\Chrome\\User Data'))],
        ['Edge', await chromiumCaches(joinChild(d.local, 'Microsoft\\Edge\\User Data'))],
        ['Brave', await chromiumCaches(joinChild(d.local, 'BraveSoftware\\Brave-Browser\\User Data'))],
        ['Vivaldi', await chromiumCaches(joinChild(d.local, 'Vivaldi\\User Data'))],
        ['Chromium', await chromiumCaches(joinChild(d.local, 'Chromium\\User Data'))],
        ['Firefox', await firefoxCaches(joinChild(d.local, 'Mozilla\\Firefox\\Profiles'), 'cache2')],
      ];
      const found = sets.filter(([, l]) => l.length > 0);
      return {
        ...base, id, label: 'Caches des navigateurs',
        description: found.length ? found.map(([n]) => n).join(' · ') : 'Aucun navigateur détecté',
        locations: found.flatMap(([, l]) => l),
      };
    }
    case 'app-cache': {
      const locs: Location[] = [
        ...electronCaches(joinChild(d.roaming, 'discord')),
        ...electronCaches(joinChild(d.roaming, 'Slack')),
        ...electronCaches(joinChild(d.roaming, 'Code')),
        ...electronCaches(joinChild(d.roaming, 'Microsoft\\Teams')),
        ...electronCaches(joinChild(d.local, 'Packages\\MSTeams_8wekyb3d8bbwe\\LocalCache\\Microsoft\\MSTeams\\EBWebView\\Default')),
        self(joinChild(d.local, 'Spotify\\Data')),
        self(joinChild(d.local, 'Microsoft\\Windows\\INetCache')),
        self(joinChild(d.local, 'D3DSCache')),
        self(joinChild(d.local, 'NVIDIA\\DXCache')),
        self(joinChild(d.local, 'NVIDIA\\GLCache')),
        self(joinChild(d.roaming, 'NVIDIA\\ComputeCache')),
        self(joinChild(d.local, 'AMD\\DxCache')),
        self(joinChild(d.local, 'AMD\\DxcCache')),
        self(joinChild(d.local, 'AMD\\VkCache')),
      ];
      return { ...base, id, label: "Caches d'applications", description: 'Discord, Slack, VS Code, Teams, Spotify, caches graphiques…', locations: await existing(locs) };
    }
    case 'crash-dumps': {
      const wer = (b: string) => joinChild(b, 'Microsoft\\Windows\\WER');
      const locs: Location[] = [
        children(joinChild(d.local, 'CrashDumps')),
        children(joinChild(wer(d.local), 'ReportArchive')),
        children(joinChild(wer(d.local), 'ReportQueue')),
        children(joinChild(wer(d.programData), 'ReportArchive'), true),
        children(joinChild(wer(d.programData), 'ReportQueue'), true),
        children(joinChild(d.sysRoot, 'Minidump'), true),
      ];
      return { ...base, id, label: 'Vidages sur incident', description: 'CrashDumps · rapports d’erreurs Windows (WER) · Minidump', locations: await existing(locs) };
    }
    case 'win-update':
      return {
        ...base, id, label: 'Téléchargements Windows Update', description: 'SoftwareDistribution\\Download', requiresAdmin: true,
        locations: await existing([children(joinChild(d.sysRoot, 'SoftwareDistribution\\Download'), true)]),
      };
    case 'dev-cache': {
      const locs = [
        self(joinChild(d.local, 'npm-cache')),
        self(joinChild(d.local, 'pip\\Cache')),
        self(joinChild(d.local, 'Yarn\\Cache')),
        self(joinChild(d.local, 'Yarn\\Berry\\cache')),
        self(joinChild(d.local, 'NuGet\\v3-cache')),
      ];
      return { ...base, id, label: 'Caches de développement', description: 'npm · pip · Yarn · NuGet', locations: await existing(locs) };
    }
    case 'recycle-bin': {
      const sid = await currentUserSid();
      const drives = (await getDrives()).filter((x) => x.kind === 'fixed');
      const locs = sid ? await existing(drives.map((x) => self(joinChild(x.mount + '$Recycle.Bin', sid)))) : [];
      return {
        ...base, id, label: 'Corbeille', description: 'Éléments supprimés en attente', mode: 'empty-bin', defaultSelected: false, minAgeMs: 0, locations: locs,
        error: sid ? undefined : 'Impossible de déterminer l’utilisateur courant pour lire la Corbeille.',
      };
    }
    case 'old-downloads': {
      const days = Math.max(30, settings.oldDownloadsDays || 90);
      const dir = await windowsDownloadsDir();
      return {
        ...base, id, label: 'Anciens téléchargements', description: `Téléchargements · plus de ${days} jours · envoyés à la Corbeille`,
        mode: 'trash', defaultSelected: false, minAgeMs: days * DAY, locations: await existing([children(dir)]),
      };
    }
  }
}

/* ───────────────────────────── macOS ───────────────────────────── */

function macDirs() {
  const home = os.homedir();
  const lib = joinChild(home, 'Library');
  return { home, lib, caches: joinChild(lib, 'Caches'), support: joinChild(lib, 'Application Support') };
}

/** Caches navigateurs dans ~/Library/Caches (exclus de mac-user-caches). */
function macBrowserCacheRoots(): string[] {
  const { caches } = macDirs();
  return ['Google/Chrome', 'Microsoft Edge', 'BraveSoftware/Brave-Browser', 'Firefox', 'Mozilla', 'com.apple.Safari', 'Vivaldi', 'Chromium'].map((s) => joinChild(caches, s));
}

/** Caches de développement dans ~/Library/Caches (exclus de mac-user-caches). */
function macDevCacheRoots(): string[] {
  const { caches } = macDirs();
  return ['pip', 'Yarn'].map((s) => joinChild(caches, s));
}

async function deriveMac(id: MacCleanCategoryId, settings: Settings): Promise<CategoryDef | null> {
  const d = macDirs();
  const base = { mode: 'permanent' as DeleteMode, requiresAdmin: false, defaultSelected: true, minAgeMs: DAY };
  switch (id) {
    case 'mac-user-caches': {
      // Caches sensibles à l'état en cours (iCloud, téléchargements en arrière-plan) : jamais touchés.
      const keep = ['CloudKit', 'com.apple.bird', 'com.apple.nsurlsessiond', 'com.apple.cloudd'].map((s) => joinChild(d.caches, s));
      return {
        ...base, id, label: 'Caches utilisateur', description: '~/Library/Caches (hors navigateurs)',
        locations: await existing([{ root: d.caches, itemize: 'children', exclude: [...macBrowserCacheRoots(), ...macDevCacheRoots(), ...keep] }]),
      };
    }
    case 'mac-logs':
      return { ...base, id, label: 'Journaux', description: '~/Library/Logs', locations: await existing([children(joinChild(d.lib, 'Logs'))]) };
    case 'browser-cache': {
      const locs: Location[] = macBrowserCacheRoots().map((r) => self(r));
      for (const b of ['Google/Chrome', 'Microsoft Edge', 'BraveSoftware/Brave-Browser', 'Vivaldi', 'Chromium']) {
        locs.push(...(await chromiumCaches(joinChild(d.support, b))));
      }
      const found = await existing(locs);
      return { ...base, id, label: 'Caches des navigateurs', description: 'Chrome · Edge · Brave · Firefox · Safari', locations: found };
    }
    case 'xcode-derived-data':
      return {
        ...base, id, label: 'Données dérivées Xcode', description: '~/Library/Developer/Xcode/DerivedData',
        locations: await existing([children(joinChild(d.lib, 'Developer/Xcode/DerivedData'))]),
      };
    case 'dev-cache': {
      const locs = [self(joinChild(d.home, '.npm/_cacache')), ...macDevCacheRoots().map((r) => self(r)), self(joinChild(d.home, '.yarn/berry/cache'))];
      return { ...base, id, label: 'Caches de développement', description: 'npm · pip · Yarn', locations: await existing(locs) };
    }
    case 'mac-trash':
      return {
        ...base, id, label: 'Corbeille', description: 'Éléments supprimés en attente', mode: 'empty-bin', defaultSelected: false, minAgeMs: 0,
        locations: [self(joinChild(d.home, '.Trash'))],
      };
    case 'old-downloads': {
      const days = Math.max(30, settings.oldDownloadsDays || 90);
      return {
        ...base, id, label: 'Anciens téléchargements', description: `Téléchargements · plus de ${days} jours · envoyés à la Corbeille`,
        mode: 'trash', defaultSelected: false, minAgeMs: days * DAY, locations: await existing([children(joinChild(d.home, 'Downloads'))]),
      };
    }
  }
}

/** Redérive une catégorie à partir de son identifiant (null si elle n'existe pas sur cet OS). */
export async function deriveCategory(id: CleanCategoryId, settings: Settings): Promise<CategoryDef | null> {
  if (!platformCategories().includes(id)) return null;
  if (IS_WIN) return deriveWin(id as WinCleanCategoryId, settings);
  if (IS_MAC) return deriveMac(id as MacCleanCategoryId, settings);
  return null;
}
