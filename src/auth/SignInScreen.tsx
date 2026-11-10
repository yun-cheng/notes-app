import { useEffect, useRef, useState } from 'react';
import { SyncAuthExpired, SyncOffline } from '../sync/engine';
import { claimPairing, fetchConfig, startPairing } from '../sync/http';
import type { SessionInfo } from '../sync/protocol';
import { isNativeShell } from './shell';

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

const POLL_MS = 2000;

/**
 * Inside the native app Google won't sign in, so the app pairs with a signed-in browser instead.
 * Both show the same short code, so a link from someone else can't sign their app in as you.
 */
function BrowserSignIn({ onSession }: { onSession: (info: SessionInfo) => Promise<void> }) {
  const [pairing, setPairing] = useState<{ pair: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pairing) return;
    let live = true;
    const poll = async () => {
      const result = await claimPairing(pairing.pair);
      if (!live) return;
      if (result === 'pending') return void setTimeout(poll, POLL_MS);
      if (result === 'expired') {
        setPairing(null);
        return setError('That took too long. Start again.');
      }
      await onSession(result).catch(() => setError('Sign-in failed. Start again.'));
    };
    const timer = setTimeout(poll, POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pairing, onSession]);

  const start = async () => {
    setError(null);
    try {
      const next = await startPairing();
      setPairing(next);
      // The app opens anything outside itself in the system browser.
      window.open(`${location.origin}/pair?p=${encodeURIComponent(next.pair)}`, '_blank');
    } catch (err) {
      setError(err instanceof SyncOffline ? 'Connect to the internet to sign in.' : 'Sign-in failed. Try again.');
    }
  };

  return (
    <>
      {pairing ? (
        <>
          <p className="signin__note">Your browser opened. Sign in there and confirm this code:</p>
          <p className="signin__code" aria-label="Code">
            {pairing.code}
          </p>
          <p className="signin__note">Waiting for your browser…</p>
          <button type="button" className="btn btn--quiet" onClick={() => void start()}>
            Open the browser again
          </button>
        </>
      ) : (
        <button type="button" className="btn btn--primary" onClick={() => void start()}>
          Sign in with your browser
        </button>
      )}
      {error && (
        <p className="signin__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function SignInScreen({ onCredential, onSession }: { onCredential: (credential: string) => Promise<void>; onSession: (info: SessionInfo) => Promise<void> }) {
  const native = useState(isNativeShell)[0];
  const button = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const handler = useRef(onCredential);
  handler.current = onCredential;

  useEffect(() => {
    if (native) return;
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
  }, [native]);

  return (
    <main className="signin">
      <div className="signin__card">
        <h1>Notes</h1>
        <p className="signin__lede">Your notes, todos and diary, on every device.</p>
        {native && <BrowserSignIn onSession={onSession} />}
        <div className="signin__button" ref={button} hidden={native || phase !== 'ready'} />
        {!native && phase === 'loading' && <p className="signin__note">Getting sign-in ready…</p>}
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
