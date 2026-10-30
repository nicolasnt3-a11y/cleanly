/** Rapport de protection (LECTURE SEULE) : antivirus, pare-feu, SmartScreen, UAC, chiffrement… */
import type { CheckStatus, ProtectionCheck, ProtectionReport } from '../../../../shared/types';
import { run, runPowerShell } from '../../util/exec';

type Check = Omit<ProtectionCheck, 'weight'> & { weight: number };

export function scoreOf(checks: ProtectionCheck[]): number {
  let got = 0;
  let total = 0;
  for (const c of checks) {
    if (c.status === 'unknown') continue;
    total += c.weight;
    got += c.status === 'ok' ? c.weight : c.status === 'warn' ? c.weight / 2 : 0;
  }
  return total > 0 ? Math.round((got / total) * 100) : 0;
}

function check(id: string, label: string, weight: number, status: CheckStatus, detail: string, advice?: string): Check {
  const c: Check = { id, label, weight, status, detail };
  if (status !== 'ok' && advice) c.advice = advice;
  return c;
}

/* ───────────── Windows ───────────── */

/** Un seul script : chaque section est isolée dans son propre try/catch. */
const WIN_SCRIPT = String.raw`
$r=[ordered]@{}
try{$s=Get-MpComputerStatus;$r.mp=[ordered]@{rtp=[bool]$s.RealTimeProtectionEnabled;av=[bool]$s.AntivirusEnabled;am=[bool]$s.AMServiceEnabled;
 age=$s.AntivirusSignatureAge;last=$(if($s.AntivirusSignatureLastUpdated){$s.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('o')}else{$null});
 tamper=$s.IsTamperProtected;mode=[string]$s.AMRunningMode}}catch{$r.mpErr=$_.Exception.Message}
try{$r.av=@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct -ErrorAction Stop|ForEach-Object{[ordered]@{name=[string]$_.displayName;state=[int64]$_.productState}})}catch{$r.av=$null}
try{$r.fw=@(Get-NetFirewallProfile -ErrorAction Stop|ForEach-Object{[ordered]@{name=[string]$_.Name;enabled=($_.Enabled -eq $true -or [string]$_.Enabled -eq 'True')}})}catch{$r.fw=$null}
function RegVal($p,$n){try{(Get-ItemProperty -LiteralPath $p -Name $n -ErrorAction Stop).$n}catch{$null}}
$r.ssPolicy=RegVal 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\System' 'EnableSmartScreen'
$r.ssExplorer=RegVal 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer' 'SmartScreenEnabled'
$r.lua=RegVal 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' 'EnableLUA'
$r.consent=RegVal 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' 'ConsentPromptBehaviorAdmin'
try{$v=Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop;$r.bl=[ordered]@{src='cmdlet';status=[string]$v.ProtectionStatus;vol=[string]$v.VolumeStatus}}catch{
 try{$x=(New-Object -ComObject Shell.Application).NameSpace($env:SystemDrive+'\').Self.ExtendedProperty('System.Volume.BitLockerProtection');$r.bl=[ordered]@{src='shell';value=$x}}catch{$r.bl=$null}}
ConvertTo-Json -InputObject $r -Depth 4 -Compress
`;

interface WinRaw {
  mp?: { rtp: boolean; av: boolean; am: boolean; age: number | null; last: string | null; tamper: boolean | null; mode: string };
  mpErr?: string;
  av?: Array<{ name: string; state: number }> | null;
  fw?: Array<{ name: string; enabled: boolean }> | null;
  ssPolicy?: number | null;
  ssExplorer?: string | null;
  lua?: number | null;
  consent?: number | null;
  bl?: { src: 'cmdlet'; status: string; vol: string } | { src: 'shell'; value: number | null } | null;
}

/** productState (SecurityCenter2) : octet 2 = activé (0x10), octet 3 = signatures à jour (0x00). */
function decodeProductState(state: number): { on: boolean; upToDate: boolean } {
  return { on: ((state >> 8) & 0xff & 0x10) !== 0, upToDate: (state & 0xff) === 0 };
}

