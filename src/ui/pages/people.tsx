import { useEffect, useState, type FormEvent } from 'react';
import { isMemberCopy } from '../../crypto/vaultKeys';
import { useNavigate } from 'react-router';
import type { Vault } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { SyncOffline } from '../../sync/engine';
import { addVaultMember, cancelVaultInvite, fetchVaultPeople, removeVaultMember, type VaultPeople } from '../../sync/http';
import { Empty, Section } from '../components';
import { useToast } from '../Toast';
import { PinInput } from '../PinInput';
import { useVaultEncryption } from '../useVaultEncryption';
import { KeyCode, VaultKeyCode } from '../KeyCode';

const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view and comment' } as const;

/** Who can see a vault. Its owner adds people by email; anyone else can leave. */
export function VaultPeopleSection({ vault }: { vault: Vault }) {
  const { engine, accountId, keyring } = useCards();
  const toast = useToast();
  const navigate = useNavigate();
  const [people, setPeople] = useState<VaultPeople | null>(null);
  const [offline, setOffline] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const owner = (vault.role ?? 'owner') === 'owner';
  const encrypted = !!vault.encryption;
  const vaultKey = keyring.key(vault.id);

  // Again once this account's own place in it changes: a PIN set, a key asked for or given.
  const mine = `${vault.withheld}|${vault.lock}|${vault.encryption && isMemberCopy(vault.encryption) ? (vault.encryption.member?.public ?? '') : ''}`;
  useEffect(() => {
    fetchVaultPeople(vault.id).then(setPeople, () => setOffline(true));
  }, [vault.id, mine]);

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
    const unlocked = vault.lock === 'pin' && !vault.members_need_pin && !encrypted ? ' They won’t need your PIN to see it.' : '';
    const once = encrypted ? ' once you let them in' : '';
    if (count === 1 && !confirm(`Everything in ${vault.name} will be visible to ${address}${once}.${unlocked} Share it?`)) return;
    if (await run(() => addVaultMember(vault.id, address, role))) setEmail('');
  };

  const leave = async () => {
    if (!confirm(`Leave ${vault.name}? Its cards will be removed from your devices.`)) return;
    if (await run(() => removeVaultMember(vault.id, accountId), `You left ${vault.name}`)) void navigate('/vaults', { replace: true });
  };

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
                  {vault.members_need_pin && !encrypted && m.role !== 'owner' && !m.locked ? ' · No PIN yet, so sees nothing in it' : ''}
                  {encrypted && m.role !== 'owner' && !m.key && ' · Hasn’t set a PIN to ask for its key, so sees nothing in it'}
                  {encrypted && m.key && !m.key.given && ' · Asked for its key'}
                </span>
                {owner && m.key && !m.key.given && <LetIn vault={vault} person={m} onDone={setPeople} />}
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
      {encrypted && vaultKey && (people?.members.length ?? 0) > 1 && (
        <div className="vault-gap">
          <p className="prose-note">
            Its key’s code here is <VaultKeyCode vaultKey={vaultKey} vaultId={vault.id} />
          </p>
          <p className="prose-note">
            Everyone let in sees the same code on this page. Compare it once with {owner ? 'each of them' : 'its owner'}: someone who sees another got a key that isn’t this vault’s, and what they write in it isn’t safe.
            {owner ? ' Remove them and let them ask again.' : ' Ask for its key again with Forgot PIN? on the lock.'}
          </p>
        </div>
      )}
      {owner && (
        <p className="prose-note vault-gap">
          {encrypted
            ? 'Everyone here sees every card in this vault once you let them in: each sets a PIN of their own, which asks you for its key, sealed for them alone. The server never sees it.'
            : `Everyone here sees every card in this vault${vault.members_need_pin ? ', once they’ve locked it with a PIN of their own' : ''}. To share just one card, use Share on that card.`}
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

/**
 * Letting someone into an encrypted vault: the code to compare with the one they see, and the key sealed for them.
 * The key must have been opened by PIN to be sealed, so a vault opened by fingerprint asks for the PIN here.
 */
function LetIn({ vault, person, onDone }: { vault: Vault; person: VaultPeople['members'][number]; onDone: (people: VaultPeople) => void }) {
  const { keyring, engine } = useCards();
  const crypt = useVaultEncryption();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsPin = !keyring.key(vault.id)?.extractable;
  if (!person.key || !vault.encryption || isMemberCopy(vault.encryption)) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const people = await crypt.letIn(vault, person, needsPin ? pin : undefined);
      if (!people) return setError("That PIN isn't right.");
      onDone(people);
      toast(`${person.name} can open ${vault.name} now`);
      // The vault list's count of those waiting comes with the vault.
      void engine.sync();
    } catch (err) {
      setError(err instanceof SyncOffline ? 'Connect to the internet to let them in.' : 'That didn’t work: they may have asked again since. Reload and check the code once more.');
    } finally {
      setPin('');
      setBusy(false);
    }
  };

  return (
    <form className="let-in" onSubmit={(e) => void submit(e)}>
      <span className="prose-note">
        Check with {person.name} that they see this code: <KeyCode publicKey={person.key.public} />
      </span>
      <span className="lock-panel__row">
        {needsPin && <PinInput value={pin} placeholder="Your PIN" aria-label={`Your PIN for ${vault.name}`} onChange={(e) => setPin(e.target.value)} />}
        <button type="submit" className="btn btn--primary" disabled={busy || (needsPin && !pin)}>
          Let in
        </button>
      </span>
      {error && <span className="lock-panel__error">{error}</span>}
    </form>
  );
}
