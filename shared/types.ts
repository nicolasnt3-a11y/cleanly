/**
 * Cleanly — contrat de données partagé.
 *
 * Ce fichier est l'UNIQUE source de vérité pour :
 *  - tous les types échangés entre le processus principal Electron et l'interface ;
 *  - la liste des canaux IPC, leurs arguments et leurs résultats ;
 *  - les événements poussés du processus principal vers l'interface.
 *
 * Règle de sécurité fondamentale : l'interface ne transmet JAMAIS de chemin à
 * supprimer. Elle transmet des identifiants (catégorie, élément de scan, entrée
 * de démarrage, application) que le processus principal résout lui-même à partir
 * de son propre état, puis revalide (realpath + règles de sécurité).
 *
 * Ce fichier ne doit contenir que des types et des constantes sans dépendance
 * (il est importé par le main, le preload sandboxé et le renderer).
 */

/* ────────────────────────────── Base ────────────────────────────── */

export type Platform = 'win32' | 'darwin' | 'linux';
/** Taille en octets. */
export type Bytes = number;
/** Horodatage en millisecondes depuis l'époque Unix. */
export type EpochMs = number;

export interface AppInfo {
  name: string;
  version: string;
  platform: Platform;
  arch: string;
  /** Version du système, lisible (ex. « Windows 11 Pro 24H2 », « macOS 15.1 »). */
  osLabel: string;
  /** true si l'application tourne dans la démo navigateur avec données fictives. */
  isDemo: boolean;
  /** true si l'application est empaquetée (pas en développement). */
  isPackaged: boolean;
}

/** Résultat générique d'une opération qui peut échouer proprement. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/* ──────────────────────────── Disques ──────────────────────────── */

export type DriveKind = 'fixed' | 'removable' | 'network' | 'unknown';

export interface DriveInfo {
  /** Identifiant opaque (ex. « C: » sous Windows, « / » ou point de montage sous macOS). */
  id: string;
  /** Point de montage affiché (« C:\\ », « / », « /Volumes/Data »). */
  mount: string;
  label: string;
  kind: DriveKind;
  totalBytes: Bytes;
  freeBytes: Bytes;
  /** true pour le disque système (C: / volume de démarrage). */
  isSystem: boolean;
}

/** Répartition simplifiée du disque système pour la mini-carte de l'accueil. */
export interface DiskBreakdown {
  drive: DriveInfo;
  segments: Array<{
    id: 'system' | 'apps' | 'user' | 'reclaimable' | 'other' | 'free';
    label: string;
    bytes: Bytes;
  }>;
}

/* ─────────────────────────── Nettoyage ─────────────────────────── */

export type WinCleanCategoryId =
  | 'win-user-temp'
  | 'win-system-temp'
  | 'browser-cache'
  | 'app-cache'
  | 'crash-dumps'
  | 'win-update'
  | 'dev-cache'
  | 'recycle-bin'
  | 'old-downloads';

export type MacCleanCategoryId =
  | 'mac-user-caches'
  | 'mac-logs'
  | 'browser-cache'
  | 'xcode-derived-data'
  | 'dev-cache'
  | 'mac-trash'
  | 'old-downloads';

export type CleanCategoryId = WinCleanCategoryId | MacCleanCategoryId;

/**
 * - `permanent` : contenu régénérable (caches, temporaires, journaux) supprimé définitivement ;
 *   l'envoyer à la corbeille ne libérerait aucun espace.
 * - `trash` : fichiers propres à l'utilisateur, TOUJOURS envoyés à la corbeille système.
 * - `empty-bin` : vidage de la Corbeille système via l'API dédiée du système.
 */
export type DeleteMode = 'permanent' | 'trash' | 'empty-bin';

/** Un élément trouvé lors d'une analyse (fichier ou dossier agrégé). */
export interface ScanItem {
  /** Identifiant opaque, valable uniquement pour le `scanId` qui l'a produit. */
  id: string;
  /** Chemin affiché (informatif — jamais renvoyé au main pour suppression). */
  path: string;
  name: string;
  sizeBytes: Bytes;
  modifiedAt: EpochMs;
  isDirectory: boolean;
}