const PROFILE_FR: Record<string, string> = { Domain: 'domaine', Private: 'privé', Public: 'public' };

function windowsChecks(raw: WinRaw): Check[] {
  const checks: Check[] = [];
  const thirdParty = (raw.av ?? []).filter((p) => !/defender/i.test(p.name));
  const activeThird = thirdParty.filter((p) => decodeProductState(p.state).on);
  const mp = raw.mp;
  const defenderActive = !!mp && mp.am && mp.rtp && !/passive|edr/i.test(mp.mode);

  // Antivirus (30)
  if (defenderActive) {
    checks.push(check('antivirus', 'Antivirus', 30, 'ok', 'Microsoft Defender protège cet ordinateur en temps réel.'));
  } else if (activeThird.length) {
    checks.push(check('antivirus', 'Antivirus', 30, 'ok', `${activeThird.map((p) => p.name).join(', ')} est actif.`));
  } else if (mp || raw.av) {
    checks.push(
      check('antivirus', 'Antivirus', 30, 'bad', 'Aucune protection antivirus en temps réel détectée.',
        'Activez la protection en temps réel dans Sécurité Windows, ou celle de votre antivirus.'),
    );
  } else {
    checks.push(check('antivirus', 'Antivirus', 30, 'unknown', "L'état de l'antivirus n'a pas pu être lu."));
  }

  // Définitions (15)
  if (defenderActive && mp) {
    const age = typeof mp.age === 'number' ? mp.age : null;
    if (age === null) checks.push(check('signatures', 'Définitions de virus', 15, 'unknown', 'Âge des définitions inconnu.'));
    else if (age <= 3) checks.push(check('signatures', 'Définitions de virus', 15, 'ok', age === 0 ? 'Mises à jour aujourd’hui.' : `Mises à jour il y a ${age} jour${age > 1 ? 's' : ''}.`));
    else
      checks.push(
        check('signatures', 'Définitions de virus', 15, age <= 14 ? 'warn' : 'bad', `Dernière mise à jour il y a ${age} jours.`,
          'Lancez Windows Update ou « Rechercher des mises à jour » dans Sécurité Windows.'),
      );
  } else if (activeThird.length) {
    const outdated = activeThird.filter((p) => !decodeProductState(p.state).upToDate);
    checks.push(
      outdated.length
        ? check('signatures', 'Définitions de virus', 15, 'warn', `Les définitions de ${outdated.map((p) => p.name).join(', ')} ne sont pas à jour.`,
            'Mettez à jour votre antivirus.')
        : check('signatures', 'Définitions de virus', 15, 'ok', 'Les définitions de votre antivirus sont à jour.'),
    );
  } else {
    checks.push(check('signatures', 'Définitions de virus', 15, 'unknown', 'Aucune information sur les définitions.'));
  }

  // Pare-feu (20)
  if (raw.fw && raw.fw.length) {
    const off = raw.fw.filter((p) => !p.enabled);
    checks.push(
      off.length === 0
        ? check('firewall', 'Pare-feu', 20, 'ok', 'Le pare-feu est activé pour tous les profils réseau.')
        : check('firewall', 'Pare-feu', 20, off.length === raw.fw.length ? 'bad' : 'warn',
            `Pare-feu désactivé pour le profil ${off.map((p) => PROFILE_FR[p.name] ?? p.name).join(', ')}.`,
            'Activez le pare-feu dans Sécurité Windows › Pare-feu et protection du réseau.'),
    );
  } else {
    checks.push(check('firewall', 'Pare-feu', 20, 'unknown', "L'état du pare-feu n'a pas pu être lu."));
  }

  // SmartScreen (10) : la stratégie prime sur le réglage de l'Explorateur ; absence = activé par défaut.
  let ss: CheckStatus = 'ok';
  let ssDetail = 'SmartScreen vérifie les applications et fichiers téléchargés.';
  if (raw.ssPolicy === 0) {
    ss = 'bad';
    ssDetail = 'SmartScreen est désactivé par une stratégie.';
  } else if (raw.ssPolicy !== 1 && typeof raw.ssExplorer === 'string' && /^off$/i.test(raw.ssExplorer)) {
    ss = 'bad';
    ssDetail = 'SmartScreen est désactivé.';
  }
  checks.push(check('smartscreen', 'SmartScreen', 10, ss, ssDetail,
    'Activez « Vérifier les applications et les fichiers » dans Sécurité Windows › Contrôle des applications et du navigateur.'));

  // UAC (10)
  if (raw.lua === 0) {
    checks.push(check('uac', 'Contrôle de compte d’utilisateur', 10, 'bad', 'Le contrôle de compte d’utilisateur (UAC) est désactivé.',
      'Réactivez l’UAC dans le Panneau de configuration › Comptes d’utilisateurs.'));
  } else if (raw.lua === 1 && raw.consent === 0) {
    checks.push(check('uac', 'Contrôle de compte d’utilisateur', 10, 'warn', 'L’UAC élève les administrateurs sans demander de confirmation.',
      'Remontez le curseur des paramètres de l’UAC au niveau par défaut.'));
  } else {
    // EnableLUA absent = valeur par défaut (activé).
    checks.push(check('uac', 'Contrôle de compte d’utilisateur', 10, 'ok', 'Les modifications système demandent une autorisation.'));
  }

  // BitLocker (10)
  const bl = raw.bl;
  const blAdvice = 'Activez le chiffrement de l’appareil ou BitLocker dans Paramètres › Confidentialité et sécurité.';
  if (bl && bl.src === 'cmdlet') {
    if (/^on$/i.test(bl.status)) checks.push(check('encryption', 'Chiffrement du disque', 10, 'ok', 'Le disque système est chiffré avec BitLocker.'));
    else if (/progress/i.test(bl.vol)) checks.push(check('encryption', 'Chiffrement du disque', 10, 'warn', 'Chiffrement BitLocker en cours.'));
    else checks.push(check('encryption', 'Chiffrement du disque', 10, 'warn', 'Le disque système n’est pas chiffré.', blAdvice));
  } else if (bl && bl.src === 'shell' && typeof bl.value === 'number' && bl.value > 0) {
    // 1 = protégé, 3 = chiffrement en cours, 2 / autres = non protégé.
    if (bl.value === 1) checks.push(check('encryption', 'Chiffrement du disque', 10, 'ok', 'Le disque système est chiffré avec BitLocker.'));
    else if (bl.value === 3) checks.push(check('encryption', 'Chiffrement du disque', 10, 'warn', 'Chiffrement BitLocker en cours.'));
    else checks.push(check('encryption', 'Chiffrement du disque', 10, 'warn', 'Le disque système n’est pas chiffré.', blAdvice));
  } else {
    checks.push(check('encryption', 'Chiffrement du disque', 10, 'unknown', 'État du chiffrement non disponible sans droits administrateur.'));
  }

  // Protection contre les falsifications (5)
  if (defenderActive && mp && typeof mp.tamper === 'boolean') {
    checks.push(
      mp.tamper
        ? check('tamper', 'Protection contre les falsifications', 5, 'ok', 'Les réglages de Defender sont protégés.')
        : check('tamper', 'Protection contre les falsifications', 5, 'warn', 'Les réglages de Defender peuvent être modifiés par des programmes.',
            'Activez la protection contre les falsifications dans Sécurité Windows › Protection contre les virus et menaces.'),
    );
  } else {
    checks.push(check('tamper', 'Protection contre les falsifications', 5, 'unknown', 'Non applicable avec cet antivirus.'));
  }
  return checks;
}

