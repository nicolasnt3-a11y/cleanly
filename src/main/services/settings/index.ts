/**
 * Paramètres, clés API chiffrées, retour d'expérience et soutien.
 *
 * - Les paramètres sont stockés en JSON dans `userData/settings.json` (écriture atomique :
 *   fichier temporaire puis renommage). Un fichier illisible ou corrompu → valeurs par défaut.
 * - Les clés API sont chiffrées avec `safeStorage` et stockées (base64) dans
 *   `userData/ai-keys.json`. Elles ne quittent jamais le processus principal et ne sont jamais
 *   journalisées. Sans chiffrement disponible, on refuse de les enregistrer.
 */
import { app, safeStorage, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AiProvider,
  AppInfo,
  FeedbackRequest,
  FeedbackResult,
  MotionPreference,
  Result,
  SetApiKeyRequest,
  Settings,
  SettingsPatch,
  TipOption,
} from '../../../../shared/types';

/* ═══════════════════════════ À CONFIGURER ═══════════════════════════ */

/** Dépôt GitHub qui reçoit les retours (formulaire « nouvelle issue » pré-rempli). À CONFIGURER. */
export const FEEDBACK_REPO = 'https://github.com/cleanly-app/cleanly';

/** Liens de soutien (HTTPS uniquement). À CONFIGURER. */
export const TIP_LINKS = {
  coffee: 'https://ko-fi.com/cleanly',
  sponsor: 'https://github.com/sponsors/cleanly-app',
} as const;

/* ═════════════════════════════════════════════════════════════════════ */

export const DEFAULT_SETTINGS: Settings = {
  aiProvider: null,
  aiModel: { anthropic: null, openai: null },
  hasApiKey: { anthropic: false, openai: false },
  encryptionAvailable: false,
  motion: 'system',
  oldDownloadsDays: 90,
  largeFileMinMb: 100,
  confirmBeforeClean: true,
};

const PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai'];
const MOTIONS: readonly MotionPreference[] = ['system', 'reduced', 'full'];
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

/** Partie persistée (hasApiKey et encryptionAvailable sont recalculés à chaque lecture). */
type Stored = Omit<Settings, 'hasApiKey' | 'encryptionAvailable'>;
type StoredKeys = Partial<Record<AiProvider, string>>;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const keysFile = () => path.join(app.getPath('userData'), 'ai-keys.json');

let stored: Stored | null = null;
let keys: StoredKeys | null = null;
/** Sérialise les écritures pour éviter les courses entre deux mises à jour rapprochées. */
let writeChain: Promise<unknown> = Promise.resolve();

/* ───────────────────────────── Validation ───────────────────────────── */

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function model(v: unknown): string | null {
  return typeof v === 'string' && MODEL_RE.test(v.trim()) ? v.trim() : null;
}

/** Valide et borne chaque champ ; tout champ invalide reprend sa valeur par défaut. */
function sanitize(raw: unknown): Stored {
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const m = typeof o.aiModel === 'object' && o.aiModel !== null ? (o.aiModel as Record<string, unknown>) : {};
  return {
    aiProvider: PROVIDERS.includes(o.aiProvider as AiProvider) ? (o.aiProvider as AiProvider) : null,
    aiModel: { anthropic: model(m.anthropic), openai: model(m.openai) },
    motion: MOTIONS.includes(o.motion as MotionPreference) ? (o.motion as MotionPreference) : DEFAULT_SETTINGS.motion,
    oldDownloadsDays: clampInt(o.oldDownloadsDays, 30, 3650, DEFAULT_SETTINGS.oldDownloadsDays),
    largeFileMinMb: clampInt(o.largeFileMinMb, 10, 100_000, DEFAULT_SETTINGS.largeFileMinMb),
    confirmBeforeClean: typeof o.confirmBeforeClean === 'boolean' ? o.confirmBeforeClean : DEFAULT_SETTINGS.confirmBeforeClean,
  };
}

/* ───────────────────────────── Fichiers ───────────────────────────── */

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  } catch {
    return null; // absent ou corrompu → valeurs par défaut
  }
}

async function writeAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

function queueWrite(file: string, data: unknown): Promise<void> {
  const p = writeChain.then(() => writeAtomic(file, data));
  writeChain = p.catch(() => undefined);
  return p;
}

async function loadStored(): Promise<Stored> {
  stored ??= sanitize(await readJson(settingsFile()));
  return stored;
}

async function loadKeys(): Promise<StoredKeys> {
  if (keys) return keys;
  const raw = await readJson(keysFile());
  const out: StoredKeys = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const p of PROVIDERS) {
      const v = (raw as Record<string, unknown>)[p];
      if (typeof v === 'string' && /^[A-Za-z0-9+/=]{8,8192}$/.test(v)) out[p] = v;
    }
  }
  keys = out;
  return keys;
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function compose(s: Stored, k: StoredKeys): Settings {
  return {
    ...s,
    aiModel: { ...s.aiModel },
    hasApiKey: { anthropic: !!k.anthropic, openai: !!k.openai },
    encryptionAvailable: encryptionAvailable(),
  };
}

/* ───────────────────────────── API publique ───────────────────────────── */

export async function getSettings(): Promise<Settings> {
  return compose(await loadStored(), await loadKeys());
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const cur = await loadStored();
  const next = sanitize({
    ...cur,
    ...patch,
    aiModel: patch.aiModel ? { ...cur.aiModel, ...patch.aiModel } : cur.aiModel,
  });
  stored = next;
  await queueWrite(settingsFile(), next);
  return compose(next, await loadKeys());
}

