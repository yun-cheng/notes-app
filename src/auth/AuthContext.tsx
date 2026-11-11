import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { claimLegacyNotes } from '../storage/legacy';
import { CardsProvider, openAccountStorage } from '../state/CardsContext';
import { signInWithGoogle, signOutOfServer } from '../sync/http';
import type { Account, SessionInfo } from '../sync/protocol';
import { SignInScreen } from './SignInScreen';

const ACCOUNT_KEY = 'notes-app:account';

function loadAccount(): Account | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

interface AuthValue {
  account: Account;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAccount(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAccount must be used inside AuthGate');
  return value;
}

/** Shows sign-in until there is an account. The account is remembered on the device, so the app opens offline. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(loadAccount);

  const finish = useCallback(async ({ user, vaults }: SessionInfo) => {
    const { store, repo } = openAccountStorage(user.id);
    await store.putVaults(vaults);
    await repo.init();
    await claimLegacyNotes(repo);
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(user));
    setAccount(user);
  }, []);

  const signIn = useCallback(async (credential: string) => finish(await signInWithGoogle(credential)), [finish]);

  // Unsynced changes stay in this account's local database and sync at next sign-in.
  const signOut = useCallback(async () => {
    localStorage.removeItem(ACCOUNT_KEY);
    setAccount(null);
    await signOutOfServer().catch(() => undefined);
  }, []);

  const value = useMemo(() => (account ? { account, signOut } : null), [account, signOut]);

  if (!value) return <SignInScreen onCredential={signIn} />;
  return (
    <AuthContext.Provider value={value}>
      <CardsProvider key={value.account.id} accountId={value.account.id}>
        {children}
      </CardsProvider>
    </AuthContext.Provider>
  );
}
