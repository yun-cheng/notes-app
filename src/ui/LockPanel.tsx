import { useEffect, useState, type FormEvent } from 'react';
import { biometricKey, verifyBiometric } from '../auth/biometric';
import { useCards } from '../state/CardsContext';
import { Icon } from './Icon';

/** Asks for a vault's PIN. A hidden vault's name is never shown here. */
export function LockPanel({ vaultId }: { vaultId: string }) {
  const { vaults, locks, repo } = useCards();
  const vault = vaults.find((v) => v.id === vaultId);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);

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
    if (credential && (await verifyBiometric(credential))) locks.unlockVerified(vault.id);
    else setError("Fingerprint didn't work. Use your PIN.");
  };

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
      {error && (
        <p className="lock-panel__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
