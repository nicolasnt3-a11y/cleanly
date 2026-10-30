/**
 * Onglet « Doublons ». Règle de sécurité de l'interface : on ne peut JAMAIS sélectionner
 * tous les fichiers d'un groupe — le dernier exemplaire non coché est verrouillé.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DuplicateGroup, DuplicatesResult, ScanProgress } from '../../../../shared/types';
import { call, errorMessage } from '../../api';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/icons';
import { Badge, Button, Capsule, CheckMark, EmptyState, IconButton, ProgressBar, VerdictChip } from '../../components/ui';
import { formatBytes, formatCount, formatDate, plural } from '../../lib/format';
import { useStore } from '../../state/createStore';
import { appStore, progressStore, verdictStore } from '../../state/stores';
import { filesStore, rootName, rootOfKey } from './filesState';
import { RootPicker } from './RootPicker';

type Sel = Record<string, true>;

/** Sélection par défaut : tout sauf le premier (l'original suggéré, le plus ancien). */
function defaultSelection(groups: DuplicateGroup[]): Sel {
  const sel: Sel = {};
  for (const g of groups) for (const f of g.files.slice(1)) sel[f.id] = true;
  return sel;
}

/** Garantit qu'au moins un fichier par groupe reste non sélectionné. */
function sanitize(groups: DuplicateGroup[], sel: Sel): Sel {
  const out: Sel = { ...sel };
  for (const g of groups) {
    if (g.files.length > 0 && g.files.every((f) => out[f.id])) delete out[g.files[0]!.id];
  }
  return out;
}

const STAGES: Array<{ phase: ScanProgress['phase']; label: string; detail: string }> = [
  { phase: 'walking', label: 'Taille', detail: 'Seuls les fichiers de même taille peuvent être identiques.' },
  { phase: 'hashing-partial', label: 'Empreinte partielle', detail: 'Début et fin de chaque candidat, pour écarter vite les faux amis.' },
  { phase: 'hashing-full', label: 'Empreinte complète', detail: 'SHA-256 du contenu entier : identité certaine.' },
];