export interface CleanCategory {
  id: CleanCategoryId;
  label: string;
  description: string;
  mode: DeleteMode;
  sizeBytes: Bytes;
  fileCount: number;
  /** Éléments les plus volumineux (au plus 50) pour l'aperçu et l'assistant IA. */
  topItems: ScanItem[];
  /** Fichiers ignorés car verrouillés ou inaccessibles pendant l'analyse. */
  lockedCount: number;
  /** Fichiers ignorés car modifiés il y a moins de 24 h (catégories temporaires). */
  recentSkippedCount: number;
  /** true si la suppression complète exige des droits administrateur. */
  requiresAdmin: boolean;
  /** Sélectionnée par défaut dans le Smart Scan (false pour corbeille / anciens téléchargements). */
  defaultSelected: boolean;
  /** Message d'erreur si l'analyse de cette catégorie a échoué. */
  error?: string;
}

export type ScanPhase = 'idle' | 'cleanup' | 'apps' | 'startup' | 'protection' | 'disk' | 'done';

export interface ScanProgress {
  /** Identifiant de la tâche (smart scan, carte d'espace, gros fichiers, doublons). */
  task: 'smart-scan' | 'space-map' | 'large-files' | 'duplicates' | 'clean';
  phase: ScanPhase | 'walking' | 'hashing-partial' | 'hashing-full' | 'deleting';
  /** 0..1, ou null si indéterminé. */
  fraction: number | null;
  /** Chemin en cours (affichage uniquement). */
  currentPath?: string;
  bytesFound: Bytes;
  itemsVisited: number;
}

export interface StartupSummary {
  enabledCount: number;
  highImpactCount: number;
}

export interface AppsSummary {
  installedCount: number;
  totalBytes: Bytes;
  /** Applications non utilisées depuis au moins 180 jours (si l'information existe). */
  unusedCount: number;
}

export interface ProtectionSummary {
  score: number;
  issues: number;
}

export interface SmartScanResult {
  scanId: string;
  scannedAt: EpochMs;
  durationMs: number;
  categories: CleanCategory[];
  /** Somme des catégories sélectionnées par défaut. */
  reclaimableBytes: Bytes;
  disk: DiskBreakdown;
  startup: StartupSummary;
  apps: AppsSummary;
  protection: ProtectionSummary;
}

export interface CleanRequest {
  /** Résultat de scan de référence. */
  scanId: string;
  /** Catégories à nettoyer. Le main redérive lui-même leurs emplacements. */
  categoryIds: CleanCategoryId[];
  /**
   * Éléments (ids de `topItems`) que l'utilisateur a décochés.
   * Ne peut que RETIRER des éléments : jamais en ajouter.
   */
  excludedItemIds?: string[];
}

export interface CleanResult {
  freedBytes: Bytes;
  deletedCount: number;
  trashedCount: number;
  /** Fichiers verrouillés / en cours d'utilisation, ignorés. */
  lockedCount: number;
  /** Fichiers temporaires récents (< 24 h), ignorés. */
  recentSkippedCount: number;
  /** Chemins refusés par les règles de sécurité. */
  unsafeRejectedCount: number;
  /** Catégories ignorées car elles exigent des droits administrateur. */
  needsAdminCategoryIds: CleanCategoryId[];
  errors: string[];
}

/* ───────────────────────── Carte d'espace ───────────────────────── */

/** Racine de la carte : le dossier personnel ou un lecteur fixe (`DriveInfo.id`). */
export type SpaceRoot = { kind: 'home' } | { kind: 'drive'; driveId: string };

export interface SpaceNode {
  /** Identifiant opaque, valable pour le `mapId` qui l'a produit. */
  id: string;
  name: string;
  /** Chemin affiché. */
  path: string;
  sizeBytes: Bytes;
  isDirectory: boolean;
  /** true si on peut descendre dans ce nœud. */
  hasChildren: boolean;
  /** Nombre de fichiers agrégés (approximatif). */
  fileCount: number;
}

export interface SpaceLevel {
  mapId: string;
  root: SpaceRoot;
  /** Nœud courant (racine si `parentId` absent). */
  node: SpaceNode;
  /** Enfants triés par taille décroissante (au plus 60 ; le reste agrégé en « Autres »). */
  children: SpaceNode[];
  /** Fil d'Ariane, de la racine au nœud courant. */
  crumbs: Array<{ id: string; name: string }>;
  /** Éléments ignorés (accès refusé, verrouillés). */
  skippedCount: number;
  /** true si le parcours était partiel (annulé ou limite de temps). */
  partial: boolean;
}

