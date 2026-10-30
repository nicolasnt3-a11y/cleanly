/** Coquille de l'application : barre supérieure (concept minimaliste), fond de brume, écran courant. */
import { useEffect, type ComponentType } from 'react';
import { Icon, Logo, type IconName } from './components/icons';
import { IconButton } from './components/ui';
import { MistShader } from './components/MistShader';
import { navigate, navStore, type ScreenId } from './nav';
import { useStore } from './state/createStore';
import { appStore, loadAppInfo, loadSettings, settingsStore } from './state/stores';
import { isDemo } from './api';
import { formatBytes } from './lib/format';
import { HomeScreen } from './screens/home/HomeScreen';
import { CleanupScreen } from './screens/cleanup/CleanupScreen';
import { FilesScreen } from './screens/files/FilesScreen';
import { SpeedScreen } from './screens/speed/SpeedScreen';
import { AppsScreen } from './screens/apps/AppsScreen';
import { ProtectionScreen } from './screens/protection/ProtectionScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';
import { FeedbackScreen } from './screens/feedback/FeedbackScreen';
import { TipScreen } from './screens/tip/TipScreen';
import './app.css';

const SCREENS: Record<ScreenId, ComponentType> = {
  home: HomeScreen,
  cleanup: CleanupScreen,
  files: FilesScreen,
  speed: SpeedScreen,
  apps: AppsScreen,
  protection: ProtectionScreen,
  settings: SettingsScreen,
  feedback: FeedbackScreen,
  tip: TipScreen,
};

const MAIN_NAV: Array<{ id: ScreenId; label: string; icon: IconName }> = [
  { id: 'home', label: 'Smart Scan', icon: 'scan' },
  { id: 'cleanup', label: 'Nettoyage', icon: 'clean' },
  { id: 'files', label: 'Fichiers', icon: 'files' },
  { id: 'speed', label: 'Vitesse', icon: 'speed' },
  { id: 'apps', label: 'Applications', icon: 'apps' },
  { id: 'protection', label: 'Protection', icon: 'shield' },
];

export function App() {
  const { screen } = useStore(navStore);
  const { info, drives } = useStore(appStore);
  const { settings } = useStore(settingsStore);

  useEffect(() => {
    void loadAppInfo();
    void loadSettings();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('platform-win32', info?.platform === 'win32');
    root.classList.toggle('platform-darwin', info?.platform === 'darwin');
    root.classList.toggle('is-demo', isDemo);
  }, [info]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('motion-reduced', settings?.motion === 'reduced');
    root.classList.toggle('motion-full', settings?.motion === 'full');
  }, [settings?.motion]);

  const sys = drives.find((d) => d.isSystem) ?? drives[0];
  const Screen = SCREENS[screen];

  return (
    <div className="shell">
      <MistShader />
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span className="brand-name">Cleanly</span>
          {isDemo && <span className="badge accent">Démo</span>}
        </div>
        <nav className="mainnav" aria-label="Navigation principale">
          {MAIN_NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={n.id === screen ? 'nav on' : 'nav'}
              aria-current={n.id === screen ? 'page' : undefined}
              onClick={() => navigate(n.id)}
            >
              <Icon name={n.icon} size={18} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="topbar-r">
          {sys && (
            <button type="button" className="drivemini" onClick={() => navigate('files', { filesTab: 'map' })} title="Carte d'espace">
              <span className="mono">
                {sys.mount.replace(/\\$/, '')} {formatBytes(sys.freeBytes)} libres
              </span>
              <span className="drivemini-bar">
                <i style={{ width: `${((sys.totalBytes - sys.freeBytes) / Math.max(1, sys.totalBytes)) * 100}%` }} />
              </span>
            </button>
          )}
          <IconButton icon="settings" label="Paramètres" onClick={() => navigate('settings')} className={screen === 'settings' ? 'on' : undefined} />
          <IconButton icon="feedback" label="Donner votre avis" onClick={() => navigate('feedback')} className={screen === 'feedback' ? 'on' : undefined} />
          <IconButton icon="heart" label="Soutenir Cleanly" onClick={() => navigate('tip')} className={screen === 'tip' ? 'on' : undefined} />
        </div>
      </header>
      <main className="content" key={screen}>
        <Screen />
      </main>
    </div>
  );
}