export function Duplicates() {
  const { rootKey, duplicates } = useStore(filesStore);
  const { drives } = useStore(appStore);
  const { verdicts } = useStore(verdictStore);
  const { last: progress } = useStore(progressStore);

  const result: DuplicatesResult | null = duplicates && duplicates.key === rootKey ? duplicates.result : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(() => (result ? defaultSelection(result.groups) : {}));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const seq = useRef(0);

  useEffect(
    () => () => {
      seq.current++;
    },
    [],
  );

  // Changement de racine : abandonner une recherche en cours.
  useEffect(() => {
    seq.current++;
    setLoading(false);
    setError(null);
    setNotice(null);
    const r = filesStore.get().duplicates;
    setSel(r && r.key === rootKey ? defaultSelection(r.result.groups) : {});
  }, [rootKey]);

  const run = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const r = await call('files:duplicates', { root: rootOfKey(rootKey) });
      if (my !== seq.current) return;
      filesStore.set({ duplicates: { key: rootKey, result: r } });
      setSel(defaultSelection(r.groups));
      setOpen(Object.fromEntries(r.groups.slice(0, 2).map((g) => [g.id, true])));
    } catch (err) {
      if (my === seq.current) setError(errorMessage(err));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [rootKey]);

  const cancel = () => {
    seq.current++;
    setLoading(false);
    void call('scan:cancel');
  };

  const groups = result?.groups ?? [];
  const safeSel = useMemo(() => sanitize(groups, sel), [groups, sel]);
  const selFiles = useMemo(() => groups.flatMap((g) => g.files.filter((f) => safeSel[f.id])), [groups, safeSel]);
  const selBytes = selFiles.reduce((a, f) => a + f.sizeBytes, 0);

  const toggle = (g: DuplicateGroup, id: string) => {
    setSel((s) => {
      const n = { ...s };
      if (n[id]) delete n[id];
      else {
        const others = g.files.filter((f) => f.id !== id);
        if (others.every((f) => n[f.id])) return s; // serait le dernier exemplaire
        n[id] = true;
      }
      return n;
    });
  };

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
    if (!result) return;
    // Revérification juste avant l'envoi : au moins un exemplaire conservé par groupe.
    const ids = groups.flatMap((g) => {
      const chosen = g.files.filter((f) => safeSel[f.id]);
      return chosen.length < g.files.length ? chosen.map((f) => f.id) : [];
    });
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const r = await call('files:trash', { scanId: result.scanId, itemIds: ids });
      const failed = new Set(r.failed.map((f) => f.itemId));
      const gone = new Set(ids.filter((id) => !failed.has(id)));
      const nextGroups = groups
        .map((g) => {
          const files = g.files.filter((f) => !gone.has(f.id));
          return { ...g, files, wastedBytes: g.sizeBytes * Math.max(0, files.length - 1) };
        })
        .filter((g) => g.files.length > 1);
      filesStore.set({
        duplicates: {
          key: rootKey,
          result: { ...result, groups: nextGroups, totalWastedBytes: nextGroups.reduce((a, g) => a + g.wastedBytes, 0) },
        },
      });
      setSel(Object.fromEntries([...failed].map((id) => [id, true as const])));
      setNotice(
        r.failed.length > 0
          ? { tone: 'bad', text: `${plural(r.trashedCount, 'fichier déplacé', 'fichiers déplacés')} · ${plural(r.failed.length, 'échec')} : ${r.failed[0]!.reason}` }
          : { tone: 'ok', text: `${plural(r.trashedCount, 'doublon déplacé', 'doublons déplacés')} dans la Corbeille — ${formatBytes(r.freedBytes)} libérés.` },
      );
    } catch (err) {
      setNotice({ tone: 'bad', text: errorMessage(err) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const live = progress?.task === 'duplicates' ? progress : null;
  const stageIndex = live ? STAGES.findIndex((s) => s.phase === live.phase) : -1;

  return (
    <div className="fs-tab">
      <div className="fs-toolbar">
        <RootPicker disabled={loading} />
        <div className="fs-toolbar-r">
          {result && !loading && (
            <Button small icon="refresh" onClick={() => void run()}>
              Relancer
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="panel fs-dup-run" role="status" aria-live="polite">
          <div className="h3">Recherche des doublons…</div>
          <p className="small">{rootName(rootKey, drives)} · fichiers de plus de 1 Mo</p>
          <ol className="fs-stages">
            {STAGES.map((s, i) => {
              const state = i < stageIndex ? 'done' : i === stageIndex ? 'active' : 'pending';
              return (
                <li key={s.phase} className={`fs-stage-step is-${state}`}>
                  <span className="fs-stage-dot" aria-hidden="true">
                    {state === 'done' ? <Icon name="check" size={14} /> : <span className="mono">{i + 1}</span>}
                  </span>
                  <div className="fs-stage-text">
                    <span className="fs-stage-label">{s.label}</span>
                    <span className="small">{s.detail}</span>
                    {state === 'active' && (
                      <div className="fs-stage-progress">
                        <ProgressBar fraction={live?.fraction ?? null} />
                        <span className="mono">{live && live.itemsVisited > 0 ? `${formatCount(live.itemsVisited)} candidats` : ''}</span>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {live?.currentPath && <p className="row-meta">{live.currentPath}</p>}
          <div>
            <Button small icon="stop" onClick={cancel}>
              Arrêter
            </Button>
          </div>
        </div>
      ) : !result ? (
        <div className="panel fs-dup-intro">
          {error ? (
            <EmptyState icon="warn" title="Recherche impossible">
              {error}
            </EmptyState>
          ) : (
            <EmptyState icon="duplicate" title="Trouver les fichiers en double">
              Cleanly compare d'abord les tailles, puis une empreinte partielle, puis l'empreinte complète du contenu. Seuls les fichiers
              strictement identiques sont proposés, et un exemplaire est toujours conservé.
            </EmptyState>
          )}
          <ol className="fs-stages is-compact" aria-label="Étapes">
            {STAGES.map((s, i) => (
              <li key={s.phase} className="fs-stage-step">
                <span className="fs-stage-dot" aria-hidden="true">
                  <span className="mono">{i + 1}</span>
                </span>
                <span className="fs-stage-label">{s.label}</span>
                {i < STAGES.length - 1 && <Icon name="chevron-right" size={14} />}
              </li>
            ))}
          </ol>
          <Capsule small onClick={() => void run()}>
            Rechercher les doublons
          </Capsule>
        </div>
      ) : (
        <div className="fs-split">
          <div className="panel fs-list-panel">
            {groups.length === 0 ? (
              <EmptyState icon="check" title="Aucun doublon">
                Aucun fichier identique de plus de 1 Mo dans cet emplacement.
              </EmptyState>
            ) : (
              <>
                <div className="fs-list-head">
                  <span className="mono" style={{ flex: 1 }}>
                    {plural(groups.length, 'groupe')} · {formatBytes(result.totalWastedBytes)} récupérables
                  </span>
                  <button
                    type="button"
                    className="fs-link"
                    onClick={() => setOpen(Object.fromEntries(groups.map((g) => [g.id, !groups.every((x) => open[x.id])])))}
                  >
                    {groups.every((g) => open[g.id]) ? 'Tout replier' : 'Tout déplier'}
                  </button>
                </div>
                <ul className="panel-scroll fs-list" aria-label="Groupes de doublons">
                  {groups.map((g) => (
                    <DupGroup
                      key={g.id}
                      group={g}
                      open={!!open[g.id]}
                      sel={safeSel}
                      verdicts={verdicts}
                      onToggleOpen={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
                      onToggle={(id) => toggle(g, id)}
                      onReveal={(id) => void reveal(id)}
                    />
                  ))}
                </ul>
                <div className="fs-list-foot">
                  <span className="mono">
                    Sélection <b className="fs-foot-num">{formatBytes(selBytes)}</b>
                    {selFiles.length > 0 && ` · ${plural(selFiles.length, 'fichier')}`}
                  </span>
                  <Button variant="danger" small icon="trash" disabled={selFiles.length === 0 || busy} onClick={() => setConfirm(true)}>
                    Mettre la sélection à la corbeille
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
            <div className="panel fs-stats">
              <p className="eyebrow">Analyse</p>
              <dl>
                <div>
                  <dt>Même taille</dt>
                  <dd className="mono">{formatCount(result.stats.candidatesBySize)}</dd>
                </div>
                <div>
                  <dt>Même empreinte partielle</dt>
                  <dd className="mono">{formatCount(result.stats.candidatesByPartialHash)}</dd>
                </div>
                <div>
                  <dt>Identiques (SHA-256)</dt>
                  <dd className="mono">{formatCount(result.stats.confirmed)}</dd>
                </div>
                {result.skippedCount > 0 && (
                  <div>
                    <dt>Inaccessibles</dt>
                    <dd className="mono">{formatCount(result.skippedCount)}</dd>
                  </div>
                )}
              </dl>
            </div>
            <p className="small fs-side-note">
              Le plus ancien exemplaire de chaque groupe est marqué « Original » et conservé par défaut. Il reste toujours au moins un
              exemplaire : la dernière case d'un groupe ne peut pas être cochée.
            </p>
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        title={`Mettre ${plural(selFiles.length, 'doublon')} à la corbeille ?`}
        confirmLabel="Mettre à la corbeille"
        danger
        busy={busy}
        onConfirm={() => void doTrash()}
        onCancel={() => setConfirm(false)}
      >
        <p style={{ margin: 0 }}>
          {formatBytes(selBytes)} seront déplacés dans la Corbeille. Au moins un exemplaire de chaque fichier est conservé, et vous pourrez
          restaurer les autres tant que la Corbeille n'est pas vidée.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function DupGroup({
  group,
  open,
  sel,
  verdicts,
  onToggleOpen,
  onToggle,
  onReveal,
}: {
  group: DuplicateGroup;
  open: boolean;
  sel: Sel;
  verdicts: ReturnType<typeof verdictStore.get>['verdicts'];
  onToggleOpen: () => void;
  onToggle: (id: string) => void;
  onReveal: (id: string) => void;
}) {
  const unselected = group.files.filter((f) => !sel[f.id]);
  const selCount = group.files.length - unselected.length;
  const panelId = `dup-${group.id}`;
  return (
    <li className={open ? 'fs-group is-open' : 'fs-group'}>
      <button type="button" className="row row-btn fs-group-head" aria-expanded={open} aria-controls={panelId} onClick={onToggleOpen}>
        <span className="fs-chev" aria-hidden="true">
          <Icon name="chevron-right" size={16} />
        </span>
        <span className="row-text">
          <span className="row-title">{group.files[0]?.name}</span>
          <span className="row-meta">
            {plural(group.files.length, 'exemplaire')} · {formatBytes(group.sizeBytes)} chacun
            {selCount > 0 ? ` · ${selCount} sélectionné${selCount > 1 ? 's' : ''}` : ''}
          </span>
        </span>
        <span className="mono fs-wasted">perdu</span>
        <span className="row-size">{formatBytes(group.wastedBytes)}</span>
      </button>
      {open && (
        <ul id={panelId} className="fs-group-files">
          {group.files.map((f, i) => {
            const on = !!sel[f.id];
            const locked = !on && unselected.length === 1;
            const v = verdicts[f.id];
            return (
              <li key={f.id} className={on ? 'fs-file is-on' : 'fs-file'}>
                <button
                  type="button"
                  className="fs-row-main"
                  onClick={() => onToggle(f.id)}
                  disabled={locked}
                  aria-pressed={on}
                  title={locked ? 'Au moins un exemplaire est toujours conservé.' : undefined}
                >
                  <CheckMark on={on} />
                  <span className="row-text">
                    <span className="row-meta fs-file-path" title={f.path}>
                      {f.path}
                    </span>
                    <span className="small">Modifié le {formatDate(f.modifiedAt)}</span>
                  </span>
                </button>
                {i === 0 && <Badge tone="accent">Original</Badge>}
                {locked && (
                  <span className="fs-kept" title="Au moins un exemplaire est toujours conservé.">
                    <Icon name="lock" size={14} /> Conservé
                  </span>
                )}
                {v && <VerdictChip verdict={v.verdict} title={v.reason} />}
                <IconButton icon="external" label="Afficher dans le dossier" onClick={() => onReveal(f.id)} />
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
