import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { biometricAvailable, biometricKey, enrollBiometric } from '../../auth/biometric';
import { isDefaultVault } from '../../domain/locks';
import { hashPin, MIN_PIN_LENGTH } from '../../domain/pin';
import type { Vault } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { SyncOffline } from '../../sync/engine';
import { createVault, updateVault, type VaultChanges } from '../../sync/http';
import { CardRow, Empty, Page, Section, useNewNote } from '../components';
import { Icon } from '../Icon';
import { LockPanel } from '../LockPanel';
import { useToast } from '../Toast';
import { VaultPeopleSection } from './people';

const pinError = `Use at least ${MIN_PIN_LENGTH} characters.`;

function useVaultSaver() {
  const { repo } = useCards();
  const toast = useToast();
  return async (run: () => Promise<Vault>, done?: string): Promise<boolean> => {
    try {
      await repo.putVaults([await run()]);
      if (done) toast(done);
      return true;
    } catch (err) {
      toast(err instanceof SyncOffline ? 'Connect to the internet to change a vault.' : "That change couldn't be saved.");
      return false;
    }
  };
}

function CreateVaultForm() {
  const save = useVaultSaver();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (pin && pin.length < MIN_PIN_LENGTH) return setError(pinError);
    setError(null);
    const hashed = pin ? await hashPin(pin) : null;
    if (await save(() => createVault({ name: name.trim(), pin: hashed }))) {
      setName('');
      setPin('');
    }
  };

  return (
    <form className="vault-form" onSubmit={(e) => void submit(e)}>
      <input className="text-input" value={name} placeholder="Vault name" aria-label="Vault name" maxLength={80} onChange={(e) => setName(e.target.value)} />
      <input className="text-input" type="password" value={pin} placeholder="PIN (optional, makes it private)" aria-label="PIN" autoComplete="new-password" onChange={(e) => setPin(e.target.value)} />
      <button type="submit" className="btn btn--primary" disabled={!name.trim()}>
        Create vault
      </button>
      {error && <p className="lock-panel__error">{error}</p>}
    </form>
  );
}

function UnlockHiddenForm() {
  const { vaults, locked, locks } = useCards();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    setError(null);
    const result = await locks.tryUnlockAny(vaults.filter((v) => v.hidden && locked.has(v.id)), pin);
    setPin('');
    if (result === 'wrong') setError("That PIN isn't right.");
    if (result === 'throttled') setError('Too many tries. Wait 30 seconds and try again.');
  };

  return (
    <form className="lock-panel__row" onSubmit={(e) => void submit(e)}>
      <input className="text-input" type="password" value={pin} placeholder="PIN" aria-label="PIN for a hidden vault" autoComplete="off" onChange={(e) => setPin(e.target.value)} />
      <button type="submit" className="btn" disabled={!pin}>
        Unlock
      </button>
      {error && <p className="lock-panel__error">{error}</p>}
    </form>
  );
}

export function VaultsPage() {
  const { index, vaults, locked } = useCards();
  const shown = vaults.filter((v) => !(v.hidden && locked.has(v.id)));
  return (
    <Page title="Vaults">
      <p className="prose-note">A vault decides who can see a note. Use tags for topics.</p>
      <div className="list">
        {shown.map((v) => {
          const count = index.live.filter((c) => c.vaultId === v.id).length;
          return (
            <Link className="row row--link" key={v.id} to={`/vault/${encodeURIComponent(v.id)}`}>
              <span className="row__icon">
                <Icon name={v.lock === 'pin' ? 'lock' : 'notes'} size={18} />
              </span>
              <span className="row__body">
                <span className="row__title">{v.name}</span>
                <span className="row__preview">{locked.has(v.id) ? 'Locked' : `${count} ${count === 1 ? 'card' : 'cards'}`}</span>
              </span>
            </Link>
          );
        })}
      </div>
      <Section title="New vault">
        <CreateVaultForm />
      </Section>
      <Section title="Hidden vaults">
        <UnlockHiddenForm />
      </Section>
    </Page>
  );
}

const AI_HINT: Record<Vault['ai_access'], string> = {
  off: 'AI apps see nothing in this vault.',
  read: 'Connected AI apps can search and read this vault.',
  write: 'Connected AI apps can also add and edit cards here. Every change is kept in history and can be undone.',
};

/** What connected AI apps may do in an open vault. Private vaults are always off. */
export function AiAccessField({ vault, labelled }: { vault: Vault; labelled?: boolean }) {
  const save = useVaultSaver();
  const set = (ai_access: Vault['ai_access']) => void save(() => updateVault(vault.id, { ai_access }));
  return (
    <div className="ai-field">
      <label className="field-row">
        {labelled ? vault.name : 'AI access'}
        <select value={vault.ai_access} aria-label={`AI access for ${vault.name}`} onChange={(e) => set(e.target.value as Vault['ai_access'])}>
          <option value="off">Off</option>
          <option value="read">Read</option>
          <option value="write">Read and write</option>
        </select>
      </label>
      <p className="prose-note">{AI_HINT[vault.ai_access]}</p>
    </div>
  );
}

