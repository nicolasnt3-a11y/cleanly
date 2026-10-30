/**
 * Exécution de processus externes — le SEUL point d'entrée autorisé.
 *
 * Règles :
 *  - toujours execFile (jamais de shell, jamais de chaîne de commande construite) ;
 *  - toujours un délai d'expiration et windowsHide ;
 *  - la sortie de reg.exe / des outils console Windows est dans la page de codes OEM
 *    (ex. 866 sur un Windows russe) : la décoder avec decodeOem() ;
 *  - PowerShell : script passé via -EncodedCommand (UTF-16LE base64), sortie forcée en UTF-8.
 *    Toute valeur dynamique insérée dans un script DOIT passer par psQuote().
 */
import { execFile } from 'node:child_process';
import iconv from 'iconv-lite';

export type OutputEncoding = 'utf8' | 'oem' | 'utf16le';

export interface RunOptions {
  /** Délai d'expiration en ms (défaut 30 s). */
  timeoutMs?: number;
  encoding?: OutputEncoding;
  /** Taille maximale de sortie en octets (défaut 32 Mo). */
  maxBuffer?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  /** Code de sortie (null si tué par signal ou délai dépassé). */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Erreur de lancement (exécutable introuvable, etc.). */
  spawnError?: string;
}

let oemCodePage: number | null = null;

/** Page de codes OEM de la console Windows (437, 850, 866…), mise en cache. */
export async function getOemCodePage(): Promise<number> {
  if (oemCodePage !== null) return oemCodePage;
  oemCodePage = 437;
  if (process.platform !== 'win32') return oemCodePage;
  // La sortie de cette requête ne contient que de l'ASCII : sûre à lire en latin1.
  const r = await runRaw('reg.exe', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'OEMCP'], {
    timeoutMs: 10_000,
  });
  const m = /OEMCP\s+REG_SZ\s+(\d+)/i.exec(r.stdout.toString('latin1'));
  if (m?.[1]) {
    const cp = Number(m[1]);
    if (iconv.encodingExists('cp' + cp)) oemCodePage = cp;
  }
  return oemCodePage;
}

/** Décode un tampon produit par un outil console Windows. */
export function decodeOem(buf: Buffer, codePage: number): string {
  const enc = 'cp' + codePage;
  return iconv.encodingExists(enc) ? iconv.decode(buf, enc) : buf.toString('latin1');
}

interface RawResult {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  spawnError?: string;
}

function runRaw(file: string, args: readonly string[], opts: RunOptions = {}): Promise<RawResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        encoding: 'buffer',
        timeout: opts.timeoutMs ?? 30_000,
        maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
        windowsHide: true,
        shell: false,
        cwd: opts.cwd,
        env: opts.env,
      },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string; signal?: string }) | null;
        const timedOut = !!err && err.killed === true && err.signal === 'SIGTERM';
        let code: number | null = 0;
        let spawnError: string | undefined;
        if (err) {
          if (typeof err.code === 'number') code = err.code;
          else {
            code = null;
            if (typeof err.code === 'string') spawnError = err.code;
          }
        }
        resolve({ code, stdout: stdout ?? Buffer.alloc(0), stderr: stderr ?? Buffer.alloc(0), timedOut, spawnError });
      },
    );
  });
}

/** Lance un exécutable avec des arguments (aucun shell) et décode sa sortie. */
export async function run(file: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  const raw = await runRaw(file, args, opts);
  const encoding = opts.encoding ?? 'utf8';
  let decode: (b: Buffer) => string;
  if (encoding === 'oem') {
    const cp = await getOemCodePage();
    decode = (b) => decodeOem(b, cp);
  } else if (encoding === 'utf16le') {
    decode = (b) => b.toString('utf16le').replace(/^\uFEFF/, '');
  } else {
    decode = (b) => b.toString('utf8').replace(/^\uFEFF/, '');
  }
  return {
    code: raw.code,
    stdout: decode(raw.stdout),
    stderr: decode(raw.stderr),
    timedOut: raw.timedOut,
    spawnError: raw.spawnError,
  };
}

/** Échappe une valeur en littéral PowerShell entre apostrophes ('…'). */
export function psQuote(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error('Valeur refusée pour PowerShell (caractère de contrôle).');
  // PowerShell accepte aussi les apostrophes typographiques comme délimiteurs : on les double toutes.
  return "'" + value.replace(/['\u2018\u2019\u201A\u201B]/g, (c) => c + c) + "'";
}

/** Chemin absolu de Windows PowerShell 5.1 (évite toute résolution via PATH). */
export function powershellPath(): string {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

/** Chemin absolu de reg.exe. */
export function regExePath(): string {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return `${root}\\System32\\reg.exe`;
}

/**
 * Exécute un script PowerShell (Windows uniquement). Le script est encodé en base64
 * (UTF-16LE) et la sortie forcée en UTF-8. Ne JAMAIS concaténer d'entrée non échappée :
 * utiliser psQuote() pour chaque valeur dynamique.
 */
export async function runPowerShell(script: string, opts: Omit<RunOptions, 'encoding'> = {}): Promise<RunResult> {
  const prelude =
    "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';" +
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8;';
  const encoded = Buffer.from(prelude + script, 'utf16le').toString('base64');
  return run(
    powershellPath(),
    ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { ...opts, encoding: 'utf8', timeoutMs: opts.timeoutMs ?? 60_000 },
  );
}
