/**
 * Vitesse — applications lancées au démarrage de la session.
 * Désactiver ne supprime rien : Cleanly écrit le même indicateur que le Gestionnaire des tâches
 * (Windows) ou passe par launchctl (macOS). L'état affiché après bascule est TOUJOURS celui relu
 * par le main dans la source.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Impact, Platform, StartupItem, StartupLocation } from '../../../../shared/types';
import { call, errorMessage } from '../../api';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/stores';
import { AppTile, Badge, Button, EmptyState, ScreenHead, Spinner, Toggle } from '../../components/ui';
import { Icon } from '../../components/icons';
import { ConfirmDialog } from '../../components/Dialog';
import { formatCount } from '../../lib/format';
import './speed.css';

const IMPACT: Record<Impact, { label: string; tone?: 'ok' | 'warn' | 'bad'; rank: number }> = {
  high: { label: 'Impact élevé', tone: 'bad', rank: 0 },
  medium: { label: 'Impact moyen', tone: 'warn', rank: 1 },
  low: { label: 'Impact faible', tone: 'ok', rank: 2 },
  unknown: { label: 'Impact inconnu', rank: 3 },
};

const LOCATION: Record<StartupLocation, string> = {
  'hkcu-run': 'Registre · utilisateur',
  'hklm-run': 'Registre · machine',
  'hklm-run32': 'Registre · machine 32 bits',
  'startup-folder-user': 'Dossier Démarrage',
  'startup-folder-common': 'Dossier Démarrage commun',
  'mac-launch-agent-user': 'LaunchAgent · utilisateur',
  'mac-launch-agent-global': 'LaunchAgent · système',
  'mac-login-item': 'Ouverture de session',
};

/** Tri à l'ouverture : activées d'abord, puis par impact, puis par nom. Figé ensuite pour ne pas faire sauter les lignes. */
function sortOrder(items: StartupItem[]): string[] {
  return [...items]
    .sort(
      (a, b) =>
        Number(b.enabled) - Number(a.enabled) ||
        IMPACT[a.impact].rank - IMPACT[b.impact].rank ||
        a.name.localeCompare(b.name, 'fr'),
    )
    .map((i) => i.id);
}

function copy(platform: Platform | undefined) {
  const mac = platform === 'darwin';
  return {
    howNote: mac
      ? 'Désactiver ne supprime rien. Cleanly utilise launchctl, comme le fait macOS lui-même ; vous pouvez réactiver à tout moment.'
      : 'Désactiver ne supprime rien. Cleanly écrit le même indicateur que le Gestionnaire des tâches ; vous pouvez réactiver à tout moment.',
    adminScope: 'Tous les utilisateurs · admin',
    adminTitle: mac
      ? 'Élément partagé par tous les utilisateurs : macOS demandera votre mot de passe administrateur.'
      : 'Élément partagé par tous les utilisateurs : Windows demandera une autorisation administrateur (UAC).',
    readOnlyTitle: mac
      ? 'Cleanly ne peut pas modifier cet élément. Gérez-le dans Réglages Système › Général › Ouverture.'
      : 'Cleanly ne peut pas modifier cet élément. Gérez-le dans le Gestionnaire des tâches › Applications de démarrage.',
    dlgTitle: mac ? 'macOS va demander votre mot de passe' : 'Windows va demander une autorisation',
    dlgBody: (name: string, enable: boolean) =>
      mac
        ? `${name} démarre pour tous les utilisateurs de ce Mac. Pour ${enable ? 'le réactiver' : 'le désactiver'}, macOS affichera une demande de mot de passe administrateur. Si vous la refusez, rien ne change.`
        : `${name} démarre pour tous les utilisateurs de ce PC. Pour ${enable ? 'le réactiver' : 'le désactiver'}, Windows affichera une fenêtre « Contrôle de compte d’utilisateur ». Si vous la refusez, rien ne change.`,
  };
}

type Flash = { tone: 'ok' | 'bad'; text: string } | null;