function VaultSettings({ vault }: { vault: Vault }) {
  const { repo } = useCards();
  const save = useVaultSaver();
  const toast = useToast();
  const [name, setName] = useState(vault.name);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [canUseFingerprint, setCanUseFingerprint] = useState(false);
  const [fingerprintOn, setFingerprintOn] = useState(false);
  const change = (changes: VaultChanges, done: string) => save(() => updateVault(vault.id, changes), done);
  const isPrivate = vault.lock === 'pin';

  useEffect(() => {
    void biometricAvailable().then(setCanUseFingerprint);
    void repo.getMeta(biometricKey(vault.id)).then((value) => setFingerprintOn(typeof value === 'string'));
  }, [repo, vault.id]);

  const submitPin = async (e: FormEvent) => {
    e.preventDefault();
    if (pin.length < MIN_PIN_LENGTH) return setError(pinError);
    setError(null);
    if (await change({ pin: await hashPin(pin) }, isPrivate ? 'PIN changed' : 'Vault is now private')) setPin('');
  };

  const toggleFingerprint = async (on: boolean) => {
    try {
      await repo.setMeta(biometricKey(vault.id), on ? await enrollBiometric(vault.name) : null);
      setFingerprintOn(on);
    } catch {
      toast("Fingerprint couldn't be set up on this device.");
    }
  };

  return (
    <Section title="Settings">
      <form
        className="lock-panel__row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && name.trim() !== vault.name) void change({ name: name.trim() }, 'Vault renamed');
        }}
      >
        <input className="text-input" value={name} aria-label="Vault name" maxLength={80} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn" disabled={!name.trim() || name.trim() === vault.name}>
          Rename
        </button>
      </form>

      {!isDefaultVault(vault) && (vault.members ?? 1) <= 1 && (
        <>
          <form className="lock-panel__row vault-gap" onSubmit={(e) => void submitPin(e)}>
            <input className="text-input" type="password" value={pin} placeholder={isPrivate ? 'New PIN' : 'PIN'} aria-label={isPrivate ? 'New PIN' : 'PIN'} autoComplete="new-password" onChange={(e) => setPin(e.target.value)} />
            <button type="submit" className="btn" disabled={!pin}>
              {isPrivate ? 'Change PIN' : 'Make private'}
            </button>
          </form>
          {error && <p className="lock-panel__error">{error}</p>}
          {!isPrivate && <p className="prose-note vault-gap">A forgotten PIN can't be recovered yet, so keep it somewhere safe.</p>}
        </>
      )}

      {!isPrivate && (
        <div className="vault-gap">
          <AiAccessField vault={vault} />
        </div>
      )}

      {isPrivate && (
        <div className="vault-options">
          <label className="check-row">
            <input type="checkbox" checked={vault.hidden} onChange={(e) => void change({ hidden: e.target.checked }, e.target.checked ? 'Vault hidden until unlocked' : 'Vault shown in the list')} />
            <span>Hide this vault until it is unlocked</span>
          </label>
          {canUseFingerprint && (
            <label className="check-row">
              <input type="checkbox" checked={fingerprintOn} onChange={(e) => void toggleFingerprint(e.target.checked)} />
              <span>Unlock with fingerprint on this device. Anyone with a fingerprint enrolled on it can then open this vault, and family members often have theirs enrolled.</span>
            </label>
          )}
          <button type="button" className="btn vault-gap" onClick={() => void change({ pin: null }, 'Vault is no longer private')}>
            Remove PIN
          </button>
        </div>
      )}
    </Section>
  );
}

export function VaultPage() {
  const { id } = useParams();
  const { index, vaults, locked, locks } = useCards();
  const newNote = useNewNote();
  const vault = vaults.find((v) => v.id === id);

  if (!vault) {
    return (
      <Page title="Not found">
        <Empty>This vault doesn't exist on this device.</Empty>
      </Page>
    );
  }
  if (locked.has(vault.id)) {
    return (
      <Page title="Locked">
        <LockPanel vaultId={vault.id} />
      </Page>
    );
  }
  const cards = index.live.filter((c) => c.vaultId === vault.id);
  return (
    <Page
      title={vault.name}
      actions={
        <>
          {vault.lock === 'pin' && (
            <button type="button" className="btn" onClick={() => locks.lock(vault.id)}>
              Lock now
            </button>
          )}
          {vault.role !== 'viewer' && (
            <button type="button" className="btn btn--primary" onClick={() => void newNote([], vault.id)}>
              New note here
            </button>
          )}
        </>
      }
    >
      {cards.length ? (
        <div className="list">
          {cards.map((c) => (
            <CardRow key={c.id} card={c} />
          ))}
        </div>
      ) : (
        <Empty>Nothing in this vault yet.</Empty>
      )}
      {(vault.role ?? 'owner') === 'owner' && <VaultSettings key={vault.id} vault={vault} />}
      <VaultPeopleSection key={`people-${vault.id}`} vault={vault} />
    </Page>
  );
}
