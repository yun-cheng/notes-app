import { useEffect, useState } from 'react';
import { formatMoment } from '../../domain/dates';
import { count as plural } from '../../domain/plural';
import type { AiAccess, Vault } from '../../domain/types';
import { Link, useLocation } from 'react-router';
import { useAccount } from '../../auth/AuthContext';
import { useCards } from '../../state/CardsContext';
import { SyncAuthExpired, SyncOffline } from '../../sync/engine';
import { answerOAuth, disconnectAiApp, fetchAiApps, fetchOAuthClient, updateAiDefaultAccess } from '../../sync/http';
import type { ConnectedApp } from '../../sync/protocol';
import { Empty, Section } from '../components';
import { useToast } from '../Toast';
import { AI_ACCESS_LABEL, AiAccessField } from './vaults';

export const mcpUrl = () => `${location.origin}/api/mcp`;

const vaultSummary = (vaults: Vault[]) => {
  const shown = vaults.slice(0, 5).map((v) => `${v.name} (${AI_ACCESS_LABEL[v.ai_access].toLowerCase()}${v.role && v.role !== 'owner' ? ', shared' : ''})`);
  return vaults.length > 5 ? `${shown.join(', ')} and ${vaults.length - 5} more` : shown.join(', ');
};

/**
 * The page an AI app sends the person to, to approve it once. Which vaults AI apps may reach is managed in the app
 * under Backup & settings → AI apps (default for open vaults, plus per-vault overrides).
 */
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

  const reachable = vaults.filter((v) => v.lock === 'none' && !v.withheld && v.ai_access !== 'off');

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
            {reachable.length ? (
              <p className="prose-note">
                Currently open to AI: {vaultSummary(reachable)}.
              </p>
            ) : (
              <p className="connect__warn">No vault is open to AI yet, so {client.name} will see nothing until you turn it on.</p>
            )}
            <p className="prose-note">
              You can set a default for all open vaults or change individual vaults any time in{' '}
              <Link to="/settings">Backup &amp; settings</Link>. Private vaults are never visible to AI. Every change it makes is kept in history, marked as
              made by {client.name}, and can be undone.
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
  return `Last used ${formatMoment(app.last_used_at)}`;
}

/** Settings: how to connect an AI app, default & per-vault AI access, and the apps already connected. */
export function AiAppsSection() {
  const { vaults, locked, repo } = useCards();
  const toast = useToast();
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [defaultAccess, setDefaultAccess] = useState<AiAccess | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const [filter, setFilter] = useState('');
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    fetchAiApps().then(
      (res) => {
        setApps(res.apps);
        setDefaultAccess(res.default_access);
      },
      () => setOffline(true),
    );
  }, []);

  const changeDefault = async (next: AiAccess) => {
    setSavingDefault(true);
    try {
      const res = await updateAiDefaultAccess(next);
      setDefaultAccess(res.default_access);
      await repo.putVaults(res.vaults);
      toast('Default AI access updated');
    } catch (err) {
      toast(err instanceof SyncOffline ? 'Connect to the internet to change AI access.' : "That change couldn't be saved.");
    } finally {
      setSavingDefault(false);
    }
  };

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

  const ownedOpen = vaults.filter((v) => (v.role ?? 'owner') === 'owner' && v.lock === 'none');
  const shownDefault: AiAccess = defaultAccess ?? ownedOpen.find((v) => !v.ai_access_override)?.ai_access ?? 'off';
  const privateCount = vaults.filter((v) => v.lock === 'pin' && !(v.hidden && locked.has(v.id))).length;
  const sharedOpen = vaults.filter((v) => v.role && v.role !== 'owner' && v.lock === 'none' && !v.withheld && v.ai_access !== 'off');
  const query = filter.trim().toLowerCase();
  const shownVaults = query ? ownedOpen.filter((v) => v.name.toLowerCase().includes(query)) : ownedOpen;

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

      <div className="ai-field vault-gap">
        <label className="field-row">
          Default for open vaults
          <select
            value={shownDefault}
            disabled={offline || savingDefault || defaultAccess === null}
            aria-label="Default AI access for open vaults"
            onChange={(e) => void changeDefault(e.target.value as AiAccess)}
          >
            <option value="off">Off</option>
            <option value="read">Read</option>
            <option value="write">Read and write</option>
          </select>
        </label>
        <p className="prose-note">
          Applies to every unlocked vault you own, including new ones, unless you choose otherwise below. Private vaults are always off.
        </p>
      </div>

      {ownedOpen.length > 0 && (
        <div className="ai-vaults vault-gap">
          {ownedOpen.length > 6 && (
            <input
              className="text-input ai-vaults__filter"
              value={filter}
              placeholder="Filter vaults…"
              aria-label="Filter vaults"
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          <div className="list">
            {shownVaults.map((v) => (
              <AiAccessField key={v.id} vault={v} defaultAccess={shownDefault} compact />
            ))}
          </div>
          {query && !shownVaults.length && <p className="prose-note">No open vault matches "{filter}".</p>}
        </div>
      )}

      {privateCount > 0 && (
        <p className="prose-note vault-gap">{plural(privateCount, 'private vault')} {privateCount === 1 ? 'is' : 'are'} always off.</p>
      )}
      {sharedOpen.length > 0 && (
        <p className="prose-note vault-gap">
          Shared vaults open to AI (read only): {sharedOpen.map((v) => v.name).join(', ')}.
        </p>
      )}

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
