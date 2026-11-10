import { useEffect, useState, type FormEvent } from 'react';
import { biometricKey, verifyBiometric } from '../auth/biometric';
import { useCards } from '../state/CardsContext';
import { Icon } from './Icon';
import { MIN_PIN_LENGTH } from '../domain/pin';
import { useVaultEncryption } from './useVaultEncryption';

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

  useEffect(() => {
    void repo.getMeta(biometricKey(vaultId)).then((value) => setCredential(typeof value === 'string' ? value : null));
  }, [repo, vaultId]);

  if (!vault) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pin || busy) return;
    setBusy(true);
    setError(null);
    const result = await locks.tryUnlock(vault, pin);
    setBusy(false);
    setPin('');
    if (result === 'wrong') setError("That PIN isn't right.");
    if (result === 'throttled') setError('Too many tries. Wait 30 seconds and try again.');
  };

  const useFingerprint = async () => {
    if (credential && (await verifyBiometric(credential)) && (await locks.unlockWithDevice(vault))) return;
    setError("Fingerprint didn't work. Use your PIN.");
  };

  const recover = async (e: FormEvent) => {
    e.preventDefault();
    if (newPin.length < MIN_PIN_LENGTH) return setError(`Use at least ${MIN_PIN_LENGTH} characters for the new PIN.`);
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
        <input className="text-input vault-gap" type="password" value={newPin} autoComplete="new-password" placeholder="New PIN" aria-label="New PIN" onChange={(e) => setNewPin(e.target.value)} />
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
          className="text-input"
          type="password"
          value={pin}
          autoFocus
          autoComplete="off"
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
