import type { SharedCard } from '../sync/protocol';
import type { Card, Vault } from './types';

export interface Permissions {
  /** Change the text and fields. */
  edit: boolean;
  comment: boolean;
  /** Trash it or move it to another vault, which only members of its vault can do. */
  manage: boolean;
  /** Share it onward. */
  share: boolean;
  /** Set when the card reaches this account through a share rather than a vault. */
  sharedBy: string | null;
  /** A short description of how this account reaches the card, when it isn't simply its own. */
  note: string | null;
}

const NONE: Permissions = { edit: false, comment: false, manage: false, share: false, sharedBy: null, note: null };
const SHARE_NOTE = { view: 'You can view it', comment: 'You can view and comment', edit: 'You can edit it' };

/** What this account may do with a card, from its role in the card's vault or the share that reached it. */
export function permissions(card: Card, vaults: Vault[], shared: ReadonlyMap<string, SharedCard>): Permissions {
  const vault = vaults.find((v) => v.id === card.vaultId);
  if (vault) {
    const role = vault.role ?? 'owner';
    const write = role !== 'viewer';
    const note = role === 'owner' ? null : `In ${vault.name}, shared with you as ${role === 'editor' ? 'an editor' : 'a viewer'}`;
    return { edit: write, comment: true, manage: write, share: write, sharedBy: null, note };
  }
  const share = shared.get(card.id);
  if (!share) return NONE;
  return {
    edit: share.role === 'edit',
    comment: share.role !== 'view',
    manage: false,
    share: false,
    sharedBy: share.shared_by,
    note: `Shared with you by ${share.shared_by}. ${SHARE_NOTE[share.role]}.`,
  };
}

/** The account's own main vault, which new cards go into. */
export const mainVault = (vaults: Vault[], accountId: string) => vaults.find((v) => v.id === `vault-${accountId}`) ?? vaults[0];

/** The account's diary: the vault made for it at sign-in, whatever it has been renamed to. `#diary` files an entry there. */
export const diaryVault = (vaults: Vault[], accountId: string) => vaults.find((v) => v.id === `diary-${accountId}`);
