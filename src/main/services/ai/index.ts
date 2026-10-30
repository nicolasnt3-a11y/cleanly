/**
 * Assistant IA : « second avis » sur des éléments à nettoyer.
 *
 * Confidentialité : le modèle ne reçoit QUE nom, chemin (dossier personnel remplacé par « ~ »),
 * taille, date de modification et contexte. Jamais le contenu d'un fichier. Les identifiants
 * envoyés sont des numéros locaux, rattachés ensuite aux ids d'origine.
 *
 * SDK officiels : `@anthropic-ai/sdk` (Claude) et `openai` (ChatGPT). Les erreurs des SDK ne
 * sont jamais renvoyées telles quelles (elles pourraient contenir des détails de requête) :
 * elles sont traduites en messages français neutres.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import os from 'node:os';
import type {
  AiProvider,
  AiReviewItem,
  AiReviewRequest,
  AiReviewResult,
  AiVerdict,
  AiVerdictKind,
  Result,
  TestApiKeyResult,
} from '../../../../shared/types';
import { getApiKey, getSettings } from '../settings/index';

/** Modèles par défaut (surchargés par Settings.aiModel). */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5.5',
};

const PROVIDER_LABEL: Record<AiProvider, string> = { anthropic: 'Claude', openai: 'ChatGPT' };
const BATCH_SIZE = 150;
const MAX_ITEMS = 500;
const TIMEOUT_MS = 60_000;
const MAX_REASON = 140;
const MAX_SUMMARY = 400;
const VERDICTS: readonly AiVerdictKind[] = ['safe', 'review', 'keep'];
const NEUTRAL_REASON = "Pas d'avis clair : vérifiez cet élément avant de le supprimer.";

/* ───────────────────────────── Prompt ───────────────────────────── */

export const SYSTEM_PROMPT = `Tu es l'assistant de Cleanly, un nettoyeur de disque pour Windows et macOS. On te donne une liste d'éléments repérés pendant une analyse. Pour chacun tu ne connais QUE : un identifiant, le chemin (le dossier personnel est remplacé par « ~ »), le nom, la taille en octets, la date de dernière modification et le contexte (catégorie de nettoyage, « large-file » pour un gros fichier, « duplicate » pour un doublon, « space-map » pour un élément de la carte d'espace). Tu ne vois jamais le contenu des fichiers.

Donne un verdict par élément :
- "safe" : sans risque à supprimer, car régénérable ou jetable (caches, fichiers temporaires, journaux, rapports de plantage, caches de développement, installateurs déjà utilisés et faciles à retélécharger).
- "review" : l'utilisateur doit vérifier lui-même (archives, vidéos, images disque, téléchargements anciens au contenu incertain, doublons dont on ne sait pas lequel garder, tout ce qui est ambigu).
- "keep" : à conserver (documents, photos, vidéos personnelles, projets et code source, clés, certificats, portefeuilles, bases de données, sauvegardes, fichiers de configuration, données d'applications).

En cas de doute, choisis "review". Ne recommande jamais "safe" pour un élément qui pourrait être unique ou personnel.

Réponds en français. Pour chaque élément, une justification courte et concrète (moins de 140 caractères), sans répéter le chemin. Termine par une synthèse d'une ou deux phrases pour l'ensemble. Réponds uniquement avec le JSON demandé : {"verdicts":[{"id","verdict","reason"}],"summary"}, avec exactement un verdict par identifiant reçu.`;

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['safe', 'review', 'keep'] },
          reason: { type: 'string' },
        },
        required: ['id', 'verdict', 'reason'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
  },
  required: ['verdicts', 'summary'],
  additionalProperties: false,
} as const;

