/** Votre avis : ouvre un formulaire pré-rempli (HTTPS) dans le navigateur. Aucun serveur Cleanly. */
import { useId, useState, type FormEvent } from 'react';
import type { FeedbackRequest } from '../../../../shared/types';
import { call, errorMessage } from '../../api';
import { Icon } from '../../components/icons';
import { Button, Capsule, ScreenHead, Segmented, Spinner, Toggle } from '../../components/ui';
import { navigate } from '../../nav';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/stores';
import '../settings/prefs.css';

type Kind = FeedbackRequest['kind'];
const MAX = 5000;
const PLACEHOLDER: Record<Kind, string> = {
  bug: 'Ce qui s’est passé, ce que vous attendiez, et comment le reproduire si possible.',
  idea: 'Ce qui vous manque, ou ce qui pourrait être plus simple.',
  praise: 'Ce qui vous a plu.',
  other: 'Votre message.',
};

export function FeedbackScreen() {
  const { info } = useStore(appStore);
  const [kind, setKind] = useState<Kind>('idea');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [diag, setDiag] = useState(true);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const msgId = useId();
  const emailId = useId();
  const counterId = useId();

  const trimmed = message.trim();
  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const canSend = trimmed.length >= 3 && message.length <= MAX && emailOk && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setState(null);
    try {
      const r = await call('feedback:send', {
        kind,
        message: trimmed,
        email: email.trim() || undefined,
        includeDiagnostics: diag,
      });
      setState(r.ok ? { ok: true, text: r.value.message } : { ok: false, text: r.error });
    } catch (err) {
      setState({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  if (state?.ok) {
    return (
      <div className="screen prefs">
        <ScreenHead eyebrow="Votre avis" title="Merci." />
        <div className="panel form-grid" role="status">
          <p className="sub" style={{ margin: 0 }}>
            {state.text}
          </p>
          <p className="small">
            Le formulaire s’ouvre sur GitHub. Si vous n’avez pas de compte, vous pouvez en créer un gratuitement, ou simplement
            nous écrire autrement : rien n’est envoyé tant que vous ne validez pas.
          </p>
          <div className="form-actions">
            <Button
              onClick={() => {
                setState(null);
                setMessage('');
              }}
            >
              Écrire un autre message
            </Button>
            <Button variant="solid" onClick={() => navigate('home')}>
              Retour à l’accueil
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen prefs">
      <ScreenHead eyebrow="Votre avis" title="Dites-nous tout." />
      <p className="sub" style={{ marginTop: -8 }}>
        Cleanly n’a pas de serveur. Votre message ouvre un formulaire pré-rempli dans votre navigateur, que vous relisez et
        validez vous-même.
      </p>

      <form className="panel form-grid" onSubmit={submit} noValidate>
        <div className="field">
          <span className="field-label" id={`${msgId}-kind`}>
            Type de retour
          </span>
          <div>
            <Segmented<Kind>
              label="Type de retour"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'bug', label: 'Bug' },
                { value: 'idea', label: 'Idée' },
                { value: 'praise', label: 'Bravo' },
                { value: 'other', label: 'Autre' },
              ]}
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={msgId}>
            Message
          </label>
          <textarea
            id={msgId}
            className="textarea"
            rows={7}
            maxLength={MAX}
            placeholder={PLACEHOLDER[kind]}
            value={message}
            aria-describedby={counterId}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="field-foot">
            <span>Évitez d’y mettre des informations personnelles : le formulaire sera public.</span>
            <span id={counterId} className={`num${message.length > MAX * 0.95 ? ' over' : ''}`} aria-live="polite">
              {message.length} / {MAX}
            </span>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={emailId}>
            E-mail <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>(facultatif)</span>
          </label>
          <input
            id={emailId}
            className="input"
            type="email"
            autoComplete="email"
            placeholder="vous@exemple.fr"
            value={email}
            maxLength={254}
            aria-invalid={!emailOk}
            onChange={(e) => setEmail(e.target.value)}
          />
          <span className="small" style={{ color: emailOk ? undefined : 'var(--bad)' }}>
            {emailOk
              ? 'Seulement si vous souhaitez une réponse. Il apparaîtra dans le formulaire, que vous pourrez modifier.'
              : 'Cette adresse ne semble pas valide.'}
          </span>
        </div>

        <div className="pref" style={{ padding: 0 }}>
          <div className="pref-text">
            <span className="pref-title">Joindre les informations techniques</span>
            <span className="small">Aide à reproduire un problème. Exactement ceci, rien d’autre :</span>
            <ul className="diag-list">
              <li>
                Version de Cleanly : <code>{info?.version ?? '—'}</code>
              </li>
              <li>
                Système : <code>{info ? `${info.osLabel} (${info.platform}, ${info.arch})` : '—'}</code>
              </li>
            </ul>
            <span className="small" style={{ marginTop: 4 }}>
              Aucun nom de fichier, chemin ou résultat d’analyse n’est joint.
            </span>
          </div>
          <div className="pref-ctrl">
            <Toggle label="Joindre les informations techniques" on={diag} onChange={setDiag} />
          </div>
        </div>

        <div className="form-actions">
          <Capsule small type="submit" disabled={!canSend}>
            {busy ? 'Ouverture…' : 'Ouvrir le formulaire'}
          </Capsule>
          {busy && <Spinner />}
          <span className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="external" size={16} /> S’ouvre dans votre navigateur (github.com)
          </span>
        </div>
        {state && !state.ok && (
          <p className="notice bad" role="alert">
            {state.text}
          </p>
        )}
      </form>
    </div>
  );
}