async function windowsReport(): Promise<ProtectionCheck[]> {
  const r = await runPowerShell(WIN_SCRIPT, { timeoutMs: 45_000 });
  let raw: WinRaw = {};
  try {
    raw = JSON.parse(r.stdout.trim()) as WinRaw;
  } catch {
    /* tout sera « inconnu » */
  }
  return windowsChecks(raw);
}

/* ───────────── macOS ───────────── */

async function macReport(): Promise<ProtectionCheck[]> {
  const opt = { timeoutMs: 10_000 };
  const [gk, sip, xp, fw, fv] = await Promise.all([
    run('/usr/sbin/spctl', ['--status'], opt),
    run('/usr/bin/csrutil', ['status'], opt),
    run('/usr/bin/defaults', ['read', '/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist', 'CFBundleShortVersionString'], opt),
    run('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate'], opt),
    run('/usr/bin/fdesetup', ['status'], opt),
  ]);
  const out = (x: { stdout: string; stderr: string }): string => (x.stdout + x.stderr).toLowerCase();
  const checks: Check[] = [];

  const g = out(gk);
  checks.push(
    g.includes('assessments enabled')
      ? check('gatekeeper', 'Gatekeeper', 20, 'ok', 'Seules les apps vérifiées peuvent s’ouvrir.')
      : g.includes('assessments disabled')
        ? check('gatekeeper', 'Gatekeeper', 20, 'bad', 'Gatekeeper est désactivé.', 'Réactivez-le avec « sudo spctl --master-enable ».')
        : check('gatekeeper', 'Gatekeeper', 20, 'unknown', 'État de Gatekeeper inconnu.'),
  );

  const s = out(sip);
  checks.push(
    /status:\s*enabled/.test(s)
      ? check('sip', 'Protection de l’intégrité du système', 25, 'ok', 'Les fichiers système sont protégés (SIP).')
      : /status:\s*disabled/.test(s)
        ? check('sip', 'Protection de l’intégrité du système', 25, 'bad', 'SIP est désactivé.', 'Réactivez SIP depuis le mode de récupération (csrutil enable).')
        : /custom|unknown/.test(s)
          ? check('sip', 'Protection de l’intégrité du système', 25, 'warn', 'SIP est partiellement désactivé.', 'Réactivez SIP complètement depuis le mode de récupération.')
          : check('sip', 'Protection de l’intégrité du système', 25, 'unknown', 'État de SIP inconnu.'),
  );

  const ver = xp.code === 0 ? xp.stdout.trim() : '';
  checks.push(
    ver
      ? check('xprotect', 'XProtect', 15, 'ok', `Protection anti-logiciels malveillants intégrée (version ${ver}).`)
      : check('xprotect', 'XProtect', 15, 'unknown', 'Version de XProtect introuvable.'),
  );

  const f = out(fw);
  checks.push(
    /enabled|state = [12]/.test(f)
      ? check('firewall', 'Pare-feu', 20, 'ok', 'Le pare-feu applicatif est activé.')
      : /disabled|state = 0/.test(f)
        ? check('firewall', 'Pare-feu', 20, 'warn', 'Le pare-feu applicatif est désactivé.', 'Activez-le dans Réglages › Réseau › Coupe-feu.')
        : check('firewall', 'Pare-feu', 20, 'unknown', 'État du pare-feu inconnu.'),
  );

  const v = out(fv);
  checks.push(
    v.includes('filevault is on')
      ? check('encryption', 'FileVault', 20, 'ok', 'Le disque de démarrage est chiffré.')
      : v.includes('filevault is off')
        ? check('encryption', 'FileVault', 20, 'bad', 'Le disque de démarrage n’est pas chiffré.', 'Activez FileVault dans Réglages › Confidentialité et sécurité.')
        : check('encryption', 'FileVault', 20, 'unknown', 'État de FileVault inconnu.'),
  );
  return checks;
}

export async function protectionReportImpl(): Promise<ProtectionReport> {
  let checks: ProtectionCheck[] = [];
  try {
    if (process.platform === 'win32') checks = await windowsReport();
    else if (process.platform === 'darwin') checks = await macReport();
  } catch {
    checks = [];
  }
  return { checkedAt: Date.now(), score: scoreOf(checks), checks };
}
