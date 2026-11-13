import { describe, expect, it } from 'vitest';
import { mainVault, ownAlone, permissions } from './access';
import { note } from './testFixtures';
import type { Vault } from './types';

const vault = (id: string, role?: Vault['role'], created_at = 1): Vault => ({ id, name: id, owner_id: 'o', lock: 'none', ai_access: 'off', created_at, pin: null, hidden: false, role });

describe('permissions', () => {
  it('follows the role in the card’s vault', () => {
    expect(permissions(note('n', 'x', { vaultId: 'v' }), [vault('v', 'owner')], new Map())).toMatchObject({ edit: true, manage: true, share: true, note: null });
    expect(permissions(note('n', 'x', { vaultId: 'v' }), [vault('v', 'viewer')], new Map())).toMatchObject({ edit: false, comment: true, manage: false, share: false });
    expect(permissions(note('n', 'x', { vaultId: 'v' }), [vault('v')], new Map()).edit).toBe(true);
  });
  it('follows a share for a card outside the account’s vaults', () => {
    const shared = new Map([['n', { card_id: 'n', role: 'edit' as const, shared_by: 'Ann' }]]);
    expect(permissions(note('n', 'x', { vaultId: 'elsewhere' }), [vault('v')], shared)).toMatchObject({ edit: true, manage: false, share: false, sharedBy: 'Ann' });
    expect(permissions(note('m', 'x', { vaultId: 'elsewhere' }), [vault('v')], shared)).toMatchObject({ edit: false, comment: false });
  });
  it('knows a vault that is the account’s alone', () => {
    expect(ownAlone(vault('v'))).toBe(true);
    expect(ownAlone({ ...vault('v', 'owner'), members: 2 })).toBe(false);
    expect(ownAlone(vault('v', 'editor'))).toBe(false);
    expect(ownAlone(undefined)).toBe(false);
  });
  it('finds the account’s own main vault even when a shared one is older', () => {
    expect(mainVault([vault('vault-ann', 'viewer', 1), vault('vault-ben', 'owner', 5)], 'ben').id).toBe('vault-ben');
  });
});
