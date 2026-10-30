/**
 * Boîte de confirmation modale partagée. Voile opaque (jamais de backdrop-filter :
 * le fond est un canvas animé).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Action destructrice : bouton de confirmation en rouge. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Annuler',
  danger,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, busy, onCancel]);

  if (!open) return null;
  return createPortal(
    <div className="dlg-veil" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="dlg panel" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <h3 id="dlg-title" className="h3">
          {title}
        </h3>
        {children && <div className="dlg-body">{children}</div>}
        <div className="dlg-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={danger ? 'btn solid dlg-danger' : 'btn solid'} onClick={onConfirm} disabled={busy}>
            {busy && <span className="spinner" style={{ borderTopColor: '#fff' }} />}
            {confirmLabel}
          </button>
        </div>
      </div>
      <style>{`
        .dlg-veil{position:fixed;inset:0;z-index:100;background:rgba(14,15,18,.32);display:grid;place-items:center;animation:cl-fade-in .15s ease}
        .dlg{width:min(460px,calc(100vw - 32px));padding:24px;display:flex;flex-direction:column;gap:14px;box-shadow:0 24px 60px rgba(14,15,18,.25)}
        .dlg-body{font-size:14px;color:var(--ink-2);line-height:1.55}
        .dlg-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}
        .dlg-danger{background:var(--bad);border-color:var(--bad)}
      `}</style>
    </div>,
    document.body,
  );
}
