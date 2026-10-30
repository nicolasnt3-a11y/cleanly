/**
 * Données fictives : assistant IA, paramètres, retour d'expérience, soutien.
 * Propriété : agent « IA + paramètres » (peut enrichir librement).
 */
import type { AiReviewItem, AiVerdict, Settings } from '../../../shared/types';
import type { MockContext, MockHandlers } from './index';
import { delay } from './util';

const DEFAULT_MODEL = { anthropic: 'claude-opus-5-5', openai: 'gpt-5.5' } as const;

/** Heuristique locale imitant les verdicts d'un modèle (démo uniquement). */
function fakeVerdict(it: AiReviewItem): AiVerdict {
  const n = it.name.toLowerCase();
  const p = it.path.toLowerCase();
  const v = (verdict: AiVerdict['verdict'], reason: string): AiVerdict => ({ id: it.id, verdict, reason });
  if (/\.(pdf|docx?|xlsx?|pptx?|odt|pages|key|numbers)$/.test(n) || /facture|contrat|devis|impots|cv/.test(n))
    return v('keep', 'Document personnel probable : à conserver ou à archiver ailleurs.');
  if (/\.(jpe?g|png|heic|raw|cr2|nef)$/.test(n) || /photos?|pictures|images/.test(p))
    return v('keep', 'Photo personnelle : impossible à régénérer.');
  if (/\.(pem|key|kdbx|wallet|p12|pfx)$/.test(n) || /backup|sauvegarde|\.bak$/.test(n))
    return v('keep', 'Clé, coffre ou sauvegarde : à ne jamais supprimer sans copie.');
  if (/\.(mp4|mov|mkv|avi)$/.test(n)) return v('review', 'Vidéo volumineuse : vérifiez si elle est personnelle ou retéléchargeable.');
  if (/\.(iso|dmg|img|vhdx?)$/.test(n)) return v('review', 'Image disque : souvent retéléchargeable, mais vérifiez son origine.');
  if (/\.(msi|exe|pkg)$/.test(n) || /setup|installer/.test(n))
    return v(it.context === 'old-downloads' ? 'safe' : 'review', 'Installateur déjà utilisé : facile à retélécharger.');
  if (/\.(zip|7z|rar|tar|gz)$/.test(n)) return v('review', 'Archive : le contenu peut être unique, ouvrez-la avant de supprimer.');
  if (it.context === 'duplicate') return v('review', 'Copie identique : gardez l’exemplaire le mieux rangé.');
  if (it.context === 'large-file' || it.context === 'space-map' || it.context === 'old-downloads')
    return v('review', 'Fichier personnel possible : à vérifier.');
  if (it.context === 'crash-dumps') return v('safe', 'Rapport de plantage : utile seulement aux développeurs.');
  if (it.context === 'dev-cache' || it.context === 'xcode-derived-data') return v('safe', 'Cache de compilation : régénéré au prochain build.');
  return v('safe', 'Cache ou fichier temporaire régénéré automatiquement.');
}

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
      settings = { ...settings, ...patch, aiModel: patch.aiModel ? { ...settings.aiModel, ...patch.aiModel } : settings.aiModel };
      return settings;
    },
    'settings:set-api-key': async ({ provider, apiKey }) => {
      await delay(250);
      if (apiKey) {
        if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-'))
          return { ok: false, error: 'Une clé Claude (Anthropic) commence par « sk-ant- ».' };
        if (provider === 'openai' && (!apiKey.startsWith('sk-') || apiKey.startsWith('sk-ant-')))
          return { ok: false, error: 'Une clé OpenAI commence par « sk- ».' };
        if (apiKey.length < 20) return { ok: false, error: 'Cette clé ne semble pas complète. Collez-la sans espace.' };
      }
      settings = {
        ...settings,
        aiProvider: settings.aiProvider ?? (apiKey ? provider : null),
        hasApiKey: { ...settings.hasApiKey, [provider]: !!apiKey },
      };
      return { ok: true, value: settings };
    },
    'ai:test-key': async (provider) => {
      await delay(700);
      const model = settings.aiModel[provider] ?? DEFAULT_MODEL[provider];
      return settings.hasApiKey[provider]
        ? { ok: true, model, message: `Clé valide. Modèle disponible : ${model}.` }
        : { ok: false, message: 'Aucune clé enregistrée.' };
    },
    'ai:review': async ({ items }) => {
      const provider = settings.aiProvider;
      if (!provider) return { ok: false, error: "Aucun assistant IA n'est activé. Choisissez Claude ou ChatGPT dans les paramètres." };
      if (!settings.hasApiKey[provider]) return { ok: false, error: 'Aucune clé enregistrée. Ajoutez-la dans les paramètres.' };
      await delay(1200 + Math.min(items.length, 150) * 8);
      const verdicts = items.slice(0, 500).map(fakeVerdict);
      const count = (k: string) => verdicts.filter((v) => v.verdict === k).length;
      const safe = count('safe');
      const review = count('review');
      const keep = count('keep');
      const summary =
        (safe ? `La plupart des éléments sont des caches ou des installateurs sans risque. ` : '') +
        (keep ? `${keep} élément${keep > 1 ? 's semblent personnels' : ' semble personnel'} : gardez-${keep > 1 ? 'les' : 'le'}. ` : '') +
        (review ? `Jetez un œil aux ${review} élément${review > 1 ? 's' : ''} à vérifier avant de nettoyer.` : '');
      return {
        ok: true,
        value: {
          provider,
          model: settings.aiModel[provider] ?? DEFAULT_MODEL[provider],
          verdicts,
          summary: summary.trim() || 'Rien à signaler.',
        },
      };
    },
    'feedback:send': async ({ message }) => {
      await delay(400);
      if (!message.trim()) return { ok: false, error: 'Le message est vide.' };
      return {
        ok: true,
        value: {
          delivered: 'browser',
          message: 'Le formulaire pré-rempli s’est ouvert dans votre navigateur. Il ne reste qu’à le valider. (Démo : rien n’a été ouvert.)',
        },
      };
    },
    'tip:options': async () => [
      { id: 'coffee', label: 'Un café', description: 'Un don ponctuel, du montant de votre choix.', url: 'https://ko-fi.com/cleanly' },
      {
        id: 'sponsor',
        label: 'Parrainer sur GitHub',
        description: 'Un soutien mensuel qui finance les certificats de signature et le temps de développement.',
        url: 'https://github.com/sponsors/cleanly-app',
      },
    ],
  };
}
