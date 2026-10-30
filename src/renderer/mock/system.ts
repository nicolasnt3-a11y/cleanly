/**
 * Données fictives : démarrage, applications, protection.
 * Propriété : agent « écrans système » (peut enrichir librement).
 *
 * Scénarios de démo :
 *  - « Logi Options+ » (tous les utilisateurs) : l'invite UAC est refusée → l'état relu ne change pas.
 *  - « Windows Security notification icon » : lecture seule.
 *  - « Zoom Workplace » : le désinstallateur est lancé mais l'app reste listée (l'utilisateur doit terminer).
 *  - « Microsoft Edge WebView2 » : composant sans désinstallateur ; Cleanly lui-même n'est pas désinstallable.
 */
import type { InstalledApp, ProtectionReport, StartupItem, StartupToggleResult } from '../../../shared/types';
import type { MockContext, MockHandlers } from './index';
import { DAY, GB, MB, delay } from './util';

const now = Date.now();
const HOUR = 3_600_000;

function startupSeed(): StartupItem[] {
  const s = (
    id: string,
    name: string,
    publisher: string | undefined,
    command: string,
    impact: StartupItem['impact'],
    enabled: boolean,
    opts: { location?: StartupItem['location']; readOnly?: boolean } = {},
  ): StartupItem => {
    const location = opts.location ?? 'hkcu-run';
    const machine = location === 'hklm-run' || location === 'hklm-run32' || location === 'startup-folder-common';
    return {
      id,
      name,
      command,
      publisher,
      location,
      scope: machine ? 'machine' : 'user',
      enabled,
      requiresAdmin: machine && !opts.readOnly,
      readOnly: opts.readOnly ?? false,
      impact,
    };
  };
  return [
    s('st-onedrive', 'Microsoft OneDrive', 'Microsoft Corporation', '"C:\\Users\\Camille\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe" /background', 'high', true),
    s('st-steam', 'Steam', 'Valve Corporation', '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent', 'high', true),
    s('st-discord', 'Discord', 'Discord Inc.', '"C:\\Users\\Camille\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe --process-start-args --start-minimized', 'high', true),
    s('st-acc', 'Adobe Creative Cloud', 'Adobe Inc.', '"C:\\Program Files\\Adobe\\Adobe Creative Cloud\\ACC\\Creative Cloud.exe" --showwindow=false --onOSstartup=true', 'high', true, { location: 'hklm-run' }),
    s('st-spotify', 'Spotify', 'Spotify AB', '"C:\\Users\\Camille\\AppData\\Roaming\\Spotify\\Spotify.exe" --autostart --minimized', 'medium', true),
    s('st-edge', 'Microsoft Edge', 'Microsoft Corporation', '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --no-startup-window --win-session-start', 'medium', true),
    s('st-teams', 'Microsoft Teams', 'Microsoft Corporation', '"C:\\Users\\Camille\\AppData\\Local\\Microsoft\\WindowsApps\\ms-teams.exe" msteams:system-initiated', 'medium', false),
    s('st-logi', 'Logi Options+', 'Logitech', '"C:\\Program Files\\LogiOptionsPlus\\logioptionsplus_agent.exe" /minimized', 'low', true, { location: 'hklm-run' }),
    s('st-sec', 'Windows Security notification icon', 'Microsoft Corporation', '%windir%\\system32\\SecurityHealthSystray.exe', 'low', true, { location: 'hklm-run', readOnly: true }),
    s('st-ahk', 'raccourcis.ahk', undefined, '"C:\\Users\\Camille\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\raccourcis.lnk"', 'unknown', true, { location: 'startup-folder-user' }),
    s('st-zoom', 'Zoom Workplace', 'Zoom Video Communications', '"C:\\Users\\Camille\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe" --autostart', 'medium', false),
  ];
}

type AppSeed = Omit<InstalledApp, 'id' | 'installedAt' | 'location' | 'canUninstall' | 'isSelf'> & {
  canUninstall?: boolean;
  isSelf?: boolean;
  dir?: string;
};

