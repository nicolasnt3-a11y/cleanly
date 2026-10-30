/**
 * Éléments de démarrage macOS : LaunchAgents utilisateur (activables via launchctl),
 * LaunchAgents globaux et éléments d'ouverture (lecture seule).
 */
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StartupItem, StartupLocation, StartupToggleRequest, StartupToggleResult } from '../../../../shared/types';
import { run } from '../../util/exec';
import { iconFor } from './icons';
import { estimateImpact, mapLimit, opaqueId } from './util';

const LABEL_RE = /^[A-Za-z0-9._-]{1,200}$/;

interface RawAgent {
  id: string;
  name: string;
  command: string;
  location: StartupLocation;
  scope: 'user' | 'machine';
  enabled: boolean;
  readOnly: boolean;
  label?: string;
  plistPath?: string;
  /** Bundle .app ou exécutable, pour l'icône. */
  iconPath?: string;
}

function uid(): number {
  return os.userInfo().uid;
}

async function readPlistJson(file: string): Promise<Record<string, unknown> | null> {
  const r = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { timeoutMs: 5_000 });
  if (r.code !== 0) return null;
  try {
    const v = JSON.parse(r.stdout) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Surcharges launchctl (« label » => disabled|enabled|true|false). */
async function disabledOverrides(): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const r = await run('/bin/launchctl', ['print-disabled', `gui/${uid()}`], { timeoutMs: 5_000 });
  for (const m of r.stdout.matchAll(/"([^"]+)"\s*=>\s*(disabled|enabled|true|false)/g)) {
    out.set(m[1] as string, m[2] === 'disabled' || m[2] === 'true');
  }
  return out;
}

function bundleOf(p: string): string | undefined {
  const i = p.indexOf('.app/');
  return i > 0 ? p.slice(0, i + 4) : undefined;
}

async function readAgents(dir: string, location: StartupLocation, scope: 'user' | 'machine', overrides: Map<string, boolean>): Promise<RawAgent[]> {
  let files: string[] = [];
  try {
    files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.plist'));
  } catch {
    return [];
  }
  const out = await mapLimit(files, 6, async (file): Promise<RawAgent | null> => {
    const plistPath = path.join(dir, file);
    try {
      const st = await fsp.lstat(plistPath);
      if (!st.isFile()) return null;
    } catch {
      return null;
    }
    const pl = await readPlistJson(plistPath);
    if (!pl) return null;
    const label = typeof pl.Label === 'string' ? pl.Label : file.replace(/\.plist$/, '');
    const progArgs = Array.isArray(pl.ProgramArguments) ? pl.ProgramArguments.filter((a): a is string => typeof a === 'string') : [];
    const program = typeof pl.Program === 'string' ? pl.Program : progArgs[0];
    const command = progArgs.length ? progArgs.join(' ') : program ?? '';
    const plistDisabled = pl.Disabled === true;
    const enabled = !(overrides.get(label) ?? plistDisabled);
    const validLabel = LABEL_RE.test(label);
    return {
      id: opaqueId('su', location, file),
      name: label,
      command,
      location,
      scope,
      enabled,
      readOnly: scope !== 'user' || !validLabel,
      label: validLabel ? label : undefined,
      plistPath,
      iconPath: program ? bundleOf(program) ?? program : undefined,
    };
  });
  return out.filter((a): a is RawAgent => !!a);
}

/** Éléments d'ouverture via System Events (lecture seule ; absent si l'accès est refusé). */
async function readLoginItems(): Promise<RawAgent[]> {
  const script = [
    'set out to ""',
    'tell application "System Events"',
    'repeat with li in every login item',
    'set out to out & (name of li) & tab & (path of li) & linefeed',
    'end repeat',
    'end tell',
    'return out',
  ];
  const args = script.flatMap((l) => ['-e', l]);
  const r = await run('/usr/bin/osascript', args, { timeoutMs: 8_000 });
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name = '', p = ''] = l.split('\t');
      return {
        id: opaqueId('su', 'mac-login-item', name, p),
        name,
        command: p,
        location: 'mac-login-item' as const,
        scope: 'user' as const,
        enabled: true,
        readOnly: true,
        iconPath: p.endsWith('.app') ? p : undefined,
      };
    });
}

async function readAll(includeLoginItems: boolean): Promise<RawAgent[]> {
  const overrides = await disabledOverrides();
  const [user, global, login] = await Promise.all([
    readAgents(path.join(os.homedir(), 'Library', 'LaunchAgents'), 'mac-launch-agent-user', 'user', overrides),
    readAgents('/Library/LaunchAgents', 'mac-launch-agent-global', 'machine', overrides),
    includeLoginItems ? readLoginItems() : Promise.resolve([]),
  ]);
  return [...user, ...global, ...login];
}

async function toItem(a: RawAgent): Promise<StartupItem> {
  const item: StartupItem = {
    id: a.id,
    name: a.name,
    command: a.command,
    location: a.location,
    scope: a.scope,
    enabled: a.enabled,
    requiresAdmin: a.scope === 'machine',
    readOnly: a.readOnly,
    impact: estimateImpact(a.command, undefined),
  };
  const icon = await iconFor(a.iconPath);
  if (icon) item.iconDataUrl = icon;
  return item;
}

export async function listStartupItemsMac(): Promise<StartupItem[]> {
  return mapLimit(await readAll(true), 6, toItem);
}

export async function toggleStartupItemMac(req: StartupToggleRequest): Promise<StartupToggleResult> {
  const before = (await readAll(false)).find((a) => a.id === req.id);
  if (!before) throw new Error('Élément de démarrage introuvable (la liste a peut-être changé).');
  if (before.readOnly || !before.label || !before.plistPath) {
    return { item: await toItem(before), applied: false, message: 'Cet élément ne peut pas être modifié par Cleanly.' };
  }
  if (before.enabled === req.enabled) return { item: await toItem(before), applied: true };

  const domain = `gui/${uid()}`;
  const target = `${domain}/${before.label}`;
  if (req.enabled) {
    await run('/bin/launchctl', ['enable', target], { timeoutMs: 10_000 });
    await run('/bin/launchctl', ['bootstrap', domain, before.plistPath], { timeoutMs: 10_000 });
  } else {
    await run('/bin/launchctl', ['disable', target], { timeoutMs: 10_000 });
    await run('/bin/launchctl', ['bootout', target], { timeoutMs: 10_000 });
  }
  const after = (await readAll(false)).find((a) => a.id === req.id) ?? before;
  const applied = after.enabled === req.enabled;
  return {
    item: await toItem(after),
    applied,
    ...(applied ? {} : { message: "La modification n'a pas pu être appliquée." }),
  };
}
