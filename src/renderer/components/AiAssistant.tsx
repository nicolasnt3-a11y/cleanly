/** Panneau « Un second avis » : verdicts IA facultatifs sur une liste d'éléments (jamais leur contenu). */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiReviewItem, AiReviewResult, AiVerdictKind } from '../../../shared/types';
import { call, errorMessage } from '../api';
import { navigate } from '../nav';
import { useStore } from '../state/createStore';
import { loadSettings, setVerdicts, settingsStore } from '../state/stores';
import { PROVIDER_LABEL } from '../screens/settings/aiModels';
import { Icon } from './icons';
import { Button, Spinner, VerdictChip } from './ui';
import './AiAssistant.css';

export interface AiAssistantProps {
  /** Éléments à soumettre (nom, chemin, taille — jamais le contenu). */
  items: AiReviewItem[];
  /** Variante compacte pour les barres latérales étroites. */
  compact?: boolean;
}

const MAX_ITEMS = 500;
const KINDS: AiVerdictKind[] = ['safe', 'review', 'keep'];
const KIND_COUNT_LABEL: Record<AiVerdictKind, [string, string]> = {
  safe: ['sûr', 'sûrs'],
  review: ['à vérifier', 'à vérifier'],
  keep: ['à conserver', 'à conserver'],
};

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: AiReviewResult }
  | { status: 'error'; error: string };

/** Signature stable de la liste : change seulement si l'ensemble des ids change. */
function signature(items: AiReviewItem[]): string {
  return items
    .map((i) => i.id)
    .sort()
    .join('|');
}

/** Écrit ses verdicts dans verdictStore (state/stores.ts) ; les listes les lisent par id. */
export function AiAssistant({ items, compact }: AiAssistantProps) {
  const { settings } = useStore(settingsStore);
  const [state, setState] = useState<State>({ status: 'idle' });
  const reqSeq = useRef(0);
  const sig = useMemo(() => signature(items), [items]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (!settings) void loadSettings().catch(() => undefined);
  }, [settings]);

  // Liste modifiée : on oublie le résultat affiché et on ignore toute réponse en cours.
  useEffect(() => {
    reqSeq.current++;
    setState({ status: 'idle' });
  }, [sig]);

  const provider = settings?.aiProvider ?? null;
  const hasKey = provider ? settings!.hasApiKey[provider] : false;
  const ready = !!provider && hasKey;
  const count = Math.min(items.length, MAX_ITEMS);

  const run = async () => {
    const seq = ++reqSeq.current;
    const batch = itemsRef.current.slice(0, MAX_ITEMS);
    setState({ status: 'loading' });
    try {
      const r = await call('ai:review', { items: batch });
      if (seq !== reqSeq.current) return;
      if (r.ok) {
        setVerdicts(r.value.verdicts, r.value.summary);
        setState({ status: 'done', result: r.value });
      } else setState({ status: 'error', error: r.error });
    } catch (e) {
      if (seq === reqSeq.current) setState({ status: 'error', error: errorMessage(e) });
    }
  };

  const counts = useMemo(() => {
    const c: Record<AiVerdictKind, number> = { safe: 0, review: 0, keep: 0 };
    if (state.status === 'done') for (const v of state.result.verdicts) c[v.verdict]++;
    return c;
  }, [state]);

  return (
    <section className={`panel ai-panel${compact ? ' compact' : ''}`} aria-label="Assistant IA : un second avis" aria-busy={state.status === 'loading'}>
      <header className="ai-head">
        <span className="ai-mark" aria-hidden="true">
          <Icon name="sparkle" size={18} />
        </span>
        <div className="ai-head-text">
          <h3 className="ai-title">Un second avis</h3>
          <span className="ai-meta">
            {!settings
              ? '…'
              : provider
                ? `${PROVIDER_LABEL[provider]} · ${hasKey ? 'clé chiffrée' : 'aucune clé'}`
                : 'Assistant désactivé'}
          </span>
        </div>
      </header>

      {settings && !ready ? (
        <div className="ai-body">
          <p className="small">
            {provider
              ? `Ajoutez votre clé API ${PROVIDER_LABEL[provider]} pour demander un avis sur ces éléments.`
              : 'Un modèle d’IA (Claude ou ChatGPT, avec votre propre clé) peut indiquer ce qui est sûr à supprimer. Facultatif.'}
          </p>
          <Button small icon="settings" onClick={() => navigate('settings')}>
            {provider ? 'Ajouter une clé' : 'Configurer l’assistant'}
          </Button>
        </div>
      ) : (
        <div className="ai-body">
          {state.status !== 'done' && (
            <p className="ai-privacy">
              <Icon name="lock" size={14} />
              <span>Seuls les noms, chemins (« ~ » à la place de votre dossier) et tailles sont envoyés. Jamais le contenu.</span>
            </p>
          )}

          {state.status === 'idle' && (
            <Button small={compact} variant="solid" className="ai-go" disabled={count === 0 || !settings} onClick={() => void run()}>
              {count === 0 ? 'Aucun élément à évaluer' : `Obtenir des verdicts (${count} élément${count > 1 ? 's' : ''})`}
            </Button>
          )}
          {state.status === 'idle' && items.length > MAX_ITEMS && (
            <p className="small">Les {MAX_ITEMS} premiers éléments seront évalués.</p>
          )}

          {state.status === 'loading' && (
            <div className="ai-loading" role="status">
              <Spinner />
              <span className="small">
                {provider ? PROVIDER_LABEL[provider] : 'L’assistant'} examine {count} élément{count > 1 ? 's' : ''}…
              </span>
            </div>
          )}

          {state.status === 'error' && (
            <>
              <p className="notice ai-error" role="alert">
                {state.error}
              </p>
              <div className="ai-actions">
                <Button small icon="refresh" onClick={() => void run()}>
                  Réessayer
                </Button>
                <Button small onClick={() => navigate('settings')}>
                  Paramètres
                </Button>
              </div>
            </>
          )}

          {state.status === 'done' && (
            <>
              <ul className="ai-counts" aria-label="Répartition des verdicts">
                {KINDS.map((k) => (
                  <li key={k}>
                    <span className="ai-count num">{counts[k]}</span>
                    <VerdictChip verdict={k} title={`${counts[k]} ${KIND_COUNT_LABEL[k][counts[k] > 1 ? 1 : 0]}`} />
                  </li>
                ))}
              </ul>
              {state.result.summary && <p className="ai-summary">{state.result.summary}</p>}
              <p className="ai-foot">
                <span className="mono">{state.result.model}</span>
                <span>Un avis, pas une décision : vous gardez la main.</span>
              </p>
              <div className="ai-actions">
                <Button small icon="refresh" onClick={() => void run()}>
                  Redemander
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
