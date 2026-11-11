import { useEffect, useRef, useState } from 'react';
import { SyncAuthExpired, SyncOffline } from '../sync/engine';
import { fetchConfig } from '../sync/http';

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
      renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';

function loadGoogleScript(): Promise<GoogleIdentityServices> {
  return new Promise((resolve, reject) => {
    if (window.google) return resolve(window.google);
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google sign-in did not load')));
    script.onerror = () => reject(new SyncOffline('Google sign-in could not be reached'));
    document.head.appendChild(script);
  });
}

type Phase = 'loading' | 'ready' | 'unconfigured' | 'offline' | 'busy';

export function SignInScreen({ onCredential }: { onCredential: (credential: string) => Promise<void> }) {
  const button = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const handler = useRef(onCredential);
  handler.current = onCredential;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { googleClientId } = await fetchConfig();
        if (!active) return;
        if (!googleClientId) return setPhase('unconfigured');
        const google = await loadGoogleScript();
        if (!active || !button.current) return;
        google.accounts.id.initialize({
          client_id: googleClientId,
          callback: ({ credential }) => {
            setPhase('busy');
            setError(null);
            handler.current(credential).catch((err: unknown) => {
              console.error(err);
              setPhase('ready');
              setError(
                err instanceof SyncOffline
                  ? "You're offline. Connect and try again."
                  : err instanceof SyncAuthExpired
                    ? 'Google could not confirm that account. Try again.'
                    : 'Sign-in failed. Try again.',
              );
            });
          },
        });
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        google.accounts.id.renderButton(button.current, { theme: dark ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 260 });
        setPhase('ready');
      } catch (err) {
        if (!active) return;
        console.error(err);
        setPhase(err instanceof SyncOffline ? 'offline' : 'unconfigured');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="signin">
      <div className="signin__card">
        <h1>Notes</h1>
        <p className="signin__lede">Your notes, todos and diary, on every device.</p>
        <div className="signin__button" ref={button} hidden={phase !== 'ready'} />
        {phase === 'loading' && <p className="signin__note">Getting sign-in ready…</p>}
        {phase === 'busy' && <p className="signin__note">Signing you in…</p>}
        {phase === 'offline' && <p className="signin__note">Connect to the internet to sign in.</p>}
        {phase === 'unconfigured' && <p className="signin__note">Sign-in isn't available yet.</p>}
        {error && (
          <p className="signin__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
