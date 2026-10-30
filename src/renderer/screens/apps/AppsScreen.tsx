/**
 * Applications installées. La désinstallation passe TOUJOURS par la voie officielle :
 *  - Windows : lancement du désinstallateur de l'éditeur (qui peut afficher sa propre interface) ;
 *  - macOS : le .app est déplacé dans la Corbeille (restaurable).
 * Rien n'est forcé ; la liste est relue après l'opération.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { InstalledApp, Platform } from '../../../../shared/types';
import { call, errorMessage } from '../../api';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/stores';
import { AppTile, Badge, Button, EmptyState, ScreenHead, Segmented, Spinner } from '../../components/ui';
import { Icon } from '../../components/icons';
import { ConfirmDialog } from '../../components/Dialog';
import { formatBytes, formatCount, formatDate, formatRelative } from '../../lib/format';
import './apps.css';

type SortKey = 'size' | 'name' | 'used';
const UNUSED_MS = 180 * 86_400_000;

function copy(platform: Platform | undefined) {
  const mac = platform === 'darwin';
  return {
    mac,
    action: mac ? 'Mettre à la corbeille' : 'Désinstaller',
    busy: mac ? 'Déplacement…' : 'Désinstallation…',
    note: mac
      ? 'Cleanly déplace l’application dans la Corbeille, comme le Finder : rien n’est supprimé définitivement et vous pouvez la restaurer.'
      : 'Cleanly lance le désinstallateur officiel de chaque application, comme Paramètres › Applications. Rien n’est forcé ni supprimé en arrière-plan.',
    selfTip: 'Cleanly ne peut pas se désinstaller lui-même.',
    cannotTip: mac
      ? 'Application système ou protégée : macOS la gère.'
      : 'Composant système ou sans désinstallateur : Windows le gère.',
    dlgTitle: (name: string) => (mac ? `Mettre ${name} à la corbeille ?` : `Désinstaller ${name} ?`),
    dlgConfirm: mac ? 'Mettre à la corbeille' : 'Lancer le désinstallateur',
  };
}

function sortApps(list: InstalledApp[], key: SortKey): InstalledApp[] {
  const byName = (a: InstalledApp, b: InstalledApp) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  const out = [...list];
  if (key === 'name') out.sort(byName);
  else if (key === 'size') out.sort((a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1) || byName(a, b));
  else
    out.sort((a, b) => {
      // Les moins récemment utilisées d'abord ; dates inconnues à la fin.
      const av = a.lastUsedAt ?? Number.POSITIVE_INFINITY;
      const bv = b.lastUsedAt ?? Number.POSITIVE_INFINITY;
      return av - bv || byName(a, b);
    });
  return out;
}

type Flash = { tone: 'ok' | 'info' | 'bad'; text: string } | null;

export function AppsScreen() {
  const { info } = useStore(appStore);
  const t = copy(info?.platform);

  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [sort, setSort] = useState<SortKey>('size');
  const [confirm, setConfirm] = useState<InstalledApp | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setStatus('loading');
    else setRefreshing(true);
    setLoadError(null);
    try {
      setApps(await call('apps:list'));
      setStatus('ready');
    } catch (err) {
      setLoadError(errorMessage(err));
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const totalBytes = apps.reduce((s, a) => s + (a.sizeBytes ?? 0), 0);
  const now = Date.now();
  const unusedCount = apps.filter((a) => a.lastUsedAt && now - a.lastUsedAt >= UNUSED_MS).length;

  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLocaleLowerCase('fr');
    const filtered = q
      ? apps.filter((a) => `${a.name} ${a.publisher ?? ''}`.toLocaleLowerCase('fr').includes(q))
      : apps;
    return sortApps(filtered, sort);
  }, [apps, deferredQuery, sort]);

  const uninstall = async (app: InstalledApp) => {
    setConfirm(null);
    setFlash(null);
    setBusyId(app.id);
    try {
      const res = await call('apps:uninstall', app.id);
      if (res.removed) {
        setFlash({ tone: 'ok', text: res.message });
        setApps((list) => list.filter((a) => a.id !== app.id));
        void load();
      } else if (res.started) {
        setFlash({ tone: 'info', text: res.message });
      } else {
        setFlash({ tone: 'bad', text: res.message });
      }
    } catch (err) {
      setFlash({ tone: 'bad', text: `${app.name} : ${errorMessage(err)}` });
    } finally {
      setBusyId(null);
    }
  };

  const title =
    status === 'ready' ? (
      <>
        {formatCount(apps.length)} application{apps.length > 1 ? 's' : ''}
        <span className="ap-title-sep"> · </span>
        <span className="ap-title-size">{formatBytes(totalBytes)}</span>
      </>
    ) : (
      'Applications'
    );

  return (
    <div className="screen ap">
      <ScreenHead
        eyebrow="Applications — installées"
        title={title}
        right={
          <Button small icon="refresh" onClick={() => void load()} disabled={status === 'loading' || refreshing || !!busyId}>
            {refreshing ? 'Actualisation…' : 'Actualiser'}
          </Button>
        }
      />

      <p className="notice ap-note">
        <Icon name="info" size={16} />
        <span>{t.note}</span>
      </p>

      {status === 'loading' && (
        <div className="panel ap-fill ap-center">
          <Spinner />
          <span className="mono">Inventaire des applications…</span>
        </div>
      )}

      {status === 'error' && (
        <div className="panel ap-fill">
          <EmptyState icon="warn" title="Impossible de lister les applications">
            <p className="small">{loadError}</p>
            <Button small icon="refresh" onClick={() => void load(true)} style={{ marginTop: 14 }}>
              Réessayer
            </Button>
          </EmptyState>
        </div>
      )}

      {status === 'ready' && (
        <>
          <div className="ap-tools">
            <label className="ap-search">
              <svg className="ic" viewBox="0 0 24 24" width={16} height={16} aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M16 16l4 4" />
              </svg>
              <input
                className="input"
                type="search"
                placeholder="Rechercher une application ou un éditeur"
                aria-label="Rechercher une application"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {unusedCount > 0 && (
              <span className="mono ap-unused">
                {formatCount(unusedCount)} inutilisée{unusedCount > 1 ? 's' : ''} depuis 6 mois
              </span>
            )}
            <Segmented<SortKey>
              label="Trier par"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'size', label: 'Taille' },
                { value: 'name', label: 'Nom' },
                { value: 'used', label: 'Dernière utilisation' },
              ]}
            />
          </div>

          <div aria-live="polite" className="ap-flash">
            {flash && (
              <p className={`notice ap-flash-${flash.tone}`}>
                <Icon name={flash.tone === 'ok' ? 'check' : flash.tone === 'info' ? 'info' : 'warn'} size={16} />
                <span>{flash.text}</span>
                {flash.tone === 'info' && (
                  <Button small onClick={() => void load()} disabled={refreshing}>
                    Actualiser la liste
                  </Button>
                )}
                <button type="button" className="ap-flash-x" aria-label="Fermer le message" onClick={() => setFlash(null)}>
                  <Icon name="close" size={14} />
                </button>
              </p>
            )}
            {loadError && (
              <p className="notice ap-flash-bad">
                <Icon name="warn" size={16} />
                <span>Actualisation impossible : {loadError}</span>
              </p>
            )}
          </div>

          <div className="panel ap-fill ap-panel panel-scroll">
            <div className="ap-head mono" aria-hidden="true">
              <span className="ap-h-name">Application</span>
              <span className="ap-h-used">Dernière utilisation</span>
              <span className="ap-h-size">Taille</span>
              <span className="ap-h-act" />
            </div>
            {visible.length === 0 ? (
              <EmptyState icon="apps" title={apps.length === 0 ? 'Aucune application trouvée' : 'Aucun résultat'}>
                {apps.length === 0
                  ? 'Aucune application installée n’a pu être lue.'
                  : `Aucune application ne correspond à « ${query.trim()} ».`}
              </EmptyState>
            ) : (
              <ul className="ap-list" aria-label="Applications installées">
                {visible.map((app) => (
                  <AppRow
                    key={app.id}
                    app={app}
                    now={now}
                    busy={busyId === app.id}
                    lockAll={!!busyId}
                    t={t}
                    onUninstall={() => setConfirm(app)}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm ? t.dlgTitle(confirm.name) : ''}
        confirmLabel={t.dlgConfirm}
        danger={t.mac}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void uninstall(confirm)}
      >
        {confirm && <UninstallExplain app={confirm} mac={t.mac} />}
      </ConfirmDialog>
    </div>
  );
}

function UninstallExplain({ app, mac }: { app: InstalledApp; mac: boolean }) {
  if (mac) {
    return (
      <>
        <p className="ap-dlg-p">
          <strong>{app.name}</strong> sera déplacée dans la Corbeille. Vous pourrez la restaurer tant que la Corbeille n’est pas vidée.
        </p>
        <p className="ap-dlg-p">
          macOS peut demander votre mot de passe si l’application a été installée pour tous les utilisateurs. Ses réglages et
          documents restent en place.
        </p>
        {app.location && <p className="ap-dlg-path mono">{app.location}</p>}
      </>
    );
  }
  return (
    <>
      <p className="ap-dlg-p">
        Cleanly va lancer le désinstallateur fourni par <strong>{app.publisher ?? 'l’éditeur'}</strong>. Il peut afficher ses propres
        fenêtres et vous poser des questions : suivez ses étapes jusqu’au bout.
      </p>
      <p className="ap-dlg-p">
        Windows peut demander une autorisation administrateur. Cleanly ne force rien et ne supprime aucun fichier lui-même.
      </p>
      {app.location && <p className="ap-dlg-path mono">{app.location}</p>}
    </>
  );
}

function AppRow({
  app,
  now,
  busy,
  lockAll,
  t,
  onUninstall,
}: {
  app: InstalledApp;
  now: number;
  busy: boolean;
  lockAll: boolean;
  t: ReturnType<typeof copy>;
  onUninstall: () => void;
}) {
  const unused = !!app.lastUsedAt && now - app.lastUsedAt >= UNUSED_MS;
  const meta = [app.publisher, app.version && `v${app.version}`].filter(Boolean).join(' · ');
  const blocked = app.isSelf ? t.selfTip : !app.canUninstall ? t.cannotTip : null;
  return (
    <li className={busy ? 'row ap-row busy' : 'row ap-row'} aria-busy={busy || undefined}>
      <div className="ap-c-name">
        <AppTile name={app.name} iconDataUrl={app.iconDataUrl} />
        <div className="row-text">
          <span className="row-title" title={app.name}>
            {app.name}
            {app.isSelf && <Badge tone="accent">Cette app</Badge>}
          </span>
          <span className="row-meta" title={app.location}>
            {meta || '—'}
          </span>
        </div>
      </div>
      <div className="ap-c-used" title={app.lastUsedAt ? formatDate(app.lastUsedAt) : 'Information indisponible'}>
        {unused ? (
          <span className="ap-old">
            <span className="ap-used">{formatRelative(app.lastUsedAt, now)}</span>
            <Badge tone="warn">Inutilisée depuis 6 mois</Badge>
          </span>
        ) : (
          <span className={app.lastUsedAt ? 'ap-used' : 'ap-used none'}>{formatRelative(app.lastUsedAt, now)}</span>
        )}
      </div>
      <span className="row-size ap-c-size">{app.sizeBytes !== undefined ? formatBytes(app.sizeBytes) : '—'}</span>
      <div className="ap-c-act">
        {blocked ? (
          <span className="ap-tip" title={blocked} tabIndex={0} aria-label={`${t.action} indisponible : ${blocked}`}>
            <Button small disabled tabIndex={-1} aria-hidden="true">
              {t.action}
            </Button>
          </span>
        ) : (
          <Button small variant="danger" onClick={onUninstall} disabled={lockAll} aria-label={`${t.action} ${app.name}`}>
            {busy && <Spinner />}
            {busy ? t.busy : t.action}
          </Button>
        )}
      </div>
    </li>
  );
}
