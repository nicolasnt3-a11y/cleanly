/** Onglet « Carte d'espace » : bulles physiques + fil d'Ariane + panneau de détail. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpaceLevel, SpaceNode } from '../../../../shared/types';
import { call, errorMessage } from '../../api';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/icons';
import { Button, ProgressBar } from '../../components/ui';
import { formatBytes, formatCount, plural } from '../../lib/format';
import { useReducedMotion } from '../../lib/motion';
import { useStore } from '../../state/createStore';
import { appStore, progressStore } from '../../state/stores';
import { BubbleStage } from './BubbleStage';
import { filesStore, rootName, rootOfKey } from './filesState';
import { RootPicker } from './RootPicker';

const OPEN_MIN_MS = 320;

export function SpaceMap() {
  const reduced = useReducedMotion();
  const { rootKey } = useStore(filesStore);
  const { drives } = useStore(appStore);
  const { last: progress } = useStore(progressStore);

  const [level, setLevel] = useState<SpaceLevel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spawn, setSpawn] = useState<{ x: number; y: number } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<SpaceNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (nodeId: string | null, opts: { spawn?: { x: number; y: number } | null; openingId?: string } = {}) => {
      const my = ++seq.current;
      setLoading(true);
      setError(null);
      if (opts.openingId) setOpeningId(opts.openingId);
      const started = performance.now();
      try {
        const next = await call('space:level', rootOfKey(rootKey), nodeId);
        // Laisse le temps à la transition d'ouverture de se jouer.
        const wait = opts.openingId && !reduced ? OPEN_MIN_MS - (performance.now() - started) : 0;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (my !== seq.current) return;
        setSpawn(opts.spawn ?? null);
        setLevel(next);
        setSelectedId(null);
      } catch (err) {
        if (my !== seq.current) return;
        setError(errorMessage(err));
      } finally {
        if (my === seq.current) {
          setLoading(false);
          setOpeningId(null);
        }
      }
    },
    [rootKey, reduced],
  );

  // Nouvelle racine : on repart du sommet.
  useEffect(() => {
    setLevel(null);
    setNotice(null);
    void load(null);
    return () => {
      seq.current++;
    };
  }, [load]);

  const currentNodeId = level && level.crumbs.length > 1 ? level.node.id : null;
  const selected = level?.children.find((c) => c.id === selectedId) ?? null;
  const detail = selected ?? level?.node ?? null;
  const isRoot = !!level && detail === level.node && level.crumbs.length <= 1;

  const openNode = (node: SpaceNode, at?: { x: number; y: number }) => {
    if (!node.hasChildren || loading) return;
    setNotice(null);
    void load(node.id, { spawn: at ?? null, openingId: node.id });
  };

  const goCrumb = (index: number) => {
    if (!level || loading || index >= level.crumbs.length - 1) return;
    setNotice(null);
    void load(index === 0 ? null : level.crumbs[index]!.id);
  };

  const cancelWalk = () => {
    void call('scan:cancel');
  };

  const reveal = async (node: SpaceNode) => {
    if (!level) return;
    try {
      const r = await call('app:reveal-item', level.mapId, node.id);
      if (!r.ok) setNotice({ tone: 'bad', text: r.error });
    } catch (err) {
      setNotice({ tone: 'bad', text: errorMessage(err) });
    }
  };

  const doTrash = async () => {
    if (!level || !confirm) return;
    const node = confirm;
    setBusy(true);
    try {
      const r = await call('files:trash', { scanId: level.mapId, itemIds: [node.id] });
      setConfirm(null);
      if (r.failed.length > 0) {
        setNotice({ tone: 'bad', text: r.failed[0]!.reason || 'Impossible de déplacer cet élément.' });
        return;
      }
      setNotice({ tone: 'ok', text: `« ${node.name} » est dans la Corbeille — ${formatBytes(r.freedBytes)} libérés.` });
      if (node.id === level.node.id) {
        const parent = level.crumbs[level.crumbs.length - 2];
        await load(level.crumbs.length > 2 && parent ? parent.id : null);
      } else {
        await load(currentNodeId);
      }
    } catch (err) {
      setConfirm(null);
      setNotice({ tone: 'bad', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const walking = loading && !level;
  const walkProgress = progress?.task === 'space-map' && progress.phase !== 'done' ? progress : null;
  const total = level?.children.reduce((a, c) => a + c.sizeBytes, 0) ?? 0;

  return (
    <div className="fs-map">
      <div className="fs-toolbar">
        <RootPicker disabled={loading && !level} />
        {level && (
          <nav className="fs-crumbs" aria-label="Fil d'Ariane">
            {level.crumbs.map((c, i) => {
              const lastCrumb = i === level.crumbs.length - 1;
              return (
                <span key={c.id} className="fs-crumb">
                  {i > 0 && <Icon name="chevron-right" size={14} />}
                  {lastCrumb ? (
                    <span aria-current="location">{i === 0 ? rootName(rootKey, drives) : c.name}</span>
                  ) : (
                    <button type="button" onClick={() => goCrumb(i)} disabled={loading}>
                      {i === 0 ? rootName(rootKey, drives) : c.name}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
        )}
      </div>

      <div className="fs-map-body">
        <div className="fs-stage-wrap panel">
          {level && (
            <BubbleStage
              nodes={level.children}
              levelKey={`${level.mapId}:${level.node.id}`}
              selectedId={selectedId}
              reduced={reduced}
              spawn={spawn}
              openingId={openingId}
              onActivate={(n, at) => openNode(n, at)}
              onSelect={(n) => setSelectedId((s) => (s === n.id ? null : n.id))}
            />
          )}

          {level && level.children.length === 0 && !loading && (
            <div className="fs-stage-empty small">Ce dossier est vide ou son contenu n'est pas accessible.</div>
          )}

          {walking && (
            <div className="fs-walk" role="status" aria-live="polite">
              <div className="fs-walk-orb" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <div className="h3">Mesure de l'espace…</div>
              <p className="small">
                Le premier parcours de « {rootName(rootKey, drives)} » peut prendre un moment. Les visites suivantes seront instantanées.
              </p>
              <div className="fs-walk-progress">
                <ProgressBar fraction={walkProgress?.fraction ?? null} />
                <div className="fs-walk-meta">
                  <span className="mono">{walkProgress ? `${formatCount(walkProgress.itemsVisited)} éléments` : 'Préparation'}</span>
                  <span className="mono">{walkProgress && walkProgress.bytesFound > 0 ? formatBytes(walkProgress.bytesFound) : ''}</span>
                </div>
                {walkProgress?.currentPath && <div className="fs-walk-path row-meta">{walkProgress.currentPath}</div>}
              </div>
              <Button small icon="stop" onClick={cancelWalk}>
                Arrêter
              </Button>
            </div>
          )}

          {!walking && error && !level && (
            <div className="fs-walk">
              <Icon name="warn" size={28} />
              <p className="small">{error}</p>
              <Button small icon="refresh" onClick={() => void load(null)}>
                Réessayer
              </Button>
            </div>
          )}

          {level && (
            <div className="fs-stage-foot">
              <span className="mono">
                {plural(level.children.length, 'élément')} · {formatBytes(total)}
              </span>
              {loading && <span className="spinner" aria-label="Chargement" />}
              {!reduced && level.children.length > 0 && <span className="mono fs-hint">Glissez et lancez les bulles · clic pour ouvrir</span>}
            </div>
          )}
        </div>

        <aside className="fs-side panel" aria-label="Détail">
          {detail && level ? (
            <SideDetail
              node={detail}
              level={level}
              isCurrent={detail === level.node}
              isRoot={isRoot}
              loading={loading}
              onOpen={() => openNode(detail)}
              onReveal={() => void reveal(detail)}
              onTrash={() => setConfirm(detail)}
              onPick={(n) => setSelectedId(n.id)}
              onClear={() => setSelectedId(null)}
            />
          ) : (
            <div className="fs-side-empty small">{walking ? 'Parcours en cours…' : error ? 'Carte indisponible.' : ''}</div>
          )}
          {notice && (
            <p className={`notice fs-notice ${notice.tone}`} role="status">
              {notice.text}
            </p>
          )}
          {error && level && (
            <p className="notice fs-notice bad" role="alert">
              {error}
            </p>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm ? `Mettre « ${confirm.name} » à la corbeille ?` : ''}
        confirmLabel="Mettre à la corbeille"
        danger
        busy={busy}
        onConfirm={() => void doTrash()}
        onCancel={() => setConfirm(null)}
      >
        {confirm && (
          <>
            <p style={{ margin: 0 }}>
              {confirm.isDirectory
                ? `Le dossier et tout son contenu (${plural(confirm.fileCount, 'fichier')}, ${formatBytes(confirm.sizeBytes)}) seront déplacés dans la Corbeille.`
                : `Ce fichier (${formatBytes(confirm.sizeBytes)}) sera déplacé dans la Corbeille.`}{' '}
              Vous pourrez le restaurer tant qu'elle n'est pas vidée.
            </p>
            <p className="row-meta" style={{ whiteSpace: 'normal', wordBreak: 'break-all' }}>
              {confirm.path}
            </p>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

function SideDetail({
  node,
  level,
  isCurrent,
  isRoot,
  loading,
  onOpen,
  onReveal,
  onTrash,
  onPick,
  onClear,
}: {
  node: SpaceNode;
  level: SpaceLevel;
  isCurrent: boolean;
  isRoot: boolean;
  loading: boolean;
  onOpen: () => void;
  onReveal: () => void;
  onTrash: () => void;
  onPick: (n: SpaceNode) => void;
  onClear: () => void;
}) {
  const share = !isCurrent && level.node.sizeBytes > 0 ? node.sizeBytes / level.node.sizeBytes : null;
  const contents = isCurrent ? level.children.slice(0, 8) : [];
  return (
    <div className="fs-detail">
      <div className="fs-detail-head">
        <p className="eyebrow">{isCurrent ? 'Dossier affiché' : node.isDirectory ? 'Dossier' : 'Fichier'}</p>
        {!isCurrent && (
          <button type="button" className="icon-btn fs-detail-close" aria-label="Revenir au dossier affiché" title="Revenir au dossier affiché" onClick={onClear}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <h3 className="h3 fs-detail-name" title={node.name}>
        {node.name}
      </h3>
      <p className="row-meta fs-detail-path" title={node.path}>
        {node.path}
      </p>
      <div className="fs-detail-size">
        <span className="fs-detail-num">{formatBytes(node.sizeBytes)}</span>
        {share !== null && <span className="mono">{Math.max(0.1, share * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % du dossier</span>}
      </div>
      <dl className="fs-detail-facts">
        <div>
          <dt className="mono">Fichiers</dt>
          <dd>{node.isDirectory ? `≈ ${formatCount(node.fileCount)}` : '1'}</dd>
        </div>
        {isCurrent && (
          <div>
            <dt className="mono">Ignorés</dt>
            <dd>{formatCount(level.skippedCount)}</dd>
          </div>
        )}
      </dl>
      {isCurrent && level.partial && <p className="notice fs-notice warn">Parcours partiel : certaines tailles sont sous-estimées.</p>}

      <div className="fs-detail-actions">
        {!isCurrent && node.hasChildren && (
          <Button small icon="chevron-right" onClick={onOpen} disabled={loading}>
            Ouvrir
          </Button>
        )}
        <Button small icon="external" onClick={onReveal}>
          Afficher dans le dossier
        </Button>
        {!isRoot && (
          <Button small variant="danger" icon="trash" onClick={onTrash} disabled={loading}>
            Mettre à la corbeille
          </Button>
        )}
      </div>

      {contents.length > 0 && (
        <div className="fs-detail-list">
          <p className="eyebrow">Les plus gros éléments</p>
          <ul>
            {contents.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onPick(c)}>
                  <Icon name={c.isDirectory ? 'folder' : 'file'} size={16} />
                  <span className="fs-detail-list-name">{c.name}</span>
                  <span className="fs-detail-list-size">{formatBytes(c.sizeBytes)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