const appSeeds: AppSeed[] = [
  { name: 'Adobe Photoshop 2025', publisher: 'Adobe Inc.', version: '26.1', sizeBytes: 4.8 * GB, lastUsedAt: now - 3 * DAY },
  { name: 'Steam', publisher: 'Valve Corporation', version: '2.10.91.91', sizeBytes: 1.2 * GB, lastUsedAt: now - 2 * HOUR, dir: 'C:\\Program Files (x86)\\Steam' },
  { name: 'Blender 4.2', publisher: 'Blender Foundation', version: '4.2.3', sizeBytes: 1.1 * GB, lastUsedAt: now - 210 * DAY },
  { name: 'Microsoft Edge WebView2 Runtime', publisher: 'Microsoft Corporation', version: '130.0.2849.80', sizeBytes: 640 * MB, canUninstall: false },
  { name: 'OBS Studio', publisher: 'OBS Project', version: '31.0.0', sizeBytes: 512 * MB, lastUsedAt: now - 240 * DAY },
  { name: 'Visual Studio Code', publisher: 'Microsoft Corporation', version: '1.95.3', sizeBytes: 410 * MB, lastUsedAt: now - HOUR },
  { name: 'Spotify', publisher: 'Spotify AB', version: '1.2.50.335', sizeBytes: 380 * MB, lastUsedAt: now - DAY },
  { name: 'Discord', publisher: 'Discord Inc.', version: '1.0.9171', sizeBytes: 345 * MB, lastUsedAt: now - 5 * HOUR },
  { name: 'Zoom Workplace', publisher: 'Zoom Video Communications', version: '6.2.11', sizeBytes: 290 * MB, lastUsedAt: now - 330 * DAY },
  { name: 'Audacity 3.6', publisher: 'Audacity Team', version: '3.6.4', sizeBytes: 182 * MB, lastUsedAt: now - 410 * DAY },
  { name: 'VLC media player', publisher: 'VideoLAN', version: '3.0.21', sizeBytes: 170 * MB, lastUsedAt: now - 20 * DAY },
  { name: 'Cleanly', publisher: 'Cleanly', version: '0.1.0', sizeBytes: 228 * MB, lastUsedAt: now, isSelf: true, canUninstall: false },
  { name: 'Logi Options+', publisher: 'Logitech', version: '1.82.6', sizeBytes: 154 * MB },
  { name: 'Notepad++ (64-bit x64)', publisher: 'Notepad++ Team', version: '8.7.1', sizeBytes: 15 * MB, lastUsedAt: now - 45 * DAY },
  { name: '7-Zip 24.08 (x64)', publisher: 'Igor Pavlov', version: '24.08', sizeBytes: 6 * MB, lastUsedAt: now - 9 * DAY },
  { name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)', publisher: 'Microsoft Corporation', version: '14.40.33810.0', sizeBytes: 25 * MB },
];

function appsSeed(): InstalledApp[] {
  return appSeeds.map(({ dir, canUninstall, isSelf, ...a }, i) => ({
    ...a,
    id: `app-${i}`,
    installedAt: now - (400 - i * 20) * DAY,
    location: dir ?? `C:\\Program Files\\${a.name}`,
    canUninstall: canUninstall ?? true,
    isSelf: isSelf ?? false,
  }));
}

const protection: Omit<ProtectionReport, 'checkedAt'> = {
  score: 85,
  checks: [
    { id: 'defender', label: 'Microsoft Defender', detail: 'Protection en temps réel active', status: 'ok', weight: 30 },
    { id: 'signatures', label: 'Définitions antivirus', detail: 'Mises à jour il y a 3 h', status: 'ok', weight: 15 },
    { id: 'firewall', label: 'Pare-feu Windows', detail: 'Domaine, privé et public actifs', status: 'ok', weight: 20 },
    { id: 'smartscreen', label: 'SmartScreen', detail: 'Applications et fichiers vérifiés', status: 'ok', weight: 10 },
    { id: 'uac', label: 'Contrôle de compte (UAC)', detail: 'Niveau par défaut', status: 'ok', weight: 10 },
    {
      id: 'bitlocker',
      label: 'Chiffrement BitLocker',
      detail: 'Désactivé sur C:',
      status: 'warn',
      weight: 10,
      advice: 'Activez le chiffrement dans Paramètres › Confidentialité et sécurité › Chiffrement de l’appareil. Notez la clé de récupération avant.',
    },
    {
      id: 'tamper',
      label: 'Protection contre les falsifications',
      detail: 'Désactivée',
      status: 'warn',
      weight: 5,
      advice: 'Activez-la dans Sécurité Windows › Protection contre les virus et menaces › Gérer les paramètres.',
    },
  ],
};

export function createSystemMocks(_ctx: MockContext): MockHandlers {
  let startup = startupSeed();
  let installed = appsSeed();
  return {
    'startup:list': async () => {
      await delay(350);
      return startup.map((s) => ({ ...s }));
    },
    'startup:toggle': async ({ id, enabled }): Promise<StartupToggleResult> => {
      const current = startup.find((s) => s.id === id);
      if (!current) throw new Error('Élément de démarrage introuvable. Actualisez la liste.');
      await delay(current.requiresAdmin ? 1400 : 350);
      if (current.readOnly) {
        return { item: { ...current }, applied: false, message: 'Cet élément ne peut pas être modifié par Cleanly.' };
      }
      if (id === 'st-logi') {
        return {
          item: { ...current },
          applied: false,
          elevationDeclined: true,
          message: 'L’autorisation administrateur a été refusée. Rien n’a été modifié.',
        };
      }
      startup = startup.map((s) => (s.id === id ? { ...s, enabled } : s));
      return { item: { ...startup.find((s) => s.id === id)! }, applied: true };
    },
    'apps:list': async () => {
      await delay(550);
      return installed.map((a) => ({ ...a }));
    },
    'apps:uninstall': async (appId) => {
      const app = installed.find((a) => a.id === appId);
      if (!app) throw new Error('Application introuvable. Actualisez la liste.');
      if (!app.canUninstall || app.isSelf) throw new Error('Cette application ne peut pas être désinstallée depuis Cleanly.');
      await delay(1600);
      if (app.name.startsWith('Zoom')) {
        return {
          started: true,
          removed: false,
          message: `Le désinstallateur de ${app.name} a été lancé. Terminez-le dans sa fenêtre, puis actualisez la liste.`,
        };
      }
      installed = installed.filter((a) => a.id !== appId);
      return { started: true, removed: true, message: `${app.name} a été désinstallée par son désinstallateur officiel.` };
    },
    'protection:report': async () => {
      await delay(700);
      return { ...protection, checkedAt: Date.now() };
    },
  };
}
