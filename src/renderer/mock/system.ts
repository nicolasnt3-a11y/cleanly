/**
 * Données fictives : démarrage, applications, protection.
 * Propriété : agent « écrans système » (peut enrichir librement).
 */
import type { InstalledApp, ProtectionReport, StartupItem } from '../../../shared/types';
import type { MockContext, MockHandlers } from './index';
import { DAY, GB, MB, delay } from './util';

const now = Date.now();

function startupSeed(): StartupItem[] {
  const s = (
    id: string,
    name: string,
    publisher: string,
    impact: StartupItem['impact'],
    enabled: boolean,
    machine = false,
  ): StartupItem => ({
    id,
    name,
    command: `"C:\\Program Files\\${name}\\${name.replace(/\s/g, '')}.exe" --background`,
    publisher,
    location: machine ? 'hklm-run' : 'hkcu-run',
    scope: machine ? 'machine' : 'user',
    enabled,
    requiresAdmin: machine,
    readOnly: false,
    impact,
  });
  return [
    s('st-onedrive', 'Microsoft OneDrive', 'Microsoft Corporation', 'high', true),
    s('st-steam', 'Steam', 'Valve Corporation', 'high', true),
    s('st-discord', 'Discord', 'Discord Inc.', 'high', true),
    s('st-acc', 'Adobe Creative Cloud', 'Adobe Inc.', 'high', true, true),
    s('st-spotify', 'Spotify', 'Spotify AB', 'medium', true),
    s('st-teams', 'Microsoft Teams', 'Microsoft Corporation', 'medium', false),
    s('st-logi', 'Logi Options+', 'Logitech', 'low', true, true),
  ];
}

const apps: InstalledApp[] = [
  { name: 'Adobe Photoshop 2025', publisher: 'Adobe Inc.', version: '26.1', sizeBytes: 4.8 * GB, lastUsedAt: now - 3 * DAY },
  { name: 'Steam', publisher: 'Valve Corporation', version: '2.10', sizeBytes: 1.2 * GB, lastUsedAt: now - 2 * 3600_000 },
  { name: 'Blender 4.2', publisher: 'Blender Foundation', version: '4.2.3', sizeBytes: 1.1 * GB, lastUsedAt: now - 210 * DAY },
  { name: 'OBS Studio', publisher: 'OBS Project', version: '31.0', sizeBytes: 512 * MB, lastUsedAt: now - 240 * DAY },
  { name: 'Visual Studio Code', publisher: 'Microsoft Corporation', version: '1.95', sizeBytes: 410 * MB, lastUsedAt: now - 3600_000 },
  { name: 'Spotify', publisher: 'Spotify AB', version: '1.2.50', sizeBytes: 380 * MB, lastUsedAt: now - DAY },
  { name: 'Zoom Workplace', publisher: 'Zoom Communications', version: '6.2', sizeBytes: 290 * MB, lastUsedAt: now - 330 * DAY },
  { name: 'VLC media player', publisher: 'VideoLAN', version: '3.0.21', sizeBytes: 170 * MB, lastUsedAt: now - 20 * DAY },
  { name: '7-Zip 24.08 (x64)', publisher: 'Igor Pavlov', version: '24.08', sizeBytes: 6 * MB, lastUsedAt: now - 9 * DAY },
  { name: 'Microsoft Edge WebView2 Runtime', publisher: 'Microsoft Corporation', version: '130.0', sizeBytes: 640 * MB, lastUsedAt: undefined },
].map((a, i) => ({
  ...a,
  id: `app-${i}`,
  installedAt: now - (400 - i * 30) * DAY,
  location: `C:\\Program Files\\${a.name}`,
  canUninstall: !a.name.includes('WebView2'),
  isSelf: false,
}));

const protection: ProtectionReport = {
  checkedAt: now,
  score: 86,
  checks: [
    { id: 'defender', label: 'Microsoft Defender', detail: 'Protection en temps réel active', status: 'ok', weight: 30 },
    { id: 'signatures', label: 'Définitions antivirus', detail: 'Mises à jour il y a 3 h', status: 'ok', weight: 15 },
    { id: 'firewall', label: 'Pare-feu Windows', detail: 'Domaine, privé et public actifs', status: 'ok', weight: 20 },
    { id: 'smartscreen', label: 'SmartScreen', detail: 'Applications et fichiers vérifiés', status: 'ok', weight: 10 },
    { id: 'uac', label: 'Contrôle de compte (UAC)', detail: 'Niveau par défaut', status: 'ok', weight: 10 },
    { id: 'bitlocker', label: 'Chiffrement BitLocker', detail: 'Désactivé sur C:', status: 'warn', weight: 10, advice: 'Activez BitLocker (Paramètres › Confidentialité et sécurité › Chiffrement de l’appareil).' },
    { id: 'tamper', label: 'Protection contre les falsifications', detail: 'Désactivée', status: 'warn', weight: 5, advice: 'Activez-la dans Sécurité Windows › Protection contre les virus et menaces.' },
  ],
};

export function createSystemMocks(_ctx: MockContext): MockHandlers {
  let startup = startupSeed();
  let installed = [...apps];
  return {
    'startup:list': async () => {
      await delay(300);
      return startup;
    },
    'startup:toggle': async ({ id, enabled }) => {
      await delay(id === 'st-acc' || id === 'st-logi' ? 1200 : 300);
      startup = startup.map((s) => (s.id === id ? { ...s, enabled } : s));
      const item = startup.find((s) => s.id === id)!;
      return { item, applied: true };
    },
    'apps:list': async () => {
      await delay(500);
      return installed;
    },
    'apps:uninstall': async (appId) => {
      await delay(1500);
      const app = installed.find((a) => a.id === appId);
      installed = installed.filter((a) => a.id !== appId);
      return { started: true, removed: true, message: `Le désinstallateur de ${app?.name ?? 'l’application'} s’est terminé.` };
    },
    'protection:report': async () => {
      await delay(700);
      return { ...protection, checkedAt: Date.now() };
    },
  };
}