/* ─────────────────── Fichiers volumineux & doublons ─────────────────── */

export interface LargeFilesRequest {
  root: SpaceRoot;
  /** Taille minimale en octets (défaut : 100 Mo). */
  minBytes?: Bytes;
  /** Nombre maximal de résultats (défaut : 200). */
  limit?: number;
}

export interface LargeFilesResult {
  scanId: string;
  items: Array<ScanItem & { kind: FileKind }>;
  skippedCount: number;
}

export type FileKind = 'video' | 'image' | 'audio' | 'archive' | 'disk-image' | 'installer' | 'document' | 'code' | 'other';

export interface DuplicatesRequest {
  root: SpaceRoot;
  /** Taille minimale en octets (défaut : 1 Mo). */
  minBytes?: Bytes;
}

export interface DuplicateGroup {
  id: string;
  /** Empreinte SHA-256 complète du contenu. */
  hash: string;
  sizeBytes: Bytes;
  /** Au moins deux fichiers identiques. Le premier est l'original suggéré (le plus ancien). */
  files: ScanItem[];
  /** Espace récupérable si l'on ne garde qu'un exemplaire. */
  wastedBytes: Bytes;
}

export interface DuplicatesResult {
  scanId: string;
  groups: DuplicateGroup[];
  totalWastedBytes: Bytes;
  /** Statistiques des étapes : taille → empreinte partielle → empreinte complète. */
  stats: { candidatesBySize: number; candidatesByPartialHash: number; confirmed: number };
  skippedCount: number;
}

/** Envoi à la corbeille d'éléments issus d'un scan (gros fichiers, doublons, carte d'espace). */
export interface TrashItemsRequest {
  scanId: string;
  itemIds: string[];
}

export interface TrashItemsResult {
  trashedCount: number;
  freedBytes: Bytes;
  failed: Array<{ itemId: string; reason: string }>;
}

/* ───────────────────────────── Vitesse ───────────────────────────── */

export type StartupLocation =
  | 'hkcu-run'
  | 'hklm-run'
  | 'hklm-run32'
  | 'startup-folder-user'
  | 'startup-folder-common'
  | 'mac-launch-agent-user'
  | 'mac-launch-agent-global'
  | 'mac-login-item';

export type Impact = 'high' | 'medium' | 'low' | 'unknown';

export interface StartupItem {
  /** Identifiant opaque (le main relit la source avant toute modification). */
  id: string;
  name: string;
  /** Commande lancée (affichage). */
  command: string;
  publisher?: string;
  location: StartupLocation;
  /** `machine` = pour tous les utilisateurs : nécessite une élévation (UAC). */
  scope: 'user' | 'machine';
  enabled: boolean;
  /** true si la bascule nécessite une invite d'élévation. */
  requiresAdmin: boolean;
  /** true si la bascule n'est pas prise en charge pour cet élément. */
  readOnly: boolean;
  impact: Impact;
  /** Icône (data URL PNG) si disponible localement. */
  iconDataUrl?: string;
}

export interface StartupToggleRequest {
  id: string;
  enabled: boolean;
}

export interface StartupToggleResult {
  /** État RELU dans la source après l'opération (jamais déduit d'un code de sortie). */
  item: StartupItem;
  /** true si l'état relu correspond à l'état demandé. */
  applied: boolean;
  /** true si l'utilisateur a refusé l'invite d'élévation (ou si elle a échoué). */
  elevationDeclined?: boolean;
  message?: string;
}

/* ─────────────────────────── Applications ─────────────────────────── */

export interface InstalledApp {
  /** Identifiant opaque (clé de registre ou chemin du .app, connu du main uniquement). */
  id: string;
  name: string;
  publisher?: string;
  version?: string;
  sizeBytes?: Bytes;
  installedAt?: EpochMs;
  lastUsedAt?: EpochMs;
  iconDataUrl?: string;
  /** Emplacement affiché (dossier d'installation ou chemin du .app). */
  location?: string;
  /** false pour les composants système ou les applications sans désinstallateur. */
  canUninstall: boolean;
  /** true si l'application est Cleanly elle-même. */
  isSelf: boolean;
}

