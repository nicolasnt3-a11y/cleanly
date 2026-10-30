/**
 * Services système : éléments de démarrage, applications installées, protection, libellé de l'OS.
 * Toute action (bascule, désinstallation) relit la source et redérive l'élément à partir de l'id opaque.
 */
import type {
  InstalledApp, ProtectionReport, StartupItem, StartupToggleRequest, StartupToggleResult, UninstallResult,
} from '../../../../shared/types';
import { listInstalledAppsMac, uninstallAppMac } from './apps-mac';
import { listInstalledAppsWin, uninstallAppWin } from './apps-win';
import { osLabelImpl } from './os-label';
import { protectionReportImpl } from './protection';
import { listStartupItemsMac, toggleStartupItemMac } from './startup-mac';
import { listStartupItemsWin, toggleStartupItemWin } from './startup-win';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

export async function listStartupItems(): Promise<StartupItem[]> {
  if (isWin) return listStartupItemsWin();
  if (isMac) return listStartupItemsMac();
  return [];
}

export async function toggleStartupItem(req: StartupToggleRequest): Promise<StartupToggleResult> {
  if (isWin) return toggleStartupItemWin(req);
  if (isMac) return toggleStartupItemMac(req);
  throw new Error('Plateforme non prise en charge.');
}

export async function listInstalledApps(): Promise<InstalledApp[]> {
  if (isWin) return listInstalledAppsWin();
  if (isMac) return listInstalledAppsMac();
  return [];
}

export async function uninstallApp(appId: string): Promise<UninstallResult> {
  if (isWin) return uninstallAppWin(appId);
  if (isMac) return uninstallAppMac(appId);
  return { started: false, removed: false, message: 'Plateforme non prise en charge.' };
}

export async function protectionReport(): Promise<ProtectionReport> {
  return protectionReportImpl();
}

/** Libellé lisible de l'OS (« Windows 11 Pro 24H2 », « macOS 15.1 »). */
export async function osLabel(): Promise<string> {
  return osLabelImpl();
}