/** Vérification de forme (pas de validité) : préfixe et longueur raisonnables. */
function checkKeyFormat(provider: AiProvider, key: string): string | null {
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) return 'Cette clé ne semble pas complète. Collez-la sans espace.';
  if (!/^[A-Za-z0-9_\-]+$/.test(key)) return 'La clé contient des caractères inattendus.';
  if (provider === 'anthropic' && !key.startsWith('sk-ant-'))
    return key.startsWith('sk-') ? 'Cette clé ressemble à une clé OpenAI. Une clé Claude commence par « sk-ant- ».' : 'Une clé Claude (Anthropic) commence par « sk-ant- ».';
  if (provider === 'openai') {
    if (key.startsWith('sk-ant-')) return 'Cette clé ressemble à une clé Claude (Anthropic). Une clé OpenAI commence par « sk- ».';
    if (!key.startsWith('sk-')) return 'Une clé OpenAI commence par « sk- ».';
  }
  return null;
}

export async function setApiKey(req: SetApiKeyRequest): Promise<Result<Settings>> {
  const k = { ...(await loadKeys()) };
  if (req.apiKey === null || req.apiKey === '') {
    delete k[req.provider];
  } else {
    if (!encryptionAvailable())
      return {
        ok: false,
        error: "Le chiffrement sécurisé du système n'est pas disponible : la clé ne peut pas être enregistrée en toute sécurité.",
      };
    const key = req.apiKey.trim();
    const bad = checkKeyFormat(req.provider, key);
    if (bad) return { ok: false, error: bad };
    try {
      k[req.provider] = safeStorage.encryptString(key).toString('base64');
    } catch {
      return { ok: false, error: "Le chiffrement de la clé a échoué. Elle n'a pas été enregistrée." };
    }
  }
  try {
    await queueWrite(keysFile(), k);
  } catch {
    return { ok: false, error: "Impossible d'écrire le fichier des clés dans le dossier de l'application." };
  }
  keys = k;
  // Première clé enregistrée sans fournisseur choisi : on active ce fournisseur.
  const s = await loadStored();
  if (req.apiKey && s.aiProvider === null) return { ok: true, value: await updateSettings({ aiProvider: req.provider }) };
  return { ok: true, value: compose(s, k) };
}

/** Clé déchiffrée — usage interne au main UNIQUEMENT (jamais renvoyée à l'interface). */
export async function getApiKey(provider: AiProvider): Promise<string | null> {
  const enc = (await loadKeys())[provider];
  if (!enc || !encryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null; // clé chiffrée par un autre compte / machine : considérée absente
  }
}

/* ─────────────────────────── Retour d'expérience ─────────────────────────── */

const KIND_LABEL: Record<FeedbackRequest['kind'], string> = { bug: 'Bug', idea: 'Idée', praise: 'Bravo', other: 'Autre' };
const MAX_URL = 7000;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]{1,190}\.[A-Za-z]{2,24}$/;

/** Construit l'URL « nouvelle issue » pré-remplie (exportée pour les tests). */
export function buildFeedbackUrl(req: FeedbackRequest, info: AppInfo): string {
  const message = req.message.replace(/\r\n/g, '\n').trim();
  const firstLine = message.split('\n')[0]!.replace(/\s+/g, ' ').trim();
  const titleText = firstLine.length > 70 ? `${firstLine.slice(0, 69).trimEnd()}…` : firstLine;
  const title = `[${KIND_LABEL[req.kind]}] ${titleText || 'Retour'}`;

  const footer: string[] = [];
  const email = req.email?.trim();
  if (email && EMAIL_RE.test(email)) footer.push(`**Contact :** ${email}`);
  if (req.includeDiagnostics) {
    footer.push(
      '**Diagnostic :**',
      `- Cleanly ${info.version}${info.isPackaged ? '' : ' (développement)'}`,
      `- ${info.osLabel} (${info.platform}, ${info.arch})`,
    );
  }
  const tail = footer.length ? `\n\n---\n${footer.join('\n')}` : '';
  const make = (msg: string) =>
    `${FEEDBACK_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(`${msg}${tail}\n\n_Envoyé depuis Cleanly._`)}`;

  let url = make(message);
  if (url.length > MAX_URL) {
    // Tronque le message (par dichotomie sur la longueur) pour rester sous la limite.
    let lo = 0;
    let hi = message.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (make(`${message.slice(0, mid)}… (tronqué)`).length <= MAX_URL) lo = mid;
      else hi = mid - 1;
    }
    url = make(`${message.slice(0, lo)}… (tronqué)`);
  }
  return url;
}

export async function sendFeedback(req: FeedbackRequest, info: AppInfo): Promise<Result<FeedbackResult>> {
  if (!req.message.trim()) return { ok: false, error: 'Le message est vide.' };
  let url: URL;
  try {
    url = new URL(buildFeedbackUrl(req, info));
  } catch {
    return { ok: false, error: "L'adresse du formulaire est invalide." };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'Seules les adresses HTTPS sont autorisées.' };
  try {
    await shell.openExternal(url.href);
  } catch {
    return { ok: false, error: "Impossible d'ouvrir le navigateur." };
  }
  return {
    ok: true,
    value: {
      delivered: 'browser',
      message: 'Le formulaire pré-rempli s’est ouvert dans votre navigateur. Il ne reste qu’à le valider.',
    },
  };
}

/* ───────────────────────────── Soutien ───────────────────────────── */

export function tipOptions(): TipOption[] {
  return [
    {
      id: 'coffee',
      label: 'Un café',
      description: 'Un don ponctuel, du montant de votre choix.',
      url: TIP_LINKS.coffee,
    },
    {
      id: 'sponsor',
      label: 'Parrainer sur GitHub',
      description: 'Un soutien mensuel qui finance les certificats de signature et le temps de développement.',
      url: TIP_LINKS.sponsor,
    },
  ].filter((o) => o.url.startsWith('https://'));
}
