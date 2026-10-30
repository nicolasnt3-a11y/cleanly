/** Accueil « Smart Scan » : une analyse, un grand chiffre, une action. */
import { useEffect, useMemo, useState } from 'react';
import type { CleanCategory, ScanProgress } from '../../../../shared/types';
import { ConfirmDialog } from '../../components/Dialog';
import { Button, Capsule, ProgressBar } from '../../components/ui';
import { bytesParts, formatBytes, formatCount, plural } from '../../lib/format';
import { useReducedMotion } from '../../lib/motion';
import { navigate } from '../../nav';
import { useStore } from '../../state/createStore';
import {
  appStore,
  cancelSmartScan,
  cleanSelected,
  loadAppInfo,
  progressStore,
  runSmartScan,
  scanStore,
  selectedBytes,
  settingsStore,
  type ScanStatus,
} from '../../state/stores';
import { MiniMap, segmentsFromDrive, type MapSegment } from './MiniMap';
import { StatCards, type CardData } from './StatCards';
import { useTween } from './useTween';
import './home.css';

const PHASE_LABEL: Record<ScanProgress['phase'], string> = {
  idle: 'Préparation',
  cleanup: 'Recherche des fichiers superflus',
  apps: 'Inventaire des applications',
  startup: 'Programmes au démarrage',
  protection: 'Vérification de la protection',
  disk: "Mesure de l'espace disque",
  done: 'Finalisation',
  walking: 'Parcours des dossiers',
  'hashing-partial': 'Comparaison des fichiers',
  'hashing-full': 'Comparaison des fichiers',
  deleting: 'Suppression en cours',
};

