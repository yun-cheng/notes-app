import { useEffect, useRef, useState } from 'react';
import { count } from '../domain/plural';
import { useAccount } from '../auth/AuthContext';
import { SyncOffline } from '../sync/engine';
import { fetchAccountSummary } from '../sync/http';
import type { AccountSummary } from '../sync/protocol';
import { Section } from './components';
import { useToast } from './Toast';
import { useBackdropClose } from './useBackdrop';
import { composing } from './composing';


/** Settings, last: deleting the account for good, behind a dialog that says what goes and asks for its email. */
export function DeleteAccountSection({ onExport }: { onExport: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Delete account">
      <p className="prose-note">Deletes this account and everything in it from the server, for good. Other accounts signed in on this browser stay as they are.</p>
      <div className="button-row">
        <button type="button" className="btn btn--danger" onClick={() => setOpen(true)}>
          Delete account…
        </button>
      </div>
      {open && <DeleteAccountDialog onExport={onExport} onClose={() => setOpen(false)} />}
    </Section>
  );
}

function DeleteAccountDialog({ onExport, onClose }: { onExport: () => void; onClose: () => void }) {
  const { account, deleteAccount } = useAccount();
  const toast = useToast();
  const [summary, setSummary] = useState<AccountSummary | 'offline' | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const backdrop = useBackdropClose(() => !busy && onClose());

  useEffect(() => {
    let live = true;
    fetchAccountSummary().then(
      (s) => live && setSummary(s),
      () => live && setSummary('offline'),
    );
    input.current?.focus();
    return () => {
      live = false;
    };
  }, []);

  const matches = typed.trim().toLowerCase() === account.email.toLowerCase();
  const ready = matches && summary !== null && summary !== 'offline' && !busy;

  const remove = async () => {
    setBusy(true);
    try {
      await deleteAccount(typed);
      toast(`Deleted ${account.email}.`);
    } catch (err) {
      setBusy(false);
      toast(err instanceof SyncOffline ? 'Deleting an account needs a connection.' : err instanceof Error ? err.message : "The account couldn't be deleted.");
    }
  };

  const shared = summary && summary !== 'offline' ? summary.vaults.filter((v) => v.others > 0) : [];
  return (
    <div className="dialog-backdrop" {...backdrop}>
      <div
        className="dialog delete-account"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onClose();
        }}
      >
        <div className="dialog__head">
          <h2 id="delete-account-title">Delete this account?</h2>
        </div>
        <p className="prose-note">
          <strong>{account.email}</strong> and everything in it is deleted from the server for good. This can't be undone.
        </p>
        {summary === null && <p className="prose-note">Finding what's in it…</p>}
        {summary === 'offline' && <p className="prose-note is-alert">Deleting an account needs a connection. Try again once you're online.</p>}
        {summary && summary !== 'offline' && (
          <ul className="delete-account__list">
            <li>
              Your {summary.vaults.length === 1 ? 'vault' : 'vaults'}, with every entry, its history, comments and public links:{' '}
              {summary.vaults.map((v, i) => (
                <span key={v.id}>
                  {i > 0 && ', '}
                  {v.name} ({count(v.cards, 'entry', 'entries')})
                </span>
              ))}
              .
            </li>
            {shared.length > 0 && (
              <li className="is-alert">
                {shared.map((v) => `${v.name} is shared with ${count(v.others, 'other person', 'other people')}`).join('; ')}: they lose {shared.length === 1 ? 'it' : 'them'} too.
              </li>
            )}
            {summary.joined > 0 && (
              <li>
                You leave {count(summary.joined, 'vault')} other people share with you. What you wrote there stays, without your name; your comments there are deleted.
              </li>
            )}
            <li>Your photos stay in your Google Drive, and the app's access to it ends. AI apps, reminders and your other devices are signed out.</li>
          </ul>
        )}
        <div className="dialog__warn">
          <span>Want a copy first? Export your notes before deleting.</span>
          <button type="button" className="btn" onClick={onExport}>
            Export as Markdown
          </button>
        </div>
        <label className="delete-account__confirm">
          <span>
            Type <strong>{account.email}</strong> to confirm
          </span>
          <input
            ref={input}
            className="text-input"
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !composing(e) && ready) void remove();
            }}
          />
        </label>
        <div className="button-row">
          <button type="button" className="btn btn--danger-solid" disabled={!ready} onClick={() => void remove()}>
            {busy ? 'Deleting…' : 'Delete account'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
