import { useEffect, useState, type FormEvent } from 'react';
import { count as plural } from '../../domain/plural';
import { Link, useParams } from 'react-router';
import { biometricAvailable, biometricKey, enrollBiometric } from '../../auth/biometric';
import { isDefaultVault } from '../../domain/locks';
import { createVaultKey, isMemberCopy } from '../../crypto/vaultKeys';
import { hashPin, MIN_PIN_LENGTH, verifyPin } from '../../domain/pin';
import type { AiAccess, AiAccessSetting, Vault } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { SyncOffline } from '../../sync/engine';
import { createVault, updateVault, type VaultChanges } from '../../sync/http';
import { CardRow, Empty, Page, Section, useNewNote } from '../components';
import { NotHere } from '../NotHere';
import { Icon } from '../Icon';
import { KeyCode } from '../KeyCode';
import { LockPanel } from '../LockPanel';
import { useToast } from '../Toast';
import { PinInput, PinStrength } from '../PinInput';
import { RecoveryKeyDialog } from '../RecoveryKeyDialog';
import { NeedsPin, SealedOutOfReach, useVaultEncryption } from '../useVaultEncryption';
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

const ENCRYPTED_NOTE =
  "Only devices where the PIN is entered can read it, its photos and files too, and you'll get a recovery key in case you forget the PIN. As the server can't read it, its voice messages aren't transcribed, its links get no previews and its entries can't be shared one by one, though the whole vault can be. Its todos still remind you, once it's been open on one of your devices.";
const LOCKED_NOTE = 'The PIN keeps it out of sight in the app, but the server can read it, as it can your other vaults, so everything works in it.';

/** Whether a vault with a PIN is end-to-end encrypted too, and what each way gives up. */
function EncryptChoice({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="encrypt-choice">
      <label className="check-row">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
        <span>Encrypt end to end</span>
      </label>
      <p className="prose-note">{on ? ENCRYPTED_NOTE : LOCKED_NOTE}</p>
    </div>
  );
}