export interface UninstallResult {
  /**
   * Windows : le désinstallateur de l'éditeur a été lancé (il peut afficher sa propre UI).
   * macOS : le .app a été déplacé dans la Corbeille.
   */
  started: boolean;
  /** true si l'application n'apparaît plus dans la liste après relecture. */
  removed: boolean;
  message: string;
}

/* ─────────────────────────── Protection ─────────────────────────── */

export type CheckStatus = 'ok' | 'warn' | 'bad' | 'unknown';

export interface ProtectionCheck {
  id: string;
  label: string;
  detail: string;
  status: CheckStatus;
  /** Poids dans le score (somme des poids = 100). */
  weight: number;
  /** Conseil si le statut n'est pas « ok ». */
  advice?: string;
}

export interface ProtectionReport {
  checkedAt: EpochMs;
  /** 0..100. */
  score: number;
  checks: ProtectionCheck[];
}

/* ─────────────────────────── Assistant IA ─────────────────────────── */

export type AiProvider = 'anthropic' | 'openai';
export type AiVerdictKind = 'safe' | 'review' | 'keep';

/**
 * Ce qui est envoyé au modèle : UNIQUEMENT nom, chemin, taille, date et catégorie.
 * Jamais le contenu des fichiers.
 */
export interface AiReviewItem {
  /** Identifiant (id de ScanItem) — utilisé pour rattacher le verdict. */
  id: string;
  path: string;
  name: string;
  sizeBytes: Bytes;
  modifiedAt?: EpochMs;
  /** Contexte : catégorie de nettoyage ou « large-file » / « duplicate ». */
  context: CleanCategoryId | 'large-file' | 'duplicate' | 'space-map';
}

export interface AiVerdict {
  id: string;
  verdict: AiVerdictKind;
  /** Justification courte en français (≤ 140 caractères). */
  reason: string;
}

export interface AiReviewRequest {
  items: AiReviewItem[];
}

export interface AiReviewResult {
  provider: AiProvider;
  model: string;
  verdicts: AiVerdict[];
  /** Synthèse en une ou deux phrases. */
  summary: string;
}

/* ──────────────────────────── Paramètres ──────────────────────────── */

export type MotionPreference = 'system' | 'reduced' | 'full';

export interface Settings {
  aiProvider: AiProvider | null;
  /** Modèle choisi par fournisseur (null = défaut recommandé). */
  aiModel: { anthropic: string | null; openai: string | null };
  /** Indique seulement la présence d'une clé : la clé elle-même ne quitte jamais le main. */
  hasApiKey: { anthropic: boolean; openai: boolean };
  /** false si safeStorage n'est pas disponible (la clé ne pourra pas être enregistrée). */
  encryptionAvailable: boolean;
  motion: MotionPreference;
  /** Seuil « anciens téléchargements » en jours (défaut 90, minimum 30). */
  oldDownloadsDays: number;
  /** Seuil « fichiers volumineux » en Mo (défaut 100). */
  largeFileMinMb: number;
  /** Demander confirmation avant chaque nettoyage. */
  confirmBeforeClean: boolean;
}

export type SettingsPatch = Partial<
  Pick<Settings, 'aiProvider' | 'aiModel' | 'motion' | 'oldDownloadsDays' | 'largeFileMinMb' | 'confirmBeforeClean'>
>;

export interface SetApiKeyRequest {
  provider: AiProvider;
  /** null pour effacer la clé. */
  apiKey: string | null;
}

export interface TestApiKeyResult {
  ok: boolean;
  model?: string;
  message: string;
}

/* ─────────────────────── Retour d'expérience & soutien ─────────────────────── */

export interface FeedbackRequest {
  kind: 'bug' | 'idea' | 'praise' | 'other';
  message: string;
  /** Adresse facultative pour être recontacté. */
  email?: string;
  /** Joindre la version de l'app et de l'OS (aucune donnée de fichier). */
  includeDiagnostics: boolean;
}

export interface FeedbackResult {
  /** Comment le retour a été transmis (ouverture d'un formulaire HTTPS dans le navigateur). */
  delivered: 'browser';
  message: string;
}

