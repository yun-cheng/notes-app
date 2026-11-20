import type { NoteCard, TodoCard, Vault } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { SyncOffline } from '../sync/engine';
import { shareCard, unshareCard } from '../sync/http';
import { useVaultMove } from './components';
import { Icon } from './Icon';
import { useToast } from './Toast';

type Entry = NoteCard | TodoCard;

/**
 * Puts an entry in another vault besides its own, or takes it out: a share with that vault's members, who can do
 * with it what the vault lets them. It needs a connection, and syncs at once so it shows there straight away.
 */
function useAlsoIn(card: Entry) {
  const { engine } = useCards();
  const toast = useToast();
  const change = async (vault: Vault, on: boolean) => {
    await (on ? shareCard(card.id, { vault_id: vault.id }, 'edit') : unshareCard(card.id, 'vault', vault.id));
    void engine.sync();
  };
  const failed = (err: unknown) =>
    toast(err instanceof SyncOffline ? 'Putting an entry in another vault needs a connection.' : "That didn't work. An entry can go in another vault once it has synced.");
  return async (vault: Vault, on: boolean) => {
    try {
      await change(vault, on);
      toast(on ? `Also in ${vault.name}` : `No longer in ${vault.name}`, { action: { label: 'Undo', run: () => void change(vault, !on).catch(failed) } });
    } catch (err) {
      failed(err);
    }
  };
}

/** Whether an entry's vaults can be changed here: it's this account's to move, with somewhere to move it. */
export function useCanChangeVaults(card: Entry): boolean {
  const { vaults } = useCards();
  return !!useVaultMove(card) && vaults.some((v) => v.id === card.vaultId);
}

/**
 * Where an entry lives, and what other vaults it's also in, to change from its menu: Lives in moves it to another
 * open vault, with an undo; Also in puts it in more or takes it out, each with an undo. `onMoved` follows a move.
 */
export function VaultChoices({ card, onMoved }: { card: Entry; onMoved: () => void }) {
  const { vaults, locked, sharedInto } = useCards();
  const vaultMove = useVaultMove(card);
  const alsoIn = useAlsoIn(card);
  const home = vaults.find((v) => v.id === card.vaultId);
  if (!vaultMove || !home) return null;
  const also = vaults.filter((v) => v.id !== home.id && sharedInto.get(card.id)?.includes(v.id));
  // A private vault's entries are shared from the share dialog, which warns that the PIN won't guard them.
  const more = home.lock === 'pin' ? [] : vaults.filter((v) => v.id !== home.id && !v.encryption && !v.withheld && !locked.has(v.id));
  return (
    <div className="vault-choices">
      <div className="style-menu__group" role="group" aria-label="Lives in">
        <span className="style-menu__label">Lives in</span>
        {vaultMove.options.map((v) => (
          <button
            key={v.id}
            type="button"
            role="menuitemradio"
            aria-checked={v.id === home.id}
            onClick={() => {
              vaultMove.move(v.id);
              onMoved();
            }}
          >
            {v.name}
            {v.lock === 'pin' && <Icon name="lock" size={12} />}
          </button>
        ))}
      </div>
      {more.length > 0 && (
        <div className="style-menu__group" role="group" aria-label="Also in">
          <span className="style-menu__label">Also in</span>
          {more.map((v) => {
            const on = also.some((a) => a.id === v.id);
            return (
              <button key={v.id} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => void alsoIn(v, !on)}>
                {on && <Icon name="check" size={14} />}
                {v.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
