/** Paramètres : assistant IA, nettoyage, affichage, à propos. */
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { AiProvider, MotionPreference, Settings, SettingsPatch, TestApiKeyResult } from '../../../../shared/types';
import { call, errorMessage } from '../../api';
import { Icon } from '../../components/icons';
import { Badge, Button, ScreenHead, Segmented, Spinner, Toggle } from '../../components/ui';
import { navigate } from '../../nav';
import { useStore } from '../../state/createStore';
import { appStore, loadSettings, settingsStore, updateSettings } from '../../state/stores';
import { MODEL_OPTIONS, PROVIDER_LABEL, defaultModel } from './aiModels';
import './prefs.css';

type ProviderChoice = AiProvider | 'off';

export function SettingsScreen() {
  const { settings } = useStore(settingsStore);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) loadSettings().catch((e) => setError(errorMessage(e)));
  }, [settings]);

  const save = async (patch: SettingsPatch) => {
    setError(null);
    try {
      await updateSettings(patch);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="screen prefs">
      <ScreenHead eyebrow="Préférences" title="Paramètres" />
      {error && (
        <p className="notice bad" role="alert">
          {error}
        </p>
      )}
      {!settings ? (
        <div className="pref-inline">
          <Spinner /> <span className="small">Chargement des paramètres…</span>
        </div>
      ) : (
        <>
          <AiSection settings={settings} save={save} />
          <CleaningSection settings={settings} save={save} />
          <DisplaySection settings={settings} save={save} />
          <AboutSection />
        </>
      )}
    </div>
  );
}

function Section({ title, eyebrow, children, right }: { title: string; eyebrow: string; children: ReactNode; right?: ReactNode }) {
  const id = useId();
  return (
    <section className="prefs-section" aria-labelledby={id}>
      <div className="prefs-section-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3 className="h3" id={id} style={{ marginTop: 4 }}>
            {title}
          </h3>
        </div>
        {right}
      </div>
      <div className="panel">{children}</div>
    </section>
  );
}

type SaveFn = (patch: SettingsPatch) => Promise<void>;

/* ───────────────────────────── Assistant IA ───────────────────────────── */

