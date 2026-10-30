/** Jeu d'icônes bicolores sur mesure : trait `currentColor` + aplat teinté (`.tn` → var(--tone)). */
import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'scan'
  | 'clean'
  | 'files'
  | 'map'
  | 'large'
  | 'duplicate'
  | 'speed'
  | 'apps'
  | 'shield'
  | 'settings'
  | 'feedback'
  | 'heart'
  | 'sparkle'
  | 'lock'
  | 'folder'
  | 'file'
  | 'trash'
  | 'check'
  | 'close'
  | 'chevron-right'
  | 'chevron-left'
  | 'refresh'
  | 'external'
  | 'info'
  | 'warn'
  | 'drive'
  | 'home'
  | 'globe'
  | 'code'
  | 'bug'
  | 'stop';

const paths: Record<IconName, ReactNode> = {
  scan: (
    <>
      <circle className="tn" cx="12" cy="12" r="8.5" />
      <path d="M12 6.5l1.5 3.9 3.9 1.6-3.9 1.6-1.5 3.9-1.5-3.9-3.9-1.6 3.9-1.6z" />
    </>
  ),
  clean: (
    <>
      <path className="tn" d="M6 10h12l-1.2 9.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8z" />
      <path d="M6 10h12l-1.2 9.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8zM4 7h16M10 7V4h4v3M10.5 13.5v4M13.5 13.5v4" />
    </>
  ),
  files: (
    <>
      <path className="tn" d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    </>
  ),
  map: (
    <>
      <circle className="tn" cx="9" cy="10" r="6" />
      <circle cx="9" cy="10" r="6" />
      <circle cx="17" cy="16" r="4" />
      <circle cx="17.5" cy="5.5" r="2" />
    </>
  ),
  large: (
    <>
      <path className="tn" d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5M9 17l3-3 3 3M12 14v-4" />
    </>
  ),
  duplicate: (
    <>
      <rect className="tn" x="8" y="8" width="12" height="12" rx="2" />
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  speed: (
    <>
      <path className="tn" d="M3.5 16a8.5 8.5 0 0 1 17 0z" />
      <path d="M3.5 16a8.5 8.5 0 0 1 17 0M12 16l4.2-4.8" />
      <circle cx="12" cy="16" r="1.6" />
    </>
  ),
  apps: (
    <>
      <rect className="tn" x="4" y="4" width="7" height="7" rx="2" />
      <rect className="tn" x="13" y="13" width="7" height="7" rx="2" />
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>
  ),
  shield: (
    <>
      <path className="tn" d="M12 3l7 3v5.5c0 4.4-3 7.8-7 9.5-4-1.7-7-5.1-7-9.5V6z" />
      <path d="M12 3l7 3v5.5c0 4.4-3 7.8-7 9.5-4-1.7-7-5.1-7-9.5V6zM9 12l2.2 2.2L15.5 10" />
    </>
  ),
  settings: (
    <>
      <circle className="tn" cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5" />
    </>
  ),
  feedback: (
    <>
      <path className="tn" d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z" />
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4zM8.5 9.5h7M8.5 12.5h4" />
    </>
  ),
  heart: (
    <>
      <path className="tn" d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </>
  ),
  sparkle: (
    <>
      <path className="tn" d="M10 3l1.9 5.1L17 10l-5.1 1.9L10 17l-1.9-5.1L3 10l5.1-1.9z" />
      <path d="M10 3l1.9 5.1L17 10l-5.1 1.9L10 17l-1.9-5.1L3 10l5.1-1.9zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
    </>
  ),
  lock: (
    <>
      <rect className="tn" x="5" y="10" width="14" height="10" rx="2" />
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  folder: (
    <>
      <path className="tn" d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </>
  ),
  file: (
    <>
      <path className="tn" d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5" />
    </>
  ),
  trash: (
    <>
      <path className="tn" d="M6.5 8h11l-1 11.2a2 2 0 0 1-2 1.8h-5a2 2 0 0 1-2-1.8z" />
      <path d="M6.5 8h11l-1 11.2a2 2 0 0 1-2 1.8h-5a2 2 0 0 1-2-1.8zM4.5 8h15M9.5 8V5h5v3" />
    </>
  ),
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'chevron-right': <path d="M9.5 6l6 6-6 6" />,
  'chevron-left': <path d="M14.5 6l-6 6 6 6" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
  info: (
    <>
      <circle className="tn" cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  warn: (
    <>
      <path className="tn" d="M12 4l9 16H3z" />
      <path d="M12 4l9 16H3zM12 10v4M12 17h.01" />
    </>
  ),
  drive: (
    <>
      <rect className="tn" x="3" y="13" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M5 13l2.5-8h9L19 13M16.5 16.5h.01" />
    </>
  ),
  home: (
    <>
      <path className="tn" d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />
      <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />
    </>
  ),
  globe: (
    <>
      <circle className="tn" cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </>
  ),
  code: (
    <>
      <rect className="tn" x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 9l-3 3 3 3M15 9l3 3-3 3M13 8l-2 8" />
    </>
  ),
  bug: (
    <>
      <rect className="tn" x="7" y="8" width="10" height="12" rx="5" />
      <rect x="7" y="8" width="10" height="12" rx="5" />
      <path d="M9 8a3 3 0 0 1 6 0M4 13h3M17 13h3M5 19l2.5-1.5M19 19l-2.5-1.5M5 7l2.5 1.5M19 7l-2.5 1.5M12 12v6" />
    </>
  ),
  stop: (
    <>
      <rect className="tn" x="6" y="6" width="12" height="12" rx="2" />
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 22, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className ? `ic ${className}` : 'ic'}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}

/** Logo Cleanly : un « C » ouvert et une étincelle. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0e0f12" />
      <path d="M21.6 10.4A8 8 0 1 0 21.6 21.6" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M23.5 12.6l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" fill="#7d96ff" />
    </svg>
  );
}
