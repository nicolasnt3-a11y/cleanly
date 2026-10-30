/** Onglet « Volumineux » : fichiers au-delà du seuil des paramètres, triables, à afficher ou mettre à la corbeille. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiReviewItem } from '../../../../shared/types';
import { call, errorMessage } from '../../api';
import { AiAssistant } from '../../components/AiAssistant';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/icons';
import { Button, CheckMark, EmptyState, IconButton, ProgressBar, Segmented, VerdictChip } from '../../components/ui';
import { formatBytes, formatCount, formatDate, formatRelative, plural } from '../../lib/format';
import { useStore } from '../../state/createStore';
import { appStore, progressStore, settingsStore, verdictStore } from '../../state/stores';
import { KIND_ICON, KIND_LABEL, filesStore, rootName, rootOfKey } from './filesState';
import { RootPicker } from './RootPicker';

type SortKey = 'size' | 'date';

export function LargeFiles() {
  const { rootKey, large } = useStore(filesStore);
  const { settings } = useStore(settingsStore);
  const { drives } = useStore(appStore);
  const { verdicts } = useStore(verdictStore);
  const { last: progress } = useStore(progressStore);

  const minMb = settings?.largeFileMinMb ?? 100;
  const minBytes = minMb * 1_000_000;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('size');
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const seq = useRef(0);

  const result = large && large.key === rootKey && large.minBytes === minBytes ? large.result : null;

  const run = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    setSelected({});
    try {
      const r = await call('files:large', { root: rootOfKey(rootKey), minBytes, limit: 200 });
      if (my !== seq.current) return;
      filesStore.set({ large: { key: rootKey, minBytes, result: r } });
    } catch (err) {
      if (my === seq.current) setError(errorMessage(err));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [rootKey, minBytes]);

  // Lancement automatique quand rien n'est en cache pour cette racine / ce seuil.
  useEffect(() => {
    if (!settings) return;
    if (!result) void run();
    return () => {
      seq.current++;
      setLoading(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, settings === null]);

  const items = useMemo(() => {
    const list = [...(result?.items ?? [])];
    list.sort((a, b) => (sort === 'size' ? b.sizeBytes - a.sizeBytes : a.modifiedAt - b.modifiedAt));
    return list;
  }, [result, sort]);

  const selItems = items.filter((i) => selected[i.id]);
  const selBytes = selItems.reduce((a, i) => a + i.sizeBytes, 0);
  const allOn = items.length > 0 && selItems.length === items.length;

  const aiItems: AiReviewItem[] = useMemo(
    () =>
      (selItems.length > 0 ? selItems : items.slice(0, 40)).map((i) => ({
        id: i.id,
        path: i.path,
        name: i.name,
        sizeBytes: i.sizeBytes,
        modifiedAt: i.modifiedAt,
        context: 'large-file' as const,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, selected],
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = { ...s };
      if (n[id]) delete n[id];
      else n[id] = true;
      return n;
    });

  const toggleAll = () => setSelected(allOn ? {} : Object.fromEntries(items.map((i) => [i.id, true as const])));

  const reveal = async (id: string) => {
    if (!result) return;
    try {
      const r = await call('app:reveal-item', result.scanId, id);
      if (!r.ok) setNotice({ tone: 'bad', text: r.error });
    } catch (err) {
      setNotice({ tone: 'bad', text: errorMessage(err) });
    }
  };

  const doTrash = async () => {
    if (!result || selItems.length === 0) return;
    setBusy(true);
    try {
      const r = await call('files:trash', { scanId: result.scanId, itemIds: selItems.map((i) => i.id) });
      const failed = new Set(r.failed.map((f) => f.itemId));
      const gone = new Set(selItems.filter((i) => !failed.has(i.id)).map((i) => i.id));
      filesStore.set((s) =>
        s.large ? { large: { ...s.large, result: { ...s.large.result, items: s.large.result.items.filter((i) => !gone.has(i.id)) } } } : {},
      );
      setSelected(Object.fromEntries([...failed].map((id) => [id, true as const])));
      setNotice(
        r.failed.length > 0
          ? { tone: 'bad', text: `${plural(r.trashedCount, 'fichier déplacé', 'fichiers déplacés')} · ${plural(r.failed.length, 'échec')} : ${r.failed[0]!.reason}` }
          : { tone: 'ok', text: `${plural(r.trashedCount, 'fichier déplacé', 'fichiers déplacés')} dans la Corbeille — ${formatBytes(r.freedBytes)} libérés.` },
      );
    } catch (err) {
      setNotice({ tone: 'bad', text: errorMessage(err) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const scanning = progress?.task === 'large-files' && progress.phase !== 'done' ? progress : null;

  return (
    <div className="fs-tab">
      <div className="fs-toolbar">
        <RootPicker disabled={loading} />
        <div className="fs-toolbar-r">
          <span className="mono">Seuil {formatCount(minMb)} Mo</span>
          <Segmented<SortKey>
            label="Trier par"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'size', label: 'Taille' },
              { value: 'date', label: 'Plus anciens' },
            ]}
          />
          <IconButton icon="refresh" label="Relancer la recherche" onClick={() => void run()} disabled={loading} />
        </div>
      </div>

      <div className="fs-split">
        <div className="panel fs-list-panel">
          {loading ? (
            <div className="fs-loading" role="status">
              <div className="h3">Recherche des fichiers volumineux…</div>
              <p className="small">
                {rootName(rootKey, drives)} · fichiers de plus de {formatCount(minMb)} Mo
              </p>
              <div className="fs-walk-progress">
                <ProgressBar fraction={scanning?.fraction ?? null} />
                <div className="fs-walk-meta">
                  <span className="mono">{scanning ? `${formatCount(scanning.itemsVisited)} éléments vus` : 'Préparation'}</span>
                </div>
                {scanning?.currentPath && <div className="row-meta">{scanning.currentPath}</div>}
              </div>
            </div>
          ) : error ? (
            <EmptyState icon="warn" title="Recherche impossible">
              {error}
              <div style={{ marginTop: 14 }}>
                <Button small icon="refresh" onClick={() => void run()}>
                  Réessayer
                </Button>
              </div>
            </EmptyState>
          ) : items.length === 0 ? (
            <EmptyState icon="large" title="Aucun fichier volumineux">
              Aucun fichier de plus de {formatCount(minMb)} Mo trouvé ici. Le seuil se règle dans les paramètres.
            </EmptyState>
          ) : (
            <>
              <div className="fs-list-head">
                <button type="button" className="fs-chk-btn" onClick={toggleAll} aria-label={allOn ? 'Tout désélectionner' : 'Tout sélectionner'}>
                  <CheckMark on={allOn} mixed={!allOn && selItems.length > 0} />
                </button>
                <span className="mono" style={{ flex: 1 }}>
                  {plural(items.length, 'fichier')}
                  {result && result.skippedCount > 0 ? ` · ${formatCount(result.skippedCount)} inaccessibles` : ''}
                </span>
                <span className="mono fs-col-date">Modifié</span>
                <span className="mono row-size">Taille</span>
                <span className="fs-col-act" />
              </div>
              <ul className="panel-scroll fs-list" aria-label="Fichiers volumineux">
                {items.map((it) => {
                  const v = verdicts[it.id];
                  const on = !!selected[it.id];
                  return (
                    <li key={it.id} className={on ? 'row fs-row is-on' : 'row fs-row'}>
                      <button type="button" className="fs-row-main" onClick={() => toggle(it.id)} aria-pressed={on}>
                        <CheckMark on={on} />
                        <span className="fs-kind" title={KIND_LABEL[it.kind]}>
                          <Icon name={KIND_ICON[it.kind]} size={18} />
                        </span>
                        <span className="row-text">
                          <span className="row-title">{it.name}</span>
                          <span className="row-meta" title={it.path}>
                            {it.path}
                          </span>
                        </span>
                      </button>
                      {v && <VerdictChip verdict={v.verdict} title={v.reason} />}
                      <span className="fs-col-date small" title={formatDate(it.modifiedAt)}>
                        {formatRelative(it.modifiedAt)}
                      </span>
                      <span className="row-size">{formatBytes(it.sizeBytes)}</span>
                      <span className="fs-col-act">
                        <IconButton icon="external" label={`Afficher ${it.name} dans le dossier`} onClick={() => void reveal(it.id)} />
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="fs-list-foot">
                <span className="mono">
                  Sélection <b className="fs-foot-num">{formatBytes(selBytes)}</b>
                  {selItems.length > 0 && ` · ${plural(selItems.length, 'fichier')}`}
                </span>
                <Button variant="danger" small icon="trash" disabled={selItems.length === 0 || busy} onClick={() => setConfirm(true)}>
                  Mettre à la corbeille
                </Button>
              </div>
            </>
          )}
        </div>

        <aside className="fs-side-col">
          {notice && (
            <p className={`notice fs-notice ${notice.tone}`} role="status">
              {notice.text}
            </p>
          )}
          {items.length > 0 && !loading && <AiAssistant items={aiItems} compact />}
          <p className="small fs-side-note">
            Les fichiers sont toujours envoyés à la Corbeille : vous pouvez les restaurer tant qu'elle n'est pas vidée.
          </p>
        </aside>
      </div>

      <ConfirmDialog
        open={confirm}
        title={`Mettre ${plural(selItems.length, 'fichier')} à la corbeille ?`}
        confirmLabel="Mettre à la corbeille"
        danger
        busy={busy}
        onConfirm={() => void doTrash()}
        onCancel={() => setConfirm(false)}
      >
        <p style={{ margin: '0 0 8px' }}>
          {formatBytes(selBytes)} seront déplacés dans la Corbeille. Rien n'est supprimé définitivement.
        </p>
        <ul className="fs-dlg-list">
          {selItems.slice(0, 5).map((i) => (
            <li key={i.id}>
              <span>{i.name}</span>
              <span className="mono">{formatBytes(i.sizeBytes)}</span>
            </li>
          ))}
          {selItems.length > 5 && <li className="mono">et {formatCount(selItems.length - 5)} autres</li>}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
