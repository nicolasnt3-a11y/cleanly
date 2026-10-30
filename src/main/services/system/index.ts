/** STUB — propriété de l'agent « services système ». */
import type {
  InstalledApp, ProtectionReport, StartupItem, StartupToggleRequest, StartupToggleResult, UninstallResult,
} from '../../../../shared/types';

const ni = (): never => {
  throw new Error('Non implémenté');
};

export async function listStartupItems(): Promise<StartupItem[]> {
  return ni();
}
export async function toggleStartupItem(_req: StartupToggleRequest): Promise<StartupToggleResult> {
  return ni();
}
export async function listInstalledApps(): Promise<InstalledApp[]> {
  return ni();
}
export async function uninstallApp(_appId: string): Promise<UninstallResult> {
  return ni();
}
export async function protectionReport(): Promise<ProtectionReport> {
  return ni();
}
/** Libellé lisible de l'OS (« Windows 11 Pro 24H2 », « macOS 15.1 »). */
export async function osLabel(): Promise<string> {
  return process.platform;
}
