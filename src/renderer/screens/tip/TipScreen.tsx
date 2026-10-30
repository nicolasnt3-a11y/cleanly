/** Soutenir Cleanly : page sobre, liens HTTPS ouverts dans le navigateur système. */
import { useEffect, useState } from 'react';
import type { TipOption } from '../../../../shared/types';
import { call, errorMessage } from '../../api';
import { Icon, type IconName } from '../../components/icons';
import { Button, ScreenHead, Spinner } from '../../components/ui';
import { navigate } from '../../nav';
import '../settings/prefs.css';

const TIP_ICON: Record<string, IconName> = { coffee: 'heart', sponsor: 'code' };

const REASONS: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: 'shield',
    title: 'Des applications signées',
    text: 'Les certificats de signature Windows et macOS coûtent plusieurs centaines d’euros par an. Sans eux, le système affiche des avertissements à l’installation.',
  },
  {
    icon: 'code',
    title: 'Un projet indépendant',
    text: 'Pas de publicité, pas de revente de données, pas d’abonnement caché. Juste un outil qui fait son travail.',
  },
  {
    icon: 'sparkle',
    title: 'Du temps pour l’améliorer',
    text: 'Chaque contribution finance des tests sur de vrais ordinateurs et de nouvelles vérifications de sécurité.',
  },
];

export function TipScreen() {
  const [options, setOptions] = useState<TipOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call('tip:options')
      .then(setOptions)
      .catch((e) => {
        setOptions([]);
        setError(errorMessage(e));
      });
  }, []);

  const open = async (url: string) => {
    setError(null);
    try {
      const r = await call('app:open-external', url);
      if (!r.ok) setError(r.error);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="screen prefs">
      <ScreenHead eyebrow="Soutenir" title="Cleanly est gratuit, et le restera." />
      <p className="sub" style={{ marginTop: -8 }}>
        Si l’application vous a rendu service, vous pouvez aider à la faire vivre. Aucune fonction n’est réservée aux
        donateurs.
      </p>

      <div className="tip-hero">
        <section className="prefs-section" aria-labelledby="tip-why">
          <div className="prefs-section-head">
            <h3 className="h3" id="tip-why">
              Pourquoi ça compte
            </h3>
          </div>
          <ul className="panel tip-reasons">
            {REASONS.map((r) => (
              <li key={r.title}>
                <Icon name={r.icon} />
                <div>
                  <div className="pref-title">{r.title}</div>
                  <p className="small" style={{ marginTop: 3 }}>
                    {r.text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="prefs-section" aria-labelledby="tip-how">
          <div className="prefs-section-head">
            <h3 className="h3" id="tip-how">
              Contribuer
            </h3>
          </div>
          {options === null ? (
            <Spinner />
          ) : (
            <div className="tip-cards">
              {options.map((o) => (
                <button key={o.id} type="button" className="panel tip-card" onClick={() => void open(o.url)}>
                  <span className="tip-icon" aria-hidden="true">
                    <Icon name={TIP_ICON[o.id] ?? 'heart'} size={20} />
                  </span>
                  <span className="tip-card-title">{o.label}</span>
                  <span className="small">{o.description}</span>
                  <span className="tip-card-go">
                    Ouvrir <Icon name="external" size={14} />
                  </span>
                </button>
              ))}
            </div>
          )}
          {error && (
            <p className="notice bad" role="alert">
              {error}
            </p>
          )}
          <p className="small">Le paiement se fait sur la plateforme choisie, dans votre navigateur. Cleanly ne voit rien passer.</p>
        </section>
      </div>

      <section className="prefs-section" aria-labelledby="tip-free">
        <div className="prefs-section-head">
          <h3 className="h3" id="tip-free">
            Sans dépenser un centime
          </h3>
        </div>
        <div className="panel">
          <div className="pref">
            <div className="pref-text">
              <span className="pref-title">Racontez-nous</span>
              <span className="small">Un bug signalé ou une idée bien formulée vaut autant qu’un don.</span>
            </div>
            <div className="pref-ctrl">
              <Button small icon="feedback" onClick={() => navigate('feedback')}>
                Donner votre avis
              </Button>
            </div>
          </div>
          <div className="pref">
            <div className="pref-text">
              <span className="pref-title">Parlez-en autour de vous</span>
              <span className="small">
                Recommander Cleanly à un proche dont l’ordinateur est saturé, c’est la meilleure des publicités.
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