/** « a, b et c ». */
function joinFr(list: string[]): string {
  return list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}`;
}

/** Raccourcit un chemin par le milieu pour garder le début et la fin lisibles. */
function middleTruncate(path: string, max = 72): string {
  if (path.length <= max) return path;
  const head = Math.ceil(max * 0.35);
  const tail = max - head - 1;
  return `${path.slice(0, head)}…${path.slice(-tail)}`;
}

function BigNumber({ bytes, reduced, caption }: { bytes: number; reduced: boolean; caption?: string }) {
  const v = useTween(bytes, reduced);
  const { value, unit } = bytesParts(v);
  return (
    <div className="hm-big" aria-label={`${formatBytes(bytes)}${caption ? ` ${caption}` : ''}`}>
      <span className="display-num hm-num" aria-hidden="true">
        {value}
      </span>
      <span className="display-unit hm-unit" aria-hidden="true">
        {unit}
      </span>
    </div>
  );
}

export function HomeScreen() {
  const scan = useStore(scanStore);
  const { info, drives } = useStore(appStore);
  const { settings } = useStore(settingsStore);
  const { last } = useStore(progressStore);
  const reduced = useReducedMotion();

  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Annulation demandée ici : l'erreur « annulée » renvoyée ensuite n'est pas une vraie erreur. */
  const [userCancelled, setUserCancelled] = useState(false);

  /* Progression périmée : la dernière reçue avant le début de l'opération en cours est ignorée. */
  const [prevStatus, setPrevStatus] = useState<ScanStatus>(scan.status);
  const [staleProgress, setStaleProgress] = useState<ScanProgress | null>(null);
  if (scan.status !== prevStatus) {
    setPrevStatus(scan.status);
    setStaleProgress(last);
  }

  /* Après un nettoyage, rafraîchir l'espace libre affiché (barre supérieure, mini-carte). */
  useEffect(() => {
    if (scan.status === 'cleaned') void loadAppInfo().catch(() => undefined);
  }, [scan.status]);

  const isMac = info?.platform === 'darwin';
  const sysDrive = drives.find((d) => d.isSystem) ?? drives[0] ?? null;
  const result = scan.result;
  const selBytes = selectedBytes(scan);
  const selectedCats = useMemo(
    () => (result ? result.categories.filter((c) => scan.selected[c.id]) : []),
    [result, scan.selected],
  );

  let status: ScanStatus = scan.status;
  if (status === 'error' && userCancelled) status = 'idle';
  const errorMsg = userCancelled ? null : scan.error;

  const progressFor = (task: ScanProgress['task']): ScanProgress | null =>
    last && last !== staleProgress && last.task === task ? last : null;

  const startScan = () => {
    setUserCancelled(false);
    void runSmartScan();
  };
  const cancelScan = () => {
    setUserCancelled(true);
    void cancelSmartScan();
  };
  const askClean = () => {
    if (settings?.confirmBeforeClean ?? true) setConfirmOpen(true);
    else void cleanSelected();
  };
  const doClean = () => {
    setConfirmOpen(false);
    void cleanSelected();
  };

  /* ── Mini-carte ── */
  const mapSegments: MapSegment[] = useMemo(() => {
    if (result) {
      let segs: MapSegment[] = result.disk.segments.map((s) => ({ ...s }));
      if (status === 'cleaned' && scan.cleanResult) {
        const freed = scan.cleanResult.freedBytes;
        segs = segs.map((s) =>
          s.id === 'reclaimable' ? { ...s, bytes: Math.max(0, s.bytes - freed) } : s.id === 'free' ? { ...s, bytes: s.bytes + freed } : s,
        );
      }
      return segs;
    }
    return sysDrive ? segmentsFromDrive(sysDrive) : [];
  }, [result, status, scan.cleanResult, sysDrive]);
  const mapDrive = result?.disk.drive ?? sysDrive;

  /* ── Cartes ── */
  const cards = useMemo((): [CardData, CardData, CardData, CardData] => {
    if (status === 'scanning' && !result) {
      const s = { value: '…', sub: 'Analyse en cours' };
      return [s, s, s, s];
    }
    if (!result) {
      return [
        { value: 'À analyser', sub: 'Caches et fichiers temporaires' },
        { value: 'À analyser', sub: 'Programmes au démarrage' },
        { value: 'À analyser', sub: 'Sécurité intégrée du système' },
        { value: 'À analyser', sub: 'Applications installées' },
      ];
    }
    const total = result.categories.reduce((a, c) => a + c.sizeBytes, 0);
    const found = result.categories.filter((c) => c.sizeBytes > 0).length;
    const clean: CardData =
      status === 'cleaned' && scan.cleanResult
        ? { ...bytesParts(scan.cleanResult.freedBytes), sub: 'Libérés à l’instant' }
        : { ...bytesParts(total), sub: `Détectés dans ${plural(found, 'catégorie')}` };
    const { startup, protection, apps } = result;
    return [
      clean,
      {
        value: formatCount(startup.enabledCount),
        unit: 'au démarrage',
        sub: startup.highImpactCount > 0 ? `Dont ${formatCount(startup.highImpactCount)} à fort impact` : 'Aucune à fort impact',
      },
      {
        value: formatCount(Math.round(protection.score)),
        unit: '/100',
        sub: protection.issues > 0 ? `${plural(protection.issues, 'point')} à vérifier` : 'Tout est en ordre',
      },
      {
        value: formatCount(apps.installedCount),
        unit: 'installées',
        sub: apps.unusedCount > 0 ? `${plural(apps.unusedCount, 'inutilisée')} depuis 6 mois` : 'Toutes utilisées récemment',
      },
    ];
  }, [status, result, scan.cleanResult]);

  const eyebrow = `Smart Scan — ${info?.osLabel ?? (isMac ? 'macOS' : 'Windows')}`;

  return (
    <div className="screen hm">
      <div className="hm-top">
        <section className="hm-hero" aria-labelledby="hm-title">
          {status === 'idle' && (
            <IdleHero eyebrow={eyebrow} isMac={isMac} onStart={startScan} cancelled={userCancelled && scan.status !== 'scanning'} />
          )}
          {status === 'scanning' && (
            <ScanningHero eyebrow={eyebrow} progress={progressFor('smart-scan')} reduced={reduced} onCancel={cancelScan} />
          )}
          {status === 'done' && result && (
            <DoneHero
              eyebrow={eyebrow}
              bytes={selBytes}
              selectedCount={selectedCats.length}
              reduced={reduced}
              error={errorMsg}
              onClean={askClean}
            />
          )}
          {status === 'cleaning' && (
            <CleaningHero eyebrow={eyebrow} bytes={selBytes} progress={progressFor('clean')} reduced={reduced} />
          )}
          {status === 'cleaned' && scan.cleanResult && result && (
            <CleanedHero eyebrow={eyebrow} categories={result.categories} reduced={reduced} onRescan={startScan} />
          )}
          {status === 'error' && <ErrorHero eyebrow={eyebrow} message={errorMsg} onRetry={startScan} />}
        </section>

        <MiniMap drive={mapDrive} segments={mapSegments} pending={status === 'scanning' && !result} />
      </div>

      <StatCards data={cards} busy={status === 'scanning'} />

      <ConfirmDialog
        open={confirmOpen}
        title={`Libérer ${formatBytes(selBytes)} ?`}
        confirmLabel="Nettoyer"
        onConfirm={doClean}
        onCancel={() => setConfirmOpen(false)}
      >
        <CleanSummary categories={selectedCats} />
      </ConfirmDialog>
    </div>
  );
}

/* ───────────────────────────── États ───────────────────────────── */

function IdleHero({ eyebrow, isMac, onStart, cancelled }: { eyebrow: string; isMac: boolean; onStart: () => void; cancelled: boolean }) {
  return (
    <>
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="hm-title" className="h1 hm-h1">
        {isMac ? 'Votre Mac' : 'Votre PC'} mérite un peu d'air.
      </h1>
      <p className="sub">
        Caches, fichiers temporaires, applications au démarrage et sécurité intégrée : une seule analyse pour tout vérifier. Rien n'est
        supprimé sans votre accord.
      </p>
      <div className="hm-actions">
        <Capsule onClick={onStart}>Lancer l'analyse</Capsule>
      </div>
      {cancelled && (
        <p className="hm-note" role="status">
          Analyse annulée.
        </p>
      )}
    </>
  );
}

function ScanningHero({
  eyebrow,
  progress,
  reduced,
  onCancel,
}: {
  eyebrow: string;
  progress: ScanProgress | null;
  reduced: boolean;
  onCancel: () => void;
}) {
  const phase = progress ? PHASE_LABEL[progress.phase] : 'Préparation';
  return (
    <>
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="hm-title" className="hm-vh">
        Analyse en cours
      </h1>
      <BigNumber bytes={progress?.bytesFound ?? 0} reduced={reduced} caption="trouvés pour l'instant" />
      <p className="sub hm-subline">
        trouvés pour l'instant · <span aria-live="polite">{phase}</span>
      </p>
      <div className="hm-progress">
        <ProgressBar fraction={progress?.fraction ?? null} />
        <div className="hm-progress-meta">
          <span className="mono hm-path" title={progress?.currentPath}>
            {progress?.currentPath ? middleTruncate(progress.currentPath) : 'Préparation de l\'analyse'}
          </span>
          <span className="mono num">{progress?.fraction != null ? `${Math.round(progress.fraction * 100)} %` : ''}</span>
        </div>
      </div>
      <div className="hm-actions">
        <Button className="hm-ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </>
  );
}

function DoneHero({
  eyebrow,
  bytes,
  selectedCount,
  reduced,
  error,
  onClean,
}: {
  eyebrow: string;
  bytes: number;
  selectedCount: number;
  reduced: boolean;
  error: string | null;
  onClean: () => void;
}) {
  return (
    <>
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="hm-title" className="hm-vh">
        Analyse terminée
      </h1>
      <BigNumber bytes={bytes} reduced={reduced} caption="prêts à être libérés" />
      <p className="sub hm-subline">
        prêts à être libérés · {selectedCount === 0 ? 'aucune catégorie sélectionnée' : `${plural(selectedCount, 'catégorie')} ${selectedCount > 1 ? 'sélectionnées' : 'sélectionnée'}`}
      </p>
      <div className="hm-actions">
        <Capsule onClick={onClean} disabled={selectedCount === 0 || bytes <= 0}>
          Nettoyer
        </Capsule>
        <Button className="hm-ghost" onClick={() => navigate('cleanup')}>
          Voir le détail
        </Button>
      </div>
      {error && (
        <p className="hm-note bad" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function CleaningHero({
  eyebrow,
  bytes,
  progress,
  reduced,
}: {
  eyebrow: string;
  bytes: number;
  progress: ScanProgress | null;
  reduced: boolean;
}) {
  return (
    <>
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="hm-title" className="hm-vh">
        Nettoyage en cours
      </h1>
      <BigNumber bytes={bytes} reduced={reduced} caption="en cours de nettoyage" />
      <p className="sub hm-subline">
        en cours de nettoyage · <span aria-live="polite">{progress ? PHASE_LABEL[progress.phase] : 'Préparation'}</span>
      </p>
      <div className="hm-progress">
        <ProgressBar fraction={progress?.fraction ?? null} />
        <div className="hm-progress-meta">
          <span className="mono">
            {progress && progress.itemsVisited > 0 ? `${formatCount(progress.itemsVisited)} éléments traités` : 'Ne fermez pas Cleanly'}
          </span>
          <span className="mono num">{progress?.fraction != null ? `${Math.round(progress.fraction * 100)} %` : ''}</span>
        </div>
      </div>
    </>
  );
}

function CleanedHero({ eyebrow, categories, reduced, onRescan }: { eyebrow: string; categories: CleanCategory[]; reduced: boolean; onRescan: () => void }) {
  const r = useStore(scanStore).cleanResult!;
  const adminLabels = r.needsAdminCategoryIds.map((id) => categories.find((c) => c.id === id)?.label ?? id);
  const facts: string[] = [];
  if (r.deletedCount > 0) facts.push(`${plural(r.deletedCount, 'fichier supprimé', 'fichiers supprimés')}`);
  if (r.trashedCount > 0) facts.push(`${plural(r.trashedCount, 'élément placé', 'éléments placés')} dans la Corbeille`);
  if (r.lockedCount > 0) facts.push(`${plural(r.lockedCount, 'fichier verrouillé ignoré', 'fichiers verrouillés ignorés')}`);
  if (r.recentSkippedCount > 0) facts.push(`${plural(r.recentSkippedCount, 'fichier récent conservé', 'fichiers récents conservés')} (moins de 24 h)`);
  if (r.unsafeRejectedCount > 0) facts.push(`${plural(r.unsafeRejectedCount, 'élément protégé', 'éléments protégés')}, non touchés`);

  return (
    <>
      <p className="eyebrow">{eyebrow} · Nettoyage terminé</p>
      <h1 id="hm-title" className="hm-vh">
        Nettoyage terminé
      </h1>
      <BigNumber bytes={r.freedBytes} reduced={reduced} caption="libérés" />
      <p className="sub hm-subline" role="status">
        libérés{facts.length > 0 ? ` · ${facts[0]}` : ''}
      </p>
      {(facts.length > 1 || adminLabels.length > 0 || r.errors.length > 0) && (
        <ul className="hm-facts">
          {facts.slice(1).map((f) => (
            <li key={f}>{f}</li>
          ))}
          {adminLabels.length > 0 && (
            <li>
              Non nettoyé, droits administrateur requis : {joinFr(adminLabels)}
            </li>
          )}
          {r.errors.length > 0 && <li className="bad">{plural(r.errors.length, 'erreur')} : {r.errors[0]}</li>}
        </ul>
      )}
      <div className="hm-actions">
        <Capsule onClick={onRescan}>Analyser à nouveau</Capsule>
        <Button className="hm-ghost" onClick={() => navigate('files', { filesTab: 'large' })}>
          Fichiers volumineux
        </Button>
      </div>
    </>
  );
}

function ErrorHero({ eyebrow, message, onRetry }: { eyebrow: string; message: string | null; onRetry: () => void }) {
  return (
    <>
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="hm-title" className="h1 hm-h1">
        L'analyse n'a pas abouti.
      </h1>
      <p className="sub" role="alert">
        {message ?? 'Une erreur inattendue est survenue.'} Aucun fichier n'a été modifié.
      </p>
      <div className="hm-actions">
        <Capsule onClick={onRetry}>Réessayer</Capsule>
      </div>
    </>
  );
}

/* ───────────────────── Résumé avant nettoyage ───────────────────── */

function CleanSummary({ categories }: { categories: CleanCategory[] }) {
  const sum = (list: CleanCategory[]) => list.reduce((a, c) => a + c.sizeBytes, 0);
  const permanent = categories.filter((c) => c.mode === 'permanent');
  const trash = categories.filter((c) => c.mode === 'trash');
  const bin = categories.filter((c) => c.mode === 'empty-bin');
  const admin = categories.filter((c) => c.requiresAdmin);
  return (
    <div className="hm-sum">
      <ul>
        {permanent.length > 0 && (
          <li>
            <span className="hm-sum-k">Supprimé définitivement</span>
            <span className="hm-sum-v num">{formatBytes(sum(permanent))}</span>
            <span className="hm-sum-d">Caches, fichiers temporaires et journaux : ils se recréent automatiquement.</span>
          </li>
        )}
        {trash.length > 0 && (
          <li>
            <span className="hm-sum-k">Placé dans la Corbeille</span>
            <span className="hm-sum-v num">{formatBytes(sum(trash))}</span>
            <span className="hm-sum-d">
              Vos fichiers personnels ({trash.map((c) => c.label.toLowerCase()).join(', ')}) restent récupérables.
            </span>
          </li>
        )}
        {bin.length > 0 && (
          <li>
            <span className="hm-sum-k">Corbeille vidée</span>
            <span className="hm-sum-v num">{formatBytes(sum(bin))}</span>
            <span className="hm-sum-d">Son contenu actuel sera effacé définitivement.</span>
          </li>
        )}
      </ul>
      <p className="hm-sum-note">
        Les fichiers temporaires modifiés il y a moins de 24 h et les fichiers en cours d'utilisation sont conservés.
        {admin.length > 0 &&
          ` ${joinFr(admin.map((c) => c.label))} ${admin.length > 1 ? 'exigent' : 'exige'} des droits administrateur et ${admin.length > 1 ? 'pourront être ignorées' : 'pourra être ignorée'}.`}
      </p>
    </div>
  );
}