/* ─────────────────────────── Anonymisation ─────────────────────────── */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remplace le dossier personnel par « ~ » et masque le nom des autres comptes utilisateur. */
export function anonymizePath(p: string, home = os.homedir()): string {
  let out = p;
  const h = home.replace(/[\\/]+$/, '');
  if (h.length > 1) {
    const re = new RegExp(`^${escapeRe(h)}(?=$|[\\\\/])`, process.platform === 'win32' || /^[A-Za-z]:/.test(h) ? 'i' : '');
    out = out.replace(re, '~');
  }
  // Autres profils (C:\Users\xxx, /Users/xxx, /home/xxx) : nom masqué.
  out = out.replace(/^([A-Za-z]:[\\/]Users[\\/])[^\\/]+/i, '$1<utilisateur>');
  out = out.replace(/^(\/(?:Users|home)\/)[^/]+/, '$1<utilisateur>');
  return out;
}

function isoDate(ms: number | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Charge utile envoyée au modèle pour un lot (ids locaux « 1 », « 2 »…). */
export function buildUserMessage(batch: AiReviewItem[]): string {
  const rows = batch.map((it, i) => ({
    id: String(i + 1),
    path: anonymizePath(it.path),
    name: it.name,
    sizeBytes: it.sizeBytes,
    modified: isoDate(it.modifiedAt),
    context: it.context,
  }));
  return `Éléments à évaluer (${rows.length}) :\n${JSON.stringify(rows)}`;
}

/* ─────────────────────────── Analyse défensive ─────────────────────────── */

function cleanText(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Extrait l'objet JSON d'un texte (tolère des balises ```json ou du texte autour). */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Transforme la réponse brute du modèle en verdicts sûrs pour le lot donné :
 * ids inconnus ignorés, verdict hors énumération ignoré, raison tronquée,
 * ids manquants → « review » avec une raison neutre. Ne lève jamais.
 */
export function parseVerdicts(text: string, batch: AiReviewItem[]): { verdicts: AiVerdict[]; summary: string; parsed: boolean } {
  const data = extractJson(text);
  const byLocal = new Map<string, AiVerdict>();
  let summary = '';
  let parsed = false;
  if (typeof data === 'object' && data !== null) {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.verdicts)) {
      parsed = true;
      for (const v of o.verdicts) {
        if (typeof v !== 'object' || v === null) continue;
        const r = v as Record<string, unknown>;
        const local = typeof r.id === 'string' ? r.id.trim() : typeof r.id === 'number' ? String(r.id) : null;
        if (!local || byLocal.has(local)) continue;
        const idx = Number(local) - 1;
        if (!/^\d+$/.test(local) || idx < 0 || idx >= batch.length) continue;
        if (typeof r.verdict !== 'string' || !VERDICTS.includes(r.verdict as AiVerdictKind)) continue;
        const reason = typeof r.reason === 'string' ? cleanText(r.reason, MAX_REASON) : '';
        byLocal.set(local, { id: batch[idx]!.id, verdict: r.verdict as AiVerdictKind, reason: reason || NEUTRAL_REASON });
      }
    }
    if (typeof o.summary === 'string') summary = cleanText(o.summary, MAX_SUMMARY);
  }
  const verdicts = batch.map(
    (it, i) => byLocal.get(String(i + 1)) ?? { id: it.id, verdict: 'review' as const, reason: NEUTRAL_REASON },
  );
  return { verdicts, summary, parsed };
}

/* ─────────────────────────── Erreurs ─────────────────────────── */

class FriendlyError extends Error {}

/** Traduit une erreur de SDK en message français, sans jamais en recopier le contenu brut. */
function friendlyError(err: unknown, provider: AiProvider): string {
  if (err instanceof FriendlyError) return err.message;
  const name = PROVIDER_LABEL[provider];
  const A = Anthropic;
  const O = OpenAI;
  if (err instanceof A.AuthenticationError || err instanceof O.AuthenticationError)
    return `Clé API refusée par ${name} (401). Vérifiez-la ou enregistrez-en une nouvelle dans les paramètres.`;
  if (err instanceof A.PermissionDeniedError || err instanceof O.PermissionDeniedError)
    return `Accès refusé par ${name} (403) : cette clé n'a pas accès à ce modèle.`;
  if (err instanceof A.NotFoundError || err instanceof O.NotFoundError)
    return `Modèle introuvable chez ${name} (404). Choisissez le modèle par défaut dans les paramètres.`;
  if (err instanceof A.RateLimitError || err instanceof O.RateLimitError)
    return `Limite d'utilisation atteinte chez ${name} (429). Réessayez dans quelques instants ou vérifiez votre crédit.`;
  if (err instanceof A.APIConnectionTimeoutError || err instanceof O.APIConnectionTimeoutError)
    return `${name} n'a pas répondu à temps. Réessayez avec moins d'éléments.`;
  if (err instanceof A.APIConnectionError || err instanceof O.APIConnectionError)
    return `Impossible de joindre ${name}. Vérifiez votre connexion Internet.`;
  if (err instanceof A.BadRequestError || err instanceof O.BadRequestError)
    return `${name} a refusé la requête (400). Le modèle choisi ne prend peut-être pas en charge les réponses structurées.`;
  if (err instanceof A.InternalServerError || err instanceof O.InternalServerError)
    return `${name} rencontre un problème temporaire. Réessayez plus tard.`;
  if (err instanceof A.APIError || err instanceof O.APIError) {
    const status = typeof (err as { status?: unknown }).status === 'number' ? ` (${(err as { status: number }).status})` : '';
    return `Erreur du service ${name}${status}.`;
  }
  return `Erreur inattendue lors de l'appel à ${name}.`;
}

/* ─────────────────────────── Fournisseurs ─────────────────────────── */

/** Modèles Claude qui acceptent `output_config.effort` (ne pas l'envoyer aux anciens modèles). */
const CLAUDE_EFFORT = /^claude-(opus|sonnet|haiku|fable|mythos)-(5|4-[678])/;
/** Modèles Claude qui acceptent les repli serveur `fallbacks: "default"`. */
const CLAUDE_FALLBACK = /^claude-(opus-5|opus-5-5|sonnet-5-5|fable-5-1)$/;

async function askClaude(apiKey: string, model: string, user: string): Promise<string> {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  const fallback = CLAUDE_FALLBACK.test(model);
  const res = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: user }],
    output_config: {
      format: { type: 'json_schema', schema: RESPONSE_SCHEMA as unknown as Record<string, unknown> },
      ...(CLAUDE_EFFORT.test(model) ? { effort: 'low' as const } : {}),
    },
    ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  });
  if (res.stop_reason === 'refusal') throw new FriendlyError('Claude a refusé d’évaluer ces éléments.');
  if (res.stop_reason === 'max_tokens') throw new FriendlyError('La réponse de Claude a été tronquée. Réessayez avec moins d’éléments.');
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

