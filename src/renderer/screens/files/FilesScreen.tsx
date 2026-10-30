/** Écran « Fichiers » : carte d'espace, fichiers volumineux, doublons. */
import { ScreenHead, Segmented } from '../../components/ui';
import { navStore, type FilesTab } from '../../nav';
import { useStore } from '../../state/createStore';
import { Duplicates } from './Duplicates';
import { LargeFiles } from './LargeFiles';
import { SpaceMap } from './SpaceMap';
import './files.css';

const TABS: Array<{ value: FilesTab; label: string }> = [
  { value: 'map', label: "Carte d'espace" },
  { value: 'large', label: 'Volumineux' },
  { value: 'duplicates', label: 'Doublons' },
];

const TITLES: Record<FilesTab, { eyebrow: string; title: string }> = {
  map: { eyebrow: 'Fichiers — où va l’espace', title: "Carte d'espace" },
  large: { eyebrow: 'Fichiers — au-delà du seuil', title: 'Fichiers volumineux' },
  duplicates: { eyebrow: 'Fichiers — contenu identique', title: 'Doublons' },
};

export function FilesScreen() {
  const { filesTab } = useStore(navStore);
  const t = TITLES[filesTab];
  return (
    <div className="screen fs-screen">
      <ScreenHead
        eyebrow={t.eyebrow}
        title={t.title}
        right={<Segmented<FilesTab> label="Vue" value={filesTab} options={TABS} onChange={(v) => navStore.set({ filesTab: v })} />}
      />
      {filesTab === 'map' && <SpaceMap />}
      {filesTab === 'large' && <LargeFiles />}
      {filesTab === 'duplicates' && <Duplicates />}
    </div>
  );
}
