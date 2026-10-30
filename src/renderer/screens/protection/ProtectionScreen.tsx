/**
 * Protection — lecture seule de l'état des protections intégrées au système.
 * Cleanly n'est PAS un antivirus : il ne modifie rien ici et ne remplace aucune solution de sécurité.
 */
import { useCallback, useEffect, useState } from 'react';
import type { CheckStatus, Platform, ProtectionCheck, ProtectionReport } from '../../../../shared/types';
import { call, errorMessage } from '../../api';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/stores';
import { Button, EmptyState, ScreenHead, Spinner, StatusDot } from '../../components/ui';
import { Icon } from '../../components/icons';
import './protection.css';

const SEVERITY: Record<CheckStatus, number> = { bad: 0, warn: 1, unknown: 2, ok: 3 };

function verdict(score: number): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (score >= 90) return { label: 'Excellente', tone: 'ok' };
  if (score >= 75) return { label: 'Bonne', tone: 'ok' };
  if (score >= 50) return { label: 'À renforcer', tone: 'warn' };
  return { label: 'Faible', tone: 'bad' };
}

function osName(platform: Platform | undefined): string | null {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  return null;
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function ProtectionScreen() {
  const { info } = useStore(appStore);
  const os = osName(info?.platform);
  const mac = info?.platform === 'darwin';

  const [report, setReport] = useState<ProtectionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await call('protection:report'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const checks = report ? [...report.checks].sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]) : [];
  const issues = checks.filter((c) => c.status !== 'ok').length;

  return (
    <div className="screen pr">
      <ScreenHead
        eyebrow="Protection — lecture seule"
        title={os ? `Sécurité intégrée de ${os}` : 'Sécurité intégrée du système'}
        right={
          report && (
            <span className="mono pr-checked">
              Vérifié à {timeFmt.format(report.checkedAt)}
            </span>
          )
        }
      />

      {!report && loading && (
        <div className="panel pr-fill pr-center">
          <Spinner />
          <span className="mono">Lecture de l’état des protections…</span>
        </div>
      )}

      {!report && !loading && error && (
        <div className="panel pr-fill">
          <EmptyState icon="warn" title="Impossible de lire l’état des protections">
            <p className="small">{error}</p>
            <Button small icon="refresh" onClick={() => void load()} style={{ marginTop: 14 }}>
              Réessayer
            </Button>
          </EmptyState>
        </div>
      )}

      {report && (
        <div className="pr-grid">
          <section className="panel pr-score" aria-labelledby="pr-score-h">
            <h3 id="pr-score-h" className="eyebrow">
              Indice de protection
            </h3>
            <ScoreRing score={report.score} />
            <div className="pr-verdict">
              <span className={`pr-verdict-l ${verdict(report.score).tone}`}>{verdict(report.score).label}</span>
              <span className="small">
                {issues === 0
                  ? 'Toutes les protections vérifiées sont actives.'
                  : `${issues} point${issues > 1 ? 's' : ''} à examiner.`}
              </span>
            </div>
            <div className="pr-disclaimer">
              <Icon name="info" size={16} />
              <p className="small">
                Cleanly se contente de <strong>lire</strong> l’état des protections intégrées à {os ?? 'votre système'}
                {mac ? ' (Gatekeeper, XProtect, pare-feu, FileVault…)' : os === 'Windows' ? ' (Microsoft Defender, pare-feu, SmartScreen…)' : ''}. Il
                ne modifie aucun réglage. <strong>Cleanly n’est pas un antivirus</strong> : il ne détecte ni ne supprime aucune menace et ne
                remplace pas une solution de sécurité.
              </p>
            </div>
          </section>

          <section className="panel pr-checks" aria-labelledby="pr-checks-h">
            <div className="pr-checks-head">
              <div>
                <h3 id="pr-checks-h" className="eyebrow">
                  Vérifications
                </h3>
                <span className="small">
                  {checks.length} contrôle{checks.length > 1 ? 's' : ''} · pondérés sur 100
                </span>
              </div>
              <Button small icon="refresh" onClick={() => void load()} disabled={loading}>
                {loading ? 'Vérification…' : 'Vérifier à nouveau'}
              </Button>
            </div>
            {error && (
              <p className="notice pr-err" role="alert">
                Nouvelle vérification impossible : {error}
              </p>
            )}
            <ul className="panel-scroll pr-list" aria-busy={loading || undefined}>
              {checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: ProtectionCheck }) {
  return (
    <li className={`pr-row ${check.status}`}>
      <div className="pr-row-main">
        <div className="row-text">
          <span className="row-title">{check.label}</span>
          <span className="pr-detail mono">{check.detail}</span>
        </div>
        <span className="pr-weight mono" title="Poids dans l’indice">
          {check.weight} pts
        </span>
        <StatusDot status={check.status} />
      </div>
      {check.status !== 'ok' && check.advice && <p className="pr-advice">{check.advice}</p>}
    </li>
  );
}

function ScoreRing({ score }: { score: number }) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const r = 92;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <div className="pr-ring" role="img" aria-label={`Indice de protection : ${value} sur 100`}>
      <svg viewBox="0 0 200 200" width="200" height="200" aria-hidden="true">
        <circle cx="100" cy="100" r={r} className="pr-ring-track" />
        <circle
          cx="100"
          cy="100"
          r={r}
          className="pr-ring-val"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          transform="rotate(-90 100 100)"
        />
      </svg>
      <div className="pr-ring-txt" aria-hidden="true">
        <span className="pr-ring-num">{value}</span>
        <span className="mono">Sur 100</span>
      </div>
    </div>
  );
}
