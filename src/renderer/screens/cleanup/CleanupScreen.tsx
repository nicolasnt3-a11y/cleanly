/** Écran « Nettoyage » : catégories du Smart Scan, détail par élément, second avis IA, nettoyage confirmé. */
import { useMemo, useState } from 'react';
import type { AiReviewItem, AiVerdict, AiVerdictKind, CleanCategory, CleanResult, DeleteMode } from '../../../../shared/types';
import { AiAssistant } from '../../components/AiAssistant';
import { ConfirmDialog } from '../../components/Dialog';
import { Icon } from '../../components/icons';
import { Badge, Button, Capsule, CheckMark, EmptyState, ProgressBar, ScreenHead, VerdictChip } from '../../components/ui';
import { bytesParts, formatBytes, formatCount, formatRelative, plural } from '../../lib/format';
import { useStore } from '../../state/createStore';
import {
  cancelSmartScan,
  cleanSelected,
  progressStore,
  runSmartScan,
  scanStore,
  selectedBytes,
  settingsStore,
  toggleCategory,
  toggleExcluded,
  verdictStore,
  type ScanState,
} from '../../state/stores';
import './cleanup.css';

const MODE_BADGE: Record<DeleteMode, { label: string; tone?: 'accent'; title: string }> = {
  permanent: { label: 'Définitif', title: 'Contenu régénérable, supprimé définitivement.' },
  trash: { label: 'Corbeille', tone: 'accent', title: 'Fichiers personnels : toujours envoyés à la Corbeille.' },
  'empty-bin': { label: 'Vider', title: 'Vide la Corbeille du système.' },
};

/** Octets effectivement nettoyés d'une catégorie (moins les éléments décochés). */
function categoryBytes(c: CleanCategory, excluded: ScanState['excluded']): number {
  let total = c.sizeBytes;
  for (const it of c.topItems) if (excluded[it.id]) total -= it.sizeBytes;
  return Math.max(0, total);
}

/** Verdict le plus prudent parmi les éléments d'une catégorie. */
function categoryVerdict(c: CleanCategory, verdicts: Record<string, AiVerdict>): { verdict: AiVerdictKind; title: string } | null {
  const list = c.topItems.map((it) => verdicts[it.id]).filter((v): v is AiVerdict => !!v);
  if (list.length === 0) return null;
  const count = (k: AiVerdictKind) => list.filter((v) => v.verdict === k).length;
  const keep = count('keep');
  const review = count('review');
  const safe = count('safe');
  const verdict: AiVerdictKind = keep > 0 ? 'keep' : review > 0 ? 'review' : 'safe';
  const parts = [safe && `${safe} sûr${safe > 1 ? 's' : ''}`, review && `${review} à vérifier`, keep && `${keep} à conserver`].filter(Boolean);
  return { verdict, title: `Assistant : ${parts.join(', ')}` };
}

