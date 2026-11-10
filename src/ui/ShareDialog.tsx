import { useEffect, useRef, useState, type FormEvent } from 'react';
import { displayTitle } from '../domain/content';
import type { Card } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { SyncOffline } from '../sync/engine';
import { createPublicLink, deletePublicLink, fetchCardShares, shareCard, unshareCard, type CardShares, type ShareRole } from '../sync/http';
import { useToast } from './Toast';

const ROLE_LABEL: Record<ShareRole, string> = { view: 'Can view', comment: 'Can comment', edit: 'Can edit' };
const EXPIRY = [
  { label: 'Never expires', days: null },
  { label: 'Expires in 1 day', days: 1 },
  { label: 'Expires in 7 days', days: 7 },
  { label: 'Expires in 30 days', days: 30 },
];

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

function RoleSelect({ value, onChange, label }: { value: ShareRole; onChange: (role: ShareRole) => void; label: string }) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as ShareRole)}>
      {(['view', 'comment', 'edit'] as const).map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}

/** Share one card with people, with another vault's members, or with anyone who has a link. */
export function ShareDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const { vaults, locked } = useCards();
  const toast = useToast();
  const dialog = useRef<HTMLDivElement>(null);
  const [shares, setShares] = useState<CardShares | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [emailRole, setEmailRole] = useState<ShareRole>('view');
  const [target, setTarget] = useState('');
  const [vaultRole, setVaultRole] = useState<ShareRole>('view');
  const [expiry, setExpiry] = useState(0);

  const home = vaults.find((v) => v.id === card.vaultId);
  const isPrivate = home?.lock === 'pin';
  const [confirmed, setConfirmed] = useState(!isPrivate);
  const others = vaults.filter((v) => v.id !== card.vaultId && v.lock === 'none' && !locked.has(v.id));
  const chosen = others.find((v) => v.id === target);

  useEffect(() => {
    fetchCardShares(card.id).then(setShares, (err: unknown) =>
      setProblem(err instanceof SyncOffline ? 'Sharing needs a connection.' : "This card can't be shared until it has synced."),
    );
  }, [card.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    dialog.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (work: () => Promise<CardShares>, done?: string) => {
    try {
      setShares(await work());
      if (done) toast(done);
      return true;
    } catch (err) {
      toast(err instanceof SyncOffline ? 'Sharing needs a connection.' : "That didn't work. Try again.");
      return false;
    }
  };

  const addPerson = async (e: FormEvent) => {
    e.preventDefault();
    if (email.trim() && (await run(() => shareCard(card.id, { email: email.trim() }, emailRole)))) setEmail('');
  };

  const addVault = async () => {
    if (!chosen) return;
    if (await run(() => shareCard(card.id, { vault_id: chosen.id }, vaultRole), `Shared with ${chosen.name}`)) setTarget('');
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      toast("Couldn't copy. Select the link and copy it yourself.");
    }
  };

  const linkUrl = (token: string) => `${location.origin}/s/${token}`;
  const title = displayTitle(card);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`Share ${title}`} tabIndex={-1} ref={dialog}>
        <div className="dialog__head">
          <h2>Share “{title}”</h2>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Done
          </button>
        </div>
        {home && (
          <p className="prose-note">
            This card is in {home.name}
            {home.members && home.members > 1 ? ` (${people(home.members)})` : ''}. Sharing it doesn't share the cards it links to.
          </p>
        )}
        {problem && <p className="lock-panel__error">{problem}</p>}
        {isPrivate && !confirmed && (
          <div className="dialog__warn">
            <p>This card is in a private vault. Whoever you share it with can read it without your PIN.</p>
            <button type="button" className="btn" onClick={() => setConfirmed(true)}>
              I understand, continue
            </button>
          </div>
        )}

        {shares && confirmed && (
          <>
            <h3>People</h3>
            <form className="share-form" onSubmit={(e) => void addPerson(e)}>
              <input className="text-input" type="email" value={email} placeholder="Email address" aria-label="Email address" onChange={(e) => setEmail(e.target.value)} />
              <RoleSelect value={emailRole} onChange={setEmailRole} label="Access for this person" />
              <button type="submit" className="btn btn--primary" disabled={!email.trim()}>
                Share
              </button>
            </form>
            <ul className="share-list">
              {shares.people.map((p) => (
                <li key={p.user_id}>
                  <span>
                    {p.name} <span className="muted">{p.email}</span>
                  </span>
                  <RoleSelect value={p.role} label={`Access for ${p.name}`} onChange={(r) => void run(() => shareCard(card.id, { email: p.email }, r))} />
                  <button type="button" className="btn btn--quiet" onClick={() => void run(() => unshareCard(card.id, 'user', p.user_id))}>
                    Remove
                  </button>
                </li>
              ))}
              {shares.invites.map((i) => (
                <li key={i.email}>
                  <span>
                    {i.email} <span className="muted">invited, sees it after signing up</span>
                  </span>
                  <span className="muted">{ROLE_LABEL[i.role]}</span>
                  <button type="button" className="btn btn--quiet" onClick={() => void run(() => unshareCard(card.id, 'invite', i.email))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            {others.length > 0 && (
              <>
                <h3>A vault's members</h3>
                <div className="share-form">
                  <select value={target} aria-label="Vault to share with" onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Choose a vault</option>
                    {others.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {v.members ? ` (${people(v.members)})` : ''}
                      </option>
                    ))}
                  </select>
                  <RoleSelect value={vaultRole} onChange={setVaultRole} label="Access for the vault's members" />
                </div>
                {chosen && (
                  <div className="dialog__warn">
                    <p>
                      This card is in {home?.name}
                      {home?.members ? ` (${people(home.members)})` : ''}. Share it with {chosen.name}
                      {chosen.members ? ` (${people(chosen.members)})` : ''}?
                    </p>
                    <button type="button" className="btn btn--primary" onClick={() => void addVault()}>
                      Share with {chosen.name}
                    </button>
                  </div>
                )}
                <ul className="share-list">
                  {shares.vaults.map((v) => (
                    <li key={v.vault_id}>
                      <span>
                        {v.name} <span className="muted">{people(v.members)}</span>
                      </span>
                      <span className="muted">{ROLE_LABEL[v.role]}</span>
                      <button type="button" className="btn btn--quiet" onClick={() => void run(() => unshareCard(card.id, 'vault', v.vault_id))}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h3>Anyone with the link</h3>
            <p className="prose-note">Read only. The link isn't listed anywhere, and you can turn it off.</p>
            <div className="share-form">
              <select value={expiry} aria-label="Link expiry" onChange={(e) => setExpiry(Number(e.target.value))}>
                {EXPIRY.map((x, i) => (
                  <option key={x.label} value={i}>
                    {x.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={() => void run(() => createPublicLink(card.id, EXPIRY[expiry].days), 'Link created')}>
                Create link
              </button>
            </div>
            <ul className="share-list">
              {shares.links.map((l) => (
                <li key={l.token}>
                  <input className="text-input" readOnly value={linkUrl(l.token)} aria-label="Public link" onFocus={(e) => e.target.select()} />
                  <span className="muted">{l.expires_at ? `Until ${new Date(l.expires_at).toLocaleDateString()}` : 'No expiry'}</span>
                  <button type="button" className="btn btn--quiet" onClick={() => void copy(linkUrl(l.token))}>
                    Copy
                  </button>
                  <button type="button" className="btn btn--quiet" onClick={() => void run(() => deletePublicLink(card.id, l.token), 'Link turned off')}>
                    Turn off
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
