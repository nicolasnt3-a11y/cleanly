/** STUB — propriété de l'agent « IA + paramètres ». */
import type {
  AiProvider, AppInfo, FeedbackRequest, FeedbackResult, Result, SetApiKeyRequest, Settings, SettingsPatch, TipOption,
} from '../../../../shared/types';

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

export async function getSettings(): Promise<Settings> {
  return DEFAULT_SETTINGS;
}
export async function updateSettings(_patch: SettingsPatch): Promise<Settings> {
  return DEFAULT_SETTINGS;
}
export async function setApiKey(_req: SetApiKeyRequest): Promise<Result<Settings>> {
  return { ok: false, error: 'Non implémenté' };
}
/** Clé déchiffrée — usage interne au main UNIQUEMENT (jamais renvoyée à l'interface). */
export async function getApiKey(_provider: AiProvider): Promise<string | null> {
  return null;
}
export async function sendFeedback(_req: FeedbackRequest, _info: AppInfo): Promise<Result<FeedbackResult>> {
  return { ok: false, error: 'Non implémenté' };
}
export function tipOptions(): TipOption[] {
  return [];
}