function AiSection({ settings, save }: { settings: Settings; save: SaveFn }) {
  const provider = settings.aiProvider;
  const choice: ProviderChoice = provider ?? 'off';
  const [keyDraft, setKeyDraft] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<TestApiKeyResult | null>(null);
  const [testing, setTesting] = useState(false);
  const keyId = useId();
  const modelId = useId();

  useEffect(() => {
    setKeyDraft('');
    setKeyMsg(null);
    setTest(null);
  }, [provider]);

  const hasKey = provider ? settings.hasApiKey[provider] : false;

  const storeKey = async (apiKey: string | null) => {
    if (!provider) return;
    setKeyBusy(true);
    setKeyMsg(null);
    setTest(null);
    try {
      const r = await call('settings:set-api-key', { provider, apiKey });
      if (r.ok) {
        settingsStore.set({ settings: r.value });
        setKeyDraft('');
        setKeyMsg({ ok: true, text: apiKey ? 'Clé chiffrée et enregistrée.' : 'Clé effacée.' });
      } else setKeyMsg({ ok: false, text: r.error });
    } catch (e) {
      setKeyMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setKeyBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const k = keyDraft.trim();
    if (k) void storeKey(k);
  };

  const runTest = async () => {
    if (!provider) return;
    setTesting(true);
    setTest(null);
    try {
      setTest(await call('ai:test-key', provider));
    } catch (e) {
      setTest({ ok: false, message: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section eyebrow="Second avis" title="Assistant IA">
      <div className="pref">
        <div className="pref-text">
          <span className="pref-title">Fournisseur</span>
          <span className="small">
            Facultatif. Un modèle d’IA peut donner un avis sur les éléments trouvés, avec votre propre clé API. Le nettoyage
            fonctionne entièrement sans.
          </span>
        </div>
        <div className="pref-ctrl">
          <Segmented<ProviderChoice>
            label="Fournisseur d’IA"
            value={choice}
            options={[
              { value: 'anthropic', label: 'Claude' },
              { value: 'openai', label: 'ChatGPT' },
              { value: 'off', label: 'Désactivé' },
            ]}
            onChange={(v) => void save({ aiProvider: v === 'off' ? null : v })}
          />
        </div>
      </div>

      {provider && (
        <>
          <div className="pref stack">
            <div className="pref-text">
              <label className="pref-title" htmlFor={keyId}>
                Clé API {PROVIDER_LABEL[provider]}
                {hasKey ? (
                  <Badge tone="ok">Clé chiffrée enregistrée</Badge>
                ) : (
                  <Badge>Aucune clé</Badge>
                )}
              </label>
              <span className="small">
                {provider === 'anthropic'
                  ? 'Créez une clé sur console.anthropic.com. Elle commence par « sk-ant- ».'
                  : 'Créez une clé sur platform.openai.com. Elle commence par « sk- ».'}{' '}
                La clé est chiffrée par le système ({settings.encryptionAvailable ? 'trousseau protégé' : 'indisponible'}) et
                ne quitte jamais le cœur de l’application : l’interface ne peut pas la relire.
              </span>
            </div>
            {!settings.encryptionAvailable && (
              <p className="notice warn" role="alert">
                Le chiffrement sécurisé n’est pas disponible sur ce système. Par prudence, Cleanly refuse d’enregistrer une clé
                en clair : l’assistant IA ne peut pas être utilisé.
              </p>
            )}
            <form className="pref-inline" onSubmit={onSubmit}>
              <input
                id={keyId}
                className="input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={hasKey ? 'Coller une nouvelle clé pour remplacer' : provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                value={keyDraft}
                maxLength={512}
                disabled={keyBusy || !settings.encryptionAvailable}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <Button type="submit" variant="solid" disabled={keyBusy || !keyDraft.trim() || !settings.encryptionAvailable}>
                Enregistrer
              </Button>
              {hasKey && (
                <Button variant="danger" disabled={keyBusy} onClick={() => void storeKey(null)}>
                  Effacer
                </Button>
              )}
            </form>
            <div className="pref-inline" aria-live="polite">
              <Button small icon="check" disabled={!hasKey || testing || keyBusy} onClick={() => void runTest()}>
                Tester la clé
              </Button>
              {(testing || keyBusy) && <Spinner />}
              {keyMsg && <span className={`inline-msg ${keyMsg.ok ? 'ok' : 'bad'}`}>{keyMsg.text}</span>}
              {test && !keyMsg && <span className={`inline-msg ${test.ok ? 'ok' : 'bad'}`}>{test.message}</span>}
            </div>
          </div>

          <div className="pref">
            <div className="pref-text">
              <label className="pref-title" htmlFor={modelId}>
                Modèle
              </label>
              <span className="small">Le modèle recommandé offre le meilleur jugement. Les autres coûtent moins cher.</span>
            </div>
            <div className="pref-ctrl">
              <ModelSelect id={modelId} provider={provider} settings={settings} save={save} />
            </div>
          </div>
        </>
      )}

      <div className="pref stack">
        <div className="privacy">
          <Icon name="lock" />
          <div>
            <strong>Ce qui est envoyé, et seulement cela.</strong> Quand vous demandez un avis, Cleanly transmet au fournisseur
            choisi le <strong>nom</strong>, le <strong>chemin</strong>, la <strong>taille</strong> et la date de chaque élément.
            <ul>
              <li>Jamais le contenu d’un fichier.</li>
              <li>Votre dossier personnel est remplacé par « ~ » dans les chemins (votre nom d’utilisateur n’est pas transmis).</li>
              <li>Rien n’est envoyé sans que vous le demandiez, élément par élément.</li>
            </ul>
          </div>
        </div>
      </div>
    </Section>
  );
}

function ModelSelect({ id, provider, settings, save }: { id: string; provider: AiProvider; settings: Settings; save: SaveFn }) {
  const current = settings.aiModel[provider];
  const options = MODEL_OPTIONS[provider];
  const custom = current && !options.some((o) => o.id === current) ? current : null;
  return (
    <select
      id={id}
      className="select"
      value={current ?? ''}
      onChange={(e) => {
        const v = e.target.value || null;
        void save({ aiModel: { ...settings.aiModel, [provider]: v === defaultModel(provider) ? null : v } });
      }}
    >
      <option value="">Par défaut ({options[0]!.label.split(' — ')[0]})</option>
      {options.slice(1).map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
      {custom && <option value={custom}>{custom}</option>}
    </select>
  );
}

/* ───────────────────────────── Nettoyage ───────────────────────────── */

function NumberSetting({
  label,
  value,
  min,
  max,
  unit,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft.replace(/\s/g, '').replace(',', '.')));
    const v = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
    setDraft(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <span className="num-input">
      <input
        className="input"
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <span className="unit">{unit}</span>
    </span>
  );
}

function CleaningSection({ settings, save }: { settings: Settings; save: SaveFn }) {
  return (
    <Section eyebrow="Règles" title="Nettoyage">
      <div className="pref">
        <div className="pref-text">
          <span className="pref-title">Anciens téléchargements</span>
          <span className="small">
            Un fichier du dossier Téléchargements est proposé s’il n’a pas été modifié depuis ce nombre de jours (30 au
            minimum). Il part toujours dans la Corbeille.
          </span>
        </div>
        <div className="pref-ctrl">
          <NumberSetting
            label="Ancienneté minimale des téléchargements, en jours"
            value={settings.oldDownloadsDays}
            min={30}
            max={3650}
            unit="jours"
            onCommit={(v) => void save({ oldDownloadsDays: v })}
          />
        </div>
      </div>
      <div className="pref">
        <div className="pref-text">
          <span className="pref-title">Fichiers volumineux</span>
          <span className="small">Taille à partir de laquelle un fichier apparaît dans « Fichiers volumineux ».</span>
        </div>
        <div className="pref-ctrl">
          <NumberSetting
            label="Taille minimale d’un fichier volumineux, en mégaoctets"
            value={settings.largeFileMinMb}
            min={10}
            max={100000}
            unit="Mo"
            onCommit={(v) => void save({ largeFileMinMb: v })}
          />
        </div>
      </div>
      <div className="pref">
        <div className="pref-text">
          <span className="pref-title">Confirmer avant de nettoyer</span>
          <span className="small">Affiche un récapitulatif avant chaque suppression.</span>
        </div>
        <div className="pref-ctrl">
          <Toggle
            label="Confirmer avant de nettoyer"
            on={settings.confirmBeforeClean}
            onChange={(v) => void save({ confirmBeforeClean: v })}
          />
        </div>
      </div>
    </Section>
  );
}

/* ───────────────────────────── Affichage ───────────────────────────── */

function DisplaySection({ settings, save }: { settings: Settings; save: SaveFn }) {
  return (
    <Section eyebrow="Interface" title="Affichage">
      <div className="pref">
        <div className="pref-text">
          <span className="pref-title">Animations</span>
          <span className="small">« Système » suit le réglage d’accessibilité de votre ordinateur.</span>
        </div>
        <div className="pref-ctrl">
          <Segmented<MotionPreference>
            label="Animations"
            value={settings.motion}
            options={[
              { value: 'system', label: 'Système' },
              { value: 'reduced', label: 'Réduites' },
              { value: 'full', label: 'Complètes' },
            ]}
            onChange={(v) => void save({ motion: v })}
          />
        </div>
      </div>
    </Section>
  );
}

/* ───────────────────────────── À propos ───────────────────────────── */

function AboutSection() {
  const { info } = useStore(appStore);
  return (
    <Section eyebrow="Cleanly" title="À propos">
      <div className="pref stack">
        <dl className="kv">
          <dt>Version</dt>
          <dd className="num">
            {info ? `${info.version}${info.isDemo ? ' · démo' : info.isPackaged ? '' : ' · développement'}` : '—'}
          </dd>
          <dt>Système</dt>
          <dd>{info ? `${info.osLabel} · ${info.arch}` : '—'}</dd>
        </dl>
        <p className="small">
          Cleanly ne supprime que ce qu’il peut revérifier lui-même, et envoie à la Corbeille tout ce qui vous appartient. Les
          vérifications de l’écran Protection donnent un aperçu des réglages de sécurité du système : elles ne remplacent pas
          un antivirus.
        </p>
      </div>
      <div className="pref">
        <div className="pref-text">
          <span className="pref-title">Un avis, un bug, une idée ?</span>
          <span className="small">Chaque retour est lu.</span>
        </div>
        <div className="pref-ctrl">
          <Button small icon="feedback" onClick={() => navigate('feedback')}>
            Donner votre avis
          </Button>
          <Button small icon="heart" onClick={() => navigate('tip')}>
            Soutenir
          </Button>
        </div>
      </div>
    </Section>
  );
}