/** Modèles OpenAI à raisonnement (acceptent `reasoning.effort`). */
const OPENAI_REASONING = /^(gpt-5|gpt-6|o\d)/;

async function askOpenAI(apiKey: string, model: string, user: string): Promise<string> {
  const client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  const res = await client.responses.create({
    model,
    instructions: SYSTEM_PROMPT,
    input: user,
    max_output_tokens: 16000,
    store: false,
    text: {
      format: { type: 'json_schema', name: 'cleanly_verdicts', schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>, strict: true },
    },
    ...(OPENAI_REASONING.test(model) ? { reasoning: { effort: 'low' as const } } : {}),
  });
  if (res.status === 'incomplete') throw new FriendlyError('La réponse de ChatGPT est incomplète. Réessayez avec moins d’éléments.');
  return res.output_text;
}

async function resolveProvider(provider?: AiProvider): Promise<{ provider: AiProvider; model: string; apiKey: string }> {
  const s = await getSettings();
  const p = provider ?? s.aiProvider;
  if (!p) throw new FriendlyError("Aucun assistant IA n'est activé. Choisissez Claude ou ChatGPT dans les paramètres.");
  const apiKey = await getApiKey(p);
  if (!apiKey) throw new FriendlyError(`Aucune clé ${PROVIDER_LABEL[p]} enregistrée. Ajoutez-la dans les paramètres.`);
  return { provider: p, model: s.aiModel[p] ?? DEFAULT_MODELS[p], apiKey };
}