export function CleanupScreen() {
  const scan = useStore(scanStore);
  const { settings } = useStore(settingsStore);
  const { verdicts } = useStore(verdictStore);
  const { last: progress } = useStore(progressStore);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState(false);

  const { result, selected, excluded, status } = scan;
  const total = selectedBytes(scan);
  const chosen = useMemo(() => result?.categories.filter((c) => selected[c.id]) ?? [], [result, selected]);

  const aiItems: AiReviewItem[] = useMemo(
    () =>
      chosen
        .flatMap((c) =>
          c.topItems.map((it) => ({
            id: it.id,
            path: it.path,
            name: it.name,
            sizeBytes: it.sizeBytes,
            modifiedAt: it.modifiedAt,
            context: c.id,
          })),
        )
        .slice(0, 150),
    [chosen],
  );

  /* ── Pas encore d'analyse ── */
  if (!result) {
    const p = progress?.task === 'smart-scan' ? progress : null;
    return (
      <div className="screen cu-screen">
        <ScreenHead eyebrow="Nettoyage" title="Fichiers superflus" />
        <div className="panel cu-empty">
          {status === 'scanning' ? (
            <div className="cu-scanning" role="status" aria-live="polite">
              <div className="h3">Analyse en cours…</div>
              <div className="cu-scan-progress">
                <ProgressBar fraction={p?.fraction ?? null} />
                <div className="cu-scan-meta">
                  <span className="mono">{p ? `${formatCount(p.itemsVisited)} éléments` : 'Préparation'}</span>
                  <span className="mono">{p && p.bytesFound > 0 ? `${formatBytes(p.bytesFound)} trouvés` : ''}</span>
                </div>
                {p?.currentPath && <div className="row-meta">{p.currentPath}</div>}
              </div>
              <Button small icon="stop" onClick={() => void cancelSmartScan()}>
                Arrêter
              </Button>
            </div>
          ) : (
            <EmptyState icon="clean" title="Aucune analyse pour l'instant">
              Lancez le Smart Scan : Cleanly mesure les caches, fichiers temporaires et téléchargements oubliés, sans rien supprimer.
              {scan.error && <span className="cu-error-line">{scan.error}</span>}
              <div className="cu-empty-cta">
                <Capsule small onClick={() => void runSmartScan()}>
                  Lancer le Smart Scan
                </Capsule>
              </div>
            </EmptyState>
          )}
        </div>
      </div>
    );
  }

  const cleaning = status === 'cleaning';
  const cleaned = status === 'cleaned' && scan.cleanResult;
  const { value: totalValue, unit: totalUnit } = bytesParts(total);

  const byMode = (m: DeleteMode) => chosen.filter((c) => c.mode === m && !c.requiresAdmin);
  const permanentBytes = byMode('permanent').reduce((a, c) => a + categoryBytes(c, excluded), 0);
  const trashBytes = byMode('trash').reduce((a, c) => a + categoryBytes(c, excluded), 0);
  const binBytes = byMode('empty-bin').reduce((a, c) => a + categoryBytes(c, excluded), 0);
  const adminCats = chosen.filter((c) => c.requiresAdmin);

  const startClean = () => {
    if (chosen.length === 0 || cleaning) return;
    if (settings?.confirmBeforeClean === false) void cleanSelected();
    else setConfirm(true);
  };

  const cleanP = progress?.task === 'clean' ? progress : null;

  return (
    <div className="screen cu-screen">
      <ScreenHead
        eyebrow={`Nettoyage — ${plural(result.categories.length, 'catégorie')}`}
        title="Fichiers superflus"
        right={
          <>
            <div className="cu-total">
              <span className="mono">Sélection</span>
              <span className="cu-total-num" aria-live="polite">
                {totalValue}
                <small> {totalUnit}</small>
              </span>
            </div>
            <Capsule onClick={startClean} disabled={chosen.length === 0 || cleaning || status === 'scanning'}>
              {cleaning ? 'Nettoyage…' : 'Nettoyer'}
            </Capsule>
          </>
        }
      />

      <div className="cu-body">
        <div className="cu-main">
          {cleaning && (
            <div className="panel cu-banner" role="status" aria-live="polite">
              <div className="cu-banner-row">
                <span className="spinner" />
                <span>Nettoyage en cours…</span>
              </div>
              <ProgressBar fraction={cleanP?.fraction ?? null} />
              {cleanP?.currentPath && <div className="row-meta">{cleanP.currentPath}</div>}
            </div>
          )}
          {cleaned && <CleanSummary r={scan.cleanResult!} categories={result.categories} />}
          {scan.error && <p className="notice cu-notice-bad" role="alert">{scan.error}</p>}

          <div className="panel panel-scroll cu-list" aria-busy={cleaning}>
            <ul aria-label="Catégories">
              {result.categories.map((c) => (
                <CategoryRow
                  key={c.id}
                  c={c}
                  on={!!selected[c.id]}
                  open={!!open[c.id]}
                  disabled={cleaning}
                  excluded={excluded}
                  verdicts={verdicts}
                  onToggle={() => toggleCategory(c.id)}
                  onToggleOpen={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
                />
              ))}
            </ul>
          </div>

          <p className="cu-foot small">
            <Icon name="info" size={16} />
            <span>
              Les caches et fichiers temporaires sont supprimés définitivement (ils se régénèrent). Vos fichiers personnels vont toujours à la
              Corbeille. Les fichiers temporaires modifiés il y a moins de 24 h sont conservés.
            </span>
          </p>
        </div>

        <aside className="cu-side" aria-label="Assistant">
          {aiItems.length > 0 ? (
            <AiAssistant items={aiItems} compact />
          ) : (
            <p className="small cu-side-empty">Sélectionnez des catégories pour demander un second avis à l'assistant.</p>
          )}
          <p className="small cu-side-meta">
            Analyse {formatRelative(result.scannedAt)} ·{' '}
            <button type="button" className="cu-link" onClick={() => void runSmartScan()} disabled={cleaning || status === 'scanning'}>
              {status === 'scanning' ? 'analyse…' : 'relancer'}
            </button>
          </p>
        </aside>
      </div>

      <ConfirmDialog
        open={confirm}
        title={`Nettoyer ${formatBytes(total)} ?`}
        confirmLabel="Nettoyer"
        busy={cleaning}
        onConfirm={() => {
          setConfirm(false);
          void cleanSelected();
        }}
        onCancel={() => setConfirm(false)}
      >
        <ul className="cu-dlg">
          {permanentBytes > 0 && (
            <li>
              <span>
                <b>Suppression définitive</b> — caches et temporaires
              </span>
              <span className="mono">{formatBytes(permanentBytes)}</span>
            </li>
          )}
          {trashBytes > 0 && (
            <li>
              <span>
                <b>Vers la Corbeille</b> — fichiers personnels, restaurables
              </span>
              <span className="mono">{formatBytes(trashBytes)}</span>
            </li>
          )}
          {binBytes > 0 && (
            <li>
              <span>
                <b>Vidage de la Corbeille</b> — irréversible
              </span>
              <span className="mono">{formatBytes(binBytes)}</span>
            </li>
          )}
        </ul>
        {adminCats.length > 0 && (
          <p className="cu-dlg-note">
            {adminCats.map((c) => c.label).join(', ')} : droits administrateur nécessaires, ces éléments pourront être ignorés.
          </p>
        )}
        <p className="cu-dlg-note">Les fichiers verrouillés ou en cours d'utilisation sont ignorés sans erreur.</p>
      </ConfirmDialog>
    </div>
  );
}

function CategoryRow({
  c,
  on,
  open,
  disabled,
  excluded,
  verdicts,
  onToggle,
  onToggleOpen,
}: {
  c: CleanCategory;
  on: boolean;
  open: boolean;
  disabled: boolean;
  excluded: ScanState['excluded'];
  verdicts: Record<string, AiVerdict>;
  onToggle: () => void;
  onToggleOpen: () => void;
}) {
  const badge = MODE_BADGE[c.mode];
  const someExcluded = c.topItems.some((it) => excluded[it.id]);
  const cv = categoryVerdict(c, verdicts);
  const empty = c.sizeBytes <= 0 && !c.error;
  const canExpand = c.topItems.length > 0;
  const shown = on ? categoryBytes(c, excluded) : c.sizeBytes;
  const panelId = `cu-items-${c.id}`;
  const hints = [
    c.lockedCount > 0 && `${plural(c.lockedCount, 'fichier verrouillé', 'fichiers verrouillés')}`,
    c.recentSkippedCount > 0 && `${plural(c.recentSkippedCount, 'fichier récent conservé', 'fichiers récents conservés')}`,
  ].filter(Boolean) as string[];

  return (
    <li className={`cu-cat${on ? ' is-on' : ''}${open ? ' is-open' : ''}`}>
      <div className="cu-cat-row">
        <button
          type="button"
          className="cu-cat-main"
          onClick={onToggle}
          disabled={disabled || (!!c.error && !on) || (empty && !on)}
          aria-pressed={on}
        >
          <CheckMark on={on} mixed={on && someExcluded} />
          <span className="row-text">
            <span className="cu-cat-title">
              <span className="row-title">{c.label}</span>
            </span>
            {c.error ? (
              <span className="cu-error-line">{c.error}</span>
            ) : (
              <span className="row-meta">
                {c.description} · {plural(c.fileCount, 'fichier')}
              </span>
            )}
          </span>
        </button>
        <span className="cu-cat-badges">
          {cv && <VerdictChip verdict={cv.verdict} title={cv.title} />}
          {c.requiresAdmin && (
            <span title="Droits administrateur nécessaires pour tout supprimer.">
              <Badge tone="warn">Admin</Badge>
            </span>
          )}
          <span title={badge.title}>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </span>
        </span>
        <span className={`row-size${on ? '' : ' cu-dim'}`}>{formatBytes(shown)}</span>
        {canExpand ? (
          <button
            type="button"
            className="icon-btn cu-expand"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? `Masquer le détail de ${c.label}` : `Afficher le détail de ${c.label}`}
            onClick={onToggleOpen}
          >
            <Icon name="chevron-right" size={18} />
          </button>
        ) : (
          <span className="cu-expand" aria-hidden="true" />
        )}
      </div>

      {open && canExpand && (
        <div id={panelId} className="cu-items">
          <ul>
            {c.topItems.map((it) => {
              const itOn = on && !excluded[it.id];
              const v = verdicts[it.id];
              return (
                <li key={it.id} className="cu-item">
                  <button
                    type="button"
                    className="cu-item-main"
                    disabled={!on || disabled}
                    onClick={() => toggleExcluded(it.id)}
                    aria-pressed={itOn}
                    title={on ? undefined : 'Cochez la catégorie pour choisir ses éléments.'}
                  >
                    <CheckMark on={itOn} />
                    <Icon name={it.isDirectory ? 'folder' : 'file'} size={16} />
                    <span className="row-text">
                      <span className="cu-item-name">{it.name}</span>
                      <span className="row-meta" title={it.path}>
                        {it.path}
                      </span>
                    </span>
                  </button>
                  {v && <VerdictChip verdict={v.verdict} title={v.reason} />}
                  <span className="cu-item-date small">{formatRelative(it.modifiedAt)}</span>
                  <span className={`row-size cu-item-size${itOn ? '' : ' cu-dim'}`}>{formatBytes(it.sizeBytes)}</span>
                </li>
              );
            })}
          </ul>
          <p className="cu-items-foot mono">
            {c.topItems.length < c.fileCount ? `${c.topItems.length} plus gros éléments sur ${formatCount(c.fileCount)}` : `${c.topItems.length} éléments`}
            {hints.length > 0 && ` · ${hints.join(' · ')}`}
          </p>
        </div>
      )}
      {!open && hints.length > 0 && on && <p className="cu-hint mono">{hints.join(' · ')}</p>}
    </li>
  );
}

