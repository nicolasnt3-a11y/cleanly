/**
 * Données fictives : assistant IA, paramètres, retour d'expérience, soutien.
 * Propriété : agent « IA + paramètres » (peut enrichir librement).
 */
import type { AiVerdict, Settings } from '../../../shared/types';
import type { MockContext, MockHandlers } from './index';
import { delay } from './util';

export function createAiMocks(_ctx: MockContext): MockHandlers {
  let settings: Settings = {
    aiProvider: 'anthropic',
    aiModel: { anthropic: null, openai: null },
    hasApiKey: { anthropic: true, openai: false },
    encryptionAvailable: true,
    motion: 'system',
    oldDownloadsDays: 90,
    largeFileMinMb: 100,
    confirmBeforeClean: true,
  };
  return {
    'settings:get': async () => settings,
    'settings:update': async (patch) => {
      settings = { ...settings, ...patch };
      return settings;
    },
    'settings:set-api-key': async ({ provider, apiKey }) => {
      await delay(200);
      settings = { ...settings, hasApiKey: { ...settings.hasApiKey, [provider]: !!apiKey } };
      return { ok: true, value: settings };
    },
    'ai:test-key': async (provider) => {
      await delay(800);
      return settings.hasApiKey[provider]
        ? { ok: true, model: provider === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-5', message: 'Clé valide.' }
        : { ok: false, message: 'Aucune clé enregistrée.' };
    },
    'ai:review': async ({ items }) => {
      await delay(1600);
      const verdicts: AiVerdict[] = items.map((it) => {
        const n = it.name.toLowerCase();
        if (/\.(pdf|docx?|xlsx?|pptx?)$/.test(n) || /facture|contrat|photos?/.test(n))
          return { id: it.id, verdict: 'keep', reason: 'Semble être un document personnel.' };
        if (/\.(iso|msi|exe|zip)$/.test(n) || it.context === 'old-downloads' || it.context === 'large-file' || it.context === 'duplicate')
          return { id: it.id, verdict: 'review', reason: 'Installateur ou archive : vérifiez que vous n’en avez plus besoin.' };
        return { id: it.id, verdict: 'safe', reason: 'Cache régénérable automatiquement.' };
      });
      const count = (k: string) => verdicts.filter((v) => v.verdict === k).length;
      return {
        ok: true,
        value: {
          provider: settings.aiProvider ?? 'anthropic',
          model: 'claude-sonnet-5-5',
          verdicts,
          summary: `${count('safe')} éléments sûrs, ${count('review')} à vérifier, ${count('keep')} à conserver. Les installateurs anciens peuvent généralement partir.`,
        },
      };
    },
    'feedback:send': async () => {
      await delay(400);
      return { ok: true, value: { delivered: 'browser', message: 'Merci ! Votre retour s’ouvre dans le navigateur.' } };
    },
    'tip:options': async () => [
      { id: 'coffee', label: 'Un café', description: 'Un petit geste qui fait plaisir.', url: 'https://github.com/sponsors' },
      { id: 'sponsor', label: 'Parrainer', description: 'Soutien mensuel pour financer la signature des applications.', url: 'https://github.com/sponsors' },
    ],
  };
}
