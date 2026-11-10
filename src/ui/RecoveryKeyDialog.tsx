import { useState } from 'react';
import { useToast } from './Toast';

/** Shows a new recovery key once. It is never stored, so this is the only chance to keep it. */
export function RecoveryKeyDialog({ recoveryKey, onClose }: { recoveryKey: string; onClose: () => void }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      toast('Recovery key copied. Paste it somewhere safe, away from this device.');
    } catch {
      toast("Couldn't copy. Write it down instead.");
    }
  };
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label="Your recovery key">
        <div className="dialog__head">
          <h2>Your recovery key</h2>
        </div>
        <p className="prose-note">
          If you forget this vault's PIN, this key is the only way back in. It is shown once and not stored anywhere, not even on the server. Write it down or keep it in
          a password manager.
        </p>
        <p className="recovery-key" aria-label="Recovery key">
          {recoveryKey}
        </p>
        <div className="button-row">
          <button type="button" className="btn" onClick={() => void copy()}>
            Copy
          </button>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>I've saved my recovery key</span>
        </label>
        <button type="button" className="btn btn--primary" disabled={!saved} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
