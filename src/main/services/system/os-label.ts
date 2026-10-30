/** Libellé lisible du système d'exploitation. */
import os from 'node:os';
import { run } from '../../util/exec';
import { regValues, valueOf } from './registry';

let cached: string | null = null;

/** « Windows 10 Pro » + build 22631 + « 23H2 » → « Windows 11 Pro 23H2 ». */
export function formatWindowsLabel(productName: string, build: number, displayVersion?: string): string {
  let name = productName.trim() || 'Windows';
  // ProductName indique encore « Windows 10 » sur Windows 11 : on se fie au numéro de build.
  if (build >= 22000) name = name.replace(/Windows 10/i, 'Windows 11');
  return displayVersion ? `${name} ${displayVersion}` : name;
}

export async function osLabelImpl(): Promise<string> {
  if (cached) return cached;
  if (process.platform === 'win32') {
    const vals = await regValues('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion');
    const product = valueOf(vals, 'ProductName')?.data ?? '';
    const build = Number(valueOf(vals, 'CurrentBuild')?.data ?? valueOf(vals, 'CurrentBuildNumber')?.data ?? os.release().split('.')[2]);
    const dv = valueOf(vals, 'DisplayVersion')?.data || valueOf(vals, 'ReleaseId')?.data || undefined;
    cached = product ? formatWindowsLabel(product, Number.isFinite(build) ? build : 0, dv) : `Windows ${os.release()}`;
  } else if (process.platform === 'darwin') {
    const r = await run('/usr/bin/sw_vers', ['-productVersion'], { timeoutMs: 5_000 });
    const v = r.stdout.trim();
    cached = v ? `macOS ${v}` : `macOS (Darwin ${os.release()})`;
  } else {
    cached = `${os.type()} ${os.release()}`;
  }
  return cached;
}