function CreateVaultForm() {
  const save = useVaultSaver();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [encrypt, setEncrypt] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  // A private vault is end-to-end encrypted from the start unless that's turned off, and its recovery key is shown once.
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (pin && pin.length < MIN_PIN_LENGTH) return setError(pinError);
    setError(null);
    const hashed = pin ? await hashPin(pin) : null;
    const sealed = pin && encrypt ? await createVaultKey(pin) : null;
    if (await save(() => createVault({ name: name.trim(), pin: hashed, encryption: sealed?.encryption ?? null }))) {
      setName('');
      setPin('');
      if (sealed) setRecoveryKey(sealed.recoveryKey);
    }
  };

  return (
    <form className="vault-form" onSubmit={(e) => void submit(e)}>
      <input className="text-input" value={name} placeholder="Vault name" aria-label="Vault name" maxLength={80} onChange={(e) => setName(e.target.value)} />
      <PinInput value={pin} placeholder="PIN (optional, makes it private)" aria-label="PIN" onChange={(e) => setPin(e.target.value)} />
      {pin && encrypt && <PinStrength pin={pin} />}
      {pin && <EncryptChoice on={encrypt} onChange={setEncrypt} />}
      <button type="submit" className="btn btn--primary" disabled={!name.trim()}>
        Create vault
      </button>
      {error && <p className="lock-panel__error">{error}</p>}
      {recoveryKey && <RecoveryKeyDialog recoveryKey={recoveryKey} onClose={() => setRecoveryKey(null)} />}
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
      <PinInput value={pin} placeholder="PIN" aria-label="PIN for a hidden vault" onChange={(e) => setPin(e.target.value)} />
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
    <Page title="Vaults" viewOnly={false}>
      <p className="prose-note">A vault decides who can see a note. Use tags for topics.</p>
      <div className="list">
        {shown.map((v) => {
          const count = index.live.filter((c) => c.vaultId === v.id).length;
          const waitingIn = v.encryption && isMemberCopy(v.encryption) && v.encryption.member;
          const state = [
            v.withheld ? (waitingIn ? 'Waiting to be let in' : 'Needs your PIN') : locked.has(v.id) ? 'Locked' : `${plural(count, 'card')}`,
            v.encryption && 'Encrypted',
            v.waiting && `${v.waiting} waiting to be let in`,
          ];
          return (
            <Link className="row row--link" key={v.id} to={`/vault/${encodeURIComponent(v.id)}`}>
              <span className="row__icon">
                <Icon name={v.lock === 'pin' ? 'lock' : 'notes'} size={18} />
              </span>
              <span className="row__body">
                <span className="row__title">{v.name}</span>
                <span className="row__preview">{state.filter(Boolean).join(' · ')}</span>
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

export const AI_ACCESS_LABEL: Record<AiAccess, string> = { off: 'Off', read: 'Read', write: 'Read and write' };

const AI_HINT: Record<AiAccess, string> = {
  off: 'AI apps see nothing in this vault.',
  read: 'Connected AI apps can search and read this vault.',
  write: 'Connected AI apps can also add and edit cards here. Every change is kept in history and can be undone.',
};

/** What connected AI apps may do in an open vault. Private vaults are always off. */
export function AiAccessField({ vault, defaultAccess, compact }: { vault: Vault; defaultAccess?: AiAccess; compact?: boolean }) {
  const save = useVaultSaver();
  const value: AiAccessSetting = vault.ai_access_override ?? 'default';
  const defaultLabel = defaultAccess ? `Default (${AI_ACCESS_LABEL[defaultAccess]})` : value === 'default' ? `Default (${AI_ACCESS_LABEL[vault.ai_access]})` : 'Default';
  const set = (ai_access: AiAccessSetting) => void save(() => updateVault(vault.id, { ai_access }));
  if (compact) {
    return (
      <div className="row ai-vault-row">
        <span className="row__body">
          <span className="row__title">{vault.name}</span>
          {value !== 'default' && <span className="row__preview">Custom</span>}
        </span>
        <select value={value} aria-label={`AI access for ${vault.name}`} onChange={(e) => set(e.target.value as AiAccessSetting)}>
          <option value="default">{defaultLabel}</option>
          <option value="off">Off</option>
          <option value="read">Read</option>
          <option value="write">Read and write</option>
        </select>
      </div>
    );
  }
  return (
    <div className="ai-field">
      <label className="field-row">
        AI access
        <select value={value} aria-label={`AI access for ${vault.name}`} onChange={(e) => set(e.target.value as AiAccessSetting)}>
          <option value="default">{defaultLabel}</option>
          <option value="off">Off</option>
          <option value="read">Read</option>
          <option value="write">Read and write</option>
        </select>
      </label>
      <p className="prose-note">
        {value === 'default' ? `Following your account default in Backup & settings. ${AI_HINT[vault.ai_access]}` : AI_HINT[vault.ai_access]}
      </p>
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
  // Each member's lock is their own; only the owner changes the rest, and only theirs can be encrypted.
  const owner = (vault.role ?? 'owner') === 'owner';
  const alone = (vault.members ?? 1) <= 1;
  const isPrivate = vault.lock === 'pin';
  const encrypted = !!vault.encryption;
  const crypt = useVaultEncryption();
  const [busy, setBusy] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [encryptNew, setEncryptNew] = useState(true);
  const [stopping, setStopping] = useState(false);

  /** Runs a step that may take a while, reporting any failure. */
  const step = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    try {
      await work();
    } catch (err) {
      toast(err instanceof NeedsPin || err instanceof SealedOutOfReach ? err.message : err instanceof SyncOffline ? 'Connect to the internet to change a vault.' : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void biometricAvailable().then(setCanUseFingerprint);
    void repo.getMeta(biometricKey(vault.id)).then((value) => setFingerprintOn(typeof value === 'string'));
  }, [repo, vault.id]);

  const submitPin = async (e: FormEvent) => {
    e.preventDefault();
    if (pin.length < MIN_PIN_LENGTH) return setError(pinError);
    setError(null);
    const next = pin;
    setPin('');
    if (encrypted) return step('Changing the PIN…', async () => (await crypt.rewrap(vault, next), toast('PIN changed')));
    // Making a vault private encrypts it, unless that's turned off.
    if (!isPrivate && owner && encryptNew) return step('Encrypting…', async () => setRecoveryKey(await crypt.encrypt(vault, next)));
    await change({ pin: await hashPin(next) }, isPrivate ? 'PIN changed' : owner ? 'Vault is private' : 'Locked with your PIN');
  };

  const encryptNow = async (e: FormEvent) => {
    e.preventDefault();
    const entered = currentPin;
    setCurrentPin('');
    if (!vault.pin || !(await verifyPin(entered, vault.pin))) return setError("That PIN isn't right.");
    setError(null);
    await step('Encrypting…', async () => setRecoveryKey(await crypt.encrypt(vault, entered)));
  };

  /** Keeps the PIN, storing the cards readable again so the server can work on them. */
  const stopEncrypting = () =>
    step('Decrypting…', async () => {
      await crypt.decrypt(vault, { keepPin: true });
      setStopping(false);
      toast('Vault is no longer encrypted');
    });

  const removePin = async () => {
    if (encrypted && !confirm(`Remove the PIN from ${vault.name}? Its cards, photos and files will be decrypted and stored readable again.`)) return;
    if (encrypted) await step('Decrypting…', async () => (await crypt.decrypt(vault), toast('Vault is no longer private')));
    else await change({ pin: null }, owner ? 'Vault is no longer private' : 'Your PIN is removed');
  };

  const toggleFingerprint = async (on: boolean) => {
    try {
      await crypt.rememberOnDevice(vault, on);
      await repo.setMeta(biometricKey(vault.id), on ? await enrollBiometric(vault.name) : null);
      setFingerprintOn(on);
    } catch (err) {
      toast(err instanceof NeedsPin ? err.message : "Fingerprint couldn't be set up on this device.");
    }
  };

  return (
    <Section title={owner ? 'Settings' : 'Your lock'}>
      {owner && (
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
      )}

      {!owner && (
        <p className="prose-note">
          {isPrivate ? 'You lock this vault with a PIN of your own, on your devices. No one else in it needs it.' : 'Lock this vault with a PIN of your own, on your devices. No one else in it needs it, and theirs don’t lock it for you.'}
        </p>
      )}
      {!(owner && isDefaultVault(vault)) && (
        <>
          <form className={`lock-panel__row${owner ? ' vault-gap' : ''}`} onSubmit={(e) => void submitPin(e)}>
            <PinInput value={pin} placeholder={isPrivate ? 'New PIN' : 'PIN'} aria-label={isPrivate ? 'New PIN' : 'PIN'} onChange={(e) => setPin(e.target.value)} />
            <button type="submit" className="btn" disabled={!pin || !!busy}>
              {isPrivate ? 'Change PIN' : owner ? 'Make private' : 'Lock with PIN'}
            </button>
          </form>
          {(encrypted || (!isPrivate && owner && encryptNew)) && <PinStrength pin={pin} />}
          {error && <p className="lock-panel__error">{error}</p>}
          {!isPrivate && owner && (
            <div className="vault-gap">
              <EncryptChoice on={encryptNew} onChange={setEncryptNew} />
            </div>
          )}
          {!isPrivate && owner && !alone && (
            <p className="prose-note vault-gap">
              {encryptNew
                ? 'The PIN is yours. Encrypted, the others in this vault see nothing in it until each sets a PIN of their own, which asks you for its key, and you let them in here.'
                : 'The PIN is yours: the others in this vault see it without it, unless you then ask each of them for a PIN of their own.'}
            </p>
          )}
        </>
      )}

      {isPrivate && encrypted && !owner && (
        <p className="access-note vault-gap">End-to-end encrypted. Only devices where the PIN of someone let in is entered can read this vault. Your PIN holds your copy of its key.</p>
      )}
      {isPrivate && encrypted && owner && (
        <div className="encrypt-box vault-gap">
          <p className="access-note">End-to-end encrypted. Only devices where the PIN is entered{alone ? '' : ', yours or that of someone you let in,'} can read this vault.</p>
          {stopping ? (
            <>
              <p className="prose-note">
                Its cards, photos and files will be stored readable again, on the server and in Google Drive too. The PIN still locks it in the app, and voice transcripts, link previews and sharing start working in it.
              </p>
              <div className="lock-panel__row">
                <button type="button" className="btn btn--primary" disabled={!!busy} onClick={() => void stopEncrypting()}>
                  Stop encrypting
                </button>
                <button type="button" className="btn" disabled={!!busy} onClick={() => setStopping(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="btn" disabled={!!busy} onClick={() => setStopping(true)}>
              Stop encrypting…
            </button>
          )}
        </div>
      )}
      {isPrivate && !encrypted && owner && (
        <form className="encrypt-box vault-gap" onSubmit={(e) => void encryptNow(e)}>
          <p className="prose-note">
            Locked by its PIN, not encrypted: the PIN keeps it out of sight in the app, but the server can read its cards, so everything works in it. Encrypting it makes it readable only where the PIN is entered, its photos and files too, and turns off voice transcripts, link previews and sharing its entries one by one.
            {alone ? '' : ' The others in it then see nothing in it until each sets a PIN of their own, which asks you for its key, and you let them in.'}
          </p>
          <div className="lock-panel__row">
            <PinInput value={currentPin} placeholder="Current PIN" aria-label="Current PIN to encrypt with" onChange={(e) => setCurrentPin(e.target.value)} />
            <button type="submit" className="btn btn--primary" disabled={!currentPin || !!busy}>
              Encrypt this vault
            </button>
          </div>
          <PinStrength pin={currentPin} />
        </form>
      )}
      {isPrivate && !encrypted && owner && (
        <div className="encrypt-choice vault-gap">
          <label className="check-row">
            <input
              type="checkbox"
              checked={!!vault.members_need_pin}
              onChange={(e) => void change({ members_need_pin: e.target.checked }, e.target.checked ? 'Everyone needs a PIN of their own now' : 'A PIN is up to each person now')}
            />
            <span>Everyone in it needs a PIN of their own to see it</span>
          </label>
          <p className="prose-note">
            {vault.members_need_pin
              ? 'Until someone sets one, the server sends them nothing in this vault.'
              : 'Your PIN locks it only for you. With this on, anyone you share it with sees nothing in it until they lock it with a PIN of their own.'}
          </p>
        </div>
      )}
      {busy && <p className="prose-note vault-gap" role="status">{busy}</p>}
      {recoveryKey && <RecoveryKeyDialog recoveryKey={recoveryKey} onClose={() => setRecoveryKey(null)} />}

      {!isPrivate && owner && (
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
          {!owner && encrypted ? (
            <p className="prose-note">Your PIN holds your copy of its key, so it can be changed but not removed. To give the vault up, leave it.</p>
          ) : owner || !vault.members_need_pin ? (
            <button type="button" className="btn vault-gap" disabled={!!busy} onClick={() => void removePin()}>
              Remove PIN
            </button>
          ) : (
            <p className="prose-note">Its owner asks everyone in it to keep a PIN on it, so yours can be changed but not removed.</p>
          )}
        </div>
      )}
    </Section>
  );
}

/**
 * What a member sees of a vault before the server sends them anything in it: one whose owner asks everyone for a PIN
 * of their own, until they set theirs, or an encrypted one, until they've set a PIN, which asks for its key, and its
 * owner has let them in.
 */
export function SetOwnPin({ vault }: { vault: Vault }) {
  const { locks, engine } = useCards();
  const save = useVaultSaver();
  const crypt = useVaultEncryption();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const sealed = vault.encryption && isMemberCopy(vault.encryption) ? vault.encryption : null;
  const asked = sealed?.member && !again ? sealed.member : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pin.length < MIN_PIN_LENGTH) return setError(pinError);
    setError(null);
    const next = pin;
    setPin('');
    if (sealed) {
      // It saves the vault itself, keyring and all.
      try {
        await crypt.askForKey(vault, next);
        toast('Asked for its key');
        setAgain(false);
      } catch (err) {
        toast(err instanceof SyncOffline ? 'Connect to the internet to change a vault.' : "That change couldn't be saved.");
      }
      return;
    }
    const hashed = await hashPin(next);
    if (!(await save(() => updateVault(vault.id, { pin: hashed }), 'Locked with your PIN'))) return;
    // Just typed, so open here; its cards come with the next sync.
    locks.unlockVerified(vault.id);
    void engine.sync();
  };

  if (asked) {
    return (
      <div className="lock-panel">
        <div className="lock-panel__title">
          <Icon name="lock" size={16} /> Waiting to be let in to {vault.name}
        </div>
        <p className="prose-note">
          You asked for its key. Its owner lets you in from the vault’s page, on a device where it’s open. Before they do, check together that they see this code beside your name:
        </p>
        <p>
          <KeyCode publicKey={asked.public} />
        </p>
        <p className="prose-note">If it isn’t the same, someone may have put their key in place of yours: they shouldn’t let you in. Your PIN opens it here once they have.</p>
        <button type="button" className="btn btn--quiet" onClick={() => setAgain(true)}>
          Forgot the PIN? Ask again
        </button>
      </div>
    );
  }

  return (
    <div className="lock-panel">
      <div className="lock-panel__title">
        <Icon name="lock" size={16} /> Set your own PIN to see {vault.name}
      </div>
      <p className="prose-note">
        {sealed
          ? 'It’s end-to-end encrypted, so its key comes to you sealed for your PIN alone. Setting one asks its owner for it, and once they let you in, your PIN opens it on your devices. No one else needs yours.'
          : 'Its owner asks everyone in it to lock it with a PIN of their own. Yours is only yours: no one else in the vault needs it, and it locks the vault on your devices.'}
      </p>
      <form className="lock-panel__row" onSubmit={(e) => void submit(e)}>
        <PinInput value={pin} placeholder="New PIN" aria-label={`New PIN for ${vault.name}`} onChange={(e) => setPin(e.target.value)} />
        <button type="submit" className="btn btn--primary" disabled={!pin}>
          {sealed ? 'Set PIN and ask' : 'Set PIN'}
        </button>
      </form>
      {sealed && <PinStrength pin={pin} />}
      {error && <p className="lock-panel__error">{error}</p>}
      {again && (
        <button type="button" className="btn btn--quiet vault-gap" onClick={() => setAgain(false)}>
          Back
        </button>
      )}
    </div>
  );
}

export function VaultPage() {
  const { id } = useParams();
  const { index, vaults, locked, locks } = useCards();
  const newNote = useNewNote();
  const vault = vaults.find((v) => v.id === id);

  if (!vault) {
    return (
      <Page title="Not found" viewOnly={false}>
        <NotHere thing="vault" away={{ to: '/vaults', label: 'See your vaults' }} />
      </Page>
    );
  }
  if (locked.has(vault.id)) {
    return (
      <Page title="Locked" viewOnly={false}>
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
          {vault.role !== 'viewer' && !vault.withheld && (
            <button type="button" className="btn btn--primary" onClick={() => void newNote([], vault.id)}>
              New note here
            </button>
          )}
        </>
      }
    >
      {vault.withheld ? (
        <SetOwnPin vault={vault} />
      ) : cards.length ? (
        <div className="list">
          {cards.map((c) => (
            <CardRow key={c.id} card={c} />
          ))}
        </div>
      ) : (
        <Empty>Nothing in this vault yet.</Empty>
      )}
      {/* A member's own lock; the rest is the owner's. */}
      {!vault.withheld && <VaultSettings key={vault.id} vault={vault} />}
      <VaultPeopleSection key={`people-${vault.id}`} vault={vault} />
    </Page>
  );
}
