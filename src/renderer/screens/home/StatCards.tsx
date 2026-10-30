/** Bandeau des 4 cartes de l'accueil (Nettoyage, Vitesse, Protection, Applications). */
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/icons';
import { navigate, type ScreenId } from '../../nav';

export interface CardData {
  value: string;
  unit?: string;
  sub: string;
}

interface CardDef {
  id: ScreenId;
  label: string;
  icon: IconName;
  deco: ReactNode;
}

const DECO: Record<'clean' | 'speed' | 'protect' | 'apps', ReactNode> = {
  clean: (
    <span className="hm-deco hm-particles">
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  ),
  speed: (
    <span className="hm-deco hm-slider">
      <i className="hm-slider-track" />
      <i className="hm-slider-knob" />
    </span>
  ),
  protect: <span className="hm-deco hm-glow" />,
  apps: (
    <span className="hm-deco hm-tiles">
      {Array.from({ length: 4 }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  ),
};

const CARDS: CardDef[] = [
  { id: 'cleanup', label: 'Nettoyage', icon: 'clean', deco: DECO.clean },
  { id: 'speed', label: 'Vitesse', icon: 'speed', deco: DECO.speed },
  { id: 'protection', label: 'Protection', icon: 'shield', deco: DECO.protect },
  { id: 'apps', label: 'Applications', icon: 'apps', deco: DECO.apps },
];

export function StatCards({ data, busy }: { data: [CardData, CardData, CardData, CardData]; busy?: boolean }) {
  return (
    <nav className={busy ? 'hm-cards busy' : 'hm-cards'} aria-label="Résumé">
      {CARDS.map((c, i) => {
        const d = data[i]!;
        return (
          <button key={c.id} type="button" className="hm-card" onClick={() => navigate(c.id)}>
            {c.deco}
            <span className="hm-card-top">
              <span className="mono">{c.label}</span>
              <Icon name={c.icon} size={22} />
            </span>
            <span className="hm-card-value num">
              {d.value}
              {d.unit && <span className="hm-card-unit">{d.unit}</span>}
            </span>
            <span className="hm-card-sub" title={d.sub}>{d.sub}</span>
          </button>
        );
      })}
    </nav>
  );
}
