import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useAccount } from '../../auth/AuthContext';
import { useCards } from '../../state/CardsContext';
import { SyncAuthExpired, SyncOffline } from '../../sync/engine';
import { answerOAuth, disconnectAiApp, fetchOAuthClient, listAiApps, type ConnectedApp } from '../../sync/http';
import { Empty, Section } from '../components';
import { useToast } from '../Toast';
import { AiAccessField } from './vaults';

const ACCESS_LABEL = { off: 'Off', read: 'Read', write: 'Read and write' } as const;

export const mcpUrl = () => `${location.origin}/api/mcp`;

/** The page an AI app sends the person to, to approve it once. What it may do is set per vault. */
export function ConnectPage() {
  const query = new URLSearchParams(useLocation().search);
  const { vaults } = useCards();
  const { account, signOut } = useAccount();
  const [client, setClient] = useState<{ name: string; redirect_host: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const params: Record<string, string> = {};
  for (const key of ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method']) {
    const value = query.get(key);
    if (value !== null) params[key] = value;
  }
  const valid = query.get('response_type') === 'code' && !!params.client_id && !!params.redirect_uri;

  useEffect(() => {
    if (!valid) return;
    fetchOAuthClient(params.client_id, params.redirect_uri).then(setClient, (err: unknown) =>
      setProblem(err instanceof SyncOffline ? 'Connect to the internet to continue.' : "This connection request isn't valid. Start again from the AI app."),
    );
    // The query string is fixed for the life of this page.
  }, [valid]);

  const answer = async (approve: boolean) => {
    setBusy(true);
    try {
      location.href = await answerOAuth(params, approve);
    } catch (err) {
      setBusy(false);
      setProblem(err instanceof SyncAuthExpired ? 'Your session ended. Sign in again, then start again from the AI app.' : "That didn't go through. Try again.");
    }
  };

  const open = vaults.filter((v) => v.lock === 'none');
  const reachable = open.filter((v) => v.ai_access !== 'off');

  return (
    <main className="connect">
      <div className="connect__card">
        {!valid || problem ? (
          <>
            <h1>Can't connect</h1>
            <p>{problem ?? "This link is missing details. Start again from the AI app."}</p>
            {problem?.startsWith('Your session') && (
              <button type="button" className="btn" onClick={() => void signOut()}>
                Sign in again
              </button>
            )}
            <Link className="btn" to="/today">
              Back to notes
            </Link>
          </>
        ) : !client ? (
          <p className="prose-note">Checking the request…</p>
        ) : (
          <>
            <h1>Connect {client.name}?</h1>
            <p className="prose-note">
              {client.name} ({client.redirect_host}) wants to use the notes of {account.name}.
            </p>

            <h2>What it can reach</h2>
            <p className="prose-note">Choose for each vault. You can change this any time under Vaults.</p>
            <div className="connect__vaults">
              {open.map((v) => (
                <AiAccessField key={v.id} vault={v} labelled />
              ))}
            </div>
            {!reachable.length && <p className="connect__warn">No vault is open to AI yet, so {client.name} will see nothing.</p>}
            <p className="prose-note">
              Private vaults are never visible to AI. Every change it makes is kept in history, marked as made by {client.name}, and can be undone.
              Disconnect it any time in Backup & settings.
            </p>

            <div className="button-row">
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void answer(true)}>
                Allow
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void answer(false)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function lastUsed(app: ConnectedApp): string {
  if (!app.last_used_at) return 'Not used yet';
  return `Last used ${new Date(app.last_used_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

/** Settings: how to connect an AI app, and the apps already connected. */
export function AiAppsSection() {
  const { vaults } = useCards();
  const toast = useToast();
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    listAiApps().then(setApps, () => setOffline(true));
  }, []);

  const disconnect = async (app: ConnectedApp) => {
    try {
      await disconnectAiApp(app.id);
      setApps((list) => list?.filter((a) => a.id !== app.id) ?? null);
      toast(`Disconnected ${app.name}`);
    } catch {
      toast("Couldn't disconnect. Check your connection and try again.");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl());
      toast('Copied');
    } catch {
      toast("Couldn't copy. Select the address and copy it yourself.");
    }
  };

  const open = vaults.filter((v) => v.lock === 'none' && v.ai_access !== 'off');

  return (
    <Section title="AI apps">
      <p className="prose-note">
        Claude and other AI apps can read and edit vaults you open to them. In the app, add a custom connector (in Claude: Settings, Connectors) with this address:
      </p>
      <div className="lock-panel__row vault-gap">
        <input className="text-input" readOnly value={mcpUrl()} aria-label="Connector address" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn" onClick={() => void copy()}>
          Copy
        </button>
      </div>
      <p className="prose-note vault-gap">
        {open.length
          ? `Open to AI: ${open.map((v) => `${v.name} (${ACCESS_LABEL[v.ai_access].toLowerCase()})`).join(', ')}.`
          : 'No vault is open to AI yet. Turn it on for a vault under Vaults.'}
      </p>
      {offline ? (
        <Empty>Connect to the internet to see connected apps.</Empty>
      ) : apps === null ? null : apps.length ? (
        <div className="list vault-gap">
          {apps.map((app) => (
            <div className="row" key={app.id}>
              <span className="row__body">
                <span className="row__title">{app.name}</span>
                <span className="row__preview">{lastUsed(app)}</span>
              </span>
              <button type="button" className="btn" onClick={() => void disconnect(app)}>
                Disconnect
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty>No AI app is connected.</Empty>
      )}
    </Section>
  );
}