/* ─────────────────────────── API publique ─────────────────────────── */

export async function reviewItems(req: AiReviewRequest): Promise<Result<AiReviewResult>> {
  // Dédoublonnage par id, plafond global.
  const seen = new Set<string>();
  const items = req.items.filter((it) => !seen.has(it.id) && seen.add(it.id)).slice(0, MAX_ITEMS);
  if (items.length === 0) return { ok: false, error: 'Aucun élément à évaluer.' };

  let ctx: Awaited<ReturnType<typeof resolveProvider>>;
  try {
    ctx = await resolveProvider();
  } catch (err) {
    return { ok: false, error: err instanceof FriendlyError ? err.message : 'Paramètres IA illisibles.' };
  }

  const batches: AiReviewItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) batches.push(items.slice(i, i + BATCH_SIZE));

  try {
    // Au plus deux lots en parallèle pour ménager les limites de débit.
    const results: Array<ReturnType<typeof parseVerdicts>> = new Array(batches.length);
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const idx = next++;
        const batch = batches[idx]!;
        const user = buildUserMessage(batch);
        const text = ctx.provider === 'anthropic' ? await askClaude(ctx.apiKey, ctx.model, user) : await askOpenAI(ctx.apiKey, ctx.model, user);
        const parsed = parseVerdicts(text, batch);
        if (!parsed.parsed) throw new FriendlyError(`La réponse de ${PROVIDER_LABEL[ctx.provider]} était illisible. Réessayez.`);
        results[idx] = parsed;
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, batches.length) }, worker));

    const verdicts = results.flatMap((r) => r.verdicts);
    const summaries = [...new Set(results.map((r) => r.summary).filter(Boolean))];
    let summary = summaries.length === 1 ? summaries[0]! : '';
    if (!summary) {
      const n = (k: AiVerdictKind) => verdicts.filter((v) => v.verdict === k).length;
      summary = `${n('safe')} sûrs, ${n('review')} à vérifier, ${n('keep')} à conserver.`;
      if (summaries.length > 1) summary = cleanText(`${summary} ${summaries.join(' ')}`, MAX_SUMMARY);
    }
    return { ok: true, value: { provider: ctx.provider, model: ctx.model, verdicts, summary } };
  } catch (err) {
    return { ok: false, error: friendlyError(err, ctx.provider) };
  }
}

/** Vérifie la clé par un appel gratuit (lecture des informations du modèle). */
export async function testApiKey(provider: AiProvider): Promise<TestApiKeyResult> {
  let ctx: Awaited<ReturnType<typeof resolveProvider>>;
  try {
    ctx = await resolveProvider(provider);
  } catch (err) {
    return { ok: false, message: err instanceof FriendlyError ? err.message : 'Paramètres IA illisibles.' };
  }
  try {
    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: ctx.apiKey, timeout: 15_000, maxRetries: 0 });
      const m = await client.models.retrieve(ctx.model);
      return { ok: true, model: m.id, message: `Clé valide. Modèle disponible : ${m.display_name || m.id}.` };
    }
    const client = new OpenAI({ apiKey: ctx.apiKey, timeout: 15_000, maxRetries: 0 });
    const m = await client.models.retrieve(ctx.model);
    return { ok: true, model: m.id, message: `Clé valide. Modèle disponible : ${m.id}.` };
  } catch (err) {
    return { ok: false, model: ctx.model, message: friendlyError(err, provider) };
  }
}
