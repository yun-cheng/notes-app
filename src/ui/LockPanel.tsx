import { useEffect, useRef, useState, type FormEvent } from 'react';
import { biometricKey, verifyBiometric } from '../auth/biometric';
import { useCards } from '../state/CardsContext';
import { Icon } from './Icon';
import { MIN_PIN_LENGTH } from '../domain/pin';
import { PIN_FIELD } from './pinField';
import { useVaultEncryption } from './useVaultEncryption';

/**
 * Unlocking takes this panel away, PIN box and all. A popup the browser opened on the box (Chrome offering a login it
 * saved for the site) would stay behind with nothing under it, holding on to the scroll wheel in every app until
 * the tab is left. So the box lets go of the keyboard first, which closes it.
 */
function letGo() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/** Asks for a vault's PIN. A hidden vault's name is never shown here. */
export function LockPanel({ vaultId }: { vaultId: string }) {
  const { vaults, locks, repo } = useCards();
  const vault = vaults.find((v) => v.id === vaultId);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPin, setNewPin] = useState('');
  const crypt = useVaultEncryption();
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void repo.getMeta(biometricKey(vaultId)).then((value) => setCredential(typeof value === 'string' ? value : null));
  }, [repo, vaultId]);

  if (!vault) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pin || busy) return;
    letGo();
    setBusy(true);
    setError(null);
    const result = await locks.tryUnlock(vault, pin);
    setBusy(false);
    setPin('');
    if (result === 'wrong') setError("That PIN isn't right.");
    if (result === 'throttled') setError('Too many tries. Wait 30 seconds and try again.');
    // Still locked: back to the box to try again.
    if (result === 'wrong' || result === 'throttled') box.current?.focus();
  };

  const useFingerprint = async () => {
    if (credential && (await verifyBiometric(credential)) && (await locks.unlockWithDevice(vault))) return;
    setError("Fingerprint didn't work. Use your PIN.");
  };

  const recover = async (e: FormEvent) => {
    e.preventDefault();
    if (newPin.length < MIN_PIN_LENGTH) return setError(`Use at least ${MIN_PIN_LENGTH} characters for the new PIN.`);
    letGo();
    setBusy(true);
    setError(null);
    try {
      if (!(await crypt.recover(vault, recoveryKey, newPin))) setError("That recovery key isn't right.");
    } catch {
      setError('Connect to the internet to set a new PIN.');
    } finally {
      setBusy(false);
    }
  };

  if (recovering) {
    return (
      <form className="lock-panel" onSubmit={(e) => void recover(e)}>
        <div className="lock-panel__title">
          <Icon name="lock" size={18} />
          <span>Use your recovery key</span>
        </div>
        <input className="text-input" value={recoveryKey} autoComplete="off" placeholder="XXXX-XXXX-…" aria-label="Recovery key" onChange={(e) => setRecoveryKey(e.target.value)} />
        <input {...PIN_FIELD} className={`${PIN_FIELD.className} vault-gap`} value={newPin} placeholder="New PIN" aria-label="New PIN" onChange={(e) => setNewPin(e.target.value)} />
        <div className="button-row vault-gap">
          <button type="submit" className="btn btn--primary" disabled={!recoveryKey || !newPin || busy}>
            Unlock and set PIN
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => setRecovering(false)}>
            Back
          </button>
        </div>
        {error && (
          <p className="lock-panel__error" role="alert">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <form className="lock-panel" onSubmit={(e) => void submit(e)}>
      <div className="lock-panel__title">
        <Icon name="lock" size={18} />
        <span>{vault.hidden ? 'This is locked' : `${vault.name} is locked`}</span>
      </div>
      <div className="lock-panel__row">
        <input
          {...PIN_FIELD}
          ref={box}
          value={pin}
          autoFocus
          placeholder="PIN"
          aria-label="PIN"
          enterKeyHint="done"
          onChange={(e) => setPin(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={!pin || busy}>
          Unlock
        </button>
      </div>
      {credential && (
        <button type="button" className="btn btn--quiet" onClick={() => void useFingerprint()}>
          Use fingerprint
        </button>
      )}
      {vault.encryption && (
        <button type="button" className="btn btn--quiet" onClick={() => setRecovering(true)}>
          Forgot PIN?
        </button>
      )}
      {error && (
        <p className="lock-panel__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