export function SpeedScreen() {
  const { info } = useStore(appStore);
  const t = copy(info?.platform);

  const [items, setItems] = useState<Record<string, StartupItem>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Éléments en cours de bascule → état demandé (affiché de façon optimiste). */
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<Flash>(null);
  const [confirm, setConfirm] = useState<{ item: StartupItem; enabled: boolean } | null>(null);

  const load = useCallback(async () => {
    setStatus((s) => (s === 'ready' ? 'ready' : 'loading'));
    setLoadError(null);
    try {
      const list = await call('startup:list');
      setItems(Object.fromEntries(list.map((i) => [i.id, i])));
      setOrder(sortOrder(list));
      setStatus('ready');
    } catch (err) {
      setLoadError(errorMessage(err));
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const list = useMemo(() => order.map((id) => items[id]).filter((i): i is StartupItem => !!i), [order, items]);
  const enabledCount = list.filter((i) => i.enabled).length;
  const highCount = list.filter((i) => i.enabled && i.impact === 'high').length;
  const disabledCount = list.length - enabledCount;
  const busyAny = Object.keys(pending).length > 0;

  const runToggle = async (item: StartupItem, enabled: boolean) => {
    setFlash(null);
    setPending((p) => ({ ...p, [item.id]: enabled }));
    try {
      const res = await call('startup:toggle', { id: item.id, enabled });
      setItems((m) => ({ ...m, [res.item.id]: res.item }));
      if (!res.applied) {
        setFlash({
          tone: 'bad',
          text:
            res.message ??
            (res.elevationDeclined
              ? 'L’autorisation administrateur n’a pas été accordée. Rien n’a été modifié.'
              : `${item.name} n’a pas pu être ${enabled ? 'réactivé' : 'désactivé'}.`),
        });
      } else {
        setFlash({
          tone: 'ok',
          text: res.message ?? `${res.item.name} ${res.item.enabled ? 'se lancera de nouveau au démarrage.' : 'ne se lancera plus au démarrage.'}`,
        });
      }
    } catch (err) {
      setFlash({ tone: 'bad', text: `${item.name} : ${errorMessage(err)}` });
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[item.id];
        return next;
      });
    }
  };

  const requestToggle = (item: StartupItem, enabled: boolean) => {
    if (item.readOnly || item.id in pending) return;
    if (item.requiresAdmin) setConfirm({ item, enabled });
    else void runToggle(item, enabled);
  };

  const title =
    status !== 'ready'
      ? 'Applications au démarrage'
      : enabledCount === 0
        ? 'Aucune application au démarrage'
        : `${formatCount(enabledCount)} application${enabledCount > 1 ? 's' : ''} au démarrage`;

  return (
    <div className="screen sp">
      <ScreenHead
        eyebrow="Vitesse — démarrage"
        title={title}
        right={
          <>
            <p className="small sp-note">{t.howNote}</p>
            <Button small icon="refresh" onClick={() => void load()} disabled={status === 'loading' || busyAny}>
              Actualiser
            </Button>
          </>
        }
      />

      {status === 'loading' && (
        <div className="panel sp-fill sp-center">
          <Spinner />
          <span className="mono">Lecture des éléments de démarrage…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="panel sp-fill">
          <EmptyState icon="warn" title="Impossible de lire les éléments de démarrage">
            <p className="small">{loadError}</p>
            <Button small icon="refresh" onClick={() => void load()} style={{ marginTop: 14 }}>
              Réessayer
            </Button>
          </EmptyState>
        </div>
      )}

      {status === 'ready' && (
        <>
          <div className="panel sp-stats" role="group" aria-label="Résumé">
            <Stat label="Activées" value={enabledCount} />
            <Stat label="Impact élevé" value={highCount} tone={highCount > 0 ? 'bad' : undefined} />
            <Stat label="Désactivées" value={disabledCount} />
            <Stat label="Au total" value={list.length} />
          </div>

          <div className="sp-flash" aria-live="polite">
            {flash && (
              <p className={`notice sp-flash-${flash.tone}`}>
                <Icon name={flash.tone === 'ok' ? 'check' : 'warn'} size={16} />
                <span>{flash.text}</span>
                <button type="button" className="sp-flash-x" aria-label="Fermer le message" onClick={() => setFlash(null)}>
                  <Icon name="close" size={14} />
                </button>
              </p>
            )}
            {loadError && (
              <p className="notice sp-flash-bad">
                <Icon name="warn" size={16} />
                <span>Actualisation impossible : {loadError}</span>
              </p>
            )}
          </div>

          {list.length === 0 ? (
            <div className="panel sp-fill">
              <EmptyState icon="speed" title="Rien ne se lance au démarrage">
                Aucune application n’est inscrite au démarrage de votre session.
              </EmptyState>
            </div>
          ) : (
            <div className="panel panel-scroll sp-fill sp-list" role="list" aria-label="Applications au démarrage">
              {list.map((item) => {
                const isPending = item.id in pending;
                const shown = isPending ? pending[item.id]! : item.enabled;
                return (
                  <StartupRow
                    key={item.id}
                    item={item}
                    on={shown}
                    busy={isPending}
                    adminTitle={t.adminTitle}
                    adminScope={t.adminScope}
                    readOnlyTitle={t.readOnlyTitle}
                    onToggle={(v) => requestToggle(item, v)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={t.dlgTitle}
        confirmLabel="Continuer"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) void runToggle(c.item, c.enabled);
        }}
      >
        {confirm && <p style={{ margin: 0 }}>{t.dlgBody(confirm.item.name, confirm.enabled)}</p>}
      </ConfirmDialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <div className="sp-stat">
      <span className="mono">{label}</span>
      <span className={tone ? `sp-stat-v ${tone}` : 'sp-stat-v'}>{formatCount(value)}</span>
    </div>
  );
}

function StartupRow({
  item,
  on,
  busy,
  adminTitle,
  adminScope,
  readOnlyTitle,
  onToggle,
}: {
  item: StartupItem;
  on: boolean;
  busy: boolean;
  adminTitle: string;
  adminScope: string;
  readOnlyTitle: string;
  onToggle: (v: boolean) => void;
}) {
  const impact = IMPACT[item.impact];
  const label = `${item.name} au démarrage`;
  return (
    <div className={on ? 'row sp-row' : 'row sp-row off'} role="listitem">
      <AppTile name={item.name} iconDataUrl={item.iconDataUrl} />
      <div className="row-text">
        <div className="sp-line">
          <span className="row-title">{item.name}</span>
          {item.publisher && <span className="sp-pub">{item.publisher}</span>}
        </div>
        <span className="row-meta sp-cmd" title={item.command}>
          {item.command}
        </span>
        <span className="sp-loc mono">{LOCATION[item.location]}</span>
      </div>
      <div className="sp-chips">
        {item.requiresAdmin && (
          <span title={adminTitle}>
            <Badge>{adminScope}</Badge>
          </span>
        )}
        <Badge tone={impact.tone}>{impact.label}</Badge>
      </div>
      <div className="sp-sw" title={item.readOnly ? readOnlyTitle : busy ? 'Application en cours…' : undefined}>
        {item.readOnly ? (
          <span className="sp-ro">
            <Icon name="lock" size={14} />
            Lecture seule
          </span>
        ) : busy ? (
          <span className="sp-ro">
            <Spinner />
          </span>
        ) : null}
        <Toggle on={on} onChange={onToggle} label={label} disabled={item.readOnly} busy={busy} />
      </div>
    </div>
  );
}
