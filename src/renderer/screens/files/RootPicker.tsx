/** Choix de la racine analysée : dossier personnel ou lecteur fixe. Partagé entre les trois onglets. */
import { Segmented } from '../../components/ui';
import { useStore } from '../../state/createStore';
import { appStore } from '../../state/stores';
import { filesStore, rootOptions, setRootKey } from './filesState';

export function RootPicker({ disabled }: { disabled?: boolean }) {
  const { drives } = useStore(appStore);
  const { rootKey } = useStore(filesStore);
  const options = rootOptions(drives);
  return (
    <div className={disabled ? 'fs-root is-disabled' : 'fs-root'} aria-disabled={disabled || undefined}>
      <span className="mono">Racine</span>
      <Segmented label="Emplacement analysé" value={rootKey} options={options} onChange={(v) => !disabled && setRootKey(v)} />
    </div>
  );
}