function CleanSummary({ r, categories }: { r: CleanResult; categories: CleanCategory[] }) {
  const adminLabels = r.needsAdminCategoryIds.map((id) => categories.find((c) => c.id === id)?.label ?? id);
  const { value, unit } = bytesParts(r.freedBytes);
  return (
    <div className="panel cu-summary" role="status">
      <div className="cu-summary-head">
        <span className="cu-summary-check" aria-hidden="true">
          <Icon name="check" size={18} />
        </span>
        <div>
          <p className="eyebrow">Nettoyage terminé</p>
          <div className="cu-summary-num">
            {value}
            <small> {unit} libérés</small>
          </div>
        </div>
        <Button small icon="refresh" onClick={() => void runSmartScan()}>
          Nouvelle analyse
        </Button>
      </div>
      <dl className="cu-summary-facts">
        <div>
          <dt className="mono">Supprimés</dt>
          <dd>{formatCount(r.deletedCount)}</dd>
        </div>
        <div>
          <dt className="mono">Corbeille</dt>
          <dd>{formatCount(r.trashedCount)}</dd>
        </div>
        <div>
          <dt className="mono">Verrouillés</dt>
          <dd>{formatCount(r.lockedCount)}</dd>
        </div>
        <div>
          <dt className="mono">Récents gardés</dt>
          <dd>{formatCount(r.recentSkippedCount)}</dd>
        </div>
        {r.unsafeRejectedCount > 0 && (
          <div>
            <dt className="mono">Refusés (sécurité)</dt>
            <dd>{formatCount(r.unsafeRejectedCount)}</dd>
          </div>
        )}
      </dl>
      {adminLabels.length > 0 && (
        <p className="small cu-summary-note">
          <Icon name="lock" size={14} /> Ignorés faute de droits administrateur : {adminLabels.join(', ')}.
        </p>
      )}
      {r.errors.length > 0 && (
        <details className="small cu-summary-note">
          <summary>{plural(r.errors.length, 'erreur')}</summary>
          <ul>
            {r.errors.slice(0, 20).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
