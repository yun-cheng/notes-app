import { verifyPin } from './pin';
import type { Vault } from './types';

export type UnlockResult = 'ok' | 'wrong' | 'throttled';

/** Opening and forgetting the keys of end-to-end encrypted vaults, alongside their locks. */
export interface VaultKeyHooks {
  /** Unwraps the vault key with the PIN. False if the PIN is wrong. */
  unlock(vault: Vault, pin: string): Promise<boolean>;
  /** Uses a key kept on this device for fingerprint unlock. False if there isn't one. */
  unlockStored(vault: Vault): Promise<boolean>;
  forget(vaultId: string): void;
  forgetAll(): void;
}

const noKeys: VaultKeyHooks = { unlock: async () => true, unlockStored: async () => true, forget: () => undefined, forgetAll: () => undefined };

const AUTO_LOCK_MS = 5 * 60_000;
const FREE_ATTEMPTS = 5;
const THROTTLE_MS = 30_000;

/** Which private vaults are open on this device. Held only in memory, so a reload locks everything. */
export class VaultLocks {
  private open: ReadonlySet<string> = new Set();
  private listeners = new Set<() => void>();
  private failures = 0;
  private blockedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private now: () => number = Date.now,
    private autoLockMs = AUTO_LOCK_MS,
    private keys: VaultKeyHooks = noKeys,
  ) {}

  getOpen = () => this.open;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private set(next: ReadonlySet<string>) {
    this.open = next;
    this.listeners.forEach((l) => l());
  }

  isThrottled() {
    return this.now() < this.blockedUntil;
  }

  private markOpen(id: string) {
    this.set(new Set([...this.open, id]));
    this.touch();
  }

  /** Opens a vault whose key, if it has one, is already in the keyring, such as after recovery. */
  unlockVerified(id: string) {
    this.failures = 0;
    this.markOpen(id);
  }

  /** Opens a vault after another check, such as a fingerprint. An encrypted vault also needs its key kept on this device. */
  async unlockWithDevice(vault: Vault): Promise<boolean> {
    if (vault.encryption && !(await this.keys.unlockStored(vault))) return false;
    this.unlockVerified(vault.id);
    return true;
  }

  /** The PIN opens an encrypted vault only if it unwraps the vault key, which checks it too. */
  private async matches(vault: Vault, pin: string): Promise<boolean> {
    if (vault.encryption) return this.keys.unlock(vault, pin);
    return !!vault.pin && (await verifyPin(pin, vault.pin));
  }

  async tryUnlock(vault: Vault, pin: string): Promise<UnlockResult> {
    if (this.isThrottled()) return 'throttled';
    if (await this.matches(vault, pin)) {
      this.unlockVerified(vault.id);
      return 'ok';
    }
    return this.recordFailure();
  }

  /** Tries a PIN against several vaults at once, for finding a hidden vault without naming it. */
  async tryUnlockAny(vaults: Vault[], pin: string): Promise<UnlockResult> {
    if (this.isThrottled()) return 'throttled';
    const matches = await Promise.all(vaults.map((v) => this.matches(v, pin)));
    const found = vaults.filter((_, i) => matches[i]);
    if (!found.length) return this.recordFailure();
    found.forEach((v) => this.unlockVerified(v.id));
    return 'ok';
  }

  private recordFailure(): UnlockResult {
    if (++this.failures >= FREE_ATTEMPTS) {
      this.blockedUntil = this.now() + THROTTLE_MS;
      this.failures = 0;
    }
    return 'wrong';
  }

  lock(id: string) {
    this.keys.forget(id);
    if (this.open.has(id)) this.set(new Set([...this.open].filter((v) => v !== id)));
  }

  lockAll() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.keys.forgetAll();
    if (this.open.size) this.set(new Set());
  }

  /** Restarts the idle timer. */
  touch() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = this.open.size ? setTimeout(() => this.lockAll(), this.autoLockMs) : null;
  }

  /** Locks on going to the background and after five idle minutes. */
  start(): () => void {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') this.lockAll();
    };
    const onActivity = () => this.touch();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      this.lockAll();
    };
  }
}

/** A vault with a PIN that this device hasn't opened. */
export function lockedVaultIds(vaults: Vault[], open: ReadonlySet<string>): Set<string> {
  return new Set(vaults.filter((v) => v.lock === 'pin' && !open.has(v.id)).map((v) => v.id));
}


/** Each account's first vault. It holds new cards, so it always stays open. */
export const isDefaultVault = (vault: Vault) => vault.id === `vault-${vault.owner_id}`;

/** Oldest first, which puts the default vault at the top. */
export const sortVaults = (vaults: Vault[]) => [...vaults].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
