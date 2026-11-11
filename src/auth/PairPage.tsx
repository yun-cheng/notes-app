import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { approvePairing, pairingCode } from '../sync/http';
import { useAccount } from './AuthContext';

/** In the browser: confirm that the native app showing this code may sign in as you. */
export function PairPage() {
  const params = new URLSearchParams(useLocation().search);
  const pair = params.get('p') ?? '';
  /** The native apps open this page in a sign-in sheet that closes when it reaches their own URL scheme. */
  const returnToApp = params.get('return') === 'app';
  const { account } = useAccount();
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'done' | 'expired'>('loading');

  useEffect(() => {
    pairingCode(pair).then(
      (c) => {
        setCode(c);
        setState('ready');
      },
      () => setState('expired'),
    );
  }, [pair]);

  const approve = async () => {
    try {
      await approvePairing(pair);
      setState('done');
      if (returnToApp) location.href = 'notesapp://paired';
    } catch {
      setState('expired');
    }
  };

  return (
    <main className="connect">
      <div className="connect__card">
        {state === 'loading' && <p className="prose-note">Checking…</p>}
        {state === 'expired' && (
          <>
            <h1>This sign-in has expired</h1>
            <p className="prose-note">Start again from the app.</p>
          </>
        )}
        {state === 'ready' && (
          <>
            <h1>Sign in the Notes app?</h1>
            <p className="prose-note">Only continue if the app on your device shows this code:</p>
            <p className="signin__code">{code}</p>
            <p className="prose-note">It will be signed in as {account.name} ({account.email}).</p>
            <div className="button-row">
              <button type="button" className="btn btn--primary" onClick={() => void approve()}>
                Yes, sign in the app
              </button>
              <Link className="btn" to="/today">
                Cancel
              </Link>
            </div>
          </>
        )}
        {state === 'done' && (
          <>
            <h1>Done</h1>
            <p className="prose-note">The app is signing in. You can close this tab and go back to it.</p>
          </>
        )}
      </div>
    </main>
  );
}
