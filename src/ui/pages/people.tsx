import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { Vault } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { SyncOffline } from '../../sync/engine';
import { addVaultMember, cancelVaultInvite, fetchVaultPeople, removeVaultMember, type VaultPeople } from '../../sync/http';
import { Empty, Section } from '../components';
import { useToast } from '../Toast';

const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view and comment' } as const;

/** Who can see a vault. Its owner adds people by email; anyone else can leave. */
export function VaultPeopleSection({ vault }: { vault: Vault }) {
  const { engine, accountId } = useCards();
  const toast = useToast();
  const navigate = useNavigate();
  const [people, setPeople] = useState<VaultPeople | null>(null);
  const [offline, setOffline] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const owner = (vault.role ?? 'owner') === 'owner';

  useEffect(() => {
    fetchVaultPeople(vault.id).then(setPeople, () => setOffline(true));
  }, [vault.id]);

  const run = async (work: () => Promise<VaultPeople | { ok: true }>, done?: string) => {
    try {
      const result = await work();
      if ('members' in result) setPeople(result);
      if (done) toast(done);
      void engine.sync();
      return true;
    } catch (err) {
      toast(err instanceof SyncOffline ? 'Connect to the internet to change who can see this vault.' : "That didn't work. Check the address and try again.");
      return false;
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    const count = (people?.members.length ?? 1) + (people?.invites.length ?? 0);
    // Their lock is their own: a vault locked by the owner's PIN alone is open to them unless the owner asks for theirs.
    const unlocked = vault.lock === 'pin' && !vault.members_need_pin ? ' They won’t need your PIN to see it.' : '';
    if (count === 1 && !confirm(`Everything in ${vault.name} will be visible to ${address}.${unlocked} Share it?`)) return;
    if (await run(() => addVaultMember(vault.id, address, role))) setEmail('');
  };

  const leave = async () => {
    if (!confirm(`Leave ${vault.name}? Its cards will be removed from your devices.`)) return;
    if (await run(() => removeVaultMember(vault.id, accountId), `You left ${vault.name}`)) void navigate('/vaults', { replace: true });
  };

  if (vault.encryption) {
    return (
      <Section title="People">
        <p className="prose-note">Only you can see an encrypted vault. To share it, stop encrypting it first: your PIN still locks it for you.</p>
      </Section>
    );
  }

  return (
    <Section title="People">
      {offline && <Empty>Connect to the internet to see who can see this vault.</Empty>}
      {people && (
        <div className="list">
          {people.members.map((m) => (
            <div className="row" key={m.user_id}>
              <span className="row__body">
                <span className="row__title">
                  {m.name}
                  {m.user_id === accountId ? ' (you)' : ''}
                </span>
                <span className="row__preview">
                  {m.email} · {ROLE_LABEL[m.role]}
                  {vault.members_need_pin && m.role !== 'owner' && !m.locked ? ' · No PIN yet, so sees nothing in it' : ''}
                </span>
              </span>
              {owner && m.role !== 'owner' && (
                <button type="button" className="btn" onClick={() => void run(() => removeVaultMember(vault.id, m.user_id), `Removed ${m.name}`)}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {people.invites.map((i) => (
            <div className="row" key={i.email}>
              <span className="row__body">
                <span className="row__title">{i.email}</span>
                <span className="row__preview">Invited · {ROLE_LABEL[i.role]} · joins when they first sign in</span>
              </span>
              {owner && (
                <button type="button" className="btn" onClick={() => void run(() => cancelVaultInvite(vault.id, i.email))}>
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {owner && people && (
        <form className="share-form vault-gap" onSubmit={(e) => void add(e)}>
          <input className="text-input" type="email" value={email} placeholder="Email address" aria-label="Email address to share with" onChange={(e) => setEmail(e.target.value)} />
          <select value={role} aria-label="Role" onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
            <option value="editor">Can edit</option>
            <option value="viewer">Can view and comment</option>
          </select>
          <button type="submit" className="btn btn--primary" disabled={!email.trim()}>
            Share
          </button>
        </form>
      )}
      {owner && (
        <p className="prose-note vault-gap">
          Everyone here sees every card in this vault{vault.members_need_pin ? ', once they’ve locked it with a PIN of their own' : ''}. To share just one card, use Share on that card.
        </p>
      )}
      {!owner && (
        <button type="button" className="btn vault-gap" onClick={() => void leave()}>
          Leave this vault
        </button>
      )}
    </Section>
  );
}
