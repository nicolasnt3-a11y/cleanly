/** Kit d'interface partagé (direction minimaliste). Utiliser ces composants plutôt que de les recréer. */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import type { AiVerdictKind, CheckStatus } from '../../../shared/types';

/** Bouton capsule signature, avec reflet lumineux en rotation. Une seule action principale par écran. */
export function Capsule({
  small,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { small?: boolean }) {
  return (
    <button type="button" className={['capsule', small && 'sm', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </button>
  );
}

export function Button({
  variant = 'default',
  small,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'solid' | 'danger';
  small?: boolean;
  icon?: IconName;
}) {
  const cls = ['btn', variant !== 'default' && variant, small && 'sm', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {icon && <Icon name={icon} size={small ? 16 : 18} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" className={className ? `icon-btn ${className}` : 'icon-btn'} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={20} />
    </button>
  );
}

/** Case à cocher visuelle (à placer dans un bouton/label qui porte l'action). */
export function CheckMark({ on, mixed }: { on: boolean; mixed?: boolean }) {
  return (
    <span className={`chk${on ? ' on' : ''}${mixed ? ' mixed' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 12 12">{mixed ? <path d="M3 6h6" /> : <path d="M2.5 6.2l2.4 2.3L9.5 3.8" />}</svg>
    </span>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  disabled,
  busy,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled || busy}
      className={`sw${on ? ' on' : ''}${busy ? ' busy' : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segs" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'seg on' : 'seg'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ tone, children }: { tone?: 'accent' | 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return <span className={tone ? `badge ${tone}` : 'badge'}>{children}</span>;
}

const VERDICT_LABEL: Record<AiVerdictKind, string> = { safe: 'Sûr', review: 'À vérifier', keep: 'À conserver' };
export function VerdictChip({ verdict, title }: { verdict: AiVerdictKind; title?: string }) {
  return (
    <span className={`verdict ${verdict}`} title={title}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

const STATUS_LABEL: Record<CheckStatus, string> = { ok: 'Actif', warn: 'À vérifier', bad: 'Problème', unknown: 'Inconnu' };
export function StatusDot({ status, label }: { status: CheckStatus; label?: string }) {
  return (
    <span className={`status ${status}`}>
      <i />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

export function ProgressBar({ fraction }: { fraction: number | null }) {
  if (fraction === null) {
    return (
      <div className="progress indeterminate" role="progressbar" aria-label="Progression">
        <i />
      </div>
    );
  }
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Chargement" />;
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} />
      <div className="h3">{title}</div>
      {children && <div className="small" style={{ maxWidth: 420 }}>{children}</div>}
    </div>
  );
}

/** Tuile d'application : vraie icône si disponible, sinon initiales sur teinte dérivée du nom. */
export function AppTile({ name, iconDataUrl, size = 36 }: { name: string; iconDataUrl?: string; size?: number }) {
  if (iconDataUrl) {
    return (
      <span className="app-tile" style={{ width: size, height: size, background: 'transparent' }}>
        <img src={iconDataUrl} alt="" width={size - 4} height={size - 4} />
      </span>
    );
  }
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const initials = name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span className="app-tile" style={{ width: size, height: size, background: `hsl(${h},45%,40%)` }} aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

/** En-tête d'écran standard : surtitre mono + titre + zone droite. */
export function ScreenHead({ eyebrow, title, right }: { eyebrow: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="screen-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="h2">{title}</h2>
      </div>
      {right && <div className="screen-head-r">{right}</div>}
    </div>
  );
}