export interface TipOption {
  id: string;
  label: string;
  description: string;
  /** URL HTTPS ouverte dans le navigateur système. */
  url: string;
}

/* ──────────────────────────── Contrat IPC ──────────────────────────── */

/**
 * Chaque canal : arguments (tuple) et résultat (résolu par la promesse `invoke`).
 * Le main valide CHAQUE argument à l'exécution : ces types ne sont qu'une promesse.
 */
export interface IpcContract {
  'app:info': { args: []; result: AppInfo };
  /** Ouvre une URL HTTPS dans le navigateur système. Toute autre URL est refusée. */
  'app:open-external': { args: [url: string]; result: Result<null> };
  /** Affiche un élément de scan dans l'Explorateur / le Finder. */
  'app:reveal-item': { args: [scanId: string, itemId: string]; result: Result<null> };

  'disk:drives': { args: []; result: DriveInfo[] };

  'scan:smart': { args: []; result: SmartScanResult };
  'scan:cancel': { args: []; result: null };
  'clean:run': { args: [request: CleanRequest]; result: CleanResult };

  'space:level': { args: [root: SpaceRoot, nodeId: string | null]; result: SpaceLevel };
  'files:large': { args: [request: LargeFilesRequest]; result: LargeFilesResult };
  'files:duplicates': { args: [request: DuplicatesRequest]; result: DuplicatesResult };
  'files:trash': { args: [request: TrashItemsRequest]; result: TrashItemsResult };

  'startup:list': { args: []; result: StartupItem[] };
  'startup:toggle': { args: [request: StartupToggleRequest]; result: StartupToggleResult };

  'apps:list': { args: []; result: InstalledApp[] };
  'apps:uninstall': { args: [appId: string]; result: UninstallResult };

  'protection:report': { args: []; result: ProtectionReport };

  'ai:review': { args: [request: AiReviewRequest]; result: Result<AiReviewResult> };
  'ai:test-key': { args: [provider: AiProvider]; result: TestApiKeyResult };

  'settings:get': { args: []; result: Settings };
  'settings:update': { args: [patch: SettingsPatch]; result: Settings };
  'settings:set-api-key': { args: [request: SetApiKeyRequest]; result: Result<Settings> };

  'feedback:send': { args: [request: FeedbackRequest]; result: Result<FeedbackResult> };
  'tip:options': { args: []; result: TipOption[] };
}

export type IpcChannel = keyof IpcContract;
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args'];
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result'];

/** Liste exhaustive des canaux (le preload n'expose que ceux-ci). */
export const IPC_CHANNELS = [
  'app:info',
  'app:open-external',
  'app:reveal-item',
  'disk:drives',
  'scan:smart',
  'scan:cancel',
  'clean:run',
  'space:level',
  'files:large',
  'files:duplicates',
  'files:trash',
  'startup:list',
  'startup:toggle',
  'apps:list',
  'apps:uninstall',
  'protection:report',
  'ai:review',
  'ai:test-key',
  'settings:get',
  'settings:update',
  'settings:set-api-key',
  'feedback:send',
  'tip:options',
] as const satisfies readonly IpcChannel[];

/* Garantit à la compilation que IPC_CHANNELS couvre tout le contrat. */
type _MissingChannels = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>;
const _exhaustive: [_MissingChannels] extends [never] ? true : _MissingChannels = true;
void _exhaustive;

/* ─────────────────────── Événements main → interface ─────────────────────── */

export interface IpcEvents {
  'event:progress': ScanProgress;
}

export type IpcEventName = keyof IpcEvents;
export const IPC_EVENTS = ['event:progress'] as const satisfies readonly IpcEventName[];

/* ───────────────────── API exposée à l'interface (preload) ───────────────────── */

export type Unsubscribe = () => void;

/** Ce que le preload expose sur `window.cleanly` (et ce que la démo navigateur simule). */
export interface CleanlyApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>>;
  on<E extends IpcEventName>(event: E, listener: (payload: IpcEvents[E]) => void): Unsubscribe;
}

declare global {
  interface Window {
    /** Présent uniquement dans l'application Electron (absent dans la démo navigateur). */
    cleanly?: CleanlyApi;
  }
}
