import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { claimLegacyNotes } from '../storage/legacy';
import { CardsProvider, forgetAccountStorage, openAccountStorage } from '../state/CardsContext';
import { deleteAccountOnServer, fetchSignedInAccounts, setRequestAccount, signInWithGoogle, signOutOfServer } from '../sync/http';
import type { Account, SessionInfo } from '../sync/protocol';
import { SignInScreen } from './SignInScreen';

/** The account this browser opens with: the one last chosen in any tab. */
const ACCOUNT_KEY = 'notes-app:account';
/** Every account signed in on this browser, so the account menu can list them offline too. */
const ACCOUNTS_KEY = 'notes-app:accounts';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can refuse storage; the account still works until the tab closes.
  }
}

interface AuthValue {
  account: Account;
  /** The other accounts signed in on this browser, to switch to without signing in again. */
  others: Account[];
  switchTo: (account: Account) => void;
  /** Shows sign-in, to add another Google account while keeping this one. */
  addAccount: () => void;
  /** Signs this account out, and opens the next signed-in account if there is one. */
  signOut: () => Promise<void>;
  /** Deletes this account for good, given its email, then its copy on this device, and opens the next signed-in account. */
  deleteAccount: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAccount(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAccount must be used inside AuthGate');
  return value;
}

const sameAccount = (a: Account, b: Account) => a.id === b.id && a.name === b.name && a.email === b.email && (a.picture ?? null) === (b.picture ?? null);

/**
 * Shows sign-in until there is an account. The account is remembered on the device, so the app opens offline.
 * A browser can be signed in to several accounts; each has its own local database, and switching opens another's.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(() => {
    const saved = load<Account | null>(ACCOUNT_KEY, null);
    setRequestAccount(saved?.id ?? null);
    return saved;
  });
  const [signedIn, setSignedIn] = useState<Account[]>(() => load(ACCOUNTS_KEY, []));
  const [adding, setAdding] = useState(false);

  const open = useCallback((user: Account | null) => {
    setRequestAccount(user?.id ?? null);
    save(ACCOUNT_KEY, user);
    setAccount(user);
    setAdding(false);
  }, []);

  // The server knows which accounts this browser is signed in to. Asked again whenever another account opens.
  useEffect(() => {
    let live = true;
    fetchSignedInAccounts()
      .then((list) => {
        if (!live) return;
        save(ACCOUNTS_KEY, list);
        setSignedIn(list);
        // A name or photo changed at Google since this device last signed in.
        const fresh = account && list.find((a) => a.id === account.id);
        if (fresh && !sameAccount(fresh, account)) open(fresh);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Only when the open account changes, not when its details are refreshed.
  }, [account?.id, open]);

  const finish = useCallback(
    async ({ user, vaults }: SessionInfo) => {
      const { store, repo } = openAccountStorage(user.id);
      await store.putVaults(vaults);
      await repo.init();
      await claimLegacyNotes(repo);
      open(user);
    },
    [open],
  );

  const signIn = useCallback(async (credential: string) => finish(await signInWithGoogle(credential)), [finish]);

  // Unsynced changes stay in this account's local database and sync at its next sign-in.
  const signOut = useCallback(async () => {
    const rest = await signOutOfServer().catch(() => signedIn.filter((a) => a.id !== account?.id));
    save(ACCOUNTS_KEY, rest);
    setSignedIn(rest);
    open(rest[0] ?? null);
  }, [account, signedIn, open]);

  const deleteAccount = useCallback(
    async (email: string) => {
      if (!account) return;
      const rest = await deleteAccountOnServer(email);
      save(ACCOUNTS_KEY, rest);
      setSignedIn(rest);
      open(rest[0] ?? null);
      // Once its notes are closed, which opening another account does.
      await forgetAccountStorage(account.id);
    },
    [account, open],
  );

  const value = useMemo<AuthValue | null>(
    () =>
      account
        ? { account, others: signedIn.filter((a) => a.id !== account.id), switchTo: open, addAccount: () => setAdding(true), signOut, deleteAccount }
        : null,
    [account, signedIn, open, signOut, deleteAccount],
  );

  if (!value || adding) {
    return (
      <SignInScreen
        onCredential={signIn}
        // Accounts still signed in on this browser open with one press, no Google needed.
        accounts={value ? [] : signedIn}
        onPick={open}
        onCancel={value ? () => setAdding(false) : undefined}
      />
    );
  }
  return (
    <AuthContext.Provider value={value}>
      <CardsProvider key={value.account.id} accountId={value.account.id}>
        {children}
      </CardsProvider>
    </AuthContext.Provider>
  );
}
