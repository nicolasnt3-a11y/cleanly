/** Modèles proposés dans les paramètres. Le premier de chaque liste est le défaut du main (services/ai). */
import type { AiProvider } from '../../../../shared/types';

export const PROVIDER_LABEL: Record<AiProvider, string> = { anthropic: 'Claude', openai: 'ChatGPT' };

export const MODEL_OPTIONS: Record<AiProvider, Array<{ id: string; label: string }>> = {
  anthropic: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — recommandé' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — plus rapide' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — le plus économique' },
  ],
  openai: [
    { id: 'gpt-5.5', label: 'GPT-5.5 — recommandé' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini — plus économique' },
  ],
};

export function defaultModel(provider: AiProvider): string {
  return MODEL_OPTIONS[provider][0]!.id;
}
